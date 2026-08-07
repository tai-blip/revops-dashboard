# BA Playbook — Weekly RevOps/Forecast Brief

*This is the "brief for myself." The scheduled job reads this at the start of every run and appends
what it learned at the end. Keep it tight and actionable — it is how the job gets better each week.*

Last updated: 2026-08-06 (inaugural setup)

---

## Mission

Every Friday, turn the week's Gemini meeting notes (RevOps Sync + Forecast Call) into a **coding brief
Tai can paste into a fresh Claude Code chat** to execute against the `revops-dashboard` repo. I am a BA,
not a stenographer: my value is filtering the ~15 raw action items down to the few that are (a) real
dashboard/code work, (b) not already shipped, and (c) worth doing next — each scored by priority and
feasibility, with a clear "do this first."

## Where the notes live (Google Drive connector)

Two recurring Gemini note series, predictable titles:
- `Weekly Sales/Rev Ops Sync – YYYY/MM/DD … – Notes by Gemini` (attendees: Andrew, Tai, Stephen)
- `Weekly Forecast Call … – Notes by Gemini` (attendees add **Sai + Davi** — this is the numbers-heavy one)

Search query that works:
`(title contains 'Rev Ops' or title contains 'Forecast Call') and mimeType = 'application/vnd.google-apps.document'`
Then filter to `modifiedTime` within the last 7 days. Pull **every** matching note that week and synthesize
across them — do not stop at the first one.

### Reading gotcha (important)
`read_file_content` on these notes returns 60k+ chars and the tool **errors, dumping the JSON to a file** like
`.../tool-results/…read_file_content-*.txt` with schema `{fileContent: string}`. Don't try to Read that file
line-by-line. Instead:
```
jq -r '.fileContent' "$FILE" | awk '/# \*\*.? Transcript/{exit} {print}'
```
That drops the giant verbatim transcript and keeps **Quick notes → Summary → Decisions → Next steps → Details**,
which is all I need. Only dip into the transcript to disambiguate a vague action item.

## Note anatomy
`Quick notes` (bullets) · `Summary` (prose by theme) · `Decisions › Aligned` (what they committed to) ·
`Next steps` (`[Owner] Title: detail` — the raw action list) · `Details` (per-topic paragraphs with the *why*).
The **Details** section is where feasibility signal lives (which SFDC field, who's blocked, what number was wrong).

## Cross-reference before writing (this is the BA part)

1. **The repo** — score feasibility against what already exists:
   - `src/app/api/dashboard/route.ts` — data aggregation / the `dash.json` shape (keys: `bookingReport`,
     `forecastTab`, `liveArrToday`, `arrForward`, `dealHealth`, `arr`, `pipelineWow`, `winRateYtd`…).
   - `src/app/page.tsx` — the dashboard UI / tabs.
   - `src/lib/*` — `parse.ts`, `deals.ts`, `paymentMix.ts`, `acvInsights.ts`.
   - `scripts/*` — the refresh jobs (`refresh-arr-from-sfdc.mjs`, `build-arr-mom.mjs`,
     `refresh-ae-annual-potential.mjs`, `build-ae-attainment-official.mjs`, `daily-digest.mjs`, …).
2. **Auto-memory** — read `~/.claude/projects/-Users-tainguyen-Downloads-revops-dashboard/memory/MEMORY.md`
   and the linked files, especially `salesops-handoff-roadmap`, `arr-fullbook-rebuild`,
   `dashboard-data-sources`, `ae-attainment-official`, `payment-mix-report`.
3. **Prior briefs** — read the newest 2–3 `briefs/*-revops-brief.md` so I don't re-brief an item that's
   already been handed off or shipped. Carry forward anything still open under "Still open from prior weeks."

## Filtering rules
- **Keep** only items that translate to dashboard/data/code work in THIS repo.
- **Route out (list separately, don't brief as code):** Salesforce field config, order-form/PandaDoc,
  people/ops (credit cards, domains, handoffs, commission templates, pump-up speeches). Tai still wants to
  see these captured, just in a "Not a code task — routed elsewhere" section so nothing is lost.
- **Drop / mark resolved** anything the notes themselves retire or the dashboard already does
  (e.g. Payment Mix report — Stephen said in the 8/4 sync it's redundant now that it's on the dashboard).
- **Flag blocked** items whose code work can't start until an SFDC field exists (e.g. bookings metric needs
  a Contract Signed Date; revenue-timing needs the new "potential contract start date"). Name the blocker.

## Scoring
- **Priority P0/P1/P2** — weight by (a) who pushed it (Sai/Andrew/Davi named → higher), (b) whether it's a
  *Decision › Aligned* vs a passing comment, (c) revenue/forecast-accuracy impact.
- **Feasibility High/Med/Low** — how much infra already exists + whether the source data is available now.
- Every brief ends with a one-line **"Prioritize first"** call and a suggested sequence.

## Output
- Write `briefs/YYYY-MM-DD-revops-brief.md` (run date). Format below.
- Purely local: **do not send email/Slack or push commits.** The file + completion notification is the delivery.
- Then append a dated "Run log" line to this playbook (what notes covered, item count, anything that broke).

## Brief format (keep stable so Tai's paste-into-chat habit works)
1. **TL;DR** — 2–3 sentences + the "Prioritize first" line.
2. **Prioritized breakdown table** — | # | Ask | Source mtg | Priority | Feasibility | Blocked by | Recommendation |
3. **Per-ask detail** — for each kept item: what was said (1–2 lines, cite the meeting), current state in
   the repo, proposed change w/ file pointers, acceptance criteria, blockers.
4. **Recommended sequence** — ordered list, grouped into "do now" vs "blocked/later."
5. **Not a code task — routed elsewhere** — the SFDC/ops items, one line each.
6. **Resolved / dropped this week** — with reason.
7. **Still open from prior weeks** — carried forward.

## Run log
- 2026-08-06 — Inaugural brief built by hand during setup. Covered Forecast Call (8/6, Sai+Davi) + Rev Ops
  Sync (8/4). 8 code asks kept, biggest cluster = bookings-vs-live-ARR + potential-ARR-on-live-date. Learned:
  the read_file_content size-error → jq workaround (documented above); Payment Mix explicitly retired in 8/4.
- 2026-08-07 — Run 2. The two *recurring* notes in the 7-day window were the SAME 8/6 Forecast + 8/4 Sync the
  inaugural brief already covered (re-read both; nothing missed). The real find came from **widening the search
  to `title contains 'Notes by Gemini'`**, which surfaced a **Weekly Tai/Stephen 1:1 (8/6)** — outside the two
  named series but the most consequential note of the week. **Change to the method: always run the broad
  `'Notes by Gemini'` query as well as the two-series query.** Other 1:1s (Tai/Ben, Tai/Dave) likely carry
  dashboard signal too. Kept 4 new code asks (#9 stage-vocabulary module, #10 renewal-overdue panel,
  #11 SQL-chart smoothing, #12 key deals [blocked on Dave]) + carried all 8 prior asks; routed out 6 new
  non-code items. Two lessons worth keeping:
  1. **Check `git log` before writing.** No commits since 8/4 → nothing shipped → every prior ask carries
     forward. Cheap check, changes the whole "still open" section.
  2. **Grep the repo for the strings a decision will invalidate.** The 1:1's SFDC stage restructure looked like
     a pure ops item until I grepped `Billing|Closed Won` and found it hardcoded in 5 places incl. the SOQL
     `WHERE` clause — which would have silently dropped the new stage from the pull. That grep turned an ops
     note into the week's P0 code ask. Do this whenever a note changes a field, stage, or status vocabulary.
  Also worth noting: Gemini's own sections can contradict each other (this note's Quick notes / Decisions /
  transcript gave three different domain names) — prefer the **transcript** when they disagree, and flag it.
