"use client";

import { C } from "./ui";

export type HeaderStat = {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "warn";
};

const toneColor: Record<string, string> = {
  good: "#9FD9A4",
  bad: "#F0A99C",
  warn: "#FAC775",
};

export function TabHeader({
  label,
  sentence,
  stats,
}: {
  label: string;
  sentence: string;
  stats: HeaderStat[];
}) {
  const cols = Math.min(stats.length, 6);
  return (
    <div
      style={{
        background: `linear-gradient(160deg, ${C.navy} 0%, #16223D 100%)`,
        borderRadius: 14,
        padding: "20px 24px",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "#9FAAC6",
          marginBottom: 8,
        }}
      >
        {label} · Executive Summary
      </div>
      <div
        style={{
          fontSize: 16,
          lineHeight: 1.55,
          color: "#fff",
          fontWeight: 500,
          marginBottom: 18,
        }}
      >
        {sentence}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 10,
        }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              background: "rgba(255,255,255,.06)",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "#9FAAC6",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: s.tone ? toneColor[s.tone] : "#fff",
                fontFamily: "var(--font-dm-mono)",
                marginTop: 5,
                lineHeight: 1,
              }}
            >
              {s.value}
            </div>
            {s.sub && (
              <div style={{ fontSize: 11, color: "#9FAAC6", marginTop: 5 }}>{s.sub}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
