// Numbers regression gate (reliability Layer 3).
//
// Layer 1 (check-sheet.mjs) asks "does every tab still exist and look sane?".
// Layer 2 (weekly-finance-audit.mjs) asks "do the sheet's own numbers agree with
// each other?". This layer asks the question neither of those can:
//
//     "Is the number the dashboard SHOWS the number Salesforce actually SUPPORTS?"
//
// It answers that by recomputing each headline metric straight from Salesforce with
// its own SOQL — deliberately NOT reusing src/lib/parse.ts, the sheet formulas, or
// the refresh scripts' math. That independence is the whole point: if a bug lives in
// the shared path, a check built on the shared path inherits the bug and reports PASS.
//
// Three families of check:
//   A. SFDC cross-check   — headline value vs. an independent SOQL recompute.
//   B. Internal consistency — derived tiles vs. the algebra they claim (gap = target − booked).
//   C. Baseline drift      — every key vs. the last committed snapshot, so a code
//                            change that moves a number can't land unnoticed.
//
// Exit code 1 on any FAIL so a PR check / scheduled job goes red.
//
// Run:      node --env-file=.env scripts/verify-numbers.mjs
// Rebase:   node --env-file=.env scripts/verify-numbers.mjs --update-baseline
// CI:       .github/workflows/verify-numbers.yml (pull_request + daily)
//
// STALENESS: the Headline tab is formula-driven over source tabs that refresh once a
// day, so it trails live Salesforce by up to ~24h. SFDC cross-checks therefore carry a
// tolerance and report observed drift; a mismatch far outside tolerance is a real defect,
// not lag. The source pull timestamp is printed in the header so lag is always visible.
import { google } from "googleapis";

const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const BASELINE_PATH = new URL("../snapshots/headline-numbers.json", import.meta.url);
const ACK_PATH = new URL("../snapshots/acknowledged.json", import.meta.url);

// ── Resilience (same posture as refresh-sf-imports.mjs: a transient blip must not
// turn into a red build that everyone learns to ignore). ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isTransient(e) {
  const code = e?.code ?? e?.status ?? e?.response?.status;
  if ([408, 429, 500, 502, 503, 504].includes(Number(code))) return true;
  if (["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return true;
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  return /\b(408|429|500|502|503|504)\b|rate.?limit|quota exceeded|backend error|timeout|timed out|aborted|econnreset|socket hang|network|fetch failed|temporarily|try again/.test(msg);
}
async function retry(label, fn, tries = 5, baseMs = 1000) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries - 1 || !isTransient(e)) throw e;
      const wait = baseMs * 2 ** i + Math.floor(Math.random() * 300);
      console.warn(`  ↻ retry ${label} (${i + 1}/${tries - 1}) in ${wait}ms — ${e.message || e}`);
      await sleep(wait);
    }
  }
}

// ── Salesforce (client-credentials, read-only) ──
async function sfLogin() {
  const url = `${process.env.SF_LOGIN_URL}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });
  const j = await retry("sf login", async () => {
    const r = await fetch(url, { method: "POST", body, signal: AbortSignal.timeout(45000) });
    if (!r.ok) { const e = new Error(`sf login HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 140)}`); e.status = r.status; throw e; }
    return r.json();
  });
  return { token: j.access_token, instance: j.instance_url };
}
// Aggregate SOQL only — one row back, no pagination, no client-side math to get wrong.
async function soqlAgg(sf, soql) {
  // SF_API_VERSION is stored bare ("59.0"), matching the other refresh scripts.
  const v = String(process.env.SF_API_VERSION || "59.0").replace(/^v/, "");
  const url = `${sf.instance}/services/data/v${v}/query/?q=${encodeURIComponent(soql.replace(/\s+/g, " ").trim())}`;
  const j = await retry("soql", async () => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${sf.token}` }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) { const e = new Error(`soql HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`); e.status = r.status; throw e; }
    return r.json();
  });
  return j.records?.[0] ?? {};
}

// ── Sheet (read-only) ──
const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth: gAuth });

// Parse a source tab's machine-readable key→value block (col A = snake_case key, col B = number).
// Mirrors the dashboard's own parseKeyValue so we grade exactly what the tiles read.
const parseKeyValue = (rows) => {
  const out = {};
  for (const r of rows ?? []) {
    const k = String(r?.[0] ?? "").trim();
    if (/^[a-z][a-z0-9_]+$/.test(k) && typeof r?.[1] === "number") out[k] = r[1];
  }
  return out;
};

// ── Date helpers. The ARR convention (team-agreed 2026-08-15) buckets a month as
// (1st, 1st-of-next] — END-INCLUSIVE, so a deal live on the 1st belongs to the
// PREVIOUS month. Every flow query below is written to that convention on purpose:
// the gate's job is to verify the dashboard implements its stated rule, not to
// re-litigate the rule. See briefs/2026-08-15-arr-boundary-convention.md. ──
const iso = (d) => d.toISOString().slice(0, 10);
const firstOfMonth = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}-01`;

const findings = []; // {level, check, detail, fix}
const add = (level, check, detail, fix) => findings.push({ level, check, detail, fix });
const usd = (n) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

// Compare a headline value against an independent recompute.
// tolAbs/tolPct absorb source-tab lag; anything beyond is reported as a defect.
function cross(check, shown, actual, { tolAbs = 1, tolPct = 0.005, fmt = usd, fix } = {}) {
  if (shown == null) return add("WARN", check, `headline key missing from the Headline tab`, fix);
  if (actual == null) return add("WARN", check, `independent recompute returned nothing`, fix);
  const diff = shown - actual;
  const tol = Math.max(tolAbs, Math.abs(actual) * tolPct);
  const detail = `dashboard ${fmt(shown)} vs Salesforce ${fmt(actual)} (diff ${diff >= 0 ? "+" : ""}${fmt(diff)}${actual ? `, ${pct(diff / actual)}` : ""})`;
  if (Math.abs(diff) <= tol) add("PASS", check, detail);
  else add("FAIL", check, detail, fix);
}

// Compare a derived tile against the algebra it claims. No tolerance beyond float noise —
// these are pure arithmetic over numbers already on the same tab, so any gap is a bug.
function algebra(check, shown, expected, { fmt = usd, tolAbs = 1, fix } = {}) {
  if (shown == null || expected == null) return add("WARN", check, "one side missing", fix);
  const diff = shown - expected;
  const detail = `${fmt(shown)} vs expected ${fmt(expected)}${Math.abs(diff) > tolAbs ? ` (off by ${fmt(diff)})` : ""}`;
  if (Math.abs(diff) <= tolAbs) add("PASS", check, detail);
  else add("FAIL", check, detail, fix);
}

// "Aug 2026" — the label format ARR_MoM_Rebuild writes in col A.
const monthName = (y, m) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" })
  .format(new Date(Date.UTC(y, m, 15)));

async function main() {
  const now = new Date();

  // Which month is "this month"? It has to be the month the SPREADSHEET is in, because that is
  // the month the dashboard is showing: the Headline tab matches on EOMONTH(TODAY(),0) and
  // TODAY() resolves in the spreadsheet's timezone (Asia/Saigon, UTC+7). Checking UTC instead
  // meant that for seven hours at every month boundary the gate compared the sheet's September
  // against Salesforce's August and reported a $344k regression that did not exist. One clock,
  // and it is the sheet's. Falls back to UTC only if the lookup fails.
  let y = now.getUTCFullYear(), m = now.getUTCMonth(), clock = "UTC";
  try {
    const meta = await retry("sheets.get timeZone", () => sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID, fields: "properties.timeZone" }));
    const tz = meta.data.properties?.timeZone || "UTC";
    const [ys, ms] = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" })
      .format(now).split("-");
    y = Number(ys); m = Number(ms) - 1; clock = tz;
  } catch { /* keep UTC */ }

  const [sf, sheetRes] = await Promise.all([
    sfLogin(),
    retry("sheets batchGet", () => sheets.spreadsheets.values.batchGet({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      ranges: [
        "Headline!A1:E240",
        "Targets!A1:C120",
        "ARR_MoM_Rebuild!V1:W1",
        "ARR_MoM_Rebuild!A1:A400",            // month labels ("Aug 2026") — is the current one written yet?
        "'Open pipeline - SOQL pull'!A1:A1",   // banner carries the pull timestamp
      ],
      valueRenderOption: "UNFORMATTED_VALUE",
    })),
  ]);
  const [headRows, targetRows, w1Rows, momMonthRows, bannerRows] = sheetRes.data.valueRanges.map((v) => v.values || []);
  const H = parseKeyValue(headRows);
  const T = parseKeyValue(targetRows);
  const w1 = typeof w1Rows?.[0]?.[1] === "number" ? w1Rows[0][1] : null;
  const banner = String(bannerRows?.[0]?.[0] ?? "").replace(/\s+/g, " ").trim();

  // Does ARR_MoM_Rebuild carry a row for the month the SHEET thinks it is? The Headline formulas
  // MATCH on EOMONTH(TODAY(),0), and TODAY() resolves in the spreadsheet's own timezone, while the
  // row is appended by a refresh bounded on getUTCMonth(). Between sheet-local midnight and UTC
  // midnight — seven hours, once a month — no row matches and new_arr_mo / churn_mo are blank BY
  // DESIGN (blank, not 0: see the note in scripts/build-headline-tab.mjs). Without this the gate
  // reads that as a broken formula and fails the nightly build every month-start.
  const sheetMonthLabel = monthName(y, m);
  const curMonthRowExists = (momMonthRows ?? []).some((r) => String(r?.[0] ?? "").trim() === sheetMonthLabel);
  // Keys that are legitimately absent during that window, and only then.
  const BLANK_OK = curMonthRowExists ? new Set() : new Set(["new_arr_mo", "churn_mo"]);

  console.log(`\nNumbers regression gate — ${iso(now)}`);
  console.log(`Source pull: ${banner || "(no timestamp banner)"}`);
  console.log(`Headline keys: ${Object.keys(H).length} · Targets keys: ${Object.keys(T).length} · month basis: ${monthName(y, m)} (${clock})\n`);

  // ════════════════════════════════════════════════════════════════════════════
  // A. SFDC CROSS-CHECKS — independent SOQL recompute of each headline metric.
  // ════════════════════════════════════════════════════════════════════════════

  // A1. Live ARR (as of today) = contract live by today, not yet ended, not churned.
  //     Mirrors ARR_MoM_Rebuild!W1 but computed server-side by Salesforce.
  const liveAgg = await soqlAgg(sf, `
    SELECT COUNT(Id) cnt, SUM(convertCurrency(AnnualContractValueARR__c)) arr
    FROM Opportunity
    WHERE StageName IN ('Billing','Closed Won')
      AND ContractLiveDate__c <= TODAY
      AND (ContractEndDate__c > TODAY OR ContractEndDate__c = null)
      AND Status__c != 'Contracts Ended (Churned)'`);
  cross("Live ARR vs Salesforce", H.live_arr, liveAgg.arr, {
    tolPct: 0.005,
    fix: "ARR_MoM_Rebuild!W1 formula in scripts/refresh-arr-from-sfdc.mjs, or a stale daily pull.",
  });
  // W1 is what the dashboard falls back to; it must equal the Headline tile.
  algebra("Live ARR: Headline tile == ARR_MoM_Rebuild!W1", H.live_arr, w1, {
    fix: "Headline live_arr should be =ARR_MoM_Rebuild!$W$1 (scripts/build-headline-tab.mjs).",
  });

  // A2. Open opportunity COUNT — the cheapest possible proof the pipeline tab is fresh.
  const openAgg = await soqlAgg(sf, `
    SELECT COUNT(Id) cnt,
           SUM(convertCurrency(AnnualContractValueARR__c)) arrTrue,
           SUM(Annual_Contract_Value_ARR_Formula__c) arrFormulaField
    FROM Opportunity WHERE IsClosed = false`);
  cross("Open opportunity count", H.total_opps, openAgg.cnt, {
    tolAbs: 15, tolPct: 0.02, fmt: (n) => `${Math.round(n)}`,
    fix: "'Open pipeline - SOQL pull' is stale or partially written (scripts/refresh-sf-imports.mjs).",
  });

  // A3. Open pipeline ARR. NOTE: the Pipeline tab sums col D of the open-pipeline pull,
  //     which is Annual_Contract_Value_ARR_Formula__c — empirically identical to Amount
  //     (multi-year TCV), NOT the annual value in AnnualContractValueARR__c. Both are
  //     reported so the failure is self-explaining rather than just "number wrong".
  cross("Open pipeline ARR", H.total_pipeline, openAgg.arrTrue, {
    tolPct: 0.01,
    fix: "Pipeline!B5 sums col D (Annual_Contract_Value_ARR_Formula__c = TCV). For ARR it must sum col O (AnnualContractValueARR__c).",
  });
  if (H.total_pipeline != null && openAgg.arrFormulaField != null) {
    const nearTcv = Math.abs(H.total_pipeline - openAgg.arrFormulaField) <= Math.abs(openAgg.arrFormulaField) * 0.05;
    add("INFO", "Open pipeline basis",
      `TCV basis ${usd(openAgg.arrFormulaField)} · true-ARR basis ${usd(openAgg.arrTrue)} · tile shows ${usd(H.total_pipeline)}` +
      (nearTcv ? " → tile is on the TCV basis" : ""));
  }

  // A4. New ARR, current month = New Business + Expansion going live in (1st, 1st-of-next].
  const moLo = firstOfMonth(y, m);
  const moHi = m === 11 ? firstOfMonth(y + 1, 0) : firstOfMonth(y, m + 1);
  const newMoAgg = await soqlAgg(sf, `
    SELECT SUM(convertCurrency(AnnualContractValueARR__c)) arr
    FROM Opportunity
    WHERE StageName IN ('Billing','Closed Won')
      AND RecordType.Name IN ('1.New Business','3.Business Expansion')
      AND ContractLiveDate__c > ${moLo} AND ContractLiveDate__c <= ${moHi}`);
  cross(`New ARR this month (live in ${moLo} → ${moHi}]`, H.new_arr_mo, newMoAgg.arr, {
    tolPct: 0.01,
    fix: "ARR_MoM_Rebuild col Q (=N+O) in scripts/refresh-arr-from-sfdc.mjs.",
  });

  // A5. Q3 New ARR booked (QTD) = same flow, quarter-start through current month-end.
  //     Matches the Headline SUMIFS: col B (month-end) from Jul 1 to EOMONTH(TODAY()).
  const qLo = firstOfMonth(y, 6); // Jul 1 — Q3 FY26 per SALES_Q
  const q3Agg = await soqlAgg(sf, `
    SELECT SUM(convertCurrency(AnnualContractValueARR__c)) arr
    FROM Opportunity
    WHERE StageName IN ('Billing','Closed Won')
      AND RecordType.Name IN ('1.New Business','3.Business Expansion')
      AND ContractLiveDate__c > ${qLo} AND ContractLiveDate__c <= ${moHi}`);
  cross("Q3 New ARR booked (QTD)", H.q3_booked, q3Agg.arr, {
    tolPct: 0.01,
    fix: "Headline q3_booked SUMIFS over ARR_MoM_Rebuild col Q (scripts/build-headline-tab.mjs).",
  });

  // A6. Churn this month = contracts whose END date lands in (prev month-end, month-end]
  //     and whose Status is the org's own churn marker.
  const prevEnd = iso(new Date(Date.UTC(y, m, 0)));      // last day of previous month
  const thisEnd = iso(new Date(Date.UTC(y, m + 1, 0)));  // last day of this month
  const churnAgg = await soqlAgg(sf, `
    SELECT SUM(convertCurrency(AnnualContractValueARR__c)) arr
    FROM Opportunity
    WHERE StageName IN ('Billing','Closed Won')
      AND Status__c = 'Contracts Ended (Churned)'
      AND ContractEndDate__c > ${prevEnd} AND ContractEndDate__c <= ${thisEnd}`);
  cross(`Churned ARR this month (ends in ${prevEnd} → ${thisEnd}]`, H.churn_mo, churnAgg.arr ?? 0, {
    tolAbs: 100, tolPct: 0.01,
    fix: "ARR_MoM_Rebuild col J in scripts/refresh-arr-from-sfdc.mjs.",
  });

  // ════════════════════════════════════════════════════════════════════════════
  // B. INTERNAL CONSISTENCY — derived tiles must equal their own arithmetic.
  //    These need no Salesforce call and catch the "two tiles disagree" class of bug
  //    that made the 2026-08-14 audit necessary.
  // ════════════════════════════════════════════════════════════════════════════
  algebra("gap_to_10m == $10M − live_arr", H.gap_to_10m, H.live_arr == null ? null : 10_000_000 - H.live_arr);
  algebra("gap_to_target == q3_target − q3_booked", H.gap_to_target,
    H.q3_target == null || H.q3_booked == null ? null : H.q3_target - H.q3_booked);
  algebra("pipe_gap == max(0, pipe_quota − pipe_created_q3)", H.pipe_gap,
    H.pipe_quota == null || H.pipe_created_q3 == null ? null : Math.max(0, H.pipe_quota - H.pipe_created_q3));
  algebra("q3_pct == q3_booked ÷ q3_target", H.q3_pct,
    H.q3_booked == null || !H.q3_target ? null : H.q3_booked / H.q3_target, { fmt: pct, tolAbs: 0.0005 });
  algebra("coverage == total_pipeline ÷ pipe_quota", H.coverage,
    H.total_pipeline == null || !H.pipe_quota ? null : H.total_pipeline / H.pipe_quota,
    { fmt: (n) => `${n.toFixed(2)}×`, tolAbs: 0.01 });
  algebra("gen_pct == pipe_created_q3 ÷ pipe_quota", H.gen_pct,
    H.pipe_created_q3 == null || !H.pipe_quota ? null : H.pipe_created_q3 / H.pipe_quota,
    { fmt: pct, tolAbs: 0.0005 });
  algebra("arr_needed_week == gap_to_target ÷ weeks_left", H.arr_needed_week,
    H.gap_to_target == null || !H.weeks_left ? null : H.gap_to_target / H.weeks_left);
  // Cross-tab: the plan target must be one number, not two. This is the exact collision
  // class the finance audit flagged (Live ARR ×2, Booked ×5).
  algebra("q3_target agrees across Headline and Targets tabs", H.q3_target, T.q3_target, {
    fix: "Both must read the same Targets-tab plan cell (scripts/build-targets-tab.mjs).",
  });

  // C. Sanity envelopes — a currency/units blow-up shows up here even if the algebra ties.
  if (H.live_arr != null) {
    if (H.live_arr < 3_000_000 || H.live_arr > 12_000_000)
      add("FAIL", "Live ARR sanity envelope", `${usd(H.live_arr)} outside $3M–$12M (currency or units bug?)`);
    else add("PASS", "Live ARR sanity envelope", `${usd(H.live_arr)} within $3M–$12M`);
  }
  if (H.mom_pct != null) {
    if (Math.abs(H.mom_pct) > 0.25)
      add("FAIL", "MoM change sanity envelope", `${pct(H.mom_pct)} exceeds ±25% — likely a broken month boundary`);
    else add("PASS", "MoM change sanity envelope", `${pct(H.mom_pct)} within ±25%`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // D. BASELINE DRIFT — every key vs. the last committed snapshot.
  //    This is the half that catches "my code change moved a number": metrics with no
  //    SOQL equivalent still can't shift silently. Real movement is expected daily, so
  //    drift is WARN (visible in the log / PR annotation), never a build failure —
  //    only a NEW or VANISHED key is a FAIL, because that breaks a tile outright.
  // ════════════════════════════════════════════════════════════════════════════
  const snapshot = { capturedAt: new Date().toISOString(), sourcePull: banner, headline: H, targets: T };
  const fs = await import("node:fs/promises");
  if (UPDATE_BASELINE) {
    await fs.writeFile(BASELINE_PATH, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`baseline rewritten → snapshots/headline-numbers.json (${Object.keys(H).length + Object.keys(T).length} keys)\n`);
  } else {
    let base = null;
    try { base = JSON.parse(await fs.readFile(BASELINE_PATH, "utf-8")); } catch { /* first run */ }
    if (!base) {
      add("WARN", "Baseline drift", "no baseline committed yet — run with --update-baseline to seed it");
    } else {
      const DRIFT_PCT = 0.10; // flag a >10% move in any single metric for a human to eyeball
      for (const [group, cur] of [["headline", H], ["targets", T]]) {
        const prev = base[group] ?? {};
        const goneAll = Object.keys(prev).filter((k) => !(k in cur));
        const expectedBlank = goneAll.filter((k) => BLANK_OK.has(k));
        const gone = goneAll.filter((k) => !BLANK_OK.has(k));
        if (expectedBlank.length) add("INFO", `Baseline: ${group} keys blank at the month boundary`,
          `${expectedBlank.join(", ")} — ARR_MoM_Rebuild has no "${sheetMonthLabel}" row yet, so these read blank rather than a false $0. Clears on the first refresh after 00:00 UTC.`);
        const fresh = Object.keys(cur).filter((k) => !(k in prev));
        if (gone.length) add("FAIL", `Baseline: ${group} keys vanished`, gone.join(", "),
          "A tile reading a removed key renders blank — restore it or update the dashboard.");
        if (fresh.length) add("INFO", `Baseline: new ${group} keys`, fresh.join(", "));
        const moved = [];
        for (const [k, v] of Object.entries(cur)) {
          const p = prev[k];
          if (typeof p !== "number" || p === 0) continue;
          const d = (v - p) / Math.abs(p);
          if (Math.abs(d) > DRIFT_PCT) moved.push(`${k} ${pct(d)} (${p.toLocaleString()} → ${v.toLocaleString()})`);
        }
        if (moved.length) add("WARN", `Baseline: ${group} moved >${pct(DRIFT_PCT)}`, moved.join(" · "),
          "Expected if the book really moved. If not, this is the regression — compare against the PR diff.");
        else add("PASS", `Baseline: ${group} within ±${pct(DRIFT_PCT)}`, `${Object.keys(cur).length} keys checked (vs ${base.capturedAt?.slice(0, 10)})`);
      }
    }
  }

  // ── Acknowledged findings ──────────────────────────────────────────────────
  // A gate that is permanently red is a gate everyone learns to ignore, and then it
  // stops catching the NEXT regression. snapshots/acknowledged.json lets a known-open
  // issue be downgraded FAIL → ACK (with a written reason and an owner) so the build
  // goes green on "no NEW problems" while the known one stays printed in every run.
  // Acknowledging is a deliberate, reviewable act: it shows up in the PR diff.
  // An entry past its `until` date stops suppressing and the gate goes red again.
  let acks = {};
  try { acks = JSON.parse(await (await import("node:fs/promises")).readFile(ACK_PATH, "utf-8")).acknowledged ?? {}; }
  catch { /* no ack file — nothing suppressed */ }
  const todayISO = iso(now);
  for (const f of findings) {
    if (f.level !== "FAIL") continue;
    const a = acks[f.check];
    if (!a) continue;
    if (a.until && a.until < todayISO) {
      f.expiredAck = `acknowledgement expired ${a.until} — ${a.reason ?? "no reason given"}`;
      continue; // stays a FAIL
    }
    f.level = "ACK";
    f.ack = `${a.reason ?? "acknowledged"}${a.owner ? ` (owner: ${a.owner})` : ""}${a.until ? ` · expires ${a.until}` : ""}`;
  }

  // ── Report ──
  const order = { FAIL: 0, ACK: 1, WARN: 2, INFO: 3, PASS: 4 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  const n = (l) => findings.filter((f) => f.level === l).length;
  console.log(`${n("FAIL")} FAIL · ${n("ACK")} known · ${n("WARN")} WARN · ${n("PASS")} OK · ${n("INFO")} INFO\n`);
  for (const f of findings) {
    console.log(`${{ FAIL: "❌", ACK: "🔶", WARN: "⚠️ ", INFO: "ℹ️ ", PASS: "✅" }[f.level]} ${f.check}`);
    console.log(`   ${f.detail}`);
    if (f.ack) console.log(`   KNOWN: ${f.ack}`);
    if (f.expiredAck) console.log(`   ${f.expiredAck}`);
    if (f.fix && f.level !== "PASS" && f.level !== "INFO") console.log(`   FIX: ${f.fix}`);
  }
  console.log("");
  if (n("FAIL")) {
    console.log(`Gate FAILED — ${n("FAIL")} check(s) show a number the dashboard cannot support.`);
    process.exitCode = 1;
  } else if (n("ACK")) {
    console.log(`Gate passed with ${n("ACK")} acknowledged issue(s) — no NEW regressions. See snapshots/acknowledged.json.`);
  } else {
    console.log("Gate passed.");
  }
}

main().catch((e) => { console.error("verify-numbers crashed:", e); process.exitCode = 1; });
