import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { DashboardClientError } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient } from '@/state/dashboardAuthStore';

type Category = 'music' | 'video' | 'podcast' | 'other';
type Visibility = 'public' | 'supporters_only' | 'vault';
type PickedUploadFile = { uri: string; name: string; mimeType?: string | null; size?: number | null };

const CATEGORIES: Category[] = ['music', 'video', 'podcast', 'other'];
const VISIBILITIES: Visibility[] = ['public', 'supporters_only', 'vault'];

function humanBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function uploadErrorMessage(err: unknown) {
  if (err instanceof DashboardClientError) {
    const data = err.data as { error?: string } | undefined;
    return data?.error || `Upload failed (${err.status})`;
  }
  return 'Upload failed. Keep the app open, check your connection, and try again.';
}

export function UploadScreen() {
  const colors = useTheme();
  const router = useRouter();
  const client = useDashboardClient();

  const [file, setFile] = useState<PickedUploadFile | null>(null);
  const [category, setCategory] = useState<Category>('music');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickFile() {
    setError(null);
    setMessage(null);
    const result = await File.pickFileAsync({ mimeTypes: ['audio/*', 'video/*'], multipleFiles: false });
    if (result.canceled) return;
    const picked = result.result;
    setFile({ uri: picked.uri, name: picked.name, mimeType: picked.type || null, size: picked.size });
    if (!title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, ''));
  }

  async function upload() {
    if (!client || !file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setProgress(0);
    try {
      const uploaded = await client.uploadMedia({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        category,
        visibility,
        title,
        artist,
        album,
        onProgress: ({ bytesSent, totalBytes }) => {
          if (totalBytes > 0) setProgress(Math.min(1, bytesSent / totalBytes));
        },
      });
      setProgress(1);
      setMessage(`${uploaded.filename || file.name} uploaded to ${uploaded.category || category}. The vault scanner will finish indexing it.`);
    } catch (err) {
      if (err instanceof DashboardClientError && err.status === 401) router.replace('/(tabs)/studio');
      setError(uploadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!client) {
    return (
      <ThemedView style={styles.centerFill}>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          Pair this phone with Studio before uploading media.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <ThemedText type="smallBold">Media file</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Pick an audio or video file from this phone. Keep Paperweight open until the upload finishes — background uploads are not resumable in v1.
          </ThemedText>
          {file ? (
            <View style={[styles.fileBox, { borderColor: colors.border }]}>
              <ThemedText type="smallBold" numberOfLines={1}>{file.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{humanBytes(file.size)} · {file.mimeType || 'unknown type'}</ThemedText>
            </View>
          ) : null}
          <Pressable onPress={pickFile} disabled={busy} style={[styles.primaryButton, { backgroundColor: colors.accentSoft }]}>
            <ThemedText type="smallBold" themeColor="accent">{file ? 'Choose a different file' : 'Choose file'}</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <ThemedText type="smallBold">Vault details</ThemedText>
          <View style={styles.segmentGroup}>
            {CATEGORIES.map((item) => (
              <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && { backgroundColor: colors.accentSoft }]}>
                <ThemedText type="smallBold" themeColor={category === item ? 'accent' : 'textSecondary'}>{item}</ThemedText>
              </Pressable>
            ))}
          </View>
          <View style={styles.segmentGroup}>
            {VISIBILITIES.map((item) => (
              <Pressable key={item} onPress={() => setVisibility(item)} style={[styles.chip, visibility === item && { backgroundColor: colors.accentSoft }]}>
                <ThemedText type="smallBold" themeColor={visibility === item ? 'accent' : 'textSecondary'}>{item.replace('_', ' ')}</ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.textSecondary} style={[styles.input, { backgroundColor: colors.backgroundSelected, color: colors.text }]} />
          <TextInput value={artist} onChangeText={setArtist} placeholder="Artist" placeholderTextColor={colors.textSecondary} style={[styles.input, { backgroundColor: colors.backgroundSelected, color: colors.text }]} />
          <TextInput value={album} onChangeText={setAlbum} placeholder="Album" placeholderTextColor={colors.textSecondary} style={[styles.input, { backgroundColor: colors.backgroundSelected, color: colors.text }]} />
        </View>

        {busy ? (
          <View style={[styles.progressTrack, { backgroundColor: colors.backgroundElement }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.accent, width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
        {message ? <ThemedText type="small" style={{ color: colors.live }}>{message}</ThemedText> : null}
        {error ? <ThemedText type="small" style={{ color: colors.accent }}>{error}</ThemedText> : null}

        <Pressable onPress={upload} disabled={busy || !file} style={[styles.uploadButton, { backgroundColor: colors.accent, opacity: busy || !file ? 0.55 : 1 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.uploadLabel}>Upload to station</ThemedText>}
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  centerText: { textAlign: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  fileBox: { borderWidth: 1, borderRadius: 14, padding: Spacing.two, gap: 2 },
  primaryButton: { alignItems: 'center', borderRadius: 999, paddingVertical: Spacing.two },
  segmentGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  input: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  progressTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  uploadButton: { alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingVertical: Spacing.three },
  uploadLabel: { color: '#ffffff', fontWeight: '800' },
});
