// Development · Overview
// Function header (Overview tab active) + attention banner + 4 stat tiles +
// Product × Health matrix + 2 rollups (Workflows / Open tasks) + 4 info tiles
// (Tests / Bugs / Deploys / Synthetic).

import { C, DEV, devHeader, escapeHtml, currentBu, loadDevSubstrate } from './_shared.js';
import { loadWorkflows, loadWorkflowTasks, workflowRow, dueStyle, updateTaskBadges } from '../workflows/_shared.js';

// Persisted UI state for the matrix card so a hash navigation away + back
// preserves the All/Live/In dev tab + per-row expanded state.
const matrixState = { tab: 'all', expanded: new Set() };

export async function renderDevelopmentOverview() {
  const root = document.getElementById('route-development-overview');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading…</div>';

  const [wfData, taskData, matrix, tests, bugs, deploys, synth] = await Promise.all([
    loadWorkflows(bu),
    loadWorkflowTasks(bu),
    loadDevSubstrate('products_matrix.json', { products: [], company_aggregate: null }),
    loadDevSubstrate('tests_history.json', { current_pass_rate_7d: null }),
    loadDevSubstrate('bugs_summary.json', { severity_buckets: [] }),
    loadDevSubstrate('deploys_history.json', { deploys_this_week: 0, stability_pct_30d: null }),
    loadDevSubstrate('synthetic_status.json', { bus: [] }),
  ]);

  const workflows = (wfData?.workflows || []).filter(w => w.mod === 'development');
  const tasks = (taskData?.tasks || []).filter(t => t.mod === 'development');
  updateTaskBadges(taskData?.tasks || []);

  const totalSteps = workflows.reduce((s, w) => s + (w.total_steps || 0), 0);
  const autoSteps  = workflows.reduce((s, w) => s + (w.automated_steps || 0), 0);
  const nowTasks = tasks.filter(t => t.group === 'now');
  const overdueTasks = tasks.filter(t => t.urgency === 'overdue');
  const drafted = tasks.filter(t => t.drafted_fix).length;

  const buildHealthLabel = (() => {
    const pass = tests?.current_pass_rate_7d ?? null;
    const crit = bugs?.severity_buckets?.find(b => b.label === 'Critical')?.count ?? 0;
    if (pass == null) return { label: '—', color: C.ink3 };
    if (crit > 0) return { label: 'Yellow', color: '#c98a16' };
    if (pass >= 95) return { label: 'Green', color: '#0e9f6e' };
    if (pass >= 85) return { label: 'Yellow', color: '#c98a16' };
    return { label: 'Red', color: C.red };
  })();

  const needsAttention = nowTasks.length;
  const deploysWeek = deploys?.deploys_this_week ?? 0;
  const passRate = tests?.current_pass_rate_7d ?? null;

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
      ${devHeader({ activeTab: 'overview' })}
      ${renderAttentionBanner(needsAttention, overdueTasks.length, drafted)}

      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;margin-bottom:18px;">
        ${statTile('BUILD HEALTH',    buildHealthLabel.label, `Pass ${passRate ?? '—'}% · ${bugs?.severity_buckets?.find(b => b.label==='Critical')?.count || 0} critical`, buildHealthLabel.color)}
        ${statTile('NEEDS ATTENTION', needsAttention,         overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : `${nowTasks.length} for you`, overdueTasks.length > 0 ? C.red : C.ink, '#development-tasks')}
        ${statTile('DEPLOYS · WEEK',  deploysWeek,            `${deploys?.rollbacks_this_week ?? 0} rollback${(deploys?.rollbacks_this_week ?? 0) === 1 ? '' : 's'}`, C.ink, '#dev-deploys')}
        ${statTile('TEST PASS · 7d',  passRate == null ? '—' : `${passRate}%`, tests?.trend_vs_last_week === 'up' ? 'up vs last week' : tests?.trend_vs_last_week === 'down' ? 'down vs last week' : '', passRate >= 95 ? '#0e9f6e' : passRate >= 85 ? '#c98a16' : C.red, '#dev-tests')}
      </div>

      ${renderProductMatrix(matrix)}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0;">
        ${rollupCard('Workflows', '#development-workflows',
          workflows.length === 0
            ? '<div style="font-size:13px;color:#9aa1ae;padding:18px 4px;text-align:center;">No workflows yet.</div>'
            : workflows.slice(0, 3).map(w => workflowRow(w, true)).join(''))}
        ${rollupCard('Open tasks', '#development-tasks',
          tasks.length === 0
            ? '<div style="font-size:13px;color:#9aa1ae;padding:18px 4px;text-align:center;">All caught up.</div>'
            : tasks.slice(0, 3).map(taskPreviewRow).join(''))}
      </div>

      <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:10px;">Information · Development</div>
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;">
        ${infoTile({ name: 'Tests health',  metric: passRate == null ? '—' : `${passRate}%`,
                     sub: tests?.last_failure?.summary || 'no recent failures', href: '#dev-tests' })}
        ${infoTile({ name: 'Bugs',          metric: `${(bugs?.severity_buckets || []).reduce((s, b) => s + (b.count||0), 0)} open`,
                     sub: `${bugs?.severity_buckets?.find(b => b.label==='Critical')?.count || 0} critical · ${bugs?.severity_buckets?.find(b => b.label==='High')?.count || 0} high`, href: '#dev-bugs' })}
        ${infoTile({ name: 'Deploys',       metric: `${deploys?.stability_pct_30d ?? '—'}%`,
                     sub: deploys?.last_deploy ? `last ${escapeHtml(deploys.last_deploy.version)} · ${escapeHtml(deploys.last_deploy.status)}` : 'stability · 30d', href: '#dev-deploys' })}
        ${infoTile({ name: 'Synthetic data',metric: `${(synth?.bus || []).filter(b => b.tag === 'FRESH').length}/${(synth?.bus || []).length} fresh`,
                     sub: (synth?.bus || []).find(b => b.tag === 'DUE') ? `${(synth?.bus || []).filter(b => b.tag === 'DUE').length} due for refresh` : 'all on cadence', href: '#dev-synthetic' })}
      </div>
    </div>
  `;

  wireMatrixHandlers(matrix);
  document.getElementById('add-workflow-btn')?.addEventListener('click', () => {
    alert('+ Add workflow — overlay ships in the follow-up slice.');
  });
}

function renderAttentionBanner(nowCount, overdueCount, draftedCount) {
  let bg, border, dot, msg;
  if (nowCount === 0) {
    bg = 'rgba(14,159,110,.06)'; border = 'rgba(14,159,110,.22)'; dot = '#0e9f6e';
    msg = 'Build is healthy — nothing waiting on you.';
  } else if (overdueCount > 0) {
    bg = 'rgba(192,57,43,.06)'; border = 'rgba(192,57,43,.22)'; dot = C.red;
    const draftedSuffix = draftedCount > 0 ? ` · ${draftedCount} drafted fix${draftedCount === 1 ? '' : 'es'} ready to review` : '';
    msg = `${nowCount} task${nowCount === 1 ? ' needs' : 's need'} you — including an overdue run${draftedSuffix}.`;
  } else {
    bg = 'rgba(14,159,110,.06)'; border = 'rgba(14,159,110,.22)'; dot = '#0e9f6e';
    const draftedSuffix = draftedCount > 0 ? ` · ${draftedCount} drafted fix${draftedCount === 1 ? '' : 'es'} ready` : '';
    msg = `${nowCount} task${nowCount === 1 ? ' needs' : 's need'} you. Everything else is on track${draftedSuffix}.`;
  }
  return `<div style="display:flex;align-items:center;gap:11px;padding:13px 16px;background:${bg};border:1px solid ${border};border-radius:13px;margin-bottom:18px;">
    <span style="width:8px;height:8px;border-radius:99px;background:${dot};flex:none;"></span>
    <span style="font-size:13.5px;color:${C.ink};font-weight:600;flex:1;">${escapeHtml(msg)}</span>
    <a href="#development-tasks" style="font-size:12.5px;color:${C.ink2};text-decoration:none;font-weight:500;">Go to tasks ›</a>
  </div>`;
}

function statTile(label, num, sub, numColor, href) {
  const inner = `<div style="background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:16px 18px;box-shadow:0 1px 2px rgba(16,18,28,.04);${href ? 'cursor:pointer;' : ''}">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:8px;">${escapeHtml(label)}</div>
    <div style="font-size:27px;font-weight:800;letter-spacing:-.02em;color:${numColor};">${escapeHtml(String(num))}</div>
    <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-top:5px;">${escapeHtml(sub)}</div>
  </div>`;
  return href ? `<a href="${href}" style="text-decoration:none;color:inherit;">${inner}</a>` : inner;
}

function rollupCard(title, viewAllHash, body) {
  return `<div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <strong style="font-size:14.5px;color:${C.ink};">${escapeHtml(title)}</strong>
      <a href="${viewAllHash}" style="font-size:12px;color:${C.accent};text-decoration:none;font-weight:600;">View all ›</a>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">${body}</div>
  </div>`;
}

function taskPreviewRow(t) {
  const d = dueStyle(t.urgency);
  return `<a href="#workflow-detail/${escapeHtml(t.wf_id)}?from=overview" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${C.cardSoft};border:1px solid ${C.border};border-radius:11px;text-decoration:none;color:inherit;">
    <span style="width:18px;height:18px;flex:none;border-radius:6px;border:1.6px solid rgba(20,22,28,.3);"></span>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:600;color:${C.ink};">${escapeHtml(t.title)}</div>
      <div style="font:500 11px ${C.mono};color:${C.ink3};margin-top:2px;">${escapeHtml(t.wf_title)}</div>
    </div>
    ${t.drafted_fix ? `<span style="font:600 9.5px ${C.mono};letter-spacing:.10em;color:#7a4dff;background:rgba(122,77,255,.12);padding:2px 7px;border-radius:5px;">DRAFTED FIX</span>` : ''}
    <span style="font:600 11px ${C.mono};color:${d.color};background:${d.bg};padding:2px 8px;border-radius:6px;">${escapeHtml(t.due)}</span>
  </a>`;
}

function infoTile(info) {
  return `<a href="${info.href}" style="display:flex;align-items:center;justify-content:space-between;background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:16px 18px;text-decoration:none;color:inherit;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div>
      <div style="font-size:14px;font-weight:700;color:${C.ink};">${escapeHtml(info.name)}</div>
      <div style="font-size:18px;font-weight:800;color:${C.ink};margin-top:5px;letter-spacing:-.01em;">${escapeHtml(info.metric)}</div>
      <div style="font:500 11px ${C.mono};color:${C.ink3};margin-top:3px;">${escapeHtml(info.sub)}</div>
    </div>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${C.ink3}" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
  </a>`;
}

// Product × Health matrix.
// Rows = products. Columns = Active work bar · Tests · Bugs · Deploys · Synthetic.
// Tab bar at top switches the per-row column source (all / live / dev).
// Each row is expandable to show the per-version split where applicable.
function renderProductMatrix(matrix) {
  const products = matrix?.products || [];
  const aggregate = matrix?.company_aggregate;
  const tabs = [
    { key: 'all',  label: 'All' },
    { key: 'live', label: 'Live (maintenance)' },
    { key: 'dev',  label: 'In dev' },
  ];

  if (products.length === 0 && !aggregate) return '';

  // If the Product module isn't installed, fall back to the aggregate row.
  if (products.length === 0 && aggregate) {
    return `<div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
      <strong style="font-size:14.5px;color:${C.ink};">Build health · company-wide</strong>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:14px;margin-top:14px;">
        ${matrixCell('Active work', activeWorkBar(aggregate.active))}
        ${matrixCell('Tests',       chip(aggregate.tests))}
        ${matrixCell('Bugs',        chip(aggregate.bugs))}
        ${matrixCell('Deploys',     chip(aggregate.deploys))}
        ${matrixCell('Synthetic',   chip(aggregate.synthetic))}
      </div>
    </div>`;
  }

  return `<div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
      <strong style="font-size:14.5px;color:${C.ink};">Build health · per product</strong>
      <div id="matrix-tabs" style="display:inline-flex;background:${C.bg};border-radius:9px;padding:3px;gap:2px;">
        ${tabs.map(t => {
          const on = matrixState.tab === t.key;
          return `<button type="button" data-matrix-tab="${t.key}" style="background:${on ? C.card : 'transparent'};border:none;padding:6px 10px;border-radius:7px;font:600 11.5px ${C.mono};color:${on ? C.ink : C.ink3};cursor:pointer;${on ? 'box-shadow:0 1px 2px rgba(16,18,28,.06);' : ''}">${escapeHtml(t.label)}</button>`;
        }).join('')}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1.6fr) 86px 86px 86px 86px 26px;gap:14px;padding:0 4px 8px;font:600 9.5px ${C.mono};letter-spacing:.12em;text-transform:uppercase;color:${C.ink3};border-bottom:1px solid ${C.border};">
      <span>Product</span><span>Active work</span><span style="text-align:center;">Tests</span><span style="text-align:center;">Bugs</span><span style="text-align:center;">Deploys</span><span style="text-align:center;">Synthetic</span><span></span>
    </div>
    <div id="matrix-rows" style="display:flex;flex-direction:column;">
      ${products.map(p => productRow(p, matrixState.tab)).join('')}
    </div>
  </div>`;
}

function productRow(p, tab) {
  const slice = p[tab] || p.all || {};
  const notShipped = !!slice.not_shipped;
  const expanded = matrixState.expanded.has(p.name);
  const versionsRow = expanded ? expandedSubRow(p, tab) : '';
  return `<div data-product="${escapeHtml(p.name)}">
    <button type="button" data-matrix-expand="${escapeHtml(p.name)}" style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1.6fr) 86px 86px 86px 86px 26px;gap:14px;align-items:center;width:100%;padding:14px 4px;border:none;background:transparent;border-bottom:1px solid ${C.border};cursor:pointer;text-align:left;font:inherit;color:inherit;">
      <div style="min-width:0;">
        <strong style="font-size:13.5px;color:${C.ink};">${escapeHtml(p.name)}</strong>
        <div style="font:500 11px ${C.mono};color:${C.ink3};margin-top:3px;">${escapeHtml(p.version_label || '')}</div>
      </div>
      ${notShipped
        ? `<span style="font:500 11.5px ${C.mono};color:${C.ink3};">Not yet shipped</span>`
        : `<div style="display:flex;align-items:center;">${activeWorkBar(slice.active)}</div>`}
      <div style="display:flex;justify-content:center;">${chip(slice.tests)}</div>
      <div style="display:flex;justify-content:center;">${chip(slice.bugs)}</div>
      <div style="display:flex;justify-content:center;">${chip(slice.deploys)}</div>
      <div style="display:flex;justify-content:center;">${chip(slice.synthetic)}</div>
      <span style="color:${C.ink3};display:flex;justify-content:flex-end;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="transform:${expanded ? 'rotate(90deg)' : 'rotate(0deg)'};transition:transform .14s;">
          <path d="m9 6 6 6-6 6"/>
        </svg>
      </span>
    </button>
    ${versionsRow}
  </div>`;
}

function expandedSubRow(p, tab) {
  const liveSlice = p.live || {};
  const devSlice = p.dev || {};
  const showLive = (tab === 'all' || tab === 'live') && !liveSlice.not_shipped;
  const showDev  = (tab === 'all' || tab === 'dev')  && p.next_version;
  if (!showLive && !showDev) return '';
  const cell = (label, slice) => `<div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1.6fr) 86px 86px 86px 86px 26px;gap:14px;align-items:center;padding:10px 4px 10px 22px;background:${C.cardSoft};border-bottom:1px solid ${C.border};">
    <div style="font:500 11.5px ${C.mono};color:${C.ink2};">${escapeHtml(label)}</div>
    <div>${activeWorkBar(slice.active)}</div>
    <div style="display:flex;justify-content:center;">${chip(slice.tests)}</div>
    <div style="display:flex;justify-content:center;">${chip(slice.bugs)}</div>
    <div style="display:flex;justify-content:center;">${chip(slice.deploys)}</div>
    <div style="display:flex;justify-content:center;">${chip(slice.synthetic)}</div>
    <span></span>
  </div>`;
  return `${showLive ? cell(`Live · ${p.live_version || 'shipped'}`, liveSlice) : ''}${showDev ? cell(`In dev · ${p.next_version}`, devSlice) : ''}`;
}

function chip(c) {
  if (!c || c.label == null) return `<span style="font:500 11.5px ${C.mono};color:${C.ink3};">—</span>`;
  return `<span style="font:600 11px ${C.mono};color:${c.color || C.ink2};background:${(c.color || C.ink2) + '14'};padding:3px 8px;border-radius:6px;white-space:nowrap;">${escapeHtml(c.label)}</span>`;
}

function activeWorkBar(active) {
  if (!active) return `<span style="font:500 11.5px ${C.mono};color:${C.ink3};">—</span>`;
  const { feat = 0, fix = 0, chore = 0 } = active;
  const total = feat + fix + chore;
  if (total === 0) return `<span style="font:500 11.5px ${C.mono};color:${C.ink3};">none</span>`;
  const pct = (n) => (n / total) * 100;
  return `<div style="display:flex;align-items:center;gap:8px;width:100%;min-width:0;">
    <div style="flex:1;display:flex;height:6px;border-radius:3px;overflow:hidden;background:${C.bg};">
      ${feat > 0 ? `<span style="background:${DEV.color};width:${pct(feat)}%;"></span>` : ''}
      ${fix > 0 ? `<span style="background:#c98a16;width:${pct(fix)}%;"></span>` : ''}
      ${chore > 0 ? `<span style="background:#9aa1ae;width:${pct(chore)}%;"></span>` : ''}
    </div>
    <span style="font:500 11px ${C.mono};color:${C.ink3};white-space:nowrap;">${feat}f · ${fix}fx · ${chore}c</span>
  </div>`;
}

function matrixCell(label, body) {
  return `<div>
    <div style="font:600 9.5px ${C.mono};letter-spacing:.12em;text-transform:uppercase;color:${C.ink3};margin-bottom:8px;">${escapeHtml(label)}</div>
    ${body}
  </div>`;
}

function wireMatrixHandlers(matrix) {
  document.querySelectorAll('#matrix-tabs [data-matrix-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      matrixState.tab = btn.dataset.matrixTab;
      renderDevelopmentOverview();
    });
  });
  document.querySelectorAll('[data-matrix-expand]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.matrixExpand;
      if (matrixState.expanded.has(k)) matrixState.expanded.delete(k);
      else matrixState.expanded.add(k);
      renderDevelopmentOverview();
    });
  });
}
