import { supabase } from "./supabase";

interface Organization {
  id: string;
  categories: string[];
  geography_keywords: string[];
}

interface Grant {
  id: string;
  portal_id: number;
  status: string;
  title: string;
  agency: string;
  purpose: string;
  categories: string[];
  applicant_types: string[];
  geography_text: string | null;
  est_amounts_text: string | null;
  application_deadline: string | null;
  deadline_date: string | null;
  grant_url: string | null;
  first_seen_at: string;
}

export interface MatchedGrant extends Grant {
  section: "closing_soon" | "new_this_week" | "all_matching";
}

function hasOverlap(a: string[], b: string[]): boolean {
  const setB = new Set(b.map((s) => s.toLowerCase()));
  return a.some((item) => setB.has(item.toLowerCase()));
}

function matchesGeography(geoText: string | null, keywords: string[]): boolean {
  if (!geoText || geoText.trim() === "") return true; // include if empty
  const lower = geoText.toLowerCase();
  if (lower.includes("statewide") || lower.includes("california")) return true;
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function matchGrantsForOrg(org: Organization): Promise<MatchedGrant[]> {
  // Fetch active/forecasted grants that include "Nonprofit" in applicant_types
  const { data: grants, error } = await supabase
    .from("grants")
    .select("*")
    .in("status", ["active", "forecasted"])
    .contains("applicant_types", ["Nonprofit"]);

  if (error || !grants) return [];

  const now = new Date();
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const matched: MatchedGrant[] = [];

  for (const grant of grants as Grant[]) {
    // Hard filter: category overlap
    if (!hasOverlap(grant.categories, org.categories)) continue;

    // Soft filter: geography
    if (!matchesGeography(grant.geography_text, org.geography_keywords)) continue;

    // Determine section
    const deadlineDate = grant.deadline_date ? new Date(grant.deadline_date) : null;
    const firstSeen = new Date(grant.first_seen_at);
    const isClosingSoon = deadlineDate && deadlineDate <= fourteenDaysFromNow && deadlineDate >= now;
    const isNewThisWeek = firstSeen >= sevenDaysAgo;

    let section: MatchedGrant["section"];
    if (isClosingSoon) {
      section = "closing_soon";
    } else if (isNewThisWeek) {
      section = "new_this_week";
    } else {
      section = "all_matching";
    }

    matched.push({ ...grant, section });
  }

  // Sort: closing_soon by deadline ASC, new_this_week by deadline ASC, all by deadline ASC
  matched.sort((a, b) => {
    const sectionOrder = { closing_soon: 0, new_this_week: 1, all_matching: 2 };
    if (sectionOrder[a.section] !== sectionOrder[b.section]) {
      return sectionOrder[a.section] - sectionOrder[b.section];
    }
    const aDate = a.deadline_date ? new Date(a.deadline_date).getTime() : Infinity;
    const bDate = b.deadline_date ? new Date(b.deadline_date).getTime() : Infinity;
    return aDate - bDate;
  });

  return matched;
}
