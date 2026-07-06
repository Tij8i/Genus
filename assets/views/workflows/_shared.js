// Shared helpers for the Workflows + Tasks surfaces.
//
// Tokens lifted from ~/Desktop/design_handoff_genus_workflows/README.md so
// every workflow view stays visually identical to the brief without each
// view re-declaring constants.

import { fetchSubstrateJson } from '../../substrate-client.js';

export const MODULES = {
  finance:  { name: 'Finance',  color: '#0e9f6e', bg: 'rgba(14,159,110,.10)' },
  strategy: { name: 'Strategy', color: '#2f6bff', bg: 'rgba(47,107,255,.10)' },
  product:  { name: 'Product',  color: '#2f6bff', bg: 'rgba(47,107,255,.10)' },
  development: { name: 'Development', color: '#0d8a8e', bg: 'rgba(13,138,142,.10)' },
  cs:       { name: 'Customer Success', color: '#e0683a', bg: 'rgba(224,104,58,.10)' },
  operations: { name: 'Operations', color: '#5b6270', bg: 'rgba(91,98,112,.10)' },
};

export const C = {
  ink: '#16181d', ink2: '#5b6270', ink3: '#9aa1ae',
  bg: '#f6f6f7', card: '#fff', cardSoft: '#fbfbfc',
  border: 'rgba(20,22,28,.08)',
  accent: '#2f6bff', accentBg: 'rgba(47,107,255,.10)',
  green: '#0e9f6e', amber: '#c98a16', red: '#c0392b',
  manual: '#7a4dff',
  mono: "'JetBrains Mono',ui-monospace,Menlo,monospace",
};

export function adherenceColor(p) {
  if (p == null) return C.ink3;
  if (p >= 85) return C.green;
  if (p >= 60) return C.amber;
  return C.red;
}

export function dueStyle(urgency) {
  if (urgency === 'overdue') return { bg: 'rgba(192,57,43,.10)', color: '#c0392b' };
  if (urgency === 'soon')    return { bg: 'rgba(201,138,22,.12)', color: '#c98a16' };
  return { bg: 'rgba(20,22,28,.05)', color: '#5b6270' };
}

export function currentBu() {
  return new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'medivara';
}

// Use NON-NULL fallback so substrate-client returns the fallback on 404
// instead of throwing. The throw-on-null-fallback path is documented
// (see substrate-client.js comment) and bit us when a BU without
// workflows seeded was rendered. We tolerate missing files by treating
// them as empty.
const EMPTY_WORKFLOWS = { workflows: [] };
const EMPTY_TASKS = { tasks: [] };

export async function loadWorkflows(bu) {
  try {
    return await fetchSubstrateJson(`dashboard/public/data/bus/${bu}/workflows.json`, EMPTY_WORKFLOWS);
  } catch { return EMPTY_WORKFLOWS; }
}

export async function loadWorkflowTasks(bu) {
  try {
    return await fetchSubstrateJson(`dashboard/public/data/bus/${bu}/workflow_tasks.json`, EMPTY_TASKS);
  } catch { return EMPTY_TASKS; }
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Page header used by all function-tab pages.
// i44 real fix (2026-07-06): matches the locked design.
//   - No Overview tab (content items are in the sidebar directly now)
//   - No standalone Discipline tab (folds into Settings → Rules per i106)
//   - Four ops tabs: Workflows | Tasks | Settings | Chat with Steward
//   - Header line 2: purpose · Stewart · connectors (from registry manifest)
//   - Status pill on the right showing Stewart activity
export function moduleMetaSync(mod) {
  const reg = (typeof window !== 'undefined' && window.__genusRegistry) || null;
  return (reg?.available_modules || []).find(m => m.id === mod) || null;
}

export function functionHeader({ mod, modName, modColor, activeTab, meta }) {
  meta = meta || moduleMetaSync(mod);
  const tabs = [
    { key: 'workflows', label: 'Workflows', hash: `#${mod}-workflows` },
    { key: 'tasks',     label: 'Tasks',     hash: `#${mod}-tasks` },
    { key: 'settings',  label: 'Settings',  hash: `#${mod}-settings-rules` },
    { key: 'chat',      label: `💬 Chat with ${stewardLabel(mod, meta)}`, hash: `#${mod}-chat`, isAction: true },
  ];
  const purpose = meta?.purpose_line || meta?.summary || '';
  const connectors = (meta?.requires_connectors || []).slice(0, 3).map(c => escapeHtml(c)).join(', ');
  const stewart = escapeHtml(stewardLabel(mod, meta));
  const purposeLine = purpose
    ? `<div style="font-size:13.5px;color:${C.ink2};line-height:1.45;margin-top:6px;">${escapeHtml(purpose)}${stewart ? ` · <strong style="color:${C.ink};font-weight:600;">${stewart}</strong>` : ''}${connectors ? ` · <span style="color:${C.ink3};font-family:${C.mono};font-size:12px;">${connectors}</span>` : ''}</div>`
    : '';
  const statusPill = `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(14,159,110,.10);color:${C.green};border-radius:99px;font:600 10.5px ${C.mono};letter-spacing:.06em;flex-shrink:0;"><span style="width:7px;height:7px;border-radius:99px;background:${C.green};animation:pulseDot 1.6s infinite;"></span>Steward active</span>`;
  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="flex:1;min-width:280px;">
        <div style="font:600 10.5px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${modColor};margin-bottom:8px;">${escapeHtml(modName)} · module</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:40px;height:40px;border-radius:9px;background:${modColor};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;flex-shrink:0;">${escapeHtml((modName||'?').charAt(0))}</div>
          <h1 style="font-size:26px;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.05;">${escapeHtml(modName)}</h1>
          ${statusPill}
        </div>
        ${purposeLine}
      </div>
    </div>
    <nav style="display:flex;gap:22px;border-bottom:1px solid ${C.border};margin-bottom:24px;">
      ${tabs.map(t => {
        const on = activeTab === t.key;
        if (t.isAction) {
          return `<a href="#" data-action-tab="steward-chat" data-mod="${mod}" style="padding:10px 0;font-size:13.5px;color:${C.ink3};font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;text-decoration:none;margin-left:auto;">
            ${t.label}
          </a>`;
        }
        return `<a href="${t.hash}" style="padding:10px 0;font-size:13.5px;color:${on ? C.ink : C.ink3};font-weight:${on ? 700 : 500};border-bottom:${on ? `2px solid ${C.accent}` : '2px solid transparent'};margin-bottom:-1px;text-decoration:none;">
          ${t.label}
        </a>`;
      }).join('')}
    </nav>
  `;
}

function stewardLabel(mod, meta) {
  if (meta?.stewart_archetype) {
    // e.g. product-stewart → "Product Stewart"
    const parts = meta.stewart_archetype.split('-');
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }
  return `${mod.charAt(0).toUpperCase() + mod.slice(1)} Stewart`;
}

// Wide WorkflowRow used in Workflows tab + as rollup-preview in Overview.
// Columns (left → right): Workflow (icon + title + module) · Trigger/Cadence ·
// Owner · Automation gauge · 90d adherence · Last/Next run.
export function workflowRow(w, narrow = false) {
  const isSched = w.kind === 'scheduled';
  const kpLabel = isSched ? 'SCHEDULED' : 'MANUAL';
  const kpColor = isSched ? C.ink2 : C.manual;
  const kpBg = isSched ? 'rgba(20,22,28,.06)' : 'rgba(122,77,255,.12)';
  const kpRadius = isSched ? '5px' : '3px';
  const triggerStr = isSched ? w.cadence_label : w.trigger_label;
  const owner = w.owner || {};
  const adhColor = adherenceColor(w.adherence_pct_90d);
  const adhLabel = w.adherence_pct_90d == null ? '—' : (w.adherence_pct_90d + '%');
  const segs = [];
  for (let i = 0; i < w.total_steps; i++) {
    segs.push(i < w.automated_steps ? C.green : 'rgba(20,22,28,.10)');
  }
  const runColor = (w.next_run_overdue || w.last_run_label?.includes('overdue')) ? C.red : C.ink2;

  if (narrow) {
    return `<a href="#workflow-detail/${escapeHtml(w.id)}?from=overview" style="background:${C.card};border:1px solid ${C.border};border-radius:11px;padding:13px 15px;box-shadow:0 1px 2px rgba(16,18,28,.04);text-decoration:none;color:inherit;display:block;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px;">
        <span style="width:32px;height:32px;flex:none;border-radius:9px;background:${w.module_bg || MODULES[w.mod]?.bg || 'rgba(20,22,28,.06)'};color:${w.module_color || MODULES[w.mod]?.color || C.ink2};display:flex;align-items:center;justify-content:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 2.1 21 6l-4 3.9"/><path d="M3 12V8a2 2 0 0 1 2-2h14"/><path d="m7 21.9-4-3.9 4-3.9"/><path d="M21 12v4a2 2 0 0 1-2 2H5"/></svg>
        </span>
        <strong style="font-size:13.5px;color:${C.ink};flex:1;min-width:0;">${escapeHtml(w.title)}</strong>
        <span style="font:600 9px ${C.mono};letter-spacing:.08em;color:${kpColor};background:${kpBg};border-radius:${kpRadius};padding:2px 6px;">${kpLabel}</span>
      </div>
      <div style="font:500 11px ${C.mono};color:${C.ink3};">${escapeHtml(triggerStr || '')}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:9px;">
        <div style="flex:1;display:flex;gap:2px;">
          ${segs.map(s => `<span style="flex:1;height:4px;border-radius:2px;background:${s};"></span>`).join('')}
        </div>
        <span style="font:500 10.5px ${C.mono};color:${C.ink3};">${w.automated_steps}/${w.total_steps}</span>
      </div>
    </a>`;
  }

  return `<a href="#workflow-detail/${escapeHtml(w.id)}?from=workflows" style="background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:14px 18px;box-shadow:0 1px 2px rgba(16,18,28,.04);text-decoration:none;color:inherit;display:grid;grid-template-columns:minmax(0, 2.3fr) minmax(0, 1.5fr) minmax(0, 1.2fr) minmax(0, 1.4fr) 80px minmax(0, 1.5fr);gap:18px;align-items:center;">
    <div style="display:flex;align-items:center;gap:12px;min-width:0;">
      <span style="width:38px;height:38px;flex:none;border-radius:10px;background:${w.module_bg || MODULES[w.mod]?.bg};color:${w.module_color || MODULES[w.mod]?.color};display:flex;align-items:center;justify-content:center;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 2.1 21 6l-4 3.9"/><path d="M3 12V8a2 2 0 0 1 2-2h14"/><path d="m7 21.9-4-3.9 4-3.9"/><path d="M21 12v4a2 2 0 0 1-2 2H5"/></svg>
      </span>
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong style="font-size:14.5px;color:${C.ink};">${escapeHtml(w.title)}</strong>
          <span style="font:600 9px ${C.mono};letter-spacing:.08em;color:${kpColor};background:${kpBg};border-radius:${kpRadius};padding:2px 6px;">${kpLabel}</span>
        </div>
        <div style="font:500 11px ${C.mono};color:${C.ink3};margin-top:3px;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(w.area_name || '')}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;font:500 11.5px ${C.mono};color:${isSched ? C.ink2 : C.manual};">
      <span style="width:7px;height:7px;border-radius:99px;background:${isSched ? (w.module_color || MODULES[w.mod]?.color || C.green) : C.manual};"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(triggerStr || '—')}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;min-width:0;">
      <span style="width:26px;height:26px;flex:none;border-radius:99px;background:${owner.bg || 'rgba(20,22,28,.08)'};color:${owner.color || C.ink2};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10.5px;">${escapeHtml(owner.initials || '?')}</span>
      ${owner.owner_b ? `<span style="width:26px;height:26px;flex:none;border-radius:99px;background:${owner.owner_b.bg};color:${owner.owner_b.color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10.5px;margin-left:-12px;border:1.5px solid ${C.card};">${escapeHtml(owner.owner_b.initials)}</span>` : ''}
      <span style="font-size:12.5px;color:${C.ink2};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(owner.tag || '')}</span>
    </div>
    <div>
      <div style="display:flex;gap:2px;margin-bottom:5px;">
        ${segs.map(s => `<span style="flex:1;height:5px;border-radius:2px;background:${s};"></span>`).join('')}
      </div>
      <span style="font:500 10.5px ${C.mono};color:${C.ink3};">${w.automated_steps} of ${w.total_steps} automated</span>
    </div>
    <span style="font-size:14px;font-weight:700;color:${adhColor};text-align:center;">${escapeHtml(adhLabel)}</span>
    <span style="font:500 11.5px ${C.mono};color:${runColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(w.last_run_label || '—')}</span>
  </a>`;
}

export function pathSegment() {
  const raw = (window.location.hash || '').replace(/^#/, '').split('?')[0];
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : '';
}

export function queryParam(key) {
  const raw = (window.location.hash || '').replace(/^#/, '');
  const q = raw.split('?')[1];
  if (!q) return null;
  return new URLSearchParams(q).get(key);
}

// Update sidebar Tasks badges. Called after tasks load. Red when any
// task in that module has urgency=overdue; neutral otherwise.
export function updateTaskBadges(tasks) {
  const byMod = {
    finance:     { count: 0, overdue: false },
    strategy:    { count: 0, overdue: false },
    product:     { count: 0, overdue: false },
    development: { count: 0, overdue: false },
    operations:  { count: 0, overdue: false },
  };
  (tasks || []).forEach(t => {
    if (!byMod[t.mod]) return;
    byMod[t.mod].count += 1;
    if (t.urgency === 'overdue') byMod[t.mod].overdue = true;
  });
  for (const mod of Object.keys(byMod)) {
    const el = document.getElementById(`nav-${mod}-tasks-badge`);
    if (!el) continue;
    const { count, overdue } = byMod[mod];
    if (count === 0) {
      el.hidden = true;
      continue;
    }
    el.hidden = false;
    el.textContent = String(count);
    el.style.fontFamily = "'JetBrains Mono',ui-monospace,Menlo,monospace";
    el.style.fontSize = '10px';
    el.style.fontWeight = '700';
    el.style.padding = '1px 6px';
    el.style.borderRadius = '99px';
    el.style.minWidth = '18px';
    el.style.textAlign = 'center';
    el.style.background = overdue ? 'rgba(192,57,43,.14)' : 'rgba(20,22,28,.08)';
    el.style.color = overdue ? '#c0392b' : '#5b6270';
  }
}
