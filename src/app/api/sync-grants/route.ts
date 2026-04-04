import { NextRequest, NextResponse } from "next/server";
import { syncGrants } from "@/lib/grants";

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncGrants();

  if (result.error) {
    console.error("Grant sync error:", result.error);
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
