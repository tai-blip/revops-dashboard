// "Sales Cycle" source tab — average days per stage for the deals WON in each quarter.
//
// Scope: NEW BUSINESS only (Tai, 2026-08-31). Renewals and Business Expansion never pass
// through SQL, so including them produced a fake 74% "missing data" gap. On New Business the
// stage stamps are 98–100% complete and the metric is real.
//
// Cohort is pinned to the quarter by CLOSE DATE, and the cycle ends there (Tai, 2026-08-31).
//
// We tried Date_Reached_Closed_Won__c — the literal "reached Closed Won" stamp — and reverted.
// The Salesforce automation that sets it STOPPED FIRING around April 2026: every New Business
// deal closed since is missing it (23 of 23), while the earlier stage stamps still fire. Test -
// ABC reproduces it. Using that field would leave the current quarters blank, which is the
// opposite of useful. On deals carrying both dates the two agree to within a day (116 vs 115),
// so CloseDate costs nothing and covers 137/137.
//
// Revisit once the flow is fixed and the 42 gaps are backfilled.
//
//   Total sales cycle = CloseDate − Date_Reached_SQL__c
//   SQL     = Date_Reached_SAL__c     − Date_Reached_SQL__c
//   SAL     = Date_Reached_SQO__c     − Date_Reached_SAL__c
//   SQO     = Date_Reached_Trial__c   − Date_Reached_SQO__c
//   Pilot   = Date_Reached_Billing__c − Date_Reached_Trial__c
//
// SQL + SAL + SQO + Pilot decompose the total. Billing is deliberately NOT a stage — see the
// note on POST_CLOSE below.
//
// Written long-format (one row per region × quarter × metric) so the dashboard can pivot it
// for display without computing anything. Every row carries its sample size: an average over
// four deals is not the same claim as an average over thirty, and the reader should see which.
//
// Run: node --env-file=.env scripts/build-sales-cycle-tab.mjs
import { google } from "googleapis";

const TAB = "Sales Cycle";
const QS = [
  ["Q1'25", "2025-01-02", "2025-04-01"], ["Q2'25", "2025-04-02", "2025-07-01"],
  ["Q3'25", "2025-07-02", "2025-10-01"], ["Q4'25", "2025-10-02", "2026-01-01"],
  ["Q1'26", "2026-01-02", "2026-04-01"], ["Q2'26", "2026-04-02", "2026-07-01"],
  ["Q3'26 YTD", "2026-07-02", "2026-10-01"],
];
const METRICS = [
  ["cycle", "Total Sales Cycle", "Date_Reached_SQL__c", "CloseDate"],
  ["sql", "SQL", "Date_Reached_SQL__c", "Date_Reached_SAL__c"],
  ["sal", "SAL", "Date_Reached_SAL__c", "Date_Reached_SQO__c"],
  ["sqo", "SQO", "Date_Reached_SQO__c", "Date_Reached_Trial__c"],
  ["pilot", "Pilot", "Date_Reached_Trial__c", "Date_Reached_Billing__c"],
];
// Billing is NOT part of the sales cycle. On 55% of New Business wins the Billing stamp lands
// AFTER the close date — billing happens once the deal is won, not on the way to winning it.
// Measuring it as a stage made the parts sum to 367 days against a 188-day cycle. It is reported
// separately below as post-close time to billing, which is a real number, just a different one.
const POST_CLOSE = ["postBilling", "Post-close → Billing", "CloseDate", "Date_Reached_Billing__c"];
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Segment. Merchant_Segment__c (the STRING field) is populated on 137/137 New Business wins —
// note the near-identical picklist MerchantSegment__c is only on 10% and is NOT the one to use.
// Five raw values collapse to four buckets (Tai, 2026-08-31): Medium sits with Mid-Market.
const SEGMENTS = ["Small", "Mid Market", "Enterprise", "Mega Enterprise"];
const segOf = (r) => {
  const raw = String(r.Merchant_Segment__c || r.Account?.Merchant_Segment__c || "").trim().toLowerCase();
  if (raw === "small") return "Small";
  if (raw === "medium" || raw === "mid-market" || raw === "mid market") return "Mid Market";
  if (raw === "enterprise") return "Enterprise";
  if (raw.startsWith("mega")) return "Mega Enterprise";
  return "";
};

async function main() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const t = await (await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();
  const v = process.env.SF_API_VERSION || "59.0";
  const q = `SELECT Id, CloseDate, Region__c, Merchant_Segment__c, Account.Merchant_Segment__c,
    Date_Reached_SQL__c, Date_Reached_SAL__c, Date_Reached_SQO__c,
    Date_Reached_Trial__c, Date_Reached_Billing__c, Date_Reached_Closed_Won__c FROM Opportunity
    WHERE IsWon = true AND RecordType.Name = '1.New Business'
      AND CloseDate >= 2025-01-02 AND CloseDate <= 2026-10-01`.replace(/\s+/g, " ");
  let url = `${t.instance_url}/services/data/v${v}/query?q=${encodeURIComponent(q)}`;
  const recs = [];
  while (url) { const j = await (await fetch(url, { headers: { Authorization: `Bearer ${t.access_token}` } })).json(); recs.push(...j.records); url = j.done ? null : t.instance_url + j.nextRecordsUrl; }

  const regionOf = (r) => (String(r.Region__c ?? "") === "North America" ? "North America" : "International");
  const qOf = (d) => QS.find(([, a, b]) => d >= a && d <= b)?.[0] ?? "";
  let negatives = 0;

  const rows = [];
  rows.push([`Sales Cycle — average days per stage, New Business won deals`]);
  rows.push([`Auto-written by scripts/build-sales-cycle-tab.mjs. NEW BUSINESS only — renewals and expansions never pass through SQL. Cohort pinned to the quarter by Close Date; the cycle ends on Close Date because Date_Reached_Closed_Won__c is only on 69% of these deals.`]);
  rows.push([`Last updated`, new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"]);
  rows.push([]);
  rows.push(["region", "quarter", "metric_key", "metric", "avg_days", "n", "segment"]);
  // avg over a pool, skipping rows where the stamps run backwards
  const avgOf = (pool, from, to) => {
    const vals = pool.filter((r) => r[from] && r[to]).map((r) => days(r[from], r[to]))
      .filter((d) => { if (d < 0) { negatives++; return false; } return true; });
    return [vals.length ? Math.round(vals.reduce((s2, x) => s2 + x, 0) / vals.length) : "", vals.length];
  };

  for (const region of ["Total", "North America", "International"]) {
    for (const [qn] of QS) {
      const pool = recs.filter((r) => qOf(r.CloseDate) === qn && (region === "Total" || regionOf(r) === region));
      rows.push([region, qn, "won", "Total Deals Won", pool.length, pool.length, ""]);
      for (const seg of SEGMENTS) {
        const sp = pool.filter((r) => segOf(r) === seg);
        rows.push([region, qn, "won", "Total Deals Won", sp.length, sp.length, seg]);
      }
      for (const [key, label, from, to] of [...METRICS, POST_CLOSE]) {
        const [a, n2] = avgOf(pool, from, to);
        rows.push([region, qn, key, label, a, n2, ""]);
        for (const seg of SEGMENTS) {
          const [sa, sn] = avgOf(pool.filter((r) => segOf(r) === seg), from, to);
          rows.push([region, qn, key, label, sa, sn, seg]);
        }
      }
    }
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
  reqs.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 40, columnCount: 7 } } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: "RAW",
    requestBody: { values: rows.map((r) => (r.length ? r : [""])) } });

  console.log(`"${TAB}" written — ${recs.length} New Business wins, ${rows.length - 5} metric rows.`);
  if (negatives) console.log(`  ${negatives} stage gaps were negative (stamps out of order) and were excluded.`);
  const tot = recs.filter((r) => r.Date_Reached_SQL__c);
  const avg = Math.round(tot.reduce((s, r) => s + days(r.Date_Reached_SQL__c, r.CloseDate), 0) / tot.length);
  console.log(`  overall cycle, SQL -> close date: ${avg} days over ${tot.length} deals`);
  const noStamp = recs.length - recs.filter((r) => r.Date_Reached_Closed_Won__c).length;
  console.log(`  FYI ${noStamp} of ${recs.length} have no Date_Reached_Closed_Won__c — the SFDC automation stopped firing ~Apr 2026.`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
