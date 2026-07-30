// Roll back the "AE attainment" MoM section to its ORIGINAL live-date formulas.
// Regenerates the known original patterns (col D = Q3 live-date; each month col =
// live-date monthly) rather than replaying the snapshot, because the snapshot was
// truncated at col AH while the booking rebuild had written out to col BJ.
// Run: node --env-file=.env scripts/restore-ae-attainment.mjs
import { google } from "googleapis";
const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const api = google.sheets({ version: "v4", auth: gAuth });
const ID = process.env.GOOGLE_SHEET_ID;
const TAB = "AE attainment", LV = "'LiveARR - SOQL Pull'";
const REP_ROWS = [5, 6, 7, 8, 9, 10];
const STATUS = (rng) => `((${LV}!$D$3:${rng}="[LP] Live Paying")+(${LV}!$D$3:${rng}="[LP] Live Paying (Monthly)")+(${LV}!$D$3:${rng}="Pending Billing")+(${LV}!$D$3:${rng}="Pending Initial Payment")>0)`;
const colLetter = (i) => { let s = "", n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// original col D: LIVE date (col S) in Q3, still-live (H>TODAY), live-paying status
const dOrig = (r) => `=SUMPRODUCT(($A${r}=${LV}!$L$3:$L)*(${LV}!$S$3:$S>=DATE(2026,7,1))*(${LV}!$S$3:$S<DATE(2026,10,1))*(${LV}!$H$3:$H>TODAY())*${STATUS("$D")}*${LV}!$E$3:$E)`;
// original monthly: LIVE date (col F) in [month,next), still-live, live-paying status
const moOrig = (r, L) => `=SUMPRODUCT(($A${r}=${LV}!$L$3:$L$1199)*(${LV}!$F$3:$F$1199>=${L}$2)*(${LV}!$F$3:$F$1199<EDATE(${L}$2,1))*(${LV}!$H$3:$H$1199>TODAY())*${STATUS("$D$1199")}*${LV}!$E$3:$E$1199)`;

async function main() {
  const r2 = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${TAB}'!A2:BZ2`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values?.[0] || [];
  const monthCols = r2.map((v, i) => (i >= 4 && typeof v === "number" ? i : -1)).filter((i) => i >= 0);
  const data = [{ range: `'${TAB}'!D5:D10`, values: REP_ROWS.map((r) => [dOrig(r)]) }];
  for (const ci of monthCols) { const L = colLetter(ci); data.push({ range: `'${TAB}'!${L}5:${L}10`, values: REP_ROWS.map((r) => [moOrig(r, L)]) }); }
  data.push({ range: `'${TAB}'!A1`, values: [["Tracks ARR & Pipeline Generation attainment per AE | Closed Won + Live Paying deals | Quota = Q3 2026 Target | Data from Salesforce"]] });
  data.push({ range: `'${TAB}'!D4`, values: [["Q3 2026 Actual"]] });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: "USER_ENTERED", data } });
  const back = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${TAB}'!A5:D10`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  console.log("restored — Q3 Actual (live-date) per rep:");
  for (const row of back) console.log("  " + String(row[0]).padEnd(20), "$" + Math.round(row[3] || 0).toLocaleString().padStart(8), "(" + ((row[2] || 0) * 100).toFixed(1) + "%)");
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
