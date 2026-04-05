import { NextRequest, NextResponse } from "next/server";

// NTEE major group → GrantRadar categories
const NTEE_TO_CATEGORIES: Record<string, string[]> = {
  A: ["Libraries and Arts"],
  B: ["Education"],
  C: ["Environment & Water"],
  D: ["Animal Services"],
  E: ["Health & Human Services"],
  F: ["Health & Human Services"],
  G: ["Health & Human Services"],
  H: ["Science, Technology, and Research & Development"],
  I: ["Law, Justice, and Legal Services"],
  J: ["Employment, Labor & Training"],
  K: ["Food & Nutrition", "Agriculture"],
  L: ["Housing, Community and Economic Development"],
  M: ["Disaster Prevention & Relief"],
  N: ["Parks & Recreation"],
  O: ["Education"],
  P: ["Health & Human Services"],
  R: ["Disadvantaged Communities"],
  S: ["Housing, Community and Economic Development"],
  U: ["Science, Technology, and Research & Development"],
  V: ["Science, Technology, and Research & Development"],
  W: ["Consumer Protection"],
};

// Revenue → suggested min grant amount
function suggestMinAmount(revenue: number | null): number | null {
  if (!revenue || revenue <= 0) return null;
  if (revenue < 100000) return 5000;
  if (revenue < 500000) return 10000;
  if (revenue < 1000000) return 25000;
  if (revenue < 5000000) return 50000;
  return 100000;
}

// Extract mission-relevant keywords from org name
function extractKeywords(name: string, nteeCode: string | null): string[] {
  const keywords: string[] = [];
  const nameLower = name.toLowerCase();

  // Common mission-indicating words in org names
  const missionTerms: Record<string, string[]> = {
    historic: ["historic preservation", "cultural heritage"],
    preservation: ["preservation", "historic preservation"],
    heritage: ["cultural heritage", "heritage"],
    museum: ["museum", "cultural heritage"],
    arts: ["arts", "cultural programs"],
    education: ["education", "youth development"],
    environmental: ["environmental conservation", "sustainability"],
    conservation: ["conservation", "wildlife"],
    housing: ["affordable housing", "community development"],
    health: ["public health", "community health"],
    veterans: ["veterans services"],
    youth: ["youth development", "youth programs"],
    literacy: ["literacy", "education"],
    food: ["food security", "hunger relief"],
    shelter: ["housing", "shelter"],
    animal: ["animal welfare", "animal rescue"],
    garden: ["community garden", "urban agriculture"],
    theater: ["performing arts", "theater"],
    library: ["library", "literacy"],
    landmark: ["landmark", "historic preservation"],
  };

  for (const [term, kws] of Object.entries(missionTerms)) {
    if (nameLower.includes(term)) {
      keywords.push(...kws);
    }
  }

  // NTEE-specific keywords
  if (nteeCode) {
    const nteeKeywords: Record<string, string[]> = {
      A51: ["museum", "art museum"],
      A52: ["children's museum"],
      A54: ["history museum", "historic preservation"],
      A56: ["natural history", "science museum"],
      A6: ["performing arts", "theater", "music"],
      A7: ["humanities", "cultural programs"],
      A80: ["historic preservation", "architectural preservation"],
      A82: ["historic preservation", "cultural heritage"],
      A84: ["commemorative event", "heritage"],
      B2: ["elementary education", "K-12"],
      B4: ["higher education"],
      B6: ["adult education"],
      C3: ["land conservation", "open space"],
      C4: ["botanical garden", "horticulture"],
      L2: ["affordable housing", "housing development"],
      N3: ["recreation", "parks"],
      S2: ["community development", "neighborhood"],
    };

    for (const [code, kws] of Object.entries(nteeKeywords)) {
      if (nteeCode.startsWith(code)) {
        keywords.push(...kws);
      }
    }
  }

  // Deduplicate
  return [...new Set(keywords)];
}

export async function GET(request: NextRequest) {
  const ein = request.nextUrl.searchParams.get("ein");

  if (!ein) {
    return NextResponse.json({ error: "Missing EIN" }, { status: 400 });
  }

  // Clean EIN: remove dashes, spaces
  const cleanEin = ein.replace(/[-\s]/g, "");
  if (!/^\d{9}$/.test(cleanEin)) {
    return NextResponse.json({ error: "EIN must be 9 digits (e.g. 12-3456789)" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://projects.propublica.org/nonprofits/api/v2/organizations/${cleanEin}.json`,
      { next: { revalidate: 86400 } } // cache for 24h
    );

    if (!res.ok) {
      return NextResponse.json({ error: "Organization not found. Check your EIN and try again." }, { status: 404 });
    }

    const data = await res.json();
    const org = data.organization;

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Map NTEE to categories
    const nteeCode = org.ntee_code || "";
    const nteeMajor = nteeCode.charAt(0).toUpperCase();
    const categories = NTEE_TO_CATEGORIES[nteeMajor] || [];

    // Extract keywords
    const missionKeywords = extractKeywords(org.name || "", nteeCode);

    // Suggest min amount based on revenue
    const suggestedMinAmount = suggestMinAmount(org.income_amount);

    return NextResponse.json({
      name: org.name,
      city: org.city,
      state: org.state,
      ntee_code: nteeCode,
      revenue: org.income_amount,
      categories,
      mission_keywords: missionKeywords,
      suggested_min_amount: suggestedMinAmount,
      geography: org.city && org.state ? `${org.city}, ${org.state}` : null,
    });
  } catch {
    return NextResponse.json({ error: "Failed to look up EIN. Try again later." }, { status: 500 });
  }
}
