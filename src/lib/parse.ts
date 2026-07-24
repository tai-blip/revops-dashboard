// Helpers to turn raw Sheet rows into clean shapes for the dashboard.

type Row = (string | number | null)[];

// Google Sheets API (UNFORMATTED_VALUE) returns dates as serial day-numbers
// (days since Dec 30, 1899), not JS Dates or ISO strings. Convert properly.
function sheetsSerialToISODate(v: unknown): string {
  if (typeof v === "number") {
    const ms = Date.UTC(1899, 11, 30) + v * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof v === "string") return v.slice(0, 10);
  return String(v ?? "");
}

export type ArrPoint = {
  label: string;
  newARR: number;
  newBusiness: number;
  expansion: number;
  renewals: number;
  activeARR: number;
  churnedARR: number;
  changePct: number | null;
  alfie: number;
  managedServices: number;
  coreExisting: number;
  alfieTarget: number;
  msTarget: number;
};

export function parseArrTab(rows: Row[]) {
  // Monthly section — header on the row starting with "Month"
  const monthlyHeaderIdx = rows.findIndex((r) => r[0] === "Month");
  const monthly: ArrPoint[] = [];
  if (monthlyHeaderIdx !== -1) {
    for (let i = monthlyHeaderIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0] || typeof r[0] !== "string" || !/^\d{4}-\d{2}$/.test(r[0])) break;
      monthly.push({
        label: String(r[0]),
        newARR: Number(r[2] ?? 0) + Number(r[3] ?? 0), // New ARR = New Business + Expansion (renewals excluded; sheet col r[1] "New ARR Added" bundles renewals in)
        newBusiness: Number(r[2] ?? 0), // - New Business ($)
        expansion: Number(r[3] ?? 0), // - Biz Expansion ($)
        renewals: Number(r[4] ?? 0), // - Renewals ($)
        activeARR: Number(r[5] ?? 0), // Active ARR Snapshot ($)
        churnedARR: Number(r[11] ?? 0), // Churned ARR ($)
        changePct: r[22] != null ? Number(r[22]) : null, // MoM Change (%)
        alfie: Number(r[12] ?? 0), // Chat Agent Alfie ($) = M
        managedServices: Number(r[14] ?? 0), // Managed Services ($) = O
        coreExisting: Number(r[16] ?? 0), // Core Existing Features ($) = Q
        alfieTarget: Number(r[13] ?? 0), // Monthly Target (Agent) = N
        msTarget: Number(r[15] ?? 0), // Monthly Target (Managed Service) = P
      });
    }
  }

  // Weekly section — header on the row starting with "Week Starting"
  const weeklyHeaderIdx = rows.findIndex((r) => r[0] === "Week Starting");
  const weekly: ArrPoint[] = [];
  if (weeklyHeaderIdx !== -1) {
    for (let i = weeklyHeaderIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0]) break;
      // Week Starting is a date (parsed as string by Sheets API in serial or ISO form)
      const rawLabel = r[0] as unknown;
      const label = sheetsSerialToISODate(rawLabel);
      weekly.push({
        label,
        newARR: Number(r[2] ?? 0) + Number(r[3] ?? 0), // New ARR = New Business + Expansion (renewals excluded)
        newBusiness: Number(r[2] ?? 0),
        expansion: Number(r[3] ?? 0),
        renewals: Number(r[4] ?? 0),
        activeARR: Number(r[5] ?? 0),
        churnedARR: Number(r[11] ?? 0),
        changePct: r[22] != null ? Number(r[22]) : null, // WoW Change (%)
        alfie: Number(r[12] ?? 0),
        managedServices: Number(r[14] ?? 0),
        coreExisting: Number(r[16] ?? 0),
        alfieTarget: Number(r[13] ?? 0),
        msTarget: Number(r[15] ?? 0),
      });
    }
  }

  return { monthly, weekly };
}

// "ARR MoM Progression" tab — the authoritative Total-ARR history that drives the
// "Path to $10M" trend and the Command Live-ARR headline. Columns:
// Month | Total ARR | MoM Change ($) | MoM Growth (%)
export type ArrMomPoint = {
  label: string; // "YYYY-MM"
  totalARR: number;
  momChange: number;
  momGrowth: number; // percent units, e.g. 3.12 means 3.12%
};

export function parseArrMomProgressionTab(rows: Row[]): ArrMomPoint[] {
  const headerIdx = rows.findIndex((r) => r[0] === "Month");
  const out: ArrMomPoint[] = [];
  if (headerIdx === -1) return out;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] == null || r[0] === "") break;
    const label = sheetsSerialToISODate(r[0]).slice(0, 7); // "2026-07"
    if (!/^\d{4}-\d{2}$/.test(label)) continue;
    out.push({
      label,
      totalARR: Number(r[1] ?? 0),
      momChange: Number(r[2] ?? 0),
      momGrowth: Number(r[3] ?? 0),
    });
  }
  return out;
}

// "ARR_MoM_Rebuild" tab — the automated SFDC-sourced Total-ARR series (Rule A),
// written daily by scripts/refresh-arr-from-sfdc.mjs. Replaces the manual
// Tableau-download series as the driver of the Command ARR chart.
// Cols: A label, B month-end (serial), C Rule A, H MoM change $, I MoM growth (fraction).
export function parseArrMomRebuildTab(rows: Row[]): ArrMomPoint[] {
  const out: ArrMomPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r?.[1] == null || typeof r[2] !== "number" || r[2] <= 0) continue;
    out.push({
      label: sheetsSerialToISODate(r[1]).slice(0, 7),
      totalARR: r[2],
      momChange: typeof r[7] === "number" ? r[7] : 0,
      momGrowth: typeof r[8] === "number" ? r[8] * 100 : 0, // sheet stores a fraction; keep % units like the manual tab
    });
  }
  return out;
}

// "ACV_MoM" tab — avg ACV of deals won each month, by Segment / Region / AE
// (sheet-computed AVERAGEIFS so the numbers are auditable in the workbook).
export type AcvMomData = {
  months: string[]; // display labels e.g. "Jul 2026"
  all: (number | null)[];
  groups: { key: "segment" | "region" | "ae"; series: { name: string; values: (number | null)[] }[] }[];
};

export function parseAcvMomTab(rows: Row[]): AcvMomData | null {
  if (rows.length < 2) return null;
  const header = rows[0].map((h) => String(h ?? ""));
  const data = rows.slice(1).filter((r) => r?.[0]);
  const months = data.map((r) => String(r[0]));
  const colVals = (c: number) => data.map((r) => (typeof r[c] === "number" ? (r[c] as number) : null));
  const group = (prefix: string) =>
    header
      .map((h, c) => ({ h, c }))
      .filter(({ h }) => h.startsWith(prefix))
      .map(({ h, c }) => ({ name: h.slice(prefix.length), values: colVals(c) }));
  return {
    months,
    all: colVals(2),
    groups: [
      { key: "segment", series: group("Seg: ") },
      { key: "region", series: group("Reg: ") },
      { key: "ae", series: group("AE: ") },
    ],
  };
}

// "$ / Location" series from the ARR_MoM_Segments tab (last 13 rows ≈ 12 months
// + current). Cols: A label, C total ARR, AA active locations, AB $/location.
export type PerLocationData = {
  months: string[];
  perLoc: (number | null)[];
  locations: (number | null)[];
  arr: (number | null)[];
};

export function parsePerLocation(rows: Row[]): PerLocationData | null {
  const data = rows.slice(1).filter((r) => r?.[0] && typeof r[2] === "number");
  if (!data.length) return null;
  const tail = data.slice(-13);
  const num = (v: string | number | null) => (typeof v === "number" ? v : null);
  return {
    months: tail.map((r) => String(r[0])),
    perLoc: tail.map((r) => num(r[27])),
    locations: tail.map((r) => num(r[26])),
    arr: tail.map((r) => num(r[2])),
  };
}

export function parseAeAttainmentTab(rows: Row[]) {
  const headerIdx = rows.findIndex((r) => r[0] === "AE");
  if (headerIdx === -1) return { reps: [], monthlyTeamActual: [] };

  const headerRow = rows[headerIdx];
  // Month columns repeat every 3 starting at index 4: Month, MoM$, MoM%
  const monthCols: { idx: number; label: string }[] = [];
  for (let c = 4; c < headerRow.length; c += 3) {
    const v = headerRow[c];
    if (typeof v === "string" && /^[A-Za-z]{3}-\d{2}$/.test(v)) {
      monthCols.push({ idx: c, label: v });
    }
  }

  const reps: {
    name: string;
    quota: number;
    pctOfQuota: number;
    actual: number;
    nb: number;
    exp: number;
  }[] = [];
  const monthlySums = monthCols.map(() => 0);

  // Optional per-rep Closed-Won breakdown columns, matched by header name so
  // position doesn't matter. If absent, nb/exp stay 0 and the card falls back.
  const findCol = (kw: string) =>
    headerRow.findIndex((c) => typeof c === "string" && c.toLowerCase().includes(kw));
  const nbCol = findCol("new business");
  const expCol = findCol("expansion");
  const cwCol = findCol("closed won");

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || typeof r[0] !== "string") break;
    reps.push({
      name: String(r[0]),
      quota: Number(r[1] ?? 0),
      pctOfQuota: Number(r[2] ?? 0),
      actual: cwCol >= 0 ? Number(r[cwCol] ?? 0) : Number(r[3] ?? 0),
      nb: nbCol >= 0 ? Number(r[nbCol] ?? 0) : 0,
      exp: expCol >= 0 ? Number(r[expCol] ?? 0) : 0,
    });
    monthCols.forEach((m, mi) => {
      monthlySums[mi] += Number(r[m.idx] ?? 0);
    });
  }

  const monthlyTeamActual = monthCols.map((m, i) => ({
    label: m.label,
    actual: monthlySums[i],
  }));

  return { reps, monthlyTeamActual };
}

type MetricRow = { metric: string; value: number; kind: "currency" | "count" | "percent" | "ratio" };
type BreakdownRow = { label: string; opps: number; arr: number; pctOfTotal: number };
type StageWeightRow = { stage: string; arr: number; probability: number; weighted: number };
type AeBreakdownRow = { name: string; quota: number | null; actual: number };

export function parsePipelineTab(rows: Row[]) {
  const filterRow = rows.find((r) => r[4] === "🔍 Filter by Rep:");
  const filterRep = filterRow ? String(filterRow[5]) : "All";

  const metricSections: Record<string, MetricRow[]> = {};
  const breakdownSections: Record<string, BreakdownRow[]> = {};
  let stageWeights: StageWeightRow[] = [];
  let aeBreakdown: AeBreakdownRow[] = [];

  let currentSection = "";
  let mode: "metric" | "breakdown" | "weight" | "ae" | "" = "";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = r[0];

    if (typeof label === "string" && /^\d+\./.test(label)) {
      currentSection = label;
      mode = "";
      continue;
    }
    if (label === "AE Pipeline Breakdown") {
      mode = "ae";
      continue;
    }
    if (label === "Metric" && r[1] === "Value") {
      mode = "metric";
      metricSections[currentSection] = [];
      continue;
    }
    if (r[1] === "# Opps" && r[2] === "Total ARR") {
      mode = "breakdown";
      breakdownSections[currentSection] = [];
      continue;
    }
    if (label === "Stage" && r[1] === "Total ARR" && r[2] === "Probability %") {
      mode = "weight";
      continue;
    }
    if (label === "AE Name") {
      mode = "ae";
      continue;
    }

    if (!label || typeof label !== "string") continue;

    if (mode === "metric" && typeof r[1] === "number") {
      const l = label.toLowerCase();
      const kind: MetricRow["kind"] = l.includes("ratio")
        ? "ratio"
        : l.includes("%")
        ? "percent"
        : l.startsWith("#") || l.includes("# new") || l.includes("total opportunities")
        ? "count"
        : "currency";
      metricSections[currentSection].push({ metric: label, value: r[1], kind });
    } else if (mode === "breakdown" && typeof r[1] === "number") {
      breakdownSections[currentSection].push({
        label,
        opps: Number(r[1] ?? 0),
        arr: Number(r[2] ?? 0),
        pctOfTotal: Number(r[3] ?? 0),
      });
    } else if (mode === "weight" && typeof r[1] === "number") {
      stageWeights.push({
        stage: label,
        arr: Number(r[1] ?? 0),
        probability: Number(r[2] ?? 0),
        weighted: Number(r[3] ?? 0),
      });
    } else if (mode === "ae" && (typeof r[1] === "number" || r[1] == null)) {
      aeBreakdown.push({
        name: label,
        quota: typeof r[1] === "number" ? r[1] : null,
        actual: Number(r[2] ?? 0),
      });
    }
  }

  return { filterRep, metricSections, breakdownSections, stageWeights, aeBreakdown };
}

export function parsePipelineWowTab(rows: Row[]) {
  const filterRow = rows.find((r) => r[0] === "🔍 Filter by Rep:");
  const filterRep = filterRow ? String(filterRow[1]) : "All";

  const headerIdx = rows.findIndex((r) => r[0] === "Metric");
  const weeks: { metric: string; values: (number | null)[] }[] = [];
  let weekLabels: string[] = [];

  if (headerIdx !== -1) {
    weekLabels = rows[headerIdx]
      .slice(1)
      .filter((v): v is string => typeof v === "string");

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0] || typeof r[0] !== "string") break;
      weeks.push({
        metric: String(r[0]),
        values: r.slice(1, weekLabels.length + 1).map((v) =>
          typeof v === "number" ? v : null
        ),
      });
    }
  }

  // Rep-by-rep MoM tables: "New Opps Entered (SQL)" and "New ARR Created ($)"
  function parseRepTable(sectionMarker: string) {
    const idx = rows.findIndex(
      (r) => typeof r[0] === "string" && r[0].includes(sectionMarker)
    );
    if (idx === -1) return { months: [] as string[], reps: {} as Record<string, number[]> };

    const headerRow = rows[idx + 1];
    const months = headerRow
      .slice(1, -1) // drop "Rep" and trailing "TOTAL"
      .filter((v): v is string => typeof v === "string");

    const reps: Record<string, number[]> = {};
    for (let i = idx + 2; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0] || typeof r[0] !== "string") break;
      reps[String(r[0])] = r.slice(1, 1 + months.length).map((v) => Number(v ?? 0));
    }
    return { months, reps };
  }

  const newOppsMom = parseRepTable("MONTH OVER MONTH — New Opps Entered");
  const newArrMom = parseRepTable("MONTH OVER MONTH — New ARR Created");

  // Net New ARR + Expansion ARR MoM blocks (Ask 3). Match by title text with a
  // month-header sanity check, trying specific → broad so a stray keyword hit
  // (e.g. an "Expansion Lead" stage row) can't be mistaken for the block.
  function parseRepTableAny(markers: string[]) {
    const monthish = (s: string) => /^[A-Za-z]{3}[-\s]?\d{2,4}$/.test(s);
    for (const m of markers) {
      const t = parseRepTable(m);
      if (t.months.some(monthish) && Object.keys(t.reps).length) return t;
    }
    return { months: [] as string[], reps: {} as Record<string, number[]> };
  }
  const netNewArrMom = parseRepTableAny([
    "MONTH OVER MONTH — Net New ARR",
    "Net New ARR Created",
    "Net New ARR",
    "Net New",
  ]);
  const expansionArrMom = parseRepTableAny([
    "MONTH OVER MONTH — Expansion ARR",
    "Expansion ARR Created",
    "Expansion ARR",
    "MONTH OVER MONTH — Expansion",
    "Expansion Created",
    "Biz Expansion",
    "Expansion",
  ]);

  return { filterRep, weekLabels, weeks, newOppsMom, newArrMom, netNewArrMom, expansionArrMom };
}
