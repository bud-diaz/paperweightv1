# Security

Paperweight is a self-hosted, creator-first streaming and distribution server. It is designed for one station owner or a small trusted team, not for untrusted creators sharing one hosted instance.

## Trust Model

- The creator controls the machine running Paperweight.
- The dashboard is protected by a shared owner token in `DASHBOARD_TOKEN`.
- Listener accounts are separate from dashboard access.
- Listener access uses an httpOnly `pw_token` cookie or a Bearer token for mobile/native clients.
- SQLite data lives locally at `data/paperweight.db`.

## Public Station Requirements

- Put public stations behind HTTPS.
- Set `HTTPS=true` when public traffic is served over TLS so cookies use the `Secure` flag.
- Keep `.env` private.
- Set a permanent `DOWNLOAD_SIGNING_SECRET`; otherwise signed download links break after restart.
- Back up `.env`, `vault/`, and `data/paperweight.db`.

## Dashboard Auth

Dashboard routes require `X-Dashboard-Token`.

This is owner/admin auth, not team account management. Do not share the dashboard token with listeners. Listener cookies never grant dashboard access.

The shipped UI stores the dashboard token for the current browser session only.

## CSRF

Unsafe browser requests carrying `pw_token` are checked against Origin or Referer. Bearer-token clients bypass this check because they do not use browser cookies.

## Payments

Stripe webhooks require `STRIPE_WEBHOOK_SECRET`.

PayPal webhooks require `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`.

Do not enable a payment provider without verified webhooks. Payment redirects improve user experience, but webhooks are the authoritative access sync path.

## Uploads And Media

Dashboard uploads are restricted to audio/video MIME types, sanitized, and inspected with ffprobe before they are treated as usable media.

Media files are still untrusted input. Keep FFmpeg updated and avoid running Paperweight as an operating-system administrator/root user after installation.

## Known Limits

- No email verification for listener accounts.
- No password reset flow.
- Dashboard auth is a shared token, not named creator accounts.
- Analytics are approximate and based on player pings.
- One station per install.

## Reporting Issues

Before sharing logs, remove:

- Dashboard tokens
- Stripe and PayPal secrets
- Listener tokens
- Public tunnel tokens
- Private station URLs if sensitive
