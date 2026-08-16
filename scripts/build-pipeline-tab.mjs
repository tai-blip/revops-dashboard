// Build the "Pipeline Pulse" sheet tab — a LIVE, formula-driven AUDIT summary of the dashboard's
// Pipeline tab pulse strip. Unlike Targets, the Pipeline numbers are ALREADY sheet-native (they
// live in the "Pipeline" + "Pipeline - WoW" tabs); this tab consolidates the top-line pulse
// scalars onto one auditable page and surfaces the aggregates the dashboard otherwise computes in
// code (Created-in-Q3, gap-to-quota, needed/week). Every value is a formula that reads those tabs
// by LABEL (INDEX/MATCH), so it is robust to row shifts and auto-updates on the nightly refresh.
//   node --env-file=.env scripts/build-pipeline-tab.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const NAVY = { red: 0.13, green: 0.19, blue: 0.32 };

const PL = "Pipeline";          // the computed data tab (label→value metric rows in A/B)
const PW = "Pipeline - WoW";    // weekly + rep-MoM tab

// Value for a Pipeline-tab metric row, found by its label (robust to row shifts).
const mL = (label) => `INDEX('${PL}'!$B:$B,MATCH("${label}",'${PL}'!$A:$A,0))`;
// Weekly "New ARR pipeline Created ($)" row: cols B:I are the last 8 weeks; I = latest, H = prior.
const WROW = `MATCH("New ARR pipeline Created ($)",'${PW}'!$A:$A,0)`;
const weekLatest = `INDEX('${PW}'!$A:$I,${WROW},9)`;
const weekPrior = `INDEX('${PW}'!$A:$I,${WROW},8)`;
const weeksLeft = `ROUNDUP((DATE(2026,10,1)-TODAY())/7,0)`;

const OPEN = mL("Total Pipeline (ARR)");
const OPPS = mL("Total Opportunities");
const COVER = mL("Pipeline Coverage Ratio");
const QUOTA = mL("Total Q3 Pipe Quota (All AEs)");
const CRE_Q3 = mL("Created This Quarter (ARR)");
const CRE_MO = mL("Created This Month (ARR)");
const NOPPS_Q3 = mL("# New Opps This Quarter");

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const B = ["", "", "", "", ""];

  const values = [
    ["PIPELINE PULSE — live audit mirror of the Pipeline tab pulse strip"],
    [`Every value is a formula reading the ${PL} / ${PW} tabs by label (auto-refreshed nightly) → this tab updates itself. It consolidates the top-line pulse scalars + the aggregates the dashboard computes in code (Created-in-Q3, gap, needed/week). Recomputed on open; as of =TODAY().`],
    ["Snapshot date:", "=TEXT(TODAY(),\"yyyy-mm-dd\")"],
    B,
    ["① OPEN PIPELINE"],
    [`Source: ${PL} tab — sections 1 & 3`],
    ["Open pipeline (ARR)", `=${OPEN}`],
    ["Open opportunities", `=${OPPS}`],
    ["Coverage ratio (open ÷ Q3 quota)", `=${COVER}`],
    B,
    ["② PIPELINE CREATED"],
    [`Source: ${PL} tab §4 (quarter/month) · ${PW} tab weekly row "New ARR pipeline Created ($)"`],
    ["Created this quarter (ARR)", `=${CRE_Q3}`],
    ["Created this month (ARR)", `=${CRE_MO}`],
    ["# new opps this quarter", `=${NOPPS_Q3}`],
    ["Created latest week (ARR)", `=${weekLatest}`],
    ["Created prior week (ARR)", `=${weekPrior}`],
    ["WoW change", `=IFERROR(TEXT((${weekLatest}-${weekPrior})/${weekPrior},"+0.0%;-0.0%"),"—")`],
    B,
    ["③ vs Q3 QUOTA"],
    [`Source: ${PL} tab §3 quota · created-this-quarter above`],
    ["Q3 pipe quota (all AEs)", `=${QUOTA}`],
    ["Gap to quota", `=${QUOTA}-${CRE_Q3}`],
    ["Weeks left in Q3", `=${weeksLeft}`],
    ["Pipeline needed / week", `=IFERROR(MAX(0,${QUOTA}-${CRE_Q3})/${weeksLeft},0)`],
    B,
    // Machine-readable key→value block — the dashboard reads THIS by key (col A → col B).
    ["══ MACHINE-READABLE — Pipeline pulse source · DO NOT EDIT ══"],
    ["key", "value", "feeds"],
    ["pipe_open", `=${OPEN}`, "Open pipeline (ARR)"],
    ["pipe_opps", `=${OPPS}`, "Open opportunities (#)"],
    ["pipe_coverage", `=${COVER}`, "Coverage ratio"],
    ["pipe_quota_q3", `=${QUOTA}`, "Q3 pipe quota (all AEs)"],
    ["pipe_created_q3", `=${CRE_Q3}`, "Created this quarter (ARR) — canonical Pipeline-tab figure"],
    ["pipe_created_mo", `=${CRE_MO}`, "Created this month (ARR)"],
    ["pipe_new_opps_q3", `=${NOPPS_Q3}`, "# new opps this quarter"],
    ["pipe_created_week", `=${weekLatest}`, "Created latest week (ARR)"],
    ["pipe_created_week_prev", `=${weekPrior}`, "Created prior week (ARR)"],
    ["pipe_wow_pct", `=IFERROR((${weekLatest}-${weekPrior})/${weekPrior},"")`, "WoW change (fraction)"],
    ["pipe_gap", `=MAX(0,${QUOTA}-${CRE_Q3})`, "Gap to Q3 quota"],
    ["pipe_needed_week", `=IFERROR(MAX(0,${QUOTA}-${CRE_Q3})/${weeksLeft},0)`, "Pipeline needed / week"],
  ];

  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const existing = meta.data.sheets.find((s) => s.properties.title === "Pipeline Pulse");
  const reqs = [];
  if (existing) reqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: "Pipeline Pulse", index: 3, tabColor: NAVY, gridProperties: { rowCount: values.length + 10, columnCount: 6 } } } });
  const res = await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  const gid = res.data.replies.find((r) => r.addSheet).addSheet.properties.sheetId;
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: "'Pipeline Pulse'!A1", valueInputOption: "USER_ENTERED", requestBody: { values } });

  const WHITE = { red: 1, green: 1, blue: 1 };
  const GRAYbg = { red: 0.93, green: 0.94, blue: 0.96 }, GRAYtx = { red: 0.5, green: 0.5, blue: 0.5 };
  const rowFmt = (i, fmt) => ({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: fmt }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
  const fmtReqs = [
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 4, endRowIndex: values.length, startColumnIndex: 1, endColumnIndex: 3 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } }, fields: "userEnteredFormat.numberFormat" } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 300 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: 1, endIndex: 3 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
  ];
  values.forEach((row, i) => {
    const a = String(row[0] || "");
    if (i === 0) fmtReqs.push(rowFmt(i, { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 13 } }));
    else if (/^[①②③]/.test(a) || a.startsWith("══")) fmtReqs.push(rowFmt(i, { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 } }));
    else if (a.startsWith("Source:")) fmtReqs.push(rowFmt(i, { textFormat: { foregroundColor: GRAYtx, italic: true, fontSize: 9 } }));
    else if (a === "key" && row[1]) fmtReqs.push(rowFmt(i, { backgroundColor: GRAYbg, textFormat: { bold: true } }));
  });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: fmtReqs } });

  console.log("Pipeline Pulse tab (formula-driven) built → https://docs.google.com/spreadsheets/d/" + ID + "/edit#gid=" + gid);
  console.log("All values are live formulas into the Pipeline / Pipeline - WoW tabs (read by label) — auto-refreshes with the data source.");
}
main().catch((e) => { console.error(e); process.exit(1); });
