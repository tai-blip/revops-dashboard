"use client";

import { useEffect, useMemo, useState } from "react";
import { C, fmt, pct, Card, KV, Bar, Pill, HeroStat, Th, Td } from "@/lib/ui";
import { ArrChart } from "@/lib/ArrChart";
import { BarTrendChart } from "@/lib/BarTrendChart";
import { LineTrendChart } from "@/lib/LineTrendChart";
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

    return {
      latest,
      teamQuota,
      teamActual,
      teamPctOfQuota,
      totalPipelineARR,
      coverageRatio,
    };
  }, [data]);

  const pipeOwners = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.trendEvents.map((e) => e.owner))).sort();
  }, [data]);

  function getWeekStart(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day; // Monday start
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

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
            <Card title="ARR Trend" sub="Hover a point for details" accent={C.coral}>
              <div style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <ChartPeriodToggle period={period} onChange={setPeriod} />
                </div>
                <ArrChart points={chartPoints} />
              </div>
            </Card>

            <Card
              title="Team ARR Attainment — Monthly vs Q3 Quota"
              sub="Column chart of closed-won + live-paying ARR by month, against the Q3 quota target"
            >
              <div style={{ padding: "16px 20px" }}>
                <BarTrendChart
                  labels={data.aeAttainment.monthlyTeamActual.map((m) => m.label)}
                  values={data.aeAttainment.monthlyTeamActual.map((m) => m.actual)}
                  valueFormat="currency"
                  targetLine={derived.teamQuota}
                  targetLabel="Q3 Quota"
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
          </div>
        </div>
      )}

      {tab === "targets" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
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

          <Card title="AE Pipeline Breakdown — Q3 FY26" sub="Quota vs actual open pipeline per AE, from your Pipeline tab">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>AE</Th>
                  <Th>Q3 Pipe Quota</Th>
                  <Th>Actual Pipeline</Th>
                  <Th l>Progress</Th>
                </tr>
              </thead>
              <tbody>
                {data.pipeline.aeBreakdown.map((row) => (
                  <tr key={row.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                    <Td l bold>{row.name}</Td>
                    <Td mono>{row.quota != null ? fmt(row.quota) : "—"}</Td>
                    <Td mono color={C.purp}>{fmt(row.actual)}</Td>
                    <td style={{ padding: "10px 16px", width: 160 }}>
                      {row.quota != null && row.quota > 0 ? (
                        <Bar value={row.actual} target={row.quota} />
                      ) : (
                        <span style={{ fontSize: 12, color: C.t3 }}>no quota</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

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
            sub={`Filtered by: ${data.pipelineWow.filterRep}`}
          >
            {(() => {
              const weeks = data.pipelineWow.weeks;
              const labels = data.pipelineWow.weekLabels;
              const findRow = (name: string) => weeks.find((w) => w.metric === name)?.values ?? [];

              const countSeries = [
                { label: "New Opps Entered (SQL)", values: findRow("New Opps Entered (SQL)"), color: C.navy },
                { label: "Progressed to SAL", values: findRow("Progressed to SAL"), color: C.teal },
                { label: "Progressed to SQO", values: findRow("Progressed to SQO"), color: C.purp },
                { label: "Stage Movements (any)", values: findRow("Stage Movements (any)"), color: C.coralDk },
              ].filter((s) => s.values.length > 0);

              const arrSeries = [
                { label: "New ARR pipeline Created ($)", values: findRow("New ARR pipeline Created ($)"), color: C.coralDk },
              ].filter((s) => s.values.length > 0);

              const pctSeries = [
                { label: "New Opps WoW Δ%", values: findRow("New Opps WoW Δ%"), color: C.navy },
                { label: "New ARR WoW Δ%", values: findRow("New ARR WoW Δ%"), color: C.coralDk },
              ].filter((s) => s.values.length > 0);

              return (
                <div style={{ padding: "16px 20px", display: "grid", gap: 24 }}>
                  {countSeries.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.t2, marginBottom: 8 }}>
                        Opp & Stage Movement Counts
                      </div>
                      <LineTrendChart labels={labels} series={countSeries} valueFormat="number" />
                    </div>
                  )}
                  {arrSeries.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.t2, marginBottom: 8 }}>
                        New ARR Pipeline Created
                      </div>
                      <LineTrendChart labels={labels} series={arrSeries} valueFormat="currency" />
                    </div>
                  )}
                  {pctSeries.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.t2, marginBottom: 8 }}>
                        WoW % Change
                      </div>
                      <LineTrendChart labels={labels} series={pctSeries} valueFormat="percent" />
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                    <Th l>Metric</Th>
                    {data.pipelineWow.weekLabels.map((w) => (
                      <Th key={w}>{w}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.pipelineWow.weeks.map((row) => (
                    <tr key={row.metric} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <Td l>{row.metric}</Td>
                      {row.values.map((v, i) => (
                        <Td key={i} mono>{v == null ? "—" : v}</Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "attainment" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
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
