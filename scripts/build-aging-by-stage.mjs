// Builds the "Deal Health — Aging by Stage" source tab as an AE × Stage matrix, LIVE by formula
// over Query 1 (auto-refreshes). Stage buckets match Stephen's leadership deck: SQL, SAL, SQO,
// Trial, Proposal, Pending Signature, Expansion Lead, and "Other (renewal/billing)" = everything
// else. One block per AE (All + the 5 core AEs) so the dashboard can toggle by AE and by Stage.
// Age = days since Last Stage Change (else Created); Stale = age >= 90 days in current stage.
// All math is sheet formulas; the dashboard only reads/filters. No computation in the app.
// Run: node --env-file=.env scripts/build-aging-by-stage.mjs
import { google } from "googleapis";

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const ID = process.env.GOOGLE_SHEET_ID;
const TAB = "Deal Health — Aging by Stage";
const Q = "'Query 1'"; // C=Stage, D=ARR, G=Created, J=Owner, L=LastStageChange
const R = (c) => `${Q}!$${c}$3:$${c}$2000`;
const AGE0 = `IFERROR(TODAY()-DATEVALUE(LEFT(IF(${R("L")}<>"",${R("L")},${R("G")}),10)),0)`;

const AES = ["All (everyone)", "David Dubinski", "James Burdick", "Jed Rutstein", "Jill Bucci", "Mathias Berthelemot"];
// Stephen's explicit stages; "Other (renewal/billing)" is the catch-all for anything else.
const EXPLICIT = ["SQL", "SAL", "SQO", "Trial", "Proposal", "Pending Signature", "Expansion Lead"];
const OTHER = "Other (renewal/billing)";
const STAGES = [...EXPLICIT, OTHER];

// Row-mask array (as a formula string) for one AE + stage bucket.
function mask(ae, stage) {
  const owner = ae === "All (everyone)" ? "" : `*(${R("J")}="${ae.replace(/"/g, '""')}")`;
  const st = stage === OTHER
    ? `*(${R("C")}<>"")*(1-(${EXPLICIT.map((s) => `(${R("C")}="${s}")`).join("+")}))`
    : `*(${R("C")}="${stage}")`;
  return `(${R("C")}<>"")${owner}${st}`;
}
const cnt = (m) => `=SUMPRODUCT(${m})`;
const avgAge = (m) => `=IFERROR(ROUND(SUMPRODUCT(${m}*${AGE0})/SUMPRODUCT(${m})),"—")`;
const stale = (m) => `=SUMPRODUCT(${m}*(${AGE0}>=90))`;
const staleD = (m) => `=ROUND(SUMPRODUCT(${m}*(${AGE0}>=90)*${R("D")}))`;
const avgAcv = (m) => `=IFERROR(ROUND(SUMPRODUCT(${m}*${R("D")})/SUMPRODUCT(${m})),"—")`;

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const rows = [
    [`Deal Health — Aging by Stage (AE × Stage) · LIVE over Query 1. Stage buckets match Stephen's deck; "Other" = renewal/billing/everything else. Age = days since Last Stage Change (else Created); Stale = >=90 days in stage.`],
    [],
    ["AE", "Stage", "# of Deals", "Avg Age (days)", "Stale (≥90d)", "Stale $", "Avg ACV"],
  ];
  for (const ae of AES) {
    for (const s of STAGES) {
      const m = mask(ae, s);
      rows.push([ae, s, cnt(m), avgAge(m), stale(m), staleD(m), avgAcv(m)]);
    }
    // per-AE TOTAL (all stages for this AE)
    const t = ae === "All (everyone)" ? `(${R("C")}<>"")` : `(${R("C")}<>"")*(${R("J")}="${ae.replace(/"/g, '""')}")`;
    rows.push([ae, "TOTAL", cnt(t), avgAge(t), stale(t), staleD(t), avgAcv(t)]);
  }

  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const ex = meta.data.sheets.find((s) => s.properties.title === TAB);
  const reqs = [];
  if (ex) reqs.push({ deleteSheet: { sheetId: ex.properties.sheetId } });
  reqs.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 5, columnCount: 7 } } } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: rows } });

  const back = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${TAB}'!A4:G100`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values ?? [];
  console.log(`wrote '${TAB}' — ${AES.length} AEs × ${STAGES.length} stages (+ per-AE totals). Sample (All + James):`);
  back.filter((r) => r[0] === "All (everyone)" || r[0] === "James Burdick").forEach((r) => console.log("  " + String(r[0]).slice(0, 16).padEnd(17) + String(r[1]).slice(0, 22).padEnd(23) + "n=" + String(r[2]).padStart(4) + " age=" + String(r[3]).padStart(4) + " stale=" + String(r[4]).padStart(4) + " $" + Number(r[5] || 0).toLocaleString()));
}
main().catch((e) => { console.error(e); process.exit(1); });
