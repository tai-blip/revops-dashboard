import fs from "node:fs";
const raw=JSON.parse(fs.readFileSync('/tmp/funnel-raw.json','utf8'));
const d=s=>s?String(s).slice(0,10):null;
const days=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000);

// ── §2 entry date ───────────────────────────────────────────────────────────
const entryOf=r=>{
  if(r.Date_Reached_SQL__c) return d(r.Date_Reached_SQL__c);
  const c=[r.Date_Reached_SAL__c,r.Date_Reached_SQO__c,r.Date_Reached_Trial__c,r.CreatedDate].filter(Boolean).map(d).sort();
  return c[0]??null;
};
// ── §2 sales-cycle quarters: Q1 = 2 Jan–1 Apr etc, FY = calendar year of start
const QS=[];
for(const y of [2025,2026]) for(const [i,[a,b]] of [["01-02","04-01"],["04-02","07-01"],["07-02","10-01"],["10-02","01-01"]].entries()){
  const endY = i===3 ? y+1 : y;
  QS.push({label:`Q${i+1} FY${String(y).slice(2)}`, from:`${y}-${a}`, to:`${endY}-${b}`});
}
// §1: last 6 quarters rolling, currently Q2 FY25 – Q3 FY26 QTD. Anything past the current
// quarter is a future cohort and is out of scope — including it inflated the exclusion counts.
const COHORTS=["Q2 FY25","Q3 FY25","Q4 FY25","Q1 FY26","Q2 FY26","Q3 FY26"];
const qOf=dt=>{const l=QS.find(q=>dt>=q.from&&dt<=q.to)?.label??null; return COHORTS.includes(l)?l:null;};

// ── §2 exclusions ───────────────────────────────────────────────────────────
const SEGS=["SMB","Mid-Market","Enterprise","Mega Enterprise"];
const ex={unclassified:0,test:0,quickloss:0,outside:0,noentry:0};
const lostDate=r=>d(r.Date_Reached_Closed_Lost__c)??d(r.ClosedLostDate__c);
const deals=[];
for(const r of raw){
  const entry=entryOf(r); if(!entry){ex.noentry++;continue;}
  if(entry < "2025-04-02"){ex.outside++;continue;}
  const qn=qOf(entry); if(!qn){ex.outside++;continue;}
  const seg=String(r.Account?.Merchant_Segment__c??"").trim();
  if(!seg||seg==="To be Classified"){ex.unclassified++;continue;}
  if(String(r.Account?.Name??"").trim()==="Test"){ex.test++;continue;}
  const ld=lostDate(r);
  if(r.StageName==="Closed Lost" && String(r.Previous_stage__c??"")==="SQL" && ld && days(entry,ld)<=30){ex.quickloss++;continue;}
  // ── §3 per-deal flags ──
  const st=r.StageName;
  const R_CW = st==="Closed Won";
  const R_Billing = !!r.Date_Reached_Billing__c || st==="Billing" || R_CW;
  const R_Trial = !!r.Date_Reached_Trial__c || st==="Trial" || R_Billing;
  const R_SQO = !!r.Date_Reached_SQO__c || ["SQO","Negotiation","Proposal","Pending Signature"].includes(st) || R_Trial;
  const R_SAL = !!r.Date_Reached_SAL__c || st==="SAL" || R_SQO;
  const Lost = st==="Closed Lost", Won=R_CW;
  const usd = Number(r.AnnualContractValueARR__c ?? 0) || Number(r.Amount ?? 0) || 0;
  deals.push({id:r.Id,name:r.Name,acct:r.Account?.Name,entry,q:qn,seg,
    region:String(r.Region__c??"")==="North America"?"North America":"International",
    st,R_SQL:true,R_SAL,R_SQO,R_Trial,R_Billing,R_CW,Lost,Won,Open:!Won&&!Lost,usd,
    prev:r.Previous_stage__c??"", reasons:r.ClosedLostReasons__c??"", owner:r.Owner?.Name??"",
    cwDate:d(r.ContractLiveDate__c)??d(r.Date_Reached_Closed_Won__c), lostDate:ld});
}
console.log(`included ${deals.length} deals · excluded: unclassified ${ex.unclassified} · quick SQL loss ${ex.quickloss} · test ${ex.test} · outside window ${ex.outside} · no entry date ${ex.noentry}`);
fs.writeFileSync('/tmp/funnel-deals.json',JSON.stringify(deals));

// ── §3 slice metrics ────────────────────────────────────────────────────────
const ST=["SQL","SAL","SQO","Trial","Billing","CW"];
const R=(x,s)=>x["R_"+s];
export function metrics(pool){
  const o={};
  for(const s of ST){ o["n_"+s]=pool.filter(x=>R(x,s)).length; o["usd_"+s]=pool.filter(x=>R(x,s)).reduce((a,b)=>a+b.usd,0); }
  o.n_Lost=pool.filter(x=>x.Lost).length; o.n_Open=pool.filter(x=>x.Open).length;
  o.usd_Lost=pool.filter(x=>x.Lost).reduce((a,b)=>a+b.usd,0);
  for(let i=0;i<ST.length-1;i++){ const X=ST[i],Y=ST[i+1];
    const nL=pool.filter(x=>R(x,X)&&!R(x,Y)&&x.Lost);
    o[`nL_${X}_${Y}`]=nL.length; o[`usdL_${X}_${Y}`]=nL.reduce((a,b)=>a+b.usd,0);
    const den=o["n_"+Y]+nL.length; o[`rate_${X}_${Y}`]=den?o["n_"+Y]/den:null;
    const uden=o["usd_"+Y]+o[`usdL_${X}_${Y}`]; o[`rate_usd_${X}_${Y}`]=uden?o["usd_"+Y]/uden:null;
  }
  for(const Y of ["SQO","Trial","CW"]){ const lostBefore=pool.filter(x=>!R(x,Y)&&x.Lost).length;
    const den=o["n_"+Y]+lostBefore; o[`cum_SQL_${Y}`]=den?o["n_"+Y]/den:null; }
  const uden=o.usd_CW+pool.filter(x=>!x.R_CW&&x.Lost).reduce((a,b)=>a+b.usd,0);
  o.cum_usd_SQL_CW=uden?o.usd_CW/uden:null;
  return o;
}
const pctv=x=>x==null?"—":Math.round(x*100)+"%";
// ── §7 acceptance ───────────────────────────────────────────────────────────
const EXPECT=[
 ["Q2 FY25",117,80,58,34,26,25,70,22,"72%","85%","62%","76%","26%"],
 ["Q3 FY25",63,43,35,24,20,19,29,15,"78%","88%","73%","87%","40%"],
 ["Q4 FY25",68,40,30,24,21,17,28,23,"73%","79%","92%","91%","38%"],
 ["Q1 FY26",104,68,47,25,15,14,55,35,"69%","85%","68%","75%","20%"],
 ["Q2 FY26",121,72,37,20,17,15,61,45,"63%","77%","83%","89%","20%"],
 ["Q3 FY26",51,33,14,3,1,0,5,46,"100%","88%","60%","50%","0%"],
];
console.log("\nCOHORT  | SQL SAL SQO Tri Bil  CW Lost Open | S→SAL SAL→SQO SQO→Tri Tri→Bil SQL→CW");
const diffs=[];
for(const e of EXPECT){
  const [lab]=e; const pool=deals.filter(x=>x.q===lab); const m=metrics(pool);
  const got=[m.n_SQL,m.n_SAL,m.n_SQO,m.n_Trial,m.n_Billing,m.n_CW,m.n_Lost,m.n_Open,
    pctv(m.rate_SQL_SAL),pctv(m.rate_SAL_SQO),pctv(m.rate_SQO_Trial),pctv(m.rate_Trial_Billing),pctv(m.cum_SQL_CW)];
  const exp=e.slice(1);
  got.forEach((g,i)=>{ if(String(g)!==String(exp[i])) diffs.push(`${lab} col${i}: got ${g}, brief ${exp[i]}`); });
  console.log(`${lab} | ${got.slice(0,8).map(x=>String(x).padStart(3)).join(" ")} | ${got.slice(8).map(x=>String(x).padStart(6)).join(" ")}`);
}
const all=metrics(deals); const allq=[all.n_SQL,all.n_SAL,all.n_SQO,all.n_Trial,all.n_Billing,all.n_CW,all.n_Lost,all.n_Open];
console.log(`ALL 6   | ${allq.map(x=>String(x).padStart(3)).join(" ")} | ${[pctv(all.rate_SQL_SAL),pctv(all.rate_SAL_SQO),pctv(all.rate_SQO_Trial),pctv(all.rate_Trial_Billing),pctv(all.cum_SQL_CW)].map(x=>String(x).padStart(6)).join(" ")}`);
console.log(`   brief| 524 336 221 130 100  90  248 186 |    72%     83%     72%     83%    27%`);
const mat=deals.filter(x=>x.entry>="2025-04-02"&&x.entry<="2026-04-01"); const mm=metrics(mat);
console.log(`MATURED | ${[mm.n_SQL,mm.n_SAL,mm.n_SQO,mm.n_Trial,mm.n_Billing,mm.n_CW,mm.n_Lost,mm.n_Open].map(x=>String(x).padStart(3)).join(" ")} | ${[pctv(mm.rate_SQL_SAL),pctv(mm.rate_SAL_SQO),pctv(mm.rate_SQO_Trial),pctv(mm.rate_Trial_Billing),pctv(mm.cum_SQL_CW)].map(x=>String(x).padStart(6)).join(" ")}`);
console.log(`   brief| 352 231 170 107  82  75  182  95 |    72%     85%     71%     82%    29%`);
console.log(`\nBilling→CW all six: ${pctv(all.rate_Billing_CW)} (brief 98%)`);
console.log(`$ SQL→CW all six  : ${pctv(all.cum_usd_SQL_CW)} (brief 18%) · matured ${pctv(mm.cum_usd_SQL_CW)} (brief 21%)`);
console.log(`Closed Won ARR    : $${Math.round(all.usd_CW).toLocaleString()} (brief $2.06M)`);
const cyc=deals.filter(x=>x.Won&&x.cwDate).map(x=>days(x.entry,x.cwDate)).filter(x=>x>=0).sort((a,b)=>a-b);
console.log(`Median SQL→CW     : ${cyc[Math.floor(cyc.length/2)]} days (brief 56)`);
console.log(`\n${diffs.length} cell diffs vs §7`); diffs.slice(0,25).forEach(x=>console.log("  "+x));
