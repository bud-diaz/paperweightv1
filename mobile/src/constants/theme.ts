/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Token values from `mobile/paperweight-new-design-spec.md` (ink / surface /
 * raised / paper / concrete / oxide) — "heavy, grounded, architectural"
 * industrial system, replacing an earlier pink/red accent draft. Oxide is
 * deliberately reused for `live` too (the spec's own "Color means something
 * is happening" rule: one accent for active/live/selected states, not a
 * separate brand color per meaning). The spec only defines a single dark
 * palette (section 7); `light` below is derived to preserve the same
 * value relationships since the app supports OS-level light mode and the
 * spec doesn't say to drop that.
 */
export const Colors = {
  light: {
    text: '#141414',
    background: '#F5F4F0',
    backgroundElement: '#EAE9E4',
    backgroundSelected: '#DEDCD5',
    textSecondary: '#6B6A65',
    border: 'rgba(20, 20, 20, 0.08)',
    accent: '#C84B20',
    accentSoft: 'rgba(200, 75, 32, 0.12)',
    live: '#C84B20',
  },
  dark: {
    text: '#F0EFEA',
    background: '#090909',
    backgroundElement: '#121212',
    backgroundSelected: '#1B1B1B',
    textSecondary: '#8A8984',
    border: 'rgba(240, 239, 234, 0.08)',
    accent: '#C84B20',
    accentSoft: 'rgba(200, 75, 32, 0.14)',
    live: '#C84B20',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Corner radii from the design spec's "Component Shape Language" — small/medium-small, not the 20-30px pill radii it explicitly calls out to avoid. */
export const Radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
} as const;

export const BottomTabInset = Platform.select({ ios: 70, android: 120 }) ?? 0;
export const MaxContentWidth = 800;
