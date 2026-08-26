// Daily audit suite — runs every dashboard auditor and posts ONE digest to Slack.
//
// Why this exists: all four auditors already worked, but their output landed in places
// nobody reads (a red GitHub run, a job summary). A silent auditor is not an auditor.
// This runs them in one job and posts the result where Tai actually is.
//
// Layers (see each script's header for its own scope):
//   1 check-sheet          — does every tab still exist with a sane header/values?
//   2 weekly-finance-audit — do the sheet's own numbers tie out to each other?
//   3 verify-numbers       — does the dashboard match an independent Salesforce recompute?
//   + audit-roster-drift   — has any script's private AE list drifted from AE_ROSTER?
//
// Posts daily even when green (a short line), so silence always means "the job didn't run"
// rather than "nothing to report" — the failure mode that hid Davi's missing row for weeks.
// Exit 1 if any auditor fails, so the GitHub run goes red too.
//
// Run: node --env-file=.env scripts/audit-suite.mjs [--dry]
import { spawnSync } from "child_process";
import { existsSync } from "fs";

const DRY = process.argv.includes("--dry");
// Locally the auditors are run as `node --env-file=.env script.mjs`. In CI there is no .env —
// the workflow supplies credentials as job-level env, matching refresh-arr.yml, so children
// just inherit them. Passing --env-file with no file present would abort every auditor.
const NODE_ARGS = existsSync(new URL("../.env", import.meta.url)) ? ["--env-file=.env"] : [];
const WEBHOOK = process.env.SLACK_WEBHOOK_URL;
const RUN_URL = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

const AUDITS = [
  { id: "structure",  label: "Sheet structure",        script: "check-sheet.mjs",             blurb: "tabs, headers, sane values" },
  { id: "tieouts",    label: "Reconciliation tie-outs", script: "weekly-finance-audit.mjs",    blurb: "the sheet's numbers agree with each other" },
  { id: "vs-sfdc",    label: "Numbers vs Salesforce",  script: "verify-numbers.mjs",          blurb: "independent SOQL recompute" },
  { id: "roster",     label: "Roster drift",           script: "audit-roster-drift.mjs",      blurb: "no AE silently dropped from a tab" },
];

const results = [];
for (const a of AUDITS) {
  const t0 = Date.now();
  const r = spawnSync("node", [...NODE_ARGS, `scripts/${a.script}`], { encoding: "utf-8", timeout: 300_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  results.push({ ...a, ok: r.status === 0, secs: Math.round((Date.now() - t0) / 1000), out });
  console.log(`${r.status === 0 ? "✓" : "✗"} ${a.label} (${Math.round((Date.now() - t0) / 1000)}s)`);
  if (r.status !== 0) console.log(out.split("\n").slice(0, 20).map((l) => "    " + l).join("\n"));
}

const failed = results.filter((r) => !r.ok);
const dLabel = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Singapore" });

// Pull the most useful lines out of a failing auditor for the Slack body. Each auditor
// marks problems with ✗/×/FAIL/MISSING, so surface those rather than the whole log.
const MARK = /^(❌|✗|×|!)|^(FAIL|MISSING|UNREADABLE)\b/i;
const salient = (out) => {
  const lines = out.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const picked = [];
  for (let i = 0; i < lines.length && picked.length < 5; i++) {
    if (!MARK.test(lines[i].trim())) continue;
    const head = lines[i].trim().replace(/^(❌|✗|×|!)\s*/, "");
    // Auditors print the headline on the marked line and the "why" on the indented line(s)
    // beneath it. Carry the first detail line so Slack shows the reason, not just the name.
    const detail = (lines[i + 1] && /^\s{2,}/.test(lines[i + 1]) && !MARK.test(lines[i + 1].trim()))
      ? lines[i + 1].trim() : "";
    picked.push(detail ? `• *${head}*\n   ${detail.length > 260 ? detail.slice(0, 260) + "…" : detail}` : `• ${head}`);
  }
  if (picked.length) return picked.join("\n");
  return lines.slice(-3).map((l) => `• ${l.trim()}`).join("\n");
};

const blocks = [
  { type: "header", text: { type: "plain_text", text: failed.length ? `🔴 Dashboard audit — ${failed.length} failing` : `🟢 Dashboard audit — all clear`, emoji: true } },
];
if (failed.length) {
  for (const f of failed) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${f.label}* — _${f.blurb}_\n${salient(f.out)}` } });
  }
  const passed = results.filter((r) => r.ok).map((r) => r.label).join(" · ");
  if (passed) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `✓ passing: ${passed}` }] });
} else {
  blocks.push({ type: "section", text: { type: "mrkdwn", text: results.map((r) => `✓ *${r.label}* — _${r.blurb}_`).join("\n") } });
}
blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `${dLabel} · ${results.reduce((s, r) => s + r.secs, 0)}s${RUN_URL ? ` · <${RUN_URL}|run log>` : ""} · auto-posted by the audit suite` }] });

if (!WEBHOOK || DRY) {
  console.log(DRY ? "\nDRY RUN — Slack preview:" : "\nSLACK_WEBHOOK_URL not set — preview only:");
  console.log(JSON.stringify({ blocks }, null, 1));
} else {
  const res = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocks }) });
  console.log(`\nSlack: ${res.status} ${res.ok ? "posted" : await res.text()}`);
}

process.exit(failed.length ? 1 : 0);
