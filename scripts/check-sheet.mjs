// Sheet health check (reliability Layer 1): verifies every tab the dashboard reads
// still exists, has the expected header, enough rows, and sane headline values.
// Catches drift (renamed tab/column, empty pull, stale import, currency blow-up)
// BEFORE it silently breaks the live dashboard. Exit code 1 on any failure so the
// scheduled GitHub job goes red.
// Run: node --env-file=.env scripts/check-sheet.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const api = google.sheets({ version: "v4", auth: gAuth });
const ID = process.env.GOOGLE_SHEET_ID;

const fails = [];
const warns = [];
const get = (range) =>
  api.spreadsheets.values.get({ spreadsheetId: ID, range, valueRenderOption: "UNFORMATTED_VALUE" })
    .then((r) => r.data.values || [])
    .catch(() => null);

// [tab, range, checkFn(rows)] — checkFn returns null if OK, else a failure string.
const checks = [
  ["SOQL_Pull", "A1:Q3", (r) => (!r ? "missing" : r[0]?.[2] !== "ARR (USD)" ? "col C header != 'ARR (USD)'" : null)],
  ["SOQL_ClosedDeals", "A1:T2", (r) => (!r ? "missing" : !r[0]?.includes("Outcome") ? "no Outcome column" : null)],
  ["ARR_MoM_Rebuild", "A1:M65", (r) => {
    if (!r) return "missing";
    const last = r.filter((x) => typeof x[2] === "number" && x[2] > 0).pop();
    if (!last) return "no numeric Rule A values";
    if (last[2] < 3_000_000 || last[2] > 12_000_000) return `latest Rule A ARR out of range: ${Math.round(last[2])}`;
    return null;
  }],
  ["ACV_MoM", "A1:AZ2", (r) => (!r ? "missing" : r[0]?.[2] !== "All: Avg ACV" ? "col C header != 'All: Avg ACV'" : null)],
  ["ARR_MoM_Segments", "A1:AB2", (r) => (!r ? "missing" : !r[0]?.some((h) => String(h).includes("$ / Location")) ? "no $/Location column" : null)],
  ["ARR_WoW_Rebuild", "A1:B20", (r) => {
    if (!r) return "missing";
    const vals = r.slice(1).filter((x) => typeof x[1] === "number" && x[1] > 0);
    if (!vals.length) return "no weekly Active ARR";
    const last = vals[vals.length - 1][1];
    if (last < 3_000_000 || last > 12_000_000) return `latest weekly Active ARR out of range: ${Math.round(last)} (currency bug?)`;
    return null;
  }],
  ["Query 1", "A1:A1200", (r) => (!r ? "missing" : r.filter((x) => x[0]).length < 100 ? `only ${r.filter((x) => x[0]).length} rows (pull failed?)` : null)],
  ["Query 2", "A1:A2200", (r) => (!r ? "missing" : r.filter((x) => x[0]).length < 100 ? `only ${r.filter((x) => x[0]).length} rows` : null)],
  ["LiveARR - SOQL Pull", "A1:A1300", (r) => (!r ? "missing" : r.filter((x) => x[0]).length < 500 ? `only ${r.filter((x) => x[0]).length} rows` : null)],
  ["AE Attainment (Official)", "A1:A40", (r) => (!r ? "missing" : !r.some((x) => x[0] === "AE") ? "no AE header" : null)],
  ["Pipeline - WoW", "A1:A20", (r) => (!r ? "missing" : !r.some((x) => String(x[0]).includes("New ARR pipeline Created")) ? "no pipeline-created row" : null)],
  ["Forecasting", "A1:A5", (r) => (!r ? "missing" : null)],
];

// Staleness: the import banners we stamp start with "Salesforce Import".
async function checkFreshness(tab) {
  const r = await get(`'${tab}'!A1`);
  const banner = r?.[0]?.[0] ?? "";
  const m = String(banner).match(/(\d{4}-\d{2}-\d{2})/);
  if (!m) { warns.push(`${tab}: no update timestamp in banner`); return; }
  const ageDays = (Date.now() - Date.parse(m[1])) / 86400000;
  if (ageDays > 2) warns.push(`${tab}: last updated ${Math.floor(ageDays)}d ago (stale?)`);
}

async function main() {
  for (const [tab, range, fn] of checks) {
    const rows = await get(`'${tab}'!${range}`);
    const res = fn(rows);
    if (res) fails.push(`${tab}: ${res}`);
    else console.log(`  ✓ ${tab}`);
  }
  for (const t of ["Query 1", "Query 2", "LiveARR - SOQL Pull"]) await checkFreshness(t);

  if (warns.length) console.log("\nWARN:\n  " + warns.join("\n  "));
  if (fails.length) {
    console.error("\nHEALTH CHECK FAILED:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log("\nAll sheet health checks passed.");
}
main().catch((e) => { console.error("check-sheet error:", e.message); process.exit(1); });
