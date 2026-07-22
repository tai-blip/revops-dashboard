"use client";

import { useEffect, useMemo, useState } from "react";
import { C, fmt, pct, Card, KV, Bar, Pill, Th, Td } from "@/lib/ui";
import { ArrChart } from "@/lib/ArrChart";
import { BarTrendChart } from "@/lib/BarTrendChart";
import { LineTrendChart } from "@/lib/LineTrendChart";
import { GroupedBarChart } from "@/lib/GroupedBarChart";
import { Sparkline, DeltaPill, wowDeltaPct, fmtMetricValue } from "@/lib/Sparkline";
import { PlanChart } from "@/lib/PlanChart";
import { TabHeader } from "@/lib/TabHeader";
import {
  TARGETS,
  PLAN_MONTHS,
  ANNUAL_END_TARGET,
  SALES_Q,
  currentSalesQ,
  monthsInQuarter,
} from "@/lib/planConfig";
import type { ArrPoint } from "@/lib/parse";

type MetricRow = { metric: string; value: number; kind: "currency" | "count" | "percent" | "ratio" };
type BreakdownRow = { label: string; opps: number; arr: number; pctOfTotal: number };
type StageWeightRow = { stage: string; arr: number; probability: number; weighted: number };
type AeBreakdownRow = { name: string; quota: number | null; actual: number };

type DashboardData = {
  updatedAt: string;
  demo?: boolean;
  arr: {
    monthly: ArrPoint[];
    weekly: ArrPoint[];
  };
  aeAttainment: {
    reps: { name: string; quota: number; pctOfQuota: number; actual: number }[];
    monthlyTeamActual: { label: string; actual: number }[];
  };
  pipeline: {
    filterRep: string;
    metricSections: Record<string, MetricRow[]>;
    breakdownSections: Record<string, BreakdownRow[]>;
    stageWeights: StageWeightRow[];
    aeBreakdown: AeBreakdownRow[];
  };
  pipelineWow: {
    filterRep: string;
    weekLabels: string[];
    weeks: { metric: string; values: (number | null)[] }[];
    newOppsMom: { months: string[]; reps: Record<string, number[]> };
    newArrMom: { months: string[]; reps: Record<string, number[]> };
  };
  dealHealth: { label: string; min: number; max: number; arr: number; count: number }[];
  rankedDeals: { name: string; owner: string; stage: string; arr: number; ageDays: number | null }[];
  trendEvents: { date: string; owner: string; arr: number; type: "created" | "closedWon" | "closedLost" }[];
  forecast: {
    rawTotal: number;
    weightedTotal: number;
    byStage: Record<string, { raw: number; weighted: number; count: number }>;
  };
  forecastTab: {
    rows: { name: string; am: boolean; openPipe: number; quota: number | null; closedWon: number; potNB: number; potExp: number; potential: number; variance: number | null; attainP: number | null }[];
    aeTeam: { openPipe: number; quota: number; closedWon: number; potNB: number; potExp: number; potential: number; variance: number; attainP: number | null };
    totalInclAM: { openPipe: number; quota: number; closedWon: number; potNB: number; potExp: number; potential: number; variance: number; attainP: number | null };
    teamProjected: number;
    teamQuota: number;
    teamActual: number;
    projYE: number;
    annualGap: number;
    annualTarget: number;
    currentLiveARR: number;
    weightedAnnual: number;
    weightedAnnualFlat: number;
    rawAnnual: number;
    pipelineNeededForGap: number;
    yeWaterfall: { stage: string; raw: number; weighted: number }[];
    nextQuarter: {
      label: string;
      startISO: string;
      quota: number;
      raw: number;
      realistic: number;
      count: number;
      gap: number;
      coversPct: number;
      lateStageRaw: number;
      byStage: { stage: string; count: number; raw: number; aeExpected: number; survivesPct: number }[];
    };
    daysLeft: number;
    weeksLeft: number;
    quotaGap: number;
    quotaPerWeek: number;
    potentialLanding: number;
    decideDeals: { name: string; owner: string; stage: string; arr: number; ageDays: number | null }[];
  };
  quarter: { key: string; label: string; start: string; end: string };
  winRates: { derived: boolean; n: number; overall: number | null };
  winRateYtd: {
    winRate: number | null;
    avgCycle: number | null;
    medianCycle: number | null;
    closedCount: number;
    wonCount: number;
  };
  acv: {
    buckets: { label: string; min: number; max: number; count: number; arr: number }[];
    avg: number;
    median: number;
    count: number;
  };
  whoDoesWhat: Record<
    string,
    { openCount: number; openArr: number; staleCount: number; staleArr: number }
  >;
};

const TABS = [
  ["command", "Command"],
  ["targets", "Targets & Progress"],
  ["pipeline", "Pipeline"],
  ["forecast", "Forecast"],
  ["health", "Deal Health"],
  ["attainment", "AE Attainment"],
  ["acv", "ACV & Deal Size"],
  ["productarr", "Product ARR"],
  ["actions", "Who Does What"],
] as const;

function ChartPeriodToggle({
  period,
  onChange,
}: {
  period: "monthly" | "weekly";
  onChange: (p: "monthly" | "weekly") => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {(["monthly", "weekly"] as const).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
            border: `1px solid ${C.bd}`,
            background: period === p ? C.navy : "#fff",
            color: period === p ? "#fff" : C.t2,
            cursor: "pointer",
          }}
        >
          {p === "monthly" ? "MoM" : "WoW"}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("command");
  const [period, setPeriod] = useState<"monthly" | "weekly">("monthly");
  const [trendRep, setTrendRep] = useState<string>("James Burdick");
  const [pipeAeFilter, setPipeAeFilter] = useState<string>("All");
  const [pipeCriteria, setPipeCriteria] = useState<
    "created" | "createdCount" | "closedWon" | "closedLost"
  >("created");
  const [pipePeriod, setPipePeriod] = useState<"weekly" | "monthly">("weekly");
  const [wowMetric, setWowMetric] = useState<string | null>(null);
  const [decideAE, setDecideAE] = useState<string>("all");
  const [dealCalls, setDealCalls] = useState<Record<string, "commit" | "best" | "pipeline" | "omit">>({});

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const months = data.arr.monthly;
    const latest = months[months.length - 1];

    const teamQuota = data.aeAttainment.reps.reduce((s, r) => s + r.quota, 0);
    const teamActual = data.aeAttainment.reps.reduce((s, r) => s + r.actual, 0);
    const teamPctOfQuota = teamQuota > 0 ? teamActual / teamQuota : 0;

    const totalPipelineARR =
      data.pipeline.metricSections["1. TOTAL PIPELINE"]?.find((m) => m.metric === "Total Pipeline (ARR)")?.value ?? 0;
    const coverageRatio =
      data.pipeline.metricSections["3. PIPELINE COVERAGE"]?.find((m) => m.metric === "Pipeline Coverage Ratio")?.value ?? 0;

    // Cumulative team ARR attainment across months
    const monthlyCumulative: { label: string; actual: number }[] = [];
    let running = 0;
    for (const m of data.aeAttainment.monthlyTeamActual) {
      running += m.actual;
      monthlyCumulative.push({ label: m.label, actual: running });
    }

    // Cumulative churned ARR (last 12 months window)
    const churnWindow = data.arr.monthly.slice(-12);
    const churnCumulative: number[] = [];
    let churnRunning = 0;
    for (const m of churnWindow) {
      churnRunning += m.churnedARR;
      churnCumulative.push(churnRunning);
    }

    return {
      latest,
      teamQuota,
      teamActual,
      teamPctOfQuota,
      totalPipelineARR,
      coverageRatio,
      monthlyCumulative,
      churnWindow,
      churnCumulative,
    };
  }, [data]);

  const pipeOwners = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.trendEvents.map((e) => e.owner))).sort();
  }, [data]);

  // Pipeline created within Q3 FY26 (Jul 1 – Sep 30, 2026), per AE
  const q3CreatedByOwner = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    for (const e of data.trendEvents) {
      if (e.type !== "created") continue;
      if (e.date >= "2026-07-01" && e.date <= "2026-09-30") {
        out[e.owner] = (out[e.owner] ?? 0) + e.arr;
      }
    }
    return out;
  }, [data]);

  // Count of Q3-created opps per AE (parallels q3CreatedByOwner, which sums ARR)
  const q3CreatedCountByOwner = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    for (const e of data.trendEvents) {
      if (e.type !== "created") continue;
      if (e.date >= "2026-07-01" && e.date <= "2026-09-30") {
        out[e.owner] = (out[e.owner] ?? 0) + 1;
      }
    }
    return out;
  }, [data]);

  function getWeekStart(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day; // Monday start
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  const wowMetrics = useMemo(() => {
    if (!data) return [];
    // "New ARR pipeline Created" is pipeline generation, NOT booked ARR. Relabel it
    // for display so the Pipeline tab reads consistently; keep `raw` for lookups.
    const relabel = (m: string) =>
      m.replace(/New ARR pipeline Created/i, "New Pipeline Created");
    return data.pipelineWow.weeks
      .filter((w) => !w.metric.includes("Δ%"))
      .map((w) => ({
        metric: relabel(w.metric),
        raw: w.metric,
        values: w.values,
        money: w.metric.includes("($)"),
      }));
  }, [data]);

  const activeWowMetric = wowMetric ?? wowMetrics[0]?.metric ?? null;

  const execSummary = useMemo(() => {
    if (!data) return null;
    const months = data.arr.monthly;
    const latest = months[months.length - 1];
    // "Current month" = the row matching today's YYYY-MM, else the latest row that
    // isn't in the future. Fixes New/Churned ARR showing a future month (e.g. Sep)
    // with near-zero data instead of the actual current month.
    const nowKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    const notFuture = months.filter((m) => m.label <= nowKey);
    const currentMonth =
      months.find((m) => m.label === nowKey) ??
      notFuture[notFuture.length - 1] ??
      latest;
    const arrNow = latest?.activeARR ?? 0;
    const gap = 10000000 - arrNow;

    // Q3 pipe generation vs quota vs time elapsed
    const aeRows = data.pipeline.aeBreakdown.filter((r) => r.name !== "TOTAL");
    const quota = aeRows.reduce((s, r) => s + (r.quota ?? 0), 0);
    const gen = Object.values(q3CreatedByOwner).reduce((s, n) => s + n, 0);
    const genPct = quota > 0 ? (gen / quota) * 100 : 0;
    const qStart = new Date("2026-07-02").getTime();
    const qEnd = new Date("2026-10-01").getTime();
    const elapsedPct = Math.min(100, Math.max(0, ((Date.now() - qStart) / (qEnd - qStart)) * 100));
    const paceRatio = elapsedPct > 0 ? genPct / elapsedPct : 0;
    const genStatus =
      paceRatio >= 0.9
        ? { label: "On pace", tone: "good" as const }
        : paceRatio >= 0.5
        ? { label: "Watch", tone: "warn" as const }
        : { label: "Behind", tone: "bad" as const };

    // Weekly ARR creation WoW
    const arrRow = wowMetrics.find((m) => m.raw.includes("New ARR pipeline Created"));
    const wowDelta = arrRow ? wowDeltaPct(arrRow.values) : null;

    // Churn: latest month vs prior 3-month average
    const churnLast = latest?.churnedARR ?? 0;
    const prior = months.slice(-4, -1).map((m) => m.churnedARR);
    const priorAvg = prior.length ? prior.reduce((s, n) => s + n, 0) / prior.length : 0;
    const churn12 = months.slice(-12).reduce((s, m) => s + m.churnedARR, 0);
    const churnStatus =
      priorAvg > 0 && churnLast > priorAvg * 1.2
        ? { label: "Rising", tone: "bad" as const }
        : churnLast === 0 || churnLast < priorAvg * 0.8
        ? { label: "Low", tone: "good" as const }
        : { label: "Watch", tone: "warn" as const };

    const coverage =
      data.pipeline.metricSections["3. PIPELINE COVERAGE"]?.find(
        (m) => m.metric === "Pipeline Coverage Ratio"
      )?.value ?? 0;
    const coverageStatus =
      coverage >= 3
        ? { label: "Healthy", tone: "good" as const }
        : coverage >= 2
        ? { label: "Watch", tone: "warn" as const }
        : { label: "Low", tone: "bad" as const };

    const arrStatus =
      (currentMonth?.changePct ?? 0) >= 0
        ? { label: "On track", tone: "good" as const }
        : { label: "Declining", tone: "bad" as const };

    return {
      arrNow,
      gap,
      arrMoM: currentMonth?.changePct ?? null,
      gen,
      quota,
      genPct,
      elapsedPct,
      genStatus,
      wowDelta,
      churnLast,
      churn12,
      churnStatus,
      coverage,
      coverageStatus,
      arrStatus,
      currentMonth,
    };
  }, [data, q3CreatedByOwner, wowMetrics]);

  const tabSummaries = useMemo(() => {
    if (!data || !execSummary) return null;
    const S = execSummary;
    const months = data.arr.monthly;
    const latest = months[months.length - 1];

    const reps = [...data.aeAttainment.reps].sort((a, b) => b.pctOfQuota - a.pctOfQuota);
    const top = reps[0];
    const bottom = reps[reps.length - 1];
    const teamQuota = data.aeAttainment.reps.reduce((s, r) => s + r.quota, 0);
    const teamActual = data.aeAttainment.reps.reduce((s, r) => s + r.actual, 0);
    const teamPct = teamQuota > 0 ? (teamActual / teamQuota) * 100 : 0;
    const below10 = reps.filter((r) => r.pctOfQuota < 0.1).length;

    const totalOpps =
      data.pipeline.metricSections["1. TOTAL PIPELINE"]?.find((m) => m.metric === "Total Opportunities")?.value ?? 0;
    const totalPipe =
      data.pipeline.metricSections["1. TOTAL PIPELINE"]?.find((m) => m.metric === "Total Pipeline (ARR)")?.value ?? 0;

    const arrRow = wowMetrics.find((m) => m.raw.includes("New ARR pipeline Created"));
    const arrClean = arrRow?.values.filter((v): v is number => v != null) ?? [];
    const arrThisWeek = arrClean[arrClean.length - 1] ?? 0;
    const wowPhrase =
      S.wowDelta == null
        ? ""
        : S.wowDelta >= 0
        ? ` New pipeline creation is up ${Math.round(S.wowDelta)}% WoW.`
        : ` New pipeline creation is down ${Math.abs(Math.round(S.wowDelta))}% WoW.`;

    const staleBuckets = data.dealHealth.filter((b) => b.min >= 91);
    const staleArr = staleBuckets.reduce((s, b) => s + b.arr, 0);
    const staleCount = staleBuckets.reduce((s, b) => s + b.count, 0);
    const totalHealthArr = data.dealHealth.reduce((s, b) => s + b.arr, 0);
    const stalePct = totalHealthArr > 0 ? (staleArr / totalHealthArr) * 100 : 0;
    const biggest = data.rankedDeals[0];

    const owners = Object.entries(data.whoDoesWhat).sort((a, b) => b[1].openArr - a[1].openArr);
    const topOwner = owners[0];
    const totalStaleArr = owners.reduce((s, [, v]) => s + v.staleArr, 0);
    const totalOpenArr = owners.reduce((s, [, v]) => s + v.openArr, 0);
    const totalOpenCount = owners.reduce((s, [, v]) => s + v.openCount, 0);
    const flaggedOwners = owners.filter(([, v]) => v.staleCount > 0).length;

    // Q3 ARR mix skew from last 3 months
    const q3Win = months.slice(-3);
    const nb = q3Win.reduce((s, m) => s + m.newBusiness, 0);
    const exp = q3Win.reduce((s, m) => s + m.expansion, 0);
    const newArrNbExp = nb + exp; // New ARR = Net New + Expansion (renewals excluded)
    const mixTotal = nb + exp;
    const nbPct = mixTotal > 0 ? (nb / mixTotal) * 100 : 0;

    const gp = (n: number | null | undefined) => (n != null ? pct(n) : "—");

    return {
      command: {
        sentence: `ARR sits at ${fmt(S.arrNow)} — ${fmt(S.gap)} from the $10M milestone. Pipeline generation is ${S.genStatus.tone === "good" ? "on pace" : "behind pace"} at ${S.genPct.toFixed(0)}% of the Q3 quota with ${(100 - S.elapsedPct).toFixed(0)}% of the quarter remaining${S.wowDelta != null ? (S.wowDelta >= 0 ? ` while weekly pipeline creation rebounded +${Math.round(S.wowDelta)}% WoW` : ` while weekly pipeline creation declined ${Math.round(S.wowDelta)}% WoW`) : ""}.`,
        stats: [
          { label: "Live ARR", value: fmt(S.arrNow), tone: "good" as const },
          { label: "New ARR (mo)", value: fmt(S.currentMonth?.newARR), sub: `New Biz + Expansion${S.currentMonth?.label ? " · " + S.currentMonth.label : ""}` },
          { label: "Churned (mo)", value: fmt(S.currentMonth?.churnedARR), sub: S.currentMonth?.label, tone: "bad" as const },
          { label: "MoM change", value: gp(S.arrMoM), tone: (S.arrMoM ?? 0) >= 0 ? ("good" as const) : ("bad" as const) },
          { label: "Total pipeline", value: fmt(totalPipe) },
          { label: "Coverage", value: S.coverage.toFixed(2) + "x", tone: S.coverage >= 3 ? ("good" as const) : ("warn" as const) },
        ],
      },
      targets: {
        sentence: `Quarter-to-date the team has attained ${fmt(teamActual)} — ${teamPct.toFixed(1)}% of the ${fmt(teamQuota)} Q3 quota${top ? `, with ${top.name} leading at ${gp(top.pctOfQuota)}` : ""}.${mixTotal > 0 ? ` New ARR (Net New + Expansion) is ${fmt(newArrNbExp)}, skewing ${nbPct.toFixed(0)}% Net New.` : ""}`,
        stats: [
          { label: "New ARR (current mo)", value: fmt(newArrNbExp), sub: "Net New + Expansion" },
          { label: "Team New ARR Q3", value: fmt(newArrNbExp), sub: "Net New + Expansion" },
          { label: "Team quota Q3", value: fmt(teamQuota), sub: `across ${data.aeAttainment.reps.length} AEs` },
          { label: "% of quota", value: teamPct.toFixed(1) + "%", sub: `attainment ${fmt(teamActual)} · ${S.elapsedPct.toFixed(0)}% of quarter gone`, tone: teamPct >= S.elapsedPct ? ("good" as const) : ("bad" as const) },
        ],
      },
      pipeline: {
        sentence: `Q3 pipeline generation stands at ${fmt(S.gen)} — ${S.genPct.toFixed(0)}% of the ${fmt(S.quota)} quota with ${S.elapsedPct.toFixed(0)}% of the quarter gone (${S.genStatus.label.toLowerCase()}). Open pipeline totals ${fmt(totalPipe)} across ${totalOpps} opportunities at ${S.coverage.toFixed(1)}x coverage.${wowPhrase}`,
        stats: [
          { label: "Created in Q3", value: fmt(S.gen), sub: `${S.genPct.toFixed(0)}% of ${fmt(S.quota)} quota`, tone: S.genStatus.tone },
          { label: "Open pipeline", value: fmt(totalPipe), sub: `${totalOpps} opportunities` },
          { label: "New Pipeline this week", value: fmt(arrThisWeek), sub: S.wowDelta != null ? `${S.wowDelta >= 0 ? "+" : "−"}${Math.abs(Math.round(S.wowDelta))}% WoW` : undefined, tone: (S.wowDelta ?? 0) >= 0 ? ("good" as const) : ("bad" as const) },
          { label: "Coverage", value: S.coverage.toFixed(2) + "x", sub: "open pipe vs Q3 quota", tone: S.coverage >= 3 ? ("good" as const) : ("warn" as const) },
        ],
      },
      forecast: {
        sentence: `Raw open pipeline of ${fmt(data.forecast.rawTotal)} weights down to ${fmt(data.forecast.weightedTotal)} after applying stage win rates${data.winRates.derived ? ` derived from ${data.winRates.n} closed deals (${data.winRates.overall != null ? pct(data.winRates.overall) : "—"} overall win rate)` : ""}.`,
        stats: [
          { label: "Raw pipeline", value: fmt(data.forecast.rawTotal) },
          { label: "Weighted forecast", value: fmt(data.forecast.weightedTotal), tone: "good" as const },
          { label: "Overall win rate", value: data.winRates.overall != null ? pct(data.winRates.overall) : "—" },
          { label: "Deals in basis", value: String(data.winRates.n), sub: "closed, last 18mo" },
        ],
      },
      health: {
        sentence: `${fmt(staleArr)} of open pipeline (${staleCount} deals, ${stalePct.toFixed(0)}% of total) hasn't moved stages in 90+ days.${biggest ? ` Largest open deal: ${biggest.name} at ${fmt(biggest.arr)}${biggest.ageDays != null ? ` (${biggest.ageDays}d since last stage change)` : ""}.` : ""}`,
        stats: [
          { label: "Stale 90d+ ARR", value: fmt(staleArr), tone: "bad" as const },
          { label: "Stale deals", value: String(staleCount), sub: "90+ days no movement" },
          { label: "% of pipe stale", value: stalePct.toFixed(0) + "%", tone: stalePct > 40 ? ("bad" as const) : ("warn" as const) },
          { label: "Largest open deal", value: biggest ? fmt(biggest.arr) : "—", sub: biggest?.name },
        ],
      },
      attainment: {
        sentence: `Team attainment is ${teamPct.toFixed(1)}% of the Q3 quota (${fmt(teamActual)} of ${fmt(teamQuota)}).${top ? ` Top: ${top.name} at ${gp(top.pctOfQuota)}.` : ""}${bottom && bottom !== top ? ` Lowest: ${bottom.name} at ${gp(bottom.pctOfQuota)}.` : ""}${below10 > 0 ? ` ${below10} of ${reps.length} AEs are below 10%.` : ""}`,
        stats: [
          { label: "Team actual", value: fmt(teamActual), sub: `of ${fmt(teamQuota)} quota` },
          { label: "Team % of quota", value: teamPct.toFixed(1) + "%", sub: `${S.elapsedPct.toFixed(0)}% of quarter gone`, tone: teamPct >= S.elapsedPct ? ("good" as const) : ("bad" as const) },
          { label: "Top AE", value: top ? gp(top.pctOfQuota) : "—", sub: top ? `${top.name} · ${fmt(top.actual)}` : undefined, tone: "good" as const },
          { label: "Lowest AE", value: bottom ? gp(bottom.pctOfQuota) : "—", sub: bottom ? `${bottom.name} · ${fmt(bottom.actual)}` : undefined, tone: "bad" as const },
        ],
      },
      acv: {
        sentence: `Average won deal is ${fmt(data.acv.avg)} (median ${fmt(data.acv.median)}) across ${data.acv.count} wins in 18 months. YTD win rate: ${data.winRateYtd.winRate != null ? pct(data.winRateYtd.winRate) : "—"} on ${data.winRateYtd.closedCount} closed New Business deals${data.winRateYtd.medianCycle != null ? `, median cycle ${data.winRateYtd.medianCycle}d SQL→close` : ""}.`,
        stats: [
          { label: "Avg deal size", value: fmt(data.acv.avg), sub: "won, last 18mo" },
          { label: "Median deal size", value: fmt(data.acv.median), sub: "less outlier skew" },
          { label: "Win rate YTD", value: data.winRateYtd.winRate != null ? pct(data.winRateYtd.winRate) : "—", sub: `${data.winRateYtd.wonCount} of ${data.winRateYtd.closedCount} New Biz` },
          { label: "Median cycle", value: data.winRateYtd.medianCycle != null ? `${data.winRateYtd.medianCycle}d` : "—", sub: "SQL → close" },
        ],
      },
      actions: {
        sentence: `${topOwner ? `${topOwner[0]} holds the most open pipeline (${fmt(topOwner[1].openArr)} across ${topOwner[1].openCount} deals). ` : ""}${fmt(totalStaleArr)} across all owners has been stale for 60+ days and needs action.`,
        stats: [
          { label: "Total open ARR", value: fmt(totalOpenArr) },
          { label: "Open deals", value: String(totalOpenCount), sub: `across ${owners.length} owners` },
          { label: "Stale 60d+ ARR", value: fmt(totalStaleArr), tone: "bad" as const },
          { label: "Owners flagged", value: String(flaggedOwners), sub: "with stale deals" },
        ],
      },
    };
  }, [data, execSummary, wowMetrics]);

  const pathToPlan = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const q = currentSalesQ(now);
    const qDef = SALES_Q[q];
    const qMonthIdxs = monthsInQuarter(q);

    // Booked New ARR (New Business + Expansion, churn excluded) per calendar month, live from ARR tab.
    // arr.monthly labels look like "2026-07"; map to calendar month index.
    const bookedByMonth: (number | null)[] = PLAN_MONTHS.map(() => null);
    for (const p of data.arr.monthly) {
      const m = /^\d{4}-(\d{2})$/.exec(p.label);
      if (!m) continue;
      const idx = parseInt(m[1], 10) - 1;
      if (p.label.startsWith("2026-")) {
        bookedByMonth[idx] = (bookedByMonth[idx] ?? 0) + p.newBusiness + p.expansion;
      }
    }

    // YTD booked = sum of booked months that have data
    const ytdBooked = bookedByMonth.reduce((s: number, v) => s + (v ?? 0), 0);
    const ytdTargetThroughNow = TARGETS.newARR
      .slice(0, now.getUTCMonth() + 1)
      .reduce((s, v) => s + v, 0);

    // Q3 booked & target
    const q3Booked = qMonthIdxs.reduce((s, i) => s + (bookedByMonth[i] ?? 0), 0);
    const q3Target = qMonthIdxs.reduce((s, i) => s + TARGETS.newARR[i], 0);
    const fy26NewArrTarget = TARGETS.newARR.reduce((s, v) => s + v, 0);

    // Weeks left in quarter
    const qEnd = new Date(qDef.end).getTime();
    const weeksLeft = Math.max(0, Math.ceil((qEnd - now.getTime()) / (7 * 86400000)));

    // Run-rate needed per week
    const arrGap = Math.max(0, q3Target - q3Booked);
    const arrPerWeek = weeksLeft > 0 ? arrGap / weeksLeft : 0;

    // Pipeline: Q3 created vs quota, weekly run-rate
    const pipeGen = Object.values(q3CreatedByOwner).reduce((s, n) => s + n, 0);
    const pipeQuota = data.pipeline.aeBreakdown
      .filter((r) => r.name !== "TOTAL")
      .reduce((s, r) => s + (r.quota ?? 0), 0);
    const pipeGap = Math.max(0, pipeQuota - pipeGen);
    const pipePerWeek = weeksLeft > 0 ? pipeGap / weeksLeft : 0;

    // Last week's ARR added + pipeline added (from weekly ARR tab + WoW)
    const lastWeek = data.arr.weekly[data.arr.weekly.length - 1];
    const arrAddedLastWeek = lastWeek?.newARR ?? 0;
    const arrWeekLabel = lastWeek?.label ?? "";
    const pipeRow = data.pipelineWow.weeks.find((w) => w.metric.includes("New ARR pipeline Created"));
    const pipeClean = pipeRow?.values.filter((v): v is number => v != null) ?? [];
    const pipeAddedLastWeek = pipeClean[pipeClean.length - 1] ?? 0;

    // Chart series: booked vs target, with H2 rebased flag
    const chart = PLAN_MONTHS.map((m, i) => ({
      month: m,
      target: TARGETS.newARR[i],
      booked: bookedByMonth[i],
      isH2: i >= 6,
    }));

    // --- Command "gap to target" + "last week vs pace" card fields ----------
    const qStart = new Date(qDef.start).getTime();
    const qEndMs = new Date(qDef.end).getTime();
    const daysLeft = Math.max(0, Math.ceil((qEndMs - now.getTime()) / 86400000));
    const totalQuarterWeeks = (qEndMs - qStart) / (7 * 86400000);
    const elapsedPct =
      qEndMs > qStart ? Math.min(100, Math.max(0, ((now.getTime() - qStart) / (qEndMs - qStart)) * 100)) : 0;

    // Elapsed-month QTD target: sum of this quarter's monthly targets whose month
    // has already started (e.g. mid-July → only July's target counts).
    const nowMonth = now.getUTCMonth();
    const qtdArrTarget = qMonthIdxs
      .filter((i) => i <= nowMonth)
      .reduce((s, i) => s + TARGETS.newARR[i], 0);

    // Pace = the flat weekly run-rate implied by the full-quarter target.
    const arrPace = totalQuarterWeeks > 0 ? q3Target / totalQuarterWeeks : 0;
    const pipePace = totalQuarterWeeks > 0 ? pipeQuota / totalQuarterWeeks : 0;

    return {
      q,
      qEnd: qDef.end,
      daysLeft,
      elapsedPct,
      arrAddedLastWeek,
      arrWeekLabel,
      pipeAddedLastWeek,
      weeksLeft,
      arrPerWeek,
      arrGap,
      q3Target,
      pipeGen,
      pipePerWeek,
      pipeGap,
      pipeQuota,
      qtdArrTarget,
      arrPace,
      pipePace,
      ytdTargetThroughNow,
      ytdBooked,
      q3Booked,
      fy26NewArrTarget,
      annualEnd: ANNUAL_END_TARGET,
      chart,
    };
  }, [data, q3CreatedByOwner]);

  const pipelineTrend = useMemo(() => {
    if (!data) return { labels: [], values: [] };
    const filtered = data.trendEvents.filter(
      (e) => pipeAeFilter === "All" || e.owner === pipeAeFilter
    );
    const typeMap: Record<string, "created" | "closedWon" | "closedLost"> = {
      created: "created",
      createdCount: "created",
      closedWon: "closedWon",
      closedLost: "closedLost",
    };
    const wantType = typeMap[pipeCriteria];
    const isCount = pipeCriteria === "createdCount";

    const buckets: Record<string, number> = {};
    for (const e of filtered) {
      if (e.type !== wantType) continue;
      const key = pipePeriod === "weekly" ? getWeekStart(e.date) : e.date.slice(0, 7);
      buckets[key] = (buckets[key] ?? 0) + (isCount ? 1 : e.arr);
    }
    const labels = Object.keys(buckets).sort();
    const values = labels.map((l) => buckets[l]);
    // keep it readable — last 20 periods
    return { labels: labels.slice(-20), values: values.slice(-20) };
  }, [data, pipeAeFilter, pipeCriteria, pipePeriod]);

  if (error) {
    return (
      <div style={{ padding: 40, color: C.red, fontFamily: "var(--font-dm-sans)" }}>
        Failed to load dashboard data: {error}
      </div>
    );
  }

  if (!data || !derived) {
    return (
      <div style={{ padding: 40, color: C.t2, fontFamily: "var(--font-dm-sans)" }}>
        Loading live data…
      </div>
    );
  }

  const chartPoints = period === "monthly" ? data.arr.monthly : data.arr.weekly;

  return (
    <div style={{ fontFamily: "var(--font-dm-sans)", background: C.bg, minHeight: "100vh" }}>
      <div style={{ background: C.card, borderBottom: `1px solid ${C.bd}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 30px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.navy }}>
              {data.demo ? "Horizon Dining Group — Q3 FY26" : "Momos Forecast — Q3 FY26"}
            </div>
            <div style={{ fontSize: 12, color: C.t3 }}>
              {data.demo && (
                <span
                  style={{
                    background: C.ylwBg,
                    color: C.ylw,
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 10,
                    marginRight: 8,
                    letterSpacing: ".04em",
                  }}
                >
                  DEMO DATA
                </span>
              )}
              Live · updated {new Date(data.updatedAt).toLocaleTimeString()}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 14, overflowX: "auto" }}>
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  padding: "10px 16px",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: tab === key ? C.navy : C.t2,
                  background: "none",
                  border: "none",
                  borderBottom: tab === key ? `2px solid ${C.coral}` : "2px solid transparent",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "command" && (
        <div>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
            {tabSummaries && (
              <TabHeader label="Command" sentence={tabSummaries.command.sentence} stats={tabSummaries.command.stats} />
            )}

            {pathToPlan && (() => {
              const P = pathToPlan;
              // whole-k / M formatter matching the card design (no decimal on k)
              const fk = (n: number) => {
                const a = Math.abs(n);
                const s = n < 0 ? "−" : "";
                if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
                if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "k";
                return s + "$" + Math.round(a);
              };
              const gridWrap = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px 40px", padding: "20px" } as const;
              const lbl = { fontSize: 11, fontWeight: 700 as const, letterSpacing: ".06em", textTransform: "uppercase" as const, color: C.t3 };
              const bigN = (color: string, sm = false) => ({ fontSize: sm ? 34 : 38, fontWeight: 800 as const, color, lineHeight: 1, marginTop: 6, fontFamily: "var(--font-dm-mono)" });
              const subN = { fontSize: 13, color: C.t2, marginTop: 8 };
              const subWarn = { fontSize: 13, color: C.red, marginTop: 8 };

              const arrAtt = P.q3Target > 0 ? Math.round((P.q3Booked / P.q3Target) * 100) : 0;
              const arrGapPct = P.q3Target > 0 ? Math.round((P.arrGap / P.q3Target) * 100) : 0;
              const arrQtdAtt = P.qtdArrTarget > 0 ? Math.round((P.q3Booked / P.qtdArrTarget) * 100) : 0;
              const pipeAtt = P.pipeQuota > 0 ? Math.round((P.pipeGen / P.pipeQuota) * 100) : 0;
              const arrBehind = P.arrAddedLastWeek < P.arrPace;
              const pipeBehind = P.pipeAddedLastWeek < P.pipePace;
              const wk = P.arrWeekLabel ? P.arrWeekLabel.replace(/^\d{4}-/, "").replace("-", "/") : "";

              return (
                <>
                  {/* Card 1 — days left / gap to target */}
                  <Card
                    title={`${P.daysLeft} days left in ${P.q} · gap to target`}
                    sub={`${P.weeksLeft} weeks remaining (quarter ends ${P.qEnd}) · ${arrGapPct}% of ${P.q} target still left. What's still needed — or banked — on ARR and pipeline.`}
                    accent={C.coral}
                  >
                    <div style={gridWrap}>
                      <div>
                        <div style={lbl}>New ARR — Gap to Target</div>
                        <div style={bigN(C.coralDk)}>{fk(P.arrGap)}</div>
                        <div style={subN}>{fk(P.q3Booked)} booked of {fk(P.q3Target)} {P.q} target · {arrGapPct}% left</div>
                      </div>
                      <div>
                        <div style={lbl}>ARR Needed / Week Left</div>
                        <div style={bigN(C.navy)}>{fk(P.arrPerWeek)}</div>
                        <div style={subN}>across {P.weeksLeft} weeks to close</div>
                      </div>
                      <div>
                        <div style={lbl}>Pipeline — Gap to Target</div>
                        <div style={bigN(C.purp)}>{fk(P.pipeGap)}</div>
                        <div style={subN}>{fk(P.pipeGen)} created of {fk(P.pipeQuota)} target</div>
                      </div>
                      <div>
                        <div style={lbl}>Pipeline Needed / Week Left</div>
                        <div style={bigN(C.navy)}>{fk(P.pipePerWeek)}</div>
                        <div style={subN}>across {P.weeksLeft} weeks to close</div>
                      </div>
                    </div>
                  </Card>

                  {/* Card 2 — last week vs pace / QTD vs target */}
                  <Card
                    title={`Last week vs pace · ${P.q} QTD vs target`}
                    sub={`Weekly run-rate against pace, and quarter-to-date booking against the elapsed-months target · ${Math.round(P.elapsedPct)}% of ${P.q} elapsed. Pipeline pace is the catch-up run-rate.`}
                    accent={C.purp}
                  >
                    <div style={gridWrap}>
                      <div>
                        <div style={lbl}>ARR Booked — Last Week</div>
                        <div style={bigN(C.coralDk, true)}>{fk(P.arrAddedLastWeek)}</div>
                        <div style={arrBehind ? subWarn : subN}>
                          {arrBehind ? `behind pace (${fk(P.arrPace)}/wk)` : `at/above pace (${fk(P.arrPace)}/wk)`}{wk ? ` · wk of ${wk}` : ""}
                        </div>
                      </div>
                      <div>
                        <div style={lbl}>Pipeline Created — Last Week</div>
                        <div style={bigN(C.purp, true)}>{fk(P.pipeAddedLastWeek)}</div>
                        <div style={pipeBehind ? subWarn : subN}>
                          {pipeBehind ? `behind pace (${fk(P.pipePace)} needed)` : `at/above pace (${fk(P.pipePace)}/wk)`}{wk ? ` · wk of ${wk}` : ""}
                        </div>
                      </div>
                      <div>
                        <div style={lbl}>{P.q} New ARR — QTD</div>
                        <div style={bigN(C.navy, true)}>{fk(P.q3Booked)}</div>
                        <div style={subN}>{arrQtdAtt}% of QTD target ({fk(P.qtdArrTarget)})</div>
                      </div>
                      <div>
                        <div style={lbl}>{P.q} Pipeline — QTD</div>
                        <div style={bigN(C.purp, true)}>{fk(P.pipeGen)}</div>
                        <div style={subN}>{pipeAtt}% of {fk(P.pipeQuota)} target</div>
                      </div>
                    </div>
                  </Card>
                </>
              );
            })()}

            <Card
              title="Pipeline Pulse — Week over Week"
              sub="Last 8 weeks per metric · click a row for the full breakdown"
            >
              <div style={{ padding: "8px 20px 14px" }}>
                {wowMetrics.map((m) => {
                  const clean = m.values.filter((v): v is number => v != null);
                  const last = clean[clean.length - 1];
                  return (
                    <div
                      key={m.metric}
                      onClick={() => {
                        setWowMetric(m.metric);
                        setTab("pipeline");
                      }}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) 190px 100px 70px",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 0",
                        borderBottom: `1px solid ${C.s1}`,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 13, color: C.t1 }}>{m.metric}</span>
                      <Sparkline data={clean} />
                      <span
                        style={{
                          textAlign: "right",
                          fontSize: 14,
                          fontWeight: 600,
                          fontFamily: "var(--font-dm-mono)",
                          color: C.t1,
                        }}
                      >
                        {last != null ? fmtMetricValue(last, m.money) : "—"}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        <DeltaPill delta={wowDeltaPct(m.values)} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="ARR Trend — Path to $10M" sub="Hover a point for details · dashed line = $10M milestone" accent={C.coral}>
              <div style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <ChartPeriodToggle period={period} onChange={setPeriod} />
                </div>
                <ArrChart points={chartPoints} milestone={10000000} milestoneLabel="$10M Milestone" />
              </div>
            </Card>

            {(() => {
              const mixWindow = period === "monthly" ? chartPoints.slice(-3) : chartPoints.slice(-13);
              return (
                <Card
                  title="New ARR Mix — Net New vs Expansion"
                  sub={period === "monthly" ? "Last 3 months, grouped per month · New ARR = Net New + Expansion" : "Last 13 weeks, grouped per week · New ARR = Net New + Expansion"}
                >
                  <div style={{ padding: "16px 20px" }}>
                    <GroupedBarChart
                      labels={mixWindow.map((m) => m.label)}
                      series={[
                        { label: "Net New", values: mixWindow.map((m) => m.newBusiness), color: C.navy },
                        { label: "Expansion", values: mixWindow.map((m) => m.expansion), color: C.teal },
                      ]}
                    />
                  </div>
                </Card>
              );
            })()}

            <Card
              title="Team ARR Attainment — Cumulative"
              sub="Running total of closed-won + live-paying ARR by month"
            >
              <div style={{ padding: "16px 20px" }}>
                <BarTrendChart
                  labels={derived.monthlyCumulative.map((m) => m.label)}
                  values={derived.monthlyCumulative.map((m) => m.actual)}
                  valueFormat="currency"
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                  <KV label="Actual (Q3)" v={fmt(derived.teamActual)} />
                  <KV label="Quota (Q3)" v={fmt(derived.teamQuota)} />
                  <KV
                    label="% of Quota"
                    v={pct(derived.teamPctOfQuota)}
                    color={derived.teamPctOfQuota >= 1 ? C.grn : C.t1}
                  />
                </div>
              </div>
            </Card>

            <Card
              title="Churned ARR — Cumulative vs Monthly"
              sub="Columns = cumulative churn over the last 12 months · line = churn in each month"
              accent={C.red}
            >
              <div style={{ padding: "16px 20px" }}>
                <BarTrendChart
                  labels={derived.churnWindow.map((m) => m.label)}
                  values={derived.churnCumulative}
                  valueFormat="currency"
                  barColor={C.red}
                  lineOverlay={{
                    label: "Monthly Churn",
                    values: derived.churnWindow.map((m) => m.churnedARR),
                    color: C.navy,
                  }}
                />
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "targets" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="Targets & Progress" sentence={tabSummaries.targets.sentence} stats={tabSummaries.targets.stats} />
          )}

          {pathToPlan && (() => {
            const P = pathToPlan;
            const tile = (bg: string) => ({
              background: bg,
              border: `1px solid ${C.bd}`,
              borderRadius: 12,
              padding: "13px 16px",
            });
            const lbl = { fontSize: 10.5, fontWeight: 600 as const, letterSpacing: ".05em", textTransform: "uppercase" as const, color: C.t3 };
            const big = (color: string) => ({ fontSize: 24, fontWeight: 700 as const, color, fontFamily: "var(--font-dm-mono)", marginTop: 3 });
            const sub = { fontSize: 11.5, color: C.t2, marginTop: 2 };
            return (
              <div style={{ marginBottom: 18 }}>
                {/* run-rate hero row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div style={tile("linear-gradient(135deg,#FBEEE9,#FBF7F1)")}>
                    <div style={lbl}>ARR added last week</div>
                    <div style={big(C.coralDk)}>{fmt(P.arrAddedLastWeek)}</div>
                    <div style={sub}>{P.arrWeekLabel && `week of ${P.arrWeekLabel}`}</div>
                  </div>
                  <div style={tile("linear-gradient(135deg,#EEEAF5,#FBF7F1)")}>
                    <div style={lbl}>Pipeline added last week</div>
                    <div style={big(C.purp)}>{fmt(P.pipeAddedLastWeek)}</div>
                    <div style={sub}>{P.arrWeekLabel && `week of ${P.arrWeekLabel}`}</div>
                  </div>
                </div>

                {/* run-rate-to-goal row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div style={tile("#fff")}>
                    <div style={lbl}>Weeks left in {P.q}</div>
                    <div style={big(C.t1)}>{P.weeksLeft}</div>
                    <div style={sub}>calendar weeks remaining</div>
                  </div>
                  <div style={tile("#fff")}>
                    <div style={lbl}>New ARR needed / wk — {P.q}</div>
                    <div style={big(C.coralDk)}>{fmt(P.arrPerWeek)}</div>
                    <div style={sub}>{fmt(P.arrGap)} left to {fmt(P.q3Target)} target</div>
                  </div>
                  <div style={tile("#fff")}>
                    <div style={lbl}>Pipeline needed / wk — {P.q}</div>
                    <div style={big(C.navy)}>{fmt(P.pipePerWeek)}</div>
                    <div style={sub}>{fmt(P.pipeGap)} left to {fmt(P.pipeQuota)} goal</div>
                  </div>
                </div>

                {/* plan targets row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginBottom: 16 }}>
                  <div style={tile("#fff")}>
                    <div style={{ ...lbl, minHeight: 26 }}>YTD New ARR Target</div>
                    <div style={{ ...big(C.t1), fontSize: 18 }}>{fmt(P.ytdTargetThroughNow)}</div>
                    <div style={sub}>through this month</div>
                  </div>
                  <div style={tile("#fff")}>
                    <div style={{ ...lbl, minHeight: 26 }}>YTD New ARR Booked</div>
                    <div style={{ ...big(C.coralDk), fontSize: 18 }}>{fmt(P.ytdBooked)}</div>
                    <div style={sub}>{P.ytdTargetThroughNow > 0 ? Math.round((P.ytdBooked / P.ytdTargetThroughNow) * 100) + "% of YTD target" : "—"}</div>
                  </div>
                  <div style={tile("#fff")}>
                    <div style={{ ...lbl, minHeight: 26 }}>{P.q} New ARR Target</div>
                    <div style={{ ...big(C.t1), fontSize: 18 }}>{fmt(P.q3Target)}</div>
                    <div style={sub}>&nbsp;</div>
                  </div>
                  <div style={tile("#fff")}>
                    <div style={{ ...lbl, minHeight: 26 }}>{P.q} New ARR Booked</div>
                    <div style={{ ...big(C.coralDk), fontSize: 18 }}>{fmt(P.q3Booked)}</div>
                    <div style={sub}>{P.q3Target > 0 ? Math.round((P.q3Booked / P.q3Target) * 100) + "% of target" : "—"}</div>
                  </div>
                  <div style={tile("#fff")}>
                    <div style={{ ...lbl, minHeight: 26 }}>FY26 New ARR Target</div>
                    <div style={{ ...big(C.t1), fontSize: 18 }}>{fmt(P.fy26NewArrTarget)}</div>
                    <div style={sub}>&nbsp;</div>
                  </div>
                  <div style={tile("#fff")}>
                    <div style={{ ...lbl, minHeight: 26 }}>FY26 Ending ARR Target</div>
                    <div style={{ ...big(C.navy), fontSize: 18 }}>{fmt(P.annualEnd)}</div>
                    <div style={sub}>&nbsp;</div>
                  </div>
                </div>

                <Card
                  title="New ARR booked vs target"
                  sub="Monthly bookings (New Business + Expansion) against plan — churn excluded"
                  accent={C.coral}
                >
                  <div style={{ padding: "16px 20px" }}>
                    <PlanChart data={P.chart} />
                  </div>
                </Card>
              </div>
            );
          })()}

          {pathToPlan && (() => {
            const P = pathToPlan;
            const nowMonth = new Date().getUTCMonth(); // 0 = Jan … 6 = Jul
            const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
            const kM = (n: number) => {
              const a = Math.abs(n);
              return "$" + (a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? Math.round(a / 1e3) + "k" : String(Math.round(a)));
            };
            const dlt = (n: number) => (n < 0 ? "−" : "") + kM(n);
            const H2_BG = "#EAF0FB";
            const attColor = (p: number) => (p >= 100 ? C.grn : p >= 75 ? C.ylw : p >= 40 ? C.coral : C.red);
            const attBg = (p: number) => (p >= 100 ? C.grnBg : p >= 75 ? C.ylwBg : p >= 40 ? C.coralSoft : C.redBg);

            const attCell = (att: number | null, withBar: boolean) => {
              if (att == null) return <span style={{ color: C.t3 }}>—</span>;
              const col = attColor(att);
              return (
                <div style={{ display: "flex", alignItems: "center", justifyContent: withBar ? "flex-start" : "flex-end", gap: 8 }}>
                  {withBar && (
                    <div style={{ flex: 1, maxWidth: 120, height: 7, borderRadius: 4, background: C.s1, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, att)}%`, height: "100%", background: col, borderRadius: 4 }} />
                    </div>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 700, color: col, background: attBg(att), padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
                    {Math.round(att)}%
                  </span>
                </div>
              );
            };

            const dataRow = (
              key: string,
              label: React.ReactNode,
              target: number,
              booked: number | null,
              endArr: number,
              h2: boolean,
              total: boolean,
              ytd: boolean
            ) => {
              const delta = booked == null ? null : booked - target;
              const att = booked == null || target <= 0 ? null : (booked / target) * 100;
              const bg = ytd ? "#fff" : total ? (h2 ? H2_BG : C.s2) : h2 ? H2_BG : "transparent";
              const dc = delta == null ? C.t3 : delta >= 0 ? C.grn : C.coralDk;
              return (
                <tr key={key} style={{ background: bg, borderTop: ytd ? `2px solid ${C.navy}` : `1px solid ${C.s1}` }}>
                  <Td l bold={total}>{label}</Td>
                  <Td mono color={C.t2} bold={total}>{money(target)}</Td>
                  <Td mono color={booked == null ? C.t3 : C.coralDk} bold={total}>{booked == null ? "—" : money(booked)}</Td>
                  <Td mono color={dc} bold={total}>{delta == null ? "—" : dlt(delta)}</Td>
                  <td style={{ padding: "10px 16px" }}>{attCell(att, !total)}</td>
                  <Td mono color={C.t2} bold={total}>{money(endArr)}</Td>
                </tr>
              );
            };

            return (
              <Card
                title="Monthly detail — booked vs target"
                sub="Jul onward (H2) is the rebased plan to $10M year-end — shown shaded; Jan–Jun (H1) unshaded. Jul–Dec targets are the net-new ARR implied by each month's Ending-ARR step."
              >
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: C.s1, borderBottom: `1px solid ${C.bd}` }}>
                        <Th l>Month</Th>
                        <Th>Target New ARR</Th>
                        <Th>Booked</Th>
                        <Th>Δ</Th>
                        <Th l>Attainment</Th>
                        <Th>Ending ARR Target</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {P.chart.map((c, i) =>
                        dataRow(
                          c.month,
                          <>
                            <span style={{ fontWeight: 600, color: C.t1 }}>{c.month}</span>{" "}
                            <span style={{ color: C.t3, fontSize: 11 }}>{`Q${Math.floor(i / 3) + 1}`}</span>
                          </>,
                          c.target,
                          i <= nowMonth ? (c.booked ?? 0) : null,
                          TARGETS.endARR[i],
                          i >= 6,
                          false,
                          false
                        )
                      )}
                      {[0, 1, 2, 3].map((qi) => {
                        const idxs = [qi * 3, qi * 3 + 1, qi * 3 + 2];
                        const target = idxs.reduce((s, i) => s + TARGETS.newARR[i], 0);
                        const elapsed = idxs.filter((i) => i <= nowMonth);
                        const booked = elapsed.length
                          ? elapsed.reduce((s, i) => s + (P.chart[i].booked ?? 0), 0)
                          : null;
                        return dataRow(
                          `q${qi + 1}`,
                          <span style={{ fontWeight: 700 }}>{`Q${qi + 1} total`}</span>,
                          target,
                          booked,
                          TARGETS.endARR[qi * 3 + 2],
                          qi >= 2,
                          true,
                          false
                        );
                      })}
                      {(() => {
                        const idxs = P.chart.map((_, i) => i).filter((i) => i <= nowMonth);
                        const t = idxs.reduce((s, i) => s + TARGETS.newARR[i], 0);
                        const b = idxs.reduce((s, i) => s + (P.chart[i].booked ?? 0), 0);
                        return dataRow(
                          "ytd",
                          <>
                            <span style={{ fontWeight: 700 }}>2026 YTD</span>{" "}
                            <span style={{ color: C.t3, fontSize: 11 }}>through {P.chart[nowMonth].month}</span>
                          </>,
                          t,
                          b,
                          TARGETS.endARR[nowMonth],
                          false,
                          true,
                          true
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })()}
        </div>
      )}

      {tab === "pipeline" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="Pipeline" sentence={tabSummaries.pipeline.sentence} stats={tabSummaries.pipeline.stats} />
          )}
          <Card
            title="Pipeline Progression — Week over Week"
            sub={`Filtered by: ${data.pipelineWow.filterRep} · pick a metric to chart it`}
          >
            {(() => {
              const labels = data.pipelineWow.weekLabels;
              const active = wowMetrics.find((m) => m.metric === activeWowMetric) ?? wowMetrics[0];
              if (!active) return <div style={{ padding: 20, color: C.t3, fontSize: 13 }}>No data available.</div>;
              return (
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                    {wowMetrics.map((m) => (
                      <button
                        key={m.metric}
                        onClick={() => setWowMetric(m.metric)}
                        style={{
                          padding: "5px 12px",
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 6,
                          border: `1px solid ${C.bd}`,
                          background: m.metric === active.metric ? C.navy : "#fff",
                          color: m.metric === active.metric ? "#fff" : C.t2,
                          cursor: "pointer",
                        }}
                      >
                        {m.metric}
                      </button>
                    ))}
                  </div>

                  <LineTrendChart
                    labels={labels}
                    series={[{ label: active.metric, values: active.values, color: C.navy }]}
                    valueFormat={active.money ? "currency" : "number"}
                  />

                  <div style={{ overflowX: "auto", marginTop: 16 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                          <Th l>Metric</Th>
                          {labels.map((w) => (
                            <Th key={w}>{w}</Th>
                          ))}
                          <Th>WoW</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {wowMetrics.map((m) => (
                          <tr
                            key={m.metric}
                            onClick={() => setWowMetric(m.metric)}
                            style={{
                              borderBottom: `1px solid ${C.s1}`,
                              cursor: "pointer",
                              background: m.metric === active.metric ? C.s1 : "transparent",
                            }}
                          >
                            <Td l bold={m.metric === active.metric}>{m.metric}</Td>
                            {m.values.map((v, i) => (
                              <Td key={i} mono>
                                {v == null ? "—" : fmtMetricValue(v, m.money)}
                              </Td>
                            ))}
                            <td style={{ textAlign: "right", padding: "10px 16px" }}>
                              <DeltaPill delta={wowDeltaPct(m.values)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </Card>

          <Card
            title="Pipeline Movement — Trend"
            sub="New pipeline created, closed-won, and closed-lost, over time — filter by AE and by what you want to see"
            accent={C.coral}
          >
            <div style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.t3, marginBottom: 4, textTransform: "uppercase" }}>
                    AE
                  </div>
                  <select
                    value={pipeAeFilter}
                    onChange={(e) => setPipeAeFilter(e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.bd}`, fontSize: 13, color: C.t1, background: "#fff" }}
                  >
                    <option value="All">All AEs</option>
                    {pipeOwners.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.t3, marginBottom: 4, textTransform: "uppercase" }}>
                    Criteria
                  </div>
                  <select
                    value={pipeCriteria}
                    onChange={(e) => setPipeCriteria(e.target.value as typeof pipeCriteria)}
                    style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.bd}`, fontSize: 13, color: C.t1, background: "#fff" }}
                  >
                    <option value="created">New Pipeline Created ($)</option>
                    <option value="createdCount">New Opps Created (#)</option>
                    <option value="closedWon">Closed Won ($)</option>
                    <option value="closedLost">Closed Lost ($)</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.t3, marginBottom: 4, textTransform: "uppercase" }}>
                    Period
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["weekly", "monthly"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPipePeriod(p)}
                        style={{
                          padding: "6px 12px",
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 6,
                          border: `1px solid ${C.bd}`,
                          background: pipePeriod === p ? C.navy : "#fff",
                          color: pipePeriod === p ? "#fff" : C.t2,
                          cursor: "pointer",
                        }}
                      >
                        {p === "weekly" ? "WoW" : "MoM"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <BarTrendChart
                labels={pipelineTrend.labels}
                values={pipelineTrend.values}
                valueFormat={pipeCriteria === "createdCount" ? "number" : "currency"}
              />
            </div>
          </Card>

          <Card
            title="Pipeline generation by AE — Q3 FY26"
            sub="New pipeline created this quarter — total contract value (Amount) of opps reaching SQL, vs each AE's quarterly pipe-generation target. Open pipeline shown for context."
            accent={C.coral}
          >
            {(() => {
              const kM = (n: number) => {
                const a = Math.abs(n);
                if (a >= 1e6) return "$" + (a / 1e6).toFixed(2) + "M";
                if (a >= 1e3) return "$" + Math.round(a / 1e3) + "k";
                return "$" + Math.round(a);
              };
              const quotaByName: Record<string, number | null> = {};
              for (const r of data.pipeline.aeBreakdown) quotaByName[r.name] = r.quota;
              const genTargetOf = (name: string) => {
                const q = quotaByName[name];
                return q != null && q > 0 ? q : null;
              };
              const roster = [...data.forecastTab.rows].sort(
                (a, b) => Number(a.am) - Number(b.am)
              );
              const aeRows = roster.filter((r) => !r.am);
              const teamTarget = aeRows.reduce((s, r) => s + (genTargetOf(r.name) ?? 0), 0);
              const teamGen = aeRows.reduce((s, r) => s + (q3CreatedByOwner[r.name] ?? 0), 0);
              const teamOpps = aeRows.reduce((s, r) => s + (q3CreatedCountByOwner[r.name] ?? 0), 0);
              const teamOpen = aeRows.reduce((s, r) => s + (r.openPipe ?? 0), 0);
              const progressCell = (gen: number, target: number | null) => {
                if (target == null)
                  return <span style={{ fontSize: 12, color: C.t3 }}>no target</span>;
                const p = target > 0 ? Math.round((gen / target) * 100) : 0;
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <Bar value={gen} target={target} />
                    </div>
                    <span style={{ fontSize: 12, color: C.t3, minWidth: 30, textAlign: "right" }}>
                      {p}%
                    </span>
                  </div>
                );
              };
              return (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.s1, borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>AE</Th>
                      <Th>Gen Target</Th>
                      <Th>Generated QTD (TCV)</Th>
                      <Th l>Progress to Gen Target</Th>
                      <Th># Opps</Th>
                      <Th>Open Pipeline</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((row) => {
                      const target = genTargetOf(row.name);
                      const gen = q3CreatedByOwner[row.name] ?? 0;
                      const opps = q3CreatedCountByOwner[row.name] ?? 0;
                      return (
                        <tr key={row.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                          <Td l bold>
                            {row.name}
                            {row.am && (
                              <span style={{ fontSize: 11, color: C.t3, fontWeight: 400 }}> · AM</span>
                            )}
                          </Td>
                          <Td mono color={C.navy2}>{target != null ? kM(target) : "—"}</Td>
                          <Td mono bold color={C.purp}>{kM(gen)}</Td>
                          <td style={{ padding: "10px 16px", width: 220 }}>
                            {progressCell(gen, target)}
                          </td>
                          <Td mono color={C.navy2}>{opps}</Td>
                          <Td mono>{kM(row.openPipe ?? 0)}</Td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: C.s1, borderTop: `2px solid ${C.navy}` }}>
                      <Td l bold>Team (AEs)</Td>
                      <Td mono bold color={C.navy2}>{kM(teamTarget)}</Td>
                      <Td mono bold color={C.purp}>{kM(teamGen)}</Td>
                      <td style={{ padding: "10px 16px", width: 220 }}>
                        {progressCell(teamGen, teamTarget)}
                      </td>
                      <Td mono bold color={C.navy2}>{teamOpps}</Td>
                      <Td mono bold>{kM(teamOpen)}</Td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </Card>

        </div>
      )}

      {tab === "attainment" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="AE Attainment" sentence={tabSummaries.attainment.sentence} stats={tabSummaries.attainment.stats} />
          )}
          <Card title="AE Attainment — Q3 FY26">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>AE</Th>
                  <Th>Quota</Th>
                  <Th>Actual</Th>
                  <Th>% of Quota</Th>
                  <Th l>Progress</Th>
                </tr>
              </thead>
              <tbody>
                {data.aeAttainment.reps.map((rep) => (
                  <tr key={rep.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                    <Td l bold>{rep.name}</Td>
                    <Td mono>{fmt(rep.quota)}</Td>
                    <Td mono>{fmt(rep.actual)}</Td>
                    <Td mono color={rep.pctOfQuota >= 1 ? C.grn : C.t1}>{pct(rep.pctOfQuota)}</Td>
                    <td style={{ padding: "10px 16px", width: 160 }}>
                      <Bar value={rep.actual} target={rep.quota} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card
            title="Pipe Generation History — Monthly"
            sub="New pipeline created and new opps entered SQL, by rep, since Jan-25"
          >
            <div style={{ padding: "16px 20px" }}>
              <div style={{ marginBottom: 16 }}>
                <select
                  value={trendRep}
                  onChange={(e) => setTrendRep(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: `1px solid ${C.bd}`,
                    fontSize: 13,
                    color: C.t1,
                    background: "#fff",
                  }}
                >
                  {Object.keys(data.pipelineWow.newArrMom.reps).map((rep) => (
                    <option key={rep} value={rep}>
                      {rep}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.t2, marginBottom: 6 }}>
                New Pipeline Created ($)
              </div>
              <div style={{ marginBottom: 24 }}>
                <BarTrendChart
                  labels={data.pipelineWow.newArrMom.months}
                  values={data.pipelineWow.newArrMom.reps[trendRep] ?? []}
                  valueFormat="currency"
                />
              </div>

              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.t2, marginBottom: 6 }}>
                New Opps Entered (SQL)
              </div>
              <BarTrendChart
                labels={data.pipelineWow.newOppsMom.months}
                values={data.pipelineWow.newOppsMom.reps[trendRep] ?? []}
                valueFormat="number"
              />
            </div>
          </Card>
        </div>
      )}

      {tab === "forecast" && (() => {
        const F = data.forecastTab;
        const Q = data.quarter;
        const roster = F.rows;
        const money = (n: number | null) => (n == null ? "\u2014" : fmt(n));
        const short = (name: string) => name.split(" ")[0];

        // Decide board derived numbers
        const decideView = F.decideDeals.filter((d) => decideAE === "all" || d.owner === decideAE);
        const decideOwners = ["all", ...Array.from(new Set(F.decideDeals.map((d) => d.owner)))];
        let committed = 0, commitBest = 0;
        for (const d of F.decideDeals) {
          const call = dealCalls[d.name];
          if (call === "commit") { committed += d.arr; commitBest += d.arr; }
          else if (call === "best") { commitBest += d.arr; }
        }
        const landingInclCW = committed + F.teamActual;
        const committedCount = Object.values(dealCalls).filter((v) => v === "commit").length;

        const vsQuotaPill = (pctv: number | null, variance: number | null) => {
          if (pctv == null) return <span style={{ fontSize: 12, color: C.t3 }}>&mdash;</span>;
          const tone = pctv >= 1 ? "good" : pctv >= 0.8 ? "warn" : "bad";
          const bg = tone === "good" ? C.grnBg : tone === "warn" ? C.ylwBg : C.redBg;
          const fg = tone === "good" ? C.grn : tone === "warn" ? C.ylw : C.red;
          return (
            <span style={{ background: bg, color: fg, padding: "3px 8px", borderRadius: 9, fontSize: 11, fontWeight: 600, display: "inline-block", textAlign: "center", lineHeight: 1.3 }}>
              {pct(pctv)}
              {variance != null && <><br />{variance >= 0 ? "+" : ""}{fmt(variance)}</>}
            </span>
          );
        };

        const callBtn = (deal: string, type: "commit" | "best" | "pipeline" | "omit", label: string, activeBg: string) => {
          const active = dealCalls[deal] === type;
          return (
            <button
              onClick={() => setDealCalls((prev) => ({ ...prev, [deal]: prev[deal] === type ? (undefined as never) : type }))}
              style={{ padding: "3px 9px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.bd}`, margin: "0 2px", cursor: "pointer", background: active ? activeBg : "#fff", color: active ? "#fff" : C.t2 }}
            >
              {label}
            </button>
          );
        };

        return (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="Forecast" sentence={tabSummaries.forecast.sentence} stats={tabSummaries.forecast.stats} />
          )}

          {/* header tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <Card title={`${Q.key} Projected Close`}>
              <div style={{ padding: "14px 18px" }}>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: F.teamProjected >= F.teamQuota ? C.grn : C.ylw }}>{fmt(F.teamProjected)}</div>
                <div style={{ fontSize: 12, color: C.t2, marginTop: 2 }}>vs {fmt(F.teamQuota)} quota · {pct(F.teamQuota ? F.teamProjected / F.teamQuota : 0)}</div>
              </div>
            </Card>
            <Card title="Projected Year-End ARR">
              <div style={{ padding: "14px 18px" }}>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: F.projYE >= F.annualTarget ? C.grn : C.coralDk }}>{fmt(F.projYE)}</div>
                <div style={{ fontSize: 12, color: C.t2, marginTop: 2 }}>vs {fmt(F.annualTarget)} · gap {fmt(F.annualGap)}</div>
              </div>
            </Card>
          </div>

          {/* in-quarter table */}
          <Card title={`In-quarter forecast — ${Q.label}`} sub="Per AE (incl. AM). Potential = Closed Won + Pot. New Biz + Pot. Expansion (open-deal quarter-expected revenue; Closed Won excluded from weighting).">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                    <Th l>AE</Th><Th>Open Pipeline</Th><Th>Quota</Th><Th>Closed Won</Th><Th>Pot. New Biz</Th><Th>Pot. Expansion</Th><Th>Potential</Th><Th>vs Quota</Th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <Td l bold>{short(r.name)}{r.am && <span style={{ color: C.t3, fontWeight: 400, fontSize: 11 }}> · AM</span>}</Td>
                      <Td mono color={C.blue}>{fmt(r.openPipe)}</Td>
                      <Td mono color={C.t2}>{r.quota != null && r.quota > 0 ? fmt(r.quota) : "\u2014"}</Td>
                      <Td mono color={r.closedWon > 0 ? C.coralDk : C.t1}>{fmt(r.closedWon)}</Td>
                      <Td mono color={C.coralDk}>{fmt(r.potNB)}</Td>
                      <Td mono color={C.purp}>{fmt(r.potExp)}</Td>
                      <Td mono bold>{fmt(r.potential)}</Td>
                      <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(r.attainP, r.variance)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `2px solid ${C.navy}`, background: C.s2, fontWeight: 700 }}>
                    <Td l bold>AE team</Td>
                    <Td mono>{fmt(F.aeTeam.openPipe)}</Td><Td mono>{fmt(F.aeTeam.quota)}</Td><Td mono>{fmt(F.aeTeam.closedWon)}</Td>
                    <Td mono color={C.coralDk}>{fmt(F.aeTeam.potNB)}</Td><Td mono color={C.purp}>{fmt(F.aeTeam.potExp)}</Td><Td mono bold>{fmt(F.aeTeam.potential)}</Td>
                    <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(F.aeTeam.attainP, F.aeTeam.variance)}</td>
                  </tr>
                  <tr style={{ background: "#EEF2F8", fontWeight: 700 }}>
                    <Td l bold>Total · incl AM</Td>
                    <Td mono>{fmt(F.totalInclAM.openPipe)}</Td><Td mono>{fmt(F.totalInclAM.quota)}</Td><Td mono>{fmt(F.totalInclAM.closedWon)}</Td>
                    <Td mono color={C.coralDk}>{fmt(F.totalInclAM.potNB)}</Td><Td mono color={C.purp}>{fmt(F.totalInclAM.potExp)}</Td><Td mono bold>{fmt(F.totalInclAM.potential)}</Td>
                    <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(F.totalInclAM.attainP, null)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* remainder of quarter */}
          <Card title={`Remainder of ${Q.label} — ${F.daysLeft} days, ${F.weeksLeft} week${F.weeksLeft === 1 ? "" : "s"} left`} sub="What still has to close to reach quota, the weekly run-rate that implies, and where Potential ARR projects the quarter to land." accent={C.coral}>
            <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <div>
                <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Still to close (to quota)</div>
                <div style={{ fontSize: 23, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: F.quotaGap > 0 ? C.coralDk : C.grn }}>{F.quotaGap > 0 ? fmt(F.quotaGap) : "met"}</div>
                <div style={{ fontSize: 12, color: C.t2 }}>{fmt(F.teamActual)} of {fmt(F.teamQuota)} quota closed</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>ARR needed / week left</div>
                <div style={{ fontSize: 23, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.navy }}>{F.quotaGap > 0 ? fmt(F.quotaPerWeek) : "\u2014"}</div>
                <div style={{ fontSize: 12, color: C.t2 }}>across {F.weeksLeft} week{F.weeksLeft === 1 ? "" : "s"} remaining</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Quarter landing (Potential ARR)</div>
                <div style={{ fontSize: 23, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: F.potentialLanding >= F.teamQuota ? C.grn : C.coralDk }}>{fmt(F.potentialLanding)}</div>
                <div style={{ fontSize: 12, color: C.t2 }}>{pct(F.teamQuota ? F.potentialLanding / F.teamQuota : 0)} of quota · NB CW + NB open</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Surplus / shortfall vs quota</div>
                <div style={{ fontSize: 23, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: F.potentialLanding >= F.teamQuota ? C.grn : C.red }}>{F.potentialLanding >= F.teamQuota ? "+" + fmt(F.potentialLanding - F.teamQuota) : fmt(F.potentialLanding - F.teamQuota)}</div>
                <div style={{ fontSize: 12, color: C.t2 }}>if open expected lands as forecast</div>
              </div>
            </div>
          </Card>

          {/* deals that decide */}
          <Card title={`Deals that decide ${Q.label}`} sub={`Biggest open deals by ARR${decideAE === "all" ? "" : " · " + short(decideAE)}. Filter by AE to work rep-by-rep. Top ${decideView.length} by ARR · ${fmt(decideView.reduce((s, d) => s + d.arr, 0))} in view.`} accent={C.coral}>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                {decideOwners.map((o) => (
                  <button key={o} onClick={() => setDecideAE(o)} style={{ padding: "5px 13px", fontSize: 12, fontWeight: 600, borderRadius: 20, border: `1px solid ${o === decideAE ? C.coral : C.bd}`, background: o === decideAE ? C.coralSoft : "#fff", color: o === decideAE ? C.coralDk : C.t2, cursor: "pointer" }}>
                    {o === "all" ? "All" : short(o)}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Committed (ARR)</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.grn }}>{fmt(committed)}</div>
                  <div style={{ fontSize: 11.5, color: C.t2 }}>{committedCount} deals committed · {fmt(committed + F.teamActual - F.teamQuota)} vs quota incl. CW</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Commit + best case</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.navy }}>{fmt(commitBest)}</div>
                  <div style={{ fontSize: 11.5, color: C.t2 }}>upside if best-case lands</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Landing incl. CW</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.coralDk }}>{fmt(landingInclCW)}</div>
                  <div style={{ fontSize: 11.5, color: C.t2 }}>{pct(F.teamQuota ? landingInclCW / F.teamQuota : 0)} of {fmt(F.teamQuota)} quota</div>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>Deal</Th><Th l>AE</Th><Th l>Stage</Th><Th>Age</Th><Th>ARR</Th><Th>Call</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {decideView.map((d, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.s1}` }}>
                        <Td l bold>{d.name}</Td>
                        <Td l>{short(d.owner)}</Td>
                        <Td l><Pill tone="blue">{d.stage}</Pill></Td>
                        <Td mono color={(d.ageDays ?? 0) > 90 ? C.red : C.t2}>{d.ageDays != null ? d.ageDays + "d" : "\u2014"}</Td>
                        <Td mono bold color={C.coralDk}>{fmt(d.arr)}</Td>
                        <td style={{ textAlign: "center", padding: "8px 10px", whiteSpace: "nowrap" }}>
                          {callBtn(d.name, "commit", "Commit", C.grn)}
                          {callBtn(d.name, "best", "Best case", C.navy)}
                          {callBtn(d.name, "pipeline", "Pipeline", C.blue)}
                          {callBtn(d.name, "omit", "Omit", C.t3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* ── Next quarter at a glance ── */}
          {(() => {
            const NQ = F.nextQuarter;
            const fk = (n: number) => {
              const a = Math.abs(n); const s = n < 0 ? "−" : "";
              if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
              if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "k";
              return s + "$" + Math.round(a);
            };
            return (
              <Card
                title={`Next quarter at a glance — ${NQ.label}`}
                sub={`How ${NQ.label} is shaping up. The pipeline dated to close in ${NQ.label.split(" ")[0]} is mostly early-stage right now, so its raw value (${fk(NQ.raw)}) and its realistic AE-weighted value (${fk(NQ.realistic)}) are far apart. The table shows where that gap comes from. Quarter starts ${NQ.startISO}.`}
                accent={C.coral}
              >
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 28, paddingBottom: 16, borderBottom: `1px solid ${C.s1}`, marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>{NQ.label.split(" ")[0]} Team Quota</div>
                      <div style={{ fontSize: 30, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: C.navy, marginTop: 5 }}>{fk(NQ.quota)}</div>
                      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>New ARR target — what we need to close</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Realistic from Current Pipe</div>
                      <div style={{ fontSize: 30, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: C.coralDk, marginTop: 5 }}>{fk(NQ.realistic)}</div>
                      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>AE-weighted · covers {pct(NQ.coversPct)} of quota</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Gap to Source / Advance</div>
                      <div style={{ fontSize: 30, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: C.coralDk, marginTop: 5 }}>{fk(NQ.gap)}</div>
                      <div style={{ fontSize: 12, color: C.t2, marginTop: 6 }}>quota minus realistic pipe</div>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Where the {fk(NQ.raw)} raw pipeline stands — and why it weights down to {fk(NQ.realistic)}</div>
                  {NQ.byStage.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.t3, padding: "10px 0" }}>No open deals are dated to close in {NQ.label} yet.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                          <Th l>Stage</Th><Th>Deals</Th><Th>Raw ARR</Th><Th>AE Expected</Th><Th l>How much survives weighting</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {NQ.byStage.map((s) => (
                          <tr key={s.stage} style={{ borderBottom: `1px solid ${C.s1}` }}>
                            <Td l><Pill tone="blue">{s.stage}</Pill></Td>
                            <Td mono>{s.count}</Td>
                            <Td mono color={C.blue}>{fk(s.raw)}</Td>
                            <Td mono color={C.coralDk}>{fk(s.aeExpected)}</Td>
                            <td style={{ padding: "10px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ flex: 1, maxWidth: 220, height: 7, background: C.s2, borderRadius: 4, overflow: "hidden" }}>
                                  <div style={{ width: `${Math.max(2, Math.round(s.survivesPct * 100))}%`, height: "100%", background: C.coral, borderRadius: 4 }} />
                                </div>
                                <span style={{ fontSize: 11, color: C.t2 }}>{pct(s.survivesPct)}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: `2px solid ${C.navy}`, background: C.s2, fontWeight: 700 }}>
                          <Td l bold>Total</Td>
                          <Td mono>{NQ.count}</Td>
                          <Td mono color={C.blue}>{fk(NQ.raw)}</Td>
                          <Td mono color={C.coralDk}>{fk(NQ.realistic)}</Td>
                          <td style={{ padding: "10px 16px", fontSize: 12, color: C.t2, fontWeight: 400 }}>{fk(NQ.lateStageRaw)} of raw is late-stage (SQO+)</td>
                        </tr>
                      </tbody>
                    </table>
                  )}

                  <div style={{ background: "#FAEEDA", borderRadius: 12, padding: "14px 16px", marginTop: 16, fontSize: 13.5, color: "#6b5320", lineHeight: 1.55 }}>
                    Read it this way: {NQ.label.split(" ")[0]} quota is <b>{fk(NQ.quota)}</b>. The pipeline already dated for {NQ.label.split(" ")[0]} would be worth <b>{fk(NQ.raw)}</b> if every deal closed at full value, but most of it is sitting in early stages where deals rarely convert — so the AE-weighted realistic figure is <b>{fk(NQ.realistic)}</b>, about <b>{pct(NQ.coversPct)}</b> of quota. The team needs to source or advance roughly <b>{fk(NQ.gap)}</b> more of weighted pipeline before {NQ.label.split(" ")[0]} starts to be on track.
                  </div>
                </div>
              </Card>
            );
          })()}

          {/* ── Year-end projection vs annual target (per-stage waterfall) ── */}
          {(() => {
            const fk = (n: number) => {
              const a = Math.abs(n); const s = n < 0 ? "−" : "";
              if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
              if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "k";
              return s + "$" + Math.round(a);
            };
            const PLOT = 300;
            const maxV = Math.max(F.annualTarget, F.projYE) * 1.05;
            const yPx = (v: number) => (v / maxV) * PLOT;
            type Step = { label: string; type: "base" | "inc" | "gap" | "target"; value: number; of?: string; from?: number };
            const steps: Step[] = [
              { label: "Current live ARR", type: "base", value: F.currentLiveARR },
              ...F.yeWaterfall.map((w) => ({ label: w.stage, type: "inc" as const, value: w.weighted, of: `of ${fk(w.raw)}` })),
              { label: "Gap to target", type: "gap", value: Math.max(0, F.annualGap), from: F.projYE },
              { label: "FY26 target", type: "target", value: F.annualTarget },
            ];
            const n = steps.length;
            let running = 0;
            return (
              <Card title="Year-end projection vs annual target" sub="Current ARR plus all open pipeline weighted at the derived per-stage close rates, versus the FY26 ending-ARR target." accent={C.navy}>
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ position: "relative", height: PLOT, borderBottom: `1px solid ${C.bd}` }}>
                    {steps.map((s, i) => {
                      const leftPct = (i / n) * 100;
                      const colW = (1 / n) * 100;
                      let bottomV = 0, heightV = s.value, color = C.navy, capColor = C.t1;
                      let cap: React.ReactNode = fk(s.value);
                      if (s.type === "base") { bottomV = 0; running = s.value; color = C.navy; }
                      else if (s.type === "inc") { bottomV = running; color = "#7FA8D0"; capColor = C.blue; running += s.value; cap = (<><span style={{ color: C.t3, fontWeight: 600 }}>{s.of}</span><br />+{fk(s.value)}</>); }
                      else if (s.type === "gap") { bottomV = s.from ?? 0; color = "#C0524A"; capColor = C.red; }
                      else { bottomV = 0; color = C.grn; capColor = C.grn; }
                      const bPx = yPx(bottomV);
                      const hPx = Math.max(yPx(heightV), s.type === "inc" ? 2 : 3);
                      return (
                        <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${leftPct}%`, width: `${colW}%` }}>
                          <div style={{ position: "absolute", left: "14%", width: "72%", bottom: bPx, height: hPx, background: color, borderRadius: "3px 3px 0 0" }} />
                          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: bPx + hPx + 4, fontSize: 9.5, fontWeight: 700, color: capColor, whiteSpace: "nowrap", textAlign: "center", lineHeight: 1.25 }}>{cap}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ position: "relative", height: 34, marginTop: 6 }}>
                    {steps.map((s, i) => (
                      <div key={i} style={{ position: "absolute", left: `${(i / n) * 100}%`, width: `${(1 / n) * 100}%`, textAlign: "center", fontSize: 9.5, color: C.t2, lineHeight: 1.15 }}>{s.label}</div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginTop: 18 }}>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Current Live ARR</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)" }}>{fk(F.currentLiveARR)}</div></div>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Weighted Open Pipe</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.blue }}>{fk(F.weightedAnnual)}</div><div style={{ fontSize: 10.5, color: C.t3 }}>from {fk(F.rawAnnual)} raw</div></div>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Projected Year-End</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.coralDk }}>{fk(F.projYE)}</div></div>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Annual Target</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)" }}>{fk(F.annualTarget)}</div></div>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Gap</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: F.annualGap > 0 ? C.red : C.grn }}>{fk(F.annualGap)}</div></div>
                  </div>

                  <div style={{ background: "#FAEEDA", borderRadius: 12, padding: "14px 16px", marginTop: 16, fontSize: 13.5, color: "#6b5320", lineHeight: 1.55 }}>
                    {F.annualGap > 0 ? (
                      <>To cover the <b>{fk(F.annualGap)}</b> shortfall at the assumed <b>25%</b> close rate, the team needs to create roughly <b style={{ color: C.coralDk }}>{fk(F.pipelineNeededForGap)}</b> of net-new pipeline beyond what's already open.</>
                    ) : (
                      <>Projected year-end of <b>{fk(F.projYE)}</b> is on track to meet or exceed the <b>{fk(F.annualTarget)}</b> target.</>
                    )}
                  </div>
                </div>
              </Card>
            );
          })()}
        </div>
        );
      })()}

      {tab === "health" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="Deal Health" sentence={tabSummaries.health.sentence} stats={tabSummaries.health.stats} />
          )}
          <Card
            title="Pipeline Aging"
            sub="Open deals bucketed by days since last stage change — stale deals need attention"
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>Age Bucket</Th>
                  <Th># Deals</Th>
                  <Th>ARR</Th>
                </tr>
              </thead>
              <tbody>
                {data.dealHealth.map((b) => (
                  <tr key={b.label} style={{ borderBottom: `1px solid ${C.s1}` }}>
                    <Td l bold color={b.min >= 91 ? C.red : b.min >= 31 ? C.ylw : C.t1}>
                      {b.label}
                    </Td>
                    <Td mono>{b.count}</Td>
                    <Td mono>{fmt(b.arr)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Largest Open Deals" sub="Top 25 open deals, ranked by ARR">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>Deal</Th>
                  <Th l>Owner</Th>
                  <Th l>Stage</Th>
                  <Th>ARR</Th>
                  <Th>Days Since Stage Change</Th>
                </tr>
              </thead>
              <tbody>
                {data.rankedDeals.map((d, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.s1}` }}>
                    <Td l>{d.name}</Td>
                    <Td l>{d.owner}</Td>
                    <Td l>{d.stage}</Td>
                    <Td mono bold>{fmt(d.arr)}</Td>
                    <Td mono color={(d.ageDays ?? 0) > 90 ? C.red : (d.ageDays ?? 0) > 30 ? C.ylw : C.t1}>
                      {d.ageDays ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "acv" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="ACV & Deal Size" sentence={tabSummaries.acv.sentence} stats={tabSummaries.acv.stats} />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
            <Card title="Average Deal Size">
              <div style={{ padding: 20 }}>
                <KV label="Across all won deals (18mo)" v={fmt(data.acv.avg)} />
              </div>
            </Card>
            <Card title="Median Deal Size">
              <div style={{ padding: 20 }}>
                <KV label="Less skewed by outliers" v={fmt(data.acv.median)} />
              </div>
            </Card>
            <Card title="Win Rate (YTD)">
              <div style={{ padding: 20 }}>
                <KV
                  label={`${data.winRateYtd.wonCount} of ${data.winRateYtd.closedCount} closed New Biz`}
                  v={data.winRateYtd.winRate != null ? pct(data.winRateYtd.winRate) : "—"}
                  color={C.navy}
                />
              </div>
            </Card>
          </div>

          <Card title="Avg Sales Cycle (YTD)" sub="Days from SQL to close, won New Business deals">
            <div style={{ padding: 20, display: "flex", gap: 40 }}>
              <KV label="Average" v={data.winRateYtd.avgCycle != null ? `${data.winRateYtd.avgCycle.toFixed(0)}d` : "—"} />
              <KV label="Median" v={data.winRateYtd.medianCycle != null ? `${data.winRateYtd.medianCycle}d` : "—"} />
            </div>
          </Card>

          <Card title="Deal Size Distribution">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>Range</Th>
                  <Th># Deals</Th>
                  <Th>Total ARR</Th>
                </tr>
              </thead>
              <tbody>
                {data.acv.buckets.map((b) => (
                  <tr key={b.label} style={{ borderBottom: `1px solid ${C.s1}` }}>
                    <Td l bold>{b.label}</Td>
                    <Td mono>{b.count}</Td>
                    <Td mono>{fmt(b.arr)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "productarr" && (() => {
        const monthly = data.arr.monthly.filter((p) => p.label.startsWith("2026-"));
        const weekly = data.arr.weekly.slice(-6);
        const wLabels = weekly.map((p) => p.label.slice(5));
        const mWin = monthly.slice(-6);
        const mLabels = mWin.map((p) => p.label.slice(5));

        const PRODUCTS = [
          { key: "alfie" as const, name: "Alfie", color: C.purp, target: "alfieTarget" as const },
          { key: "managedServices" as const, name: "Managed Services", color: C.teal, target: "msTarget" as const },
          { key: "coreExisting" as const, name: "Core Existing", color: C.navy, target: null },
        ];

        const wowPill = (series: number[]) => {
          const clean = series.filter((v) => v != null);
          if (clean.length < 2) return <DeltaPill delta={null} />;
          const last = clean[clean.length - 1], prev = clean[clean.length - 2];
          return <DeltaPill delta={prev === 0 ? null : ((last - prev) / Math.abs(prev)) * 100} />;
        };

        // exec summary line
        const latest = monthly[monthly.length - 1];
        const summ = `Product ARR: Core Existing ${fmt(latest?.coreExisting ?? 0)}, Managed Services ${fmt(latest?.managedServices ?? 0)}, Alfie ${fmt(latest?.alfie ?? 0)}.`;

        const captureHTML = () => {
          const el = document.getElementById("productArrCapture");
          if (!el) return "";
          return `<!doctype html><html><head><meta charset="utf-8"><title>Product ARR — Momos</title></head><body style="font-family:system-ui;background:#FBF7F1;padding:20px;">${el.innerHTML}</body></html>`;
        };
        const downloadHTML = () => {
          const blob = new Blob([captureHTML()], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `product-arr-${new Date().toISOString().slice(0, 10)}.html`;
          a.click();
          URL.revokeObjectURL(url);
        };
        const emailIt = () => {
          downloadHTML();
          const subject = encodeURIComponent("Product ARR snapshot");
          const body = encodeURIComponent("Product ARR snapshot attached (downloaded to your device — attach the HTML file to this email before sending).");
          window.location.href = `mailto:tai@momos.com?subject=${subject}&body=${body}`;
        };

        return (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 20, color: C.navy }}>Product ARR</div>
              <div style={{ fontSize: 12.5, color: C.t2 }}>Weekly & monthly ARR movement by product line</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={downloadHTML} style={{ background: "#fff", color: C.navy, border: `1px solid ${C.bd}`, borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⬇ Download HTML</button>
              <button onClick={emailIt} style={{ background: C.navy, color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✉ Email to tai@momos.com</button>
            </div>
          </div>

          <div id="productArrCapture">
            <div style={{ background: C.navy, borderRadius: 14, padding: "16px 22px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#9FAAC6", marginBottom: 6 }}>Product ARR · Executive Summary</div>
              <div style={{ fontSize: 15.5, lineHeight: 1.55, color: "#fff", fontWeight: 500 }}>{summ}</div>
            </div>

            {/* 1. weekly grouped columns */}
            <Card title="Weekly ARR by Product — last 6 weeks" sub="Grouped columns per product line, week over week" accent={C.coral}>
              <div style={{ padding: "16px 20px" }}>
                <GroupedBarChart
                  labels={wLabels}
                  series={PRODUCTS.map((p) => ({ label: p.name, values: weekly.map((w) => w[p.key]), color: p.color }))}
                />
              </div>
            </Card>

            {/* 2. WoW table by product */}
            <Card title="Week over week by product">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>Product</Th>
                      {wLabels.map((w) => <Th key={w}>{w}</Th>)}
                      <Th>WoW</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRODUCTS.map((p) => (
                      <tr key={p.key} style={{ borderBottom: `1px solid ${C.s1}` }}>
                        <td style={{ padding: "10px 16px", fontSize: 13 }}>
                          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: p.color, marginRight: 8 }} />
                          <span style={{ fontWeight: 600, color: C.t1 }}>{p.name}</span>
                        </td>
                        {weekly.map((w, i) => <Td key={i} mono>{fmt(w[p.key])}</Td>)}
                        <td style={{ textAlign: "right", padding: "10px 16px" }}>{wowPill(weekly.map((w) => w[p.key]))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* 3. monthly grouped columns w/ target on hover */}
            <Card title="Monthly ARR by Product — vs target" sub="Grouped columns per product; hover a bar to see that product's monthly target and attainment" accent={C.navy}>
              <div style={{ padding: "16px 20px" }}>
                <GroupedBarChart
                  labels={mLabels}
                  series={PRODUCTS.map((p) => ({ label: p.name, values: mWin.map((m) => m[p.key]), color: p.color }))}
                  targets={PRODUCTS.map((p) => (p.target ? mWin.map((m) => m[p.target]) : mWin.map(() => 0)))}
                />
              </div>
            </Card>

            {/* monthly summary table */}
            <Card title="Month over month by product">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>Product</Th>
                      {mLabels.map((m) => <Th key={m}>{m}</Th>)}
                      <Th>MoM</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRODUCTS.map((p) => (
                      <tr key={p.key} style={{ borderBottom: `1px solid ${C.s1}` }}>
                        <td style={{ padding: "10px 16px", fontSize: 13 }}>
                          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: p.color, marginRight: 8 }} />
                          <span style={{ fontWeight: 600, color: C.t1 }}>{p.name}</span>
                        </td>
                        {mWin.map((m, i) => <Td key={i} mono>{fmt(m[p.key])}</Td>)}
                        <td style={{ textAlign: "right", padding: "10px 16px" }}>{wowPill(mWin.map((m) => m[p.key]))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
        );
      })()}

      {tab === "actions" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="Who Does What" sentence={tabSummaries.actions.sentence} stats={tabSummaries.actions.stats} />
          )}
          <Card title="Who Does What — Open Pipeline by Owner" sub="Stale = no stage change in 60+ days">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>Owner</Th>
                  <Th># Open Deals</Th>
                  <Th>Open ARR</Th>
                  <Th># Stale</Th>
                  <Th>Stale ARR</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.whoDoesWhat)
                  .sort((a, b) => b[1].openArr - a[1].openArr)
                  .map(([owner, v]) => (
                    <tr key={owner} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <Td l bold>{owner}</Td>
                      <Td mono>{v.openCount}</Td>
                      <Td mono>{fmt(v.openArr)}</Td>
                      <Td mono color={v.staleCount > 0 ? C.red : C.t1}>{v.staleCount}</Td>
                      <Td mono color={v.staleArr > 0 ? C.red : C.t1}>{fmt(v.staleArr)}</Td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
