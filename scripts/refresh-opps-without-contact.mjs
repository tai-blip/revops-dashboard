// Ops Excellence (b): Opportunities without an associated Contact.
// Flags OPEN opps with no OpportunityContactRole, and classifies each into a Scope so the
// dashboard total and the rep-facing tracker can never drift apart again:
//   Coachable      — active selling stages (SAL/SQL/SQO/Trial/Billing). This is the number the
//                    weekly Ops Excellency email reports and the only scope reps are asked to fix.
//   Renewal        — Renewal Pending/Upcoming/Window/Overdue. AM-owned, tracked separately.
//   Expansion Lead — auto-created expansion leads; a contact isn't expected at that stage yet.
//   Other          — Value Identified / Proposal / Negotiation / Pending Signature / Solutions Approved.
// Writes tab "Ops Excellence - No Contact" (all scopes, for the dashboard) AND refreshes the
// team-facing tracker sheet (rep tabs + Summary progression) with the Coachable scope only,
// mirroring refresh-probability-freshness.mjs so reps can work their own tab top-down.
// Run: node --env-file=.env scripts/refresh-opps-without-contact.mjs
import { google } from "googleapis";

const COACHABLE_STAGES = ["SAL", "SQL", "SQO", "Trial", "Billing"];

async function sfAuth() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const r = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error("SF auth failed: " + JSON.stringify(j));
  return { token: j.access_token, instance: j.instance_url };
}
async function sfQueryAll(instance, token, soql) {
  const v = process.env.SF_API_VERSION || "59.0";
  let url = `${instance}/services/data/v${v}/query?q=${encodeURIComponent(soql)}`;
  const out = [];
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (j.records == null) throw new Error("SF query failed: " + JSON.stringify(j));
    out.push(...j.records);
    url = j.done ? null : `${instance}${j.nextRecordsUrl}`;
  }
  return out;
}

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const scopeOf = (stage) =>
  COACHABLE_STAGES.includes(stage) ? "Coachable"
  : String(stage).startsWith("Renewal") ? "Renewal"
  : stage === "Expansion Lead" ? "Expansion Lead"
  : "Other";

// The order a rep should work their tab in: clear the dead pipeline first (biggest, fastest
// chunk), then the one-click links, then the accounts that need a contact created.
const STEP_CLOSE = "1 · Close or re-date (close date has passed)";
const STEP_LINK = "2 · Link an existing contact from the account";
const STEP_CREATE = "3 · Create a contact on the account (account has none)";
const STEP_CHECK = "Check the account — contact count unavailable";

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const { token, instance } = await sfAuth();

  const recs = await sfQueryAll(instance, token,
    `SELECT Id, Name, Owner.Name, AccountId, Account.Name, StageName, CloseDate, CreatedDate, LastActivityDate, convertCurrency(AnnualContractValueARR__c) FROM Opportunity WHERE IsClosed = false AND Id NOT IN (SELECT OpportunityId FROM OpportunityContactRole) ORDER BY Owner.Name, StageName`);

  // Contact rollup per account. A lookup miss stays null (never silently 0) so a truncated
  // rollup can't quietly reclassify "quick fix" rows as "this account has no contacts".
  const acctIds = [...new Set(recs.map((r) => r.AccountId).filter(Boolean))];
  const contactCount = new Map();
  for (let i = 0; i < acctIds.length; i += 150) {
    const chunk = acctIds.slice(i, i + 150);
    const rows = await sfQueryAll(instance, token,
      `SELECT AccountId, COUNT(Id) c FROM Contact WHERE AccountId IN (${chunk.map((a) => `'${a}'`).join(",")}) GROUP BY AccountId`);
    for (const row of rows) contactCount.set(row.AccountId, Number(row.c) || 0);
    for (const id of chunk) if (!contactCount.has(id)) contactCount.set(id, 0); // queried, so a miss really is zero
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const daysPast = (d) => (d ? Math.floor((today - new Date(d + "T00:00:00Z")) / 86400000) : null);

  const rows = recs.map((r) => {
    const acctContacts = r.AccountId ? contactCount.get(r.AccountId) ?? null : null;
    const overdue = Boolean(r.CloseDate && r.CloseDate < todayStr);
    const step = overdue ? STEP_CLOSE : acctContacts == null ? STEP_CHECK : acctContacts > 0 ? STEP_LINK : STEP_CREATE;
    return {
      rec: r,
      owner: r.Owner?.Name ?? "(unassigned)",
      scope: scopeOf(r.StageName),
      acctContacts,
      daysOverdue: overdue ? daysPast(r.CloseDate) : "",
      step,
    };
  });

  const coachable = rows.filter((x) => x.scope === "Coachable");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const tally = (list, key) => list.reduce((a, x) => { a[x[key]] = (a[x[key]] || 0) + 1; return a; }, {});
  const byScope = tally(rows, "scope");
  const byRepCoachable = tally(coachable, "owner");
  const byRepAll = tally(rows, "owner");
  const repRows = Object.entries(byRepAll).sort((a, b) => (byRepCoachable[b[0]] ?? 0) - (byRepCoachable[a[0]] ?? 0) || b[1] - a[1]);

  const matrix = [
    ["Opportunities without an associated Contact (open)", "", "", `Updated ${stamp}`, "", "", "", "", "", ""],
    [`${recs.length} open opportunities have no linked Contact — of which ${coachable.length} are Coachable (${COACHABLE_STAGES.join("/")}), the number the weekly Ops Excellency email reports`, "", "", "", "", "", "", "", "", ""],
    [],
    ["Scope", "Opps", "", "", "", "", "", "", "", ""],
    ...["Coachable", "Renewal", "Expansion Lead", "Other"].map((s) => [s, byScope[s] ?? 0, "", "", "", "", "", "", "", ""]),
    [],
    ["Rep", "Coachable", "All open", "", "", "", "", "", "", ""],
    ...repRows.map(([rep, n]) => [rep, byRepCoachable[rep] ?? 0, n, "", "", "", "", "", "", ""]),
    [],
    ["Owner", "Opportunity", "Account", "Stage", "Scope", "ARR (USD)", "Close Date", "Days Overdue", "Account Contacts", "Next step"],
    ...rows.map((x) => [
      x.owner, x.rec.Name, x.rec.Account?.Name ?? "", x.rec.StageName, x.scope,
      x.rec.AnnualContractValueARR__c ?? "", x.rec.CloseDate ?? "", x.daysOverdue,
      x.acctContacts ?? "unknown", x.step,
    ]),
  ];

  const TAB = "Ops Excellence - No Contact";
  const meta = await api.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, fields: "sheets.properties(sheetId,title)" });
  const existing = meta.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (existing) reqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: matrix } });

  console.log(`wrote "${TAB}": ${recs.length} open opps without a contact (${coachable.length} coachable)`);
  console.log("scopes:", Object.entries(byScope).map(([s, n]) => `${s} ${n}`).join(" | "));

  // ── Team-facing tracker (the Drive link in the weekly Ops Excellency email). Same
  // treatment as the probability tracker: each rep gets their own tab, sorted so it can be
  // worked top-down, col A a clickable SFDC link; Summary keeps its weekly-range
  // progression columns, today's written as static numbers so history stays frozen. ──
  // Needs the service account (GOOGLE_SERVICE_ACCOUNT_EMAIL) shared as Editor on TEAM_ID.
  // Until then this half fails soft: the dashboard tab above is already written, so the daily
  // job stays green and the reason is printed instead of blowing up the run.
  const TEAM_ID = "11AuKNXZmRQtDzEony0ZA7BM5rLVxdUKskVuAzJZy0Us";
  try {
  const REP_TABS = ["James Burdick", "Dorsa Mahmoudnia", "Osman Mubarak", "Jed Rutstein", "Jill Bucci", "Mathias Berthelemot", "David Dubinski"];
  const STAGE_ORDER = ["Billing", "Trial", "SQO", "SQL", "SAL"];
  const stepRank = (s) => [STEP_CLOSE, STEP_LINK, STEP_CREATE, STEP_CHECK].indexOf(s);
  const oppLink = (id) => `=HYPERLINK("${instance}/lightning/r/Opportunity/${id}/view","${id}")`;
  const detailHeader = ["Id", "Opportunity", "Account", "Stage", "Close Date", "Days Overdue", "ARR (USD)", "Account Contacts", "Last Activity", "Created", "Next step"];
  const detailRow = (x) => [
    oppLink(x.rec.Id), x.rec.Name, x.rec.Account?.Name ?? "", x.rec.StageName, x.rec.CloseDate ?? "",
    x.daysOverdue, x.rec.AnnualContractValueARR__c ?? "", x.acctContacts ?? "unknown",
    x.rec.LastActivityDate ?? "never", (x.rec.CreatedDate ?? "").slice(0, 10), x.step,
  ];
  // Work order: the three steps in sequence, then most-advanced stage, then longest overdue.
  const workOrder = (a, b) =>
    stepRank(a.step) - stepRank(b.step) ||
    STAGE_ORDER.indexOf(a.rec.StageName) - STAGE_ORDER.indexOf(b.rec.StageName) ||
    String(a.rec.CloseDate).localeCompare(String(b.rec.CloseDate));

  let teamMeta = await api.spreadsheets.get({ spreadsheetId: TEAM_ID, fields: "sheets.properties(sheetId,title)" });
  const teamTabs = new Set(teamMeta.data.sheets.map((s) => s.properties.title));
  const ensureTab = async (title) => {
    if (teamTabs.has(title)) return;
    await api.spreadsheets.batchUpdate({ spreadsheetId: TEAM_ID, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
    teamTabs.add(title);
  };

  for (const rep of REP_TABS) {
    const mine = coachable.filter((x) => x.owner === rep).sort(workOrder);
    await ensureTab(rep);
    await api.spreadsheets.values.clear({ spreadsheetId: TEAM_ID, range: `'${rep}'!A1:Z5000` });
    await api.spreadsheets.values.update({
      spreadsheetId: TEAM_ID, range: `'${rep}'!A1`, valueInputOption: "USER_ENTERED",
      requestBody: { values: [
        [`${rep} — ${mine.length} open opps with no linked Contact (${COACHABLE_STAGES.join("/")}) · work top-down`, "", "", `Updated ${stamp}, auto-refreshed daily`],
        detailHeader,
        ...mine.map(detailRow),
      ] },
    });
  }

  // Pin the number formats: clearing a tab leaves the old formatting behind, which rendered
  // "Days Overdue" (576) as a date. Dates as dates, counts and ARR as numbers.
  teamMeta = await api.spreadsheets.get({ spreadsheetId: TEAM_ID, fields: "sheets.properties(sheetId,title)" });
  const sheetIdOf = new Map(teamMeta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const COL_FORMATS = [
    [[4, 5], { type: "DATE", pattern: "yyyy-mm-dd" }],   // Close Date
    [[5, 6], { type: "NUMBER", pattern: "0" }],          // Days Overdue
    [[6, 7], { type: "NUMBER", pattern: "#,##0.00" }],   // ARR (USD)
    [[7, 8], { type: "NUMBER", pattern: "0" }],          // Account Contacts
    [[8, 10], { type: "DATE", pattern: "yyyy-mm-dd" }],  // Last Activity, Created
  ];
  const formatReqs = REP_TABS.flatMap((rep) => {
    const sheetId = sheetIdOf.get(rep);
    if (sheetId == null) return [];
    return COL_FORMATS.map(([[start, end], numberFormat]) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: 2, startColumnIndex: start, endColumnIndex: end },
        cell: { userEnteredFormat: { numberFormat } },
        fields: "userEnteredFormat.numberFormat",
      },
    }));
  });
  if (formatReqs.length) await api.spreadsheets.batchUpdate({ spreadsheetId: TEAM_ID, requestBody: { requests: formatReqs } });

  // Summary: one column per week, labelled for the 7 days ending today ("24th Jul - 31st Jul").
  await ensureTab("Summary");
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d) => `${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
  const label = `${fmt(new Date(today.getTime() - 7 * 86400000))} - ${fmt(today)}`;
  const sum = await api.spreadsheets.values.get({ spreadsheetId: TEAM_ID, range: "'Summary'!A1:ZZ50" }).then((r) => r.data.values ?? []);
  if (sum.length === 0) sum.push([""], ...REP_TABS.filter((r) => r !== "Osman Mubarak").map((rep) => [rep]), [""]);
  const header = sum[0] ?? [];
  const col = header.indexOf(label) !== -1 ? header.indexOf(label) : Math.max(header.length, 1);
  const a1col = (i) => (i < 26 ? "" : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26));

  // Summary rows are whichever reps the sheet already lists; the final row is its (unlabelled)
  // TOTAL row. Write this week's column, then recompute TOTAL for every column from the rep
  // rows above it — that row had been offset one column, publishing the wrong weekly totals.
  const repRowIdx = sum.map((r, i) => [r?.[0], i]).filter(([name]) => REP_TABS.includes(name)).map(([, i]) => i);
  const totalRowIdx = sum.length - 1;
  const thisWeekTotal = repRowIdx.reduce((t, ri) => t + (byRepCoachable[sum[ri][0]] ?? 0), 0);
  const colValues = [[label], ...sum.slice(1).map((row, i) => {
    const idx = i + 1;
    if (repRowIdx.includes(idx)) return [byRepCoachable[row[0]] ?? 0];
    if (idx === totalRowIdx) return [thisWeekTotal];
    return [""];
  })];
  await api.spreadsheets.values.update({
    spreadsheetId: TEAM_ID, range: `'Summary'!${a1col(col)}1`, valueInputOption: "RAW",
    requestBody: { values: colValues },
  });
  if (totalRowIdx > 0 && header.length > 1) {
    const totalRow = [sum[totalRowIdx]?.[0] ?? ""];
    for (let i = 1; i < Math.max(header.length, col + 1); i++) {
      totalRow.push(i === col ? thisWeekTotal : repRowIdx.reduce((t, ri) => {
        const v = Number(sum[ri]?.[i]);
        return t + (Number.isFinite(v) ? v : 0);
      }, 0) || "");
    }
    await api.spreadsheets.values.update({
      spreadsheetId: TEAM_ID, range: `'Summary'!A${totalRowIdx + 1}`, valueInputOption: "RAW",
      requestBody: { values: [totalRow] },
    });
  }
  const untracked = coachable.filter((x) => !REP_TABS.includes(x.owner)).length;
  console.log(`team tracker refreshed: ${REP_TABS.length} rep tabs + Summary column "${label}" (coachable opps owned by reps without a tab: ${untracked})`);
  } catch (e) {
    console.warn(`TEAM TRACKER SKIPPED (${e.message.slice(0, 120)}) — share sheet ${TEAM_ID} with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as Editor to enable it.`);
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
