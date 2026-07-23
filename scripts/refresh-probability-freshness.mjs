// Ops Excellence (a): AE/AM probability freshness.
// Flags OPEN opps in SAL/SQL/SQO/Trial whose AE/AM Quarterly forecast hasn't been
// updated in 15+ days (per the Last_Forecasted_Date_Quarterly__c field the reps stamp).
// Writes tab "Ops Excellence - Probability Freshness".
// Run: node --env-file=.env scripts/refresh-probability-freshness.mjs
import { google } from "googleapis";

const STAGES = "('SAL','SQL','SQO','Trial')";
const STALE_DAYS = 15;

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

  const soql = `SELECT Id, Name, Owner.Name, Account.Name, StageName, AE_AM_Probability__c, Last_Forecasted_Date_Quarterly__c FROM Opportunity WHERE IsClosed = false AND StageName IN ${STAGES} AND (Last_Forecasted_Date_Quarterly__c < LAST_N_DAYS:${STALE_DAYS} OR Last_Forecasted_Date_Quarterly__c = null) ORDER BY Owner.Name, Last_Forecasted_Date_Quarterly__c NULLS FIRST`;
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
    [`${recs.length} open opps (SAL/SQL/SQO/Trial) with quarterly forecast not updated in ${STALE_DAYS}+ days (or never)`, "", "", "", "", "", ""],
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
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
