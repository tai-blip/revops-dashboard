# RevOps → Dashboard Brief — week of 2026-08-06

**Sources:** Weekly Forecast Call (8/6 — Andrew, Tai, Stephen, **Sai**, **Davi**) · Weekly Sales/Rev Ops Sync (8/4 — Andrew, Tai, Stephen)
**Prepared by:** BA agent (inaugural run) · Paste the "do now" items into a fresh Claude Code chat to execute.

---

## TL;DR

The Forecast Call produced a clear, leadership-aligned theme: **the dashboard must stop conflating "signed" with "live & paying."** Sai and Davi explicitly aligned on standardizing **Potential ARR on Contract *Live* Date** and adding a **separate Bookings metric on Contract *Signed* Date**. That same "true live ARR" problem showed up in the 8/4 sync (Papa Murphy's renewal reads as closed-lost while pending). This is the same survivorship/booked-vs-live thread already on the SalesOps roadmap — so the infra is partly there.

**Prioritize first:** Ask #1 (Bookings vs Live-ARR split) + Ask #2 (Potential ARR keyed to Contract Live Date) — do them together; they're one coherent change and everything else in the forecast conversation hangs off the definitions they settle.

---

## Prioritized breakdown

| # | Ask | Mtg | Priority | Feasibility | Blocked by | Recommendation |
|---|-----|-----|----------|-------------|------------|----------------|
| 1 | Separate **Bookings** metric (Contract *Signed* Date) vs Closed-Won/live | Forecast 8/6 | **P0** | **High** | — (partial infra: `bookingReport`) | **Do now — first** |
| 2 | **Potential ARR** standardized on **Contract Live Date** | Forecast 8/6 | **P0** | Med | needs live-date populated | **Do now — with #1** |
| 3 | **True Live ARR** — pending/lapsed/renewing contracts (Papa Murphy's) not counted as lost | Sync 8/4 | **P1** | Med | new SFDC status | **Do now (dashboard side)** |
| 4 | **Forecast-tab guard** for quarterly-vs-annual mismatch (Matias 190.4 vs 76) | Forecast 8/6 | P1 | Med | — | Do now (cheap win) |
| 5 | **Slim "weekly review" deal tab** (key metrics only) | Forecast 8/6 | P2 | High | — | Do after #1–2 |
| 6 | **Probability-threshold filter** on forecast tab (hide low-close deals) | Forecast 8/6 | P2 | High | — | Do after #1–2 |
| 7 | **Cash-flow model**: per-deal go-live timing overrides (not flat monthly) | Forecast 8/6 | P2 | Low | Stephen+Davi to define timing first | Later / blocked |
| 8 | **FY projection toggle/metrics** consistent across all tabs | Forecast 8/6 | P2 | Med | mostly data-entry (Davi) | Later — small code assist |

Legend: P0 = leadership-aligned Decision, revenue-accuracy critical · Feasibility = how much already exists + is the data available now.

---

## Per-ask detail

### 1 — Bookings (signed) vs Live ARR (live & paying)  · P0 · High
> *"a new metric for bookings, based on the contract sign date, should be implemented"* — Sai & Davi, aligned decision. Davi: team may hit **booking** targets but Q3 **live** revenue lands ~600–800K because clients go live in Q4/Q1.

- **Current state:** the dashboard already has `bookingReport` (Booked-not-yet-live) and `liveArrToday` in `src/app/api/dashboard/route.ts`; memory's `salesops-handoff-roadmap` already lists "booked-vs-live ARR" + "booking report" as open workstreams. So this is *finishing* an existing thread, not greenfield.
- **Proposed change:** surface **two first-class series** on the dashboard — *Bookings* (sum of New Business by Contract Signed Date, in-quarter) and *Live/Recognized* (by Contract Live Date). Show both against target so the "we booked it vs we're collecting it" gap is explicit.
- **Acceptance:** a Q3 view shows Bookings ≈ target-track while Live shows Davi's ~600–800K; the two numbers are labeled and never summed together.
- **Files:** `src/app/api/dashboard/route.ts` (add `bookings` aggregation by signed date), `src/app/page.tsx` (twin metric), likely a refresh script under `scripts/` for the signed-date pull.

### 2 — Potential ARR on Contract Live Date  · P0 · Med
> Aligned decision: *"'Contract Live Date' for Potential ARR calculations and 'Contract Signed Date' for a separate Bookings metric."*

- **Current state:** we recently fixed live-date handling for the Top-5 booked view (commit a901fef — raw sheet serials → real dates), so the live-date field is already in play.
- **Proposed change:** ensure Potential ARR / forecast rollups bucket by Contract Live Date, not close/sign date.
- **Acceptance:** deals signed in Q3 but going live Q4 (Kahala, Dave's Hot Chicken, Five Guys Global per Davi) fall into Q4 Potential, not Q3.
- **Blocker:** relies on Contract Live Date being populated per deal — spot-check coverage before trusting the rollup.

### 3 — True Live ARR (pending/renewing not counted as lost)  · P1 · Med
> Sync 8/4: Papa Murphy's is mid-renewal but reads *closed-lost* → excluded from Live ARR. Team wants a "pending / not-live" status so ARR reflects reality.

- **Current state:** directly related to memory's `arr-fullbook-rebuild` — the dashboard already overrides New ARR/churn with full-book Rule A from `ARR_MoM_Rebuild` because `LiveARR` is survivorship-biased. This ask extends that: handle in-renewal contracts so they aren't shown as churn/lost.
- **Proposed change (dashboard side):** treat in-renewal/pending deals as a distinct bucket in the ARR waterfall rather than dropping them to churn.
- **Blocker:** the clean fix needs the new SFDC status field (Tai is configuring). Until then, code can approximate via the renewal-due signal already in `arrForward.renewalDue`.

### 4 — Forecast-tab quarterly-vs-annual guard  · P1 · Med
> Stephen spotted Matias showing **190.4** potential (quarterly) vs **76** annual on the forecast tab — an annual field left mispopulated.

- **Current state:** `refresh-ae-annual-potential.mjs` already maintains the annual field; the two numbers come from different SFDC fields (quarterly forecast vs annual potential).
- **Proposed change:** add a **visual flag** on the forecast tab when a rep's quarterly potential exceeds their annual projection (logically impossible) so bad data is caught on the dashboard instead of in a meeting.
- **Acceptance:** Matias-type mismatches render a ⚠ badge; clean reps render nothing. Cheap, high-trust win.

### 5 — Slim weekly-review deal tab  · P2 · High
> *"[Stephen] Create an abbreviated deal tab with key metrics for weekly review."*

- **Current state:** `forecastTab.rows` already carries per-deal/per-rep metrics; the full forecast tab was called "too dense" in both meetings.
- **Proposed change:** a condensed view (top deals by Potential ARR, close prob, live date, owner) — a filtered projection of existing data, no new source.

### 6 — Probability-threshold filter on forecast tab  · P2 · High
> Davi committed to *"removing deals with low closure probability"* so the pipeline reflects realistic outcomes.

- **Proposed change:** a probability cutoff (e.g. hide < 20%) on the forecast/pipeline view. Pure client-side filter over existing rows.

### 7 — Cash-flow model with per-deal timing  · P2 · Low  · BLOCKED
> Model currently treats revenue as flat monthly; needs manual overrides for deal-specific go-live timing.

- **Blocker:** Stephen + Davi first meet to define the timing rules ("Refine Cash Flow" action item). No code until those rules exist. Park it.

### 8 — FY projection toggle/metrics consistent across tabs  · P2 · Med
> Davi to ensure full-year projection toggles + metrics are accurate across all tabs; some reps update quarterly prob but not FY.

- **Mostly data-entry** (Davi owns the team nudge). Code assist is small: make sure every tab reads the same FY source so a fixed number propagates everywhere. Low urgency.

---

## Recommended sequence

**Do now (paste these into the coding chat):**
1. #1 + #2 together — Bookings(signed) vs Live/Potential(live-date) split. *This is the anchor.*
2. #4 — forecast-tab mismatch guard (small, builds trust fast).
3. #3 — true-live-ARR pending bucket (dashboard-side approximation now; finish when the SFDC status lands).

**Fast-follow once #1–2 land:** #5 slim deal tab, #6 probability filter.

**Blocked / later:** #7 cash-flow timing (needs Stephen+Davi rules), #8 FY consistency (mostly data-entry).

---

## Not a code task — routed elsewhere (captured so nothing is lost)
- **SFDC — make `Amount` mandatory on SQL creation** (Davi) — unblocks Jill's missing pipeline values; prerequisite for trustworthy Bookings numbers.
- **SFDC — mandatory `Potential Contract Start Date` on Trial stage** (Stephen) — this is the field that later unblocks Ask #7 and sharpens #2.
- **SFDC data entry — update Matias's annual projection field** (Stephen to nudge) — the root cause behind Ask #4.
- **Order form / PandaDoc** — relabel to Alfie (Experience Agent) / Rocky (Intelligence Agent), drop Chat Agent; wait for Nick's new pricing calculator (this week) before finalizing fields.
- **Ops/People** — new sales domain + credit card (Stephen), Shri handoff before the 11th, commission-payout template, Andrew's team spiff sign-offs. No dashboard impact.
- **Meeting cadence** — Forecast call moves Mon → **Tuesday** (so Davi can validate data first). *Note for this job:* Friday runs still capture it fine.

## Resolved / dropped this week
- **Payment Mix report** — Stephen (8/4): *"we probably don't need that report anymore"* now that it's on the dashboard. Confirmed by memory `payment-mix-report` (already built). **Dropped.**

## Still open from prior weeks
- *(none — inaugural brief)* Future runs: carry forward any "do now" item not yet shipped.

## Side projects noted (not this repo, low priority)
- **Gong objection insights** — Tai + Nick pulling call-transcript objection trends via Gong API; main constraint is transcript token volume. Interesting, not dashboard work.
- **Per-rep Claude emails** — replace the dense broad Opportunity-Excellence email with concise per-rep emails (~75% shorter). Overlaps the existing `weekly-ops-excellency-email` scheduled task; consider folding in there rather than the dashboard.
