import type { ReaderFont, ReaderSettings, ReaderTheme, SortKey } from '@margin/shared';
import { useSyncExternalStore } from 'react';

/** Small localStorage-backed stores for per-device preferences (not synced, like Instapaper's per-device "Aa"). */
function createLocalStore<T extends object>(key: string, defaults: T) {
  const listeners = new Set<() => void>();
  let value: T = { ...defaults, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<T>) };
  return {
    get: () => value,
    set(patch: Partial<T>) {
      value = { ...value, ...patch };
      localStorage.setItem(key, JSON.stringify(value));
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const readerSettings = createLocalStore<ReaderSettings>('margin.reader', {
  theme: 'light',
  font: 'literata',
  fontSize: 20,
  lineHeight: 1.6,
  measure: 66,
});

export interface AppSettings {
  /** Bearer token, only needed when the server runs with APP_TOKEN. */
  apiToken: string;
  /** Archive an article automatically when you reach the end (Instapaper option). */
  autoArchive: boolean;
  sort: SortKey;
}

export const appSettings = createLocalStore<AppSettings>('margin.app', {
  apiToken: '',
  autoArchive: false,
  sort: 'newest',
});

export const useReaderSettings = () => useSyncExternalStore(readerSettings.subscribe, readerSettings.get);
export const useAppSettings = () => useSyncExternalStore(appSettings.subscribe, appSettings.get);

export const THEMES: Record<ReaderTheme, { label: string; bg: string; fg: string; muted: string }> = {
  light: { label: 'Light', bg: '#ffffff', fg: '#000000', muted: '#6b6b6b' },
  sepia: { label: 'Sepia', bg: '#f5ecd9', fg: '#3b2f22', muted: '#8a7660' },
  dark: { label: 'Dark', bg: '#2a2c30', fg: '#dcdcdc', muted: '#9a9ca1' },
  black: { label: 'Black', bg: '#000000', fg: '#c9c9c9', muted: '#8a8a8a' },
};

export const FONTS: Record<ReaderFont, { label: string; stack: string }> = {
  literata: { label: 'Literata', stack: "'Literata', Georgia, serif" },
  'source-serif': { label: 'Source Serif', stack: "'Source Serif 4', Georgia, serif" },
  lora: { label: 'Lora', stack: "'Lora', Georgia, serif" },
  inter: { label: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  atkinson: { label: 'Atkinson', stack: "'Atkinson Hyperlegible', system-ui, sans-serif" },
};
