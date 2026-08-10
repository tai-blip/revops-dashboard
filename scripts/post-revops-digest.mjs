// RevOps Pulse — the recurring RevOps daily digest ("Rep Scorecard" format).
// ARR status-lights + a per-rep scorecard (attainment · pipeline generated · weighted
// forecast) + forecasting/deal-health. Posts to SLACK_WEBHOOK_URL.
// Data source: the deployed dashboard API (DASH_API_URL) — it reads the freshly
// refreshed sheet, so the digest reuses the exact numbers the dashboard shows.
// Run (local): node --env-file=.env scripts/post-revops-digest.mjs [--dry]
//   (defaults to http://localhost:3000; set DASH_API_URL to the prod origin in CI)

const DRY = process.argv.includes("--dry");
const WEBHOOK = process.env.SLACK_WEBHOOK_URL;
const API = (process.env.DASH_API_URL || "http://localhost:3000").replace(/\/+$/, "") + "/api/dashboard";
async function loadData() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(API, { signal: AbortSignal.timeout(25000) });
      if (r.ok) return await r.json();
      console.log(`revops-digest: ${API} → HTTP ${r.status} (attempt ${attempt}/3)`);
    } catch (e) { console.log(`revops-digest: fetch failed (attempt ${attempt}/3): ${e.message}`); }
    if (attempt < 3) await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}
const d = await loadData();
if (!d || !d.forecastTab) { console.log(`revops-digest: could not load dashboard data from ${API} — skipping (no-op).`); process.exit(0); }

// ---- formatting ----
const M = (n) => (n == null ? "—" : (n === 0 ? "$0" : Math.abs(n) >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1e3) + "k"));
const pad = (s, n) => String(s).padEnd(n);
const MABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const moLabel = (l) => { const [, m] = l.split("-"); return MABBR[+m - 1] || l; };

// ---- ARR ----
const liveArr = d.liveArrToday;
const booked = d.bookingReport;
const renewal = d.arrForward?.renewalDue ?? 0;
const mo = d.arr.monthly;
const lastComplete = mo[mo.length - 2]; // Jul (Aug is in progress)

// ---- pipe generated per rep (New ARR created in Q3 months = Jul+Aug), same as dashboard ----
const MA = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const isQ3 = (l) => { const m = /^([a-z]{3})-(\d{2})$/.exec(l.toLowerCase().trim()); return m && (2000 + +m[2]) === 2026 && [6, 7, 8].includes(MA.indexOf(m[1])); };
const nb = d.pipelineWow.newArrMom;
const q3idx = nb.months.map((m, i) => (isQ3(m) ? i : -1)).filter((i) => i >= 0);
const pipeGen = (name) => q3idx.reduce((s, i) => s + ((nb.reps[name] || [])[i] || 0), 0);
const PIPE_TARGET = { "James Burdick": 738000, "Dorsa Mahmoudnia": 750000, "Jed Rutstein": 960000, "Jill Bucci": 850000, "Mathias Berthelemot": 0, "David Dubinski": 0 };

// ---- per-rep scorecard rows (config-driven quotas via forecastTab) ----
const rows = d.forecastTab.rows;
const teamAEs = rows.filter((r) => !r.am && !r.lead);
const teamQuota = teamAEs.reduce((s, r) => s + (r.quota || 0), 0);
const teamActual = teamAEs.reduce((s, r) => s + (r.closedWon || 0), 0);
const teamPct = teamQuota ? Math.round((teamActual / teamQuota) * 100) : 0;

// Status box (trailing column so the monospace columns stay aligned): AEs judged on
// pipe-gen pace (early quarter → pipe leads); AM / Enterprise-lead get their own box.
const status = (r, p) => (r.lead ? ["⬜", "Ent"] : r.am ? ["🟦", "AM"] : p >= 0.5 ? ["🟩", "on track"] : p >= 0.2 ? ["🟨", "building"] : ["🟥", "behind"]);
// Order = AEs by pipe-gen % (leaderboard), then AM, then Enterprise lead.
const withPipe = rows.map((r) => ({ r, pg: pipeGen(r.name), pt: PIPE_TARGET[r.name] ?? 0 }));
const ordered = [
  ...withPipe.filter((x) => !x.r.am && !x.r.lead).sort((a, b) => (b.pt ? b.pg / b.pt : 0) - (a.pt ? a.pg / a.pt : 0)),
  ...withPipe.filter((x) => x.r.am),
  ...withPipe.filter((x) => x.r.lead),
];
const scoreRows = ordered.map(({ r, pg, pt }) => {
  const first = r.name.split(" ")[0];
  const hasQ = r.quota && r.quota > 0;
  const attPct = hasQ ? r.closedWon / r.quota : 0;
  const [box, lbl] = status(r, pt > 0 ? pg / pt : attPct);
  const att = hasQ ? `${(Math.round(attPct * 100) + "%").padStart(4)} ${M(r.closedWon)}/${M(r.quota)}` : `  —  ${M(r.closedWon)} won`;
  const pipe = pt > 0 ? `${(Math.round((pg / pt) * 100) + "%").padStart(4)} ${M(pg)}/${M(pt)}` : "  —";
  return `${pad(first, 8)} ${pad(att, 16)} ${pad(pipe, 16)} ${pad(M(r.potential), 6)}  ${box} ${lbl}`;
});
const header = `${pad("", 8)} ${pad("Attain", 16)} ${pad("Pipe Gen (Q3)", 16)} ${pad("Wtd", 6)}  Status`;
const scorecard = "```" + [header, ...scoreRows].join("\n") + "```";

// ---- forecasting / deal health ----
const wtd = d.forecast.weightedTotal, raw = d.forecast.rawTotal;
const win = d.winRateYtd?.winRate ? Math.round(d.winRateYtd.winRate * 100) + "%" : "—";
const dh = Object.fromEntries(d.dealHealth.map((b) => [b.label, b]));
const old1yr = dh["365+ days"], aging = dh["91–180 days"] || dh["91-180 days"];

const today = new Date(d.updatedAt);
const dLabel = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const arrText =
  `*💰 ARR*\n` +
  `🟢 *Live ARR* ${M(liveArr)}  —  +${M(lastComplete.newARR)} new · −${M(lastComplete.churnedARR)} churn (${moLabel(lastComplete.label)})\n` +
  `🟡 *Booked (not yet live)* ${M(booked.total)}  —  ${booked.count} deals awaiting go-live\n` +
  `🔴 *In renewal (this month)* ${M(renewal)}  —  confirm renewals before close\n` +
  `📈 *Team attainment* ${teamPct}%  —  QTD · ${teamAEs.length} AEs vs ${M(teamQuota)} quota`;

const fcastText =
  `*🔮 Forecasting / Deal health*\n` +
  `Weighted pipeline *${M(wtd)}*  (raw ${M(raw)} · ${win} win rate)\n` +
  `⚠️ ${old1yr ? `${old1yr.count} deals >1yr old (${M(old1yr.arr)})` : ""}${aging ? ` · ${aging.count} aging 91–180d (${M(aging.arr)})` : ""} — cull or close`;

const blocks = [
  { type: "header", text: { type: "plain_text", text: `📊 RevOps Pulse — ${dLabel} · Q3 FY26`, emoji: true } },
  { type: "section", text: { type: "mrkdwn", text: arrText } },
  { type: "divider" },
  { type: "section", text: { type: "mrkdwn", text: "*🎯 Rep Scorecard — Q3 QTD*\n" + scorecard } },
  { type: "context", elements: [{ type: "mrkdwn", text: "🟢 on track · 🟡 building · 🔴 behind · 🔵 AM · ⚪ Enterprise (not in team quota)" }] },
  { type: "divider" },
  { type: "section", text: { type: "mrkdwn", text: fcastText } },
  { type: "context", elements: [{ type: "mrkdwn", text: "auto-posted from the RevOps dashboard" }] },
];

if (DRY || !WEBHOOK) {
  console.log(DRY ? "DRY RUN — message preview:\n" : "SLACK_WEBHOOK_URL not set — preview only:\n");
  console.log(arrText + "\n\n" + scorecard + "\n\n" + fcastText);
  process.exit(0);
}
const res = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocks }) });
console.log("Slack post:", res.status, await res.text());
