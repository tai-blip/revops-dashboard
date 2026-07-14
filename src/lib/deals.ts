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
  const deals: OpenDeal[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    deals.push({
      id: String(r[0]),
      name: String(r[1] ?? ""),
      stage: String(r[2] ?? ""),
      arr: Number(r[3] ?? 0),
      expectedRevQ: Number(r[4] ?? 0),
      closeDate: sheetsSerialToDate(r[5]),
      createdDate: sheetsSerialToDate(r[6]),
      owner: String(r[7] ?? "Unassigned"),
      recordType: String(r[8] ?? ""),
      dateReachedSQL: sheetsSerialToDate(r[9]),
      channel: String(r[10] ?? ""),
      lastStageChangeDate: sheetsSerialToDate(r[11]),
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
  const deals: ClosedDeal[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    deals.push({
      id: String(r[0]),
      name: String(r[1] ?? ""),
      stage: String(r[2] ?? ""),
      isWon: r[3] === true || r[3] === "true" || r[3] === "TRUE",
      arr: Number(r[4] ?? 0),
      createdDate: sheetsSerialToDate(r[5]),
      closeDate: sheetsSerialToDate(r[6]),
      dateReachedSQL: sheetsSerialToDate(r[7]),
      owner: String(r[8] ?? "Unassigned"),
      recordType: String(r[9] ?? ""),
      contractLiveDate: sheetsSerialToDate(r[10]),
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

// ACV & Deal Size — distribution of won-deal ARR.
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
