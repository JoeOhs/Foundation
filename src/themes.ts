// Theme registry — see THEMES.md for the full design spec (token tables,
// gradient recipes, signature details). The CSS side lives in themes.css;
// this module owns identity, defaults, and legacy migration.
export type ThemeId = 'obsidian' | 'midnight' | 'cosmic' | 'sunset' | 'emerald' | 'nova';

export interface ThemeMeta {
  label: string;
  mode: 'dark' | 'light';
  // [base, accent1, accent2] chips shown in the picker
  swatch: [string, string, string];
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  obsidian: { label: 'Obsidian', mode: 'dark', swatch: ['#0a0a0c', '#c4c9d4', '#dfae61'] },
  midnight: { label: 'Midnight', mode: 'dark', swatch: ['#0e0a1c', '#8b6ef2', '#4fd7c4'] },
  cosmic: { label: 'Cosmic', mode: 'dark', swatch: ['#0a0014', '#00e5ff', '#ff6ec7'] },
  sunset: { label: 'Sunset', mode: 'dark', swatch: ['#1a0d08', '#ff7043', '#ffab40'] },
  emerald: { label: 'Emerald', mode: 'dark', swatch: ['#0e1f16', '#5fd393', '#d4a24e'] },
  nova: { label: 'Nova', mode: 'light', swatch: ['#faf7f2', '#7ba7cc', '#e8a3b3'] },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

// OS-aware default, same behavior the old boolean had: dark systems get
// Obsidian, light systems get Nova, until the user picks explicitly.
export function systemDefaultTheme(): ThemeId {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'nova' : 'obsidian';
}

// The persisted pref used to be 'dark' | 'light' | null; map those legacy
// values onto the registry so nobody's saved preference breaks.
export function normalizeStoredTheme(value: unknown): ThemeId | null {
  if (value === 'dark') return 'obsidian';
  if (value === 'light') return 'nova';
  return typeof value === 'string' && value in THEMES ? (value as ThemeId) : null;
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
}
