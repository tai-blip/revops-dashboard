// One-off: writes the "Churn_Investigate" tab — contracts with Status = Churned/Paused
// that are STILL counted in Live ARR (ContractLiveDate <= today < ContractEndDate, or
// blank/2999 end date). Each opp is a clickable link to its Salesforce record so the
// team can investigate. Run: node --env-file=.env scripts/build-churn-investigate.mjs
import { google } from "googleapis";

const TAB = "Churn_Investigate";
const CHURN_STATUS = ["Contracts Ended (Churned)", "Contract Paused"];

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

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const { token, instance } = await sfAuth();
  const T = new Date().toISOString().slice(0, 10);

  const inList = CHURN_STATUS.map((s) => `'${s}'`).join(", ");
  const recs = await sfQueryAll(instance, token,
    `SELECT Id, Name, Account.Name, Owner.Name, Status__c, convertCurrency(AnnualContractValueARR__c), ContractLiveDate__c, ContractEndDate__c FROM Opportunity WHERE StageName IN ('Billing','Closed Won') AND Status__c IN (${inList})`);

  const rows = recs
    .map((r) => ({
      id: r.Id,
      opp: r.Name || "",
      acct: r.Account?.Name || "",
      owner: (r.Owner?.Name || "").split(" ")[0],
      status: r.Status__c || "",
      arr: Number(r.AnnualContractValueARR__c || 0),
      live: (r.ContractLiveDate__c || "").slice(0, 10),
      end: (r.ContractEndDate__c || "").slice(0, 10),
    }))
    .filter((r) => r.arr > 0 && r.live && r.live <= T && (!r.end || r.end > T))
    .sort((a, b) => b.arr - a.arr);

  const total = rows.reduce((s, r) => s + r.arr, 0);
  // Salesforce record redirect (works from classic or lightning): <instance>/<Id>
  const link = (id, label) => `=HYPERLINK("${instance}/${id}", "${String(label).replace(/"/g, '""')}")`;

  const header = ["Account", "Opportunity (click → Salesforce)", "Opp ID", "Owner", "Status", "ARR (USD)", "Contract Live", "Contract End"];
  const values = [
    [`Churned / paused but still counted in Live ARR — as of ${T}`],
    [`${rows.length} contracts · $${Math.round(total).toLocaleString()} total`],
    [],
    header,
    ...rows.map((r) => [
      r.acct,
      link(r.id, r.opp),
      link(r.id, r.id),
      r.owner,
      r.status,
      r.arr,
      r.live,
      r.end || "(blank)",
    ]),
  ];

  // Ensure tab exists; get its gid for the link.
  const meta = await api.spreadsheets.get({ spreadsheetId: ID });
  let sheet = meta.data.sheets.find((s) => s.properties.title === TAB);
  if (!sheet) {
    const add = await api.spreadsheets.batchUpdate({
      spreadsheetId: ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    sheet = { properties: add.data.replies[0].addSheet.properties };
  }
  const gid = sheet.properties.sheetId;

  await api.spreadsheets.values.clear({ spreadsheetId: ID, range: `${TAB}!A1:Z200` });
  await api.spreadsheets.values.update({
    spreadsheetId: ID,
    range: `${TAB}!A1`,
    valueInputOption: "USER_ENTERED", // so HYPERLINK() renders as a link
    requestBody: { values },
  });

  console.log(`Wrote ${rows.length} rows · $${Math.round(total).toLocaleString()} to "${TAB}"`);
  console.log(`Link: https://docs.google.com/spreadsheets/d/${ID}/edit#gid=${gid}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
