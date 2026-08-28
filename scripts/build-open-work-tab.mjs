// Add an "Open Work" tab to Week1_Status_Board holding every pending / in-progress item,
// in the same format as its Board tab, plus a summary table on the existing Summary tab.
//   node --env-file=.env scripts/build-open-work-tab.mjs
import { google } from "googleapis";

const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const ID = "1R9C2Tk-9FVCYJO9SIR9G_MMLrcB-okxSqBNzlNDBo78";  // Week1_Status_Board
const TAB = "Open Work";

const rgb = (r, g, b) => ({ red: r, green: g, blue: b });
const NAVY = rgb(0.18431373, 0.24313726, 0.27450982);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0.043137256, 0.043137256, 0.043137256);
const GREY = rgb(0.32156864, 0.31764707, 0.30588236);
const FAINT = rgb(0.5372549, 0.5294118, 0.5058824);
const RULE = rgb(0.8509804, 0.84705883, 0.8235294);
const YELLOW = rgb(1, 1, 0.8);

const STATUS = {
  "Shipped":           { bg: rgb(0.9098039, 0.9607843, 0.9098039), fg: rgb(0, 0.3882353, 0) },
  "In progress":       { bg: rgb(0.99607843, 0.9529412, 0.8627451), fg: rgb(0.5411765, 0.35686275, 0) },
  "Waiting on others": { bg: rgb(0.9882353, 0.91764706, 0.88235295), fg: rgb(0.6039216, 0.2901961, 0.11764706) },
  "Queued":            { bg: rgb(0.94509804, 0.94509804, 0.9411765), fg: rgb(0.35686275, 0.35686275, 0.34509805) },
  "Owed":              { bg: rgb(0.9843137, 0.9019608, 0.9019608), fg: rgb(0.65882355, 0.12941177, 0.12941177) },
};

const border = { style: "SOLID", width: 1, colorStyle: { rgbColor: RULE } };
const BORDERS = { top: border, bottom: border, left: border, right: border };
const txt = (s) => ({ userEnteredValue: { stringValue: s } });
const num = (n) => ({ userEnteredValue: { numberValue: n } });
const fx = (f) => ({ userEnteredValue: { formulaValue: f } });
const fmt = (cell, format) => ({ ...cell, userEnteredFormat: format });
const font = (o = {}) => ({ fontFamily: "Arial", fontSize: 10, ...o });

const ROWS = [
  ["In progress", 1, "Chargebee to Ops reconciliation", "24 Aug", "Self-initiated / Finance", "Me",
    "Findings doc and a 158-row exception file issued 24 Aug against ARR_Audit_Master, from 10,341 invoices and 1,122 subscriptions joined on Salesforce opportunity id. Billable ARR is inflated by about $862,314 — 17% of the reported $5,104,157 — because account-level billable locations are repeated onto every opportunity row and multiplied. The $802,680 Burger King under-billing line is wrong: Chargebee shows invoice MMSUSA202605-2561 paid in full on 20 May.",
    "Get sign-off on the first three corrections: Burger King billable locations, row 158 price from $650 to about $48, and stop multiplying account locations across opportunity rows", "NEW"],
  ["In progress", 2, "Billing-after-Closed-Won stage change", "20 Aug", "Self-initiated / Finance", "Me",
    "Read-only impact scan complete. Structural blocker found: Closed Won is the only stage with IsClosed and IsWon both true. Exposure at cutover is 17 opportunities in Billing ($508k) and 1,183 in Closed Won. Recommendation is not to add stages after Closed Won.",
    "Circulate the scan and the recommendation to Stephen and Finance", "Carried"],
  ["In progress", 3, "Revie — RevOps Slack bot", "24 Aug", "Self-initiated", "Me",
    "PR #43 merged to main on 24 Aug. Socket Mode runner, read-only sheet and SOQL tools, and two-phase human-confirmed Salesforce writes behind an allowlist with a real write lock.",
    "Create the Slack app and set the environment variables so it can answer in #ask-revops", "NEW"],
  ["In progress", 4, "Deal Desk app", "Aug", "Self-initiated", "Me",
    "Separate app letting AEs edit their own deal data in Salesforce, stage-gated with Davi approving and a full audit log. Quota and scorecard maths verified against the two conflicting pipe-gen definitions in the repo.",
    "Confirm scope and the approval flow with Davi and Stephen", "NEW"],
  ["In progress", 5, "Customer dashboard handover from Sri", "Aug", "Sri", "Me",
    "CS-facing dashboard picked up from Sri. Running on Vercel behind the momos.com Google sign-in, currently on seeded data.",
    "Agree the real data source and who owns it going forward", "NEW"],
  ["In progress", 6, "Stale-pipeline auto-cleanup", "20 Aug", "Stephen", "Me",
    "Test preview shipped: 193 New Business deals, $11.56M stale in stage, broken out by owner. Nothing has been moved.",
    "Correct the threshold from 90 to 60 days per Stephen, then get sign-off before enabling the live version", "Threshold correction carried"],
  ["In progress", 7, "Cash-flow forecast model", "17 Aug", "Stephen", "Me",
    "Demoed 17 Aug on the assumption that contracts convert to live ARR about 45 days after contract live date, matching net payment terms. Finance has formally disputed that assumption — they hold that live means first payment received.",
    "Refine payment terms per Stephen's feedback and resolve the contract-live-plus-45 dispute with Truc and An", "Carried"],
  ["Waiting on others", 8, "Drive admin access for contract hard copies", "Blocked since 13 Aug", "Andrew", "Davi",
    "Chased through An, Sun Ay, Trong and Ben to establish who holds admin. Two paths put to Andrew in writing: an auto-refreshing link register as the source of truth, or hard-copy consolidation contingent on access.",
    "Davi to grant Drive admin access; work with Jed", "11 days blocked"],
  ["Waiting on others", 9, "Contract audit report for Andrew", "18 Aug", "Andrew", "Andrew / Drive access",
    "Inventory of 591 unique contract links and a gap list of 157 opportunities are shipped. Methodology agreed with Finance on 18 Aug: Salesforce validated against Tableau first, then reconciled to Chargebee.",
    "Write the report; set the timeline once Drive admin access lands", "Carried"],
  ["Waiting on others", 10, "PandaDoc order-form configuration", "19 Aug", "Stephen, Andrew", "Nick / Stephen",
    "Field configuration noted: Trial start and end, Pilot start and end, Contract Live and End as solution dates, with validation rules to gate them.",
    "Confirm the outcome of the Nick session on Pricing Calc to Salesforce to PandaDoc, then write the plan", "Carried"],
  ["Waiting on others", 11, "Tableau or the dashboard as source of truth", "Unresolved since 18 Aug", "Leadership", "Stephen / Andrew / Finance",
    "The 11 Aug Forecast Call agreed to phase Tableau out and run reporting off the dashboard. The 18 Aug finance session made Tableau the primary validation source for contracted ARR and the number that goes to investors. Both cannot be true.",
    "One decision from leadership — it determines whether the dashboard is system of record during the raise", "NEW"],
  ["Waiting on others", 12, "FX rates and the per-deal revenue split rule", "24 Aug", "Reconciliation blockers", "Finance / Data",
    "The FX tab holds only USD and AED; SGD, MYR, AUD and PHP are placeholders, which strands 53 accounts including SGD 665,791 and AUD 128,495. Separately, 118 Chargebee subscriptions are legitimately shared across several opportunities — one across 14 — and no split rule exists in either system.",
    "Finance to sanction the FX rates; Finance and Data to set a per-opportunity split rule, or agree that account-level rollup is the only defensible comparison", "NEW"],
  ["Waiting on others", 13, "Davi's residual quota number", "Carried", "Stephen / Davi", "Davi",
    "Davi's quota is the whole-department target minus the sum of the other reps. Blocked on the department total.",
    "Get the whole-department target so annual AE attainment can be closed", "NEW"],
  ["Waiting on others", 14, "Daily digest precision", "20 Aug", "Stephen", "Sai / Davi",
    "Explicitly deferred by Stephen — more important things at the moment.",
    "Poll in #revops-external so Sai and Davi set the metric list first", "Deferred by Stephen"],
  ["Queued", 15, "Dashboard fixes carried from the 21 Aug brief", "21 Aug", "BA brief", "Me",
    "Four open items: the stage-vocabulary module (third week carried), Contract Paused still excluded at six sites, the Predicted Cashflow card plotting ARR rather than cash, and renewals not split out of the Live tier.",
    "Clear the two sub-hour label and split fixes, then the stage-vocabulary module", "NEW"],
  ["Queued", 16, "Additional-locations ARR undercount", "18 Aug", "An Dinh / Finance", "Me",
    "Salesforce stopped getting opportunities for added locations around February 2026 but Chargebee still bills them, so dashboard ARR undercounts and the gap grows. These numbers are being used for the PE raise.",
    "Quantify it from the Chargebee join and disclose the number", "NEW"],
  ["Queued", 17, "Partnership Ops", "21 Aug", "Noah", "Noah",
    "Raised by Noah on 21 Aug. Scope not yet defined.",
    "Agree scope with Noah", "Carried — scope undefined"],
  ["Queued", 18, "Integration keys from Sri's account and email", "21 Aug", "Stephen", "Blocked by other work",
    "Explicitly deferred by Stephen — let's get on this eventually.",
    "Pick up once the higher-priority items clear", "Deferred by Stephen"],
];

const HEADERS = ["Status", "#", "Item", "Date", "Requested by", "Blocked on / Owner", "Detail", "Next step", "Flag", "Your update"];
const COL_W = [118, 34, 307, 118, 139, 139, 545, 307, 237, 209];
const LAST = ROWS.length + 1;

function boardRows() {
  const head = { values: HEADERS.map((h) => fmt(txt(h), { backgroundColorStyle: { rgbColor: NAVY }, textFormat: font({ bold: true, foregroundColorStyle: { rgbColor: WHITE } }), horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP", borders: BORDERS })) };
  const body = ROWS.map((r) => {
    const s = STATUS[r[0]];
    const base = { backgroundColorStyle: { rgbColor: s.bg }, verticalAlignment: "TOP", wrapStrategy: "WRAP", borders: BORDERS };
    return { values: [
      fmt(txt(r[0]), { ...base, textFormat: font({ bold: true, foregroundColorStyle: { rgbColor: s.fg } }), horizontalAlignment: "LEFT" }),
      fmt(num(r[1]), { ...base, textFormat: font({ foregroundColorStyle: { rgbColor: FAINT } }), horizontalAlignment: "CENTER", wrapStrategy: "OVERFLOW_CELL" }),
      fmt(txt(r[2]), { ...base, textFormat: font({ bold: true, foregroundColorStyle: { rgbColor: INK } }), horizontalAlignment: "LEFT" }),
      ...[3, 4, 5, 6, 7].map((i) => fmt(txt(r[i]), { ...base, textFormat: font({ foregroundColorStyle: { rgbColor: GREY } }), horizontalAlignment: "LEFT" })),
      fmt(txt(r[8] || ""), { ...base, textFormat: { fontFamily: "Arial", fontSize: 9, bold: true, foregroundColorStyle: { rgbColor: s.fg } } }),
      fmt(txt(""), { ...base, backgroundColorStyle: { rgbColor: YELLOW }, textFormat: font({ foregroundColorStyle: { rgbColor: GREY } }) }),
    ] };
  });
  return [head, ...body];
}


// ---- Summary tab addition: a counts table over the Open Work tab -------------
function summaryBlock() {
  const label = (t, o = {}) => fmt(txt(t), { backgroundColorStyle: { rgbColor: WHITE }, textFormat: font(o), horizontalAlignment: "LEFT", verticalAlignment: "TOP", wrapStrategy: "OVERFLOW_CELL" });
  const hdr = (a, b) => {
    const f = { backgroundColorStyle: { rgbColor: NAVY }, textFormat: font({ bold: true, foregroundColorStyle: { rgbColor: WHITE } }), verticalAlignment: "TOP", wrapStrategy: "OVERFLOW_CELL", borders: BORDERS };
    return { values: [{}, fmt(txt(a), { ...f, horizontalAlignment: "LEFT" }), fmt(txt(b), { ...f, horizontalAlignment: "CENTER" })] };
  };
  const band = (name, right, extra) => {
    const s = STATUS[name];
    const f = { backgroundColorStyle: { rgbColor: s.bg }, textFormat: font({ bold: true, foregroundColorStyle: { rgbColor: s.fg } }), verticalAlignment: "MIDDLE", wrapStrategy: "OVERFLOW_CELL", borders: BORDERS };
    const row = [{}, fmt(txt(name), { ...f, horizontalAlignment: "LEFT" }), fmt(right, { ...f, horizontalAlignment: "CENTER" })];
    if (extra) row.push(extra);
    return { values: row };
  };
  const plain = (a, b) => ({ values: [{}, label(a, { bold: true, foregroundColorStyle: { rgbColor: INK } }), fmt(b, { backgroundColorStyle: { rgbColor: WHITE }, textFormat: font({ bold: true, foregroundColorStyle: { rgbColor: INK } }), horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "OVERFLOW_CELL" })] });
  const note = (t) => fmt(txt(t), { backgroundColorStyle: { rgbColor: WHITE }, textFormat: { fontFamily: "Arial", fontSize: 9, foregroundColorStyle: { rgbColor: FAINT } }, horizontalAlignment: "LEFT", verticalAlignment: "TOP", wrapStrategy: "WRAP" });
  const cnt = (row) => fx(`=COUNTIF('${TAB}'!$A$2:$A$${LAST},$B${row})`);
  return [
    { values: [] },
    { values: [{}, label("Open work carried into Week 2", { fontSize: 11, bold: true, foregroundColorStyle: { rgbColor: INK } })] },
    { values: [{}, label("Window: 21 – 28 August 2026. Prepared for Formal Check-in #2, Fri 28 Aug 09:00 ICT.", { fontSize: 10, foregroundColorStyle: { rgbColor: GREY } })] },
    hdr("Status", "Count"),
    band("In progress", cnt(18), note(`These counts are formulas over the '${TAB}' tab — change a Status cell there and they update here. The Board tab above stays as the Week 1 record.`)),
    band("Waiting on others", cnt(19)),
    band("Queued", cnt(20)),
    plain("Total open items", fx("=SUM(C18:C20)")),
    { values: [] },
    { values: [...plain("Carried from Week 1", num(9)).values, note("Week 1's 16 shipped items are not repeated on the Open Work tab.")] },
    plain("New since the Week 1 board", num(9)),
  ];
}

const meta = await sheets.spreadsheets.get({ spreadsheetId: ID });
const prior = meta.data.sheets.find((s) => s.properties.title === TAB);
if (prior) await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ deleteSheet: { sheetId: prior.properties.sheetId } }] } });
const summaryId = meta.data.sheets.find((s) => s.properties.title === "Summary").properties.sheetId;

const add = await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB, index: 1, gridProperties: { rowCount: LAST + 40, columnCount: 26, frozenRowCount: 1 } } } }] } });
const tabId = add.data.replies[0].addSheet.properties.sheetId;

const requests = [
  { updateCells: { rows: boardRows(), fields: "userEnteredValue,userEnteredFormat", start: { sheetId: tabId, rowIndex: 0, columnIndex: 0 } } },
  { updateCells: { rows: summaryBlock(), fields: "userEnteredValue,userEnteredFormat", start: { sheetId: summaryId, rowIndex: 13, columnIndex: 0 } } },
  { updateDimensionProperties: { range: { sheetId: tabId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: "pixelSize" } },
  { updateDimensionProperties: { range: { sheetId: tabId, dimension: "ROWS", startIndex: 1, endIndex: LAST }, properties: { pixelSize: 77 }, fields: "pixelSize" } },
];
COL_W.forEach((px, i) => requests.push({ updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } }));
await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests } });

const tabs = (await sheets.spreadsheets.get({ spreadsheetId: ID })).data.sheets.map((s) => s.properties.title);
console.log("tabs now:", tabs.join(" | "));
const sum = await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: "Summary!B15:C24" });
console.log("\nnew Summary block:");
for (const r of sum.data.values || []) if (r.length) console.log("  ", r.join(" = "));
const ow = await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: `'${TAB}'!A1:B20` });
console.log("\nOpen Work rows:", ow.data.values.length - 1);
const old = await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: "Board!A1:B25" });
console.log("Board tab untouched, rows:", old.data.values.length - 1);
