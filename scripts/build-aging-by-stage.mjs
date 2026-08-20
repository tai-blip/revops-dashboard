// Builds the "Deal Health — Aging by Stage" source tab — one row per open-pipeline stage with
// # of Deals, Avg Age (days), Avg ACV, ALL computed by live formula over the Query 1 tab (which
// the daily refresh rewrites). The dashboard Deal Health tab reads these rows verbatim — no math
// in the code. Age = days since Last Stage Change (else Created); ACV = Annual_Contract_Value_ARR.
// Query 1 stores dates as ISO text, so age parses them with DATEVALUE(LEFT(...,10)).
// Run: node --env-file=.env scripts/build-aging-by-stage.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const ID = process.env.GOOGLE_SHEET_ID;
const TAB = "Deal Health — Aging by Stage";
const Q = "'Query 1'"; // C=StageName, D=ARR, G=CreatedDate, L=LastStageChangeDate (dates are ISO text)

// Open-pipeline stages (from Query 1). If SFDC adds/renames a stage, add it here.
const STAGES = [
  "Expansion Lead", "SQL", "SAL", "Renewal Pending (>120 Days)", "SQO",
  "Renewal Window (0-60 Days)", "Renewal Upcoming (60-120 Days)", "Value Identified",
  "Billing", "Renewal Overdue", "Negotiation", "Trial", "Pending Signature", "Proposal",
];
// Per-deal age array: blank stage → 0; else today − DATEVALUE(date-part of LastStageChange, else Created).
const AGE = `IF(${Q}!$C$3:$C$2000="",0,TODAY()-DATEVALUE(LEFT(IF(${Q}!$L$3:$L$2000<>"",${Q}!$L$3:$L$2000,${Q}!$G$3:$G$2000),10)))`;

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const vals = [
    [`Deal Health — Aging by Stage · LIVE formula over Query 1 (auto-refreshes). Age = days since Last Stage Change, else Created. ACV = Annual Contract Value (ARR field).`],
    [],
    ["Stage", "# of Deals", "Avg Age (days)", "Avg ACV"],
  ];
  STAGES.forEach((s, i) => {
    const r = i + 4;
    vals.push([
      s,
      `=COUNTIF(${Q}!$C$3:$C$2000,$A${r})`,
      `=IFERROR(ROUND(SUMPRODUCT((${Q}!$C$3:$C$2000=$A${r})*${AGE})/COUNTIF(${Q}!$C$3:$C$2000,$A${r})),"—")`,
      `=IFERROR(ROUND(AVERAGEIF(${Q}!$C$3:$C$2000,$A${r},${Q}!$D$3:$D$2000)),"—")`,
    ]);
  });
  vals.push([
    "TOTAL (all open)",
    `=SUMPRODUCT((${Q}!$C$3:$C$2000<>"")*1)`,
    `=IFERROR(ROUND(SUMPRODUCT((${Q}!$C$3:$C$2000<>"")*${AGE})/SUMPRODUCT((${Q}!$C$3:$C$2000<>"")*1)),"—")`,
    `=IFERROR(ROUND(SUMPRODUCT((${Q}!$C$3:$C$2000<>"")*${Q}!$D$3:$D$2000)/SUMPRODUCT((${Q}!$C$3:$C$2000<>"")*1)),"—")`,
  ]);

  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const ex = meta.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (ex) reqs.push({ deleteSheet: { sheetId: ex.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: vals.length + 5, columnCount: 4 } } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: vals } });
  console.log(`wrote '${TAB}' — ${STAGES.length} stages + TOTAL, formula-driven over Query 1.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
