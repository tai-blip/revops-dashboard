"use client";
// ARR trajectory — Jan-26 → Jan-27. One continuous line: navy = Live ARR (actuals,
// through the last complete month), then red = Booked ARR forecast (last Live ARR +
// cumulative scheduled go-lives). A divider + red-tinted band mark the forecast region.
// The month-by-month component breakdown (New Biz / Expansion / Churn) lives in the
// table beneath this chart.
import { CSSProperties } from "react";

type Pt = { label: string; value: number; forecast: boolean };

export function ArrMovementChart({ points }: { points: Pt[] }) {
  const W = 760, H = 210, padL = 46, padR = 14, padT = 22, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = points.length || 1;
  const vals = points.map((p) => p.value).filter((v) => v > 0);
  const vMax = Math.max(...vals, 1), vMin = Math.min(...vals);
  const span = vMax - vMin || 1;
  const lo = vMin - span * 0.35, hi = vMax + span * 0.25; // headroom so the line sits mid-frame
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => padT + innerH - ((v - lo) / (hi - lo)) * innerH;
  const fmtK = (v: number) => (Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : "$" + Math.round(v / 1e3) + "k");
  const NAVY = "#1F2D4E", GOLD = "#C79A3E";

  const firstFwd = points.findIndex((p) => p.forecast);
  // forecast segment starts at the last actual point so the two segments join
  const toPath = (pts: { i: number; v: number }[]) => pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const actualPath = toPath(points.map((p, i) => ({ i, v: p.value, f: p.forecast })).filter((p) => !p.f));
  const fcastPath = toPath(points.map((p, i) => ({ i, v: p.value })).filter((_, i) => firstFwd > 0 && i >= firstFwd - 1));
  const bandX = firstFwd > 0 ? (x(firstFwd - 1) + x(firstFwd)) / 2 : null;

  const legend: [string, string][] = [["Live ARR (actual)", NAVY], ["Booked ARR (forecast)", GOLD]];
  const chip: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5a6478", marginRight: 16 };
  const gridVals = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.1];

  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        {legend.map(([l, c]) => (
          <span key={l} style={chip}><span style={{ width: 16, height: 3, borderRadius: 2, background: c, display: "inline-block" }} />{l}</span>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 620 }}>
          {/* red-tinted forecast band */}
          {bandX != null && (
            <>
              <rect x={bandX} y={padT} width={W - padR - bandX} height={innerH} fill="rgba(199,154,62,0.08)" />
              <line x1={bandX} y1={padT} x2={bandX} y2={padT + innerH} stroke="#d8c290" strokeWidth={1} strokeDasharray="3 3" />
              <text x={bandX + 5} y={padT + 10} fontSize={9.5} fill="#a07d2e" fontWeight={600}>forecast</text>
            </>
          )}
          {/* horizontal gridlines + y labels */}
          {gridVals.map((gv, i) => (
            <g key={i}>
              <line x1={padL} y1={y(gv)} x2={W - padR} y2={y(gv)} stroke="#eceef2" strokeWidth={1} />
              <text x={padL - 8} y={y(gv) + 3} textAnchor="end" fontSize={9.5} fill="#9aa2b1">{fmtK(gv)}</text>
            </g>
          ))}
          {/* lines */}
          <path d={actualPath} fill="none" stroke={NAVY} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          <path d={fcastPath} fill="none" stroke={GOLD} strokeWidth={2.5} strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" />
          {/* dots + x labels */}
          {points.map((p, i) => (
            <g key={i}>
              <title>{`${p.label}\n${p.forecast ? "Booked ARR (forecast)" : "Live ARR"} ${fmtK(p.value)}`}</title>
              {p.value > 0 && <circle cx={x(i)} cy={y(p.value)} r={2.8} fill={p.forecast ? GOLD : NAVY} />}
              {p.value > 0 && (
                <text x={x(i)} y={y(p.value) - 9} textAnchor="middle" fontSize={9} fontWeight={700} fill={p.forecast ? "#a07d2e" : NAVY}>{fmtK(p.value)}</text>
              )}
              <text x={x(i)} y={H - 7} textAnchor="middle" fontSize={8.5} fill="#8a92a3">{p.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
