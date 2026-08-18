import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { DashboardClientError } from '@/api/dashboardClient';
import type { LibraryProject } from '@/api/stationClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient, useStudioStore } from '@/state/studioStore';

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'music', label: 'Music' },
  { value: 'beats', label: 'Beats' },
  { value: 'podcasts', label: 'Podcasts / interviews' },
  { value: 'videos', label: 'Videos' },
  { value: 'drafts', label: 'Drafts / demos' },
  { value: 'live_sessions', label: 'Live sessions' },
];

const VISIBILITIES: { value: 'public' | 'supporters_only' | 'vault'; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'supporters_only', label: 'Supporters only' },
  { value: 'vault', label: 'Private vault' },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * Mirrors web Studio's upload modal (AppShell.tsx) field-for-field: file,
 * title (auto-filled from filename), category, visibility, an optional
 * "add to collection" pick, and optional cover art — same three-call
 * sequence (upload -> addTrack -> uploadArtwork), with the same
 * non-blocking-toast treatment for the two optional follow-up calls
 * failing after a successful upload.
 *
 * File/image selection uses expo-file-system's own `File.pickFileAsync`
 * (SDK 57) rather than adding `expo-document-picker`/`expo-image-picker` —
 * expo-file-system is already a dependency (Phase 4's Stash) and its picker
 * covers both the media file and the cover-art image, so no new native
 * dependency was needed for either.
 */
export function UploadScreen() {
  const colors = useTheme();
  const { signOut } = useStudioStore();
  const dashboard = useDashboardClient();

  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('music');
  const [visibility, setVisibility] = useState<'public' | 'supporters_only' | 'vault'>('public');
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [projects, setProjects] = useState<LibraryProject[]>([]);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string, sticky = false) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    if (!sticky) noticeTimerRef.current = setTimeout(() => setNotice(null), 3000);
  }, []);

  useEffect(() => {
    if (!dashboard) return;
    dashboard
      .libraryStructure()
      .then((data) => setProjects(data.projects))
      .catch(() => {
        // Collection picker is optional — a failed fetch just leaves it empty, not a blocking error.
      });
  }, [dashboard]);

  const pickMedia = useCallback(async () => {
    const picked = await File.pickFileAsync({ mimeTypes: ['audio/*', 'video/*'] });
    if (picked.canceled) return;
    setMediaFile(picked.result);
    if (!title.trim()) setTitle(picked.result.name.replace(/\.[^.]+$/, ''));
  }, [title]);

  const pickArtwork = useCallback(async () => {
    const picked = await File.pickFileAsync({ mimeTypes: ['image/*'] });
    if (picked.canceled) return;
    setArtworkFile(picked.result);
  }, []);

  const reset = useCallback(() => {
    setMediaFile(null);
    setArtworkFile(null);
    setTitle('');
    setCategory('music');
    setVisibility('public');
    setCollectionId(null);
  }, []);

  const submit = useCallback(async () => {
    if (!dashboard || !mediaFile) return;
    setUploading(true);
    setProgress(0);
    try {
      const result = await dashboard.upload({
        fileUri: mediaFile.uri,
        mimeType: mediaFile.type || undefined,
        category,
        visibility,
        title: title.trim() || undefined,
        onProgress: setProgress,
      });

      if (collectionId) {
        try {
          await dashboard.addTrackToCollection(collectionId, result.id);
        } catch {
          notify('Uploaded, but couldn’t add it to that collection.');
        }
      }
      if (artworkFile) {
        try {
          await dashboard.uploadArtwork(result.id, artworkFile.uri, artworkFile.type || undefined);
        } catch {
          notify('Uploaded, but couldn’t attach the cover art.');
        }
      }

      notify(`${result.title || result.filename} added to the library.`);
      reset();
    } catch (err) {
      if (err instanceof DashboardClientError) {
        if (err.status === 401) {
          signOut();
          return;
        }
        const data = err.data as { error?: string };
        notify(data?.error || 'Upload failed.');
      } else {
        notify('Upload failed — connection error.');
      }
    } finally {
      setUploading(false);
    }
  }, [dashboard, mediaFile, category, visibility, title, collectionId, artworkFile, notify, reset, signOut]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Upload</ThemedText>
        {notice ? (
          <ThemedText type="small" themeColor="accent">
            {notice}
          </ThemedText>
        ) : null}
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Pressable
          onPress={pickMedia}
          disabled={uploading}
          style={[styles.dropzone, { borderColor: colors.border, opacity: uploading ? 0.6 : 1 }]}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.dropzoneText}>
            {mediaFile ? mediaFile.name : 'Choose audio or video'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {mediaFile ? formatBytes(mediaFile.size) : 'WAV, MP3, MOV, or MP4 · up to 2GB'}
          </ThemedText>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
          Title
        </ThemedText>
        <TextInput
          value={title}
          onChangeText={setTitle}
          editable={!uploading}
          placeholder="Name this work"
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        />

        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
          Category
        </ThemedText>
        <View style={styles.chipRow}>
          {CATEGORIES.map((item) => {
            const selected = category === item.value;
            return (
              <Pressable
                key={item.value}
                disabled={uploading}
                onPress={() => setCategory(item.value)}
                style={[
                  styles.chip,
                  {
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accentSoft : 'transparent',
                  },
                ]}>
                <ThemedText type="small" themeColor={selected ? 'accent' : 'text'}>
                  {item.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
          Visibility
        </ThemedText>
        <View style={styles.chipRow}>
          {VISIBILITIES.map((item) => {
            const selected = visibility === item.value;
            return (
              <Pressable
                key={item.value}
                disabled={uploading}
                onPress={() => setVisibility(item.value)}
                style={[
                  styles.chip,
                  {
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accentSoft : 'transparent',
                  },
                ]}>
                <ThemedText type="small" themeColor={selected ? 'accent' : 'text'}>
                  {item.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        {projects.length > 0 ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Add to collection
            </ThemedText>
            <View style={styles.chipRow}>
              <Pressable
                disabled={uploading}
                onPress={() => setCollectionId(null)}
                style={[
                  styles.chip,
                  {
                    borderColor: collectionId === null ? colors.accent : colors.border,
                    backgroundColor: collectionId === null ? colors.accentSoft : 'transparent',
                  },
                ]}>
                <ThemedText type="small" themeColor={collectionId === null ? 'accent' : 'text'}>
                  None
                </ThemedText>
              </Pressable>
              {projects.map((project) => {
                const selected = collectionId === project.id;
                return (
                  <Pressable
                    key={project.id}
                    disabled={uploading}
                    onPress={() => setCollectionId(project.id)}
                    style={[
                      styles.chip,
                      {
                        borderColor: selected ? colors.accent : colors.border,
                        backgroundColor: selected ? colors.accentSoft : 'transparent',
                      },
                    ]}>
                    <ThemedText type="small" themeColor={selected ? 'accent' : 'text'} numberOfLines={1}>
                      {project.name}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
          Cover art (optional)
        </ThemedText>
        <Pressable
          onPress={pickArtwork}
          disabled={uploading}
          style={[styles.artworkButton, { borderColor: colors.border }]}>
          <ThemedText type="small" numberOfLines={1}>
            {artworkFile ? artworkFile.name : 'Choose an image…'}
          </ThemedText>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.warning}>
          Keep this screen open until the upload finishes — leaving it may cancel or interrupt the transfer.
        </ThemedText>

        <Pressable
          onPress={submit}
          disabled={!mediaFile || uploading}
          style={[styles.submitButton, { backgroundColor: colors.accent, opacity: !mediaFile || uploading ? 0.5 : 1 }]}>
          {uploading ? (
            <View style={styles.submitProgress}>
              <ActivityIndicator color={colors.background} size="small" />
              <ThemedText type="smallBold" style={{ color: colors.background }}>
                {`Uploading… ${Math.round(progress * 100)}%`}
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="smallBold" style={{ color: colors.background }}>
              Add to library
            </ThemedText>
          )}
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.one,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: Spacing.three,
    gap: Spacing.one,
    // The sticky mini-player floats over the last ~BottomTabInset px of
    // every tab (StickyTransportBar.tsx) — plain Spacing.six wasn't enough
    // to clear it, found on real hardware where it covered the submit
    // button (screens with shorter content, like Discover/Stack, never
    // surfaced this since nothing critical sits at their scroll end).
    paddingBottom: Spacing.six + BottomTabInset,
  },
  dropzone: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.xl,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  dropzoneText: {
    maxWidth: '100%',
  },
  fieldLabel: {
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  artworkButton: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  warning: {
    marginTop: Spacing.three,
  },
  submitButton: {
    borderRadius: Radius.lg,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  submitProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
});
