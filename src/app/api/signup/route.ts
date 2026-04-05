import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendVerificationEmail } from "@/lib/email";
import { GRANT_CATEGORIES } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, email, categories, geography_keywords, mission_keywords, min_grant_amount } = body;

  if (!name || !email || !categories || categories.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (name.length > 200 || email.length > 200) {
    return NextResponse.json({ error: "Name or email too long" }, { status: 400 });
  }

  if (typeof geography_keywords === "string" && geography_keywords.length > 500) {
    return NextResponse.json({ error: "Geography keywords too long" }, { status: 400 });
  }

  const validCategories = categories.filter((c: string) =>
    (GRANT_CATEGORIES as readonly string[]).includes(c)
  );
  if (validCategories.length === 0) {
    return NextResponse.json({ error: "No valid categories selected" }, { status: 400 });
  }

  const geoKeywords = (geography_keywords || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  // Check for existing org with this email
  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("email", email)
    .single();

  if (existing) {
    return NextResponse.json({ error: "This email is already registered. Check your inbox for a verification link." }, { status: 409 });
  }

  const parsedMissionKeywords = (mission_keywords || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const { data, error } = await supabase
    .from("organizations")
    .insert({
      name,
      email,
      categories: validCategories,
      geography_keywords: geoKeywords,
      mission_keywords: parsedMissionKeywords,
      min_grant_amount: min_grant_amount || null,
      tier: "free",
      email_verified: false,
    })
    .select("id, email_verify_token")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const baseUrl = process.env.BASE_URL || "https://grantradar-sable.vercel.app";
    await sendVerificationEmail(email, name, `${baseUrl}/api/verify-email?token=${data.email_verify_token}`);
  } catch {
    // Email send failed but signup succeeded — don't fail the whole request
    console.error("Failed to send verification email to", email);
  }

  return NextResponse.json({ success: true, id: data.id });
}
