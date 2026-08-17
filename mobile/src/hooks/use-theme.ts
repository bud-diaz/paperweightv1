/**
 * Dark is the app's only real theme for now — `mobile/paperweight-new-
 * design-spec.md` defines a single dark (ink/surface/raised) palette with
 * no light-mode counterpart, and there's no in-app appearance setting yet
 * (Phase 7). `Colors.light` in constants/theme.ts is kept around as a
 * derived-but-unused fallback in case a real light spec or a Settings
 * toggle shows up later, but nothing should select it by default.
 */

import { Colors } from '@/constants/theme';

export function useTheme() {
  return Colors.dark;
}
