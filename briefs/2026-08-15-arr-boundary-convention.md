# ARR Month-Boundary Convention — Decision & Impact (1-pager)

**Date:** 2026-08-15 · **Owner:** Tai · **Status:** decided (Option C), shipping on next refresh (PR #24)

## TL;DR
Our ARR-MoM and Truc's dashboard disagreed on the July number. Root cause was **not a data error** — it was **how deals landing on the 1st of a month are counted at the month boundary**. We aligned on the long-standing rule: **a month runs from the 1st to the 1st of the next month, end-inclusive.** This moves reported **July ARR from $5.79M → $5.85M**, matching Truc within ~$3k. **Live/current ARR is unchanged ($5.79M, still tied to finance.)**

## What happened
When we reconciled July deal-by-deal, our number was ~$56k below Truc's. The gap was almost entirely **contracts whose term ends on the 1st of the next month** (e.g. Hawaiian Bros, contract end 2026-08-01) — live the entire month of July, but our formula rolled them off one day early.

## The convention question
At each month boundary, two edge cases decide the number:
1. A deal that **goes live on the 1st** of the next month.
2. A deal that **ends on the 1st** of the next month (i.e., live through the whole prior month).

Three defensible ways to count them:

| Option | July ARR | Rule |
|---|---|---|
| **A — Old formula** | $5,787,156 | Snapshot at the 1st: counts 1st-of-month go-lives, **drops** 1st-of-month endings |
| **B — Strict month-end** | $5,727,814 | Snapshot at the last day: **excludes** 1st-of-month go-lives, keeps 1st-of-month endings |
| **C — End-inclusive (CHOSEN)** | **$5,846,633** | Month = 1st→1st, inclusive: counts 1st-of-month go-lives **and** 1st-of-month endings |
| *Truc's list (reference)* | *$5,843,413* | *≈ Option C* |

## Decision — Option C
**A month runs 1st → 1st-of-next, end-inclusive.** This is the ARR rule the business has always used, and it makes our dashboard and Truc's agree (within ~$3k; the small residual is churn/paused/renewed treatment, tracked separately).

**Why not B?** Option B is arguably the "purest" month-end snapshot (it excludes deals that only go live the following month). If leadership prefers that stricter view, it's a one-line switch — but it would move us *away* from Truc's number, not toward it, and would require Truc to change too.

## Impact
- **Reported July ARR: $5.79M → $5.85M** (+~$59k). Other historical months shift by the same small boundary effect.
- **Live / current-month ARR: unchanged at $5.79M** — the in-progress month is still measured as-of-today and stays tied to finance's number. The convention only affects *completed* months.
- Both dashboards now tell the same story for ARR-MoM.

## What changed technically (for the record)
The pipeline (`scripts/refresh-arr-from-sfdc.mjs`) now uses two boundaries instead of one: the **live/signed side** counts through the 1st of next month, the **end side** keeps a contract that ends on the 1st (`E > month-end`). Both clamp to today for the current month, preserving the finance tie. Applies to the monthly and weekly ARR series. Activates on the next scheduled refresh.
