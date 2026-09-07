// Point the "AE Attainment (Official)" quota column at the Targets tab, instead of leaving it
// hand-typed in two places inside the tab itself.
//
// Why this exists: the quota for each AE lived in three places at once — planConfig.ts AE_ROSTER,
// and hand-typed TWICE in this tab (the Month block rows 5-10 and the Quarter block rows 15-20;
// the Week block already referenced the Quarter one). On 2026-08-28 Davi's residual quota was
// derived and written to planConfig only. The sheet copies never got it, so his quota cell stayed
// blank — and from 1 Sep, the day his first Q3 deal went live, the nightly audit failed every day:
// a rep with actuals and no quota puts ARR in the numerator of team attainment with nothing under
// it. Mathias was separately wrong here (250k in the sheet, 150k everywhere else and per Tai).
//
// After this runs there is ONE number to change per rep — the Targets tab — and both blocks and
// the dashboard follow it. Matching is by the AE name in column A, not by row position, so
// reordering the reps or inserting a row cannot silently point a rep at someone else's quota.
//
// Idempotent: re-running rewrites the same formulas. Safe to run after any rebuild of Targets.
// Run: node --env-file=.env scripts/link-ae-quotas.mjs [--apply]      (dry-run without --apply)
import { google } from "googleapis";

const APPLY = process.argv.includes("--apply");
const TAB = "AE Attainment (Official)";
// The two blocks that hardcode quotas. The Week block (23-28) already reads =B15..B20.
const BLOCKS = [[5, 10], [15, 20]];

const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const api = google.sheets({ version: "v4", auth });
const ID = process.env.GOOGLE_SHEET_ID;

// Look the rep up in the Targets key block by the slug their name makes. Wrapped in IFERROR so a
// rep who is genuinely not on the roster reads blank rather than #N/A — but note that a blank
// quota is exactly what the audit fails on, which is the intended loud behaviour.
const formula = (row) =>
  `=IFERROR(INDEX(Targets!$B:$B,MATCH("ae_quota_q3_"&LOWER(SUBSTITUTE($A${row}," ","_")),Targets!$A:$A,0)),"")`;

async function main() {
  const cur = await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${TAB}'!A1:B30`, valueRenderOption: "UNFORMATTED_VALUE" });
  const rows = cur.data.values ?? [];
  const name = (r) => String(rows[r - 1]?.[0] ?? "").trim();

  const updates = [];
  for (const [from, to] of BLOCKS) for (let r = from; r <= to; r++) {
    const who = name(r);
    if (!who) { console.log(`  row ${r}: empty — skipped`); continue; }
    console.log(`  row ${r}: ${who.padEnd(22)} was ${String(rows[r - 1]?.[1] ?? "(blank)").padStart(8)}  →  Targets lookup`);
    updates.push({ range: `'${TAB}'!B${r}`, values: [[formula(r)]] });
  }
  if (!APPLY) { console.log(`\nDRY RUN — ${updates.length} cells would change. Re-run with --apply.`); return; }
  // USER_ENTERED so the "=" is stored as a formula, not text.
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates } });
  const after = await api.spreadsheets.values.get({ spreadsheetId: ID, range: `'${TAB}'!A1:D30`, valueRenderOption: "UNFORMATTED_VALUE" });
  console.log(`\nwrote ${updates.length} quota cells. Resolved values:`);
  for (const [from, to] of BLOCKS) for (let r = from; r <= to; r++) {
    const x = after.data.values?.[r - 1] ?? [];
    if (x[0]) console.log(`  row ${String(r).padStart(2)}  ${String(x[0]).padEnd(22)} quota ${String(x[1] ?? "(blank)").padStart(9)}  actual ${String(x[3] ?? "")}`);
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
