// Build the "Headline" sheet tab — a LIVE, formula-driven database mirror of the dashboard's
// Command tab (minus the Executive Summary). Every ACTUAL is a formula that reads the existing
// data-source tabs (ARR_MoM_Rebuild, ARR_WoW_Rebuild) which refresh on the automated cadence, so
// the tab updates on its own — no re-run needed. Only the FIXED finance plan is written as a
// literal (a plan is not "pulled data"). Run ONCE to (re)create the tab:
//   node --env-file=.env scripts/build-headline-tab.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const NAVY = { red: 0.13, green: 0.19, blue: 0.32 };

// ---- Fixed finance plan (ported from planConfig.ts), Jan..Dec 2026 ----
const newBiz = [251698, 257202, 262647, 383856, 391254, 431734, 431370, 438347, 589757, 683008, 739043, 825669];
const expansion = [62924, 64301, 65662, 95964, 97813, 107933, 107843, 109587, 147439, 170752, 184761, 206417];
const endARR = [4500000, 4801692, 5109119, 5566969, 6033581, 5690808, 6210436, 6862613, 7614030, 8636980, 9383399, 9998233];
const newARR = newBiz.map((v, i) => v + expansion[i]);
for (let i = 6; i <= 11; i++) newARR[i] = endARR[i] - endARR[i - 1]; // rebased H2 net-new = MoM of ending path
const cumTarget = newARR.map((_, i) => newARR.slice(0, i + 1).reduce((s, v) => s + v, 0));
const q3Target = newARR[6] + newARR[7] + newARR[8];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- Formula helpers: read ARR_MoM_Rebuild by month-end date (col B), so no hardcoded rows ----
const A = "ARR_MoM_Rebuild";
const W = "ARR_WoW_Rebuild";
const D1 = (n) => `DATE(2026,${n},1)`;
const ME = (n) => `EOMONTH(${D1(n)},0)`;                                   // that month's end
const idx = (n, col) => `INDEX(${A}!$${col}:$${col},MATCH(${ME(n)},${A}!$B:$B,0))`;
const fut = (n, inner) => `=IF(${D1(n)}>TODAY(),"",${inner})`;            // blank future months
// (Section ① no longer builds per-month Active/MoM formulas here — it mirrors every
// ARR_MoM_Rebuild row straight through, see trendRows in main().)
const nbMo = (n) => fut(n, `IFERROR(${idx(n, "N")},0)`);
const expMo = (n) => fut(n, `IFERROR(${idx(n, "O")},0)`);
const newMo = (n) => fut(n, `IFERROR(${idx(n, "Q")},0)`);
const chnMo = (n) => fut(n, `IFERROR(${idx(n, "J")},0)`);
const cumF = (n, col) => `SUMIFS(${A}!$${col}:$${col},${A}!$B:$B,">="&DATE(2026,1,1),${A}!$B:$B,"<="&${ME(n)})`;
const cumNew = (n) => fut(n, cumF(n, "Q"));
const cumChn = (n) => fut(n, cumF(n, "J"));
const pctPlan = (n) => fut(n, `IFERROR(TEXT(${cumF(n, "Q")}/${cumTarget[n - 1]},"0.0%"),"")`);
// Q3 New ARR booked QTD (includes current month via EOMONTH(TODAY)); pace helpers.
const q3Qtd = `SUMIFS(${A}!$Q:$Q,${A}!$B:$B,">="&DATE(2026,7,1),${A}!$B:$B,"<="&EOMONTH(TODAY(),0))`;
const weeksLeft = `ROUNDUP((DATE(2026,10,1)-TODAY())/7,0)`;
const wLast = `INDEX(${W}!$B$2:$B,COUNTA(${W}!$A$2:$A))`;                 // latest weekly Active ARR
const wPrev = `INDEX(${W}!$B$2:$B,COUNTA(${W}!$A$2:$A)-1)`;
// Exec-summary helpers (current calendar month / prior month) for the machine-readable block.
const curMatch = `MATCH(EOMONTH(TODAY(),0),${A}!$B:$B,0)`;
const prevActive = `INDEX(${A}!$C:$C,MATCH(EOMONTH(TODAY(),-1),${A}!$B:$B,0))`;
// Blank, NOT zero, when the current month has no row yet. ARR_MoM_Rebuild gains its new month
// on the first refresh after UTC midnight, but TODAY() here rolls at sheet-local midnight
// (Asia/Saigon, UTC+7) — so for seven hours at every month boundary the MATCH finds nothing.
// Defaulting that to 0 turned "not written yet" into the claim "we booked nothing and churned
// nothing", which is a different and false statement: on 2026-09-01 the tiles read $0 while
// August had in fact done $344,990. Blank instead means route.ts's parseKeyValue skips the key
// (it only takes numeric cells), so the dashboard's own current-month fallback answers — and
// that one keys off UTC, so it still resolves to the right month during the gap.
const newArrMoF = `IFERROR(INDEX(${A}!$Q:$Q,${curMatch}),"")`;
const churnMoF = `IFERROR(INDEX(${A}!$J:$J,${curMatch}),"")`;
const momPctF = `IFERROR((${A}!$W$1-${prevActive})/${prevActive},"")`;
const wowPctF = `IFERROR((${wLast}-${wPrev})/${wPrev},"")`;
// Cross-tab reads for the REST of the Command tab, so EVERY Command number is a computed cell here
// (nothing left to page.tsx math). All sources are tabs that survive the nightly refresh: Pipeline /
// Pipeline - WoW are formula tabs (never deleted); ARR_Forward is cleared-in-place; Targets is a
// source tab. Pipeline metrics are read BY LABEL (INDEX/MATCH) so row shifts don't break them.
const PL = "Pipeline", PW = "Pipeline - WoW", TG = "Targets";
const mL = (label) => `INDEX('${PL}'!$B:$B,MATCH("${label}",'${PL}'!$A:$A,0))`;
const totalPipeF = mL("Total Pipeline (ARR)");
const totalOppsF = mL("Total Opportunities");
const coverageF = mL("Pipeline Coverage Ratio");
const pipeCreatedQ3F = mL("Created This Quarter (ARR)");
const pipeQuotaF = mL("Total Q3 Pipe Quota (All AEs)");
const pipeCreatedWeekF = `INDEX('${PW}'!$A:$I,MATCH("New ARR pipeline Created ($)",'${PW}'!$A:$A,0),9)`;
const pipeCreatedWeekPrevF = `INDEX('${PW}'!$A:$I,MATCH("New ARR pipeline Created ($)",'${PW}'!$A:$A,0),8)`;
const pipeWowF = `IFERROR((${pipeCreatedWeekF}-${pipeCreatedWeekPrevF})/${pipeCreatedWeekPrevF},"")`;
const renewalF = `'ARR_Forward'!$B$1`;                 // "up for renewal this month" (renewalDue)
const q3TargetF = `SUM('${TG}'!$B$13:$B$15)`;          // Q3 plan (Jul/Aug/Sep) — single home = Targets tab
const q3PctF = `IFERROR(${q3Qtd}/(${q3TargetF}),"")`;
const genPctF = `IFERROR(${pipeCreatedQ3F}/(${pipeQuotaF}),"")`;
const elapsedF = `IFERROR(1-(DATE(2026,10,1)-TODAY())/(DATE(2026,10,1)-DATE(2026,7,2)),"")`;

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const months = [...Array(12)].map((_, i) => i + 1);
  const B = ["", "", "", "", ""]; // blank spacer row

  // Full monthly trend (EVERY ARR_MoM_Rebuild month) as machine-readable rows. The Command ARR
  // chart reads THIS block, so the Headline tab is the chart's source of truth — edit a cell here
  // and the chart moves. Each cell is a formula pulling that month's row from ARR_MoM_Rebuild
  // (B=month-end→ym, C=Active ARR, Q=New ARR, J=Churn, I=MoM), so it also auto-refreshes.
  const lastRow = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${A}'!A:A` })).data.values?.length ?? 1;
  const trendRows = [];
  for (let r = 2; r <= lastRow; r++) {
    trendRows.push([
      `=TEXT('${A}'!$B${r},"yyyy-mm")`,
      `='${A}'!$C${r}`,
      `='${A}'!$Q${r}`,
      `='${A}'!$J${r}`,
      `='${A}'!$I${r}`,
    ]);
  }

  const values = [
    ["HEADLINE — live mirror of the Command tab (excl. Executive Summary)"],
    ["Every actual is a formula reading ARR_MoM_Rebuild / ARR_WoW_Rebuild (auto-refreshed) → this tab updates itself. Only the fixed finance plan is a literal. Recomputed on open; as of =TODAY()."],
    ["Snapshot date:", "=TEXT(TODAY(),\"yyyy-mm-dd\")"],
    B,
    ["① ARR TREND — Path to $10M  ·  THE COMMAND ARR CHART READS THIS TABLE"],
    ["Source: ARR_MoM_Rebuild (Active ARR col C, New col Q, Churn col J, MoM col I). Each cell is a live formula. The dashboard's ARR-trend chart is drawn from the 'active' column below — edit an 'active' cell and the chart moves."],
    ["Live ARR (as of today)", `=${A}!$W$1`],
    ["$10M milestone", 10000000],
    ["Gap to $10M", `=10000000-${A}!$W$1`],
    B,
    ["ym", "active", "new_arr", "churn", "mom"],
    ...trendRows,
    B,
    ["② DAYS LEFT IN Q3 · GAP TO TARGET (New ARR = Net New + Expansion)"],
    ["Source: ARR_MoM_Rebuild — New ARR Added (col Q), summed over Q3 · target = fixed finance plan"],
    ["Days left in Q3", "=DATE(2026,10,1)-TODAY()"],
    ["Weeks left", `=${weeksLeft}`],
    ["Q3 New ARR target (from Targets plan)", `=${q3TargetF}`],
    ["Q3 New ARR booked (QTD)", `=${q3Qtd}`],
    ["Gap to target", `=(${q3TargetF})-${q3Qtd}`],
    ["ARR needed / week", `=((${q3TargetF})-${q3Qtd})/${weeksLeft}`],
    B,
    ["③ LAST WEEK vs PACE · Q3 QTD vs TARGET"],
    ["Source: ARR_WoW_Rebuild — Active ARR (col B) · ARR_MoM_Rebuild — New ARR (col Q)"],
    ["Latest weekly Active ARR", `=${wLast}`],
    ["WoW change", `=IFERROR(TEXT((${wLast}-${wPrev})/${wPrev},"+0.0%;-0.0%"),"—")`],
    ["Q3 % of target (QTD)", `=IFERROR(TEXT(${q3Qtd}/${Math.round(q3Target)},"0.0%"),"—")`],
    ["Quarter elapsed", `=IFERROR(TEXT(1-(DATE(2026,10,1)-TODAY())/(DATE(2026,10,1)-DATE(2026,7,2)),"0.0%"),"—")`],
    B,
    ["④ PIPELINE PULSE — Week over Week (last 8 weeks)"],
    ["Source: ARR_WoW_Rebuild — week start (col A), Active ARR (col B), New ARR added (col G)"],
    ["Week start", "Active ARR", "New ARR added"],
    ...[7, 6, 5, 4, 3, 2, 1, 0].map((k) => [
      `=IFERROR(TEXT(INDEX(${W}!$A$2:$A,COUNTA(${W}!$A$2:$A)-${k}),"yyyy-mm-dd"),"")`,
      `=IFERROR(INDEX(${W}!$B$2:$B,COUNTA(${W}!$A$2:$A)-${k}),"")`,
      `=IFERROR(INDEX(${W}!$G$2:$G,COUNTA(${W}!$A$2:$A)-${k}),"")`,
    ]),
    B,
    ["⑤ NEW ARR MIX — Net New vs Expansion (per month)"],
    ["Source: ARR_MoM_Rebuild — New Business Added (col N), Expansion Added (col O)"],
    ["Month", "Net New", "Expansion", "New ARR (NB+Exp)"],
    ...months.map((n) => [`${MON[n - 1]} 2026`, nbMo(n), expMo(n), newMo(n)]),
    B,
    ["⑥ TEAM ARR ATTAINMENT — Cumulative 2026 (New ARR vs plan)"],
    ["Source: ARR_MoM_Rebuild — New ARR Added (col Q), running total · target = fixed finance plan"],
    ["Month", "New ARR (mo)", "Cumulative New ARR", "Cumulative target (plan)", "% of plan"],
    ...months.map((n) => [`${MON[n - 1]} 2026`, newMo(n), cumNew(n), Math.round(cumTarget[n - 1]), pctPlan(n)]),
    B,
    ["⑦ CHURNED ARR — Monthly vs Cumulative"],
    ["Source: ARR_MoM_Rebuild — Churned ARR in month (col J), running total"],
    ["Month", "Churn (mo)", "Cumulative churn"],
    ...months.map((n) => [`${MON[n - 1]} 2026`, chnMo(n), cumChn(n)]),
    B,
    // Machine-readable key→value block. The dashboard reads THIS by key (col A → col B), so the
    // Headline tab is the single source powering the Command tab. Robust to layout: read by key,
    // not position. Values are numbers (percentages as fractions) so the app can format them.
    ["══ MACHINE-READABLE — powers the dashboard Command tab · DO NOT EDIT ══"],
    ["key", "value", "feeds"],
    ["live_arr", `=${A}!$W$1`, "Exec: Live ARR (as of today)"],
    ["gap_to_10m", `=10000000-${A}!$W$1`, "Exec: gap to $10M milestone"],
    ["new_arr_mo", `=${newArrMoF}`, "Exec: New ARR (current month)"],
    ["churn_mo", `=${churnMoF}`, "Exec: Churned (current month)"],
    ["up_for_renewal_mo", `=${renewalF}`, "Exec: up for renewal this month"],
    ["mom_pct", `=${momPctF}`, "Exec: MoM change (fraction)"],
    ["total_pipeline", `=${totalPipeF}`, "Exec: open pipeline (ARR)"],
    ["total_opps", `=${totalOppsF}`, "Exec: open opportunities (#)"],
    ["coverage", `=${coverageF}`, "Exec: coverage ratio (open ÷ Q3 quota)"],
    ["pipe_created_q3", `=${pipeCreatedQ3F}`, "Exec/Pipeline: created this quarter (ARR)"],
    ["pipe_quota", `=${pipeQuotaF}`, "Exec/Pipeline: Q3 pipe quota (all AEs)"],
    ["gen_pct", `=${genPctF}`, "Exec: pipe gen % of quota (fraction)"],
    ["pipe_created_week", `=${pipeCreatedWeekF}`, "Exec: new pipeline this week (ARR)"],
    ["pipe_wow_pct", `=${pipeWowF}`, "Exec: pipeline creation WoW (fraction)"],
    ["pipe_gap", `=MAX(0,(${pipeQuotaF})-(${pipeCreatedQ3F}))`, "Command: pipeline gap to quota"],
    ["pipe_needed_week", `=IFERROR(MAX(0,(${pipeQuotaF})-(${pipeCreatedQ3F}))/${weeksLeft},0)`, "Command: pipeline needed/week"],
    ["q3_target", `=${q3TargetF}`, "Gap: Q3 New ARR target (from Targets tab plan)"],
    ["q3_booked", `=${q3Qtd}`, "Gap: Q3 New ARR booked (QTD)"],
    ["gap_to_target", `=(${q3TargetF})-${q3Qtd}`, "Gap: Q3 gap to target"],
    ["days_left", "=DATE(2026,10,1)-TODAY()", "Gap: days left in Q3"],
    ["weeks_left", `=${weeksLeft}`, "Gap: weeks left"],
    ["arr_needed_week", `=((${q3TargetF})-${q3Qtd})/${weeksLeft}`, "Gap: ARR needed/week"],
    ["last_week_active", `=${wLast}`, "Pace: latest weekly Active ARR"],
    ["wow_pct", `=${wowPctF}`, "Pace: WoW change (fraction)"],
    ["q3_pct", `=${q3PctF}`, "Pace: Q3 % of target (fraction)"],
    ["qtr_elapsed_pct", `=${elapsedF}`, "Pace: quarter elapsed (fraction)"],
  ];

  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const existing = meta.data.sheets.find((s) => s.properties.title === "Headline");
  const reqs = [];
  if (existing) reqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: "Headline", index: 1, tabColor: NAVY, gridProperties: { rowCount: values.length + 10, columnCount: 6 } } } });
  const res = await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  const gid = res.data.replies.find((r) => r.addSheet).addSheet.properties.sheetId;
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: "'Headline'!A1", valueInputOption: "USER_ENTERED", requestBody: { values } });
  // ---- Formatting: navy title + section headers, gray italic source lines, gray bold table
  // headers, currency on the value cols, wider label column. % cells are TEXT() (self-format). ----
  const NAVYc = { red: 0.13, green: 0.19, blue: 0.32 }, WHITE = { red: 1, green: 1, blue: 1 };
  const GRAYbg = { red: 0.93, green: 0.94, blue: 0.96 }, GRAYtx = { red: 0.5, green: 0.5, blue: 0.5 };
  const rowFmt = (i, fmt) => ({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: fmt }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
  const fmtReqs = [
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 4, endRowIndex: values.length, startColumnIndex: 1, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } }, fields: "userEnteredFormat.numberFormat" } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 300 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: 1, endIndex: 5 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
  ];
  values.forEach((row, i) => {
    const a = String(row[0] || "");
    if (i === 0) fmtReqs.push(rowFmt(i, { backgroundColor: NAVYc, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 13 } }));
    else if (/^[①②③④⑤⑥⑦]/.test(a)) fmtReqs.push(rowFmt(i, { backgroundColor: NAVYc, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 } }));
    else if (a.startsWith("Source:")) fmtReqs.push(rowFmt(i, { textFormat: { foregroundColor: GRAYtx, italic: true, fontSize: 9 } }));
    else if (["Month", "Week start", "Week"].includes(a) && row[1]) fmtReqs.push(rowFmt(i, { backgroundColor: GRAYbg, textFormat: { bold: true } }));
  });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: fmtReqs } });

  console.log("Headline tab (formula-driven) built → https://docs.google.com/spreadsheets/d/" + ID + "/edit#gid=" + gid);
  console.log("All actuals are live formulas into ARR_MoM_Rebuild / ARR_WoW_Rebuild — auto-refreshes with the data source.");
}
main().catch((e) => { console.error(e); process.exit(1); });
