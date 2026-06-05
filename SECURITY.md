# Security

Paperweight is designed as a self-hosted creator station. It is not a multi-tenant SaaS service.

## Trust Model

- The creator controls the machine running Paperweight.
- The dashboard is protected by a shared dashboard token.
- Listener accounts are separate from dashboard access.
- Listener access uses an httpOnly `pw_token` cookie or a Bearer token for mobile clients.
- SQLite is local to the station.

## Production Requirements

- Use HTTPS for public stations.
- Set `HTTPS=true` when running behind TLS so cookies use the `Secure` flag.
- Keep `.env` private.
- Use a permanent `DOWNLOAD_SIGNING_SECRET` in `.env`.
- Do not expose the dashboard token in screenshots, logs, or support messages.
- Back up `data/paperweight.db` before upgrades.

## Dashboard Auth

Dashboard routes require `X-Dashboard-Token`.

The listener cookie does not grant dashboard access. Dashboard access does not depend on listener accounts.

## CSRF

Unsafe browser requests carrying `pw_token` are checked against Origin or Referer. Bearer-token clients bypass this because they do not use browser cookies.

## Payment Webhooks

Stripe webhooks are verified with `STRIPE_WEBHOOK_SECRET`.

PayPal webhooks are verified with PayPal's webhook signature verification endpoint before access is granted.

Do not enable a payment provider without configuring its webhook secret or webhook ID.

## File Uploads

Dashboard uploads are restricted to audio and video MIME types and written under the configured vault path.

The server still depends on FFmpeg and ffprobe to safely inspect and stream media. Treat uploaded media as untrusted input and keep FFmpeg updated.

## Known Limits

- No email verification for listener accounts.
- No password reset flow.
- Dashboard auth is a shared token, not a named creator account.
- Analytics are approximate and based on player pings.
- This is intended for a single station owner, not untrusted creators sharing one server.

## Reporting Issues

Before sharing logs, remove:

- Dashboard tokens
- Stripe and PayPal secrets
- Listener tokens
- Public tunnel tokens
- Private station URLs if sensitive
