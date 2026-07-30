// Build a NEW sheet tab "AE Attainment (Official)" that mirrors the existing
// "AE attainment" tab's format (MoM / QoQ / WoW sections) but uses leadership's
// OFFICIAL filter (per the RevOps report definition):
//   • Record Type = 1.New Business
//   • Stage IN (Billing, Closed Won)          [was: Status = Live Paying/Pending…]
//   • Contract Live Date within the period    [unchanged — live-date basis]
//   • (Owners Sri Muniandy / Jesse Brennan are excluded; the 6 rep rows already do this)
//   • NO "ContractEndDate > TODAY" active filter (leadership's filter has none)
// Approach: duplicate the source tab (keeps all formatting + Δ$/Δ% formulas),
// then rewrite ONLY the value cells (those referencing LiveARR) with the transform.
// Run: node --env-file=.env scripts/build-ae-attainment-official.mjs [--apply]
import { google } from "googleapis";

const APPLY = process.argv.includes("--apply");
const SRC = "AE attainment";
const NEW = "AE Attainment (Official)";
const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const api = google.sheets({ version: "v4", auth });
const ID = process.env.GOOGLE_SHEET_ID;
const A1 = (r, c) => { let s = "", n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s + (r + 1); };

// Transform one value-cell formula to the official definition.
function toOfficial(f) {
  if (typeof f !== "string" || !f.includes("LiveARR")) return f;
  const suf = f.includes("$1199") ? "$1199" : "";
  let out = f;
  // drop the active-contract filter (ContractEndDate col H > TODAY)
  out = out.replace(/\*\('LiveARR - SOQL Pull'!\$H\$3:\$H(?:\$1199)?>TODAY\(\)\)/g, "");
  // Status OR-block  →  Stage (Billing/Closed Won) AND RecordType New Business
  const statusRe = /\(\('LiveARR - SOQL Pull'!\$D\$3:\$D(?:\$1199)?="\[LP\] Live Paying"\)\+\('LiveARR - SOQL Pull'!\$D\$3:\$D(?:\$1199)?="\[LP\] Live Paying \(Monthly\)"\)\+\('LiveARR - SOQL Pull'!\$D\$3:\$D(?:\$1199)?="Pending Billing"\)\+\('LiveARR - SOQL Pull'!\$D\$3:\$D(?:\$1199)?="Pending Initial Payment"\)>0\)/g;
  const repl = `(('LiveARR - SOQL Pull'!$C$3:$C${suf}="Billing")+('LiveARR - SOQL Pull'!$C$3:$C${suf}="Closed Won")>0)*('LiveARR - SOQL Pull'!$M$3:$M${suf}="1.New Business")`;
  out = out.replace(statusRe, () => repl);
  return out;
}

async function meta() {
  const s = (await api.spreadsheets.get({ spreadsheetId: ID })).data.sheets;
  const find = (t) => s.find((x) => x.properties.title === t)?.properties;
  return { src: find(SRC), exist: find(NEW), count: s.length };
}

async function main() {
  const { src, exist, count } = await meta();
  if (!src) throw new Error(`source tab "${SRC}" not found`);

  // DRY RUN: preview the 4 distinct transforms
  const F = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${SRC}'!A1:BN30`, valueRenderOption: "FORMULA" })).data.values || [];
  const shapes = new Map();
  for (let r = 0; r < F.length; r++) for (let c = 0; c < (F[r] || []).length; c++) {
    const f = F[r][c];
    if (typeof f === "string" && f.includes("LiveARR")) { const k = f.replace(/\$?[A-Z]+\$?\d+/g, "#").replace(/DATE\([^)]*\)/g, "D()"); if (!shapes.has(k)) shapes.set(k, [A1(r, c), f]); }
  }
  console.log(`Distinct value-cell shapes: ${shapes.size}\n`);
  for (const [ref, f] of shapes.values()) { console.log(`--- ${ref} ---\nBEFORE: ${f}\nAFTER : ${toOfficial(f)}\n`); }

  if (!APPLY) { console.log("(dry run — re-run with --apply to build the tab)"); return; }

  // 1) (re)create the new tab as a duplicate of the source
  const reqs = [];
  if (exist) reqs.push({ deleteSheet: { sheetId: exist.sheetId } });
  reqs.push({ duplicateSheet: { sourceSheetId: src.sheetId, insertSheetIndex: count, newSheetName: NEW } });
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  console.log(`created tab "${NEW}" (duplicate of "${SRC}")`);

  // 2) rewrite value cells in the new tab
  const NF = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${NEW}'!A1:BN30`, valueRenderOption: "FORMULA" })).data.values || [];
  const data = [];
  for (let r = 0; r < NF.length; r++) for (let c = 0; c < (NF[r] || []).length; c++) {
    const f = NF[r][c];
    if (typeof f === "string" && f.includes("LiveARR")) { const nf = toOfficial(f); if (nf !== f) data.push({ range: `'${NEW}'!${A1(r, c)}`, values: [[nf]] }); }
  }
  data.push({ range: `'${NEW}'!A1`, values: [["AE ARR Attainment (OFFICIAL) | New Business, Stage = Billing/Closed Won, by Contract Live Date | Quota = Q3 2026 Target | Excl. Sri Muniandy, Jesse Brennan | Data from Salesforce"]] });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: "USER_ENTERED", data } });
  console.log(`rewrote ${data.length - 1} value cells to official definition`);

  // 3) verify — James Q3 Actual across the 3 sections
  const chk = (await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${NEW}'!A1:D30`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const jamesRows = [4, 14, 22]; // MoM r5, QoQ r15, WoW r23 (0-based)
  console.log("\nVerify James Burdick Q3 Actual (col D) in each section — expect $99,936:");
  for (const r of jamesRows) console.log(`  ${chk[r]?.[0]}  D=$${Math.round(chk[r]?.[3] || 0).toLocaleString()}  (${((chk[r]?.[2] || 0) * 100).toFixed(1)}%)`);
  console.log("\nAll reps (MoM section) Q3 Actual:");
  let team = 0;
  for (let r = 4; r <= 9; r++) { team += Number(chk[r]?.[3] || 0); console.log(`  ${String(chk[r]?.[0]).padEnd(20)} $${Math.round(chk[r]?.[3] || 0).toLocaleString().padStart(9)}`); }
  console.log(`  TEAM $${Math.round(team).toLocaleString()} (expect ~$197,520)`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
