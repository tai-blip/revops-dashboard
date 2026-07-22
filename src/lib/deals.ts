// Deal-level parsing and calculations, ported from the original dashboard's logic.
// Sources: "Query 1" (open pipeline) and "Query 2" (18-month closed history).

type Row = (string | number | boolean | null)[];

function sheetsSerialToDate(v: unknown): Date | null {
  if (typeof v === "number") {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  }
  if (typeof v === "string" && v) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// --- Header-based column resolution -------------------------------------------
// The Salesforce → Coefficient export can reorder/insert columns, which silently
// breaks fixed-index parsing (e.g. reading a date column as the deal Owner).
// We resolve each field by matching the header cell TEXT instead, so the parser
// self-corrects no matter where a column lands.

function normHeader(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/__c$/g, "")   // drop Salesforce custom-field suffix
    .replace(/[^a-z0-9]/g, ""); // strip dots, spaces, underscores, etc.
}

// Build a map of normalized-header -> column index from a header row.
function headerIndexMap(headerRow: Row): Map<string, number> {
  const m = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const key = normHeader(cell);
    if (key && !m.has(key)) m.set(key, i);
  });
  return m;
}

// Find the column index for a field given a list of accepted header aliases.
// Falls back to a fixed index if provided and no header matched (defensive).
function colIdx(
  map: Map<string, number>,
  aliases: string[],
  fallback = -1
): number {
  for (const a of aliases) {
    const key = normHeader(a);
    if (map.has(key)) return map.get(key)!;
  }
  // partial contains-match as a last resort (e.g. "ownername" contains "owner")
  for (const [k, idx] of map) {
    if (aliases.some((a) => k.includes(normHeader(a)))) return idx;
  }
  return fallback;
}

// Cell getter that returns null for an unresolved (-1) column.
function cell(r: Row, idx: number): unknown {
  return idx >= 0 ? r[idx] : null;
}

export type OpenDeal = {
  id: string;
  name: string;
  stage: string;
  arr: number;
  expectedRevQ: number;
  closeDate: Date | null;
  createdDate: Date | null;
  owner: string;
  recordType: string;
  dateReachedSQL: Date | null;
  channel: string;
  lastStageChangeDate: Date | null;
};

export function parseQuery1(rows: Row[]): OpenDeal[] {
  const headerIdx = rows.findIndex((r) => r[0] === "Id");
  if (headerIdx === -1) return [];
  const H = headerIndexMap(rows[headerIdx]);

  // Resolve each field by header text (with fixed-index fallbacks matching the
  // canonical Query 1 layout, in case a header ever goes missing).
  const cId = colIdx(H, ["Id"], 0);
  const cName = colIdx(H, ["Name"], 1);
  const cStage = colIdx(H, ["StageName", "Stage"], 2);
  const cArr = colIdx(H, ["Annual_Contract_Value_ARR_Formula__c", "AnnualContractValueARR", "ARR"], 3);
  const cExpQ = colIdx(H, ["Expected_Revenue_Quarter_AE__c", "ExpectedRevenueQuarterAE", "ExpectedRevenue"], 4);
  const cClose = colIdx(H, ["CloseDate"], 5);
  const cCreated = colIdx(H, ["CreatedDate"], 6);
  const cSql = colIdx(H, ["Date_Reached_SQL__c", "DateReachedSQL"], -1);
  const cChannel = colIdx(H, ["ChannelofContact__c", "ChannelofContact", "Channel"], -1);
  const cOwner = colIdx(H, ["Owner.Name", "OwnerName", "Owner"], 7);
  const cRecord = colIdx(H, ["RecordType.Name", "RecordTypeName", "RecordType"], 8);
  const cLastStage = colIdx(H, ["LastStageChangeDate", "Last_Stage_Change_Date__c"], -1);

  const deals: OpenDeal[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!cell(r, cId)) continue;
    deals.push({
      id: String(cell(r, cId)),
      name: String(cell(r, cName) ?? ""),
      stage: String(cell(r, cStage) ?? ""),
      arr: Number(cell(r, cArr) ?? 0),
      expectedRevQ: Number(cell(r, cExpQ) ?? 0),
      closeDate: sheetsSerialToDate(cell(r, cClose)),
      createdDate: sheetsSerialToDate(cell(r, cCreated)),
      owner: String(cell(r, cOwner) ?? "Unassigned"),
      recordType: String(cell(r, cRecord) ?? ""),
      dateReachedSQL: sheetsSerialToDate(cell(r, cSql)),
      channel: String(cell(r, cChannel) ?? ""),
      lastStageChangeDate: sheetsSerialToDate(cell(r, cLastStage)),
    });
  }
  return deals;
}

export type ClosedDeal = {
  id: string;
  name: string;
  stage: string;
  isWon: boolean;
  arr: number;
  createdDate: Date | null;
  closeDate: Date | null;
  dateReachedSQL: Date | null;
  owner: string;
  recordType: string;
  contractLiveDate: Date | null;
};

export function parseQuery2(rows: Row[]): ClosedDeal[] {
  const headerIdx = rows.findIndex((r) => r[0] === "Id");
  if (headerIdx === -1) return [];
  const H = headerIndexMap(rows[headerIdx]);

  const cId = colIdx(H, ["Id"], 0);
  const cName = colIdx(H, ["Name"], 1);
  const cStage = colIdx(H, ["StageName", "Stage"], 2);
  const cWon = colIdx(H, ["IsWon", "Won"], 3);
  const cArr = colIdx(H, ["Annual_Contract_Value_ARR_Formula__c", "AnnualContractValueARR", "ARR"], 4);
  const cCreated = colIdx(H, ["CreatedDate"], 5);
  const cClose = colIdx(H, ["CloseDate"], 6);
  const cSql = colIdx(H, ["Date_Reached_SQL__c", "DateReachedSQL"], 7);
  const cOwner = colIdx(H, ["Owner.Name", "OwnerName", "Owner"], 8);
  const cRecord = colIdx(H, ["RecordType.Name", "RecordTypeName", "RecordType"], 9);
  const cLive = colIdx(H, ["ContractLiveDate", "Contract_Live_Date__c", "ContractStartDate"], 10);

  const deals: ClosedDeal[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!cell(r, cId)) continue;
    const wonRaw = cell(r, cWon);
    deals.push({
      id: String(cell(r, cId)),
      name: String(cell(r, cName) ?? ""),
      stage: String(cell(r, cStage) ?? ""),
      isWon: wonRaw === true || wonRaw === "true" || wonRaw === "TRUE" || wonRaw === 1,
      arr: Number(cell(r, cArr) ?? 0),
      createdDate: sheetsSerialToDate(cell(r, cCreated)),
      closeDate: sheetsSerialToDate(cell(r, cClose)),
      dateReachedSQL: sheetsSerialToDate(cell(r, cSql)),
      owner: String(cell(r, cOwner) ?? "Unassigned"),
      recordType: String(cell(r, cRecord) ?? ""),
      contractLiveDate: sheetsSerialToDate(cell(r, cLive)),
    });
  }
  return deals;
}

export const STAGE_ORDER = [
  "Expansion Lead",
  "Value Identified",
  "Solutions Approved",
  "Proposal",
  "SQL",
  "SAL",
  "SQO",
  "Trial",
  "Negotiation",
  "Pending Signature",
  "Billing",
];

const DEFAULT_STAGE_RATES: Record<string, number> = {
  "Expansion Lead": 0.08,
  "Value Identified": 0.15,
  "Solutions Approved": 0.55,
  Proposal: 0.45,
  SQL: 0.1,
  SAL: 0.18,
  SQO: 0.32,
  Trial: 0.55,
  Negotiation: 0.75,
  "Pending Signature": 0.9,
  Billing: 0.95,
};

// Ported exactly from the original file's `winRates` useMemo.
export function computeWinRates(closedDeals: ClosedDeal[]) {
  if (closedDeals.length === 0) {
    return { rates: DEFAULT_STAGE_RATES, derived: false, n: 0, overall: null as number | null };
  }
  const won = closedDeals.filter((d) => d.isWon).length;
  const tot = closedDeals.length;
  const overall = tot ? won / tot : 0.3;
  const k = overall / 0.3;
  const rates: Record<string, number> = {};
  Object.entries(DEFAULT_STAGE_RATES).forEach(([s, p]) => {
    rates[s] = Math.max(0.02, Math.min(0.98, p * k));
  });
  return { rates, derived: true, n: tot, overall };
}

// Deal Health — aging buckets by days since last stage change.
export function computeAgingBuckets(openDeals: OpenDeal[], asOf: Date = new Date()) {
  const buckets = [
    { label: "0–30 days", min: 0, max: 30, arr: 0, count: 0 },
    { label: "31–60 days", min: 31, max: 60, arr: 0, count: 0 },
    { label: "61–90 days", min: 61, max: 90, arr: 0, count: 0 },
    { label: "91–180 days", min: 91, max: 180, arr: 0, count: 0 },
    { label: "181–365 days", min: 181, max: 365, arr: 0, count: 0 },
    { label: "365+ days", min: 366, max: Infinity, arr: 0, count: 0 },
  ];
  for (const d of openDeals) {
    const ref = d.lastStageChangeDate ?? d.createdDate;
    if (!ref) continue;
    const days = Math.floor((asOf.getTime() - ref.getTime()) / 86400000);
    const bucket = buckets.find((b) => days >= b.min && days <= b.max);
    if (bucket) {
      bucket.arr += d.arr;
      bucket.count += 1;
    }
  }
  return buckets;
}

// Ranked list of open deals by ARR, with computed age in days — for a "biggest/stalest deals" table.
export function rankOpenDeals(openDeals: OpenDeal[], asOf: Date = new Date(), topN = 25) {
  return openDeals
    .map((d) => {
      const ref = d.lastStageChangeDate ?? d.createdDate;
      const ageDays = ref ? Math.floor((asOf.getTime() - ref.getTime()) / 86400000) : null;
      return {
        name: d.name,
        owner: d.owner,
        stage: d.stage,
        arr: d.arr,
        ageDays,
      };
    })
    .sort((a, b) => b.arr - a.arr)
    .slice(0, topN);
}

// Forecast — stage-weighted pipeline using derived win rates.
export function computeForecast(openDeals: OpenDeal[], rates: Record<string, number>) {
  let rawTotal = 0;
  let weightedTotal = 0;
  const byStage: Record<string, { raw: number; weighted: number; count: number }> = {};
  STAGE_ORDER.forEach((s) => (byStage[s] = { raw: 0, weighted: 0, count: 0 }));

  for (const d of openDeals) {
    rawTotal += d.arr;
    const w = d.arr * (rates[d.stage] ?? 0.1);
    weightedTotal += w;
    if (byStage[d.stage]) {
      byStage[d.stage].raw += d.arr;
      byStage[d.stage].weighted += w;
      byStage[d.stage].count += 1;
    }
  }

  return { rawTotal, weightedTotal, byStage };
}

// Win Rate (YTD) + Avg/Median Sales Cycle (YTD) — New Business only, matching reference.
export function computeWinRateAndCycle(closedDeals: ClosedDeal[], year: number) {
  const ytd = closedDeals.filter(
    (d) =>
      d.recordType.includes("New Business") &&
      d.closeDate &&
      d.closeDate.getUTCFullYear() === year
  );
  const won = ytd.filter((d) => d.isWon);
  const winRate = ytd.length ? won.length / ytd.length : null;

  const cycles = won
    .filter((d) => d.dateReachedSQL && d.closeDate)
    .map((d) => Math.floor((d.closeDate!.getTime() - d.dateReachedSQL!.getTime()) / 86400000))
    .filter((n) => n >= 0)
    .sort((a, b) => a - b);

  const avgCycle = cycles.length ? cycles.reduce((s, n) => s + n, 0) / cycles.length : null;
  const medianCycle = cycles.length ? cycles[Math.floor(cycles.length / 2)] : null;

  return { winRate, avgCycle, medianCycle, closedCount: ytd.length, wonCount: won.length };
}

// Flat trend events for WoW/MoM pipeline movement charting, filterable by owner and type.
export type TrendEvent = {
  date: string; // ISO date
  owner: string;
  arr: number;
  type: "created" | "closedWon" | "closedLost";
};

export function buildTrendEvents(openDeals: OpenDeal[], closedDeals: ClosedDeal[]): TrendEvent[] {
  const events: TrendEvent[] = [];
  for (const d of openDeals) {
    if (!d.createdDate) continue;
    events.push({
      date: d.createdDate.toISOString().slice(0, 10),
      owner: d.owner,
      arr: d.arr,
      type: "created",
    });
  }
  for (const d of closedDeals) {
    if (!d.closeDate) continue;
    events.push({
      date: d.closeDate.toISOString().slice(0, 10),
      owner: d.owner,
      arr: d.arr,
      type: d.isWon ? "closedWon" : "closedLost",
    });
  }
  return events;
}
export function computeAcvDistribution(closedDeals: ClosedDeal[]) {
  const won = closedDeals.filter((d) => d.isWon && d.arr > 0);
  const buckets = [
    { label: "< $10k", min: 0, max: 10000, count: 0, arr: 0 },
    { label: "$10k–25k", min: 10000, max: 25000, count: 0, arr: 0 },
    { label: "$25k–50k", min: 25000, max: 50000, count: 0, arr: 0 },
    { label: "$50k–100k", min: 50000, max: 100000, count: 0, arr: 0 },
    { label: "$100k+", min: 100000, max: Infinity, count: 0, arr: 0 },
  ];
  for (const d of won) {
    const b = buckets.find((b) => d.arr >= b.min && d.arr < b.max);
    if (b) {
      b.count += 1;
      b.arr += d.arr;
    }
  }
  const sorted = won.map((d) => d.arr).sort((a, b) => a - b);
  const avg = sorted.length ? sorted.reduce((s, n) => s + n, 0) / sorted.length : 0;
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  return { buckets, avg, median, count: sorted.length };
}

// ── Forecast tab: in-quarter per-AE potential, mirroring the original dashboard ──
export type ForecastRow = {
  name: string;
  short: string;
  am: boolean;
  lead?: boolean;
  openPipe: number;
  quota: number | null;
  closedWon: number;
  potNB: number;
  potExp: number;
  potential: number;
  variance: number | null;
  attainP: number | null;
};

const isExpRt = (rt: string) => rt.includes("Expansion");
const isRenewalRt = (rt: string) => rt.includes("Renewal");
const isNBRt = (rt: string) => rt.includes("New Business");

// ── Forecasting tab (data-warehouse): read the pre-computed QoQ block ──
// Layout: after the "QoQ Progression" title row comes a header row with the
// quarter labels (Q1 2026 … Q4 2026), each spanning a 4-col block
// [Closed Won | Potential ARR | Quota | Vs Quota]. Open Pipeline / Pot New Biz /
// Pot Expansion are snapshots in cols B/C/D. We read the block for `quarterKey`.
export type ForecastingSheetRow = {
  openPipe: number;
  potNB: number;
  potExp: number;
  closedWon: number;
  potential: number;
};
export function parseForecastingQoQ(
  rows: Row[],
  quarterKey: string
): Record<string, ForecastingSheetRow> {
  const out: Record<string, ForecastingSheetRow> = {};
  const titleIdx = rows.findIndex((r) =>
    r.some((c) => typeof c === "string" && c.includes("QoQ Progression"))
  );
  if (titleIdx === -1) return out;

  const qHeader = rows[titleIdx + 1] ?? [];
  const key = quarterKey.toUpperCase();
  let qCol = -1;
  for (let c = 0; c < qHeader.length; c++) {
    const v = qHeader[c];
    if (typeof v === "string" && v.toUpperCase().replace(/\s+/g, "").includes(key)) {
      qCol = c; // Closed Won column for that quarter; Potential ARR is qCol+1
      break;
    }
  }
  if (qCol === -1) return out;

  const num = (x: unknown): number => {
    const n = Number(String(x ?? "").replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  };

  // Data rows start after the title + quarter-header + sub-header (3 rows).
  for (let i = titleIdx + 3; i < rows.length; i++) {
    const name = String(cell(rows[i], 0) ?? "").trim();
    if (!name) break; // blank line ends the block
    if (name.toUpperCase().startsWith("AE TEAM")) continue; // summary recomputed downstream
    out[name] = {
      openPipe: num(cell(rows[i], 1)),
      potNB: num(cell(rows[i], 2)),
      potExp: num(cell(rows[i], 3)),
      closedWon: num(cell(rows[i], qCol)),
      potential: num(cell(rows[i], qCol + 1)),
    };
  }
  return out;
}

// Reads the "Weighted Pipeline by Deal Stage (All AEs)" block from the
// Forecasting tab: Stage | Open Pipeline | Pot New Biz | Pot Expansion |
// Potential ARR | Probability % | Weighted Open Pipeline.
export type ForecastingStageRow = {
  stage: string;
  openPipe: number;
  potNB: number;
  potExp: number;
  potentialARR: number;
  probability: number;
  weighted: number;
};
export function parseForecastingStages(rows: Row[]): ForecastingStageRow[] {
  const titleIdx = rows.findIndex((r) =>
    r.some((c) => typeof c === "string" && c.includes("Weighted Pipeline by Deal Stage"))
  );
  if (titleIdx === -1) return [];
  const num = (x: unknown): number => {
    const n = Number(String(x ?? "").replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : 0;
  };
  const out: ForecastingStageRow[] = [];
  // header is at titleIdx + 1; data rows follow until a blank row or "TOTAL".
  for (let i = titleIdx + 2; i < rows.length; i++) {
    const stage = String(cell(rows[i], 0) ?? "").trim();
    if (!stage) break;
    if (stage.toUpperCase() === "TOTAL") break;
    out.push({
      stage,
      openPipe: num(cell(rows[i], 1)),
      potNB: num(cell(rows[i], 2)),
      potExp: num(cell(rows[i], 3)),
      potentialARR: num(cell(rows[i], 4)),
      probability: num(cell(rows[i], 5)),
      weighted: num(cell(rows[i], 6)),
    });
  }
  return out;
}

export function computeForecastTab(
  openDeals: OpenDeal[],
  closedDeals: ClosedDeal[],
  roster: { name: string; short: string; quota: number | null; am: boolean; lead?: boolean }[],
  qStartISO: string,
  qEndISO: string,
  currentLiveARR: number,
  annualTarget: number,
  rates: Record<string, number>,
  nextQ: { label: string; startISO: string; endISO: string; quota: number },
  sheetRows?: Record<
    string,
    { openPipe: number; potNB: number; potExp: number; closedWon: number; potential: number }
  >,
  stageRows?: ForecastingStageRow[]
) {
  const rosterNames = new Set(roster.map((r) => r.name));

  const cwByOwner: Record<string, { nb: number; exp: number }> = {};
  for (const d of closedDeals) {
    if (!d.isWon || !d.closeDate) continue;
    const iso = d.closeDate.toISOString().slice(0, 10);
    if (iso < qStartISO || iso >= qEndISO) continue;
    if (!rosterNames.has(d.owner)) continue;
    if (!cwByOwner[d.owner]) cwByOwner[d.owner] = { nb: 0, exp: 0 };
    if (isExpRt(d.recordType)) cwByOwner[d.owner].exp += d.arr;
    else if (isNBRt(d.recordType)) cwByOwner[d.owner].nb += d.arr;
  }

  const openByOwner: Record<string, { pipe: number; potNB: number; potExp: number }> = {};
  for (const d of openDeals) {
    if (!rosterNames.has(d.owner)) continue;
    if (!openByOwner[d.owner]) openByOwner[d.owner] = { pipe: 0, potNB: 0, potExp: 0 };
    openByOwner[d.owner].pipe += d.arr;
    if (isRenewalRt(d.recordType)) continue;
    if (isExpRt(d.recordType)) openByOwner[d.owner].potExp += d.expectedRevQ;
    else if (isNBRt(d.recordType)) openByOwner[d.owner].potNB += d.expectedRevQ;
  }

  const rows: ForecastRow[] = roster.map((a) => {
    const s = sheetRows?.[a.name];
    const cw = s ? s.closedWon : (cwByOwner[a.name]?.nb ?? 0) + (cwByOwner[a.name]?.exp ?? 0);
    const potNB = s ? s.potNB : openByOwner[a.name]?.potNB ?? 0;
    const potExp = s ? s.potExp : openByOwner[a.name]?.potExp ?? 0;
    const openPipe = s ? s.openPipe : openByOwner[a.name]?.pipe ?? 0;
    const potential = s ? s.potential : cw + potNB + potExp;
    return {
      name: a.name,
      short: a.short,
      am: a.am,
      lead: a.lead ?? false,
      openPipe,
      quota: a.quota,
      closedWon: cw,
      potNB,
      potExp,
      potential,
      variance: a.quota != null ? potential - a.quota : null,
      attainP: a.quota ? potential / a.quota : null,
    };
  });

  const sum = (rs: ForecastRow[]) => {
    const s = (k: keyof ForecastRow) => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const quota = s("quota");
    const potential = s("potential");
    return {
      openPipe: s("openPipe"),
      quota,
      closedWon: s("closedWon"),
      potNB: s("potNB"),
      potExp: s("potExp"),
      potential,
      variance: potential - quota,
      attainP: quota ? potential / quota : null,
    };
  };
  const aeTeam = sum(rows.filter((r) => !r.am && !r.lead));
  const totalInclAM = sum(rows.filter((r) => !r.lead));
  const totalInclLead = sum(rows);

  // ── Year-end projection: per-stage weighted contributions ──
  const YE_WR = 0.25; // flat rate kept for the gap-coverage "pipeline needed" math
  let rawAnnual = 0;
  let weightedAnnualFlat = 0;
  let weightedAnnual = 0; // per-stage weighted (drives the waterfall + projection)
  let yeWaterfall: { stage: string; raw: number; weighted: number }[] = [];
  if (stageRows && stageRows.length) {
    // Single source of truth: the Forecasting tab's "Weighted Pipeline by Deal
    // Stage" block. Potential ARR is the weighted contribution; Open Pipeline is
    // the raw. Projection + gap follow from these, matching the sheet.
    for (const s of stageRows) {
      rawAnnual += s.openPipe;
      weightedAnnual += s.potentialARR;
      weightedAnnualFlat += s.openPipe * YE_WR;
    }
    yeWaterfall = stageRows
      .filter((s) => s.potentialARR > 0)
      .map((s) => ({ stage: s.stage, raw: s.openPipe, weighted: s.potentialARR }));
  } else {
    const byStageW: Record<string, { raw: number; weighted: number }> = {};
    for (const d of openDeals) {
      rawAnnual += d.arr;
      weightedAnnualFlat += d.arr * YE_WR;
      const rate = rates[d.stage] ?? 0.1;
      const w = d.arr * rate;
      weightedAnnual += w;
      if (!byStageW[d.stage]) byStageW[d.stage] = { raw: 0, weighted: 0 };
      byStageW[d.stage].raw += d.arr;
      byStageW[d.stage].weighted += w;
    }
    yeWaterfall = STAGE_ORDER.filter((s) => (byStageW[s]?.raw ?? 0) > 0).map((s) => ({
      stage: s,
      raw: byStageW[s].raw,
      weighted: byStageW[s].weighted,
    }));
  }
  const projYE = currentLiveARR + weightedAnnual;
  const annualGap = annualTarget - projYE;
  // Net-new pipeline needed to cover the gap at the flat close rate.
  const pipelineNeededForGap = annualGap > 0 && YE_WR > 0 ? annualGap / YE_WR : 0;

  // ── Next quarter at a glance: open deals dated to close in the NEXT quarter ──
  const nqByStage: Record<string, { count: number; raw: number; aeExpected: number; weighted: number }> = {};
  let nqRaw = 0, nqWeighted = 0, nqCount = 0;
  for (const d of openDeals) {
    if (!rosterNames.has(d.owner)) continue;
    if (!d.closeDate) continue;
    const iso = d.closeDate.toISOString().slice(0, 10);
    if (iso < nextQ.startISO || iso >= nextQ.endISO) continue;
    const rate = rates[d.stage] ?? 0.1;
    const w = d.arr * rate;
    if (!nqByStage[d.stage]) nqByStage[d.stage] = { count: 0, raw: 0, aeExpected: 0, weighted: 0 };
    nqByStage[d.stage].count += 1;
    nqByStage[d.stage].raw += d.arr;
    nqByStage[d.stage].aeExpected += d.expectedRevQ;
    nqByStage[d.stage].weighted += w;
    nqRaw += d.arr;
    nqWeighted += w;
    nqCount += 1;
  }
  const nextQuarter = {
    label: nextQ.label,
    startISO: nextQ.startISO,
    quota: nextQ.quota,
    raw: nqRaw,
    realistic: nqWeighted,
    count: nqCount,
    gap: Math.max(0, nextQ.quota - nqWeighted),
    coversPct: nextQ.quota > 0 ? nqWeighted / nextQ.quota : 0,
    // late-stage (SQO and beyond) share of raw, for the "read it this way" line
    lateStageRaw: STAGE_ORDER.slice(STAGE_ORDER.indexOf("SQO")).reduce((s, st) => s + (nqByStage[st]?.raw ?? 0), 0),
    byStage: STAGE_ORDER.filter((s) => (nqByStage[s]?.count ?? 0) > 0).map((s) => ({
      stage: s,
      count: nqByStage[s].count,
      raw: nqByStage[s].raw,
      aeExpected: nqByStage[s].aeExpected,
      survivesPct: nqByStage[s].raw > 0 ? nqByStage[s].weighted / nqByStage[s].raw : 0,
    })),
  };

  const now = new Date();
  const qEnd = new Date(qEndISO).getTime();
  const daysLeft = Math.max(0, Math.ceil((qEnd - now.getTime()) / 86400000));
  const weeksLeft = Math.max(0, Math.ceil(daysLeft / 7));
  const teamQuota = aeTeam.quota;
  const teamActual = aeTeam.closedWon;
  const quotaGap = Math.max(0, teamQuota - teamActual);
  const quotaPerWeek = weeksLeft > 0 ? quotaGap / weeksLeft : 0;

  let potOpenQ = 0;
  for (const d of openDeals) {
    if (!rosterNames.has(d.owner)) continue;
    if (!isNBRt(d.recordType)) continue;
    if (d.closeDate) {
      const iso = d.closeDate.toISOString().slice(0, 10);
      if (iso < qStartISO || iso >= qEndISO) continue;
    }
    potOpenQ += d.expectedRevQ;
  }
  const teamActualNB = roster.filter((r) => !r.am && !r.lead).reduce((s, a) => s + (cwByOwner[a.name]?.nb ?? 0), 0);
  const potentialLanding = teamActualNB + potOpenQ;

  const decideDeals = openDeals
    .filter((d) => rosterNames.has(d.owner))
    .map((d) => {
      const ref = d.lastStageChangeDate ?? d.createdDate;
      const ageDays = ref ? Math.floor((now.getTime() - ref.getTime()) / 86400000) : null;
      return { name: d.name, owner: d.owner, stage: d.stage, arr: d.arr, ageDays };
    })
    .sort((a, b) => b.arr - a.arr)
    .slice(0, 40);

  return {
    rows,
    aeTeam,
    totalInclAM,
    totalInclLead,
    teamProjected: aeTeam.potential,
    teamQuota,
    teamActual,
    projYE,
    annualGap,
    annualTarget,
    currentLiveARR,
    weightedAnnual,
    weightedAnnualFlat,
    rawAnnual,
    pipelineNeededForGap,
    yeWaterfall,
    nextQuarter,
    daysLeft,
    weeksLeft,
    quotaGap,
    quotaPerWeek,
    potentialLanding,
    decideDeals,
  };
}
