"use client";

import { useState } from "react";
import { C, fmt, pct } from "./ui";
import type { ArrPoint } from "./parse";

export function ArrChart({ points }: { points: ArrPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length === 0) {
    return <div style={{ color: C.t3, fontSize: 13, padding: 20 }}>No data available.</div>;
  }

  const W = 920;
  const H = 280;
  const padL = 58;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = points.map((p) => p.activeARR);
  const max = Math.max(...values) * 1.08;
  const min = Math.min(0, Math.min(...values) * 0.95);

  const x = (i: number) =>
    padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.activeARR).toFixed(1)}`)
    .join(" ");

  const areaPath =
    linePath +
    ` L ${x(points.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)}` +
    ` L ${x(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  // ~5 gridlines
  const gridLines = 4;
  const gridVals = Array.from({ length: gridLines + 1 }, (_, i) => min + ((max - min) * i) / gridLines);

  const hovered = hoverIdx != null ? points[hoverIdx] : null;
  const labelEvery = Math.ceil(points.length / 10) || 1;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", overflow: "visible" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* gridlines */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(v)}
              y2={y(v)}
              stroke={C.s2}
              strokeWidth={1}
            />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill={C.t3}>
              {fmt(v)}
            </text>
          </g>
        ))}

        {/* area + line */}
        <path d={areaPath} fill={C.coralSoft} opacity={0.5} />
        <path d={linePath} fill="none" stroke={C.coralDk} strokeWidth={2} />

        {/* points + hover targets */}
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.activeARR)} r={hoverIdx === i ? 5 : 3} fill={C.coralDk} />
            {/* invisible wide hit area */}
            <rect
              x={x(i) - innerW / points.length / 2}
              y={padT}
              width={innerW / points.length}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
            {i % labelEvery === 0 && (
              <text
                x={x(i)}
                y={H - 10}
                textAnchor="middle"
                fontSize={10}
                fill={C.t3}
              >
                {p.label.slice(5) || p.label}
              </text>
            )}
          </g>
        ))}

        {/* hover guideline */}
        {hoverIdx != null && (
          <line
            x1={x(hoverIdx)}
            x2={x(hoverIdx)}
            y1={padT}
            y2={padT + innerH}
            stroke={C.t3}
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}
      </svg>

      {hovered && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: C.navy,
            color: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            minWidth: 140,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{hovered.label}</div>
          <div>Active ARR: <span style={{ fontFamily: "var(--font-dm-mono)" }}>{fmt(hovered.activeARR)}</span></div>
          <div>New ARR: <span style={{ fontFamily: "var(--font-dm-mono)" }}>{fmt(hovered.newARR)}</span></div>
          <div>Churned: <span style={{ fontFamily: "var(--font-dm-mono)" }}>{fmt(hovered.churnedARR)}</span></div>
          <div style={{ color: (hovered.changePct ?? 0) >= 0 ? "#9FD9A4" : "#F0A99C" }}>
            Change: {pct(hovered.changePct)}
          </div>
        </div>
      )}
    </div>
  );
}
