import type { MatchedGrant } from "./matching";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text: string | null, len: number): string {
  if (!text) return "";
  return text.length > len ? text.slice(0, len - 3) + "..." : text;
}

function deadlineContext(grant: MatchedGrant): string {
  if (!grant.deadline_date) return "Ongoing";
  const deadline = new Date(grant.deadline_date);
  const now = new Date();
  const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return "Closed";
  if (daysLeft <= 7) return `${daysLeft}d left \u2014 tight timeline`;
  if (daysLeft <= 14) return `${daysLeft}d left \u2014 closing soon`;
  if (daysLeft <= 30) return `${daysLeft}d left`;
  if (daysLeft <= 90) return `${Math.floor(daysLeft / 7)}wk left \u2014 good runway`;
  return `${Math.floor(daysLeft / 30)}mo left`;
}

function renderGrantCard(grant: MatchedGrant, showPurpose: boolean): string {
  const deadline = deadlineContext(grant);
  const amount = grant.est_amounts_text ? ` \u00b7 ${escapeHtml(grant.est_amounts_text)}` : "";
  const purpose = showPurpose && grant.purpose ? `<p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${escapeHtml(truncate(grant.purpose, 120))}</p>` : "";
  const link = grant.grant_url ? `<a href="${escapeHtml(grant.grant_url)}" style="color:#0d9488;font-size:13px;text-decoration:underline;">View on CA Grants Portal \u2192</a>` : "";
  const matchTag = grant.relevanceScore > 0
    ? `<span style="display:inline-block;padding:2px 8px;background:#ecfdf5;color:#047857;border-radius:4px;font-size:11px;font-weight:600;margin-bottom:4px;">${escapeHtml(grant.matchReason)}</span><br>`
    : "";

  return `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
      ${matchTag}
      <p style="margin:0;font-weight:600;font-size:15px;color:#1e293b;">${escapeHtml(grant.title)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(grant.agency || "Unknown Agency")} \u00b7 ${escapeHtml(deadline)}${amount}</p>
      ${purpose}
      ${link ? `<p style="margin:6px 0 0;">${link}</p>` : ""}
    </td></tr>`;
}

function renderSection(title: string, emoji: string, grants: MatchedGrant[], showPurpose: boolean): string {
  if (grants.length === 0) return "";
  return `
    <tr><td style="padding:20px 0 8px;">
      <h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${emoji} ${escapeHtml(title)}</h2>
    </td></tr>
    ${grants.map((g) => renderGrantCard(g, showPurpose)).join("")}`;
}

export function renderDigestHtml(
  orgName: string,
  grants: MatchedGrant[],
  settingsUrl: string,
  unsubscribeUrl: string,
  upgradeUrl: string | null
): string {
  const closingSoon = grants.filter((g) => g.section === "closing_soon");
  const newThisWeek = grants.filter((g) => g.section === "new_this_week");
  const allMatching = grants.filter((g) => g.section === "all_matching");
  const weekOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const upgradeBanner = upgradeUrl
    ? `<tr><td style="padding:16px;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;margin:16px 0;">
        <p style="margin:0;font-size:14px;color:#92400e;font-weight:600;">Unlock AI Fit Scores + Grant Writing Assistance</p>
        <p style="margin:4px 0 0;font-size:13px;color:#92400e;">Know which grants are worth your time. $19/mo.</p>
        <a href="${escapeHtml(upgradeUrl)}" style="display:inline-block;margin-top:8px;padding:8px 16px;background:#0d9488;color:white;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Upgrade to Pro</a>
      </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:white;border-radius:12px;border:1px solid #e2e8f0;">

  <!-- Header -->
  <tr><td style="padding:24px 24px 16px;border-bottom:1px solid #e2e8f0;">
    <h1 style="margin:0;font-size:20px;color:#0f172a;font-weight:700;">GrantRadar</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#64748b;">${escapeHtml(orgName)} · Week of ${escapeHtml(weekOf)} · ${grants.length} matching grant${grants.length !== 1 ? "s" : ""}</p>
  </td></tr>

  <!-- Upgrade banner for free tier -->
  ${upgradeBanner}

  <!-- Grant sections -->
  <tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${renderSection("Closing Soon", "\u23F0", closingSoon, true)}
      ${renderSection("New This Week", "\u2728", newThisWeek, true)}
      ${renderSection("All Matching", "\uD83D\uDCCB", allMatching, false)}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;border-radius:0 0 12px 12px;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">
      Powered by CA Grants Portal data, updated daily.<br>
      <a href="${escapeHtml(settingsUrl)}" style="color:#0d9488;">Manage categories</a> ·
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#0d9488;">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
