import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabase-server";
import { GRANT_CATEGORIES } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const { token, categories, geography_keywords, mission_keywords, min_grant_amount } = await request.json();

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  if (typeof geography_keywords === "string" && geography_keywords.length > 500) {
    return NextResponse.json({ error: "Geography keywords too long" }, { status: 400 });
  }

  const validCategories = (categories || []).filter((c: string) =>
    (GRANT_CATEGORIES as readonly string[]).includes(c)
  );

  const geoKeywords = (geography_keywords || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const parsedMissionKeywords = (mission_keywords || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const { error } = await supabase
    .from("organizations")
    .update({
      categories: validCategories,
      geography_keywords: geoKeywords,
      mission_keywords: parsedMissionKeywords,
      min_grant_amount: min_grant_amount || null,
    })
    .eq("unsubscribe_token", token);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
