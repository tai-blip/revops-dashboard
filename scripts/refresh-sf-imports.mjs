// Replaces the three Coefficient Salesforce imports with direct SFDC pulls,
// preserving each tab's EXACT layout (row 1 banner, row 2 header, data from row 3)
// because downstream sheet formulas ("ARR & recurring revenue", Pipeline tabs)
// reference these positions/ranges.
//
//   Query 1            open opportunities (IsClosed = false)
//   Query 2            closed opportunities, CloseDate in last 18 months
//   LiveARR - SOQL Pull  Billing/Closed Won opps + lv_yr/lv_mo/lv_ok helper formulas
//
// LiveARR money fields use convertCurrency (aliased arrUsd/msUsd) because the org
// is multi-currency and the downstream "ARR & recurring revenue" formulas were
// built on USD values (matching the original Coefficient SOQL). Query 1/2 use the
// pre-computed *_Formula__c ARR field, which is already in corporate currency.
// Run: node --env-file=.env scripts/refresh-sf-imports.mjs
import { google } from "googleapis";

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
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const val = (v) => (v == null ? "" : typeof v === "object" ? v.Name ?? "" : v);
const banner = () =>
  `              Salesforce Import\n              Last updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC (auto — revops daily pull)`;

async function writeTab(api, tab, header, rows, extraCols = null) {
  // Clear everything below the header, then write banner + header + data.
  await api.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `'${tab}'!A3:Z10000` });
  const matrix = [[banner()], header, ...rows];
  await api.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `'${tab}'!A1`, valueInputOption: "USER_ENTERED",
    requestBody: { values: matrix },
  });
  if (extraCols) {
    await api.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `'${tab}'!${extraCols.range}`, valueInputOption: "USER_ENTERED",
      requestBody: { values: extraCols.values },
    });
  }
  console.log(`wrote ${tab}: ${rows.length} data rows`);
}

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const { token, instance } = await sfAuth();

  // ---- Query 1: open opportunities ----
  // Amount, AE_AM_Probability__c (quarter %) and AE_AM_Probability_Year__c (year %) power
  // the Forecast tab's stage-based Potential (SQL/SAL use Amount×%, SQO/Trial use ARR×%).
  const q1 = await sfQueryAll(instance, token,
    `SELECT Id, Name, StageName, Annual_Contract_Value_ARR_Formula__c, Expected_Revenue_Quarter_AE__c, CloseDate, CreatedDate, Date_Reached_SQL__c, ChannelofContact__c, Owner.Name, RecordType.Name, LastStageChangeDate, Amount, AE_AM_Probability__c, AE_AM_Probability_Year__c FROM Opportunity WHERE IsClosed = false`);
  await writeTab(api, "Query 1",
    ["Id","Name","StageName","Annual_Contract_Value_ARR_Formula__c","Expected_Revenue_Quarter_AE__c","CloseDate","CreatedDate","Date_Reached_SQL__c","ChannelofContact__c","Owner.Name","RecordType.Name","LastStageChangeDate","Amount","AE_AM_Probability__c","AE_AM_Probability_Year__c"],
    q1.map((x) => [x.Id, x.Name, x.StageName, val(x.Annual_Contract_Value_ARR_Formula__c), val(x.Expected_Revenue_Quarter_AE__c), val(x.CloseDate), val(x.CreatedDate), val(x.Date_Reached_SQL__c), val(x.ChannelofContact__c), x.Owner?.Name ?? "", x.RecordType?.Name ?? "", val(x.LastStageChangeDate), val(x.Amount), val(x.AE_AM_Probability__c), val(x.AE_AM_Probability_Year__c)]));

  // ---- Open pipeline - SOQL pull: open opps in the exact 18-col layout the
  //      "Pipeline" and "Pipeline - WoW" tab formulas expect. This tab used to be
  //      a Coefficient import (went stale when the trial expired — the Pipeline
  //      tabs were left pointing at it while everything else migrated to Query 1).
  //      Refreshing it here makes Pipeline, Pipeline - WoW, coverage, and the
  //      Slack digest's pipeline section all live again, with zero formula edits.
  //      Column order is load-bearing: the funnel formulas key off I=SQL, J=SAL,
  //      K=SQO date columns by position. Money fields pulled raw (no convertCurrency)
  //      to match the basis the tab's formulas were built on.
  const op = await sfQueryAll(instance, token,
    `SELECT Id, Name, StageName, Annual_Contract_Value_ARR_Formula__c, Expected_Revenue_Quarter_AE__c, CloseDate, LastStageChangeDate, ChannelofContact__c, Date_Reached_SQL__c, Date_Reached_SAL__c, Date_Reached_SQO__c, Amount, Owner.Name, RecordType.Name, AnnualContractValueARR__c, Date_Reached_Trial__c, Managed_Services_Tier__c, Chat_Agent_Tier__c FROM Opportunity WHERE IsClosed = false`);
  await writeTab(api, "Open pipeline - SOQL pull",
    ["Id","Name","StageName","Annual_Contract_Value_ARR_Formula__c","Expected_Revenue_Quarter_AE__c","CloseDate","LastStageChangeDate","ChannelofContact__c","Date_Reached_SQL__c","Date_Reached_SAL__c","Date_Reached_SQO__c","Amount","Owner.Name","RecordType.Name","AnnualContractValueARR__c","Date_Reached_Trial__c","Managed_Services_Tier__c","Chat_Agent_Tier__c"],
    op.map((x) => [x.Id, x.Name, x.StageName, val(x.Annual_Contract_Value_ARR_Formula__c), val(x.Expected_Revenue_Quarter_AE__c), val(x.CloseDate), val(x.LastStageChangeDate), val(x.ChannelofContact__c), val(x.Date_Reached_SQL__c), val(x.Date_Reached_SAL__c), val(x.Date_Reached_SQO__c), val(x.Amount), x.Owner?.Name ?? "", x.RecordType?.Name ?? "", val(x.AnnualContractValueARR__c), val(x.Date_Reached_Trial__c), val(x.Managed_Services_Tier__c), val(x.Chat_Agent_Tier__c)]));

  // ---- Query 2: closed opportunities, last 18 months ----
  const q2 = await sfQueryAll(instance, token,
    `SELECT Id, Name, StageName, IsWon, Annual_Contract_Value_ARR_Formula__c, CreatedDate, CloseDate, Date_Reached_SQL__c, Owner.Name, RecordType.Name, ContractLiveDate__c FROM Opportunity WHERE IsClosed = true AND CloseDate = LAST_N_MONTHS:18`);
  await writeTab(api, "Query 2",
    ["Id","Name","StageName","IsWon","Annual_Contract_Value_ARR_Formula__c","CreatedDate","CloseDate","Date_Reached_SQL__c","Owner.Name","RecordType.Name","ContractLiveDate__c"],
    q2.map((x) => [x.Id, x.Name, x.StageName, x.IsWon === true, val(x.Annual_Contract_Value_ARR_Formula__c), val(x.CreatedDate), val(x.CloseDate), val(x.Date_Reached_SQL__c), x.Owner?.Name ?? "", x.RecordType?.Name ?? "", val(x.ContractLiveDate__c)]));

  // ---- LiveARR - SOQL Pull: won/billing contracts + helper formula cols P/Q/R ----
  const lv = await sfQueryAll(instance, token,
    `SELECT Id, Name, StageName, Status__c, convertCurrency(AnnualContractValueARR__c) arrUsd, ContractLiveDate__c, ChannelofContact__c, ContractEndDate__c, Date_Reached_Billing__c, Date_Reached_Closed_Won__c, ChatAgent_Enabled__c, Owner.Name, RecordType.Name, Managed_Services_Tier__c, convertCurrency(Managed_Services_Year_1_Total__c) msUsd FROM Opportunity WHERE StageName IN ('Billing','Closed Won')`);
  const helper = lv.map((_, i) => {
    const r = i + 3; // data starts row 3
    return [
      `=IFERROR(YEAR(F${r}),0)`,
      `=IFERROR(MONTH(F${r}),0)`,
      `=IF((C${r}="Closed Won")+(D${r}="[LP] Live Paying")+(D${r}="[LP] Live Paying (Monthly)")>0,1,0)`,
      // Effective_Live_Date (col S): a contract live on the 1st counts to the prior
      // month — the "ARR & recurring revenue" formulas key their month math off this.
      `=IF(DAY(F${r})=1,F${r}-1,F${r})`,
    ];
  });
  await writeTab(api, "LiveARR - SOQL Pull",
    ["Id","Name","StageName","Status__c","AnnualContractValueARR__c","ContractLiveDate__c","ChannelofContact__c","ContractEndDate__c","Date_Reached_Billing__c","Date_Reached_Closed_Won__c","ChatAgent_Enabled__c","Owner.Name","RecordType.Name","Managed_Services_Tier__c","Managed_Services_Year_1_Total__c","lv_yr","lv_mo","lv_ok"],
    lv.map((x) => [x.Id, x.Name, x.StageName, val(x.Status__c), val(x.arrUsd), val(x.ContractLiveDate__c), val(x.ChannelofContact__c), val(x.ContractEndDate__c), val(x.Date_Reached_Billing__c), val(x.Date_Reached_Closed_Won__c), x.ChatAgent_Enabled__c === true, x.Owner?.Name ?? "", x.RecordType?.Name ?? "", val(x.Managed_Services_Tier__c), val(x.msUsd)]),
    { range: `P3:S${lv.length + 2}`, values: helper });

  console.log(`done: Query 1 ${q1.length} open | Query 2 ${q2.length} closed-18mo | LiveARR ${lv.length} won/billing`);
}
main().catch((e) => { console.error("REFRESH FAILED:", e.message); process.exit(1); });
