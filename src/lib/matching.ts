import { supabase } from "./supabase";

interface Organization {
  id: string;
  categories: string[];
  geography_keywords: string[];
  mission_keywords: string[];
  min_grant_amount: number | null;
}

interface Grant {
  id: string;
  portal_id: number;
  status: string;
  title: string;
  agency: string;
  purpose: string;
  description: string;
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
  relevanceScore: number;
  matchReason: string;
}

function hasOverlap(a: string[], b: string[]): boolean {
  const setB = new Set(b.map((s) => s.toLowerCase()));
  return a.some((item) => setB.has(item.toLowerCase()));
}

function matchesGeography(geoText: string | null, keywords: string[]): boolean {
  if (!geoText || geoText.trim() === "") return true;
  const lower = geoText.toLowerCase();
  if (lower.includes("statewide") || lower.includes("california")) return true;
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function parseMinAmount(text: string | null): number | null {
  if (!text) return null;
  const matches = text.match(/\$[\d,]+/g);
  if (!matches || matches.length === 0) return null;
  const first = matches[0].replace(/[$,]/g, "");
  const num = parseInt(first, 10);
  return isNaN(num) ? null : num;
}

function scoreRelevance(grant: Grant, keywords: string[]): { score: number; reason: string } {
  if (keywords.length === 0) return { score: 0, reason: "Category match" };

  let score = 0;
  const reasons: string[] = [];
  const titleLower = (grant.title || "").toLowerCase();
  const purposeLower = (grant.purpose || "").toLowerCase();
  const descLower = (grant.description || "").toLowerCase();

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (titleLower.includes(kwLower)) {
      score += 50;
      reasons.push(`"${kw}" in title`);
    } else if (purposeLower.includes(kwLower)) {
      score += 30;
      reasons.push(`"${kw}" in purpose`);
    } else if (descLower.includes(kwLower)) {
      score += 20;
      reasons.push(`"${kw}" in description`);
    }
  }

  if (score === 0) return { score: 0, reason: "Category match" };
  return { score: Math.min(score, 100), reason: reasons.slice(0, 2).join(", ") };
}

export async function matchGrantsForOrg(org: Organization): Promise<MatchedGrant[]> {
  const { data: grants, error } = await supabase
    .from("grants")
    .select("*")
    .in("status", ["active", "forecasted"]);

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

    // Filter by minimum grant amount
    if (org.min_grant_amount) {
      const grantAmount = parseMinAmount(grant.est_amounts_text);
      // Skip if grant has a stated amount and it's below the org's minimum
      // Include grants with no stated amount (don't penalize missing data)
      if (grantAmount !== null && grantAmount < org.min_grant_amount) continue;
    }

    // Score relevance
    const { score, reason } = scoreRelevance(grant, org.mission_keywords);

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

    matched.push({ ...grant, section, relevanceScore: score, matchReason: reason });
  }

  // Sort: by section first, then by relevance score DESC within each section, then by deadline ASC
  matched.sort((a, b) => {
    const sectionOrder = { closing_soon: 0, new_this_week: 1, all_matching: 2 };
    if (sectionOrder[a.section] !== sectionOrder[b.section]) {
      return sectionOrder[a.section] - sectionOrder[b.section];
    }
    if (a.relevanceScore !== b.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    const aDate = a.deadline_date ? new Date(a.deadline_date).getTime() : Infinity;
    const bDate = b.deadline_date ? new Date(b.deadline_date).getTime() : Infinity;
    return aDate - bDate;
  });

  return matched;
}
