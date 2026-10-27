import { useSyncExternalStore } from 'react';

/** Light/dark theme. No saved choice = follow the OS. The inline script in index.html applies it before first paint. */
export type Theme = 'light' | 'dark';

const KEY = 'notes.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

const saved = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
};

let theme: Theme = saved() ?? (media.matches ? 'dark' : 'light');
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#191919' : '#ffffff');
  listeners.forEach((l) => l());
}
apply();

media.addEventListener('change', () => {
  if (saved()) return;
  theme = media.matches ? 'dark' : 'light';
  apply();
});

export function getTheme() {
  return theme;
}

export function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  apply();
}

export function useTheme() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    getTheme,
  );
}

/** Stored ink colors are for white paper; in dark mode black ink shows as white (like OneNote). */
const DARK_INK: Record<string, string> = { '#1f1f1f': '#e6e6e3' };
export function inkColor(c: string) {
  return theme === 'dark' ? DARK_INK[c] ?? c : c;
}
