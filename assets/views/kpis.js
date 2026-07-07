// KPIs view — board view of how the venture is performing, by area.
//
// Per v0.6 mockup IA:
//   - Header with Scope dropdown (filters by area)
//   - Sources row (read-only inventory of where measurements come from)
//   - 4-up KPI card grid
//
// Each KPI card carries the operator-actionable surface restored under GEN-48
// (legacy parity from Tij8i/Orchestrator dashboard/public/assets/tuto.js):
//   - "+ Log value" → prompt → POST /api/log-kpi-measurement
//   - Current value vs target + trend projection (linear regression over the
//     captures inside `trend_window_days`)
//   - "With initiatives" projection: trend plus the sum of numeric
//     expected_deltas from active initiatives whose
//     predicted_outcome.kpi == this KPI
//   - Contributing initiative tags (clickable — navigates to Planning)
//   - Measurement count + capture method ("3 measurements · stewart_heartbeat")

import { escapeHtml, ago } from '../utils.js';

let activeAreaFilter = 'all';
let scopeDropdownOpen = false;
let activeSubTab = 'business';

export function renderKpis(ctx, hooks = {}) {
  // Read sub-tab from URL query (#kpis?tab=sources). Router strips queries
  // before validating, so this is safe.
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const tab = new URLSearchParams(queryStr).get('tab');
  if (tab === 'business' || tab === 'sources') activeSubTab = tab;

  const root = (document.getElementById('subtab-host') || document.getElementById('route-kpis'));
  const kpis = ctx.kpis || [];
  const connectors = ctx.connectors || [];
  const initiatives = ctx.initiatives || [];
  const measurementsByKpi = ctx.measurementsByKpi || {};
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
  wireScopeDropdown(ctx, areas, hooks);

  const subTabNav = `
    <nav class="subtab-nav">
      <button type="button" class="subtab-link ${activeSubTab === 'business' ? 'current' : ''}" data-subtab="business">Business</button>
      <button type="button" class="subtab-link ${activeSubTab === 'sources' ? 'current' : ''}" data-subtab="sources">Sources &amp; Health</button>
    </nav>
  `;

  // Business sub-tab keeps the legacy v0.6 layout (sources bar + 4-up grid).
  // Sources & Health sub-tab (GEN-49 restore) shows the KPI×connector join
  // table with per-row badge + action.
  const body = activeSubTab === 'sources'
    ? renderSourcesView(filteredKpis, connectors)
    : `
        ${renderSourcesBar(sources)}
        ${renderKpiGrid(sorted, measurementsByKpi, initiatives)}
      `;

  root.innerHTML = subTabNav + body;

  root.querySelectorAll('.subtab-link[data-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      window.location.hash = `#kpis?tab=${activeSubTab}`;
      renderKpis(ctx, hooks);
    });
  });

  if (activeSubTab === 'business') {
    wireLogButtons(hooks);
    wireContributingTags();
  }
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

function wireScopeDropdown(ctx, areas, hooks) {
  const trigger = document.getElementById('scope-dd-trigger');
  if (!trigger) return;
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    scopeDropdownOpen = !scopeDropdownOpen;
    renderKpis(ctx, hooks);
  });
  document.querySelectorAll('.scope-dd-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      activeAreaFilter = item.dataset.scope;
      scopeDropdownOpen = false;
      renderKpis(ctx, hooks);
    });
  });
  // Click outside to close
  if (scopeDropdownOpen) {
    setTimeout(() => {
      document.addEventListener('click', function closeOnce() {
        scopeDropdownOpen = false;
        renderKpis(ctx, hooks);
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
    const key = typeof src === 'string' ? src : (src.kind || src.connector || src.method || 'unknown');
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

function renderKpiGrid(kpis, measurementsByKpi, initiatives) {
  if (!kpis.length) {
    return `<div class="card"><div class="empty-state">No KPIs in this scope.</div></div>`;
  }
  return `
    <div class="kpi-grid">
      ${kpis.map(k => renderKpiCard(k, measurementsByKpi[k.id] || [], initiatives)).join('')}
    </div>
  `;
}

function renderKpiCard(k, measurements, initiatives) {
  const latest = measurements.length ? measurements[measurements.length - 1] : null;
  const currentValue = latest != null ? latest.value : k.last_value;
  const currentAt = latest != null
    ? (latest.captured_at || latest.at || latest.timestamp || latest.measured_at)
    : k.last_measured_at;

  const value = currentValue != null ? formatValue(currentValue, k.unit) : '—';
  const valueSub = currentAt
    ? `as of ${escapeHtml(ago(currentAt))}`
    : 'not measured yet';
  const target = k.target != null
    ? `target ${formatValue(k.target, k.unit)}`
    : '';
  const categoryChip = categoryChipForKpi(k);
  const dot = dotForKpi(k, currentValue);
  const sparkline = renderKpiSparkline(k, measurements);

  const isBinary = k.unit === 'binary' || k.direction === 'binary' || k.type === 'milestone';
  const trend = isBinary ? null : computeTrendProjection(measurements, k);
  const intervention = computeInterventionProjection(
    k, initiatives,
    typeof currentValue === 'number' ? currentValue : 0,
    typeof trend === 'number' ? trend : (typeof currentValue === 'number' ? currentValue : 0),
  );
  const projections = isBinary ? '' : renderProjections(k, trend, intervention);
  const contributing = renderContributing(intervention.contributing);

  const method = (k.data_source && (k.data_source.method || k.data_source.kind)) || 'unknown';
  const measurementsMeta = `${measurements.length} measurement${measurements.length === 1 ? '' : 's'} · ${escapeHtml(String(method))}`;

  return `
    <div class="kpi-card" title="${escapeHtml(k.description || '')}">
      <div class="kpi-card-head">
        <span class="kpi-card-name">${escapeHtml(k.name)}</span>
        <span class="kpi-card-dot" style="background:${dot.color}" title="${escapeHtml(dot.why)}"></span>
      </div>
      <div class="kpi-card-value mono">${escapeHtml(value)}</div>
      <div class="kpi-card-sub">${escapeHtml(valueSub)}${target ? ' · ' + escapeHtml(target) : ''}</div>
      ${sparkline}
      ${projections}
      ${contributing}
      <div class="kpi-card-meta-row">
        <span class="kpi-card-meta mono">${measurementsMeta}</span>
        <button type="button" class="kpi-log-btn" data-kpi-id="${escapeHtml(k.id)}" data-kpi-name="${escapeHtml(k.name)}" data-kpi-unit="${escapeHtml(k.unit || '')}">+ Log value</button>
      </div>
      <div class="kpi-card-foot">
        <span class="kpi-card-area mono">${escapeHtml((k.area || '').replace(/_/g, ' '))}</span>
        ${categoryChip}
      </div>
    </div>
  `;
}

function renderProjections(k, trend, intervention) {
  const trendCell = trend != null
    ? `<span class="kpi-proj-value mono">${escapeHtml(formatValue(trend, k.unit))}</span>`
    : `<span class="kpi-proj-na">—</span>`;
  let intCell;
  if (intervention.kind === 'na') {
    intCell = `<span class="kpi-proj-na">— no linked initiatives</span>`;
  } else if (intervention.kind === 'text') {
    intCell = `<span class="kpi-proj-text">${escapeHtml(intervention.display)}</span>`;
  } else {
    intCell = `<span class="kpi-proj-value mono">${escapeHtml(intervention.display)}</span>`;
  }
  return `
    <div class="kpi-card-projections">
      <div class="kpi-proj-cell">
        <div class="kpi-proj-label mono">TREND (PROJ)</div>
        ${trendCell}
      </div>
      <div class="kpi-proj-cell">
        <div class="kpi-proj-label mono">WITH INITIATIVES</div>
        ${intCell}
      </div>
    </div>
  `;
}

function renderContributing(contributors) {
  if (!contributors || !contributors.length) return '';
  return `
    <div class="kpi-card-contrib">
      ${contributors.map(c => `
        <button type="button" class="kpi-contrib-tag" data-initiative-id="${escapeHtml(c.id)}" title="${escapeHtml(c.title || c.id)} — ${escapeHtml(c.delta)}">
          ${escapeHtml(c.shortLabel)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderKpiSparkline(k, measurements) {
  const points = (measurements || [])
    .map(m => Number(m.value))
    .filter(Number.isFinite);
  if (!points.length) {
    return `<div class="kpi-card-sparkline-placeholder mono"><span class="kpi-spark-cactus">🌵</span>no measurements yet</div>`;
  }
  if (points.length < 2) {
    return `
      <div class="kpi-card-sparkline">
        <div class="kpi-spark-bar" style="height:100%"></div>
      </div>
    `;
  }
  const trimmed = points.slice(-30);
  const max = Math.max(1, ...trimmed);
  return `
    <div class="kpi-card-sparkline">
      ${trimmed.map(v => {
        const h = Math.max(8, Math.round((v / max) * 100));
        return `<div class="kpi-spark-bar" style="height:${h}%"></div>`;
      }).join('')}
    </div>
  `;
}

function computeTrendProjection(measurements, kpi) {
  // Linear regression on captures within `trend_window_days` (fallback 30d).
  // Project 30 days ahead. Mirrors the legacy implementation 1-for-1 so cards
  // read identically pre/post migration.
  if (!measurements || measurements.length < 2) return null;
  const window = Number(kpi.trend_window_days) || 30;
  const cutoff = Date.now() - window * 86400000;
  const pts = measurements
    .map(m => ({ t: tsOf(m), v: Number(m.value) }))
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v) && p.t >= cutoff);
  if (pts.length < 2) return null;
  const xs = pts.map(p => p.t);
  const ys = pts.map(p => p.v);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return ys[ys.length - 1];
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  const projectAt = Date.now() + 30 * 86400000;
  return Math.round((slope * projectAt + intercept) * 100) / 100;
}

function tsOf(m) {
  const raw = m.captured_at || m.at || m.timestamp || m.measured_at;
  if (!raw) return NaN;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function computeInterventionProjection(kpi, initiatives, current, trend) {
  const activeInits = (initiatives || []).filter(i =>
    i.backlog_state === 'promoted_to_plan' &&
    ['not_started', 'active', 'on_track', 'at_risk'].includes(i.status || 'not_started')
  );
  const contributors = [];
  let numericDeltaSum = 0;
  let hasNumeric = false;
  activeInits.forEach(it => {
    (it.predicted_outcome || []).forEach(p => {
      if (p.kpi === kpi.id) {
        const delta = parseDelta(p.expected_delta);
        contributors.push({
          id: it.id,
          title: it.title || it.name || it.id,
          delta: p.expected_delta || '?',
          shortLabel: `${shortInitId(it.id)} ${p.expected_delta || '?'}`,
        });
        if (delta != null) {
          hasNumeric = true;
          numericDeltaSum += delta;
        }
      }
    });
  });
  if (contributors.length === 0) return { kind: 'na', display: '', contributing: [] };
  if (!hasNumeric) {
    return {
      kind: 'text',
      display: contributors.map(c => c.shortLabel).join(', '),
      contributing: contributors,
    };
  }
  const base = trend != null ? trend : (current || 0);
  const projected = Math.round((base + numericDeltaSum) * 100) / 100;
  return {
    kind: 'value',
    display: formatValue(projected, kpi.unit),
    contributing: contributors,
  };
}

function parseDelta(str) {
  if (str == null) return null;
  const s = String(str).trim();
  // Patterns: "+100", "-50", "+1pp", "+2 PRs/week", "0 → 1"
  const arrow = s.match(/(-?\d+(?:\.\d+)?)\s*→\s*(-?\d+(?:\.\d+)?)/);
  if (arrow) return Number(arrow[2]) - Number(arrow[1]);
  const num = s.match(/(\+|-)?\s*(\d+(?:\.\d+)?)/);
  if (num) {
    const sign = num[1] === '-' ? -1 : 1;
    return sign * Number(num[2]);
  }
  return null;
}

function shortInitId(id) {
  const s = String(id || '');
  // init-2026-06-15-04 → #04 ; goal-2026-06-15-01 → #01 ; fallback: last 6 chars
  const m = s.match(/-(\d{2,3})$/);
  if (m) return `#${m[1]}`;
  return `#${s.slice(-6)}`;
}

function dotForKpi(k, currentValue) {
  // Color heuristic — green if has measurement + meets target, yellow if has measurement
  // but not at target, gray if no measurement yet, red if explicitly underperforming.
  const v = currentValue != null ? currentValue : k.last_value;
  if (v == null) return { color: 'var(--text-veryfaint)', why: 'no measurement yet' };
  if (k.target == null) return { color: 'var(--text-faint)', why: 'no target set' };
  if (k.direction === 'binary' || k.type === 'milestone') {
    return Number(v) >= 1
      ? { color: 'var(--green)', why: 'milestone met' }
      : { color: 'var(--text-veryfaint)', why: 'milestone not yet met' };
  }
  const hib = k.direction === 'higher_is_better';
  const meets = hib ? Number(v) >= k.target : Number(v) <= k.target;
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
  if (v == null || v === '') return '—';
  if (unit === 'binary') return Number(v) >= 1 ? '✓ done' : '○';
  if (typeof v === 'number') {
    const formatted = Number.isInteger(v) ? v.toString() : v.toFixed(1);
    if (unit === 'percent') return `${formatted}%`;
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return String(v);
}

function wireLogButtons(hooks) {
  document.querySelectorAll('.kpi-log-btn[data-kpi-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kpiId = btn.dataset.kpiId;
      const kpiName = btn.dataset.kpiName;
      const unit = btn.dataset.kpiUnit || '';
      const promptLabel = unit ? `${kpiName} (${unit})` : kpiName;
      const raw = window.prompt(`Log new value for "${promptLabel}":`);
      if (raw == null) return;
      const value = raw.trim();
      if (!value) return;
      const notes = window.prompt('Notes (optional):') || null;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = '…';
      try {
        const resp = await fetch('/api/log-kpi-measurement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: (new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'tuto'), kpi_id: kpiId, value, notes }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        btn.textContent = '✓ logged';
        if (hooks && typeof hooks.onChange === 'function') {
          await hooks.onChange();
        } else {
          setTimeout(() => window.location.reload(), 400);
        }
      } catch (e) {
        btn.disabled = false;
        btn.textContent = originalText;
        alert(`Failed: ${e.message}`);
        console.error('[genus] log-kpi-measurement failed:', e);
      }
    });
  });
}

function wireContributingTags() {
  document.querySelectorAll('.kpi-contrib-tag[data-initiative-id]').forEach(tag => {
    tag.addEventListener('click', () => {
      const id = tag.dataset.initiativeId;
      // Planning view opens its initiative detail overlay from this hash form.
      // If the detail handler doesn't read this query yet, the operator still
      // lands on Planning and can drill in manually.
      window.location.hash = `#planning?initiative=${encodeURIComponent(id)}`;
    });
  });
}

// ============ Sub-tab: Sources & Health ============
//
// Joins each KPI's data_source to a matching connector + computes a status
// badge from connector.status + (when available) measurement freshness.
// Ported from legacy `tuto.js` renderKpiSourcesView() / computeSourceStatus()
// per GEN-49. Substrate exposes `last_value` + `last_measured_at` on KPIs
// (and per-KPI measurements via ctx.measurementsByKpi); rows that lack any
// capture show "🟡 never captured" rather than "🟢 flowing".

function renderSourcesView(kpis, connectors) {
  if (!kpis.length) {
    return `<div class="card"><div class="empty-state">No KPIs in this scope.</div></div>`;
  }

  const rows = kpis.map(k => sourceRowData(k, connectors));
  const counts = rows.reduce((acc, r) => {
    acc[r.badgeClass] = (acc[r.badgeClass] || 0) + 1;
    return acc;
  }, {});

  return `
    <div class="kpi-sources-head">
      <div class="kpi-sources-tagline">
        For every KPI: where the data comes from, which connector it flows through, and whether it's actually flowing.
        🔴 unwired or broken · 🟡 wired but stale · 🟢 fresh · ⚪ manual (operator-captured).
      </div>
      <div class="kpi-sources-summary">
        <span class="kpi-source-badge kpi-source-badge-green">🟢 flowing · ${counts.green || 0}</span>
        <span class="kpi-source-badge kpi-source-badge-yellow">🟡 stale · ${counts.yellow || 0}</span>
        <span class="kpi-source-badge kpi-source-badge-red">🔴 broken · ${counts.red || 0}</span>
        <span class="kpi-source-badge kpi-source-badge-manual">⚪ manual · ${counts.manual || 0}</span>
      </div>
    </div>
    <div class="kpi-sources-table-wrap">
      <table class="kpi-sources-table">
        <thead>
          <tr>
            <th>KPI</th>
            <th>Source</th>
            <th>Connector</th>
            <th>Status</th>
            <th>Last value</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows.map(renderSourceRow).join('')}</tbody>
      </table>
    </div>
  `;
}

function sourceRowData(k, connectors) {
  const ds = k.data_source || {};
  const method = (ds.method || '').toLowerCase();
  // Substrate uses both `real_time_source` (legacy) and `canonical_source` (current).
  const sourceType = ds.real_time_source || ds.canonical_source || method || '—';
  const sourceConfig = ds.real_time_source_config || ds.canonical_source_config || '';
  const isManual = method.includes('manual') || method.includes('operator');

  const matchedConnector = isManual ? null : findMatchingConnector(sourceType, connectors);

  const lastAt = k.last_measured_at || null;
  const lastValue = k.last_value;
  const expectedDays = expectedFreshnessDays(k);
  const fresh = lastAt ? isWithinDays(lastAt, expectedDays * 1.5) : false;

  const { badge, badgeClass, action } = computeSourceStatus({
    isManual,
    matchedConnector,
    hasMeasurement: lastValue != null,
    lastAt,
    fresh,
    sourceConfig,
    expectedDays,
  });

  return { k, sourceType, sourceConfig, isManual, matchedConnector,
           lastAt, lastValue, badge, badgeClass, action };
}

function renderSourceRow(r) {
  const { k, sourceType, sourceConfig, isManual, matchedConnector,
          lastAt, lastValue, badge, badgeClass, action } = r;
  return `
    <tr class="kpi-source-row kpi-source-${badgeClass}">
      <td class="kpi-source-name">
        <strong>${escapeHtml(k.name)}</strong>
        <div class="kpi-source-id mono">${escapeHtml(k.id)}</div>
      </td>
      <td class="kpi-source-method">
        <div>${escapeHtml(String(sourceType).replace(/_/g, ' '))}</div>
        ${sourceConfig ? `<div class="kpi-source-config mono">${escapeHtml(sourceConfig)}</div>` : ''}
      </td>
      <td class="kpi-source-connector">
        ${isManual
          ? '<span class="kpi-source-tag kpi-source-tag-manual">manual</span>'
          : matchedConnector
            ? `<div>${escapeHtml(matchedConnector.provider || matchedConnector.id)} <span class="kpi-source-conntype mono">(${escapeHtml(matchedConnector.type || 'unknown')})</span></div>
               <div class="kpi-source-conn-id mono">${escapeHtml(matchedConnector.id)}</div>`
            : '<span class="kpi-source-tag kpi-source-tag-missing">no connector</span>'}
      </td>
      <td class="kpi-source-status">
        <span class="kpi-source-badge kpi-source-badge-${badgeClass}">${escapeHtml(badge)}</span>
      </td>
      <td class="kpi-source-last">
        ${lastValue != null
          ? `<div class="mono">${escapeHtml(formatValue(lastValue, k.unit))}</div>
             <div class="kpi-source-lasttime">${lastAt ? escapeHtml(ago(lastAt)) : '—'}</div>`
          : '<span class="kpi-na">never captured</span>'}
      </td>
      <td class="kpi-source-action">
        ${action
          ? `<div class="kpi-source-action-text">${escapeHtml(action)}</div>`
          : '<span class="kpi-na">—</span>'}
      </td>
    </tr>
  `;
}

function findMatchingConnector(sourceKey, connectors) {
  if (!sourceKey || !connectors.length) return null;
  const key = String(sourceKey).toLowerCase();
  // Strip common suffixes (api, _api) so "github_api" matches "github".
  const tokens = key.replace(/_api$/, '').split(/[_\s-]+/).filter(t => t.length > 1);
  if (!tokens.length) return null;
  const exact = connectors.find(c => (c.provider || '').toLowerCase() === tokens[0]);
  if (exact) return exact;
  return connectors.find(c => {
    const p = (c.provider || '').toLowerCase();
    return tokens.some(t => p.includes(t) || t.includes(p));
  }) || null;
}

function expectedFreshnessDays(kpi) {
  const period = (kpi.period_type || kpi.period || '').toLowerCase();
  if (period.includes('week')) return 7;
  if (period.includes('month')) return 30;
  if (period.includes('quarter')) return 90;
  if (period.includes('day')) return 1;
  return 7;
}

function isWithinDays(iso, days) {
  try {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return false;
    return (Date.now() - t) <= days * 24 * 3600 * 1000;
  } catch (_) { return false; }
}

function computeSourceStatus({ isManual, matchedConnector, hasMeasurement, lastAt, fresh, sourceConfig, expectedDays }) {
  if (isManual) {
    const stale = !fresh && lastAt;
    const never = !lastAt;
    return {
      badge: '⚪ manual',
      badgeClass: 'manual',
      action: never ? `Operator: capture first value (cadence: ~${expectedDays}d)`
                    : stale ? `Operator: capture overdue (last ${ago(lastAt)})`
                            : null,
    };
  }
  if (!matchedConnector) {
    return {
      badge: '🔴 unwired',
      badgeClass: 'red',
      action: `Wire a connector for this source${sourceConfig ? ` (note: ${sourceConfig})` : ''}`,
    };
  }
  const cs = (matchedConnector.status || '').toLowerCase();
  if (cs === 'broken' || cs === 'not_configured' || cs === 'failed') {
    return {
      badge: `🔴 connector ${cs.replace('_', ' ')}`,
      badgeClass: 'red',
      action: matchedConnector.notes || `Fix connector ${matchedConnector.id}`,
    };
  }
  if (cs === 'partial' || cs === 'degraded') {
    return {
      badge: '🟡 connector partial',
      badgeClass: 'yellow',
      action: matchedConnector.notes || `Connector ${matchedConnector.id} reachable but limited`,
    };
  }
  if (!hasMeasurement) {
    return {
      badge: '🟡 never captured',
      badgeClass: 'yellow',
      action: `Connector OK but no measurements logged yet${sourceConfig ? ` (note: ${sourceConfig})` : ''}`,
    };
  }
  if (!fresh) {
    return {
      badge: '🟡 stale capture',
      badgeClass: 'yellow',
      action: `Last capture ${ago(lastAt)} — expected ~every ${expectedDays}d`,
    };
  }
  return { badge: '🟢 flowing', badgeClass: 'green', action: null };
}
