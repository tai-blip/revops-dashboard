"use client";

import { useState } from "react";
import { C, fmt } from "./ui";

type Series = { label: string; values: (number | null)[]; color: string };

export function LineTrendChart({
  labels,
  series,
  valueFormat = "number",
}: {
  labels: string[];
  series: Series[];
  valueFormat?: "number" | "currency" | "percent";
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

  const allValues = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const max = Math.max(...allValues, 1) * 1.1;
  const min = Math.min(0, Math.min(...allValues, 0)) * 1.1;

  const x = (i: number) =>
    padL + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;

  const fmtVal = (v: number) =>
    valueFormat === "currency" ? fmt(v) : valueFormat === "percent" ? v.toFixed(1) + "%" : String(v);

  const labelEvery = Math.ceil(labels.length / 10) || 1;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", overflow: "visible" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke={C.bd} />

        {series.map((s) => {
          const pts = s.values
            .map((v, i) => (v != null ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null))
            .filter((p): p is string => p != null);
          return (
            <polyline
              key={s.label}
              points={pts.join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
            />
          );
        })}

        {series.map((s) =>
          s.values.map((v, i) =>
            v != null ? (
              <circle
                key={s.label + i}
                cx={x(i)}
                cy={y(v)}
                r={hoverIdx === i ? 5 : 3}
                fill={s.color}
              />
            ) : null
          )
        )}

        {labels.map((l, i) => (
          <rect
            key={l}
            x={x(i) - innerW / labels.length / 2}
            y={padT}
            width={innerW / labels.length}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

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

        {labels.map(
          (l, i) =>
            i % labelEvery === 0 && (
              <text key={l} x={x(i)} y={H - 30} textAnchor="middle" fontSize={10} fontWeight={600} fill={C.t2}>
                {l}
              </text>
            )
        )}

        {/* legend */}
        {series.map((s, i) => (
          <g key={s.label} transform={`translate(${padL + i * 180}, ${H - 8})`}>
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
            minWidth: 140,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{labels[hoverIdx]}</div>
          {series.map((s) => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "#C7D0E0" }}>{s.label}</span>
              <span style={{ fontFamily: "var(--font-dm-mono)" }}>
                {s.values[hoverIdx] != null ? fmtVal(s.values[hoverIdx]!) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
