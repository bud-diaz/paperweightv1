# Paperweight Business Model

This document is the reviewed and revised version of the original ecosystem pitch. It keeps
the parts that hold up, cuts the parts that don't match what's actually shippable in the next
12 months, and resolves the open risks the original draft left silent. Pair this with
`Paperweight_ROADMAP.md` (feature sequencing) and `docs/PRODUCT_OVERVIEW.md` (what ships today).

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

## Near-term priority (next 12 months)

Everything else in the original pitch is reclassified as **Future** (see below). The two
revenue lines worth building now are the two with an existing technical head start:

1. **Paperweight Home** (Raspberry Pi appliance) — builds directly on the existing headless
   exe path (`scripts/build-exe.js`, Linux x64 / Pi ARM64) and the Electron desktop app.
2. **Paperweight Mobile / discovery** — builds directly on the existing station directory
   (`/landing/listen`, `station_searchable`, the Cloudflare-tunnel reachability check in
   `src/runtime/cloudflare.js` and `src/api/dashboard.js`).

Lab, Broadcast, OS image, Premium Themes, Plugin Marketplace, Commercial Licensing,
Enterprise, Cloud, white-label, and certified-hardware-partner are real future opportunities,
but each implies its own go-to-market motion (manufacturing/support for hardware, an
enterprise sales team for LDAP/SSO, a security review for third-party plugin code). Sequencing
all of them alongside Home/Mobile understates how different those businesses are from the one
that exists today.

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

**Now / near-term:**
- Paperweight (free software) — adoption driver, unchanged.
- Paperweight Home (Pi appliance).
- Paperweight Mobile (listener discovery app).
- Donations.

**Future (unsequenced, revisit after Home + Mobile prove out):**
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
