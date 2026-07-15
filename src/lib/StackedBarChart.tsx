"use client";

import { useState } from "react";
import { C, fmt } from "./ui";

type StackSeries = { label: string; values: number[]; color: string };

export function StackedBarChart({
  labels,
  series,
}: {
  labels: string[];
  series: StackSeries[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (labels.length === 0) {
    return <div style={{ color: C.t3, fontSize: 13, padding: 12 }}>No data available.</div>;
  }

  const W = 920;
  const H = 240;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 50;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const totals = labels.map((_, i) => series.reduce((s, sr) => s + (sr.values[i] ?? 0), 0));
  const max = Math.max(...totals, 1) * 1.1;

  const barW = (innerW / labels.length) * 0.65;
  const gap = innerW / labels.length;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const scaleH = (v: number) => (v / max) * innerH;

  const labelEvery = Math.ceil(labels.length / 12) || 1;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", overflow: "visible" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} stroke={C.bd} />

        {labels.map((l, i) => {
          const x = padL + i * gap + (gap - barW) / 2;
          let cursor = padT + innerH;
          return (
            <g key={l}>
              {series.map((s) => {
                const v = s.values[i] ?? 0;
                const h = scaleH(v);
                cursor -= h;
                return (
                  <rect
                    key={s.label}
                    x={x}
                    y={cursor}
                    width={barW}
                    height={Math.max(h, 0)}
                    fill={s.color}
                    opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}
                    rx={1}
                  />
                );
              })}
              <rect
                x={padL + i * gap}
                y={padT}
                width={gap}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
              {i % labelEvery === 0 && (
                <text
                  x={padL + i * gap + gap / 2}
                  y={H - 30}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={C.t2}
                >
                  {l.length > 7 ? l.slice(2) : l}
                </text>
              )}
            </g>
          );
        })}

        {/* legend */}
        {series.map((s, i) => (
          <g key={s.label} transform={`translate(${padL + i * 160}, ${H - 8})`}>
            <rect width={10} height={10} fill={s.color} rx={2} />
            <text x={14} y={9} fontSize={10.5} fontWeight={600} fill={C.t2}>
              {s.label}
            </text>
          </g>
        ))}
      </svg>

      {hoverIdx != null && (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            background: C.navy,
            color: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            pointerEvents: "none",
            minWidth: 150,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{labels[hoverIdx]}</div>
          {series.map((s) => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "#C7D0E0" }}>{s.label}</span>
              <span style={{ fontFamily: "var(--font-dm-mono)" }}>{fmt(s.values[hoverIdx] ?? 0)}</span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              borderTop: "1px solid rgba(255,255,255,.2)",
              marginTop: 4,
              paddingTop: 4,
              fontWeight: 700,
            }}
          >
            <span>Total</span>
            <span style={{ fontFamily: "var(--font-dm-mono)" }}>
              {fmt(series.reduce((s, sr) => s + (sr.values[hoverIdx] ?? 0), 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
