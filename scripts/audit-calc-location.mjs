// Calculation-location audit — "the math lives in the database, not the codebase".
//
// The dashboard's architecture (see AGENTS.md → "Where calculations live") is:
//   Salesforce → script-written RAW tabs → sheet FORMULA tabs → dashboard READS a key
// The dashboard is a renderer. Every displayed number should come from a sheet cell via a
// source-tab accessor (H()/TS()/HS() over a key→value block), not from arithmetic in TSX.
// That way Tai can audit any number in the Sheet, and a definition change is a formula edit
// instead of a code change + deploy.
//
// This script scans the ADDED lines of a pull request for drift away from that rule. It is
// report-only by default (exit 0) because the repo has pre-existing in-code math; --strict
// makes new findings fail the job.
//
// Run locally:  node scripts/audit-calc-location.mjs --base=main
// In CI:        node scripts/audit-calc-location.mjs --base=origin/main --md=audit.md
import { execFileSync } from "node:child_process";

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.join("=") || "true"];
}));
const BASE = args.get("base") ?? "origin/main";
const HEAD = args.get("head") ?? "HEAD";
const STRICT = args.has("strict");

// ── The sheet tabs that are FORMULA-owned. Their contents are computed by spreadsheet
// formulas over the raw SFDC pulls, so a script must never write computed VALUES into them
// (writing the formula string itself is fine — that's how the formulas get installed). ──
const FORMULA_TABS = [
  "Headline", "Targets", "Forecast Potential", "Pipeline", "Pipeline - WoW", "AE Attainment",
  "AE Attainment (Official)", "Forecasting", "ARR & recurring revenue", "Payment Mix Report",
  "Booked ARR Snapshot", "Booked ARR Snapshot v2", "Contracted ARR Snapshot",
  "Live ARR Snapshot", "Deal Health — Aging by Stage", "Top_Booked_ARR",
];
// Presentation-only files: pixel/geometry math is their job, not business math. Skipped.
const PRESENTATION = /(Chart|Sparkline|TabHeader|ui)\.tsx$|^src\/lib\/session\.ts$|^src\/proxy\.ts$/;
// Sheet-first accessors — a metric read through one of these is compliant by construction.
const ACCESSOR = /\b(H|HS|TS|FP|hs|ts|parseKeyValue)\s*\(|\b(headlineSource|targetsSource|forecastPotentialSource|dealHealthSource)\s*[?.(\[]/;

function git(...a) { return execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 }); }

// ── Collect added lines (file + real line number) from the PR diff. ──
let diff;
try {
  diff = git("diff", "--unified=0", "--no-color", `${BASE}...${HEAD}`, "--", "src", "scripts");
} catch {
  console.error(`could not diff against ${BASE} — is the base branch fetched? (fetch-depth: 0)`);
  process.exit(0);
}
const added = [];   // { file, line, text }
const removed = [];  // { file, text }
{
  let file = null, lineNo = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ b/")) { file = raw.slice(6); continue; }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (raw.startsWith("+") && !raw.startsWith("+++")) { added.push({ file, line: lineNo++, text: raw.slice(1) }); continue; }
    if (raw.startsWith("-") && !raw.startsWith("---")) { removed.push({ file, text: raw.slice(1) }); }
  }
}

const findings = [];
const add = (rule, f, why, fix) =>
  findings.push({ rule, file: f.file, line: f.line ?? 0, code: (f.text ?? "").trim().slice(0, 160), why, fix });

// Strip string literals and comments so quoted text / prose can't trip the pattern matchers.
const code = (t) => t.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');

// JSX TEXT NODES ARE ENGLISH, NOT CODE. A sentence carries no string quotes for code() to
// strip, so the operator patterns below can match it by accident — "Standard / Rip" reads as a
// division, "several months." as a data access, "Tip:" as a binding. That produced a false
// positive on an explanatory line of copy. A line with no JS syntax at all (no parens, braces
// or `=`) and three or more running words is prose: every real aggregation has `.reduce(` or an
// `=`, so nothing genuine can hide behind this test.
const PROSE_LINE = (t) => !/[(){}=]/.test(t) && /\s\w+\s\w+\s\w+/.test(t);

// Deliberate, reviewed exception: `calc-ok: <reason>` on the line (or the line above) declares a
// line as presentational and prints the reason in the report instead of a finding. It is a claim
// the reviewer can see and challenge — not a silent mute. Use it only where no sheet cell could
// own the number, e.g. a caption total over rows the reader just chose by clicking.
const OK_RE = /(?:\/\/|\/\*|\{\/\*)\s*calc-ok:\s*(.+?)\s*(?:\*\/|\*\/\}|$)/;
const acked = [];

// Technical constants that are units of time / bytes / pixels, never business figures.
const TECH_CONSTANT = new Set([86400000, 86400, 3600000, 604800000, 604800, 1000, 1024, 1e6, 65536, 1200, 1440, 1080, 1920]);
// Lines whose numbers are layout, bucket labels or wire plumbing rather than finance.
const PRESENTATION_LINE = /style=|maxWidth|minWidth|padding|margin|width:|height:|fontSize|strokeWidth|viewBox|zIndex|maxAge|timeout|setTimeout|86400000|\brange:\s*["']|label:\s*["'][^"']*["']\s*,\s*(min|max):/i;

// Text of every added line, so a `calc-ok:` comment can sit on the line ABOVE the code it covers.
const prevText = new Map(added.map((f) => [f.file + ":" + f.line, f.text]));

for (const f of added) {
  if (!/\.(ts|tsx|mjs|js)$/.test(f.file ?? "")) continue;   // skip json snapshots, md, css
  const isSrc = f.file.startsWith("src/");
  const isScript = f.file.startsWith("scripts/");
  const c = code(f.text);
  if (!c.trim()) continue;
  if (PROSE_LINE(f.text)) continue;
  // The marker may sit on the line itself or anywhere in the comment block just above it, since
  // the reason usually reads before the explanation rather than jammed onto the code line.
  let ok = f.text.match(OK_RE);
  for (let back = 1; !ok && back <= 6; back++) {
    const prev = prevText.get(f.file + ":" + (f.line - back));
    if (prev === undefined || !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(prev)) break; // stop at the first non-comment line
    ok = prev.match(OK_RE);
  }
  if (ok) { acked.push({ file: f.file, line: f.line, reason: ok[1], code: f.text.trim().slice(0, 120) }); continue; }

  // ── Rule 1 — a metric AGGREGATED in the dashboard instead of read from a sheet key. ──
  // An aggregation over server data (reduce / sum loop / count) assigned to a const, with no
  // sheet accessor anywhere on the line, is a number that exists only in the code.
  if (isSrc && !PRESENTATION.test(f.file) && !ACCESSOR.test(c)) {
    // Aggregation: a fold, a count, or arithmetic between two terms.
    // `xs[xs.length - 1]` is indexing, not arithmetic — strip it before testing.
    const ci = c.replace(/\.length\s*-\s*\d+/g, ".length");
    const aggregates = /\.reduce\s*\(/.test(ci) || /\.length\s*[*/+-]|[*/+-]\s*[\w.)\]]*\.length/.test(ci) ||
      /[\w)\]]\s*[*/]\s*[\w(]/.test(ci);
    // …over data that came from the server payload (i.e. a business number, not layout math).
    const overData = /\bdata\.\w+|\b(deals|reps|months|opps|rows|buckets|weeks)\b\s*\./.test(ci);
    // Only flag a line that BINDS the result — that's a metric the UI will render.
    const binds = /\b(const|let|var)\s+\w+\s*=|^\s*\w+\s*[:=]\s*[^=]/.test(ci);
    if (aggregates && overData && binds) {
      add("R1 in-code aggregation", f,
        "aggregates server data in the dashboard, so this number exists only in the code and cannot be audited in the Sheet",
        "add the figure as a key in the relevant source tab (Headline / Targets / Forecast Potential) and read it with H(\"key\", fallback)");
    }
  }

  // ── Rule 2 — a business constant hardcoded in the codebase. ──
  // Targets, quotas and plan figures belong in the Targets tab; a literal in code silently
  // diverges from finance the moment the plan changes.
  if (isSrc && !PRESENTATION.test(f.file) && !PRESENTATION_LINE.test(f.text) && !ACCESSOR.test(c)) {
    // A literal reads as financial when it sits next to a money-ish name, or is a bare
    // 4+-digit number that is not a year and not a known technical constant.
    // Split camelCase humps first, so `q4Target` / `newQuota` / `teamPlanArr` are seen as words.
    const words = c.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    const MONEY_CONTEXT = /\b(quota|target|plan|goal|budget|arr|acv|mrr|revenue|fallback|forecast|attainment|booked|contracted|churn)/i;
    for (const m of c.matchAll(/(?<![\w.])(\d{4,})(?![\w.])/g)) {
      const n = Number(m[1]);
      if (n >= 1000 && !(n >= 1990 && n <= 2100) && !TECH_CONSTANT.has(n) && MONEY_CONTEXT.test(words)) {
        add("R2 hardcoded business constant", f,
          `numeric literal ${n.toLocaleString()} baked into code — if this is a target, quota or ARR figure it will silently diverge from finance`,
          "move the value to the Targets sheet tab as a key→value row and read it with TS(\"key\")");
        break;
      }
    }
  }

  // ── Rule 3a — a RAW write into a formula-owned tab. valueInputOption "RAW" makes the Sheet
  // store "=SUM(...)" as literal text, so a RAW write can only ever deposit computed values. ──
  if (isScript && /valueInputOption:\s*["']RAW["']/.test(f.text)) {
    const tab = FORMULA_TABS.find((t) => f.text.includes(t));
    if (tab) {
      add("R3 RAW write to a formula tab", f,
        `writes "${tab}" with valueInputOption RAW, which cannot install a formula — only a value computed in Node`,
        'use valueInputOption "USER_ENTERED" and write the formula string, so the cell shows its own calculation');
    }
  }
}

// ── Rule 3b — a touched script that fills a formula-owned tab with no formulas at all.
// If the whole file contains zero "=..." strings but writes a formula tab, every cell in that
// tab is a number JavaScript worked out — exactly the thing this audit exists to prevent. ──
const FORMULA_STR = /["'`]\s*=\s*(IF|IFERROR|SUM|SUMIF|SUMIFS|COUNT|COUNTIF|COUNTIFS|AVERAGE|QUERY|ARRAYFORMULA|FILTER|INDEX|VLOOKUP|TEXT|TODAY|DATE|ROUND|MAX|MIN|\$|[A-Z]+\d)/;
for (const file of new Set(added.filter((a) => a.file?.startsWith("scripts/")).map((a) => a.file))) {
  let body = "";
  try { body = git("show", `${HEAD}:${file}`); } catch { continue; }
  const tab = FORMULA_TABS.find((t) => body.includes(`'${t}'!`) || body.includes(`"${t}"`) || body.includes(`${t}!A`));
  if (!tab) continue;
  const writes = /values\.(update|append|batchUpdate)|spreadsheets\.batchUpdate/.test(body);
  if (writes && !FORMULA_STR.test(body)) {
    add("R3 formula tab filled with values", { file, line: 0, text: `writes "${tab}" — no formula string anywhere in this file` },
      `builds the formula-owned tab "${tab}" entirely from values computed in Node, so the Sheet shows results with no visible calculation`,
      "emit formula strings for the computed columns/rows so the arithmetic lives in the cells and Tai can audit it in the Sheet");
  }
}

// ── Rule 4 — a sheet-first read being REMOVED without replacement (architecture regression).
// A key that reappears in the added lines is a rename/refactor, not a regression — skip those. ──
const addedText = added.reduce((m, a) => ((m[a.file] = (m[a.file] ?? "") + a.text + "\n"), m), {});
for (const r of removed) {
  if (!r.file?.startsWith("src/")) continue;
  const acc = r.text.match(/\b(?:H|HS|TS|FP)\s*\(\s*["']([a-z0-9_]+)["']/);
  const rangeEntry = /\{\s*tab:\s*["']([^"']+)["'],\s*range:/.exec(r.text);
  const mine = addedText[r.file] ?? "";
  if (acc && !mine.includes(`"${acc[1]}"`) && !mine.includes(`'${acc[1]}'`)) {
    add("R4 sheet source removed", { file: r.file, line: 0, text: r.text },
      `stops reading the sheet key "${acc[1]}" and does not read it anywhere else in this file's changes, moving that number back into the codebase`,
      "keep the source-tab read; if the key was renamed, point the accessor at the new key instead of computing in code");
  } else if (rangeEntry && !mine.includes(rangeEntry[1])) {
    add("R4 source tab unwired", { file: r.file, line: 0, text: r.text },
      `removes the source-tab range for "${rangeEntry[1]}", so the dashboard no longer reads that tab`,
      "keep the tab in the read list unless the tab itself is retired");
  }
}

// ── Report ──
const byRule = findings.reduce((m, f) => ((m[f.rule] = (m[f.rule] ?? 0) + 1), m), {});
const lines = [];
const P = (s = "") => lines.push(s);
if (!findings.length) {
  P("PASS — no calculation moved into the codebase.");
  P("");
  P(`Scanned ${added.length} added line(s) across ${new Set(added.map((a) => a.file)).size} file(s) vs ${BASE}.`);
  P("Every number this PR touches is either read from a sheet source tab or is presentation-only.");
} else {
  P(`FINDINGS — ${findings.length} place(s) where a calculation may have moved out of the Sheet and into the code.`);
  P("");
  for (const [rule, n] of Object.entries(byRule)) P(`  ${rule}: ${n}`);
  P("");
  for (const f of findings) {
    P(`${f.file}:${f.line || "?"}  [${f.rule}]`);
    P(`    code: ${f.code}`);
    P(`    why:  ${f.why}`);
    P(`    fix:  ${f.fix}`);
    P("");
  }
  P("These are heuristics, not verdicts — a genuinely presentational or fallback-only line is fine.");
  P("The rule being checked: the Sheet computes, the dashboard reads. See AGENTS.md → \"Where calculations live\".");
}
// Declared exceptions are printed either way — an exception nobody sees is an exception nobody
// reviews, which is how a real finding eventually gets waved through.
if (acked.length) {
  P("");
  P(`DECLARED EXCEPTIONS — ${acked.length} line(s) marked \`calc-ok:\` by the author. Check the reasons:`);
  for (const a of acked) {
    P(`  ${a.file}:${a.line}  ${a.reason}`);
    P(`      ${a.code}`);
  }
}
const report = lines.join("\n");
console.log(report);

if (args.has("md")) {
  const { writeFileSync } = await import("node:fs");
  const head = findings.length
    ? `### Calculation-location audit — ${findings.length} finding(s)\n\nThis PR may compute numbers in the codebase that belong in the Google Sheet.\n`
    : `### Calculation-location audit — PASS\n\nNo calculation moved from the Sheet into the codebase.\n`;
  writeFileSync(args.get("md"), `${head}\n\`\`\`\n${report}\n\`\`\`\n`);
}
process.exit(STRICT && findings.length ? 1 : 0);
