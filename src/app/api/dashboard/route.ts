import { NextResponse } from "next/server";
import { getSheetValuesBatch } from "@/lib/sheets";
import {
  parseArrMomProgressionTab,
  parseArrMomRebuildTab,
  parseArrMonthlyFromRebuild,
  parseArrWeeklyFromRebuild,
  parseAcvMomTab,
  parsePerLocation,
  parseAeAttainmentTab,
  parseAeAnnualTab,
  parseTopBookedTab,
  parseArrForwardTab,
  parseDealTrackerTab,
  parsePipelineTab,
  parsePipelineWowTab,
} from "@/lib/parse";
import { computeAcvInsights } from "@/lib/acvInsights";
import { computePaymentMix } from "@/lib/paymentMix";
import {
  parseQuery1,
  parseQuery2,
  computeWinRates,
  computeAgingBuckets,
  rankOpenDeals,
  buildTrendEvents,
  computeForecast,
  computeForecastTab,
  parseForecastingQoQ,
  parseForecastingStages,
  computeWinRateAndCycle,
  computeAcvDistribution,
  computeBookingReport,
  computeSignedLiveForecast,
  computeCashForecast,
  computeArrFunnel,
} from "@/lib/deals";
import {
  SALES_Q,
  currentSalesQ,
  AE_ROSTER,
  FORECAST_EXCLUDE,
  ANNUAL_END_TARGET,
  CURRENT_LIVE_ARR_FALLBACK,
  TARGETS,
  monthsInQuarter,
} from "@/lib/planConfig";

export const dynamic = "force-dynamic";

const DEMO_MODE =
  !process.env.GOOGLE_SHEET_ID ||
  !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  (!process.env.GOOGLE_PRIVATE_KEY && !process.env.GOOGLE_PRIVATE_KEY_B64);

// Shared server cache: all viewers get one computed snapshot for CACHE_TTL_MS, so a
// burst of concurrent loads no longer re-reads Sheets on every request (that's what
// blew the read quota). `inflight` dedupes concurrent cache misses into one build; a
// transient failure serves the last-good snapshot instead of erroring the whole dash.
type Payload = Record<string, unknown>;
const CACHE_TTL_MS = 60_000;
let cache: { at: number; body: Payload } | null = null;
let inflight: Promise<Payload> | null = null;

export async function GET() {
  if (DEMO_MODE) {
    // No Google credentials configured — serve the bundled anonymized snapshot.
    const demo = (await import("@/data/demo-snapshot.json")).default;
    return NextResponse.json({ ...demo, updatedAt: new Date().toISOString() });
  }
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return NextResponse.json(cache.body);
  if (!inflight) inflight = buildPayload().finally(() => { inflight = null; });
  try {
    const body = await inflight;
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (err) {
    if (cache) return NextResponse.json(cache.body); // serve last-good data through a transient failure
    console.error("Dashboard data fetch failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

async function buildPayload(): Promise<Payload> {
    // ONE batched Sheets read for every tab (values.batchGet) — see getSheetValuesBatch.
    // Reading each tab individually (~19 gets/load) blows the Sheets "60 reads/min/user"
    // quota under concurrent traffic; batching collapses it to ~2 reads per load.
    // NOTE: order here MUST match the destructured variables below.
    const [wowRows, arrMomRows, aeRows, pipelineRows, pipelineWowRows, query1Rows, query2Rows, forecastingRows, closedDealsRows, arrMomRebuildRows, acvMomRows, perLocRows, paymentMixRows, aeAnnualRows, topBookedRows, arrForwardRows, dealTrackerRows, cashForecastRows, arrFunnelRows] =
      await getSheetValuesBatch([
        { tab: "ARR_WoW_Rebuild", range: "A1:J30" },
        // Legacy manual tab (deleted 2026-07-24; ARR_MoM_Rebuild is canonical) — tolerated as fallback.
        { tab: "ARR MoM Progression", range: "A1:D400" },
        // "AE Attainment (Official)" = leadership's exact filter (New Business, Billing/Closed Won, by Contract Live Date, excl Sri/Jesse).
        { tab: "AE Attainment (Official)" },
        { tab: "Pipeline" },
        { tab: "Pipeline - WoW", range: "A1:BI400" },
        { tab: "Query 1", range: "A1:Z1000" },
        { tab: "Query 2", range: "A1:Z2000" },
        { tab: "Forecasting", range: "A1:T45" },
        { tab: "SOQL_ClosedDeals", range: "A1:V4000" },
        { tab: "ARR_MoM_Rebuild", range: "A1:W400" },
        { tab: "ACV_MoM", range: "A1:AZ20" },
        { tab: "ARR_per_Location_MoM", range: "A1:K20" },
        { tab: "SOQL_PaymentMix", range: "A1:M2000" },
        { tab: "AE_Annual_Potential", range: "A1:L30" },
        { tab: "Top_Booked_ARR", range: "A1:F12" },
        { tab: "ARR_Forward", range: "A1:E24" },
        { tab: "Deal Tracker (DRAFT)", range: "A1:K200" },
        { tab: "Cash_Forecast", range: "A1:H4000" },
        { tab: "ARR_Funnel", range: "A1:P4000" },
      ]);

    // ARR (monthly + weekly) is now built entirely from the full-book Rule A rebuild —
    // ARR_MoM_Rebuild (monthly) + ARR_WoW_Rebuild (weekly). The survivor-biased
    // "ARR & recurring revenue" tab is retired.
    const arr = {
      monthly: parseArrMonthlyFromRebuild(arrMomRebuildRows),
      weekly: parseArrWeeklyFromRebuild(wowRows),
    };
    // Command ARR chart source: the automated SFDC rebuild (Rule A). Fall back to
    // the manual "ARR MoM Progression" tab if the rebuild hasn't been written yet.
    const arrMomRebuild = parseArrMomRebuildTab(arrMomRebuildRows);
    const arrMom = arrMomRebuild.length ? arrMomRebuild : parseArrMomProgressionTab(arrMomRows);
    // Live ARR as of TODAY (ARR_MoM_Rebuild W1) — the true point-in-time active book,
    // not the current-month row (which projects month-end, subtracting upcoming expirations).
    const liveArrToday = typeof arrMomRebuildRows?.[0]?.[22] === "number" ? (arrMomRebuildRows[0][22] as number) : null;
    const acvMoM = parseAcvMomTab(acvMomRows);
    const perLocation = parsePerLocation(perLocRows);
    const aeAttainment = parseAeAttainmentTab(aeRows);
    const aeAnnual = parseAeAnnualTab(aeAnnualRows);
    const topBooked = parseTopBookedTab(topBookedRows);
    const arrForward = parseArrForwardTab(arrForwardRows);
    const dealTracker = parseDealTrackerTab(dealTrackerRows);
    const pipeline = parsePipelineTab(pipelineRows);
    const pipelineWow = parsePipelineWowTab(pipelineWowRows);

    const openDeals = parseQuery1(query1Rows);
    const closedDeals = parseQuery2(query2Rows);

    const winRates = computeWinRates(closedDeals);
    const dealHealth = computeAgingBuckets(openDeals);
    const rankedDeals = rankOpenDeals(openDeals);
    const trendEvents = buildTrendEvents(openDeals, closedDeals);
    const forecast = computeForecast(openDeals, winRates.rates);

    // Full Forecast-tab computation (in-quarter per-AE, remainder, decide board, year-end)
    const q = currentSalesQ();
    const qDef = SALES_Q[q];
    const latestArr = arr.monthly[arr.monthly.length - 1]?.activeARR ?? CURRENT_LIVE_ARR_FALLBACK;
    const roster = AE_ROSTER.filter((a) => !FORECAST_EXCLUDE.has(a.name)).map((a) => ({
      name: a.name,
      short: a.short,
      quota: a.quotaQ3,
      am: a.am,
      lead: a.lead ?? false,
    }));
    // Next quarter (for the "Next quarter at a glance" section). Quota derived from
    // the plan's New-ARR targets for that quarter's months — stays live, no hardcoding.
    const qOrder = ["Q1", "Q2", "Q3", "Q4"];
    const nextQKey = qOrder[(qOrder.indexOf(q) + 1) % 4];
    const nextQDef = SALES_Q[nextQKey];
    const nextQuota = monthsInQuarter(nextQKey).reduce((s, i) => s + TARGETS.newARR[i], 0);
    const nextQ = {
      label: nextQDef.label,
      startISO: nextQDef.start,
      endISO: nextQDef.end,
      quota: nextQuota,
    };
    // Read pre-computed per-AE forecast straight from the Forecasting tab
    // (the warehouse) for the current quarter's QoQ block; map the sheet's short
    // names onto roster full names. This is the single source of truth for the
    // in-quarter table (incl. Closed Won) — no recompute.
    const qoqByShort = parseForecastingQoQ(forecastingRows, q);
    const normKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const qoqNorm: typeof qoqByShort = {};
    for (const [k, v] of Object.entries(qoqByShort)) qoqNorm[normKey(k)] = v;
    const forecastSheetRows: typeof qoqByShort = {};
    for (const a of AE_ROSTER) {
      // Match the sheet's QoQ row by short name, full name, or first name —
      // exact first, then whitespace/case-normalized (so "Davi" / "David
      // Dubinski" / "David" all resolve to the same QoQ row).
      const cands = [a.short, a.name, a.name.split(" ")[0]];
      let s: (typeof qoqByShort)[string] | undefined;
      for (const c of cands) {
        const hit = qoqByShort[c] ?? qoqNorm[normKey(c)];
        if (hit) { s = hit; break; }
      }
      if (s) forecastSheetRows[a.name] = s;
    }
    // Year-end projection uses the sheet's "Weighted Pipeline by Deal Stage"
    // (Potential ARR) so the projection + gap match the warehouse.
    const forecastStageRows = parseForecastingStages(forecastingRows);
    // Forecast "Closed Won" = each AE's Booked ARR from the AE Attainment tab, so the
    // forecast and the AE Attainment tab tell the same story (potential/variance recompute).
    const attByOwner: Record<string, number> = {};
    for (const r of aeAttainment.reps) attByOwner[r.name] = r.actual;
    const forecastTab = computeForecastTab(
      openDeals,
      closedDeals,
      roster,
      qDef.start,
      qDef.end,
      latestArr,
      ANNUAL_END_TARGET,
      winRates.rates,
      nextQ,
      forecastSheetRows,
      forecastStageRows,
      attByOwner
    );
    const currentYear = new Date().getUTCFullYear();
    const winRateYtd = computeWinRateAndCycle(closedDeals, currentYear);
    const acv = computeAcvDistribution(closedDeals);
    const acvInsights = computeAcvInsights(closedDealsRows);
    const bookingReport = computeBookingReport(closedDealsRows);
    const signedLive = computeSignedLiveForecast(closedDealsRows, qDef.start, qDef.end);
    const cashForecast = computeCashForecast(cashForecastRows);
    const arrFunnel = computeArrFunnel(arrFunnelRows);
    const paymentMix = computePaymentMix(paymentMixRows);

    // Who Does What — open deals grouped by owner, flagged if stale (>60d since last stage change)
    const now = new Date();
    const byOwner: Record<
      string,
      { openCount: number; openArr: number; staleCount: number; staleArr: number }
    > = {};
    for (const d of openDeals) {
      if (!byOwner[d.owner]) {
        byOwner[d.owner] = { openCount: 0, openArr: 0, staleCount: 0, staleArr: 0 };
      }
      byOwner[d.owner].openCount += 1;
      byOwner[d.owner].openArr += d.arr;
      const ref = d.lastStageChangeDate ?? d.createdDate;
      const days = ref ? Math.floor((now.getTime() - ref.getTime()) / 86400000) : 0;
      if (days > 60) {
        byOwner[d.owner].staleCount += 1;
        byOwner[d.owner].staleArr += d.arr;
      }
    }

    // ── AE attainment cards: per-owner Q3 closed-won split (NB/Exp) + coverage
    // pipeline (open deals in SAL/SQO/SQL). Computed from raw Query 1/2 deals. ──
    const cwSplitByOwner: Record<string, { nb: number; exp: number }> = {};
    for (const d of closedDeals) {
      if (!d.isWon || !d.closeDate) continue;
      const iso = d.closeDate.toISOString().slice(0, 10);
      if (iso < qDef.start || iso >= qDef.end) continue;
      if (!cwSplitByOwner[d.owner]) cwSplitByOwner[d.owner] = { nb: 0, exp: 0 };
      if (/Expansion/.test(d.recordType)) cwSplitByOwner[d.owner].exp += d.arr;
      else if (/New Business/.test(d.recordType)) cwSplitByOwner[d.owner].nb += d.arr;
    }
    const COVERAGE_STAGES = new Set(["SAL", "SQO", "SQL"]);
    const coverageByOwner: Record<string, number> = {};
    for (const d of openDeals) {
      if (!COVERAGE_STAGES.has(d.stage)) continue;
      coverageByOwner[d.owner] = (coverageByOwner[d.owner] ?? 0) + d.arr;
    }

    return {
      updatedAt: new Date().toISOString(),
      arr,
      arrMom,
      liveArrToday,
      bookingReport,
      signedLive,
      cashForecast,
      arrFunnel,
      dealTracker,
      topBooked,
      arrForward,
      aeAttainment,
      aeAnnual,
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
      acvInsights,
      acvMoM,
      perLocation,
      paymentMix,
      whoDoesWhat: byOwner,
      cwSplitByOwner,
      coverageByOwner,
    };
}
