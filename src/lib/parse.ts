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
  if (headerIdx === -1) return { reps: [] };

  const reps: {
    name: string;
    quota: number;
    pctOfQuota: number;
    actual: number;
  }[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || typeof r[0] !== "string") break;
    reps.push({
      name: String(r[0]),
      quota: Number(r[1] ?? 0),
      pctOfQuota: Number(r[2] ?? 0),
      actual: Number(r[3] ?? 0),
    });
  }

  return { reps };
}

export function parsePipelineTab(rows: Row[]) {
  const filterRow = rows.find((r) => r[4] === "🔍 Filter by Rep:");
  const filterRep = filterRow ? String(filterRow[5]) : "All";

  const sections: Record<string, { metric: string; value: number }[]> = {};
  let currentSection = "";

  for (const r of rows) {
    if (r[0] && typeof r[0] === "string" && /^\d\./.test(r[0])) {
      currentSection = r[0];
      sections[currentSection] = [];
    } else if (
      currentSection &&
      r[0] &&
      r[0] !== "Metric" &&
      r[0] !== "Stage" &&
      typeof r[1] === "number"
    ) {
      sections[currentSection].push({
        metric: String(r[0]),
        value: Number(r[1]),
      });
    }
  }

  return { filterRep, sections };
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
