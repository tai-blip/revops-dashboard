// Daily Slack digest — runs LAST in the refresh workflow, after the SFDC → Sheet
// pull has rewritten the tabs. Reads the freshly-written sheet (so the numbers
// match the dashboard 1:1), compares against the previous run, and posts a Slack
// message summarizing WHAT CHANGED TODAY vs YESTERDAY:
//   • Live ARR + movement since the last run
//   • deals newly won since yesterday (name · ARR · term · rep)
//   • deals that dropped out of the won set (churn / re-stage)
//   • payment-mix annual-% shift (New Business & Renewals, current month)
//
// A snapshot row is appended to the "Daily_Digest_Log" sheet tab each run, so the
// "vs yesterday" diff is auditable and lives in the sheet (not hidden in code).
//
// No-ops cleanly (exit 0) if SLACK_WEBHOOK_URL is unset — so the cron never fails
// just because Slack isn't wired up yet.
//
// Run: node --env-file=.env scripts/daily-digest.mjs

import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const WEBHOOK = process.env.SLACK_WEBHOOK_URL;
const DRY = process.env.DIGEST_DRY === "1" || process.argv.includes("--dry");
const LOG_TAB = "Daily_Digest_Log";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Dry run (DIGEST_DRY=1 or --dry): read the sheet + compose the message, print it,
// but never post to Slack or append a snapshot row. For local verification.
if (!WEBHOOK && !DRY) {
  console.log("daily-digest: SLACK_WEBHOOK_URL not set — skipping (no-op).");
  process.exit(0);
}

const gAuth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const api = google.sheets({ version: "v4", auth: gAuth });

// ---------- helpers ----------
const fmtUsd = (v) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? "$" + (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? "$" + Math.round(a / 1e3) + "k" : "$" + Math.round(a);
  return v < 0 ? "-" + s : s;
};
const signed = (v) => (v >= 0 ? "+" : "") + fmtUsd(v);
const emoji = (v) => (v > 0 ? "🟢" : v < 0 ? "🔴" : "⚪️");

const toMs = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Date.UTC(1899, 11, 30) + v * 86400000;
  const t = Date.parse(String(v).slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(t) ? null : t;
};

async function getValues(range) {
  try {
    const res = await api.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range, valueRenderOption: "UNFORMATTED_VALUE" });
    return res.data.values || [];
  } catch {
    return [];
  }
}

async function ensureLogTab() {
  const meta = await api.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === LOG_TAB);
  if (exists) return;
  await api.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: LOG_TAB, gridProperties: { rowCount: 1000, columnCount: 8 } } } }] },
  });
  await api.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${LOG_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [["Date (UTC)", "Timestamp", "Live ARR", "Won deals (count)", "Won ARR (total)", "NB Annual %", "Ren Annual %", "Won Opp Ids"]] },
  });
}

// ---------- main ----------
async function main() {
  if (!DRY) await ensureLogTab();

  // 1) Live ARR = last populated "Active ARR — Rule A" (col C) in ARR_MoM_Rebuild.
  const momRows = await getValues("ARR_MoM_Rebuild!A2:C600");
  let liveArr = 0;
  for (const r of momRows) {
    const c = Number(r?.[2]);
    if (Number.isFinite(c) && c > 0) liveArr = c;
  }

  // 2) Won deals (all Billing/Closed Won) from SOQL_PaymentMix.
  const pmix = await getValues("SOQL_PaymentMix!A1:M5000");
  const h = (pmix[0] || []).map((x) => String(x ?? ""));
  const ci = (n) => h.findIndex((x) => x.toLowerCase() === n.toLowerCase());
  const cId = ci("Id"), cOpp = ci("Opportunity"), cAcct = ci("Account"), cType = ci("Type"),
    cTerm = ci("Payment Term"), cArr = ci("ARR (USD)"), cOwner = ci("Owner"), cAm = ci("Account Manager"),
    cLive = ci("ContractLiveDate");
  const deals = pmix.slice(1).filter((r) => r?.[cId]).map((r) => ({
    id: String(r[cId]),
    name: String(r[cAcct] || r[cOpp] || "(unnamed)"),
    isNB: /New Business/i.test(String(r[cType] || "")),
    isRen: /Renewal/i.test(String(r[cType] || "")),
    term: String(r[cTerm] || ""),
    arr: Number(r[cArr] || 0),
    rep: String(r[cOwner] || r[cAm] || ""),
    liveMs: toMs(r[cLive]),
  }));

  // current calendar month → payment-mix annual % (share of ARR)
  const now = new Date();
  const cy = now.getUTCFullYear(), cm = now.getUTCMonth();
  const inCurMonth = (d) => d.liveMs != null && new Date(d.liveMs).getUTCFullYear() === cy && new Date(d.liveMs).getUTCMonth() === cm;
  const annualPct = (list) => {
    const tot = list.reduce((s, d) => s + d.arr, 0);
    return tot ? Math.round((list.filter((d) => d.term === "Annual").reduce((s, d) => s + d.arr, 0) / tot) * 100) : 0;
  };
  const curNB = deals.filter((d) => d.isNB && inCurMonth(d));
  const curRen = deals.filter((d) => d.isRen && inCurMonth(d));
  const nbAnnual = annualPct(curNB), renAnnual = annualPct(curRen);

  const wonIds = deals.map((d) => d.id);
  const wonArrTotal = deals.reduce((s, d) => s + d.arr, 0);

  // 3) Previous snapshot (last row of the log).
  const log = await getValues(`${LOG_TAB}!A2:H2000`);
  const prev = log.length ? log[log.length - 1] : null;
  const prevArr = prev ? Number(prev[2]) || 0 : null;
  const prevCount = prev ? Number(prev[3]) || 0 : null;
  const prevNbAnnual = prev ? Number(prev[5]) || 0 : null;
  const prevRenAnnual = prev ? Number(prev[6]) || 0 : null;
  const prevIds = new Set(prev && prev[7] ? String(prev[7]).split(",").filter(Boolean) : []);

  const newWon = prev ? deals.filter((d) => !prevIds.has(d.id)) : [];
  const dropped = prev ? [...prevIds].filter((id) => !wonIds.includes(id)) : [];
  newWon.sort((a, b) => b.arr - a.arr);

  // 4) Build the Slack message.
  const today = now.toISOString().slice(0, 10);
  const dLabel = `${MON[cm]} ${now.getUTCDate()}, ${cy}`;
  const arrDelta = prevArr == null ? null : liveArr - prevArr;

  const blocks = [];
  blocks.push({ type: "header", text: { type: "plain_text", text: `📊 RevOps Daily Digest — ${dLabel}`, emoji: true } });

  const dCount = prevCount == null ? null : wonIds.length - prevCount;
  const dNb = prevNbAnnual == null ? null : nbAnnual - prevNbAnnual;
  const dRen = prevRenAnnual == null ? null : renAnnual - prevRenAnnual;
  const pts = (d) => `${d >= 0 ? "+" : ""}${d} pts`;
  const headlineFields = [
    { type: "mrkdwn", text: `*Live ARR*\n${fmtUsd(liveArr)}${arrDelta == null ? "" : `  ${emoji(arrDelta)} ${signed(arrDelta)}`}` },
    { type: "mrkdwn", text: `*Won deals (total)*\n${wonIds.length}${dCount == null ? "" : `  (${dCount >= 0 ? "+" : ""}${dCount} vs yst)`}` },
    { type: "mrkdwn", text: `*NB annual mix (${MON[cm]})*\n${nbAnnual}%${dNb == null ? "" : `  (${pts(dNb)})`}` },
    { type: "mrkdwn", text: `*Renewal annual mix (${MON[cm]})*\n${renAnnual}%${dRen == null ? "" : `  (${pts(dRen)})`}` },
  ];
  blocks.push({ type: "section", fields: headlineFields });

  if (!prev) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_First run — baseline captured. Tomorrow's digest will show day-over-day changes._" } });
  } else {
    blocks.push({ type: "divider" });
    if (newWon.length) {
      const lines = newWon.slice(0, 12).map((d) => `• *${d.name}* — ${fmtUsd(d.arr)} · ${d.term || "—"} · ${d.isNB ? "New Biz" : d.isRen ? "Renewal" : "—"}${d.rep ? ` · ${d.rep}` : ""}`);
      const extra = newWon.length > 12 ? `\n_…and ${newWon.length - 12} more_` : "";
      const newArr = newWon.reduce((s, d) => s + d.arr, 0);
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*🎉 ${newWon.length} newly won since yesterday* (${fmtUsd(newArr)})\n${lines.join("\n")}${extra}` } });
    } else {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: "*No new deals entered the won set since yesterday.*" } });
    }
    if (dropped.length) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*⚠️ ${dropped.length} deal(s) left the won set* (churn or re-stage) — worth a look.` } });
    }
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Won-ARR book: ${fmtUsd(wonArrTotal)} · source: SOQL_PaymentMix + ARR_MoM_Rebuild · auto-posted after the daily SFDC → Sheet refresh` }] });

  const text = `RevOps Daily Digest — ${dLabel}: Live ARR ${fmtUsd(liveArr)}${arrDelta == null ? "" : ` (${signed(arrDelta)})`}, ${newWon.length} newly won.`;

  if (DRY) {
    console.log("=== DRY RUN — not posting, not writing snapshot ===");
    console.log("fallback text:", text);
    console.log("prev snapshot:", prev ? `ARR ${fmtUsd(prevArr)}, ${prevCount} won` : "(none — first run)");
    console.log("newly won:", newWon.length, "| dropped:", dropped.length);
    console.log(JSON.stringify({ blocks }, null, 2));
    return;
  }

  // 5) Append today's snapshot BEFORE posting (so a Slack hiccup doesn't lose it).
  await api.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${LOG_TAB}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[today, now.toISOString(), liveArr, wonIds.length, Math.round(wonArrTotal), nbAnnual, renAnnual, wonIds.join(",")]] },
  });

  // 6) Post to Slack.
  const resp = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, blocks }),
  });
  if (!resp.ok) {
    console.error("daily-digest: Slack post failed", resp.status, await resp.text());
    process.exit(1);
  }
  console.log(`daily-digest: posted. Live ARR ${fmtUsd(liveArr)}, ${newWon.length} newly won, ${dropped.length} dropped.`);
}

main().catch((e) => {
  console.error("daily-digest failed:", e?.message || e);
  process.exit(1);
});
