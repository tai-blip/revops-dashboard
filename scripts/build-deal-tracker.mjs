// Deal Tracker (DRAFT) — an editable, team-facing deal sheet the AEs update weekly.
// Merges two sources into one tab in the dashboard spreadsheet:
//   1. "Deals that decide Q3" — the live SF pipeline (open SAL/SQL/SQO ranked by
//      quarterly Potential ARR), read from the API snapshot (/tmp/dash.json).
//   2. Davi's "Key Deals 2026" sheet — his flagged pipeline (confidence, est. live
//      date, notes), embedded below (in-play deals only; Closed Won/Lost dropped).
// Matched by normalized name so a decide-Q3 opp inherits Davi's confidence/notes.
// Left columns = auto (from SF/Davi). Right ▸ columns = for the team to edit.
// DRAFT: not wired into the dashboard or the daily refresh — safe to review/edit.
// Run: node --env-file=.env scripts/build-deal-tracker.mjs
import { google } from "googleapis";
import fs from "node:fs";

const TAB = "Deal Tracker (DRAFT)";
const AE = { Davi: "David Dubinski", James: "James Burdick", Jill: "Jill Bucci", Jed: "Jed Rutstein", Dorsa: "Dorsa Mahmoudnia", Mathias: "Mathias Berthelemot", Os: "Osman Mubarak" };

// Davi's Key Deals 2026 — in-play only [name, aeShort, confidence, potentialARR, estLive, notes]
const KEY = [
  ["Tim Horton's CA","Davi","Very Hard",600000,"04/04/2027","Just pinged for revisit"],
  ["Kahala Brands","Davi","Pilot",300000,"08/01/2026","1 month left in pilot. Check in two weeks"],
  ["Pizza Hut CA","Davi","Hard",100000,"09/01/2027","Revisiting Aug 20"],
  ["Dave's Hot Chicken","Jill","Pilot",200000,"09/15/2026","Surveys going live. Analytics + Alfie to come"],
  ["Boost Juice","James","Hard",120000,"10/01/2026","RFP restarting mid-July"],
  ["Krystal","James","Very Hard",170000,"06/01/2027","2+ yrs left on SOCi; revisit next year"],
  ["Teriyaki Madness","James","Hard",150000,"10/01/2026","End of summer revisit"],
  ["Quiznos","James","Very Hard",100000,"10/01/2027","Champion was fired; trying to re-engage"],
  ["Mendocino Farms","Dorsa","Pilot",110000,"07/22/2026","Pilot ends tomorrow - stuck in legal"],
  ["La Madelaine","James","Very Hard",60000,"10/01/2027","In contract with SMG"],
  ["Mooyah","James","Hard",43200,"10/01/2026","End of summer revisit"],
  ["Cotton Patch Cafe","James","Medium",100000,"10/01/2026","Final demo done, aligning on pilot terms"],
  ["Snooze","Jed","Hard",70000,"01/02/2027","Trying to build tool internally"],
  ["Apparel Group","Os","Very Hard",50000,"","Haven't paid"],
  ["Silver Diner","James","Hard",20000,"11/01/2026","End of summer revisit"],
  ["The Melt","James","Hard",15000,"09/01/2026","Demoing"],
  ["Dunn Bros","James","Hard",20000,"10/01/2026","End of summer revisit"],
  ["Slim Chickens","Jed","Hard",150000,"11/01/2026","August revisit"],
  ["Pizza Inn","Jed","Very Hard",60000,"11/01/2026","Revisit September"],
  ["Bagel Brands","Jed","Hard",250000,"11/01/2026","Guest services + Yext; missing ops-leader buy-in"],
  ["Sambazon","Jed","Medium",20000,"07/01/2026","Final decision Aug 1"],
  ["Pressed","James","Pilot",37000,"07/01/2026","Final redlines sent back"],
  ["Smalls Sliders","Jed","Very Hard",36000,"11/01/2026","Busy; setting up meeting"],
  ["Mountain Mike's","James","Very Hard",80000,"12/01/2027","EOY revisit"],
  ["Potbelly Surveys","Mathias","Pilot",100000,"01/01/2026","Pilot, working through details"],
  ["Gen Korean BBQ","James","Pilot",50000,"08/01/2026","Contract sent - waiting on Ops"],
  ["Five Guys Global","Jill","Pilot",72000,"10/01/2026","Pilot kicked off"],
  ["Qdoba","James","Very Hard",0,"12/01/2027","Pushed to 2027"],
  ["Shelby's CA","Davi","Hard",30000,"10/01/2026","Next meeting with VP ops + marketing"],
  ["Paris Baguette","James","Very Hard",150000,"12/01/2027","Not realistic this year"],
  ["Peet's Coffee","Davi","Pilot",200000,"12/01/2026","Final contract / redline + pilot agreement"],
  ["Philz Coffee","Jed","Very Hard",75000,"01/05/2027","Not a priority right now"],
  ["Penn Station","Davi","Hard",100000,"12/01/2026","End of year opportunity"],
  ["Jack's Family Restaurants","Davi","Pilot",150000,"10/01/2026","Pilot in July - very close"],
  ["Meltwich","Jed","Very Hard",50000,"","Budget issue - not this year"],
  ["Eggs Up Grill","Jed","Very Hard",75000,"01/01/2027","In contract with SOCi"],
  ["Houston Hot Chicken","Davi","Medium",35000,"11/01/2026","Verbally committed to pilot + rollout Q3/Q4"],
  ["Grimaldi's","Davi","Medium",35000,"11/01/2026","Verbally committed to pilot Q3/Q4"],
  ["Cookie Plug","Davi","Medium",25000,"09/01/2026","Late June pilot"],
  ["WNB","Davi","Very Hard",10000,"09/01/2026","Pricing discussion - close"],
  ["Eegee's","James","Very Hard",25000,"","Revisit later this year"],
  ["UFG","Davi","Medium",62160,"09/01/2026","Pilot chat today"],
  ["Panda Restaurants","James","Hard",200000,"01/10/2027","Very far away; likely not 2026"],
  ["Cava","Jill","Hard",200000,"11/01/2026","Call for next steps"],
  ["Shake Shack USA","Jill","Very Hard",200000,"12/01/2027","Intro call done"],
  ["Robeks","Davi","Hard",60000,"10/01/2026","In-person demo booked"],
  ["Salted","Jed","Hard",35000,"10/01/2026","Pricing sensitive; end of nego"],
  ["Five Guys USA","Jill","Very Hard",300000,"11/01/2026","Working to get in with US corporate"],
  ["Landry's","James","Hard",70000,"10/01/2026","End of summer revisit"],
  ["Nekter","Jed","Hard",80000,"10/01/2026","Social postponed to end of June"],
  ["Fresh Kitchen","Jed","Pilot",15000,"10/01/2026","Between Momos and Tattle"],
  ["Accensis Group","Jed","Hard",20000,"10/01/2026","End of summer revisit"],
  ["Minor Food Group","Jed","Hard",75000,"","RFP ongoing"],
  ["Sunny Street Cafe","Jed","Hard",20000,"10/01/2026","Demo booked"],
  ["Church's Texas Chicken","Jed","Hard",100000,"","RFP"],
  ["Beans and Brews","James","Pilot",75000,"",""],
  ["MTY CA Sushi Shop","Davi","Medium",40000,"",""],
  ["MTY CA Baton Rouge","Davi","Medium",10000,"",""],
  ["Flame Broiler","James","Medium",75000,"",""],
  ["DRG","Jed","Hard",50000,"12/01/2026","Ghosting; will follow up"],
  ["Oakberry CA","Jed","Hard",30000,"",""],
  ["Seattle's Best","Jed","Hard",30000,"",""],
  ["Carrot Express","Jed","Hard",30000,"",""],
  ["Thrive","James","Hard",30000,"",""],
  ["Playa Bowls","Jill","Hard",175000,"",""],
  ["Salsarita's","Jed","Pilot",70000,"","All key stakeholders pitched"],
  ["Cousins Subs","James","Hard",75000,"",""],
  ["Keke's","Jill","Pilot",90000,"",""],
  ["Burger King CA","Davi","Pilot",50400,"07/01/2026","Final legal review"],
  ["FHS Alfie","Mathias","Pilot",400000,"",""],
  ["Popeyes","Davi","Medium",270000,"",""],
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const nameMatch = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; return x === y || (x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x))); };

const gAuth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf-8"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });

// Load the "deals that decide Q3" from the deployed dashboard API (CI) or a local
// dev server. Set DASH_API_URL to the prod origin in CI; defaults to localhost.
const API = (process.env.DASH_API_URL || "http://localhost:3000").replace(/\/+$/, "") + "/api/dashboard";
async function loadDash() {
  // Prefer a local snapshot if present (fast for manual dev runs), else fetch the API.
  try { if (fs.existsSync("/tmp/dash.json")) return JSON.parse(fs.readFileSync("/tmp/dash.json", "utf-8")); } catch {}
  for (let i = 1; i <= 3; i++) {
    try { const r = await fetch(API, { signal: AbortSignal.timeout(25000) }); if (r.ok) return await r.json(); } catch (e) { console.log(`deal-tracker: fetch ${API} failed (${i}/3): ${e.message}`); }
    if (i < 3) await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

async function main() {
  const api = google.sheets({ version: "v4", auth: gAuth });
  const ID = process.env.GOOGLE_SHEET_ID;
  const dash = await loadDash();
  if (!dash || !dash.forecastTab) { console.log(`deal-tracker: no dashboard data (tried /tmp/dash.json + ${API}) — skipping.`); return; }
  const decide = dash.forecastTab?.decideDeals ?? [];

  // Merge: start from decide-Q3 (live SF pipeline), enrich with Davi's key-deal data.
  const usedKey = new Set();
  const rows = decide.map((d) => {
    const k = KEY.find((x) => nameMatch(x[0], d.name));
    if (k) usedKey.add(k[0]);
    return { name: d.name, ae: d.owner, stage: d.stage, pot: d.potARR, conf: k ? k[2] : "", live: k ? k[4] : "", notes: k ? k[5] : "", source: k ? "Q3 + Key Deal" : "Q3 Pipeline" };
  });
  // Add Davi's key deals not already matched to a decide-Q3 opp (his extra flagged pipeline).
  for (const k of KEY) {
    if (usedKey.has(k[0])) continue;
    rows.push({ name: k[0], ae: AE[k[1]] ?? k[1], stage: "Key Deal", pot: k[3], conf: k[2], live: k[4], notes: k[5], source: "Davi Key Deal" });
  }
  // Sort: Q3-pipeline deals first, then by potential desc.
  rows.sort((a, b) => (b.source.startsWith("Q3") ? 1 : 0) - (a.source.startsWith("Q3") ? 1 : 0) || b.pot - a.pot);

  const CONF_ORDER = { "Medium": 1, "Pilot": 2, "Hard": 3, "Very Hard": 4 };
  const stamp = new Date().toISOString().slice(0, 10);
  const matrix = [
    [`Deal Tracker (DRAFT) — Q3 FY26 · seeded ${stamp} from "Deals that decide Q3" + Davi's Key Deals 2026`, "", "", "", "", "", "", "", "", "", ""],
    ["Team edits the ▸ columns. Left columns auto-seeded (re-running this script overwrites them — keep manual updates in Salesforce or the ▸ columns).", "", "", "", "", "", "", "", "", "", ""],
    ["#", "Deal", "AE", "Stage", "Potential ARR", "Confidence (Davi)", "Est. Live (Davi)", "Source", "▸ Call (Commit/Best/Pipeline)", "▸ Next step", "▸ Updated"],
    ...rows.map((r, i) => [i + 1, r.name, (r.ae || "").split(" ")[0], r.stage, r.pot || "", r.conf, r.live, r.source, "", r.notes, ""]),
  ];

  await api.spreadsheets.values.clear({ spreadsheetId: ID, range: `'${TAB}'!A1:Z400` }).catch(async (e) => {
    if (/Unable to parse range|not found/i.test(String(e))) {
      await api.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 20, columnCount: 12 } } } }] } });
    } else throw e;
  });
  // RAW so Davi's est-live date strings ("10/01/2026") stay TEXT — USER_ENTERED coerces
  // them to date serials that then read back as raw numbers (46393) in the dashboard.
  await api.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: "RAW", requestBody: { values: matrix } });

  const nMedium = rows.filter((r) => r.conf === "Medium").length;
  console.log(`Wrote "${TAB}" — ${rows.length} deals (${decide.length} from decide-Q3 + ${rows.length - decide.length} extra key deals) · ${nMedium} Medium-confidence.`);
  console.log(`Tab URL: https://docs.google.com/spreadsheets/d/${ID}/edit`);
}
main().catch((e) => { console.error(e); process.exit(1); });
