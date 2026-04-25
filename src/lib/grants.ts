import { parse } from "csv-parse/sync";
import { supabaseServer as supabase } from "./supabase-server";
import { CA_GRANTS_CSV_URL, MIN_CSV_ROWS_SAFETY } from "./constants";

// Only keep grants in these CA categories — everything else is irrelevant to NSH
const CA_RELEVANT_CATEGORIES = new Set([
  "Libraries and Arts",
  "Housing, Community and Economic Development",
  "Parks & Recreation",
  "Disadvantaged Communities",
  "Education",
  "Employment, Labor & Training",
]);

interface CsvRow {
  PortalID: string;
  GrantID: string;
  Status: string;
  AgencyDept: string;
  Title: string;
  Purpose: string;
  Description: string;
  Categories: string;
  ApplicantType: string;
  Geography: string;
  EstAmounts: string;
  EstAvailFunds: string;
  ApplicationDeadline: string;
  OpenDate: string;
  GrantURL: string;
  ContactInfo: string;
}

function parseSemicolonList(value: string): string[] {
  if (!value) return [];
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDateLoose(value: string): string | null {
  if (!value || value.toLowerCase() === "ongoing") return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  } catch {
    return null;
  }
}

function csvRowToGrant(row: CsvRow) {
  return {
    portal_id: parseInt(row.PortalID, 10),
    source_id: row.PortalID,
    grant_id: row.GrantID || null,
    status: row.Status?.toLowerCase() || "active",
    agency: row.AgencyDept || null,
    title: row.Title || "Untitled",
    purpose: row.Purpose || null,
    description: row.Description || null,
    categories: parseSemicolonList(row.Categories),
    applicant_types: parseSemicolonList(row.ApplicantType),
    geography_text: row.Geography || null,
    est_amounts_text: row.EstAmounts || null,
    est_available_funds_text: row.EstAvailFunds || null,
    application_deadline: row.ApplicationDeadline || null,
    deadline_date: parseDateLoose(row.ApplicationDeadline),
    open_date: parseDateLoose(row.OpenDate),
    grant_url: row.GrantURL || null,
    contact_info: row.ContactInfo || null,
    last_synced: new Date().toISOString(),
  };
}

export interface SyncGrantResult {
  title: string;
  agency: string;
  deadline: string | null;
  url: string | null;
}

async function fetchWithRetry(url: string, maxAttempts = 3): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error("fetchWithRetry exhausted retries");
}

function hasRelevantCategory(row: CsvRow): boolean {
  const cats = parseSemicolonList(row.Categories);
  return cats.some((c) => CA_RELEVANT_CATEGORIES.has(c));
}

export async function syncGrants(): Promise<{
  fetched: number;
  upserted: number;
  closed: number;
  newGrants: SyncGrantResult[];
  error?: string;
}> {
  // Fetch CSV with retry
  let csvText: string;
  try {
    csvText = await fetchWithRetry(CA_GRANTS_CSV_URL);
  } catch (err) {
    return { fetched: 0, upserted: 0, closed: 0, newGrants: [], error: `CSV fetch failed after 3 attempts: ${err}` };
  }

  const allRows: CsvRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });

  // Safety guard: if CSV returned too few rows, something is wrong.
  if (allRows.length < MIN_CSV_ROWS_SAFETY) {
    return {
      fetched: allRows.length,
      upserted: 0,
      closed: 0,
      newGrants: [],
      error: `CSV returned only ${allRows.length} rows (minimum ${MIN_CSV_ROWS_SAFETY}). Aborting to prevent data loss.`,
    };
  }

  // Filter to relevant categories only
  const rows = allRows.filter(hasRelevantCategory);

  // Load existing source_ids to detect truly new grants
  // Supabase caps at 1000 rows per request — paginate to get all
  const existingSourceIds = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page } = await supabase
      .from("grants")
      .select("source_id")
      .eq("source", "ca_portal")
      .range(from, from + pageSize - 1);
    if (!page || page.length === 0) break;
    for (const r of page) existingSourceIds.add(r.source_id);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  // Collect portal_ids from filtered CSV and identify new grants
  const csvPortalIds = new Set<number>();
  const newGrants: SyncGrantResult[] = [];
  const grantsToUpsert = rows.map((row) => {
    const grant = csvRowToGrant(row);
    csvPortalIds.add(grant.portal_id);

    if (!existingSourceIds.has(grant.source_id)) {
      newGrants.push({
        title: grant.title,
        agency: grant.agency || "Unknown Agency",
        deadline: grant.application_deadline,
        url: grant.grant_url,
      });
    }

    return grant;
  });

  // Upsert grants in batches of 500
  let upserted = 0;
  for (let i = 0; i < grantsToUpsert.length; i += 500) {
    const batch = grantsToUpsert.slice(i, i + 500);
    const { error } = await supabase.from("grants").upsert(batch, {
      onConflict: "source_id",
      ignoreDuplicates: false,
    });
    if (error) {
      return { fetched: rows.length, upserted, closed: 0, newGrants, error: `Upsert error: ${error.message}` };
    }
    upserted += batch.length;
  }

  // Mark grants not in CSV as closed (only those currently active/forecasted)
  const { data: existingGrants } = await supabase
    .from("grants")
    .select("id, portal_id")
    .eq("source", "ca_portal")
    .in("status", ["active", "forecasted"]);

  const toClose = (existingGrants || [])
    .filter((g) => !csvPortalIds.has(g.portal_id))
    .map((g) => g.id);

  let closed = 0;
  if (toClose.length > 0) {
    const { error } = await supabase
      .from("grants")
      .update({ status: "closed", last_synced: new Date().toISOString() })
      .in("id", toClose);
    if (!error) closed = toClose.length;
  }

  return { fetched: rows.length, upserted, closed, newGrants };
}
