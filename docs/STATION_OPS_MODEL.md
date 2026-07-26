# Station Ops — Unit Economics Model

A basic model for the $29/month Station Ops add-on (managed public URL, monitoring,
automated updates, encrypted backup, priority support — see `docs/BUSINESS_MODEL.md`).
Every number below is a **starting assumption, not a measurement** — there is no
subscriber data yet, since this is a waitlist test (`landing/station-ops.html`) plus
the backup/monitoring pieces, not a fully staffed managed service. Revisit every
assumption once the waitlist has real signups and the first paying subscribers exist.

## Inputs

| Variable | Assumption | Why |
|---|---|---|
| Price | $29.00/mo | Fixed, per the checklist. |
| CAC | ~$0 in paid spend | No ad budget planned — subscribers come from the existing download funnel (an "upsell" surfaced in-dashboard or on the waitlist page), not a separate acquisition channel. |
| Founder/support time per subscriber | 30 min/month | A guess for a small, mostly self-serve subscriber base; ticket volume for "is my tunnel still up" / "restore my backup" style requests should be low if monitoring/backup work as designed. |
| Support labor rate | $40/hr (founder's own time, opportunity-cost basis) | Placeholder — swap for a real contractor rate if support is ever outsourced. |
| Hosting cost per subscriber | ~$1.50/mo | Backup storage (bounded — see below) + a share of a shared monitoring poller. Cloudflare Tunnel itself is free. |
| Monthly churn | 5% | Placeholder for an unlaunched product. SaaS-wide early-stage churn commonly runs 3–7%/mo; revisit hard once real cohort data exists. |
| Fixed costs (monthly) | $0 today | No dedicated infrastructure yet at "waitlist + backup/monitoring" scope — this becomes non-zero the moment a shared monitoring service or paid backup storage tier is provisioned. |

## Per-subscriber unit economics

```
Support cost/mo   = (30/60) hr × $40/hr           = $20.00
Hosting cost/mo    = backup storage share + poller = $1.50
─────────────────────────────────────────────────────────
Gross margin/mo    = $29.00 − $20.00 − $1.50        = $7.50
Gross margin %                                       ≈ 26%
```

**This margin is thin, and it is dominated by the support-time assumption.** The
single biggest lever is support cost per subscriber — if monitoring/backup genuinely
run unattended (the design intent), real support time per subscriber should trend
toward single-digit minutes/month rather than 30, which would push gross margin
above 90%. Track actual support minutes per subscriber from day one so this
assumption gets replaced with data quickly instead of staying a guess.

## What ships at this test-phase scope

- **Waitlist**: `landing/station-ops.html`, reusing `download_leads`/`POST /api/download-lead` with `source: 'station_ops_waitlist'` — no new table.
- **Encrypted backup**: `scripts/backup.js` now supports optional AES-256-GCM encryption via `BACKUP_ENCRYPTION_KEY` (pure Node `crypto`, no new dependency).
- **Monitoring**: `scripts/station-ops-monitor.js`, a script the founder runs by hand or via cron against a list of subscriber station URLs — not a hosted dashboard. Reuses the same SSRF-safe reachability check already used for the in-app station health check.

## Backup storage cost bound

`scripts/backup.js`'s pruning keeps the on-disk backup set bounded per station, so
hosting cost doesn't grow unbounded with tenure — it scales with the number of
active subscribers, not with how long any one subscriber has been on the plan.
Once real backup file sizes are known (varies by vault size), replace the $1.50/mo
placeholder with `(avg backup set size × subscriber count × storage $/GB) / subscriber count`.

## Customer lifetime value (LTV)

```
Expected months retained = 1 / monthly churn = 1 / 0.05 = 20 months
LTV                       = gross margin/mo × expected months
                          = $7.50 × 20
                          = $150
```

At $0 CAC, LTV:CAC is undefined (infinite) in the strictest sense — but that's an
artifact of assuming zero paid acquisition, not a real signal of a good business.
The moment any paid acquisition is tried, this section needs the actual CAC plugged
in and a real LTV:CAC ratio computed (3:1 or better is the common healthy-SaaS bar).

## Break-even subscriber count

With $0 fixed costs today, Station Ops is profitable from subscriber #1 on a pure
gross-margin basis. Break-even only becomes a meaningful question once a **fixed**
cost is added — e.g., a dedicated monitoring service, paid support staff, or
managed backup storage with a fixed monthly floor:

```
Break-even subscribers = Fixed costs/mo ÷ Gross margin/subscriber/mo
                       = Fixed costs/mo ÷ $7.50
```

Worked examples once a fixed cost exists:

| Fixed cost/mo | Break-even subscribers |
|---|---|
| $200 (e.g. a small monitoring service) | 27 |
| $500 (e.g. part-time support contractor) | 67 |
| $1,000 | 134 |

## What to revisit once the waitlist has data

- Replace the $0-CAC assumption once any spend (ads, sponsorships, affiliate) targets Station Ops specifically.
- Replace the 30 min/month support-time guess with actual measured support minutes per subscriber.
- Replace the 5% churn placeholder with the first real cohort's actual churn once ~3 months of subscriber history exists.
- Add a real hosting-cost line item once backup storage or monitoring infrastructure has an actual bill attached to it.
