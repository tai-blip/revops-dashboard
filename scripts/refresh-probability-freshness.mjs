// Ops Excellence (a): AE/AM probability freshness.
// Flags OPEN opps in SAL/SQL/SQO/Trial that need forecast attention — EITHER the
// quarterly forecast datestamp (Last_Forecasted_Date_Quarterly__c) is 4+ weeks old / never
// set, OR the AE/AM % probability value itself (AE_AM_Probability__c) is blank (it must be
// filled at all times). Excludes brand-new opps (created < 4 weeks ago) so a rep isn't
// dinged for an opp they haven't had a chance to forecast. Writes "Ops Excellence - Probability Freshness".
// Run: node --env-file=.env scripts/refresh-probability-freshness.mjs
import { google } from "googleapis";

const STAGES = "('SAL','SQL','SQO','Trial')";
const STALE_DAYS = 28;       // forecast counts as stale after 4 weeks with no update
const MIN_AGE_DAYS = 28;     // exclude opps created within the last 4 weeks (too new to be "stale")

async function sfAuth() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const r = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error("SF auth failed: " + JSON.stringify(j));
  return { token: j.access_token, instance: j.instance_url };
}
async function sfQueryAll(instance, token, soql) {
  const v = process.env.SF_API_VERSION || "59.0";
  let url = `${instance}/services/data/v${v}/query?q=${encodeURIComponent(soql)}`;
  const out = [];
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (j.records == null) throw new Error("SF query failed: " + JSON.stringify(j));
    out.push(...j.records);
    url = j.done ? null : `${instance}${j.nextRecordsUrl}`;
  }
  return out;
}

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const { token, instance } = await sfAuth();

  const soql = `SELECT Id, Name, AccountId, Owner.Name, Account.Name, StageName, Probability, RecordType.Name, convertCurrency(AnnualContractValueARR__c), CloseDate, CreatedDate, AE_AM_Probability__c, Last_Forecasted_Date_Quarterly__c FROM Opportunity WHERE IsClosed = false AND StageName IN ${STAGES} AND CreatedDate <= N_DAYS_AGO:${MIN_AGE_DAYS} AND (Last_Forecasted_Date_Quarterly__c < LAST_N_DAYS:${STALE_DAYS} OR Last_Forecasted_Date_Quarterly__c = null OR AE_AM_Probability__c = null) ORDER BY Owner.Name, Last_Forecasted_Date_Quarterly__c NULLS FIRST`;
  const recs = await sfQueryAll(instance, token, soql);

  const today = new Date();
  const daysSince = (d) => d ? Math.floor((today - new Date(d + "T00:00:00Z")) / 86400000) : null;

  // per-rep summary
  const byRep = {};
  for (const r of recs) { const o = r.Owner?.Name ?? "(unassigned)"; byRep[o] = (byRep[o] || 0) + 1; }
  const repRows = Object.entries(byRep).sort((a, b) => b[1] - a[1]);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const matrix = [
    ["AE/AM Probability Freshness — flagged Opportunities", "", "", `Updated ${stamp}`, "", "", ""],
    [`${recs.length} open opps (SAL/SQL/SQO/Trial) needing forecast attention — forecast not updated in ${STALE_DAYS}+ days / never set, OR AE/AM % probability blank · excludes opps created < 4 weeks ago`, "", "", "", "", "", ""],
    [],
    ["Rep", "Flagged", "", "", "", "", ""],
    ...repRows.map(([rep, n]) => [rep, n, "", "", "", "", ""]),
    [],
    ["Owner", "Opportunity", "Account", "Stage", "AE/AM Prob — Qtr (%)", "Last Forecasted (Qtr)", "Days Since"],
    ...recs.map((r) => {
      const d = r.Last_Forecasted_Date_Quarterly__c;
      const ds = daysSince(d);
      return [
        r.Owner?.Name ?? "", r.Name, r.Account?.Name ?? "", r.StageName,
        r.AE_AM_Probability__c ?? "", d ?? "never", ds == null ? "never" : ds,
      ];
    }),
  ];

  const TAB = "Ops Excellence - Probability Freshness";
  const meta = await api.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, fields: "sheets.properties(sheetId,title)" });
  const existing = meta.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (existing) reqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: matrix } });

  console.log(`wrote "${TAB}": ${recs.length} flagged opps`);
  console.log("by rep:", repRows.map(([r, n]) => `${r} ${n}`).join(" | "));

  // ── Also refresh the team-facing tracker ("Ops that hasn't been updated", the Drive
  // link in the bi-weekly Opportunity Excellency email). Replaces the old per-tab
  // Salesforce-connector imports (which drifted per tab and went stale). Keeps the
  // sheet's structure: rep tabs get the same columns with col A now a clickable SFDC
  // link; Summary keeps its Rep | Flagged Opps | <dated snapshot>... layout, with
  // today's column written as static numbers so history stays frozen. ──
  const TEAM_ID = "1wZ93z8rdYLWo6Js-Jd0Qh0tWsSJURmrTPHtnf-n34L0";
  const AE_TABS = ["James Burdick", "Dorsa Mahmoudnia", "Jed Rutstein", "Jill Bucci", "David Dubinski", "Mathias Berthelemot"];
  const oppLink = (id) => `=HYPERLINK("${instance}/lightning/r/Opportunity/${id}/view","${id}")`;
  const detailHeader = ["Id", "Name", "AccountId", "StageName", "CloseDate", "Probability", "AnnualContractValueARR__c (USD)", "Account.Name", "RecordType.Name", "Owner.Name", "Last_Forecasted_Date_Quarterly__c", "Days Since"];
  const detailRow = (r) => {
    const d = r.Last_Forecasted_Date_Quarterly__c;
    const ds = daysSince(d);
    return [oppLink(r.Id), r.Name, r.AccountId ?? "", r.StageName, r.CloseDate ?? "", r.Probability ?? "", r.AnnualContractValueARR__c ?? "", r.Account?.Name ?? "", r.RecordType?.Name ?? "", r.Owner?.Name ?? "", d ?? "never", ds == null ? "never" : ds];
  };

  const teamMeta = await api.spreadsheets.get({ spreadsheetId: TEAM_ID, fields: "sheets.properties(sheetId,title)" });
  const teamTabs = new Set(teamMeta.data.sheets.map((s) => s.properties.title));
  const ensureTab = async (title) => {
    if (teamTabs.has(title)) return;
    await api.spreadsheets.batchUpdate({ spreadsheetId: TEAM_ID, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
    teamTabs.add(title);
  };

  // Rep tabs: full rewrite each run, most-stale first (SOQL orders "never" to the top).
  for (const rep of AE_TABS) {
    const mine = recs.filter((r) => r.Owner?.Name === rep);
    await ensureTab(rep);
    await api.spreadsheets.values.clear({ spreadsheetId: TEAM_ID, range: `'${rep}'!A1:Z5000` });
    await api.spreadsheets.values.update({
      spreadsheetId: TEAM_ID, range: `'${rep}'!A1`, valueInputOption: "USER_ENTERED",
      requestBody: { values: [
        [`${rep} — ${mine.length} flagged (forecast ${STALE_DAYS}+ days old / never set, or AE/AM % blank · excl. opps < 4 weeks old)`, "", `Updated ${stamp}, auto-refreshed daily`],
        detailHeader,
        ...mine.map(detailRow),
      ] },
    });
  }

  // Summary: write/refresh today's dated column (e.g. "24th Jul"); leave past columns alone.
  await ensureTab("Summary");
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `${ordinal(today.getUTCDate())} ${MONTHS[today.getUTCMonth()]}`;
  const sum = await api.spreadsheets.values.get({ spreadsheetId: TEAM_ID, range: "'Summary'!A1:ZZ50" }).then((r) => r.data.values ?? []);
  if (sum.length === 0) sum.push(["Rep"], ...AE_TABS.map((rep) => [rep]), ["TOTAL"]);
  const header = sum[0];
  const col = header.indexOf(label) !== -1 ? header.indexOf(label) : Math.max(header.length, 1);
  const countFor = (name) => (name === "TOTAL" ? AE_TABS.reduce((t, rep) => t + (byRep[rep] ?? 0), 0) : name in byRep && AE_TABS.includes(name) ? byRep[name] : AE_TABS.includes(name) ? 0 : "");
  const colValues = [[label], ...sum.slice(1).map((row) => [countFor(row[0])])];
  const a1col = (i) => (i < 26 ? "" : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26));
  await api.spreadsheets.values.update({
    spreadsheetId: TEAM_ID, range: `'Summary'!${a1col(col)}1`, valueInputOption: "RAW",
    requestBody: { values: colValues },
  });
  const othersCount = recs.filter((r) => !AE_TABS.includes(r.Owner?.Name)).length;
  console.log(`team sheet refreshed: ${AE_TABS.length} rep tabs + Summary column "${label}" (owners without a tab: ${othersCount} opps)`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
