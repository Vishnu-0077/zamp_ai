/** Light/dark/system theme preference (per-browser convenience only). */
const THEME_KEY = 'invoice-review.theme';
export type Theme = 'system' | 'light' | 'dark';

export function currentTheme(): Theme {
  return (document.documentElement.getAttribute('data-theme') as Theme | null) ?? 'system';
}

export function applyTheme(theme: Theme | string) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
}

export function restoreTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch { /* storage unavailable */ }
}
