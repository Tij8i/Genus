// Function Discipline tab — roadmap i41.
//
// Renders the module's discipline rules (agreed / pending / rejected) and
// lets the operator propose new rules, agree/reject pending ones, and see
// the evidence trail each rule was proposed on.
//
// One tab per module (Finance / Strategy / Product / Operations). Substrate:
// bus/<bu>/<mod>/discipline.json. API: /api/discipline.

import { C, MODULES, escapeHtml, currentBu, functionHeader } from './_shared.js';

const FN_META = {
  finance:    MODULES.finance,
  strategy:   MODULES.strategy,
  product:    { name: 'Product',    color: '#2f6bff', bg: 'rgba(47,107,255,.10)' },
  operations: { name: 'Operations', color: '#5b6270', bg: 'rgba(91,98,112,.10)' },
};

export async function renderFunctionDiscipline(mod) {
  // i106: check both old route (route-{mod}-discipline) and new route
  // (route-{mod}-settings-rules). Whichever is currently visible gets rendered.
  const root = document.getElementById(`route-${mod}-settings-rules`) || document.getElementById(`route-${mod}-discipline`);
  if (!root) return;
  const bu = currentBu();
  const modMeta = FN_META[mod] || { name: mod, color: C.ink };
  root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
    ${functionHeader({ mod, modName: modMeta.name, modColor: modMeta.color, activeTab: 'settings' })}
    <div style="padding:40px;color:#9aa1ae;text-align:center;">Loading discipline rules…</div>
  </div>`;

  let payload;
  try {
    const res = await fetch(`/api/discipline?bu=${encodeURIComponent(bu)}&module=${encodeURIComponent(mod)}`, { credentials: 'include' });
    payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.message || `HTTP ${res.status}`);
  } catch (e) {
    root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
      ${functionHeader({ mod, modName: modMeta.name, modColor: modMeta.color, activeTab: 'settings' })}
      <div style="padding:24px;background:#fdebe9;border:1px solid #f6cfca;border-radius:11px;color:#c12525;">Could not load discipline: ${escapeHtml(e.message || String(e))}</div>
    </div>`;
    return;
  }

  const rules = payload.rules || [];
  const agreed = rules.filter(r => r.status === 'agreed');
  const pending = rules.filter(r => r.status === 'pending');
  const rejected = rules.filter(r => r.status === 'rejected');

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
      ${functionHeader({ mod, modName: modMeta.name, modColor: modMeta.color, activeTab: 'settings' })}

      ${renderSettingsSubNav(mod, 'rules')}
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;gap:20px;flex-wrap:wrap;">
        <div style="flex:1;min-width:280px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:${modMeta.color};text-transform:uppercase;margin-bottom:6px;">SETTINGS · RULES</div>
          <h2 style="font-size:20px;font-weight:800;margin:0 0 6px;color:#16181d;">The rules ${moduleStewart(mod)} + the operator have agreed to follow</h2>
          <p style="font-size:13px;color:#5b6270;margin:0;line-height:1.5;">${escapeHtml(payload.description || `Rules for the ${modMeta.name} module. Proposed by the Stewart, agreed by the operator. Rejected rules stay for archaeology — Stewart won't re-propose the same shape.`)}</p>
        </div>
        <button type="button" id="disc-propose-btn" style="padding:9px 16px;border:none;border-radius:10px;background:${modMeta.color};color:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px ${modMeta.color}44;flex-shrink:0;">+ Propose a rule</button>
      </div>

      ${statTiles(agreed.length, pending.length, rejected.length, modMeta.color)}

      ${pending.length > 0 ? section('Pending decision', pending.map(r => ruleCard(r, modMeta.color)).join(''), '#c78500') : ''}
      ${agreed.length > 0 ? section('Agreed', agreed.map(r => ruleCard(r, modMeta.color)).join(''), '#238c46') : emptyAgreed(modMeta)}
      ${rejected.length > 0 ? section('Rejected', rejected.map(r => ruleCard(r, modMeta.color)).join(''), '#9aa1ae') : ''}
    </div>
  `;

  document.getElementById('disc-propose-btn')?.addEventListener('click', () => openProposeDialog(bu, mod));
  document.querySelectorAll('.disc-agree').forEach(b => b.addEventListener('click', () => decideRule(bu, mod, b.dataset.ruleId, 'agree_rule', null)));
  document.querySelectorAll('.disc-reject').forEach(b => b.addEventListener('click', () => {
    const reason = prompt('Why reject this rule? Stewart will remember and not re-propose the same shape.');
    if (reason === null) return;
    decideRule(bu, mod, b.dataset.ruleId, 'reject_rule', reason);
  }));
}

function renderSettingsSubNav(mod, active) {
  const items = [
    { key: 'general',     label: 'General',     hash: `#${mod}-settings-general` },
    { key: 'connections', label: 'Connections', hash: `#${mod}-settings-connections` },
    { key: 'rules',       label: 'Rules',       hash: `#${mod}-settings-rules` },
    { key: 'permissions', label: 'Permissions', hash: `#${mod}-settings-permissions` },
  ];
  return `<nav style="display:flex;gap:16px;margin-bottom:20px;padding-bottom:0;">
    ${items.map(it => {
      const on = it.key === active;
      return `<a href="${it.hash}" style="padding:6px 12px;font-size:12.5px;font-weight:${on ? 700 : 500};color:${on ? '#16181d' : '#5b6270'};border-radius:8px;background:${on ? 'rgba(20,22,28,.06)' : 'transparent'};text-decoration:none;">${it.label}</a>`;
    }).join('')}
  </nav>`;
}

function moduleStewart(mod) {
  return mod === 'product' ? 'Product Stewart' : mod === 'finance' ? 'Finance Stewart' : mod === 'strategy' ? 'Strategy Stewart' : mod === 'development' ? 'Dev Stewart' : 'the Stewart';
}

function statTiles(agreed, pending, rejected, color) {
  const tile = (label, n, c) => `<div style="flex:1;padding:14px 18px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:11px;">
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#9aa1ae;text-transform:uppercase;">${label}</div>
    <div style="font-size:22px;font-weight:800;color:${c};margin-top:4px;">${n}</div>
  </div>`;
  return `<div style="display:flex;gap:12px;margin-bottom:20px;">
    ${tile('Agreed', agreed, '#238c46')}
    ${tile('Pending', pending, '#c78500')}
    ${tile('Rejected', rejected, '#9aa1ae')}
  </div>`;
}

function section(title, body, tint) {
  return `<div style="margin-bottom:22px;">
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:${tint};text-transform:uppercase;margin-bottom:9px;">${title}</div>
    <div style="display:flex;flex-direction:column;gap:10px;">${body}</div>
  </div>`;
}

function emptyAgreed(modMeta) {
  return `<div style="margin-bottom:22px;padding:32px 24px;text-align:center;background:#fff;border:1.5px dashed rgba(20,22,28,.14);border-radius:12px;color:#9aa1ae;">
    <div style="font-size:14px;color:#5b6270;margin-bottom:6px;">No agreed rules yet.</div>
    <div style="font-size:12.5px;">${escapeHtml(modMeta.name)} Stewart will propose the first rules from patterns it sees; you can also propose them yourself above.</div>
  </div>`;
}

function ruleCard(r, accent) {
  const stateChip = r.status === 'agreed'
    ? `<span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:#e3ede2;color:#238c46;font-weight:700;">AGREED</span>`
    : r.status === 'pending'
    ? `<span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:#f3e9d6;color:#9a6320;font-weight:700;">PENDING</span>`
    : `<span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:#eef0f4;color:#5b6270;font-weight:700;">REJECTED</span>`;
  const borderColor = r.status === 'agreed' ? '#238c4633' : r.status === 'pending' ? '#c78500' : 'rgba(20,22,28,.10)';
  const evidence = (r.evidence || []).slice(0, 6);
  return `<div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${borderColor};border-radius:11px;padding:14px 17px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:9px;flex:1;">
        ${stateChip}
        <strong style="font-size:14px;color:#16181d;line-height:1.35;">${escapeHtml(r.title)}</strong>
      </div>
      <span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:10.5px;color:#9aa1ae;">${escapeHtml((r.status === 'agreed' ? r.agreed_at : r.status === 'rejected' ? r.decided_at : r.proposed_at || '').slice(0,10))}</span>
    </div>
    <div style="font-size:13px;color:#3a3f4a;line-height:1.55;margin-bottom:10px;">${escapeHtml(r.body || '')}</div>
    ${r.status === 'rejected' && r.decided_reason ? `<div style="font-size:12px;color:#9aa1ae;background:#f5f6f8;border-radius:7px;padding:8px 11px;margin-bottom:10px;font-style:italic;">Reason: ${escapeHtml(r.decided_reason)}</div>` : ''}
    ${evidence.length > 0 ? `<details style="margin-bottom:${r.status === 'pending' ? '12px' : '0'};">
      <summary style="cursor:pointer;font-size:11.5px;color:${accent};font-weight:600;user-select:none;list-style:none;">▸ ${evidence.length} evidence signal${evidence.length === 1 ? '' : 's'}</summary>
      <ul style="margin:6px 0 0 0;padding-left:16px;font-size:12px;color:#5b6270;line-height:1.5;">
        ${evidence.map(e => `<li style="margin-bottom:2px;"><span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(e.t || '?')}</span> — ${escapeHtml(e.signal || '')}</li>`).join('')}
      </ul>
    </details>` : ''}
    ${r.status === 'pending' ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
      <button type="button" class="disc-reject onboard-cancel" data-rule-id="${escapeHtml(r.id)}" style="padding:6px 12px;font-size:12px;color:#c12525;border-color:#f6cfca;">Reject</button>
      <button type="button" class="disc-agree onboard-begin" data-rule-id="${escapeHtml(r.id)}" style="padding:6px 14px;font-size:12px;">Agree ✓</button>
    </div>` : ''}
  </div>`;
}

function openProposeDialog(bu, mod) {
  const host = document.getElementById('overlay-host');
  if (!host) return;
  host.innerHTML = `
    <div id="disc-scrim" style="position:fixed;inset:0;background:rgba(16,18,28,.34);z-index:60;"></div>
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(620px,94vw);background:#fff;border-radius:16px;box-shadow:0 30px 90px rgba(16,18,28,.28);z-index:61;overflow:hidden;">
      <div style="padding:20px 24px 14px;border-bottom:1px solid rgba(20,22,28,.08);display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--accent);text-transform:uppercase;">Propose a discipline rule</div>
          <div style="font-size:13px;color:#5b6270;margin-top:3px;">The Stewart will review; the operator will agree or reject.</div>
        </div>
        <button type="button" id="disc-close" style="background:none;border:none;font-size:26px;color:#9aa1ae;cursor:pointer;line-height:1;">×</button>
      </div>
      <div style="padding:20px 24px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#5b6270;margin-bottom:5px;">Title (short — "Cuts always need operator approval")</label>
        <input type="text" id="disc-title" style="width:100%;padding:9px 12px;border:1px solid rgba(20,22,28,.12);border-radius:8px;font-family:inherit;font-size:13px;color:#16181d;margin-bottom:14px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#5b6270;margin-bottom:5px;">Rule (what the Stewart + operator agree to do or not do)</label>
        <textarea id="disc-body" rows="6" style="width:100%;padding:9px 12px;border:1px solid rgba(20,22,28,.12);border-radius:8px;font-family:inherit;font-size:13px;line-height:1.5;color:#16181d;resize:vertical;"></textarea>
      </div>
      <div style="padding:14px 24px;border-top:1px solid rgba(20,22,28,.08);display:flex;justify-content:flex-end;gap:10px;">
        <button type="button" class="disc-cancel onboard-cancel" style="padding:8px 16px;">Cancel</button>
        <button type="button" id="disc-submit" class="onboard-begin" style="padding:8px 18px;">Propose ↗</button>
      </div>
    </div>
  `;
  const close = () => { host.innerHTML = ''; };
  document.getElementById('disc-scrim')?.addEventListener('click', close);
  document.getElementById('disc-close')?.addEventListener('click', close);
  document.querySelectorAll('.disc-cancel').forEach(b => b.addEventListener('click', close));
  document.getElementById('disc-submit').addEventListener('click', async () => {
    const title = document.getElementById('disc-title').value.trim();
    const body = document.getElementById('disc-body').value.trim();
    if (!title) { alert('Title required'); return; }
    if (!body) { alert('Rule body required'); return; }
    const btn = document.getElementById('disc-submit');
    btn.disabled = true; btn.textContent = 'Proposing…';
    try {
      const res = await fetch('/api/discipline', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, module: mod, action: 'propose_rule', rule: { title, body } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.message || `HTTP ${res.status}`);
      close();
      await renderFunctionDiscipline(mod);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Propose ↗';
      alert(`Could not propose: ${e.message}`);
    }
  });
}

async function decideRule(bu, mod, rule_id, action, reason) {
  try {
    const res = await fetch('/api/discipline', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, module: mod, action, rule_id, reason }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.message || `HTTP ${res.status}`);
    await renderFunctionDiscipline(mod);
  } catch (e) {
    alert(`Could not ${action.replace('_', ' ')}: ${e.message}`);
  }
}
