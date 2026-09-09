import fs from "node:fs";
const D=JSON.parse(fs.readFileSync('/tmp/dash.json','utf8'));
const H=D.headlineSource, T=D.targetsSource;
const body=new URLSearchParams({grant_type:"client_credentials",client_id:process.env.SF_CLIENT_ID,client_secret:process.env.SF_CLIENT_SECRET});
const t=await (await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body})).json();
const v=process.env.SF_API_VERSION||"59.0";
const q=async(soql)=>{let url=`${t.instance_url}/services/data/v${v}/query?q=${encodeURIComponent(soql.replace(/\s+/g," "))}`;
 const rs=[];while(url){const j=await (await fetch(url,{headers:{Authorization:`Bearer ${t.access_token}`}})).json();
 if(!j.records){console.error("SOQL ERR",JSON.stringify(j).slice(0,200));return[];}rs.push(...j.records);url=j.done?null:t.instance_url+j.nextRecordsUrl;}return rs;};
const agg=async(soql)=>{const r=await q(soql);return Number(r?.[0]?.expr0??0);};

const F=[];  // findings
const usd=n=>"$"+Math.round(n).toLocaleString();
const chk=(tab,name,dash,sf,{tol=0.005,note="",fix=""}={})=>{
  if(dash==null||sf==null){F.push({tab,name,dash,sf,status:"NO DATA",note,fix});return;}
  const diff=dash-sf, rel=sf?Math.abs(diff/sf):(diff?1:0);
  F.push({tab,name,dash,sf,diff,rel,status: rel<=tol?"OK":"MISMATCH",note,fix});
};

const TODAY=new Date().toISOString().slice(0,10);
const Q3=["2026-07-01","2026-09-30"];

// ── 1. COMMAND ────────────────────────────────────────────────────────────
// Live ARR = contract live by today, not ended, not churned  (mirrors ARR_MoM_Rebuild W1)
const liveArr=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity
  WHERE StageName IN ('Billing','Closed Won') AND ContractLiveDate__c <= ${TODAY}
    AND (ContractEndDate__c = null OR ContractEndDate__c > ${TODAY})
    AND Status__c != 'Contracts Ended (Churned)'`);
chk("Command","Live ARR",H.live_arr,liveArr,{fix:"ARR_MoM_Rebuild!W1"});
chk("Command","Gap to $10M",H.gap_to_10m,10_000_000-liveArr,{fix:"derived from live_arr"});

// New ARR this month + churn (sales-month = calendar month)
const m0=TODAY.slice(0,7)+"-01";
const nextM=new Date(Date.UTC(+m0.slice(0,4),+m0.slice(5,7),1)).toISOString().slice(0,10);
const newArr=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity
  WHERE StageName IN ('Billing','Closed Won') AND RecordType.Name IN ('1.New Business','3.Business Expansion')
    AND ContractLiveDate__c >= ${m0} AND ContractLiveDate__c < ${nextM}`);
chk("Command","New ARR (month)",H.new_arr_mo,newArr,{fix:"ARR_MoM_Rebuild col Q (=N+O)"});
const churn=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity
  WHERE Status__c = 'Contracts Ended (Churned)' AND ContractEndDate__c >= ${m0} AND ContractEndDate__c < ${nextM}`);
chk("Command","Churned ARR (month)",H.churn_mo,churn,{fix:"ARR_MoM_Rebuild col J"});

// Open pipeline — both bases, to show which one the tile is on
const pipeArr=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity WHERE IsClosed = false`);
const pipeTcv=await agg(`SELECT SUM(convertCurrency(Amount)) FROM Opportunity WHERE IsClosed = false`);
const openN=(await q(`SELECT COUNT(Id) FROM Opportunity WHERE IsClosed = false`))?.[0]?.expr0 ?? null;
chk("Command","Open pipeline",H.total_pipeline,pipeArr,{note:`on a TCV basis Salesforce gives ${usd(pipeTcv)} — the tile matches TCV, not ARR`,fix:"Pipeline!B5 sums col D (TCV). For ARR it must sum col O."});
chk("Command","Open opportunities (#)",H.total_opps,openN,{tol:0});

// Q3 booked (New Business + Expansion live in Q3)
const q3Booked=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity
  WHERE StageName IN ('Billing','Closed Won') AND RecordType.Name IN ('1.New Business','3.Business Expansion')
    AND ContractLiveDate__c >= ${Q3[0]} AND ContractLiveDate__c <= ${Q3[1]}`);
chk("Command","Q3 booked (QTD)",H.q3_booked,q3Booked,{fix:"Headline q3_booked formula"});
chk("Command","Gap to Q3 target",H.gap_to_target,(H.q3_target??0)-q3Booked,{fix:"= q3_target − q3_booked"});

// Pipe generated this quarter — New Business SQL'd in Q3, valued on Amount
const pipeQ3=await agg(`SELECT SUM(convertCurrency(Amount)) FROM Opportunity
  WHERE RecordType.Name='1.New Business' AND Date_Reached_SQL__c >= ${Q3[0]} AND Date_Reached_SQL__c <= ${Q3[1]}
    AND Owner.Name != 'Tai Nguyen'`);
chk("Command","Pipe generated Q3",H.pipe_created_q3,pipeQ3,{fix:"Pipeline - WoW / pipegen formula"});

// ── 2. PIPELINE ───────────────────────────────────────────────────────────
chk("Pipeline","Total pipeline (ARR basis)",H.total_pipeline,pipeArr,{note:`TCV basis = ${usd(pipeTcv)}`,fix:"Pipeline!B5"});
chk("Pipeline","Coverage ratio",H.coverage,pipeArr/(H.pipe_quota||1),{tol:0.01,note:`the tile reads ${(H.coverage??0).toFixed(2)}x on TCV; on true ARR it is ${(pipeArr/(H.pipe_quota||1)).toFixed(2)}x`,fix:"follows whichever basis Pipeline!B5 uses"});
const pipeWeek=await agg(`SELECT SUM(convertCurrency(Amount)) FROM Opportunity
  WHERE RecordType.Name='1.New Business' AND Date_Reached_SQL__c >= LAST_N_DAYS:7 AND Owner.Name != 'Tai Nguyen'`);
chk("Pipeline","Pipe created this week",H.pipe_created_week,pipeWeek,{fix:"Pipeline - WoW weekly column"});

// ── 3. AE ATTAINMENT ──────────────────────────────────────────────────────
const AES=["James Burdick","Dorsa Mahmoudnia","Jed Rutstein","David Dubinski","Jill Bucci","Mathias Berthelemot"];
const aeRows=await q(`SELECT Owner.Name own, SUM(convertCurrency(AnnualContractValueARR__c)) arr FROM Opportunity
  WHERE StageName IN ('Billing','Closed Won') AND RecordType.Name='1.New Business'
    AND ContractLiveDate__c >= ${Q3[0]} AND ContractLiveDate__c <= ${Q3[1]}
    AND Owner.Name NOT IN ('Sri Muniandy','Jesse Brennan') GROUP BY Owner.Name`);
const sfAE=Object.fromEntries(aeRows.map(r=>[r.own,Number(r.arr||0)]));
// what the sheet shows
const ae=(D.aeAttainmentOfficial||D.aeAttainment||[]);
for(const name of AES){
  const sf=sfAE[name]??0;
  const row=Array.isArray(ae)?ae.find(r=>String(r.name||r.ae||"")===name):null;
  chk("AE Attainment",`${name} — Q3 actual`, row?Number(row.actual??row.q3??0):null, sf,
    {fix:"AE Attainment (Official) col D SUMPRODUCT over 'LiveARR - SOQL Pull'"});
}

// ── 4. BOOKED ARR & CASHFLOW ──────────────────────────────────────────────
const AF=D.arrFunnel?.stock?.[D.arrFunnel.stock.length-1];
const billed=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity
  WHERE StageName IN ('Billing','Closed Won') AND Live_Paying_Date__c != null AND Live_Paying_Date__c <= ${TODAY}
    AND (ContractEndDate__c = null OR ContractEndDate__c > ${TODAY}) AND Status__c != 'Contracts Ended (Churned)'`);
const contracted=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity
  WHERE StageName IN ('Billing','Closed Won') AND ContractLiveDate__c <= ${TODAY} AND Live_Paying_Date__c = null
    AND (ContractEndDate__c = null OR ContractEndDate__c > ${TODAY}) AND Status__c != 'Contracts Ended (Churned)'`);
const pilot=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity
  WHERE StageName='Trial' AND TrialStartDate__c != null`);
chk("Booked ARR & Cashflow","Billed ARR",AF?.live,billed,{fix:"ARR_Funnel tier formula"});
chk("Booked ARR & Cashflow","Contracted ARR",AF?.contracted,contracted,{fix:"ARR_Funnel tier formula"});
chk("Booked ARR & Cashflow","Pilot ARR",AF?.booked,pilot,{fix:"ARR_Funnel tier formula"});
chk("Booked ARR & Cashflow","Live ARR (Contracted+Billed)",AF?.liveArr,contracted+billed,{fix:"roll-up of the two tiers"});
chk("Booked ARR & Cashflow","Booked ARR (Live+Pilot)",AF?.bookedPilot,contracted+billed+pilot,{fix:"roll-up"});

// ── 5. TARGETS & PROGRESS ─────────────────────────────────────────────────
const ytdBooked=await agg(`SELECT SUM(convertCurrency(AnnualContractValueARR__c)) FROM Opportunity
  WHERE StageName IN ('Billing','Closed Won') AND RecordType.Name IN ('1.New Business','3.Business Expansion')
    AND ContractLiveDate__c >= 2026-01-01 AND ContractLiveDate__c <= ${TODAY}`);
chk("Targets & Progress","YTD New ARR booked",T.ytd_new_arr_booked,ytdBooked,{fix:"Targets ytd_new_arr_booked formula"});
chk("Targets & Progress","Q3 target (plan)",T.q3_target,null,{note:"finance plan — no Salesforce equivalent, cannot be verified"});
chk("Targets & Progress","FY26 New ARR target",T.fy26_new_arr_target,null,{note:"finance plan — no Salesforce equivalent"});
chk("Targets & Progress","AE quota total",T.ae_quota_q3_total,null,{note:"leadership-set — no Salesforce equivalent"});

// ── 6. FORECAST ───────────────────────────────────────────────────────────
const openByAE=await q(`SELECT Owner.Name own, SUM(convertCurrency(AnnualContractValueARR__c)) arr, COUNT(Id) n
  FROM Opportunity WHERE IsClosed=false AND StageName != 'Billing' AND Owner.Name IN ('James Burdick','Dorsa Mahmoudnia','Jed Rutstein','David Dubinski','Jill Bucci','Mathias Berthelemot') GROUP BY Owner.Name`);
const sfOpen=Object.fromEntries(openByAE.map(r=>[r.own,{arr:Number(r.arr||0),n:Number(r.n||0)}]));
const fcTeam=Object.values(sfOpen).reduce((s,x)=>s+x.arr,0);
chk("Forecast","Team open pipeline (excl. Billing, 6 AEs)",null,fcTeam,
  {note:"the Forecasting tab's team row sums only 4 of 7 reps — a known gap; recorded here so the true figure is on the record"});

fs.writeFileSync('/tmp/findings.json',JSON.stringify(F,null,1));
const bad=F.filter(f=>f.status!=="OK");
console.log(`${F.length} checks · ${F.filter(f=>f.status==="OK").length} OK · ${bad.length} need attention\n`);
for(const f of F) console.log(
  `${f.status==="OK"?"OK  ":f.status==="NO DATA"?"n/a ":"FAIL"} ${f.tab.padEnd(24)} ${f.name.padEnd(38)} dash ${String(f.dash==null?"—":Math.round(f.dash*100)/100).padStart(14)}  sf ${String(f.sf==null?"—":Math.round(f.sf*100)/100).padStart(14)}${f.rel!=null&&f.status!=="OK"?"  Δ "+(f.rel*100).toFixed(1)+"%":""}`);
