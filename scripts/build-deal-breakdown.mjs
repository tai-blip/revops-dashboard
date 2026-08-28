// Builds the "Deal Breakdown" tab — one row per open opportunity with an SFDC link, name,
// owner, stage, ARR, age-in-stage and a stale (>=90d) flag. All LIVE formulas over Query 1
// (which the daily refresh rewrites). This is the deal-level "database" the dashboard drill-down
// reads: click a number on the dash → it filters these rows into a panel (+ CSV). No math in the
// app code. Age parses Query 1's ISO-text dates with DATEVALUE(LEFT(...,10)).
// Run: node --env-file=.env scripts/build-deal-breakdown.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const ID = process.env.GOOGLE_SHEET_ID;
const TAB = "Deal Breakdown";
const SF = "https://fun-ruby-7024.my.salesforce.com"; // SF instance base for record links (static)
const Q = "'Query 1'";
const R = (c) => `${Q}!$${c}$3:$${c}$2000`; // Query 1 data rows (A=Id,B=Name,C=Stage,D=ARR,G=Created,J=Owner,L=LastStageChange,M=Amount,N=AE/AM % quarter,O=AE/AM % year)
const NB = `${R("C")}<>""`; // non-blank stage = a real open deal
const AGE_RAW = `TODAY()-DATEVALUE(LEFT(IF(${R("L")}<>"",${R("L")},${R("G")}),10))`;
const AGE = `IFERROR(${AGE_RAW},"")`;   // for the Age column ("" on bad/blank date)
const AGE0 = `IFERROR(${AGE_RAW},0)`;   // for the stale test (0 on bad/blank date)
const arr = (expr) => `=ARRAYFORMULA(IF(${R("C")}="","",${expr}))`;

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  // A blank cell breaks arithmetic inside ARRAYFORMULA (""*1 is #VALUE!), so every number is
  // coerced first. OR() does not broadcast over a range either — (a)+(b) is the array-safe form.
  const n = (x) => `IF(ISNUMBER(${x}),${x},0)`;
  const EARLY = `((${R("C")}="SQL")+(${R("C")}="SAL"))`;
  // Potential per deal, exactly as the Forecast tab defines it: Early (SQL/SAL) weights the
  // Amount, Late (SQO/Trial) weights the ARR, and the AE/AM probability is a 0-100 percentage.
  const pot = (probCol) => `IF(${EARLY},${n(R("M"))},${n(R("D"))})*${n(R(probCol))}/100`;
  const rows = [
    ["Opp ID", "SFDC Link", "Name", "Owner", "Stage", "ARR", "Age (days)", "Stale (≥90d)",
     "Amount", "AE/AM % (Q)", "AE/AM % (Year)", "Potential (Q)", "Potential (Year)"],
    [
      arr(R("A")),                                   // Opp ID
      arr(`"${SF}/"&${R("A")}`),                     // SFDC Link (full URL)
      arr(R("B")),                                   // Name
      arr(R("J")),                                   // Owner
      arr(R("C")),                                   // Stage
      arr(R("D")),                                   // ARR
      arr(AGE),                                       // Age (days)
      arr(`IF(${AGE0}>=90,"Yes","No")`),             // Stale (≥90d)
      arr(R("M")),                                   // Amount
      arr(R("N")),                                   // AE/AM % (quarter)
      arr(R("O")),                                   // AE/AM % (year)
      arr(pot("N")),                                 // Potential (Q)
      arr(pot("O")),                                 // Potential (Year)
    ],
  ];
  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const ex = meta.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (ex) reqs.push({ deleteSheet: { sheetId: ex.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: 2200, columnCount: 13 } } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: rows } });
  const back = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${TAB}'!A1:H6`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values ?? [];
  console.log(`wrote '${TAB}' — formula-driven over Query 1. Sample:`);
  back.slice(1, 5).forEach((r) => console.log("  " + String(r[0]).slice(0, 18) + " | " + String(r[2]).slice(0, 22).padEnd(22) + " | " + r[4] + " | $" + Math.round(Number(r[5]) || 0).toLocaleString() + " | age " + r[6] + " | stale " + r[7]));
}
main().catch((e) => { console.error(e); process.exit(1); });
