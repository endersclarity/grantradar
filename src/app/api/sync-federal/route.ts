import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  searchOpportunities,
  fetchOpportunityDetail,
  computeSearchHash,
  transformHit,
} from "@/lib/grants-gov";
import { sendSyncReportEmail } from "@/lib/email";
import type { SyncGrantResult } from "@/lib/grants";

export const maxDuration = 300;

// With AR|HU|CD|NR category filter, expect ~60 results — lowered from 500
const MIN_RESULTS_SAFETY = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const timestamp = startedAt.toISOString();

  try {
    // 1. Fetch all posted opportunities from Grants.gov
    const allHits = await searchOpportunities();

    if (allHits.length === 0) {
      await sendSyncReportEmail({
        source: "Grants.gov",
        timestamp,
        fetched: 0,
        newGrants: [],
        closed: 0,
        errors: ["No grants fetched — API may be down"],
      });
      return NextResponse.json(
        { error: "No grants fetched — API may be down", fetched: 0 },
        { status: 500 }
      );
    }

    // 2. Load existing search hashes for diff detection
    const { data: existing } = await supabase
      .from("grants")
      .select("source_id, search_hash")
      .eq("source", "grants_gov");

    const existingHashes = new Map(
      (existing || []).map((g) => [g.source_id, g.search_hash])
    );

    // 3. Identify new or changed grants — separate truly new from updated
    const newGrants: SyncGrantResult[] = [];
    const newOrChanged = allHits.filter((hit) => {
      const sourceId = String(hit.id);
      const currentHash = computeSearchHash(hit);
      const storedHash = existingHashes.get(sourceId);
      if (!storedHash) {
        // Truly new — not in database at all
        newGrants.push({
          title: hit.title || "Untitled",
          agency: hit.agency || "Unknown Agency",
          deadline: hit.closeDate || null,
          url: `https://www.grants.gov/search-results-detail/${hit.id}`,
        });
        return true;
      }
      return storedHash !== currentHash;
    });

    // 4. Fetch details for new/changed grants only
    let detailsFetched = 0;
    const grantsToUpsert = [];

    for (const hit of allHits) {
      const sourceId = String(hit.id);
      const isNewOrChanged = newOrChanged.some((h) => String(h.id) === sourceId);

      let detail = null;
      if (isNewOrChanged && detailsFetched < 200) {
        // Cap detail fetches per run to avoid rate limiting.
        // First run: ~200 details per invocation. Run curl multiple times to backfill.
        detail = await fetchOpportunityDetail(hit.id);
        if (detail) detailsFetched++;
        // 200ms delay between detail fetches to avoid IP ban
        await new Promise((r) => setTimeout(r, 200));
      }

      grantsToUpsert.push(transformHit(hit, isNewOrChanged ? detail : null));
    }

    // 5. Upsert in batches
    let upserted = 0;
    const errors: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < grantsToUpsert.length; i += batchSize) {
      const batch = grantsToUpsert.slice(i, i + batchSize);
      const { error } = await supabase
        .from("grants")
        .upsert(batch, { onConflict: "source_id" });
      if (error) {
        errors.push(`Batch ${i}: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    // 6. Reconciliation: close stale federal grants
    let closed = 0;
    if (allHits.length >= MIN_RESULTS_SAFETY) {
      const threeDaysAgo = new Date(
        Date.now() - 3 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: stale } = await supabase
        .from("grants")
        .select("id")
        .eq("source", "grants_gov")
        .eq("status", "active")
        .lt("last_seen_in_sync", threeDaysAgo);

      if (stale && stale.length > 0) {
        const staleIds = stale.map((g) => g.id);
        const { error: closeError } = await supabase
          .from("grants")
          .update({ status: "closed" })
          .in("id", staleIds);
        if (!closeError) closed = staleIds.length;
      }
    } else {
      console.warn(
        `Federal sync: only ${allHits.length} results (< ${MIN_RESULTS_SAFETY}). Skipping reconciliation.`
      );
    }

    const duration = Date.now() - startedAt.getTime();

    // 7. Log to sync_runs
    await supabase.from("sync_runs").insert({
      source: "grants_gov",
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      grants_fetched: allHits.length,
      grants_new: newGrants.length,
      grants_closed: closed,
      error: errors.length > 0 ? errors.join("; ") : null,
      duration_ms: duration,
    });

    // 8. Send Telegram notification
    await sendSyncReportEmail({
      source: "Grants.gov",
      timestamp,
      fetched: allHits.length,
      newGrants,
      closed,
      errors,
    });

    return NextResponse.json({
      source: "grants_gov",
      fetched: allHits.length,
      new_or_changed: newOrChanged.length,
      details_fetched: detailsFetched,
      upserted,
      closed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Federal sync error:", err);
    const duration = Date.now() - startedAt.getTime();

    // Log failure to sync_runs
    await supabase.from("sync_runs").insert({
      source: "grants_gov",
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      grants_fetched: 0,
      grants_new: 0,
      grants_closed: 0,
      error: err instanceof Error ? err.message : "Sync failed",
      duration_ms: duration,
    });

    // Still send Telegram on crash
    await sendSyncReportEmail({
      source: "Grants.gov",
      timestamp,
      fetched: 0,
      newGrants: [],
      closed: 0,
      errors: [err instanceof Error ? err.message : "Sync failed"],
    }).catch(() => {}); // don't let notification failure mask the real error
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
