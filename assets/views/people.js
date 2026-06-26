// People & permissions view — list users + add/edit/remove.
// Per Session #18/19 Initiative #3 (multi-user). Reads /api/admin-state for
// the roster + writes via /api/people-edit.

import { escapeHtml } from '../utils.js';
import { openOverlay, closeOverlay } from '../overlay.js';
import { fetchSubstrateJson } from '../substrate-client.js';

const ROLE_TINTS = { owner: '#16181d', admin: '#2f6bff', member: '#0e9f6e', observer: '#9aa1ae' };
const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member', observer: 'Observer' };

export async function renderPeople(ctx) {
  const root = document.getElementById('route-people');
  if (!root) return;
  const viewer = ctx?.viewer || {};
  root.innerHTML = '<div class="card"><div class="card-body">Loading roster…</div></div>';

  let state;
  try {
    const res = await fetch('/api/admin-state');
    state = await res.json();
    if (!state.ok) throw new Error(state.message || `HTTP ${res.status}`);
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="card-body">Could not load roster: ${escapeHtml(e.message || String(e))}</div></div>`;
    return;
  }
  const users = state.users || [];

  const registry = await fetchSubstrateJson('dashboard/public/data/bus/_registry.json', null);
  const allBus = (registry?.business_units || []).map(b => b.id);

  const isAdminLike = viewer.role === 'owner' || viewer.role === 'admin';
  root.innerHTML = `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">People &amp; permissions</span>
          <p class="card-sub">${users.length} ${users.length === 1 ? 'user' : 'users'} · global tier (Owner / Admin / Member / Observer) + per-BU access list.</p>
        </div>
        ${isAdminLike ? `<button type="button" class="onboard-begin" id="people-add-btn">Add a person</button>` : ''}
      </div>
      <div class="people-list" style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
        ${users.map(u => renderRow(u, viewer)).join('')}
      </div>
    </div>
  `;

  document.getElementById('people-add-btn')?.addEventListener('click', () => addPersonFlow(allBus));
  root.querySelectorAll('[data-edit-email]').forEach(b => b.addEventListener('click', () => editPersonFlow(b.dataset.editEmail, users, allBus)));
  root.querySelectorAll('[data-remove-email]').forEach(b => b.addEventListener('click', () => removePersonFlow(b.dataset.removeEmail)));
}

function renderRow(u, viewer) {
  const isYou = (u.email || '').toLowerCase() === (viewer.email || '').toLowerCase();
  const canEdit = !isYou && (viewer.role === 'owner' || (viewer.role === 'admin' && u.role !== 'owner'));
  const ventures = u.ventures && u.ventures.includes('*') ? 'all ventures' : (u.ventures || []).join(', ') || '—';
  const tint = ROLE_TINTS[u.role] || '#666';
  const initial = (u.display_name || u.email || '?').charAt(0).toUpperCase();
  return `
    <div style="display:flex;align-items:center;gap:14px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;">
      <span style="width:36px;height:36px;border-radius:50%;background:${tint};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;flex-shrink:0;">${escapeHtml(initial)}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <strong style="font-size:14px;">${escapeHtml(u.display_name || u.email)}</strong>
          ${isYou ? '<span class="mono" style="font-size:10px;padding:1px 7px;background:var(--accent);color:#fff;border-radius:8px;">YOU</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--text-faint);font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;">${escapeHtml(u.email)}</div>
        ${u.title ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${escapeHtml(u.title)}</div>` : ''}
      </div>
      <div style="font-size:11px;color:var(--text-dim);min-width:140px;text-align:right;">${escapeHtml(ventures)}</div>
      <span style="padding:3px 12px;border-radius:10px;background:${tint};color:#fff;font-size:11px;font-weight:600;min-width:64px;text-align:center;">${ROLE_LABELS[u.role] || u.role}</span>
      ${canEdit ? `
        <div style="display:flex;gap:6px;">
          <button type="button" class="onboard-cancel" data-edit-email="${escapeHtml(u.email)}" style="padding:6px 12px;font-size:11px;">Edit</button>
          <button type="button" class="onboard-cancel" data-remove-email="${escapeHtml(u.email)}" style="padding:6px 12px;font-size:11px;border-color:var(--red);color:var(--red-fg);">Remove</button>
        </div>
      ` : ''}
    </div>
  `;
}

function addPersonFlow(allBus) {
  const currentBu = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'genus';
  openOverlay({
    title: 'Add a person',
    subtitle: `Will be added to ${currentBu} only`,
    iconHtml: '👤',
    iconTint: '#2f6bff',
    bodyHtml: personForm({}, allBus, false, currentBu),
    footerHtml: `
      <button type="button" class="onboard-cancel" id="pp-cancel">Cancel</button>
      <button type="button" class="onboard-begin" id="pp-save">Add to ${currentBu}</button>
    `,
  });
  wireForm({}, 'add', currentBu);
}

function editPersonFlow(email, users, allBus) {
  const u = users.find(x => (x.email || '').toLowerCase() === email.toLowerCase());
  if (!u) return;
  openOverlay({
    title: 'Edit ' + (u.display_name || u.email),
    subtitle: 'Change role + venture access',
    iconHtml: '✎',
    iconTint: '#2f6bff',
    bodyHtml: personForm(u, allBus, true, null),
    footerHtml: `
      <button type="button" class="onboard-cancel" id="pp-cancel">Cancel</button>
      <button type="button" class="onboard-begin" id="pp-save">Save changes</button>
    `,
  });
  wireForm(u, 'edit', null);
}

async function removePersonFlow(email) {
  if (!confirm(`Remove ${email}? They will lose dashboard access immediately on reload.`)) return;
  try {
    const res = await fetch('/api/people-edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', email }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) { alert('Remove failed: ' + (result.message || `HTTP ${res.status}`)); return; }
    renderPeople({ viewer: {} });
  } catch (e) { alert('Network error: ' + (e.message || e)); }
}

function personForm(u, allBus, isEdit, addToBu) {
  const role = u.role || 'member';
  // ADD mode: ventures are locked to the current BU only — owner of one BU isn't
  // necessarily owner of another, so adding people to other BUs is forbidden here.
  // EDIT mode: keep the per-BU checkbox grid (caller controls who they can add).
  const venturesAll = !u.ventures || (Array.isArray(u.ventures) && u.ventures.includes('*'));
  const venturesBlock = isEdit ? `
    <div style="display:flex;flex-direction:column;gap:6px;">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
        <input type="checkbox" id="pp-ventures-all" ${venturesAll ? 'checked' : ''} />
        All ventures (* — implicit for Owner)
      </label>
      <div id="pp-ventures-box" style="display:flex;flex-direction:column;gap:0;padding-left:24px;">
        ${allBus.map(b => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 0;">
            <input type="checkbox" data-bu="${escapeHtml(b)}" ${(u.ventures || []).includes(b) ? 'checked' : ''} ${venturesAll ? 'disabled' : ''} />
            ${escapeHtml(b)}
          </label>
        `).join('')}
      </div>
    </div>
  ` : `
    <div style="padding:12px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;font-size:13px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;margin-bottom:4px;">Adding to venture</div>
      <strong style="font-size:14px;">${escapeHtml(addToBu)}</strong>
      <div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.5;">This person will only see ${escapeHtml(addToBu)}. The owner of another venture must add them separately for that venture — owners of one BU aren't automatically authorized to grant access to others.</div>
    </div>
  `;
  return `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">Email</span>
        <input id="pp-email" type="email" value="${escapeHtml(u.email || '')}" ${isEdit ? 'readonly' : ''}
               style="padding:10px 12px;font-size:14px;border:1px solid var(--border);border-radius:6px;background:${isEdit ? 'var(--surface2)' : 'var(--surface)'};color:var(--text);font-family:inherit;outline:none;" />
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">Display name</span>
        <input id="pp-name" type="text" value="${escapeHtml(u.display_name || '')}" placeholder="e.g. Jane Doe"
               style="padding:10px 12px;font-size:14px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:inherit;outline:none;" />
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">Title (optional)</span>
        <input id="pp-title" type="text" value="${escapeHtml(u.title || '')}" placeholder="e.g. CFO"
               style="padding:10px 12px;font-size:14px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:inherit;outline:none;" />
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">Role</span>
        <select id="pp-role" style="padding:10px 12px;font-size:14px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:inherit;outline:none;">
          ${isEdit ? `<option value="owner" ${role === 'owner' ? 'selected' : ''}>Owner — full access, can manage users + runtimes</option>` : ''}
          <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin — write access within this venture</option>
          <option value="member" ${role === 'member' ? 'selected' : ''}>Member — limited write within this venture</option>
          <option value="observer" ${role === 'observer' ? 'selected' : ''}>Observer — read-only</option>
        </select>
      </label>
      ${venturesBlock}
      <div id="pp-error" style="display:none;padding:10px 12px;background:var(--red-bg);color:var(--red-fg);border-radius:6px;font-size:12px;"></div>
    </div>
  `;
}

function wireForm(u, action, addToBu) {
  const $cancel = document.getElementById('pp-cancel');
  const $save = document.getElementById('pp-save');
  const $err = document.getElementById('pp-error');
  const $role = document.getElementById('pp-role');
  // Ventures controls only exist in edit mode
  const $all = document.getElementById('pp-ventures-all');

  if ($all) {
    $all.addEventListener('change', () => {
      document.querySelectorAll('#pp-ventures-box input[type=checkbox]').forEach(cb => { cb.disabled = $all.checked; });
    });
    $role.addEventListener('change', () => {
      if ($role.value === 'owner') { $all.checked = true; $all.dispatchEvent(new Event('change')); }
    });
  }

  $cancel.addEventListener('click', closeOverlay);
  $save.addEventListener('click', async () => {
    const email = document.getElementById('pp-email').value.trim().toLowerCase();
    const display_name = document.getElementById('pp-name').value.trim();
    const title = document.getElementById('pp-title').value.trim();
    const role = $role.value;
    let ventures;
    if (action === 'add') {
      // Always scoped to the currently-open BU
      ventures = [addToBu];
    } else {
      const venturesAll = $all && $all.checked;
      ventures = venturesAll ? ['*'] : Array.from(document.querySelectorAll('#pp-ventures-box input[type=checkbox]:checked')).map(cb => cb.dataset.bu);
    }
    $err.style.display = 'none';
    if (!email) { $err.textContent = 'Email is required.'; $err.style.display = 'block'; return; }

    $save.disabled = true; $save.textContent = 'Saving…';
    try {
      const res = await fetch('/api/people-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email, role, ventures, display_name, title }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        $err.textContent = result.message || `HTTP ${res.status}`; $err.style.display = 'block';
        $save.disabled = false; $save.textContent = action === 'add' ? `Add to ${addToBu}` : 'Save changes';
        return;
      }
      closeOverlay();
      renderPeople({ viewer: {} });
    } catch (e) {
      $err.textContent = 'Network error: ' + (e.message || e); $err.style.display = 'block';
      $save.disabled = false; $save.textContent = action === 'add' ? `Add to ${addToBu}` : 'Save changes';
    }
  });
}
