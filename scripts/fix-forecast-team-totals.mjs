// The Forecasting tab's "AE Team" rows only ever summed the first FOUR rep rows.
//
// Each of the three blocks (WoW, MoM, QoQ) lists the reps and then totals them. The totals were
// written when the team was four people and never extended as reps were added underneath:
//
//   WoW  r10  =SUM(B4:B7)    lists James, Dorsa, Jed, Jill, [blank], Mathias   → drops Mathias
//   MoM  r21  =SUM(B15:B18)  lists those plus David and Mathias                → drops both
//   QoQ  r33  =SUM(B26:B29)  lists those plus David, Osman and Mathias         → drops all three
//
// The MoM team open pipeline read $5,496,230 when its own rep rows sum to $13,977,941 — the
// forecast the team runs the quarter on was understating open pipeline by $8,481,711, 61%.
//
// Tell-tale that this is an oversight rather than a definition: M33 in the same QoQ block already
// reads =SUM(M26:M32), the full range. One column was corrected at some point and the rest were
// not, which is exactly how a total quietly stops matching the rows above it.
//
// Only the RANGE changes. No filter, no basis, no row is added or moved — inserting a row here
// would shift every reference below it.
//
// Two things deliberately NOT changed, because they are judgement calls, not bugs:
//   · David has no row at all in the WoW block (r8 is empty). Widening the range to B4:B9 makes
//     the total right for the reps that ARE listed; giving him a row means inventing weekly
//     history, which is Tai's call.
//   · Osman appears in the QoQ block but is not in AE_ROSTER. The range below includes him,
//     matching what M33 already does — flag it if the team total should exclude him.
//
// Run: node --env-file=.env scripts/fix-forecast-team-totals.mjs [--apply]
import { google } from "googleapis";

const APPLY = process.argv.includes("--apply");
const TAB = "Forecasting";
// [team row, first rep row, last rep row]
const BLOCKS = [["WoW", 10, 4, 9], ["MoM", 21, 15, 20], ["QoQ", 33, 26, 32]];
const COLS = ["B", "C", "D"];

const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const api = google.sheets({ version: "v4", auth });
const ID = process.env.GOOGLE_SHEET_ID;
const usd = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();

async function main() {
  const before = (await api.spreadsheets.values.get({ spreadsheetId: ID,
    range: `'${TAB}'!A1:F40`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const updates = [];
  for (const [name, teamRow, from, to] of BLOCKS) {
    const reps = [];
    for (let r = from; r <= to; r++) reps.push(Number(before[r - 1]?.[1]) || 0);
    const shown = Number(before[teamRow - 1]?.[1]) || 0;
    const should = reps.reduce((a, b) => a + b, 0);
    console.log(`\n${name}  team row ${teamRow}`);
    console.log(`  open pipeline shows ${usd(shown)} · its own rep rows sum to ${usd(should)} · missing ${usd(should - shown)}`);
    for (const c of COLS) {
      console.log(`  ${c}${teamRow}: =SUM(${c}${from}:${c}${to})`);
      updates.push({ range: `'${TAB}'!${c}${teamRow}`, values: [[`=SUM(${c}${from}:${c}${to})`]] });
    }
  }
  if (!APPLY) { console.log(`\nDRY RUN — ${updates.length} cells would change. Re-run with --apply.`); return; }
  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates } });
  const after = (await api.spreadsheets.values.get({ spreadsheetId: ID,
    range: `'${TAB}'!A1:F40`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  console.log(`\napplied — ${updates.length} cells.`);
  for (const [name, teamRow] of BLOCKS)
    console.log(`  ${name} AE Team open pipeline now ${usd(after[teamRow - 1]?.[1])}  ·  potential ARR ${usd(after[teamRow - 1]?.[5])}`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
