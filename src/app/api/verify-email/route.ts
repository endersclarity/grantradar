import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/?verified=invalid", request.url));
  }

  const { data: org, error: fetchError } = await supabase
    .from("organizations")
    .select("id, email_verified")
    .eq("email_verify_token", token)
    .single();

  if (fetchError || !org) {
    return NextResponse.redirect(new URL("/?verified=invalid", request.url));
  }

  if (org.email_verified) {
    return NextResponse.redirect(new URL("/?verified=already", request.url));
  }

  const { error: updateError } = await supabase
    .from("organizations")
    .update({ email_verified: true })
    .eq("id", org.id);

  if (updateError) {
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  return NextResponse.redirect(new URL("/?verified=success", request.url));
}
