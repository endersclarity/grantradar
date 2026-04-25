import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabase-server";
import { matchGrantsForOrg } from "@/lib/matching";
import { sendDigestEmail } from "@/lib/email";

export const maxDuration = 120;

interface DigestResult {
  org: string;
  status: "sent" | "skipped_empty" | "send_failed" | "match_error";
  grants: number;
  error?: string;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all verified, non-cancelled orgs
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("email_verified", true)
    .not("subscription_status", "eq", "cancelled");

  if (orgError || !orgs) {
    return NextResponse.json({ error: orgError?.message || "No orgs" }, { status: 500 });
  }

  // Fetch ALL active grants ONCE (not per org). Exclude raw_json to save memory.
  const { data: allGrants, error: grantsError } = await supabase
    .from("grants")
    .select("id, portal_id, source, source_id, status, title, agency, purpose, description, synopsis, eligibility, categories, applicant_types, geography_text, est_amounts_text, application_deadline, deadline_date, open_date, grant_url, contact_info, first_seen_at, ai_tags, ai_summary")
    .in("status", ["active", "forecasted"]);

  if (grantsError) {
    return NextResponse.json({ error: `Grant fetch failed: ${grantsError.message}` }, { status: 500 });
  }

  const results: DigestResult[] = [];
  // Compute current digest week (ISO week) for dedup
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  const digestWeek = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      // Dedup check: skip if already sent this week
      const { data: existing } = await supabase
        .from("digests")
        .select("id")
        .eq("org_id", org.id)
        .eq("digest_week", digestWeek)
        .limit(1);

      if (existing && existing.length > 0) {
        results.push({ org: org.name, status: "skipped_empty", grants: 0 });
        skipped++;
        continue;
      }
      const matched = await matchGrantsForOrg(
        {
          id: org.id,
          categories: org.categories,
          geography_keywords: org.geography_keywords,
          mission_keywords: org.mission_keywords || [],
          min_grant_amount: org.min_grant_amount || null,
        },
        allGrants || []
      );

      if (matched.length === 0) {
        results.push({ org: org.name, status: "skipped_empty", grants: 0 });
        skipped++;
        continue;
      }

      const showUpgrade = org.tier === "free";
      const emailResult = await sendDigestEmail(
        org.email, org.name, matched, org.unsubscribe_token, showUpgrade
      );

      if (emailResult) {
        await supabase.from("digests").insert({
          org_id: org.id,
          grant_count: matched.length,
          resend_message_id: emailResult.id,
          digest_week: digestWeek,
        });
        results.push({ org: org.name, status: "sent", grants: matched.length });
        sent++;
      } else {
        results.push({ org: org.name, status: "send_failed", grants: matched.length });
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`Digest failed for ${org.name}: ${message}`);
      results.push({ org: org.name, status: "match_error", grants: 0, error: message });
      failed++;
    }
  }

  return NextResponse.json({ sent, skipped, failed, total: orgs.length, results });
}
