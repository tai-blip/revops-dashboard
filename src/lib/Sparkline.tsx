"use client";

import { C, fmt } from "./ui";

export function Sparkline({
  data,
  color = C.navy,
  width = 180,
  height = 36,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const x = (i: number) => (i / (data.length - 1 || 1)) * (width - 8) + 4;
  const y = (v: number) => height - 5 - ((v - min) / (max - min || 1)) * (height - 10);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = data[data.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} />
      <circle cx={x(data.length - 1)} cy={y(last)} r={3} fill={color} />
    </svg>
  );
}

export function fmtMetricValue(v: number, money: boolean) {
  if (!money) return String(Math.round(v));
  return fmt(v);
}

export function wowDeltaPct(values: (number | null)[]): number | null {
  const clean = values.filter((v): v is number => v != null);
  if (clean.length < 2) return null;
  const last = clean[clean.length - 1];
  const prev = clean[clean.length - 2];
  if (prev === 0) return null;
  return ((last - prev) / Math.abs(prev)) * 100;
}

export function DeltaPill({ delta }: { delta: number | null }) {
  if (delta == null) {
    return <span style={{ color: C.t3, fontSize: 11.5 }}>—</span>;
  }
  const up = delta >= 0;
  return (
    <span
      style={{
        background: up ? C.grnBg : C.redBg,
        color: up ? C.grn : C.red,
        padding: "2px 9px",
        borderRadius: 10,
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {up ? "+" : "−"}
      {Math.abs(Math.round(delta))}%
    </span>
  );
}
