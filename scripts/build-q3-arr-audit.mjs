// Audit tabs: 3 PINK tabs (Booked / Contracted / Live ARR) listing every deal in each
// tier using the DASHBOARD's current point-in-time logic (computeArrFunnel, as of today) —
// mutually exclusive, each deal in exactly one tier. Columns: Account, Opportunity, Stage,
// Status, Contract Live Date, Contract Signed Date, ARR, + a Q3? flag (contract-live in Q3).
// Snapshot as of run time. Run: node --env-file=.env scripts/build-q3-arr-audit.mjs
import { google } from "googleapis";

const Q_START = "2026-07-01", Q_END = "2026-10-01"; // Q3 FY26
const CHURN = new Set(["Contracts Ended (Churned)", "Contract Paused"]);
const LP = new Set(["[LP] Live Paying", "[LP] Live Paying (Monthly)"]);
const SIGNED = new Set(["Billing", "Closed Won"]);
const PINK = { red: 0.96, green: 0.55, blue: 0.75 };

async function sfAuth() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SF_CLIENT_ID, client_secret: process.env.SF_CLIENT_SECRET });
  const r = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error("SF auth failed: " + JSON.stringify(j));
  return { token: j.access_token, instance: j.instance_url };
}
async function sfQuery(instance, token, soql) {
  let url = `${instance}/services/data/v${process.env.SF_API_VERSION || "59.0"}/query?q=${encodeURIComponent(soql)}`;
  const out = [];
  while (url) { const j = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()); if (!j.records) throw new Error(JSON.stringify(j)); out.push(...j.records); url = j.done ? null : `${instance}${j.nextRecordsUrl}`; }
  return out;
}
const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });

const d10 = (s) => (s ? String(s).slice(0, 10) : "");

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const { token, instance } = await sfAuth();
  const T = new Date().toISOString().slice(0, 10);

  const recs = await sfQuery(instance, token,
    `SELECT Id, Account.Name, Name, StageName, Status__c, convertCurrency(AnnualContractValueARR__c) arr, ContractLiveDate__c, ContractSignedDate__c, Contract_Live_Date_Rip_Replace_LOC__c, Live_Paying_Date__c, Date_Reached_Trial__c, Date_Reached_Closed_Lost__c, ContractEndDate__c FROM Opportunity WHERE Date_Reached_Trial__c != null OR ContractLiveDate__c != null OR Live_Paying_Date__c != null`);

  const rows = recs.map((r) => ({
    id: r.Id, acct: r.Account?.Name || "", opp: r.Name || "", stage: r.StageName || "", status: r.Status__c || "",
    arr: Number(r.arr || 0), live: d10(r.ContractLiveDate__c), signed: d10(r.ContractSignedDate__c), rr: d10(r.Contract_Live_Date_Rip_Replace_LOC__c),
    livePay: d10(r.Live_Paying_Date__c), trial: d10(r.Date_Reached_Trial__c), lost: d10(r.Date_Reached_Closed_Lost__c), end: d10(r.ContractEndDate__c),
  })).filter((r) => r.arr > 0);

  // Quarter (FY26) of a date; anchor date per tier. Filter keeps Q3 + Q4 only.
  const coalesce = (...xs) => xs.find((x) => x) || "";
  const quarterOf = (d) => { if (!d) return ""; const m = d.slice(0, 7); if (m >= "2026-07" && m <= "2026-09") return "Q3 FY26"; if (m >= "2026-10" && m <= "2026-12") return "Q4 FY26"; return ""; };

  // Exact dashboard point-in-time logic (computeArrFunnel, as-of-today).
  const be = (d) => d !== "" && d <= T;   // date set and on/before today
  const af = (d) => d === "" || d > T;    // blank or in the future
  const tierOf = (r) => {
    const sg = SIGNED.has(r.stage), ch = CHURN.has(r.status);
    if (sg && !ch && be(r.livePay) && af(r.end)) return "Live";
    if (sg && !ch && be(r.live) && af(r.livePay) && af(r.end) && af(r.lost)) return "Contracted";
    if (be(r.trial) && af(r.live) && af(r.livePay) && af(r.lost)) return "Booked";
    return "";
  };
  const inQ3 = (d) => d && d >= Q_START && d < Q_END;

  const buckets = { Booked: [], Contracted: [], Live: [] };
  for (const r of rows) { const t = tierOf(r); if (buckets[t]) buckets[t].push(r); }

  // Truc's NESTED classification (a deal can be in several): Booked = Billing/CW/Trial (not
  // churned), Contracted = Billing/CW (not churned), Live = status Live Paying. No ended filter.
  const trucBooked = (r) => !CHURN.has(r.status) && ["Billing", "Closed Won", "Trial"].includes(r.stage);
  const trucContracted = (r) => !CHURN.has(r.status) && ["Billing", "Closed Won"].includes(r.stage);
  const trucLive = (r) => LP.has(r.status);
  const trucTiers = (r) => [trucBooked(r) && "Booked", trucContracted(r) && "Contracted", trucLive(r) && "Live"].filter(Boolean).join(", ") || "—";
  const isEnded = (r) => r.end !== "" && r.end <= T;

  const M = (n) => "$" + Math.round(n).toLocaleString();
  const sum = (l) => l.reduce((s, r) => s + r.arr, 0);
  const link = (id, label) => `=HYPERLINK("${instance}/${id}", "${String(label).replace(/"/g, '""')}")`;

  // Anchor date per tier = the transition date that defines membership in that tier.
  // Filter every tab to Q3 + Q4 FY26 on that anchor, sorted by ARR, with a Quarter column.
  const anchorBooked = (r) => coalesce(r.trial, r.rr, r.live, r.signed);       // reached trial
  const anchorContracted = (r) => coalesce(r.rr, r.live, r.signed);            // contract went live
  const anchorLive = (r) => coalesce(r.livePay, r.rr, r.live);                 // started paying
  const q34 = (list, anchorFn) => list
    .map((r) => ({ ...r, anchor: anchorFn(r), q: quarterOf(anchorFn(r)) }))
    .filter((r) => r.q)
    .sort((a, b) => b.arr - a.arr);
  const qsplit = (l) => { const q3 = l.filter((r) => r.q === "Q3 FY26"), q4 = l.filter((r) => r.q === "Q4 FY26"); return `Q3: ${q3.length}/${M(sum(q3))}   Q4: ${q4.length}/${M(sum(q4))}`; };

  const oB = q34(buckets.Booked, anchorBooked), oC = q34(buckets.Contracted, anchorContracted), oL = q34(buckets.Live, anchorLive);
  const tB = q34(rows.filter(trucBooked), anchorBooked), tC = q34(rows.filter(trucContracted), anchorContracted), tL = q34(rows.filter(trucLive), anchorLive);
  const notEnded = (r) => !isEnded(r);

  const build = (title, note, list) => [
    [title + " — OURS point-in-time · Q3+Q4 FY26 (as of " + T + ")"],
    [`${list.length} ops · ${M(sum(list))}   |   ${qsplit(list)}`],
    [note + "  ·  'Truc tiers' = where the same deal lands in Truc's nested model. Filter the Quarter column to isolate Q3 / Q4."],
    [],
    ["Quarter", "Account", "Opportunity (→SFDC)", "Stage", "Status", "Contract Live Date", "Contract Signed Date", "ARR (USD)", "Anchor date", "Truc tiers (nested)", "Contract ended?"],
    ...list.map((r) => [r.q, r.acct, link(r.id, r.opp), r.stage, r.status, r.live || "(blank)", r.signed || "(blank)", Math.round(r.arr), r.anchor, trucTiers(r), isEnded(r) ? "ENDED" : ""]),
  ];
  const buildTruc = (title, note, list) => {
    const ended = list.filter(isEnded);
    return [
      [title + " — TRUC nested · Q3+Q4 FY26 (as of " + T + ")"],
      [`${list.length} ops · ${M(sum(list))}   |   ${qsplit(list)}   |   already-ended: ${ended.length}/${M(sum(ended))}`],
      [note],
      [],
      ["Quarter", "Account", "Opportunity (→SFDC)", "Stage", "Status", "Contract Live Date", "Contract Signed Date", "ARR (USD)", "Anchor date", "Contract ended?"],
      ...list.map((r) => [r.q, r.acct, link(r.id, r.opp), r.stage, r.status, r.live || "(blank)", r.signed || "(blank)", Math.round(r.arr), r.anchor, isEnded(r) ? "ENDED" : ""]),
    ];
  };

  // Reconciliation (on the same Q3+Q4-filtered populations): ours vs Truc vs Truc excl-ended.
  const recon = [
    ["Reconciliation — Ours (point-in-time) vs Truc (nested) — Q3+Q4 FY26, as of " + T],
    ["Anchored on each tier's transition date (Booked = reached trial, Contracted = contract-live, Live = live-paying). Ours = each deal in ONE tier, active only. Truc = nested (a deal counts in every tier it's reached), no ended-contract filter."],
    [],
    ["Tier", "Ours: ops", "Ours: $", "Truc: ops", "Truc: $", "Truc excl-ended: ops", "Truc excl-ended: $", "Why the gap"],
    ["Booked", oB.length, Math.round(sum(oB)), tB.length, Math.round(sum(tB)), tB.filter(notEnded).length, Math.round(sum(tB.filter(notEnded))), "Truc = all sold-or-piloting (nested, incl. live+ended); ours = only current pilots"],
    ["Contracted", oC.length, Math.round(sum(oC)), tC.length, Math.round(sum(tC)), tC.filter(notEnded).length, Math.round(sum(tC.filter(notEnded))), "Truc = all signed (incl. live-paying + ended); ours = only signed-not-yet-paying"],
    ["Live", oL.length, Math.round(sum(oL)), tL.length, Math.round(sum(tL)), "—", "—", "Both = live-paying book; agree within rounding"],
    [],
    ["Two reasons for the gap:", ""],
    ["1) NESTED vs EXCLUSIVE", "Truc counts a live deal in Booked + Contracted + Live; we count it once (Live). That triple-counts our Live deals into his Booked/Contracted."],
    ["2) ENDED CONTRACTS", "Truc includes already-ended contracts. Excluding them (the 'Truc excl-ended' columns) narrows the gap to the nesting effect."],
  ];

  const BLUE = { red: 0.6, green: 0.77, blue: 0.96 }, YELLOW = { red: 1, green: 0.9, blue: 0.5 };

  // Ordered: ours (pink) then Truc's (blue), side by side; reconciliation first.
  const sheets = [
    ["ARR Reconciliation", YELLOW, recon],
    ["Booked ARR", PINK, build("Booked ARR", "OURS — in pilot: reached Trial, not yet contract-live / paying / lost.", oB)],
    ["Booked ARR - Truc", BLUE, buildTruc("Booked ARR", "Everything sold or piloting: stage Billing / Closed Won / Trial (churn+paused excluded). No ended-contract filter.", tB)],
    ["Contracted ARR", PINK, build("Contracted ARR", "OURS — signed, contract-live, NOT yet paying (no Live Paying Date), not ended/churned.", oC)],
    ["Contracted ARR - Truc", BLUE, buildTruc("Contracted ARR", "Signed order forms: stage Billing / Closed Won (churn+paused excluded). No ended-contract filter.", tC)],
    ["Live ARR", PINK, build("Live ARR", "OURS — signed, live-paying (Live Paying Date reached), not ended/churned.", oL)],
    ["Live ARR - Truc", BLUE, buildTruc("Live ARR", "Live and paying: status Live Paying.", tL)],
  ];

  const meta = await api.spreadsheets.get({ spreadsheetId: ID, fields: "sheets.properties(sheetId,title)" });
  const byTitle = Object.fromEntries(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const reqs = [];
  for (const t of ["Q3 Booked ARR", "Q3 Contracted ARR", "Q3 Live ARR", ...sheets.map(([t]) => t)]) if (byTitle[t] != null) reqs.push({ deleteSheet: { sheetId: byTitle[t] } });
  sheets.forEach(([t, color], i) => reqs.push({ addSheet: { properties: { title: t, index: i, tabColor: color } } }));
  const res = await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });
  const gids = {};
  res.data.replies.filter((r) => r.addSheet).forEach((r) => { gids[r.addSheet.properties.title] = r.addSheet.properties.sheetId; });

  await api.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: "USER_ENTERED", data: sheets.map(([t, , values]) => ({ range: `'${t}'!A1`, values })) } });

  // Filter dropdowns on each deal tab (header on row 5); freeze that header row.
  const filterReqs = [];
  for (const [t, , values] of sheets) {
    if (t === "ARR Reconciliation") continue;
    const sheetId = gids[t], cols = values[4].length, rowsN = values.length;
    filterReqs.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 5 } }, fields: "gridProperties.frozenRowCount" } });
    filterReqs.push({ setBasicFilter: { filter: { range: { sheetId, startRowIndex: 4, endRowIndex: rowsN, startColumnIndex: 0, endColumnIndex: cols } } } });
  }
  await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: filterReqs } });

  console.log("=== Reconciliation (Q3+Q4 FY26) ===");
  console.log(`  Booked:     ours ${oB.length}/${M(sum(oB))}   truc ${tB.length}/${M(sum(tB))}   truc-excl-ended ${tB.filter(notEnded).length}/${M(sum(tB.filter(notEnded)))}`);
  console.log(`  Contracted: ours ${oC.length}/${M(sum(oC))}   truc ${tC.length}/${M(sum(tC))}   truc-excl-ended ${tC.filter(notEnded).length}/${M(sum(tC.filter(notEnded)))}`);
  console.log(`  Live:       ours ${oL.length}/${M(sum(oL))}   truc ${tL.length}/${M(sum(tL))}`);
  for (const [t] of sheets) console.log(`${t} → gid=${gids[t]}`);
  console.log("Sheet: https://docs.google.com/spreadsheets/d/" + ID + "/edit");
}
main().catch((e) => { console.error(e); process.exit(1); });
