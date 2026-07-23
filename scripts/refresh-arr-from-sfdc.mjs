// Daily refresh: Salesforce Opportunities -> Google Sheet.
// Auth via Connected App (client credentials), pull Billing/Closed-Won opps in USD,
// rewrite SOQL_Pull, and rebuild ARR_MoM_Rebuild. Replaces Coefficient/manual pulls.
// Run: node --env-file=.env scripts/refresh-arr-from-sfdc.mjs
import { google } from "googleapis";

// ---------- Salesforce (client credentials) ----------
async function sfAuth() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });
  const r = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
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
const arrOf = (rec) => rec.AnnualContractValueARR__c ?? rec.expr0 ?? 0; // convertCurrency alias-safe

// ---------- Google Sheets (write) ----------
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SOQL = `SELECT Id, AccountId, convertCurrency(AnnualContractValueARR__c), ContractLiveDate__c, ContractEndDate__c, RecordType.Name, Status__c FROM Opportunity WHERE StageName IN ('Billing','Closed Won')`;

function monthList(startY, startM /*1-based*/) {
  const now = new Date();
  const endY = now.getUTCFullYear(), endM = now.getUTCMonth() + 1;
  const out = [];
  let y = startY, m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month
    out.push({ ym: `${y}-${String(m).padStart(2, "0")}`, monthEnd });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const ser2ym = (s) => new Date(Date.UTC(1899, 11, 30) + s * 86400000).toISOString().slice(0, 7);

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });

  // 1) Pull from Salesforce
  const { token, instance } = await sfAuth();
  const recs = await sfQueryAll(instance, token, SOQL);
  console.log("SF pull:", recs.length, "opps from", instance);

  // 2) Targets = current manual "ARR MoM Progression" series (Month serial in A, Total ARR in B)
  const mp = (await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "'ARR MoM Progression'!A2:B400", valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const targetByYm = {};
  for (const row of mp) { if (typeof row[0] === "number" && typeof row[1] === "number") targetByYm[ser2ym(row[0])] = row[1]; }

  // 3) Month rows (Apr 2021 -> current month)
  const months = monthList(2021, 4);
  const N = recs.length, LAST = N + 1;

  // 4) SOQL_Pull matrix
  const pull = [["Id","AccountId","ARR (USD)","ContractLiveDate","ContractEndDate","RecordType","Status","Supersedes","NextSupersedingLive","EffectiveEndDate"]];
  recs.forEach((x, i) => {
    const r = i + 2;
    pull.push([
      x.Id, x.AccountId, arrOf(x),
      x.ContractLiveDate__c, x.ContractEndDate__c || "2099-12-31",
      x.RecordType?.Name ?? "", x.Status__c ?? "",
      `=IF(OR(F${r}="1.New Business",F${r}="2.Renewals"),1,0)`,
      `=MINIFS($D$2:$D$${LAST},$B$2:$B$${LAST},B${r},$H$2:$H$${LAST},1,$D$2:$D$${LAST},">"&D${r})`,
      `=IF(H${r}=0,E${r},IF(I${r}=0,E${r},MIN(E${r},I${r})))`,
    ]);
  });

  // 5) ARR_MoM_Rebuild matrix (boundary = 1st of next month = $B+1)
  const mom = [["Month","Month-End","Active ARR — Rule A","Active ARR — Exact (renewal-netted)","Current series (target)","Rule A vs Target ($)","Rule A vs Target (%)","MoM Change ($) [Rule A]","MoM Growth (%) [Rule A]"]];
  months.forEach((m, i) => {
    const r = i + 2;
    mom.push([
      `=TEXT(B${r},"mmm yyyy")`, m.monthEnd,
      `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$E$2:$E$${LAST}>$B${r}+1)*SOQL_Pull!$C$2:$C$${LAST})`,
      `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$J$2:$J$${LAST}>$B${r}+1)*SOQL_Pull!$C$2:$C$${LAST})`,
      targetByYm[m.ym] ?? "",
      `=IFERROR(C${r}-E${r},"")`,
      `=IFERROR((C${r}-E${r})/E${r},"")`,
      r === 2 ? "" : `=C${r}-C${r-1}`,
      r === 2 ? "" : `=IFERROR((C${r}-C${r-1})/C${r-1},"")`,
    ]);
  });

  // 6) Create-or-replace + bulk write
  const meta = await api.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties(sheetId,title)" });
  const byTitle = Object.fromEntries(meta.data.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const reqs = [];
  for (const t of ["SOQL_Pull","ARR_MoM_Rebuild"]) if (byTitle[t] != null) reqs.push({ deleteSheet: { sheetId: byTitle[t] } });
  reqs.push({ addSheet: { properties: { title: "SOQL_Pull" } } }, { addSheet: { properties: { title: "ARR_MoM_Rebuild" } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "SOQL_Pull!A1", valueInputOption: "USER_ENTERED", requestBody: { values: pull } });
  await api.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "ARR_MoM_Rebuild!A1", valueInputOption: "USER_ENTERED", requestBody: { values: mom } });

  // 7) Report latest month + MAPE vs target
  const back = (await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `ARR_MoM_Rebuild!A2:G${months.length+1}`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const ape = [];
  let latest = null;
  back.forEach((row, i) => {
    const ruleA = row[2], target = row[4];
    if (typeof ruleA === "number" && typeof target === "number" && target > 0) ape.push(Math.abs((ruleA - target) / target));
    if (typeof ruleA === "number" && ruleA > 0) latest = { ym: months[i].ym, ruleA: Math.round(ruleA) };
  });
  const mape = ape.length ? (ape.reduce((s,v)=>s+v,0)/ape.length*100).toFixed(1)+"%" : "n/a";
  console.log(`wrote SOQL_Pull (${pull.length} rows) + ARR_MoM_Rebuild (${mom.length} rows)`);
  console.log(`latest month: ${latest?.ym} Rule A = $${latest?.ruleA?.toLocaleString()} | MAPE vs current series: ${mape}`);
}
main().catch(e => { console.error("REFRESH FAILED:", e.message); process.exit(1); });
