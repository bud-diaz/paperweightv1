# Paperweight Roadmap

This document is aspirational. It describes possible future directions beyond the current self-hosted release.

## The Wedge

The easiest way for independent audio creators to operate an owned, always-on station and sell directly to listeners.

**Initial customer**: independent radio shows and music collectives with an existing audience and catalog — not creators starting from zero.

**What we market**: only the three features that win the wedge — an always-on station, an owned audience, and direct monetization. Every other shipped feature keeps working, but it is not the pitch.

**What stays permanent**: the self-hosted core is free, and the creator-sales fee stays 0%. Station Ops (see `docs/BUSINESS_MODEL.md`) is an optional paid layer on top, never a toll on the core.

## Six-Month Freeze (see `docs/BUSINESS_MODEL.md` for full rationale)

No further work or roadmap movement on the following until the freeze lifts:

- Mobile apps (listener or creator/dashboard)
- Manufactured/certified hardware
- Plugin architecture / marketplace
- Enterprise features (LDAP/SSO/audit, etc.)
- White-label

This supersedes this document's own "Future Directions" list below where it previously named Mobile listener app / creator mobile dashboard / plugin architecture as active near-term lines — they are frozen, not near-term, for now.

Hardware (Paperweight Home, the Pi appliance) is treated as a later **distribution channel** for the existing headless build (`scripts/build-exe.js`), not a primary business line — it is not part of the freeze list above since it ships no new product surface, only a packaging target that already exists.

## Current Public Release

Paperweight currently ships as a self-hosted, creator-first streaming and distribution server:

- local media vault
- continuous HLS stream
- live mic broadcast from the dashboard
- web listener player
- creator dashboard
- public/supporter/vault visibility
- listener accounts and creator-issued tokens
- optional TOTP 2FA on dashboard login
- optional Stripe/PayPal monetization

The current release is one station per install. It is not a managed cloud platform, mobile app suite, plugin ecosystem, or multi-tenant SaaS.

## Near-Term Hardening

- Better HTTP integration coverage.
- More platform smoke tests.
- Clearer install flows for Windows, macOS, Linux, and Raspberry Pi.
- More explicit payment webhook diagnostics.
- Optional native executable artifacts once each target has native CI and smoke coverage.

## Future Directions

These are not shipped today:

- Managed hosting for creators who do not want to run hardware.
- Mobile listener app.
- Creator mobile dashboard.
- Station directory and discovery.
- Plugin architecture.
- Expanded analytics.
- Migration tools between self-hosted and managed installs.

Paperweight's core commitment remains creator ownership: the self-hosted path should stay real even if managed services are added later.
