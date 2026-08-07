# RevOps → Dashboard Brief — week of 2026-08-07

**Sources:** Weekly Tai/Stephen 1:1 (8/6 — **new, not previously briefed**) · Weekly Forecast Call (8/6 — Andrew, Tai, Stephen, Sai, Davi) · Weekly Sales/Rev Ops Sync (8/4)
**Prepared by:** BA agent (run 2) · Paste the "do now" items into a fresh Claude Code chat to execute.

---

## TL;DR

The two recurring notes this week are the **same 8/6 Forecast Call and 8/4 Sync already covered in the [2026-08-06 brief](2026-08-06-revops-brief.md)** — I re-read both and found nothing the inaugural brief missed. The genuinely new input is the **Tai/Stephen 1:1 (8/6)**, and it matters a lot: it settles the *mechanism* behind the booked-vs-live problem that the Forecast Call only settled the *definition* for. Tai and Stephen aligned to **restructure the Salesforce opportunity stages** — move `Closed Won` earlier (= **Booked ARR**, gated by Contract Signed Date), keep `Billing`, and add a terminal **`Live Paying`** stage (= **Live ARR**, gated by Contract Live Date).

That is a schema change under this repo's feet. The dashboard hardcodes `Billing|Closed Won` as "won" in at least four places, and `refresh-arr-from-sfdc.mjs` pulls on `StageName IN ('Billing','Closed Won','Closed Lost')`. When Tai's stage change lands, those either break or — worse — keep running and quietly report the wrong number.

**Prioritize first:** new Ask #9 (centralize the stage vocabulary behind one module, with a migration guard) **before** last week's #1/#2. It is a day of work, it de-risks the whole booked-vs-live cluster, and doing #1/#2 first means writing the same `Closed Won` string into three more files that then all need rewriting.

Also worth knowing: **nothing has shipped since 8/4** (last commit `db50d65`, no commits since the inaugural brief). All 8 asks from last week carry forward unchanged.

---

## Prioritized breakdown

| # | Ask | Mtg | Priority | Feasibility | Blocked by | Recommendation |
|---|-----|-----|----------|-------------|------------|----------------|
| 9 | **Stage-vocabulary module + migration guard** for the `Closed Won → Billing → Live Paying` restructure | 1:1 8/6 | **P0** | **High** | — (prepare now, flip when SFDC lands) | **Do now — first, before #1/#2** |
| 10 | **Renewal-overdue panel** — surface lapsed renewals (Papa Murphy's $200k) that are invisible in Live ARR | 1:1 8/6 | **P1** | **High** | — (stage already exists in SFDC) | **Do now** |
| 1 | Separate **Bookings** metric (Contract *Signed* Date) vs live | Forecast 8/6 | **P0** | **High** | do after #9 | Do now — after #9 |
| 2 | **Potential ARR** standardized on **Contract Live Date** | Forecast 8/6 | **P0** | Med | live-date coverage; do after #9 | Do now — with #1 |
| 3 | **True Live ARR** — pending/renewing not counted as lost | Sync 8/4 | **P1** | Med | superseded in part by #9/#10 | Fold into #9 + #10 |
| 4 | **Forecast-tab guard** for quarterly-vs-annual mismatch (Matias 190.4 vs 76) | Forecast 8/6 | P1 | Med | — | Do now (cheap win) |
| 11 | **Smooth SQL-creation chart** (trailing avg) so conference batches stop reading as anomalies | 1:1 8/6 | P2 | High | — | Fast-follow |
| 5 | **Slim "weekly review" deal tab** | Forecast 8/6 | P2 | High | — | Fast-follow |
| 6 | **Probability-threshold filter** on forecast tab | Forecast 8/6 | P2 | High | — | Fast-follow |
| 12 | **"Key deals" logic** on the dashboard | 1:1 8/6 | P2 | Low | **Dave** hasn't answered Tai's questions | Blocked |
| 7 | **Cash-flow model**: per-deal go-live timing overrides | Forecast 8/6 | P2 | Low | Stephen+Davi timing rules | Blocked |
| 8 | **FY projection toggle/metrics** consistent across tabs | Forecast 8/6 | P2 | Med | mostly Davi data-entry | Later |

Legend: P0 = leadership-aligned Decision, revenue-accuracy critical · Feasibility = how much infra exists + is the data available now.

---

## Per-ask detail — new this week

### 9 — Stage-vocabulary module + migration guard · P0 · High · **DO FIRST**

> **Decision › Aligned (1:1 8/6):** *"restructure sales opportunity stages to distinguish between Book AR, which will be mapped to the 'Closed Won' stage, and Live AR, which will be mapped to a new 'Billing' stage."*
> Transcript is more precise than the summary — Tai: *"Anything under the closed wall is going to be book ar"*; Stephen: *"we need that billing stage because we need to know what opportunities are closed one who are not who are still in the process of paying… I think it would prefer just go billing and then live paying."* Net model: **`Closed Won` (Booked ARR, gated by Contract Signed Date) → `Billing` → `Live Paying` (Live ARR, gated by Contract Live Date).** Tai owns the SFDC change and is building the automation flow now.

**Current repo state — this is the risk.** The `Billing|Closed Won` pair is hardcoded as the definition of "won" across the codebase:
- [scripts/refresh-arr-from-sfdc.mjs:57](scripts/refresh-arr-from-sfdc.mjs:57) — `WHERE StageName IN ('Billing','Closed Won','Closed Lost')`. A new `Live Paying` stage is **excluded from the pull entirely** → those deals vanish from `SOQL_Pull`, `ARR_MoM_Rebuild`, and therefore from Live ARR, the product split, and every downstream tab. This is the single most dangerous line in the repo right now.
- [src/lib/deals.ts:38](src/lib/deals.ts:38) — `/Billing|Closed Won/i` filter in `computeBookingReport`.
- [src/lib/acvInsights.ts:6](src/lib/acvInsights.ts:6) — `Won = StageName Billing or Closed Won`.
- [src/lib/deals.ts:224](src/lib/deals.ts:224) — `Billing` as the terminal entry in the pipeline stage-order list; `DEFAULT_STAGE_RATES` likewise has no `Live Paying`.
- [scripts/refresh-opps-without-contact.mjs:15](scripts/refresh-opps-without-contact.mjs:15) + `:142` — `COACHABLE_STAGES` / `STAGE_ORDER` both end at `Billing`.

**Proposed change:** create `src/lib/stages.ts` (and a mirrored constant for the `.mjs` scripts) as the single source of truth:
```
BOOKED_STAGES  = ["Closed Won", "Billing", "Live Paying"]   // signed → counts as Booked ARR
LIVE_STAGES    = ["Live Paying"]                            // live & paying → counts as Live ARR
LOST_STAGES    = ["Closed Lost"]
OPEN_STAGES    = [...existing pipeline stages]
```
Replace every hardcoded `Billing|Closed Won` regex and the SOQL `IN (...)` list with these. Keep the current values working (`Live Paying` simply matches nothing until SFDC has it), so this ships **safely before** Tai's SFDC change and needs no re-deploy after it.

**Add a migration guard:** in `refresh-arr-from-sfdc.mjs`, after the pull, log a warning (and surface a dashboard banner) if any opportunity comes back with a `StageName` not in the known set. That converts a silent-wrong-number failure into a visible one — the exact failure mode Stephen caught by eye with Matias.

**Acceptance:**
- No file outside `stages.ts` contains a literal `"Closed Won"` / `"Billing"` stage string used as a filter.
- Adding `"Live Paying"` to `LIVE_STAGES` is the only edit needed on the day SFDC flips.
- An unknown stage in the SFDC pull produces a loud warning, not a silent drop.

**Blocker:** none to build. The flip is gated on Tai's SFDC flow — do the refactor now so the flip is a one-line change.

---

### 10 — Renewal-overdue panel · P1 · High

> 1:1 8/6, the Papa Murphy's case in detail. Stephen: *"it's a renewal that lapsed… the contract ended like June 30th… it's not being counted in like live AR right now."* Tai: *"it's in renewal overdue"* — and on how it got there: *"It just move uh based on the date… They're not moving anything. It move on itself."* Tai's conclusion: *"we should hold the account manager… responsible for this stage."* Stephen confirms AMs have historically never worked these stages.

**Why this is different from last week's Ask #3.** #3 was framed as "we need a new SFDC status before we can fix this." The 1:1 shows that's not true — **`Renewal Overdue` already exists as a stage**, the renewal opportunities already get auto-created, and the data is already in the SFDC pull. What's missing is *visibility*, not a field. That moves this from blocked-Med to buildable-now-High.

**Current repo state:** `arrForward.renewalDue` ([src/lib/parse.ts:296-319](src/lib/parse.ts:296)) carries a single aggregate renewal-due number and month — no per-deal breakout, no overdue flag. `computeBookingReport` deliberately drops Renewals (`deals.ts:38` — *"Renewals excluded (they don't add booked ARR)"*), which is right for bookings but means lapsed renewals appear nowhere.

**Proposed change:** a **"Renewals at risk"** panel — per-deal list of opportunities where `RecordType = Renewals` and (stage is `Renewal Overdue`, or `ContractEndDate` is in the past / within 60 days) — showing account, owner/AM, ARR, contract end date, days overdue, and current stage. Sum at the top: *"$X of ARR in lapsed or at-risk renewals, not counted in Live ARR."* Source it from `SOQL_ClosedDeals` (already has Stage, RecordType, ContractEndDate, Owner) — new function in `src/lib/deals.ts`, new key on `dash.json` in [src/app/api/dashboard/route.ts](src/app/api/dashboard/route.ts), new card in `src/app/page.tsx`.

**Acceptance:** Papa Murphy's (~$200k, ended ~June 30) appears in the panel with its days-overdue count, and the panel total reconciles as an explicit line item against the Live-ARR-vs-Booked-ARR gap. Adding it to the Slack daily digest (`scripts/daily-digest.mjs`) is the cheap follow-on that creates the AM accountability Tai wants.

**Blocker:** none. Accuracy improves once AMs actually maintain these opps, but the panel is what makes them do it.

---

### 11 — Smooth the SQL-creation chart · P2 · High

> 1:1 8/6. Tai flagged *"they created like 15 new SQL per last week"* as a possible data-quality problem. Stephen's explanation: *"SQLs always come in like really big batches because when an AE goes to a conference it's all from like that one week… so it's always going to look lumpy week over week. So I wouldn't be super concerned."* Tai accepted this; the concern was **de-escalated**, not actioned.

**The residue is a real dashboard defect, though:** the chart makes normal conference behaviour look like an anomaly, and it cost a meeting to explain. Cheap fix — add a trailing 4-week moving average line over the weekly SQL-creation series so the trend reads through the batching, and/or annotate the batch weeks. Pure presentation over existing pipeline-generation data.

**Note:** the "stricter SQL gatekeeping" question was explicitly parked — Stephen argued Davi's weekly pipeline reviews already cover it, and both agreed to raise it in the forecast call rather than build anything. **Do not brief gatekeeping as code work.**

---

### 12 — "Key deals" logic on the dashboard · P2 · Low · **BLOCKED**

> 1:1 8/6: Tai sent Dave a question list covering *"defining logic for 'key deals' on the dashboard, cleaning up the open pipeline, and clarifying feedback for ongoing opportunities."* Dave has not responded — *"he told me today that he going to roll back to me."*

Dave currently tracks key deals in his own way; the ask is to reverse-engineer that into logic the dashboard can compute. **No code until Dave answers what makes a deal "key."** Carry as blocked; if it's still unanswered next week, that's worth escalating rather than re-briefing.

---

## Per-ask detail — carried forward (unchanged from 2026-08-06)

Asks **#1–#8** are all still open — **no commits since 2026-08-04**, so nothing from the inaugural brief has shipped. Full detail is in [briefs/2026-08-06-revops-brief.md](2026-08-06-revops-brief.md); only the deltas are repeated here.

- **#1 Bookings (signed) vs Live ARR** — *feasibility upgraded to High.* I found more existing infra than last week's brief credited: `refresh-arr-from-sfdc.mjs` already writes a **`Signed Date` column T** to `SOQL_Pull` ([:162](scripts/refresh-arr-from-sfdc.mjs:162)) and `ARR_MoM_Rebuild` already carries **`bookedARR` in column U** ([src/lib/parse.ts:178](src/lib/parse.ts:178)), rendered as the gold forecast series in `ArrMovementChart.tsx`. So a monthly booked series exists — what's missing is the **in-quarter Bookings-vs-target** view Sai and Davi asked for, shown alongside Live and never summed with it.
  ⚠️ One caveat worth fixing as part of this: today's Signed Date is a *fallback chain* — `Date_Reached_Closed_Won__c || CloseDate || ContractLiveDate__c` ([:176](scripts/refresh-arr-from-sfdc.mjs:176)). That's a guess. After Ask #9's stage restructure, `Date_Reached_Closed_Won__c` becomes an authoritative signed-date gate and the fallback should be narrowed or flagged when it fires.
- **#2 Potential ARR on Contract Live Date** — unchanged. Spot-check live-date coverage before trusting the rollup.
- **#3 True Live ARR** — **largely superseded.** The structural half is Ask #9 (stage model); the visibility half is Ask #10 (renewal panel). Don't brief #3 as its own task — fold it in.
- **#4 Forecast-tab quarterly-vs-annual guard** — unchanged, still the cheapest trust win on the list. Stephen has messaged Matias to fix the underlying record.
- **#5 Slim weekly-review deal tab** · **#6 Probability filter** — unchanged, fast-follow.
- **#7 Cash-flow per-deal timing** · **#8 FY projection consistency** — unchanged, blocked/later.

---

## Recommended sequence

**Do now (paste into the coding chat, in this order):**
1. **#9 — stage-vocabulary module + migration guard.** Foundation. Everything below writes stage logic; do it once, centrally.
2. **#1 + #2 together** — Bookings(signed) vs Live/Potential(live-date), built on #9's constants. Includes narrowing the Signed Date fallback.
3. **#10 — renewal-overdue panel** (+ add to the Slack digest).
4. **#4 — forecast-tab mismatch guard.** Small, fast, visible.

**Fast-follow:** #11 SQL-creation smoothing, #5 slim deal tab, #6 probability filter.

**Blocked / later:** #12 key deals (needs Dave), #7 cash-flow timing (needs Stephen+Davi rules), #8 FY consistency (mostly Davi data-entry), #3 (folded into #9/#10).

---

## Not a code task — routed elsewhere

**New this week (from the 1:1):**
- **SFDC — restructure opportunity stages** (Tai): move `Closed Won` before `Billing`, add terminal `Live Paying`. *This is the prerequisite for Ask #9's flip — it is the highest-leverage non-code item on the list.*
- **SFDC — build the Live ARR automation flow** (Tai): roll-up summaries can't take a formula field as a condition, so Live ARR needs a Flow to maintain a checkbox instead. Tai is mid-build and called it the main technical blocker.
- **Document the stage change** (Tai): two-page summary for the forecast call. *Worth doing before Ask #9 ships so the repo and the deck agree on stage names.*
- **AM process — hold Account Managers accountable for renewal opps in SFDC** (Tai + Ben). Renewal stages currently advance on date alone with no human touch. Ask #10 gives them the visibility; the accountability is a people change.
- **SQL gatekeeping** — parked by mutual agreement (Stephen: Davi's weekly pipeline reviews cover it; no fraud observed). Group to revisit at a forecast call. Not code.
- **New US sales domain** (Tai + Stephen) — Stephen has the card; Tai sends login. *Note: Gemini's notes disagree with themselves on the chosen domain — Quick notes say `connectmomos.com`, Decisions say `connect.com`, transcript has Tai proposing "contact momos.com" then "connect". Confirm before purchase.* Tai to check with Anna whether multiple domains are needed.
- **Follow up with Dave** (Tai) — outstanding question list; blocks Ask #12 and the open-pipeline cleanup.

**Carried from last week:** SFDC mandatory `Amount` on SQL creation (Davi) · mandatory `Potential Contract Start Date` on Trial (Stephen) · Matias's annual projection field · order form / PandaDoc relabel (Alfie / Rocky, pending Nick's pricing calculator) · Shri handoff, commission-payout template, team spiffs · forecast call moved Mon → **Tuesday**.

---

## Resolved / dropped this week

- **Ask #3 (True Live ARR) as a standalone item** — superseded by #9 (stage model) + #10 (renewal visibility), which address its structural and visibility halves respectively. Not dropped, absorbed.
- **SQL quality / gatekeeping concern** — raised by Tai in the 1:1, answered by Stephen (conference batching, not data quality), accepted by Tai. **Resolved, no code** beyond the optional #11 chart smoothing.
- **Payment Mix report** — remains dropped (retired 8/4, already on the dashboard).

---

## Still open from prior weeks

All 8 asks from [2026-08-06](2026-08-06-revops-brief.md) — **none shipped** (no commits since `db50d65`, 2026-08-04). Reprioritized above: #1/#2 move behind #9; #3 folds into #9/#10; #4–#8 unchanged.

Also still on the [SalesOps handoff roadmap](../AGENTS.md) and not yet retired: chart x-axis month labels (quick win, never briefed), and annual AE attainment (still gated on Davi's annual-potential field).

## Side projects noted (not this repo)

- **Gong** — contact-to-opportunity linking is now **complete** (1:1 8/6), and lead→opportunity conversion is fixed, so opportunity list-source is populated going forward. This makes the Gong objection-insights side project more tractable, and makes channel attribution reportable if it's ever wanted on the dashboard.
- **Per-rep Claude emails** — unchanged; consider folding into the existing `weekly-ops-excellency-email` task rather than the dashboard. Dave's feedback on whether to continue Opportunity Excellency at all is still pending.
