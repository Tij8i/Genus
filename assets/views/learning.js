// Learning view — 2-part per v0.7:
//   1. Hypotheses & experiments (learning about the market) — each Initiative
//      as a bet with a verdict: Validated / Disproven / Testing / Proposed
//   2. What the system is learning (learning to run itself) — agent
//      independence meter + agent reflections + coaching before→after
//
// Sub-tabs: Hypotheses · System

import { escapeHtml, ago, dateLabel } from '../utils.js';

let activeSubTab = 'hypotheses';

export function renderLearning(ctx) {
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const tab = new URLSearchParams(queryStr).get('tab');
  if (['hypotheses', 'system'].includes(tab)) activeSubTab = tab;

  const root = (document.getElementById('subtab-host') || document.getElementById('route-learning'));
  root.innerHTML = `
    <nav class="subtab-nav">
      ${renderSubTab('hypotheses', 'Hypotheses & experiments')}
      ${renderSubTab('system', 'What the system is learning')}
    </nav>
    <div id="learning-subtab-body"></div>
  `;
  root.querySelectorAll('.subtab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      window.location.hash = `#learning?tab=${activeSubTab}`;
      renderLearning(ctx);
    });
  });
  const body = document.getElementById('learning-subtab-body');
  if (activeSubTab === 'hypotheses') body.innerHTML = renderHypothesesSubTab(ctx);
  else body.innerHTML = renderSystemSubTab(ctx);
}

function renderSubTab(name, label) {
  return `<button type="button" class="subtab-link ${activeSubTab === name ? 'current' : ''}" data-subtab="${name}">${escapeHtml(label)}</button>`;
}

// ============ Hypotheses & experiments ============

function renderHypothesesSubTab(ctx) {
  // Each Initiative with an active_hypothesis is a bet. Verdict derives from
  // Initiative state:
  //   - completed + outcome positive → Validated
  //   - abandoned → Disproven
  //   - in_progress / review / scoping → Testing
  //   - not_started → Proposed
  // (Real outcome polarity needs operator confirmation later — for v1 we
  //  treat all completed as Validated and abandoned as Disproven.)
  const inits = (ctx.initiatives || []).filter(i => i.active_hypothesis);
  if (!inits.length) {
    return `<div class="card"><div class="empty-state">No initiatives with hypotheses yet. Each Initiative is a bet; add an active_hypothesis to surface it here.</div></div>`;
  }
  const sorted = inits.slice().sort((a, b) => {
    const order = { in_progress: 1, review: 2, scoping: 3, blocked: 4, not_started: 5, completed: 6, abandoned: 7, discarded: 8 };
    return (order[(a.status || '').toLowerCase()] || 9) - (order[(b.status || '').toLowerCase()] || 9);
  });
  return `
    <div class="hypothesis-list">
      ${sorted.map(renderHypothesisCard).join('')}
    </div>
  `;
}

function renderHypothesisCard(init) {
  const status = (init.status || 'not_started').toLowerCase();
  const verdict = verdictFor(status);
  const daysIn = init.started_at
    ? Math.floor((Date.now() - new Date(init.started_at).getTime()) / 86400000)
    : null;
  // Confidence bar for "Testing" only — proxy as % of milestones done
  const ms = init.milestones || [];
  const doneMs = ms.filter(m => (m.status || '').toLowerCase() === 'done').length;
  const confidence = ms.length > 0 ? Math.round((doneMs / ms.length) * 100) : 0;
  return `
    <div class="hypo-card hypo-card-${verdict.key}">
      <div class="hypo-card-head">
        <span class="hypo-verdict-chip hypo-verdict-${verdict.key}">
          ${verdict.iconHtml}
          ${escapeHtml(verdict.label)}
        </span>
        <span class="mono hypo-card-id">${escapeHtml(init.id)}</span>
      </div>
      <div class="hypo-card-title">${escapeHtml(init.title)}</div>
      <div class="hypo-card-hypothesis">
        <span class="hypo-label mono">HYPOTHESIS</span>
        <p class="hypo-card-bet">${escapeHtml(init.active_hypothesis)}</p>
      </div>
      ${verdict.key === 'testing' && ms.length > 0 ? `
        <div class="hypo-confidence">
          <div class="hypo-confidence-label-row">
            <span class="mono hypo-confidence-label">CONFIDENCE</span>
            <span class="mono hypo-confidence-pct">${confidence}%${daysIn != null ? ` · ${daysIn}d in` : ''}</span>
          </div>
          <div class="hypo-confidence-bar"><div class="hypo-confidence-fill" style="width:${confidence}%"></div></div>
        </div>
      ` : ''}
      ${verdict.key === 'validated' && init.success_criterion ? `
        <div class="hypo-evidence">
          <span class="mono hypo-label">EVIDENCE</span>
          <p>${escapeHtml((init.success_criterion || '').slice(0, 200))}</p>
        </div>
      ` : ''}
      ${verdict.key === 'proposed' ? `
        <div class="hypo-actions">
          <button type="button" class="hypo-action-btn hypo-action-start btn-soon" disabled title="Hypothesis lifecycle controls ship in v0.8">Start test<span class="soon-tag">soon</span></button>
          <button type="button" class="hypo-action-btn hypo-action-park btn-soon" disabled title="Hypothesis lifecycle controls ship in v0.8">Park<span class="soon-tag">soon</span></button>
        </div>
      ` : ''}
    </div>
  `;
}

function verdictFor(status) {
  const checkIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>';
  const xIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const testIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6M12 17v6M4.2 4.2l4.2 4.2M15.6 15.6l4.2 4.2M1 12h6M17 12h6"/></svg>';
  const proposeIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>';
  switch (status) {
    case 'completed': return { key: 'validated', label: 'Validated', iconHtml: checkIcon };
    case 'abandoned':
    case 'discarded': return { key: 'disproven', label: 'Disproven', iconHtml: xIcon };
    case 'in_progress':
    case 'review':
    case 'scoping':
    case 'blocked': return { key: 'testing', label: 'Testing', iconHtml: testIcon };
    case 'not_started':
    default: return { key: 'proposed', label: 'Proposed', iconHtml: proposeIcon };
  }
}

// ============ What the system is learning ============

function renderSystemSubTab(ctx) {
  // Independence meter: % of approved tasks that were auto-approved (via
  // trust gauge) vs operator-approved. Proxy for "how much does Tuto run
  // itself".
  const tasks = ctx.tasks || [];
  const autoApproved = tasks.filter(t => (t.approval || {}).decided_by === 'tuto-stewart' || (t.approval || {}).decided_by === 'system').length;
  const operatorApproved = tasks.filter(t => (t.approval || {}).decided_by === 'operator').length;
  const totalDecided = autoApproved + operatorApproved;
  const independence = totalDecided > 0 ? Math.round((autoApproved / totalDecided) * 100) : 0;

  // Agent reflections — strategic memos or memos from REFLECTION_LOG
  // (proxy: memos with from_meeting OR level=system, latest 5)
  const reflections = (ctx.memos || [])
    .filter(m => m.from_meeting || (m.level || '').toLowerCase() === 'system')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 5);

  return `
    <!-- Independence meter -->
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Agent independence</span></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint)">${independence}% auto-approved · last cycle</span>
      </div>
      <p class="card-sub">How much Tuto runs itself vs needs your sign-off. Higher = more delegation working as intended.</p>
      <div class="independence-bar-wrap" style="margin-top:18px">
        <div class="independence-bar">
          <div class="independence-fill" style="width:${independence}%"></div>
          <div class="independence-marker" style="left:30%" title="target 30% — Cautious"></div>
          <div class="independence-marker" style="left:60%" title="target 60% — Balanced"></div>
          <div class="independence-marker" style="left:85%" title="target 85% — Bold"></div>
        </div>
        <div class="independence-axis mono">
          <span>0% · You decide everything</span>
          <span>100% · Tuto runs itself</span>
        </div>
      </div>
      <div class="independence-breakdown mono">
        <div><strong>${autoApproved}</strong> auto-approved · <strong>${operatorApproved}</strong> operator-approved · <strong>${tasks.length - totalDecided}</strong> pending</div>
      </div>
    </div>

    <!-- Agent reflections -->
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Agent reflections</span></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint)">${reflections.length} recent</span>
      </div>
      <p class="card-sub">What Tuto noticed about its own work + your patterns. Accept to lock in, Refine to coach, Discuss to explore.</p>
      <div class="reflections-list" style="margin-top:14px">
        ${reflections.length === 0
          ? `<div class="empty-cactus"><div class="empty-cactus-icon">🌵</div><div class="empty-cactus-title">No reflections yet</div><div class="empty-cactus-body">Closed meetings + the daily heartbeat self-audit produce these. As soon as Tuto reflects on a meeting or its own work, it shows up here.</div></div>`
          : reflections.map(renderReflectionCard).join('')}
      </div>
    </div>

    <!-- Coaching before→after -->
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">How your coaching shows up</span></div>
      </div>
      <p class="card-sub">Operator corrections that became durable behavior changes.</p>
      <div class="empty-cactus" style="margin-top:14px">
        <div class="empty-cactus-icon">🌵</div>
        <div class="empty-cactus-title">Coaching diff tracking ships in v0.8</div>
        <div class="empty-cactus-body">For now this lives in <code>LEARNING_LOG.md</code> per Stewart in the substrate repo.</div>
      </div>
    </div>
  `;
}

function renderReflectionCard(m) {
  return `
    <div class="reflection-card">
      <div class="reflection-card-head">
        <span class="mono reflection-card-source">${escapeHtml(m.id)}${m.from_meeting ? ` · from ${escapeHtml(m.from_meeting)}` : ''}</span>
        <span class="mono reflection-card-when">${escapeHtml(ago(m.created_at))}</span>
      </div>
      <div class="reflection-card-title">${escapeHtml(m.title || (m.body || '').slice(0, 60))}</div>
      <p class="reflection-card-body">${escapeHtml((m.body || '').slice(0, 240))}${(m.body || '').length > 240 ? '…' : ''}</p>
      <div class="reflection-actions">
        <button type="button" class="reflection-action-btn reflection-accept btn-soon" disabled title="Reflection-coaching flow ships in v0.8">Accept<span class="soon-tag">soon</span></button>
        <button type="button" class="reflection-action-btn reflection-refine btn-soon" disabled title="Reflection-coaching flow ships in v0.8">Refine<span class="soon-tag">soon</span></button>
        <button type="button" class="reflection-action-btn reflection-discuss btn-soon" disabled title="Reflection-coaching flow ships in v0.8">Discuss<span class="soon-tag">soon</span></button>
      </div>
    </div>
  `;
}
