// Revie's ONLY data access path (read-only). The Socket-Mode bot allows headless Claude
// exactly one Bash pattern — `node --env-file=.env scripts/revie-query.mjs …` — so every
// answer flows through the guards in this file.
//
// Usage:
//   node --env-file=.env scripts/revie-query.mjs tabs  <main|rep>
//   node --env-file=.env scripts/revie-query.mjs sheet <main|rep> "<Tab>!A1:H50"
//   node --env-file=.env scripts/revie-query.mjs soql  "SELECT ... FROM Opportunity ..."
import { google } from "googleapis";

const REP_SHEET_ID = "1dHpM2O_8tZfsEGmbIz_W59_qe5gI5NQ5THW_v5DWphc";
const [cmd, a1, a2] = process.argv.slice(2);

const gAuth = () =>
  new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64 ?? "", "base64").toString("utf-8"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"], // readonly scope — hard guard
  });
const sheetId = (which) => (which === "rep" ? REP_SHEET_ID : process.env.GOOGLE_SHEET_ID);

async function main() {
  if (cmd === "tabs") {
    const api = google.sheets({ version: "v4", auth: gAuth() });
    const m = await api.spreadsheets.get({ spreadsheetId: sheetId(a1), fields: "sheets.properties.title" });
    console.log(JSON.stringify(m.data.sheets.map((s) => s.properties.title)));
    return;
  }
  if (cmd === "sheet") {
    const api = google.sheets({ version: "v4", auth: gAuth() });
    const r = await api.spreadsheets.values.get({ spreadsheetId: sheetId(a1), range: a2, valueRenderOption: "UNFORMATTED_VALUE" });
    console.log(JSON.stringify((r.data.values ?? []).slice(0, 150)));
    return;
  }
  if (cmd === "soql") {
    const clean = String(a1 ?? "").trim().replace(/;+\s*$/, "");
    if (!/^select\s/i.test(clean) || /;/.test(clean)) throw new Error("REJECTED: only a single SELECT statement is allowed.");
    if (/\b(insert|update|delete|upsert|merge)\b/i.test(clean.replace(/'[^']*'/g, ""))) throw new Error("REJECTED: read-only.");
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
    const t = await (await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body })).json();
    if (!t.access_token) throw new Error("SF auth failed");
    const v = process.env.SF_API_VERSION || "59.0";
    const j = await (await fetch(`${t.instance_url}/services/data/v${v}/query?q=${encodeURIComponent(clean)}`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    if (!j.records) throw new Error("SOQL error: " + JSON.stringify(j).slice(0, 400));
    console.log(JSON.stringify({ totalSize: j.totalSize, records: j.records.slice(0, 100) }));
    return;
  }
  throw new Error("usage: revie-query.mjs tabs|sheet|soql …");
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
