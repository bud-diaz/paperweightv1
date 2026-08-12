# Paperweight Business Model

This document is the reviewed and revised version of the original ecosystem pitch. It keeps
the parts that hold up, cuts the parts that don't match what's actually shippable in the next
12 months, and resolves the open risks the original draft left silent. Pair this with
`Paperweight_ROADMAP.md` (feature sequencing) and `docs/PRODUCT_OVERVIEW.md` (what ships today).

**This section supersedes the "Near-term priority" and "Revenue streams" sections below where
they conflict** — those sections predate the decisions here and still frame Paperweight Mobile
as a near-term line; it is now frozen (see Freeze, below).

## The Wedge

One sentence: **the easiest way for independent audio creators to operate an owned, always-on
station and sell directly to listeners.**

**Initial customer**: independent radio shows and music collectives that already have an
audience and a catalog — they feel the "algorithm platform" pain today and can be broadcasting
within the 10-minute activation target immediately, unlike a creator starting from zero.

**Permanent commitments**:
- The self-hosted core stays free, forever. No license fee to run it.
- The creator-sales fee stays 0% — Paperweight never takes a cut of tips, subscriptions, or
  vault unlocks. (Confirmed: no fee-taking logic exists anywhere in the Stripe/PayPal payment
  paths — `src/api/payments.js` and related webhook handlers pass the full amount through.)
- Station Ops (see below) is the one paid product, and it is optional infrastructure/support on
  top of the free core, never a toll on using the core.

**What we market**: only the three features that win the wedge — always-on station, owned
audience, direct monetization. Every other shipped feature (device pairing, offline saves,
smart playlists, etc.) keeps working and keeps shipping bug fixes, but none of it is the pitch
for the next six months.

## Six-Month Freeze

No new work and no roadmap movement on these until the freeze lifts (tracked from the date this
section was added):

- Mobile apps (the roadmapped "Paperweight Mobile" listener/discovery app and any creator mobile
  dashboard — distinct from the already-shipped in-app Studio device-pairing feature, which is
  existing functionality, not new work, and is unaffected).
- Manufactured/certified hardware (Lab, Broadcast, Certified Hardware Partners, Accessories).
- Plugin architecture / marketplace.
- Enterprise (LDAP/SSO/audit, etc.).
- White-label.

**Hardware as a distribution channel, not a business**: Paperweight Home (the Raspberry Pi
appliance) is reclassified as a later packaging/distribution channel for the existing headless
build (`scripts/build-exe.js`, Linux x64 / Pi ARM64) — not a primary business line, and not part
of the freeze above, since it introduces no new product surface beyond an existing build target.

## Station Ops — the one thing we're testing now

A $29/month optional service, layered on the free self-hosted core: managed public URL,
monitoring, automated updates, encrypted backup, and priority support. Scope for the initial
test (see `docs/STATION_OPS_MODEL.md` for the CAC/margin model): a waitlist to gauge demand,
plus the backup-encryption and basic monitoring pieces that are cheap to build on top of
existing infrastructure (`scripts/backup.js`, `src/runtime/net-guard.js`) — not full managed
fulfillment yet.

## Positioning

"Own your server, get effortless discovery, keep built-in monetization" is a real gap versus
the field:

- Spotify/Apple Music/SoundCloud: discovery and monetization, no self-hosting, no creator
  ownership.
- Plex/Jellyfin/Navidrome: self-hosting, no discovery, no built-in monetization.
- Paperweight already ships tips, subscriptions, vault pay-what-you-want unlocks, and
  token-gated access on top of a self-hosted station — that combination doesn't exist
  elsewhere today. This is the actual moat, not the hardware or the marketplace.

## What "no centralized platform" actually means

The brand promise is "own your platform," but discovery (the station directory), the plugin
marketplace, and Paperweight Cloud all require Paperweight-run central infrastructure. The
honest version of the pitch: **media, audience data, and payments stay on the creator's own
server — full stop.** Discovery and marketplace are optional, centralized *services* layered
on top, and a creator can walk away from them without losing anything that matters. Message it
that way instead of implying zero central component; it's a stronger and more defensible claim
than the original framing.

## Near-term priority (next 6 months) — superseded by the Freeze above

**Update**: this section originally named Paperweight Home and Paperweight Mobile as the two
near-term revenue lines. Mobile is now frozen for six months (see Freeze, above) — it is not
being built or sequenced right now, regardless of its technical head start. Home survives, but
reclassified as a distribution channel rather than a revenue line in its own right (see above).
The actual near-term priority for these six months is Station Ops (above) plus the activation
and instrumentation work needed to make the free core convert well on its own.

Lab, Broadcast, OS image, Premium Themes, Plugin Marketplace, Commercial Licensing,
Enterprise, Cloud, white-label, and certified-hardware-partner are real future opportunities,
but each implies its own go-to-market motion (manufacturing/support for hardware, an
enterprise sales team for LDAP/SSO, a security review for third-party plugin code). All of them
are outside the six-month freeze window; none are sequenced yet.

## Station reliability (Mobile discovery)

Home-hosted stations will go offline — router reboots, ISP hiccups, power loss. The plan:

- **Now:** the Mobile app caches last-known station metadata (name, now-playing, artwork) and
  shows an explicit "station offline" state instead of a blank failure when a station can't be
  reached. This is a client-side UX problem, solvable without new server infrastructure.
- **Later:** an optional Paperweight Cloud relay tier can keep a station's public
  surface reachable (cached feed data, maybe a stream relay) even when the creator's own
  machine is briefly down — strictly opt-in, never required, consistent with "the creator's
  local server remains the source of truth."

## Content responsibility & licensing

Public-performance licensing (ASCAP/BMI/SoundExchange-style) is a real exposure for the
Broadcast tier's commercial-venue targets (coffee shops, retail, churches). Resolution:
responsibility is contractually pushed to the creator/operator, not absorbed by Paperweight.

- `CONTENT RESPONSIBILITY.txt` already states this (no content verification, user owns
  licensing/performance rights, indemnification) and is already surfaced via the dashboard's
  first-launch acceptance flow and the `/landing/content-responsibility` page linked from
  the download and license landing pages.
- Decision: this acknowledgment and the licensing docs should also ship as literal files
  inside every download package (Home/Lab/Broadcast appliance images, the Electron installers,
  the headless exe), not only as a web page and an in-app checkbox.
- **Gap today:** `electron/package.json`'s `extraResources` and `scripts/build-desktop-runtime.js`
  stage `src`, `node_modules`, and `package.json` into the installer, but do not currently copy
  `CONTENT RESPONSIBILITY.txt`, `LICENSE.txt`, or `THIRD-PARTY NOTICE.txt` into the packaged
  output. Same gap likely applies to `scripts/build-exe.js`. This is a small follow-up, not
  designed yet — flagging it here so it isn't lost.

## Hardware tiers vs. software capability

Decision: hardware tiers (Home/Lab/Broadcast) reflect **performance only** — faster CPU, more
RAM/storage, higher concurrent-listener headroom from raw capacity. They do **not** gate
software capability (multi-account support, listener caps, feature availability) that a
hobbyist could otherwise run for free on their own hardware. This keeps "software remains free
forever" true in practice, not just in messaging. Revisit only if a specific software-side
capability turns out to require its own paid tier for reasons unrelated to hardware — not the
default assumption.

## Plugin marketplace: security design, not a store-front decision

Marked **Future**, not near-term. Before this ships, third-party plugin execution needs an
actual permission/sandboxing model — plugins running in-process against a server that already
handles payment idempotency, tokens, and vault access is a security problem before it's a
commission-rate problem. No commitment to a design yet; flagged so it isn't skipped when this
line item eventually gets prioritized.

## Revenue streams — revised sequencing

**Now / near-term (next 6 months):**
- Paperweight (free software, 0% creator-sales fee) — adoption driver, unchanged.
- Station Ops ($29/mo, waitlist + backup/monitoring test — see above).
- Donations.
- Paperweight Home (Pi appliance) continues shipping as a distribution channel, not a
  standalone revenue push.

**Frozen for six months (no work, no roadmap movement):**
- Paperweight Mobile (listener discovery app).
- Plugin Marketplace.
- Enterprise.
- White label.
- Certified Hardware Partners / manufactured hardware generally.

**Future (unsequenced, revisit after the freeze lifts and Station Ops proves out):**
- Paperweight Lab / Broadcast (professional & commercial hardware).
- Paperweight OS (downloadable appliance image).
- Premium Themes.
- Plugin Marketplace (blocked on the sandboxing design above).
- Commercial Licensing.
- Enterprise (LDAP/SSO/audit — implies a sales motion this team doesn't have yet).
- Paperweight Cloud (managed hosting / always-on relay).
- White label.
- Certified Hardware Partners — likely comes *before* Paperweight manufacturing its own
  Lab/Broadcast hardware, not after, since partnering avoids inventory/support/margin risk
  the original draft didn't account for.
- Accessories.
