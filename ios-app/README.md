# Paperweight iOS (discovery hub app)

A native iOS wrapper, built with [Capacitor](https://capacitorjs.com/), around
Paperweight's public station directory. This is **one generic app**, not a
per-station build: it searches the public directory
(`https://system.paperweighthq.com/api/modules/paperweight/stations`) for any
station that has opted into `station_searchable`, and plays a selected
station via that station's own `/embed` mini player loaded in an iframe. See
`docs/system-pape-directory.md` for the directory API contract and
`docs/BUSINESS_MODEL.md` ("Paperweight Mobile / discovery") for the product
framing this app implements.

It does **not** expose the creator dashboard, and it does **not** support
subscriber-tier/vault-gated listening — `/embed` is the public live-stream-only
player (see `client/js/embed.js`). Those are explicitly out of scope for this
app; see the "Out of scope" section below.

## Prerequisites

- A Mac with Xcode (latest stable) and its Command Line Tools installed.
- [CocoaPods](https://cocoapods.org/): `sudo gem install cocoapods` or `brew install cocoapods`.
- Node.js ≥ 20 (matches the root project's `engines.node`).
- An Apple ID signed into Xcode. A free account is enough to build and run on
  the Simulator or your own device for 7 days at a time; a paid Apple
  Developer Program membership ($99/yr) is required to archive for
  TestFlight/App Store distribution.

None of the steps below require network access to a running Paperweight
station — the app only ever talks to the public directory API and whichever
station's public `/embed` URL a user selects at runtime.

## First-time setup

```bash
cd ios-app
npm install
npx cap add ios          # generates ios/App/App.xcodeproj — requires Xcode/CocoaPods, run this on a Mac
npm run icons             # generates build/AppIcon.appiconset/ from assets/branding
```

Copy the generated icon into the Xcode project (only needs doing once, or
whenever the source logo changes):

```bash
cp -R build/AppIcon.appiconset/. ios/App/App/Assets.xcassets/AppIcon.appiconset/
```

```bash
npx cap sync ios
npx cap open ios          # opens the project in Xcode
```

## One-time manual native edits

Capacitor doesn't template these — add them once to the generated project.

**`ios/App/App/Info.plist`** — enable background audio:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

**`ios/App/App/AppDelegate.swift`** — activate the playback audio session in
`applicationDidFinishLaunching`, so streaming keeps playing with the screen
locked or the app backgrounded:

```swift
import AVFoundation
// ...inside application(_:didFinishLaunchingWithOptions:), before `return true`:
try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
try? AVAudioSession.sharedInstance().setActive(true)
```

Lock-screen / Control Center now-playing metadata and transport controls come
from the Media Session API wiring already shipped in `client/js/embed.js`
(runs inside the station iframe) — no further native work needed for that.

## Running

- **Simulator**: select any iOS Simulator target in Xcode and press ⌘R. No
  Apple account needed.
- **Physical device**: select your Team under Signing & Capabilities, plug in
  a device, press ⌘R. A free Apple ID build expires after 7 days; re-run from
  Xcode to refresh it.

Confirm on first launch: the Browse view loads either your recently-played
stations or top public stations, search returns results, selecting a station
plays audio, backgrounding the app keeps it playing, and the lock screen shows
now-playing controls.

## Archiving for TestFlight / App Store

Requires a paid Apple Developer Program membership and an App Store Connect
app record already created under bundle ID `com.paperweighthq.mobile` (or
your own, if you've changed `appId` in `capacitor.config.ts`).

1. In Xcode: Product → Archive.
2. Window → Organizer → Distribute App → App Store Connect → Upload.
3. Fill out the App Store Connect listing (screenshots, description, privacy
   details — the app makes network requests to `system.paperweighthq.com`
   and to whichever station a user selects; disclose this per Apple's privacy
   questionnaire) and submit for review, or add internal/external testers via
   TestFlight first.

## Updating the app icon or bundle ID

- Icon: replace `assets/branding/pape-logo-yt.png` (repo root) or edit the
  render logic in `ios-app/scripts/generate-icons.js`, then re-run
  `npm run icons` and re-copy into `Assets.xcassets` as above.
- Bundle ID / display name: edit `appId`/`appName` in `capacitor.config.json`,
  then `npx cap sync ios`.

## Out of scope (see the implementation plan for reasoning)

- **CI / automated TestFlight upload.** Requires Apple secrets (signing
  certificate, provisioning profile, App Store Connect API key) that aren't
  provisioned anywhere in this repo. This is manual-only for now, mirroring
  how the existing `.github/workflows/build-executables.yml` already leaves
  the macOS Electron build disabled to conserve runner minutes.
- **Creator dashboard on iOS.** This app is listener-facing discovery only.
- **Subscriber-tier / vault-gated listening.** `/embed` is public-stream-only
  by design; unifying per-station listener accounts into one cross-station
  app is a separate, unbuilt design problem.
