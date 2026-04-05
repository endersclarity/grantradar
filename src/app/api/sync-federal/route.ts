import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const maxDuration = 60;

// Map Grants.gov CFDA categories to our grant categories
const CFDA_TO_CATEGORIES: Record<string, string[]> = {
  AG: ["Agriculture"],
  AR: ["Libraries and Arts"],
  BC: ["Consumer Protection"],
  CD: ["Housing, Community and Economic Development"],
  CP: ["Consumer Protection"],
  DPR: ["Disaster Prevention & Relief"],
  ED: ["Education"],
  ELT: ["Employment, Labor & Training"],
  EN: ["Energy"],
  ENV: ["Environment & Water"],
  FN: ["Food & Nutrition"],
  HL: ["Health & Human Services"],
  HO: ["Housing, Community and Economic Development"],
  HU: ["Libraries and Arts"],
  IS: ["Science, Technology, and Research & Development"],
  LJL: ["Law, Justice, and Legal Services"],
  NR: ["Environment & Water"],
  O: ["Consumer Protection"],
  RA: ["Science, Technology, and Research & Development"],
  RD: ["Housing, Community and Economic Development"],
  ST: ["Science, Technology, and Research & Development"],
  T: ["Transportation"],
};

function mapCategories(cfdaList: string[], fundingCategories: string[]): string[] {
  const cats = new Set<string>();

  // Map from funding category codes
  for (const fc of fundingCategories) {
    const mapped = CFDA_TO_CATEGORIES[fc];
    if (mapped) mapped.forEach((c) => cats.add(c));
  }

  // If no categories mapped, try to infer from CFDA numbers
  if (cats.size === 0 && cfdaList.length > 0) {
    // CFDA prefix mapping (first 2 digits = agency)
    for (const cfda of cfdaList) {
      const prefix = cfda.split(".")[0];
      const agencyMap: Record<string, string[]> = {
        "10": ["Agriculture"],
        "11": ["Consumer Protection"],
        "14": ["Housing, Community and Economic Development"],
        "15": ["Parks & Recreation", "Libraries and Arts"],
        "16": ["Law, Justice, and Legal Services"],
        "17": ["Employment, Labor & Training"],
        "19": ["Education"],
        "20": ["Transportation"],
        "43": ["Science, Technology, and Research & Development"],
        "45": ["Libraries and Arts"],
        "47": ["Science, Technology, and Research & Development"],
        "59": ["Housing, Community and Economic Development"],
        "64": ["Veterans & Military"],
        "66": ["Environment & Water"],
        "81": ["Energy"],
        "84": ["Education"],
        "93": ["Health & Human Services"],
        "94": ["Housing, Community and Economic Development"],
        "97": ["Disaster Prevention & Relief"],
      };
      const mapped = agencyMap[prefix];
      if (mapped) mapped.forEach((c) => cats.add(c));
    }
  }

  return cats.size > 0 ? [...cats] : ["Consumer Protection"]; // fallback
}

function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  // Grants.gov format: MM/DD/YYYY
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all posted opportunities from Grants.gov
    // The API returns max 1000 per request, paginate if needed
    const allGrants: Array<Record<string, unknown>> = [];
    let startRecord = 0;
    const rows = 250;

    while (true) {
      const res = await fetch("https://apply07.grants.gov/grantsws/rest/opportunities/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oppStatuses: "posted",
          rows,
          startRecordNum: startRecord,
        }),
      });

      if (!res.ok) break;

      const data = await res.json();
      const hits = data.oppHits || [];
      allGrants.push(...hits);

      if (hits.length < rows) break; // last page
      startRecord += rows;
      if (startRecord > 5000) break; // safety cap
    }

    if (allGrants.length === 0) {
      return NextResponse.json({ error: "No grants fetched from Grants.gov" }, { status: 500 });
    }

    // Transform to our schema
    const grants = allGrants.map((g: Record<string, unknown>) => ({
      portal_id: -1 * (g.id as number), // negative IDs for federal grants to avoid collision with CA portal IDs
      grant_id: g.number as string || null,
      status: "active",
      agency: g.agency as string || null,
      title: g.title as string || "Untitled",
      purpose: null, // Grants.gov search doesn't include description
      description: null,
      categories: mapCategories(
        (g.cfdaList as string[]) || [],
        (g.fundingCategories as string[]) || []
      ),
      applicant_types: ["Nonprofit"], // Federal grants generally include nonprofits
      geography_text: "Nationwide",
      est_amounts_text: g.awardCeiling ? `Up to $${Number(g.awardCeiling).toLocaleString()}` : null,
      application_deadline: g.closeDate as string || null,
      deadline_date: parseDate(g.closeDate as string || null),
      open_date: parseDate(g.openDate as string || null),
      grant_url: `https://www.grants.gov/search-results-detail/${g.id}`,
      contact_info: null,
      source: "grants_gov",
    }));

    // Upsert in batches
    let upserted = 0;
    const errors: string[] = [];
    const batchSize = 100;
    for (let i = 0; i < grants.length; i += batchSize) {
      const batch = grants.slice(i, i + batchSize);
      const { error } = await supabase
        .from("grants")
        .upsert(batch, { onConflict: "portal_id" });
      if (error) {
        errors.push(`Batch ${i}: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    return NextResponse.json({
      source: "grants.gov",
      fetched: allGrants.length,
      upserted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Federal sync error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
