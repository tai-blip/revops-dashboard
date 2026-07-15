"use client";

import { useState } from "react";
import { C, fmt } from "./ui";

type PlanPoint = { month: string; target: number; booked: number | null; isH2: boolean };

export function PlanChart({ data }: { data: PlanPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 960;
  const H = 320;
  const padL = 60;
  const padR = 16;
  const padT = 20;
  const padB = 60;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = Math.max(...data.map((d) => Math.max(d.target, d.booked ?? 0))) * 1.15;
  const gap = innerW / data.length;
  const barW = gap * 0.5;

  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", overflow: "visible" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* H2 shaded background band */}
        {(() => {
          const firstH2 = data.findIndex((d) => d.isH2);
          if (firstH2 < 0) return null;
          const x0 = padL + firstH2 * gap;
          return (
            <rect
              x={x0}
              y={padT}
              width={padL + data.length * gap - x0 - 0}
              height={innerH}
              fill={C.navy}
              opacity={0.05}
            />
          );
        })()}

        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={C.s2} strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fontWeight={600} fill={C.t2}>
              {fmt(v)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const cx = padL + i * gap + gap / 2;
          const hit = d.booked != null && d.booked >= d.target;
          const barColor = d.booked == null ? C.s2 : hit ? C.grn : C.coralDk;
          return (
            <g key={d.month}>
              {/* faint target-height ghost bar for H2/future context */}
              {d.booked == null && (
                <rect x={cx - barW / 2} y={y(d.target)} width={barW} height={innerH - (y(d.target) - padT)} fill={C.navy} opacity={0.06} rx={2} />
              )}
              {/* booked bar */}
              {d.booked != null && (
                <rect x={cx - barW / 2} y={y(d.booked)} width={barW} height={Math.max(innerH - (y(d.booked) - padT), 1)} fill={barColor} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.5} rx={2} />
              )}
              {/* target cap line */}
              <line x1={cx - barW / 2 - 3} x2={cx + barW / 2 + 3} y1={y(d.target)} y2={y(d.target)} stroke={C.navy} strokeWidth={2.5} />
              {/* booked value label */}
              {d.booked != null && (
                <text x={cx} y={y(d.booked) - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={barColor}>
                  {fmt(d.booked)}
                </text>
              )}
              {/* month label */}
              <text x={cx} y={H - 40} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.t2}>
                {d.month}
              </text>
              {/* hover hit area */}
              <rect x={padL + i * gap} y={padT} width={gap} height={innerH} fill="transparent" onMouseEnter={() => setHoverIdx(i)} />
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div style={{ display: "flex", gap: 18, fontSize: 11.5, color: C.t2, marginTop: 4, paddingLeft: padL }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 16, height: 2.5, background: C.navy, display: "inline-block" }} /> target
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, background: C.coralDk, borderRadius: 2, display: "inline-block" }} /> booked
        </span>
        <span style={{ color: C.t3 }}>· shaded = H2 (Jul+) rebased plan</span>
      </div>

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
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {data[hoverIdx].month} {data[hoverIdx].isH2 ? "· rebased" : ""}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#C7D0E0" }}>Target</span>
            <span style={{ fontFamily: "var(--font-dm-mono)" }}>{fmt(data[hoverIdx].target)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#C7D0E0" }}>Booked</span>
            <span style={{ fontFamily: "var(--font-dm-mono)" }}>
              {data[hoverIdx].booked != null ? fmt(data[hoverIdx].booked!) : "—"}
            </span>
          </div>
          {data[hoverIdx].booked != null && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid rgba(255,255,255,.2)", marginTop: 4, paddingTop: 4 }}>
              <span style={{ color: "#C7D0E0" }}>Attainment</span>
              <span style={{ fontFamily: "var(--font-dm-mono)" }}>
                {data[hoverIdx].target > 0 ? Math.round((data[hoverIdx].booked! / data[hoverIdx].target) * 100) + "%" : "—"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
