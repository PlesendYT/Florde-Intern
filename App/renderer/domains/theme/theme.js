export const THEME_CYCLE = ['florde-dark', 'florde-light', 'florde-midnight'];
export const DEFAULT_THEME = 'florde-dark';

const LEGACY_MAP = {
  dark: 'florde-dark',
  light: 'florde-light',
  'high-contrast': 'florde-dark',
  'solarized-dark': 'florde-dark',
  'solarized-light': 'florde-light',
};

export function migrateTheme(theme) {
  if (!theme) return DEFAULT_THEME;
  if (THEME_CYCLE.includes(theme)) return theme;
  return LEGACY_MAP[theme] || DEFAULT_THEME;
}

export function isLightTheme(theme) {
  return migrateTheme(theme) === 'florde-light';
}

export function normalizeTheme(theme) {
  return migrateTheme(theme);
}

export function nextTheme(current) {
  const i = THEME_CYCLE.indexOf(migrateTheme(current));
  return THEME_CYCLE[(i === -1 ? 0 : i + 1) % THEME_CYCLE.length];
}

export function monacoThemeFor(theme) {
  return isLightTheme(theme) ? 'vs' : 'vs-dark';
}

const api = { THEME_CYCLE, DEFAULT_THEME, isLightTheme, normalizeTheme, nextTheme, monacoThemeFor, migrateTheme };
if (typeof window !== 'undefined') window.__theme = api;
export default api;
