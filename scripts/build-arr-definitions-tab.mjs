// "ARR Definitions" tab — the single sheet page that says what each ARR term MEANS and what it
// currently EQUALS, written straight from the dashboard's own API so the two can never disagree.
//
// Why this exists: Revie answers questions out of the Sheet, and the ARR funnel's tiers are
// computed in the dashboard code (see the note in src/lib/deals.ts). Without this tab Revie has
// no sheet-side view of the numbers people actually see, so it either guesses or quotes a stale
// snapshot tab. This mirrors the dashboard exactly — same source, same figures, four sections:
//
//   ①  DEFINITIONS   one row per term: what it means, the rule, today's value, today's deal count
//   ②  KEY → VALUE   machine-readable block (arr_pilot, arr_invoiced, …) for formulas and Revie
//   ③  MONTHLY       the dashboard's MoM funnel table, Jan-26 → now, column for column
//   ④  DEALS TODAY   every deal in Booked Pilot right now with the tier it sits in
//
// Vocabulary is the standard agreed on the Weekly Forecast Call, 2026-08-26 (Andrew, Sai,
// Stephen, Davi, Tai): "live ARR = invoiced ARR + billed ARR, and bookings = live ARR + pilot
// bookings". Internally the dashboard still keys these as booked/contracted/live — do not rename
// those keys, the ARR_Funnel tier formulas and the snapshot tabs match on the old words.
//
// This tab is a MIRROR, not a source: it is rewritten in full on every run and any manual edit is
// overwritten. Nothing else reads from it, so it cannot move a number on the dashboard.
//
// Run: node --env-file=.env scripts/build-arr-definitions-tab.mjs
//   local dev server:  DASH_API_URL=http://localhost:3010 node --env-file=.env scripts/…
//   CI: DASH_API_URL = the prod origin, CRON_TOKEN = the shared token (see src/proxy.ts)
import { google } from "googleapis";
import fs from "node:fs";

const TAB = "ARR Definitions";
const API = (process.env.DASH_API_URL || "http://localhost:3000").replace(/\/+$/, "") + "/api/dashboard";

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function loadDash() {
  try { if (fs.existsSync("/tmp/dash.json")) return JSON.parse(fs.readFileSync("/tmp/dash.json", "utf-8")); } catch {}
  const headers = process.env.CRON_TOKEN ? { "x-cron-token": process.env.CRON_TOKEN } : {};
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(API, { headers, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.message; }
    console.log(`arr-definitions: fetch ${API} failed (${i}/3): ${last}`);
    if (i < 3) await new Promise((r) => setTimeout(r, 2000 * i));
  }
  throw new Error(`could not read ${API}: ${last}`);
}

// The three tiers, in funnel order, with the rule each one applies. Keys are the dashboard's
// internal ones; `label` is what the dashboard and the team now call them.
const TIERS = [
  { key: "booked", label: "Pilot", means: "In an active pilot. Not signed yet, so not revenue.",
    rule: "Stage = Trial AND Pilot Start Date is set. ARR >= 0, so $0 pilots are kept." },
  { key: "contracted", label: "Contracted", means: "Awaiting Billing — signed and contract-live, but payment has not started yet (Rip & Replace or billing timing).",
    rule: "Stage = Billing or Closed Won, Contract Live Date reached, no Live Paying Date yet, contract not ended, not churned or paused." },
  { key: "live", label: "Billed", means: "Paying. Money is arriving.",
    rule: "Stage = Billing or Closed Won, Live Paying Date reached, contract not ended, not churned or paused." },
];
const ROLLUPS = [
  { key: "liveArr", label: "Live ARR", means: "The whole signed contract-live book, whether or not payment has started. This is the headline ARR figure.",
    rule: "Contracted + Billed. Agreed on the Weekly Forecast Call 2026-08-26." },
  { key: "bookedPilot", label: "Booked Pilot", means: "The signed book plus what is still in pilot. The widest view.",
    rule: "Live ARR + Pilot." },
];

async function main() {
  const dash = await loadDash();
  const AF = dash.arrFunnel;
  if (!AF?.stock?.length) throw new Error("the API returned no arrFunnel — nothing to mirror");
  const now = AF.stock[AF.stock.length - 1];
  const idx = AF.dealIndex ?? [];
  const dealsIn = (bucket) => (now.ids?.[bucket] ?? []).map((n) => idx[n]).filter(Boolean);
  const money = (n) => Math.round(n);

  const rows = [];
  const blank = () => rows.push([]);
  rows.push([`ARR Definitions — what each term means and what it equals today`]);
  rows.push([`Auto-written by scripts/build-arr-definitions-tab.mjs from the dashboard API. Rewritten in full on every run — manual edits are overwritten.`]);
  rows.push([`Last updated`, new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
    `Mirrors the dashboard's "Booked ARR & Cashflow" tab as of ${now.label}.`]);
  blank();

  // ① definitions
  rows.push(["① DEFINITIONS"]);
  rows.push(["Term", "What it means", "The rule", "Today ($)", "Deals", "Internal key"]);
  for (const t of [...TIERS, ...ROLLUPS]) {
    rows.push([t.label, t.means, t.rule, money(now[t.key] ?? 0), dealsIn(t.key).length, t.key]);
  }
  blank();
  rows.push(["Note", "A deal sits in exactly ONE of Pilot / Contracted / Billed at a time, so the roll-ups never double-count: Live ARR and Booked Pilot are simple sums of the tiers above them."]);
  blank();

  // ② machine-readable key → value, same shape as the Headline / Targets source tabs
  rows.push(["② KEY → VALUE", "(read this block by key; layout above may shift)"]);
  rows.push(["key", "value"]);
  for (const t of [...TIERS, ...ROLLUPS]) {
    const slug = t.label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    rows.push([`arr_${slug}`, money(now[t.key] ?? 0)]);
    rows.push([`arr_${slug}_deals`, dealsIn(t.key).length]);
  }
  rows.push(["arr_as_of_month", now.ym]);
  rows.push(["arr_as_of_label", now.label]);
  blank();

  // ③ the dashboard's monthly table, column for column
  rows.push(["③ MONTHLY — point-in-time ARR in each tier at month-end (same table the dashboard shows)"]);
  rows.push(["Month", "Pilot", "$ P→Lost", "$ P→Con", "Contracted", "Contracted Renewal", "Contracted Expansion",
    "$ Con→Billed", "Billed", "Churn", "Live ARR", "Booked Pilot", "MoM (Live ARR)"]);
  AF.stock.forEach((p, i) => {
    const prev = AF.stock[i - 1];
    rows.push([p.label, money(p.booked), money(p.bToLost), money(p.bToC), money(p.contracted),
      money(p.contractedRenewal), money(p.contractedNewExp), money(p.cToL), money(p.live),
      money(p.churn), money(p.liveArr), money(p.bookedPilot),
      prev ? money(p.liveArr - prev.liveArr) : ""]);
  });
  blank();

  // ④ deal-level — every deal in the widest roll-up, tagged with its tier
  const tierOfDeal = new Map();
  for (const t of TIERS) for (const d of dealsIn(t.key)) tierOfDeal.set(d, t.label);
  const all = dealsIn("bookedPilot").sort((a, b) => b.arr - a.arr);
  rows.push([`④ DEALS TODAY — every deal inside Booked Pilot (${all.length} deals · $${money(now.bookedPilot).toLocaleString()}), tagged with its tier`]);
  rows.push(["Tier", "Deal", "Account", "AE", "AM", "Type", "Stage", "ARR", "Trial", "Contract live", "Live paying", "Ends", "R&R"]);
  for (const d of all) {
    rows.push([tierOfDeal.get(d) ?? "?", d.opp || d.account, d.account, d.owner, d.am, d.type,
      d.stage, money(d.arr), d.trial, d.liveDate, d.livePay, d.end, d.rr ? "Yes" : ""]);
  }

  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title,gridProperties)" });
  let sheet = meta.data.sheets.find((s) => s.properties.title === TAB);
  if (!sheet) {
    const add = await api.spreadsheets.batchUpdate({ spreadsheetId: ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 200, columnCount: 14, frozenRowCount: 0 } } } }] } });
    sheet = { properties: add.data.replies[0].addSheet.properties };
    console.log(`created tab "${TAB}"`);
  }
  // Grow the grid before writing — a values.update past the grid edge is rejected outright.
  const gp = sheet.properties.gridProperties ?? {};
  if ((gp.rowCount ?? 0) < rows.length + 50 || (gp.columnCount ?? 0) < 14) {
    await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{
      updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId,
        gridProperties: { rowCount: Math.max(rows.length + 200, gp.rowCount ?? 0), columnCount: Math.max(14, gp.columnCount ?? 0) } },
        fields: "gridProperties.rowCount,gridProperties.columnCount" } }] } });
  }
  // Clear then write. RAW: every cell here is a value the dashboard computed — writing it
  // USER_ENTERED would let a leading "+" or "-" be parsed as a broken formula.
  await api.spreadsheets.values.clear({ spreadsheetId: ID, range: `'${TAB}'!A1:N100000` });
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`,
    valueInputOption: "RAW", requestBody: { values: rows.map((r) => (r.length ? r : [""])) } });

  console.log(`"${TAB}" written — ${rows.length} rows.`);
  console.log(`  as of ${now.label}: Pilot $${money(now.booked).toLocaleString()} · Contracted $${money(now.contracted).toLocaleString()} · Billed $${money(now.live).toLocaleString()}`);
  console.log(`  Live ARR $${money(now.liveArr).toLocaleString()} (${dealsIn("liveArr").length} deals) · Booked Pilot $${money(now.bookedPilot).toLocaleString()} (${all.length} deals)`);
}

main().catch((e) => { console.error("arr-definitions:", e.message || e); process.exit(1); });
