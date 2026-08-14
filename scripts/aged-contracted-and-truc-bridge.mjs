// (1) Aged-Contracted list: our standing Contracted deals whose contract went live BEFORE Q3
//     (pre-Jul-1) and are STILL not paying — signed revenue stuck in the billing gap >1 quarter.
// (2) Truc bridge: decompose Truc's "Contracted" population (stage Billing/Closed Won, not
//     churned — his stated $9.46M) into mutually-exclusive buckets to show where the $9M is.
// Writes two tabs. Read-only on SFDC. Run: node --env-file=.env scripts/aged-contracted-and-truc-bridge.mjs
import { google } from "googleapis";

const CHURN = new Set(["Contracts Ended (Churned)", "Contract Paused"]);
const SIGNED = new Set(["Billing", "Closed Won"]);
const ORANGE = { red: 0.98, green: 0.75, blue: 0.4 }, PURPLE = { red: 0.8, green: 0.72, blue: 0.92 };

async function sfAuth() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const j = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }).then((r) => r.json());
  if (!j.access_token) throw new Error("SF auth failed: " + JSON.stringify(j));
  return { token: j.access_token, instance: j.instance_url };
}
async function sfQuery(instance, token, soql) {
  let url = `${instance}/services/data/v${process.env.SF_API_VERSION || "59.0"}/query?q=${encodeURIComponent(soql)}`;
  const out = [];
  while (url) { const j = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()); if (!j.records) throw new Error(JSON.stringify(j)); out.push(...j.records); url = j.done ? null : `${instance}${j.nextRecordsUrl}`; }
  return out;
}
const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const d10 = (s) => (s ? String(s).slice(0, 10) : "");
const M = (n) => "$" + Math.round(n).toLocaleString();

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const { token, instance } = await sfAuth();
  const T = new Date().toISOString().slice(0, 10);

  const recs = await sfQuery(instance, token,
    `SELECT Id, Account.Name, Name, StageName, Status__c, convertCurrency(AnnualContractValueARR__c) arr, ContractLiveDate__c, ContractSignedDate__c, Live_Paying_Date__c, Date_Reached_Closed_Lost__c, ContractEndDate__c FROM Opportunity WHERE ContractLiveDate__c != null OR Live_Paying_Date__c != null OR ContractSignedDate__c != null`);
  const rows = recs.map((r) => ({
    id: r.Id, acct: r.Account?.Name || "", opp: r.Name || "", stage: r.StageName || "", status: r.Status__c || "",
    arr: Number(r.arr || 0), signed: SIGNED.has(r.StageName || ""), churn: CHURN.has(r.Status__c || ""),
    live: d10(r.ContractLiveDate__c), signedDate: d10(r.ContractSignedDate__c), livePay: d10(r.Live_Paying_Date__c),
    lost: d10(r.Date_Reached_Closed_Lost__c), end: d10(r.ContractEndDate__c),
  })).filter((r) => r.arr > 0);

  const sum = (l) => l.reduce((s, r) => s + r.arr, 0);
  const link = (r) => `=HYPERLINK("${instance}/${r.id}", "${String(r.opp || r.acct).replace(/"/g, '""')}")`;
  const be = (d) => d !== "" && d <= T, af = (d) => d === "" || d > T;

  // ---- (1) Aged Contracted: our standing Contracted, contract-live BEFORE Q3, still unpaid ----
  const contractedNow = rows.filter((r) => r.signed && be(r.live) && af(r.livePay) && af(r.end) && af(r.lost) && !r.churn);
  const aged = contractedNow.filter((r) => r.live < "2026-07-01").sort((a, b) => a.live.localeCompare(b.live));
  const daysSince = (d) => Math.round((Date.parse(T) - Date.parse(d)) / 86400000);
  const agedHdr = ["Account", "Opportunity (→SFDC)", "Stage", "Status", "ARR (USD)", "Contract Live Date", "Signed Date", "Days since live", "Contract End"];
  const agedVals = [
    ["Aged Contracted — signed & contract-live BEFORE Q3 (pre-Jul-1), still NOT paying — as of " + T],
    [`${aged.length} ops · ${M(sum(aged))} of signed ARR stuck in the billing gap for more than a quarter (no Live_Paying_Date yet).`],
    [""],
    agedHdr,
    ...aged.map((r) => [r.acct, link(r), r.stage, r.status, Math.round(r.arr), r.live, r.signedDate || "(blank)", daysSince(r.live), r.end || "(blank)"]),
  ];

  // ---- (2) Truc bridge: his Contracted population = Billing/Closed Won, not churned-status ----
  const trucPop = rows.filter((r) => r.signed && !r.churn);         // no end-filter, no paying-filter, all vintages
  const ended = trucPop.filter((r) => r.end !== "" && r.end <= T);   // contract already expired
  const active = trucPop.filter((r) => !(r.end !== "" && r.end <= T));
  const paying = active.filter((r) => be(r.livePay));                                  // = our Live
  const notPaying = active.filter((r) => af(r.livePay) && be(r.live) && af(r.lost));   // = our Contracted
  const backlog = active.filter((r) => af(r.livePay) && af(r.live));                   // signed, not yet contract-live
  const otherA = active.filter((r) => !paying.includes(r) && !notPaying.includes(r) && !backlog.includes(r));
  const bridge = [
    ["How Truc reaches ~$9.46M 'Contracted' — bridge from our $1.02M — as of " + T],
    ["Truc's population = stage Billing / Closed Won, status not churned. NO end-date filter, NO paying filter, ALL vintages, and NESTED (a live-paying deal still counts as contracted). Ours counts only the signed-but-not-yet-paying slice."],
    [""],
    ["Bucket (mutually exclusive)", "ops", "ARR (USD)", "In OUR Contracted tile?"],
    ["① Signed & PAYING now (= our Live ARR)", paying.length, Math.round(sum(paying)), "No — we count these as Live"],
    ["② Signed, live, NOT yet paying (= our Contracted tile)", notPaying.length, Math.round(sum(notPaying)), "YES"],
    ["③ Signed, not yet contract-live (backlog)", backlog.length, Math.round(sum(backlog)), "No — not live yet"],
    ["④ Contract already ENDED (expired, not churned-status)", ended.length, Math.round(sum(ended)), "No — we roll these off"],
    ["⑤ Other active (edge cases)", otherA.length, Math.round(sum(otherA)), "—"],
    ["TRUC TOTAL (Billing/Closed Won, not churned)", trucPop.length, Math.round(sum(trucPop)), ""],
    [""],
    ["Takeaway", `Truc's ${M(sum(trucPop))} = our Contracted (${M(sum(notPaying))}) + the entire Live book (${M(sum(paying))}) + ended contracts (${M(sum(ended))}) + backlog (${M(sum(backlog))}). It's an all-time signed-bookings total, not a point-in-time 'awaiting billing' tier. His anchor date (Contract Signed Date) only buckets these into months for a MoM view; it does not shrink the total.`],
  ];

  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const byTitle = Object.fromEntries(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const tabs = [["Aged Contracted", ORANGE, agedVals], ["Truc $9M Bridge", PURPLE, bridge]];
  const reqs = [];
  tabs.forEach(([t]) => { if (byTitle[t] != null) reqs.push({ deleteSheet: { sheetId: byTitle[t] } }); });
  tabs.forEach(([t, color], i) => reqs.push({ addSheet: { properties: { title: t, index: 1 + i, tabColor: color } } }));
  const res = await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  const gids = {}; res.data.replies.filter((r) => r.addSheet).forEach((r) => { gids[r.addSheet.properties.title] = r.addSheet.properties.sheetId; });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: "USER_ENTERED", data: tabs.map(([t, , values]) => ({ range: `'${t}'!A1`, values })) } });

  console.log("AGED CONTRACTED (pre-Q3, still unpaid):", aged.length, "ops ·", M(sum(aged)));
  console.log("\nTRUC $9M BRIDGE:");
  console.log("  ① paying now (our Live):      ", paying.length, "·", M(sum(paying)));
  console.log("  ② not-paying (our Contracted):", notPaying.length, "·", M(sum(notPaying)));
  console.log("  ③ backlog (not yet live):     ", backlog.length, "·", M(sum(backlog)));
  console.log("  ④ ended contracts:            ", ended.length, "·", M(sum(ended)));
  console.log("  ⑤ other active:               ", otherA.length, "·", M(sum(otherA)));
  console.log("  TRUC TOTAL:                   ", trucPop.length, "·", M(sum(trucPop)));
  for (const [t] of tabs) console.log(`${t} → https://docs.google.com/spreadsheets/d/${ID}/edit#gid=${gids[t]}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
