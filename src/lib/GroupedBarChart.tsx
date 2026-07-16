"use client";

import { useState } from "react";
import { C, fmt } from "./ui";

type GroupSeries = { label: string; values: number[]; color: string };

export function GroupedBarChart({
  labels,
  series,
  targets,
}: {
  labels: string[];
  series: GroupSeries[];
  targets?: number[][];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (labels.length === 0) {
    return <div style={{ color: C.t3, fontSize: 13, padding: 12 }}>No data available.</div>;
  }

  const W = 920;
  const H = 260;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 52;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(...allValues, 1) * 1.1;

  const groupGap = innerW / labels.length;
  const barW = Math.min(42, (groupGap * 0.7) / series.length);
  const groupW = barW * series.length;

  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const labelEvery = Math.ceil(labels.length / 12) || 1;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", overflow: "visible" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} stroke={C.bd} />

        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke={C.s2}
              strokeWidth={1}
            />
            <text x={padL - 8} y={y(max * f) + 4} textAnchor="end" fontSize={11} fontWeight={600} fill={C.t2}>
              {fmt(max * f)}
            </text>
          </g>
        ))}

        {labels.map((l, i) => {
          const groupX = padL + i * groupGap + (groupGap - groupW) / 2;
          return (
            <g key={l}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const barH = innerH - (y(v) - padT);
                return (
                  <rect
                    key={s.label}
                    x={groupX + si * barW + 1}
                    y={y(v)}
                    width={barW - 2}
                    height={Math.max(barH, 1)}
                    fill={s.color}
                    opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}
                    rx={2}
                  />
                );
              })}
              <rect
                x={padL + i * groupGap}
                y={padT}
                width={groupGap}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
              {i % labelEvery === 0 && (
                <text
                  x={padL + i * groupGap + groupGap / 2}
                  y={H - 32}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill={C.t2}
                >
                  {l}
                </text>
              )}
            </g>
          );
        })}

        {series.map((s, i) => (
          <g key={s.label} transform={`translate(${padL + i * 150}, ${H - 10})`}>
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
          {series.map((s, si) => {
            const tgt = targets?.[si]?.[hoverIdx];
            return (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "#C7D0E0" }}>{s.label}</span>
                <span style={{ fontFamily: "var(--font-dm-mono)" }}>
                  {fmt(s.values[hoverIdx] ?? 0)}
                  {tgt != null && tgt > 0 && (
                    <span style={{ color: "#9FAAC6" }}>
                      {" / "}{fmt(tgt)} ({Math.round(((s.values[hoverIdx] ?? 0) / tgt) * 100)}%)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
