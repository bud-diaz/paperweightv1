# Release Checklist

Use this before publishing Paperweight for public distribution.

## Required Environment

- Node.js 20 or newer is installed.
- `npm install` has completed successfully.
- FFmpeg and ffprobe are installed and available on `PATH`.
- `.env` exists and has a permanent `DASHBOARD_TOKEN`.
- `DOWNLOAD_SIGNING_SECRET` is set for public stations.
- The vault path exists and contains the expected category folders.

For source installs, set both secrets in `.env` explicitly. A packaged exe with no
`.env` generates both on first run and writes them back so they persist; treat the
generated `DASHBOARD_TOKEN` printed on first launch as sensitive.

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

Run the install/start/smoke path on each supported platform before public release.

Linux x64 and Raspberry Pi OS 64-bit / Ubuntu on Raspberry Pi (source install or
pkg exe):

1. Run the platform installer (`scripts/install.sh`).
2. Run `bash scripts/setup.sh`.
3. Run `npm run preflight`.
4. Start Paperweight with `npm start`.
5. Run `npm run smoke`.
6. Verify the dashboard rejects a missing/wrong token.
7. Verify the dashboard accepts the token from `.env`.
8. Add a small audio file and confirm it indexes.
9. Confirm the library shows public media.
10. Confirm `supporters_only` and `vault` media are gated for free listeners.

Windows 10/11 x64 and macOS (Electron desktop app — see "Desktop App Packaging"
below for the build steps and manual QA checklist covering setup wizard,
auto-login, tray, and shortcuts). After the app is running, also work through
steps 5-10 above against its local server.

## Public Station Checks

- Public URL resolves to the station.
- HTTPS terminates before Paperweight.
- `.env` has `STATION_PUBLIC_URL` and `HTTPS=true`.
- Stripe is not partially configured.
- PayPal is not partially configured.
- Payment webhooks show successful verification in dashboard logs after a test event.

## Convenience Executable Packaging (Linux / Raspberry Pi)

Executables are optional convenience artifacts for Linux and Raspberry Pi, not the
primary public distribution path. Windows and macOS ship as the Electron desktop
app instead — see "Desktop App Packaging (Windows / macOS)" below.

Build each target **on its matching OS and architecture** — `better-sqlite3` is a
native module, so a binary built on one platform will not load on another. Use a
clean dependency install so the bundled native matches the target:

```bash
npm ci            # rebuilds better-sqlite3 for this OS/arch
npm run build:exe # runs release:check, then packages this OS/arch to dist/
```

`build:exe` runs the full `release:check` first, so FFmpeg/ffprobe must be on
`PATH` on the build machine (preflight fails otherwise).

Supported explicit targets are `linux-x64` and `linux-arm64` (`pi`). The
`Build Executables` GitHub Actions workflow builds each target on a matching
native runner and uploads the smoke tested artifacts.

### Clean-folder smoke (required before publishing an exe)

Verify the built binary self-bootstraps with nothing beside it:

```bash
npm run smoke:exe   # launches the exe in an empty temp dir and smokes it
```

It confirms the exe, starting from an empty folder, creates its own `.env` (with a
generated `DASHBOARD_TOKEN` and `DOWNLOAD_SIGNING_SECRET`), `data/paperweight.db`,
and `hls_output/stream/`, applies all migrations, and serves the locally-vendored
frontend (`/vendor/hls.min.js`, `/vendor/fonts/fonts.css`) with no CDN. The
generated secrets are written back to `.env`, so they persist across restarts.

Do not publish executable artifacts unless the same platform has passed this
clean-folder smoke.

### Hardware lock

Packaged executables write a `DEVICE_LOCK` fingerprint into `.env` on first
run (derived from a platform-specific stable machine id — Linux
`/etc/machine-id`, macOS `IOPlatformUUID`, Windows registry `MachineGuid` —
hashed with SHA-256; pure Node `os`/`fs`/`crypto`, no network calls). Every
subsequent boot recomputes the fingerprint and refuses to start if it does not
match what is stored in `.env`, printing the exact `.env` path and instructing
the user to delete the `DEVICE_LOCK` line to move the install to new hardware.
This only deters casual copying of the exe + data folder pair — it is not
tamper-resistant against a user willing to read or edit the shipped code, and
is not a security boundary.

Manual QA before publishing: hand-edit `DEVICE_LOCK` in a clean-folder smoke's
`.env` to a bogus value, restart the exe, confirm it exits with code 1 and
prints the hardware-lock-mismatch message; then delete the `DEVICE_LOCK` line
and restart, confirming it boots and re-enrolls.

## Desktop App Packaging (Windows / macOS)

Windows and macOS users install the Electron desktop app, not the pkg
convenience executable. Build it on each matching OS:

```bash
cd electron
npm ci
npm run dist   # rebuilds better-sqlite3 for Electron's ABI, then runs electron-builder
```

This produces an NSIS installer (`electron/dist/*.exe`) on Windows and a DMG +
ZIP (`electron/dist/*.dmg`, `*.zip`) on macOS.

The app is **not code-signed or notarized**. Expect Windows SmartScreen and
macOS Gatekeeper warnings on first run — see TROUBLESHOOTING.md for the
"Run anyway" / "Open Anyway" workaround. Treat signing/notarization as a
follow-up, not a gate for this checklist.

Manual QA before publishing:

1. Install on a clean machine (no prior `.env`/userData folder).
2. Confirm the graphical setup wizard appears and writes `.env`.
3. Confirm the main window opens already logged into the dashboard.
4. Confirm the tray icon appears with "Open Dashboard", "Launch at Login", and
   "Quit Paperweight".
5. On Windows, confirm the installer created a Desktop and Start Menu shortcut.
6. Quit via the tray "Quit Paperweight" and relaunch — confirm it boots straight
   to the main window (no setup wizard) and the station configured in step 2/3
   persists.

## Do Not Ship If

- `npm run release:check` fails.
- FFmpeg or ffprobe are missing on a target platform.
- Any setup guide is stale or untested.
- Runtime frontend depends on a CDN.
- Payment provider configuration is partial.
- The dashboard token appears in screenshots, logs, or support material.
