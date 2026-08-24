// Revie's ONLY write path — the mirror of revie-query.mjs (the read path). Every mutation
// flows through the guards in this file.
//
// TWO-PHASE BY DESIGN — the headless CLI can NEVER execute a write:
//   plan   → validates, records a pending proposal, prints a nonce. Mutates nothing.
//   apply  → an exported FUNCTION, called in-process by revie-socket.mjs after an authorised
//            human confirms in Slack. It is deliberately not a command-line verb, so no shell
//            command can reach it however it is composed.
// So the worst a prompt injection in Slack text can achieve is a *proposal* a human must approve.
//
// Usage:
//   node --env-file=.env scripts/revie-write.mjs plan <op> <OppId> "<value>" --requester <U…>
//   node --env-file=.env scripts/revie-write.mjs show --nonce <N>
//
// Ops (allowlist — parameterised; no free-form DML is ever accepted):
//   rescue     <OppId> <StageName>  reopen a stale Closed Lost opp to its correct stage
//   stage      <OppId> <StageName>  move an opp to another stage
//   close-lost <OppId> <reason>     close an opp as lost, with a reason
//
// Guards: Opportunity only · fields limited to StageName + ClosedLostDetails__c ·
// stage validated against the live picklist · revenue-affecting stages refused ·
// exactly one record per call (no bulk) · nonce single-use with a 15-min TTL ·
// every apply verified by re-query and audited to .revie/writes.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, ".revie");
const PENDING = path.join(DIR, "pending.json");
const AUDIT = path.join(DIR, "writes.jsonl");
const TTL_MS = 15 * 60_000;

const OPS = {
  rescue:       { field: "StageName",            verb: "reopen to stage" },
  stage:        { field: "StageName",            verb: "move to stage" },
  "close-lost": { field: "ClosedLostDetails__c", verb: "close as lost, reason" },
};
const FIELD_ALLOWLIST = new Set(["StageName", "ClosedLostDetails__c"]);
// Moving a deal into a won stage changes reported ARR. Refused on this path — do it in SFDC.
const FORBIDDEN_STAGES = [/closed\s*won/i, /won/i];

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) { i++; continue; }
  pos.push(argv[i]);
}
const die = (m) => { console.error("REJECTED: " + m); process.exit(1); };

// ── salesforce ────────────────────────────────────────────────────────────────
async function sf() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });
  const t = await (await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  })).json();
  if (!t.access_token) throw new Error("SF auth failed");
  const v = process.env.SF_API_VERSION || "59.0";
  const H = { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json" };
  const base = `${t.instance_url}/services/data/v${v}`;
  return {
    H, base,
    query: async (q) => {
      const j = await (await fetch(`${base}/query?q=${encodeURIComponent(q)}`, { headers: H })).json();
      if (!j.records) throw new Error("SOQL error: " + JSON.stringify(j).slice(0, 300));
      return j.records;
    },
    stages: async () => {
      const d = await (await fetch(`${base}/sobjects/Opportunity/describe`, { headers: H })).json();
      const f = (d.fields || []).find((x) => x.name === "StageName");
      return (f?.picklistValues || []).filter((p) => p.active).map((p) => p.label);
    },
    patch: async (id, body) => {
      const r = await fetch(`${base}/sobjects/Opportunity/${id}`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
      if (r.status !== 204) throw new Error(`PATCH failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
    },
  };
}

// ── pending store ─────────────────────────────────────────────────────────────
const loadPending = () => { try { return JSON.parse(readFileSync(PENDING, "utf-8")); } catch { return {}; } };
function savePending(p) {
  mkdirSync(DIR, { recursive: true });
  const now = Date.now();
  for (const [k, v] of Object.entries(p)) if (now - v.t > TTL_MS) delete p[k]; // expire on write
  writeFileSync(PENDING, JSON.stringify(p, null, 2));
}

// ── plan ──────────────────────────────────────────────────────────────────────
async function plan() {
  const [, op, oppId, ...rest] = pos;
  const value = rest.join(" ").trim();
  const requester = flag("requester") || "";

  if (!OPS[op]) die(`unknown op "${op}". Allowed: ${Object.keys(OPS).join(", ")}`);
  if (!/^006[A-Za-z0-9]{12,15}$/.test(oppId || "")) die("first argument must be a single Opportunity Id (006…).");
  if (!value) die("a value is required (stage name, or close-lost reason).");
  if (value.length > 120 || /[\r\n]/.test(value)) die("value must be a single line under 120 chars.");
  if (!/^U[A-Z0-9]{6,}$/.test(requester)) die("--requester must be a Slack user id.");

  const field = OPS[op].field;
  if (!FIELD_ALLOWLIST.has(field)) die(`field ${field} is not writable.`);

  const api = await sf();
  const [rec] = await api.query(
    `SELECT Id, Name, Account.Name, Owner.Name, StageName, Amount, ClosedLostDetails__c FROM Opportunity WHERE Id='${oppId}'`
  );
  if (!rec) die(`no Opportunity ${oppId}.`);

  if (field === "StageName") {
    if (FORBIDDEN_STAGES.some((re) => re.test(value)))
      die(`"${value}" is revenue-affecting and cannot be set from Slack — change it in Salesforce.`);
    const stages = await api.stages();
    if (!stages.includes(value)) die(`"${value}" is not an active stage. Valid: ${stages.join(", ")}`);
  }

  const patch = { [field]: value };
  if (op === "rescue") patch.ClosedLostDetails__c = null; // reopening clears the loss reason
  if (op === "close-lost") patch.StageName = "Closed Lost";

  const before = { StageName: rec.StageName, ClosedLostDetails__c: rec.ClosedLostDetails__c ?? null };
  const nonce = randomBytes(3).toString("hex").toUpperCase();
  const p = loadPending();
  p[nonce] = { t: Date.now(), op, oppId, patch, before, requester,
               name: rec.Name, account: rec.Account?.Name ?? "?", owner: rec.Owner?.Name ?? "?",
               amount: rec.Amount ?? 0 };
  savePending(p);

  console.log(JSON.stringify({
    nonce,
    summary: `${rec.Name} (${rec.Account?.Name ?? "?"}, owner ${rec.Owner?.Name ?? "?"}) — ` +
             `${OPS[op].verb} "${value}". Currently ${rec.StageName}.`,
    expires_in_minutes: TTL_MS / 60000,
  }));
}

// ── apply / cancel — NOT command-line verbs ──────────────────────────────────
// These are exported functions, imported directly by revie-socket.mjs. There is no CLI
// path to them at all, so no shell command — however it is composed — can execute a write.
// Only `plan` is reachable from the command line, and it only ever records a proposal.
export async function applyPending(nonce, confirmer) {
  nonce = String(nonce || "").toUpperCase();
  if (!/^U[A-Z0-9]{6,}$/.test(confirmer || "")) throw new Error("confirmer must be a Slack user id.");
  const p = loadPending();
  const e = p[nonce];
  if (!e) throw new Error("unknown or already-used confirmation code.");
  if (Date.now() - e.t > TTL_MS) { delete p[nonce]; savePending(p); throw new Error("that confirmation expired — ask again."); }

  delete p[nonce]; savePending(p); // single-use: burn before attempting

  const api = await sf();
  await api.patch(e.oppId, e.patch);
  const [after] = await api.query(`SELECT StageName, ClosedLostDetails__c FROM Opportunity WHERE Id='${e.oppId}'`);
  const field = Object.keys(e.patch)[0];
  const landed = String(after?.[field] ?? "") === String(e.patch[field] ?? "");

  mkdirSync(DIR, { recursive: true });
  appendFileSync(AUDIT, JSON.stringify({
    t: Date.now(), op: e.op, oppId: e.oppId, name: e.name, requester: e.requester, confirmer,
    before: e.before, patch: e.patch,
    after: { StageName: after?.StageName ?? null, ClosedLostDetails__c: after?.ClosedLostDetails__c ?? null },
    verified: landed,
  }) + "\n");

  if (!landed) throw new Error(`write did not verify — ${field} is "${after?.[field]}", expected "${e.patch[field]}".`);
  return { ok: true, oppId: e.oppId, name: e.name, before: e.before, after: e.patch };
}

export function cancelPending(nonce, confirmer) {
  nonce = String(nonce || "").toUpperCase();
  const p = loadPending();
  const e = p[nonce];
  if (!e) throw new Error("unknown or already-used confirmation code.");
  delete p[nonce]; savePending(p);
  mkdirSync(DIR, { recursive: true });
  appendFileSync(AUDIT, JSON.stringify({ t: Date.now(), op: e.op, oppId: e.oppId, name: e.name,
    requester: e.requester, cancelled_by: confirmer || "", patch: e.patch }) + "\n");
  return { ok: true, cancelled: true, name: e.name };
}

function show() {
  const e = loadPending()[(flag("nonce") || "").toUpperCase()];
  if (!e) die("unknown confirmation code.");
  console.log(JSON.stringify(e));
}

const cmd = pos[0];
// CLI surface: `plan` and `show` only — and only when this file is executed directly.
// Importing it (as revie-socket.mjs does) runs nothing.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const verbs = { plan, show: async () => show() };
  const run = verbs[cmd];
  if (!run) { console.error("usage: revie-write.mjs plan|show …"); process.exit(1); }
  run().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
