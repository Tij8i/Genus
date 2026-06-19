// Learning view — sub-tabs by source: Initiative log / Cycle close / Strategic memo.
//
// Per operator's "submenus as a general rule" (2026-06-19): replace the filter-
// chip layout with proper sub-tabs.

import { escapeHtml, ago, dateLabel } from '../utils.js';

let activeSubTab = 'all';

export function renderLearning(ctx) {
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const tab = new URLSearchParams(queryStr).get('tab');
  if (['all', 'initiative', 'cycle', 'memo'].includes(tab)) activeSubTab = tab;

  const items = collectLearnings(ctx);
  const counts = items.reduce((acc, x) => { acc[x.kind] = (acc[x.kind] || 0) + 1; return acc; }, {});
  const filtered = activeSubTab === 'all' ? items : items.filter(x => x.kind === activeSubTab);

  const root = document.getElementById('route-learning');
  root.innerHTML = `
    <nav class="subtab-nav">
      ${renderSubTab('all', 'All', items.length)}
      ${renderSubTab('initiative', 'Initiative log', counts.initiative || 0)}
      ${renderSubTab('cycle', 'Cycle close', counts.cycle || 0)}
      ${renderSubTab('memo', 'Strategic memo', counts.memo || 0)}
    </nav>
    ${filtered.length === 0
      ? `<div class="card"><div class="empty-state">No ${activeSubTab === 'all' ? 'learnings recorded yet' : activeSubTab + ' learnings'}. Initiative <code>learning_log</code> entries, cycle <code>closing_notes</code>, and strategic memos all surface here.</div></div>`
      : `<div class="learning-list">${filtered.map(renderLearningCard).join('')}</div>`
    }
  `;

  root.querySelectorAll('.subtab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      window.location.hash = `#learning?tab=${activeSubTab}`;
      renderLearning(ctx);
    });
  });
}

function renderSubTab(name, label, count) {
  return `
    <button type="button" class="subtab-link ${activeSubTab === name ? 'current' : ''}" data-subtab="${name}">
      ${escapeHtml(label)}
      ${count > 0 ? `<span class="subtab-badge">${count}</span>` : ''}
    </button>
  `;
}

function collectLearnings(ctx) {
  const items = [];
  for (const init of (ctx.initiatives || [])) {
    for (const entry of (init.learning_log || [])) {
      items.push({
        kind: 'initiative', kindLabel: 'Initiative log',
        at: entry.at || entry.created_at,
        title: `${init.title} — learning`,
        source: init.id,
        body: entry.body || entry.note || '',
        author: entry.author || 'tuto-stewart',
      });
    }
  }
  for (const p of (ctx.plans || [])) {
    if (!['completed', 'superseded'].includes(p.status)) continue;
    if (!p.closing_notes) continue;
    items.push({
      kind: 'cycle', kindLabel: 'Cycle close',
      at: p.completed_at || p.superseded_at,
      title: `${p.title} — close note`,
      source: p.id, body: p.closing_notes, author: 'operator',
    });
  }
  for (const m of (ctx.memos || [])) {
    const level = (m.level || '').toLowerCase();
    if (!['strategic', 'decision'].includes(level)) continue;
    items.push({
      kind: 'memo', kindLabel: 'Strategic memo',
      at: m.created_at,
      title: m.title || (m.body || '').slice(0, 60),
      source: m.id, body: m.body || '', author: m.created_by || 'unknown',
    });
  }
  items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return items;
}

function renderLearningCard(item) {
  return `
    <div class="learning-card">
      <div class="learning-card-head">
        <span class="learning-kind-chip learning-kind-${item.kind}">${escapeHtml(item.kindLabel)}</span>
        <span class="mono learning-card-source">${escapeHtml(item.source)}</span>
        <span class="mono learning-card-when">${escapeHtml(ago(item.at))}</span>
      </div>
      <div class="learning-card-title">${escapeHtml(item.title)}</div>
      <p class="learning-card-body">${escapeHtml(item.body)}</p>
      <div class="mono learning-card-foot">${escapeHtml(item.author.toUpperCase())} · ${escapeHtml(dateLabel(item.at))}</div>
    </div>
  `;
}
