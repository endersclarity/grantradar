import { Resend } from "resend";
import type { MatchedGrant } from "./matching";

const resend = new Resend(process.env.RESEND_API_KEY);

function truncate(text: string | null, len: number): string {
  if (!text) return "";
  return text.length > len ? text.slice(0, len - 3) + "..." : text;
}

function formatGrantLine(grant: MatchedGrant, includePurpose: boolean): string {
  const parts = [
    `  ${grant.agency || "Unknown Agency"}`,
    `Deadline: ${grant.application_deadline || "Ongoing"}`,
  ];
  if (grant.est_amounts_text) parts.push(grant.est_amounts_text);
  let line = `\u2022 ${grant.title}\n  ${parts.join(" | ")}`;
  if (includePurpose && grant.purpose) {
    line += `\n  ${truncate(grant.purpose, 120)}`;
  }
  if (grant.grant_url) {
    line += `\n  \u2192 ${grant.grant_url}`;
  }
  return line;
}

export function renderDigestText(
  orgName: string,
  grants: MatchedGrant[],
  settingsUrl: string,
  unsubscribeUrl: string,
  trialBanner: boolean
): string {
  const closingSoon = grants.filter((g) => g.section === "closing_soon");
  const newThisWeek = grants.filter((g) => g.section === "new_this_week");
  const allMatching = grants.filter((g) => g.section === "all_matching");

  let body = "";

  if (trialBanner) {
    body += "--- YOUR FREE TRIAL HAS ENDED ---\n\n";
    body += "Subscribe for $49/mo to keep receiving your weekly grant digest.\n";
    body += `Subscribe now: ${process.env.BASE_URL}/api/checkout?org=${encodeURIComponent(orgName)}\n\n`;
  }

  if (closingSoon.length > 0) {
    body += "--- CLOSING SOON ---\n\n";
    body += closingSoon.map((g) => formatGrantLine(g, true)).join("\n\n");
    body += "\n\n";
  }

  if (newThisWeek.length > 0) {
    body += "--- NEW THIS WEEK ---\n\n";
    body += newThisWeek.map((g) => formatGrantLine(g, true)).join("\n\n");
    body += "\n\n";
  }

  if (allMatching.length > 0) {
    body += "--- ALL MATCHING ---\n\n";
    body += allMatching.map((g) => formatGrantLine(g, false)).join("\n\n");
    body += "\n\n";
  }

  body += "---\n";
  body += `Manage your categories: ${settingsUrl}\n`;
  body += `Unsubscribe: ${unsubscribeUrl}\n`;

  return body;
}

export async function sendDigestEmail(
  to: string,
  orgName: string,
  grants: MatchedGrant[],
  unsubscribeToken: string,
  trialBanner: boolean
): Promise<{ id: string } | null> {
  const baseUrl = process.env.BASE_URL || "https://grantradar.com";
  const settingsUrl = `${baseUrl}/settings?token=${unsubscribeToken}`;
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}`;
  const weekOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const text = renderDigestText(orgName, grants, settingsUrl, unsubscribeUrl, trialBanner);

  const { data, error } = await resend.emails.send({
    from: "GrantRadar <digest@grantradar.com>",
    to,
    subject: `GrantRadar \u2014 ${grants.length} grants for ${orgName} (Week of ${weekOf})`,
    text,
  });

  if (error) {
    console.error(`Failed to send digest to ${to}:`, error);
    return null;
  }

  return data;
}

export async function sendConfirmationEmail(to: string, orgName: string): Promise<void> {
  await resend.emails.send({
    from: "GrantRadar <hello@grantradar.com>",
    to,
    subject: `Welcome to GrantRadar, ${orgName}!`,
    text: `You're signed up for GrantRadar.\n\nEvery Monday, we'll email you CA state grants that match your nonprofit's categories and geography.\n\nYour first digest arrives next Monday. If you signed up on a Monday morning, check your inbox later today.\n\nQuestions? Reply to this email.\n\n- GrantRadar`,
  });
}
