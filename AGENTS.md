<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Where calculations live

**The Sheet computes. The dashboard reads.** The data path is:

```
Salesforce → script-written RAW tabs → sheet FORMULA tabs → dashboard reads a key
```

Any number shown on the dashboard must come from a cell in the Google Sheet, read through a
source-tab accessor over a key→value block — `H("key", fallback)` (Headline), `TS(...)`
(Targets), `HS(...)`, `FP(...)`. Arithmetic in `page.tsx` is not the source of a metric; at
most it is the fallback behind one of those accessors.

Why: Tai audits numbers in the Sheet, not in TypeScript. A definition that lives in a formula
is changed by editing a cell; the same definition in code needs a PR and a deploy, and two
copies of it drift apart silently.

Concretely, when adding or changing a metric:

1. Add the figure as a **formula** in the relevant source tab (`scripts/build-headline-tab.mjs`,
   `build-targets-tab.mjs`, `build-forecast-potential.mjs` — they write `"=..."` strings with
   `valueInputOption: "USER_ENTERED"`).
2. Make sure the tab is in the read list in `src/app/api/dashboard/route.ts`.
3. Read it in the dashboard by key. Keep an in-code fallback so a missing tab degrades instead
   of breaking, but the sheet value must win.

Never: hardcode a target, quota or plan figure in `src/` (they belong in the Targets tab);
write a formula-owned tab with `valueInputOption: "RAW"` (that stores `=SUM(...)` as text, so
only a Node-computed value can land); build a formula tab entirely out of values computed in
JavaScript.

`.github/workflows/audit-calc-location.yml` checks this on every pull request and comments the
verdict. Run it yourself before pushing:

```
node scripts/audit-calc-location.mjs --base=main
```
