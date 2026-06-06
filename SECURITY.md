# Security

Paperweight is designed as a self-hosted creator station. It is not a multi-tenant SaaS service.

## Trust Model

- The creator controls the machine running Paperweight.
- The dashboard is protected by a single shared **owner/admin** token
  (`DASHBOARD_TOKEN`). This is owner auth, not per-user team auth — anyone with
  the token has full control. Do not hand it out as if it were a team account.
- Listener accounts are separate from dashboard access.
- Listener access uses an httpOnly `pw_token` cookie or a Bearer token for mobile clients.
- SQLite is local to the station.

## Startup Warnings

The server inspects its configuration at boot and prints loud warnings (it never
aborts) when a public deployment is likely misconfigured:

- `DASHBOARD_TOKEN` unset — a temporary token is generated each restart.
- `DOWNLOAD_SIGNING_SECRET` unset — signed download links break on restart.
- `HTTPS=false` while `STATION_PUBLIC_URL` is a public address — cookies are sent
  without the `Secure` flag and traffic is unencrypted.
- Stripe or PayPal partially configured, or configured without webhook
  verification — paid access will silently fail to be granted.

Treat these warnings as release blockers for a public station.

## Production Requirements

- Use HTTPS for public stations.
- Set `HTTPS=true` when running behind TLS so cookies use the `Secure` flag.
- Keep `.env` private.
- Use a permanent `DOWNLOAD_SIGNING_SECRET` in `.env`.
- Do not expose the dashboard token in screenshots, logs, or support messages.
- Back up `data/paperweight.db` before upgrades.

## Dashboard Auth

Dashboard routes require `X-Dashboard-Token`.

In the browser, the token is held in `sessionStorage` only — it is never written
to `localStorage`/disk and is cleared when the tab closes, so a shared or kiosk
browser does not retain owner access between sessions.

The listener cookie does not grant dashboard access. Dashboard access does not depend on listener accounts.

## CSRF

Unsafe browser requests carrying `pw_token` are checked against Origin or Referer. Bearer-token clients bypass this because they do not use browser cookies.

## Payment Webhooks

Stripe webhooks are verified with `STRIPE_WEBHOOK_SECRET`.

PayPal webhooks are verified with PayPal's webhook signature verification endpoint before access is granted.

Do not enable a payment provider without configuring its webhook secret or webhook ID. The server warns at startup if you do.

Webhook handling is idempotent: a provider event that has already been handled
(or deliberately skipped) is acknowledged without re-running its side effects, so
retried or duplicated deliveries do not double-grant access. Events that errored
remain retryable.

## File Uploads

Dashboard uploads require the dashboard token, are restricted to audio and video MIME types, and are written under the configured vault path.

Uploaded filenames are sanitized (path components, control characters, and
shell/filesystem-hostile characters are stripped). An uploaded file is recorded
as inactive and is **not playable or indexed until `ffprobe` succeeds** on it, so
a corrupt or unprobeable upload never reaches listeners.

The server depends on FFmpeg and ffprobe to inspect and stream media. Treat uploaded media as untrusted input and keep FFmpeg updated.

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
