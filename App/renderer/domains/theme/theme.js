export const THEME_CYCLE = ['dark', 'light', 'high-contrast', 'solarized-dark', 'solarized-light'];
export const DEFAULT_THEME = 'dark';

export function isLightTheme(theme) {
  return theme === 'light' || theme === 'solarized-light';
}

export function normalizeTheme(theme) {
  return theme || DEFAULT_THEME;
}

export function nextTheme(current) {
  const i = THEME_CYCLE.indexOf(normalizeTheme(current));
  return THEME_CYCLE[(i === -1 ? 0 : i + 1) % THEME_CYCLE.length];
}

export function monacoThemeFor(theme) {
  return isLightTheme(theme) ? 'vs' : 'vs-dark';
}

const api = { THEME_CYCLE, DEFAULT_THEME, isLightTheme, normalizeTheme, nextTheme, monacoThemeFor };
if (typeof window !== 'undefined') window.__theme = api;
export default api;
