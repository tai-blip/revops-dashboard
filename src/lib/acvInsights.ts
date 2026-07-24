// ACV & Deal Size analytics, computed from the "SOQL_ClosedDeals" tab
// (written daily by scripts/refresh-arr-from-sfdc.mjs — all Billing / Closed Won /
// Closed Lost opps enriched with deal dimensions).
//
// Definitions (aligned with the rest of the dashboard):
// - Won  = StageName Billing or Closed Won ("Outcome" column, precomputed in the pull)
// - Window for ACV / cycle / win-rate = last 12 months by CloseDate
// - Cycle = Date Reached SQL -> Date Reached Closed Won (days)
// - US = Deal Country "United States"; everything else = International
// - ARR by Location Tier = point-in-time active ARR (live <= boundary < end) per
//   Location Tier at each 2026 month-end, boundary = 1st of next month (same rule
//   as ARR_MoM_Rebuild / the Tableau tracker).

type Row = (string | number | null)[];

export type AcvInsights = {
  windowLabel: string;
  totals: { count: number; avg: number; median: number; totalARR: number };
  segments: {
    seg: string; count: number; avg: number; median: number; totalARR: number;
    medianCycle: number | null; cycleN: number;
  }[];
  geo: {
    label: string; wonCount: number; lostCount: number; winRate: number | null;
    avg: number; median: number; totalARR: number;
  }[];
  regions: { region: string; count: number; avg: number; median: number; totalARR: number }[];
  byAE: { owner: string; count: number; avg: number; median: number; totalARR: number }[];
  arrByTier: { months: string[]; tiers: { tier: string; values: number[] }[] };
};

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const SEG_ORDER = ["Small", "Medium", "Mid-Market", "Enterprise", "Mega Enterprise"];
const segKey = (s: string) => {
  const i = SEG_ORDER.indexOf(s);
  return i === -1 ? SEG_ORDER.length + (s === "Unclassified" ? 1 : 0) : i;
};

export function computeAcvInsights(rows: Row[]): AcvInsights | null {
  if (!rows.length) return null;
  const header = rows[0].map((h) => String(h ?? ""));
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cOwner = col("Owner"), cOutcome = col("Outcome"), cSeg = col("Merchant Segment"),
    cTier = col("Location Tier"), cCountry = col("Deal Country"), cRegion = col("Region"),
    cArr = col("ARR (USD)"), cClose = col("CloseDate"), cSql = col("Date Reached SQL"),
    cWonDate = col("Date Reached Closed Won"), cLive = col("ContractLiveDate"), cEnd = col("ContractEndDate"),
    cRt = col("RecordType");
  if (cOutcome === -1 || cArr === -1) return null;

  // Sheets may hand dates back as serials (UNFORMATTED_VALUE) or strings — normalize to ms.
  const toMs = (v: string | number | null): number | null => {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Date.UTC(1899, 11, 30) + v * 86400000;
    const t = Date.parse(String(v).slice(0, 10) + "T00:00:00Z");
    return Number.isNaN(t) ? null : t;
  };

  const now = Date.now();
  const windowStart = now - 365 * 86400000; // 12 months
  type Deal = {
    owner: string; outcome: string; seg: string; tier: string; us: boolean; region: string;
    arr: number; closeMs: number | null; cycle: number | null; liveMs: number | null; endMs: number | null;
    nb: boolean; // New Business record type (win-rate basis — renewals/expansion excluded)
  };
  const deals: Deal[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[cOutcome] == null || r[cOutcome] === "") continue;
    const sqlMs = toMs(r[cSql]), wonMs = toMs(r[cWonDate]);
    const cycle = sqlMs != null && wonMs != null && wonMs >= sqlMs ? Math.round((wonMs - sqlMs) / 86400000) : null;
    const segRaw = String(r[cSeg] ?? "").trim();
    deals.push({
      owner: String(r[cOwner] ?? ""),
      outcome: String(r[cOutcome]),
      seg: !segRaw || segRaw === "To Be Classified" ? "Unclassified" : segRaw,
      tier: String(r[cTier] ?? "").trim() || "No tier",
      us: String(r[cCountry] ?? "") === "United States",
      region: String(r[cRegion] ?? "").trim() || "Unknown",
      arr: Number(r[cArr] ?? 0),
      closeMs: toMs(r[cClose]),
      cycle,
      liveMs: toMs(r[cLive]),
      endMs: toMs(r[cEnd]),
      nb: /New Business/i.test(String(r[cRt] ?? "")),
    });
  }

  const inWindow = (d: Deal) => d.closeMs != null && d.closeMs >= windowStart && d.closeMs <= now;
  const wonW = deals.filter((d) => d.outcome === "Won" && inWindow(d) && d.arr > 0);
  const lostW = deals.filter((d) => d.outcome === "Lost" && inWindow(d));

  const agg = (list: Deal[]) => {
    const arrs = list.map((d) => d.arr);
    const totalARR = arrs.reduce((s, v) => s + v, 0);
    return { count: list.length, avg: list.length ? totalARR / list.length : 0, median: median(arrs), totalARR };
  };

  // by segment (+ cycle per segment)
  const segNames = Array.from(new Set(wonW.map((d) => d.seg))).sort((a, b) => segKey(a) - segKey(b));
  const segments = segNames.map((seg) => {
    const list = wonW.filter((d) => d.seg === seg);
    const cycles = list.map((d) => d.cycle).filter((c): c is number => c != null);
    return { seg, ...agg(list), medianCycle: cycles.length ? Math.round(median(cycles)) : null, cycleN: cycles.length };
  });

  // US vs International — win rate on NEW BUSINESS only (renewals/expansion nearly
  // always close won and would inflate it); ACV stats on all won deals in the geo.
  const geo = [true, false].map((us) => {
    const won = wonW.filter((d) => d.us === us);
    const wonNb = won.filter((d) => d.nb);
    const lostNb = lostW.filter((d) => d.us === us && d.nb);
    const denom = wonNb.length + lostNb.length;
    return {
      label: us ? "US" : "International",
      wonCount: wonNb.length, lostCount: lostNb.length,
      winRate: denom ? wonNb.length / denom : null,
      ...(({ avg, median: med, totalARR }) => ({ avg, median: med, totalARR }))(agg(won)),
    };
  });

  // by region
  const regions = Array.from(new Set(wonW.map((d) => d.region)))
    .map((region) => ({ region, ...agg(wonW.filter((d) => d.region === region)) }))
    .sort((a, b) => b.totalARR - a.totalARR);

  // by AE
  const byAE = Array.from(new Set(wonW.map((d) => d.owner).filter(Boolean)))
    .map((owner) => ({ owner, ...agg(wonW.filter((d) => d.owner === owner)) }))
    .sort((a, b) => b.totalARR - a.totalARR);

  // ARR by Location Tier — 2026 month-ends, active-ARR rule (boundary = 1st of next month)
  const year = new Date().getUTCFullYear();
  const curMonth = new Date().getUTCMonth(); // 0-based
  const months: string[] = [];
  const boundaries: number[] = [];
  for (let m = 0; m <= curMonth; m++) {
    months.push(`${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]}-${String(year).slice(2)}`);
    boundaries.push(Date.UTC(year, m + 1, 1)); // 1st of next month
  }
  const wonAll = deals.filter((d) => d.outcome === "Won" && d.liveMs != null);
  const tierNames = Array.from(new Set(wonAll.map((d) => d.tier))).sort((a, b) => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (Number.isNaN(na) && Number.isNaN(nb)) return a.localeCompare(b);
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb;
  });
  const tiers = tierNames.map((tier) => ({
    tier,
    values: boundaries.map((b) =>
      wonAll.reduce((s, d) => {
        if (d.tier !== tier) return s;
        const end = d.endMs ?? Date.UTC(2099, 11, 31);
        return d.liveMs! <= b && end > b ? s + d.arr : s;
      }, 0)
    ),
  })).filter((t) => t.values.some((v) => v > 0));

  return {
    windowLabel: "last 12 months",
    totals: (({ count, avg, median: med, totalARR }) => ({ count, avg, median: med, totalARR }))(agg(wonW)),
    segments, geo, regions, byAE,
    arrByTier: { months, tiers },
  };
}
