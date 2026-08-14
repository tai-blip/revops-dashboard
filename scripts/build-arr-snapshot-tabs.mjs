// Build 3 LIVE, self-refreshing ARR snapshot tabs — v2 (team-agreed 2026-08-14) — driven by
// formulas over the ARR_Funnel tab (rewritten nightly), so deal lists recompute on every refresh.
//   Booked v2    = reached Trial AND Pilot Start Date known, not yet live/paying/lost.
//   Contracted v2= signed-stage + contract-live, not paying (Truc fallback: keeps unsigned) + a
//                  "Signed on file?" flag and a signed/unsigned split so the ~$176K unsigned shows.
//   Live v2      = signed + Live-Paying Date reached (unchanged; anchored on Live Paying Date).
// ARR_Funnel cols: P Tier(v2) · Q PaymentTerms · R Cadence · S Invoice/cycle · T Monthly-equiv ·
//   U Pilot Start Date · V Signed on file? · H ARR · J SignedDate · K LiveDate · M LivePaying · I Trial.
// FIXED LAYOUT: 1 title·2 desc·3 blank·4 WHERE·5-9 summary·10 blank·11 by-term hdr·12-15 cadence·
//   16 blank·17 detail title·18 detail header·19+ QUERY. Run: node --env-file=.env scripts/build-arr-snapshot-tabs.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const TEAL = { red: 0.4, green: 0.8, blue: 0.78 }, GREEN = { red: 0.62, green: 0.85, blue: 0.62 }, PINK = { red: 0.96, green: 0.55, blue: 0.75 };
const F = "'ARR_Funnel'";
const TC = "W"; // tier column read by these tabs = "Tier (Q3-end)" (projected to Sep-30). "P" = today.
const cntOps = (tier) => `=COUNTIF(${F}!$${TC}:$${TC},"${tier}")&" ops"`;
const arrTot = (tier) => `=SUMIF(${F}!$${TC}:$${TC},"${tier}",${F}!$H:$H)`;
const moTot = (tier) => `=SUMIF(${F}!$${TC}:$${TC},"${tier}",${F}!$T:$T)`;
const cntCad = (tier, cad) => `=COUNTIFS(${F}!$${TC}:$${TC},"${tier}",${F}!$R:$R,"${cad}")`;
const arrCad = (tier, cad) => `=SUMIFS(${F}!$H:$H,${F}!$${TC}:$${TC},"${tier}",${F}!$R:$R,"${cad}")`;
// signed-on-file (col J = Contract Signed Date) helpers, for the Contracted split.
const cntSigned = (tier) => `=COUNTIFS(${F}!$${TC}:$${TC},"${tier}",${F}!$J:$J,">0")&" ops"`;
const arrSigned = (tier) => `=SUMIFS(${F}!$H:$H,${F}!$${TC}:$${TC},"${tier}",${F}!$J:$J,">0")`;
const cntUnsigned = (tier) => `=COUNTIF(${F}!$${TC}:$${TC},"${tier}")-COUNTIFS(${F}!$${TC}:$${TC},"${tier}",${F}!$J:$J,">0")&" ops"`;
const arrUnsigned = (tier) => `=SUMIF(${F}!$${TC}:$${TC},"${tier}",${F}!$H:$H)-SUMIFS(${F}!$H:$H,${F}!$${TC}:$${TC},"${tier}",${F}!$J:$J,">0")`;
const cadBlock = (tier) => {
  const C = (cad) => `=COUNTIFS(${F}!$${TC}:$${TC},"${tier}",${F}!$R:$R,"${cad}")`;
  const A = (cad) => `=SUMIFS(${F}!$H:$H,${F}!$${TC}:$${TC},"${tier}",${F}!$R:$R,"${cad}")`;
  const Pc = (cad) => `=IFERROR(SUMIFS(${F}!$H:$H,${F}!$${TC}:$${TC},"${tier}",${F}!$R:$R,"${cad}")/SUMIF(${F}!$${TC}:$${TC},"${tier}",${F}!$H:$H),"")`;
  const I = (cad) => `=SUMIFS(${F}!$S:$S,${F}!$${TC}:$${TC},"${tier}",${F}!$R:$R,"${cad}")`;
  return [
    ["Annual", C("Annual"), A("Annual"), Pc("Annual"), "1× / yr (upfront)", I("Annual")],
    ["Quarterly", C("Quarterly"), A("Quarterly"), Pc("Quarterly"), "4× / yr", I("Quarterly")],
    ["Monthly", C("Monthly"), A("Monthly"), Pc("Monthly"), "12× / yr", I("Monthly")],
    ["Unknown / blank", C("Unknown"), A("Unknown"), Pc("Unknown"), "—", I("Unknown")],
  ];
};
const query = (tier, cols) => `=IFERROR(QUERY(${F}!A2:W,"select ${cols} where ${TC} = '${tier}' order by H desc",0),"(none)")`;
const pad = (rows, n) => { while (rows.length < n) rows.push(["", "", ""]); return rows; };
function tab(title, desc, summary, tier, detailHdr, cols) {
  return [
    [title, "", ""], [desc, "", ""], ["", "", ""], ["WHERE WE STAND AT Q3-END — Sep 30, 2026 (projected; live — updates every refresh)", "", ""],
    ...pad(summary, 5),
    ["", "", ""], ["BY PAYMENT TERM", "ops", "ARR (annual)", "% of ARR", "Cadence", "Invoice / cycle"],
    ...cadBlock(tier),
    ["", "", ""], ["DEAL DETAIL (live — sorted by ARR)", "", "", "", "", "", "", "", "", ""],
    detailHdr,
    [query(tier, cols)],
  ];
}

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;

  const contracted = tab(
    "CONTRACTED ARR v2 — as of Q3-end (Sep 30, 2026) · auto-refreshes with ARR_Funnel",
    "v2: signed-stage (Billing/Closed Won) + contract-live, not yet paying, not ended/churned. Contract Signed Date preferred; falls back to Live/RR date (Truc's rule). 'Signed on file?' flags fallbacks.",
    [["Contracted ARR (annualized run-rate)", cntOps("Contracted"), arrTot("Contracted")],
     ["  ├─ Signed (Contract Signed Date on file)", cntSigned("Contracted"), arrSigned("Contracted")],
     ["  └─ Unsigned (Live/RR fallback — Ops to attach date)", cntUnsigned("Contracted"), arrUnsigned("Contracted")],
     ["Recognized ÷ 12 (monthly-equiv once live)", "", moTot("Contracted")]],
    "Contracted",
    ["Account", "Opportunity", "Stage", "Status", "Signed on file?", "Signed Date", "Payment Term", "Cadence", "ARR (annual)", "Invoice/cycle", "Contract Live"],
    "D, C, E, G, V, J, Q, R, H, S, K");
  const live = tab(
    "LIVE ARR v2 — as of Q3-end (Sep 30, 2026) · auto-refreshes with ARR_Funnel",
    "v2: signed + Live-Paying Date reached + not ended/churned (unchanged — anchored on Live Paying Date). Actively PAYING. ARR annualized; invoice = ARR ÷ cycles/yr.",
    [["Live ARR (annualized run-rate — paying book)", cntOps("Live"), arrTot("Live")],
     ["Recognized ÷ 12 (smoothed monthly run-rate)", "", moTot("Live")],
     ["  ├─ Annual-billed (cash LUMPY — full year at renewal)", cntCad("Live", "Annual"), arrCad("Live", "Annual")],
     ["  └─ Monthly + Quarterly (smoother recurring cash)", `=COUNTIFS(${F}!$P:$P,"Live",${F}!$R:$R,"Monthly")+COUNTIFS(${F}!$P:$P,"Live",${F}!$R:$R,"Quarterly")`, `=SUMIFS(${F}!$H:$H,${F}!$P:$P,"Live",${F}!$R:$R,"Monthly")+SUMIFS(${F}!$H:$H,${F}!$P:$P,"Live",${F}!$R:$R,"Quarterly")`]],
    "Live",
    ["Account", "Opportunity", "Stage", "Status", "Payment Term", "Cadence", "ARR (annual)", "Invoice/cycle", "Monthly-equiv", "Live-Paying Date"],
    "D, C, E, G, Q, R, H, S, T, M");
  const booked = tab(
    "BOOKED ARR v2 — as of Q3-end (Sep 30, 2026) · auto-refreshes with ARR_Funnel",
    "v2 (concluded): currently in an active pilot — Stage = Trial AND a Pilot Start Date is set (ARR >= 0, so $0 pilots count). Graduates out once signed (→ Contracted) or paying (→ Live); a bare Contract Live Date on an unsigned Trial does NOT eject it. Cash today = $0.",
    [["Booked ARR (pilot pipeline, annualized deal size)", cntOps("Booked"), arrTot("Booked")],
     ["Cash collected from these so far", "", "$0 — in Trial, not billing"]],
    "Booked",
    ["Account", "Opportunity", "Stage", "Status", "AE (Owner)", "Payment Term", "ARR (annual)", "Pilot Start Date", "Trial Date", ""],
    "D, C, E, G, A, Q, H, U, I");

  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title,index)" });
  const anchor = meta.data.sheets.find((s) => /Contracted ARR Snapshot/.test(s.properties.title));
  const baseIdx = anchor ? anchor.properties.index : 1;
  const tabs = [["Contracted ARR Snapshot v2", TEAL, contracted], ["Live ARR Snapshot v2", GREEN, live], ["Booked ARR Snapshot v2", PINK, booked]];
  // Remove any prior v1/v2 snapshot tabs so v2 replaces them cleanly.
  const reqs = [];
  for (const s of meta.data.sheets) if (/(Contracted|Live|Booked) ARR Snapshot( v2)?$/.test(s.properties.title)) reqs.push({ deleteSheet: { sheetId: s.properties.sheetId } });
  tabs.forEach(([t, color], i) => reqs.push({ addSheet: { properties: { title: t, index: baseIdx + i, tabColor: color, gridProperties: { rowCount: 400, columnCount: 12 } } } }));
  const res = await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  const gids = {}; res.data.replies.filter((r) => r.addSheet).forEach((r) => { gids[r.addSheet.properties.title] = r.addSheet.properties.sheetId; });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: "USER_ENTERED", data: tabs.map(([t, , values]) => ({ range: `'${t}'!A1`, values })) } });

  // Number-format: summary ARR col C rows 5-9; by-term ARR col C rows 12-15, % col D, invoice col F.
  // Detail (rows 19+): classify each column by its header text (numeric vs date) so formats always
  // land right regardless of column order. Dates use a date pattern so serials render as yyyy-mm-dd.
  const NUM = { type: "NUMBER", pattern: "#,##0" }, PCT = { type: "PERCENT", pattern: "0%" }, DATE = { type: "DATE", pattern: "yyyy-mm-dd" };
  const fmt = (gid, r0, r1, c0, c1, nf) => ({ repeatCell: { range: { sheetId: gid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { numberFormat: nf } }, fields: "userEnteredFormat.numberFormat" } });
  const fmtReqs = [];
  for (const [t, , values] of tabs) {
    const gid = gids[t], detailHdr = values[17]; // detail header row (0-based 17)
    fmtReqs.push({ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
    fmtReqs.push(fmt(gid, 4, 9, 2, 3, NUM));   // summary ARR (col C)
    fmtReqs.push(fmt(gid, 11, 15, 2, 3, NUM));  // by-term ARR (col C)
    fmtReqs.push(fmt(gid, 11, 15, 3, 4, PCT));  // by-term % (col D)
    fmtReqs.push(fmt(gid, 11, 15, 5, 6, NUM));  // by-term invoice (col F)
    detailHdr.forEach((h, c) => {
      if (/ARR|Invoice|Monthly/i.test(h)) fmtReqs.push(fmt(gid, 18, 400, c, c + 1, NUM));
      else if (/Date|Contract Live|Live-Paying|Pilot Start/i.test(h) && !/Signed on file/i.test(h)) fmtReqs.push(fmt(gid, 18, 400, c, c + 1, DATE));
    });
  }
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: fmtReqs } });

  for (const [t] of tabs) console.log(`${t} → https://docs.google.com/spreadsheets/d/${ID}/edit#gid=${gids[t]}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
