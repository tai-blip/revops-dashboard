// AE Attainment (Annual) — full annual table written to the "AE_Annual_Potential" tab,
// which the dashboard reads to render the Annual view of the AE Attainment tab.
// Two SF pulls, both on leadership's official basis (excl Sri/Jesse):
//   1. YTD attainment  = closed ARR (Stage Billing/Closed Won, NB + Expansion) with
//      ContractLiveDate in [Jan 1 of this year … today].  Split NB vs Expansion.
//   2. Potential (Year) = Σ over OPEN opps of (AE/AM % probability × ARR), NB + Exp.
// Projection = YTD + Potential.  Annual Goal = FY26 ACV quota (GOALS below).
// Run: node --env-file=.env scripts/refresh-ae-annual-potential.mjs
import { google } from "googleapis";

const EXCLUDE = new Set(["Sri Muniandy", "Jesse Brennan"]);
// FY26 ACV quota per rep (leadership's FY26 ACV Quota sheet). Keep in sync with
// AE_ROSTER.quotaAnnual in src/lib/planConfig.ts.
const GOALS = {
  "James Burdick": 1000000,
  "Dorsa Mahmoudnia": 883200,
  "Jed Rutstein": 750000,
  "Jill Bucci": 520000,
  "Mathias Berthelemot": 600000,
};
const YEAR = new Date().getUTCFullYear();

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

// AE_AM_Probability__c is stored as a percent (0–100) — e.g. 50 = 50%, 1 = 1%.
const frac = (v) => Number(v ?? 0) / 100;
const isExp = (rt) => /Expansion/i.test(rt);
const isNB = (rt) => /New Business/i.test(rt);

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const { token, instance } = await sfAuth();

  // ── 1. YTD attainment (closed, by ContractLiveDate this year) ──
  const ytdSoql = `SELECT Owner.Name, RecordType.Name, convertCurrency(AnnualContractValueARR__c), ContractLiveDate__c FROM Opportunity WHERE StageName IN ('Billing','Closed Won') AND (RecordType.Name = '1.New Business' OR RecordType.Name = '3.Business Expansion') AND ContractLiveDate__c >= ${YEAR}-01-01 AND ContractLiveDate__c <= TODAY ORDER BY Owner.Name`;
  const ytdRecs = await sfQueryAll(instance, token, ytdSoql);
  const ytd = {}; // name -> { nb, exp }
  for (const r of ytdRecs) {
    const owner = r.Owner?.Name ?? "(unassigned)";
    if (EXCLUDE.has(owner)) continue;
    const rt = r.RecordType?.Name ?? "";
    const arr = Number(r.AnnualContractValueARR__c ?? 0);
    if (!(arr > 0)) continue;
    ytd[owner] ??= { nb: 0, exp: 0 };
    if (isExp(rt)) ytd[owner].exp += arr;
    else if (isNB(rt)) ytd[owner].nb += arr;
  }

  // ── 2. Potential (Year) = Σ open (AE/AM % × ARR), NB + Exp ──
  const potSoql = `SELECT Owner.Name, RecordType.Name, AE_AM_Probability__c, convertCurrency(AnnualContractValueARR__c) FROM Opportunity WHERE IsClosed = false AND AE_AM_Probability__c != null ORDER BY Owner.Name`;
  const potRecs = await sfQueryAll(instance, token, potSoql);
  const pot = {}; // name -> { nb, exp, count }
  for (const r of potRecs) {
    const owner = r.Owner?.Name ?? "(unassigned)";
    if (EXCLUDE.has(owner)) continue;
    const rt = r.RecordType?.Name ?? "";
    if (/Renewal/i.test(rt)) continue;
    const w = frac(r.AE_AM_Probability__c) * Number(r.AnnualContractValueARR__c ?? 0);
    if (!(w > 0)) continue;
    pot[owner] ??= { nb: 0, exp: 0, count: 0 };
    if (isExp(rt)) pot[owner].exp += w; else pot[owner].nb += w;
    pot[owner].count += 1;
  }

  // ── Assemble one row per rep with a goal (order follows GOALS) ──
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const names = Object.keys(GOALS);
  const rows = names.map((name) => {
    const y = ytd[name] ?? { nb: 0, exp: 0 };
    const p = pot[name] ?? { nb: 0, exp: 0, count: 0 };
    const goal = GOALS[name];
    const ytdTot = y.nb + y.exp;
    const potTot = p.nb + p.exp;
    const proj = ytdTot + potTot;
    return [
      name, goal,
      Math.round(y.nb), Math.round(y.exp), Math.round(ytdTot),
      goal > 0 ? +(ytdTot / goal).toFixed(4) : 0,
      Math.round(p.nb), Math.round(p.exp), Math.round(potTot),
      Math.round(proj), goal > 0 ? +(proj / goal).toFixed(4) : 0,
    ];
  });

  const matrix = [
    [`AE Attainment (Annual) — FY${String(YEAR).slice(2)} · YTD by ContractLiveDate + open-pipe potential`, "", "", "", "", "", "", "", "", "", `Updated ${stamp}`],
    ["Owner", "Annual Goal", "YTD NB", "YTD Exp", "YTD Total", "% of Goal", "Pot NB", "Pot Exp", "Pot Total", "Projection", "% Proj"],
    ...rows,
  ];

  // Clear any prior contents (older/wider layouts) before writing the fresh table.
  await api.spreadsheets.values.clear({ spreadsheetId: ID, range: "AE_Annual_Potential!A1:Z200" }).catch(async (e) => {
    if (/Unable to parse range|not found/i.test(String(e))) {
      await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: "AE_Annual_Potential" } } }] } });
    } else throw e;
  });
  await api.spreadsheets.values.update({
    spreadsheetId: ID, range: "AE_Annual_Potential!A1:K200", valueInputOption: "RAW", requestBody: { values: matrix },
  });

  console.log(`Wrote AE_Annual_Potential — ${rows.length} reps · ${ytdRecs.length} YTD closed, ${potRecs.length} open opps scanned.\n`);
  const M = (n) => "$" + Math.round(n).toLocaleString();
  for (const r of rows) console.log(`  ${r[0].padEnd(22)} goal ${M(r[1]).padEnd(12)} YTD ${M(r[4]).padEnd(11)} (${Math.round(r[5] * 100)}%)  pot ${M(r[8]).padEnd(11)} proj ${M(r[9])} (${Math.round(r[10] * 100)}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
