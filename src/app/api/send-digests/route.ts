import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { matchGrantsForOrg } from "@/lib/matching";
import { sendDigestEmail } from "@/lib/email";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Send to all verified orgs that aren't cancelled
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("email_verified", true)
    .not("subscription_status", "eq", "cancelled");

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

    if (matched.length === 0) {
      results.push({ org: org.name, status: "skipped_empty", grants: 0 });
      continue;
    }

    // Show upgrade banner for free tier orgs
    const showUpgrade = org.tier === "free";

    const emailResult = await sendDigestEmail(
      org.email, org.name, matched, org.unsubscribe_token, showUpgrade
    );

    if (emailResult) {
      await supabase.from("digests").insert({
        org_id: org.id,
        grant_count: matched.length,
        resend_message_id: emailResult.id,
      });
      results.push({ org: org.name, status: "sent", grants: matched.length });
    } else {
      results.push({ org: org.name, status: "send_failed", grants: matched.length });
    }
  }

  return NextResponse.json({ sent: results.length, results });
}
