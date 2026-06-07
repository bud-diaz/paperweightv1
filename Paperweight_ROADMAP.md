# Paperweight Roadmap

This document is aspirational. It describes possible future directions beyond the current self-hosted release.

## Current Public Release

Paperweight currently ships as a self-hosted, creator-first streaming and distribution server:

- local media vault
- continuous HLS stream
- web listener player
- creator dashboard
- public/supporter/vault visibility
- listener accounts and creator-issued tokens
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
