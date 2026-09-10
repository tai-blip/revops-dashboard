// Refreshes the AE-facing Q3 pipeline-generation sheets from live Salesforce.
//
// DELIBERATELY standalone — NOT part of the dashboard's 4-hourly ARR refresh
// (.github/workflows/refresh-arr.yml). Runs weekly (Friday) as step 1 of the
// weekly-ops-excellency-email task; feeds Section 2 "TOFU Pipeline Report" of that email.
//
// ── VALUATION RULE (Tai, final 2026-08-21): Value = Amount, always. ARR is shown
//    per deal for reference but never drives the number. Closed Lost stays included.
//    Deals with no Amount at all are the data-quality callout in the weekly email. ──
//
// Rebuilds in the REP sheet (1dHpM2O…):
//   • "Q3 Pipeline Gen by Rep"  — deal-by-deal per rep (ARR shown for reference, Value = Amount)
//   • "Summary"                 — scorecard: SQLs | Generated | Open Pipe | Quota | % | WoW
//   • "PipeGen — Snapshots"     — per rep/channel per run date (the WoW source)
// And the same "Q3 Pipeline Gen by Rep" layout in the MAIN sheet (GOOGLE_SHEET_ID).
//
// Basis: New Business opps with Date_Reached_SQL__c in Q3 FY26 (Jul–Sep 2026), open +
// closed-lost, excl. owner "Tai Nguyen". Quotas read live from the main sheet's
// "AE Attainment (Official)" B65:B70. WoW = current vs newest snapshot ≥6 days old
// (baseline fallback: deals SQL-dated in the last 7 days).
//
// Prints a JSON block ("=== EMAIL_DATA ===") with everything the weekly email needs.
// Run: node --env-file=.env scripts/refresh-q3-pipegen.mjs
import { google } from "googleapis";

// ── Q3 FY26 window. Bump these four lines when the quarter rolls over. ──
const Q_LABEL = "Q3 FY26";
const Q_MONTHS = "Jul–Sep 2026";
const Q_START = "2026-07-01";
const Q_END = "2026-09-30";

const REP_SHEET = "1dHpM2O_8tZfsEGmbIz_W59_qe5gI5NQ5THW_v5DWphc";
const TAB = "Q3 Pipeline Gen by Rep";
const SNAP_TAB = "PipeGen — Snapshots";
const SUM_TAB = "Summary";
const EXCLUDE_OWNER = "Tai Nguyen"; // test records
const PAST = new Set(["SAL", "SQO", "Trial", "Proposal", "Pending Signature", "Billing", "Closed Won", "Live Paying"]);

// ── retry/backoff ──
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
    catch (e) {
      if (i >= tries - 1 || !isTransient(e)) throw e;
      const wait = baseMs * 2 ** i;
      console.warn(`  ↻ retry ${label} (${i + 1}/${tries - 1}) in ${wait}ms — ${e.message || e}`);
      await sleep(wait);
    }
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
  if (!j.access_token) throw new Error("SF auth failed");
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

async function ensureTab(api, spreadsheetId, title, rows, cols) {
  const meta = await retry("get-meta", () => api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,gridProperties)" }));
  let sheet = meta.data.sheets.find((s) => s.properties.title === title);
  if (!sheet) {
    const res = await retry("add-tab", () => api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title, gridProperties: { rowCount: rows, columnCount: cols } } } }] } }));
    sheet = { properties: res.data.replies[0].addSheet.properties };
  }
  return sheet.properties;
}
// input option per tab: deal tabs use USER_ENTERED so =HYPERLINK() opp links parse; Summary &
// snapshots use RAW because their "+$…" WoW strings would otherwise parse as broken formulas.
async function writeTab(api, spreadsheetId, title, rows, cols, inputOption = "RAW") {
  const props = await ensureTab(api, spreadsheetId, title, rows.length + 20, cols);
  const need = rows.length + 20;
  if ((props.gridProperties?.rowCount ?? 0) < need || (props.gridProperties?.columnCount ?? 0) < cols) {
    await retry("grow", () => api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: props.sheetId, gridProperties: { rowCount: Math.max(need, props.gridProperties?.rowCount ?? 0), columnCount: Math.max(cols, props.gridProperties?.columnCount ?? cols) } }, fields: "gridProperties.rowCount,gridProperties.columnCount" } }] } }));
  }
  await retry("write", () => api.spreadsheets.values.update({ spreadsheetId, range: `'${title}'!A1`, valueInputOption: inputOption, requestBody: { values: rows } }));
  const lastRow = props.gridProperties?.rowCount ?? rows.length + 20;
  if (lastRow > rows.length) {
    await retry("clear-tail", () => api.spreadsheets.values.clear({ spreadsheetId, range: `'${title}'!A${rows.length + 1}:Z${lastRow}` })).catch((e) => { if (!/exceeds grid limits/i.test(String(e))) throw e; });
  }
}

const SF_LIGHTNING = "https://fun-ruby-7024.lightning.force.com";
const oppLink = (id) => `=HYPERLINK("${SF_LIGHTNING}/lightning/r/Opportunity/${id}/view","${id}")`;

function buildDealRows(byRep, totals) {
  const rows = [
    [`${Q_LABEL} Pipeline Generated by Rep — opps that reached SQL ${Q_MONTHS} · Open + Closed-Lost`],
    [`Value rule (Tai 2026-08-21): Value = Amount, always. ARR column is reference-only. Deals with no Amount are flagged in the weekly email.`],
    [`TOTAL: ${totals.n} opps · Value ${money(totals.val)} (ARR ${money(totals.arr)} · Amount ${money(totals.amt)})`],
    [],
  ];
  const header = ["Opp ID", "Opportunity", "Stage", "Status", "ARR (ref)", "Amount", "Value (= Amount)", "Flag", "Channel of Contact", "Date Reached SQL"];
  for (const g of byRep) {
    rows.push([`▸ ${g.name} — ${g.n} opps · Value ${money(g.val)}`]);
    rows.push(header);
    for (const d of g.deals) {
      rows.push([oppLink(d.id), d.name, d.stage, d.stage === "Closed Lost" ? "Closed Lost" : "Open",
        d.arr || "", d.amt || "", d.val,
        d.val ? "" : "⚠ no Amount",
        d.channel, d.sqlDate]);
    }
    rows.push([]);
  }
  return rows;
}

async function main() {
  const { token, instance } = await sfAuth();

  // 1) Q3 SQL-dated New Business deals — pull BOTH the real ARR (converted) and Amount
  const soql = `SELECT Id, Name, Owner.Name, StageName, ChannelofContact__c, Date_Reached_SQL__c, convertCurrency(AnnualContractValueARR__c) arrUsd, Amount
    FROM Opportunity WHERE RecordType.Name = '1.New Business'
      AND Date_Reached_SQL__c >= ${Q_START} AND Date_Reached_SQL__c <= ${Q_END}
      AND Owner.Name != '${EXCLUDE_OWNER}' ORDER BY Owner.Name`.replace(/\s+/g, " ");
  const recs = await sfQueryAll(instance, token, soql);
  const deals = recs.map((x) => {
    const arr = x.arrUsd || 0, amt = x.Amount || 0;
    return { id: x.Id, name: x.Name ?? "", rep: x.Owner?.Name ?? "?", stage: x.StageName ?? "",
      channel: x.ChannelofContact__c || "Not set", sqlDate: x.Date_Reached_SQL__c ?? "",
      arr, amt, val: amt };
  });

  // 2) total open pipeline per owner (all open opps, same rule: Amount)
  const openAgg = await sfQueryAll(instance, token,
    `SELECT Owner.Name o, SUM(Amount) s FROM Opportunity WHERE IsClosed = false GROUP BY Owner.Name`);
  const openPipe = {};
  for (const r of openAgg) openPipe[r.o] = r.s || 0;

  const api = google.sheets({ version: "v4", auth: gAuth });

  // 3) quotas — live from the main sheet's "AE Attainment (Official)" (single source of truth)
  const qv = (await retry("quotas", () => api.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: "'AE Attainment (Official)'!A65:B70", valueRenderOption: "UNFORMATTED_VALUE" }))).data.values ?? [];
  const quota = {};
  for (const r of qv) if (r[0]) quota[r[0]] = (r[1] === 0 || r[1] > 0) ? r[1] : null; // blank = no quota

  // 4) group current state (name is explicit — never rely on a missing property)
  const grp = (key) => { const m = {}; for (const d of deals) { const k = d[key]; (m[k] ??= { name: k, n: 0, val: 0, arr: 0, amt: 0, past: 0, deals: [] });
      const g = m[k]; g.n++; g.val += d.val; g.arr += d.arr; g.amt += d.amt; if (PAST.has(d.stage)) g.past++; g.deals.push(d); }
    for (const g of Object.values(m)) g.deals.sort((a, b) => b.val - a.val);
    return Object.values(m).map((g) => ({ ...g, conv: g.n ? g.past / g.n * 100 : 0 })).sort((a, b) => b.val - a.val || b.n - a.n); };
  const byRep = grp("rep"), byCh = grp("channel");
  const totals = { n: deals.length, val: deals.reduce((s, d) => s + d.val, 0), arr: deals.reduce((s, d) => s + d.arr, 0), amt: deals.reduce((s, d) => s + d.amt, 0), past: deals.filter((d) => PAST.has(d.stage)).length };

  // 5) WoW — vs newest snapshot ≥6 days old; baseline fallback = deals SQL-dated in last 7 days
  await ensureTab(api, REP_SHEET, SNAP_TAB, 2000, 5);
  const snapRows = (await retry("read-snaps", () => api.spreadsheets.values.get({ spreadsheetId: REP_SHEET, range: `'${SNAP_TAB}'!A2:E5000`, valueRenderOption: "UNFORMATTED_VALUE" }))).data.values ?? [];
  const cutoff = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const snapDates = [...new Set(snapRows.map((r) => String(r[0])))].filter((d) => d <= cutoff).sort();
  const baseDate = snapDates[snapDates.length - 1] ?? null;
  const snap = {};
  if (baseDate) for (const r of snapRows) if (String(r[0]) === baseDate) snap[`${r[1]}|${r[2]}`] = { n: +r[3] || 0, val: +r[4] || 0 };
  const wkAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const fresh = deals.filter((d) => d.sqlDate >= wkAgo);
  const wow = (kind, name, cur) => {
    if (baseDate) { const s = snap[`${kind}|${name}`] ?? { n: 0, val: 0 }; return { dN: cur.n - s.n, dVal: cur.val - s.val, basis: baseDate }; }
    const ff = kind === "total" ? fresh : fresh.filter((d) => (kind === "rep" ? d.rep : d.channel) === name);
    return { dN: ff.length, dVal: ff.reduce((s, d) => s + d.val, 0), basis: wkAgo };
  };
  const repWow = Object.fromEntries(byRep.map((r) => [r.name, wow("rep", r.name, r)]));
  const chWow = Object.fromEntries(byCh.map((c) => [c.name, wow("channel", c.name, c)]));
  const totWow = wow("total", "TOTAL", totals);

  // 6) rebuild deal tabs (identical layout, rep sheet + main sheet)
  const dealRows = buildDealRows(byRep, totals);
  await writeTab(api, REP_SHEET, TAB, dealRows, 10, "USER_ENTERED");
  await writeTab(api, process.env.GOOGLE_SHEET_ID, TAB, dealRows, 10, "USER_ENTERED");

  // 7) rebuild the Summary scorecard tab (rep sheet)
  const wowStr = (w) => (!w.dN && !w.dVal) ? "—" : [w.dVal ? (w.dVal > 0 ? "+" : "−") + money(Math.abs(w.dVal)) : null, w.dN ? (w.dN > 0 ? "+" : "−") + Math.abs(w.dN) + " SQL" + (Math.abs(w.dN) > 1 ? "s" : "") : null].filter(Boolean).join(" · ");
  const pct = (g, q) => (q ? Math.round(g / q * 100) + "%" : "—");
  const totQuota = byRep.reduce((s, r) => s + (quota[r.name] || 0), 0); // only scorecard reps
  const sumRows = [
    [`${Q_LABEL} — Pipeline Generation Summary by Rep (Value = Amount; as of ${today} · WoW vs ${totWow.basis}${baseDate ? " snapshot" : " (new-SQL basis, first snapshot week)"})`],
    [],
    ["Rep", "Q3 SQLs", "Q3 Pipeline Generated", "Total Open Pipeline", "Pipe-Gen Quota (Q3)", "% of Quota", "WoW Δ"],
    ...byRep.map((r) => [r.name, r.n, Math.round(r.val), Math.round(openPipe[r.name] || 0), quota[r.name] ?? "—", pct(r.val, quota[r.name]), wowStr(repWow[r.name])]),
    ["TOTAL", totals.n, Math.round(totals.val), Math.round(byRep.reduce((s, r) => s + (openPipe[r.name] || 0), 0)), totQuota, pct(totals.val, totQuota), wowStr(totWow)],
  ];
  await writeTab(api, REP_SHEET, SUM_TAB, sumRows, 7);

  // 8) snapshots: replace any rows already stamped today (re-runs update, never duplicate)
  const keep = snapRows.filter((r) => String(r[0]) !== today);
  const add = [
    ...byRep.map((r) => [today, "rep", r.name, r.n, Math.round(r.val)]),
    ...byCh.map((c) => [today, "channel", c.name, c.n, Math.round(c.val)]),
    [today, "total", "TOTAL", totals.n, Math.round(totals.val)],
  ];
  await writeTab(api, REP_SHEET, SNAP_TAB, [["Date", "Kind", "Name", "SQLs", "Value"], ...keep, ...add], 5);

  // 9) machine-readable output for the weekly email
  const emailData = {
    asOf: today, wowBasis: totWow.basis, baseline: !baseDate,
    kpi: { sqls: totals.n, val: Math.round(totals.val), past: totals.past, convPct: +(totals.past / totals.n * 100).toFixed(1), quota: totQuota, pctToGoal: totQuota ? +(totals.val / totQuota * 100).toFixed(1) : null, wowN: totWow.dN, wowVal: Math.round(totWow.dVal) },
    reps: byRep.map((r) => ({ rep: r.name, quota: quota[r.name] ?? null, generated: Math.round(r.val), pctOfQuota: quota[r.name] ? Math.round(r.val / quota[r.name] * 100) : null, sqls: r.n, openPipe: Math.round(openPipe[r.name] || 0), past: r.past, wowN: repWow[r.name].dN, wowVal: Math.round(repWow[r.name].dVal) })),
    channels: byCh.map((c) => ({ channel: c.name, opps: c.n, val: Math.round(c.val), past: c.past, convPct: +c.conv.toFixed(1), wowN: chWow[c.name].dN, wowVal: Math.round(chWow[c.name].dVal) })),
    dataQuality: {
      noAmountCount: deals.filter((d) => !d.val).length,          // Amount blank → $0 in the report; the email's DQ callout
      noAmountDeals: deals.filter((d) => !d.val).map((d) => ({ name: d.name, rep: d.rep, stage: d.stage })),
    },
  };
  console.log(`Refreshed "${TAB}" + "${SUM_TAB}" + snapshots — ${totals.n} opps · Value ${money(totals.val)} (${Q_LABEL}, WoW vs ${totWow.basis})`);
  console.log(`Value rule: Amount, always · deals with no Amount: ${emailData.dataQuality.noAmountCount}`);
  console.log("=== EMAIL_DATA ===");
  console.log(JSON.stringify(emailData, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
