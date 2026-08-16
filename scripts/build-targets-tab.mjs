// Build the "Targets" sheet tab — a LIVE, formula-driven database mirror of the dashboard's
// "Targets & Progress" tab. Every ACTUAL (booked) is a formula reading ARR_MoM_Rebuild (which
// refreshes nightly), so the tab updates itself. The FIXED finance plan (New ARR target +
// Ending ARR target per month) is written as literals — a plan is not "pulled data" — but now
// it lives HERE, in the sheet, as the single auditable source the dashboard reads (with an
// in-code fallback to planConfig.ts). Mirrors build-headline-tab.mjs.
//   node --env-file=.env scripts/build-targets-tab.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const NAVY = { red: 0.13, green: 0.19, blue: 0.32 };

// ---- Fixed finance plan (ported EXACTLY from planConfig.ts), Jan..Dec 2026 ----
const newBiz = [251698, 257202, 262647, 383856, 391254, 431734, 431370, 438347, 589757, 683008, 739043, 825669];
const expansion = [62924, 64301, 65662, 95964, 97813, 107933, 107843, 109587, 147439, 170752, 184761, 206417];
const endARR = [4500000, 4801692, 5109119, 5566969, 6033581, 6549122, 7063929, 7585327, 8294435, 9118730, 10007309, 11004164];
const newARR = newBiz.map((v, i) => v + expansion[i]);
const rebasedEnd = [[5, 5690808], [6, 6210436], [7, 6862613], [8, 7614030], [9, 8636980], [10, 9383399], [11, 9998233]];
for (const [i, v] of rebasedEnd) endARR[i] = v;
for (let i = 6; i <= 11; i++) newARR[i] = endARR[i] - endARR[i - 1]; // rebased H2 net-new = MoM of ending path
const fy26NewArr = newARR.reduce((s, v) => s + v, 0);
const fy26EndArr = endARR[11];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- Formula helpers: booked New ARR read from ARR_MoM_Rebuild by month-end date (col B) ----
// New ARR Added lives in col Q (New Business N + Expansion O, churn excluded). Read by matching
// the month-end date so nothing is hardcoded to a row.
const A = "ARR_MoM_Rebuild";
const D1 = (n) => `DATE(2026,${n},1)`;
const ME = (n) => `EOMONTH(${D1(n)},0)`;
const idxQ = (n) => `IFERROR(INDEX(${A}!$Q:$Q,MATCH(${ME(n)},${A}!$B:$B,0)),0)`;
const fut = (n, inner) => `=IF(${D1(n)}>TODAY(),"",${inner})`;
const booked = (n) => fut(n, idxQ(n));
// Booked New ARR summed over a date window (YTD / Q3-to-date, current month included via EOMONTH(TODAY)).
const bookedYtd = `SUMIFS(${A}!$Q:$Q,${A}!$B:$B,">="&DATE(2026,1,1),${A}!$B:$B,"<="&EOMONTH(TODAY(),0))`;
const bookedQ3 = `SUMIFS(${A}!$Q:$Q,${A}!$B:$B,">="&DATE(2026,7,1),${A}!$B:$B,"<="&EOMONTH(TODAY(),0))`;
const weeksLeft = `ROUNDUP((DATE(2026,10,1)-TODAY())/7,0)`;
// Q3 New ARR target = plan for Jul+Aug+Sep (literals). QTD target = quarter months already started.
const q3Target = newARR[6] + newARR[7] + newARR[8];
// YTD target through the current month = sum of plan New ARR for months whose 1st has arrived.
// Built as a SUMPRODUCT over a small in-sheet plan range so it stays auditable and self-updating.

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const months = [...Array(12)].map((_, i) => i + 1);
  const B = ["", "", "", "", ""];

  // The monthly plan table starts at a known row so the YTD/scalar formulas can reference it.
  // Section ① header is row 5 (1-based); the "Month" header is row 6; data rows 7..18.
  const planFirstRow = 7;         // first month (Jan) data row (1-based)
  const planLastRow = planFirstRow + 11; // Dec
  const PN = `$B$${planFirstRow}:$B$${planLastRow}`; // plan New ARR target column (B)
  const PS = `$A$${planFirstRow}:$A$${planLastRow}`; // month-start date column (A, hidden helper)
  // Q3 target = Jul+Aug+Sep plan cells. This tab is the single HOME of the plan; the dashboard
  // reads q3_target from here for BOTH the Targets & Progress and Command gap cards.
  const Q3SUM = `SUM($B$${planFirstRow + 6}:$B$${planFirstRow + 8})`;
  // YTD plan target through the current calendar month (month whose 1st <= today).
  const ytdTargetF = `SUMPRODUCT((${PS}<=TODAY())*${PN})`;
  // Q3 QTD plan target (Jul/Aug/Sep months already started).
  const qtdTargetF = `SUMPRODUCT((${PS}<=TODAY())*(${PS}>=DATE(2026,7,1))*(${PS}<DATE(2026,10,1))*${PN})`;

  const values = [
    ["TARGETS — live mirror of the Targets & Progress tab"],
    ["Booked actuals are formulas reading ARR_MoM_Rebuild (auto-refreshed nightly) → this tab updates itself. The fixed finance plan (New ARR + Ending ARR target per month) is a literal, but lives HERE as the single auditable source the dashboard reads. Recomputed on open; as of =TODAY()."],
    ["Snapshot date:", "=TEXT(TODAY(),\"yyyy-mm-dd\")"],
    B,
    ["① PLAN TARGETS (FY26) — fixed finance plan · New ARR = Net New + Expansion"],
    ["Month (start)", "New ARR target", "Ending ARR target", "", ""],
    ...months.map((n) => [
      `=DATE(2026,${n},1)`,               // A: month-start date (helper for the YTD SUMPRODUCTs) — shown as a date
      Math.round(newARR[n - 1]),          // B: New ARR target (literal plan — the one editable input)
      Math.round(endARR[n - 1]),          // C: Ending ARR target (literal plan)
      "", "",
    ]),
    // Totals are FORMULAS over the monthly cells, so editing any month propagates everywhere
    // (FY26 target, machine-readable block, dashboard). Ending-ARR total = the Dec year-end level.
    ["FY26 totals", `=SUM($B$${planFirstRow}:$B$${planLastRow})`, `=$C$${planLastRow}`, "", ""],
    B,
    ["② NEW ARR — BOOKED vs TARGET (per month)"],
    ["Source: ARR_MoM_Rebuild — New ARR Added (col Q) · target from ① above"],
    ["Month", "Target", "Booked", "Δ vs target", "Attainment %"],
    ...months.map((n) => [
      `${MON[n - 1]} 2026`,
      `=$B$${planFirstRow + n - 1}`, // target = plan cell in ①
      booked(n),                     // booked = formula over ARR_MoM_Rebuild
      "",                            // Δ vs target — filled by the row-relative patch below
      "",                            // Attainment % — filled by the row-relative patch below
    ]),
    B,
    ["③ YTD & Q3 PROGRESS"],
    ["Source: ① plan targets + ARR_MoM_Rebuild booked (col Q)"],
    ["YTD New ARR target (through this month)", `=${ytdTargetF}`],
    ["YTD New ARR booked", `=${bookedYtd}`],
    ["Q3 New ARR target (fixed plan)", `=${Q3SUM}`],
    ["Q3 New ARR booked (QTD)", `=${bookedQ3}`],
    ["Gap to Q3 target", `=${Q3SUM}-${bookedQ3}`],
    ["Weeks left in Q3", `=${weeksLeft}`],
    ["New ARR needed / week", `=(${Q3SUM}-${bookedQ3})/${weeksLeft}`],
    B,
    // Machine-readable key→value block — the dashboard reads THIS by key (col A → col B).
    // Only the values NOT already published by the Headline tab live here: the fixed plan
    // (per month + FY26 totals) and the YTD/QTD plan-target rollups. q3_target/q3_booked/
    // gap_to_target/arr_needed_week/weeks_left/days_left continue to come from Headline.
    ["══ MACHINE-READABLE — powers the dashboard Targets tab · DO NOT EDIT ══"],
    ["key", "value", "feeds"],
    ["q3_target", `=${Q3SUM}`, "Q3 New ARR target (Σ Jul–Sep plan) — single plan source"],
    ["ytd_new_arr_target", `=${ytdTargetF}`, "YTD New ARR target (through current month)"],
    ["ytd_new_arr_booked", `=${bookedYtd}`, "YTD New ARR booked"],
    ["qtd_arr_target", `=${qtdTargetF}`, "Q3 QTD target (started months) — Command pace"],
    ["fy26_new_arr_target", `=SUM($B$${planFirstRow}:$B$${planLastRow})`, "FY26 New ARR target (Σ plan months)"],
    ["fy26_ending_arr_target", `=$C$${planLastRow}`, "FY26 Ending ARR target (Dec year-end)"],
    ...months.map((n) => [`plan_newarr_m${n}`, `=$B$${planFirstRow + n - 1}`, `Plan New ARR target — ${MON[n - 1]}`]),
    ...months.map((n) => [`plan_endarr_m${n}`, `=$C$${planFirstRow + n - 1}`, `Plan Ending ARR target — ${MON[n - 1]}`]),
  ];

  // Patch section ②'s Δ / attainment formulas to reference their OWN rows (now that the layout
  // is fixed). Section ② "Month" header is at index (find it), data rows follow.
  const hdr2 = values.findIndex((r) => r[0] === "Month" && r[1] === "Target");
  for (let n = 1; n <= 12; n++) {
    const r1 = hdr2 + n + 1; // 1-based row of this month in ②
    values[hdr2 + n][3] = `=IF($C$${r1}="","",$C$${r1}-$B$${r1})`;
    values[hdr2 + n][4] = `=IFERROR(TEXT($C$${r1}/$B$${r1},"0.0%"),"")`;
  }

  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const existing = meta.data.sheets.find((s) => s.properties.title === "Targets");
  const reqs = [];
  if (existing) reqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: "Targets", index: 2, tabColor: NAVY, gridProperties: { rowCount: values.length + 10, columnCount: 6 } } } });
  const res = await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  const gid = res.data.replies.find((r) => r.addSheet).addSheet.properties.sheetId;
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: "'Targets'!A1", valueInputOption: "USER_ENTERED", requestBody: { values } });

  // ---- Formatting: navy title/section headers, gray italic source lines, gray bold table
  // headers, currency on value cols, date on the plan month-start col, wider label column. ----
  const WHITE = { red: 1, green: 1, blue: 1 };
  const GRAYbg = { red: 0.93, green: 0.94, blue: 0.96 }, GRAYtx = { red: 0.5, green: 0.5, blue: 0.5 };
  const rowFmt = (i, fmt) => ({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: fmt }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
  const fmtReqs = [
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    // Currency on B:C for section ① + the value column generally.
    { repeatCell: { range: { sheetId: gid, startRowIndex: 4, endRowIndex: values.length, startColumnIndex: 1, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } }, fields: "userEnteredFormat.numberFormat" } },
    // Date format on the ① month-start helper column (A, rows planFirstRow..planLastRow).
    { repeatCell: { range: { sheetId: gid, startRowIndex: planFirstRow - 1, endRowIndex: planLastRow, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } }, fields: "userEnteredFormat.numberFormat" } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 300 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: 1, endIndex: 5 }, properties: { pixelSize: 140 }, fields: "pixelSize" } },
  ];
  values.forEach((row, i) => {
    const a = String(row[0] || "");
    if (i === 0) fmtReqs.push(rowFmt(i, { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 13 } }));
    else if (/^[①②③④]/.test(a) || a.startsWith("══")) fmtReqs.push(rowFmt(i, { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 } }));
    else if (a.startsWith("Source:")) fmtReqs.push(rowFmt(i, { textFormat: { foregroundColor: GRAYtx, italic: true, fontSize: 9 } }));
    else if ((["Month", "key"].includes(a) || a === "Month (start)") && row[1]) fmtReqs.push(rowFmt(i, { backgroundColor: GRAYbg, textFormat: { bold: true } }));
  });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: fmtReqs } });

  console.log("Targets tab (formula-driven) built → https://docs.google.com/spreadsheets/d/" + ID + "/edit#gid=" + gid);
  console.log("Plan targets are literals-in-sheet (auditable single source); booked/YTD/Q3 are live formulas into ARR_MoM_Rebuild.");
}
main().catch((e) => { console.error(e); process.exit(1); });
