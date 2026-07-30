// Add a "PIPELINE GENERATION — Week over Week (Last 13 Weeks)" section to the
// "AE Attainment (Official)" tab, mirroring the ARR-attainment WoW section's
// exact structure (13 rolling weeks, week-start buckets, Δ$/Δ%, formatting) but
// with the pipeline-generation metric: Open pipeline ARR (col D) by Date_Reached_SQL
// (col I) per owner (col M) — same source/logic as the pipe-gen MoM/QoQ sections.
// Run: node --env-file=.env scripts/add-pipegen-wow.mjs
import { google } from "googleapis";
const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const api = google.sheets({ version: "v4", auth });
const ID = process.env.GOOGLE_SHEET_ID;
const TAB = "AE Attainment (Official)";
const OP = "'Open pipeline - SOQL pull'";
const SRC_TOP = 20;              // 0-based row 21 (WoW section header)
const DEST_TOP = 62;             // 0-based row 63 (new section header) → data rows 65-70
const HDR_ROW = 64;              // 1-based week-serial header row in the new section
const REP_ROWS = [65, 66, 67, 68, 69, 70];
const WEEK_COLS = ["E", "H", "K", "N", "Q", "T", "W", "Z", "AC", "AF", "AI", "AL", "AO"];
const QUOTAS = [738000, 750000, 960000, "", 850000, 0]; // James, Dorsa, Jed, David(blank), Jill, Mathias

const q3Formula = (r) =>
  `=SUMPRODUCT(($A${r}=${OP}!$M$3:$M$1200)*(${OP}!$I$3:$I$1200>=DATE(2026,7,1))*(${OP}!$I$3:$I$1200<DATE(2026,10,2))*${OP}!$D$3:$D$1200)`;
const weekFormula = (r, L) =>
  `=SUMPRODUCT(($A${r}=${OP}!$M$3:$M$1200)*(${OP}!$I$3:$I$1200>=${L}$${HDR_ROW})*(${OP}!$I$3:$I$1200<${L}$${HDR_ROW}+7)*${OP}!$D$3:$D$1200)`;

async function main() {
  const sheet = (await api.spreadsheets.get({ spreadsheetId: ID })).data.sheets.find((s) => s.properties.title === TAB);
  const sheetId = sheet.properties.sheetId;

  // 1) copy the ARR-attainment WoW block (A21:AO28) → A63, keeping all formatting + week math
  await api.spreadsheets.batchUpdate({
    spreadsheetId: ID,
    requestBody: { requests: [{ copyPaste: {
      source: { sheetId, startRowIndex: SRC_TOP, endRowIndex: SRC_TOP + 8, startColumnIndex: 0, endColumnIndex: 41 },
      destination: { sheetId, startRowIndex: DEST_TOP, endRowIndex: DEST_TOP + 8, startColumnIndex: 0, endColumnIndex: 41 },
      pasteType: "PASTE_NORMAL",
    } }] },
  });

  // 2) overwrite labels + quotas + value cells with the pipe-gen metric
  const data = [
    { range: `'${TAB}'!A${DEST_TOP + 1}`, values: [["🚀  PIPELINE GENERATION — Week over Week (Last 13 Weeks)"]] },
    { range: `'${TAB}'!B${HDR_ROW}`, values: [["Q3 Pipe Quota"]] },
    { range: `'${TAB}'!B65:B70`, values: QUOTAS.map((q) => [q]) },
    { range: `'${TAB}'!D65:D70`, values: REP_ROWS.map((r) => [q3Formula(r)]) },
  ];
  for (const L of WEEK_COLS) data.push({ range: `'${TAB}'!${L}65:${L}70`, values: REP_ROWS.map((r) => [weekFormula(r, L)]) });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: "USER_ENTERED", data } });

  // 3) verify
  const chk = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${TAB}'!A63:AO70`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  console.log("Section title:", chk[0]?.[0]);
  console.log("Week-start serials (row 64):", WEEK_COLS.map((L, i) => chk[1]?.[[4,7,10,13,16,19,22,25,28,31,34,37,40][i]]).map((s)=>s).join(","));
  console.log("\nPipe-gen WoW per rep (quota | Q3 actual | first & last week):");
  let errs = 0;
  for (let i = 0; i < 6; i++) {
    const row = chk[2 + i] || [];
    for (const x of row) if (typeof x === "string" && x.startsWith("#")) errs++;
    console.log(`  ${String(row[0]).padEnd(20)} B=$${Math.round(row[1]||0).toLocaleString().padStart(9)}  Q3=$${Math.round(row[3]||0).toLocaleString().padStart(9)}  wk1=$${Math.round(row[4]||0).toLocaleString()}  wk13=$${Math.round(row[40]||0).toLocaleString()}`);
  }
  console.log("formula errors in section:", errs ? errs : "NONE ✓");
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
