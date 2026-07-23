// Rebuild SOQL_Pull + ARR_MoM_Rebuild in the live workbook from a Salesforce pull file.
// Usage: node --env-file=.env scripts/build-arr-mom.mjs <soql-result-file> <targets-json>
// The SOQL pull MUST use convertCurrency(AnnualContractValueARR__c) (org is multi-currency).
import { google } from "googleapis";
import { readFileSync } from "fs";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const SOQL_FILE = process.argv[2];
const TARGETS_FILE = process.argv[3];
const rows = JSON.parse(readFileSync(SOQL_FILE, "utf8")).rows;
const targets = JSON.parse(readFileSync(TARGETS_FILE, "utf8"));
const N = rows.length, LAST = N + 1;
console.log("SOQL rows:", N, "| months:", targets.length);

const pull = [["Id","AccountId","ARR (USD)","ContractLiveDate","ContractEndDate","RecordType","Status","Supersedes","NextSupersedingLive","EffectiveEndDate"]];
rows.forEach((x, i) => {
  const r = i + 2;
  pull.push([
    x.Id, x.AccountId, x.AnnualContractValueARR__c,
    x.ContractLiveDate__c, x.ContractEndDate__c || "2099-12-31",
    x.RecordType?.Name ?? "", x.Status__c ?? "",
    `=IF(OR(F${r}="1.New Business",F${r}="2.Renewals"),1,0)`,
    `=MINIFS($D$2:$D$${LAST},$B$2:$B$${LAST},B${r},$H$2:$H$${LAST},1,$D$2:$D$${LAST},">"&D${r})`,
    `=IF(H${r}=0,E${r},IF(I${r}=0,E${r},MIN(E${r},I${r})))`,
  ]);
});

const mom = [["Month","Month-End","Active ARR — Rule A","Active ARR — Exact (renewal-netted)","Current series (target)","Exact vs Target ($)","Exact vs Target (%)","MoM Change ($) [Exact]","MoM Growth (%) [Exact]"]];
targets.forEach((m, i) => {
  const r = i + 2;
  mom.push([
    `=TEXT(B${r},"mmm yyyy")`,           // label derived from date (avoids date auto-parse)
    m.monthEnd,
    // Snapshot as of the 1st of the NEXT month ($B is month-end, +1 = next-month-1st) —
    // matches how the Tableau tracker recognizes ARR (a contract live on the 1st of a
    // month lands in the prior month's column). This closed the ~15% divergent months.
    `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$E$2:$E$${LAST}>$B${r}+1)*SOQL_Pull!$C$2:$C$${LAST})`,
    `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$J$2:$J$${LAST}>$B${r}+1)*SOQL_Pull!$C$2:$C$${LAST})`,
    m.target ?? "",
    `=D${r}-E${r}`,
    `=IFERROR((D${r}-E${r})/E${r},"")`,
    r === 2 ? "" : `=D${r}-D${r-1}`,
    r === 2 ? "" : `=IFERROR((D${r}-D${r-1})/D${r-1},"")`,
  ]);
});

const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties(sheetId,title)" });
const byTitle = Object.fromEntries(meta.data.sheets.map(s => [s.properties.title, s.properties.sheetId]));
const reqs = [];
for (const t of ["SOQL_Pull","ARR_MoM_Rebuild"]) if (byTitle[t] != null) reqs.push({ deleteSheet: { sheetId: byTitle[t] } });
reqs.push({ addSheet: { properties: { title: "SOQL_Pull" } } }, { addSheet: { properties: { title: "ARR_MoM_Rebuild" } } });
await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs } });
await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "SOQL_Pull!A1", valueInputOption: "USER_ENTERED", requestBody: { values: pull } });
await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "ARR_MoM_Rebuild!A1", valueInputOption: "USER_ENTERED", requestBody: { values: mom } });
console.log("wrote SOQL_Pull:", pull.length, "rows | ARR_MoM_Rebuild:", mom.length, "rows");

// Verify: read back, report MAPE by year (excluding tiny-denominator noise)
const back = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `ARR_MoM_Rebuild!A2:G${targets.length+1}`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
const yr = {}, samples = {};
back.forEach((row, i) => {
  const label = targets[i]?.label || "";
  const exact = row[3], target = row[4];
  if (typeof exact === "number" && typeof target === "number" && target > 0) {
    const y = label.split(" ")[1];
    (yr[y] ||= []).push(Math.abs((exact - target) / target));
    if (["Dec 2024","Dec 2025","Jun 2026","Jul 2026"].includes(label))
      samples[label] = `exact ${Math.round(exact).toLocaleString()} vs ${target.toLocaleString()} (${((exact-target)/target*100).toFixed(1)}%)`;
  }
});
const mean = a => (a.reduce((s,v)=>s+v,0)/a.length*100).toFixed(1)+"%";
console.log("\nMAPE by year:", Object.fromEntries(Object.entries(yr).map(([y,a])=>[y, mean(a)+` (n=${a.length})`])));
console.log("samples:", JSON.stringify(samples, null, 1));
