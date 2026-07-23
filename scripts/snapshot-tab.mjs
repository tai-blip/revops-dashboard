import { google } from "googleapis";
import { writeFileSync, mkdirSync } from "fs";
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const TAB = process.argv[2] || "LiveARR - SOQL Pull";
const STAMP = process.argv[3] || "manual";

// Pull both values and formulas so the snapshot is a faithful rollback source
const [vals, forms] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1:AH1200`, valueRenderOption: "UNFORMATTED_VALUE" }),
  sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'!A1:AH1200`, valueRenderOption: "FORMULA" }),
]);
mkdirSync("data-snapshots", { recursive: true });
const safe = TAB.replace(/[^A-Za-z0-9]+/g, "-");
const path = `data-snapshots/${safe}_${STAMP}.json`;
writeFileSync(path, JSON.stringify({ tab: TAB, stamp: STAMP, values: vals.data.values, formulas: forms.data.values }, null, 0));
console.log("snapshot saved:", path);
console.log("rows(values):", (vals.data.values||[]).length, " rows(formulas):", (forms.data.values||[]).length);
