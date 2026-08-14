// Contracted → Live MOVEMENT (flow), not the standing snapshot. Reconstructs each deal's
// tier at consecutive month-ends using the SAME point-in-time logic as computeArrFunnel,
// then finds deals that were Contracted at month M and Live at month M+1 (they started
// paying that month). Writes a "Contracted→Live Movement" tab + prints Jul→Aug and Aug→Sep.
// Run: node --env-file=.env scripts/arr-contracted-live-movement.mjs
import { google } from "googleapis";

const CHURN = new Set(["Contracts Ended (Churned)", "Contract Paused"]);
const SIGNED = new Set(["Billing", "Closed Won"]);
const GREEN = { red: 0.7, green: 0.9, blue: 0.7 };

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
    `SELECT Id, Account.Name, Name, StageName, Status__c, convertCurrency(AnnualContractValueARR__c) arr, ContractLiveDate__c, ContractSignedDate__c, Live_Paying_Date__c, Date_Reached_Trial__c, Date_Reached_Closed_Lost__c, ContractEndDate__c FROM Opportunity WHERE Date_Reached_Trial__c != null OR ContractLiveDate__c != null OR Live_Paying_Date__c != null`);
  const rows = recs.map((r) => ({
    id: r.Id, acct: r.Account?.Name || "", opp: r.Name || "", stage: r.StageName || "", status: r.Status__c || "",
    arr: Number(r.arr || 0), signed_stage: SIGNED.has(r.StageName || ""), churn: CHURN.has(r.Status__c || ""),
    live: d10(r.ContractLiveDate__c), signedDate: d10(r.ContractSignedDate__c), livePay: d10(r.Live_Paying_Date__c),
    trial: d10(r.Date_Reached_Trial__c), lost: d10(r.Date_Reached_Closed_Lost__c), end: d10(r.ContractEndDate__c),
  })).filter((r) => r.arr > 0);

  // Tier of a deal AS OF a cutoff date — identical rules to computeArrFunnel.
  const tierAt = (r, me) => {
    const be = (d) => d !== "" && d <= me, af = (d) => d === "" || d > me;
    if (r.signed_stage && be(r.livePay) && af(r.end) && !r.churn) return "Live";
    if (r.signed_stage && be(r.live) && af(r.livePay) && af(r.end) && af(r.lost) && !r.churn) return "Contracted";
    if (be(r.trial) && af(r.live) && af(r.livePay) && af(r.lost)) return "Booked";
    return "";
  };
  const monthEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10); // last day of month m (0-based)

  const sum = (l) => l.reduce((s, r) => s + r.arr, 0);
  // Movers: Contracted at cutoff A, Live at cutoff B.
  const movers = (a, b) => rows.filter((r) => tierAt(r, a) === "Contracted" && tierAt(r, b) === "Live");
  const contractedAt = (c) => rows.filter((r) => tierAt(r, c) === "Contracted");
  const link = (r) => `=HYPERLINK("${instance}/${r.id}", "${String(r.opp || r.acct).replace(/"/g, '""')}")`;
  const hdr = ["Account", "Opportunity (→SFDC)", "Stage", "Status", "ARR (USD)", "Contract Live Date", "Signed Date", "Live-Paying Date", "Contract End"];
  const rowOf = (r) => [r.acct, link(r), r.stage, r.status, Math.round(r.arr), r.live || "(blank)", r.signedDate || "(blank)", r.livePay || "(blank)", r.end || "(blank)"];
  const section = (title, list) => [[title + `  —  ${list.length} ops · ${M(sum(list))}`], hdr, ...list.sort((a, b) => b.arr - a.arr).map(rowOf), [""]];

  // One movement report for a focus month: standing Contracted snapshot at its month-end,
  // where those deals go by the NEXT month-end, and what arrived from the PRIOR month.
  async function report(tab, index, focusLabel, priorLabel, nextLabel, priorME, focusME, nextME, future) {
    const snap = contractedAt(focusME);
    const toNext = movers(focusME, nextME);        // Contracted at focus, Live at next
    const stay = snap.filter((r) => !toNext.some((m) => m.id === r.id));
    const priorMovers = movers(priorME, focusME);  // arrived Live in focus month
    const values = [
      [`Contracted → Live movement (flow) — focus month ${focusLabel} — as of ${T}`],
      [`Standing Contracted at ${focusLabel} month-end, then where it goes by ${nextLabel} month-end. A 'mover' = Contracted at one month-end, Live (paying) at the next.` + (future ? ` NOTE: ${nextLabel}-end is in the future — movers only appear if a Live-Paying Date is already scheduled that month.` : "")],
      [""],
      ["SUMMARY", "ops", "ARR (USD)"],
      [`${focusLabel}-end Contracted snapshot (standing)`, snap.length, Math.round(sum(snap))],
      [`  ├─ of which move Contracted→Live by ${nextLabel}-end`, toNext.length, Math.round(sum(toNext))],
      [`  └─ still Contracted at ${nextLabel}-end`, stay.length, Math.round(sum(stay))],
      [`${priorLabel}→${focusLabel} movers (became Live in ${focusLabel})`, priorMovers.length, Math.round(sum(priorMovers))],
      [`${focusLabel} Contracted + ${focusLabel}→${nextLabel} movers (as asked, NOTE: movers ⊆ Contracted → additive double-counts)`, snap.length + toNext.length, Math.round(sum(snap) + sum(toNext))],
      [""],
      ...section(`① ${focusLabel}-end Contracted snapshot (signed, live, NOT yet paying)`, snap),
      ...section(`② ${focusLabel}→${nextLabel} movers: Contracted at ${focusLabel}-end, Live-paying by ${nextLabel}-end`, toNext),
      ...section(`③ Still Contracted at ${nextLabel}-end`, stay),
      ...section(`④ ${priorLabel}→${focusLabel} movers: were Contracted at ${priorLabel}-end, went Live in ${focusLabel}`, priorMovers),
    ];
    const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
    const existing = meta.data.sheets.find((s) => s.properties.title === tab);
    const reqs = [];
    if (existing) reqs.push({ deleteSheet: { sheetId: existing.properties.sheetId } });
    reqs.push({ addSheet: { properties: { title: tab, index, tabColor: GREEN } } });
    const res = await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
    const gid = res.data.replies.find((r) => r.addSheet).addSheet.properties.sheetId;
    await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${tab}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values } });
    console.log(`\n=== ${focusLabel} focus (${tab}) ===`);
    console.log(`${focusLabel}-end Contracted snapshot:  `, snap.length, "ops ·", M(sum(snap)));
    console.log(`  move Contracted→Live by ${nextLabel}:  `, toNext.length, "ops ·", M(sum(toNext)));
    console.log(`  still Contracted at ${nextLabel}-end:  `, stay.length, "ops ·", M(sum(stay)));
    console.log(`${priorLabel}→${focusLabel} movers (Live in ${focusLabel}):`, priorMovers.length, "ops ·", M(sum(priorMovers)));
    console.log("Tab gid=" + gid + "  https://docs.google.com/spreadsheets/d/" + ID + "/edit#gid=" + gid);
  }

  const JUN = monthEnd(2026, 5), JUL = monthEnd(2026, 6), AUG = monthEnd(2026, 7), SEP = monthEnd(2026, 8);
  await report("Contracted→Live Movement (Jul)", 1, "Jul", "Jun", "Aug", JUN, JUL, AUG, false);
  await report("Contracted→Live Movement (Aug)", 2, "Aug", "Jul", "Sep", JUL, AUG, SEP, true);
}
main().catch((e) => { console.error(e); process.exit(1); });
