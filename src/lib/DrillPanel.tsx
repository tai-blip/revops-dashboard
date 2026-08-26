"use client";
// Generic click-a-number → see-the-deals panel.
//
// Tai's rule: every number on the dashboard should be clickable and explain itself. Rather than
// re-implement the Deal Health drill-down per table, a caller describes ONE spec — title, filter
// chips, the rows behind the number, and how to render/export each column — and this renders the
// panel, the running total, the CSV export and the clear button identically everywhere.
//
// Deliberately dumb: it does no filtering or arithmetic of its own. The caller passes the rows it
// already has, so a drill-down can never disagree with the number it came from (and no metric math
// lands in the UI — see AGENTS.md "Where calculations live").
import React from "react";
import { C, fmt, Th, Td } from "@/lib/ui";

export type DrillCol<T> = {
  label: string;
  l?: boolean;                       // left-align (text column)
  render: (row: T) => React.ReactNode;
  csv: (row: T) => string | number;  // flat value for the export
  mono?: boolean;
  bold?: boolean;
};

export type DrillSpec<T> = {
  title: string;                     // used for the CSV filename
  chips?: string[];                  // context pills: AE, stage, month…
  rows: T[];
  cols: DrillCol<T>[];
  amount: (row: T) => number;        // what to sum for the header total
  amountLabel?: string;              // e.g. "ARR", "cash", "Amount"
  emptyHint?: string;
  // Shown under the header when the rows do NOT simply sum to the number that was clicked —
  // because the cell is probability-weighted, or comes from a different (staler) source. Saying
  // so is the point of a drill-down; a silent mismatch is what destroys trust in one.
  note?: string;
};

const chipStyle = {
  fontSize: 11, fontWeight: 600 as const, color: C.t2, background: C.s2,
  border: `1px solid ${C.bd}`, borderRadius: 20, padding: "2px 10px",
};
const btn = (primary?: boolean) => ({
  padding: "6px 14px", fontSize: 12.5, fontWeight: 600 as const, borderRadius: 8,
  border: `1px solid ${C.bd}`, background: primary ? C.navy : "#fff",
  color: primary ? "#fff" : C.t2, cursor: "pointer" as const,
});
const eyebrow = {
  fontSize: 10.5, fontWeight: 700 as const, letterSpacing: ".07em",
  textTransform: "uppercase" as const, color: C.t3, marginBottom: 6,
};

// Style for a clickable number. Exported so every call site looks identical.
export const drillable = { cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: "3px" } as const;

function toCsv<T>(spec: DrillSpec<T>) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = spec.cols.map((c) => esc(c.label)).join(",");
  const body = spec.rows.map((r) => spec.cols.map((c) => esc(c.csv(r))).join(","));
  return [head, ...body].join("\n");
}

export function DrillPanel<T>({ spec, onClear }: { spec: DrillSpec<T> | null; onClear: () => void }) {
  if (!spec) {
    return (
      <>
        <div style={eyebrow}>Breakdown</div>
        <div style={{ padding: "22px 8px", textAlign: "center", color: C.t3, fontSize: 14, fontWeight: 600 }}>
          Choose a number to show your deals
        </div>
      </>
    );
  }
  const total = spec.rows.reduce((s, r) => s + spec.amount(r), 0);
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCsv(spec)], { type: "text/csv;charset=utf-8" }));
    a.download = `${spec.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={eyebrow}>Breakdown</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--font-dm-mono)", color: C.navy }}>{spec.rows.length}</span>
            <span style={{ fontSize: 13, color: C.t2 }}>
              {spec.rows.length === 1 ? "deal" : "deals"} · {fmt(total)}{spec.amountLabel ? ` ${spec.amountLabel}` : ""}
            </span>
            {(spec.chips ?? []).filter(Boolean).map((c) => <span key={c} style={chipStyle}>{c}</span>)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={download} style={btn(true)} disabled={!spec.rows.length}>⬇ Download CSV</button>
          <button onClick={onClear} style={btn()}>✕ Clear</button>
        </div>
      </div>
      {spec.note && (
        <div style={{ fontSize: 11.5, color: C.t2, background: C.s2, border: `1px solid ${C.bd}`,
          borderRadius: 8, padding: "7px 11px", marginBottom: 10, lineHeight: 1.5 }}>
          {spec.note}
        </div>
      )}
      {spec.rows.length === 0 ? (
        <div style={{ padding: "18px 8px", textAlign: "center", color: C.t3, fontSize: 13 }}>
          {spec.emptyHint ?? "No deals behind this number."}
        </div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.bd}` }}>
                {spec.cols.map((c) => <Th key={c.label} l={c.l}>{c.label}</Th>)}
              </tr>
            </thead>
            <tbody>
              {spec.rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.s1}` }}>
                  {spec.cols.map((c) => (
                    <Td key={c.label} l={c.l} mono={c.mono} bold={c.bold}>{c.render(r)}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
