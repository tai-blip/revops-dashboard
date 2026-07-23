// Ops Excellence (c): New Business lead-conversion compliance.
// Pulls New Business opps created since the SOP and flags which were created via
// Lead conversion vs directly. Writes tab "Ops Excellence - Lead Conversion".
// Run: node --env-file=.env scripts/refresh-lead-conversion.mjs
import { google } from "googleapis";

const SOP_DATE = "2026-06-16"; // New-Opportunity SOP effective date

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

  const opps = await sfQueryAll(instance, token,
    `SELECT Id, Name, Owner.Name, Account.Name, CreatedDate, StageName, convertCurrency(AnnualContractValueARR__c) FROM Opportunity WHERE RecordType.Name = '1.New Business' AND CreatedDate >= ${SOP_DATE}T00:00:00Z ORDER BY CreatedDate`);
  const converted = await sfQueryAll(instance, token,
    `SELECT ConvertedOpportunityId FROM Lead WHERE IsConverted = true AND ConvertedOpportunityId != null AND ConvertedDate >= 2026-06-01`);
  const convSet = new Set(converted.map(r => r.ConvertedOpportunityId));

  const rows = opps.map(o => ({
    created: o.CreatedDate.slice(0, 10),
    name: o.Name, owner: o.Owner?.Name ?? "", account: o.Account?.Name ?? "",
    stage: o.StageName, arr: o.AnnualContractValueARR__c ?? "",
    fromLead: convSet.has(o.Id),
  }));
  const total = rows.length, fromLead = rows.filter(r => r.fromLead).length, direct = total - fromLead;
  const pct = total ? Math.round((fromLead / total) * 100) : 0;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const matrix = [
    ["New Business — Lead-Conversion Compliance", `(SOP since ${SOP_DATE})`, "", "", `Updated ${stamp}`, "", ""],
    [`${total} New Business opps created since SOP`, `${fromLead} via Lead conversion (${pct}%)`, `${direct} created directly (non-compliant)`, "", "", "", ""],
    [],
    ["Created", "Opportunity", "Owner", "Account", "Stage", "ARR (USD)", "Created via Lead?"],
    ...rows.map(r => [r.created, r.name, r.owner, r.account, r.stage, r.arr, r.fromLead ? "Yes" : "NO — direct"]),
  ];

  const meta = await api.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, fields: "sheets.properties(sheetId,title)" });
  const existing = meta.data.sheets.find(s => s.properties.title === "Ops Excellence - Lead Conversion");
  const reqs = [];
  if (existing) reqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: "Ops Excellence - Lead Conversion" } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: "'Ops Excellence - Lead Conversion'!A1", valueInputOption: "USER_ENTERED", requestBody: { values: matrix } });

  console.log(`wrote tab "Ops Excellence - Lead Conversion": ${total} opps, ${fromLead} via lead (${pct}%), ${direct} direct`);
  console.log("non-compliant:", rows.filter(r => !r.fromLead).map(r => `${r.owner}: ${r.account}`).join(" | "));
}
main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
