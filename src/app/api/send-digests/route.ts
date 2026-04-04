import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { matchGrantsForOrg } from "@/lib/matching";
import { sendDigestEmail } from "@/lib/email";
import { TRIAL_DIGEST_LIMIT } from "@/lib/constants";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all orgs eligible for digest
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .in("subscription_status", ["trial", "active"]);

  if (orgError || !orgs) {
    return NextResponse.json({ error: orgError?.message || "No orgs" }, { status: 500 });
  }

  const results: Array<{ org: string; status: string; grants: number }> = [];

  for (const org of orgs) {
    const matched = await matchGrantsForOrg({
      id: org.id,
      categories: org.categories,
      geography_keywords: org.geography_keywords,
    });

    // Empty digest: skip sending, do NOT increment trial counter
    if (matched.length === 0) {
      results.push({ org: org.name, status: "skipped_empty", grants: 0 });
      continue;
    }

    // Determine if this is the upgrade-prompt send (trial org, already received TRIAL_DIGEST_LIMIT digests)
    const isTrialExpiring = org.subscription_status === "trial" && org.trial_digests_sent >= TRIAL_DIGEST_LIMIT;

    if (isTrialExpiring) {
      // This org's trial is over. Send one final digest with upgrade banner, then expire.
      const emailResult = await sendDigestEmail(
        org.email, org.name, matched, org.unsubscribe_token, true
      );

      await supabase
        .from("organizations")
        .update({ subscription_status: "expired" })
        .eq("id", org.id);

      if (emailResult) {
        await supabase.from("digests").insert({
          org_id: org.id,
          grant_count: matched.length,
          resend_message_id: emailResult.id,
        });
      }

      results.push({ org: org.name, status: "trial_expired", grants: matched.length });
      continue;
    }

    // Normal send (trial or active)
    const emailResult = await sendDigestEmail(
      org.email, org.name, matched, org.unsubscribe_token, false
    );

    if (emailResult) {
      // Increment trial counter if trial org
      if (org.subscription_status === "trial") {
        await supabase
          .from("organizations")
          .update({ trial_digests_sent: org.trial_digests_sent + 1 })
          .eq("id", org.id);
      }

      await supabase.from("digests").insert({
        org_id: org.id,
        grant_count: matched.length,
        resend_message_id: emailResult.id,
      });

      results.push({ org: org.name, status: "sent", grants: matched.length });
    } else {
      // Send failed: do NOT increment trial counter
      results.push({ org: org.name, status: "send_failed", grants: matched.length });
    }
  }

  return NextResponse.json({ sent: results.length, results });
}
