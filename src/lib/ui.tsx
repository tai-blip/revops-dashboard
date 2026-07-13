"use client";

import React from "react";

export const C = {
  bg: "#FBF7F1",
  card: "#FFFFFF",
  s1: "#F6F1E8",
  s2: "#F0E9DD",
  bd: "#E7DECE",
  bdSoft: "#F0E9DD",
  ink: "#221E1A",
  t1: "#2A2521",
  t2: "#6F665B",
  t3: "#A39787",
  navy: "#1F2D4E",
  navy2: "#33436B",
  coral: "#D4785A",
  coralDk: "#B85F42",
  coralSoft: "#F5E2D8",
  grn: "#2E7D32",
  grnBg: "#EAF3DE",
  red: "#C0392B",
  redBg: "#FBEAE7",
  ylw: "#B7791F",
  ylwBg: "#FAEEDA",
  blue: "#1565C0",
  blueBg: "#E6F1FB",
  purp: "#6B4E9E",
  purpBg: "#EEE8F6",
  teal: "#0F766E",
  tealBg: "#DBF1EE",
};

export function fmt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "$0";
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "k";
  return s + "$" + a.toFixed(0);
}

export function pct(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}

type Tone = "good" | "bad" | "warn" | "blue" | "purp" | "teal" | undefined;

export function Pill({
  children,
  tone,
  sm,
}: {
  children: React.ReactNode;
  tone?: Tone;
  sm?: boolean;
}) {
  const m: Record<string, [string, string]> = {
    good: [C.grnBg, C.grn],
    bad: [C.redBg, C.red],
    warn: [C.ylwBg, C.ylw],
    blue: [C.blueBg, C.blue],
    purp: [C.purpBg, C.purp],
    teal: [C.tealBg, C.teal],
    default: [C.s2, C.t2],
  };
  const [bg, fg] = m[tone ?? "default"] || m.default;
  return (
    <span
      style={{
        background: bg,
        color: fg,
        fontSize: sm ? 10 : 11,
        fontWeight: 600,
        padding: sm ? "2px 7px" : "3px 9px",
        borderRadius: 20,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Bar({
  value,
  target,
  h = 8,
}: {
  value: number;
  target: number;
  h?: number;
}) {
  const r = target > 0 ? value / target : 0;
  const col = r >= 1 ? C.grn : r >= 0.7 ? C.ylw : C.coral;
  return (
    <div
      style={{
        background: C.s2,
        borderRadius: 6,
        height: h,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, r * 100)}%`,
          height: "100%",
          background: col,
          borderRadius: 6,
          transition: "width .5s",
        }}
      />
    </div>
  );
}

export function Th({ children, l }: { children: React.ReactNode; l?: boolean }) {
  return (
    <th
      style={{
        textAlign: l ? "left" : "right",
        padding: "11px 16px",
        fontWeight: 600,
        fontSize: 11.5,
        color: C.t2,
        textTransform: "uppercase",
        letterSpacing: ".04em",
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  l,
  mono,
  color,
  bold,
}: {
  children: React.ReactNode;
  l?: boolean;
  mono?: boolean;
  color?: string;
  bold?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: l ? "left" : "right",
        padding: "10px 16px",
        fontFamily: mono ? "var(--font-dm-mono)" : "inherit",
        color: color || C.t1,
        fontWeight: bold ? 600 : 400,
        fontSize: 13,
      }}
    >
      {children}
    </td>
  );
}

export function Card({
  title,
  sub,
  accent,
  children,
  pad,
}: {
  title?: string;
  sub?: string;
  accent?: string;
  children: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.bd}`,
        borderRadius: 16,
        overflow: "hidden",
        marginBottom: 18,
        boxShadow: "0 1px 2px rgba(34,30,26,.03)",
      }}
    >
      {title && (
        <div
          style={{
            padding: "15px 20px",
            borderBottom: `1px solid ${C.bd}`,
            borderLeft: accent ? `3px solid ${accent}` : "none",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>{title}</div>
          {sub && (
            <div style={{ fontSize: 12.5, color: C.t2, marginTop: 3 }}>{sub}</div>
          )}
        </div>
      )}
      <div style={{ padding: pad ? "18px 20px" : 0 }}>{children}</div>
    </div>
  );
}

export function KV({
  label,
  v,
  sub,
  color,
  subColor,
}: {
  label: string;
  v: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  subColor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          color: C.t3,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-dm-mono)",
          fontWeight: 600,
          fontSize: 15,
          color: color || C.t1,
        }}
      >
        {v}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: subColor || C.t2,
            marginTop: 3,
            fontWeight: subColor ? 600 : 400,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

type HeroTone = "good" | "bad" | "warn" | "coral" | undefined;

export function HeroStat({
  label,
  value,
  delta,
  deltaTone,
  tone,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaTone?: "good" | "bad";
  tone?: HeroTone;
  onClick?: () => void;
}) {
  const toneMap: Record<string, string> = {
    good: C.grn,
    bad: C.red,
    warn: C.ylw,
    coral: C.coral,
  };
  const tc = (tone && toneMap[tone]) || "#fff";
  return (
    <button
      onClick={onClick}
      style={{
        background: "rgba(255,255,255,.06)",
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: 14,
        padding: "16px 18px",
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        transition: "background .2s",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "#9FAAC6",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: tc,
          marginTop: 6,
          fontFamily: "var(--font-dm-mono)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {delta && (
        <div
          style={{
            fontSize: 12,
            marginTop: 6,
            color:
              deltaTone === "bad"
                ? "#F0A99C"
                : deltaTone === "good"
                ? "#9FD9A4"
                : "#9FAAC6",
            fontWeight: 500,
          }}
        >
          {delta}
        </div>
      )}
    </button>
  );
}
