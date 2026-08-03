"use client";
// Monthly ARR movement — Stephen's combined churn view. Stacked bars per month:
// New Business + Expansion up (green/blue), Churn down (red), with Live ARR as a line
// overlay (own scale, since the book ~$5.6M dwarfs the monthly flows ~$200k).
import { CSSProperties } from "react";

type Pt = { label: string; newBusiness: number; expansion: number; churn: number; liveARR: number };

export function ArrMovementChart({ points }: { points: Pt[] }) {
  const W = 760, H = 240, padL = 8, padR = 8, padT = 16, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = points.length || 1;
  const bw = Math.min(34, (innerW / n) * 0.62);
  const gap = innerW / n;
  // flow scale: max stack up vs churn down
  const ups = points.map((p) => p.newBusiness + p.expansion);
  const downs = points.map((p) => Math.abs(p.churn));
  const fMax = Math.max(...ups, ...downs, 1) * 1.15;
  const zeroY = padT + innerH * (Math.max(...ups, 1) / (Math.max(...ups, 1) + Math.max(...downs, 1)) || 0.7);
  const hUp = (v: number) => (v / fMax) * (zeroY - padT);
  const hDown = (v: number) => (v / fMax) * (padT + innerH - zeroY);
  const lMax = Math.max(...points.map((p) => p.liveARR), 1) * 1.1;
  const lineY = (v: number) => padT + innerH - (v / lMax) * innerH;
  const cx = (i: number) => padL + gap * i + gap / 2;
  const fmtK = (v: number) => (Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + Math.round(v / 1e3) + "k");
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${lineY(p.liveARR).toFixed(1)}`).join(" ");
  const GREEN = "#2E9E6B", BLUE = "#3F6BB0", RED = "#D2603A", NAVY = "#1B2949";
  const legend: [string, string][] = [["New Business", GREEN], ["Expansion", BLUE], ["Churn", RED], ["Live ARR", NAVY]];
  const chip: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#5a6478", marginRight: 14 };

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        {legend.map(([l, c]) => (
          <span key={l} style={chip}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}</span>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560 }}>
          <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#d8dbe2" strokeWidth={1} />
          {points.map((p, i) => {
            const x = cx(i) - bw / 2;
            const nbH = hUp(p.newBusiness), exH = hUp(p.expansion), chH = hDown(Math.abs(p.churn));
            return (
              <g key={i}>
                <title>{`${p.label}\nNew Business ${fmtK(p.newBusiness)}\nExpansion ${fmtK(p.expansion)}\nChurn ${fmtK(-Math.abs(p.churn))}\nLive ARR ${fmtK(p.liveARR)}`}</title>
                <rect x={x} y={zeroY - nbH} width={bw} height={nbH} fill={GREEN} />
                <rect x={x} y={zeroY - nbH - exH} width={bw} height={exH} fill={BLUE} />
                {chH > 0 && <rect x={x} y={zeroY} width={bw} height={chH} fill={RED} />}
                <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="#8a92a3">{p.label}</text>
              </g>
            );
          })}
          <path d={linePath} fill="none" stroke={NAVY} strokeWidth={2} />
          {points.map((p, i) => <circle key={i} cx={cx(i)} cy={lineY(p.liveARR)} r={2.4} fill={NAVY} />)}
        </svg>
      </div>
    </div>
  );
}
