import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  searchOpportunities,
  fetchOpportunityDetail,
  computeSearchHash,
  transformHit,
} from "@/lib/grants-gov";

export const maxDuration = 300;

const MIN_RESULTS_SAFETY = 500; // skip reconciliation if fewer than this

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Fetch all posted opportunities from Grants.gov
    const allHits = await searchOpportunities();

    if (allHits.length === 0) {
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

    // 3. Identify new or changed grants
    const newOrChanged = allHits.filter((hit) => {
      const sourceId = String(hit.id);
      const currentHash = computeSearchHash(hit);
      const storedHash = existingHashes.get(sourceId);
      return !storedHash || storedHash !== currentHash;
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
        .upsert(batch, { onConflict: "source,source_id" });
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
