import { createHash } from "crypto";

const GRANTS_GOV_BASE = "https://api.grants.gov";
const SEARCH_URL = `${GRANTS_GOV_BASE}/v1/api/search2`;
const DETAIL_URL = `${GRANTS_GOV_BASE}/v1/api/fetchOpportunity`;

interface SearchHit {
  id: number;
  number: string;
  title: string;
  agency: string;
  openDate: string;
  closeDate: string;
  awardCeiling: number;
  awardFloor: number;
  oppStatus: string;
  cfdaList: string[];
  fundingCategories: string[];
  [key: string]: unknown;
}

interface OpportunityDetail {
  synopsis: { synopsisDesc: string } | null;
  forecast: { synopsisDesc: string } | null;
  applicantTypes: Array<{ code: string; description: string }>;
  cfdaNumbers: Array<{ programTitle: string; cfdaNumber: string }>;
  [key: string]: unknown;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error("fetchWithRetry exhausted retries");
}

export async function searchOpportunities(): Promise<SearchHit[]> {
  const allHits: SearchHit[] = [];
  let startRecord = 0;
  const pageSize = 250;

  while (true) {
    const res = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oppStatuses: "posted",
        rows: pageSize,
        startRecordNum: startRecord,
      }),
    });

    const json = await res.json();
    const data = json.data || json; // API wraps results in a data envelope
    const hits: SearchHit[] = data.oppHits || [];
    allHits.push(...hits);

    if (hits.length < pageSize) break;
    startRecord += pageSize;

    // 500ms delay between pages to be respectful
    await new Promise((r) => setTimeout(r, 500));
  }

  return allHits;
}

export async function fetchOpportunityDetail(
  oppId: number
): Promise<OpportunityDetail | null> {
  try {
    const res = await fetchWithRetry(
      `${DETAIL_URL}/${oppId}`,
      { method: "GET" }
    );
    return await res.json();
  } catch {
    return null;
  }
}

export function computeSearchHash(hit: SearchHit): string {
  const normalized = JSON.stringify({
    title: hit.title || "",
    closeDate: hit.closeDate || "",
    awardCeiling: hit.awardCeiling || 0,
    awardFloor: hit.awardFloor || 0,
    fundingCategories: (hit.fundingCategories || []).sort(),
    oppStatus: hit.oppStatus || "",
  });
  return createHash("sha256").update(normalized).digest("hex");
}

export function computeDetailHash(
  hit: SearchHit,
  detail: OpportunityDetail
): string {
  const synopsis =
    detail.synopsis?.synopsisDesc || detail.forecast?.synopsisDesc || "";
  const eligibility = (detail.applicantTypes || [])
    .map((a) => a.description)
    .sort()
    .join(", ");
  const normalized = JSON.stringify({
    title: hit.title || "",
    closeDate: hit.closeDate || "",
    awardCeiling: hit.awardCeiling || 0,
    awardFloor: hit.awardFloor || 0,
    fundingCategories: (hit.fundingCategories || []).sort(),
    oppStatus: hit.oppStatus || "",
    synopsis,
    eligibility,
  });
  return createHash("sha256").update(normalized).digest("hex");
}

function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

export function transformHit(hit: SearchHit, detail: OpportunityDetail | null) {
  const synopsis =
    detail?.synopsis?.synopsisDesc || detail?.forecast?.synopsisDesc || null;
  const applicantTypes = detail?.applicantTypes
    ? detail.applicantTypes.map((a) => a.description)
    : [];
  const cfdaNumbers = detail?.cfdaNumbers
    ? detail.cfdaNumbers.map((c) => c.cfdaNumber)
    : hit.cfdaList || [];

  return {
    source: "grants_gov",
    source_id: String(hit.id),
    portal_id: null,
    grant_id: hit.number || null,
    status: "active",
    agency: hit.agency || null,
    title: hit.title || "Untitled",
    purpose: null,
    description: null,
    synopsis,
    eligibility: applicantTypes.join(", ") || null,
    categories: mapCategories(hit.cfdaList || [], hit.fundingCategories || []),
    applicant_types: applicantTypes.length > 0 ? applicantTypes : ["Unknown"],
    geography_text: "Nationwide",
    est_amounts_text: hit.awardCeiling
      ? `Up to $${Number(hit.awardCeiling).toLocaleString()}`
      : null,
    award_floor: hit.awardFloor || null,
    award_ceiling: hit.awardCeiling || null,
    application_deadline: hit.closeDate || null,
    deadline_date: parseDate(hit.closeDate || null),
    open_date: parseDate(hit.openDate || null),
    grant_url: `https://www.grants.gov/search-results-detail/${hit.id}`,
    contact_info: null,
    cfda_numbers: cfdaNumbers,
    search_hash: computeSearchHash(hit),
    detail_hash: detail ? computeDetailHash(hit, detail) : null,
    detail_fetched: !!detail,
    detail_fetched_at: detail ? new Date().toISOString() : null,
    raw_json: hit,
    last_seen_in_sync: new Date().toISOString(),
  };
}

// Copied from existing sync-federal — category mapping from CFDA codes
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
  for (const fc of fundingCategories) {
    const mapped = CFDA_TO_CATEGORIES[fc];
    if (mapped) mapped.forEach((c) => cats.add(c));
  }
  if (cats.size === 0 && cfdaList.length > 0) {
    for (const cfda of cfdaList) {
      const prefix = cfda.split(".")[0];
      const agencyMap: Record<string, string[]> = {
        "10": ["Agriculture"],
        "14": ["Housing, Community and Economic Development"],
        "15": ["Parks & Recreation", "Libraries and Arts"],
        "16": ["Law, Justice, and Legal Services"],
        "17": ["Employment, Labor & Training"],
        "20": ["Transportation"],
        "45": ["Libraries and Arts"],
        "47": ["Science, Technology, and Research & Development"],
        "59": ["Housing, Community and Economic Development"],
        "66": ["Environment & Water"],
        "81": ["Energy"],
        "84": ["Education"],
        "93": ["Health & Human Services"],
        "97": ["Disaster Prevention & Relief"],
      };
      const mapped = agencyMap[prefix];
      if (mapped) mapped.forEach((c) => cats.add(c));
    }
  }
  return cats.size > 0 ? [...cats] : ["Consumer Protection"];
}
