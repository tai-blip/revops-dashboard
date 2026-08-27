"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { C, fmt, pct, Card, KV, Bar, Pill, Th, Td } from "@/lib/ui";
import { DrillPanel, drillable, type DrillSpec } from "@/lib/DrillPanel";
import { ArrChart } from "@/lib/ArrChart";
import { BarTrendChart } from "@/lib/BarTrendChart";
import { LineTrendChart } from "@/lib/LineTrendChart";
import { ArrMovementChart } from "@/lib/ArrMovementChart";
import { GroupedBarChart } from "@/lib/GroupedBarChart";
import { StackedBarChart } from "@/lib/StackedBarChart";
import { Sparkline, DeltaPill, wowDeltaPct, fmtMetricValue } from "@/lib/Sparkline";
import { PlanChart } from "@/lib/PlanChart";
import { TabHeader } from "@/lib/TabHeader";
import type { MomentumTerm } from "@/lib/paymentMix";
import {
  TARGETS,
  PLAN_MONTHS,
  ANNUAL_END_TARGET,
  SALES_Q,
  currentSalesQ,
  monthsInQuarter,
  FORECAST_EXCLUDE,
} from "@/lib/planConfig";
import type { ArrPoint } from "@/lib/parse";
import { AE_PLAN } from "@/lib/aePlan";

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
  arrMom?: { label: string; totalARR: number; momChange: number; momGrowth: number }[];
  liveArrToday?: number | null;
  headlineSource?: Record<string, number>; // key→value block from the Headline tab (single source)
  headlineTrend?: { ym: string; active: number; newARR: number; churn: number; mom: number }[]; // ARR-trend table (drives the Command chart)
  targetsSource?: Record<string, number>; // key→value block from the Targets tab (plan + rollups)
  bookingReport?: { total: number; nb: number; exp: number; count: number; deals: { name: string; owner: string; stage: string; arr: number; signedDate: string; liveDate: string; type: "NB" | "Exp" }[] };
  topBooked?: { opp: string; account: string; owner: string; arr: number; status: string; liveDate: string }[];
  signedLive?: { byOwner: Record<string, { owner: string; signed: number; live: number; signedNotLive: number }>; total: { owner: string; signed: number; live: number; signedNotLive: number } };
  cashForecast?: { events: { owner: string; name: string; ym: string; arr: number; kind: "rr" | "std" }[]; owners: string[]; total: number; rrTotal: number; stdTotal: number };
  arrFunnel?: { stock: { ym: string; label: string; booked: number; contracted: number; contractedRenewal: number; contractedNewExp: number; contractedRR: number; live: number; churn: number; bToC: number; cToL: number; bToLost: number; bNew: number; bToLive: number; bDrop: number; cNewSigned: number; cLeak: number; lNewDirect: number; lChurn: number; liveArr: number; bookedPilot: number; ids?: Record<string, number[] | undefined> }[]; dealIndex: { account: string; opp: string; owner: string; am: string; type: string; rr: boolean; arr: number; stage: string; trial: string; liveDate: string; livePay: string; end: string; lost: string }[] };
  predictedCashflow?: { months: { ym: string; label: string; contracted: number; live: number }[]; baseline: { contracted: number; live: number }; booked: number; deals: { tier: "contracted" | "live"; opp: string; account: string; owner: string; arr: number; arriveYm: string; arriveDate: string; basis: string }[] };
  bookedTotal?: number; // full standing Booked pilot book total (from Booked ARR Snapshot v2 tab)
  pipelineGen?: { byOwner: Record<string, { arr: number; count: number }>; total: number; totalCount: number };
  dealTracker?: { name: string; ae: string; stage: string; pot: number; conf: string; live: string; source: string; call: string; nextStep: string; updated: string }[];
  arrForward?: { renewalDue: number; renewalMonth: string; months: { label: string; ym: string; goLiveNB: number; goLiveExp: number; goLiveTotal: number }[] };
  aeAttainment: {
    reps: { name: string; quota: number; pctOfQuota: number; actual: number; nb?: number; exp?: number }[];
    monthlyTeamActual: { label: string; actual: number }[];
  };
  aeAnnual?: {
    reps: { name: string; goal: number; ytdNB: number; ytdExp: number; ytdTotal: number; pctOfGoal: number; potNB: number; potExp: number; potTotal: number; projection: number; pctProj: number; yrMissing: number }[];
    missingYearlyOpps: number;
    missingYearlyArr: number;
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
    netNewArrMom: { months: string[]; reps: Record<string, number[]> };
    expansionArrMom: { months: string[]; reps: Record<string, number[]> };
  };
  dealHealth: { label: string; min: number; max: number; arr: number; count: number }[];
  agingByStage?: { ae: string; stage: string; deals: number; avgAge: number | null; stale: number | null; staleDollar: number | null; avgAcv: number | null; total: boolean }[];
  dealBreakdown?: { id: string; url: string; name: string; owner: string; stage: string; arr: number; age: number | null; stale: boolean }[];
  // Signed deals (Billing / Closed Won) whose effective live date falls in the current year —
  // the same rows the "AE Attainment (Official)" formulas sum, so the Closed Won drill-down can
  // tie to the cell. `eld` is Effective_Live_Date (what attainment counts on); `cld` is the raw
  // Contract Live Date, which is NOT always the same day.
  closedWonFeed?: { name: string; owner: string; stage: string; status: string; arr: number; rt: string; rtRaw: string; eld: string; cld: string }[];
  rankedDeals: { name: string; owner: string; stage: string; arr: number; ageDays: number | null }[];
  trendEvents: { date: string; owner: string; arr: number; type: "created" | "closedWon" | "closedLost" }[];
  forecast: {
    rawTotal: number;
    weightedTotal: number;
    byStage: Record<string, { raw: number; weighted: number; count: number }>;
  };
  forecastTab: {
    rows: { name: string; short?: string; am: boolean; lead?: boolean; openPipe: number; quota: number | null; closedWon: number; potEarlyQ: number; potLateQ: number; potSqlQ: number; potEarlyY: number; potLateY: number; potSqlY: number; potential: number; variance: number | null; attainP: number | null }[];
    aeTeam: { openPipe: number; quota: number; closedWon: number; potEarlyQ: number; potLateQ: number; potSqlQ: number; potEarlyY: number; potLateY: number; potSqlY: number; potential: number; variance: number; attainP: number | null };
    totalInclAM: { openPipe: number; quota: number; closedWon: number; potEarlyQ: number; potLateQ: number; potSqlQ: number; potEarlyY: number; potLateY: number; potSqlY: number; potential: number; variance: number; attainP: number | null };
    totalInclLead?: { openPipe: number; quota: number; closedWon: number; potEarlyQ: number; potLateQ: number; potSqlQ: number; potEarlyY: number; potLateY: number; potSqlY: number; potential: number; variance: number; attainP: number | null };
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
    decideDeals: { name: string; owner: string; stage: string; arr: number; potARR: number; ageDays: number | null }[];
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
  acvInsights?: {
    windowLabel: string;
    totals: { count: number; avg: number; median: number; totalARR: number };
    segments: { seg: string; count: number; avg: number; median: number; totalARR: number; medianCycle: number | null; cycleN: number }[];
    geo: { label: string; wonCount: number; lostCount: number; winRate: number | null; avg: number; median: number; totalARR: number }[];
    regions: { region: string; count: number; avg: number; median: number; totalARR: number }[];
    byAE: { owner: string; count: number; avg: number; median: number; totalARR: number }[];
    arrByTier: { months: string[]; tiers: { tier: string; values: number[] }[] };
    reconcile: { liveARR: number; recentActive: number; olderActive: number; renewalsActive: number };
  } | null;
  acvMoM?: {
    months: string[];
    all: (number | null)[];
    allSums: (number | null)[];
    groups: { key: "segment" | "region" | "ae"; series: { name: string; values: (number | null)[]; sums: (number | null)[] }[] }[];
  } | null;
  perLocation?: {
    months: string[];
    total: (number | null)[];
    newBiz: (number | null)[];
    expansion: (number | null)[];
    locations: (number | null)[];
  } | null;
  paymentMix?: {
    monthLabel: string;
    headline: {
      nbAnnualDeals: number; nbTotalDeals: number; nbAnnualCash: number;
      renAnnualDeals: number; renTotalDeals: number; renAnnualCash: number;
      newArr: number; newAnnualPct: number; renArr: number; renAnnualPct: number; annualCashTotal: number;
    };
    byTerm: { nb: { term: string; deals: number; arr: number }[]; ren: { term: string; deals: number; arr: number }[] };
    momentum: { months: string[]; nb: MomentumTerm[]; ren: MomentumTerm[] };
    flags: { type: "NB" | "Renewal"; rep: string; opp: string; term: string; arr: number }[];
    aeBreakdown: { name: string; deals: number; newArr: number; annualPctArr: number; annualCash: number; avgAcv: number }[];
    csmBreakdown: { name: string; deals: number; renArr: number; annualPctArr: number; annualCash: number }[];
    upcoming: { account: string; csm: string; arr: number; prevTerm: string; convert: boolean; endDate: string }[];
  } | null;
  whoDoesWhat: Record<
    string,
    { openCount: number; openArr: number; staleCount: number; staleArr: number }
  >;
  cwSplitByOwner?: Record<string, { nb: number; exp: number }>;
  coverageByOwner?: Record<string, number>;
};

const TABS = [
  ["command", "Command"],
  ["targets", "Targets & Progress"],
  ["pipeline", "Pipeline"],
  ["forecast", "Forecast"],
  ["cashflow", "Booked ARR & Cashflow"],
  ["deals", "Deal Tracker"],
  ["health", "Deal Health"],
  ["attainment", "AE Attainment"],
  ["acv", "ACV & Deal Size"],
  ["paymentmix", "Payment Mix"],
  ["productarr", "Product ARR"],
] as const;

// Is a Pipeline-WoW MoM month label (e.g. "Jul-26") inside Q3 FY26 (Jul–Sep 2026)?
const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function isQ3Fy26(label: string): boolean {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(label.trim());
  if (!m) return false;
  const mi = MONTH_ABBR.indexOf(m[1].toLowerCase());
  const yr = 2000 + parseInt(m[2], 10);
  return yr === 2026 && (mi === 6 || mi === 7 || mi === 8);
}

// MoM progression card (styled after the Pipeline WoW card): pill per series,
// line chart of the selected series with on-point value labels, and the full
// numbers table underneath so every point is checkable against the ACV_MoM tab.
function MomProgressCard({
  title,
  sub,
  months,
  series,
  accent,
}: {
  title: string;
  sub: string;
  months: string[];
  series: { name: string; values: (number | null)[]; sums?: (number | null)[] }[];
  accent: string;
}) {
  const [sel, setSel] = useState(0);
  const shortMonths = months.map((m) => m.split(" ")[0]);
  const kFmt = (v: number | null) =>
    v == null ? "—" : Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "k" : "$" + Math.round(v);
  const active = series[Math.min(sel, series.length - 1)];
  if (!series.length) return null;
  // cumulative won ARR of the selected series (bars behind the avg-ACV line)
  let running = 0;
  const cumulative = shortMonths.map((_, i) => (running += active.sums?.[i] ?? 0));
  return (
    <Card title={title} sub={sub}>
      <div style={{ padding: "12px 20px 16px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {series.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setSel(i)}
              style={{
                padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: `1px solid ${C.bd}`, cursor: "pointer",
                background: i === sel ? C.navy : "#fff", color: i === sel ? "#fff" : C.t2,
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <BarTrendChart
          labels={shortMonths}
          values={cumulative}
          valueFormat="currency"
          barColor={C.s2}
          showValues
          lineOverlay={{ label: "Avg ACV", values: active.values.map((v) => v ?? 0), color: accent }}
          lineOverlayOwnScale
          axisLeftLabel="Cumulative won ARR ($) — bars"
          axisRightLabel="Avg ACV per deal ($) — line"
        />
        <div style={{ display: "flex", gap: 18, marginTop: 8, fontSize: 11.5, color: C.t2, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: 2, background: C.s2, border: `1px solid ${C.bd}`, display: "inline-block" }} />
            Bars: running total of won ARR for {active.name} across the 12 months
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 11, height: 3, background: accent, display: "inline-block" }} />
            Line: average ACV per deal won that month (own scale — size of a typical deal, not volume)
          </span>
        </div>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                <th style={{ textAlign: "left", padding: "6px 8px", color: C.t3, fontWeight: 700 }}> </th>
                {shortMonths.map((m, i) => (
                  <th key={i} style={{ textAlign: "right", padding: "6px 8px", color: C.t3, fontWeight: 700 }}>{m}</th>
                ))}
                <th style={{ textAlign: "right", padding: "6px 8px", color: C.t3, fontWeight: 700 }}>MoM</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s, i) => (
                <tr
                  key={s.name}
                  onClick={() => setSel(i)}
                  style={{ borderBottom: `1px solid ${C.s1}`, cursor: "pointer", background: i === sel ? C.s1 : "transparent" }}
                >
                  <td style={{ padding: "6px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{s.name}</td>
                  {s.values.map((v, j) => (
                    <td key={j} style={{ padding: "6px 8px", textAlign: "right", fontFamily: "var(--font-dm-mono)" }}>{kFmt(v)}</td>
                  ))}
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    <DeltaPill delta={wowDeltaPct(s.values)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

// Payment-mix momentum for one deal type (New Business OR Renewals): toggle
// Annual/Quarterly/Monthly; $ ARR bars with values on top + % share trend line
// (own scale); Jan→now table with MoM/QoQ/YoY deltas, headlining MoM%.
function PaymentMixMomentumCard({
  title,
  months,
  series,
  accent,
}: {
  title: string;
  months: string[];
  series: MomentumTerm[];
  accent: string;
}) {
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<"value" | "count">("value"); // $ vs # of deals
  const short = months.map((m) => m.split(" ")[0]);
  const s = series[Math.min(sel, series.length - 1)];
  const isVal = mode === "value";
  // Metric-dependent accessors: $ ARR view vs deal-count view.
  const valsOf = (row: MomentumTerm) => (isVal ? row.arr : row.deals);
  const pctsOf = (row: MomentumTerm) => (isVal ? row.pct : row.dealPct);
  const yoyOf = (row: MomentumTerm) => (isVal ? row.yoyArr : row.yoyDeals);
  const kFmt = (v: number) => (Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? "$" + Math.round(v / 1e3) + "k" : "$" + Math.round(v));
  const nFmt = (v: number) => String(Math.round(v));
  const fmtV = isVal ? kFmt : nFmt;
  const pctD = (a: number, b: number | null) => (b == null || b === 0 ? null : ((a - b) / b) * 100);
  const vals = valsOf(s), pcts = pctsOf(s), yoyArr = yoyOf(s);
  const n = vals.length;
  const cur = vals[n - 1] ?? 0, prev = vals[n - 2] ?? null;
  const mom = pctD(cur, prev);
  const q1 = vals.slice(-3).reduce((x, y) => x + y, 0), q0 = vals.slice(-6, -3).reduce((x, y) => x + y, 0);
  const qoq = q0 ? ((q1 - q0) / q0) * 100 : null;
  const yoy = pctD(cur, yoyArr[n - 1] ?? null);
  const pill = (v: number | null) =>
    v == null ? <span style={{ color: C.t3 }}>—</span> : <span style={{ color: v >= 0 ? C.grn : C.red, fontWeight: 700 }}>{v >= 0 ? "+" : ""}{v.toFixed(0)}%</span>;
  const btn = (activeCond: boolean) => ({ padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${C.bd}`, cursor: "pointer", background: activeCond ? C.navy : "#fff", color: activeCond ? "#fff" : C.t2 } as const);
  return (
    <Card title={title} sub={`Toggle a term · bars = ${isVal ? "$ ARR" : "# of deals"} that month, line = % share of the type · Jan→now`}>
      <div style={{ padding: "12px 20px 16px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          {series.map((x, i) => (
            <button key={x.term} onClick={() => setSel(i)} style={btn(i === sel)}>{x.term}</button>
          ))}
          {/* $ vs # of deals metric toggle */}
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button onClick={() => setMode("value")} style={btn(isVal)}>$</button>
            <button onClick={() => setMode("count")} style={btn(!isVal)}># of deals</button>
          </div>
        </div>
        <BarTrendChart
          labels={short}
          values={vals}
          valueFormat={isVal ? "currency" : "number"}
          barColor={C.s2}
          showValues
          lineOverlay={{ label: `${s.term} % share`, values: pcts, color: accent, format: "percent" }}
          lineOverlayOwnScale
          axisLeftLabel={isVal ? "ARR ($) — bars" : "# deals — bars"}
          axisRightLabel="% share — line"
        />
        {/* Jan→now delta summary, headlining MoM% */}
        <div style={{ display: "flex", gap: 20, marginTop: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: C.t3 }}>MoM </span><span style={{ fontSize: 18 }}>{pill(mom)}</span></div>
          <div style={{ fontSize: 12.5, color: C.t2 }}>QoQ {pill(qoq)}</div>
          <div style={{ fontSize: 12.5, color: C.t2 }}>YoY {pill(yoy)}</div>
          <div style={{ fontSize: 12, color: C.t3 }}>{s.term}: {short[n - 1]} {fmtV(cur)}{isVal ? "" : " deals"}</div>
        </div>
        {/* Per month for ALL three terms (selected highlighted), then a MoM% row
            for the selected term. Values follow the $/# toggle. Click a row to chart it. */}
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                <th style={{ textAlign: "left", padding: "5px 8px", color: C.t3, fontWeight: 700 }}>{isVal ? "ARR by term ($)" : "Deals by term (#)"}</th>
                {short.map((m, i) => <th key={i} style={{ textAlign: "right", padding: "5px 8px", color: C.t3, fontWeight: 700 }}>{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {series.map((row, ri) => (
                <tr key={row.term} onClick={() => setSel(ri)} style={{ cursor: "pointer", background: ri === sel ? C.s1 : "transparent", borderBottom: `1px solid ${C.s1}` }}>
                  <td style={{ padding: "5px 8px", fontWeight: ri === sel ? 800 : 600, color: ri === sel ? accent : C.t2 }}>{row.term}</td>
                  {valsOf(row).map((v, i) => <td key={i} style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-dm-mono)", fontWeight: ri === sel ? 700 : 400 }}>{v ? fmtV(v) : "—"}</td>)}
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${C.bd}` }}>
                <td style={{ padding: "5px 8px", color: C.t3 }}>{s.term} MoM%</td>
                {vals.map((v, i) => { const d = i === 0 ? null : pctD(v, vals[i - 1]); return <td key={i} style={{ padding: "5px 8px", textAlign: "right" }}>{d == null ? "—" : <span style={{ color: d >= 0 ? C.grn : C.red }}>{d >= 0 ? "+" : ""}{d.toFixed(0)}%</span>}</td>; })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

// $/Location per month — one line at a time (toggle), with a table of all three
// series below. Modeled on the Pipeline Progression chart so the three lines
// don't overlap into an unreadable tangle of value labels.
function PerLocationCard({
  months,
  total,
  newBiz,
  expansion,
}: {
  months: string[];
  total: (number | null)[];
  newBiz: (number | null)[];
  expansion: (number | null)[];
}) {
  const rows = [
    { label: "Total (book)", values: total, color: C.navy },
    { label: "New Business", values: newBiz, color: C.coral },
    { label: "Expansion", values: expansion, color: C.teal },
  ];
  const [sel, setSel] = useState(0);
  const active = rows[Math.min(sel, rows.length - 1)];
  const short = months.map((m) => m.split(" ")[0]);
  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {rows.map((r, i) => (
          <button
            key={r.label}
            onClick={() => setSel(i)}
            style={{
              padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: `1px solid ${i === sel ? r.color : C.bd}`,
              background: i === sel ? r.color : "#fff",
              color: i === sel ? "#fff" : C.t2, cursor: "pointer",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <LineTrendChart
        labels={short}
        series={[{ label: active.label, values: active.values, color: active.color }]}
        valueFormat="currency"
        showValues
      />

      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
              <Th l>$ / Location</Th>
              {short.map((m) => <Th key={m}>{m}</Th>)}
              <Th>MoM</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.label}
                onClick={() => setSel(i)}
                style={{ borderBottom: `1px solid ${C.s1}`, cursor: "pointer", background: i === sel ? C.s1 : "transparent" }}
              >
                <Td l bold={i === sel}>
                  <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: r.color, marginRight: 7, verticalAlign: "middle" }} />
                  {r.label}
                </Td>
                {r.values.map((v, j) => <Td key={j} mono>{v == null ? "—" : fmt(v)}</Td>)}
                <td style={{ textAlign: "right", padding: "10px 16px" }}>
                  <DeltaPill delta={wowDeltaPct(r.values)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const [decideAE, setDecideAE] = useState<string>("all");
  const [attView, setAttView] = useState<"quarterly" | "annual">("quarterly");
  const [fcastView, setFcastView] = useState<"quarterly" | "yearly">("quarterly");
  const [inclSql, setInclSql] = useState<boolean>(true); // Forecast Potential: include SQL-stage deals?
  // Deal Health: selected AE for the Aging-by-Stage module (toggle), and the drill-down selection.
  const [agingAE, setAgingAE] = useState<string>("All (everyone)");
  const [drill, setDrill] = useState<{ title: string; ae: string; stage: string; staleOnly: boolean } | null>(null);
  // Forecast tab: which cell's deals to show. Stored as the SELECTION (owner + which stage
  // bucket), never as a copied list, so the panel is always derived from the same rows the
  // number itself came from.
  const [fDrill, setFDrill] = useState<{ owner: string; label: string; bucket: "open" | "early" | "late"; cell: number } | null>(null);
  // Booked ARR & Cashflow: which month's rows to show. cfDrill = cash-in payments (Cash timing),
  // pcDrill = deals arriving into a tier (Forward ARR forecast).
  const [cfDrill, setCfDrill] = useState<{ ym: string; label: string; kind: "std" | "rr" | "all" } | null>(null);
  // ARR Funnel (Pilot → Contracted → Billed): which month + which column was clicked. The deal
  // sets come from the API (arrFunnel.stock[].ids → arrFunnel.dealIndex) — nothing recomputed here.
  const [afDrill, setAfDrill] = useState<{ ym: string; label: string; bucket: string; col: string; cell: number } | null>(null);
  // Forecast tab — Closed Won / YTD click-through. Separate from fDrill because it lists CLOSED
  // deals (from closedWonFeed) rather than open pipeline; the two never show at once.
  const [cwDrill, setCwDrill] = useState<{ owner: string; label: string; scope: "q" | "y"; cell: number } | null>(null);
  // Which funnel rows have their breakdown expanded. Collapsed by default so the matrix reads
  // as the five headline lines; click "Contracted" to see the renewal / expansion split.
  const [funnelOpen, setFunnelOpen] = useState<Record<string, boolean>>({});
  const [pcDrill, setPcDrill] = useState<{ ym: string; label: string } | null>(null);
  const AGING_EXPLICIT = ["SQL", "SAL", "SQO", "Trial", "Proposal", "Pending Signature", "Expansion Lead"];
  const clk = { cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: "3px" } as const;
  const downloadCsv = (name: string, deals: NonNullable<DashboardData["dealBreakdown"]>) => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Opp ID", "Name", "Owner", "Stage", "ARR", "Age (days)", "Stale", "SFDC Link"];
    const lines = deals.map((d) => [d.id, d.name, d.owner, d.stage, d.arr, d.age ?? "", d.stale ? "Yes" : "No", d.url].map(esc).join(","));
    const csv = [header.map(esc).join(","), ...lines].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `deal-breakdown-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const [cashAE, setCashAE] = useState<string>("all");
  const [cashTier, setCashTier] = useState<"booked" | "contracted" | "live">("contracted"); // Forward ARR forecast tier toggle
  const [dealAE, setDealAE] = useState<string>("all");
  const [dealConf, setDealConf] = useState<string>("all");
  const [dealSearch, setDealSearch] = useState<string>("");
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

    // 2026-only cumulative (restarts at Jan-26 = YTD attainment). H1 (Jan–Jun) is
    // shaded as the prior plan — superseded by the H2 plan — vs H2 (Jul–Dec).
    const cumulative2026: { label: string; actual: number; isH1: boolean }[] = [];
    let run26 = 0;
    for (const m of data.aeAttainment.monthlyTeamActual) {
      if (!/-26$/.test(m.label)) continue;
      run26 += m.actual;
      const mi = MONTH_ABBR.indexOf(m.label.slice(0, 3).toLowerCase());
      cumulative2026.push({ label: m.label, actual: run26, isH1: mi >= 0 && mi <= 5 });
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
      cumulative2026,
      churnWindow,
      churnCumulative,
    };
  }, [data]);

  const pipeOwners = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.trendEvents.map((e) => e.owner))).sort();
  }, [data]);

  // Monthly ARR-trend series from the "ARR MoM Progression" tab (Total ARR), joined to
  // the ARR tab by month so the hover tooltip keeps New ARR / Churned. changePct uses
  // the tab's MoM Growth % (÷100 → fraction, since pct() multiplies back up). Falls
  // back to the ARR tab's monthly points when the new tab is absent (demo mode).
  const arrMomPoints = useMemo<ArrPoint[]>(() => {
    if (!data) return [];
    const byLabel = new Map(data.arr.monthly.map((m) => [m.label, m]));
    const pts: ArrPoint[] =
      !data.arrMom || !data.arrMom.length
        ? data.arr.monthly.map((m) => ({ ...m }))
        : data.arrMom.map((p) => {
      const m = byLabel.get(p.label);
      return {
        label: p.label,
        activeARR: p.totalARR,
        bookedARR: m?.bookedARR ?? 0,
        newARR: m?.newARR ?? 0,
        newBusiness: m?.newBusiness ?? 0,
        expansion: m?.expansion ?? 0,
        renewals: m?.renewals ?? 0,
        churnedARR: m?.churnedARR ?? 0,
        changePct: p.momGrowth / 100,
        alfie: m?.alfie ?? 0,
        managedServices: m?.managedServices ?? 0,
        coreExisting: m?.coreExisting ?? 0,
        alfieTarget: m?.alfieTarget ?? 0,
        msTarget: m?.msTarget ?? 0,
      };
    });
    // The Command ARR chart's source of truth is the Headline tab's ARR-trend table: overlay its
    // active / new / churn / mom onto each month so editing a Headline 'active' cell moves the chart.
    if (data.headlineTrend && data.headlineTrend.length) {
      const ht = new Map(data.headlineTrend.map((t) => [t.ym, t]));
      for (let i = 0; i < pts.length; i++) {
        const t = ht.get(pts[i].label);
        if (t) pts[i] = { ...pts[i], activeARR: t.active, newARR: t.newARR, churnedARR: t.churn, changePct: t.mom };
      }
    }
    // The current calendar month's Rule A value is a month-END projection (subtracts the
    // month's upcoming term-ends, so it reads as a drop). Anchor the current-month point on
    // the true as-of-today Live ARR so the chart endpoint matches the headline ($5.79M).
    const nowKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    const ci = pts.findIndex((p) => p.label === nowKey);
    if (ci >= 0 && data.liveArrToday != null) {
      const prev = pts[ci - 1];
      pts[ci] = { ...pts[ci], activeARR: data.liveArrToday, changePct: prev && prev.activeARR > 0 ? (data.liveArrToday - prev.activeARR) / prev.activeARR : pts[ci].changePct };
    }
    return pts;
  }, [data]);

  // Pipeline generated within the quarter, per AE — now computed server-side (data.pipelineGen)
  // from the open + closed-LOST pulls by Date_Reached_SQL, fixing the Pipeline-WoW month-drift and
  // including lost pipeline. ARR = Annual_Contract_Value_ARR_Formula__c (Amount/TCV). Falls back to
  // the old Pipeline-WoW MoM figure if the server field is absent.
  const q3CreatedByOwner = useMemo(() => {
    const out: Record<string, number> = {};
    if (!data) return out;
    if (data.pipelineGen) { for (const [rep, o] of Object.entries(data.pipelineGen.byOwner)) out[rep] = o.arr; return out; }
    const { months, reps } = data.pipelineWow.newArrMom;
    const q3Idx = months.map((m, i) => (isQ3Fy26(m) ? i : -1)).filter((i) => i >= 0);
    for (const [rep, vals] of Object.entries(reps)) { if (/^all\b/i.test(rep)) continue; out[rep] = q3Idx.reduce((s, i) => s + (vals[i] ?? 0), 0); }
    return out;
  }, [data]);

  // Count of quarter-created opps per AE — same server source (open + closed-lost).
  const q3CreatedCountByOwner = useMemo(() => {
    const out: Record<string, number> = {};
    if (!data) return out;
    if (data.pipelineGen) { for (const [rep, o] of Object.entries(data.pipelineGen.byOwner)) out[rep] = o.count; return out; }
    const { months, reps } = data.pipelineWow.newOppsMom;
    const q3Idx = months.map((m, i) => (isQ3Fy26(m) ? i : -1)).filter((i) => i >= 0);
    for (const [rep, vals] of Object.entries(reps)) { if (/^all\b/i.test(rep)) continue; out[rep] = q3Idx.reduce((s, i) => s + (vals[i] ?? 0), 0); }
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
    // Every Command number is a computed cell on the Headline sheet tab — read it BY KEY so the
    // dashboard does no math (audit any number by opening Headline). The in-code expressions below
    // stay ONLY as a break-glass fallback if a key is ever missing. H = number, Hn = nullable.
    const H = (k: string, fb: number): number => data.headlineSource?.[k] ?? fb;
    const Hn = (k: string, fb: number | null): number | null => data.headlineSource?.[k] ?? fb;
    const months = data.arr.monthly;
    const latest = months[months.length - 1];
    // "Current month" = the row matching today's YYYY-MM, else the latest row that
    // isn't in the future. Fixes New/Churned ARR showing a future month (e.g. Sep)
    // with near-zero data instead of the actual current month.
    const nowKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    const notFuture = months.filter((m) => m.label <= nowKey);
    // Use the LAST COMPLETE month — the current calendar month is in progress, and Rule A
    // projects its month-end active ARR (subtracting upcoming churn), so on the 1st it
    // looks like ARR fell and New ARR reads $0. Prefer the latest month before this one.
    const complete = months.filter((m) => m.label < nowKey);
    const prevMonth = complete[complete.length - 1]; // last complete month (for MoM base)
    // Current month = this calendar month (labels the "(mo)" tiles correctly). Its Live ARR
    // is taken as-of-today (arrNow below), not the month-end projection.
    const currentMonth =
      months.find((m) => m.label === nowKey) ??
      complete[complete.length - 1] ??
      notFuture[notFuture.length - 1] ??
      latest;
    // Live ARR = current-month Total ARR from the "ARR MoM Progression" tab (the
    // authoritative series). Pick the row for this month, else the latest non-future
    // row. Falls back to the ARR tab's Active ARR Snapshot if the tab is absent (demo).
    const arrMomList = data.arrMom && data.arrMom.length ? data.arrMom : null;
    const arrMomCur = arrMomList
      ? arrMomList.filter((p) => p.label < nowKey).slice(-1)[0] ??
        arrMomList.filter((p) => p.label <= nowKey).slice(-1)[0] ??
        arrMomList[arrMomList.length - 1]
      : null;
    // Live ARR = true active book AS OF TODAY (not the current-month month-end projection,
    // which subtracts the whole month's upcoming expirations and looks like a drop).
    const arrNow = data.liveArrToday ?? (arrMomCur ? arrMomCur.totalARR : currentMonth?.activeARR ?? 0);
    // MoM = as-of-today Live ARR vs last complete month's active ARR (not the current-month
    // month-end projection, which read as a false drop).
    const curMoM = Hn(
      "mom_pct",
      data.liveArrToday != null && prevMonth && prevMonth.activeARR > 0
        ? (data.liveArrToday - prevMonth.activeARR) / prevMonth.activeARR
        : arrMomCur ? arrMomCur.momGrowth / 100 : currentMonth?.changePct ?? null
    );
    const gap = H("gap_to_10m", 10000000 - arrNow);

    // Q3 pipe generation vs quota vs time elapsed. Headline "Created in Q3" = the Pipeline tab's
    // canonical "Created This Quarter (ARR)" (all sources), the single auditable figure. The per-AE
    // table below is a rep-ATTRIBUTION view (excludes AM/lead/unassigned) so it sums to less.
    const aeRows = data.pipeline.aeBreakdown.filter((r) => r.name !== "TOTAL");
    const quota = H("pipe_quota", aeRows.reduce((s, r) => s + (r.quota ?? 0), 0));
    const genRows = data.forecastTab.rows.filter((r) => !r.am && !r.lead);
    const genAe = genRows.reduce((s, r) => s + (q3CreatedByOwner[r.name] ?? 0), 0);
    // Created in Q3 = code-computed pipeline generated (open + closed-lost, drift-free); the per-AE
    // table sums the same source, so headline and breakdown reconcile.
    const gen = data.pipelineGen?.total ?? H(
      "pipe_created_q3",
      data.pipeline.metricSections["4. PIPELINE CREATED (NEW)"]?.find((m) => m.metric === "Created This Quarter (ARR)")?.value ?? genAe
    );
    // gen_pct is stored as a fraction on Headline; fall back to the ratio of the sourced values.
    const genPct = data.headlineSource?.gen_pct != null ? data.headlineSource.gen_pct * 100 : quota > 0 ? (gen / quota) * 100 : 0;
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
    const wowDelta = data.headlineSource?.pipe_wow_pct != null ? data.headlineSource.pipe_wow_pct * 100 : arrRow ? wowDeltaPct(arrRow.values) : null;

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

    const coverage = H(
      "coverage",
      data.pipeline.metricSections["3. PIPELINE COVERAGE"]?.find((m) => m.metric === "Pipeline Coverage Ratio")?.value ?? 0
    );
    const coverageStatus =
      coverage >= 3
        ? { label: "Healthy", tone: "good" as const }
        : coverage >= 2
        ? { label: "Watch", tone: "warn" as const }
        : { label: "Low", tone: "bad" as const };

    const arrStatus =
      (curMoM ?? 0) >= 0
        ? { label: "On track", tone: "good" as const }
        : { label: "Declining", tone: "bad" as const };

    return {
      arrNow,
      gap,
      arrMoM: curMoM,
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

    // Pipeline totals + this-week read from the Headline tab (computed cells); Pipeline tab as fallback.
    const totalOpps =
      data.headlineSource?.total_opps ??
      data.pipeline.metricSections["1. TOTAL PIPELINE"]?.find((m) => m.metric === "Total Opportunities")?.value ?? 0;
    const totalPipe =
      data.headlineSource?.total_pipeline ??
      data.pipeline.metricSections["1. TOTAL PIPELINE"]?.find((m) => m.metric === "Total Pipeline (ARR)")?.value ?? 0;

    const arrRow = wowMetrics.find((m) => m.raw.includes("New ARR pipeline Created"));
    const arrClean = arrRow?.values.filter((v): v is number => v != null) ?? [];
    const arrThisWeek = data.headlineSource?.pipe_created_week ?? arrClean[arrClean.length - 1] ?? 0;
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

    // Q3 ARR mix skew from last 3 months
    // TRUE quarter window (e.g. Jul–Sep), not a rolling last-3-months slice — otherwise
    // in August it becomes Jun–Aug and overstates "Q3".
    const qStart = data.quarter.start.slice(0, 7), qEndExcl = data.quarter.end.slice(0, 7);
    const q3Win = months.filter((m) => m.label >= qStart && m.label < qEndExcl);
    const nb = q3Win.reduce((s, m) => s + m.newBusiness, 0);
    const exp = q3Win.reduce((s, m) => s + m.expansion, 0);
    const newArrNbExp = nb + exp; // Q3 New ARR = Net New + Expansion (renewals excluded)
    const mixTotal = nb + exp;
    const nbPct = mixTotal > 0 ? (nb / mixTotal) * 100 : 0;

    const gp = (n: number | null | undefined) => (n != null ? pct(n) : "—");

    return {
      command: {
        sentence: `ARR sits at ${fmt(S.arrNow)} — ${fmt(S.gap)} from the $10M milestone. Pipeline generation is ${S.genStatus.tone === "good" ? "on pace" : "behind pace"} at ${S.genPct.toFixed(0)}% of the Q3 quota with ${(100 - S.elapsedPct).toFixed(0)}% of the quarter remaining${S.wowDelta != null ? (S.wowDelta >= 0 ? ` while weekly pipeline creation rebounded +${Math.round(S.wowDelta)}% WoW` : ` while weekly pipeline creation declined ${Math.round(S.wowDelta)}% WoW`) : ""}.`,
        stats: [
          { label: "Live ARR", value: fmt(S.arrNow), tone: "good" as const, sub: "signed contracts — SFDC stages Billing + Closed Won (contract-live & not churned) · as of today" },
          { label: "New ARR (mo)", value: fmt(data.headlineSource?.new_arr_mo ?? S.currentMonth?.newARR), sub: `New Biz + Expansion · per contract live date${S.currentMonth?.label ? " · " + S.currentMonth.label : ""}` },
          { label: "Churned (mo)", value: fmt(data.headlineSource?.churn_mo ?? S.currentMonth?.churnedARR), sub: S.currentMonth?.label, tone: "bad" as const },
          { label: "Up for renewal (mo)", value: fmt(data.headlineSource?.up_for_renewal_mo ?? data.arrForward?.renewalDue ?? 0), sub: "contract term ends this month · in renewal", tone: "warn" as const },
          { label: "MoM change", value: gp(S.arrMoM), tone: (S.arrMoM ?? 0) >= 0 ? ("good" as const) : ("bad" as const) },
          {
            label: "Total pipeline",
            value: fmt(totalPipe),
            extra: { label: "Coverage", value: S.coverage.toFixed(2) + "x", tone: S.coverage >= 3 ? ("good" as const) : ("warn" as const) },
          },
        ],
      },
      targets: {
        sentence: `Quarter-to-date the team has attained ${fmt(teamActual)} — ${teamPct.toFixed(1)}% of the ${fmt(teamQuota)} Q3 quota${top ? `, with ${top.name} leading at ${gp(top.pctOfQuota)}` : ""}.${mixTotal > 0 ? ` New ARR (Net New + Expansion) is ${fmt(newArrNbExp)}, skewing ${nbPct.toFixed(0)}% Net New.` : ""}`,
        stats: [
          { label: "New ARR (current mo)", value: fmt(S.currentMonth?.newARR), sub: `Net New + Expansion · per contract live date${S.currentMonth?.label ? " · " + S.currentMonth.label : ""}` },
          { label: "Team New ARR Q3", value: fmt(newArrNbExp), sub: `Net New + Expansion · per contract live date · ${qStart}→${qEndExcl}` },
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
      acv: (() => {
        // Current-month $/Location (Total, per MONTH) for the exec-summary strip.
        const PL = data.perLocation;
        const plCur = PL?.total[PL.total.length - 1] ?? null;
        const plPrev = PL?.total[PL.total.length - 2] ?? null;
        const plMom = plCur != null && plPrev != null && plPrev !== 0 ? ((plCur - plPrev) / plPrev) * 100 : null;
        const plLocs = PL?.locations[PL.locations.length - 1] ?? null;
        const plMonth = PL?.months[PL.months.length - 1] ?? "";
        return {
          sentence: `Average won deal is ${fmt(data.acv.avg)} (median ${fmt(data.acv.median)}) across ${data.acv.count} wins in 18 months. YTD win rate: ${data.winRateYtd.winRate != null ? pct(data.winRateYtd.winRate) : "—"} on ${data.winRateYtd.closedCount} closed New Business deals${data.winRateYtd.medianCycle != null ? `, median cycle ${data.winRateYtd.medianCycle}d SQL→close` : ""}.`,
          stats: [
            { label: "Avg deal size", value: fmt(data.acv.avg), sub: "won, last 18mo" },
            { label: "Median deal size", value: fmt(data.acv.median), sub: "less outlier skew" },
            { label: "Win rate YTD", value: data.winRateYtd.winRate != null ? pct(data.winRateYtd.winRate) : "—", sub: `${data.winRateYtd.wonCount} of ${data.winRateYtd.closedCount} New Biz` },
            { label: "Median cycle", value: data.winRateYtd.medianCycle != null ? `${data.winRateYtd.medianCycle}d` : "—", sub: "SQL → close" },
            ...(plCur != null
              ? [{
                  label: `$ / Location / mo · ${plMonth}`,
                  value: "$" + plCur.toFixed(2),
                  sub: `${plMom != null ? `${plMom >= 0 ? "+" : ""}${plMom.toFixed(1)}% MoM` : ""}${plLocs != null ? ` · ${Math.round(plLocs).toLocaleString()} locations` : ""}`,
                  tone: (plMom ?? 0) >= 0 ? ("good" as const) : ("bad" as const),
                }]
              : []),
          ],
        };
      })(),
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

    // ── Targets source: the fixed finance plan + YTD/Q3 rollups now live on the Targets sheet tab
    // as the single auditable source. TS() prefers the sheet value, falling back to the in-code
    // plan (planConfig.ts) so a missing/edited tab degrades gracefully instead of breaking the tab.
    const TS = (k: string, fb: number): number => data.targetsSource?.[k] ?? fb;
    const planNewArr = TARGETS.newARR.map((v, i) => TS(`plan_newarr_m${i + 1}`, v));
    const planEndArr = TARGETS.endARR.map((v, i) => TS(`plan_endarr_m${i + 1}`, v));

    // YTD booked = sum of booked months that have data (prefer the Targets tab's SUMIFS rollup)
    const ytdBooked = TS("ytd_new_arr_booked", bookedByMonth.reduce((s: number, v) => s + (v ?? 0), 0));
    const ytdTargetThroughNow = TS(
      "ytd_new_arr_target",
      planNewArr.slice(0, now.getUTCMonth() + 1).reduce((s, v) => s + v, 0)
    );

    // Q3 booked & target — sourced from the Headline tab's key→value block when present (single
    // source of truth), falling back to the in-code computation. HS() = Headline source lookup.
    const HS = (k: string, fb: number): number => data.headlineSource?.[k] ?? fb;
    const q3Booked = HS("q3_booked", qMonthIdxs.reduce((s, i) => s + (bookedByMonth[i] ?? 0), 0));
    // Q3 target's single home is the Targets tab (the plan owner); fall back to Headline, then plan.
    const q3Target = TS("q3_target", HS("q3_target", qMonthIdxs.reduce((s, i) => s + planNewArr[i], 0)));
    const fy26NewArrTarget = TS("fy26_new_arr_target", planNewArr.reduce((s, v) => s + v, 0));

    // Weeks left in quarter
    const qEnd = new Date(qDef.end).getTime();
    const weeksLeft = Math.max(0, Math.ceil((qEnd - now.getTime()) / (7 * 86400000)));

    // Gap & run-rate read from the Headline tab's computed cells; the arithmetic below is only a
    // break-glass fallback so the dashboard does no math when the sheet is present.
    const arrGap = HS("gap_to_target", Math.max(0, q3Target - q3Booked));
    const arrPerWeek = HS("arr_needed_week", weeksLeft > 0 ? arrGap / weeksLeft : 0);

    // Pipeline: Q3 created vs quota, weekly run-rate. Created = the Pipeline tab's canonical
    // "Created This Quarter (ARR)" (all sources) so Command gap & the header agree; fall back to
    // the AE-only rep sum if the metric is absent.
    const pipeGenAe = data.forecastTab.rows
      .filter((r) => !r.am && !r.lead)
      .reduce((s, r) => s + (q3CreatedByOwner[r.name] ?? 0), 0);
    const pipeGen = data.pipelineGen?.total ?? HS(
      "pipe_created_q3",
      data.pipeline.metricSections["4. PIPELINE CREATED (NEW)"]?.find((m) => m.metric === "Created This Quarter (ARR)")?.value ?? pipeGenAe
    );
    const pipeQuota = HS(
      "pipe_quota",
      data.pipeline.aeBreakdown.filter((r) => r.name !== "TOTAL").reduce((s, r) => s + (r.quota ?? 0), 0)
    );
    const pipeGap = HS("pipe_gap", Math.max(0, pipeQuota - pipeGen));
    const pipePerWeek = HS("pipe_needed_week", weeksLeft > 0 ? pipeGap / weeksLeft : 0);

    // Last *completed* week — NOT the current in-progress week. The weekly ARR tab and
    // the WoW table both carry a row/column for the running week, which understates
    // "last week". Exclude it: ARR from the last weekly row before this week's Monday;
    // pipeline from the 2nd-to-last WoW column (the last column is the current week).
    const curMonday = getWeekStart(now.toISOString().slice(0, 10));
    const completedWeeks = data.arr.weekly.filter((w) => w.label < curMonday);
    const lastWeek = completedWeeks[completedWeeks.length - 1];
    const arrAddedLastWeek = lastWeek?.newARR ?? 0;
    const arrWeekLabel = lastWeek?.label ?? "";
    const pipeRow = data.pipelineWow.weeks.find((w) => w.metric.includes("New ARR pipeline Created"));
    const pipeClean = pipeRow?.values.filter((v): v is number => v != null) ?? [];
    const pipeAddedLastWeek =
      pipeClean.length >= 2 ? pipeClean[pipeClean.length - 2] : pipeClean[pipeClean.length - 1] ?? 0;

    // Chart series: booked vs target, with H2 rebased flag
    const chart = PLAN_MONTHS.map((m, i) => ({
      month: m,
      target: planNewArr[i],
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
    const qtdArrTarget = TS(
      "qtd_arr_target",
      qMonthIdxs.filter((i) => i <= nowMonth).reduce((s, i) => s + planNewArr[i], 0)
    );

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
      annualEnd: TS("fy26_ending_arr_target", ANNUAL_END_TARGET),
      planNewArr,
      planEndArr,
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

  const chartPoints = period === "monthly" ? arrMomPoints : data.arr.weekly;

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
              title="Team ARR Attainment — Cumulative (2026)"
              sub="2026 YTD running total of closed-won + live-paying ARR · H1 (faded) is the prior plan, replaced by the H2 plan"
            >
              <div style={{ padding: "16px 20px" }}>
                <BarTrendChart
                  labels={derived.cumulative2026.map((m) => m.label)}
                  values={derived.cumulative2026.map((m) => m.actual)}
                  barColors={derived.cumulative2026.map((m) => (m.isH1 ? C.bd : C.navy))}
                  valueFormat="currency"
                />
                {/* H1 (prior plan) vs H2 (current plan) legend */}
                <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 11.5, color: C.t2 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 2, background: C.bd, display: "inline-block" }} />
                    H1 — prior plan (superseded)
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 2, background: C.navy, display: "inline-block" }} />
                    H2 — current plan
                  </span>
                </div>
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
                          P.planEndArr[i],
                          i >= 6,
                          false,
                          false
                        )
                      )}
                      {[0, 1, 2, 3].map((qi) => {
                        const idxs = [qi * 3, qi * 3 + 1, qi * 3 + 2];
                        const target = idxs.reduce((s, i) => s + P.planNewArr[i], 0);
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
                (a, b) =>
                  (a.lead ? 0 : a.am ? 2 : 1) - (b.lead ? 0 : b.am ? 2 : 1)
              );
              const aeRows = roster.filter((r) => !r.am && !r.lead);
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
                            {row.short ?? row.name.split(" ")[0]}
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

        </div>
      )}

      {tab === "attainment" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="AE Attainment" sentence={tabSummaries.attainment.sentence} stats={tabSummaries.attainment.stats} />
          )}
          {/* Quarterly ⇄ Annual toggle */}
          <div style={{ display: "inline-flex", background: C.s2, border: `1px solid ${C.bd}`, borderRadius: 10, padding: 3, marginBottom: 16 }}>
            {(["quarterly", "annual"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setAttView(v)}
                style={{
                  border: "none", cursor: "pointer", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600,
                  fontFamily: "inherit", textTransform: "capitalize",
                  background: attView === v ? "#fff" : "transparent",
                  color: attView === v ? C.t1 : C.t3,
                  boxShadow: attView === v ? "0 1px 3px rgba(0,0,0,.08)" : "none",
                }}
              >
                {v === "quarterly" ? `${data.quarter.label}` : `Annual (FY${new Date().getUTCFullYear().toString().slice(2)})`}
              </button>
            ))}
          </div>
          {attView === "annual" && (() => {
            const kM = (n: number) => {
              const a = Math.abs(n);
              if (a >= 1e6) return "$" + (a / 1e6).toFixed(2) + "M";
              if (a >= 1e3) return "$" + Math.round(a / 1e3) + "k";
              return "$" + Math.round(a);
            };
            const label = (t: string) => (
              <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{t}</div>
            );
            const reps = data.aeAnnual?.reps ?? [];
            if (reps.length === 0) {
              return <div style={{ background: "#fff", border: `1px solid ${C.bd}`, borderRadius: 14, padding: "22px", color: C.t2, fontSize: 14 }}>Annual attainment data not yet available. Run <code>refresh-ae-annual-potential.mjs</code> to populate it.</div>;
            }
            const teamGoal = reps.reduce((s, r) => s + r.goal, 0);
            const teamYtd = reps.reduce((s, r) => s + r.ytdTotal, 0);
            const teamProj = reps.reduce((s, r) => s + r.projection, 0);
            return (
              <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 4 }}>
                  {[
                    ["Team annual goal", kM(teamGoal), `${reps.length} reps`, C.t1],
                    ["Team YTD attainment", kM(teamYtd), `${teamGoal > 0 ? Math.round((teamYtd / teamGoal) * 100) : 0}% of goal · by ContractLiveDate`, C.coralDk],
                    ["Full-year projection", kM(teamProj), `${teamGoal > 0 ? Math.round((teamProj / teamGoal) * 100) : 0}% of goal · YTD + open-pipe potential`, C.navy],
                  ].map(([l, v, s, c], i) => (
                    <div key={i} style={{ background: "#fff", border: `1px solid ${C.bd}`, borderRadius: 14, padding: "16px 20px" }}>
                      {label(l as string)}
                      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: c as string, marginTop: 4 }}>{v}</div>
                      <div style={{ fontSize: 12, color: C.t2, marginTop: 3 }}>{s}</div>
                    </div>
                  ))}
                </div>
                {[...reps].sort((a, b) => b.pctOfGoal - a.pctOfGoal).map((rep) => (
                  <div key={rep.name} style={{ background: "#fff", border: `1px solid ${C.bd}`, borderRadius: 14, padding: "18px 22px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: C.t1 }}>{rep.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.coralDk, background: C.coralSoft, borderRadius: 20, padding: "4px 12px" }}>
                        {rep.goal > 0 ? pct(rep.pctOfGoal) : "—"} to annual goal
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
                      <div>
                        {label("Annual Goal")}
                        <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.t1, marginTop: 3 }}>{rep.goal > 0 ? kM(rep.goal) : "—"}</div>
                      </div>
                      <div>
                        {label("YTD Attainment")}
                        <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.coralDk, marginTop: 3 }}>{kM(rep.ytdTotal)}</div>
                        <div style={{ fontSize: 11.5, color: C.t3, marginTop: 2 }}>NB {kM(rep.ytdNB)} · Exp {kM(rep.ytdExp)}</div>
                      </div>
                      <div>
                        {label("Potential ARR (Year)")}
                        <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.purp, marginTop: 3 }}>{kM(rep.potTotal)}</div>
                        <div style={{ fontSize: 11.5, color: C.t3, marginTop: 2 }}>AE/AM % × open ARR</div>
                      </div>
                      <div>
                        {label("Full-Year Projection")}
                        <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.navy, marginTop: 3 }}>{kM(rep.projection)}</div>
                        <div style={{ fontSize: 11.5, color: rep.pctProj >= 1 ? C.grn : C.t3, marginTop: 2 }}>{rep.goal > 0 ? `${pct(rep.pctProj)} of goal` : ""}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 16 }}>
                      {label("YTD → Projection vs Annual Goal")}
                      <div style={{ marginTop: 6 }}><Bar value={rep.ytdTotal} target={rep.goal} /></div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
          {attView === "quarterly" && (() => {
            const kM = (n: number) => {
              const a = Math.abs(n);
              if (a >= 1e6) return "$" + (a / 1e6).toFixed(2) + "M";
              if (a >= 1e3) return "$" + Math.round(a / 1e3) + "k";
              return "$" + Math.round(a);
            };
            const label = (t: string) => (
              <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{t}</div>
            );
            const attByName: Record<string, { actual: number; nb?: number; exp?: number }> = {};
            for (const a of data.aeAttainment.reps) attByName[a.name] = a;
            // Q3 month labels (e.g. Jul-26/Aug-26/Sep-26) for summing MoM ARR blocks.
            const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const qMonthSet = new Set<string>();
            {
              const [sy, sm] = data.quarter.start.slice(0, 7).split("-").map(Number);
              for (let k = 0; k < 3; k++) {
                const m = sm - 1 + k;
                const y = sy + Math.floor(m / 12);
                qMonthSet.add(`${MON[m % 12]}-${String(y).slice(2)}`);
              }
            }
            const sumQ3 = (blk: { months: string[]; reps: Record<string, number[]> }, name: string) => {
              const arr = blk.reps[name];
              if (!arr) return 0;
              return blk.months.reduce((s, mo, i) => s + (qMonthSet.has(mo) ? (arr[i] ?? 0) : 0), 0);
            };
            return (
              <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                {data.forecastTab.rows.map((rep) => {
                  const att = attByName[rep.name];
                  // NB/Exp split: prefer the Q3 sums of the Net New / Expansion MoM
                  // blocks (booked ARR), then AE-attainment split columns, then Query 2.
                  const nbQ3 = sumQ3(data.pipelineWow.netNewArrMom, rep.name);
                  const expQ3 = sumQ3(data.pipelineWow.expansionArrMom, rep.name);
                  const cwq = data.cwSplitByOwner?.[rep.name] ?? { nb: 0, exp: 0 };
                  const attSplit = att != null && ((att.nb ?? 0) !== 0 || (att.exp ?? 0) !== 0);
                  // The official AE attainment (att.actual) is New-Business-only by
                  // definition, so its whole figure IS the NB split (Exp = 0) — this
                  // keeps the "Closed Won" headline and its NB/Exp sub-line consistent.
                  // Fall back to booked Net New / Expansion MoM sums, then the
                  // AE-attainment split columns, then Query 2, for rows without it (AMs).
                  const cw =
                    att?.actual != null
                      ? { nb: att.actual, exp: 0 }
                      : nbQ3 !== 0 || expQ3 !== 0
                      ? { nb: nbQ3, exp: expQ3 }
                      : attSplit
                      ? { nb: att!.nb ?? 0, exp: att!.exp ?? 0 }
                      : cwq;
                  const cwTotal = att?.actual ?? rep.closedWon ?? cw.nb + cw.exp;
                  const quota = rep.quota;
                  const attain = quota && quota > 0 ? cwTotal / quota : null;
                  const pipeGen = q3CreatedByOwner[rep.name] ?? 0;
                  const pipeTarget = AE_PLAN[rep.name]?.pipeGenTargetQ3 ?? 0;
                  const coverage = data.coverageByOwner?.[rep.name] ?? 0;
                  const covMult = quota && quota > 0 ? coverage / quota : null;
                  const isAE = !rep.am && !rep.lead;
                  return (
                    <div key={rep.name} style={{ background: "#fff", border: `1px solid ${C.bd}`, borderRadius: 14, padding: "18px 22px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: C.t1 }}>{rep.name}</span>
                          {rep.lead && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.t2, background: C.s2, border: `1px solid ${C.bd}`, borderRadius: 6, padding: "2px 8px" }}>Enterprise · not in team attainment</span>
                          )}
                          {rep.am && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.t2, background: C.s2, border: `1px solid ${C.bd}`, borderRadius: 6, padding: "2px 8px" }}>AM</span>
                          )}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.coralDk, background: C.coralSoft, borderRadius: 20, padding: "4px 12px" }}>
                          {rep.lead ? "plan only" : `${attain != null ? pct(attain) : "\u2014"} to quota`}
                        </span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
                        <div>
                          {label("Quota Q3")}
                          <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.t1, marginTop: 3 }}>{quota != null && quota > 0 ? kM(quota) : "\u2014"}</div>
                        </div>
                        <div>
                          {label("Booked ARR")}
                          <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.coralDk, marginTop: 3 }}>{kM(cwTotal)}</div>
                          <div style={{ fontSize: 11.5, color: C.t3, marginTop: 2 }}>NB {kM(cw.nb)} · Exp {kM(cw.exp)}</div>
                        </div>
                        <div>
                          {label("Pipe Generated (TCV)")}
                          <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.purp, marginTop: 3 }}>{kM(pipeGen)}</div>
                          <div style={{ fontSize: 11.5, color: C.t3, marginTop: 2 }}>{pipeTarget > 0 ? `${Math.round((pipeGen / pipeTarget) * 100)}% of ${kM(pipeTarget)} target` : "no target"}</div>
                        </div>
                        <div>
                          {label("Coverage (SAL+SQO+SQL)")}
                          <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.t1, marginTop: 3 }}>{kM(coverage)}</div>
                          <div style={{ fontSize: 11.5, color: covMult != null && covMult >= 3 ? C.grn : C.t3, marginTop: 2 }}>{covMult != null ? `${covMult.toFixed(1)}\u00d7 quota` : ""}</div>
                        </div>
                      </div>
                      {isAE && (
                        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                          <div>
                            {label("Attainment to Quota")}
                            <div style={{ marginTop: 6 }}><Bar value={cwTotal} target={quota ?? 0} /></div>
                          </div>
                          <div>
                            {label("Pipeline Created to Target")}
                            <div style={{ marginTop: 6 }}><Bar value={pipeGen} target={pipeTarget} /></div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

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
                  showValues
                  trendline
                />
              </div>

              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.t2, marginBottom: 6 }}>
                New Opps Entered (SQL)
              </div>
              <BarTrendChart
                labels={data.pipelineWow.newOppsMom.months}
                values={data.pipelineWow.newOppsMom.reps[trendRep] ?? []}
                valueFormat="number"
                showValues
                trendline
              />
            </div>
          </Card>

          <Card
            title="New ARR"
            sub="New ARR booked by rep, per month — split into Net New and Expansion"
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
                Net New ARR ($)
              </div>
              <div style={{ marginBottom: 24 }}>
                <BarTrendChart
                  labels={data.pipelineWow.netNewArrMom.months}
                  values={data.pipelineWow.netNewArrMom.reps[trendRep] ?? []}
                  valueFormat="currency"
                  showValues
                  trendline
                />
              </div>

              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.t2, marginBottom: 6 }}>
                Expansion ARR ($)
              </div>
              <BarTrendChart
                labels={data.pipelineWow.expansionArrMom.months}
                values={data.pipelineWow.expansionArrMom.reps[trendRep] ?? []}
                valueFormat="currency"
                showValues
                trendline
              />
            </div>
          </Card>
        </div>
      )}

      {tab === "forecast" && (() => {
        const F = data.forecastTab;
        const Q = data.quarter;
        const roster = [...F.rows].sort(
          (a, b) => (a.lead ? 0 : a.am ? 2 : 1) - (b.lead ? 0 : b.am ? 2 : 1)
        );
        const hasLead = F.rows.some((r) => r.lead);
        const money = (n: number | null) => (n == null ? "\u2014" : fmt(n));
        const short = (name: string) => name.split(" ")[0];

        // Stage-based open potential, honoring the Include/Exclude-SQL toggle.
        // Quarterly uses AE/AM quarter %, Yearly uses AE/AM year %. Early = SQL+SAL
        // (Amount×%), Late = SQO+Trial (ARR×%); excluding SQL drops its slice of Early.
        type PotRow = { potEarlyQ: number; potLateQ: number; potSqlQ: number; potEarlyY: number; potLateY: number; potSqlY: number };
        const earlyPot = (r: PotRow, yearly: boolean) =>
          (yearly ? r.potEarlyY : r.potEarlyQ) - (inclSql ? 0 : (yearly ? r.potSqlY : r.potSqlQ));
        const latePot = (r: PotRow, yearly: boolean) => (yearly ? r.potLateY : r.potLateQ);
        const openPot = (r: PotRow, yearly: boolean) => earlyPot(r, yearly) + latePot(r, yearly);
        // Click a forecast number → the deals behind it. A span (not the cell) so the column keeps
        // its colour, and the click stores only the SELECTION — the panel re-derives the rows.
        const dnum = (owner: string, label: string, bucket: "open" | "early" | "late", value: number) => (
          <span style={drillable} onClick={() => { setCwDrill(null); setFDrill({ owner, label, bucket, cell: value }); }} title="Click to see the deals">{fmt(value)}</span>
        );
        // Quarterly per-row cells (toggle-aware). Potential = Closed Won + Early + Late.
        // "Pot. Late" (SQO + Trial) is the half of Potential with a real chance of closing in
        // the period — Early is SQL/SAL, which rarely converts in-quarter. Boxed in red in both
        // tables so it is read as the number that decides the forecast, not just another column.
        const LATE_WHY = "SQO + Trial — late-stage, the highest-probability slice of Potential and the part that realistically lands in this period. Early (SQL + SAL) rarely converts in time. Watch this column.";
        const ThLate = ({ children }: { children: ReactNode }) => (
          <th style={{ textAlign: "right", padding: "8px 16px 8px 0", whiteSpace: "nowrap" }}>
            <span title={LATE_WHY} style={{ display: "inline-block", cursor: "help",
              border: `1.5px solid ${C.red}`, borderRadius: 5, padding: "3px 9px",
              background: C.redBg, color: C.red,
              fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>
              {children}
            </span>
          </th>
        );

        const qCells = (r: PotRow & { closedWon: number; quota: number | null }) => {
          const early = earlyPot(r, false), late = latePot(r, false);
          const pot = r.closedWon + early + late;
          return { early, late, pot, variance: r.quota != null ? pot - r.quota : null, attainP: r.quota ? pot / r.quota : null };
        };

        // Totals incl. AM + Davi (grand total) drive the forecast headline numbers (quarter basis).
        const T = F.totalInclLead ?? F.totalInclAM;
        const totalPot = T.closedWon + openPot(T, false);
        const totalQuota = T.quota;
        const totalCW = T.closedWon;
        // (The projection baseline used to be end-of-Q2 live ARR; it is now TODAY'S Live ARR plus
        // open potential — see projEnd below, which also follows the Quarterly/Yearly toggle.)
        // Remainder of quarter, measured against the TOTAL quota (incl AM + Davi).
        const remGap = Math.max(0, totalQuota - totalCW);
        const remPerWeek = F.weeksLeft > 0 ? remGap / F.weeksLeft : 0;
        const potVsQuota = totalQuota > 0 ? totalPot / totalQuota : 0;

        // Decide board derived numbers
        // Filter by STAGE now (SQL/SAL/SQO), not by AE — per Stephen.
        const decideView = F.decideDeals.filter((d) => decideAE === "all" || d.stage === decideAE);
        const decideStages = ["all", "SQL", "SAL", "SQO"].filter((s) => s === "all" || F.decideDeals.some((d) => d.stage === s));
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

        // Quarterly ⇄ Yearly toggle (shown on both views). Yearly uses the AE/AM % YEAR
        // forecast (AE_AM_Probability_Year__c) from the AE_Annual_Potential feed.
        const fcastToggle = (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "inline-flex", background: C.s2, border: `1px solid ${C.bd}`, borderRadius: 10, padding: 3 }}>
              {(["quarterly", "yearly"] as const).map((v) => (
                <button key={v} onClick={() => setFcastView(v)}
                  style={{ border: "none", cursor: "pointer", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                    background: fcastView === v ? "#fff" : "transparent", color: fcastView === v ? C.t1 : C.t3,
                    boxShadow: fcastView === v ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
                  {v === "quarterly" ? Q.label : "Yearly (FY26)"}
                </button>
              ))}
            </div>
            <div style={{ display: "inline-flex", background: C.s2, border: `1px solid ${C.bd}`, borderRadius: 10, padding: 3 }}>
              {([["incl", true, "Incl. SQL"], ["excl", false, "Excl. SQL"]] as const).map(([k, val, lbl]) => (
                <button key={k} onClick={() => setInclSql(val)}
                  style={{ border: "none", cursor: "pointer", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                    background: inclSql === val ? "#fff" : "transparent", color: inclSql === val ? C.t1 : C.t3,
                    boxShadow: inclSql === val ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        );

        // Yearly numbers (AE/AM % YEAR). Potential is recomputed client-side with the same
        // stage rule + SQL toggle as Quarterly (from F.rows' year buckets); goal / YTD /
        // Yr%-missing still come from the AE_Annual_Potential feed. Projection = YTD + Potential.
        const annY = data.aeAnnual;
        const fByName = Object.fromEntries(F.rows.map((r) => [r.name, r]));
        // The AE_Annual_Potential feed is the single source for this table — it carries every
        // roster member, including leads whose quota is still TBD (goal 0 renders as "—").
        // There is deliberately NO client-side fallback row here: the previous one substituted
        // `closedWon`, a QUARTER-scoped figure, into the YTD column, which showed Davi at $57.9k
        // against an actual YTD of $1.16M. If a rep is missing from the feed, fix the roster in
        // scripts/refresh-ae-annual-potential.mjs rather than reconstructing a number here.
        const annYReps = [...(annY?.reps ?? [])]
          .filter((r) => !FORECAST_EXCLUDE.has(r.name))
          .map((r) => {
            const fr = fByName[r.name];
            const pot = fr ? openPot(fr, true) : r.potTotal;
            const projection = r.ytdTotal + pot;
            return { ...r, potTotal: pot, projection, pctProj: r.goal > 0 ? projection / r.goal : 0 };
          })
          .sort((a, b) => b.pctProj - a.pctProj);
        const kMY = (n: number) => (Math.abs(n) >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1e3) + "k");
        const annYTot = annYReps.reduce((t, r) => ({ goal: t.goal + r.goal, ytd: t.ytd + r.ytdTotal, pot: t.pot + r.potTotal, proj: t.proj + r.projection, miss: t.miss + r.yrMissing,
            early: t.early + (fByName[r.name] ? earlyPot(fByName[r.name], true) : 0), late: t.late + (fByName[r.name] ? latePot(fByName[r.name], true) : 0) }),
          { goal: 0, ytd: 0, pot: 0, proj: 0, miss: 0, early: 0, late: 0 });

        // Expected period end = TODAY'S Live ARR + the team's Potential, following the toggle.
        // The components are quoted EXACTLY as the table below shows them, so the tile reconciles
        // on screen: quarterly Potential is the "Total · incl AM + Davi" row ($1.05M), yearly is
        // Pot. Early + Pot. Late on the Team row ($3.00M).
        //
        // The one adjustment, shown on the tile rather than hidden: the QUARTERLY Potential column
        // is Closed Won + Early + Late, and those closed deals are signed and contract-live, so
        // they are already inside Live ARR. Adding the column whole would count them twice, so it
        // is subtracted as a visible line. The yearly Potential is Early + Late only (YTD is its
        // own column), so there is nothing to subtract.
        const projBase = F.currentLiveARR;
        // Potential here is Early + Late ONLY. Closed Won is not added on top because it is
        // already inside Live ARR — which is exactly how the tile reads it out:
        //   Live ARR (incl. Closed Won) + Potential (Early + Late)
        const projEarly = fcastView === "yearly" ? annYTot.early : T.potEarlyQ;
        const projLate = fcastView === "yearly" ? annYTot.late : T.potLateQ;
        const projPot = projEarly + projLate;
        const projEnd = projBase + projPot;
        const projGap = F.annualTarget - projEnd;
        const projPeriod = fcastView === "yearly" ? "Year End" : `${Q.key} End`;

        return (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {/* header tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <Card title={`${Q.key} Projected Close`}>
              <div style={{ padding: "14px 18px" }}>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: totalPot >= totalQuota ? C.grn : C.ylw }}>{fmt(totalPot)}</div>
                <div style={{ fontSize: 12, color: C.t2, marginTop: 2 }}>Potential ARR vs {fmt(totalQuota)} quota · {pct(potVsQuota)}</div>
              </div>
            </Card>
            <Card title={`Expected ${projPeriod}`}>
              <div style={{ padding: "14px 18px" }}>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: projEnd >= F.annualTarget ? C.grn : C.coralDk }}>{fmt(projEnd)}</div>
                <div style={{ fontSize: 12, color: C.t2, marginTop: 2 }}>
                  Live ARR <b>{fmt(projBase)}</b> (Closed Won) &nbsp;+&nbsp; Potential <b>{fmt(projPot)}</b> (Early {fmt(projEarly)} and Late {fmt(projLate)})
                </div>
                <div style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>vs {fmt(F.annualTarget)} target</div>
              </div>
            </Card>
          </div>

          {/* in-quarter forecast — Quarterly ⇄ Yearly toggle (this table only) */}
          {fcastToggle}
          {fcastView === "yearly" && (annY?.missingYearlyOpps ?? 0) > 0 && (
            <div style={{ background: C.ylwBg, border: `1px solid ${C.ylw}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: C.t1 }}>
              ⚠️ <b>{annY?.missingYearlyOpps} open opps ({kMY(annY?.missingYearlyArr ?? 0)} ARR)</b> have no AE/AM <b>yearly</b> % — the yearly projection is understated until reps fill it.
            </div>
          )}
          <Card
            title={fcastView === "quarterly" ? `In-quarter forecast — ${Q.label}` : "Yearly forecast by AE — FY26"}
            sub={fcastView === "quarterly"
              ? `Per AE (incl. AM). Potential = Closed Won + Early (SQL+SAL, Amount×AE/AM %) + Late (SQO+Trial, ARR×AE/AM %). ${inclSql ? "SQL included" : "SQL excluded"}.`
              : `Per AE. YTD (by Contract Live Date) + Potential (Early SQL+SAL Amount×%, Late SQO+Trial ARR×%) using AE/AM % YEAR → full-year projection vs goal. ${inclSql ? "SQL included" : "SQL excluded"}.`}
          >
            {fcastView === "yearly" ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                    <Th l>AE</Th><Th>Open Pipeline</Th><Th>Annual Goal</Th><Th>YTD (Closed)</Th><Th>Pot. Early (SQL+SAL)</Th><ThLate>Pot. Late (SQO+Trial)</ThLate><Th>Projection</Th><Th>vs Goal</Th>
                  </tr>
                </thead>
                <tbody>
                  {annYReps.map((r) => {
                    const fr = fByName[r.name];
                    const early = fr ? earlyPot(fr, true) : 0, late = fr ? latePot(fr, true) : 0;
                    return (
                    <tr key={r.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <Td l bold>{r.name.split(" ")[0]}</Td>
                      <Td mono color={C.blue}>{fr ? dnum(r.name, r.name.split(" ")[0], "open", fr.openPipe) : "—"}</Td>
                      <Td mono color={C.t2}>{r.goal > 0 ? fmt(r.goal) : "—"}</Td>
                      <Td mono color={r.ytdTotal > 0 ? C.coralDk : C.t1}>
                        <span style={drillable} title="Click to see the closed deals"
                          onClick={() => { setFDrill(null); setCwDrill({ owner: r.name, label: r.name.split(" ")[0], scope: "y", cell: r.ytdTotal }); }}>
                          {fmt(r.ytdTotal)}
                        </span>
                      </Td>
                      <Td mono color={C.coralDk}>{dnum(r.name, r.name.split(" ")[0], "early", early)}</Td>
                      <Td mono color={C.purp}>{dnum(r.name, r.name.split(" ")[0], "late", late)}</Td>
                      <Td mono bold>{fmt(r.projection)}</Td>
                      <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(r.goal > 0 ? r.pctProj : null, r.goal > 0 ? r.projection - r.goal : null)}</td>
                    </tr>
                    );
                  })}
                  <tr style={{ borderTop: `2px solid ${C.navy}`, background: C.s2, fontWeight: 700 }}>
                    <Td l bold>Team</Td>
                    <Td mono>{fmt(annYReps.reduce((s, r) => s + (fByName[r.name]?.openPipe ?? 0), 0))}</Td>
                    <Td mono>{fmt(annYTot.goal)}</Td>
                    <Td mono color={C.coralDk}>{fmt(annYTot.ytd)}</Td>
                    <Td mono color={C.coralDk}>{fmt(annYReps.reduce((s, r) => { const fr = fByName[r.name]; return s + (fr ? earlyPot(fr, true) : 0); }, 0))}</Td>
                    <Td mono color={C.purp}>{fmt(annYReps.reduce((s, r) => { const fr = fByName[r.name]; return s + (fr ? latePot(fr, true) : 0); }, 0))}</Td>
                    <Td mono bold>{fmt(annYTot.proj)}</Td>
                    <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(annYTot.goal > 0 ? annYTot.proj / annYTot.goal : null, annYTot.goal > 0 ? annYTot.proj - annYTot.goal : null)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                    <Th l>AE</Th><Th>Open Pipeline</Th><Th>Quota</Th><Th>Closed Won</Th><Th>Pot. Early (SQL+SAL)</Th><ThLate>Pot. Late (SQO+Trial)</ThLate><Th>Potential</Th><Th>vs Quota</Th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <Td l bold>{r.short ?? short(r.name)}{r.am && <span style={{ color: C.t3, fontWeight: 400, fontSize: 11 }}> · AM</span>}</Td>
                      <Td mono color={C.blue}>{dnum(r.name, r.short ?? short(r.name), "open", r.openPipe)}</Td>
                      <Td mono color={C.t2}>{r.quota != null && r.quota > 0 ? fmt(r.quota) : "\u2014"}</Td>
                      <Td mono color={r.closedWon > 0 ? C.coralDk : C.t1}>
                        <span style={drillable} title="Click to see the closed deals"
                          onClick={() => { setFDrill(null); setCwDrill({ owner: r.name, label: r.short ?? short(r.name), scope: "q", cell: r.closedWon }); }}>
                          {fmt(r.closedWon)}
                        </span>
                      </Td>
                      <Td mono color={C.coralDk}>{dnum(r.name, r.short ?? short(r.name), "early", earlyPot(r, false))}</Td>
                      <Td mono color={C.purp}>{dnum(r.name, r.short ?? short(r.name), "late", latePot(r, false))}</Td>
                      <Td mono bold>{fmt(qCells(r).pot)}</Td>
                      <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(qCells(r).attainP, qCells(r).variance)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `2px solid ${C.navy}`, background: C.s2, fontWeight: 700 }}>
                    <Td l bold>AE team</Td>
                    <Td mono>{fmt(F.aeTeam.openPipe)}</Td><Td mono>{fmt(F.aeTeam.quota)}</Td><Td mono>{fmt(F.aeTeam.closedWon)}</Td>
                    <Td mono color={C.coralDk}>{fmt(earlyPot(F.aeTeam, false))}</Td><Td mono color={C.purp}>{fmt(latePot(F.aeTeam, false))}</Td><Td mono bold>{fmt(qCells(F.aeTeam).pot)}</Td>
                    <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(qCells(F.aeTeam).attainP, qCells(F.aeTeam).variance)}</td>
                  </tr>
                  <tr style={{ background: "#EEF2F8", fontWeight: 700 }}>
                    <Td l bold>Total · incl AM</Td>
                    <Td mono>{fmt(F.totalInclAM.openPipe)}</Td><Td mono>{fmt(F.totalInclAM.quota)}</Td><Td mono>{fmt(F.totalInclAM.closedWon)}</Td>
                    <Td mono color={C.coralDk}>{fmt(earlyPot(F.totalInclAM, false))}</Td><Td mono color={C.purp}>{fmt(latePot(F.totalInclAM, false))}</Td><Td mono bold>{fmt(qCells(F.totalInclAM).pot)}</Td>
                    <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(qCells(F.totalInclAM).attainP, null)}</td>
                  </tr>
                  {hasLead && (() => {
                    const G = F.totalInclLead ?? F.totalInclAM;
                    return (
                      <tr style={{ background: "#E4EAF2", fontWeight: 700 }}>
                        <Td l bold>Total · incl AM + Davi</Td>
                        <Td mono>{fmt(G.openPipe)}</Td><Td mono>{fmt(G.quota)}</Td><Td mono>{fmt(G.closedWon)}</Td>
                        <Td mono color={C.coralDk}>{fmt(earlyPot(G, false))}</Td><Td mono color={C.purp}>{fmt(latePot(G, false))}</Td><Td mono bold>{fmt(qCells(G).pot)}</Td>
                        <td style={{ textAlign: "right", padding: "10px 16px" }}>{vsQuotaPill(qCells(G).attainP, null)}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            )}
            {/* Click-through: the deals behind whichever forecast number was clicked. Folded into
                this card so the number and its evidence stay together. */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.bd}` }}>
              {(() => {
                const FB_EARLY = ["SQL", "SAL"], FB_LATE = ["SQO", "Trial"];
                // The Forecasting tab's Open Pipeline formula is
                //   SUMIFS('Query 1'!D:D, owner, StageName "<>Billing")
                // i.e. every open opp EXCEPT stage Billing (already-won deals waiting to bill are
                // not pipeline). The drill-down has to apply the same exclusion or it reports a
                // bigger number than the cell it was opened from.
                const FB_OPEN_EXCLUDE = ["Billing"];
                let spec: DrillSpec<NonNullable<typeof data.dealBreakdown>[number]> | null = null;
                if (fDrill && data.dealBreakdown) {
                  const stages = fDrill.bucket === "early" ? FB_EARLY : fDrill.bucket === "late" ? FB_LATE : null;
                  const rows = data.dealBreakdown
                    .filter((d) => d.owner === fDrill.owner
                      && (stages ? stages.includes(d.stage) : !FB_OPEN_EXCLUDE.includes(d.stage)))
                    .sort((a, b) => b.arr - a.arr);
                  const bucketChip = fDrill.bucket === "open" ? "open pipeline · excl. Billing"
                    : fDrill.bucket === "early" ? "early · SQL + SAL" : "late · SQO + Trial";
                  // Why the rows may not add up to the number clicked — state it rather than let
                  // the reader discover a mismatch and stop trusting the panel. The panel hands us
                  // its own row total, so nothing is re-summed here.
                  const note = fDrill.bucket === "open"
                    ? (total: number) => Math.abs(total - fDrill.cell) > Math.max(1000, fDrill.cell * 0.01)
                        ? `Heads up: the cell reads ${fmt(fDrill.cell)} from the Forecasting tab but these deals sum to ${fmt(total)} (Δ ${fmt(Math.abs(total - fDrill.cell))}). Both should be "open opps excluding stage Billing" — worth a look.`
                        : `Matches the cell (${fmt(fDrill.cell)}): open opps for this AE, excluding stage Billing, same basis as the Forecasting tab formula.`
                    : (total: number) => `This cell is probability-weighted — Σ(deal value × AE/AM %) = ${fmt(fDrill.cell)}. The deals below show their full unweighted ARR (${fmt(total)}), so they will total more.`;
                  spec = {
                    title: `forecast-${fDrill.label}-${fDrill.bucket}`,
                    chips: [fDrill.label, bucketChip],
                    note,
                    rows,
                    amount: (d) => d.arr,
                    amountLabel: "ARR",
                    emptyHint: "No open deals in this bucket for this AE.",
                    cols: [
                      { label: "Opportunity", l: true, csv: (d) => d.name || d.id,
                        render: (d) => <a href={d.url} target="_blank" rel="noreferrer" style={{ color: C.navy, textDecoration: "underline", fontWeight: 600 }}>{d.name || d.id}</a> },
                      { label: "Stage", l: true, csv: (d) => d.stage, render: (d) => d.stage },
                      { label: "Age (d)", mono: true, csv: (d) => d.age ?? "",
                        render: (d) => <span style={{ color: (d.age ?? 0) >= 90 ? C.red : C.t1 }}>{d.age ?? "—"}</span> },
                      { label: "ARR", mono: true, bold: true, csv: (d) => d.arr, render: (d) => fmt(d.arr) },
                    ],
                  };
                }
                // Closed Won / YTD click-through. Different rows (closed deals, not open
                // pipeline), so it gets its own spec; only ever one panel is on screen.
                let cwSpec: DrillSpec<NonNullable<typeof data.closedWonFeed>[number]> | null = null;
                if (cwDrill && data.closedWonFeed) {
                  const yr = String(new Date().getUTCFullYear());
                  // CALENDAR quarter bounds, not the sales quarter. The attainment formula reads
                  // DATE(2026,7,1) → DATE(2026,10,1); the dashboard's sales quarter starts a day
                  // later (2 Jul), and using that here would drop a deal live on the 1st.
                  const qNum = Number(Q.key.replace(/\D/g, "")) || 1;
                  const qStart = `${yr}-${String((qNum - 1) * 3 + 1).padStart(2, "0")}-01`;
                  const qEndEx = qNum === 4 ? `${Number(yr) + 1}-01-01` : `${yr}-${String(qNum * 3 + 1).padStart(2, "0")}-01`;
                  const inQ = (d: { eld: string }) => d.eld >= qStart && d.eld < qEndEx;
                  // Quarterly cell = the OFFICIAL attainment number: New Business only, counted on
                  // Effective_Live_Date. Yearly cell = the annual tab: every record type, counted
                  // on the raw Contract Live Date. Same-looking columns, deliberately different
                  // scopes — so each side filters the way its own source does.
                  const mine = data.closedWonFeed.filter((d) => d.owner === cwDrill.owner);
                  const rows = cwDrill.scope === "q"
                    ? mine.filter((d) => d.rt === "NB" && inQ(d))
                    : mine.filter((d) => d.cld.startsWith(yr));
                  // What the official quarterly filter leaves out, so a $0 cell can be read as
                  // "nothing counted" rather than "nothing happened".
                  const excluded = cwDrill.scope === "q"
                    ? mine.filter((d) => d.rt !== "NB" && inQ(d))
                    : [];
                  const exclTotal = excluded.reduce((t, d) => t + d.arr, 0);
                  cwSpec = {
                    title: `closed-won-${cwDrill.label}-${cwDrill.scope}`,
                    chips: [cwDrill.label,
                      cwDrill.scope === "q" ? `${Q.key} · New Business only` : `FY${yr.slice(2)} · all record types`,
                      cwDrill.scope === "q" ? "by effective live date" : "by contract live date"],
                    note: (total) => {
                      const tie = Math.abs(total - cwDrill.cell) > 1
                        ? `Heads up: the cell reads ${fmt(cwDrill.cell)} but these deals sum to ${fmt(total)} (Δ ${fmt(Math.abs(total - cwDrill.cell))}) — worth a look.`
                        : `Ties to the cell exactly (${fmt(cwDrill.cell)}).`;
                      const note2 = excluded.length
                        ? ` Excluded from this column: ${excluded.length} ${excluded.length === 1 ? "deal" : "deals"} worth ${fmt(exclTotal)} that closed in ${Q.key} but ${excluded.length === 1 ? "is not" : "are not"} New Business — the official attainment filter counts New Business only, so ${excluded.length === 1 ? "it does" : "they do"} not appear in Closed Won.`
                        : "";
                      return tie + note2;
                    },
                    rows,
                    amount: (d) => d.arr,
                    amountLabel: "ARR",
                    emptyHint: excluded.length
                      ? "No New Business closed in this quarter — see the note above for what did close."
                      : "Nothing closed for this AE in this period.",
                    cols: [
                      { label: "Deal", l: true, csv: (d) => d.name, render: (d) => d.name },
                      { label: "Type", l: true, csv: (d) => d.rtRaw,
                        render: (d) => <Pill tone={d.rt === "NB" ? undefined : d.rt === "EXP" ? "blue" : "warn"}>{d.rtRaw.replace(/^\d+\.\s*/, "") || "—"}</Pill> },
                      { label: "Stage", l: true, csv: (d) => d.stage, render: (d) => d.stage },
                      { label: "Status", l: true, csv: (d) => d.status, render: (d) => d.status || "—" },
                      { label: "Effective live", l: true, csv: (d) => d.eld, render: (d) => d.eld || "—" },
                      { label: "Contract live", l: true, csv: (d) => d.cld,
                        render: (d) => <span style={{ color: d.cld && d.eld && d.cld !== d.eld ? C.ylw : C.t1 }}>{d.cld || "—"}</span> },
                      { label: "ARR", mono: true, bold: true, csv: (d) => d.arr, render: (d) => fmt(d.arr) },
                    ],
                  };
                }
                if (cwDrill) return <DrillPanel spec={cwSpec} onClear={() => setCwDrill(null)} />;
                return <DrillPanel spec={spec} onClear={() => setFDrill(null)} />;
              })()}
            </div>
            <div style={{ fontSize: 11.5, color: C.t3, marginTop: 10 }}>
              Tip: every number on a row opens the deals behind it — <b>Open Pipeline</b>, <b>Pot. Early</b>, <b>Pot. Late</b>,
              and <b>Closed Won</b> / <b>YTD</b>. Closed Won counts <b>New Business only</b>, on each deal&rsquo;s effective live date;
              the yearly YTD column counts <b>every record type</b> on the contract live date. Click either to see exactly what is in it.
            </div>
          </Card>

          {/* Bookings vs Arrivals — Sai's cash-flow lens (signed date vs live date) */}
          {data.signedLive && (() => {
            const SL = data.signedLive;
            const rowsSL = roster.filter((r) => !r.lead || (SL.byOwner[r.name] && (SL.byOwner[r.name].signed > 0 || SL.byOwner[r.name].live > 0)));
            return (
              <Card
                title={`Bookings vs Arrivals — ${Q.label}`}
                sub="Per AE, cash-flow lens. Booked = ARR signed this quarter (by Contract Signed date). Arriving = ARR going live this quarter (by Contract Live date). Signed-not-live = booked this quarter but goes live later — the timing gap that shifts when cash actually arrives."
                accent={C.navy}
              >
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>AE</Th><Th>Booked (signed in {Q.key})</Th><Th>Arriving (live in {Q.key})</Th><Th>Signed, not yet live</Th>
                    </tr></thead>
                    <tbody>
                      {rowsSL.map((r) => {
                        const s = SL.byOwner[r.name] ?? { signed: 0, live: 0, signedNotLive: 0 };
                        return (
                          <tr key={r.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                            <Td l bold>{r.short ?? short(r.name)}{r.am && <span style={{ color: C.t3, fontWeight: 400, fontSize: 11 }}> · AM</span>}{r.lead && <span style={{ color: C.t3, fontWeight: 400, fontSize: 11 }}> · Ent</span>}</Td>
                            <Td mono color={s.signed > 0 ? C.coralDk : C.t1}>{fmt(s.signed)}</Td>
                            <Td mono color={s.live > 0 ? C.grn : C.t1}>{fmt(s.live)}</Td>
                            <Td mono color={s.signedNotLive > 0 ? C.ylw : C.t3}>{s.signedNotLive > 0 ? fmt(s.signedNotLive) : "—"}</Td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: `2px solid ${C.navy}`, background: C.s2, fontWeight: 700 }}>
                        <Td l bold>Team</Td>
                        <Td mono bold color={C.coralDk}>{fmt(SL.total.signed)}</Td>
                        <Td mono bold color={C.grn}>{fmt(SL.total.live)}</Td>
                        <Td mono bold color={C.ylw}>{SL.total.signedNotLive > 0 ? fmt(SL.total.signedNotLive) : "—"}</Td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })()}


          {/* remainder of quarter */}
          <Card title={`Remainder of ${Q.label} — ${F.daysLeft} days, ${F.weeksLeft} week${F.weeksLeft === 1 ? "" : "s"} left`} sub="What still has to close to reach quota, the weekly run-rate that implies, and where Potential ARR projects the quarter to land." accent={C.coral}>
            <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <div>
                <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Still to close (to quota)</div>
                <div style={{ fontSize: 23, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: remGap > 0 ? C.coralDk : C.grn }}>{remGap > 0 ? fmt(remGap) : "met"}</div>
                <div style={{ fontSize: 12, color: C.t2 }}>{fmt(totalCW)} of {fmt(totalQuota)} quota closed</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>ARR needed / week left</div>
                <div style={{ fontSize: 23, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.navy }}>{remGap > 0 ? fmt(remPerWeek) : "\u2014"}</div>
                <div style={{ fontSize: 12, color: C.t2 }}>across {F.weeksLeft} week{F.weeksLeft === 1 ? "" : "s"} remaining</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Quarter landing (Potential ARR)</div>
                <div style={{ fontSize: 23, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: totalPot >= totalQuota ? C.grn : C.coralDk }}>{fmt(totalPot)}</div>
                <div style={{ fontSize: 12, color: C.t2 }}>{pct(potVsQuota)} of quota · CW + open potential</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Surplus / shortfall vs quota</div>
                <div style={{ fontSize: 23, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: totalPot >= totalQuota ? C.grn : C.red }}>{totalPot >= totalQuota ? "+" + fmt(totalPot - totalQuota) : fmt(totalPot - totalQuota)}</div>
                <div style={{ fontSize: 12, color: C.t2 }}>if open potential lands as forecast</div>
              </div>
            </div>
          </Card>

          {/* deals that decide */}
          <Card title={`Deals that decide ${Q.label}`} sub={`Open SQL/SAL/SQO deals ranked by quarterly Potential ARR${decideAE === "all" ? "" : " · " + decideAE}. Top ${decideView.length} · ${fmt(decideView.reduce((s, d) => s + d.potARR, 0))} potential in view.`} accent={C.coral}>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                {decideStages.map((o) => (
                  <button key={o} onClick={() => setDecideAE(o)} style={{ padding: "5px 13px", fontSize: 12, fontWeight: 600, borderRadius: 20, border: `1px solid ${o === decideAE ? C.coral : C.bd}`, background: o === decideAE ? C.coralSoft : "#fff", color: o === decideAE ? C.coralDk : C.t2, cursor: "pointer" }}>
                    {o === "all" ? "All stages" : o}
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
                      <Th l>Deal</Th><Th l>AE</Th><Th l>Stage</Th><Th>Age</Th><Th>ARR</Th><Th>Pot. ARR (Q)</Th><Th>Call</Th>
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
                        <Td mono bold color={C.navy}>{fmt(d.potARR)}</Td>
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
            const maxV = Math.max(F.annualTarget, projEnd) * 1.05;
            const yPx = (v: number) => (v / maxV) * PLOT;
            type Step = { label: string; type: "base" | "inc" | "gap" | "target"; value: number; of?: string; from?: number };
            const steps: Step[] = [
              { label: "Live ARR today", type: "base", value: projBase },
              { label: "Potential (Early + Late)", type: "inc", value: projPot, of: `${pct(potVsQuota)} of quota` },
              { label: "Gap to target", type: "gap", value: Math.max(0, projGap), from: projEnd },
              { label: "FY26 target", type: "target", value: F.annualTarget },
            ];
            const n = steps.length;
            let running = 0;
            return (
              <Card title="Year-end projection vs annual target" sub="End-of-Q2 live ARR plus Q3 Potential ARR (from the Quarter Forecast), versus the FY26 ending-ARR target." accent={C.navy}>
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
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Live ARR today</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)" }}>{fk(projBase)}</div></div>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Potential</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.blue }}>{fk(projPot)}</div><div style={{ fontSize: 10.5, color: C.t3 }}>Early {fk(projEarly)} + Late {fk(projLate)}</div></div>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Expected {projPeriod}</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.coralDk }}>{fk(projEnd)}</div></div>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Annual Target</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)" }}>{fk(F.annualTarget)}</div></div>
                    <div><div style={{ fontSize: 11, color: C.t3 }}>Gap</div><div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: projGap > 0 ? C.red : C.grn }}>{fk(projGap)}</div></div>
                  </div>

                  <div style={{ background: "#FAEEDA", borderRadius: 12, padding: "14px 16px", marginTop: 16, fontSize: 13.5, color: "#6b5320", lineHeight: 1.55 }}>
                    {projGap > 0 ? (
                      <>Expected {projPeriod.toLowerCase()} of <b>{fk(projEnd)}</b> (Live ARR {fk(projBase)} + {fk(projPot)} potential, Early {fk(projEarly)} and Late {fk(projLate)}) is <b style={{ color: C.coralDk }}>{fk(projGap)}</b> short of the <b>{fk(F.annualTarget)}</b> target.</>
                    ) : (
                      <>Expected {projPeriod.toLowerCase()} of <b>{fk(projEnd)}</b> is on track to meet or exceed the <b>{fk(F.annualTarget)}</b> target.</>
                    )}
                  </div>
                </div>
              </Card>
            );
          })()}
        </div>
        );
      })()}

      {tab === "cashflow" && (() => {
        const short = (s: string) => (s || "").split(" ")[0];
        return (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
            {/* ARR Funnel — Pilot (in trial) → Contracted (signed, not paying) → Billed (paying), MoM.
                Contracted + Billed = Live ARR, the Command tab's headline figure. */}
            {data.arrFunnel && data.arrFunnel.stock.length > 0 && (() => {
              const AF = data.arrFunnel;
              const series = AF.stock;
              const cur = series[series.length - 1] ?? { booked: 0, contracted: 0, live: 0, liveArr: 0 };
              const maxV = Math.max(1, ...series.map((p) => Math.max(p.booked, p.contracted, p.live, p.liveArr)));
              const W = 920, H = 240, padL = 58, padR = 16, padT = 16, padB = 30;
              const iw = W - padL - padR, ih = H - padT - padB;
              const xx = (i: number) => padL + (series.length <= 1 ? iw / 2 : (i / (series.length - 1)) * iw);
              const yy = (v: number) => padT + ih - (v / (maxV * 1.08)) * ih;
              const LINES = [
                { key: "booked" as const, label: "Pilot (in trial)", color: C.gold },
                { key: "contracted" as const, label: "Contracted (signed, not paying)", color: C.blue },
                { key: "live" as const, label: "Billed (paying)", color: C.grn },
                { key: "liveArr" as const, label: "Live ARR (Contracted + Billed)", color: C.navy },
              ];
              type LineKey = "booked" | "contracted" | "live" | "liveArr";
              const path = (key: LineKey) => series.map((p, i) => `${i === 0 ? "M" : "L"}${xx(i).toFixed(1)} ${yy(p[key]).toFixed(1)}`).join(" ");
              const every = Math.ceil(series.length / 12) || 1;
              const ticks = [0, 0.5, 1].map((f) => f * maxV * 1.08);
              const kM = (n: number) => (Math.abs(n) >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : "$" + Math.round(n / 1e3) + "k");
              // The two blocks of the matrix. `bucket` is the deal-set key the drill-down uses,
              // so every cell stays clickable; `total` marks the line the block adds up to.
              type FRow = { bucket: string; label: string; color: string; get: (p: typeof series[number]) => number;
                sign?: string; total?: boolean;
                // `parent` makes this a child row: it hides unless its parent is expanded.
                parent?: string; hint?: string;
                // A cross-cut sits under a parent but is NOT part of its sum — mark it so.
                cross?: boolean };
              const FUNNEL_SECTIONS: { title: string; sub: string; rows: FRow[] }[] = [
                {
                  title: "ARR",
                  sub: "Contracted + Billed = Live ARR",
                  rows: [
                    { bucket: "contracted", label: "Contracted", color: C.blue, get: (p) => p.contracted,
                      hint: "Awaiting Billing — signed and contract-live, but payment has not started yet" },
                    { bucket: "contractedRenewal", label: "Contracted Renewal", color: C.t2, get: (p) => p.contractedRenewal,
                      parent: "contracted", hint: "The renewal share of Contracted" },
                    { bucket: "contractedNewExp", label: "Contracted Expansion", color: C.t2, get: (p) => p.contractedNewExp,
                      parent: "contracted", hint: "The rest of Contracted — new business and expansion, i.e. everything that is not a renewal" },
                    { bucket: "contractedRR", label: "Contracted — Rip & Replace", color: C.ylw, get: (p) => p.contractedRR,
                      parent: "contracted", cross: true,
                      hint: "A cross-cut, not a third slice: these deals are ALREADY counted in Renewal or Expansion above. Broken out because a rip & replace changeover is the usual reason a deal is contracted but not yet billing." },
                    { bucket: "live", label: "Billed", color: C.grn, get: (p) => p.live },
                    { bucket: "liveArr", label: "Live ARR", color: C.navy, get: (p) => p.liveArr, total: true },
                  ],
                },
                {
                  title: "Pilot, and what moves",
                  sub: "Live ARR + Pilot = Booked ARR",
                  rows: [
                    { bucket: "booked", label: "Pilot", color: C.gold, get: (p) => p.booked },
                    { bucket: "bToLost", label: "Pilot → Lost", color: C.red, get: (p) => p.bToLost, sign: "−",
                      parent: "booked", hint: "Pilots that went Closed Lost this month" },
                    { bucket: "bToC", label: "Pilot → Contracted", color: C.blue, get: (p) => p.bToC, sign: "+",
                      parent: "booked", hint: "Pilots that signed and went contract-live this month" },
                    { bucket: "cToL", label: "Contracted → Billed", color: C.grn, get: (p) => p.cToL, sign: "+" },
                    { bucket: "churn", label: "Churn", color: C.red, get: (p) => p.churn, sign: "−" },
                    { bucket: "bookedPilot", label: "Booked ARR", color: C.gold, get: (p) => p.bookedPilot, total: true,
                      hint: "Live ARR + Pilot — the widest view. Note: before 27 Aug 2026 \"Booked ARR\" meant the pilot book alone, which is now just Pilot." },
                  ],
                },
              ];
              return (
                <Card
                  title="ARR Funnel — Pilot → Contracted → Billed (MoM · Jan-26 → now)"
                  sub="Point-in-time ARR in each tier at month-end. Pilot = in trial. Contracted = signed and contract-live but payment has not started (R&R / billing timing). Billed = paying. Live ARR = Contracted + Billed, the whole signed contract-live book and the figure the Command tab headline reports. Booked ARR = Live ARR + Pilot. Churn excluded throughout."
                  accent={C.navy}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "14px 20px 2px" }}>
                    <div style={{ display: "flex", gap: 16, marginLeft: "auto", flexWrap: "wrap" }}>
                      {LINES.map((l) => (
                        <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.t2 }}>
                          <span style={{ width: 12, height: 3, background: l.color, borderRadius: 2 }} />{l.label} <b style={{ color: l.color, fontFamily: "var(--font-dm-mono)" }}>{fmt(cur[l.key])}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: "6px 12px 4px", overflowX: "auto" }}>
                    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }}>
                      {ticks.map((t, i) => (
                        <g key={i}>
                          <line x1={padL} y1={yy(t)} x2={W - padR} y2={yy(t)} stroke={C.s1} strokeWidth={1} />
                          <text x={padL - 8} y={yy(t) + 4} textAnchor="end" fontSize={11} fill={C.t3} fontFamily="var(--font-dm-mono)">{kM(t)}</text>
                        </g>
                      ))}
                      {series.map((p, i) => i % every === 0 ? (
                        <text key={i} x={xx(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={C.t3}>{p.label}</text>
                      ) : null)}
                      {LINES.map((l) => <path key={l.key} d={path(l.key)} fill="none" stroke={l.color} strokeWidth={2.5} strokeLinejoin="round" />)}
                      {LINES.map((l) => <circle key={l.key} cx={xx(series.length - 1)} cy={yy(cur[l.key])} r={3.5} fill={l.color} />)}
                    </svg>
                  </div>
                  {/* Months run ACROSS; the metrics run DOWN in two blocks — the ARR that adds
                      up to Live ARR, then the pilot book and the movements that feed it, ending
                      at Booked ARR. Every cell still opens its deals. */}
                  <div style={{ overflowX: "auto", padding: "4px 20px 18px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                          <th style={{ textAlign: "left", padding: "8px 16px 8px 0", minWidth: 178 }} />
                          {series.map((p, i) => (
                            <Th key={p.ym}>{i === series.length - 1 ? <b>{p.label}</b> : p.label}</Th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {FUNNEL_SECTIONS.map((sec) => (
                          <Fragment key={sec.title}>
                            <tr>
                              <td colSpan={series.length + 1} style={{ padding: "14px 16px 5px 0", borderBottom: `1px solid ${C.s1}` }}>
                                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.t3 }}>{sec.title}</span>
                                <span style={{ fontSize: 11.5, color: C.t3, marginLeft: 10 }}>{sec.sub}</span>
                              </td>
                            </tr>
                            {sec.rows.filter((row) => !row.parent || funnelOpen[row.parent]).map((row) => {
                              const hasKids = sec.rows.some((r) => r.parent === row.bucket);
                              const open = !!funnelOpen[row.bucket];
                              return (
                              <tr key={row.bucket} style={{ borderBottom: `1px solid ${C.s1}`, background: row.total ? C.s2 : undefined }}>
                                <td style={{ textAlign: "left", padding: "10px 16px 10px 0",
                                  paddingLeft: row.parent ? 22 : 0, whiteSpace: "nowrap" }}>
                                  <span title={row.hint}
                                    onClick={hasKids ? () => setFunnelOpen((o) => ({ ...o, [row.bucket]: !open })) : undefined}
                                    style={{ color: row.color, fontSize: 13,
                                      fontWeight: row.total ? 700 : row.parent ? 400 : 600,
                                      cursor: hasKids ? "pointer" : row.hint ? "help" : undefined,
                                      textDecoration: row.hint && !hasKids ? "underline dotted" : undefined,
                                      textDecorationColor: C.bd, textUnderlineOffset: "3px" }}>
                                    {hasKids
                                      ? <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                                          width: 18, height: 18, marginRight: 8, borderRadius: 4, fontSize: 10, lineHeight: 1,
                                          border: `1px solid ${open ? row.color : C.bd}`,
                                          background: open ? row.color : "transparent",
                                          color: open ? "#fff" : row.color, verticalAlign: "middle" }}>
                                          {open ? "▾" : "▸"}
                                        </span>
                                      : null}
                                    {row.label}
                                    {row.cross && (
                                      <span style={{ marginLeft: 7, fontSize: 9.5, fontWeight: 700, color: C.t3,
                                        border: `1px solid ${C.bd}`, borderRadius: 3, padding: "1px 5px", letterSpacing: ".03em" }}>
                                        OVERLAPS
                                      </span>
                                    )}
                                    {hasKids && (
                                      <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: C.t3,
                                        letterSpacing: ".03em", textTransform: "uppercase" }}>
                                        {open ? "hide split" : "show split"}
                                      </span>
                                    )}
                                  </span>
                                </td>
                                {series.map((p) => {
                                  const v = row.get(p);
                                  return (
                                    <Td key={p.ym} mono bold={!!row.total} color={v > 0 ? row.color : C.t3}>
                                      {v > 0
                                        ? <span style={drillable} title={`Click to see the ${row.label} deals for ${p.label}`}
                                            onClick={() => setAfDrill({ ym: p.ym, label: p.label, bucket: row.bucket, col: row.label, cell: v })}>
                                            {(row.sign ?? "") + fmt(v)}
                                          </span>
                                        : "—"}
                                    </Td>
                                  );
                                })}
                              </tr>
                              );
                            })}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Deals behind whichever funnel cell was clicked. Sits directly under the table
                      so the number and its evidence read together. */}
                  <div style={{ padding: "0 20px 14px" }}>
                    {(() => {
                      let spec: DrillSpec<NonNullable<typeof data.arrFunnel>["dealIndex"][number]> | null = null;
                      if (afDrill) {
                        const pt = AF.stock.find((x) => x.ym === afDrill.ym);
                        const idx = pt?.ids?.[afDrill.bucket] ?? [];
                        const rows = idx.map((n) => AF.dealIndex[n]).filter(Boolean).sort((a, b) => b.arr - a.arr);
                        const isFlow = /^(bTo|cTo|cNew|cLeak|lNew|lChurn|bNew|bDrop)/.test(afDrill.bucket);
                        const isRollup = afDrill.bucket === "liveArr" || afDrill.bucket === "bookedPilot";
                        spec = {
                          title: `arr-funnel-${afDrill.ym}-${afDrill.bucket}`,
                          chips: [afDrill.label, afDrill.col,
                            isFlow ? "moved this month" : isRollup ? "every deal in the roll-up, at month-end" : "in this tier at month-end"],
                          note: (total) => Math.abs(total - afDrill.cell) > 1
                            ? `The cell reads ${fmt(afDrill.cell)} but these deals sum to ${fmt(total)} — worth a look.`
                            : `Ties to the cell exactly (${fmt(afDrill.cell)}).`,
                          rows,
                          amount: (d) => d.arr,
                          amountLabel: "ARR",
                          emptyHint: "No deals in this bucket for this month.",
                          cols: [
                            { label: "Deal", l: true, csv: (d) => d.opp || d.account,
                              render: (d) => <>{d.opp || d.account}{d.rr && <span style={{ marginLeft: 6, background: C.ylwBg, color: C.ylw, padding: "1px 7px", borderRadius: 20, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>R&amp;R</span>}</> },
                            { label: "Account", l: true, csv: (d) => d.account, render: (d) => d.account || "—" },
                            { label: "AE", l: true, csv: (d) => d.owner, render: (d) => d.owner || "—" },
                            { label: "AM", l: true, csv: (d) => d.am, render: (d) => d.am || "—" },
                            { label: "Type", l: true, csv: (d) => d.type,
                              render: (d) => d.type ? <Pill tone={/Renewal/i.test(d.type) ? "warn" : /Expansion/i.test(d.type) ? "blue" : undefined}>{d.type.replace(/^\d+\.\s*/, "")}</Pill> : "—" },
                            { label: "Stage", l: true, csv: (d) => d.stage, render: (d) => d.stage || "—" },
                            { label: "Trial", l: true, csv: (d) => d.trial, render: (d) => d.trial || "—" },
                            { label: "Contract live", l: true, csv: (d) => d.liveDate, render: (d) => d.liveDate || "—" },
                            { label: "Live paying", l: true, csv: (d) => d.livePay, render: (d) => d.livePay || "—" },
                            { label: "Ends", l: true, csv: (d) => d.end, render: (d) => d.end || "—" },
                            { label: "ARR", mono: true, bold: true, csv: (d) => d.arr, render: (d) => fmt(d.arr) },
                          ],
                        };
                      }
                      return <DrillPanel spec={spec} onClear={() => setAfDrill(null)} />;
                    })()}
                  </div>
                </Card>
              );
            })()}
            <div style={{ height: 16 }} />
            {/* Funnel Movement — MoM reconciliation: every tier level = last month + ins − outs */}
            {data.arrFunnel && data.arrFunnel.stock.length > 1 && (() => {
              const s = data.arrFunnel.stock;
              const rows = s.slice(1); // each row reconciles this month vs the prior
              const flowD = (n: number, sign: string) => (n > 0 ? sign + fmt(n) : "—");
              return (
                <Card
                  title="Funnel Movement — how each tier's level reconciles (MoM)"
                  sub="Each tier's level = last month + what came in − what went out; every row ties out exactly. Pilot: 'Rolled back' = a pilot reverted from Trial to SQO/SAL/SQL (fell out of pilot without converting). Contracted can fall even while deals start being billed, because newly-signed deals enter Contracted directly (never a tracked pilot)."
                >
                  <div style={{ padding: "8px 20px 2px", fontSize: 12.5, fontWeight: 700, color: C.gold }}>Pilot (in trial)</div>
                  <div style={{ overflowX: "auto", padding: "2px 20px 10px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                        <Th l>Month</Th><Th>Open</Th><Th>+ New pilots</Th><Th>− To Contracted</Th><Th>→ Billed (direct)</Th><Th>− Lost</Th><Th>− Rolled back</Th><Th>Close</Th>
                      </tr></thead>
                      <tbody>
                        {rows.map((p, i) => (
                          <tr key={p.ym} style={{ borderBottom: `1px solid ${C.s1}`, background: i === rows.length - 1 ? C.s2 : undefined }}>
                            <Td l bold>{p.label}</Td>
                            <Td mono color={C.t2}>{fmt(s[i].booked)}</Td>
                            <Td mono color={p.bNew > 0 ? C.grn : C.t3}>{flowD(p.bNew, "+")}</Td>
                            <Td mono color={p.bToC > 0 ? C.blue : C.t3}>{flowD(p.bToC, "−")}</Td>
                            <Td mono color={p.bToLive > 0 ? C.grn : C.t3}>{flowD(p.bToLive, "−")}</Td>
                            <Td mono color={p.bToLost > 0 ? C.red : C.t3}>{flowD(p.bToLost, "−")}</Td>
                            <Td mono color={p.bDrop > 0 ? C.red : C.t3}>{flowD(p.bDrop, "−")}</Td>
                            <Td mono bold color={C.gold}>{fmt(p.booked)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "8px 20px 2px", fontSize: 12.5, fontWeight: 700, color: C.blue }}>Contracted (signed, not yet paying)</div>
                  <div style={{ overflowX: "auto", padding: "2px 20px 10px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                        <Th l>Month</Th><Th>Open</Th><Th>+ New signed</Th><Th>+ From Pilot</Th><Th>− To Billed</Th><Th>− Lost/Churn</Th><Th>Close</Th>
                      </tr></thead>
                      <tbody>
                        {rows.map((p, i) => (
                          <tr key={p.ym} style={{ borderBottom: `1px solid ${C.s1}`, background: i === rows.length - 1 ? C.s2 : undefined }}>
                            <Td l bold>{p.label}</Td>
                            <Td mono color={C.t2}>{fmt(s[i].contracted)}</Td>
                            <Td mono color={p.cNewSigned > 0 ? C.grn : C.t3}>{flowD(p.cNewSigned, "+")}</Td>
                            <Td mono color={p.bToC > 0 ? C.grn : C.t3}>{flowD(p.bToC, "+")}</Td>
                            <Td mono color={p.cToL > 0 ? C.red : C.t3}>{flowD(p.cToL, "−")}</Td>
                            <Td mono color={p.cLeak > 0 ? C.red : C.t3}>{flowD(p.cLeak, "−")}</Td>
                            <Td mono bold color={C.blue}>{fmt(p.contracted)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "6px 20px 2px", fontSize: 12.5, fontWeight: 700, color: C.grn }}>Billed (paying)</div>
                  <div style={{ overflowX: "auto", padding: "2px 20px 16px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                        <Th l>Month</Th><Th>Open</Th><Th>+ From Contracted</Th><Th>+ New direct</Th><Th>− Churn / ended</Th><Th>Close</Th>
                      </tr></thead>
                      <tbody>
                        {rows.map((p, i) => (
                          <tr key={p.ym} style={{ borderBottom: `1px solid ${C.s1}`, background: i === rows.length - 1 ? C.s2 : undefined }}>
                            <Td l bold>{p.label}</Td>
                            <Td mono color={C.t2}>{fmt(s[i].live)}</Td>
                            <Td mono color={p.cToL > 0 ? C.grn : C.t3}>{flowD(p.cToL, "+")}</Td>
                            <Td mono color={p.lNewDirect > 0 ? C.grn : C.t3}>{flowD(p.lNewDirect, "+")}</Td>
                            <Td mono color={p.lChurn > 0 ? C.red : C.t3}>{flowD(p.lChurn, "−")}</Td>
                            <Td mono bold color={C.grn}>{fmt(p.live)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })()}
            <div style={{ height: 16 }} />
            {/* Forward ARR forecast — cumulative standing ARR per tier at each month-end (NOT cash; the cash model is the "Cash timing" card below). Tiers are Pilot / Contracted / Billed. */}
            {data.predictedCashflow && data.predictedCashflow.months.length > 0 && (() => {
              const pc = data.predictedCashflow;
              const curYm = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
              const tier: "contracted" | "live" = cashTier === "live" ? "live" : "contracted";
              const meta = {
                contracted: { label: "Contracted", color: C.blue, base: pc.baseline.contracted, sub: "+ pilots converting in (Trial End + 15d)" },
                live: { label: "Billed", color: C.grn, base: pc.baseline.live, sub: "+ contracted deals starting to be billed (Contract-Live + 45d)" },
              } as const;
              const active = meta[tier];
              const endpoint = pc.months.length ? pc.months[pc.months.length - 1][tier] : active.base;
              const cumPts = pc.months.map((m) => ({ label: m.label, value: m[tier], forecast: m.ym > curYm }));
              const tierDeals = pc.deals.filter((d) => d.tier === tier);
              // The table shows every arrival by default, or just one month once a month chip is picked.
              const shownDeals = pcDrill ? tierDeals.filter((d) => d.arriveYm === pcDrill.ym) : tierDeals;
              return (
                <Card
                  title="Forward ARR forecast"
                  sub="Cumulative standing ARR per tier at each month-end — not cash collected, and not per-month increments. Contracted grows as pilots convert (Trial End + 15d nego); Billed grows as contracted deals start paying (Contract-Live date + 45d billing). Pilot is context only — too early to forecast."
                >
                  {/* IN PROGRESS banner — methodology (CLD+45, pilot-end dates) still being validated */}
                  <div style={{ margin: "10px 20px 0", padding: "8px 12px", background: C.ylwBg, border: `1px solid ${C.ylw}`, borderRadius: 8, fontSize: 12, color: C.t2, fontWeight: 600 }}>
                    ⚠️ IN PROGRESS — methodology still being validated (CLD + 45d cash assumption is under review with finance; pilot-end dates populate on the nightly refresh). Numbers here are provisional.
                  </div>
                  {/* Snapshot — the three tiers standing right now */}
                  <div style={{ padding: "12px 20px 4px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: C.t3, marginBottom: 6 }}>
                      Snapshot — as of {new Date().toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                      <div style={{ background: C.s2, border: `1px solid ${C.bd}`, borderRadius: 10, padding: "12px 14px", opacity: 0.75 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.gold }}>Pilot ARR <span style={{ color: C.t3, fontWeight: 400 }}>· all pilots</span></div>
                        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: C.t1, marginTop: 3 }}>{fmt(data.bookedTotal ?? pc.booked)}</div>
                      </div>
                      {(["contracted", "live"] as const).map((k) => (
                        <div key={k} onClick={() => setCashTier(k)} style={{ cursor: "pointer", background: C.s2, border: `1px solid ${tier === k ? meta[k].color : C.bd}`, borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: meta[k].color }}>{meta[k].label} ARR</div>
                          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: C.t1, marginTop: 3 }}>{fmt(meta[k].base)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Toggle — Contracted vs Billed forecast */}
                  <div style={{ padding: "8px 20px 4px", display: "flex", gap: 8 }}>
                    {(["contracted", "live"] as const).map((k) => (
                      <button key={k} onClick={() => setCashTier(k)}
                        style={{ cursor: "pointer", border: `1px solid ${tier === k ? meta[k].color : C.bd}`, background: tier === k ? meta[k].color : "transparent", color: tier === k ? "#fff" : C.t2, borderRadius: 10, padding: "7px 14px", fontSize: 12.5, fontWeight: 700 }}>
                        {meta[k].label} forecast
                      </button>
                    ))}
                  </div>
                  <div style={{ padding: "6px 20px 4px", fontSize: 12.5, fontWeight: 700, color: active.color }}>
                    {active.label} ARR — {fmt(active.base)} now → <span style={{ fontFamily: "var(--font-dm-mono)" }}>{fmt(endpoint)}</span> projected · {active.sub}
                  </div>
                  <div style={{ padding: "0 12px 8px" }}>
                    <ArrMovementChart points={cumPts} actualLabel={`${active.label} ARR now`} forecastLabel="Forecast" />
                  </div>
                  {/* Per-month arrivals — click a month to see only the deals landing in it. */}
                  <div style={{ padding: "2px 20px 0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: C.t3, marginBottom: 6 }}>
                      Arrivals by month — click one to filter
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                      {pc.months.map((m) => {
                        const n = tierDeals.filter((d) => d.arriveYm === m.ym).length;
                        const sum = tierDeals.filter((d) => d.arriveYm === m.ym).reduce((t, d) => t + d.arr, 0);
                        const on = pcDrill?.ym === m.ym;
                        return (
                          <button key={m.ym} disabled={!n}
                            onClick={() => setPcDrill(on ? null : { ym: m.ym, label: m.label })}
                            title={n ? `${n} deal${n === 1 ? "" : "s"} · ${fmt(sum)}` : "no arrivals this month"}
                            style={{ cursor: n ? "pointer" : "default", border: `1px solid ${on ? active.color : C.bd}`,
                              background: on ? active.color : n ? "#fff" : C.s2, color: on ? "#fff" : n ? C.t1 : C.t3,
                              borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}>
                            {m.label}{n ? ` · ${n}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Deal-level detail — the deals converting into the selected tier */}
                  <div style={{ padding: "2px 20px 18px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, margin: "6px 0 8px" }}>
                      {tier === "contracted" ? "Pilots converting to Contracted" : "Contracted deals starting to be billed"}
                      {pcDrill ? <> in <span style={{ color: active.color }}>{pcDrill.label}</span></> : null} — {shownDeals.length} deals · <span style={{ color: active.color, fontFamily: "var(--font-dm-mono)" }}>{fmt(shownDeals.reduce((s, d) => s + d.arr, 0))}</span>
                      {pcDrill && <button onClick={() => setPcDrill(null)} style={{ marginLeft: 10, padding: "3px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 7, border: `1px solid ${C.bd}`, background: "#fff", color: C.t2, cursor: "pointer" }}>✕ all months</button>}
                    </div>
                    <div style={{ overflowX: "auto", border: `1px solid ${C.s1}`, borderRadius: 10, maxHeight: 320, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead><tr style={{ borderBottom: `1px solid ${C.bd}`, position: "sticky", top: 0, background: C.s2 }}>
                          <Th l>Deal</Th><Th l>Account</Th><Th l>AE</Th><Th>ARR</Th><Th l>Arrives</Th><Th l>Basis</Th>
                        </tr></thead>
                        <tbody>
                          {shownDeals.map((d, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${C.s1}` }}>
                              <Td l bold>{d.opp || d.account || "—"}</Td>
                              <Td l>{d.account || "—"}</Td>
                              <Td l>{d.owner || "—"}</Td>
                              <Td mono bold color={active.color}>{fmt(d.arr)}</Td>
                              <Td l mono>{d.arriveYm || "—"}</Td>
                              <Td l>{d.basis}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Card>
              );
            })()}
            <div style={{ height: 16 }} />
          {/* Cash timing — forecast cash-in (Contract Live Date + 45 days), Standard vs Rip&Replace */}
          {data.cashForecast && data.cashForecast.events.length > 0 && (() => {
            const CF = data.cashForecast;
            const evs = CF.events.filter((e) => cashAE === "all" || e.owner === cashAE);
            const now2 = new Date();
            const base2 = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth(), 1));
            const cfMonths: { ym: string; label: string }[] = [];
            for (let i = -2; i <= 9; i++) { const d = new Date(Date.UTC(base2.getUTCFullYear(), base2.getUTCMonth() + i, 1)); cfMonths.push({ ym: d.toISOString().slice(0, 7), label: d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) }); }
            const winSet = new Set(cfMonths.map((m) => m.ym));
            const std: Record<string, number> = {}, rr: Record<string, number> = {};
            cfMonths.forEach((m) => { std[m.ym] = 0; rr[m.ym] = 0; });
            let overdue = 0;
            for (const e of evs) { if (!winSet.has(e.ym)) { overdue += e.arr; continue; } (e.kind === "rr" ? rr : std)[e.ym] += e.arr; }
            const nowYm2 = base2.toISOString().slice(0, 7);
            const pts = cfMonths.map((m) => ({ label: m.label, value: std[m.ym] + rr[m.ym], forecast: m.ym >= nowYm2 }));
            const totStd = cfMonths.reduce((s, m) => s + std[m.ym], 0), totRR = cfMonths.reduce((s, m) => s + rr[m.ym], 0);
            const cashAEs = ["all", ...CF.owners];
            return (
              <Card title="Cash timing — forecast cash-in (Contract Live Date + 45 days)" sub="Signed / committed but not-yet-paying deals (Stage Closed Won / Billing / Trial, no Live Paying Date). First payment 45 days after contract live date (R&R date + 45 for Rip & Replace), then split into installments by billing term — Monthly = ARR/12 monthly, Quarterly = ARR/4 quarterly, Annual = one payment. Already-paying deals sit in Live ARR, not here." accent={C.navy}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "14px 20px 4px" }}>
                  <select value={cashAE} onChange={(e) => setCashAE(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid " + C.bd, fontSize: 13, fontFamily: "inherit" }}>
                    {cashAEs.map((a) => <option key={a} value={a}>{a === "all" ? "All AEs" : short(a)}</option>)}
                  </select>
                  <span style={{ fontSize: 13, color: C.t2, marginLeft: "auto" }}>Standard <b style={{ color: C.navy }}>{fmt(totStd)}</b> · Rip&amp;Replace <b style={{ color: C.gold }}>{fmt(totRR)}</b>{overdue > 0 ? <> · overdue {fmt(overdue)}</> : null}</span>
                </div>
                <div style={{ padding: "10px 12px 4px" }}><ArrMovementChart points={pts} /></div>
                <div style={{ overflowX: "auto", padding: "4px 20px 18px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ borderBottom: "1px solid " + C.bd }}><Th l>Month</Th><Th>Standard (CLD+45)</Th><Th>Rip &amp; Replace</Th><Th>Total</Th></tr></thead>
                    <tbody>
                      {cfMonths.map((m) => (
                        <tr key={m.ym} style={{ borderBottom: "1px solid " + C.s1, background: m.ym >= nowYm2 ? C.s2 : undefined }}>
                          <Td l bold>{m.label}</Td>
                          <Td mono color={std[m.ym] > 0 ? C.navy : C.t3}>{std[m.ym] > 0
                            ? <span style={drillable} title="Click to see the payments" onClick={() => setCfDrill({ ym: m.ym, label: m.label, kind: "std" })}>{fmt(std[m.ym])}</span> : "—"}</Td>
                          <Td mono color={rr[m.ym] > 0 ? C.gold : C.t3}>{rr[m.ym] > 0
                            ? <span style={drillable} title="Click to see the payments" onClick={() => setCfDrill({ ym: m.ym, label: m.label, kind: "rr" })}>{fmt(rr[m.ym])}</span> : "—"}</Td>
                          <Td mono bold>{(std[m.ym] + rr[m.ym]) > 0
                            ? <span style={drillable} title="Click to see the payments" onClick={() => setCfDrill({ ym: m.ym, label: m.label, kind: "all" })}>{fmt(std[m.ym] + rr[m.ym])}</span> : "—"}</Td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: "2px solid " + C.navy, background: C.s2, fontWeight: 700 }}>
                        <Td l bold>Total</Td><Td mono bold color={C.navy}>{fmt(totStd)}</Td><Td mono bold color={C.gold}>{fmt(totRR)}</Td><Td mono bold>{fmt(totStd + totRR)}</Td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.bd}` }}>
                    {(() => {
                      let spec: DrillSpec<(typeof evs)[number]> | null = null;
                      if (cfDrill) {
                        const rows = evs
                          .filter((e) => e.ym === cfDrill.ym && (cfDrill.kind === "all" || e.kind === (cfDrill.kind === "rr" ? "rr" : "std")))
                          .sort((a, b) => b.arr - a.arr);
                        spec = {
                          title: `cash-in-${cfDrill.ym}-${cfDrill.kind}`,
                          chips: [cfDrill.label, cfDrill.kind === "std" ? "Standard (CLD+45)" : cfDrill.kind === "rr" ? "Rip & Replace" : "all", cashAE === "all" ? "All AEs" : short(cashAE)],
                          rows,
                          amount: (e) => e.arr,
                          amountLabel: "cash-in",
                          emptyHint: "No payments forecast in this month.",
                          cols: [
                            { label: "Deal", l: true, csv: (e) => e.name || "—", render: (e) => e.name || "—" },
                            { label: "AE", l: true, csv: (e) => e.owner || "—", render: (e) => short(e.owner) || "—" },
                            { label: "Basis", l: true, csv: (e) => (e.kind === "rr" ? "Rip & Replace" : "Standard (CLD+45)"),
                              render: (e) => <span style={{ color: e.kind === "rr" ? C.gold : C.navy, fontWeight: 600 }}>{e.kind === "rr" ? "Rip & Replace" : "Standard"}</span> },
                            { label: "Installment", mono: true, bold: true, csv: (e) => e.arr, render: (e) => fmt(e.arr) },
                          ],
                        };
                      }
                      return <DrillPanel spec={spec} onClear={() => setCfDrill(null)} />;
                    })()}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.t3, marginTop: 10 }}>
                    Tip: click any month&rsquo;s Standard / Rip&amp;Replace / Total to see the individual payments behind it. Amounts are <b>installments</b>, so one deal can appear in several months.
                  </div>
                </div>
              </Card>
            );
          })()}
        </div>
        );
      })()}

      {tab === "deals" && (() => {
        const all = data.dealTracker ?? [];
        const aes = ["all", ...Array.from(new Set(all.map((d) => d.ae).filter(Boolean)))];
        const qq = dealSearch.trim().toLowerCase();
        const view = all.filter((d) =>
          (dealAE === "all" || d.ae === dealAE) &&
          (dealConf === "all" || d.conf === dealConf) &&
          (!qq || (d.name + " " + d.ae + " " + d.nextStep).toLowerCase().includes(qq))
        );
        // Two components: the live Q3 pipeline vs Davi's hand-tracked key deals.
        const q3View = view.filter((d) => d.source.startsWith("Q3"));
        const keyView = view.filter((d) => d.source === "Davi Key Deal");
        const kfmt = (n: number) => fmt(n);
        const confTone: Record<string, { bg: string; fg: string }> = {
          Medium: { bg: C.grnBg, fg: C.grn }, Pilot: { bg: C.blueBg, fg: C.blue },
          Hard: { bg: C.ylwBg, fg: C.ylw }, "Very Hard": { bg: C.redBg, fg: C.red },
        };
        const nConf = (c: string) => all.filter((d) => d.conf === c).length;
        const sheetUrl = "https://docs.google.com/spreadsheets/d/1QPpNHeUuPqlAtWA5VyF0_AxXCLM3MZia5UokMSwhFNc/edit";
        const dealTable = (list: typeof view) => (
          <div style={{ overflow: "auto", maxHeight: 520, padding: "6px 20px 18px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.bd}`, position: "sticky", top: 0, background: "#fff" }}>
                <Th l>Deal</Th><Th l>AE</Th><Th l>Stage</Th><Th>Potential</Th><Th l>Confidence</Th><Th l>Est. Live</Th><Th l>Call</Th><Th l>Next step</Th><Th l>Updated</Th>
              </tr></thead>
              <tbody>
                {list.map((d, i) => {
                  const t = confTone[d.conf];
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <Td l bold>{d.name}</Td>
                      <Td l>{d.ae}</Td>
                      <Td l><Pill tone={/SQO/.test(d.stage) ? "good" : /SAL|SQL/.test(d.stage) ? "blue" : undefined}>{d.stage}</Pill></Td>
                      <Td mono bold>{d.pot ? kfmt(d.pot) : "—"}</Td>
                      <Td l>{d.conf ? <span style={{ background: t?.bg ?? C.s2, color: t?.fg ?? C.t2, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{d.conf}</span> : "—"}</Td>
                      <Td l>{d.live || "—"}</Td>
                      <Td l>{d.call || <span style={{ color: C.t3 }}>—</span>}</Td>
                      <Td l><span style={{ fontSize: 12, color: C.t2 }}>{d.nextStep || "—"}</span></Td>
                      <Td l>{d.updated || <span style={{ color: C.t3 }}>—</span>}</Td>
                    </tr>
                  );
                })}
                {list.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: "16px 20px", color: C.t3, fontSize: 13 }}>No deals match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
        const potOf = (list: typeof view) => list.reduce((s, d) => s + d.pot, 0);
        return (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
            {all.length === 0 ? (
              <div style={{ background: "#fff", border: `1px solid ${C.bd}`, borderRadius: 14, padding: 22, color: C.t2 }}>Deal Tracker not populated yet — run <code>build-deal-tracker.mjs</code>.</div>
            ) : (
            <>
              {/* Shared filters (apply to both components) */}
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                <select value={dealAE} onChange={(e) => setDealAE(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.bd}`, fontSize: 13, fontFamily: "inherit" }}>
                  {aes.map((a) => <option key={a} value={a}>{a === "all" ? "All AEs" : a}</option>)}
                </select>
                <select value={dealConf} onChange={(e) => setDealConf(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.bd}`, fontSize: 13, fontFamily: "inherit" }}>
                  <option value="all">All confidence</option>
                  {["Medium", "Pilot", "Hard", "Very Hard"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={dealSearch} onChange={(e) => setDealSearch(e.target.value)} placeholder="Search deal / AE / note…" style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.bd}`, fontSize: 13, fontFamily: "inherit", minWidth: 180 }} />
                <a href={sheetUrl} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 13, color: C.blue, fontWeight: 600, textDecoration: "none" }}>Edit in Google Sheets ↗</a>
              </div>
              <Card
                title="Deals that make Q3"
                sub={`Live Q3 pipeline from Salesforce (the deals that decide the quarter). ${q3View.length} deals · ${fmt(potOf(q3View))} potential.`}
              >
                {dealTable(q3View)}
              </Card>
              <div style={{ height: 16 }} />
              <Card
                title="Key deals from Davi's tab"
                sub={`Davi's hand-tracked key deals (editable in the sheet: Call / Next step / Updated). ${keyView.length} deals · ${fmt(potOf(keyView))} potential · ${nConf("Medium")} Medium · ${nConf("Pilot")} Pilot · ${nConf("Hard")} Hard · ${nConf("Very Hard")} Very Hard.`}
              >
                {dealTable(keyView)}
              </Card>
            </>
            )}
          </div>
        );
      })()}

      {tab === "health" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          {tabSummaries && (
            <TabHeader label="Deal Health" sentence={tabSummaries.health.sentence} stats={tabSummaries.health.stats} />
          )}
          {/* Aging by Stage — toggle by AE; click any number to drill into the deals (SFDC links + CSV) */}
          {data.agingByStage && data.agingByStage.length > 0 && (() => {
            const aes = Array.from(new Set(data.agingByStage.map((s) => s.ae)));
            const shortAE = (a: string) => (a === "All (everyone)" ? "All" : a.split(" ")[0]);
            const rowsForAE = data.agingByStage.filter((s) => s.ae === agingAE);
            return (
              <Card
                title="Aging by Stage"
                sub="Open deals by stage (Stephen's buckets — 'Other' = renewal/billing/everything else): count, avg age, stale (≥90d in stage) and ARR. Live from the sheet. Toggle AE; click any number for the deals."
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {aes.map((a) => (
                    <button key={a} onClick={() => setAgingAE(a)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 20, border: `1px solid ${a === agingAE ? C.coral : C.bd}`, background: a === agingAE ? C.coralSoft : "#fff", color: a === agingAE ? C.coralDk : C.t2, cursor: "pointer" }}>{shortAE(a)}</button>
                  ))}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                      <Th l>Stage</Th><Th># Deals</Th><Th>Avg Age (days)</Th><Th>Stale (≥90d)</Th><Th>Stale $</Th><Th>Avg ACV</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsForAE.map((s) => (
                      <tr key={s.stage} style={{ borderBottom: `1px solid ${C.s1}`, background: s.total ? C.s2 : undefined }}>
                        <Td l bold={s.total}>{s.stage}</Td>
                        <Td mono bold={s.total}><span style={clk} onClick={() => setDrill({ title: `${shortAE(agingAE)} · ${s.stage} · all open`, ae: agingAE, stage: s.total ? "" : s.stage, staleOnly: false })}>{s.deals}</span></Td>
                        <Td mono bold={s.total} color={(s.avgAge ?? 0) > 90 ? C.red : (s.avgAge ?? 0) > 60 ? C.ylw : C.t1}>{s.avgAge ?? "—"}</Td>
                        <Td mono bold={s.total}><span onClick={() => setDrill({ title: `${shortAE(agingAE)} · ${s.stage} · stale ≥90d`, ae: agingAE, stage: s.total ? "" : s.stage, staleOnly: true })} style={(s.stale ?? 0) > 0 ? { cursor: "pointer", display: "inline-block", border: `1.5px solid ${C.red}`, color: C.red, background: "rgba(200,40,40,0.06)", borderRadius: 5, padding: "1px 9px", fontWeight: 700 } : { color: C.t3 }}>{s.stale ?? "—"}</span></Td>
                        <Td mono bold={s.total} color={(s.stale ?? 0) > 0 ? C.red : C.t1}><span style={clk} onClick={() => setDrill({ title: `${shortAE(agingAE)} · ${s.stage} · stale $`, ae: agingAE, stage: s.total ? "" : s.stage, staleOnly: true })}>{s.staleDollar != null ? fmt(s.staleDollar) : "—"}</span></Td>
                        <Td mono bold={s.total}>{s.avgAcv != null ? fmt(s.avgAcv) : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11.5, color: C.t3, marginTop: 8 }}>Tip: click any # Deals / Stale / Stale $ number to see the exact deals behind it (Salesforce links + CSV).</div>
                {/* Breakdown — folded into this same module (no separate card) */}
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.bd}` }}>
                  {(() => {
                    if (!drill || !data.dealBreakdown) {
                      return (
                        <>
                          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: C.t3, marginBottom: 6 }}>Breakdown</div>
                          <div style={{ padding: "22px 8px", textAlign: "center", color: C.t3, fontSize: 14, fontWeight: 600 }}>Choose a number to show your deals</div>
                        </>
                      );
                    }
                    const matchStage = (dStage: string) => (drill.stage === "" ? true : drill.stage === "Other (renewal/billing)" ? !AGING_EXPLICIT.includes(dStage) : dStage === drill.stage);
                    const rows = data.dealBreakdown
                      .filter((d) => (drill.ae === "All (everyone)" || d.owner === drill.ae) && matchStage(d.stage) && (!drill.staleOnly || d.stale))
                      .sort((a, b) => b.arr - a.arr);
                    const totalArr = rows.reduce((sum, d) => sum + d.arr, 0);
                    return (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: C.t3, marginBottom: 6 }}>Breakdown</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: C.navy }}>{rows.length}</span>
                              <span style={{ fontSize: 13, color: C.t2 }}>deals · {fmt(totalArr)}</span>
                              {(() => { const chip = { fontSize: 11, fontWeight: 600 as const, color: C.t2, background: C.s2, border: `1px solid ${C.bd}`, borderRadius: 20, padding: "2px 10px" }; return (<>
                                <span style={chip}>{shortAE(drill.ae)}</span>
                                {drill.stage && <span style={chip}>{drill.stage}</span>}
                                {drill.staleOnly && <span style={{ ...chip, color: C.red, fontWeight: 700, background: "rgba(200,40,40,0.06)", border: `1px solid ${C.red}` }}>stale ≥90d</span>}
                              </>); })()}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => downloadCsv(drill.title, rows)} style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: `1px solid ${C.bd}`, background: C.navy, color: "#fff", cursor: "pointer" }}>⬇ Download CSV</button>
                            <button onClick={() => setDrill(null)} style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: `1px solid ${C.bd}`, background: "#fff", color: C.t2, cursor: "pointer" }}>✕ Clear</button>
                          </div>
                        </div>
                        <div style={{ maxHeight: 420, overflowY: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                                <Th l>Opportunity</Th><Th l>Owner</Th><Th l>Stage</Th><Th>Age (d)</Th><Th>ARR</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((d) => (
                                <tr key={d.id} style={{ borderBottom: `1px solid ${C.s1}` }}>
                                  <Td l><a href={d.url} target="_blank" rel="noreferrer" style={{ color: C.navy, textDecoration: "underline", fontWeight: 600 }}>{d.name || d.id}</a></Td>
                                  <Td l>{d.owner}</Td>
                                  <Td l>{d.stage}</Td>
                                  <Td mono color={(d.age ?? 0) >= 90 ? C.red : C.t1}>{d.age ?? "—"}</Td>
                                  <Td mono bold>{fmt(d.arr)}</Td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </Card>
            );
          })()}

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

      {tab === "acv" && (() => {
        const I = data.acvInsights;
        const kM = (n: number) => {
          const a = Math.abs(n);
          if (a >= 1e6) return "$" + (a / 1e6).toFixed(2) + "M";
          if (a >= 1e3) return "$" + Math.round(a / 1e3) + "k";
          return "$" + Math.round(a);
        };
        const TIER_COLORS = [C.navy, C.teal, C.coral, C.purp, C.ylw, C.red, C.navy2];
        return (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
            {tabSummaries && (
              <TabHeader label="ACV & Deal Size" sentence={tabSummaries.acv.sentence} stats={tabSummaries.acv.stats} />
            )}

            {!I && (
              <Card title="ACV insights unavailable" sub="The SOQL_ClosedDeals tab hasn't been populated yet — run the daily SFDC refresh.">
                <div style={{ padding: 20, color: C.t3, fontSize: 13 }}>Falling back once the pull runs.</div>
              </Card>
            )}

            {I && (
              <>
                {/* ── ACV progression MoM (sheet-computed in the ACV_MoM tab) ── */}
                {data.acvMoM && (
                  <>
                    <MomProgressCard
                      title="ACV Progression — by Deal Segment"
                      sub="Avg ACV of New Business + Expansion won each month (renewals excluded), last 12 months · computed in the ACV_MoM sheet tab · click a pill or row to chart it"
                      months={data.acvMoM.months}
                      series={[{ name: "All", values: data.acvMoM.all, sums: data.acvMoM.allSums }, ...(data.acvMoM.groups.find((g) => g.key === "segment")?.series ?? [])]}
                      accent={C.navy}
                    />
                    <MomProgressCard
                      title="ACV Progression — by Region"
                      sub="Avg ACV of deals won each month, last 12 months · computed in the ACV_MoM sheet tab"
                      months={data.acvMoM.months}
                      series={data.acvMoM.groups.find((g) => g.key === "region")?.series ?? []}
                      accent={C.teal}
                    />
                    <MomProgressCard
                      title="ACV Progression — by AE/AM"
                      sub="Avg ACV of New Business + Expansion won each month (renewals excluded) · AMs included · computed in the ACV_MoM sheet tab"
                      months={data.acvMoM.months}
                      series={data.acvMoM.groups.find((g) => g.key === "ae")?.series ?? []}
                      accent={C.purp}
                    />
                  </>
                )}

                {/* ── $/Location per month — Total vs New Business vs Expansion ── */}
                {data.perLocation && (
                  <Card
                    title="$ / Location per Month — Total · New Business · Expansion"
                    sub="Total = active-book ARR ÷ active locations ÷ 12 · New Biz / Expansion = ARR of those deals won that month ÷ their locations ÷ 12 · sheet-computed (ARR_per_Location_MoM tab)"
                    accent={C.teal}
                  >
                    <PerLocationCard
                      months={data.perLocation.months}
                      total={data.perLocation.total}
                      newBiz={data.perLocation.newBiz}
                      expansion={data.perLocation.expansion}
                    />
                  </Card>
                )}

                {/* ── Win rate US vs International ── */}
                <Card
                  title="Win Rate & ACV — US vs International"
                  sub={`${I.windowLabel} · US = Deal Country "United States" · win rate on New Business only (won / won+lost); ACV on New Business + Expansion (renewals excluded)`}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                    {I.geo.map((g, gi) => (
                      <div key={g.label} style={{ padding: "18px 24px", borderLeft: gi ? `1px solid ${C.s1}` : "none" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: gi ? C.teal : C.navy }}>{g.label}</div>
                        <div style={{ fontSize: 34, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: gi ? C.teal : C.navy, margin: "6px 0 2px" }}>
                          {g.winRate != null ? pct(g.winRate) : "—"}
                        </div>
                        <div style={{ fontSize: 12.5, color: C.t2 }}>{g.wonCount} won · {g.lostCount} lost</div>
                        <div style={{ display: "flex", gap: 28, marginTop: 12 }}>
                          <KV label="Avg ACV" v={kM(g.avg)} />
                          <KV label="Median ACV" v={kM(g.median)} />
                          <KV label="Won ARR" v={kM(g.totalARR)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* ── ARR by Location Tier — MoM this year ── */}
                <Card
                  title={`ARR by Location Tier — ${new Date().getUTCFullYear()} MoM`}
                  sub="Point-in-time active ARR at each month-end, split by SFDC Location Tiers (locations in contract)"
                  accent={C.purp}
                >
                  <div style={{ padding: "16px 20px" }}>
                    <StackedBarChart
                      labels={I.arrByTier.months}
                      series={I.arrByTier.tiers.map((t, i) => ({ label: t.tier, values: t.values, color: TIER_COLORS[i % TIER_COLORS.length] }))}
                    />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, fontSize: 11.5, color: C.t2 }}>
                      {I.arrByTier.tiers.map((t, i) => (
                        <span key={t.tier} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 11, height: 11, borderRadius: 2, background: TIER_COLORS[i % TIER_COLORS.length], display: "inline-block" }} />
                          {t.tier} · {kM(t.values[t.values.length - 1] ?? 0)}
                        </span>
                      ))}
                    </div>
                  </div>
                </Card>

                {/* ── ACV by Deal Segment (incl. sales cycle by segment) ── */}
                <Card
                  title="ACV & Sales Cycle by Deal Segment"
                  sub={`New Business + Expansion won, ${I.windowLabel} (renewals excluded) · segments from SFDC Merchant Segment · cycle = SQL → Closed Won`}
                  accent={C.coral}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: C.s1, borderBottom: `1px solid ${C.bd}` }}>
                        <Th l>Segment</Th>
                        <Th># Won</Th>
                        <Th>Avg ACV</Th>
                        <Th>Median ACV</Th>
                        <Th>Total ARR</Th>
                        <Th>Median Cycle</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {I.segments.map((s) => (
                        <tr key={s.seg} style={{ borderBottom: `1px solid ${C.s1}` }}>
                          <Td l bold>{s.seg}</Td>
                          <Td mono>{s.count}</Td>
                          <Td mono color={C.navy2}>{kM(s.avg)}</Td>
                          <Td mono bold>{kM(s.median)}</Td>
                          <Td mono>{kM(s.totalARR)}</Td>
                          <Td mono color={C.purp}>{s.medianCycle != null ? `${s.medianCycle}d` : "—"}{s.cycleN ? <span style={{ color: C.t3, fontWeight: 400 }}> · n={s.cycleN}</span> : null}</Td>
                        </tr>
                      ))}
                      <tr style={{ background: C.s1, borderTop: `2px solid ${C.navy}` }}>
                        <Td l bold>All segments</Td>
                        <Td mono bold>{I.totals.count}</Td>
                        <Td mono bold color={C.navy2}>{kM(I.totals.avg)}</Td>
                        <Td mono bold>{kM(I.totals.median)}</Td>
                        <Td mono bold>{kM(I.totals.totalARR)}</Td>
                        <Td mono>—</Td>
                      </tr>
                    </tbody>
                  </table>
                  {I.reconcile && (
                    <div style={{ padding: "10px 16px 12px", fontSize: 12, color: C.t3, borderTop: `1px solid ${C.s1}` }}>
                      Why this ≠ Live ARR ({kM(I.reconcile.liveARR)}): the table counts ARR <b>won</b> in the last 12 months; Live ARR also includes {kM(I.reconcile.olderActive)} of NB + Expansion won before this window and {kM(I.reconcile.renewalsActive)} of active renewals — while {kM(Math.max(0, I.totals.totalARR - I.reconcile.recentActive))} of these wins has since ended/churned.
                    </div>
                  )}
                </Card>

                {/* ── ACV by AE + by Region ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card title="ACV by AE" sub={`New Business + Expansion won, ${I.windowLabel} (renewals excluded)`}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                          <Th l>AE</Th>
                          <Th># Won</Th>
                          <Th>Median ACV</Th>
                          <Th>Total ARR</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {I.byAE.slice(0, 10).map((a) => (
                          <tr key={a.owner} style={{ borderBottom: `1px solid ${C.s1}` }}>
                            <Td l bold>{a.owner}</Td>
                            <Td mono>{a.count}</Td>
                            <Td mono>{kM(a.median)}</Td>
                            <Td mono bold color={C.navy2}>{kM(a.totalARR)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                  <Card title="ACV by Region" sub={`New Business + Expansion won, ${I.windowLabel} (renewals excluded) · SFDC Region`}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                          <Th l>Region</Th>
                          <Th># Won</Th>
                          <Th>Median ACV</Th>
                          <Th>Total ARR</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {I.regions.map((r) => (
                          <tr key={r.region} style={{ borderBottom: `1px solid ${C.s1}` }}>
                            <Td l bold>{r.region}</Td>
                            <Td mono>{r.count}</Td>
                            <Td mono>{kM(r.median)}</Td>
                            <Td mono bold color={C.navy2}>{kM(r.totalARR)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </div>

                {/* ── Deal size distribution (kept from previous version) ── */}
                <Card title="Deal Size Distribution" sub="All won deals incl. renewals, last 18 months (Query 2 basis)">
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
              </>
            )}
          </div>
        );
      })()}

      {tab === "paymentmix" && (() => {
        const M = data.paymentMix;
        const kM = (n: number) => {
          const a = Math.abs(n);
          if (a >= 1e6) return "$" + (a / 1e6).toFixed(2) + "M";
          if (a >= 1e3) return "$" + Math.round(a / 1e3) + "k";
          return "$" + Math.round(n);
        };
        // Annual-mix % badge — underperformers (<50%) get a solid red block so they
        // pop; at/above 50% is a soft green pill. 50% is the annual-mix target line.
        const annPill = (p: number) => {
          const low = p < 50;
          return (
            <span style={{
              display: "inline-block", minWidth: 46, textAlign: "center", padding: "3px 9px",
              borderRadius: 6, fontFamily: "var(--font-dm-mono)", fontWeight: 800, fontSize: 12.5,
              background: low ? C.red : C.grnBg, color: low ? "#fff" : C.grn,
            }}>{p.toFixed(0)}%</span>
          );
        };
        const stat = (labelTxt: string, big: string, sub: string, tone?: string) => (
          <div style={{ background: C.card, border: `1px solid ${C.bd}`, borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: C.t3 }}>{labelTxt}</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: tone ?? C.navy, marginTop: 4, lineHeight: 1.1 }}>{big}</div>
            <div style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>{sub}</div>
          </div>
        );
        return (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
            <TabHeader
              label="Payment Mix"
              sentence={M
                ? `${M.monthLabel}: New Business is ${M.headline.newAnnualPct.toFixed(0)}% annual mix (${M.headline.nbAnnualDeals}/${M.headline.nbTotalDeals} deals), Renewals ${M.headline.renAnnualPct.toFixed(0)}% (${M.headline.renAnnualDeals}/${M.headline.renTotalDeals}). Annual cash collected: ${kM(M.headline.annualCashTotal)}.`
                : "Payment-term monitoring — annual vs quarterly vs monthly. Awaiting the SOQL_PaymentMix pull."}
              stats={M ? [
                { label: "New ARR (mo)", value: kM(M.headline.newArr), sub: `${M.headline.newAnnualPct.toFixed(0)}% annual` },
                { label: "Renewal ARR (mo)", value: kM(M.headline.renArr), sub: `${M.headline.renAnnualPct.toFixed(0)}% annual` },
                { label: "Annual cash", value: kM(M.headline.annualCashTotal), sub: `NB ${kM(M.headline.nbAnnualCash)} · Ren ${kM(M.headline.renAnnualCash)}` },
                { label: "NB annual upfront", value: `${M.headline.nbTotalDeals ? Math.round(M.headline.nbAnnualDeals / M.headline.nbTotalDeals * 100) : 0}%`, sub: `${M.headline.nbAnnualDeals} of ${M.headline.nbTotalDeals} deals` },
              ] : []}
            />

            {!M && (
              <Card title="Payment Mix unavailable" sub="The SOQL_PaymentMix tab hasn't been populated yet — run the daily SFDC refresh.">
                <div style={{ padding: 20, color: C.t3, fontSize: 13 }}>Falling back once the pull runs.</div>
              </Card>
            )}

            {M && (<>
              {/* By payment term — current month, NB + Renewals */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {([["New Business", M.byTerm.nb, M.headline.nbAnnualCash] as const, ["Renewals", M.byTerm.ren, M.headline.renAnnualCash] as const]).map(([ttl, tbl, cash]) => (
                  <Card key={ttl} title={`${ttl} · by Payment Term`} sub={`${M.monthLabel} · Contract Live Date`}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ background: C.s1, borderBottom: `1px solid ${C.bd}` }}><Th l>Term</Th><Th># Deals</Th><Th>ARR</Th></tr></thead>
                      <tbody>
                        {tbl.map((t) => (
                          <tr key={t.term} style={{ borderBottom: `1px solid ${C.s1}` }}>
                            <Td l bold>{t.term}</Td><Td mono>{t.deals}</Td><Td mono>{kM(t.arr)}</Td>
                          </tr>
                        ))}
                        <tr style={{ background: C.s1, borderTop: `2px solid ${C.navy}` }}>
                          <Td l bold>Annual cash collected</Td><Td>{""}</Td><Td mono bold color={C.grn}>{kM(cash)}</Td>
                        </tr>
                      </tbody>
                    </table>
                  </Card>
                ))}
              </div>

              {/* Payment Mix Momentum — two cards (NB / Renewals), term toggle,
                  $ bars + % share line, MoM/QoQ/YoY deltas (like the email's YTD) */}
              <PaymentMixMomentumCard title="Payment Mix Momentum — New Business" months={M.momentum.months} series={M.momentum.nb} accent={C.navy} />
              <PaymentMixMomentumCard title="Payment Mix Momentum — Renewals" months={M.momentum.months} series={M.momentum.ren} accent={C.teal} />

              {/* Flags — current-month non-annual */}
              {M.flags.length > 0 && (
                <Card title={`⚑ Monthly / Quarterly deals — ${M.monthLabel}`} sub="Non-annual closings this month, by rep · annual-conversion coaching targets" accent={C.coral}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ borderBottom: `1px solid ${C.bd}` }}><Th l>Type</Th><Th l>Rep</Th><Th l>Opportunity</Th><Th>Term</Th><Th>ARR</Th></tr></thead>
                    <tbody>
                      {M.flags.map((f, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.s1}` }}>
                          <Td l>{f.type}</Td><Td l bold>{f.rep}</Td><Td l>{f.opp}</Td>
                          <Td color={C.coralDk}>{f.term}</Td><Td mono>{kM(f.arr)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}

              {/* AE + CSM breakdowns (YTD) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Card title="AE Breakdown — New ARR" sub="Amount × Opportunity Owner · YTD">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ borderBottom: `1px solid ${C.bd}` }}><Th l>AE</Th><Th>Deals</Th><Th>New ARR</Th><Th>Ann %</Th><Th>Ann Cash</Th></tr></thead>
                    <tbody>
                      {M.aeBreakdown.slice(0, 10).map((a) => (
                        <tr key={a.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                          <Td l bold>{a.name}</Td><Td mono>{a.deals}</Td><Td mono>{a.deals === 0 ? "—" : kM(a.newArr)}</Td>
                          {a.deals === 0 ? (
                            <td colSpan={2} style={{ textAlign: "right", padding: "10px 16px", fontSize: 12, fontStyle: "italic", color: C.t3 }}>no won deals yet</td>
                          ) : (
                            <>
                              <td style={{ textAlign: "right", padding: "10px 16px" }}>{annPill(a.annualPctArr)}</td><Td mono>{kM(a.annualCash)}</Td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
                <Card title="CSM Breakdown — Renewal ARR" sub="Amount × Account Manager · YTD">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ borderBottom: `1px solid ${C.bd}` }}><Th l>CSM</Th><Th>Deals</Th><Th>Renewal ARR</Th><Th>Ann %</Th><Th>Ann Cash</Th></tr></thead>
                    <tbody>
                      {M.csmBreakdown.slice(0, 10).map((a) => (
                        <tr key={a.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                          <Td l bold>{a.name}</Td><Td mono>{a.deals}</Td><Td mono>{kM(a.renArr)}</Td>
                          <td style={{ textAlign: "right", padding: "10px 16px" }}>{annPill(a.annualPctArr)}</td><Td mono>{kM(a.annualCash)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>

              {/* Upcoming renewals — next 90 days */}
              <Card title="Upcoming Renewals — Next 90 Days" sub="Top 10 by ARR · ⚑ = prior term Monthly/Quarterly (annual-conversion target) · Monthly = biggest upside" accent={C.purp}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: `1px solid ${C.bd}` }}><Th l>Account</Th><Th l>CSM</Th><Th>ARR</Th><Th>Prev Term</Th><Th>End Date</Th></tr></thead>
                  <tbody>
                    {M.upcoming.map((u, i) => {
                      const isMonthly = u.prevTerm === "Monthly";
                      const isQuarterly = u.prevTerm === "Quarterly";
                      // Prev-term block: Monthly = solid coral (prime conversion target),
                      // Quarterly = soft coral pill, anything else = plain text.
                      const termCell = isMonthly || isQuarterly ? (
                        <span style={{
                          display: "inline-block", padding: "3px 10px", borderRadius: 6, fontWeight: 800, fontSize: 12.5,
                          background: isMonthly ? C.coral : C.coralSoft, color: isMonthly ? "#fff" : C.coralDk,
                        }}>{u.prevTerm}</span>
                      ) : <span style={{ color: C.t2 }}>{u.prevTerm}</span>;
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.s1}`, background: isMonthly ? C.coralSoft : "transparent" }}>
                          <Td l bold>{u.convert ? "⚑ " : ""}{u.account}</Td><Td l>{u.csm}</Td>
                          <Td mono>{kM(u.arr)}</Td>
                          <td style={{ textAlign: "right", padding: "10px 16px" }}>{termCell}</td><Td mono>{u.endDate}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </>)}
          </div>
        );
      })()}

      {tab === "productarr" && (() => {
        const monthly = data.arr.monthly.filter((p) => p.label.startsWith("2026-"));
        const weekly = data.arr.weekly.slice(-6);
        const MABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        // proper month labels (Stephen item 3) — was p.label.slice(5) which showed bare
        // month numbers ("07") instead of names. "2026-07"→"Jul-26"; "2026-07-27"→"Jul 27".
        const wLabels = weekly.map((p) => { const [, m, d] = p.label.split("-"); return `${MABBR[+m - 1]} ${+d}`; });
        const mWin = monthly.slice(-6);
        const mLabels = mWin.map((p) => { const [y, m] = p.label.split("-"); return `${MABBR[+m - 1]}-${y.slice(2)}`; });

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

    </div>
  );
}
