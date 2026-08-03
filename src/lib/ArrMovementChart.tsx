"use client";
// ARR composition — Jan-26 → Jan-27. Bars: New Business + Expansion up (green/blue),
// Churn down (red) for actual months. Two lines on their own scale (the book ~$5.6M
// dwarfs the monthly flows): Live ARR (navy, actuals only — stops at the last complete
// month) and Booked ARR (gold dashed — actuals then a forward projection that adds each
// month's scheduled go-lives, no end-date subtraction). A divider marks where actuals end.
import { CSSProperties } from "react";

type Pt = { label: string; newBusiness: number; expansion: number; churn: number; liveARR: number | null; bookedARR: number };

export function ArrMovementChart({ points }: { points: Pt[] }) {
  const W = 760, H = 240, padL = 8, padR = 8, padT = 16, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = points.length || 1;
  const bw = Math.min(30, (innerW / n) * 0.6);
  const gap = innerW / n;
  const ups = points.map((p) => p.newBusiness + p.expansion);
  const downs = points.map((p) => Math.abs(p.churn));
  const fMax = Math.max(...ups, ...downs, 1) * 1.15;
  const zeroY = padT + innerH * (Math.max(...ups, 1) / (Math.max(...ups, 1) + Math.max(...downs, 1)) || 0.7);
  const hUp = (v: number) => (v / fMax) * (zeroY - padT);
  const hDown = (v: number) => (v / fMax) * (padT + innerH - zeroY);
  const lineVals = points.flatMap((p) => [p.liveARR ?? 0, p.bookedARR]);
  const lMax = Math.max(...lineVals, 1) * 1.06;
  const lMin = Math.min(...lineVals.filter((v) => v > 0)) * 0.96;
  const lineY = (v: number) => padT + innerH - ((v - lMin) / (lMax - lMin || 1)) * innerH;
  const cx = (i: number) => padL + gap * i + gap / 2;
  const fmtK = (v: number) => (Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : "$" + Math.round(v / 1e3) + "k");
  // Build a line path over a value accessor, breaking wherever the value is null.
  const linePath = (get: (p: Pt) => number | null) => {
    let d = "", pen = false;
    points.forEach((p, i) => {
      const v = get(p);
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${cx(i).toFixed(1)},${lineY(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const GREEN = "#2E9E6B", BLUE = "#3F6BB0", RED = "#D2603A", NAVY = "#1B2949", GOLD = "#C79A3E";
  const legend: [string, string][] = [["New Business", GREEN], ["Expansion", BLUE], ["Churn", RED], ["Booked ARR (fwd)", GOLD], ["Live ARR", NAVY]];
  const chip: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#5a6478", marginRight: 14 };
  // Divider between the last actual (live present) month and the first forecast month.
  const firstFwd = points.findIndex((p) => p.liveARR == null);
  const dividerX = firstFwd > 0 ? padL + gap * firstFwd : null;

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        {legend.map(([l, c]) => (
          <span key={l} style={chip}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}</span>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 620 }}>
          {dividerX != null && (
            <>
              <line x1={dividerX} y1={padT - 6} x2={dividerX} y2={padT + innerH} stroke="#c2c8d4" strokeWidth={1} strokeDasharray="3 3" />
              <text x={dividerX + 4} y={padT - 1} fontSize={9} fill="#9aa2b1">forecast →</text>
            </>
          )}
          <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#d8dbe2" strokeWidth={1} />
          {points.map((p, i) => {
            const x = cx(i) - bw / 2;
            const nbH = hUp(p.newBusiness), exH = hUp(p.expansion), chH = hDown(Math.abs(p.churn));
            return (
              <g key={i}>
                <title>{`${p.label}\nNew Business ${fmtK(p.newBusiness)}\nExpansion ${fmtK(p.expansion)}\nChurn ${fmtK(-Math.abs(p.churn))}\nBooked ARR ${fmtK(p.bookedARR)}${p.liveARR != null ? `\nLive ARR ${fmtK(p.liveARR)}` : ""}`}</title>
                <rect x={x} y={zeroY - nbH} width={bw} height={nbH} fill={GREEN} />
                <rect x={x} y={zeroY - nbH - exH} width={bw} height={exH} fill={BLUE} />
                {chH > 0 && <rect x={x} y={zeroY} width={bw} height={chH} fill={RED} />}
                <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={8.5} fill="#8a92a3">{p.label}</text>
              </g>
            );
          })}
          <path d={linePath((p) => p.bookedARR)} fill="none" stroke={GOLD} strokeWidth={2} strokeDasharray="5 3" />
          <path d={linePath((p) => p.liveARR)} fill="none" stroke={NAVY} strokeWidth={2} />
          {points.map((p, i) => <circle key={`b${i}`} cx={cx(i)} cy={lineY(p.bookedARR)} r={2.2} fill={GOLD} />)}
          {points.map((p, i) => (p.liveARR != null ? <circle key={`l${i}`} cx={cx(i)} cy={lineY(p.liveARR)} r={2.4} fill={NAVY} /> : null))}
        </svg>
      </div>
    </div>
  );
}
