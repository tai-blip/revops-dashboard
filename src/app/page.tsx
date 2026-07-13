"use client";

import { useEffect, useMemo, useState } from "react";
import { C, fmt, pct, Card, KV, Bar, Pill, HeroStat, Th, Td } from "@/lib/ui";

type DashboardData = {
  updatedAt: string;
  arr: {
    monthly: {
      month: string;
      newARR: number;
      activeARR: number;
      churnedARR: number;
      momChangePct: number | null;
    }[];
  };
  aeAttainment: {
    reps: { name: string; quota: number; pctOfQuota: number; actual: number }[];
  };
  pipeline: {
    filterRep: string;
    sections: Record<string, { metric: string; value: number }[]>;
  };
  pipelineWow: {
    filterRep: string;
    weekLabels: string[];
    weeks: { metric: string; values: (number | null)[] }[];
  };
};

const TABS = [
  ["command", "Command"],
  ["targets", "Targets & Progress"],
  ["pipeline", "Pipeline"],
  ["attainment", "AE Attainment"],
] as const;

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("command");

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
    const prevMonths = months.slice(-4, -1);

    // Team quota totals from AE attainment tab
    const teamQuota = data.aeAttainment.reps.reduce((s, r) => s + r.quota, 0);
    const teamActual = data.aeAttainment.reps.reduce((s, r) => s + r.actual, 0);
    const teamPctOfQuota = teamQuota > 0 ? teamActual / teamQuota : 0;

    const pipelineTotals = data.pipeline.sections["1. TOTAL PIPELINE"] ?? [];
    const totalPipelineARR =
      pipelineTotals.find((m) => m.metric === "Total Pipeline (ARR)")?.value ?? 0;
    const coverage = data.pipeline.sections["3. PIPELINE COVERAGE"] ?? [];
    const coverageRatio =
      coverage.find((m) => m.metric === "Pipeline Coverage Ratio")?.value ?? 0;

    return {
      latest,
      prevMonths,
      teamQuota,
      teamActual,
      teamPctOfQuota,
      totalPipelineARR,
      coverageRatio,
    };
  }, [data]);

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

  return (
    <div style={{ fontFamily: "var(--font-dm-sans)", background: C.bg, minHeight: "100vh" }}>
      {/* Header / tab bar */}
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
          <div style={{ display: "flex", gap: 4, marginTop: 14 }}>
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
                <HeroStat
                  label="New ARR (Latest Month)"
                  value={fmt(derived.latest?.newARR)}
                />
                <HeroStat
                  label="Churned ARR (Latest Month)"
                  value={fmt(derived.latest?.churnedARR)}
                  tone="bad"
                />
                <HeroStat
                  label="MoM Change"
                  value={pct(derived.latest?.momChangePct)}
                  tone={(derived.latest?.momChangePct ?? 0) >= 0 ? "good" : "bad"}
                />
                <HeroStat
                  label="Total Pipeline"
                  value={fmt(derived.totalPipelineARR)}
                />
                <HeroStat
                  label="Pipeline Coverage"
                  value={derived.coverageRatio.toFixed(2) + "x"}
                  tone={derived.coverageRatio >= 3 ? "good" : "warn"}
                />
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
            <Card title="Team Attainment — Q3 FY26" sub="Actual vs quota across all AEs">
              <div style={{ padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <KV label="Actual" v={fmt(derived.teamActual)} />
                  <KV label="Quota" v={fmt(derived.teamQuota)} />
                  <KV
                    label="% of Quota"
                    v={pct(derived.teamPctOfQuota)}
                    color={derived.teamPctOfQuota >= 1 ? C.grn : C.t1}
                  />
                </div>
                <Bar value={derived.teamActual} target={derived.teamQuota} h={10} />
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "targets" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 30px" }}>
          <Card title="ARR Trend vs Prior Months" sub="Last 12 months, from your ARR & recurring revenue tab">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <Th l>Month</Th>
                  <Th>New ARR</Th>
                  <Th>Active ARR</Th>
                  <Th>Churned ARR</Th>
                  <Th>MoM %</Th>
                </tr>
              </thead>
              <tbody>
                {data.arr.monthly.slice(-12).map((m) => (
                  <tr key={m.month} style={{ borderBottom: `1px solid ${C.s1}` }}>
                    <Td l mono>{m.month}</Td>
                    <Td mono>{fmt(m.newARR)}</Td>
                    <Td mono>{fmt(m.activeARR)}</Td>
                    <Td mono color={C.red}>{fmt(m.churnedARR)}</Td>
                    <Td mono color={(m.momChangePct ?? 0) >= 0 ? C.grn : C.red}>
                      {pct(m.momChangePct)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Rep Quota Progress — Q3 FY26">
            <div style={{ padding: 20, display: "grid", gap: 16 }}>
              {data.aeAttainment.reps.map((rep) => (
                <div key={rep.name}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{rep.name}</span>
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
          <div style={{ marginBottom: 12 }}>
            <Pill tone="blue">Filtered by: {data.pipeline.filterRep}</Pill>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            {Object.entries(data.pipeline.sections).map(([section, rows]) => (
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
                      <span style={{ fontFamily: "var(--font-dm-mono)" }}>
                        {row.metric.toLowerCase().includes("ratio")
                          ? row.value.toFixed(2) + "x"
                          : row.metric.toLowerCase().includes("%")
                          ? pct(row.value)
                          : fmt(row.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <Card
            title="Pipeline Progression — Week over Week"
            sub={`Filtered by: ${data.pipelineWow.filterRep}`}
          >
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
                    <Td mono color={rep.pctOfQuota >= 1 ? C.grn : C.t1}>
                      {pct(rep.pctOfQuota)}
                    </Td>
                    <td style={{ padding: "10px 16px", width: 160 }}>
                      <Bar value={rep.actual} target={rep.quota} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 30px 30px", fontSize: 12, color: C.t3 }}>
        Note: Deal Health, Forecast, ACV & Deal Size, and Who Does What tabs from the
        original dashboard aren&apos;t included here — they require deal-level Salesforce data
        (individual opportunity records) that isn&apos;t available in the Sheet.
      </div>
    </div>
  );
}
