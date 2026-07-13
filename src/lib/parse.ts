// Helpers to turn raw Sheet rows into clean shapes for the dashboard.

type Row = (string | number | null)[];

export function parseArrTab(rows: Row[]) {
  // Find the monthly table: header row starts with "Month"
  const headerIdx = rows.findIndex((r) => r[0] === "Month");
  if (headerIdx === -1) return { monthly: [] };

  const monthly: {
    month: string;
    newARR: number;
    activeARR: number;
    churnedARR: number;
    momChangePct: number | null;
  }[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || typeof r[0] !== "string" || !/^\d{4}-\d{2}$/.test(r[0])) break;
    monthly.push({
      month: String(r[0]),
      newARR: Number(r[1] ?? 0),
      activeARR: Number(r[5] ?? 0),
      churnedARR: Number(r[10] ?? 0),
      momChangePct: r[12] != null ? Number(r[12]) : null,
    });
  }

  return { monthly };
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

  return { filterRep, weekLabels, weeks };
}
