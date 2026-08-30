# Paperweight: Play — Mobile App Design Spec

**Audience:** UI designer doing a visual redesign of the mobile app.
**Status:** Functional spec of what the app is/does. The current UI (described
in "Current visual baseline" below) is a bare functional scaffold, not a
finished design — it's the starting point to redesign, not a target to
preserve. Everything else in this document (screens, content, states, flows)
is the actual product surface the redesign needs to cover.

For build status and engineering decisions, see `MOBILE-HANDOFF.md` and
`docs/plans/2026-08-17-mobile-app-{scope,implementation-plan}.md` — this
document is the design-facing counterpart, organized by screen instead of by
build phase.

---

## 1. What this app is

"Paperweight: Play" is a companion mobile app (iOS + Android, React Native /
Expo) for **Paperweight**, a self-hosted station platform: each creator runs
their own independent server (their "station") streaming a live broadcast
plus an on-demand media catalog. There is no central Paperweight service —
every station is a separate deployment on a separate host, run by a separate
creator.

The app has two audiences in one shell:

- **Listeners** — discover stations, stream live audio, browse and save an
  on-demand catalog, manage their listener account on whichever station
  they're currently tuned to.
- **Creators** — a lightweight, phone-based remote for their own station:
  live control, quick stats, scheduling, notifications, media upload. Gated
  behind pairing with their own desktop dashboard (QR scan) — this is not a
  general "browse other creators' Studio" surface, it only ever controls the
  one station the phone is paired to.

A single phone can be tuned to only **one station at a time** ("the current
station"), switched via the Discover tab. Play/Stack/Studio all act on
whichever station is currently selected.

## 2. Current build status

So a redesign scopes correctly — what exists today vs. what's still a
placeholder:

| Tab | Status |
|---|---|
| Discover | Built and functional (directory listing, search, station selection, listener login modal) |
| Play | Placeholder screen only — no player UI yet |
| Stack | Placeholder screen only — no catalog/stash UI yet |
| Studio | Placeholder screen only — no pairing/control UI yet |
| Sticky transport bar | Empty/invisible shell, mounted globally, no content yet |

Nothing in Play, Stack, or Studio has real interaction design yet — those are
open canvases functionally, described below by their intended feature set,
not by an existing implementation to match. Discover has real, working
interaction patterns (search-as-you-type, debounce, station selection, empty/
error/loading states) that a redesign should treat as functional requirements
to re-skin, not reinvent.

## 3. Information architecture

Four persistent bottom tabs, plus a sticky transport bar that overlays all of
them, plus modal screens layered on top:

```
Bottom tabs: Discover | Play | Stack | Studio
Persistent:  Sticky transport bar (mini-player) — visible on all 4 tabs
             except when the Play tab's full-player drawer is open
Modals:      Listener login · App settings · Account settings ·
             Studio QR pairing
```

The sticky transport bar and the tab bar coexist — the transport bar sits
just above the tab bar (or is designed as part of the same footer region) and
must not remount or restart audio when switching tabs. This is the app's one
non-negotiable persistent-UI constraint.

## 4. Global chrome

### 4.1 Tab bar

Four tabs, current icon set is Ionicons `compass`/`play-circle`/`layers`/
`options` (filled when active, outline when inactive) — placeholders, free to
redesign. Labels: **Discover, Play, Stack, Studio**.

The equivalent surface on the web dashboard (`studio/`) uses a pill-style
`ModeSwitcher` segmented control rather than a native tab bar
(`studio/src/components/primitives.tsx`) — useful as a reference for the
brand's navigation *personality* (rounded pill, single active-state
highlight), even though the mobile shell uses native bottom tabs, not a pill
switcher.

### 4.2 Sticky transport bar (mini-player)

A persistent mini-player, always mounted, that:
- Shows current track/station art, title, artist, live/on-demand indicator,
  play/pause.
- Is visible across Discover/Stack/Studio at all times, and on Play whenever
  the full-player drawer isn't fully expanded.
- Tapping it (anywhere but the play/pause control) opens the Play tab's full
  drawer.
- Renders nothing (collapses to zero height) when nothing has ever been
  played this session — no "phantom bar" reserving space with no content.

Reference for behavior (not visuals): `studio/src/components/StickyTransport.tsx`
on the web dashboard — same visibility rules (persistent, hidden when its
own full-player view is fully open).

### 4.3 Modals

Listener login, app settings, and account settings are modal/sheet
presentations reachable from Discover. Studio's QR pairing is a modal/full-
screen flow reachable from the Studio tab. Design these as overlays on top of
the tab shell, not as additional tabs.

---

## 5. Screen specs

### 5.1 Discover tab

**Purpose:** find and select a station to tune the rest of the app to; entry
point for listener login and app/account settings.

**Data source:** a cross-station directory hosted by System.Pape (a separate
directory service, not any one station) — `GET /directory` for the default
listing, `GET /stations?q=&limit=` for search. Every station in this list
opted in to being listed; the list can legitimately be empty.

**Content, per station row:**
- Station name
- Live/off-air status (a live badge vs. plain "Off air" label)
- Current listener count
- Now-playing title, when live and available
- Selected-state highlight when this is the app's current station

**Layout, top to bottom:**
1. Screen title ("Discover")
2. Current-station strip — only shown once a station is selected: station
   name + a "Log in" entry point into the listener login modal. This is the
   at-a-glance answer to "what station am I on right now."
3. Search field (live, debounced ~300ms; searching swaps the list from
   "Directory" to "Search results" and changes the empty-state copy
   accordingly)
4. Section label ("Directory" or "Search results")
5. The station list itself

**States to design:**
- Loading (initial load and every re-search)
- Error — directory service unreachable, with a retry action
- Empty, directory mode — "No stations are listed right now — creators opt
  in, so check back." (a normal, expected state, not a failure)
- Empty, search mode — "No stations match that search."
- Populated list, with/without a station already selected

**Interaction:** tapping a row selects that station as current (persists
across app restarts) and highlights it; it does not navigate away from
Discover — a listener can keep browsing/switching stations from here freely.

### 5.2 Play tab

**Purpose:** the primary now-playing experience — full player view for the
current station, live or on-demand.

**Structure:** a slide-up drawer/bottom-sheet that expands from the sticky
transport bar into a full player view. Collapsed state = the sticky transport
bar; expanded state = this full view.

**Full player content:**
- Large art/visual for the current track or live stream
- Track/episode title, artist/creator name
- Play/pause, and for on-demand content: scrub/seek, elapsed/remaining time
- Live indicator when tuned to the live broadcast (no scrub bar in that case
  — it's a live stream, not a seekable track)
- A simplified audio level meter — a lightweight bars/level indicator driven
  by real playback metering, standing in for the web player's frequency
  waveform visualizer (native audio APIs don't expose the same
  frequency-analysis primitive, so this is intentionally a simpler visual,
  not a missing feature)
- Up-next / recently-played list for the current station

**States:** nothing playing yet (empty/prompt state pointing back to
Discover or Stack), loading/buffering, playing, paused, live vs. on-demand,
playback error (e.g. station unreachable mid-stream).

**Platform note relevant to design:** playback must continue in the
background and on the lock screen (phone locked, app backgrounded) — the
lock-screen/notification-shade "now playing" surface (system-rendered on
both iOS and Android, using whatever artwork/title metadata the app
provides) is effectively part of this screen's design surface even though
it's not drawn by the app itself. Make sure track art and title strings are
designed to read well at that system-chrome size too.

### 5.3 Stack tab

**Purpose:** browse the current station's on-demand catalog, and manage a
personal "Stash" of saved tracks.

**Two sections:**

1. **Stack** — the current station's catalog (`GET /api/library/structure`):
   however that station organizes releases/tracks (projects, tracks, tiers/
   pricing where relevant). Tapping a track starts playback (feeds the Play
   tab / sticky transport).
2. **Stash** — tracks the listener has explicitly saved for offline/on-device
   listening, **aggregated across every station they've visited on this
   phone**, not just the current one. This is a cross-station personal
   library, deliberately local-only (no account sync, no backend).

**Save/offline behavior to reflect in the UI:**
- Not every track is saveable — creators can mark individual tracks as
  offline-disallowed. A save action on a disallowed track must be visibly
  blocked/absent, not silently fail.
- Saved tracks should show some storage-used indicator and a way to clear
  the Stash (individually and/or in bulk).
- A saved track from a station the listener isn't currently tuned to should
  still be playable from Stash (that's the point of aggregating cross-
  station) — consider how Stash rows communicate "which station this came
  from" when it's not the current one.

**States:** loading catalog, empty catalog, catalog fetch error, empty Stash
("nothing saved yet"), a saved track that's mid-download vs. fully available
offline.

### 5.4 Studio tab

**Purpose:** a creator's lightweight remote for their own station. Two very
different states: **unpaired** and **paired**.

#### Unpaired state (Studio gate)

- A creator must first be logged into their station's *desktop* web
  dashboard, and pair from there by generating a QR code (existing desktop
  flow, not something this app initiates).
- This screen's job: request camera permission, scan that QR, complete
  pairing.
- Because this requires an external desktop session the reviewer/first-time
  user may not have, **the copy here needs to clearly frame this as an
  optional creator feature**, not a broken/dead-end core tab — this matters
  both for app-store review and for a listener-only user who will never pair
  anything.
- Camera-permission-denied needs a graceful fallback (explanation + a deep
  link to the OS Settings app), not a blank/stuck screen.

#### Paired state (v1 essentials)

Once paired, the tab becomes a small dashboard with a handful of curated
screens (not full parity with the desktop dashboard — deliberately scoped
down):

- **Live / now-playing control** — see and control what's currently
  broadcasting.
- **Quick stats** — an at-a-glance summary (the kind of numbers a creator
  checks from their phone, not a full analytics suite).
- **Release scheduling** — view/manage scheduled releases (media
  `release_at` / post `published_at` — content that's set to go public at a
  future time).
- **Notifications** — view outbound notification activity (the station's
  existing go-live/new-post/media-release webhook events; this is a log of
  what already fired, not a native push-notification inbox).
- **Media upload** — pick a file from the phone and upload it into the
  station's vault, with upload progress. Needs a real progress indicator
  (large media files, sometimes over cellular) and a clear state for
  upload-failed / app-backgrounded-mid-upload.
- **Device / sign-out** — a simple "sign out this device" action. Full
  device revocation management lives on the desktop dashboard's "Authorized
  Devices" panel, not duplicated here — this tab only needs a local
  sign-out.

**States to design across paired screens:** loading each panel's data,
empty states (nothing scheduled, no notification activity yet), a
credential that's been revoked from the desktop side mid-session (the app
should fall back cleanly to the unpaired gate, not error-loop).

### 5.5 Listener login (modal)

Reachable from Discover's current-station strip. Two paths in one modal:
- **Email + password** login against the selected station's listener
  account system.
- **Redeem a creator-issued access token** (a code a creator hands out
  directly, e.g. via Patreon/Discord) — a single code-entry field.

Both apply to whichever station is currently selected; the modal should
block clearly (not silently) if no station is selected yet.

### 5.6 App settings (modal)

Reachable from Discover. Covers:
- Theme / app-level display preferences.
- **Network settings** — this app talks to arbitrary self-hosted stations,
  which aren't always reachable over the open internet (e.g. a creator
  running their station on a home network without a public tunnel). Needs:
  - A deep link into the OS WiFi settings (Android supports jumping straight
    to the WiFi pane; iOS only allows deep-linking to the Settings app root,
    not directly into WiFi — the copy/flow should account for that platform
    asymmetry rather than assuming parity).
  - A manual station URL / LAN IP override, for connecting to a station only
    reachable on the same local network.

### 5.7 Account settings (modal)

Reachable from Discover, scoped to the currently selected station's listener
account:
- Email verification status
- Supporter tier
- Tipping identity (name/email a listener optionally attaches to tips)

---

## 6. Current visual baseline (as-is, not a target)

This is the placeholder token set currently in code
(`mobile/src/constants/theme.ts`) — a starting reference point for a
redesign, not a constraint to preserve unless the designer chooses to:

| Token | Light | Dark |
|---|---|---|
| Background | `#FFFFFF` | `#000000` |
| Background (element/card) | `#F0F0F3` | `#212225` |
| Background (selected) | `#E0E1E6` | `#2E3135` |
| Text | `#000000` | `#FFFFFF` |
| Text (secondary) | `#60646C` | `#B0B4BA` |
| Border | `#E0E1E6` | `rgba(255,255,255,0.12)` |
| Accent | `#E8195C` (pink/red) | `#FF3D71` |
| Accent (soft/tint) | `rgba(232,25,92,0.1)` | `rgba(255,61,113,0.14)` |
| Live indicator | `#1FAE5F` (green) | `#3DDC84` |

Note this accent direction (pink/red) is a deliberate departure from the web
Studio dashboard's own palette (lime/coral) — treated as an intentional
mobile-specific brand choice already, per engineering notes, not an
inconsistency to reconcile. A redesign is free to revisit this, just noting
it wasn't an accident.

Full light/dark mode support is required — the OS-level appearance setting
should be respected (`userInterfaceStyle: automatic` is already configured).

Typography currently falls back to system fonts per-platform (iOS system
font, Android default, no custom typeface loaded yet) — open for the
redesign to specify real type choices. Note the web Studio app self-hosts
its own fonts (Manrope, Space Grotesk, DM Mono) rather than pulling from
Google Fonts, for CSP reasons that don't apply to a native app — no
constraint here, just useful brand-family context if visual continuity with
`studio/` matters.

### Existing brand assets

`mobile/assets/` currently has: an app icon (`icon.png` + an iOS `expo.icon`
icon-composer asset), Android adaptive-icon layers (foreground/background/
monochrome), a splash icon, and a favicon (web export only). Splash
background is currently `#208AEF` (blue) — inconsistent with the pink/red
accent above; likely leftover from the Expo template default rather than a
deliberate choice, worth the designer's attention.

## 7. Platform constraints that affect design, not just engineering

- **Background/lock-screen audio** is a core requirement, not an edge case —
  design the "now playing" metadata (art + title) knowing it also renders in
  system lock-screen/notification-shade chrome outside the app's own UI.
- **Camera permission** (QR pairing) needs a pre-permission explanation
  screen and a denied-state fallback — both are typical app-store review
  friction points.
- **A station can go unreachable** at any time (creator's server offline,
  tunnel down, phone off WiFi with only a LAN override configured) —
  network-error states aren't rare edge cases here, they're a routine part
  of using a self-hosted product across many independent hosts. Every screen
  that fetches from "the current station" needs a real, non-generic
  unreachable-station state, not just a spinner that never resolves.
- **Portrait-only** (`orientation: portrait` currently configured).

## 8. Explicit non-goals for v1

Don't design for these — they're intentionally out of scope for this app
version:
- Full parity with every desktop Studio dashboard view (deep monetization
  config, full post editor, etc.) — only the curated Studio essentials list
  in §5.4.
- Cross-device sync of Stash — it's deliberately per-phone/local-only.
- Native push notifications — the "Notifications" Studio screen is a log
  viewer, not a push inbox.
- Any listener-facing "browse other creators' Studio" surface — Studio is
  strictly the one paired station's own remote.
- A separate mobile-specific station directory — Discover's data always
  comes from the shared System.Pape directory service, not something this
  app owns.

## 9. What a redesign deliverable should cover

Given the above, a useful redesign pass should produce, at minimum:
- A color/type/spacing system (light + dark) — can keep or replace §6's
  tokens.
- Tab bar + sticky transport bar treatment, including the bar's
  collapsed/idle (nothing played yet) state.
- Discover: list row, current-station strip, search, and all four listed
  states (loading/error/empty-directory/empty-search).
- Play: collapsed transport bar → expanded full-player drawer transition,
  live vs. on-demand layouts, the simplified level meter.
- Stack: Stack vs. Stash sections, a saved-track row showing its origin
  station, storage-used indicator.
- Studio: unpaired gate (including permission-denied fallback) and the five
  paired-state screens in §5.4.
- The four modals in §5.5–§5.7 plus QR pairing.
- App icon / splash / adaptive-icon set, reconciled with whatever accent
  color the redesign lands on.
