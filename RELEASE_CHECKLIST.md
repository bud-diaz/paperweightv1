# Release Checklist

Use this before publishing Paperweight for public distribution.

## Required Environment

- Node.js 18 or newer is installed.
- `npm install` has completed successfully.
- FFmpeg and ffprobe are installed and available on `PATH`.
- `.env` exists and has a permanent `DASHBOARD_TOKEN`.
- `DOWNLOAD_SIGNING_SECRET` is set for public stations.
- The vault path exists and contains the expected category folders.

## Required Gate

Run:

```bash
npm run release:check
```

Expected result:

- Release cleanliness check passes.
- Unit and HTTP tests pass.
- Preflight has no `FAIL` items.
- Migration, scheduler, analytics, and package checks pass.
- `npm audit --omit=dev` reports zero production vulnerabilities.

## Platform Smoke Passes

Run the install/start/smoke path on each supported platform before public release:

- Windows 10/11 x64
- macOS
- Linux x64
- Raspberry Pi OS 64-bit or Ubuntu on Raspberry Pi

For each platform:

1. Run the platform installer.
2. Run `bash scripts/setup.sh`.
3. Run `npm run preflight`.
4. Start Paperweight with `npm start`.
5. Run `npm run smoke`.
6. Verify the dashboard rejects a missing/wrong token.
7. Verify the dashboard accepts the token from `.env`.
8. Add a small audio file and confirm it indexes.
9. Confirm the library shows public media.
10. Confirm `supporters_only` and `vault` media are gated for free listeners.

## Public Station Checks

- Public URL resolves to the station.
- HTTPS terminates before Paperweight.
- `.env` has `STATION_PUBLIC_URL` and `HTTPS=true`.
- Stripe is not partially configured.
- PayPal is not partially configured.
- Payment webhooks show successful verification in dashboard logs after a test event.

## Convenience Executable Packaging

Executables are optional convenience artifacts, not the primary public distribution path.

```bash
npm run build:exe
```

Do not publish executable artifacts unless the same platform has passed the clean-folder smoke test.

## Do Not Ship If

- `npm run release:check` fails.
- FFmpeg or ffprobe are missing on a target platform.
- Any setup guide is stale or untested.
- Runtime frontend depends on a CDN.
- Payment provider configuration is partial.
- The dashboard token appears in screenshots, logs, or support material.
