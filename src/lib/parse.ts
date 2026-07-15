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
        newARR: Number(r[1] ?? 0), // New ARR Added ($)
        newBusiness: Number(r[2] ?? 0), // - New Business ($)
        expansion: Number(r[3] ?? 0), // - Biz Expansion ($)
        renewals: Number(r[4] ?? 0), // - Renewals ($)
        activeARR: Number(r[5] ?? 0), // Active ARR Snapshot ($)
        churnedARR: Number(r[11] ?? 0), // Churned ARR ($)
        changePct: r[13] != null ? Number(r[13]) : null, // MoM Change (%)
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
        newARR: Number(r[1] ?? 0),
        newBusiness: Number(r[2] ?? 0),
        expansion: Number(r[3] ?? 0),
        renewals: Number(r[4] ?? 0),
        activeARR: Number(r[5] ?? 0),
        churnedARR: Number(r[11] ?? 0),
        changePct: r[13] != null ? Number(r[13]) : null, // WoW Change (%)
      });
    }
  }

  return { monthly, weekly };
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
  }[] = [];
  const monthlySums = monthCols.map(() => 0);

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || typeof r[0] !== "string") break;
    reps.push({
      name: String(r[0]),
      quota: Number(r[1] ?? 0),
      pctOfQuota: Number(r[2] ?? 0),
      actual: Number(r[3] ?? 0),
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

  return { filterRep, weekLabels, weeks, newOppsMom, newArrMom };
}
