// Learning view — what the venture has learned over time.
//
// Aggregates three sources from substrate:
//   1. Initiative learning_log entries (per-Initiative reflections logged at close)
//   2. Closed cycles' closing_notes (what we said when we wrapped a plan)
//   3. Strategic memos (level=strategic or level=decision) — explicit decisions
//
// Sorted reverse-chronologically. Filter chips at top let you scope to one source.

import { escapeHtml, ago, dateLabel } from '../utils.js';

let activeFilter = 'all';  // 'all' | 'initiative' | 'cycle' | 'memo'

export function renderLearning(ctx) {
  const root = document.getElementById('route-learning');
  const items = collectLearnings(ctx);
  const counts = items.reduce((acc, x) => { acc[x.kind] = (acc[x.kind] || 0) + 1; return acc; }, {});
  const filtered = activeFilter === 'all' ? items : items.filter(x => x.kind === activeFilter);

  root.innerHTML = `
    <div class="learning-filter-bar">
      ${renderFilter('all', 'All', items.length)}
      ${renderFilter('initiative', 'Initiative log', counts.initiative || 0)}
      ${renderFilter('cycle', 'Cycle close', counts.cycle || 0)}
      ${renderFilter('memo', 'Strategic memo', counts.memo || 0)}
    </div>

    ${filtered.length === 0
      ? `<div class="card"><div class="empty-state">No ${activeFilter === 'all' ? 'learnings recorded yet' : activeFilter + ' learnings'}. Initiative learning_log entries, cycle closing notes, and strategic memos all surface here.</div></div>`
      : `<div class="learning-list">${filtered.map(renderLearningCard).join('')}</div>`
    }
  `;

  root.querySelectorAll('.learning-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderLearning(ctx);
    });
  });
}

function renderFilter(name, label, count) {
  return `
    <button type="button" class="learning-filter-pill ${activeFilter === name ? 'current' : ''}" data-filter="${name}">
      ${escapeHtml(label)}
      <span class="learning-filter-count">${count}</span>
    </button>
  `;
}

function collectLearnings(ctx) {
  const items = [];

  // 1. Initiative learning_log entries
  for (const init of (ctx.initiatives || [])) {
    for (const entry of (init.learning_log || [])) {
      items.push({
        kind: 'initiative',
        kindLabel: 'Initiative log',
        at: entry.at || entry.created_at,
        title: `${init.title} — learning`,
        source: init.id,
        body: entry.body || entry.note || '',
        author: entry.author || 'tuto-stewart',
        sourceLink: { type: 'initiative', id: init.id },
      });
    }
  }

  // 2. Cycle closing notes (completed/superseded plans)
  for (const p of (ctx.plans || [])) {
    if (!['completed', 'superseded'].includes(p.status)) continue;
    if (!p.closing_notes) continue;
    items.push({
      kind: 'cycle',
      kindLabel: 'Cycle close',
      at: p.completed_at || p.superseded_at,
      title: `${p.title} — close note`,
      source: p.id,
      body: p.closing_notes,
      author: 'operator',
      sourceLink: { type: 'plan', id: p.id },
    });
  }

  // 3. Strategic memos
  for (const m of (ctx.memos || [])) {
    const level = (m.level || '').toLowerCase();
    if (!['strategic', 'decision'].includes(level)) continue;
    items.push({
      kind: 'memo',
      kindLabel: 'Strategic memo',
      at: m.created_at,
      title: m.title || (m.body || '').slice(0, 60),
      source: m.id,
      body: m.body || '',
      author: m.created_by || 'unknown',
      sourceLink: { type: 'memo', id: m.id },
    });
  }

  // Sort reverse-chronologically (latest first)
  items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return items;
}

function renderLearningCard(item) {
  const kindClass = `learning-kind-${item.kind}`;
  return `
    <div class="learning-card">
      <div class="learning-card-head">
        <span class="learning-kind-chip ${kindClass}">${escapeHtml(item.kindLabel)}</span>
        <span class="mono learning-card-source">${escapeHtml(item.source)}</span>
        <span class="mono learning-card-when">${escapeHtml(ago(item.at))}</span>
      </div>
      <div class="learning-card-title">${escapeHtml(item.title)}</div>
      <p class="learning-card-body">${escapeHtml(item.body)}</p>
      <div class="mono learning-card-foot">${escapeHtml(item.author.toUpperCase())} · ${escapeHtml(dateLabel(item.at))}</div>
    </div>
  `;
}
