// KPIs view — board view of how the venture is performing, by area.
//
// Per v0.6 mockup IA:
//   - Header with Scope dropdown (filters by area)
//   - Sources row (read-only inventory of where measurements come from)
//   - 4-up KPI card grid
//
// Real Tuto substrate today: 11 KPIs across 5 areas (audience, build_readiness,
// revenue, self_use, strategic_clarity), 5 categories (lagging, leading,
// milestone, north_star, operational). Most have target + definition but no
// measurements yet — UI handles "no data yet" gracefully.

import { escapeHtml, ago, isoDay } from '../utils.js';

let activeAreaFilter = 'all';
let scopeDropdownOpen = false;

export function renderKpis(ctx) {
  const root = document.getElementById('route-kpis');
  const kpis = ctx.kpis || [];
  const areas = Array.from(new Set(kpis.map(k => k.area).filter(Boolean))).sort();
  const sources = collectSources(kpis);

  const filteredKpis = activeAreaFilter === 'all'
    ? kpis
    : kpis.filter(k => k.area === activeAreaFilter);

  const priorityOrder = { primary: 1, secondary: 2 };
  const categoryOrder = { north_star: 1, lagging: 2, leading: 3, milestone: 4, operational: 5 };
  const sorted = filteredKpis.slice().sort((a, b) => {
    const pa = priorityOrder[a.priority] || 9;
    const pb = priorityOrder[b.priority] || 9;
    if (pa !== pb) return pa - pb;
    const ca = categoryOrder[a.category] || 9;
    const cb = categoryOrder[b.category] || 9;
    if (ca !== cb) return ca - cb;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Scope dropdown lives in the page header (per mockup line 491). The KPI
  // page is unusual — its scope filter sits TOP-RIGHT in the header, not in
  // a separate filter bar. So we inject directly into the page header.
  const headerRight = document.querySelector('section[data-route="kpis"] .page-header-right')
    || createHeaderRight();
  headerRight.innerHTML = renderScopeDropdown(areas);
  wireScopeDropdown(ctx, areas);

  root.innerHTML = `
    ${renderSourcesBar(sources)}
    ${renderKpiGrid(sorted)}
  `;
}

function createHeaderRight() {
  const header = document.querySelector('section[data-route="kpis"] .page-header');
  const div = document.createElement('div');
  div.className = 'page-header-right';
  header.appendChild(div);
  return div;
}

function renderScopeDropdown(areas) {
  const currentLabel = activeAreaFilter === 'all'
    ? 'All areas'
    : activeAreaFilter.replace(/_/g, ' ');
  return `
    <div class="scope-dropdown">
      <button type="button" class="scope-dd-trigger" id="scope-dd-trigger" aria-haspopup="listbox" aria-expanded="${scopeDropdownOpen}">
        <span class="mono scope-dd-label">SCOPE</span>
        <span class="scope-dd-current">${escapeHtml(currentLabel)}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      ${scopeDropdownOpen ? `
        <div class="scope-dd-menu" role="listbox">
          <button type="button" class="scope-dd-item ${activeAreaFilter === 'all' ? 'current' : ''}" data-scope="all">
            <span class="scope-dd-dot" style="background:var(--accent)"></span>All areas
          </button>
          ${areas.map((a, i) => {
            const colors = ['#e0683a', '#0e9f6e', '#7a4dff', '#a9790a', '#3aa3c7'];
            const c = colors[i % colors.length];
            return `
              <button type="button" class="scope-dd-item ${activeAreaFilter === a ? 'current' : ''}" data-scope="${escapeHtml(a)}">
                <span class="scope-dd-dot" style="background:${c}"></span>${escapeHtml(a.replace(/_/g, ' '))}
              </button>
            `;
          }).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function wireScopeDropdown(ctx, areas) {
  const trigger = document.getElementById('scope-dd-trigger');
  if (!trigger) return;
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    scopeDropdownOpen = !scopeDropdownOpen;
    renderKpis(ctx);
  });
  document.querySelectorAll('.scope-dd-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      activeAreaFilter = item.dataset.scope;
      scopeDropdownOpen = false;
      renderKpis(ctx);
    });
  });
  // Click outside to close
  if (scopeDropdownOpen) {
    setTimeout(() => {
      document.addEventListener('click', function closeOnce() {
        scopeDropdownOpen = false;
        renderKpis(ctx);
        document.removeEventListener('click', closeOnce);
      });
    }, 0);
  }
}

function collectSources(kpis) {
  const map = {};
  for (const k of kpis) {
    const src = k.data_source;
    if (!src) continue;
    const key = typeof src === 'string' ? src : (src.kind || src.connector || 'unknown');
    if (!map[key]) map[key] = { name: key, count: 0 };
    map[key].count += 1;
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

function renderSourcesBar(sources) {
  if (!sources.length) return '';
  return `
    <div class="sources-bar">
      <span class="card-section-label" style="margin-right:8px">SOURCES</span>
      ${sources.map(s => `
        <div class="source-chip">
          <span class="source-chip-icon mono">${escapeHtml(s.name.charAt(0).toUpperCase())}</span>
          <div class="source-chip-text">
            <div class="source-chip-name">${escapeHtml(s.name.replace(/_/g, ' '))}</div>
            <div class="source-chip-count mono">${s.count} KPI${s.count === 1 ? '' : 's'}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderKpiGrid(kpis) {
  if (!kpis.length) {
    return `<div class="card"><div class="empty-state">No KPIs in this scope.</div></div>`;
  }
  return `
    <div class="kpi-grid">
      ${kpis.map(renderKpiCard).join('')}
    </div>
  `;
}

function renderKpiCard(k) {
  // No measurements yet → show target + "not measured yet"
  // (When measurements flow in: latest value + delta vs previous + trend chip)
  const value = k.last_value != null ? formatValue(k.last_value, k.unit) : '—';
  const valueSub = k.last_measured_at
    ? `as of ${escapeHtml(ago(k.last_measured_at))}`
    : 'not measured yet';
  const target = k.target != null
    ? `target ${formatValue(k.target, k.unit)}`
    : '';
  const categoryChip = categoryChipForKpi(k);
  const dot = dotForKpi(k);

  return `
    <div class="kpi-card" title="${escapeHtml(k.description || '')}">
      <div class="kpi-card-head">
        <span class="kpi-card-name">${escapeHtml(k.name)}</span>
        <span class="kpi-card-dot" style="background:${dot.color}" title="${escapeHtml(dot.why)}"></span>
      </div>
      <div class="kpi-card-value mono">${escapeHtml(value)}</div>
      <div class="kpi-card-sub">${escapeHtml(valueSub)}${target ? ' · ' + escapeHtml(target) : ''}</div>
      <div class="kpi-card-foot">
        <span class="kpi-card-area mono">${escapeHtml((k.area || '').replace(/_/g, ' '))}</span>
        ${categoryChip}
      </div>
    </div>
  `;
}

function dotForKpi(k) {
  // Color heuristic — green if has measurement + meets target, yellow if has measurement
  // but not at target, gray if no measurement yet, red if explicitly underperforming.
  if (k.last_value == null) return { color: 'var(--text-veryfaint)', why: 'no measurement yet' };
  const hib = k.direction === 'higher_is_better';
  if (k.target == null) return { color: 'var(--text-faint)', why: 'no target set' };
  const meets = hib ? k.last_value >= k.target : k.last_value <= k.target;
  return meets
    ? { color: 'var(--green)', why: 'at or above target' }
    : { color: 'var(--yellow)', why: 'below target' };
}

function categoryChipForKpi(k) {
  const cat = (k.category || '').toLowerCase();
  const map = {
    north_star: { fg: '#fff', bg: 'var(--accent)', label: 'North Star' },
    lagging:    { fg: 'var(--text-dim)', bg: 'var(--surface2)', label: 'Lagging' },
    leading:    { fg: 'var(--green-fg)', bg: 'var(--green-bg)', label: 'Leading' },
    milestone:  { fg: 'var(--yellow-fg)', bg: 'var(--yellow-bg)', label: 'Milestone' },
    operational:{ fg: 'var(--text-dim)', bg: 'var(--surface2)', label: 'Operational' },
  };
  const c = map[cat] || { fg: 'var(--text-faint)', bg: 'var(--surface2)', label: cat || 'kpi' };
  return `<span class="kpi-card-cat-chip" style="color:${c.fg};background:${c.bg}">${escapeHtml(c.label)}</span>`;
}

function formatValue(v, unit) {
  if (typeof v === 'number') {
    const formatted = Number.isInteger(v) ? v.toString() : v.toFixed(1);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return String(v);
}
