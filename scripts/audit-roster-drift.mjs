// Roster-drift audit — "the Davi class".
//
// Several scripts keep their OWN hardcoded list of AEs. When the real roster
// (src/lib/planConfig.ts → AE_ROSTER) gains or loses a person and one of those private
// lists isn't updated, that rep silently vanishes from a tab. No error, no empty state —
// their row just isn't built, which reads as "closed nothing".
//
// That is exactly how David Dubinski showed $57.9k against an actual $1.16M YTD
// (fixed 2026-08-25, PR #48), and how Dorsa Mahmoudnia is currently absent from the
// Deal Health aging matrix.
//
// This audit compares every private list against AE_ROSTER and reports anyone missing.
// Deliberate exclusions are declared in ACK below so intent stays quiet and only
// ACCIDENTAL drift is reported.
//
// Exit 1 on any unacknowledged drift. Run: node scripts/audit-roster-drift.mjs
import { readFileSync } from "fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf-8");

// The source of truth.
const roster = [...read("src/lib/planConfig.ts").matchAll(/\{\s*name:\s*"([^"]+)"/g)].map((m) => m[1]);

// Private lists to police: [file, human label, extractor]
const NAME_RE = /"([A-Z][a-z]+(?:\s+[A-Z][a-z']+)+)"/g;
const namesIn = (src, sliceFrom, sliceTo) => {
  const body = sliceTo ? src.slice(src.indexOf(sliceFrom), src.indexOf(sliceTo, src.indexOf(sliceFrom))) : src;
  return [...new Set([...body.matchAll(NAME_RE)].map((m) => m[1]).filter((n) => roster.includes(n)))];
};
const TARGETS = [
  ["scripts/refresh-ae-annual-potential.mjs", "AE Attainment (Annual) — GOALS", (s) => namesIn(s, "const GOALS", "};")],
  ["scripts/build-forecast-potential.mjs", "Forecast Potential — AES", (s) => namesIn(s, "const AES", "];")],
  ["scripts/build-aging-by-stage.mjs", "Deal Health aging — AES", (s) => namesIn(s, "const AES", "];")],
];

// Declared-intentional omissions: "<label>|<name>" → why. Keep the reason honest; an entry
// here means "we know they're missing and that is correct", not "we gave up".
const ACK = {
  "Forecast Potential — AES|Dorsa Mahmoudnia":
    "FORECAST_EXCLUDE — no AE/AM % on her open opps, so Potential computes to $0 and would drag the team projection. Scoped to the Forecast tab by design.",
};

const findings = [];
for (const [file, label, extract] of TARGETS) {
  let listed;
  try { listed = extract(read(file)); }
  catch (e) { findings.push({ label, file, kind: "unreadable", detail: String(e.message).slice(0, 120) }); continue; }
  for (const person of roster) {
    if (listed.includes(person)) continue;
    const key = `${label}|${person}`;
    if (ACK[key]) continue;
    findings.push({ label, file, kind: "missing", person });
  }
}

const acked = Object.keys(ACK).length;
if (findings.length === 0) {
  console.log(`✓ roster-drift: all ${TARGETS.length} lists match AE_ROSTER (${roster.length} reps)${acked ? ` · ${acked} acknowledged omission(s)` : ""}`);
  process.exit(0);
}
console.error(`✗ roster-drift: ${findings.length} unacknowledged gap(s) vs AE_ROSTER (${roster.join(", ")})`);
for (const f of findings) {
  if (f.kind === "missing") console.error(`  MISSING  ${f.person}  →  ${f.label}  (${f.file})`);
  else console.error(`  UNREADABLE  ${f.label} (${f.file}): ${f.detail}`);
}
console.error("\nFix the list, or add an entry to ACK in this file if the omission is deliberate.");
process.exit(1);
