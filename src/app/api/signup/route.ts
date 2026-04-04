import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendConfirmationEmail } from "@/lib/email";
import { GRANT_CATEGORIES } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, email, categories, geography_keywords } = body;

  if (!name || !email || !categories || categories.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Validate categories
  const validCategories = categories.filter((c: string) =>
    (GRANT_CATEGORIES as readonly string[]).includes(c)
  );
  if (validCategories.length === 0) {
    return NextResponse.json({ error: "No valid categories selected" }, { status: 400 });
  }

  // Parse geography keywords
  const geoKeywords = (geography_keywords || "")
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
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sendConfirmationEmail(email, name);

  return NextResponse.json({ success: true, id: data.id });
}
