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

## Standard Policy Approach

- A single, standard App Store policy / clickwrap ToS that all users accept at signup, covering acceptable use, content liability, and pass-through of Apple’s guidelines.
- Solves the legal/consistency side cleanly.
- Does **not** solve the shared-app moderation risk above — that needs a separate content policy and enforcement plan.

## Open Questions / Next Steps (not yet decided)

- Shared-app architecture: station switching, auth, how a listener finds “their” station.
- Content moderation policy and enforcement for the shared-app tier.
- Pricing for shared-app tier vs. (optional) white-label tier.
- Legal drafting of the standard ToS/clickwrap.

## Status

Directional decision made: open-source the core, pursue the iOS-app-as-a-service model with a standard shared-app + standard policy approach as the default tier. Architecture and moderation details still to be worked out.
