"use client";

import { useState } from "react";
import { C, fmt } from "./ui";

export function ProductLineSection({
  name,
  color,
  labels,
  data,
  defaultTarget,
}: {
  name: string;
  color: string;
  labels: string[];
  data: number[];
  defaultTarget: number;
}) {
  const [target, setTarget] = useState<number>(defaultTarget);
  const current = data[data.length - 1] ?? 0;
  const gap = target - current;
  const attain = target > 0 ? Math.round((current / target) * 100) : 0;

  const W = 900;
  const H = 190;
  const padL = 54;
  const padR = 14;
  const padT = 14;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(target, ...data, 1) * 1.12;
  const gapW = innerW / data.length;
  const barW = gapW * 0.6;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const labelEvery = Math.ceil(labels.length / 12) || 1;

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.bd}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 12,
        padding: "16px 20px",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: C.t1 }}>{name}</div>
          <div style={{ fontSize: 12, color: C.t2 }}>Cumulative active ARR</div>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Current</div>
            <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: C.t1 }}>{fmt(current)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Target</div>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontFamily: "var(--font-dm-mono)", color: C.t3 }}>$</span>
              <input
                type="number"
                value={target}
                onChange={(e) => setTarget(Number(e.target.value) || 0)}
                style={{ width: 104, padding: "4px 7px", border: `1px solid ${C.bd}`, borderRadius: 6, fontSize: 14, fontFamily: "var(--font-dm-mono)", textAlign: "right", color: C.t1, background: "#fff" }}
              />
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Gap</div>
            <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: gap > 0 ? C.red : C.grn }}>
              {gap > 0 ? fmt(gap) : "met"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: C.t3, fontWeight: 600, textTransform: "uppercase" }}>Attain</div>
            <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-dm-mono)", color: attain >= 100 ? C.grn : attain >= 70 ? C.ylw : C.red }}>
              {attain}%
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: "relative", marginTop: 12 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }} onMouseLeave={() => setHoverIdx(null)}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} stroke={C.s2} strokeWidth={1} />
              <text x={padL - 8} y={y(max * f) + 4} textAnchor="end" fontSize={10} fontWeight={600} fill={C.t2}>{fmt(max * f)}</text>
            </g>
          ))}
          {data.map((v, i) => {
            const cx = padL + i * gapW + gapW / 2;
            return (
              <g key={i}>
                <rect x={cx - barW / 2} y={y(v)} width={barW} height={Math.max(innerH - (y(v) - padT), 1)} fill={color} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.5} rx={2} />
                <rect x={padL + i * gapW} y={padT} width={gapW} height={innerH} fill="transparent" onMouseEnter={() => setHoverIdx(i)} />
                {i % labelEvery === 0 && (
                  <text x={cx} y={H - 12} textAnchor="middle" fontSize={10} fontWeight={600} fill={C.t2}>{labels[i]}</text>
                )}
              </g>
            );
          })}
          {/* target line */}
          <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke={C.coral} strokeWidth={1.5} strokeDasharray="5,4" />
          <text x={W - padR} y={y(target) - 5} textAnchor="end" fontSize={10} fontWeight={700} fill={C.coralDk}>Target {fmt(target)}</text>
        </svg>
        {hoverIdx != null && (
          <div style={{ position: "absolute", top: 0, right: 0, background: C.navy, color: "#fff", borderRadius: 6, padding: "5px 10px", fontSize: 12, pointerEvents: "none" }}>
            <strong>{labels[hoverIdx]}</strong>: {fmt(data[hoverIdx])}
          </div>
        )}
      </div>
    </div>
  );
}
