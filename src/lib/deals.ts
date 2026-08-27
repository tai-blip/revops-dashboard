// Deal-level parsing and calculations, ported from the original dashboard's logic.
// Sources: "Query 1" (open pipeline) and "Query 2" (18-month closed history).

type Row = (string | number | boolean | null)[];

// A sheet date cell (serial number, or an ISO-ish string) as a plain "YYYY-MM-DD", or "" when
// the cell is blank or unparseable. Exported so API routes can read date columns the same way
// the parsers here do, instead of each growing its own copy.
export function sheetDateToIso(v: unknown): string {
  const d = sheetsSerialToDate(v);
  return d ? d.toISOString().slice(0, 10) : "";
}

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

// Booking report (Stephen item 2): deals that are BOOKED (Closed Won / Billing) but have
// NOT yet gone live — no ContractLiveDate, or a ContractLiveDate still in the future. The
// bridge between what Sales closed and what's actually turned on. From SOQL_ClosedDeals.
export type BookingDeal = { name: string; owner: string; stage: string; arr: number; signedDate: string; liveDate: string; type: "NB" | "Exp" };
// Booked-but-not-live report. Per Stephen: Booked ARR = Live ARR + these not-yet-live
// deals. Scope = New Business (mainly) + Expansion — Renewals excluded (they don't add
// booked ARR). Each deal is a signed Billing/Closed Won opp whose ContractLiveDate is
// unset or still in the future.
export function computeBookingReport(rows: Row[]): { total: number; nb: number; exp: number; count: number; deals: BookingDeal[] } {
  const empty = { total: 0, nb: 0, exp: 0, count: 0, deals: [] as BookingDeal[] };
  if (!rows || rows.length < 2) return empty;
  const h = rows[0].map((x) => String(x ?? "").toLowerCase());
  const ci = (n: string) => h.findIndex((x) => x === n.toLowerCase());
  const cStage = ci("Stage"), cArr = ci("ARR (USD)"), cLive = ci("ContractLiveDate"),
    cOpp = ci("Opportunity"), cOwner = ci("Owner"), cWon = ci("Date Reached Closed Won"),
    cType = ci("RecordType") >= 0 ? ci("RecordType") : ci("Type");
  if (cStage < 0 || cArr < 0 || cLive < 0) return empty;
  const now = Date.now();
  const iso = (v: unknown) => { const d = sheetsSerialToDate(v); return d ? d.toISOString().slice(0, 10) : ""; };
  const deals: BookingDeal[] = rows.slice(1)
    .filter((r) => {
      if (!/Billing|Closed Won/i.test(String(r[cStage] ?? ""))) return false;
      const rt = String(r[cType] ?? "");
      // New Business + Expansion only — drop Renewals (and anything not NB/Exp).
      if (!/New Business|Expansion/i.test(rt)) return false;
      const d = sheetsSerialToDate(r[cLive]);
      return d == null || d.getTime() > now; // no live date, or live date in the future
    })
    .map((r) => ({
      name: String(r[cOpp] ?? ""), owner: String(r[cOwner] ?? ""), stage: String(r[cStage] ?? ""),
      arr: Number(r[cArr] ?? 0), signedDate: cWon >= 0 ? iso(r[cWon]) : "", liveDate: iso(r[cLive]),
      type: /Expansion/i.test(String(r[cType] ?? "")) ? "Exp" as const : "NB" as const,
    }))
    .filter((d) => d.arr > 0)
    .sort((a, b) => b.arr - a.arr);
  const nb = deals.filter((d) => d.type === "NB").reduce((s, d) => s + d.arr, 0);
  const exp = deals.filter((d) => d.type === "Exp").reduce((s, d) => s + d.arr, 0);
  return { total: nb + exp, nb, exp, count: deals.length, deals };
}

// Bookings vs Arrivals (Sai's cash-flow lens). For a quarter [qStart, qEnd):
//   • Signed  = ARR of won/billing NB+Exp deals whose SIGNED date (Date Reached Closed
//     Won, else CloseDate) falls in the quarter — "what got booked this quarter".
//   • Live    = ARR whose ContractLiveDate falls in the quarter — "what actually goes
//     live / cash arrives this quarter" (live-and-paying, not signed).
// Signed-but-not-live (signed in-quarter, live date after qEnd or unset) is the timing
// spillover that distorts burn if you look at signings alone. Per owner + team totals.
export type SignedLiveRow = { owner: string; signed: number; live: number; signedNotLive: number };
export function computeSignedLiveForecast(rows: Row[], qStart: string, qEnd: string): { byOwner: Record<string, SignedLiveRow>; total: SignedLiveRow } {
  const total: SignedLiveRow = { owner: "", signed: 0, live: 0, signedNotLive: 0 };
  const byOwner: Record<string, SignedLiveRow> = {};
  if (!rows || rows.length < 2) return { byOwner, total };
  const h = rows[0].map((x) => String(x ?? "").toLowerCase());
  const ci = (n: string) => h.findIndex((x) => x === n.toLowerCase());
  const cStage = ci("Stage"), cArr = ci("ARR (USD)"), cLive = ci("ContractLiveDate"),
    cOwner = ci("Owner"), cWon = ci("Date Reached Closed Won"), cClose = ci("CloseDate"),
    cType = ci("RecordType") >= 0 ? ci("RecordType") : ci("Type");
  if (cStage < 0 || cArr < 0 || cLive < 0) return { byOwner, total };
  const iso = (v: unknown) => { const d = sheetsSerialToDate(v); return d ? d.toISOString().slice(0, 10) : ""; };
  const inQ = (d: string) => d !== "" && d >= qStart && d < qEnd;
  for (const r of rows.slice(1)) {
    if (!/Billing|Closed Won/i.test(String(r[cStage] ?? ""))) continue;
    if (!/New Business|Expansion/i.test(String(r[cType] ?? ""))) continue;
    const arr = Number(r[cArr] ?? 0);
    if (!(arr > 0)) continue;
    const owner = String(r[cOwner] ?? "");
    const signed = cWon >= 0 && iso(r[cWon]) ? iso(r[cWon]) : cClose >= 0 ? iso(r[cClose]) : "";
    const live = iso(r[cLive]);
    byOwner[owner] ??= { owner, signed: 0, live: 0, signedNotLive: 0 };
    if (inQ(signed)) { byOwner[owner].signed += arr; total.signed += arr; if (!inQ(live)) { byOwner[owner].signedNotLive += arr; total.signedNotLive += arr; } }
    if (inQ(live)) { byOwner[owner].live += arr; total.live += arr; }
  }
  return { byOwner, total };
}

// Cash-flow FORECAST (Sai's lens) from the isolated Cash_Forecast tab. Deals that are
// signed/committed but not yet paying — Stage in {Closed Won, Billing, Trial}, no Live
// Paying Date, status not churned/paused — are forecast to turn into cash at their live
// date + 45 days. Rip & Replace/LOC deals anchor
// on Contract_Live_Date_Rip_Replace_LOC__c + 45 instead, and are tagged kind:"rr" so the
// UI can break them out. Already-paying deals (Live Paying Date set) are Live ARR, not here.
// Returns deal-level events (UI filters/aggregates by AE, month, and RR-vs-standard).
const CF_STAGES = new Set(["Closed Won", "Billing", "Trial"]);
const CF_EXCLUDE_STATUS = new Set(["Contracts Ended (Churned)", "Contract Paused"]);
export type CashForecastEvent = { owner: string; name: string; ym: string; arr: number; kind: "rr" | "std" };
export type CashForecast = { events: CashForecastEvent[]; owners: string[]; total: number; rrTotal: number; stdTotal: number };
// Pipeline generated by AE — computed in CODE (not the drift-prone Pipeline-WoW MoM tab) directly
// from the open (Query 1) + closed (Query 2) pulls: every opp whose Date_Reached_SQL falls in the
// quarter window, by its Annual_Contract_Value_ARR_Formula__c (= Amount/TCV), attributed to Owner.
// Includes OPEN and CLOSED-LOST opps (Closed Won excluded); the labeled month always = the summed
// month, so it can't drift. Total ties to the Command "Created in Q3" headline.
export type PipelineGen = { byOwner: Record<string, { arr: number; count: number }>; total: number; totalCount: number };
export function computePipelineGenByAE(openRows: Row[], closedRows: Row[], qStart: string, qEnd: string): PipelineGen {
  const byOwner: Record<string, { arr: number; count: number }> = {};
  const add = (owner: string, arr: number) => { if (!owner) return; const o = (byOwner[owner] ??= { arr: 0, count: 0 }); o.arr += arr; o.count += 1; };
  const inQ = (v: unknown) => { const d = sheetsSerialToDate(v); if (!d) return false; const iso = d.toISOString().slice(0, 10); return iso >= qStart && iso <= qEnd; };
  // Tabs may carry a banner in row 0; locate the header row by its Owner column.
  const header = (rows: Row[]) => {
    if (!rows || rows.length < 2) return null;
    const i = rows.findIndex((r) => r.some((c) => /^owner(\.name)?$/i.test(String(c ?? "").trim())));
    if (i < 0) return null;
    const h = rows[i].map((x) => String(x ?? "").toLowerCase());
    return { i, ci: (n: string) => h.indexOf(n.toLowerCase()) };
  };
  // OPEN pipeline (Query 1): Date_Reached_SQL in the quarter, valued by the ARR-formula (= Amount/TCV).
  const H1 = header(openRows);
  if (H1) {
    const cSql = H1.ci("Date_Reached_SQL__c"), cVal = H1.ci("Annual_Contract_Value_ARR_Formula__c"), cOwner = H1.ci("Owner.Name");
    if (cSql >= 0 && cVal >= 0 && cOwner >= 0) for (const r of openRows.slice(H1.i + 1)) {
      if (inQ(r[cSql])) add(String(r[cOwner] ?? "").trim(), Number(r[cVal]) || 0);
    }
  }
  // CLOSED-LOST (SOQL_ClosedDeals — fresh, all closed): Outcome = Lost, SQL in the quarter, by Amount
  // (falls back to the raw "ARR (USD)" until the Amount column is populated by the nightly refresh).
  const H2 = header(closedRows);
  if (H2) {
    const cSql = H2.ci("Date Reached SQL"), cAmt = H2.ci("Amount"), cArr = H2.ci("ARR (USD)"), cOwner = H2.ci("Owner"), cOut = H2.ci("Outcome");
    if (cSql >= 0 && cOwner >= 0 && cOut >= 0) for (const r of closedRows.slice(H2.i + 1)) {
      if (!/lost/i.test(String(r[cOut] ?? ""))) continue;
      if (!inQ(r[cSql])) continue;
      const val = (cAmt >= 0 ? Number(r[cAmt]) || 0 : 0) || (cArr >= 0 ? Number(r[cArr]) || 0 : 0);
      add(String(r[cOwner] ?? "").trim(), val);
    }
  }
  const total = Object.values(byOwner).reduce((s, o) => s + o.arr, 0);
  const totalCount = Object.values(byOwner).reduce((s, o) => s + o.count, 0);
  return { byOwner, total, totalCount };
}

export function computeCashForecast(rows: Row[]): CashForecast {
  const empty: CashForecast = { events: [], owners: [], total: 0, rrTotal: 0, stdTotal: 0 };
  if (!rows || rows.length < 2) return empty;
  const h = rows[0].map((x) => String(x ?? "").toLowerCase());
  const ci = (n: string) => h.findIndex((x) => x === n.toLowerCase());
  const cStage = ci("Stage"), cStatus = ci("Status"), cArr = ci("ARR (USD)"),
    cLive = ci("ContractLiveDate"), cRR = ci("RR LOC Date"), cLPD = ci("Live Paying Date"),
    cOwner = ci("Owner"), cOpp = ci("Opportunity"), cTerm = ci("PaymentTerms");
  if (cStage < 0 || cArr < 0 || cLive < 0 || cLPD < 0) return empty;
  const ymOf = (d: Date) => d.toISOString().slice(0, 7);
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
  const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
  // Billing cadence → cycles/yr: Monthly 12, Quarterly 4, Annual/Bi-Annual/blank 1. Each deal's
  // annual ARR is billed in `cycles` equal installments (ARR/cycles), one per cycle from first pay.
  const cyclesOf = (t: string) => { const s = t.toLowerCase(); return s.includes("month") ? 12 : s.includes("quarter") ? 4 : 1; };

  const events: CashForecastEvent[] = [];
  const owners = new Set<string>();
  let rrTotal = 0, stdTotal = 0;
  for (const r of rows.slice(1)) {
    if (!CF_STAGES.has(String(r[cStage] ?? ""))) continue;              // Closed Won + Billing + Trial
    if (CF_EXCLUDE_STATUS.has(String(r[cStatus] ?? ""))) continue;       // drop churned/paused
    if (sheetsSerialToDate(r[cLPD])) continue;                          // already has a Live Paying Date → paying, not a forecast
    const arr = Number(r[cArr] ?? 0);
    if (!(arr > 0)) continue;
    const rr = cRR >= 0 ? sheetsSerialToDate(r[cRR]) : null;
    const anchor = rr ?? sheetsSerialToDate(r[cLive]);                   // Rip & Replace/LOC date wins
    if (!anchor) continue;
    const kind: "rr" | "std" = rr ? "rr" : "std";
    const owner = String(r[cOwner] ?? ""), name = cOpp >= 0 ? String(r[cOpp] ?? "") : "";
    // Split the ARR into billing installments per payment term, first payment at go-live + 45 days.
    const cycles = cyclesOf(cTerm >= 0 ? String(r[cTerm] ?? "") : "");
    const perCycle = arr / cycles, monthsPerCycle = 12 / cycles;
    const firstPay = addDays(anchor, 45);
    for (let c = 0; c < cycles; c++) {
      events.push({ owner, name, ym: ymOf(addMonths(firstPay, Math.round(c * monthsPerCycle))), arr: perCycle, kind });
    }
    owners.add(owner);
    if (kind === "rr") rrTotal += arr; else stdTotal += arr;
  }
  return { events, owners: [...owners].filter(Boolean).sort(), total: rrTotal + stdTotal, rrTotal, stdTotal };
}

// Predicted CASHFLOW by ARR tier — when each tier's ARR is forecast to be COLLECTED as cash.
// Rules (Tai, 2026-08-18) — forward GROWTH of each tier's ARR from its current level:
//   • Contracted = current Contracted ARR + each Booked pilot converting in at Trial-End + 15d (nego).
//   • Live       = current Live-paying ARR + each Contracted deal going live-paying at
//                  (R&R ?? Contract-Live) + 45d (billing). Overdue arrivals land in the current month.
//   • Booked is NOT forecast (too speculative) — its total is returned only as snapshot context.
// Reads the ARR_Funnel tab's own "Tier (today)" (col P) so tiers match the funnel exactly.
const NET_TERM_DAYS = 45; // billing: Contracted → Live-paying
const NEGO_DAYS = 15;     // negotiation: Booked (pilot ended) → Contracted
export type CashTierPoint = { ym: string; label: string; contracted: number; live: number };
export type CashDeal = { tier: "contracted" | "live"; opp: string; account: string; owner: string; arr: number; arriveYm: string; arriveDate: string; basis: string };
export type PredictedCashflow = { months: CashTierPoint[]; baseline: { contracted: number; live: number }; booked: number; deals: CashDeal[] };
export function computePredictedCashflow(rows: Row[]): PredictedCashflow {
  const empty: PredictedCashflow = { months: [], baseline: { contracted: 0, live: 0 }, booked: 0, deals: [] };
  if (!rows || rows.length < 2) return empty;
  const h = rows[0].map((x) => String(x ?? "").toLowerCase());
  const ci = (n: string) => h.findIndex((x) => x === n.toLowerCase());
  const cArr = ci("ARR (USD)"), cTier = ci("Tier (today)"), cLive = ci("LiveDate"),
    cRR = ci("RRDate"), cPilotEnd = ci("PilotEndDate"),
    cOpp = ci("Opportunity"), cAcct = ci("Account"), cOwner = ci("Owner");
  if (cArr < 0 || cTier < 0) return empty;
  const iso = (v: unknown) => { const d = sheetsSerialToDate(v); return d ? d : null; };
  const isoStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
  const ymOf = (d: Date) => d.toISOString().slice(0, 7);
  const curYm = new Date().toISOString().slice(0, 7);

  let baseContracted = 0, baseLive = 0, booked = 0;
  const contractedIn: Record<string, number> = {}; // ym -> ARR (Booked → Contracted)
  const liveIn: Record<string, number> = {};       // ym -> ARR (Contracted → Live)
  const deals: CashDeal[] = [];
  for (const r of rows.slice(1)) {
    const arr = Number(r[cArr] ?? 0);
    if (!(arr > 0)) continue;
    const tier = String(r[cTier] ?? "");
    const base = { opp: cOpp >= 0 ? String(r[cOpp] ?? "") : "", account: cAcct >= 0 ? String(r[cAcct] ?? "") : "", owner: (cOwner >= 0 ? String(r[cOwner] ?? "") : "").split(" ")[0], arr };
    const rr = cRR >= 0 ? iso(r[cRR]) : null;
    const live = cLive >= 0 ? iso(r[cLive]) : null;
    const pilotEnd = cPilotEnd >= 0 ? iso(r[cPilotEnd]) : null;
    if (tier === "Live") baseLive += arr;
    else if (tier === "Contracted") {
      baseContracted += arr;
      const anchor = rr ?? live;
      if (anchor) {
        const a = addDays(anchor, NET_TERM_DAYS);
        let ym = ymOf(a); if (ym < curYm) ym = curYm;               // overdue → lands this month
        liveIn[ym] = (liveIn[ym] ?? 0) + arr;
        deals.push({ tier: "live", ...base, arriveYm: ym, arriveDate: isoStr(a), basis: (rr ? "R&R" : "Contract Live") + " + 45d" });
      }
    } else if (tier === "Booked") {
      booked += arr;
      if (pilotEnd) {
        const a = addDays(pilotEnd, NEGO_DAYS);
        let ym = ymOf(a); if (ym < curYm) ym = curYm;
        contractedIn[ym] = (contractedIn[ym] ?? 0) + arr;
        deals.push({ tier: "contracted", ...base, arriveYm: ym, arriveDate: isoStr(a), basis: "Trial End + 15d" });
      }
    }
  }
  // Cumulative forward from the current month (baseline-anchored), ~18 months out.
  const grid: string[] = [];
  { let y = +curYm.slice(0, 4), m = +curYm.slice(5, 7); for (let i = 0; i < 19; i++) { grid.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } }
  let cumC = baseContracted, cumL = baseLive;
  const months = grid.map((ym) => {
    cumC += contractedIn[ym] ?? 0;
    cumL += liveIn[ym] ?? 0;
    const [y, m] = ym.split("-");
    const label = new Date(Date.UTC(+y, +m - 1, 1)).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
    return { ym, label, contracted: cumC, live: cumL };
  });
  deals.sort((a, b) => b.arr - a.arr);
  return { months, baseline: { contracted: baseContracted, live: baseLive }, booked, deals };
}

// Three-tier ARR funnel MoM (from the ARR_Funnel tab), point-in-time stock — ARR sitting
// IN each tier at month-end (interval logic). Tai's naming, 2026-08-27; the internal keys keep
// the old words so the sheet parsing and every drill-down id stay put:
//   • booked     → "Pilot":    in Trial. Trial date reached, not yet signed / live / lost.
//   • contracted → "Invoiced": contract-LIVE but not yet paying. ContractLiveDate ≤ M, no Live
//       Paying Date, contract not ended, not churned. (R&R / timing gap before first payment.)
//   • live       → "Billed":   paying. Live Paying Date ≤ M, contract not ended, not churned.
// Invoiced + Billed = "Live ARR", the whole signed contract-live book — the figure the Command
// tab headline reports. Live ARR + Pilot = "Booked Pilot". Window is fixed Jan-2026 → now.
const FUNNEL_CHURN = new Set(["Contracts Ended (Churned)", "Contract Paused"]);
export type FunnelPoint = {
  ym: string; label: string; booked: number; contracted: number; contractedRenewal: number; contractedNewExp: number; live: number; churn: number;
  bToC: number; cToL: number; bToLost: number;
  // Full reconciliation flows so each tier's level ties out exactly month-to-month:
  //   Booked[M]     = Booked[M-1] + bNew − bToC − bToLive − bToLost − bDrop
  //   Contracted[M] = Contracted[M-1] + bToC + cNewSigned − cToL − cLeak
  //   Live[M]       = Live[M-1] + cToL + lNewDirect − lChurn
  bNew: number;       // entered Booked (new pilot) this month
  bToLive: number;    // Booked → Live in one month (signed + started paying same month; a good exit)
  bDrop: number;      // left Booked to "" WITHOUT a lost date this month (rolled back to SQO/SAL, etc.)
  cNewSigned: number; // signed deals that entered Contracted directly (never a tracked pilot)
  cLeak: number;      // left Contracted to lost/churn/dropped (not to Live)
  lNewDirect: number; // entered Live directly (from Booked or brand-new), not via Contracted
  lChurn: number;     // left Live (churn / contract ended)
  // Two roll-ups over the tiers above, named for the vocabulary Tai and finance use:
  //   liveArr    = Invoiced + Billed — the whole signed contract-live book, whether or not
  //                payment has started. This is the number the Command tab calls Live ARR.
  //   bookedPilot = Live ARR + Pilot — the same book plus what is still in pilot.
  liveArr: number;
  bookedPilot: number;
  ids: Partial<Record<FunnelBucket, number[]>>; // deals behind each number above (→ dealIndex)
};
// Every number in the funnel table is a set of deals; these are the sets, so the dashboard can
// show "which deals" for any cell without recomputing anything. Stored as indices into
// ArrFunnel.dealIndex (a deal appears in many months, so repeating the object would bloat the
// payload). Level buckets are point-in-time membership; flow buckets are what moved that month.
export type FunnelBucket =
  | "booked" | "contracted" | "contractedRenewal" | "contractedNewExp" | "live" | "churn"
  | "liveArr" | "bookedPilot"
  | "bToC" | "cToL" | "bToLost" | "bNew" | "bToLive" | "bDrop" | "cNewSigned" | "cLeak" | "lNewDirect" | "lChurn";
export type FunnelDeal = { account: string; opp: string; owner: string; am: string; type: string; rr: boolean; arr: number; stage: string; trial: string; liveDate: string; livePay: string; end: string; lost: string };
export type ArrFunnel = { stock: FunnelPoint[]; dealIndex: FunnelDeal[] };
export function computeArrFunnel(rows: Row[]): ArrFunnel {
  const empty: ArrFunnel = { stock: [], dealIndex: [] };
  if (!rows || rows.length < 2) return empty;
  const h = rows[0].map((x) => String(x ?? "").toLowerCase());
  const ci = (n: string) => h.findIndex((x) => x === n.toLowerCase());
  const cArr = ci("ARR (USD)"), cStatus = ci("Status"), cStage = ci("Stage"), cTrial = ci("TrialDate"), cSigned = ci("SignedDate"),
    cLiveDate = ci("LiveDate"), cLivePay = ci("LivePayingDate"), cLost = ci("LostDate"), cEnd = ci("EndDate"),
    cAcct = ci("Account"), cOwner = ci("Owner"), cOpp = ci("Opportunity"), cAM = ci("AM"), cType = ci("Type"), cRR = ci("RRDate"),
    cPilot = ci("Pilot Start Date");
  if (cArr < 0 || cTrial < 0 || cLiveDate < 0 || cLivePay < 0) return empty;
  const iso = (v: unknown) => { const d = sheetsSerialToDate(v); return d ? d.toISOString().slice(0, 10) : ""; };
  // Contracted/Live count only signed contracts (Billing / Closed Won stage) — same basis as
  // finance's book. This drops renewal-stage opps (e.g. Renewal Pending) that share the
  // account's contract-live date but aren't the active paying contract (double-counts).
  const isSigned = (s: string) => s === "Billing" || s === "Closed Won";

  type D = { arr: number; churn: boolean; signed_stage: boolean; stage: string; pilotStart: string; trial: string; signed: string; liveDate: string; livePay: string; lost: string; end: string; account: string; owner: string; opp: string; am: string; type: string; rr: boolean };
  const deals: D[] = [];
  for (const r of rows.slice(1)) {
    const arr = Number(r[cArr] ?? 0);
    if (typeof r[cArr] !== "number" || arr < 0) continue; // ARR >= 0 (keep $0 pilots; drop blank/non-numeric)
    deals.push({
      arr, churn: FUNNEL_CHURN.has(String(r[cStatus] ?? "")), signed_stage: isSigned(String(r[cStage] ?? "")),
      stage: String(r[cStage] ?? ""), pilotStart: cPilot >= 0 ? iso(r[cPilot]) : "",
      trial: iso(r[cTrial]), signed: cSigned >= 0 ? iso(r[cSigned]) : "", liveDate: iso(r[cLiveDate]),
      livePay: iso(r[cLivePay]), lost: cLost >= 0 ? iso(r[cLost]) : "", end: cEnd >= 0 ? iso(r[cEnd]) : "",
      account: cAcct >= 0 ? String(r[cAcct] ?? "") : "", owner: cOwner >= 0 ? String(r[cOwner] ?? "") : "",
      opp: cOpp >= 0 ? String(r[cOpp] ?? "") : "", am: cAM >= 0 ? String(r[cAM] ?? "") : "",
      type: cType >= 0 ? String(r[cType] ?? "") : "", rr: cRR >= 0 ? iso(r[cRR]) !== "" : false,
    });
  }

  const now = new Date();
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const todayISO = now.toISOString().slice(0, 10);
  const stock: FunnelPoint[] = [];
  // Track each deal's tier from the prior month so we can tally the $ that moved Booked→Contracted
  // and Contracted→Live between consecutive months.
  const prevTier: string[] = new Array(deals.length).fill("");
  let firstMonth = true;
  // Fixed window: Jan 2026 → current month. Past months snapshot at month-end; the CURRENT
  // (incomplete) month snapshots as-of-today, so contracts whose term ends later this month
  // aren't pre-dropped while they're still live — and it ties to finance's today snapshot.
  for (let m = new Date(Date.UTC(2026, 0, 1)); m <= cur; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const isCurrent = m.getUTCFullYear() === cur.getUTCFullYear() && m.getUTCMonth() === cur.getUTCMonth();
    const me = isCurrent ? todayISO : new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); // as-of-today for current month, else month-end
    const ym = m.toISOString().slice(0, 7);
    const first = m.toISOString().slice(0, 10); // first of month
    const label = m.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
    const before = (d: string) => d !== "" && d <= me;   // happened on/before month-end
    const after = (d: string) => d === "" || d > me;      // not yet, as of month-end
    // Tier of a deal at this month-end (priority Live > Contracted > Booked). Booked (concluded):
    // current month = actively in pilot (Stage = Trial + Pilot Start set); past months keep the
    // date-based reconstruction (historical stage is unrecoverable) + the Pilot-Start gate.
    const tierOf = (d: D): "" | "Booked" | "Contracted" | "Live" => {
      if (d.signed_stage && before(d.livePay) && after(d.end) && !d.churn) return "Live";
      if (d.signed_stage && before(d.liveDate) && after(d.livePay) && after(d.end) && after(d.lost) && !d.churn) return "Contracted";
      const booked = isCurrent ? (d.stage === "Trial" && d.pilotStart !== "")
                               : (d.pilotStart !== "" && before(d.trial) && after(d.liveDate) && after(d.livePay) && after(d.lost));
      return booked ? "Booked" : "";
    };
    let sB = 0, sC = 0, sCRenew = 0, sCNew = 0, sL = 0, sChurn = 0, bToC = 0, cToL = 0, bToLost = 0, bNew = 0, bToLive = 0, bDrop = 0, cNewSigned = 0, cLeak = 0, lNewDirect = 0, lChurn = 0;
    // Record WHICH deals land in each bucket alongside the sum, so a click can list them.
    const ids: Partial<Record<FunnelBucket, number[]>> = {};
    const tag = (b: FunnelBucket, di: number) => { (ids[b] ??= []).push(di); };
    deals.forEach((d, di) => {
      const t = tierOf(d);
      const p = prevTier[di];
      if (t === "Booked") { sB += d.arr; tag("booked", di); }
      else if (t === "Contracted") { sC += d.arr; tag("contracted", di); if (/renew/i.test(d.type)) { sCRenew += d.arr; tag("contractedRenewal", di); } else { sCNew += d.arr; tag("contractedNewExp", di); } } // split by deal Type
      else if (t === "Live") { sL += d.arr; tag("live", di); }
      if (d.churn && d.end >= first && d.end <= me) { sChurn += d.arr; tag("churn", di); }                                                   // churned/paused, contract ended this month
      if (!firstMonth) {                                                                                               // $ that moved tier vs the prior month
        // Booked reconciliation — the four ways a pilot can leave the tier, tracked separately.
        const bookedLostThisMo = d.lost !== "" && d.lost >= first && d.lost <= me;
        if (t === "Booked" && p !== "Booked") { bNew += d.arr; tag("bNew", di); }                                                          // entered Booked (new pilot)
        if (p === "Booked" && t === "Contracted") { bToC += d.arr; tag("bToC", di); }                                                      // → Contracted (signed, not paying)
        if (p === "Booked" && t === "Live") { bToLive += d.arr; tag("bToLive", di); }                                                         // → Live in one month (good exit)
        if (p === "Booked" && bookedLostThisMo) { bToLost += d.arr; tag("bToLost", di); }                                                     // → Closed Lost this month
        if (p === "Booked" && t === "" && !bookedLostThisMo) { bDrop += d.arr; tag("bDrop", di); }                                          // dropped (rolled back to SQO/SAL, etc.)
        if (p === "Contracted" && t === "Live") { cToL += d.arr; tag("cToL", di); }
        // Contracted reconciliation: everything else that moved its level.
        if (t === "Contracted" && p !== "Contracted" && p !== "Booked") { cNewSigned += d.arr; tag("cNewSigned", di); }                          // entered Contracted directly (new sign)
        if (p === "Contracted" && t !== "Contracted" && t !== "Live") { cLeak += d.arr; tag("cLeak", di); }                                 // left Contracted to lost/churn/dropped
        // Live reconciliation.
        if (t === "Live" && p !== "Live" && p !== "Contracted") { lNewDirect += d.arr; tag("lNewDirect", di); }                                  // entered Live directly (from Booked / brand-new)
        if (p === "Live" && t !== "Live") { lChurn += d.arr; tag("lChurn", di); }                                                            // left Live (churn / ended)
      }
      prevTier[di] = t;
    });
    firstMonth = false;
    // The two roll-ups. A deal is in exactly one tier at a time, so the tiers never overlap and
    // the roll-up is the concatenation of their deal sets — which is what makes them clickable.
    ids.liveArr = [...(ids.contracted ?? []), ...(ids.live ?? [])];
    ids.bookedPilot = [...ids.liveArr, ...(ids.booked ?? [])];
    stock.push({ ym, label, booked: sB, contracted: sC, contractedRenewal: sCRenew, contractedNewExp: sCNew, live: sL, churn: sChurn, bToC, cToL, bToLost, bNew, bToLive, bDrop, cNewSigned, cLeak, lNewDirect, lChurn, liveArr: sC + sL, bookedPilot: sC + sL + sB, ids });
  }

  // Compact the deal references: only deals that appear in at least one bucket are sent, and
  // each bucket's raw row numbers are remapped onto that shorter list. 1700 sheet rows × 8 months
  // of repeated objects would otherwise dominate the API payload.
  const remap = new Map<number, number>();
  const dealIndex: FunnelDeal[] = [];
  for (const p of stock) {
    for (const key of Object.keys(p.ids) as FunnelBucket[]) {
      p.ids[key] = (p.ids[key] ?? []).map((di) => {
        let ni = remap.get(di);
        if (ni === undefined) {
          const d = deals[di];
          ni = dealIndex.push({
            account: d.account || d.opp, opp: d.opp, owner: d.owner.split(" ")[0], am: d.am.split(" ")[0],
            type: d.type, rr: d.rr, arr: d.arr, stage: d.stage, trial: d.trial, liveDate: d.liveDate,
            livePay: d.livePay, end: d.end, lost: d.lost,
          }) - 1;
          remap.set(di, ni);
        }
        return ni;
      });
    }
  }

  return { stock, dealIndex };
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
  amount: number;
  probQ: number; // AE/AM Probability - Quarter (%), 0–100
  probY: number; // AE/AM Probability - Year (%), 0–100
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
  const cAmount = colIdx(H, ["Amount"], -1);
  const cProbQ = colIdx(H, ["AE_AM_Probability__c", "AE/AM Probability - Quarter (%)"], -1);
  const cProbY = colIdx(H, ["AE_AM_Probability_Year__c", "AE/AM Probability - Year (%)"], -1);

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
      amount: Number(cell(r, cAmount) ?? 0),
      probQ: Number(cell(r, cProbQ) ?? 0),
      probY: Number(cell(r, cProbY) ?? 0),
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
  // Stage-based open potential = AE/AM probability × the right size field:
  // Early = SQL+SAL (Amount×%), Late = SQO+Trial (ARR×%). Q = quarter %, Y = year %.
  // *Sql = the SQL-only slice of Early, so the UI can subtract it when "exclude SQL" is on.
  potEarlyQ: number;
  potLateQ: number;
  potSqlQ: number;
  potEarlyY: number;
  potLateY: number;
  potSqlY: number;
  potential: number; // default: closedWon + potEarlyQ + potLateQ (quarter, incl SQL)
  variance: number | null;
  attainP: number | null;
};

// Open-pipeline stages that count toward Potential (Sai/Davi rule). Early stages use
// Amount × probability; late stages use ARR × probability.
const POT_EARLY_STAGES = new Set(["SQL", "SAL"]);
const POT_LATE_STAGES = new Set(["SQO", "Trial"]);

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
  stageRows?: ForecastingStageRow[],
  // Per-AE canonical Q3 New Business (official attainment actual). When present for an
  // owner, it overrides the sheet/close-date "Closed Won" so the Forecast tab matches
  // the AE Attainment tab. AMs/leads (absent here) keep their sheet-derived value.
  attByOwner?: Record<string, number>,
  // Sheet-calculated per-AE Potential components from the "Forecast Potential" tab. When
  // present for an owner, these SHEET formulas (live over the Query 1 pull) drive the
  // Potential columns instead of the in-code aggregation, so the math is auditable in the
  // sheet and a deal a rep has moved to 0% quarterly drops out at the source. Absent for
  // an owner → falls back to the in-code stage aggregation (unchanged behaviour).
  potSource?: Record<string, { earlyQ: number; lateQ: number; sqlQ: number; earlyY: number; lateY: number; sqlY: number }>
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

  type PotAgg = { pipe: number; earlyQ: number; lateQ: number; sqlQ: number; earlyY: number; lateY: number; sqlY: number };
  const openByOwner: Record<string, PotAgg> = {};
  for (const d of openDeals) {
    if (!rosterNames.has(d.owner)) continue;
    const o = (openByOwner[d.owner] ??= { pipe: 0, earlyQ: 0, lateQ: 0, sqlQ: 0, earlyY: 0, lateY: 0, sqlY: 0 });
    o.pipe += d.arr;
    if (isRenewalRt(d.recordType)) continue;
    const early = POT_EARLY_STAGES.has(d.stage);
    const late = POT_LATE_STAGES.has(d.stage);
    if (!early && !late) continue; // Potential = only SQL/SAL/SQO/Trial
    const size = early ? d.amount : d.arr; // SQL/SAL → Amount; SQO/Trial → ARR
    const wQ = size * (d.probQ / 100);
    const wY = size * (d.probY / 100);
    if (early) {
      o.earlyQ += wQ; o.earlyY += wY;
      if (d.stage === "SQL") { o.sqlQ += wQ; o.sqlY += wY; }
    } else {
      o.lateQ += wQ; o.lateY += wY;
    }
  }

  const rows: ForecastRow[] = roster.map((a) => {
    const s = sheetRows?.[a.name];
    const o = openByOwner[a.name];
    const cw =
      attByOwner?.[a.name] != null
        ? attByOwner[a.name]
        : s
        ? s.closedWon
        : (cwByOwner[a.name]?.nb ?? 0) + (cwByOwner[a.name]?.exp ?? 0);
    // Open pipeline stays sheet-derived when available (unchanged); potential is now
    // computed directly from open deals by stage, never from the sheet/expectedRevQ.
    const openPipe = s ? s.openPipe : o?.pipe ?? 0;
    // Prefer the sheet-calculated Potential (Forecast Potential tab) when present for this
    // owner; otherwise fall back to the in-code stage aggregation.
    const ps = potSource?.[a.name];
    const potEarlyQ = ps ? ps.earlyQ : o?.earlyQ ?? 0, potLateQ = ps ? ps.lateQ : o?.lateQ ?? 0, potSqlQ = ps ? ps.sqlQ : o?.sqlQ ?? 0;
    const potEarlyY = ps ? ps.earlyY : o?.earlyY ?? 0, potLateY = ps ? ps.lateY : o?.lateY ?? 0, potSqlY = ps ? ps.sqlY : o?.sqlY ?? 0;
    const potential = cw + potEarlyQ + potLateQ; // default: quarter, SQL included
    return {
      name: a.name,
      short: a.short,
      am: a.am,
      lead: a.lead ?? false,
      openPipe,
      quota: a.quota,
      closedWon: cw,
      potEarlyQ, potLateQ, potSqlQ,
      potEarlyY, potLateY, potSqlY,
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
      potEarlyQ: s("potEarlyQ"), potLateQ: s("potLateQ"), potSqlQ: s("potSqlQ"),
      potEarlyY: s("potEarlyY"), potLateY: s("potLateY"), potSqlY: s("potSqlY"),
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

  // "Deals that make the quarter" — filter by STAGE (SQL/SAL/SQO) and rank by the same
  // stage-based quarterly Potential ARR as the per-AE table: SQL/SAL use Amount×AE/AM%,
  // SQO uses ARR×AE/AM% (AE_AM_Probability__c). Shows deals that can realistically close.
  const DECIDE_STAGES = new Set(["SQL", "SAL", "SQO"]);
  const decideDeals = openDeals
    .filter((d) => rosterNames.has(d.owner) && DECIDE_STAGES.has(d.stage))
    .map((d) => {
      const ref = d.lastStageChangeDate ?? d.createdDate;
      const ageDays = ref ? Math.floor((now.getTime() - ref.getTime()) / 86400000) : null;
      const potARR = (POT_EARLY_STAGES.has(d.stage) ? d.amount : d.arr) * (d.probQ / 100);
      return { name: d.name, owner: d.owner, stage: d.stage, arr: d.arr, potARR, ageDays };
    })
    .filter((d) => d.potARR > 0)
    .sort((a, b) => b.potARR - a.potARR)
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
