// DEAL MOVEMENT SWEEP: stale open opps → Closed Lost with reason "Stale > 60 days".
//
// Scope: New Business open opps, days-in-stage > 60 (LastStageChangeDate else CreatedDate),
// excluding owners Osman Mubarak (out of cohort) and Tai Nguyen (test).
//
// STAGES (Tai, 2026-08-28 — "the old route"): SQL, SAL and SQO. The first sweep on 2026-08-21
// was SQL-only (77 deals / $5.95M). SAL and SQO are further down the funnel, so --apply moves
// them too but the run always prints the per-stage split first and the canary still goes first.
// Narrow it any time with --stages=SQL or --stages=SQL,SAL.
//
// Reason stamping: the official ClosedLostReasons__c is a RESTRICTED picklist that does not
// (yet) contain "Stale > 60 days" — the script checks at runtime and uses it once the value
// exists; until then the reason goes to ClosedLostDetails__c (free text). Either way the
// deal is queryable by reason.
//
// Safety: DRY RUN by default (prints the plan, changes nothing). Run with --apply to move.
// --apply flips ONE canary deal first, verifies it landed, then does the rest; every result
// (ok/error) is appended to the "Deal Movement — Log" tab in the rep sheet so the weekly
// email reports ACTUAL moved numbers and mistakes can be reopened from the log.
//
// This is the one-off for w/c 2026-08-17. The recurring weekly version (SQL/SAL/SQO + WoW)
// comes later per Tai.
//
// Run: node --env-file=.env scripts/sweep-stale-sql.mjs            (dry run)
//      node --env-file=.env scripts/sweep-stale-sql.mjs --apply    (move deals)
import { google } from "googleapis";

const APPLY = process.argv.includes("--apply");
// Which stages this run may move. Default is the full cohort; --stages= narrows it.
const STAGES = (process.argv.find((a) => a.startsWith("--stages="))?.split("=")[1] ?? "SQL,SAL,SQO")
  .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
const STALE_DAYS = 60;
const REASON = "Stale > 60 days";            // exact wording → ClosedLostDetails__c (free text)
const PICKLIST_REASON = "Stale";             // value Tai added to the restricted ClosedLostReasons__c
const REP_SHEET = "1dHpM2O_8tZfsEGmbIz_W59_qe5gI5NQ5THW_v5DWphc";
const LOG_TAB = "Deal Movement — Log";
const EXCLUDE_OWNERS = ["Osman Mubarak", "Tai Nguyen"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJSON(url, opts, label) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(45000) });
      const text = await r.text();
      const j = text ? JSON.parse(text) : null;
      if (!r.ok) { const err = new Error(`${label} HTTP ${r.status} ${text.slice(0, 300)}`); err.status = r.status; err.body = j; throw err; }
      return j;
    } catch (e) {
      const transient = [429, 500, 502, 503].includes(e.status) || /timeout|econnreset|fetch failed/i.test(String(e.message));
      if (i >= 4 || !transient) throw e;
      await sleep(1000 * 2 ** i);
    }
  }
}
async function sfAuth() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const j = await fetchJSON(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, "sf-auth");
  return { token: j.access_token, instance: j.instance_url, v: process.env.SF_API_VERSION || "59.0" };
}

async function main() {
  const { token, instance, v } = await sfAuth();
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // does the restricted picklist carry our reason yet?
  const desc = await fetchJSON(`${instance}/services/data/v${v}/sobjects/Opportunity/describe`, { headers: H }, "describe");
  const reasonsField = desc.fields.find((f) => f.name === "ClosedLostReasons__c");
  const picklistHasReason = !!reasonsField?.picklistValues?.some((p) => p.active && p.value === PICKLIST_REASON);

  const owners = EXCLUDE_OWNERS.map((o) => `'${o}'`).join(",");
  const q = `SELECT Id, Name, Account.Name, Owner.Name, StageName, Amount, LastStageChangeDate, CreatedDate
    FROM Opportunity WHERE IsClosed = false AND RecordType.Name = '1.New Business'
      AND StageName IN (${STAGES.map((x) => `'${x}'`).join(",")}) AND Owner.Name NOT IN (${owners})`.replace(/\s+/g, " ");
  let url = `${instance}/services/data/v${v}/query?q=${encodeURIComponent(q)}`;
  const recs = [];
  while (url) { const j = await fetchJSON(url, { headers: H }, "query"); recs.push(...j.records); url = j.done ? null : `${instance}${j.nextRecordsUrl}`; }
  const now = Date.now();
  const cohort = recs.map((x) => {
    const basis = x.LastStageChangeDate || x.CreatedDate;
    return { id: x.Id, name: x.Account?.Name || x.Name, rep: x.Owner?.Name ?? "?", amt: x.Amount || 0,
      stage: x.StageName, days: Math.floor((now - Date.parse(basis)) / 86400000) };
  }).filter((d) => d.days > STALE_DAYS).sort((a, b) => a.amt - b.amt); // canary = smallest first

  const total = cohort.reduce((s, d) => s + d.amt, 0);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${STAGES.join("/")} > ${STALE_DAYS}d cohort: ${cohort.length} deals · $${Math.round(total).toLocaleString()}`);
  // Per-stage split BEFORE anything moves. SAL and SQO are later-funnel, so seeing the shape of
  // what is about to close is the last cheap chance to stop a bad run.
  const byStage = {};
  for (const d of cohort) { (byStage[d.stage] ??= { n: 0, amt: 0 }); byStage[d.stage].n++; byStage[d.stage].amt += d.amt; }
  for (const st of STAGES) {
    const g = byStage[st] ?? { n: 0, amt: 0 };
    console.log(`  ${st.padEnd(5)} ${String(g.n).padStart(4)} deals · $${Math.round(g.amt).toLocaleString()}`);
  }
  console.log(`Reason: ${picklistHasReason ? `ClosedLostReasons__c = "${PICKLIST_REASON}" ✓ + Details = "${REASON}"` : `ClosedLostDetails__c only ("${PICKLIST_REASON}" not in the restricted picklist)`}`);
  const byRep = {};
  for (const d of cohort) { (byRep[d.rep] ??= { n: 0, amt: 0 }); byRep[d.rep].n++; byRep[d.rep].amt += d.amt; }
  Object.entries(byRep).sort((a, b) => b[1].amt - a[1].amt).forEach(([r, g]) => console.log(`  ${r.padEnd(20)} ${String(g.n).padStart(3)} deals · $${Math.round(g.amt).toLocaleString()}`));
  if (!APPLY) { console.log("\nDry run only — re-run with --apply to move. Nothing changed."); return; }

  // one update body for all
  const patch = { StageName: "Closed Lost", ClosedLostDetails__c: REASON };
  if (picklistHasReason) patch.ClosedLostReasons__c = PICKLIST_REASON;

  const results = [];
  const move = async (d) => {
    try {
      await fetchJSON(`${instance}/services/data/v${v}/sobjects/Opportunity/${d.id}`, { method: "PATCH", headers: H, body: JSON.stringify(patch) }, "patch");
      results.push({ ...d, ok: true, note: picklistHasReason ? "reason in picklist" : "reason in ClosedLostDetails" });
      return true;
    } catch (e) {
      const msg = JSON.stringify(e.body ?? String(e.message)).slice(0, 200);
      results.push({ ...d, ok: false, note: msg });
      return false;
    }
  };

  // canary first
  const canary = cohort[0];
  console.log(`\nCanary: ${canary.name} (${canary.rep}, $${canary.amt}, ${canary.days}d) …`);
  const ok = await move(canary);
  if (!ok) { console.error("CANARY FAILED — aborting before touching the rest:\n" + results[0].note); await writeLog(results); process.exit(1); }
  // verify it actually landed
  const chk = await fetchJSON(`${instance}/services/data/v${v}/query?q=${encodeURIComponent(`SELECT StageName, ClosedLostDetails__c FROM Opportunity WHERE Id='${canary.id}'`)}`, { headers: H }, "verify");
  console.log(`Canary verified: stage=${chk.records[0].StageName} · details=${chk.records[0].ClosedLostDetails__c}`);
  if (chk.records[0].StageName !== "Closed Lost") { console.error("Canary did not land as Closed Lost — aborting."); await writeLog(results); process.exit(1); }

  for (const d of cohort.slice(1)) { await move(d); await sleep(150); }
  const moved = results.filter((r) => r.ok), failed = results.filter((r) => !r.ok);
  console.log(`\nMoved ${moved.length}/${cohort.length} · $${Math.round(moved.reduce((s, d) => s + d.amt, 0)).toLocaleString()} — failures: ${failed.length}`);
  failed.forEach((f) => console.log(`  ✗ ${f.name} (${f.rep}): ${f.note}`));
  await writeLog(results);
  console.log(`Log appended to "${LOG_TAB}".`);
}

async function writeLog(results) {
  if (!results.length) return;
  const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const api = google.sheets({ version: "v4", auth: gAuth });
  const meta = await api.spreadsheets.get({ spreadsheetId: REP_SHEET, fields: "sheets.properties(title)" });
  const today = new Date().toISOString().slice(0, 10);
  if (!meta.data.sheets.some((s) => s.properties.title === LOG_TAB)) {
    await api.spreadsheets.batchUpdate({ spreadsheetId: REP_SHEET, requestBody: { requests: [{ addSheet: { properties: { title: LOG_TAB, gridProperties: { rowCount: 1000, columnCount: 8 } } } }] } });
    await api.spreadsheets.values.update({ spreadsheetId: REP_SHEET, range: `'${LOG_TAB}'!A1`, valueInputOption: "RAW", requestBody: { values: [["Date", "Opp ID", "Account / Opportunity", "Rep", "Amount", "Days stale", "Result", "Note"]] } });
  }
  await api.spreadsheets.values.append({ spreadsheetId: REP_SHEET, range: `'${LOG_TAB}'!A1`, valueInputOption: "RAW", requestBody: { values: results.map((r) => [today, r.id, r.name, r.rep, r.amt, r.days, r.ok ? "MOVED" : "FAILED", r.note]) } });
}

main().catch((e) => { console.error(e); process.exit(1); });
