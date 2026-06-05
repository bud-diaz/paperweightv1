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

For SQLite, stop the server before copying `data/paperweight.db`, or use SQLite backup tooling if you need hot backups.

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
