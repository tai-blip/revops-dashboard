// Payment Mix Report — computed from the "SOQL_PaymentMix" tab (won deals written
// daily by scripts/refresh-arr-from-sfdc.mjs). Reproduces the monthly RevOps
// "Payment Mix Monitoring Report":
//   New Business attributed by Owner, Renewals by Account Manager; payment terms
//   normalized to Annual / Quarterly / Monthly; ARR = convertCurrency(AnnualContractValueARR__c).
//   Scoping = ContractLiveDate. "Annual mix %" is share of ARR (not # deals).

type Row = (string | number | null)[];

const TERMS = ["Annual", "Quarterly", "Monthly"] as const;
type Term = (typeof TERMS)[number];

export type PaymentMix = {
  monthLabel: string;                 // e.g. "Jul 2026" (latest complete-ish month)
  headline: {
    nbAnnualDeals: number; nbTotalDeals: number; nbAnnualCash: number;
    renAnnualDeals: number; renTotalDeals: number; renAnnualCash: number;
    newArr: number; newAnnualPct: number;
    renArr: number; renAnnualPct: number;
    annualCashTotal: number;
  };
  byTerm: {                           // current month, per term, for NB and Renewals
    nb: { term: string; deals: number; arr: number }[];
    ren: { term: string; deals: number; arr: number }[];
  };
  momentum: {                         // Jan(current yr)→now × term, NB and Renewals
    months: string[];
    nb: { term: string; arr: number[]; pct: number[]; yoyArr: number[] }[];
    ren: { term: string; arr: number[]; pct: number[]; yoyArr: number[] }[];
  };
  flags: { type: "NB" | "Renewal"; rep: string; opp: string; term: string; arr: number }[]; // current-month non-annual
  aeBreakdown: { name: string; deals: number; newArr: number; annualPctArr: number; annualCash: number; avgAcv: number }[];
  csmBreakdown: { name: string; deals: number; renArr: number; annualPctArr: number; annualCash: number }[];
  upcoming: { account: string; csm: string; arr: number; prevTerm: string; convert: boolean; endDate: string }[];
  windowMonth: string;                // ISO YYYY-MM of the current month
};

const ms = (v: string | number | null): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Date.UTC(1899, 11, 30) + v * 86400000;
  const t = Date.parse(String(v).slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(t) ? null : t;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (y: number, m0: number) => `${MON[m0]} ${y}`;

export function computePaymentMix(rows: Row[]): PaymentMix | null {
  if (!rows || rows.length < 2) return null;
  const h = rows[0].map((x) => String(x ?? ""));
  const ci = (name: string) => h.findIndex((x) => x.toLowerCase() === name.toLowerCase());
  const cType = ci("Type"), cTerm = ci("Payment Term"), cArr = ci("ARR (USD)"), cOwner = ci("Owner"),
    cAm = ci("Account Manager"), cAcct = ci("Account"), cOpp = ci("Opportunity"),
    cLive = ci("ContractLiveDate"), cEnd = ci("ContractEndDate"), cPrev = ci("Prev Term (N-1)");
  if (cTerm === -1 || cArr === -1) return null;

  type Deal = {
    isNB: boolean; isRen: boolean; term: string; arr: number; owner: string; am: string;
    acct: string; opp: string; liveMs: number | null; endMs: number | null; prev: string;
  };
  const deals: Deal[] = rows.slice(1).filter((r) => r?.[cTerm] != null).map((r) => ({
    isNB: /New Business/i.test(String(r[cType] ?? "")),
    isRen: /Renewal/i.test(String(r[cType] ?? "")),
    term: String(r[cTerm] ?? ""),
    arr: Number(r[cArr] ?? 0),
    owner: String(r[cOwner] ?? ""),
    am: String(r[cAm] ?? ""),
    acct: String(r[cAcct] ?? ""),
    opp: String(r[cOpp] ?? ""),
    liveMs: ms(r[cLive]),
    endMs: ms(r[cEnd]),
    prev: String(r[cPrev] ?? ""),
  }));

  // Current month = the latest month with a live-dated deal, but never in the
  // future — contracts can carry a forward ContractLiveDate, which would otherwise
  // make the headline a sparse future month. Cap at the current calendar month.
  const liveMonths = deals.map((d) => d.liveMs).filter((v): v is number => v != null).sort((a, b) => a - b);
  if (!liveMonths.length) return null;
  const nowD = new Date();
  const capMs = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), 1);
  const latestDeal = liveMonths[liveMonths.length - 1];
  const last = new Date(Math.min(latestDeal, capMs));
  const curY = last.getUTCFullYear(), curM = last.getUTCMonth();
  const inMonth = (d: Deal, y: number, m0: number) =>
    d.liveMs != null && new Date(d.liveMs).getUTCFullYear() === y && new Date(d.liveMs).getUTCMonth() === m0;

  const termOf = (t: string): Term | null => (TERMS.includes(t as Term) ? (t as Term) : null);
  const sum = (list: Deal[]) => list.reduce((s, d) => s + d.arr, 0);
  const annualPct = (list: Deal[]) => {
    const tot = sum(list);
    return tot ? sum(list.filter((d) => d.term === "Annual")) / tot * 100 : 0;
  };

  // ---- Headline (current month) ----
  const cur = deals.filter((d) => inMonth(d, curY, curM));
  const nbCur = cur.filter((d) => d.isNB), renCur = cur.filter((d) => d.isRen);
  const headline = {
    nbAnnualDeals: nbCur.filter((d) => d.term === "Annual").length, nbTotalDeals: nbCur.length,
    nbAnnualCash: sum(nbCur.filter((d) => d.term === "Annual")),
    renAnnualDeals: renCur.filter((d) => d.term === "Annual").length, renTotalDeals: renCur.length,
    renAnnualCash: sum(renCur.filter((d) => d.term === "Annual")),
    newArr: sum(nbCur), newAnnualPct: annualPct(nbCur),
    renArr: sum(renCur), renAnnualPct: annualPct(renCur),
    annualCashTotal: sum(cur.filter((d) => d.term === "Annual")),
  };

  // ---- By term (current month) ----
  const termTable = (list: Deal[]) =>
    TERMS.map((t) => ({ term: t, deals: list.filter((d) => d.term === t).length, arr: sum(list.filter((d) => d.term === t)) }));
  const byTerm = { nb: termTable(nbCur), ren: termTable(renCur) };

  // ---- Momentum: Jan (current year) → current month, per type × term.
  //      arr = $ that month on that term; pct = that term's share of the type's ARR
  //      that month; yoyArr = same month one year earlier (for YoY delta). ----
  const ytdM: { y: number; m0: number }[] = [];
  for (let m0 = 0; m0 <= curM; m0++) ytdM.push({ y: curY, m0 });
  const momentumFor = (pred: (d: Deal) => boolean) =>
    TERMS.map((t) => ({
      term: t,
      arr: ytdM.map(({ y, m0 }) => sum(deals.filter((d) => pred(d) && d.term === t && inMonth(d, y, m0)))),
      pct: ytdM.map(({ y, m0 }) => {
        const tot = sum(deals.filter((d) => pred(d) && inMonth(d, y, m0)));
        return tot ? sum(deals.filter((d) => pred(d) && d.term === t && inMonth(d, y, m0))) / tot * 100 : 0;
      }),
      yoyArr: ytdM.map(({ y, m0 }) => sum(deals.filter((d) => pred(d) && d.term === t && inMonth(d, y - 1, m0)))),
    }));
  const momentum = {
    months: ytdM.map(({ y, m0 }) => label(y, m0)),
    nb: momentumFor((d) => d.isNB),
    ren: momentumFor((d) => d.isRen),
  };

  // ---- Flags: current-month non-annual deals ----
  const flags = cur
    .filter((d) => d.term === "Quarterly" || d.term === "Monthly")
    .map((d) => ({ type: (d.isNB ? "NB" : "Renewal") as "NB" | "Renewal", rep: d.isNB ? d.owner : d.am, opp: d.opp, term: d.term, arr: d.arr }))
    .sort((a, b) => b.arr - a.arr);

  // ---- YTD breakdowns (Jan 1 of current year → now) ----
  const ytdStart = Date.UTC(curY, 0, 1);
  const ytd = deals.filter((d) => d.liveMs != null && d.liveMs >= ytdStart);
  const groupBy = (list: Deal[], key: (d: Deal) => string) => {
    const m = new Map<string, Deal[]>();
    for (const d of list) { const k = key(d) || "(unassigned)"; (m.get(k) ?? m.set(k, []).get(k)!).push(d); }
    return m;
  };
  // AE view excludes departed/non-AE owners (Tai's call); CSM view excludes the
  // "System" automation user (auto-renewals with no CSM assigned — see the report's
  // misattribution flag; it's not a real person).
  const AE_EXCLUDE = new Set(["Osman Mubarak", "Dorsa Mahmoudnia"]);
  const CSM_EXCLUDE = new Set(["System", "(unassigned)"]);
  const nbYtd = ytd.filter((d) => d.isNB);
  const aeBreakdown = [...groupBy(nbYtd, (d) => d.owner)].filter(([name]) => !AE_EXCLUDE.has(name)).map(([name, list]) => ({
    name, deals: list.length, newArr: sum(list), annualPctArr: annualPct(list),
    annualCash: sum(list.filter((d) => d.term === "Annual")), avgAcv: list.length ? sum(list) / list.length : 0,
  })).sort((a, b) => b.newArr - a.newArr);
  // Active AEs with zero won deals this year still belong on the roster (their
  // pipeline just hasn't gone live yet) — append them so no one looks "missing".
  const AE_ALWAYS_SHOW = ["Jill Bucci"];
  for (const name of AE_ALWAYS_SHOW) {
    if (!aeBreakdown.some((a) => a.name === name)) {
      aeBreakdown.push({ name, deals: 0, newArr: 0, annualPctArr: 0, annualCash: 0, avgAcv: 0 });
    }
  }
  const renYtd = ytd.filter((d) => d.isRen);
  const csmBreakdown = [...groupBy(renYtd, (d) => d.am)].filter(([name]) => !CSM_EXCLUDE.has(name)).map(([name, list]) => ({
    name, deals: list.length, renArr: sum(list), annualPctArr: annualPct(list),
    annualCash: sum(list.filter((d) => d.term === "Annual")),
  })).sort((a, b) => b.renArr - a.renArr);

  // ---- Upcoming renewals: next 90 days by ContractEndDate ----
  const now = Date.now(), in90 = now + 90 * 86400000;
  const upcoming = deals
    .filter((d) => d.isRen && d.endMs != null && d.endMs >= now && d.endMs <= in90)
    .map((d) => ({
      account: d.acct || d.opp, csm: d.am, arr: d.arr, prevTerm: d.prev || d.term,
      convert: (d.prev || d.term) === "Monthly" || (d.prev || d.term) === "Quarterly",
      endDate: d.endMs != null ? new Date(d.endMs).toISOString().slice(0, 10) : "",
    }))
    .sort((a, b) => b.arr - a.arr)
    .slice(0, 10);

  return {
    monthLabel: label(curY, curM),
    windowMonth: `${curY}-${String(curM + 1).padStart(2, "0")}`,
    headline, byTerm, momentum, flags, aeBreakdown, csmBreakdown, upcoming,
  };
}
