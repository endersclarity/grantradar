import { Resend } from "resend";
import type { MatchedGrant } from "./matching";
import { renderDigestHtml } from "./email-templates";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function truncate(text: string | null, len: number): string {
  if (!text) return "";
  return text.length > len ? text.slice(0, len - 3) + "..." : text;
}

function formatGrantLine(grant: MatchedGrant, includePurpose: boolean): string {
  const daysLeft = grant.deadline_date
    ? Math.ceil((new Date(grant.deadline_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const deadlineStr = daysLeft !== null
    ? (daysLeft <= 14 ? `${daysLeft}d left` : grant.application_deadline || "Ongoing")
    : "Ongoing";
  const parts = [
    `  ${grant.agency || "Unknown Agency"}`,
    `Deadline: ${deadlineStr}`,
  ];
  if (grant.est_amounts_text) parts.push(grant.est_amounts_text);
  const matchLine = grant.relevanceScore > 0 ? `  [Matched: ${grant.matchReason}]\n` : "";
  let line = `\u2022 ${grant.title}\n${matchLine}  ${parts.join(" | ")}`;
  if (includePurpose && grant.purpose) {
    line += `\n  ${truncate(grant.purpose, 120)}`;
  }
  if (grant.grant_url) {
    line += `\n  \u2192 ${grant.grant_url}`;
  }
  return line;
}

function renderDigestText(
  orgName: string,
  grants: MatchedGrant[],
  settingsUrl: string,
  unsubscribeUrl: string
): string {
  const closingSoon = grants.filter((g) => g.section === "closing_soon");
  const newThisWeek = grants.filter((g) => g.section === "new_this_week");
  const allMatching = grants.filter((g) => g.section === "all_matching");

  let body = "";

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
  showUpgradeBanner: boolean
): Promise<{ id: string } | null> {
  const baseUrl = process.env.BASE_URL || "https://grantradar-sable.vercel.app";
  const settingsUrl = `${baseUrl}/settings?token=${unsubscribeToken}`;
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}`;
  const upgradeUrl = showUpgradeBanner ? `${baseUrl}/?upgrade=true` : null;
  const weekOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const html = renderDigestHtml(orgName, grants, settingsUrl, unsubscribeUrl, upgradeUrl);
  const text = renderDigestText(orgName, grants, settingsUrl, unsubscribeUrl);

  const { data, error } = await getResend().emails.send({
    from: "GrantRadar <digest@grantradar.com>",
    to,
    subject: `GrantRadar \u2014 ${grants.length} grants for ${orgName} (Week of ${weekOf})`,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  if (error) {
    console.error(`Failed to send digest to ${to}:`, error);
    return null;
  }

  return data;
}

export async function sendVerificationEmail(to: string, orgName: string, verifyUrl: string): Promise<void> {
  await getResend().emails.send({
    from: "GrantRadar <hello@grantradar.com>",
    to,
    subject: `Verify your email \u2014 GrantRadar`,
    text: `Hi ${orgName},\n\nPlease verify your email to start receiving your free weekly grant digest.\n\nClick here to verify: ${verifyUrl}\n\nIf you didn't sign up for GrantRadar, you can ignore this email.\n\n\u2014 GrantRadar`,
  });
}
