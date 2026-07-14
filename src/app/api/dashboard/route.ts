import { NextResponse } from "next/server";
import { getSheetValues } from "@/lib/sheets";
import {
  parseArrTab,
  parseAeAttainmentTab,
  parsePipelineTab,
  parsePipelineWowTab,
} from "@/lib/parse";
import {
  parseQuery1,
  parseQuery2,
  computeWinRates,
  computeAgingBuckets,
  rankOpenDeals,
  computeForecast,
  computeWinRateAndCycle,
  computeAcvDistribution,
} from "@/lib/deals";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [arrRows, aeRows, pipelineRows, pipelineWowRows, query1Rows, query2Rows] =
      await Promise.all([
        getSheetValues("ARR & recurring revenue"),
        getSheetValues("AE attainment"),
        getSheetValues("Pipeline"),
        getSheetValues("Pipeline - WoW"),
        getSheetValues("Query 1", "A1:Z1000"),
        getSheetValues("Query 2", "A1:Z2000"),
      ]);

    const arr = parseArrTab(arrRows);
    const aeAttainment = parseAeAttainmentTab(aeRows);
    const pipeline = parsePipelineTab(pipelineRows);
    const pipelineWow = parsePipelineWowTab(pipelineWowRows);

    const openDeals = parseQuery1(query1Rows);
    const closedDeals = parseQuery2(query2Rows);

    const winRates = computeWinRates(closedDeals);
    const dealHealth = computeAgingBuckets(openDeals);
    const rankedDeals = rankOpenDeals(openDeals);
    const forecast = computeForecast(openDeals, winRates.rates);
    const currentYear = new Date().getUTCFullYear();
    const winRateYtd = computeWinRateAndCycle(closedDeals, currentYear);
    const acv = computeAcvDistribution(closedDeals);

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

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      arr,
      aeAttainment,
      pipeline,
      pipelineWow,
      dealHealth,
      rankedDeals,
      forecast,
      winRates: { derived: winRates.derived, n: winRates.n, overall: winRates.overall },
      winRateYtd,
      acv,
      whoDoesWhat: byOwner,
    });
  } catch (err) {
    console.error("Dashboard data fetch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
