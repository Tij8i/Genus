// Workflow detail — identity strip + 2-col body.
//
// LEFT: What this workflow is + Steps + (scheduled-only) Run history
// RIGHT: Cadence + next run (or Trigger for manual) + Owners + automation + KPI (when present)
//
// Back button origin: 'from' query param ('overview' | 'workflows' | 'tasks-finance' | 'tasks-strategy' | 'area')

import { C, MODULES, escapeHtml, currentBu, loadWorkflows, pathSegment, queryParam } from './_shared.js';
import { showAlert, showConfirm } from '../../dialog.js';

export async function renderWorkflowDetail() {
  const root = document.getElementById('route-workflow-detail');
  if (!root) return;
  const wfId = pathSegment();
  const from = queryParam('from') || 'workflows';
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading workflow…</div>';

  const data = await loadWorkflows(bu);
  const w = (data?.workflows || []).find(x => x.id === wfId);
  if (!w) {
    root.innerHTML = `<div style="padding:40px;">
      <a href="#${escapeHtml(backTarget(from).hash)}" style="font:500 11.5px ${C.mono};color:${C.ink3};text-decoration:none;">‹ Back</a>
      <h2 style="margin-top:14px;font-size:21px;font-weight:800;">Workflow not found</h2>
    </div>`;
    return;
  }

  const modMeta = MODULES[w.mod] || { name: w.mod, color: C.ink, bg: 'rgba(20,22,28,.06)' };
  const isSched = w.kind === 'scheduled';
  const back = backTarget(from);
  const owner = w.owner || {};

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
      <a href="#${escapeHtml(back.hash)}" style="display:inline-flex;align-items:center;gap:7px;font:500 11.5px ${C.mono};color:${C.ink3};text-decoration:none;margin-bottom:14px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        ${escapeHtml(back.label)}
      </a>

      ${renderIdentityStrip(w, modMeta, isSched)}

      <div style="display:grid;grid-template-columns:1fr 340px;gap:18px;margin-top:18px;align-items:start;">
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0;">
          ${renderWhatThisIs(w, modMeta)}
          ${renderSteps(w, modMeta)}
          ${isSched && (w.runs || []).length > 0 ? renderRunHistory(w) : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:16px;position:sticky;top:24px;">
          ${isSched ? renderCadenceCard(w) : renderTriggerCard(w)}
          ${renderOwnersAutomationCard(w, modMeta)}
          ${w.kpi ? renderKpiCard(w.kpi) : ''}
        </div>
      </div>
    </div>
  `;

  wireDetailButtons(w, bu);
}

function wireDetailButtons(w, bu) {
  const runBtn = document.getElementById('run-now-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const editBtn = document.getElementById('edit-btn');

  runBtn?.addEventListener('click', async () => {
    const ownerAgent = w.owner?.agent_id || w.owner?.id;
    if (!ownerAgent) {
      await showAlert('No owner agent bound to this workflow — can\'t fire.', { subtitle: 'Run workflow', tone: 'danger' });
      return;
    }
    const isMason = /mason/i.test(ownerAgent);
    const endpoint = isMason ? 'http://127.0.0.1:3101/mason/dispatch' : 'http://127.0.0.1:3101/paperclip/fire-agent';
    const original = runBtn.textContent;
    runBtn.disabled = true; runBtn.textContent = 'firing…';
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: ownerAgent, bu, workflow_id: w.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.message || `HTTP ${res.status}`);
      runBtn.textContent = '✓ fired';
      runBtn.style.background = '#238c46';
      runBtn.style.color = '#fff';
    } catch (e) {
      runBtn.disabled = false; runBtn.textContent = original;
      await showAlert(`Fire failed: ${e.message}. The trigger daemon at localhost:3101 may not be running.`, { subtitle: 'Run workflow', tone: 'danger' });
    }
  });

  pauseBtn?.addEventListener('click', async () => {
    const target = w.status === 'active' ? 'paused' : 'active';
    const label = target === 'paused' ? 'Pause' : 'Resume';
    if (!await showConfirm(`${label} this workflow?`, { subtitle: w.title })) return;
    try {
      const res = await fetch('/api/workflow-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ bu, workflow_id: w.id, status: target }),
      });
      if (res.status === 404 || res.status === 405) {
        // Endpoint doesn't exist yet — acknowledge the click without lying
        await showAlert(`Pause/Resume runs via /api/workflow-status which isn\'t wired yet. The workflow's state is unchanged. This will land in the next sync.`, { subtitle: 'Not yet wired' });
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.message || `HTTP ${res.status}`);
      w.status = target;
      await renderWorkflowDetail();
    } catch (e) {
      await showAlert(`${label} failed: ${e.message}`, { subtitle: 'Update workflow status', tone: 'danger' });
    }
  });

  editBtn?.addEventListener('click', async () => {
    await showAlert(`Editing workflows in-place ships in the follow-up slice. For now, edit \`bus/${bu}/workflows.json\` directly in the repo — search for id \`${w.id}\`.`, { subtitle: 'Edit workflow' });
  });
}

function backTarget(from) {
  if (from === 'overview') return { label: 'Function overview', hash: 'finance-overview' }; // module determined below ideally
  if (from?.startsWith('tasks-')) {
    const mod = from.slice(6);
    return { label: `${mod} · Tasks`, hash: `${mod}-tasks` };
  }
  if (from === 'workflows') return { label: 'Workflows', hash: 'finance-workflows' };
  if (from === 'area') return { label: 'Layers', hash: 'layers' };
  return { label: 'Back', hash: 'dashboard' };
}

function renderIdentityStrip(w, modMeta, isSched) {
  const kpLabel = isSched ? 'SCHEDULED' : 'MANUAL';
  const kpColor = isSched ? C.ink2 : C.manual;
  const kpBg = isSched ? 'rgba(20,22,28,.06)' : 'rgba(122,77,255,.12)';
  const kpRadius = isSched ? '5px' : '3px';
  const statusActive = w.status === 'active';

  return `<div style="display:flex;align-items:center;gap:16px;padding:18px 22px;background:${C.card};border:1px solid rgba(20,22,28,.09);border-radius:15px;box-shadow:0 2px 10px rgba(16,18,28,.05);flex-wrap:wrap;">
    <span style="width:48px;height:48px;flex:none;border-radius:12px;background:${modMeta.bg};color:${modMeta.color};display:flex;align-items:center;justify-content:center;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 2.1 21 6l-4 3.9"/><path d="M3 12V8a2 2 0 0 1 2-2h14"/><path d="m7 21.9-4-3.9 4-3.9"/><path d="M21 12v4a2 2 0 0 1-2 2H5"/></svg>
    </span>
    <div style="flex:1;min-width:0;">
      <h1 style="font-size:21px;font-weight:800;letter-spacing:-.02em;margin:0 0 7px;color:${C.ink};">${escapeHtml(w.title)}</h1>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font:600 9.5px ${C.mono};letter-spacing:.08em;color:${modMeta.color};background:${modMeta.bg};border-radius:6px;padding:3px 9px;text-transform:uppercase;">${escapeHtml(modMeta.name)}</span>
        <span style="font:600 9px ${C.mono};letter-spacing:.08em;color:${kpColor};background:${kpBg};border-radius:${kpRadius};padding:2px 6px;">${kpLabel}</span>
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:${C.ink2};">
          <span style="width:8px;height:8px;border-radius:99px;background:${statusActive ? C.green : C.ink3};animation:${statusActive ? 'pulseDot 1.6s infinite' : 'none'};"></span>
          ${escapeHtml(statusActive ? 'active' : w.status)}
        </span>
        <span style="font:500 11.5px ${C.mono};color:${C.ink3};">${escapeHtml((isSched ? w.cadence_label : w.trigger_label) || '')}</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex:none;">
      ${w.automated_steps > 0 ? `<button type="button" id="run-now-btn" style="padding:8px 14px;border:1px solid ${C.border};border-radius:10px;background:${C.card};color:${C.ink};font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">Run now</button>` : ''}
      <button type="button" id="pause-btn" style="padding:8px 14px;border:1px solid ${C.border};border-radius:10px;background:${C.card};color:${C.ink};font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">${statusActive ? 'Pause' : 'Resume'}</button>
      <button type="button" id="edit-btn" style="padding:8px 14px;border:none;border-radius:10px;background:${C.accent};color:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(47,107,255,.28);">Edit</button>
    </div>
  </div>`;
}

function renderWhatThisIs(w, modMeta) {
  return `<section style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:20px 22px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:13px;">What this workflow is</div>
    <p style="font-size:14px;color:#3a3f4a;line-height:1.6;margin:0 0 12px;">${escapeHtml(w.description)}</p>
    <p style="font-size:12.5px;color:${C.ink2};margin:0 0 14px;">Lives in <strong style="color:${C.ink};">${escapeHtml(w.area_name)}</strong> inside module <strong style="color:${modMeta.color};">${escapeHtml(modMeta.name)}</strong>.</p>
    ${w.framing ? `<div style="background:rgba(122,77,255,.06);border:1px solid rgba(122,77,255,.18);border-radius:11px;padding:11px 13px;font-size:12.5px;color:${C.manual};line-height:1.5;">⊹ ${escapeHtml(w.framing)}</div>` : ''}
  </section>`;
}

function renderSteps(w, modMeta) {
  return `<section style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:20px 22px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:14px;">Steps</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${(w.steps || []).map(s => {
        const isAuto = s.mode === 'auto';
        const pillBg = isAuto ? 'rgba(14,159,110,.12)' : 'rgba(201,138,22,.13)';
        const pillFg = isAuto ? C.green : C.amber;
        const execBg = isAuto ? modMeta.bg : 'rgba(91,98,112,.12)';
        const execFg = isAuto ? modMeta.color : C.ink2;
        const execInitials = isAuto ? (w.owner?.initials || '?') : (w.owner?.owner_b?.initials || 'AT');
        return `<div style="display:flex;align-items:flex-start;gap:14px;padding:13px 14px;background:${C.cardSoft};border:1px solid ${C.border};border-radius:11px;">
          <span style="font:600 11px ${C.mono};color:${C.ink3};width:24px;flex:none;padding-top:3px;">${escapeHtml(s.n)}</span>
          <span style="width:30px;height:30px;flex:none;border-radius:99px;background:${execBg};color:${execFg};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;">${escapeHtml(execInitials)}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <strong style="font-size:13.5px;color:${C.ink};">${escapeHtml(s.title)}</strong>
              <span style="font:600 9px ${C.mono};letter-spacing:.08em;color:${pillFg};background:${pillBg};border-radius:5px;padding:2px 6px;">${isAuto ? 'AUTOMATED' : 'MANUAL'}</span>
            </div>
            <p style="font-size:12.5px;color:${C.ink2};margin:5px 0 0;line-height:1.5;">${escapeHtml(s.desc)}</p>
          </div>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

function renderRunHistory(w) {
  const runs = w.runs || [];
  return `<section style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:20px 22px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:14px;">Run history · last ${runs.length}</div>
    <div style="display:flex;align-items:flex-end;gap:5px;height:60px;margin-bottom:14px;">
      ${runs.slice().reverse().map(r => {
        const map = { succeeded: [C.green, '90%'], failed: [C.red, '42%'], skipped: [C.ink3, '62%'] };
        const v = map[r.status] || map.succeeded;
        return `<div style="flex:1;display:flex;align-items:flex-end;height:100%;"><span style="width:100%;height:${v[1]};background:${v[0]};border-radius:3px 3px 0 0;"></span></div>`;
      }).join('')}
    </div>
    <div style="display:flex;flex-direction:column;gap:1px;">
      ${runs.map(r => {
        const map = { succeeded: C.green, failed: C.red, skipped: C.ink3 };
        const dotC = map[r.status] || C.green;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(20,22,28,.05);">
          <span style="width:7px;height:7px;border-radius:99px;background:${dotC};flex:none;"></span>
          <span style="font:500 12px ${C.mono};color:${C.ink2};flex:1;">${escapeHtml(r.date)}</span>
          <span style="font:500 11px ${C.mono};color:${C.ink3};width:64px;text-align:right;">${escapeHtml(r.duration)}</span>
          <span style="font:500 10.5px ${C.mono};color:${dotC};text-transform:uppercase;letter-spacing:.04em;width:64px;text-align:right;">${escapeHtml(r.status)}</span>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

function renderCadenceCard(w) {
  const overdue = w.next_run_overdue;
  return `<section style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:12px;">Cadence + next run</div>
    <div style="font:600 14px ${C.mono};color:${C.ink};letter-spacing:.04em;margin-bottom:8px;">${escapeHtml(w.cadence_label || '')}</div>
    <div style="font-size:13.5px;color:${overdue ? C.red : C.ink2};font-weight:600;margin-bottom:14px;">${escapeHtml(w.next_run_label || '')}</div>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      ${(w.next_runs || []).map(nr => `<div style="flex:1;background:${C.cardSoft};border:1px solid ${C.border};border-radius:9px;padding:8px 10px;text-align:center;">
        <div style="font:500 9.5px ${C.mono};color:${C.ink3};letter-spacing:.04em;">${escapeHtml(nr.mon)}</div>
        <div style="font-size:15px;font-weight:800;color:${C.ink};margin-top:2px;">${escapeHtml(nr.day)}</div>
      </div>`).join('')}
    </div>
    <button type="button" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:9px;background:${C.cardSoft};color:${C.ink2};font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;">Reschedule</button>
  </section>`;
}

function renderTriggerCard(w) {
  const spark = w.spark_counts || [];
  const max = Math.max(1, ...spark);
  return `<section style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:12px;">Trigger</div>
    <div style="font:600 14px ${C.mono};color:${C.manual};margin-bottom:8px;">${escapeHtml(w.trigger_label || '')}</div>
    <p style="font-size:12.5px;color:${C.ink2};line-height:1.55;margin:0 0 14px;">${escapeHtml(w.trigger_desc || '')}</p>
    <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-bottom:5px;">Last fired</div>
    <div style="font-size:13.5px;color:${C.ink};font-weight:600;margin-bottom:14px;">${escapeHtml(w.fired_label || '—')}</div>
    <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-bottom:5px;">Fired ${w.fired_count_90d ?? 0}× in last 90 days</div>
    ${spark.length > 0 ? `<div style="display:flex;align-items:flex-end;gap:3px;height:36px;margin-bottom:14px;">
      ${spark.map(c => `<div style="flex:1;display:flex;align-items:flex-end;height:100%;"><span style="width:100%;height:${Math.max(8, Math.round(c / max * 100))}%;background:${c === 0 ? 'rgba(122,77,255,.18)' : C.manual};border-radius:2px 2px 0 0;"></span></div>`).join('')}
    </div>` : ''}
    <button type="button" id="trigger-now-btn" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:9px;background:${C.cardSoft};color:${C.ink2};font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;">Trigger now</button>
  </section>`;
}

function renderOwnersAutomationCard(w, modMeta) {
  const owner = w.owner || {};
  const segs = [];
  for (let i = 0; i < w.total_steps; i++) {
    segs.push(i < w.automated_steps ? C.green : 'rgba(20,22,28,.10)');
  }
  return `<section style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:12px;">Owners + automation</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:13px;">
      <span style="width:32px;height:32px;flex:none;border-radius:99px;background:${owner.bg || 'rgba(20,22,28,.08)'};color:${owner.color || C.ink2};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${escapeHtml(owner.initials || '?')}</span>
      ${owner.owner_b ? `<span style="width:32px;height:32px;flex:none;border-radius:99px;background:${owner.owner_b.bg};color:${owner.owner_b.color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;margin-left:-16px;border:2px solid ${C.card};">${escapeHtml(owner.owner_b.initials)}</span>` : ''}
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:${C.ink};">${escapeHtml(owner.name || '—')}</div>
        <div style="font:500 11px ${C.mono};color:${C.ink3};">${escapeHtml(owner.tag || '')}</div>
      </div>
    </div>
    <div style="display:flex;gap:3px;margin-bottom:6px;">
      ${segs.map(s => `<span style="flex:1;height:6px;border-radius:3px;background:${s};"></span>`).join('')}
    </div>
    <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-bottom:14px;">${w.automated_steps} of ${w.total_steps} steps automated</div>
    ${w.paperclip_routine_id ? `
      <a href="http://127.0.0.1:3100" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:9px 11px;background:${C.cardSoft};border:1px solid ${C.border};border-radius:9px;text-decoration:none;color:${C.ink};">
        <span style="font:600 11px ${C.mono};flex:1;">${escapeHtml(w.paperclip_routine_id)}</span>
        <span style="font:500 10.5px ${C.mono};color:${C.ink3};">Open ↗</span>
      </a>
      ${w.paperclip_shared_note ? `<div style="font:500 11px ${C.mono};color:${C.ink3};margin-top:7px;">${escapeHtml(w.paperclip_shared_note)}</div>` : ''}` : `<div style="font:500 11.5px ${C.mono};color:${C.ink3};">No Paperclip routine for this workflow.</div>`}
  </section>`;
}

function renderKpiCard(kpi) {
  return `<section style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:12px;">KPI</div>
    <div style="font:600 12px ${C.mono};color:${C.ink2};margin-bottom:8px;">${escapeHtml(kpi.name)}</div>
    <div style="display:flex;align-items:baseline;gap:8px;">
      <span style="font-size:24px;font-weight:800;color:${kpi.color || C.ink};">${escapeHtml(kpi.current || '—')}</span>
      <span style="font:500 11.5px ${C.mono};color:${C.ink3};">target ${escapeHtml(kpi.target || '—')}</span>
    </div>
  </section>`;
}
