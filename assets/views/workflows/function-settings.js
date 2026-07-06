// Settings placeholder pages for module Settings sub-nav.
// Rules is the only settings sub-tab wired in v0.9 (renders the discipline
// view — see function-discipline.js). General / Connections / Permissions
// ship as placeholders so the sub-nav is navigable.

import { C, MODULES, escapeHtml, currentBu, functionHeader } from './_shared.js';

const FN_META = {
  finance:    MODULES.finance,
  strategy:   MODULES.strategy,
  product:    { name: 'Product',    color: '#2f6bff', bg: 'rgba(47,107,255,.10)' },
  development:{ name: 'Development',color: '#0d8a8e', bg: 'rgba(13,138,142,.10)' },
  operations: { name: 'Operations', color: '#5b6270', bg: 'rgba(91,98,112,.10)' },
};

const COPY = {
  general: {
    title: 'General',
    copy: 'Module display name, description, install state, retire toggle. Coming in v1.0 alongside the module manifest editor.',
  },
  connections: {
    title: 'Connections',
    copy: 'Which external tools this module is wired to (Google Workspace, Notion, GitHub, etc.). Grant / revoke per Stewart. Coming in v1.0.',
  },
  permissions: {
    title: 'Permissions',
    copy: 'Which team members can read / write / propose in this module. Ties into venture-level Roster roles. Coming in v1.0.',
  },
};

export function renderSettingsPlaceholder(mod, activeSub) {
  const targetId = `route-${mod}-settings-${activeSub}`;
  const root = document.getElementById(targetId);
  if (!root) return;
  const modMeta = FN_META[mod] || { name: mod.charAt(0).toUpperCase() + mod.slice(1), color: C.ink };
  const c = COPY[activeSub] || { title: activeSub, copy: 'Placeholder.' };

  root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
    ${functionHeader({ mod, modName: modMeta.name, modColor: modMeta.color, activeTab: 'settings' })}
    ${renderSubNav(mod, activeSub)}
    <div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:12px;padding:32px 34px;">
      <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:${modMeta.color};text-transform:uppercase;margin-bottom:8px;">SETTINGS · ${escapeHtml(c.title.toUpperCase())}</div>
      <h2 style="font-size:20px;font-weight:800;margin:0 0 8px;color:#16181d;">${escapeHtml(c.title)}</h2>
      <p style="font-size:14px;color:#5b6270;line-height:1.55;margin:0;max-width:640px;">${escapeHtml(c.copy)}</p>
    </div>
  </div>`;
}

function renderSubNav(mod, active) {
  const items = [
    { key: 'general',     label: 'General',     hash: `#${mod}-settings-general` },
    { key: 'connections', label: 'Connections', hash: `#${mod}-settings-connections` },
    { key: 'rules',       label: 'Rules',       hash: `#${mod}-settings-rules` },
    { key: 'permissions', label: 'Permissions', hash: `#${mod}-settings-permissions` },
  ];
  return `<nav style="display:flex;gap:16px;margin-bottom:20px;">
    ${items.map(it => {
      const on = it.key === active;
      return `<a href="${it.hash}" style="padding:6px 12px;font-size:12.5px;font-weight:${on ? 700 : 500};color:${on ? '#16181d' : '#5b6270'};border-radius:8px;background:${on ? 'rgba(20,22,28,.06)' : 'transparent'};text-decoration:none;">${escapeHtml(it.label)}</a>`;
    }).join('')}
  </nav>`;
}
