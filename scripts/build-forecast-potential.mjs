// Builds the "Forecast Potential" source tab — the single, auditable, SHEET-CALCULATED
// home for each AE's Quarter/Yearly Potential ARR. Every number here is a live formula
// over the Query 1 open-pipeline pull (refreshed daily from Salesforce), so the math is
// visible in the sheet instead of buried in the dashboard code.
//
//   Quarter/Yearly Expected Rev per AE = Σ (deal size × AE/AM probability), where
//     early stages (SQL, SAL) size on Amount, late stages (SQO, Trial) size on ARR.
//   Renewals are excluded. A deal at 0% quarterly probability contributes $0 — so a
//   deal a rep has deprioritized for the quarter drops out automatically.
//   AE Potential ARR = open Expected Rev + Closed Won (booked, from AE Attainment).
//
// The dashboard reads the "══ MACHINE-READABLE ══" key/value block at the bottom.
// Run: node --env-file=.env scripts/build-forecast-potential.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = "Forecast Potential";

// Forecast roster (matches AE_ROSTER minus FORECAST_EXCLUDE=Dorsa in the dashboard).
const AES = [
  ["James", "James Burdick"],
  ["Jill", "Jill Bucci"],
  ["Jed", "Jed Rutstein"],
  ["Mathias", "Mathias Berthelemot"],
  ["Davi", "David Dubinski"],
];

// Query 1 columns: C=Stage, D=ARR, J=Owner.Name, K=RecordType.Name, M=Amount,
// N=AE_AM_Probability__c (quarter %), O=AE_AM_Probability_Year__c (year %). Data from row 3.
const Q = "'Query 1'";
const R = (c) => `${Q}!$${c}$3:$${c}$4000`;
const OWN = R("J"), ST = R("C"), ARR = R("D"), AMT = R("M"), PQ = R("N"), PY = R("O");
const NONREN = `(ISNUMBER(SEARCH("Renewal",${R("K")}))=FALSE)`;
const isEarly = `((${ST}="SQL")+(${ST}="SAL"))`;
const isLate = `((${ST}="SQO")+(${ST}="Trial"))`;
const isSql = `(${ST}="SQL")`;

// Weighted Expected Rev formula for one AE row `r`: stage set × size col × prob col.
const wtd = (r, stageExpr, sizeCol, probCol) =>
  `=SUMPRODUCT((${OWN}=$B${r})*${stageExpr}*${NONREN}*${sizeCol}*${probCol}/100)`;

function aeRow(r) {
  return [
    null, // A: short name (written separately as literal)
    null, // B: full name (literal)
    wtd(r, isEarly, AMT, PQ),                 // C Early Qtr  (SQL+SAL, Amount×Qtr%)
    wtd(r, isLate, ARR, PQ),                  // D Late Qtr   (SQO+Trial, ARR×Qtr%)
    wtd(r, isSql, AMT, PQ),                   // E SQL Qtr    (SQL only)
    `=C${r}+D${r}`,                            // F Open Qtr
    wtd(r, isEarly, AMT, PY),                 // G Early Yr
    wtd(r, isLate, ARR, PY),                  // H Late Yr
    wtd(r, isSql, AMT, PY),                   // I SQL Yr
    `=G${r}+H${r}`,                            // J Open Yr
    `=IFERROR(VLOOKUP($B${r},'AE Attainment (Official)'!$A$5:$D$10,4,FALSE),0)`, // K Closed Won
    `=F${r}+K${r}`,                            // L Qtr Potential
    `=J${r}+K${r}`,                            // M Yr Potential
  ];
}

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const HDR_ROW = 4, FIRST = 5;
  const rows = [];
  rows.push([`Forecast Potential — sheet-calculated per-AE Potential ARR (live over Query 1 · built ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)`]);
  rows.push(["Quarter/Yearly Expected Rev = Σ(deal size × AE/AM probability): SQL/SAL size on Amount, SQO/Trial on ARR. Renewals & 0%-probability deals excluded. AE Potential ARR = open Expected Rev + Closed Won (from AE Attainment)."]);
  rows.push([]);
  rows.push(["AE", "Owner (full)", "Early Qtr", "Late Qtr", "SQL Qtr", "Open Qtr", "Early Yr", "Late Yr", "SQL Yr", "Open Yr", "Closed Won", "Qtr Potential", "Yr Potential"]);
  AES.forEach(([short, full], i) => {
    const r = FIRST + i;
    const row = aeRow(r);
    row[0] = short; row[1] = full;
    rows.push(row);
  });
  const LAST = FIRST + AES.length - 1, TOT = LAST + 1;
  const totRow = ["TOTAL", ""];
  for (let c = 2; c <= 12; c++) { const L = String.fromCharCode(65 + c); totRow.push(`=SUM(${L}${FIRST}:${L}${LAST})`); }
  rows.push(totRow);

  // ── Machine-readable block the dashboard parses (key must match ^[a-z][a-z0-9_]+$) ──
  rows.push([]);
  rows.push(["══ MACHINE-READABLE — Forecast Potential · dashboard reads keys below (do not edit) ══"]);
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keyCols = { earlyq: "C", lateq: "D", sqlq: "E", earlyy: "G", latey: "H", sqly: "I", cw: "K", potq: "L", poty: "M" };
  AES.forEach(([short], i) => {
    const r = FIRST + i, s = slug(short);
    for (const [k, col] of Object.entries(keyCols)) rows.push([`fp_${k}_${s}`, `=${col}${r}`]);
  });
  rows.push(["fp_potq_team", `=L${TOT}`]);
  rows.push(["fp_poty_team", `=M${TOT}`]);

  // Recreate the tab clean (avoid stale formulas/#REF!).
  const meta = await api.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties(sheetId,title)" });
  const ex = meta.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (ex) reqs.push({ deleteSheet: { sheetId: ex.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 10, columnCount: 13 } } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: rows } });

  // Read back the computed values for verification.
  const back = (await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A${FIRST}:M${TOT}`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values ?? [];
  const k = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();
  console.log(`wrote '${TAB}' — per-AE (openQtr | openYr | ClosedWon | QtrPotential | YrPotential):`);
  for (const row of back) {
    if (!row[0]) continue;
    console.log("  " + String(row[0]).padEnd(9) + k(row[5]).padStart(11) + " | " + k(row[9]).padStart(11) + " | CW " + k(row[10]).padStart(10) + " | Qpot " + k(row[11]).padStart(11) + " | Ypot " + k(row[12]).padStart(11));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
