// Rebuilds the AE-facing "Stale Deals — By Rep" tab for the DEAL MOVEMENT initiative and
// prints the email section's data. Runs weekly (Friday) as part of the ops-excellency task.
//
// ── POLICY (Tai, 2026-08-21) ──────────────────────────────────────────────────
//   • SQL deals stale > 60 days  → MOVED to Closed Lost, reason "Stale > 60 days".
//   • SAL / SQO deals > 60 days  → tracked & reported (not auto-moved yet).
//   Stale = days since LastStageChangeDate (else CreatedDate). New Business only,
//   open opps, excl. owners Osman Mubarak (out of cohort) and Tai Nguyen (test).
//   Value = Amount (org-wide rule, 2026-08-21). AEs rescue a deal by advancing its
//   stage (or logging real next steps + stage move) before the sweep — a stage
//   change resets the clock and drops it off the list.
// ──────────────────────────────────────────────────────────────────────────────
//
// The mover is scripts/sweep-stale-sql.mjs (first sweep ran 2026-08-21: 77/77 moved, reason
// picklist "Stale" + details "Stale > 60 days"). This script reads its "Deal Movement — Log"
// tab for ACTUAL moved numbers, and tracks the still-open SQL/SAL/SQO >60d cohorts.
//
// Run: node --env-file=.env scripts/refresh-stale-deals.mjs
import { google } from "googleapis";

const REP_SHEET = "1dHpM2O_8tZfsEGmbIz_W59_qe5gI5NQ5THW_v5DWphc";
const TAB = "Stale Deals — By Rep";
const STALE_DAYS = 60;
const MOVE_STAGE = "SQL";                 // auto-moved by sweep-stale-sql.mjs
const TRACK_STAGES = ["SAL", "SQO"];      // tracked, not moved (yet)
const LOG_TAB = "Deal Movement — Log";
const EXCLUDE_OWNERS = ["Osman Mubarak", "Tai Nguyen"];
const CL_REASON = "Stale > 60 days";
const SWEEP_DATE = "2026-09-04";          // first sweep (2-week grace from 21 Aug announce)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isTransient(e) {
  const code = e?.code ?? e?.status ?? e?.response?.status;
  if ([408, 429, 500, 502, 503, 504].includes(Number(code))) return true;
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  return /\b(429|500|502|503|504)\b|rate.?limit|timeout|timed out|econnreset|socket hang|network|fetch failed|try again|backend error/.test(msg);
}
async function retry(label, fn, tries = 5, baseMs = 1000) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries - 1 || !isTransient(e)) throw e; const w = baseMs * 2 ** i; console.warn(`  ↻ retry ${label} in ${w}ms`); await sleep(w); }
  }
}
async function fetchJSON(url, opts, label) {
  return retry(label, async () => {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(45000) });
    if (!r.ok) { const b = await r.text().catch(() => ""); const err = new Error(`${label} HTTP ${r.status} ${b.slice(0, 140)}`); err.status = r.status; throw err; }
    return r.json();
  });
}
async function sfAuth() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const j = await fetchJSON(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, "sf-auth");
  return { token: j.access_token, instance: j.instance_url };
}
async function sfQueryAll(instance, token, soql) {
  const v = process.env.SF_API_VERSION || "59.0";
  let url = `${instance}/services/data/v${v}/query?q=${encodeURIComponent(soql)}`;
  const out = [];
  while (url) { const j = await fetchJSON(url, { headers: { Authorization: `Bearer ${token}` } }, "sf-query"); out.push(...j.records); url = j.done ? null : `${instance}${j.nextRecordsUrl}`; }
  return out;
}

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const money = (n) => "$" + Math.round(n || 0).toLocaleString();
const today = new Date().toISOString().slice(0, 10);
const SF_LIGHTNING = "https://fun-ruby-7024.lightning.force.com";
const oppLink = (id) => `=HYPERLINK("${SF_LIGHTNING}/lightning/r/Opportunity/${id}/view","${id}")`;

async function main() {
  const { token, instance } = await sfAuth();
  const stages = [MOVE_STAGE, ...TRACK_STAGES].map((s) => `'${s}'`).join(",");
  const owners = EXCLUDE_OWNERS.map((o) => `'${o}'`).join(",");
  const recs = await sfQueryAll(instance, token,
    `SELECT Id, Name, Account.Name, Owner.Name, StageName, Amount, LastStageChangeDate, CreatedDate
     FROM Opportunity WHERE IsClosed = false AND RecordType.Name = '1.New Business'
       AND StageName IN (${stages}) AND Owner.Name NOT IN (${owners})`.replace(/\s+/g, " "));
  const now = Date.now();
  const deals = recs.map((x) => {
    const basis = x.LastStageChangeDate || x.CreatedDate;
    const days = Math.floor((now - Date.parse(basis)) / 86400000);
    return { id: x.Id, name: x.Account?.Name || x.Name, rep: x.Owner?.Name ?? "?", stage: x.StageName,
      amt: x.Amount || 0, days, lastChange: String(basis).slice(0, 10) };
  }).filter((d) => d.days > STALE_DAYS);

  // moved deals — actuals from the sweep log
  const api0 = google.sheets({ version: "v4", auth: gAuth });
  const logRows = (await retry("log", () => api0.spreadsheets.values.get({ spreadsheetId: REP_SHEET, range: `'${LOG_TAB}'!A2:H5000`, valueRenderOption: "UNFORMATTED_VALUE" }))).data.values?.filter((r) => r[6] === "MOVED") ?? [];
  const movedDeals = logRows.map((r) => ({ movedOn: String(r[0]), id: String(r[1]), name: r[2], rep: r[3], amt: +r[4] || 0, days: +r[5] || 0 }));

  // group by rep: moved (log) + still-open cohorts
  const byRep = {};
  const ensure = (rep) => (byRep[rep] ??= { rep, movedN: 0, movedAmt: 0, pendingSqlN: 0, salN: 0, sqoN: 0, deals: [], movedList: [] });
  for (const m of movedDeals) { const g = ensure(m.rep); g.movedN++; g.movedAmt += m.amt; g.movedList.push(m); }
  for (const d of deals) {
    const g = ensure(d.rep);
    if (d.stage === MOVE_STAGE) g.pendingSqlN++;
    else if (d.stage === "SAL") g.salN++;
    else if (d.stage === "SQO") g.sqoN++;
    g.deals.push(d);
  }
  const reps = Object.values(byRep).sort((a, b) => b.movedAmt - a.movedAmt || b.movedN - a.movedN);
  for (const g of reps) { g.movedList.sort((a, b) => b.amt - a.amt); g.deals.sort((a, b) => b.days - a.days); }
  const tot = { movedN: reps.reduce((s, g) => s + g.movedN, 0), movedAmt: reps.reduce((s, g) => s + g.movedAmt, 0),
    salN: reps.reduce((s, g) => s + g.salN, 0), sqoN: reps.reduce((s, g) => s + g.sqoN, 0),
    pendingSqlN: reps.reduce((s, g) => s + g.pendingSqlN, 0) };

  // ---- build the rescue tab ----
  const rows = [
    [`DEAL MOVEMENT — Stale cleanup · rebuilt ${today}`],
    [`Policy: SQL deals with no stage movement in >${STALE_DAYS} days are moved to Closed Lost (reason "${CL_REASON}"). First sweep ran 2026-08-21 — red "Cleaned up" rows below were moved. SAL/SQO >${STALE_DAYS}d are tracked and age toward the line.`],
    [`RESCUE = click the Opp ID. Moved but still live? Reopen the opp to its correct stage — it re-enters the pipeline. SAL/SQO on the list? Advance the stage / log the real next step to reset the clock.`],
    [],
    ["MOVEMENT SUMMARY", "", "", "", ""],
    ["Rep", `SQL moved (> ${STALE_DAYS}d)`, "Amount", `SAL > ${STALE_DAYS}d`, `SQO > ${STALE_DAYS}d`],
    ...reps.map((g) => [g.rep, g.movedN, Math.round(g.movedAmt), g.salN, g.sqoN]),
    ["TOTAL", tot.movedN, Math.round(tot.movedAmt), tot.salN, tot.sqoN],
    [],
  ];
  const header = ["Opp ID", "Account / Opportunity", "Stage", "Days in stage", "Amount", "Moved on / last change", "Cleaned up"];
  const cleanedCells = []; // [rowIndex0] rows whose G cell gets the red box
  for (const g of reps) {
    rows.push([`▸ ${g.rep} — ${g.movedN} SQL moved (${money(g.movedAmt)}) · ${g.salN} SAL / ${g.sqoN} SQO >${STALE_DAYS}d${g.pendingSqlN ? ` · ${g.pendingSqlN} SQL pending next sweep` : ""}`]);
    rows.push(header);
    for (const m of g.movedList) {
      cleanedCells.push(rows.length);
      rows.push([oppLink(m.id), m.name, "Closed Lost", m.days, m.amt || "", m.movedOn, "Cleaned up"]);
    }
    for (const d of g.deals) {
      const pending = d.stage === MOVE_STAGE;
      rows.push([oppLink(d.id), d.name, d.stage, d.days, d.amt || "", d.lastChange, pending ? "next sweep" : ""]);
    }
    rows.push([]);
  }

  const api = google.sheets({ version: "v4", auth: gAuth });
  const meta = await retry("meta", () => api.spreadsheets.get({ spreadsheetId: REP_SHEET, fields: "sheets.properties(sheetId,title,gridProperties)" }));
  let props = meta.data.sheets.find((s) => s.properties.title === TAB)?.properties;
  if (!props) {
    const res = await retry("add-tab", () => api.spreadsheets.batchUpdate({ spreadsheetId: REP_SHEET, requestBody: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 20, columnCount: 8 } } } }] } }));
    props = res.data.replies[0].addSheet.properties;
  }
  const need = rows.length + 20;
  if ((props.gridProperties?.rowCount ?? 0) < need) {
    await retry("grow", () => api.spreadsheets.batchUpdate({ spreadsheetId: REP_SHEET, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: props.sheetId, gridProperties: { rowCount: need, columnCount: Math.max(8, props.gridProperties?.columnCount ?? 8) } }, fields: "gridProperties.rowCount,gridProperties.columnCount" } }] } }));
  }
  await retry("write", () => api.spreadsheets.values.update({ spreadsheetId: REP_SHEET, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: rows } }));
  const lastRow = Math.max(props.gridProperties?.rowCount ?? 0, need);
  if (lastRow > rows.length) await retry("clear-tail", () => api.spreadsheets.values.clear({ spreadsheetId: REP_SHEET, range: `'${TAB}'!A${rows.length + 1}:Z${lastRow}` })).catch((e) => { if (!/exceeds grid limits/i.test(String(e))) throw e; });

  // red box on every "Cleaned up" cell (col G) + reset formatting elsewhere in G first
  const fmt = [{ repeatCell: { range: { sheetId: props.sheetId, startRowIndex: 0, endRowIndex: rows.length, startColumnIndex: 6, endColumnIndex: 7 }, cell: { userEnteredFormat: {} }, fields: "userEnteredFormat(backgroundColor,textFormat)" } }];
  for (const r of cleanedCells) fmt.push({ repeatCell: { range: { sheetId: props.sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 6, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.86, green: 0.15, blue: 0.15 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
  await retry("format", () => api.spreadsheets.batchUpdate({ spreadsheetId: REP_SHEET, requestBody: { requests: fmt } }));

  const emailData = {
    asOf: today, staleDays: STALE_DAYS, clReason: CL_REASON, moved: tot.movedN > 0,
    reps: reps.map((g) => ({ rep: g.rep, sqlMoved: g.movedN, amount: Math.round(g.movedAmt), sal60: g.salN, sqo60: g.sqoN, pendingSql: g.pendingSqlN })),
    totals: { sqlMoved: tot.movedN, amount: Math.round(tot.movedAmt), sal60: tot.salN, sqo60: tot.sqoN, pendingSql: tot.pendingSqlN },
  };
  console.log(`Rebuilt "${TAB}" — SQL moved: ${tot.movedN} (${money(tot.movedAmt)}) · SAL>${STALE_DAYS}d: ${tot.salN} · SQO>${STALE_DAYS}d: ${tot.sqoN} · SQL pending next sweep: ${tot.pendingSqlN} (excl ${EXCLUDE_OWNERS.join(", ")})`);
  console.log("=== EMAIL_DATA ===");
  console.log(JSON.stringify(emailData, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
