// Put the Pipeline tab's "(ARR)" figures on an actual ARR basis.
//
// THE BUG. 'Open pipeline - SOQL pull' has two value columns:
//   col D  Annual_Contract_Value_ARR_Formula__c   — named ARR, but empirically identical to
//                                                   Amount, i.e. multi-year TOTAL CONTRACT VALUE
//   col O  AnnualContractValueARR__c              — the actual annual value
// Both "Total Pipeline (ARR)" (B5) and "Created This Quarter (ARR)" (B26) summed col D. So two
// tiles labelled ARR were reporting TCV, and the coverage ratio built on B5 inherited it — the
// dashboard read 6.2x cover against a New-ARR quota when the true-ARR figure is about 3.0x.
//
// Flagged by the numbers gate since August as a KNOWN finding rather than a failure, because
// which basis the tile SHOULD use is a definitional call, not an arithmetic error. Tai called it
// on 2026-09-09: the tiles say ARR, so they must be ARR.
//
// WHAT MOVES (leadership-visible, tell them before they notice):
//   Total Pipeline (ARR)      $20,464,021  ->  ~$9,869,209
//   Coverage ratio                   6.2x  ->  ~3.0x
//   Created This Quarter (ARR)  $2,160,432  ->  the ARR-basis figure
//   gen_pct, pipe_gap, pipe_needed_week all follow from those two.
//
// Reversible: swap $O$ back to $D$ in the two ranges below. The prior formulas are printed
// before the change and echoed in the run log.
//
// Run: node --env-file=.env scripts/fix-pipeline-arr-basis.mjs [--apply]   (dry-run without)
import { google } from "googleapis";

const APPLY = process.argv.includes("--apply");
const TAB = "Pipeline";
const CELLS = ["B5", "B26"];
const SRC = "Open pipeline - SOQL pull";

const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const api = google.sheets({ version: "v4", auth });
const ID = process.env.GOOGLE_SHEET_ID;

// Only the VALUE range moves from D to O. Every other term — the stage filter, the quarter
// match, the per-rep filter — is left exactly as it was, so this changes the basis and nothing
// else. Anchored on the source tab name so a stray "D3:D1000" elsewhere cannot be caught.
const swap = (f) => f.replaceAll(`'${SRC}'!D3:D1000`, `'${SRC}'!O3:O1000`);

async function main() {
  const cur = await api.spreadsheets.values.batchGet({ spreadsheetId: ID,
    ranges: CELLS.map((c) => `'${TAB}'!${c}`), valueRenderOption: "FORMULA" });
  const vals = await api.spreadsheets.values.batchGet({ spreadsheetId: ID,
    ranges: CELLS.map((c) => `'${TAB}'!${c}`), valueRenderOption: "UNFORMATTED_VALUE" });

  const updates = [];
  CELLS.forEach((cell, i) => {
    const before = String(cur.data.valueRanges[i].values?.[0]?.[0] ?? "");
    const now = vals.data.valueRanges[i].values?.[0]?.[0];
    const after = swap(before);
    console.log(`\n${TAB}!${cell}   currently reads ${typeof now === "number" ? "$" + Math.round(now).toLocaleString() : now}`);
    if (after === before) { console.log(`  no '${SRC}'!D3:D1000 in this formula — left alone`); return; }
    console.log(`  before: ${before.slice(0, 150)}`);
    console.log(`  after : ${after.slice(0, 150)}`);
    updates.push({ range: `'${TAB}'!${cell}`, values: [[after]] });
  });

  if (!updates.length) { console.log("\nnothing to change."); return; }
  if (!APPLY) { console.log(`\nDRY RUN — ${updates.length} cell(s) would change. Re-run with --apply.`); return; }

  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates } });
  const after = await api.spreadsheets.values.batchGet({ spreadsheetId: ID,
    ranges: [...CELLS.map((c) => `'${TAB}'!${c}`), `'${TAB}'!B19`], valueRenderOption: "UNFORMATTED_VALUE" });
  const [b5, b26, quota] = after.data.valueRanges.map((v) => Number(v.values?.[0]?.[0] ?? 0));
  console.log(`\napplied.`);
  console.log(`  Total Pipeline (ARR)       $${Math.round(b5).toLocaleString()}`);
  console.log(`  Created This Quarter (ARR) $${Math.round(b26).toLocaleString()}`);
  console.log(`  Coverage vs quota          ${(b5 / (quota || 1)).toFixed(2)}x   (quota $${Math.round(quota).toLocaleString()})`);
  console.log(`\nThe Headline tab reads these by label and will follow on its next recalc.`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
