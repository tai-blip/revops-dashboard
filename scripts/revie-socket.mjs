// Revie — instant RevOps Slack bot, Claude-Code-CLI edition (Kai's architecture).
//
// Slack Socket Mode (websocket push — instant, no public URL) → each question is answered
// by headless `claude -p` running ON THIS MACHINE under Tai's Claude subscription. No API key.
// Trade-off: Revie is only awake while this process runs.
//
// ── GUARDRAILS (per Kai: "guard/sandbox the claude cli") ─────────────────────
// Slack text is untrusted input being fed to a tool-capable agent, so the spawned CLI is
// locked down hard:
//   • --strict-mcp-config          → NEVER loads Tai's MCP connectors (Slack/Gmail/SFDC/Drive)
//   • --allowedTools               → ONLY Read + `node --env-file=.env scripts/revie-query.mjs …`
//                                    (revie-query.mjs is itself read-only: sheets readonly scope,
//                                    single-SELECT SOQL, DML rejected)
//   • --disallowedTools            → Write/Edit/WebFetch/WebSearch/Task/git + Read of .env files
//   • --setting-sources project    → ignores user-level settings/hooks
//   • default permission mode      → anything not allowlisted is auto-denied in -p mode
//   • --max-turns + hard kill      → bounded work per question
//   • spawn(argv[]) without shell  → message text can't shell-inject
//   • BUDGET: rolling 5h + 7d API-equivalent-cost caps (~10% of Tai's credit, tunable);
//     over budget → polite decline, no CLI spawn. Ledger: .revie/usage.jsonl
//
// Env (.env): SLACK_BOT_TOKEN (xoxb-…), SLACK_APP_TOKEN (xapp-…, connections:write)
// Optional: REVIE_BUDGET_5H_USD (default 2), REVIE_BUDGET_WEEK_USD (default 15),
//           REVIE_CHANNELS (extra channels where CHANGES are allowed), REVIE_MODEL, REVIE_ADMIN,
//           REVIE_CONFIRM_TTL_MIN (how long a proposed change stays confirmable; default 240 = 4h).
// One-time: `claude` → /login in a terminal (CLI auth is separate from the desktop app).
// Run: node --env-file=.env scripts/revie-socket.mjs
import { spawn } from "child_process";
import { applyPending, cancelPending, CONFIRM_WINDOW } from "./revie-write.mjs";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = process.env.REVIE_ADMIN || "U0B0N64DL30"; // Tai
// Questions are answered in ANY channel Revie is invited to. This list governs CHANGES only:
// proposals and confirmations work here (and in DMs) and nowhere else, so every Salesforce
// write lands in one auditable place.
const WRITE_CHANNELS = new Set(["C0BS48N4P4N", ...(process.env.REVIE_CHANNELS || "").split(",").filter(Boolean)]); // #ask-revops
const BUDGET_5H = Number(process.env.REVIE_BUDGET_5H_USD || 2);   // API-equivalent $ per rolling 5h
const BUDGET_WEEK = Number(process.env.REVIE_BUDGET_WEEK_USD || 15); // per rolling 7d  (~10% of credit — tune)
const LEDGER_DIR = path.join(REPO, ".revie");
const LEDGER = path.join(LEDGER_DIR, "usage.jsonl");
const QALOG = path.join(LEDGER_DIR, "qa.jsonl"); // every Q&A + explicit feedback, for the nightly review
const CLI_TIMEOUT_MS = 240_000;
const CLI_CHECK_MS = 30 * 60_000; // how often to confirm the CLI still starts
// Who may request and confirm a data change. Defaults to Tai alone; widen via REVIE_WRITERS.
const WRITERS = new Set([ADMIN, ...(process.env.REVIE_WRITERS || "").split(",").map((s) => s.trim()).filter(Boolean)]);

// Revie's brief lives in a file, not in this code, so Tai can change how Revie behaves without
// touching JavaScript: edit scripts/revie-prompt.md, save, ask again. It is re-read whenever it
// changes, so a save takes effect on the very next question — no restart and no deploy. If the file
// is ever unreadable or empty, the last version that worked keeps being used; Revie never falls back
// to answering with no instructions at all.
const PROMPT_FILE = path.join(REPO, "scripts", "revie-prompt.md");
let brief = { mtime: 0, text: "" };
function loadSystem() {
  try {
    const { mtimeMs } = statSync(PROMPT_FILE);
    if (mtimeMs !== brief.mtime) {
      const text = readFileSync(PROMPT_FILE, "utf-8")
        .replace(/<!--[\s\S]*?-->/g, "")     // notes for whoever edits the file, not for Revie
        .replace(/\{\{ADMIN\}\}/g, ADMIN)
        .replace(/\{\{CONFIRM_WINDOW\}\}/g, CONFIRM_WINDOW)
        .trim();
      if (!text) throw new Error("the prompt file is empty");
      brief = { mtime: mtimeMs, text };
      console.log(`[revie] brief loaded — ${text.length} chars from ${path.relative(REPO, PROMPT_FILE)}`);
    }
  } catch (e) {
    console.error(`[revie] could not read the brief (${e.message})` +
      (brief.text ? " — still using the last one that worked." : " — and there is no earlier one."));
  }
  return brief.text;
}

// ── budget ledger ─────────────────────────────────────────────────────────────
function spent(sinceMs) {
  if (!existsSync(LEDGER)) return 0;
  const now = Date.now();
  return readFileSync(LEDGER, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && now - e.t < sinceMs)
    .reduce((s, e) => s + (e.c || 0), 0);
}
// One line per exchange. This is the raw material for improving the prompt — without it there is
// no record of what people actually ask or where Revie got it wrong.
function recordQA(entry) {
  try {
    mkdirSync(LEDGER_DIR, { recursive: true });
    appendFileSync(QALOG, JSON.stringify({ t: Date.now(), ...entry }) + "\n");
  } catch (e) {
    console.error("[revie] qa log failed:", e.message || e);
  }
}

function recordSpend(cost) {
  mkdirSync(LEDGER_DIR, { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ t: Date.now(), c: cost }) + "\n");
}
function overBudget() {
  const h5 = spent(5 * 3600e3), w = spent(7 * 86400e3);
  if (h5 >= BUDGET_5H) return `5-hour window (cap $${BUDGET_5H})`;
  if (w >= BUDGET_WEEK) return `weekly window (cap $${BUDGET_WEEK})`;
  return null;
}

// ── Slack Web API ─────────────────────────────────────────────────────────────
async function slack(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body),
  });
  return r.json();
}
// Read methods (conversations.replies/history) reject a JSON body with invalid_arguments —
// they must be called with query params. Posting methods are fine with JSON.
async function slackGet(method, params) {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  return r.json();
}
const post = (channel, text, thread_ts) => slack("chat.postMessage", { channel, text, ...(thread_ts ? { thread_ts } : {}), unfurl_links: false });
const react = (channel, timestamp, name) => slack("reactions.add", { channel, timestamp, name }).catch(() => {});

// ── the guarded CLI call ──────────────────────────────────────────────────────
function askClaude(question, threadContext, userId, canWrite) {
  const system = loadSystem();
  if (!system) return Promise.resolve({ text: "", cost: 0, isError: true,
    raw: "my brief (scripts/revie-prompt.md) is missing or empty — I won't answer without it." });
  const who = `The person asking is <@${userId}> (Slack id ${userId}). They are ${WRITERS.has(userId) ? "" : "NOT "}an authorised writer.` +
    (canWrite ? "" : " You have no write tool in this channel. Do not mention that unless they actually ask you to change something — an unrequested disclaimer is noise. If they do ask, say changes are only possible in #ask-revops or a DM with you, and answer any read-only part of their question normally.");
  const prompt = threadContext
    ? `${who}\n\nThread context (earlier messages, for reference):\n${threadContext}\n\nAnswer this question:\n${question}`
    : `${who}\n\nAnswer this question:\n${question}`;
  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--max-turns", "12",
    "--strict-mcp-config",
    "--setting-sources", "project",
    "--append-system-prompt", system,
    "--allowedTools", "Read", "Bash(node --env-file=.env scripts/revie-query.mjs*)",
    ...(canWrite ? ["Bash(node --env-file=.env scripts/revie-write.mjs plan*)"] : []),
    "--disallowedTools", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "TodoWrite",
    "Bash(git*)", "Read(./.env)", "Read(.env*)", "Read(**/.env*)",
  ];
  if (process.env.REVIE_MODEL) args.push("--model", process.env.REVIE_MODEL);
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const killer = setTimeout(() => child.kill("SIGKILL"), CLI_TIMEOUT_MS);
    const finish = (r) => { if (done) return; done = true; clearTimeout(killer); resolve(r); };
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    // spawn() itself can fail — a broken CLI install, a bad PATH, a binary that isn't executable.
    // Node emits 'error' on the child, and with no listener that is an *unhandled* error event:
    // it takes the whole bot down. That is how a bad `npm -g` update turned into total silence in
    // Slack instead of one failed answer. Fail the question, stay listening.
    child.on("error", (e) => {
      console.error(`[revie] could not start the claude CLI: ${e.code || ""} ${e.message}`);
      finish({ text: "", cost: 0, isError: true,
               raw: `could not start the claude CLI (${e.code || e.message}) — my own tooling is broken, not your question.` });
    });
    child.on("close", () => {
      try {
        const j = JSON.parse(out);
        // An empty answer with is_error false is a real failure mode (max turns, refusal) and used
        // to reach the log as "error: unknown". Record what the run actually did.
        const why = j.is_error ? String(j.result || j.error || "").slice(0, 300)
                  : (j.result ? undefined : `no text returned (subtype=${j.subtype || "?"}, turns=${j.num_turns ?? "?"}, stop=${j.stop_reason || "?"})`);
        finish({ text: j.result || "", cost: j.total_cost_usd || 0, isError: !!j.is_error,
                 raw: why, stderr: err.slice(-500) });
      } catch {
        finish({ text: "", cost: 0, isError: true, raw: (err || out).slice(0, 300) });
      }
    });
  });
}

async function threadContext(channel, ts) {
  try {
    const r = await slackGet("conversations.replies", { channel, ts, limit: 12 });
    if (!r.ok) { console.error(`[revie] thread context unavailable: ${r.error}`); return ""; }
    return (r.messages || []).slice(-8).map((m) => `${m.bot_id ? "bot" : m.user || "user"}: ${(m.text || "").slice(0, 500)}`).join("\n");
  } catch (e) {
    console.error("[revie] thread context failed:", e.message || e);
    return "";
  }
}

// ── the write path ───────────────────────────────────────────────────────────
// applyPending/cancelPending are imported functions, not shell commands — there is no
// command line that reaches them. Execution happens here and only here, after an
// authorised human replies "@Revie confirm <code>" in Slack.
async function confirmWrite(ev, action, nonce, isDm, threadTs, canWrite) {
  const reply = (t) => post(ev.channel, t, isDm ? undefined : threadTs);
  if (!canWrite) {
    await reply(`:no_entry: Changes can only be confirmed in <#C0BS48N4P4N> or a DM with me.`);
    return;
  }
  if (!WRITERS.has(ev.user)) {
    await reply(`:no_entry: Only authorised writers can ${action} a change — ask <@${ADMIN}>.`);
    return;
  }
  await react(ev.channel, ev.ts, "hourglass_flowing_sand");
  let j;
  try {
    j = action === "confirm" ? await applyPending(nonce, ev.user) : cancelPending(nonce, ev.user);
  } catch (err) {
    await reply(`:warning: ${err.message || err}`);
    console.error(`[revie] ${action} ${nonce} by ${ev.user} FAILED: ${err.message || err}`);
    return;
  }
  if (action === "cancel") {
    await reply(`:wastebasket: Cancelled — *${j.name ?? nonce}* is unchanged.`);
  } else {
    const field = Object.keys(j.after ?? {})[0];
    await reply(`:white_check_mark: Done — *${j.name}*: ${field} is now *${j.after?.[field]}* (was ${j.before?.[field] ?? "—"}).\n_Audited to .revie/writes.jsonl · confirmed by <@${ev.user}>._`);
  }
  await react(ev.channel, ev.ts, "white_check_mark");
  console.log(`[revie] ${action} ${nonce} by ${ev.user} → ok`);
}

// ── event handling (serialized — one answer at a time) ───────────────────────
const seen = new Set();
let queue = Promise.resolve();

function handleEvent(ev) {
  const isMention = ev.type === "app_mention";
  const isDm = ev.type === "message" && ev.channel_type === "im" && !ev.subtype;
  if ((!isMention && !isDm) || ev.bot_id || !ev.text) return;
  const question = ev.text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!question) return;
  const threadTs = ev.thread_ts ?? ev.ts;
  const canWrite = isDm || WRITE_CHANNELS.has(ev.channel); // changes are confined to #ask-revops + DMs

  // "wrong — Live ARR should exclude X" — records a correction against the thread. Runner-handled,
  // no CLI spawn, so it is free and always works even when budget-capped.
  const fb = question.match(/^(wrong|feedback|correction)\b[:,\s-]*(.*)$/is);
  if (fb) {
    queue = queue.then(async () => {
      recordQA({ kind: "feedback", user: ev.user, channel: ev.channel, thread: threadTs,
                 note: (fb[2] || "").trim() || "(no detail given)" });
      await react(ev.channel, ev.ts, "pencil");
      await post(ev.channel, `:pencil: Noted — logged against this thread for the nightly review. Thanks.`,
                 isDm ? undefined : threadTs);
      console.log(`[revie] feedback from ${ev.user} in ${ev.channel}`);
    }).catch((e) => console.error("[revie] feedback error:", e));
    return;
  }

  // "confirm A1B2C3" / "cancel A1B2C3" — handled by the runner, never by the CLI.
  const conf = question.match(/^(confirm|cancel)\s+([0-9a-fA-F]{6})$/);
  if (conf) {
    queue = queue.then(() => confirmWrite(ev, conf[1].toLowerCase(), conf[2].toUpperCase(), isDm, threadTs, canWrite))
                 .catch((e) => console.error("[revie] confirm error:", e));
    return;
  }

  queue = queue.then(async () => {
    const over = overBudget();
    if (over) {
      await react(ev.channel, ev.ts, "hourglass_flowing_sand");
      await post(ev.channel, `:hourglass_flowing_sand: I've used up my ${over} answer budget — I'm capped at ~10% of <@${ADMIN}>'s Claude credit. Try again later, or ask <@${ADMIN}> directly.`, isDm ? undefined : threadTs);
      return;
    }
    await react(ev.channel, ev.ts, "eyes");
    const ctx = ev.thread_ts ? await threadContext(ev.channel, ev.thread_ts) : "";
    const a = await askClaude(question, ctx, ev.user, canWrite);
    if (a.cost) recordSpend(a.cost);
    if (a.isError || !a.text) {
      recordQA({ kind: "failure", user: ev.user, channel: ev.channel, thread: threadTs,
                 question, raw: a.raw || null, stderr: a.stderr || null });
      console.error(`[revie] CLI failed for ${ev.user} in ${ev.channel}: isError=${a.isError} text=${a.text ? a.text.length + "ch" : "empty"} raw=${a.raw || "-"}${a.stderr ? " | stderr: " + a.stderr : ""}`);
      await post(ev.channel, `:warning: I couldn't answer that one${a.raw ? ` (\`${a.raw}\`)` : ""}. Try rephrasing, or ask <@${ADMIN}>.`, isDm ? undefined : threadTs);
      return;
    }
    await post(ev.channel, a.text, isDm ? undefined : threadTs);
    recordQA({ kind: "qa", user: ev.user, channel: ev.channel, thread: threadTs,
               question, answer: a.text, cost: a.cost, hadThreadContext: !!ctx });
    await react(ev.channel, ev.ts, "white_check_mark");
    console.log(`[revie] answered in ${ev.channel} · $${a.cost.toFixed(4)} · 5h $${spent(5 * 3600e3).toFixed(2)}/${BUDGET_5H} · wk $${spent(7 * 86400e3).toFixed(2)}/${BUDGET_WEEK}`);
  }).catch((e) => console.error("[revie] handler error:", e));
}

// ── Socket Mode loop ──────────────────────────────────────────────────────────
async function connect() {
  const open = await fetch("https://slack.com/api/apps.connections.open", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_APP_TOKEN}` },
  }).then((r) => r.json());
  if (!open.ok) throw new Error("apps.connections.open failed: " + JSON.stringify(open));

  const ws = new WebSocket(open.url);
  ws.onopen = () => console.log("[revie] socket connected — listening (#ask-revops + DMs)");
  ws.onmessage = (m) => {
    let env;
    try { env = JSON.parse(String(m.data)); } catch { return; }
    if (process.env.REVIE_DEBUG) console.log("[revie:debug] envelope type=" + env.type + " event=" + (env.payload?.event?.type || "-") + " channel=" + (env.payload?.event?.channel || "-"));
    if (env.envelope_id) ws.send(JSON.stringify({ envelope_id: env.envelope_id })); // ack instantly
    if (env.type === "disconnect") { ws.close(); return; }
    if (env.type !== "events_api") return;
    const eventId = env.payload?.event_id;
    if (eventId) {
      if (seen.has(eventId)) return;
      seen.add(eventId);
      if (seen.size > 1000) seen.clear();
    }
    if (env.payload?.event) handleEvent(env.payload.event);
  };
  await new Promise((res) => { ws.onclose = res; ws.onerror = res; });
}

// Revie's whole ability to answer rests on a CLI it does not own and does not version-pin:
// `claude` updates itself out from under this process. Check it can actually start, at boot, so a
// broken install shows up as a loud line in the log instead of a bot that just stops replying.
function preflightCLI() {
  return new Promise((resolve) => {
    const c = spawn("claude", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); resolve(null); }, 20_000);
    c.stdout?.on("data", (d) => (out += d));
    c.on("error", (e) => { clearTimeout(t); resolve({ err: `${e.code || ""} ${e.message}`.trim() }); });
    c.on("close", (code) => { clearTimeout(t); resolve(code === 0 ? { version: out.trim() } : { err: `exited ${code}` }); });
  });
}

// Run a command to completion and hand back its exit code and output. Never rejects — a spawn
// that cannot start is a result here, not an exception, which is the whole lesson of this file.
function runCmd(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => { c.kill("SIGKILL"); finish({ code: null, out, err: err + " (timed out)" }); }, timeoutMs);
    c.stdout?.on("data", (d) => (out += d));
    c.stderr?.on("data", (d) => (err += d));
    c.on("error", (e) => finish({ code: null, out, err: String(e.message || e) }));
    c.on("close", (code) => finish({ code, out, err }));
  });
}

// The repair Revie could not do for itself on 2026-08-26.
//
// That morning an auto-update failed halfway and left a half-renamed npm staging directory behind.
// Every retry the CLI's own updater made — 08:37, 09:07 — then died on that same debris with
// ENOTEMPTY, so it could never heal. Revie was silent for five hours over four mechanical steps.
// These are the four steps.
async function repairCLI() {
  const steps = [];

  // 1. Clear the debris that makes every reinstall fail. Scoped hard: only entries named
  //    `.claude-code-*` (npm's own scratch naming) inside the global @anthropic-ai directory.
  //    Moved to the OS temp dir rather than deleted — this is npm's scratch, not Revie's, and
  //    Revie should not be in the business of destroying anything it did not create.
  const root = (await runCmd("npm", ["root", "-g"], 30_000)).out.trim();
  if (root) {
    const scope = path.join(root, "@anthropic-ai");
    let debris = [];
    try { debris = readdirSync(scope).filter((n) => n.startsWith(".claude-code-")); } catch { /* nothing to clear */ }
    for (const name of debris) {
      const to = path.join(os.tmpdir(), `revie-npm-debris-${name}-${Date.now()}`);
      try { renameSync(path.join(scope, name), to); steps.push(`cleared leftover \`${name}\``); }
      catch (e) { steps.push(`could NOT clear \`${name}\` (${e.code || e.message})`); }
    }
  } else {
    steps.push("could not locate the global npm root");
  }

  // 2. Reinstall.
  const npm = await runCmd("npm", ["i", "-g", "@anthropic-ai/claude-code"], 600_000);
  steps.push(npm.code === 0 ? "reinstalled the CLI"
                            : `npm install failed (exit ${npm.code}): ${(npm.err || "").trim().slice(-200)}`);

  // 3. Verify by actually starting it — an exit code from npm is not proof the binary runs.
  const after = await preflightCLI();
  return { ok: !!after?.version, version: after?.version, err: after?.err, steps };
}

const dm = (text) => post(ADMIN, text).catch((e) => console.error("[revie] could not DM admin:", e.message || e));

// Health state. Revie only speaks up on a CHANGE — broken, or recovered — so a long healthy run is
// silent and a genuine break is not buried under repetition.
let cliHealthy = true;
let lastRepairAt = 0;
const REPAIR_COOLDOWN_MS = 60 * 60_000; // at most one reinstall an hour, however often we check

async function ensureCLI(reason) {
  const c = await preflightCLI();
  if (c?.version) {
    if (!cliHealthy) {
      cliHealthy = true;
      console.log(`[revie] claude CLI recovered — ${c.version}`);
      await dm(`:white_check_mark: My CLI is working again — ${c.version}. Back to answering.`);
    }
    return true;
  }

  const why = c?.err || "timed out";
  console.error(`[revie] claude CLI unusable (${reason}): ${why}`);
  const firstNotice = cliHealthy;
  cliHealthy = false;

  const since = Date.now() - lastRepairAt;
  if (since < REPAIR_COOLDOWN_MS) {
    console.error(`[revie] not retrying the repair yet (${Math.round((REPAIR_COOLDOWN_MS - since) / 60000)} min of cooldown left)`);
    return false;
  }
  lastRepairAt = Date.now();

  if (firstNotice) await dm(`:wrench: My \`claude\` CLI stopped working (\`${why}\`) — I can't answer anything until it's back. Trying to repair it myself now.`);
  console.log("[revie] attempting CLI self-repair…");
  const r = await repairCLI();
  const detail = r.steps.map((x) => `• ${x}`).join("\n");

  if (r.ok) {
    cliHealthy = true;
    console.log(`[revie] self-repair succeeded — ${r.version}`);
    await dm(`:white_check_mark: Fixed it myself — ${r.version}. Answering again.\n${detail}`);
  } else {
    console.error(`[revie] self-repair FAILED: ${r.err || "still not runnable"}`);
    await dm(`:rotating_light: I could not repair my own CLI, so I'm down until someone looks.\n${detail}\n` +
             `Last error: \`${r.err || "still not runnable"}\`\nOn the Mac: \`npm i -g @anthropic-ai/claude-code\``);
  }
  return r.ok;
}

async function main() {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
    console.error("Missing SLACK_BOT_TOKEN / SLACK_APP_TOKEN in .env — see docs/slack-bot-setup.md");
    process.exit(1);
  }
  if (!loadSystem()) {
    console.error(`Missing or empty ${PROMPT_FILE} — that file is Revie's brief and there is nothing to answer with.`);
    process.exit(1);
  }
  const cli = await preflightCLI();
  if (cli?.version) console.log(`[revie] claude CLI ok — ${cli.version}`);
  else await ensureCLI("startup");

  // Keep checking. The 2026-08-26 break happened at 05:19 with Revie already up and nobody
  // restarting it, so a startup-only check would have caught it five hours late. Queued behind
  // whatever Revie is doing, so a repair can never yank the CLI out from under a live question.
  setInterval(() => {
    queue = queue.then(() => ensureCLI("periodic")).catch((e) => console.error("[revie] health check error:", e));
  }, CLI_CHECK_MS);

  console.log(`[revie] budget: $${BUDGET_5H}/5h · $${BUDGET_WEEK}/week (API-equivalent). Ledger: ${LEDGER}`);
  for (;;) {
    try { await connect(); } catch (e) { console.error("[revie] socket error:", e.message || e); }
    console.log("[revie] reconnecting in 3s…");
    await new Promise((r) => setTimeout(r, 3000));
  }
}
main();
