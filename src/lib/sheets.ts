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
