// "Sales Cycle" source tab — average days per stage for New Business deals, cohorted by the
// quarter in which they REACHED BILLING.
//
// Scope: NEW BUSINESS only (Tai, 2026-08-31). Renewals and Business Expansion never pass
// through SQL, so including them produced a fake 74% "missing data" gap.
//
// ANCHOR: Date_Reached_Billing__c, for both the cohort and the end of the cycle (Tai, 2026-08-31).
// CloseDate is not trustworthy on these records and must not be used here:
//   · 1,034 opportunities share CloseDate = 2025-01-01, a migration placeholder. 25 of them are
//     New Business wins, including Firehouse Subs ($292k) and Tim Hortons ME ($439k).
//   · 47 of 137 wins carry a Billing stamp dated BEFORE their close date — the opportunity is
//     left open while the customer is already billing, then tidied up later.
//   · Stage "Billing" is not flagged IsWon in Salesforce, so an IsWon filter silently dropped 7
//     live, contract-live deals (Sweetgreen, Hot Palette, Yoshinoya, Rubio's, TacoTime,
//     Hattie B's, Zaza). Cohorting on the billing stamp picks them up automatically.
// Date_Reached_Billing__c is the best-populated field on this record type: 438 of 439 New
// Business wins carry it, 100% in every close-year from 2021 to 2025 and 44/45 in 2026 (the one
// gap is the dummy record "Test - ABC"). Do NOT extend this anchor to renewals or expansions —
// they are at 14% and 25% coverage respectively.
//
// Date_Reached_Closed_Won__c is unusable: the Salesforce automation that sets it last fired in
// JANUARY 2026. Every deal closed from February onward is missing it, while the other stage
// stamps keep firing, so the fault is in that one flow. Test - ABC reproduces it.
//
//   Total sales cycle = Date_Reached_Billing__c − Date_Reached_SQL__c
//   SQL     = Date_Reached_SAL__c     − Date_Reached_SQL__c
//   SAL     = Date_Reached_SQO__c     − Date_Reached_SAL__c
//   SQO     = Date_Reached_Trial__c   − Date_Reached_SQO__c
//   Pilot   = Date_Reached_Billing__c − Date_Reached_Trial__c
//
// SQL + SAL + SQO + Pilot now decompose the total exactly — same start, same end. They can still
// differ by a few days because each average is taken over the deals that carry both of its own
// stamps, and three deals in the cohort have no SQL date.
//
// Written long-format (one row per region × quarter × metric) so the dashboard can pivot it
// for display without computing anything. Every row carries its sample size: an average over
// four deals is not the same claim as an average over thirty, and the reader should see which.
// A MEDIAN is written alongside the mean — six Capriotti's line items all reached billing on the
// same day after an 812-day wait, which alone drags the Q3'26 mean from 163 to 385.
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
  ["cycle", "Total Sales Cycle", "Date_Reached_SQL__c", "Date_Reached_Billing__c"],
  ["sql", "SQL", "Date_Reached_SQL__c", "Date_Reached_SAL__c"],
  ["sal", "SAL", "Date_Reached_SAL__c", "Date_Reached_SQO__c"],
  ["sqo", "SQO", "Date_Reached_SQO__c", "Date_Reached_Trial__c"],
  ["pilot", "Pilot", "Date_Reached_Trial__c", "Date_Reached_Billing__c"],
];
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
  // Stage filter, not IsWon: Salesforce does not flag "Billing" as won, but those deals are
  // contract-live and the dashboard's ARR funnel already counts them. Same definition here.
  const q = `SELECT Id, CloseDate, StageName, Region__c, Merchant_Segment__c, Account.Merchant_Segment__c,
    Date_Reached_SQL__c, Date_Reached_SAL__c, Date_Reached_SQO__c,
    Date_Reached_Trial__c, Date_Reached_Billing__c FROM Opportunity
    WHERE RecordType.Name = '1.New Business' AND StageName IN ('Closed Won', 'Billing')
      AND Date_Reached_Billing__c >= 2025-01-02 AND Date_Reached_Billing__c <= 2026-10-01`.replace(/\s+/g, " ");
  let url = `${t.instance_url}/services/data/v${v}/query?q=${encodeURIComponent(q)}`;
  const recs = [];
  while (url) { const j = await (await fetch(url, { headers: { Authorization: `Bearer ${t.access_token}` } })).json(); recs.push(...j.records); url = j.done ? null : t.instance_url + j.nextRecordsUrl; }

  const regionOf = (r) => (String(r.Region__c ?? "") === "North America" ? "North America" : "International");
  const qOf = (d) => (d ? QS.find(([, a, b]) => d >= a && d <= b)?.[0] ?? "" : "");
  let negatives = 0;

  const rows = [];
  rows.push([`Sales Cycle — average days per stage, New Business deals reaching Billing`]);
  rows.push([`Auto-written by scripts/build-sales-cycle-tab.mjs. NEW BUSINESS only — renewals and expansions never pass through SQL. Cohort pinned to the quarter the deal REACHED BILLING, and the cycle ends there: Close Date is unreliable on these records (1,034 opps share the 2025-01-01 migration placeholder, and 47 of 137 wins were already billing before their close date).`]);
  rows.push([`Last updated`, new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"]);
  rows.push([]);
  rows.push(["region", "quarter", "metric_key", "metric", "avg_days", "n", "segment", "median_days"]);
  // avg + median over a pool, skipping rows where the stamps run backwards
  const statOf = (pool, from, to) => {
    const vals = pool.filter((r) => r[from] && r[to]).map((r) => days(r[from], r[to]))
      .filter((d) => { if (d < 0) { negatives++; return false; } return true; }).sort((a, b) => a - b);
    if (!vals.length) return ["", 0, ""];
    return [Math.round(vals.reduce((s2, x) => s2 + x, 0) / vals.length), vals.length, vals[Math.floor(vals.length / 2)]];
  };

  for (const region of ["Total", "North America", "International"]) {
    for (const [qn] of QS) {
      const pool = recs.filter((r) => qOf(r.Date_Reached_Billing__c) === qn && (region === "Total" || regionOf(r) === region));
      rows.push([region, qn, "won", "Deals Reaching Billing", pool.length, pool.length, "", pool.length]);
      for (const seg of SEGMENTS) {
        const sp = pool.filter((r) => segOf(r) === seg);
        rows.push([region, qn, "won", "Deals Reaching Billing", sp.length, sp.length, seg, sp.length]);
      }
      for (const [key, label, from, to] of METRICS) {
        const [a, n2, md] = statOf(pool, from, to);
        rows.push([region, qn, key, label, a, n2, "", md]);
        for (const seg of SEGMENTS) {
          const [sa, sn, smd] = statOf(pool.filter((r) => segOf(r) === seg), from, to);
          rows.push([region, qn, key, label, sa, sn, seg, smd]);
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
  reqs.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 40, columnCount: 8 } } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: "RAW",
    requestBody: { values: rows.map((r) => (r.length ? r : [""])) } });

  console.log(`"${TAB}" written — ${recs.length} New Business deals reaching Billing, ${rows.length - 5} metric rows.`);
  console.log(`  ${recs.filter((r) => r.StageName === "Billing").length} of them sit at stage Billing, which Salesforce does not flag as won.`);
  if (negatives) console.log(`  ${negatives} stage gaps were negative (stamps out of order) and were excluded.`);
  const tot = recs.filter((r) => r.Date_Reached_SQL__c);
  const ds = tot.map((r) => days(r.Date_Reached_SQL__c, r.Date_Reached_Billing__c)).sort((a, b) => a - b);
  console.log(`  overall cycle, SQL -> billing: mean ${Math.round(ds.reduce((s, x) => s + x, 0) / ds.length)}d, median ${ds[Math.floor(ds.length / 2)]}d over ${tot.length} deals`);
  console.log(`  ${recs.length - tot.length} deals have no SQL stamp and are absent from the total-cycle average.`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
