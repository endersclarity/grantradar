import { NextRequest, NextResponse } from "next/server";
import { syncGrants } from "@/lib/grants";
import { sendSyncReportEmail } from "@/lib/email";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const result = await syncGrants();
  const duration = Date.now() - startedAt.getTime();

  // Log to sync_runs
  await supabase.from("sync_runs").insert({
    source: "ca_portal",
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    grants_fetched: result.fetched,
    grants_new: result.newGrants.length,
    grants_closed: result.closed,
    error: result.error || null,
    duration_ms: duration,
  });

  // Send Telegram notification
  await sendSyncReportEmail({
    source: "CA Grants Portal",
    timestamp: startedAt.toISOString(),
    fetched: result.fetched,
    newGrants: result.newGrants,
    closed: result.closed,
    errors: result.error ? [result.error] : [],
  }).catch((err) => {
    console.error("Failed to send sync report:", err);
  });

  if (result.error) {
    console.error("Grant sync error:", result.error);
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
