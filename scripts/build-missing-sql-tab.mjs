// "Sales Cycle — Missing SQL Date" tab: every WON deal from Q1'25 to Q3'26 YTD that has no
// Date_Reached_SQL__c, so the sales cycle cannot be computed for it.
//
// Why: module 3 of the Sales Efficiency tab measures Closed Won date − Date_Reached_SQL__c.
// 385 of 523 won deals (74%) have no SQL stamp, so they drop out of every stage-duration
// average. This tab is the worklist for closing that gap — one row per deal, with an SFDC link.
//
// Cohort is pinned to the quarter by CLOSE DATE (100% populated), not by the Closed Won stamp
// (only 40% populated) — otherwise the missing-data problem would hide the deals it affects.
//
// Run: node --env-file=.env scripts/build-missing-sql-tab.mjs
import { google } from "googleapis";

const TAB = "Sales Cycle — Missing SQL Date";
const SF = "https://fun-ruby-7024.lightning.force.com";
const QS = [["Q1'25","2025-01-02","2025-04-01"],["Q2'25","2025-04-02","2025-07-01"],["Q3'25","2025-07-02","2025-10-01"],
  ["Q4'25","2025-10-02","2026-01-01"],["Q1'26","2026-01-02","2026-04-01"],["Q2'26","2026-04-02","2026-07-01"],
  ["Q3'26 YTD","2026-07-02","2026-10-01"]];
const qOf = (d) => QS.find(([, a, b]) => d >= a && d <= b)?.[0] ?? "";

async function sf() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const t = await (await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();
  return { tok: t.access_token, inst: t.instance_url, v: process.env.SF_API_VERSION || "59.0" };
}

async function main() {
  const { tok, inst, v } = await sf();
  const q = `SELECT Id, Name, Account.Name, Owner.Name, RecordType.Name, StageName, Region__c, MerchantSegment__c,
    convertCurrency(AnnualContractValueARR__c) usd, CloseDate, CreatedDate, Date_Reached_SQL__c, Date_Reached_SAL__c,
    Date_Reached_SQO__c, Date_Reached_Trial__c, Date_Reached_Billing__c, Date_Reached_Closed_Won__c
    FROM Opportunity WHERE IsWon = true AND CloseDate >= 2025-01-02 AND CloseDate <= 2026-10-01`.replace(/\s+/g, " ");
  let url = `${inst}/services/data/v${v}/query?q=${encodeURIComponent(q)}`;
  const recs = [];
  while (url) { const j = await (await fetch(url, { headers: { Authorization: `Bearer ${tok}` } })).json(); recs.push(...j.records); url = j.done ? null : inst + j.nextRecordsUrl; }

  const rows = [];
  rows.push([`Won deals MISSING an SQL date — Q1'25 to Q3'26 YTD`]);
  rows.push([`Auto-written by scripts/build-missing-sql-tab.mjs. Cohort = IsWon, pinned to quarter by Close Date. Without Date_Reached_SQL__c the sales cycle cannot be computed for the deal.`]);
  rows.push([`Last updated`, new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"]);
  rows.push([]);
  rows.push(["SUMMARY", "Won", "Has SQL date", "Missing", "% missing"]);
  let tot = 0, totMiss = 0;
  for (const [name] of QS) {
    const g = recs.filter((r) => qOf(r.CloseDate) === name);
    const has = g.filter((r) => r.Date_Reached_SQL__c).length;
    tot += g.length; totMiss += g.length - has;
    rows.push([name, g.length, has, g.length - has, g.length ? Math.round((100 * (g.length - has)) / g.length) / 100 : ""]);
  }
  rows.push(["TOTAL", tot, tot - totMiss, totMiss, tot ? Math.round((100 * totMiss) / tot) / 100 : ""]);
  rows.push([]);
  const miss = recs.filter((r) => !r.Date_Reached_SQL__c && qOf(r.CloseDate)).sort((a, b) => (a.CloseDate < b.CloseDate ? -1 : 1));
  rows.push([`THE ${miss.length} DEALS`]);
  rows.push(["Quarter", "Opportunity", "Account", "Owner", "Record Type", "Stage", "Region", "Segment",
    "ARR (USD)", "Close Date", "Created", "SAL date", "SQO date", "Trial date", "Billing date", "Closed Won date", "SFDC link"]);
  for (const r of miss) {
    rows.push([qOf(r.CloseDate), r.Name ?? "", r.Account?.Name ?? "", r.Owner?.Name ?? "", r.RecordType?.Name ?? "",
      r.StageName ?? "", r.Region__c ?? "", r.MerchantSegment__c ?? "", Math.round(r.usd || 0), r.CloseDate ?? "",
      (r.CreatedDate || "").slice(0, 10), r.Date_Reached_SAL__c ?? "", r.Date_Reached_SQO__c ?? "",
      r.Date_Reached_Trial__c ?? "", r.Date_Reached_Billing__c ?? "", r.Date_Reached_Closed_Won__c ?? "",
      `=HYPERLINK("${SF}/lightning/r/Opportunity/${r.Id}/view","open")`]);
  }

  const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const api = google.sheets({ version: "v4", auth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const ex = meta.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (ex) reqs.push({ deleteSheet: { sheetId: ex.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 60, columnCount: 17, frozenRowCount: 0 } } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  // USER_ENTERED so the =HYPERLINK() column becomes a real link.
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED",
    requestBody: { values: rows.map((r) => (r.length ? r : [""])) } });
  console.log(`"${TAB}" written — ${miss.length} deals missing an SQL date, of ${tot} won.`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
