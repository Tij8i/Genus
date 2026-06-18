// Shared formatting + rendering helpers used across view modules.

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Human-friendly "time ago" — "3m", "2h", "4d", "2w". Returns "—" if invalid.
export function ago(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const delta = Date.now() - t;
  if (delta < 0) return 'just now';
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d`;
  const wk = Math.floor(day / 7);
  return `${wk}w`;
}

// "JUN 18", "today", "tomorrow", or "in Nd" — for upcoming milestones.
export function dateLabel(iso) {
  if (!iso) return '—';
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '—';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOnly = new Date(target);
  dateOnly.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((dateOnly - today) / 86400000);
  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const label = `${monthNames[dateOnly.getMonth()]} ${dateOnly.getDate()}`;
  if (dayDiff === 0) return `${label} · TODAY`;
  if (dayDiff === 1) return `${label} · TOMORROW`;
  if (dayDiff > 0 && dayDiff < 14) return `${label} · IN ${dayDiff} DAYS`;
  if (dayDiff < 0 && dayDiff > -14) return `${label} · ${Math.abs(dayDiff)}D AGO`;
  return label;
}

// SVG icons used across views. Returns markup string.
export function icon(name, opts = {}) {
  const color = opts.color || 'currentColor';
  const size = opts.size || 16;
  const stroke = opts.stroke || 2;
  const wrap = (path) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  switch (name) {
    case 'check-circle': return wrap('<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.3 2.3 4.7-4.8"/>');
    case 'circle': return wrap('<circle cx="12" cy="12" r="9"/>');
    case 'arrow-right': return wrap('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>');
    case 'arrow-trend-up': return wrap('<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v5h-5"/>');
    case 'lock': return wrap('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
    case 'spark': return wrap('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>');
    default: return '';
  }
}

// Group items by key (string-returning fn).
export function groupBy(arr, fn) {
  const out = {};
  for (const item of arr) {
    const k = fn(item);
    (out[k] = out[k] || []).push(item);
  }
  return out;
}

// Convert ISO date to YYYY-MM-DD for comparisons.
export function isoDay(iso) {
  if (!iso) return null;
  return iso.slice(0, 10);
}

// Days between two ISO dates (positive = b is after a).
export function daysBetween(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Sum the time-elapsed and time-remaining of a cycle (active plan).
// Returns { totalDays, elapsedDays, remainingDays, percentElapsed }.
export function cycleTimeProgress(plan) {
  if (!plan) return null;
  const start = plan.period_start || plan.activated_at || plan.created_at;
  const end = plan.period_target_end;
  if (!start || !end) return null;
  const total = daysBetween(start, end);
  if (total == null || total <= 0) return null;
  const elapsed = Math.max(0, Math.min(total, daysBetween(start, new Date().toISOString())));
  return {
    totalDays: total,
    elapsedDays: elapsed,
    remainingDays: total - elapsed,
    percentElapsed: Math.round((elapsed / total) * 100),
  };
}
