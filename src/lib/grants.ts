import { parse } from "csv-parse/sync";
import { supabase } from "./supabase";
import { CA_GRANTS_CSV_URL, MIN_CSV_ROWS_SAFETY } from "./constants";

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

export async function syncGrants(): Promise<{
  fetched: number;
  upserted: number;
  closed: number;
  error?: string;
}> {
  // Fetch CSV
  const response = await fetch(CA_GRANTS_CSV_URL);
  if (!response.ok) {
    return { fetched: 0, upserted: 0, closed: 0, error: `CSV fetch failed: ${response.status}` };
  }

  const csvText = await response.text();
  const rows: CsvRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });

  // Safety guard: if CSV returned too few rows, something is wrong. Don't nuke the table.
  if (rows.length < MIN_CSV_ROWS_SAFETY) {
    return {
      fetched: rows.length,
      upserted: 0,
      closed: 0,
      error: `CSV returned only ${rows.length} rows (minimum ${MIN_CSV_ROWS_SAFETY}). Aborting to prevent data loss.`,
    };
  }

  // Collect portal_ids from CSV
  const csvPortalIds = new Set<number>();
  const grantsToUpsert = rows.map((row) => {
    const grant = csvRowToGrant(row);
    csvPortalIds.add(grant.portal_id);
    return grant;
  });

  // Upsert grants in batches of 500
  let upserted = 0;
  for (let i = 0; i < grantsToUpsert.length; i += 500) {
    const batch = grantsToUpsert.slice(i, i + 500);
    const { error } = await supabase.from("grants").upsert(batch, {
      onConflict: "portal_id",
      ignoreDuplicates: false,
    });
    if (error) {
      return { fetched: rows.length, upserted, closed: 0, error: `Upsert error: ${error.message}` };
    }
    upserted += batch.length;
  }

  // Mark grants not in CSV as closed (only those currently active/forecasted)
  const { data: existingGrants } = await supabase
    .from("grants")
    .select("id, portal_id")
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

  return { fetched: rows.length, upserted, closed };
}
