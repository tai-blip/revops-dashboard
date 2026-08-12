// Daily refresh: Salesforce Opportunities -> Google Sheet.
// Auth via Connected App (client credentials). ONE pull of all Billing/Closed Won/
// Closed Lost opps in USD, enriched with deal dimensions (segment, location tier,
// country, region, channel, owner) then:
//   - SOQL_Pull        (Billing/Closed Won)  cols A-J unchanged (feeds ARR_MoM_Rebuild
//                      formulas) + dimension cols K-P appended.
//   - SOQL_ClosedDeals (Won + Lost + Billing) full analytics table -> powers the
//                      dashboard's ACV & Deal Size tab (ACV by segment/region/AE,
//                      cycle by segment, win rate US vs Intl, ARR by location tier).
//   - ARR_MoM_Rebuild  rebuilt (1st-of-next-month boundary, Rule A canonical).
// Run: node --env-file=.env scripts/refresh-arr-from-sfdc.mjs
import { google } from "googleapis";

// ---------- Salesforce (client credentials) ----------
async function sfAuth() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });
  const r = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
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

// ---------- Google Sheets (write) ----------
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SOQL = `SELECT Id, Name, AccountId, Account.Name, Account.Payment_Terms__c, Owner.Name, RecordType.Name, StageName, Status__c,
  convertCurrency(AnnualContractValueARR__c),
  ChatAgent_Enabled__c, convertCurrency(Managed_Services_Year_1_Total__c),
  Merchant_Segment__c, Location_Tiers__c, DealCountry__c, Region__c, ChannelofContact__c,
  Locations_in_Contract__c, CloseDate, Date_Reached_SQL__c, Date_Reached_Closed_Won__c,
  Date_Reached_Closed_Lost__c, ContractLiveDate__c, ContractEndDate__c, CreatedDate,
  PaymentTerms__c, AccountManager__r.Name, Contract_Live_Date_Rip_Replace_LOC__c
  FROM Opportunity WHERE StageName IN ('Billing','Closed Won','Closed Lost')`.replace(/\s+/g, " ");

// Normalize the messy PaymentTerms__c picklist into Annual / Bi-Annual / Quarterly /
// Monthly / Other. Bi-Annual (SFDC "Bi-Annual_24_months") = 24-month upfront — kept as
// its own bucket (it's the longest commitment, e.g. James's Yoshinoya deal).
function normTerm(v) {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("bi-annual") || s.startsWith("bi_annual") || s.startsWith("biannual") || s.startsWith("bi annual") || s.startsWith("semi")) return "Bi-Annual";
  if (s.startsWith("annual")) return "Annual";
  if (s.startsWith("quarter")) return "Quarterly";
  if (s.startsWith("monthly")) return "Monthly";
  return "Other/Unknown";
}

function monthList(startY, startM /*1-based*/) {
  const now = new Date();
  const endY = now.getUTCFullYear(), endM = now.getUTCMonth() + 1;
  const out = [];
  let y = startY, m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month
    out.push({ ym: `${y}-${String(m).padStart(2, "0")}`, monthEnd });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Last n week-start dates (Mondays, UTC) as ISO strings — matches the dashboard's
// getWeekStart (Monday) convention so arr.weekly labels line up.
function weekList(n) {
  const now = new Date();
  const diff = (now.getUTCDay() + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(monday.getTime() - i * 7 * 86400000).toISOString().slice(0, 10));
  return out;
}
const ser2ym = (s) => new Date(Date.UTC(1899, 11, 30) + s * 86400000).toISOString().slice(0, 7);

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });

  // 1) One pull from Salesforce (won + lost + billing)
  const { token, instance } = await sfAuth();
  const all = await sfQueryAll(instance, token, SOQL);
  const won = all.filter((x) => x.StageName !== "Closed Lost");
  console.log("SF pull:", all.length, "opps (", won.length, "won/billing,", all.length - won.length, "lost ) from", instance);

  // 2) Reference series for the variance columns. The manual "ARR MoM Progression"
  //    tab was retired 2026-07-24 (ARR_MoM_Rebuild is canonical); if it's absent the
  //    target column simply stays blank.
  const mp = await api.spreadsheets.values
    .get({ spreadsheetId: SHEET_ID, range: "'ARR MoM Progression'!A2:B400", valueRenderOption: "UNFORMATTED_VALUE" })
    .then((r) => r.data.values || [])
    .catch(() => []);
  const targetByYm = {};
  for (const row of mp) { if (typeof row[0] === "number" && typeof row[1] === "number") targetByYm[ser2ym(row[0])] = row[1]; }

  // 2b) SOQL_PaymentMix — the "database" for the Payment Mix Report. Won deals with
  //     normalized payment term + Account Manager + ARR/dates/type, plus a per-account
  //     "Prev Term" (payment term of that account's most recent EARLIER won deal) used
  //     for the upcoming-renewals annual-conversion flag.
  const wonSorted = [...won].sort((a, b) => String(a.ContractLiveDate__c ?? "").localeCompare(String(b.ContractLiveDate__c ?? "")));
  const prevTermByAcct = {}; // last seen term per account as we walk chronologically
  const prevTermFor = {};    // opp Id -> term of the account's prior won deal
  for (const x of wonSorted) {
    prevTermFor[x.Id] = prevTermByAcct[x.AccountId] ?? "";
    prevTermByAcct[x.AccountId] = normTerm(x.PaymentTerms__c);
  }
  const pmix = [[
    "Id","Opportunity","Account","Type","Payment Term","ARR (USD)","Owner","Account Manager",
    "Region","Deal Country","ContractLiveDate","ContractEndDate","Prev Term",
  ]];
  for (const x of won) {
    // Prior term = the account's authoritative current arrangement (Account.Payment_Terms__c),
    // falling back to the reconstructed N-1 (prior won deal on the account) when blank.
    const acctTerm = x.Account?.Payment_Terms__c ? normTerm(x.Account.Payment_Terms__c) : "";
    pmix.push([
      x.Id, x.Name, x.Account?.Name ?? "",
      x.RecordType?.Name ?? "", normTerm(x.PaymentTerms__c), x.AnnualContractValueARR__c ?? 0,
      x.Owner?.Name ?? "", x.AccountManager__r?.Name ?? "",
      x.Region__c ?? "", x.DealCountry__c ?? "",
      x.ContractLiveDate__c ?? "", x.ContractEndDate__c ?? "", acctTerm || prevTermFor[x.Id] || "",
    ]);
  }

  // 3) Month rows (Apr 2021 -> current month)
  const months = monthList(2021, 4);
  const N = won.length, LAST = N + 1;

  const dim = (x) => [
    x.Owner?.Name ?? "",
    x.Merchant_Segment__c ?? "",
    x.Location_Tiers__c ?? "",
    x.DealCountry__c ?? "",
    x.Region__c ?? "",
    x.ChannelofContact__c ?? "",
  ];

  // 4) SOQL_Pull matrix — A-J layout unchanged (formulas depend on it), dims in K-P,
  //    locations-in-contract in Q (feeds the $/Location columns in ARR_MoM_Segments)
  const pull = [[
    "Id","AccountId","ARR (USD)","ContractLiveDate","ContractEndDate","RecordType","Status","Supersedes","NextSupersedingLive","EffectiveEndDate",
    "Owner","Merchant Segment","Location Tier","Deal Country","Region","Channel of Contact","Locations",
    "ChatAgent Enabled","Managed Services Y1 (USD)",  // R, S — feed the full-book product-line split
    "Signed Date",  // T — when the deal was booked (Closed Won date, else CloseDate/live) → powers Booked ARR
  ]];
  won.forEach((x, i) => {
    const r = i + 2;
    pull.push([
      x.Id, x.AccountId, x.AnnualContractValueARR__c ?? 0,
      x.ContractLiveDate__c, x.ContractEndDate__c || "2099-12-31",
      x.RecordType?.Name ?? "", x.Status__c ?? "",
      `=IF(OR(F${r}="1.New Business",F${r}="2.Renewals"),1,0)`,
      `=MINIFS($D$2:$D$${LAST},$B$2:$B$${LAST},B${r},$H$2:$H$${LAST},1,$D$2:$D$${LAST},">"&D${r})`,
      `=IF(H${r}=0,E${r},IF(I${r}=0,E${r},MIN(E${r},I${r})))`,
      ...dim(x),
      x.Locations_in_Contract__c ?? 0,
      x.ChatAgent_Enabled__c === true, x.Managed_Services_Year_1_Total__c ?? 0,
      (x.Date_Reached_Closed_Won__c || x.CloseDate || x.ContractLiveDate__c || "").slice(0, 10),
    ]);
  });

  // 5) SOQL_ClosedDeals — full analytics table (won + lost + billing)
  const closed = [[
    "Id","Opportunity","Owner","RecordType","Stage","Outcome","Merchant Segment","Location Tier",
    "Deal Country","Region","Channel of Contact","ARR (USD)","Locations","CloseDate",
    "Date Reached SQL","Date Reached Closed Won","Date Reached Closed Lost","ContractLiveDate","ContractEndDate","CreatedDate",
    "Status","RR LOC Date",
  ]];
  for (const x of all) {
    closed.push([
      x.Id, x.Name, x.Owner?.Name ?? "", x.RecordType?.Name ?? "", x.StageName,
      x.StageName === "Closed Lost" ? "Lost" : "Won",
      x.Merchant_Segment__c ?? "", x.Location_Tiers__c ?? "",
      x.DealCountry__c ?? "", x.Region__c ?? "", x.ChannelofContact__c ?? "",
      x.AnnualContractValueARR__c ?? 0, x.Locations_in_Contract__c ?? "",
      x.CloseDate ?? "", x.Date_Reached_SQL__c ?? "", x.Date_Reached_Closed_Won__c ?? "",
      x.Date_Reached_Closed_Lost__c ?? "", x.ContractLiveDate__c ?? "", x.ContractEndDate__c ?? "", (x.CreatedDate ?? "").slice(0, 10),
      x.Status__c ?? "", x.Contract_Live_Date_Rip_Replace_LOC__c ?? "",
    ]);
  }

  // 5b) Cash_Forecast — ISOLATED source for the Booked-ARR cash forecast so Trial deals
  //     never leak into SOQL_Pull/Live ARR. Signed-but-not-yet-paying deals across the
  //     three pre-Live-Paying stages (Closed Won, Billing, Trial). computeCashForecast
  //     filters to those with no Live Paying Date and a live/RR date, at anchor + 45 days.
  const cashFcRecs = await sfQueryAll(instance, token,
    `SELECT Owner.Name, Name, StageName, Status__c, convertCurrency(AnnualContractValueARR__c) arrUsd, ContractLiveDate__c, Contract_Live_Date_Rip_Replace_LOC__c, Live_Paying_Date__c FROM Opportunity WHERE StageName IN ('Closed Won','Billing','Trial')`);
  const cashFc = [[
    "Owner","Opportunity","Stage","Status","ARR (USD)","ContractLiveDate","RR LOC Date","Live Paying Date",
  ]];
  for (const x of cashFcRecs) {
    cashFc.push([
      x.Owner?.Name ?? "", x.Name ?? "", x.StageName ?? "", x.Status__c ?? "",
      x.arrUsd ?? 0, x.ContractLiveDate__c ?? "", x.Contract_Live_Date_Rip_Replace_LOC__c ?? "", x.Live_Paying_Date__c ?? "",
    ]);
  }

  // 5c) ARR_Funnel — the three-tier ARR funnel (Booked = Trial/pilot, Contracted = final
  //     order signed, Live = live-paying) with each deal's tier-transition dates, so the
  //     dashboard can plot both a cumulative funnel and a point-in-time stock MoM series.
  const funnelRecs = await sfQueryAll(instance, token,
    `SELECT Owner.Name, AccountManager__r.Name, Name, Account.Name, StageName, RecordType.Name, Status__c, convertCurrency(AnnualContractValueARR__c) arrUsd, Date_Reached_Trial__c, ContractSignedDate__c, ContractLiveDate__c, Contract_Live_Date_Rip_Replace_LOC__c, Live_Paying_Date__c, Date_Reached_Closed_Lost__c, ContractEndDate__c FROM Opportunity WHERE Date_Reached_Trial__c != null OR ContractSignedDate__c != null OR ContractLiveDate__c != null OR Live_Paying_Date__c != null`);
  const funnel = [[
    "Owner","AM","Opportunity","Account","Stage","Type","Status","ARR (USD)","TrialDate","SignedDate","LiveDate","RRDate","LivePayingDate","LostDate","EndDate",
  ]];
  for (const x of funnelRecs) {
    funnel.push([
      x.Owner?.Name ?? "", x.AccountManager__r?.Name ?? "", x.Name ?? "", x.Account?.Name ?? "", x.StageName ?? "", x.RecordType?.Name ?? "", x.Status__c ?? "",
      x.arrUsd ?? 0, x.Date_Reached_Trial__c ?? "", x.ContractSignedDate__c ?? "", x.ContractLiveDate__c ?? "", x.Contract_Live_Date_Rip_Replace_LOC__c ?? "", x.Live_Paying_Date__c ?? "",
      x.Date_Reached_Closed_Lost__c ?? "", x.ContractEndDate__c ?? "",
    ]);
  }
  // "Tier (today)" — the Booked/Contracted/Live classification computed IN the sheet
  // (col P), so finance/RevOps can verify the buckets without the dashboard code. Mirrors
  // computeArrFunnel's as-of-today logic. Cols: E Stage, G Status, H ARR, I Trial, K Live,
  // M LivePaying, N Lost, O End. ISNUMBER(date) = "the date is set" (blank cells aren't numbers).
  const signedF = (r) => `OR($E${r}="Billing",$E${r}="Closed Won")`;
  const notChurnF = (r) => `$G${r}<>"Contracts Ended (Churned)",$G${r}<>"Contract Paused"`;
  const tierF = (r) =>
    `=IF(NOT(AND(ISNUMBER($H${r}),$H${r}>0)),"",` +
    `IF(AND(${signedF(r)},${notChurnF(r)},ISNUMBER($M${r}),$M${r}<=TODAY(),OR(NOT(ISNUMBER($O${r})),$O${r}>TODAY())),"Live",` +
    `IF(AND(${signedF(r)},${notChurnF(r)},ISNUMBER($K${r}),$K${r}<=TODAY(),OR(NOT(ISNUMBER($M${r})),$M${r}>TODAY()),OR(NOT(ISNUMBER($O${r})),$O${r}>TODAY()),OR(NOT(ISNUMBER($N${r})),$N${r}>TODAY())),"Contracted",` +
    `IF(AND(ISNUMBER($I${r}),$I${r}<=TODAY(),OR(NOT(ISNUMBER($K${r})),$K${r}>TODAY()),OR(NOT(ISNUMBER($M${r})),$M${r}>TODAY()),OR(NOT(ISNUMBER($N${r})),$N${r}>TODAY())),"Booked",""))))`;
  funnel[0].push("Tier (today)");
  for (let i = 1; i < funnel.length; i++) funnel[i].push(tierF(i + 1));
  // Verifiable tier totals (cols R:S), SUMIF over the Tier column.
  const funnelSummary = [
    ["Tier totals — as of today", ""],
    ["Booked (pilot / Trial)", `=SUMIF($P:$P,"Booked",$H:$H)`],
    ["Contracted (live, not paying)", `=SUMIF($P:$P,"Contracted",$H:$H)`],
    ["Live ARR (paying)", `=SUMIF($P:$P,"Live",$H:$H)`],
    ["Contracted + Live (ties to finance)", `=S3+S4`],
  ];

  // 6) ARR_MoM_Rebuild matrix (boundary = 1st of next month = $B+1)
  //    + churn (org's own marker: Status "Contracts Ended (Churned)", ending that month)
  //    + active-ARR split by RecordType (New Business / Renewals / Expansion; K+L+M ≈ C)
  const activeAt = (r, extra = "") =>
    `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$E$2:$E$${LAST}>$B${r}+1)${extra}*SOQL_Pull!$C$2:$C$${LAST})`;
  // FLOW: ARR that went LIVE during this month (full book — counts a deal even if it
  // later churned, unlike the survivor-only "ARR & recurring revenue" tab). Bounded by
  // ContractLiveDate in (prev-month-end+1, this-month-end+1], same 1st-of-next boundary.
  const addedAt = (r, extra = "") => {
    const lb = r === 2 ? "0" : `$B${r - 1}+1`;
    return `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}>${lb})*(SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)${extra}*SOQL_Pull!$C$2:$C$${LAST})`;
  };
  const mom = [[
    "Month","Month-End","Active ARR — Rule A","Active ARR — Exact (renewal-netted)","Current series (target)",
    "Rule A vs Target ($)","Rule A vs Target (%)","MoM Change ($) [Rule A]","MoM Growth (%) [Rule A]",
    "Churned ARR (in month)","Active — New Business","Active — Renewals","Active — Expansion",
    "New Business Added","Expansion Added","Renewals Added","New ARR Added (NB+Exp)",
    "Alfie ARR (Chat Agent)","Managed Services ARR","Core ARR",
    "Booked ARR",  // U — signed-by-boundary book (Live + signed-but-not-yet-live), same end gate as Active
  ]];
  months.forEach((m, i) => {
    const r = i + 2;
    mom.push([
      `=TEXT(B${r},"mmm yyyy")`, m.monthEnd,
      activeAt(r),
      `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$J$2:$J$${LAST}>$B${r}+1)*SOQL_Pull!$C$2:$C$${LAST})`,
      targetByYm[m.ym] ?? "",
      `=IFERROR(C${r}-E${r},"")`,
      `=IFERROR((C${r}-E${r})/E${r},"")`,
      r === 2 ? "" : `=C${r}-C${r-1}`,
      r === 2 ? "" : `=IFERROR((C${r}-C${r-1})/C${r-1},"")`,
      `=SUMPRODUCT((SOQL_Pull!$E$2:$E$${LAST}>EOMONTH($B${r},-1))*(SOQL_Pull!$E$2:$E$${LAST}<=$B${r})*(SOQL_Pull!$G$2:$G$${LAST}="Contracts Ended (Churned)")*SOQL_Pull!$C$2:$C$${LAST})`,
      activeAt(r, `*(SOQL_Pull!$F$2:$F$${LAST}="1.New Business")`),
      activeAt(r, `*(SOQL_Pull!$F$2:$F$${LAST}="2.Renewals")`),
      activeAt(r, `*(SOQL_Pull!$F$2:$F$${LAST}="3.Business Expansion")`),
      // N–Q: monthly FLOW (added this month, full book)
      addedAt(r, `*(SOQL_Pull!$F$2:$F$${LAST}="1.New Business")`),
      addedAt(r, `*(SOQL_Pull!$F$2:$F$${LAST}="3.Business Expansion")`),
      addedAt(r, `*(SOQL_Pull!$F$2:$F$${LAST}="2.Renewals")`),
      `=N${r}+O${r}`,
      // R–T: full-book product-line split (Alfie = full ARR of ChatAgent deals;
      // MS = Managed Services Y1 revenue; Core = Active − Alfie − MS — same definition
      // as the old recurring tab, now on the point-in-time full book.)
      activeAt(r, `*(SOQL_Pull!$R$2:$R$${LAST}=TRUE)`),
      `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$E$2:$E$${LAST}>$B${r}+1)*SOQL_Pull!$S$2:$S$${LAST})`,
      `=C${r}-R${r}-S${r}`,
      // U — Booked ARR: signed on/before boundary and not yet ended (gate on Signed Date T
      // instead of ContractLiveDate D), so it counts signed-but-not-yet-live deals too.
      `=SUMPRODUCT((SOQL_Pull!$T$2:$T$${LAST}<>"")*(SOQL_Pull!$T$2:$T$${LAST}<=$B${r}+1)*(SOQL_Pull!$E$2:$E$${LAST}>$B${r}+1)*SOQL_Pull!$C$2:$C$${LAST})`,
    ]);
  });

  // 6a2) ARR_WoW_Rebuild — the SAME full-book metrics, WEEKLY (last 16 Mondays), so the
  //      dashboard's weekly ARR chart is Rule A too and the survivor "recurring" tab can
  //      be retired. Boundary A+7 (next Monday) mirrors the monthly $B+1.
  const weeks = weekList(16);
  const wActive = (r, extra = "") =>
    `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$A${r}+7)*(SOQL_Pull!$E$2:$E$${LAST}>$A${r}+7)${extra}*SOQL_Pull!$C$2:$C$${LAST})`;
  const wAdded = (r, extra = "") =>
    `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}>$A${r})*(SOQL_Pull!$D$2:$D$${LAST}<=$A${r}+7)${extra}*SOQL_Pull!$C$2:$C$${LAST})`;
  const wow = [[
    "Week Start","Active ARR","Churned (in week)","New Business Added","Expansion Added","Renewals Added",
    "New ARR Added (NB+Exp)","Alfie ARR (Chat Agent)","Managed Services ARR","Core ARR",
  ]];
  weeks.forEach((wk, i) => {
    const r = i + 2;
    wow.push([
      wk, wActive(r),
      `=SUMPRODUCT((SOQL_Pull!$E$2:$E$${LAST}>=$A${r})*(SOQL_Pull!$E$2:$E$${LAST}<$A${r}+7)*(SOQL_Pull!$G$2:$G$${LAST}="Contracts Ended (Churned)")*SOQL_Pull!$C$2:$C$${LAST})`,
      wAdded(r, `*(SOQL_Pull!$F$2:$F$${LAST}="1.New Business")`),
      wAdded(r, `*(SOQL_Pull!$F$2:$F$${LAST}="3.Business Expansion")`),
      wAdded(r, `*(SOQL_Pull!$F$2:$F$${LAST}="2.Renewals")`),
      `=D${r}+E${r}`,
      wActive(r, `*(SOQL_Pull!$R$2:$R$${LAST}=TRUE)`),
      `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$A${r}+7)*(SOQL_Pull!$E$2:$E$${LAST}>$A${r}+7)*SOQL_Pull!$S$2:$S$${LAST})`,
      `=B${r}-H${r}-I${r}`,
    ]);
  });

  // 6b) ARR_MoM_Segments — active ARR at each month-end (same boundary) split by
  //     US/Intl, Merchant Segment, Location Tier, Channel of Contact. Jan-2025 →
  //     present keeps the formula count light. "Unclassified/No tier/Other" are
  //     derived (Total − named) so nothing is silently dropped.
  const SEGS = ["Small","Medium","Mid-Market","Enterprise","Mega Enterprise"];
  const TIERS = ["1 to 5","6 to 10","11 to 50","51 to 250","251 to 500","More than 500"];
  const CHANNELS = ["Outbound (AE)","Conference (Attendee)","Inbound","External Referral","Sales Agency","Momos Employee Referral","Conference (Host)"];
  const segMonths = months.filter((m) => m.ym >= "2025-01");
  const seg = [[
    "Month","Month-End","Total Active ARR","US","International",
    ...SEGS.map((s) => `Seg: ${s}`), "Seg: Unclassified",
    ...TIERS.map((t) => `Tier: ${t}`), "Tier: none",
    ...CHANNELS.map((c) => `Ch: ${c}`), "Ch: Other/Unknown",
    "Active Locations","$ / Location",
  ]];
  segMonths.forEach((m, i) => {
    const r = i + 2;
    // column letters: F..J segs, K uncl, L..Q tiers, R none, S..Y channels, Z other,
    // AA active locations (SOQL_Pull col Q), AB = ARR / location
    seg.push([
      `=TEXT(B${r},"mmm yyyy")`, m.monthEnd,
      activeAt(r),
      activeAt(r, `*(SOQL_Pull!$N$2:$N$${LAST}="United States")`),
      activeAt(r, `*(SOQL_Pull!$N$2:$N$${LAST}<>"United States")`),
      ...SEGS.map((s) => activeAt(r, `*(SOQL_Pull!$L$2:$L$${LAST}="${s}")`)),
      `=C${r}-SUM(F${r}:J${r})`,
      ...TIERS.map((t) => activeAt(r, `*(SOQL_Pull!$M$2:$M$${LAST}="${t}")`)),
      `=C${r}-SUM(L${r}:Q${r})`,
      ...CHANNELS.map((c) => activeAt(r, `*(SOQL_Pull!$P$2:$P$${LAST}="${c}")`)),
      `=C${r}-SUM(S${r}:Y${r})`,
      `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$E$2:$E$${LAST}>$B${r}+1)*SOQL_Pull!$Q$2:$Q$${LAST})`,
      `=IFERROR(C${r}/AA${r},"")`,
    ]);
  });

  // 6c) ACV_MoM — avg ACV of deals WON in each month (last 12 months), by Segment /
  //     Region / AE. AVERAGEIFS over SOQL_ClosedDeals so every number is verifiable
  //     in-sheet. CloseDate basis; ARR>0 to keep $0 bookkeeping rows out of averages.
  //     Renewals are EXCLUDED (col D) — ACV counts New Business + Expansion only.
  const REGIONS = ["North America","APAC - Developed","APAC - Emerging","MEA"];
  const AES = [
    ["James Burdick","James"],["Jed Rutstein","Jed"],
    ["Jill Bucci","Jill"],["David Dubinski","Davi"],["Mathias Berthelemot","Mathias"],
    // AMs (their NB+Expansion deals only — renewals are excluded from ACV math)
    ["Ben Conway","Ben"],["Jesse Brennan","Jesse"],["Eufthlyn Ng","Euth"],
    ["Lara Keresztes","Lara"],["Jan Onal","Jan"],
  ];
  const nowD = new Date();
  const acvMonths = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - k, 1));
    acvMonths.push(d.toISOString().slice(0, 10)); // month start
  }
  // SOQL_ClosedDeals cols: F Outcome, G Segment, J Region, C Owner, L ARR, N CloseDate
  const dealIfs = (r, dimCol, dimVal) =>
    `SOQL_ClosedDeals!$F$2:$F$${all.length + 1},"Won",SOQL_ClosedDeals!$D$2:$D$${all.length + 1},"<>2.Renewals",SOQL_ClosedDeals!$L$2:$L$${all.length + 1},">0",SOQL_ClosedDeals!$N$2:$N$${all.length + 1},">="&$B${r},SOQL_ClosedDeals!$N$2:$N$${all.length + 1},"<"&EDATE($B${r},1)${dimVal ? `,SOQL_ClosedDeals!$${dimCol}$2:$${dimCol}$${all.length + 1},"${dimVal}"` : ""}`;
  const avgIf = (r, dimCol, dimVal) =>
    `=IFERROR(AVERAGEIFS(SOQL_ClosedDeals!$L$2:$L$${all.length + 1},${dealIfs(r, dimCol, dimVal)}),"")`;
  const sumIf = (r, dimCol, dimVal) =>
    `=SUMIFS(SOQL_ClosedDeals!$L$2:$L$${all.length + 1},${dealIfs(r, dimCol, dimVal)})`;
  const acvTab = [[
    "Month","Month-Start","All: Avg ACV",
    ...SEGS.map((s) => `Seg: ${s}`),
    ...REGIONS.map((s) => `Reg: ${s}`),
    ...AES.map(([, short]) => `AE: ${short}`),
    // monthly WON ARR (NB+Expansion) — the dashboard accumulates these into the
    // cumulative bars behind each avg-ACV trend line
    "Sum All",
    ...SEGS.map((s) => `Sum Seg: ${s}`),
    ...REGIONS.map((s) => `Sum Reg: ${s}`),
    ...AES.map(([, short]) => `Sum AE: ${short}`),
  ]];
  acvMonths.forEach((ms, i) => {
    const r = i + 2;
    acvTab.push([
      `=TEXT(B${r},"mmm yyyy")`, ms,
      avgIf(r, "", ""),
      ...SEGS.map((s) => avgIf(r, "G", s)),
      ...REGIONS.map((s) => avgIf(r, "J", s)),
      ...AES.map(([full]) => avgIf(r, "C", full)),
      sumIf(r, "", ""),
      ...SEGS.map((s) => sumIf(r, "G", s)),
      ...REGIONS.map((s) => sumIf(r, "J", s)),
      ...AES.map(([full]) => sumIf(r, "C", full)),
    ]);
  });

  // 6d) ARR_per_Location_MoM — $/location/MONTH, 3 series, all sheet-computed:
  //   Total   = active-book ARR ÷ active locations ÷ 12 (SOQL_Pull, boundary = 1st of next month)
  //   New Biz = ARR of New Business deals WON that month ÷ their locations ÷ 12 (SOQL_ClosedDeals)
  //   Expansion = same for Business Expansion deals won that month
  // Raw components kept in cols F–K so every $/loc is checkable.
  const CD = all.length + 1;
  const sumifsCD = (col, rt, r) =>
    `SUMIFS(SOQL_ClosedDeals!$${col}$2:$${col}$${CD},SOQL_ClosedDeals!$F$2:$F$${CD},"Won",SOQL_ClosedDeals!$D$2:$D$${CD},"${rt}",SOQL_ClosedDeals!$N$2:$N$${CD},">="&$B${r},SOQL_ClosedDeals!$N$2:$N$${CD},"<"&EDATE($B${r},1))`;
  const perLoc = [[
    "Month","Month-Start","$/loc/mo — Total (active book)","$/loc/mo — New Business","$/loc/mo — Expansion",
    "Total ARR","Total Locations","NB ARR (won this mo)","NB Locations","Expansion ARR (won this mo)","Expansion Locations",
  ]];
  acvMonths.forEach((ms, i) => {
    const r = i + 2;
    const bnd = `EDATE($B${r},1)`; // active as of end of this month = 1st of next month
    perLoc.push([
      `=TEXT(B${r},"mmm yyyy")`, ms,
      `=IFERROR(F${r}/G${r}/12,"")`,  // Total  $/loc/mo
      `=IFERROR(H${r}/I${r}/12,"")`,  // New Biz $/loc/mo
      `=IFERROR(J${r}/K${r}/12,"")`,  // Expansion $/loc/mo
      `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=${bnd})*(SOQL_Pull!$E$2:$E$${LAST}>${bnd})*SOQL_Pull!$C$2:$C$${LAST})`,
      `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=${bnd})*(SOQL_Pull!$E$2:$E$${LAST}>${bnd})*SOQL_Pull!$Q$2:$Q$${LAST})`,
      `=${sumifsCD("L", "1.New Business", r)}`,
      `=${sumifsCD("M", "1.New Business", r)}`,
      `=${sumifsCD("L", "3.Business Expansion", r)}`,
      `=${sumifsCD("M", "3.Business Expansion", r)}`,
    ]);
  });

  // 6d) Top_Booked_ARR — the 5 largest contracts currently in the booked book
  //     (signed & not yet ended as of today — Live OR signed-but-pending go-live).
  //     Same raw end-date basis as the Live-ARR-as-of-today headline (W1), for consistency.
  const todayISO = new Date().toISOString().slice(0, 10);
  const bookedNow = won
    .map((x) => ({
      opp: x.Name ?? "", acct: x.Account?.Name ?? "", owner: x.Owner?.Name ?? "",
      arr: Number(x.AnnualContractValueARR__c ?? 0),
      live: (x.ContractLiveDate__c ?? "").slice(0, 10),
      end: (x.ContractEndDate__c ?? "").slice(0, 10),
    }))
    .filter((d) => d.arr > 0 && (!d.end || d.end > todayISO))
    .sort((a, b) => b.arr - a.arr)
    .slice(0, 5);
  const topStamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const topBooked = [
    ["Top 5 booked contracts (currently in the book — Live or signed pending go-live)", "", "", "", "", `Updated ${topStamp}`],
    ["Opportunity", "Account", "Owner", "ARR (USD)", "Status", "Live Date"],
    ...bookedNow.map((d) => [d.opp, d.acct, d.owner, Math.round(d.arr), !d.live || d.live > todayISO ? "Pending" : "Live", d.live || "not set"]),
  ];

  // 6e) ARR_Forward — forward-looking Booked ARR for the composition chart.
  //     Per RevOps: Booked ARR(future month) = last live ARR + CUMULATIVE ARR of deals
  //     with ContractLiveDate in each future month. End dates are NOT subtracted (no
  //     churn/expiry) — the line only steps up as scheduled go-lives land. The frontend
  //     anchors this at the last complete month's Live ARR. Window runs to Jan 2027.
  //     Also surfaces "renewal due" = ARR of contracts whose term ENDS in the current
  //     month (the ~$300k of accounts up for renewal), for the exec-summary box.
  const fwdNow = new Date();
  const curY = fwdNow.getUTCFullYear(), curM = fwdNow.getUTCMonth() + 1; // e.g. 2026, 8
  const curYM = `${curY}-${String(curM).padStart(2, "0")}`;
  const MNAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Forward months: current month → Jan 2027 inclusive.
  const fwdList = [];
  { let y = curY, m = curM; while (y < 2027 || (y === 2027 && m <= 1)) { fwdList.push({ y, m, ym: `${y}-${String(m).padStart(2, "0")}` }); m++; if (m > 12) { m = 1; y++; } } }
  const goLive = {}; // ym -> { nb, exp }
  for (const x of won) {
    const ym = (x.ContractLiveDate__c ?? "").slice(0, 7);
    if (!goLive[ym]) goLive[ym] = { nb: 0, exp: 0 };
    const arr = Number(x.AnnualContractValueARR__c ?? 0);
    const rt = x.RecordType?.Name ?? "";
    if (/Expansion/i.test(rt)) goLive[ym].exp += arr;
    else if (/New Business/i.test(rt)) goLive[ym].nb += arr;
    else goLive[ym].nb += arr; // renewals rarely have a future live date; bucket as NB
  }
  // Renewal-due = ARR of contracts whose term ends in the current month, using the same
  // 1st-of-next-month boundary as Live/Booked ARR — so a contract dated the 1st of next
  // month (its last active day is this month) counts as a this-month renewal. i.e.
  // end in (firstOfThisMonth, firstOfNextMonth].
  const firstThis = curYM + "-01";
  const firstNext = (curM === 12 ? `${curY + 1}-01` : `${curY}-${String(curM + 1).padStart(2, "0")}`) + "-01";
  let renewalDue = 0;
  for (const x of won) { const e = (x.ContractEndDate__c ?? "").slice(0, 10); if (e && e > firstThis && e <= firstNext) renewalDue += Number(x.AnnualContractValueARR__c ?? 0); }
  const arrForward = [
    ["Renewal due (contract end this month)", Math.round(renewalDue), "Current month", curYM, `Updated ${topStamp}`],
    ["Month", "YM", "GoLive NB", "GoLive Exp", "GoLive Total"],
    ...fwdList.map((f) => {
      const g = goLive[f.ym] ?? { nb: 0, exp: 0 };
      return [`${MNAMES[f.m - 1]} ${f.y}`, f.ym, Math.round(g.nb), Math.round(g.exp), Math.round(g.nb + g.exp)];
    }),
  ];

  // 7) Create-or-replace + bulk write (one values.update per tab)
  const meta = await api.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties(sheetId,title)" });
  const byTitle = Object.fromEntries(meta.data.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const reqs = [];
  for (const t of ["SOQL_Pull","SOQL_ClosedDeals","ARR_MoM_Rebuild","ARR_WoW_Rebuild","ARR_MoM_Segments","ACV_MoM","ARR_per_Location_MoM","SOQL_PaymentMix","Top_Booked_ARR","ARR_Forward","Cash_Forecast","ARR_Funnel"]) if (byTitle[t] != null) reqs.push({ deleteSheet: { sheetId: byTitle[t] } });
  reqs.push(
    { addSheet: { properties: { title: "SOQL_Pull" } } },
    { addSheet: { properties: { title: "SOQL_ClosedDeals", gridProperties: { rowCount: closed.length + 10, columnCount: 24 } } } },
    { addSheet: { properties: { title: "ARR_MoM_Rebuild" } } },
    { addSheet: { properties: { title: "ARR_WoW_Rebuild", gridProperties: { rowCount: wow.length + 5, columnCount: 10 } } } },
    { addSheet: { properties: { title: "ARR_MoM_Segments", gridProperties: { rowCount: seg.length + 10, columnCount: 30 } } } },
    { addSheet: { properties: { title: "ACV_MoM", gridProperties: { rowCount: 20, columnCount: 50 } } } },
    { addSheet: { properties: { title: "ARR_per_Location_MoM", gridProperties: { rowCount: 20, columnCount: 12 } } } },
    { addSheet: { properties: { title: "SOQL_PaymentMix", gridProperties: { rowCount: pmix.length + 10, columnCount: 14 } } } },
    { addSheet: { properties: { title: "Top_Booked_ARR", gridProperties: { rowCount: 20, columnCount: 6 } } } },
    { addSheet: { properties: { title: "ARR_Forward", gridProperties: { rowCount: 24, columnCount: 6 } } } },
    { addSheet: { properties: { title: "Cash_Forecast", gridProperties: { rowCount: cashFc.length + 10, columnCount: 8 } } } },
    { addSheet: { properties: { title: "ARR_Funnel", gridProperties: { rowCount: funnel.length + 10, columnCount: 20 } } } },
  );
  await api.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs } });
  // Collapse all tab writes into TWO batched calls (one per valueInputOption) instead of
  // ~10 individual values.update calls — keeps us well under the Sheets API "write
  // requests per minute" quota so the downstream daily-digest step doesn't get rate-limited.
  // USER_ENTERED so date columns land as real dates (the ACV_MoM AVERAGEIFS compare against them).
  // ARR_MoM_Rebuild!V1 = Live ARR AS OF TODAY (contracts live & not yet ended as of TODAY()) —
  // the true point-in-time live ARR, vs the current-month row which projects month-end.
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: {
    valueInputOption: "USER_ENTERED",
    data: [
      { range: "SOQL_Pull!A1", values: pull },
      { range: "SOQL_ClosedDeals!A1", values: closed },
      { range: "ARR_MoM_Rebuild!A1", values: mom },
      // Live ARR (as of today) = contract-live by date, MINUS Contracts Ended (Churned).
      // The churn exclusion (col G) ties to finance's Quarterly Trend export (~$5.78M);
      // without it a pure date rule counts churned contracts whose end date was never
      // backdated. (Folded in from the fix-live-arr-status-filter work.)
      { range: "ARR_MoM_Rebuild!V1", values: [["Live ARR (as of today)", `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=TODAY())*(SOQL_Pull!$E$2:$E$${LAST}>TODAY())*(SOQL_Pull!$G$2:$G$${LAST}<>"Contracts Ended (Churned)")*SOQL_Pull!$C$2:$C$${LAST})`]] },
      { range: "ARR_WoW_Rebuild!A1", values: wow },
      { range: "ARR_MoM_Segments!A1", values: seg },
      { range: "ACV_MoM!A1", values: acvTab },
      { range: "ARR_per_Location_MoM!A1", values: perLoc },
      { range: "SOQL_PaymentMix!A1", values: pmix },
      { range: "Top_Booked_ARR!A1", values: topBooked },
      { range: "Cash_Forecast!A1", values: cashFc },
      { range: "ARR_Funnel!A1", values: funnel },
      { range: "ARR_Funnel!R1", values: funnelSummary },
    ],
  } });
  // RAW so month labels ("2026-08", "Aug 2026") stay TEXT — USER_ENTERED would coerce them to dates.
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: {
    valueInputOption: "RAW",
    data: [{ range: "ARR_Forward!A1", values: arrForward }],
  } });

  // 8) Report latest month + MAPE vs target
  const back = (await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `ARR_MoM_Rebuild!A2:G${months.length+1}`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const ape = [];
  let latest = null;
  back.forEach((row, i) => {
    const ruleA = row[2], target = row[4];
    if (typeof ruleA === "number" && typeof target === "number" && target > 0) ape.push(Math.abs((ruleA - target) / target));
    if (typeof ruleA === "number" && ruleA > 0) latest = { ym: months[i].ym, ruleA: Math.round(ruleA) };
  });
  const mape = ape.length ? (ape.reduce((s,v)=>s+v,0)/ape.length*100).toFixed(1)+"%" : "n/a";
  console.log(`wrote SOQL_Pull (${pull.length}) + SOQL_ClosedDeals (${closed.length}) + ARR_MoM_Rebuild (${mom.length})`);
  console.log(`latest month: ${latest?.ym} Rule A = $${latest?.ruleA?.toLocaleString()} | MAPE vs current series: ${mape}`);
}
main().catch(e => { console.error("REFRESH FAILED:", e.message); process.exit(1); });
