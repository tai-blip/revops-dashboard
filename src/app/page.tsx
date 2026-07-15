"use client";

import { useEffect, useMemo, useState } from "react";
import { C, fmt, pct, Card, KV, Bar, Pill, HeroStat, Th, Td } from "@/lib/ui";
import { ArrChart } from "@/lib/ArrChart";
import { BarTrendChart } from "@/lib/BarTrendChart";
import { LineTrendChart } from "@/lib/LineTrendChart";
import { GroupedBarChart } from "@/lib/GroupedBarChart";
import { Sparkline, DeltaPill, wowDeltaPct, fmtMetricValue } from "@/lib/Sparkline";
import type { ArrPoint } from "@/lib/parse";

type MetricRow = { metric: string; value: number; kind: "currency" | "count" | "percent" | "ratio" };
type BreakdownRow = { label: string; opps: number; arr: number; pctOfTotal: number };
type StageWeightRow = { stage: string; arr: number; probability: number; weighted: number };
type AeBreakdownRow = { name: string; quota: number | null; actual: number };

type DashboardData = {
  updatedAt: string;
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

function ExecBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div style={{ background: C.navy, borderRadius: 14, padding: "16px 22px", marginBottom: 18 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "#9FAAC6",
          marginBottom: 6,
        }}
      >
        Executive Summary · auto-generated from live data
      </div>
      <div style={{ fontSize: 15.5, lineHeight: 1.55, color: "#fff", fontWeight: 500 }}>{text}</div>
    </div>
  );
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

    const totalOpps =
      data.pipeline.metricSections["1. TOTAL PIPELINE"]?.find((m) => m.metric === "Total Opportunities")?.value ?? 0;
    const totalPipe =
      data.pipeline.metricSections["1. TOTAL PIPELINE"]?.find((m) => m.metric === "Total Pipeline (ARR)")?.value ?? 0;
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

    return {
      targets: `New ARR added in ${latest?.label ?? "the latest month"}: ${fmt(latest?.newARR)}. The team sits at ${teamPct.toFixed(1)}% of the ${fmt(teamQuota)} Q3 quota${top ? `, with ${top.name} leading at ${pct(top.pctOfQuota)}` : ""}.`,
      pipeline: `Q3 pipeline generation stands at ${fmt(S.gen)} — ${S.genPct.toFixed(0)}% of the ${fmt(S.quota)} quota with ${S.elapsedPct.toFixed(0)}% of the quarter gone (${S.genStatus.label.toLowerCase()}). Open pipeline totals ${fmt(totalPipe)} across ${totalOpps} opportunities at ${S.coverage.toFixed(1)}x coverage.${wowPhrase}`,
      forecast: `Raw open pipeline of ${fmt(data.forecast.rawTotal)} weights down to ${fmt(data.forecast.weightedTotal)} after applying stage win rates${data.winRates.derived ? ` derived from ${data.winRates.n} closed deals (${data.winRates.overall != null ? pct(data.winRates.overall) : "—"} overall win rate)` : ""}.`,
      health: `${fmt(staleArr)} of open pipeline (${staleCount} deals, ${stalePct.toFixed(0)}% of total) hasn't moved stages in 90+ days.${biggest ? ` Largest open deal: ${biggest.name} at ${fmt(biggest.arr)}${biggest.ageDays != null ? ` (${biggest.ageDays}d since last stage change)` : ""}.` : ""}`,
      attainment: `Team attainment is ${teamPct.toFixed(1)}% of the Q3 quota (${fmt(teamActual)} of ${fmt(teamQuota)}).${top ? ` Top: ${top.name} at ${pct(top.pctOfQuota)}.` : ""}${bottom && bottom !== top ? ` Lowest: ${bottom.name} at ${pct(bottom.pctOfQuota)}.` : ""}`,
      acv: `Average won deal is ${fmt(data.acv.avg)} (median ${fmt(data.acv.median)}) across ${data.acv.count} wins in 18 months. YTD win rate: ${data.winRateYtd.winRate != null ? pct(data.winRateYtd.winRate) : "—"} on ${data.winRateYtd.closedCount} closed New Business deals${data.winRateYtd.medianCycle != null ? `, median cycle ${data.winRateYtd.medianCycle}d SQL→close` : ""}.`,
      actions: `${topOwner ? `${topOwner[0]} holds the most open pipeline (${fmt(topOwner[1].openArr)} across ${topOwner[1].openCount} deals). ` : ""}${fmt(totalStaleArr)} across all owners has been stale for 60+ days and needs action.`,
    };
  }, [data, execSummary]);

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
              Momos Forecast — Q3 FY26
            </div>
            <div style={{ fontSize: 12, color: C.t3 }}>
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
          <div
            style={{
              background: `linear-gradient(160deg, ${C.navy} 0%, #16223D 100%)`,
              padding: "26px 30px 30px",
            }}
          >
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                  gap: 12,
                }}
              >
                <HeroStat label="Live ARR" value={fmt(derived.latest?.activeARR)} tone="good" />
                <HeroStat label="New ARR (Latest Month)" value={fmt(derived.latest?.newARR)} />
                <HeroStat
                  label="Churned ARR (Latest Month)"
                  value={fmt(derived.latest?.churnedARR)}
                  tone="bad"
                />
                <HeroStat
                  label="MoM Change"
                  value={pct(derived.latest?.changePct)}
                  tone={(derived.latest?.changePct ?? 0) >= 0 ? "good" : "bad"}
                />
                <HeroStat label="Total Pipeline" value={fmt(derived.totalPipelineARR)} />
                <HeroStat
                  label="Pipeline Coverage"
                  value={derived.coverageRatio.toFixed(2) + "x"}
                  tone={derived.coverageRatio >= 3 ? "good" : "warn"}
                />
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
            {execSummary && (() => {
              const S = execSummary;
              const toneMap = {
                good: { bg: C.grnBg, fg: C.grn },
                warn: { bg: C.ylwBg, fg: C.ylw },
                bad: { bg: C.redBg, fg: C.red },
              };
              const Pill2 = ({ s }: { s: { label: string; tone: "good" | "warn" | "bad" } }) => (
                <span style={{ background: toneMap[s.tone].bg, color: toneMap[s.tone].fg, fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>
                  {s.label}
                </span>
              );
              const wowPhrase =
                S.wowDelta == null
                  ? ""
                  : S.wowDelta >= 0
                  ? ` while weekly ARR creation rebounded +${Math.round(S.wowDelta)}% WoW`
                  : ` while weekly ARR creation declined ${Math.round(S.wowDelta)}% WoW`;
              return (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ background: C.navy, borderRadius: 14, padding: "18px 22px", marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#9FAAC6", marginBottom: 6 }}>
                      Executive Summary · auto-generated from live data
                    </div>
                    <div style={{ fontSize: 16.5, lineHeight: 1.55, color: "#fff", fontWeight: 500 }}>
                      ARR sits at <span style={{ color: "#9FD9A4", fontFamily: "var(--font-dm-mono)" }}>{fmt(S.arrNow)}</span> — {fmt(S.gap)} from the $10M milestone. Pipeline generation is{" "}
                      <span style={{ color: S.genStatus.tone === "good" ? "#9FD9A4" : "#F0A99C" }}>
                        {S.genStatus.tone === "good" ? "on pace" : "behind pace"}
                      </span>{" "}
                      at {S.genPct.toFixed(0)}% of the Q3 quota with {(100 - S.elapsedPct).toFixed(0)}% of the quarter remaining{wowPhrase}.
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                    <div style={{ background: C.card, border: `1px solid ${C.bd}`, borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.t3 }}>ARR Pace</span>
                        <Pill2 s={S.arrStatus} />
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 17, fontWeight: 600, color: C.t1 }}>{fmt(S.arrNow)}</div>
                      <div style={{ fontSize: 11.5, color: C.t2, marginTop: 2 }}>
                        {S.arrMoM != null ? pct(S.arrMoM) + " MoM" : "—"} · gap {fmt(S.gap)}
                      </div>
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.bd}`, borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.t3 }}>Pipe Gen Q3</span>
                        <Pill2 s={S.genStatus} />
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 17, fontWeight: 600, color: C.t1 }}>{fmt(S.gen)}</div>
                      <div style={{ fontSize: 11.5, color: C.t2, marginTop: 2 }}>
                        {S.genPct.toFixed(0)}% of {fmt(S.quota)} · {S.elapsedPct.toFixed(0)}% of Q gone
                      </div>
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.bd}`, borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.t3 }}>Churn</span>
                        <Pill2 s={S.churnStatus} />
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 17, fontWeight: 600, color: C.t1 }}>{fmt(S.churnLast)} / mo</div>
                      <div style={{ fontSize: 11.5, color: C.t2, marginTop: 2 }}>{fmt(S.churn12)} cum. 12mo</div>
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.bd}`, borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.t3 }}>Coverage</span>
                        <Pill2 s={S.coverageStatus} />
                      </div>
                      <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 17, fontWeight: 600, color: C.t1 }}>{S.coverage.toFixed(2)}x</div>
                      <div style={{ fontSize: 11.5, color: C.t2, marginTop: 2 }}>open pipe vs Q3 quota</div>
                    </div>
                  </div>
                </div>
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
          <ExecBanner text={tabSummaries?.targets ?? null} />
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
          <ExecBanner text={tabSummaries?.pipeline ?? null} />
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


          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, margin: "18px 0" }}>
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
          </div>

          <Card title="9. Weighted Pipeline" sub="Stage probability weights as configured in your Pipeline tab">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>Stage</Th>
                  <Th>ARR</Th>
                  <Th>Probability</Th>
                  <Th>Weighted ARR</Th>
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
        </div>
      )}

      {tab === "attainment" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          <ExecBanner text={tabSummaries?.attainment ?? null} />
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

      {tab === "forecast" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          <ExecBanner text={tabSummaries?.forecast ?? null} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
            <Card title="Raw Open Pipeline">
              <div style={{ padding: 20 }}>
                <KV label="Full value if every deal closed" v={fmt(data.forecast.rawTotal)} />
              </div>
            </Card>
            <Card title="AE-Weighted Forecast">
              <div style={{ padding: 20 }}>
                <KV label="Stage-adjusted realistic value" v={fmt(data.forecast.weightedTotal)} color={C.purp} />
              </div>
            </Card>
            <Card title="Historical Win Rate Basis">
              <div style={{ padding: 20 }}>
                <KV
                  label={data.winRates.derived ? `Derived from ${data.winRates.n} closed deals` : "Using default assumptions (no history)"}
                  v={data.winRates.overall != null ? pct(data.winRates.overall) : "—"}
                />
              </div>
            </Card>
          </div>

          <Card title="Pipeline by Stage — Raw vs Weighted" sub="Weighted value = ARR × derived win rate for that stage">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>Stage</Th>
                  <Th># Deals</Th>
                  <Th>Raw ARR</Th>
                  <Th>Win Rate</Th>
                  <Th>Weighted ARR</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.forecast.byStage)
                  .filter(([, v]) => v.count > 0)
                  .map(([stage, v]) => (
                    <tr key={stage} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <Td l bold>{stage}</Td>
                      <Td mono>{v.count}</Td>
                      <Td mono>{fmt(v.raw)}</Td>
                      <Td mono>{v.raw > 0 ? pct(v.weighted / v.raw) : "—"}</Td>
                      <Td mono color={C.purp}>{fmt(v.weighted)}</Td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "health" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          <ExecBanner text={tabSummaries?.health ?? null} />
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
          <ExecBanner text={tabSummaries?.acv ?? null} />
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

      {tab === "actions" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          <ExecBanner text={tabSummaries?.actions ?? null} />
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
