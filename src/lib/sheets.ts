import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const b64Key = process.env.GOOGLE_PRIVATE_KEY_B64;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || (!b64Key && !rawKey)) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY(_B64) env vars"
    );
  }

  const key = b64Key
    ? Buffer.from(b64Key, "base64").toString("utf-8")
    : rawKey!.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function getSheetValues(tabName: string, range = "A1:BI200") {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${tabName}'!${range}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return res.data.values ?? [];
}

type Cell = string | number | null;
// Read many tab ranges in a SINGLE Sheets API call (values.batchGet) instead of one
// request per tab. The dashboard reads ~19 tabs per load; individual gets blow the
// "60 read requests / minute / user" quota under concurrent traffic. This collapses it
// to 2 reads (one metadata lookup so a missing tab can't fail the whole batch, + the
// batchGet). Returns rows aligned 1:1 with `specs` order; missing tabs → [].
export async function getSheetValuesBatch(
  specs: { tab: string; range?: string }[]
): Promise<Cell[][][]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties.title" });
  const titles = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));
  const present = specs.filter((s) => titles.has(s.tab));

  const res = present.length
    ? await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SHEET_ID,
        ranges: present.map((s) => `'${s.tab}'!${s.range ?? "A1:BI200"}`),
        valueRenderOption: "UNFORMATTED_VALUE",
      })
    : null;
  const ranges = res?.data.valueRanges ?? [];

  let k = 0;
  return specs.map((s) => (titles.has(s.tab) ? ((ranges[k++]?.values ?? []) as Cell[][]) : []));
}
