// "Funnel Conversion" source tab — New Business SQL→Closed Won conversion, by cohort.
//
// Built to the Sales Ops handover brief (Momos_Funnel_Dashboard_Handover_v3, Stephen, 2026-09-03).
// The brief targets "the Claude artifact" and says to recompute rates client-side from a JSON
// pack; this repo's dashboard is the Next.js app and AGENTS.md forbids metric math in src/, so
// the numbers are computed HERE and every slice is written out precomputed. That satisfies the
// brief's real constraint better than client-side code could: because region/segment/period
// totals are each computed from their own deal pool, the dashboard only ever LOOKS UP a row —
// it is structurally incapable of averaging a rate, which is the failure mode §3 warns about.
//
// THE RULE THAT MATTERS (§3): a conversion rate counts only DECIDED deals.
//   rate(X→Y) = n_Y / (n_Y + lost between X and Y).  Open deals are never in a denominator.
//
// Population (§1, §2): RecordType "1.New Business" only. Entry ("became SQL") =
// Date_Reached_SQL__c, else the earliest of SAL/SQO/Trial/CreatedDate. Cohort = the SALES-CYCLE
// quarter of the entry date — Q1 = 2 Jan–1 Apr, Q2 = 2 Apr–1 Jul, Q3 = 2 Jul–1 Oct,
// Q4 = 2 Oct–1 Jan, FY labelled by the calendar year the quarter STARTS in. This is the sales
// calendar, not the finance calendar, and not the (1st, 1st-of-next] ARR convention either.
//
// Exclusions (§2), each counted and published in the META block so they stay visible:
//   a) Account.Merchant_Segment__c blank or "To be Classified"   (21)
//   b) Account.Name = "Test"                                      (1)
//   c) quick SQL losses — Closed Lost, Previous_stage__c = "SQL", closed within 30 days  (17)
// Note (a) uses the ACCOUNT segment field with values SMB / Mid-Market / Enterprise / Mega
// Enterprise — NOT Opportunity.Merchant_Segment__c, which is a different field with different
// values (Small / Medium / …) used by the Sales Cycle tab.
//
// Verified against §7 on 2026-09-03: all six cohorts, the all-six roll-up and the matured
// benchmark reproduce to the deal and to the percentage point; Billing→CW 98%, $ SQL→CW 18%
// (matured 21%), Closed Won ARR $2,057,760, median SQL→CW 56 days, exclusions 21/17/1.
//
// Run: node --env-file=.env scripts/build-funnel-conversion-tab.mjs
import { google } from "googleapis";

const TAB = "Funnel Conversion";
const ASOF = new Date().toISOString().slice(0, 10);
const QUICK_LOSS_DAYS = 30;   // §2 setting
const MATURITY_MONTHS = 6;    // §3 setting
const BENCH = ["2025-04-02", "2026-04-01"];  // §3 benchmark window

const ST = ["SQL", "SAL", "SQO", "Trial", "Billing", "CW"];
const PAIRS = ST.slice(0, -1).map((x, i) => [x, ST[i + 1]]);
const REGIONS = ["Total", "North America", "International"];
const SEGMENTS = ["Total", "SMB", "Mid-Market", "Enterprise", "Mega Enterprise"];

const d = (s) => (s ? String(s).slice(0, 10) : null);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };

// Sales-cycle quarters. Q4 of a year ends on 1 Jan of the NEXT year.
function quarters(fromY, toY) {
  const out = [];
  const spans = [["01-02", "04-01", 0], ["04-02", "07-01", 0], ["07-02", "10-01", 0], ["10-02", "01-01", 1]];
  for (let y = fromY; y <= toY; y++) spans.forEach(([a, b, roll], i) =>
    out.push({ grain: "Quarter", label: `Q${i + 1} FY${String(y).slice(2)}`, from: `${y}-${a}`, to: `${y + roll}-${b}` }));
  return out;
}

async function main() {
  // ── pull (§5, verbatim) ───────────────────────────────────────────────────
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const t = await (await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();
  const v = process.env.SF_API_VERSION || "59.0";
  const q = `SELECT Id, Name, Account.Name, Account.Merchant_Segment__c, StageName, Previous_stage__c, Region__c,
    DealCountry__c, CurrencyIsoCode, convertCurrency(Amount), convertCurrency(AnnualContractValueARR__c), CreatedDate,
    Date_Reached_SQL__c, Date_Reached_SAL__c, Date_Reached_SQO__c, Date_Reached_Trial__c, Date_Reached_Billing__c,
    ContractLiveDate__c, Date_Reached_Closed_Won__c, Date_Reached_Closed_Lost__c, ClosedLostDate__c,
    ClosedLostReasons__c, LeadSource, Owner.Name, Locations_in_Contract__c
    FROM Opportunity WHERE RecordType.Name = '1.New Business'
      AND (Date_Reached_SQL__c >= 2025-04-01 OR Date_Reached_SAL__c >= 2025-04-01 OR Date_Reached_SQO__c >= 2025-04-01
        OR Date_Reached_Trial__c >= 2025-04-01 OR Date_Reached_Billing__c >= 2025-04-01
        OR ContractLiveDate__c >= 2025-04-01 OR Date_Reached_Closed_Lost__c >= 2025-04-01)`.replace(/\s+/g, " ");
  let url = `${t.instance_url}/services/data/v${v}/query?q=${encodeURIComponent(q)}`;
  const raw = [];
  while (url) { const j = await (await fetch(url, { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    if (!j.records) throw new Error("SOQL: " + JSON.stringify(j).slice(0, 300));
    raw.push(...j.records); url = j.done ? null : t.instance_url + j.nextRecordsUrl; }

  // ── cohort calendar: the 6 rolling quarters ending with the one we are in ──
  const allQ = quarters(2024, 2027);
  const curQ = allQ.find((x) => ASOF >= x.from && ASOF <= x.to);
  const curIx = allQ.indexOf(curQ);
  const QS = allQ.slice(curIx - 5, curIx + 1);
  const WIN_FROM = QS[0].from, WIN_TO = QS[QS.length - 1].to;
  // Monthly grain over the same span; §2 says the first month starts 2 Apr 2025.
  const MS = [];
  // Stop at the last month that STARTS inside the window. Testing against the month of WIN_TO
  // adds a month running 2 Oct–1 Nov when the window ends 1 Oct — 15 empty slices, and 25
  // periods where the brief specifies 24.
  for (let ym = WIN_FROM.slice(0, 7); `${ym}-02` <= WIN_TO; ym = addMonths(ym, 1)) {
    const nx = addMonths(ym, 1);
    MS.push({ grain: "Month", label: ym, from: `${ym}-02`, to: `${nx}-01` });
  }
  const PERIODS = [...QS, ...MS];

  // ── §2 population + §3 per-deal flags ─────────────────────────────────────
  const ex = { unclassified: 0, test: 0, quickloss: 0, outside: 0, noentry: 0 };
  const entryOf = (r) => {
    if (r.Date_Reached_SQL__c) return d(r.Date_Reached_SQL__c);
    const c = [r.Date_Reached_SAL__c, r.Date_Reached_SQO__c, r.Date_Reached_Trial__c, r.CreatedDate].filter(Boolean).map(d).sort();
    return c[0] ?? null;
  };
  const lostDateOf = (r) => d(r.Date_Reached_Closed_Lost__c) ?? d(r.ClosedLostDate__c);
  const deals = [];
  for (const r of raw) {
    const entry = entryOf(r);
    if (!entry) { ex.noentry++; continue; }
    if (entry < WIN_FROM || entry > WIN_TO) { ex.outside++; continue; }
    const seg = String(r.Account?.Merchant_Segment__c ?? "").trim();
    if (!seg || seg === "To be Classified") { ex.unclassified++; continue; }
    if (String(r.Account?.Name ?? "").trim() === "Test") { ex.test++; continue; }
    const ld = lostDateOf(r);
    if (r.StageName === "Closed Lost" && String(r.Previous_stage__c ?? "") === "SQL" && ld && days(entry, ld) <= QUICK_LOSS_DAYS) { ex.quickloss++; continue; }

    const st = r.StageName;
    const R = {};
    R.CW = st === "Closed Won";
    R.Billing = !!r.Date_Reached_Billing__c || st === "Billing" || R.CW;
    R.Trial = !!r.Date_Reached_Trial__c || st === "Trial" || R.Billing;
    R.SQO = !!r.Date_Reached_SQO__c || ["SQO", "Negotiation", "Proposal", "Pending Signature"].includes(st) || R.Trial;
    R.SAL = !!r.Date_Reached_SAL__c || st === "SAL" || R.SQO;
    R.SQL = true;
    const Lost = st === "Closed Lost";
    // "Lost from" = the furthest stage the deal actually reached before dying.
    const lostFrom = Lost ? [...ST].reverse().find((s) => s !== "CW" && R[s]) ?? "SQL" : "";
    deals.push({
      id: r.Id, name: r.Name ?? "", acct: r.Account?.Name ?? "", owner: r.Owner?.Name ?? "",
      entry, q: QS.find((x) => entry >= x.from && entry <= x.to)?.label ?? "",
      m: MS.find((x) => entry >= x.from && entry <= x.to)?.label ?? "",
      region: String(r.Region__c ?? "") === "North America" ? "North America" : "International",
      seg, stage: st, prev: r.Previous_stage__c ?? "", R, Lost, Won: R.CW, Open: !R.CW && !Lost,
      usd: Number(r.AnnualContractValueARR__c ?? 0) || Number(r.Amount ?? 0) || 0,
      lostFrom, reasons: r.ClosedLostReasons__c ?? "", locs: r.Locations_in_Contract__c ?? "",
      source: r.LeadSource ?? "",
      cwDate: d(r.ContractLiveDate__c) ?? d(r.Date_Reached_Closed_Won__c), lostDate: ld,
      dSAL: d(r.Date_Reached_SAL__c), dSQO: d(r.Date_Reached_SQO__c),
      dTrial: d(r.Date_Reached_Trial__c), dBilling: d(r.Date_Reached_Billing__c),
    });
  }

  // ── §3 slice metrics. Every slice computed from ITS OWN deals — never rolled up from rates ──
  const metrics = (pool) => {
    const o = { n: {}, usd: {} };
    for (const s of ST) { const hit = pool.filter((x) => x.R[s]); o.n[s] = hit.length; o.usd[s] = hit.reduce((a, b) => a + b.usd, 0); }
    o.nLost = pool.filter((x) => x.Lost).length;
    o.nOpen = pool.filter((x) => x.Open).length;
    o.usdLost = pool.filter((x) => x.Lost).reduce((a, b) => a + b.usd, 0);
    o.usdOpen = pool.filter((x) => x.Open).reduce((a, b) => a + b.usd, 0);
    o.nL = {}; o.usdL = {}; o.rate = {}; o.rateUsd = {};
    for (const [X, Y] of PAIRS) {
      const lost = pool.filter((x) => x.R[X] && !x.R[Y] && x.Lost);
      o.nL[`${X}_${Y}`] = lost.length;
      o.usdL[`${X}_${Y}`] = lost.reduce((a, b) => a + b.usd, 0);
      const den = o.n[Y] + lost.length;
      o.rate[`${X}_${Y}`] = den ? o.n[Y] / den : "";
      const uden = o.usd[Y] + o.usdL[`${X}_${Y}`];
      o.rateUsd[`${X}_${Y}`] = uden ? o.usd[Y] / uden : "";
    }
    o.cum = {}; o.cumUsd = {};
    for (const Y of ["SQO", "Trial", "CW"]) {
      const lostBefore = pool.filter((x) => !x.R[Y] && x.Lost);
      const den = o.n[Y] + lostBefore.length;
      o.cum[Y] = den ? o.n[Y] / den : "";
      const uden = o.usd[Y] + lostBefore.reduce((a, b) => a + b.usd, 0);
      o.cumUsd[Y] = uden ? o.usd[Y] / uden : "";
    }
    const cyc = pool.filter((x) => x.Won && x.cwDate).map((x) => days(x.entry, x.cwDate)).filter((x) => x >= 0).sort((a, b) => a - b);
    o.medCycle = cyc.length ? cyc[Math.floor(cyc.length / 2)] : "";
    return o;
  };
  const sel = (pool, region, seg) => pool.filter((x) => (region === "Total" || x.region === region) && (seg === "Total" || x.seg === seg));

  const rows = [];
  rows.push([`Funnel Conversion — New Business SQL → Closed Won, by cohort`]);
  rows.push([`Auto-written by scripts/build-funnel-conversion-tab.mjs from Salesforce, to the Sales Ops handover brief v3 (§1-§3). RESOLVED RATES: rate(X→Y) = reached Y ÷ (reached Y + lost between X and Y). Open deals are NEVER in a denominator — they are reported separately. Every region × segment × period slice is computed from its own deals, so no rate is ever an average of other rates. Cohort = sales-cycle quarter of the entry date (Q1 = 2 Jan–1 Apr, Q2 = 2 Apr–1 Jul, Q3 = 2 Jul–1 Oct, Q4 = 2 Oct–1 Jan).`]);
  rows.push([`Last updated`, new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC", `as of ${ASOF}`, `window ${WIN_FROM} → ${WIN_TO}`]);
  rows.push([]);

  // ① META
  rows.push(["① META — settings and live exclusion counts"]);
  rows.push(["key", "value"]);
  const meta = [
    ["as_of", ASOF], ["window_from", WIN_FROM], ["window_to", WIN_TO],
    ["quick_loss_days", QUICK_LOSS_DAYS], ["maturity_months", MATURITY_MONTHS],
    ["benchmark_from", BENCH[0]], ["benchmark_to", BENCH[1]],
    ["deals_included", deals.length],
    ["excl_unclassified", ex.unclassified], ["excl_test", ex.test], ["excl_quick_sql_loss", ex.quickloss],
    ["excl_outside_window", ex.outside], ["excl_no_entry_date", ex.noentry],
    ["cohorts", QS.map((x) => x.label).join(" · ")],
  ];
  meta.forEach((r) => rows.push(r));
  rows.push([]);

  // ② COHORT_LONG
  const CH = ["grain", "period", "period_from", "period_to", "region", "segment", "months_matured", "status", "matured_benchmark",
    ...ST.map((s) => `n_${s}`), "n_Lost", "n_Open",
    ...ST.map((s) => `usd_${s}`), "usd_Lost", "usd_Open",
    ...PAIRS.map(([x, y]) => `nL_${x}_${y}`), ...PAIRS.map(([x, y]) => `usdL_${x}_${y}`),
    ...PAIRS.map(([x, y]) => `rate_${x}_${y}`), ...PAIRS.map(([x, y]) => `rate_usd_${x}_${y}`),
    "cum_SQL_SQO", "cum_SQL_Trial", "cum_SQL_CW",
    "cum_usd_SQL_SQO", "cum_usd_SQL_Trial", "cum_usd_SQL_CW", "median_cycle_days"];
  rows.push([`② COHORT_LONG — one row per grain × period × region × segment. Rates are decided-deals only.`]);
  rows.push(CH);
  const asOfM = ASOF.slice(0, 7);
  let cohortRows = 0;
  for (const p of PERIODS) for (const region of REGIONS) for (const seg of SEGMENTS) {
    const pool = sel(deals.filter((x) => (p.grain === "Quarter" ? x.q : x.m) === p.label), region, seg);
    const o = metrics(pool);
    const endM = p.to.slice(0, 7);
    const matured = (Number(asOfM.slice(0, 4)) * 12 + Number(asOfM.slice(5)) ) - (Number(endM.slice(0, 4)) * 12 + Number(endM.slice(5)));
    const inBench = p.from >= BENCH[0] && p.to <= BENCH[1];
    rows.push([p.grain, p.label, p.from, p.to, region, seg, matured,
      matured >= MATURITY_MONTHS ? "Matured" : "Maturing", inBench ? "Yes" : "",
      ...ST.map((s) => o.n[s]), o.nLost, o.nOpen,
      ...ST.map((s) => Math.round(o.usd[s])), Math.round(o.usdLost), Math.round(o.usdOpen),
      ...PAIRS.map(([x, y]) => o.nL[`${x}_${y}`]), ...PAIRS.map(([x, y]) => Math.round(o.usdL[`${x}_${y}`])),
      ...PAIRS.map(([x, y]) => o.rate[`${x}_${y}`]), ...PAIRS.map(([x, y]) => o.rateUsd[`${x}_${y}`]),
      o.cum.SQO, o.cum.Trial, o.cum.CW, o.cumUsd.SQO, o.cumUsd.Trial, o.cumUsd.CW, o.medCycle]);
    cohortRows++;
  }
  // The matured benchmark, as its own slice per region × segment (§3, §6.2).
  for (const region of REGIONS) for (const seg of SEGMENTS) {
    const pool = sel(deals.filter((x) => x.entry >= BENCH[0] && x.entry <= BENCH[1]), region, seg);
    const o = metrics(pool);
    rows.push(["Benchmark", "Matured benchmark", BENCH[0], BENCH[1], region, seg, MATURITY_MONTHS, "Matured", "Yes",
      ...ST.map((s) => o.n[s]), o.nLost, o.nOpen,
      ...ST.map((s) => Math.round(o.usd[s])), Math.round(o.usdLost), Math.round(o.usdOpen),
      ...PAIRS.map(([x, y]) => o.nL[`${x}_${y}`]), ...PAIRS.map(([x, y]) => Math.round(o.usdL[`${x}_${y}`])),
      ...PAIRS.map(([x, y]) => o.rate[`${x}_${y}`]), ...PAIRS.map(([x, y]) => o.rateUsd[`${x}_${y}`]),
      o.cum.SQO, o.cum.Trial, o.cum.CW, o.cumUsd.SQO, o.cumUsd.Trial, o.cumUsd.CW, o.medCycle]);
    cohortRows++;
  }
  rows.push([]);

  // ③ FLOW_LONG — stage ENTRIES in the period. Volume, never a denominator (§3).
  rows.push([`③ FLOW_LONG — deals ENTERING each stage in the period. A volume metric: never divided across columns.`]);
  rows.push(["grain", "period", "region", "segment", ...ST.map((s) => `e_${s}`), ...ST.map((s) => `usd_e_${s}`)]);
  const stageDate = (x, s) => ({ SQL: x.entry, SAL: x.dSAL, SQO: x.dSQO, Trial: x.dTrial, Billing: x.dBilling, CW: x.cwDate }[s]);
  for (const p of PERIODS) for (const region of REGIONS) for (const seg of SEGMENTS) {
    const pool = sel(deals, region, seg);
    const e = ST.map((s) => pool.filter((x) => { const dt = stageDate(x, s); return dt && dt >= p.from && dt <= p.to; }));
    rows.push([p.grain, p.label, region, seg, ...e.map((a) => a.length), ...e.map((a) => Math.round(a.reduce((s2, b) => s2 + b.usd, 0)))]);
  }
  rows.push([]);

  // ④ OPPORTUNITIES — deal level, for drill-downs, ageing and the where-deals-die view.
  rows.push([`④ OPPORTUNITIES — the ${deals.length} included deals, one row each.`]);
  rows.push(["id", "deal", "account", "owner", "region", "segment", "entry_date", "cohort_q", "cohort_m",
    "stage", "prev_stage", "outcome", "lost_from", "lost_reasons", "lead_source", "usd",
    ...ST.map((s) => `reached_${s}`), "sal_date", "sqo_date", "trial_date", "billing_date",
    "cw_date", "lost_date", "days_sql_to_cw", "days_open"]);
  for (const x of deals) rows.push([x.id, x.name, x.acct, x.owner, x.region, x.seg, x.entry, x.q, x.m,
    x.stage, x.prev, x.Won ? "Won" : x.Lost ? "Lost" : "Open", x.lostFrom, x.reasons, x.source, Math.round(x.usd),
    ...ST.map((s) => (x.R[s] ? 1 : 0)), x.dSAL ?? "", x.dSQO ?? "", x.dTrial ?? "", x.dBilling ?? "",
    x.cwDate ?? "", x.lostDate ?? "",
    x.Won && x.cwDate ? days(x.entry, x.cwDate) : "", x.Open ? days(x.entry, ASOF) : ""]);

  // ── write ─────────────────────────────────────────────────────────────────
  const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const api = google.sheets({ version: "v4", auth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const width = Math.max(...rows.map((r) => r.length));
  const meta2 = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const exist = meta2.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (exist) reqs.push({ deleteSheet: { sheetId: exist.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 60, columnCount: width + 2 } } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  // RAW: every cell is a value this script computed. USER_ENTERED would parse a leading "-" as
  // a formula and a "2026-09" period label as a date.
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: "RAW",
    requestBody: { values: rows.map((r) => (r.length ? r : [""])) } });

  console.log(`"${TAB}" written — ${rows.length} rows × ${width} cols`);
  console.log(`  ${deals.length} deals included · excluded: unclassified ${ex.unclassified} · quick SQL loss ${ex.quickloss} · test ${ex.test} · outside window ${ex.outside}`);
  console.log(`  cohorts: ${QS.map((x) => x.label).join(", ")}`);
  console.log(`  cohort_long ${cohortRows} rows · flow_long ${PERIODS.length * 15} rows · opportunities ${deals.length}`);
  const all = metrics(deals);
  console.log(`  all six: SQL ${all.n.SQL} → CW ${all.n.CW} · SQL→CW ${Math.round(all.cum.CW * 100)}% · CW ARR $${Math.round(all.usd.CW).toLocaleString()} · median cycle ${all.medCycle}d`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
