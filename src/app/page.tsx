"use client";

import { useEffect, useMemo, useState } from "react";
import { C, fmt, pct, Card, KV, Bar, Pill, Th, Td } from "@/lib/ui";
import { ArrChart } from "@/lib/ArrChart";
import { BarTrendChart } from "@/lib/BarTrendChart";
import { LineTrendChart } from "@/lib/LineTrendChart";
import { GroupedBarChart } from "@/lib/GroupedBarChart";
import { Sparkline, DeltaPill, wowDeltaPct, fmtMetricValue } from "@/lib/Sparkline";
import { PlanChart } from "@/lib/PlanChart";
import { ProductLineSection } from "@/lib/ProductLineChart";
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
    rawAnnual: number;
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

function formatMetric(row: MetricRow): string {
  switch (row.kind) {
    case "ratio":
      return row.value.toFixed(2) + "x";
    case "percent":
      return pct(row.value);
    case "count":
      return String(row.value);
    default:
      return fmt(row.value);
  }
}

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

  function getWeekStart(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day; // Monday start
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  const wowMetrics = useMemo(() => {
    if (!data) return [];
    return data.pipelineWow.weeks
      .filter((w) => !w.metric.includes("Δ%"))
      .map((w) => ({
        metric: w.metric,
        values: w.values,
        money: w.metric.includes("($)"),
      }));
  }, [data]);

  const activeWowMetric = wowMetric ?? wowMetrics[0]?.metric ?? null;

  const execSummary = useMemo(() => {
    if (!data) return null;
    const months = data.arr.monthly;
    const latest = months[months.length - 1];
    const arrNow = latest?.activeARR ?? 0;
    const gap = 10000000 - arrNow;

    // Q3 pipe generation vs quota vs time elapsed
    const aeRows = data.pipeline.aeBreakdown.filter((r) => r.name !== "TOTAL");
    const quota = aeRows.reduce((s, r) => s + (r.quota ?? 0), 0);
    const gen = Object.values(q3CreatedByOwner).reduce((s, n) => s + n, 0);
    const genPct = quota > 0 ? (gen / quota) * 100 : 0;
    const qStart = new Date("2026-07-01").getTime();
    const qEnd = new Date("2026-09-30").getTime();
    const elapsedPct = Math.min(100, Math.max(0, ((Date.now() - qStart) / (qEnd - qStart)) * 100));
    const paceRatio = elapsedPct > 0 ? genPct / elapsedPct : 0;
    const genStatus =
      paceRatio >= 0.9
        ? { label: "On pace", tone: "good" as const }
        : paceRatio >= 0.5
        ? { label: "Watch", tone: "warn" as const }
        : { label: "Behind", tone: "bad" as const };

    // Weekly ARR creation WoW
    const arrRow = wowMetrics.find((m) => m.metric.includes("New ARR"));
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
      (latest?.changePct ?? 0) >= 0
        ? { label: "On track", tone: "good" as const }
        : { label: "Declining", tone: "bad" as const };

    return {
      arrNow,
      gap,
      arrMoM: latest?.changePct ?? null,
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

    const arrRow = wowMetrics.find((m) => m.metric.includes("New ARR"));
    const arrClean = arrRow?.values.filter((v): v is number => v != null) ?? [];
    const arrThisWeek = arrClean[arrClean.length - 1] ?? 0;
    const wowPhrase =
      S.wowDelta == null
        ? ""
        : S.wowDelta >= 0
        ? ` New ARR creation is up ${Math.round(S.wowDelta)}% WoW.`
        : ` New ARR creation is down ${Math.abs(Math.round(S.wowDelta))}% WoW.`;

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
    const mixTotal = q3Win.reduce((s, m) => s + m.newBusiness + m.expansion + m.renewals, 0);
    const nbPct = mixTotal > 0 ? (nb / mixTotal) * 100 : 0;

    const gp = (n: number | null | undefined) => (n != null ? pct(n) : "—");

    return {
      command: {
        sentence: `ARR sits at ${fmt(S.arrNow)} — ${fmt(S.gap)} from the $10M milestone. Pipeline generation is ${S.genStatus.tone === "good" ? "on pace" : "behind pace"} at ${S.genPct.toFixed(0)}% of the Q3 quota with ${(100 - S.elapsedPct).toFixed(0)}% of the quarter remaining${S.wowDelta != null ? (S.wowDelta >= 0 ? ` while weekly ARR creation rebounded +${Math.round(S.wowDelta)}% WoW` : ` while weekly ARR creation declined ${Math.round(S.wowDelta)}% WoW`) : ""}.`,
        stats: [
          { label: "Live ARR", value: fmt(S.arrNow), tone: "good" as const },
          { label: "New ARR (mo)", value: fmt(latest?.newARR) },
          { label: "Churned (mo)", value: fmt(latest?.churnedARR), tone: "bad" as const },
          { label: "MoM change", value: gp(S.arrMoM), tone: (S.arrMoM ?? 0) >= 0 ? ("good" as const) : ("bad" as const) },
          { label: "Total pipeline", value: fmt(totalPipe) },
          { label: "Coverage", value: S.coverage.toFixed(2) + "x", tone: S.coverage >= 3 ? ("good" as const) : ("warn" as const) },
        ],
      },
      targets: {
        sentence: `New ARR added in ${latest?.label ?? "the latest month"}: ${fmt(latest?.newARR)}. The team sits at ${teamPct.toFixed(1)}% of the ${fmt(teamQuota)} Q3 quota${top ? `, with ${top.name} leading at ${gp(top.pctOfQuota)}` : ""}.${mixTotal > 0 ? ` ARR mix this quarter skews ${nbPct.toFixed(0)}% Net New.` : ""}`,
        stats: [
          { label: "New ARR (latest mo)", value: fmt(latest?.newARR), sub: latest?.label },
          { label: "Team actual Q3", value: fmt(teamActual), sub: "closed-won + live paying" },
          { label: "Team quota Q3", value: fmt(teamQuota), sub: `across ${data.aeAttainment.reps.length} AEs` },
          { label: "% of quota", value: teamPct.toFixed(1) + "%", sub: `${S.elapsedPct.toFixed(0)}% of quarter gone`, tone: teamPct >= S.elapsedPct ? ("good" as const) : ("bad" as const) },
        ],
      },
      pipeline: {
        sentence: `Q3 pipeline generation stands at ${fmt(S.gen)} — ${S.genPct.toFixed(0)}% of the ${fmt(S.quota)} quota with ${S.elapsedPct.toFixed(0)}% of the quarter gone (${S.genStatus.label.toLowerCase()}). Open pipeline totals ${fmt(totalPipe)} across ${totalOpps} opportunities at ${S.coverage.toFixed(1)}x coverage.${wowPhrase}`,
        stats: [
          { label: "Created in Q3", value: fmt(S.gen), sub: `${S.genPct.toFixed(0)}% of ${fmt(S.quota)} quota`, tone: S.genStatus.tone },
          { label: "Open pipeline", value: fmt(totalPipe), sub: `${totalOpps} opportunities` },
          { label: "New ARR this week", value: fmt(arrThisWeek), sub: S.wowDelta != null ? `${S.wowDelta >= 0 ? "+" : "−"}${Math.abs(Math.round(S.wowDelta))}% WoW` : undefined, tone: (S.wowDelta ?? 0) >= 0 ? ("good" as const) : ("bad" as const) },
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
                    sub={`${P.weeksLeft} weeks remaining (quarter ends ${P.qEnd}). What's still needed — or banked — on ARR and pipeline.`}
                    accent={C.coral}
                  >
                    <div style={gridWrap}>
                      <div>
                        <div style={lbl}>New ARR — Gap to Target</div>
                        <div style={bigN(C.coralDk)}>{fk(P.arrGap)}</div>
                        <div style={subN}>{fk(P.q3Booked)} booked of {fk(P.q3Target)} {P.q} target</div>
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
                    sub="Weekly run-rate against pace, and quarter-to-date booking against the elapsed-months target. Pipeline pace is the catch-up run-rate."
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
                  title="New ARR Mix — Net New vs Expansion vs Renewal"
                  sub={period === "monthly" ? "Last 3 months, grouped per month" : "Last 13 weeks, grouped per week"}
                >
                  <div style={{ padding: "16px 20px" }}>
                    <GroupedBarChart
                      labels={mixWindow.map((m) => m.label)}
                      series={[
                        { label: "Net New", values: mixWindow.map((m) => m.newBusiness), color: C.navy },
                        { label: "Expansion", values: mixWindow.map((m) => m.expansion), color: C.teal },
                        { label: "Renewal", values: mixWindow.map((m) => m.renewals), color: C.coralDk },
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

          {(() => {
            const win = data.arr.monthly.filter((p) => p.label.startsWith("2026-")).slice(-12);
            const labels = win.map((p) => p.label.slice(5));
            const linesCfg = [
              { name: "Chat Agent Alfie", color: C.purp, data: win.map((p) => p.alfie), target: 150000 },
              { name: "Managed Services", color: C.teal, data: win.map((p) => p.managedServices), target: 400000 },
              { name: "Core Existing Features", color: C.navy, data: win.map((p) => p.coreExisting), target: 5500000 },
            ];
            const latest = win[win.length - 1];
            const alf = latest?.alfie ?? 0;
            const ms = latest?.managedServices ?? 0;
            const core = latest?.coreExisting ?? 0;
            const summary = `Product-line ARR: Core Existing Features leads at ${fmt(core)}, Managed Services ${fmt(ms)}, and Chat Agent Alfie ${fmt(alf)}. Set a target on any line below to track live gap and attainment.`;
            return (
              <>
                <div style={{ background: C.navy, borderRadius: 14, padding: "16px 22px", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#9FAAC6", marginBottom: 6 }}>
                    ARR by Product Line · Executive Summary
                  </div>
                  <div style={{ fontSize: 15.5, lineHeight: 1.55, color: "#fff", fontWeight: 500 }}>{summary}</div>
                </div>
                {linesCfg.map((l) => (
                  <ProductLineSection
                    key={l.name}
                    name={l.name}
                    color={l.color}
                    labels={labels}
                    data={l.data}
                    defaultTarget={l.target}
                  />
                ))}
              </>
            );
          })()}

          <Card title="ARR Trend" sub="Hover a point for details" accent={C.coral}>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                <ChartPeriodToggle period={period} onChange={setPeriod} />
              </div>
              <ArrChart points={chartPoints} />
            </div>
          </Card>

          <Card title={period === "monthly" ? "ARR Trend Table (Monthly)" : "ARR Trend Table (Weekly)"}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>{period === "monthly" ? "Month" : "Week Starting"}</Th>
                  <Th>New ARR</Th>
                  <Th>Active ARR</Th>
                  <Th>Churned ARR</Th>
                  <Th>{period === "monthly" ? "MoM %" : "WoW %"}</Th>
                </tr>
              </thead>
              <tbody>
                {chartPoints.slice(-16).map((p) => (
                  <tr key={p.label} style={{ borderBottom: `1px solid ${C.s1}` }}>
                    <Td l mono>{p.label}</Td>
                    <Td mono>{fmt(p.newARR)}</Td>
                    <Td mono>{fmt(p.activeARR)}</Td>
                    <Td mono color={C.red}>{fmt(p.churnedARR)}</Td>
                    <Td mono color={(p.changePct ?? 0) >= 0 ? C.grn : C.red}>{pct(p.changePct)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card
            title={`New ARR Mix — ${period === "monthly" ? "Last 3 Months" : "Last 3 Weeks"}`}
            sub="Net New vs Expansion vs Renewal breakdown with period-over-period direction"
          >
            {(() => {
              const win = chartPoints.slice(-3);
              const types = [
                { label: "Net New", key: "newBusiness" as const, color: C.navy },
                { label: "Expansion", key: "expansion" as const, color: C.teal },
                { label: "Renewal", key: "renewals" as const, color: C.coralDk },
              ];
              const totals = types.map((t) => win.reduce((s, p) => s + p[t.key], 0));
              const grandTotal = totals.reduce((s, n) => s + n, 0);
              return (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>Type</Th>
                      {win.map((p) => (
                        <Th key={p.label}>{p.label}</Th>
                      ))}
                      <Th>Total</Th>
                      <Th>Mix %</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((t, ti) => (
                      <tr key={t.label} style={{ borderBottom: `1px solid ${C.s1}` }}>
                        <td style={{ padding: "10px 16px", fontSize: 13 }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 9,
                              height: 9,
                              borderRadius: 2,
                              background: t.color,
                              marginRight: 8,
                            }}
                          />
                          <span style={{ fontWeight: 600, color: C.t1 }}>{t.label}</span>
                        </td>
                        {win.map((p, i) => {
                          const v = p[t.key];
                          const prev = i > 0 ? win[i - 1][t.key] : null;
                          const dir = prev == null ? null : v > prev ? "up" : v < prev ? "down" : "flat";
                          return (
                            <Td key={p.label} mono>
                              {fmt(v)}{" "}
                              {dir === "up" && <span style={{ color: C.grn }}>▲</span>}
                              {dir === "down" && <span style={{ color: C.red }}>▼</span>}
                            </Td>
                          );
                        })}
                        <Td mono bold>{fmt(totals[ti])}</Td>
                        <Td mono color={C.t2}>
                          {grandTotal > 0 ? ((totals[ti] / grandTotal) * 100).toFixed(0) + "%" : "—"}
                        </Td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `2px solid ${C.navy}` }}>
                      <Td l bold>Total</Td>
                      {win.map((p) => (
                        <Td key={p.label} mono bold>
                          {fmt(p.newBusiness + p.expansion + p.renewals)}
                        </Td>
                      ))}
                      <Td mono bold>{fmt(grandTotal)}</Td>
                      <Td mono color={C.t2}>100%</Td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </Card>

          <Card title="Rep Quota Progress — Q3 FY26">
            <div style={{ padding: 20, display: "grid", gap: 16 }}>
              {data.aeAttainment.reps.map((rep) => (
                <div key={rep.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: C.t1 }}>{rep.name}</span>
                    <span style={{ color: C.t2 }}>
                      {fmt(rep.actual)} / {fmt(rep.quota)} ({pct(rep.pctOfQuota)})
                    </span>
                  </div>
                  <Bar value={rep.actual} target={rep.quota} />
                </div>
              ))}
            </div>
          </Card>
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
            title="AE Pipeline Generation — Q3 FY26"
            sub="Pipeline created within Q3 (Jul–Sep 2026) vs each AE's quarterly pipe-generation quota"
          >
            {(() => {
              const rows = data.pipeline.aeBreakdown.filter((r) => r.name !== "TOTAL");
              const totalQuota = rows.reduce((s, r) => s + (r.quota ?? 0), 0);
              const totalCreated = rows.reduce(
                (s, r) => s + (q3CreatedByOwner[r.name] ?? 0),
                0
              );
              return (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>AE</Th>
                      <Th>Q3 Pipe Quota</Th>
                      <Th>Created in Q3</Th>
                      <Th l>Progress</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const created = q3CreatedByOwner[row.name] ?? 0;
                      return (
                        <tr key={row.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                          <Td l bold>{row.name}</Td>
                          <Td mono>{row.quota != null && row.quota > 0 ? fmt(row.quota) : "—"}</Td>
                          <Td mono color={C.purp}>{fmt(created)}</Td>
                          <td style={{ padding: "10px 16px", width: 160 }}>
                            {row.quota != null && row.quota > 0 ? (
                              <Bar value={created} target={row.quota} />
                            ) : (
                              <span style={{ fontSize: 12, color: C.t3 }}>no quota</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: `2px solid ${C.navy}` }}>
                      <Td l bold>TOTAL</Td>
                      <Td mono bold>{fmt(totalQuota)}</Td>
                      <Td mono bold color={C.purp}>{fmt(totalCreated)}</Td>
                      <td style={{ padding: "10px 16px", width: 160 }}>
                        <Bar value={totalCreated} target={totalQuota} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </Card>

          <div style={{ marginBottom: 12 }}>
            <Pill tone="blue">Stage/coverage snapshot filtered by: {data.pipeline.filterRep}</Pill>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
            {Object.entries(data.pipeline.metricSections).map(([section, rows]) => (
              <Card key={section} title={section}>
                <div style={{ padding: 16 }}>
                  {rows.map((row) => (
                    <div
                      key={row.metric}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "6px 0",
                        borderBottom: `1px solid ${C.s1}`,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ color: C.t2 }}>{row.metric}</span>
                      <span style={{ fontFamily: "var(--font-dm-mono)", color: C.t1 }}>
                        {formatMetric(row)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>


          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, margin: "18px 0", alignItems: "start" }}>
            {Object.entries(data.pipeline.breakdownSections).map(([section, rows]) => (
              <Card key={section} title={section}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>{section.includes("STAGE") ? "Stage" : section.includes("SOURCE") ? "Source" : "Age"}</Th>
                      <Th># Opps</Th>
                      <Th>ARR</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label} style={{ borderBottom: `1px solid ${C.s1}` }}>
                        <Td l bold={row.label === "TOTAL"}>{row.label}</Td>
                        <Td mono>{row.opps}</Td>
                        <Td mono>{fmt(row.arr)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}

            <Card title="9. WEIGHTED PIPELINE" sub="Stage probability weights from your Pipeline tab">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                    <Th l>Stage</Th>
                    <Th>ARR</Th>
                    <Th>Prob.</Th>
                    <Th>Weighted</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.pipeline.stageWeights.map((row) => (
                    <tr key={row.stage} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <Td l bold>{row.stage}</Td>
                      <Td mono>{fmt(row.arr)}</Td>
                      <Td mono>{pct(row.probability)}</Td>
                      <Td mono color={C.purp}>{fmt(row.weighted)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
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
            sub="New ARR created and new opps entered SQL, by rep, since Jan-25"
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
                New ARR Created ($)
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
