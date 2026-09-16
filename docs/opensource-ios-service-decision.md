# Paperweight: Open-Source + iOS App Service Decision

**Date:** September 15, 2026
**Context:** Inspired by Rolling Woods Radio’s experience with Radio.co, which hosted the station and offered a paid add-on to deploy/maintain a dedicated iOS app.

## The Idea

Open-source the Paperweight core platform, then offer a subscription-based service to deploy and manage iOS apps for stations/creators running Paperweight — similar to Radio.co’s model.

## Why It Fits Paperweight’s Positioning

- Paperweight’s core pitch is ownership-first: no platform cut, full audience data ownership.
- Open-sourcing **strengthens** this rather than undercutting it — it’s not just a promise not to take a cut, it removes the ability to ever force one. That’s a stronger trust signal than closed-source with a policy.
- The revenue model shifts from platform fees to a **managed service fee** (iOS deployment/maintenance), which is a different, complementary business rather than a competing one.

## What Made Radio.co’s iOS Add-On Valuable

- Apple’s $99/yr developer account and App Store review process are a real pain point for non-technical station owners.
- Per-station white-labeled apps multiply ops burden: separate code signing, provisioning profiles, and review resubmissions per customer, per iOS update.
- People will pay $20–50/mo to avoid that friction.

## Key Design Decision: One Shared App vs. Per-Station White-Label

**Shared app (recommended default):**

- One Paperweight-branded iOS app with station-switching inside it (Twitch/Discord-style multi-community access).
- Avoids the N-certificates/N-resubmissions problem entirely.
- Much cheaper to operate — could underprice Radio.co significantly and still hold healthy margin.
- **Risk:** Apple review is per-app. One bad-actor station’s content could jeopardize the shared listing for everyone on it. Requires real content moderation, not just legal boilerplate.

**Per-station white-labeled app (premium tier):**

- Own name, own icon, own App Store listing.
- Reintroduces the full per-station ops burden (this is what Radio.co actually did).
- Should be priced much higher to reflect that burden if offered at all.

**Update (2026-09-15):** This is no longer purely hypothetical — `mobile/`
(the Expo/React Native companion app) already implements the shared-app
architecture described above. `DiscoverScreen` + System.Pape's directory
handle station discovery, `stationStore` handles switching/persisting the
current station, and auth tokens are scoped per-station by base URL. 5 of 8
build phases are done and partially hardware-verified. Converting it to
native Swift was considered and rejected: the one real open risk (background/
lock-screen audio not surviving past ~15-40s, still being root-caused) reads
like a fixable native-session-activation bug, not an Expo/React Native
ceiling, and a rewrite would drop Android support and discard verified work
for no clear architectural gain. Staying on Expo/React Native also keeps the
"underprice Radio.co and still hold margin" math intact — one codebase, one
EAS Build pipeline, not per-platform native teams.

## Standard Policy Approach

- A single, standard App Store policy / clickwrap ToS that all users accept at signup, covering acceptable use, content liability, and pass-through of Apple’s guidelines.
- Solves the legal/consistency side cleanly.
- Does **not** solve the shared-app moderation risk above — that needs a separate content policy and enforcement plan.

## Subscription Gate: Directory Listing, Not App Distribution

**(Added 2026-09-15.)** The mechanism for gating the paid iOS-app service
doesn't need new infrastructure — it falls out of what already exists:

- **System.Pape stays closed.** It already is: `docs/system-pape-contract.md`
  describes it as Paperweight Systems' own separate, centrally-run control
  plane that self-hosted stations phone telemetry into. "Keep System.Pape
  closed" is confirming an existing boundary, not making a new one — the
  station server (this repo) is what gets open-sourced, System.Pape does not.
- **Today's gap:** the `station_searchable` opt-in (`src/db/settings.js`,
  set/read in `src/api/dashboard.js`, reported in `src/telemetry/reporter.js`)
  is a single free, self-serve toggle that feeds *both* the public web
  directory (`landing/listen.html`) and, per `mobile/DESIGN-SPEC.md`, the
  mobile app's Discover tab — via the same System.Pape `/stations` and
  `/directory` endpoints. There's no distinction today between "listed on the
  web" and "listed in the paid app."
- **The gate:** split these into two independent signals. Free web-directory
  listing stays free and self-serve, unchanged. Mobile-app listing eligibility
  becomes a second, System.Pape-side field driven by real subscription/billing
  status — computed and enforced **server-side, inside the closed control
  plane**, not a client-set flag. This matters specifically because the
  station server is open source: any gate implemented there is patchable by
  the person running it, so the enforcement boundary has to live in the one
  piece of infrastructure that stays proprietary.
- **Why this is the right gate, not per-app distribution:** it sidesteps the
  N-certificates/per-station white-label ops burden entirely — the toggle
  lives at the directory-listing layer of one already-shared app and one
  already-shared backend service, not per-customer app distribution.
- **Synergy with moderation:** the same eligibility/de-listing lever doubles
  as the content-moderation enforcement point flagged as unsolved below — a
  bad-actor station is pulled from the shared app the same way a non-
  subscriber is excluded from it. One mechanism, two jobs.
- **Accepted tradeoff:** since the station server is open source, a determined
  self-hoster could in principle stand up a competing directory service and a
  competing app pointed at it. At that point they're building a competing
  product, not skipping a fee — normal open-core exposure, not a gap in this
  plan.

## Open Questions / Next Steps

- ~~Shared-app architecture: station switching, auth, how a listener finds
  "their" station.~~ **Largely resolved** — `mobile/` already implements this
  (Discover tab, `stationStore`, per-station-scoped auth). Remaining
  architecture work is polish (Phase 8: store-readiness) and the background-
  audio bug above, not open design questions.
- System.Pape-side design: the exact subscription/eligibility field shape and
  API surface (new field on `/stations`/`/directory`, a query param, or
  parallel paid-eligible endpoints) — depends on System.Pape's existing
  subscription/billing model, not yet reviewed in this session.
- Whether/how the mobile app's directory client (`mobile/src/api/systemPape.ts`)
  needs to change to request the paid-eligible list specifically.
- Content moderation *workflow* on top of the de-listing mechanism: who
  reviews, what triggers a takedown, appeal process.
- Pricing for shared-app tier vs. (optional) white-label tier.
- Legal drafting of the standard ToS/clickwrap.

## Status

Directional decision made: open-source the core, pursue the iOS-app-as-a-service
model with a standard shared-app + standard policy approach as the default
tier. Shared-app architecture is substantially de-risked by existing `mobile/`
code (station switching, auth, discovery all built; staying on Expo/React
Native, not converting to Swift). The subscription-gate mechanism is now
identified — subscription-gated directory-listing eligibility, enforced
server-side in System.Pape — as the next concrete design/build item, alongside
the moderation workflow and legal drafting still to be worked out.
