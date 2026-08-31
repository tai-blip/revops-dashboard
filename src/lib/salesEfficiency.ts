// Sales Efficiency — HARDCODED for now (Tai, 2026-08-28).
//
// Slides 5 and 6 of the US Sales QBR deck, reproduced on the dashboard so leadership stops
// reading them out of a presentation. Every figure below is transcribed from that deck
// (Investor Summary / Investor Monthly, through Jun-26) and does NOT refresh — when the
// underlying investor model is wired up, replace this file with a source tab and nothing in
// the UI has to change.
//
// Deck: docs.google.com/presentation/d/1aq1iu2c26vSwNUnHOPNdCm6h5AnwAU5BeT-ueR-De7M
//
// BENCHMARKS — the deck drew 0.75 and 24 months. Tai reset them to 1.0 and 18 months, so the
// green/amber colouring here is stricter than the deck's: Q3'25 CAC (23 mo) reads green in the
// deck and red here, and that is intended.
export const SE_BENCH = { magic: 1.0, cacMonths: 18 };

export type SeQuarter = { q: string; magic: number; cac: number };

// Slide 5 — by quarter.
export const SE_BY_QUARTER: SeQuarter[] = [
  { q: "Q1'25", magic: 0.43, cac: 41 },
  { q: "Q2'25", magic: 0.73, cac: 34 },
  { q: "Q3'25", magic: 0.63, cac: 23 },
  { q: "Q4'25", magic: 1.62, cac: 12 },
  { q: "Q1'26", magic: 1.57, cac: 13 },
  { q: "Q2'26", magic: 0.48, cac: 38 },
];

// Slide 5 — by fiscal year.
export const SE_BY_FY = {
  cols: ["FY24", "FY25", "FY26 YTD"],
  rows: [
    { label: "Magic Number", values: ["1.00", "0.79", "0.84"] },
    { label: "CAC Payback (mo)", values: ["15.0", "21.2", "19.2"] },
    { label: "Net-New ARR", values: ["$1.41M", "$2.03M", "$1.52M"] },
    { label: "S&M Spend", values: ["$1.41M", "$2.57M", "$1.81M"] },
    { label: "Gross Margin %", values: ["80%", "71%", "74%"] },
  ],
};

// Slide 6 — trailing-twelve-month headline tiles.
export const SE_T12M = [
  { label: "Magic Number · T12M", value: "0.94", sub: "trailing 12 months" },
  { label: "CAC Payback · T12M", value: "17.5 mo", sub: "trailing 12 months" },
  { label: "Net-New ARR · T12M", value: "$2.99M", sub: "Δ total ARR" },
  { label: "S&M Spend · T12M", value: "$3.17M", sub: "trailing 12 months" },
];

// Slide 6 — rolling monthly series, Jul → Jun. Two lines each: the trailing-twelve-month view
// and the noisier 3-month view that swings with enterprise-deal timing.
export const SE_MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
export const SE_MAGIC_MONTHLY = {
  ttm: [0.60, 0.65, 0.67, 0.66, 0.76, 0.79, 0.79, 0.75, 1.02, 1.02, 1.00, 0.94],
  m3: [0.44, 0.72, 0.72, 0.77, 1.33, 1.41, 1.53, 0.46, 1.35, 1.23, 1.33, 0.40],
};
export const SE_CAC_MONTHLY = {
  ttm: [27, 25, 24, 25, 22, 21, 21, 23, 17, 17, 17, 18],
  m3: [40, 24, 23, 22, 13, 12, 11, 37, 13, 14, 12, 39],
};

// Slide 6 — what drives the two ratios.
export const SE_BUILD = {
  cols: ["Q1'25", "Q2'25", "Q3'25", "Q4'25", "Q1'26", "Q2'26"],
  rows: [
    { label: "Total ARR (end)", values: ["$2.39M", "$2.76M", "$3.21M", "$4.22M", "$5.35M", "$5.75M"] },
    { label: "Net-New ARR", values: ["$202K", "$369K", "$451K", "$1.01M", "$1.13M", "$398K"] },
    { label: "S&M Spend", values: ["$509K", "$720K", "$627K", "$717K", "$832K", "$975K"] },
    { label: "Gross Margin %", values: ["74%", "69%", "72%", "71%", "70%", "77%"] },
  ],
};

// ── Module 3 · Sales Cycle ────────────────────────────────────────────────────────────────
// Shape taken from the Sales Cycle workbook's first tab:
//   docs.google.com/spreadsheets/d/1FA4b7pa_KTJi78puhpz8KIpDSNO6KJy_AFoLeKYTBA8
// That sheet is a SKELETON — the rows, quarters and region toggle are defined but every cell
// is empty. So the table below is the structure with no numbers in it yet; once the sheet is
// populated this becomes a straight read.
export const SC_REGIONS = ["Total", "North America", "International"] as const;
export const SC_QUARTERS = [
  { q: "Q1'25", range: "Jan 2 – Apr 1" },
  { q: "Q2'25", range: "Apr 2 – Jul 1" },
  { q: "Q3'25", range: "Jul 2 – Oct 1" },
  { q: "Q4'25", range: "Oct 2 – Jan 1" },
  { q: "Q1'26", range: "Jan 2 – Apr 1" },
  { q: "Q2'26", range: "Apr 2 – Jul 1" },
  { q: "Q3'26 YTD", range: "Jul 2 – Oct 1" },
];
export const SC_SEGMENTS = ["SMB", "Mid Market", "Enterprise", "Mega-enterprise"] as const;
export const SC_ROWS: { key: string; label: string; note: string; segmented: boolean }[] = [
  { key: "won", label: "Total Deals Won", segmented: false,
    note: "The starting cohort — every deal won in the quarter. Everything below is measured on these deals." },
  { key: "cycle", label: "Total Sales Cycle", segmented: true,
    note: "Days from first touch to Closed Won, averaged over the cohort." },
  { key: "sql", label: "SQL", segmented: true, note: "Average days the won deals spent in SQL." },
  { key: "sal", label: "SAL", segmented: true, note: "Average days the won deals spent in SAL." },
  { key: "sqo", label: "SQO", segmented: true, note: "Average days the won deals spent in SQO." },
  { key: "pilot", label: "Pilot", segmented: true, note: "Average days the won deals spent in Trial." },
  { key: "billing", label: "Billing", segmented: true, note: "Average days the won deals spent in Billing." },
];
