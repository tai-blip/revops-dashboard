// Ops Excellence (b): Opportunities without an associated Contact.
// Flags OPEN opps with no OpportunityContactRole. Writes tab "Ops Excellence - No Contact".
// Run: node --env-file=.env scripts/refresh-opps-without-contact.mjs
import { google } from "googleapis";

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

  const recs = await sfQueryAll(instance, token,
    `SELECT Id, Name, Owner.Name, Account.Name, StageName, convertCurrency(AnnualContractValueARR__c) FROM Opportunity WHERE IsClosed = false AND Id NOT IN (SELECT OpportunityId FROM OpportunityContactRole) ORDER BY Owner.Name, StageName`);

  const byRep = {};
  for (const r of recs) { const o = r.Owner?.Name ?? "(unassigned)"; byRep[o] = (byRep[o] || 0) + 1; }
  const repRows = Object.entries(byRep).sort((a, b) => b[1] - a[1]);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const matrix = [
    ["Opportunities without an associated Contact (open)", "", "", `Updated ${stamp}`, ""],
    [`${recs.length} open opportunities have no linked Contact — target is zero`, "", "", "", ""],
    [],
    ["Rep", "Opps w/o contact", "", "", ""],
    ...repRows.map(([rep, n]) => [rep, n, "", "", ""]),
    [],
    ["Owner", "Opportunity", "Account", "Stage", "ARR (USD)"],
    ...recs.map((r) => [r.Owner?.Name ?? "", r.Name, r.Account?.Name ?? "", r.StageName, r.AnnualContractValueARR__c ?? ""]),
  ];

  const TAB = "Ops Excellence - No Contact";
  const meta = await api.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, fields: "sheets.properties(sheetId,title)" });
  const existing = meta.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (existing) reqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: matrix } });

  console.log(`wrote "${TAB}": ${recs.length} open opps without a contact`);
  console.log("by rep:", repRows.slice(0, 8).map(([r, n]) => `${r} ${n}`).join(" | "));
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
