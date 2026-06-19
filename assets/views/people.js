// People & permissions view — reached from workspace dropdown.
//
// Today: single operator (Alessio) as Owner. Other roles + invite flow live
// behind the Invite button which opens the Add-a-person onboarding overlay.

import { escapeHtml } from '../utils.js';

// Single-user mode until the invite flow ships (v0.8). Operator row is the
// only entry; everything else is empty state.

export function renderPeople(ctx) {
  const root = document.getElementById('route-people');
  const identity = ctx.identity || {};
  const operatorName = identity.operator_name || 'You';
  const operatorInitial = operatorName.charAt(0).toUpperCase();

  root.innerHTML = `
    <div class="card">
      <div class="people-list">
        <div class="people-row">
          <span class="people-avatar" style="background:linear-gradient(135deg,#2f6bff,#7a4dff)">${escapeHtml(operatorInitial)}</span>
          <div class="people-body">
            <div class="people-name-row">
              <span class="people-name">${escapeHtml(operatorName)}</span>
              <span class="people-you-tag mono">YOU</span>
            </div>
            <div class="people-email">Single-operator mode</div>
          </div>
          <div class="people-scope">All sections · all ventures</div>
          <span class="people-role-chip" style="color:#fff;background:#16181d">Owner</span>
        </div>
      </div>

      <div class="empty-cactus" style="padding:28px 24px">
        <div class="empty-cactus-icon">🌵</div>
        <div class="empty-cactus-title">Just you so far</div>
        <div class="empty-cactus-body">
          Invite a teammate, advisor, or investor to give them scoped access. Invite flow ships in v0.8.
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
}
