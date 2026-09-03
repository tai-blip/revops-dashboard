// Revie's ONLY change path — it files a request with Deal Desk and stops there.
//
// Revie does not write to Salesforce any more. It never did so directly, and now it does not
// even hold the approval: a request filed here lands in Deal Desk's queue, pings an approver in
// Slack with Approve / Reject buttons, and only that human's click writes anything. Revie's job
// ends at "filed as request #N".
//
// WHO IS ASKING IS NOT THE MODEL'S TO SAY. requesterEmail comes from REVIE_REQUESTER_EMAIL in the
// environment, injected by revie-socket.mjs from the Slack user who actually sent the message.
// It is deliberately NOT an argument: the model composes this command from untrusted Slack text,
// so if it could name the requester, a prompt injection could file changes as somebody else.
// Deal Desk enforces ownership against that email — a rep's email only reaches that rep's deals.
//
// Usage (the only shape the bot is allowed to run):
//   node --env-file=.env scripts/revie-file.mjs \
//     --opp 006... --set AE_AM_Probability__c=10 --set CloseDate=2026-09-30 --reason "..."
//
// Env: DEAL_DESK_BASE_URL (https://deal-desk-six.vercel.app in prod), REVIE_API_TOKEN.
// Injected per question by the runner: REVIE_REQUESTER_EMAIL, REVIE_THREAD_URL (optional).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, ".revie");
const FILED = path.join(DIR, "filed.jsonl");
const DEDUPE_MS = 60 * 60_000; // the same ask, twice in an hour, is the same ask
const TIMEOUT_MS = 15_000;     // Deal Desk does a live Salesforce read before queueing

// The six writable fields. Anything else is dropped silently by Deal Desk, so reject it here
// instead — a silent drop reaches the rep as "filed!" for a change that will never happen.
const FIELDS = {
  StageName:                  { kind: "picklist", check: (v) => v.trim() ? "" : "a stage name is required." },
  CloseDate:                  { kind: "date",     check: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0, 4) >= 2015 && +v.slice(0, 4) <= 2040 ? "" : "must be YYYY-MM-DD between 2015 and 2040." },
  AnnualContractValueARR__c:  { kind: "currency", check: (v) => v === "" || Number.isFinite(Number(v)) ? "" : "must be a number (or empty to clear)." },
  Amount:                     { kind: "currency", check: (v) => v === "" || Number.isFinite(Number(v)) ? "" : "must be a number (or empty to clear)." },
  AE_AM_Probability__c:       { kind: "percent",  check: (v) => /^\d{1,3}$/.test(v) && +v >= 0 && +v <= 100 ? "" : "must be a whole number 0-100." },
  AE_AM_Probability_Year__c:  { kind: "percent",  check: (v) => Number.isFinite(Number(v)) && +v >= 0 && +v <= 100 ? "" : "must be a number 0-100 (2 decimal places)." },
};

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const all = (n) => argv.reduce((acc, a, i) => (a === `--${n}` && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
// Everything this prints is read by the model and relayed to a rep in Slack, so failures are
// JSON too — never a stack trace, never the token.
const out = (o) => { console.log(JSON.stringify(o)); process.exit(o.ok === false ? 1 : 0); };
const die = (msg, extra = {}) => out({ ok: false, error: msg, ...extra });

// ── who is asking (env, not argv) ────────────────────────────────────────────
const requesterEmail = (process.env.REVIE_REQUESTER_EMAIL || "").trim().toLowerCase();
if (!requesterEmail.includes("@")) {
  die("I can't tell Slack who you are, so I can't file this. Ask Tai to check my `users:read.email` scope.");
}

// ── config ───────────────────────────────────────────────────────────────────
const BASE = (process.env.DEAL_DESK_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.REVIE_API_TOKEN || "";
if (!BASE || !TOKEN) {
  die("Deal Desk isn't wired up on my side yet (missing DEAL_DESK_BASE_URL / REVIE_API_TOKEN). Ask Tai.");
}

// ── the ask ──────────────────────────────────────────────────────────────────
const oppId = (flag("opp") || "").trim();
if (!/^[a-zA-Z0-9]{15,18}$/.test(oppId)) die("--opp must be a Salesforce Opportunity Id (15 or 18 chars).");

const reason = (flag("reason") || "").trim();
if (reason.length < 3) die("--reason is required — the approver reads it. Say what the rep asked for and why.");

const edits = {};
for (const pair of all("set")) {
  const i = pair.indexOf("=");
  if (i < 1) die(`--set must look like Field=Value (got "${pair}").`);
  const field = pair.slice(0, i).trim();
  const value = pair.slice(i + 1).trim();
  if (!FIELDS[field]) {
    die(`"${field}" is not a field I can change. The six are: ${Object.keys(FIELDS).join(", ")}.`);
  }
  const bad = FIELDS[field].check(value);
  if (bad) die(`${field} ${bad}`);
  edits[field] = value;
}
if (!Object.keys(edits).length) die("nothing to change — pass at least one --set Field=Value.");

// ── don't file the same ask twice ────────────────────────────────────────────
// Deal Desk does not dedupe: asking twice files twice and pings the approver twice. The model has
// no memory between questions, so the memory lives here.
const fingerprint = JSON.stringify({ oppId, edits, requesterEmail });
function recentlyFiled() {
  if (!existsSync(FILED)) return null;
  const now = Date.now();
  for (const line of readFileSync(FILED, "utf-8").split("\n").filter(Boolean).reverse()) {
    try {
      const e = JSON.parse(line);
      if (e.fingerprint === fingerprint && now - e.t < DEDUPE_MS) return e;
    } catch { /* skip a bad line */ }
  }
  return null;
}
const already = recentlyFiled();
if (already) {
  out({ ok: true, duplicate: true, status: "pending", requestId: already.requestId,
        message: `Already filed as request #${already.requestId} — still waiting on an approver. I haven't filed it again.` });
}

// ── file it ──────────────────────────────────────────────────────────────────
const threadUrl = (process.env.REVIE_THREAD_URL || "").trim();
const body = {
  requesterEmail,
  oppId,
  edits,
  reason: threadUrl ? `${reason} — asked in Slack: ${threadUrl}` : reason,
};

let res, json;
try {
  res = await fetch(`${BASE}/api/revie/requests`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  json = await res.json().catch(() => ({}));
} catch (e) {
  die(e?.name === "TimeoutError"
    ? "Deal Desk didn't answer in time. Nothing was filed — try again in a minute."
    : `I couldn't reach Deal Desk (${String(e?.message || e).slice(0, 120)}). Nothing was filed.`);
}

if (res.status === 200 && json.ok) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(FILED, JSON.stringify({
    t: Date.now(), fingerprint, requestId: json.requestId, oppId, edits, requesterEmail,
  }) + "\n");
  out({ ok: true, status: json.status ?? "pending", requestId: json.requestId, message: json.message });
}

// Deal Desk's refusals are written for the rep — relay them as they are, don't paraphrase.
const err = typeof json.error === "string" ? json.error : "";
if (res.status === 422) out({ ok: false, refused: true, error: err || "Deal Desk refused the change." });
if (res.status === 403) out({ ok: false, error: err || `No active Salesforce user matches ${requesterEmail}.` });
if (res.status === 400) out({ ok: false, error: err || "Deal Desk rejected the request as malformed." });
if (res.status === 401 || res.status === 503) {
  out({ ok: false, opsProblem: true,
        error: "Deal Desk turned me away — my token is wrong or not configured. This is a setup problem, not your request." });
}
out({ ok: false, error: `Deal Desk returned ${res.status}${err ? `: ${err}` : ""}. Nothing was filed.` });
