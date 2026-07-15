// Company P&L plan (Jan–Dec 2026), set by finance — a fixed plan, ported exactly from
// the original Momos Forecast snapshot. Everything MEASURED against this plan is computed
// live from Sheet data; only the plan targets themselves are fixed (as any plan is).

export const PLAN_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const newBiz = [251698, 257202, 262647, 383856, 391254, 431734, 431370, 438347, 589757, 683008, 739043, 825669];
const expansion = [62924, 64301, 65662, 95964, 97813, 107933, 107843, 109587, 147439, 170752, 184761, 206417];
const churn = [19791, 19811, 20881, 21970, 22455, 24126, 24405, 26535, 28089, 29464, 35224, 35231];
const endARR = [4500000, 4801692, 5109119, 5566969, 6033581, 6549122, 7063929, 7585327, 8294435, 9118730, 10007309, 11004164];

// New ARR target = New Business + Expansion
const newARR = newBiz.map((v, i) => v + expansion[i]);

// Rebased H2 FY26 plan → $10M year-end. H1 (Jan–May) keeps prior plan; Jun–Dec ending-ARR
// is overridden, and Jul–Dec net-new target becomes the MoM delta of that ending-ARR path.
const rebasedEnd: [number, number][] = [
  [5, 5690808], [6, 6210436], [7, 6862613], [8, 7614030], [9, 8636980], [10, 9383399], [11, 9998233],
];
for (const [i, v] of rebasedEnd) endARR[i] = v;
for (let i = 6; i <= 11; i++) newARR[i] = endARR[i] - endARR[i - 1];

export const TARGETS = { newBiz, expansion, churn, endARR, newARR };
export const ANNUAL_END_TARGET = endARR[11]; // ~ $11.0M gross; rebased path lands ~$10M (Nov)

// Sales quarters (fiscal), used to derive the current quarter from today automatically.
export const SALES_Q: Record<string, { label: string; start: string; end: string }> = {
  Q1: { label: "Q1 FY26", start: "2026-02-01", end: "2026-04-02" },
  Q2: { label: "Q2 FY26", start: "2026-04-02", end: "2026-07-02" },
  Q3: { label: "Q3 FY26", start: "2026-07-02", end: "2026-10-02" },
  Q4: { label: "Q4 FY26", start: "2026-10-02", end: "2027-01-02" },
};

export function currentSalesQ(now = new Date()): string {
  for (const k of ["Q1", "Q2", "Q3", "Q4"]) {
    const w = SALES_Q[k];
    if (now >= new Date(w.start) && now < new Date(w.end)) return k;
  }
  return now < new Date(SALES_Q.Q1.start) ? "Q1" : "Q4";
}

// Which calendar-month indices (0=Jan) fall in a given sales quarter.
export function monthsInQuarter(q: string): number[] {
  const map: Record<string, number[]> = {
    Q1: [1, 2, 3], // Feb–Apr (fiscal Q1 spans Feb 1 – Apr 2)
    Q2: [3, 4, 5], // Apr–Jun
    Q3: [6, 7, 8], // Jul–Sep
    Q4: [9, 10, 11], // Oct–Dec
  };
  return map[q] ?? [6, 7, 8];
}
