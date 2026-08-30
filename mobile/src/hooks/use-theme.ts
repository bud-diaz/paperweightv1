/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOptionalAppSettings } from '@/state/appSettingsStore';

export function useTheme() {
  const settings = useOptionalAppSettings();
  const scheme = useColorScheme();
  const theme = settings?.themeMode && settings.themeMode !== 'system' ? settings.themeMode : scheme === 'unspecified' ? 'light' : scheme;

  return Colors[theme];
}
