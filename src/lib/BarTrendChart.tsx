"use client";

import { useState } from "react";
import { C, fmt } from "./ui";

export function BarTrendChart({
  labels,
  values,
  valueFormat = "number",
  targetLine,
  targetLabel,
}: {
  labels: string[];
  values: number[];
  valueFormat?: "number" | "currency";
  targetLine?: number;
  targetLabel?: string;
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

  const max = Math.max(...values, targetLine ?? 0, 1) * 1.1;
  const barW = (innerW / labels.length) * 0.65;
  const gap = innerW / labels.length;

  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const fmtVal = (v: number) => (valueFormat === "currency" ? fmt(v) : String(v));

  const hovered = hoverIdx != null ? { label: labels[hoverIdx], value: values[hoverIdx] } : null;
  const labelEvery = Math.ceil(labels.length / 12) || 1;

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
                fill={hoverIdx === i ? C.coralDk : C.navy}
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
          <strong>{hovered.label}</strong>: {fmtVal(hovered.value)}
        </div>
      )}
    </div>
  );
}
