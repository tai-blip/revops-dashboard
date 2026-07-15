import fs from "fs";
import path from "path";
import {
  parseArrTab,
  parseAeAttainmentTab,
  parsePipelineTab,
  parsePipelineWowTab,
} from "../src/lib/parse";
import {
  parseQuery1,
  parseQuery2,
  computeWinRates,
  computeAgingBuckets,
  rankOpenDeals,
  buildTrendEvents,
  computeForecast,
  computeForecastTab,
  computeWinRateAndCycle,
  computeAcvDistribution,
} from "../src/lib/deals";
import { SALES_Q, currentSalesQ, AE_ROSTER, ANNUAL_END_TARGET, CURRENT_LIVE_ARR_FALLBACK } from "../src/lib/planConfig";

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../../raw-rows.json"), "utf-8"));

// Seeded RNG for reproducible jitter
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const BASE = 0.87;
const jm = (n: number) => Math.round(n * BASE * (0.7 + rand() * 0.6)); // money jitter 0.61x–1.13x
const jmMild = (n: number) => Math.round(n * BASE * (0.92 + rand() * 0.16)); // mild for snapshots/quotas
const jc = (n: number) => Math.max(0, Math.round(n * (0.6 + rand() * 0.8))); // count jitter

// ---- names ----
const nameMap: Record<string, string> = {};
const demoNames = [
  "Alex Carter", "Riley Morgan", "Jordan Blake", "Sam Whitfield", "Casey Nguyen",
  "Drew Ellison", "Taylor Reed", "Quinn Harper", "Avery Stone", "Jamie Lowell",
  "Morgan Vale", "Rowan Pierce", "Skyler Nash", "Emerson Cole", "Parker Lane",
];
let nameIdx = 0;
function anonName(real: string): string {
  if (!real || real === "Unassigned" || real === "TOTAL") return real;
  if (!nameMap[real]) {
    nameMap[real] = demoNames[nameIdx % demoNames.length] + (nameIdx >= demoNames.length ? ` ${Math.floor(nameIdx / demoNames.length) + 1}` : "");
    nameIdx++;
  }
  return nameMap[real];
}
const FIRST = ["Northwind", "Bluefin", "Copperleaf", "Summit", "Harborline", "Redwood", "Lighthouse", "Ironwood", "Golden Gate", "Silverbrook", "Stonebridge", "Maple & Main", "Driftwood", "Lantern", "Wildflower"];
const SECOND = ["Bistro", "Hospitality Group", "Kitchens", "Coffee Co", "Eatery", "Restaurant Group", "Diner Collective", "Grill", "Foods", "Provisions", "Tavern Group", "Bakehouse"];
let dealIdx = 0;
const dealNameMap: Record<string, string> = {};
function anonDeal(real: string): string {
  if (!dealNameMap[real]) {
    const f = FIRST[dealIdx % FIRST.length];
    const s = SECOND[Math.floor(dealIdx / FIRST.length) % SECOND.length];
    dealNameMap[real] = `${f} ${s} #${100 + dealIdx}`;
    dealIdx++;
  }
  return dealNameMap[real];
}

// ---- stage renaming ----
const STAGE_MAP: Record<string, string> = {
  "Expansion Lead": "Expansion Intent",
  "Value Identified": "Discovery",
  "Solutions Approved": "Solution Fit",
  "Proposal": "Proposal",
  "SQL": "Qualified",
  "SAL": "Accepted",
  "SQO": "Evaluating",
  "Trial": "Pilot",
  "Negotiation": "Negotiation",
  "Pending Signature": "Contract Sent",
  "Billing": "Closing",
};
const stage = (s: string) => STAGE_MAP[s] ?? s;
function relabel(text: string): string {
  // rename stage acronyms inside metric labels, longest-first to avoid partial hits
  return text
    .replace(/SQL\u2192close/g, "Qualified\u2192close")
    .replace(/\(SQL\+SQO\+SAL\)/g, "(Qual+Eval+Acc)")
    .replace(/\bSQO\b/g, "Evaluating")
    .replace(/\bSAL\b/g, "Accepted")
    .replace(/\bSQL\b/g, "Qualified");
}

// ---- parse ----
const arr = parseArrTab(raw["ARR & recurring revenue"]);
const aeAttainment = parseAeAttainmentTab(raw["AE attainment"]);
const pipeline = parsePipelineTab(raw["Pipeline"]);
const pipelineWow = parsePipelineWowTab(raw["Pipeline - WoW"]);
const openDeals = parseQuery1(raw["Query 1"]);
const closedDeals = parseQuery2(raw["Query 2"]);

// ---- jitter source-level data BEFORE computing aggregates (keeps everything consistent) ----
for (const d of openDeals) {
  d.arr = jm(d.arr);
  d.owner = anonName(d.owner);
  d.name = anonDeal(d.name);
}
for (const d of closedDeals) {
  d.arr = jm(d.arr);
  d.owner = anonName(d.owner);
  d.name = anonDeal(d.name);
}

for (const list of [arr.monthly, arr.weekly]) {
  let prev: number | null = null;
  for (const p of list) {
    p.newBusiness = jm(p.newBusiness);
    p.expansion = jm(p.expansion);
    p.renewals = jm(p.renewals);
    p.newARR = p.newBusiness + p.expansion + p.renewals;
    p.activeARR = jmMild(p.activeARR);
    p.churnedARR = jm(p.churnedARR);
    p.changePct = prev != null && prev > 0 ? (p.activeARR - prev) / prev : null;
    prev = p.activeARR;
  }
}

for (const r of aeAttainment.reps) {
  r.name = anonName(r.name);
  r.quota = jmMild(r.quota);
  r.actual = jm(r.actual);
  r.pctOfQuota = r.quota > 0 ? r.actual / r.quota : 0;
}
for (const m of aeAttainment.monthlyTeamActual) m.actual = jm(m.actual);

for (const [sec, rows] of Object.entries(pipeline.metricSections)) {
  for (const row of rows) {
    row.metric = relabel(row.metric);
    if (row.kind === "currency") row.value = jm(row.value);
    else if (row.kind === "count") row.value = jc(row.value);
  }
}
for (const rows of Object.values(pipeline.breakdownSections)) {
  for (const row of rows) {
    row.label = stage(row.label);
    row.arr = jm(row.arr);
    row.opps = jc(row.opps);
  }
}
for (const row of pipeline.stageWeights) {
  row.stage = stage(row.stage);
  row.arr = jm(row.arr);
  row.weighted = Math.round(row.arr * row.probability);
}
for (const row of pipeline.aeBreakdown) {
  row.name = anonName(row.name);
  if (row.quota != null) row.quota = jmMild(row.quota);
  row.actual = jm(row.actual);
}
pipeline.filterRep = anonName(pipeline.filterRep);

pipelineWow.filterRep = anonName(pipelineWow.filterRep);
for (const w of pipelineWow.weeks) {
  w.metric = relabel(w.metric);
  if (w.metric.includes("($)")) w.values = w.values.map((v) => (v == null ? null : jm(v)));
  else if (!w.metric.includes("\u0394%")) w.values = w.values.map((v) => (v == null ? null : jc(v)));
}
for (const key of ["newOppsMom", "newArrMom"] as const) {
  const table = pipelineWow[key];
  const newReps: Record<string, number[]> = {};
  for (const [name, vals] of Object.entries(table.reps)) {
    newReps[anonName(name)] = key === "newArrMom" ? vals.map(jm) : vals.map(jc);
  }
  table.reps = newReps;
}

// ---- compute aggregates from the jittered deals (internally consistent) ----
const q = currentSalesQ();
const qDef = SALES_Q[q];
const latestArr = arr.monthly[arr.monthly.length - 1]?.activeARR ?? CURRENT_LIVE_ARR_FALLBACK;
const demoRoster = AE_ROSTER.map((a) => ({
  name: anonName(a.name),
  short: anonName(a.name).split(" ")[0],
  quota: a.quotaQ3,
  am: a.am,
}));
const forecastTab = computeForecastTab(openDeals, closedDeals, demoRoster, qDef.start, qDef.end, latestArr, ANNUAL_END_TARGET);
// rename stages inside decide board + byStage already handled by stage() where needed
forecastTab.decideDeals = forecastTab.decideDeals.map((d) => ({ ...d, stage: stage(d.stage), name: d.name }));

const winRates = computeWinRates(closedDeals);
const dealHealth = computeAgingBuckets(openDeals);
const rankedDeals = rankOpenDeals(openDeals).map((d) => ({ ...d, stage: stage(d.stage) }));
const trendEvents = buildTrendEvents(openDeals, closedDeals);
const forecastRaw = computeForecast(openDeals, winRates.rates);
const byStageRenamed: typeof forecastRaw.byStage = {};
for (const [k, v] of Object.entries(forecastRaw.byStage)) byStageRenamed[stage(k)] = v;
const forecast = { ...forecastRaw, byStage: byStageRenamed };
const winRateYtd = computeWinRateAndCycle(closedDeals, new Date().getUTCFullYear());
const acv = computeAcvDistribution(closedDeals);

const now = new Date();
const byOwner: Record<string, { openCount: number; openArr: number; staleCount: number; staleArr: number }> = {};
for (const d of openDeals) {
  if (!byOwner[d.owner]) byOwner[d.owner] = { openCount: 0, openArr: 0, staleCount: 0, staleArr: 0 };
  byOwner[d.owner].openCount += 1;
  byOwner[d.owner].openArr += d.arr;
  const ref = d.lastStageChangeDate ?? d.createdDate;
  const days = ref ? Math.floor((now.getTime() - ref.getTime()) / 86400000) : 0;
  if (days > 60) {
    byOwner[d.owner].staleCount += 1;
    byOwner[d.owner].staleArr += d.arr;
  }
}

const payload = {
  updatedAt: new Date().toISOString(),
  demo: true,
  arr,
  aeAttainment,
  pipeline,
  pipelineWow,
  dealHealth,
  rankedDeals,
  trendEvents,
  forecast,
  forecastTab,
  quarter: { key: q, label: qDef.label, start: qDef.start, end: qDef.end },
  winRates: { derived: winRates.derived, n: winRates.n, overall: winRates.overall },
  winRateYtd,
  acv,
  whoDoesWhat: byOwner,
};

fs.mkdirSync(path.join(__dirname, "../src/data"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "../src/data/demo-snapshot.json"), JSON.stringify(payload));
console.log("snapshot written. names:", Object.keys(nameMap).length, "deals:", dealIdx);
