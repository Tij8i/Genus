// Global appearance preferences — accent color + density.
//
// Persisted in localStorage (per-browser). Applied to <html> as CSS custom
// properties so any styled element using var(--accent) / var(--pad) / etc.
// picks up the change without re-rendering.
//
// Per v0.7 design: 4 accent swatches + 2 densities (Comfortable / Compact).
// Defaults match the v1 baseline (Genus blue, Comfortable).

const STORAGE_KEY = 'genus.appearance.v1';

export const ACCENT_OPTIONS = [
  { key: 'blue',   color: '#2f6bff', name: 'Genus blue' },
  { key: 'indigo', color: '#5b53d6', name: 'Indigo' },
  { key: 'green',  color: '#0e9f6e', name: 'Green' },
  { key: 'orange', color: '#e0683a', name: 'Orange' },
];

export const DENSITY_OPTIONS = [
  { key: 'comfortable', pad: '26px', gap: '22px', name: 'Comfortable' },
  { key: 'compact',     pad: '20px', gap: '16px', name: 'Compact' },
];

const DEFAULT = { accent: 'blue', density: 'comfortable' };

export function loadAppearance() {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveAppearance(partial) {
  const merged = { ...loadAppearance(), ...partial };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); }
  catch { /* quota / disabled — change still applies in-memory */ }
  applyAppearance();
  return merged;
}

export function applyAppearance() {
  const { accent, density } = loadAppearance();
  const accentOpt = ACCENT_OPTIONS.find(a => a.key === accent) || ACCENT_OPTIONS[0];
  const densityOpt = DENSITY_OPTIONS.find(d => d.key === density) || DENSITY_OPTIONS[0];

  const root = document.documentElement;
  root.style.setProperty('--accent', accentOpt.color);
  root.style.setProperty('--accent-bg', hexToRgba(accentOpt.color, 0.10));
  root.style.setProperty('--accent-border', hexToRgba(accentOpt.color, 0.20));
  root.style.setProperty('--pad', densityOpt.pad);
  root.style.setProperty('--gap', densityOpt.gap);

  // Also update the BU switcher logo + operator avatar gradient that hardcodes
  // the accent. Those live in app.css with var(--accent) so they pick up
  // automatically; the operator avatar uses a gradient hard-coded to blue+purple,
  // which we leave alone (it's a brand mark, not theme).
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
