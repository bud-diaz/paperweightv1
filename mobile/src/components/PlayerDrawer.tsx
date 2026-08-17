import { Ionicons } from '@expo/vector-icons';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { libraryArtworkUrl, type CreatorPost, type RecentlyPlayedTrack, type StationTrack } from '@/api/stationClient';
import { LevelMeter } from '@/components/LevelMeter';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine, type OnDemandTrack } from '@/player/PlayerEngine';
import { useStationClient, useStationStore } from '@/state/stationStore';

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Station rotation/history items are already playing on the open live stream, so treating them as public on-demand tracks is safe. */
function toOnDemandTrack(item: StationTrack | RecentlyPlayedTrack): OnDemandTrack {
  return { id: item.id, title: item.title, artist: item.artist, category: item.category, duration: 'duration' in item ? item.duration : null, visibility: 'public' };
}

/** `published_at` comes from SQLite's `datetime('now')` — space-separated, UTC, no zone suffix — so it needs help to parse as UTC rather than local time. */
function formatPostDate(sqliteDatetime: string): string {
  const date = new Date(`${sqliteDatetime.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Full player content, ported from studio/src/views/PlayerView.tsx into a
 * @gorhom/bottom-sheet modal — the scope doc's mobile-only "drawer" pattern
 * standing in for the web version's dedicated always-full-screen Play mode.
 * Opened from StickyTransportBar (any tab) or automatically on the Play
 * tab's focus (see PlayScreen.tsx); lives outside the tab navigator (mounted
 * in `(tabs)/_layout.tsx`) so it survives tab switches per the Phase 3 plan's
 * recommendation.
 *
 * Deliberately audio-only for v1 — no video/live-video handling (expo-video
 * + tier-gated live-video auth is a meaningfully separate chunk of work the
 * Phase 3 plan's file list didn't call for; PlayerEngine already ignores
 * `liveVideoActive` for source selection, see that file's header comment).
 *
 * Structure closely mirrors a reference mockup (2026-08-17 addendum, see
 * MOBILE-HANDOFF.md — artwork, meta row with queue/favorite icons,
 * progress bar with a thumb, a five-across transport row, up-next list),
 * restyled per `mobile/paperweight-new-design-spec.md`'s oxide/ink system
 * instead of the mockup's own pink-gradient look. Two mockup controls stay
 * intentionally inert rather than faked: **shuffle** (not a listener-facing
 * concept — rotation order is server/creator-controlled) and the
 * **heart/favorite** toggle (no favorites API exists on the backend at
 * all). Both render dimmed and non-pressable rather than as silent no-ops.
 * The other three transport controls are real: **skip prev/next** jump to
 * the most-recently-played / next-queued rotation track (`recentlyPlayed`/
 * `stationQueue` from `/api/stream/status`, already real data), and
 * **repeat** loops the current on-demand track instead of reverting to
 * live when it ends (`PlayerEngine.repeatOnDemand`). The progress bar is
 * tap-to-seek (`engine.seekOnDemand`) for on-demand tracks — not drag, to
 * avoid fighting the bottom sheet's own pan gesture.
 *
 * The mockup's placeholder "Song - Album/Collection" pill (literal
 * placeholder text in the source image, never a finished part of that
 * design either) is now a real **Share** card: "Copy link" (the station's
 * own public URL — the one real, already-existing "share" pattern in this
 * product, see the web Studio's Tools view) and "Share via…" (the OS share
 * sheet, `react-native`'s built-in `Share.share` — this *is* "different
 * share options" without hand-rolling per-platform deep links; there's no
 * backend endpoint for a listener to mint a track-specific share link, see
 * `src/api/share.js` — that's creator/dashboard-only). "Sliding up from it"
 * to reveal Up Next / Recently on air / Posts is the sheet's own scroll —
 * those three sections sit directly below the card in document order, so
 * scrolling (the same gesture used everywhere else in this drawer) already
 * does exactly that; no nested gesture was added on top of the bottom
 * sheet's own pan handling. Posts (`GET /api/posts`, `src/api/posts.js`)
 * are plain creator text updates, no attachments — server-side tier-gated
 * off the attached bearer token, so nothing extra to filter client-side.
 */
export function PlayerDrawer() {
  const colors = useTheme();
  const engine = usePlayerEngine();
  const { baseUrl, listenerAuth } = useStationStore();
  const client = useStationClient();

  const scrollRef = useRef<React.ComponentRef<typeof BottomSheetScrollView>>(null);
  const upNextY = useRef(0);

  const [posts, setPosts] = useState<CreatorPost[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);

  useEffect(() => {
    if (!client) {
      setPosts([]);
      setPostsLoaded(false);
      return;
    }
    let cancelled = false;
    client
      .listPosts(1, 5)
      .then((res) => {
        if (!cancelled) {
          setPosts(res.posts);
          setPostsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setPostsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} />
    ),
    []
  );

  const scrollToUpNext = useCallback(() => {
    scrollRef.current?.scrollTo({ y: upNextY.current, animated: true });
  }, []);

  const onUpNextLayout = useCallback((event: LayoutChangeEvent) => {
    upNextY.current = event.nativeEvent.layout.y;
  }, []);

  const playItem = useCallback(
    (item: StationTrack | RecentlyPlayedTrack) => {
      const isPaid = !!listenerAuth?.tier && listenerAuth.tier !== 'free';
      engine.selectTrack(toOnDemandTrack(item), isPaid);
    },
    [engine, listenerAuth]
  );

  const playPrevious = useCallback(() => {
    const item = engine.recentlyPlayed[0];
    if (item) playItem(item);
  }, [engine.recentlyPlayed, playItem]);

  const playNext = useCallback(() => {
    const item = engine.stationQueue[0];
    if (item) playItem(item);
  }, [engine.stationQueue, playItem]);

  const statusLabel = engine.track
    ? engine.isPreview
      ? 'Preview'
      : 'On demand'
    : engine.isBuffering
      ? 'Buffering…'
      : engine.liveActive
        ? 'Live now'
        : engine.playing
          ? 'Playing now'
          : 'Station paused';

  const title = engine.track?.title ?? engine.nowPlaying?.title ?? 'Nothing playing yet';
  const subtitle = engine.track
    ? [engine.track.artist, engine.track.category].filter(Boolean).join(' · ')
    : [engine.nowPlaying?.artist, engine.nowPlaying?.category].filter(Boolean).join(' · ') ||
      engine.stationName ||
      '';

  const authHeaders = listenerAuth?.token ? { Authorization: `Bearer ${listenerAuth.token}` } : undefined;
  const artworkTrackId = engine.track?.id ?? engine.nowPlaying?.id ?? null;
  const artworkUrl = baseUrl && artworkTrackId != null ? libraryArtworkUrl(baseUrl, artworkTrackId) : null;

  const canSkipPrev = engine.recentlyPlayed.length > 0;
  const canSkipNext = engine.stationQueue.length > 0;

  const nowPlayingTitle = engine.track?.title ?? engine.nowPlaying?.title ?? null;
  const nowPlayingArtist = engine.track?.artist ?? engine.nowPlaying?.artist ?? null;
  const shareMessage = nowPlayingTitle
    ? `Listening to "${nowPlayingTitle}"${nowPlayingArtist ? ` by ${nowPlayingArtist}` : ''} on ${engine.stationName ?? 'Paperweight'}${baseUrl ? ` — ${baseUrl}` : ''}`
    : `Check out ${engine.stationName ?? 'this station'} on Paperweight${baseUrl ? ` — ${baseUrl}` : ''}`;

  return (
    <BottomSheetModal
      ref={engine.drawerRef}
      snapPoints={['88%']}
      backgroundStyle={{ backgroundColor: colors.background }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
      backdropComponent={renderBackdrop}>
      <BottomSheetScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <View style={styles.header}>
            <ThemedText type="small" themeColor="textSecondary">
              {engine.stationName ?? 'Station'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {engine.listenerCount} {engine.listenerCount === 1 ? 'listener' : 'listeners'} tuned in
            </ThemedText>
          </View>

          <View style={[styles.artworkFrame, { borderColor: colors.border }]}>
            {artworkUrl ? (
              <Image
                source={{ uri: artworkUrl, headers: authHeaders }}
                style={styles.artworkImage}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <View style={[styles.artworkImage, styles.artworkFallback, { backgroundColor: colors.accentSoft }]}>
                <ThemedText style={[styles.artworkGlyph, { color: colors.accent }]}>♪</ThemedText>
              </View>
            )}
          </View>

          <View style={styles.metaRow}>
            <Pressable onPress={scrollToUpNext} hitSlop={8} style={styles.iconButton}>
              <Ionicons name="list" size={18} color={colors.textSecondary} />
            </Pressable>

            <View style={styles.metaText}>
              <View style={styles.statusRow}>
                {engine.liveActive && !engine.track ? (
                  <View style={[styles.liveDot, { backgroundColor: colors.live }]} />
                ) : null}
                <ThemedText type="small" themeColor="textSecondary">
                  {statusLabel}
                </ThemedText>
                {engine.track ? (
                  <Pressable onPress={() => engine.goLive(true)} hitSlop={8}>
                    <ThemedText type="small" themeColor="accent">
                      · Back to live
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
              <ThemedText type="subtitle" numberOfLines={1} style={styles.title}>
                {title}
              </ThemedText>
              {subtitle ? (
                <ThemedText themeColor="textSecondary" numberOfLines={1}>
                  {subtitle}
                </ThemedText>
              ) : null}
            </View>

            {/* No favorites API exists yet — present for layout parity with the mockup, not wired to avoid a fake toggle. */}
            <View style={[styles.iconButton, styles.iconButtonDisabled]}>
              <Ionicons name="heart-outline" size={18} color={colors.textSecondary} />
            </View>
          </View>

          {engine.track ? (
            <View style={styles.progressBlock}>
              <ProgressBar progress={engine.odProgress} onSeekFraction={(f) => engine.seekOnDemand(f * engine.odDuration)} />
              <View style={styles.progressLabels}>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDuration(engine.odElapsed)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {engine.isPreview ? '0:30 preview' : formatDuration(engine.odDuration)}
                </ThemedText>
              </View>
            </View>
          ) : (
            <View style={styles.progressBlock}>
              <LevelMeter active={engine.playing} />
            </View>
          )}

          <View style={styles.controls}>
            {/* Rotation order isn't a listener-facing setting — present for layout parity, not wired to avoid a fake toggle. */}
            <View style={styles.transportButtonDisabled}>
              <Ionicons name="shuffle" size={20} color={colors.textSecondary} />
            </View>

            <Pressable
              onPress={playPrevious}
              disabled={!canSkipPrev}
              hitSlop={10}
              style={!canSkipPrev && styles.transportButtonDisabled}>
              <Ionicons name="play-skip-back" size={22} color={colors.text} />
            </Pressable>

            <Pressable onPress={engine.toggle} style={[styles.playButton, { backgroundColor: colors.accent }]}>
              {engine.isBuffering ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Ionicons
                  name={engine.playing ? 'pause' : 'play'}
                  size={28}
                  color={colors.text}
                  style={!engine.playing && styles.playGlyphOffset}
                />
              )}
            </Pressable>

            <Pressable
              onPress={playNext}
              disabled={!canSkipNext}
              hitSlop={10}
              style={!canSkipNext && styles.transportButtonDisabled}>
              <Ionicons name="play-skip-forward" size={22} color={colors.text} />
            </Pressable>

            <Pressable
              onPress={engine.toggleRepeatOnDemand}
              disabled={!engine.track}
              hitSlop={10}
              style={!engine.track && styles.transportButtonDisabled}>
              <Ionicons name="repeat" size={20} color={engine.repeatOnDemand ? colors.accent : colors.text} />
            </Pressable>
          </View>

          <ShareCard baseUrl={baseUrl} message={shareMessage} />

          <View style={styles.section} onLayout={onUpNextLayout}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Up next
            </ThemedText>
            {engine.stationQueue.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing queued — the station is shuffling the full catalog.
              </ThemedText>
            ) : (
              engine.stationQueue.slice(0, 4).map((item) => (
                <Row
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  meta={formatDuration(item.duration)}
                  onPress={() => playItem(item)}
                />
              ))
            )}
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Recently on air
            </ThemedText>
            {engine.recentlyPlayed.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing played yet this session.
              </ThemedText>
            ) : (
              engine.recentlyPlayed.slice(0, 3).map((item) => (
                <Row
                  key={`${item.id}-${item.playedAt}`}
                  id={item.id}
                  title={item.title}
                  meta={item.artist ?? ''}
                  onPress={() => playItem(item)}
                />
              ))
            )}
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Posts
            </ThemedText>
            {!postsLoaded ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : posts.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No posts yet.
              </ThemedText>
            ) : (
              posts.map((post) => <PostRow key={post.id} post={post} />)
            )}
          </View>
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function ShareCard({ baseUrl, message }: { baseUrl: string | null; message: string }) {
  const colors = useTheme();
  const [copied, setCopied] = useState(false);

  const copyLink = useCallback(async () => {
    if (!baseUrl) return;
    await Clipboard.setStringAsync(baseUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [baseUrl]);

  const shareVia = useCallback(() => {
    if (!baseUrl) return;
    Share.share({ message }).catch(() => {});
  }, [baseUrl, message]);

  return (
    <View style={[styles.shareCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <ThemedText type="smallBold" style={styles.shareTitle}>
        Share
      </ThemedText>

      <Pressable onPress={copyLink} disabled={!baseUrl} style={styles.shareRow}>
        <Ionicons name={copied ? 'checkmark' : 'link'} size={18} color={copied ? colors.accent : colors.text} />
        <ThemedText style={copied ? { color: colors.accent } : undefined}>{copied ? 'Copied' : 'Copy link'}</ThemedText>
      </Pressable>

      <Pressable onPress={shareVia} disabled={!baseUrl} style={styles.shareRow}>
        <Ionicons name="share-outline" size={18} color={colors.text} />
        <ThemedText>Share via…</ThemedText>
      </Pressable>

      <View style={styles.shareHint}>
        <Ionicons name="chevron-up" size={14} color={colors.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          Swipe up for more
        </ThemedText>
      </View>
    </View>
  );
}

function PostRow({ post }: { post: CreatorPost }) {
  const colors = useTheme();
  return (
    <View style={[styles.postRow, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <View style={styles.postHeader}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.postTitle}>
          {post.title ?? 'Update'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatPostDate(post.published_at)}
        </ThemedText>
      </View>
      <ThemedText themeColor="textSecondary" numberOfLines={3}>
        {post.body}
      </ThemedText>
    </View>
  );
}

/** Tap-to-seek rather than drag — a drag gesture on a horizontal bar risks fighting the bottom sheet's own vertical pan. */
function ProgressBar({ progress, onSeekFraction }: { progress: number; onSeekFraction: (fraction: number) => void }) {
  const colors = useTheme();
  const widthRef = useRef(0);
  const pct = Math.max(0, Math.min(1, progress)) * 100;

  const handlePress = (event: GestureResponderEvent) => {
    if (!widthRef.current) return;
    const fraction = Math.max(0, Math.min(1, event.nativeEvent.locationX / widthRef.current));
    onSeekFraction(fraction);
  };

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={{ top: 12, bottom: 12 }}
      style={styles.progressHit}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}>
      <View style={[styles.progressTrack, { backgroundColor: colors.backgroundElement }]}>
        <View style={[styles.progressFill, { backgroundColor: colors.accent, width: `${pct}%` }]} />
      </View>
      <View style={[styles.progressThumb, { backgroundColor: colors.accent, left: `${pct}%` }]} />
    </Pressable>
  );
}

function Row({ id, title, meta, onPress }: { id: number; title: string; meta: string; onPress: () => void }) {
  const colors = useTheme();
  const { baseUrl, listenerAuth } = useStationStore();
  const authHeaders = listenerAuth?.token ? { Authorization: `Bearer ${listenerAuth.token}` } : undefined;
  const artworkUrl = baseUrl ? libraryArtworkUrl(baseUrl, id) : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.backgroundElement, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}>
      <View style={[styles.rowArt, { backgroundColor: colors.accentSoft }]}>
        {artworkUrl ? (
          <Image source={{ uri: artworkUrl, headers: authHeaders }} style={styles.rowArt} contentFit="cover" />
        ) : null}
      </View>
      <View style={styles.rowText}>
        <ThemedText numberOfLines={1} style={styles.rowTitle}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {meta}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.one,
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  artworkFrame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: Spacing.four,
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  artworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkGlyph: {
    fontSize: 72,
  },
  metaRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDisabled: {
    opacity: 0.35,
  },
  metaText: {
    flex: 1,
    gap: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
  },
  progressBlock: {
    width: '100%',
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    gap: Spacing.one,
  },
  progressHit: {
    justifyContent: 'center',
    height: 24,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  progressThumb: {
    position: 'absolute',
    top: '50%',
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: -6,
    marginLeft: -6,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: Spacing.four,
    paddingHorizontal: Spacing.one,
  },
  transportButtonDisabled: {
    opacity: 0.35,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyphOffset: {
    marginLeft: 3,
  },
  shareCard: {
    width: '100%',
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one,
  },
  shareTitle: {
    marginBottom: Spacing.one,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  shareHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: Spacing.one,
  },
  section: {
    width: '100%',
    marginTop: Spacing.four,
    gap: Spacing.two,
  },
  sectionTitle: {
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowArt: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    flex: 1,
  },
  postRow: {
    width: '100%',
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  postTitle: {
    flex: 1,
  },
});
