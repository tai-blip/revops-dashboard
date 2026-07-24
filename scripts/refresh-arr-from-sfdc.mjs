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

const SOQL = `SELECT Id, Name, AccountId, Owner.Name, RecordType.Name, StageName, Status__c,
  convertCurrency(AnnualContractValueARR__c),
  Merchant_Segment__c, Location_Tiers__c, DealCountry__c, Region__c, ChannelofContact__c,
  Locations_in_Contract__c, CloseDate, Date_Reached_SQL__c, Date_Reached_Closed_Won__c,
  Date_Reached_Closed_Lost__c, ContractLiveDate__c, ContractEndDate__c, CreatedDate
  FROM Opportunity WHERE StageName IN ('Billing','Closed Won','Closed Lost')`.replace(/\s+/g, " ");

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
const ser2ym = (s) => new Date(Date.UTC(1899, 11, 30) + s * 86400000).toISOString().slice(0, 7);

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });

  // 1) One pull from Salesforce (won + lost + billing)
  const { token, instance } = await sfAuth();
  const all = await sfQueryAll(instance, token, SOQL);
  const won = all.filter((x) => x.StageName !== "Closed Lost");
  console.log("SF pull:", all.length, "opps (", won.length, "won/billing,", all.length - won.length, "lost ) from", instance);

  // 2) Targets = current manual "ARR MoM Progression" series (Month serial in A, Total ARR in B)
  const mp = (await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "'ARR MoM Progression'!A2:B400", valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const targetByYm = {};
  for (const row of mp) { if (typeof row[0] === "number" && typeof row[1] === "number") targetByYm[ser2ym(row[0])] = row[1]; }

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
    ]);
  });

  // 5) SOQL_ClosedDeals — full analytics table (won + lost + billing)
  const closed = [[
    "Id","Opportunity","Owner","RecordType","Stage","Outcome","Merchant Segment","Location Tier",
    "Deal Country","Region","Channel of Contact","ARR (USD)","Locations","CloseDate",
    "Date Reached SQL","Date Reached Closed Won","Date Reached Closed Lost","ContractLiveDate","ContractEndDate","CreatedDate",
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
    ]);
  }

  // 6) ARR_MoM_Rebuild matrix (boundary = 1st of next month = $B+1)
  //    + churn (org's own marker: Status "Contracts Ended (Churned)", ending that month)
  //    + active-ARR split by RecordType (New Business / Renewals / Expansion; K+L+M ≈ C)
  const activeAt = (r, extra = "") =>
    `=SUMPRODUCT((SOQL_Pull!$D$2:$D$${LAST}<=$B${r}+1)*(SOQL_Pull!$E$2:$E$${LAST}>$B${r}+1)${extra}*SOQL_Pull!$C$2:$C$${LAST})`;
  const mom = [[
    "Month","Month-End","Active ARR — Rule A","Active ARR — Exact (renewal-netted)","Current series (target)",
    "Rule A vs Target ($)","Rule A vs Target (%)","MoM Change ($) [Rule A]","MoM Growth (%) [Rule A]",
    "Churned ARR (in month)","Active — New Business","Active — Renewals","Active — Expansion",
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
  const REGIONS = ["North America","APAC - Developed","APAC - Emerging","MEA"];
  const AES = [
    ["James Burdick","James"],["Dorsa Mahmoudnia","Dorsa"],["Jed Rutstein","Jed"],
    ["Jill Bucci","Jill"],["David Dubinski","Davi"],["Mathias Berthelemot","Mathias"],
  ];
  const nowD = new Date();
  const acvMonths = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - k, 1));
    acvMonths.push(d.toISOString().slice(0, 10)); // month start
  }
  // SOQL_ClosedDeals cols: F Outcome, G Segment, J Region, C Owner, L ARR, N CloseDate
  const avgIf = (r, dimCol, dimVal) =>
    `=IFERROR(AVERAGEIFS(SOQL_ClosedDeals!$L$2:$L$${all.length + 1},SOQL_ClosedDeals!$F$2:$F$${all.length + 1},"Won",SOQL_ClosedDeals!$L$2:$L$${all.length + 1},">0",SOQL_ClosedDeals!$N$2:$N$${all.length + 1},">="&$B${r},SOQL_ClosedDeals!$N$2:$N$${all.length + 1},"<"&EDATE($B${r},1)${dimVal ? `,SOQL_ClosedDeals!$${dimCol}$2:$${dimCol}$${all.length + 1},"${dimVal}"` : ""}),"")`;
  const acvTab = [[
    "Month","Month-Start","All: Avg ACV",
    ...SEGS.map((s) => `Seg: ${s}`),
    ...REGIONS.map((s) => `Reg: ${s}`),
    ...AES.map(([, short]) => `AE: ${short}`),
  ]];
  acvMonths.forEach((ms, i) => {
    const r = i + 2;
    acvTab.push([
      `=TEXT(B${r},"mmm yyyy")`, ms,
      avgIf(r, "", ""),
      ...SEGS.map((s) => avgIf(r, "G", s)),
      ...REGIONS.map((s) => avgIf(r, "J", s)),
      ...AES.map(([full]) => avgIf(r, "C", full)),
    ]);
  });

  // 7) Create-or-replace + bulk write (one values.update per tab)
  const meta = await api.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties(sheetId,title)" });
  const byTitle = Object.fromEntries(meta.data.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const reqs = [];
  for (const t of ["SOQL_Pull","SOQL_ClosedDeals","ARR_MoM_Rebuild","ARR_MoM_Segments","ACV_MoM"]) if (byTitle[t] != null) reqs.push({ deleteSheet: { sheetId: byTitle[t] } });
  reqs.push(
    { addSheet: { properties: { title: "SOQL_Pull" } } },
    { addSheet: { properties: { title: "SOQL_ClosedDeals", gridProperties: { rowCount: closed.length + 10, columnCount: 22 } } } },
    { addSheet: { properties: { title: "ARR_MoM_Rebuild" } } },
    { addSheet: { properties: { title: "ARR_MoM_Segments", gridProperties: { rowCount: seg.length + 10, columnCount: 30 } } } },
    { addSheet: { properties: { title: "ACV_MoM" } } },
  );
  await api.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "SOQL_Pull!A1", valueInputOption: "USER_ENTERED", requestBody: { values: pull } });
  // USER_ENTERED so date columns land as real dates (the ACV_MoM AVERAGEIFS compare against them)
  await api.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "SOQL_ClosedDeals!A1", valueInputOption: "USER_ENTERED", requestBody: { values: closed } });
  await api.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "ARR_MoM_Rebuild!A1", valueInputOption: "USER_ENTERED", requestBody: { values: mom } });
  await api.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "ARR_MoM_Segments!A1", valueInputOption: "USER_ENTERED", requestBody: { values: seg } });
  await api.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "ACV_MoM!A1", valueInputOption: "USER_ENTERED", requestBody: { values: acvTab } });

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
