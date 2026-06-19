// People & permissions view — reached from workspace dropdown.
//
// Today: single operator (Alessio) as Owner. Other roles + invite flow live
// behind the Invite button which opens the Add-a-person onboarding overlay.

import { escapeHtml } from '../utils.js';
import { openOnboarding } from '../overlay.js';

// Operator is the only known person today. When invite flow ships (v0.8),
// this becomes a substrate-backed list. For now: hardcoded with role chip.
const PEOPLE = [
  {
    id: 'alessio',
    name: 'Alessio Tixi',
    email: 'alessio@tuto.ai',
    initials: 'A',
    avatarBg: 'linear-gradient(135deg,#2f6bff,#7a4dff)',
    you: true,
    scope: 'All sections · all ventures',
    role: 'Owner',
    roleFg: '#fff',
    roleBg: '#16181d',
  },
];

export function renderPeople(ctx) {
  const root = document.getElementById('route-people');
  root.innerHTML = `
    <div class="card">
      <div class="people-list">
        ${PEOPLE.map(p => `
          <div class="people-row">
            <span class="people-avatar" style="background:${p.avatarBg}">${escapeHtml(p.initials)}</span>
            <div class="people-body">
              <div class="people-name-row">
                <span class="people-name">${escapeHtml(p.name)}</span>
                ${p.you ? `<span class="people-you-tag mono">YOU</span>` : ''}
              </div>
              <div class="people-email">${escapeHtml(p.email)}</div>
            </div>
            <div class="people-scope">${escapeHtml(p.scope)}</div>
            <span class="people-role-chip" style="color:${p.roleFg};background:${p.roleBg}">${escapeHtml(p.role)}</span>
          </div>
        `).join('')}
        <div class="people-empty-row">
          <span class="people-empty-icon mono">+</span>
          <div class="people-empty-body">
            <div class="people-empty-title">You're the only person here</div>
            <div class="people-empty-sub">Invite a teammate, advisor, or investor to give them scoped access.</div>
          </div>
          <button type="button" class="people-empty-cta" id="invite-from-empty">Invite person</button>
        </div>
      </div>
    </div>

    <div class="roles-grid">
      <div class="role-card">
        <div class="role-card-head"><span class="role-card-name">Admin</span><span class="role-card-dot" style="background:#2f6bff"></span></div>
        <p class="role-card-body">Full access. Sees everything, edits anything, manages people, billing, and governance.</p>
      </div>
      <div class="role-card">
        <div class="role-card-head"><span class="role-card-name">Editor</span><span class="role-card-dot" style="background:#0e9f6e"></span></div>
        <p class="role-card-body">Works the venture. Can issue memos, run meetings, and approve in the sections you grant — no settings or billing.</p>
      </div>
      <div class="role-card">
        <div class="role-card-head"><span class="role-card-name">Viewer</span><span class="role-card-dot" style="background:#e0a008"></span></div>
        <p class="role-card-body">Read-only on the sections you expose. Ideal for investors and advisors who need a window, not the keys.</p>
      </div>
    </div>
  `;

  // Wire the empty-row Invite + the header Invite button (the header one is wired in app.js)
  const emptyInvite = document.getElementById('invite-from-empty');
  if (emptyInvite) emptyInvite.addEventListener('click', () => openOnboarding('human'));
}
