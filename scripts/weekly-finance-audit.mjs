// Weekly Finance Audit (reliability Layer 2): reconciliation, not structure.
//
// check-sheet.mjs (Layer 1) confirms every tab still EXISTS with a sane header and
// value range. This script goes deeper: it reads the live sheet and checks that the
// dashboard's own numbers TIE OUT to each other — the discrepancies a head of finance
// would catch. Each check is a named tie-out with an expected relationship; a break
// prints the two numbers, the gap, and where in the code to fix it.
//
// Run:  node --env-file=.env scripts/weekly-finance-audit.mjs
// Exit: 0 if only PASS/INFO, 1 if any FAIL (so a scheduled job can go red).
//
// This is intentionally read-only and self-contained (no repo imports) so the weekly
// cloud agent can run it headless.
import { google } from "googleapis";

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const api = google.sheets({ version: "v4", auth });
const ID = process.env.GOOGLE_SHEET_ID;

const get = (range) =>
  api.spreadsheets.values
    .get({ spreadsheetId: ID, range, valueRenderOption: "UNFORMATTED_VALUE" })
    .then((r) => r.data.values || [])
    .catch(() => null);

const usd = (n) => "$" + Math.round(Number(n)).toLocaleString();
const pct = (n) => (n * 100).toFixed(1) + "%";
const num = (v) => (typeof v === "number" ? v : Number(v) || 0);
// Google Sheets serial (epoch 1899-12-30) -> ISO date.
const ser = (n) => (typeof n === "number" ? new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10) : String(n));

const findings = []; // {level: FAIL|WARN|INFO, check, detail, fix}
const add = (level, check, detail, fix) => findings.push({ level, check, detail, fix });

async function main() {
  // ---- Load the tabs the checks need ----
  const mom = await get("'ARR_MoM_Rebuild'!A1:W80");
  const wow = await get("'ARR_WoW_Rebuild'!A1:J30");
  const ae = await get("'AE Attainment (Official)'!A1:H12");
  const soqlBanner = await get("'SOQL_Pull'!A1:A1");

  // Latest populated monthly row (has numeric Active ARR in col C).
  const momRows = (mom || []).slice(1).filter((r) => typeof r[2] === "number" && r[2] > 0);
  const curMonth = momRows[momRows.length - 1] || [];
  const prevMonth = momRows[momRows.length - 2] || [];
  // W1 headline lives in the header row, last cell (label in V1, value in W1).
  const w1Live = num(mom?.[0]?.[22]);
  // Latest weekly Active ARR.
  const wowRows = (wow || []).slice(1).filter((r) => r[0]);
  const wowLatest = wowRows[wowRows.length - 1] || [];
  const wowActive = num(wowLatest[1]);

  // ================================================================
  // CHECK 1 — "Current Live ARR" must reconcile across the 3 places it appears.
  //   Headline W1 (as-of-today) vs monthly current-month Rule A vs latest weekly.
  // ================================================================
  const monthActive = num(curMonth[2]);
  const monthLabel = curMonth[0];
  const trio = [
    ["Headline W1 (as-of-today)", w1Live],
    [`Monthly Rule A (${monthLabel}, month-end basis)`, monthActive],
    ["Latest weekly Active ARR", wowActive],
  ].filter((x) => x[1] > 0);
  const vals = trio.map((x) => x[1]);
  const spread = Math.max(...vals) - Math.min(...vals);
  const spreadPct = spread / Math.max(...vals);
  const detail1 = trio.map((x) => `${x[0]} = ${usd(x[1])}`).join("  |  ");
  if (spreadPct > 0.01) {
    add(
      "FAIL",
      "Live ARR reconciliation (3-way)",
      `${detail1}  →  spread ${usd(spread)} (${pct(spreadPct)}). These all claim "current active ARR" but disagree.`,
      "The monthly current-month row uses a month-END boundary ($B+1 = 1st of next month), so an in-progress month projects roll-off that hasn't happened yet. Clamp the current-month boundary to as-of-today — the same fix already applied to ARR_Funnel (commit 613301b). See scripts/refresh-arr-from-sfdc.mjs activeAt() (~L256) and the W1 formula (~L546)."
    );
  } else {
    add("PASS", "Live ARR reconciliation (3-way)", detail1);
  }

  // ================================================================
  // CHECK 2 — Booked ARR must be >= Live ARR (booked = live + not-yet-live backlog).
  // ================================================================
  const bookedCur = num(curMonth[20]); // col U
  if (bookedCur > 0 && w1Live > 0) {
    if (bookedCur < w1Live) {
      add(
        "FAIL",
        "Booked >= Live invariant",
        `Booked (${monthLabel}) = ${usd(bookedCur)} is BELOW the Live headline ${usd(w1Live)} by ${usd(w1Live - bookedCur)}. Booked should always be >= Live (it includes signed-but-not-yet-live deals).`,
        "Two different bases: Booked (col U) gates on Signed Date + month-end boundary; the W1 headline gates on Contract-Live <= today. Put them on the same as-of date (fixes together with Check 1)."
      );
    } else {
      add("PASS", "Booked >= Live invariant", `Booked ${usd(bookedCur)} >= Live ${usd(w1Live)} (backlog ${usd(bookedCur - w1Live)}).`);
    }
  }

  // ================================================================
  // CHECK 3 — New ARR (col Q) must equal New Business (N) + Expansion (O).
  // ================================================================
  const n = num(curMonth[13]), o = num(curMonth[14]), q = num(curMonth[16]);
  if (Math.abs(q - (n + o)) > 1) {
    add("FAIL", "New ARR = NB + Expansion", `${monthLabel}: New ARR col Q = ${usd(q)} but NB(${usd(n)}) + Exp(${usd(o)}) = ${usd(n + o)}.`, "scripts/refresh-arr-from-sfdc.mjs col Q formula (=N+O).");
  } else {
    add("PASS", "New ARR = NB + Expansion", `${monthLabel}: ${usd(q)} = NB ${usd(n)} + Exp ${usd(o)}.`);
  }

  // ================================================================
  // CHECK 4 — AE attainment quota integrity: no rep may carry actuals with no quota
  //   (inflates team % of quota; also blanks their own %, mislabeling top producers).
  // ================================================================
  const aeHdr = (ae || []).findIndex((r) => r[0] === "AE");
  if (aeHdr >= 0) {
    const reps = [];
    for (let i = aeHdr + 1; i < (ae || []).length; i++) {
      const r = ae[i];
      if (!r[0] || typeof r[0] !== "string") break;
      reps.push({ name: r[0], quota: num(r[1]), actual: num(r[3]) });
    }
    const teamQuota = reps.reduce((s, r) => s + r.quota, 0);
    const teamActual = reps.reduce((s, r) => s + r.actual, 0);
    const orphans = reps.filter((r) => r.actual > 0 && r.quota <= 0);
    const teamPct = teamQuota ? teamActual / teamQuota : 0;
    if (orphans.length) {
      const names = orphans.map((r) => `${r.name} (${usd(r.actual)} actual, no quota)`).join("; ");
      add(
        "FAIL",
        "AE attainment quota integrity",
        `Reps with actuals but NO quota: ${names}. Team % of quota (${pct(teamPct)}) counts their ${usd(orphans.reduce((s, r) => s + r.actual, 0))} in the numerator but nothing in the denominator, so attainment is overstated — and each shows a blank own %, so they can be mislabeled "Lowest AE" despite producing.`,
        "Assign a quota (or exclude from both numerator and denominator) in the AE Attainment (Official) sheet. Roster/quotas: src/lib/planConfig.ts AE_ROSTER; build: scripts/build-ae-attainment-official.mjs. Team rollup: src/app/page.tsx:546-547."
      );
    } else {
      add("PASS", "AE attainment quota integrity", `Team ${usd(teamActual)} / ${usd(teamQuota)} = ${pct(teamPct)}; every rep with actuals has a quota.`);
    }
  }

  // ================================================================
  // CHECK 5 — Freshness: the SOQL pull that feeds ARR should be recent.
  // ================================================================
  const banner = String(soqlBanner?.[0]?.[0] ?? "");
  const m = banner.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const ageDays = (Date.now() - Date.parse(m[1])) / 86400000;
    if (ageDays > 2) add("WARN", "Source freshness", `SOQL_Pull last stamped ${m[1]} (${Math.floor(ageDays)}d ago).`, "Re-run scripts/refresh-arr-from-sfdc.mjs.");
    else add("PASS", "Source freshness", `SOQL_Pull stamped ${m[1]}.`);
  } else {
    add("INFO", "Source freshness", "No date stamp found in SOQL_Pull banner.");
  }

  // ---- Report ----
  const order = { FAIL: 0, WARN: 1, INFO: 2, PASS: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  const fails = findings.filter((f) => f.level === "FAIL").length;
  const warns = findings.filter((f) => f.level === "WARN").length;

  console.log(`\n=== WEEKLY FINANCE AUDIT — ${new Date().toISOString().slice(0, 10)} ===`);
  console.log(`${fails} FAIL · ${warns} WARN · ${findings.length - fails - warns} OK\n`);
  for (const f of findings) {
    const icon = { FAIL: "❌", WARN: "⚠️ ", INFO: "ℹ️ ", PASS: "✅" }[f.level];
    console.log(`${icon} [${f.check}]`);
    console.log(`   ${f.detail}`);
    if (f.fix && (f.level === "FAIL" || f.level === "WARN")) console.log(`   FIX: ${f.fix}`);
    console.log();
  }
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("weekly-finance-audit error:", e.message);
  process.exit(1);
});
