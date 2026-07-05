# Operations

Paperweight is a self-hosted, single-machine station. Treat the machine running it as the production environment.

## Important Paths

- `.env`: station configuration and secrets.
- `vault/`: creator media files.
- `data/paperweight.db`: SQLite database.
- `logs/`: PM2 and application logs.
- `hls_output/`: generated HLS stream segments and previews. This is disposable.

When packaged as an executable, these paths live next to the `.exe`.

## Backup

Back up these regularly:

- `.env`
- `vault/`
- `data/paperweight.db`

Do not bother backing up `hls_output/`; it is regenerated.

For the database, use the built-in hot backup (safe while the server is running — it uses SQLite's online backup API):

```bash
npm run backup                       # writes data/backups/paperweight-<timestamp>.db
node scripts/backup.js --keep=30     # keep more history (default keeps 14)
```

The dashboard's STATION section also has a **DB BACKUP** button that downloads a consistent snapshot through the browser. Schedule `npm run backup` with cron/Task Scheduler for unattended installs, and copy `data/backups/` somewhere off the machine.

Copying `data/paperweight.db` by hand is still fine — but stop the server first if you do it that way.

## Restore

1. Install Node.js and FFmpeg, or place the packaged executable on the target machine.
2. Copy `.env`, `vault/`, and `data/paperweight.db` into the Paperweight root.
3. Run `npm run preflight`.
4. Start the server.
5. Open `/api/health` and the dashboard.

## Updating

Before updating:

1. Stop Paperweight.
2. Back up `.env`, `vault/`, and `data/paperweight.db`.
3. Apply the new code or replace the executable.
4. Run `npm run check:migrations` in source installs.
5. Start Paperweight and verify `/api/health`.

Migrations are tracked in the `schema_migrations` table. SQL migration files should be applied once, then left alone.

## Payments

Stripe:

- Set `STRIPE_SECRET_KEY`.
- Set `STRIPE_WEBHOOK_SECRET`.
- Set the configured price IDs for the tiers you enable.
- Configure Stripe webhooks to call `/api/payment/webhook/stripe`.

PayPal:

- Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`.
- Configure PayPal webhooks to call `/api/payment/webhook/paypal`.
- Paperweight verifies PayPal webhook signatures before granting access.

Payments are disabled when the relevant provider variables are blank.

Listeners with an active subscription can cancel it themselves from the player's ACCOUNT panel; Stripe subscribers also get a MANAGE BILLING button that opens the Stripe billing portal (enable the portal once in the Stripe dashboard under Settings → Billing → Customer portal).

## Email (SMTP)

Optional. When configured, Paperweight can email password reset links to listeners and (per post, opt-in) email new posts to active supporters. Add to `.env`:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587            # default 587 (465 when SMTP_SECURE=implicit)
SMTP_SECURE=starttls     # starttls (default) | implicit | none
SMTP_USER=you@example.com
SMTP_PASS=app-password
SMTP_FROM="My Station <station@example.com>"
```

Without SMTP, password recovery still works: the dashboard's NOTIFICATIONS & FEED section can generate a one-hour reset link for any listener account, which you hand to the listener over your own channel.

## Notifications and RSS

- A Discord-compatible webhook URL can be set in the dashboard (NOTIFICATIONS & FEED). It announces go-live and new posts.
- The RSS/podcast feed is off by default. Enabling it publishes PUBLIC media (podcasts category or all public items, your choice) at `/feed.xml` with downloadable enclosures. Gated media never appears in the feed.
- `/embed` is a small frameable player page for embedding the live stream on external sites; copy the iframe snippet from the dashboard or the player's share panel.

## Dashboard Token

The dashboard uses the `X-Dashboard-Token` header. The token is stored in `.env` as `DASHBOARD_TOKEN`.

If lost:

```bash
grep DASHBOARD_TOKEN .env
```

On Windows Git Bash:

```bash
grep DASHBOARD_TOKEN /c/path/to/paperweight/.env
```

## FFmpeg

FFmpeg and ffprobe must be available on `PATH`.

Windows:

```powershell
winget install Gyan.FFmpeg
```

Linux:

```bash
sudo apt install ffmpeg
```

macOS:

```bash
brew install ffmpeg
```

Restart your terminal after installing.
