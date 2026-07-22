"use client";

import { useState } from "react";
import { C, fmt } from "./ui";

export function BarTrendChart({
  labels,
  values,
  valueFormat = "number",
  targetLine,
  targetLabel,
  barColor,
  barColors,
  lineOverlay,
  showValues,
  trendline,
  trendColor,
}: {
  labels: string[];
  values: number[];
  valueFormat?: "number" | "currency";
  targetLine?: number;
  targetLabel?: string;
  barColor?: string;
  barColors?: (string | undefined)[];
  lineOverlay?: { label: string; values: number[]; color: string };
  showValues?: boolean;
  trendline?: boolean;
  trendColor?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (labels.length === 0) {
    return <div style={{ color: C.t3, fontSize: 13, padding: 12 }}>No data available.</div>;
  }

  const W = 920;
  const H = 200;
  const padL = 50;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = Math.max(...values, ...(lineOverlay?.values ?? []), targetLine ?? 0, 1) * 1.1;
  const barW = (innerW / labels.length) * 0.65;
  const gap = innerW / labels.length;

  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const fmtVal = (v: number) => (valueFormat === "currency" ? fmt(v) : String(v));

  const hovered = hoverIdx != null ? { label: labels[hoverIdx], value: values[hoverIdx] } : null;
  const labelEvery = Math.ceil(labels.length / 12) || 1;

  // Compact formatter for on-bar value labels (e.g. $50k, $1.4M) so they don't overlap.
  const compact = (v: number) => {
    if (valueFormat !== "currency") return String(Math.round(v));
    const a = Math.abs(v);
    if (a >= 1e6) return "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return "$" + Math.round(a / 1e3) + "k";
    return "$" + Math.round(a);
  };

  // Least-squares linear trendline over the bar values.
  const trendVals = (() => {
    if (!trendline || values.length < 2) return null;
    const n = values.length;
    const xm = (n - 1) / 2;
    const ym = values.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - xm) * (values[i] - ym); den += (i - xm) ** 2; }
    const b = den ? num / den : 0;
    const a = ym - b * xm;
    return values.map((_, i) => Math.max(0, a + b * i));
  })();
  const tColor = trendColor ?? C.red;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", overflow: "visible" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} stroke={C.bd} />
        {targetLine != null && (
          <g>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(targetLine)}
              y2={y(targetLine)}
              stroke={C.coral}
              strokeWidth={1.5}
              strokeDasharray="5,4"
            />
            <text x={W - padR} y={y(targetLine) - 5} textAnchor="end" fontSize={10} fontWeight={600} fill={C.coralDk}>
              {targetLabel ?? "Target"}: {fmtVal(targetLine)}
            </text>
          </g>
        )}
        {values.map((v, i) => {
          const x = padL + i * gap + (gap - barW) / 2;
          const barH = innerH - (y(v) - padT);
          return (
            <g key={i}>
              <rect
                x={x}
                y={y(v)}
                width={barW}
                height={Math.max(barH, 1)}
                fill={hoverIdx === i ? C.coralDk : (barColors?.[i] ?? barColor ?? C.navy)}
                rx={2}
              />
              <rect
                x={padL + i * gap}
                y={padT}
                width={gap}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
              {showValues && (
                <text
                  x={padL + i * gap + gap / 2}
                  y={y(v) - 4}
                  textAnchor="middle"
                  fontSize={8.5}
                  fontWeight={700}
                  fill={C.t1}
                >
                  {compact(v)}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text
                  x={padL + i * gap + gap / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={C.t2}
                >
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}

        {trendVals && (
          <g>
            <polyline
              points={trendVals
                .map((v, i) => `${(padL + i * gap + gap / 2).toFixed(1)},${y(v).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke={tColor}
              strokeWidth={2}
              strokeDasharray="6,3"
            />
          </g>
        )}

        {lineOverlay && (
          <g>
            <polyline
              points={lineOverlay.values
                .map((v, i) => `${(padL + i * gap + gap / 2).toFixed(1)},${y(v).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke={lineOverlay.color}
              strokeWidth={2}
            />
            {lineOverlay.values.map((v, i) => (
              <circle
                key={i}
                cx={padL + i * gap + gap / 2}
                cy={y(v)}
                r={hoverIdx === i ? 4.5 : 3}
                fill={lineOverlay.color}
              />
            ))}
          </g>
        )}
      </svg>
      {hovered && (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            background: C.navy,
            color: "#fff",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: lineOverlay ? 4 : 0 }}>
            {hovered.label}
            {!lineOverlay && <>: {fmtVal(hovered.value)}</>}
          </div>
          {lineOverlay && hoverIdx != null && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "#C7D0E0" }}>Cumulative</span>
                <span style={{ fontFamily: "var(--font-dm-mono)" }}>{fmtVal(hovered.value)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "#C7D0E0" }}>{lineOverlay.label}</span>
                <span style={{ fontFamily: "var(--font-dm-mono)" }}>
                  {fmtVal(lineOverlay.values[hoverIdx] ?? 0)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
