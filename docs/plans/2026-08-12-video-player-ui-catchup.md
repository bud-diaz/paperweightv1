# Video Player UI Catch-up Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let listeners watch video inside the normal `PLAY` tab while keeping existing audio playback, gated access, live video behavior, and creator/listener shells stable.

**Architecture:** Add a first-class media surface to the Studio SPA player instead of bolting video into isolated pages. `usePlayerEngine` should own both persistent live elements (`<audio>` for audio streams, `<video>` for video streams), detect whether the active live/on-demand item is video, attach HLS.js to the correct element, and expose enough state for `PlayerView` to render either waveform/artwork or a real video stage. Existing backend video paths remain the source of truth: station HLS stays `/hls/stream/index.m3u8`, audio live override stays `/hls/live/index.m3u8`, paid live video stays `/hls/live-video/index.m3u8`, and library streams stay `/api/library/:id/stream`.

**Tech Stack:** React 19, TypeScript, Vite, HLS.js global from `/vendor/hls.min.js`, Express static HLS routes, Node `node:test` backend tests, manual browser QA via local server/Playwright.

**Repo:** `/home/bud/paperweightv1`

**Current baseline checked:** `2026-08-12`, branch `claude/phase-5-dashboard-gaps`, HEAD `a85fcb3`, working tree ahead of origin by 4 commits.

---

## Non-negotiables

- Keep the normal `PLAY` tab as the listener video destination. Do not create a separate “Watch” tab.
- Preserve audio behavior: station stream, live audio override, on-demand audio, previews, quota handling, next-up behavior, media-session controls, listener pings.
- Do not weaken backend tier gates. `/hls/live-video/*` must stay protected by `attachTier` + `requireLiveVideoAccess` in `src/index.js`.
- Do not expose `DASHBOARD_TOKEN`, stream keys, or private file paths in UI, logs, tests, or screenshots.
- Modals must use the updated Studio visual language: `Modal`, `panel`, `panel-subtle`, `input-studio`, `ghost-button`, `lime-button`, rounded frosted cards, primary accent, display/mono typography.
- After changing built Studio assets, run `npm run build:studio`, regenerate `src/client-bundle.js`, and run `npm run check:package`.

---

## Acceptance Criteria

1. `PLAY` shows an actual `<video>` surface when the active media is video.
2. `PLAY` keeps the current audio artwork/waveform surface when the active media is audio.
3. Normal station playback chooses the video element when `/api/stream/status` says the station HLS is video (`status.isVideo` or `nowPlaying.isVideo`).
4. Paid live video uses `/hls/live-video/index.m3u8` when `live-video/status.state === 'live'` and the listener/creator can access the route.
5. Audio live override still uses `/hls/live/index.m3u8` and does not get confused with live video.
6. On-demand video tracks selected from Stack/Library play inside `PLAY` using a real video element, not `new Audio(...)`.
7. Video previews render as video previews when the locked track is video.
8. Audio and video never play on top of each other when switching modes, selecting tracks, or going back live.
9. Reconnect UX still works for HLS failures.
10. All AppShell inline modals and standalone modal components follow the updated styling, with no old flat/plain modal bodies.
11. `npm --prefix studio run typecheck` passes.
12. `npm --prefix studio run build` passes.
13. `node scripts/generate-client-bundle.js` runs after build.
14. `npm run check:package` passes.
15. Targeted backend tests pass: `node --test test/broadcast-live-video.test.js test/broadcast-engine.test.js test/http.test.js`.
16. Manual visual QA proves video inside `PLAY` with screenshots or a short note if camera/media device access blocks full browser-capture testing.

---

## Phase 1 — Discover and lock the active playback contract

### Task 1: Record exact current playback contract

**Objective:** Make the implementation start from the real code, not guesses.

**Files:**
- Read: `studio/src/lib/hooks/usePlayerEngine.ts`
- Read: `studio/src/views/PlayerView.tsx`
- Read: `studio/src/ListenerShell.tsx`
- Read: `studio/src/AppShell.tsx`
- Read: `studio/src/components/LiveBroadcastModal.tsx`
- Read: `src/index.js:154-243`
- Read: `src/api/dashboard.js:2051-2164`
- Read: `src/broadcast/liveVideo.js`
- Read: `src/broadcast/engine.js:272-330`

**Steps:**
1. Run `git status --short --branch` from repo root and note dirty files.
2. Confirm `usePlayerEngine.ts` still has the comment saying video playback is out of scope.
3. Confirm where AppShell/ListenerShell mount the hidden `<audio>`.
4. Confirm `/hls/live-video` is still tier-gated in `src/index.js`.
5. Confirm live video dashboard endpoints still live in `src/api/dashboard.js`.

**Verification:**
- No files modified.
- You can state the exact paths for station HLS, audio live HLS, video live HLS, library stream, and preview stream.

**Commit:** None.

---

### Task 2: Define the player state model before coding

**Objective:** Choose small explicit types so the hook does not become a tangle.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`

**Implementation notes:**
Add local types near existing `StreamStatus` / `OnDemandTrack` types:

```ts
type PlaybackKind = 'audio' | 'video';
type PlaybackSource = 'station' | 'live-audio' | 'live-video' | 'on-demand' | 'preview';

type ActivePlayback = {
  source: PlaybackSource;
  kind: PlaybackKind;
  url: string;
};
```

Extend `OnDemandTrack` to include video metadata already returned by `src/api/library.js`:

```ts
export type OnDemandTrack = {
  id: number;
  title: string;
  artist: string | null;
  category: string | null;
  duration: number | null;
  visibility: 'public' | 'supporters_only' | 'vault';
  unlocked?: boolean;
  isExternal?: boolean;
  isVideo?: boolean;
  mimeType?: string | null;
};
```

**Verification:**
Run:

```bash
npm --prefix studio run typecheck
```

Expected: likely PASS if only adding types; fix any type errors before continuing.

**Commit:**

```bash
git add studio/src/lib/hooks/usePlayerEngine.ts
git commit -m "feat: define player media playback types"
```

---

## Phase 2 — Add a persistent video element without breaking audio

### Task 3: Add `videoRef` to `usePlayerEngine`

**Objective:** Give the player hook a persistent video element parallel to the existing audio element.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`
- Modify: `studio/src/AppShell.tsx`
- Modify: `studio/src/ListenerShell.tsx`

**Implementation notes:**
In `usePlayerEngine`:

```ts
const audioRef = useRef<HTMLAudioElement>(null);
const videoRef = useRef<HTMLVideoElement>(null);
const hlsRef = useRef<ReturnType<NonNullable<typeof window.Hls>['prototype']['constructor']> | null>(null);
```

Return `videoRef` alongside `audioRef`.

In `AppShell` and `ListenerShell`, mount:

```tsx
<audio ref={playerEngine.audioRef} hidden />
<video ref={playerEngine.videoRef} hidden playsInline />
```

For ListenerShell the variable is `engine`, so:

```tsx
<audio ref={engine.audioRef} hidden />
<video ref={engine.videoRef} hidden playsInline />
```

**Pitfall:** Do not render a visible video yet. This task only creates the plumbing.

**Verification:**

```bash
npm --prefix studio run typecheck
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/lib/hooks/usePlayerEngine.ts studio/src/AppShell.tsx studio/src/ListenerShell.tsx
git commit -m "feat: add persistent video element to player engine"
```

---

### Task 4: Replace audio-only HLS attach with media-aware attach

**Objective:** Attach HLS.js to either audio or video based on active playback kind.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`

**Implementation notes:**
Replace `attachHls(url: string)` with a media-aware helper:

```ts
const activeMediaRef = useRef<HTMLMediaElement | null>(null);

const detachHls = useCallback(() => {
  if (hlsRef.current) {
    try { hlsRef.current.destroy(); } catch { /* already destroyed */ }
    hlsRef.current = null;
  }
}, []);

const mediaForKind = useCallback((kind: PlaybackKind) => (
  kind === 'video' ? videoRef.current : audioRef.current
), []);

const stopInactiveElement = useCallback((kind: PlaybackKind) => {
  const inactive = kind === 'video' ? audioRef.current : videoRef.current;
  if (!inactive) return;
  inactive.pause();
  inactive.removeAttribute('src');
  inactive.load?.();
}, []);

const attachHls = useCallback((playback: ActivePlayback) => {
  const mediaEl = mediaForKind(playback.kind);
  if (!mediaEl) return;
  detachHls();
  stopInactiveElement(playback.kind);
  activeMediaRef.current = mediaEl;

  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ lowLatencyMode: false });
    hls.loadSource(playback.url);
    hls.attachMedia(mediaEl);
    hlsRef.current = hls;
  } else if (mediaEl.canPlayType('application/vnd.apple.mpegurl')) {
    mediaEl.src = playback.url;
  }
}, [detachHls, mediaForKind, stopInactiveElement]);
```

Update all existing callers from `attachHls(activeUrl)` to `attachHls(activePlayback)` after Task 5 defines `activePlayback`.

**Verification:**

```bash
npm --prefix studio run typecheck
```

Expected: temporary errors are acceptable only if Task 5 immediately resolves them. Do not commit broken typecheck.

**Commit:** Combine with Task 5 if this task alone cannot typecheck.

---

## Phase 3 — Choose the correct live playback source

### Task 5: Query live-video status in `usePlayerEngine`

**Objective:** Let normal player know when paid live video is on-air.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`
- Uses existing API: `api.dashboard.liveVideo.status()` is dashboard-only; public listener shell needs a non-dashboard status endpoint before it can safely know live video is on. See Task 6.

**Important decision:** Do not call dashboard-only `/api/dashboard/live-video/status` from public listener shell. It requires dashboard auth and would break public listeners.

**Implementation direction:**
- First check whether `/api/stream/status` already exposes live video state. If not, implement Task 6 before this task.
- Final hook should use a public stream status field such as:

```ts
export type StreamStatus = {
  nowPlaying: NowPlaying | null;
  listenerCount: number;
  liveActive: boolean;
  liveVideoActive?: boolean;
  isVideo: boolean;
  mode: 'shuffle' | 'scheduled';
  stationQueue: StationTrack[];
  recentlyPlayed: (StationTrack & { playedAt: string })[];
};
```

Then compute:

```ts
const stationIsVideo = !!(status?.isVideo || status?.nowPlaying?.isVideo);
const activePlayback: ActivePlayback = status?.liveVideoActive
  ? { source: 'live-video', kind: 'video', url: '/hls/live-video/index.m3u8' }
  : status?.liveActive
    ? { source: 'live-audio', kind: 'audio', url: HLS_LIVE_URL }
    : { source: 'station', kind: stationIsVideo ? 'video' : 'audio', url: HLS_URL };
```

**Verification:**
- Typecheck passes.
- Hook does not make dashboard API calls when used by `ListenerShell`.

**Commit:** With Task 6 if backend status changes are needed.

---

### Task 6: Expose live video state safely through public stream status

**Objective:** Public listeners need to know when live video is on without accessing dashboard endpoints.

**Files:**
- Modify: `src/api/stream.js`
- Modify tests: `test/http.test.js` or create targeted assertions in existing stream-status tests.

**Implementation notes:**
1. Read current `src/api/stream.js`.
2. Import `src/broadcast/liveVideo.js` if not already imported.
3. Include only non-secret state in `/api/stream/status`:

```js
const liveVideoState = liveVideo.getLiveVideoState();
const liveVideoActive = !!liveVideoState.isLive;
```

4. Add to status JSON:

```js
liveVideoActive,
liveVideoSource: liveVideoActive ? liveVideoState.source : null,
```

**Do not expose:** RTMP URL, stream key, host, port, raw state file path, dashboard-only settings.

**Test shape:**
- Existing status test should assert `liveVideoActive` exists and defaults to `false`.
- If feasible, stub/mock `liveVideo.getLiveVideoState()` to assert `true` response. If existing test style does not support module mocking, keep the default false assertion and rely on live-video backend tests for process behavior.

**Verification:**

```bash
node --test test/http.test.js test/broadcast-live-video.test.js
```

Expected: PASS.

**Commit:**

```bash
git add src/api/stream.js test/http.test.js studio/src/lib/hooks/usePlayerEngine.ts
git commit -m "feat: expose safe live video status to player"
```

---

### Task 7: Update live HLS switching logic for audio/video

**Objective:** Switching between station audio, station video, live audio, and live video should recreate/reload HLS on the correct element.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`

**Implementation notes:**
Replace the existing `prevLiveActiveRef` effect with tracking over the whole `activePlayback` identity:

```ts
const activePlaybackKey = `${activePlayback.source}:${activePlayback.kind}:${activePlayback.url}`;
const prevPlaybackKeyRef = useRef<string | undefined>(undefined);

useEffect(() => {
  if (prevPlaybackKeyRef.current === undefined) {
    prevPlaybackKeyRef.current = activePlaybackKey;
    return;
  }
  if (prevPlaybackKeyRef.current === activePlaybackKey) return;
  prevPlaybackKeyRef.current = activePlaybackKey;
  clearRetry();
  retryAttemptRef.current = 0;
  setReconnecting(false);
  attachHls(activePlayback);
  if (playing && !track) activeMediaRef.current?.play().catch(() => setPlaying(false));
}, [activePlaybackKey, activePlayback, attachHls, clearRetry, playing, track]);
```

**Pitfall:** Memoize `activePlayback` with `useMemo` so this effect does not run every render.

**Verification:**

```bash
npm --prefix studio run typecheck
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/lib/hooks/usePlayerEngine.ts
git commit -m "feat: switch player HLS by media kind"
```

---

## Phase 4 — Render video in the normal PLAY tab

### Task 8: Expose player display state

**Objective:** `PlayerView` needs to know whether to render video, whether it is live/on-demand/preview, and what labels to show.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`

**Implementation notes:**
Return these fields:

```ts
activePlayback,
activeKind: track ? (track.isVideo ? 'video' : 'audio') : activePlayback.kind,
isVideoActive: track ? !!track.isVideo : activePlayback.kind === 'video',
videoRef,
```

If TypeScript complains about returning `activePlayback` object identity, include it in the `useMemo` dependency array.

**Verification:**

```bash
npm --prefix studio run typecheck
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/lib/hooks/usePlayerEngine.ts
git commit -m "feat: expose active video state to player view"
```

---

### Task 9: Render the video surface in `PlayerView`

**Objective:** Show the persistent `<video>` inside the Play tab when video is active.

**Files:**
- Modify: `studio/src/views/PlayerView.tsx`
- Modify: `studio/src/index.css` if the current classes cannot style the video stage cleanly.

**Implementation notes:**
In `PlayerView`, destructure `videoRef`, `isVideoActive`, and `activePlayback` from `engine`.

Replace the static artwork block:

```tsx
<div className="player-artwork" aria-label={`${stationName} artwork`}>...</div>
```

with conditional rendering:

```tsx
{isVideoActive ? (
  <div className="player-video-shell" data-testid="player-video-shell">
    <video
      ref={videoRef}
      data-testid="player-video"
      className="player-video"
      playsInline
      controls
      poster="/favicon.png"
      aria-label={title}
    />
    {!playing && (
      <div className="player-video-idle">
        <Play size={24} fill="currentColor" />
      </div>
    )}
  </div>
) : (
  <div className="player-artwork" aria-label={`${stationName} artwork`}>
    <div className="artwork-ring artwork-ring-one" />
    <div className="artwork-ring artwork-ring-two" />
    <div className="artwork-core"><Music2 size={38} /></div>
  </div>
)}
```

**CSS target:**
Add styles using the updated dark/frosted look:

```css
.player-video-shell {
  position: relative;
  width: min(100%, 760px);
  aspect-ratio: 16 / 9;
  border-radius: 1.5rem;
  overflow: hidden;
  background: rgba(0,0,0,.45);
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 80px rgba(0,0,0,.35);
}
.player-video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  background: #000;
}
.player-video-idle {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  color: var(--primary);
  background: radial-gradient(circle at center, rgba(185,255,60,.15), transparent 45%);
}
```

**Pitfall:** The `<video>` is already mounted at the shell root from Task 3. If React cannot attach the same ref to two elements, switch strategy: do not mount video at shell root hidden; mount it only in `PlayerView` but keep `PlayerView` mounted for play mode. Preferred final design: one actual video element, visible when `PLAY` is active. If playback must survive Stack/Play switches, keep root-mounted video and use CSS/portal-like positioning is overkill. YAGNI: accept video pausing when leaving `PLAY` for v1 if necessary, but audio must still survive.

**Recommended simpler final:** Mount video only in `PlayerView`; keep audio persistent at shell root. Update Task 3 accordingly if implementation reveals duplicate-ref issues.

**Verification:**

```bash
npm --prefix studio run typecheck
npm --prefix studio run build
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/views/PlayerView.tsx studio/src/index.css studio/src/lib/hooks/usePlayerEngine.ts studio/src/AppShell.tsx studio/src/ListenerShell.tsx
git commit -m "feat: render video inside play tab"
```

---

## Phase 5 — Make on-demand video and previews real

### Task 10: Pass video metadata from Stack to player engine

**Objective:** Ensure selected tracks carry `isVideo` and `mimeType` into `usePlayerEngine`.

**Files:**
- Modify: `studio/src/views/StackView.tsx`
- Inspect: `studio/src/lib/library.ts`

**Implementation notes:**
In `StackView`, current `onDemandTrack` omits video fields. Change to:

```ts
const onDemandTrack: OnDemandTrack = {
  id: track.id,
  title: track.title,
  artist: track.artist,
  category: track.category,
  duration: track.duration,
  visibility: track.visibility || 'public',
  unlocked: track.unlocked,
  isExternal: track.isExternal,
  isVideo: track.isVideo,
  mimeType: track.mimeType,
};
```

If `LibraryItem` does not include `isVideo` / `mimeType`, add them to `studio/src/lib/library.ts` types to match `src/api/library.js:211-235`.

**Verification:**

```bash
npm --prefix studio run typecheck
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/views/StackView.tsx studio/src/lib/library.ts
git commit -m "feat: carry video metadata into player selection"
```

---

### Task 11: Replace `new Audio()` on-demand engine with media-aware element

**Objective:** On-demand video tracks should play in the visible video surface; on-demand audio should keep working.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`

**Implementation notes:**
Current code uses:

```ts
const media = new Audio(api.library.streamUrl(t.id, { nextUp: isNextUp }));
odMediaRef.current = media;
```

Change `odMediaRef` to `useRef<HTMLMediaElement | null>(null)`.

For on-demand:

```ts
const kind: PlaybackKind = t.isVideo ? 'video' : 'audio';
const media = kind === 'video' ? videoRef.current : new Audio();
if (!media) { onNotify?.('Video player unavailable.'); return; }
stopInactiveElement(kind);
media.src = api.library.streamUrl(t.id, { nextUp: isNextUp });
odMediaRef.current = media;
```

For video on-demand, make sure the visible `PlayerView` has rendered the video element before `playOnDemand` tries to use it. If selection happens from Stack, the video element may not be mounted yet. Two acceptable options:

Option A, preferred: keep a root-mounted persistent `<video hidden>` and make `PlayerView` render a styled wrapper around that same element impossible in React. Not clean.

Option B, cleaner: store pending video track state, switch to Play mode before playback. This requires shell coordination.

Option C, pragmatic v1: for video selected from Stack, set `track`, notify “Open Play to watch”, and require Play button to start. This is worse UX.

Recommended implementation: add an `onVideoTrackSelected` callback from Stack to shell that switches mode to `play` before calling `engine.selectTrack`. That may require making `selectTrack` async after one tick:

```ts
onSelect={() => {
  offline.stop();
  if (track.isVideo) requestAnimationFrame(() => engine.selectTrack(onDemandTrack));
  else engine.selectTrack(onDemandTrack);
}}
```

And in AppShell/ListenerShell pass a Stack handler that calls `setMode('play')` first for video tracks.

**Do not overbuild routing.** Keep this inside existing mode state.

**Verification:**

```bash
npm --prefix studio run typecheck
```

Manual browser verification later must prove selecting a video from Stack opens/uses Play.

**Commit:**

```bash
git add studio/src/lib/hooks/usePlayerEngine.ts studio/src/views/StackView.tsx studio/src/AppShell.tsx studio/src/ListenerShell.tsx
git commit -m "feat: support on-demand video playback"
```

---

### Task 12: Make preview playback video-aware

**Objective:** Locked video content should preview as video, not audio-only.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`

**Implementation notes:**
Current preview uses:

```ts
const media = new Audio(`/api/library/${t.id}/preview`);
```

Make it choose by `t.isVideo`:

```ts
const kind: PlaybackKind = t.isVideo ? 'video' : 'audio';
const media = kind === 'video' ? videoRef.current : new Audio();
if (!media) { onNotify?.('Video player unavailable.'); return; }
stopInactiveElement(kind);
media.src = `/api/library/${t.id}/preview`;
odMediaRef.current = media;
```

Keep the 30s preview timer and progress logic.

**Backend note:** `src/api/library.js` already builds video previews with FFmpeg into video output when `row.mime_type` starts with `video/`.

**Verification:**

```bash
npm --prefix studio run typecheck
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/lib/hooks/usePlayerEngine.ts
git commit -m "feat: support video previews in player"
```

---

## Phase 6 — Tighten playback edge cases

### Task 13: Prevent overlapping audio/video playback

**Objective:** Ensure switching between live, on-demand, preview, and back-live stops inactive media.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`

**Implementation notes:**
Audit these functions and ensure each stops the right things:

- `stopOnDemandMedia`
- `goLive`
- `playPreview`
- `playOnDemand`
- `play`
- `pause`
- HLS attach/switch effect

Rules:

```ts
function pauseAllMedia() {
  audioRef.current?.pause();
  videoRef.current?.pause();
  odMediaRef.current?.pause();
}
```

But avoid removing HLS source every pause. Remove src only when switching source/kind or tearing down on-demand.

**Verification:**
- Typecheck passes.
- Manual QA later: start audio, select video, go back live; confirm no double audio.

**Commit:**

```bash
git add studio/src/lib/hooks/usePlayerEngine.ts
git commit -m "fix: prevent overlapping player media"
```

---

### Task 14: Keep listener pings limited to live station playback

**Objective:** Do not count on-demand/video preview playback as live listeners accidentally.

**Files:**
- Modify: `studio/src/lib/hooks/usePlayerEngine.ts`

**Implementation notes:**
Current ping effect:

```ts
if (!playing || track) return;
```

Keep that invariant. Confirm video live should count as live listening. If yes, no change needed because `track` is null for live video. If backend wants separate video analytics later, defer it.

Add a comment:

```ts
// Counts live station/live-video presence only. On-demand plays are recorded separately.
```

**Verification:**

```bash
npm --prefix studio run typecheck
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/lib/hooks/usePlayerEngine.ts
git commit -m "docs: clarify live listener ping behavior"
```

---

## Phase 7 — Modal styling catch-up

### Task 15: Inventory every modal and classify styling debt

**Objective:** Avoid random “looks better” edits by creating a checklist.

**Files:**
- Read: `studio/src/components/primitives.tsx`
- Read: `studio/src/AppShell.tsx` modalContent block
- Read: `studio/src/components/AccountModal.tsx`
- Read: `studio/src/components/CheckoutModal.tsx`
- Read: `studio/src/components/VaultGateModal.tsx`
- Read: `studio/src/components/WelcomeOverlay.tsx`
- Read: `studio/src/components/TipConfigModal.tsx`
- Read: `studio/src/components/LiveBroadcastModal.tsx`

**Checklist to produce in notes or PR description:**
- Uses shared `Modal`: yes/no
- Header uses eyebrow + display title: yes/no
- Body uses `panel-subtle` cards: yes/no
- Inputs use `input-studio` or `Field`: yes/no
- Buttons use `ghost-button` / `lime-button`: yes/no
- Mobile bottom-sheet behavior works: yes/no

**Verification:**
- No code changes required for this task unless obvious tiny class fixes are found.

**Commit:** None unless a docs/checklist file is created.

---

### Task 16: Upgrade shared `Modal` shell polish

**Objective:** Make all modals inherit the updated UI baseline from one component.

**Files:**
- Modify: `studio/src/components/primitives.tsx`
- Modify: `studio/src/index.css` if needed.

**Implementation notes:**
Enhance `Modal` but keep API stable:

- Keep mobile bottom-sheet: `items-end sm:items-center`, `rounded-t-2xl sm:rounded-2xl`.
- Add subtle top glow/accent line inside modal panel.
- Ensure panel backdrop has the current glass aesthetic.
- Keep Escape and backdrop close behavior.
- Keep `width` prop.

Example:

```tsx
<div className={cn('relative w-full rounded-t-2xl sm:rounded-2xl panel p-5 sm:p-7 max-h-[92dvh] overflow-y-auto scrollbar-thin animate-enter', width)}>
  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
  ...
</div>
```

**Verification:**

```bash
npm --prefix studio run typecheck
npm --prefix studio run build
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/components/primitives.tsx studio/src/index.css
git commit -m "style: refresh shared modal shell"
```

---

### Task 17: Split AppShell inline modals into styled components

**Objective:** AppShell currently has a giant inline `modalContent()` block. Move the most important inline modals into small components so styling stays consistent and maintainable.

**Files:**
- Create: `studio/src/components/modals/UploadModal.tsx`
- Create: `studio/src/components/modals/CollectionModal.tsx`
- Create: `studio/src/components/modals/ShareStationModal.tsx`
- Create: `studio/src/components/modals/NewShareLinkModal.tsx`
- Create: `studio/src/components/modals/LibraryModal.tsx`
- Modify: `studio/src/AppShell.tsx`

**Implementation order:**
1. Extract `upload` modal only.
2. Typecheck.
3. Extract `collection` modal.
4. Typecheck.
5. Extract `share` and `newShareLink`.
6. Typecheck.
7. Extract `library`.
8. Typecheck.

**Styling rules:**
- Every extracted modal must use shared `Modal`.
- All cards use `panel-subtle rounded-xl`.
- All inputs/selects use `input-studio` or `Field`.
- All primary actions use `lime-button`.
- All secondary actions use `ghost-button`.

**Verification after each extraction:**

```bash
npm --prefix studio run typecheck
```

Expected: PASS after each small extraction.

**Commit:**

```bash
git add studio/src/AppShell.tsx studio/src/components/modals/*.tsx
git commit -m "refactor: extract styled studio modals"
```

---

### Task 18: Style the remaining special-purpose modals

**Objective:** Make standalone modals match the updated UI without changing behavior.

**Files:**
- Modify: `studio/src/components/AccountModal.tsx`
- Modify: `studio/src/components/CheckoutModal.tsx`
- Modify: `studio/src/components/VaultGateModal.tsx`
- Modify: `studio/src/components/TipConfigModal.tsx`
- Modify: `studio/src/components/LiveBroadcastModal.tsx`
- Modify: `studio/src/components/WelcomeOverlay.tsx` if it visually behaves like a modal.

**Specific checks:**
- Account tabs should use the same segmented `panel-subtle rounded-xl p-1` style.
- Checkout cards should use consistent panel borders/accent hover.
- Vault gate should clearly show locked content and CTA without looking like old checkout UI.
- Live broadcast modal must keep its video preview styles but align card spacing/buttons with updated Studio.
- Welcome overlay should not feel like a legacy pop-up if it appears over the updated listener shell.

**Verification:**

```bash
npm --prefix studio run typecheck
npm --prefix studio run build
```

Expected: PASS.

**Commit:**

```bash
git add studio/src/components/*.tsx studio/src/index.css
git commit -m "style: align listener and broadcast modals"
```

---

## Phase 8 — Backend/frontend integration tests and packaging

### Task 19: Add backend status test for live video flag

**Objective:** Prevent regressions where UI loses awareness of live video.

**Files:**
- Modify: `test/http.test.js`
- Or create: `test/stream-status.test.js` only if package scripts are updated to include it.

**Test:**
Assert `/api/stream/status` includes:

```js
assert.equal(typeof body.liveVideoActive, 'boolean');
assert.equal(body.liveVideoActive, false);
```

If adding `liveVideoSource`, assert default null:

```js
assert.equal(body.liveVideoSource, null);
```

**Verification:**

```bash
node --test test/http.test.js
```

Expected: PASS.

**Commit:**

```bash
git add test/http.test.js
git commit -m "test: cover live video stream status fields"
```

---

### Task 20: Build Studio and regenerate committed client assets

**Objective:** Keep packaged/runtime frontend current.

**Files:**
- Generated/Modify: `client/app/**`
- Generated/Modify: `src/client-bundle.js`

**Steps:**

```bash
npm --prefix studio run build
node scripts/generate-client-bundle.js
npm run check:package
```

Expected:
- Studio build passes.
- Client bundle generation reports generated entries.
- Package check passes.

**Commit:**

```bash
git add client/app src/client-bundle.js
git commit -m "build: update studio video player assets"
```

---

### Task 21: Run targeted backend tests

**Objective:** Verify the backend video routes still work after exposing public status.

**Command:**

```bash
node --test test/broadcast-live-video.test.js test/broadcast-engine.test.js test/http.test.js
```

Expected: PASS.

**If failures happen:**
- Fix before moving on.
- Do not skip `broadcast-live-video.test.js`; that is the feature’s backend spine.

**Commit:** None unless fixes are needed.

---

### Task 22: Run full project tests if targeted checks pass

**Objective:** Ensure no unrelated route/build contract broke.

**Command:**

```bash
npm test
```

Expected: PASS.

**Commit:** None unless fixes are needed.

---

## Phase 9 — Manual video QA

### Task 23: Create a clean local test runtime

**Objective:** Test without mutating Bud’s real vault/DB/logs.

**Commands:**

```bash
mkdir -p /tmp/paperweight-video-qa/{vault,data,hls,logs}
PORT=3456 HOST=127.0.0.1 \
  PAPERWEIGHT_ALLOW_MISSING_ENV=true \
  DASHBOARD_TOKEN=test-dashboard-token \
  DOWNLOAD_SIGNING_SECRET=test-download-secret \
  DATA_PATH=/tmp/paperweight-video-qa/data \
  HLS_OUTPUT_PATH=/tmp/paperweight-video-qa/hls \
  VAULT_PATH=/tmp/paperweight-video-qa/vault \
  LOG_PATH=/tmp/paperweight-video-qa/logs \
  STATION_NAME='Paperweight Video QA' \
  npm start
```

Run as background process through Hermes terminal with `background=true` because server stays alive.

**Verification:**

```bash
npm run smoke -- http://127.0.0.1:3456/
```

Expected: PASS or only expected empty-vault warnings.

---

### Task 24: Seed a tiny video file for QA

**Objective:** Have an actual video track for the scanner/player.

**Command:**

```bash
ffmpeg -y \
  -f lavfi -i testsrc=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=44100 \
  -t 12 \
  -c:v libx264 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  /tmp/paperweight-video-qa/vault/test-video.mp4
```

**Verification:**

```bash
file /tmp/paperweight-video-qa/vault/test-video.mp4
```

Expected: MP4 video file.

Wait for scanner to pick it up, or restart server after placing file.

---

### Task 25: Browser QA normal Play video

**Objective:** Prove listeners can watch video in `PLAY`.

**Steps:**
1. Open `http://127.0.0.1:3456/`.
2. Dismiss welcome if present.
3. Go to `STACK`.
4. Select `test-video`.
5. Confirm UI moves/opens to `PLAY` if implemented that way.
6. Confirm `data-testid="player-video"` exists and is visible.
7. Press Play if autoplay is blocked.
8. Confirm moving video frames appear.
9. Capture screenshot.

**Suggested Playwright script path:** `/tmp/paperweight-video-qa/capture-play-video.js`

**Verification artifact:**
- Screenshot: `/tmp/paperweight-video-qa/play-video.png`
- Use `file /tmp/paperweight-video-qa/play-video.png` to verify image exists.

---

### Task 26: Browser QA modals

**Objective:** Verify modals visually match updated styling.

**Modals to open/capture:**
- Listener account modal
- Checkout/support modal
- Vault gate modal if a locked track exists or can be simulated
- Creator upload modal
- Creator live broadcast modal
- Creator library modal
- New share link modal

**Verification:**
- No unstyled white/plain modal bodies.
- Mobile-ish viewport still bottom-sheets correctly.
- Close button/backdrop/Escape work.
- Inputs/buttons match `input-studio`, `ghost-button`, `lime-button` styling.

---

## Phase 10 — Final release gate subset

### Task 27: Final build/package checks

**Commands:**

```bash
npm --prefix studio run typecheck
npm --prefix studio run build
node scripts/generate-client-bundle.js
npm run check:package
node --test test/broadcast-live-video.test.js test/broadcast-engine.test.js test/http.test.js
npm test
```

Expected: all PASS.

If `npm run release:check` is requested, run it too, but remember `check:clean` may fail if Bud has intentional local changes. Do not report release-ready unless the cleanliness gate passes.

---

## Suggested commit sequence

1. `feat: define player media playback types`
2. `feat: add persistent video element to player engine`
3. `feat: expose safe live video status to player`
4. `feat: switch player HLS by media kind`
5. `feat: render video inside play tab`
6. `feat: carry video metadata into player selection`
7. `feat: support on-demand video playback`
8. `feat: support video previews in player`
9. `fix: prevent overlapping player media`
10. `style: refresh shared modal shell`
11. `refactor: extract styled studio modals`
12. `style: align listener and broadcast modals`
13. `test: cover live video stream status fields`
14. `build: update studio video player assets`

---

## Follow-up deliberately deferred

- Separate video analytics beyond existing live listener ping/on-demand events.
- Adaptive bitrate ladders.
- Video captions/subtitles.
- Theater mode/fullscreen custom controls beyond native browser controls.
- A dedicated “Watch” tab. Bud asked for video inside normal `PLAY`.
- DRM or stronger content protection. Current access gates are HTTP/session/tier based.
