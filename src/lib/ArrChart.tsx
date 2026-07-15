"use client";

import { useState } from "react";
import { C, fmt, pct } from "./ui";
import type { ArrPoint } from "./parse";

export function ArrChart({
  points,
  milestone,
  milestoneLabel,
}: {
  points: ArrPoint[];
  milestone?: number;
  milestoneLabel?: string;
}) {
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
  const max = Math.max(...values, milestone ?? 0) * 1.08;
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
            <text x={padL - 10} y={y(v) + 4} textAnchor="end" fontSize={12} fontWeight={600} fill={C.t1}>
              {fmt(v)}
            </text>
          </g>
        ))}

        {/* area + line */}
        <path d={areaPath} fill={C.navy} opacity={0.08} />
        <path d={linePath} fill="none" stroke={C.navy} strokeWidth={2.5} />

        {/* milestone target line */}
        {milestone != null && (
          <g>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(milestone)}
              y2={y(milestone)}
              stroke={C.grn}
              strokeWidth={1.5}
              strokeDasharray="6,4"
            />
            <text
              x={W - padR}
              y={y(milestone) - 6}
              textAnchor="end"
              fontSize={11}
              fontWeight={700}
              fill={C.grn}
            >
              {milestoneLabel ?? "Milestone"}: {fmt(milestone)} · Gap:{" "}
              {fmt(milestone - (points[points.length - 1]?.activeARR ?? 0))}
            </text>
          </g>
        )}

        {/* points + hover targets */}
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.activeARR)} r={hoverIdx === i ? 6 : 3.5} fill={C.navy} />
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
                fontSize={11}
                fontWeight={600}
                fill={C.t2}
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
            stroke={C.coral}
            strokeWidth={1.5}
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
            padding: "10px 14px",
            fontSize: 13,
            minWidth: 160,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>{hovered.label}</div>
          <div style={{ marginBottom: 2 }}>
            Active ARR: <span style={{ fontFamily: "var(--font-dm-mono)", fontWeight: 600 }}>{fmt(hovered.activeARR)}</span>
          </div>
          <div style={{ marginBottom: 2 }}>
            New ARR: <span style={{ fontFamily: "var(--font-dm-mono)", fontWeight: 600 }}>{fmt(hovered.newARR)}</span>
          </div>
          <div style={{ marginBottom: 2 }}>
            Churned: <span style={{ fontFamily: "var(--font-dm-mono)", fontWeight: 600 }}>{fmt(hovered.churnedARR)}</span>
          </div>
          <div style={{ color: (hovered.changePct ?? 0) >= 0 ? "#9FD9A4" : "#F0A99C", fontWeight: 600 }}>
            Change: {pct(hovered.changePct)}
          </div>
        </div>
      )}
    </div>
  );
}
