"use client";

import { useEffect, useState } from "react";

const C = {
  bg: "#FBF7F1",
  card: "#FFFFFF",
  s1: "#F6F1E8",
  bd: "#E7DECE",
  ink: "#221E1A",
  t1: "#2A2521",
  t2: "#6F665B",
  t3: "#A39787",
  navy: "#1F2D4E",
  coral: "#D4785A",
  coralDk: "#B85F42",
  grn: "#2E7D32",
  grnBg: "#EAF3DE",
  red: "#C0392B",
  redBg: "#FBEAE7",
};

function fmt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "$0";
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "k";
  return s + "$" + a.toFixed(0);
}

function pct(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}

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

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.bd}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.3,
          color: C.t2,
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function StatBlock({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.t3, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-dm-mono)",
          fontSize: 22,
          fontWeight: 500,
          color: positive === undefined ? C.t1 : positive ? C.grn : C.red,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 40, color: C.red, fontFamily: "var(--font-dm-sans)" }}>
        Failed to load dashboard data: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 40, color: C.t2, fontFamily: "var(--font-dm-sans)" }}>
        Loading live data…
      </div>
    );
  }

  const latestMonth = data.arr.monthly[data.arr.monthly.length - 1];
  const pipelineTotals = data.pipeline.sections["1. TOTAL PIPELINE"] ?? [];
  const pipelineCoverage = data.pipeline.sections["3. PIPELINE COVERAGE"] ?? [];

  return (
    <div
      style={{
        fontFamily: "var(--font-dm-sans)",
        background: C.bg,
        minHeight: "100vh",
        padding: "32px 40px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.navy }}>
            Momos Forecast — Q3 FY26
          </div>
          <div style={{ fontSize: 13, color: C.t3, marginTop: 4 }}>
            Live data · updated {new Date(data.updatedAt).toLocaleString()}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <Card title="Active ARR">
            <StatBlock label={latestMonth?.month ?? "—"} value={fmt(latestMonth?.activeARR)} />
          </Card>
          <Card title="New ARR (Latest Month)">
            <StatBlock label={latestMonth?.month ?? "—"} value={fmt(latestMonth?.newARR)} />
          </Card>
          <Card title="Churned ARR (Latest Month)">
            <StatBlock
              label={latestMonth?.month ?? "—"}
              value={fmt(latestMonth?.churnedARR)}
              positive={false}
            />
          </Card>
          <Card title="MoM Change">
            <StatBlock
              label={latestMonth?.month ?? "—"}
              value={pct(latestMonth?.momChangePct)}
              positive={(latestMonth?.momChangePct ?? 0) >= 0}
            />
          </Card>
        </div>

        <div style={{ marginBottom: 20 }}>
          <Card title="ARR Trend (Last 12 Months)">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                    {["Month", "New ARR", "Active ARR", "Churned ARR", "MoM %"].map(
                      (h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: "6px 10px",
                            color: C.t2,
                            fontWeight: 600,
                          }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.arr.monthly.slice(-12).map((m) => (
                    <tr key={m.month} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <td style={{ padding: "6px 10px", fontFamily: "var(--font-dm-mono)" }}>
                        {m.month}
                      </td>
                      <td style={{ padding: "6px 10px", fontFamily: "var(--font-dm-mono)" }}>
                        {fmt(m.newARR)}
                      </td>
                      <td style={{ padding: "6px 10px", fontFamily: "var(--font-dm-mono)" }}>
                        {fmt(m.activeARR)}
                      </td>
                      <td
                        style={{
                          padding: "6px 10px",
                          fontFamily: "var(--font-dm-mono)",
                          color: C.red,
                        }}
                      >
                        {fmt(m.churnedARR)}
                      </td>
                      <td
                        style={{
                          padding: "6px 10px",
                          fontFamily: "var(--font-dm-mono)",
                          color: (m.momChangePct ?? 0) >= 0 ? C.grn : C.red,
                        }}
                      >
                        {pct(m.momChangePct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <Card title={`Pipeline Overview (${data.pipeline.filterRep})`}>
            <div style={{ display: "grid", gap: 10 }}>
              {[...pipelineTotals, ...pipelineCoverage].map((row) => (
                <div
                  key={row.metric}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                    padding: "4px 0",
                    borderBottom: `1px solid ${C.s1}`,
                  }}
                >
                  <span style={{ color: C.t2 }}>{row.metric}</span>
                  <span style={{ fontFamily: "var(--font-dm-mono)", color: C.t1 }}>
                    {row.metric.toLowerCase().includes("ratio") ||
                    row.metric.toLowerCase().includes("%")
                      ? row.value.toFixed(2)
                      : fmt(row.value)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="AE Attainment — Q3 FY26">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                    {["AE", "Quota", "Actual", "% of Quota"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          color: C.t2,
                          fontWeight: 600,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.aeAttainment.reps.map((rep) => (
                    <tr key={rep.name} style={{ borderBottom: `1px solid ${C.s1}` }}>
                      <td style={{ padding: "6px 8px" }}>{rep.name}</td>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--font-dm-mono)" }}>
                        {fmt(rep.quota)}
                      </td>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--font-dm-mono)" }}>
                        {fmt(rep.actual)}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          fontFamily: "var(--font-dm-mono)",
                          color: rep.pctOfQuota >= 1 ? C.grn : C.t1,
                        }}
                      >
                        {pct(rep.pctOfQuota)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card title={`Pipeline Progression — Week over Week (${data.pipelineWow.filterRep})`}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: C.t2 }}>
                    Metric
                  </th>
                  {data.pipelineWow.weekLabels.map((w) => (
                    <th
                      key={w}
                      style={{
                        textAlign: "right",
                        padding: "6px 8px",
                        color: C.t2,
                        fontWeight: 600,
                      }}
                    >
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.pipelineWow.weeks.map((row) => (
                  <tr key={row.metric} style={{ borderBottom: `1px solid ${C.s1}` }}>
                    <td style={{ padding: "6px 8px", color: C.t2 }}>{row.metric}</td>
                    {row.values.map((v, i) => (
                      <td
                        key={i}
                        style={{
                          textAlign: "right",
                          padding: "6px 8px",
                          fontFamily: "var(--font-dm-mono)",
                        }}
                      >
                        {v == null ? "—" : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
