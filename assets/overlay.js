// Shared overlay primitive — backdrop + centered panel. Used for onboarding,
// memo detail, meeting detail, module preview. Closes on backdrop click,
// X button, or Esc key. One overlay at a time (replaces existing).

import { escapeHtml } from './utils.js';
import { showAlert, showConfirm, showPrompt } from './dialog.js';

let activeCloseHandler = null;

export function openOverlay({ title, subtitle, iconHtml, iconTint, bodyHtml, footerHtml, onClose }) {
  const host = document.getElementById('overlay-host');
  if (!host) return;
  // Close any existing overlay
  closeOverlay();

  host.innerHTML = `
    <div class="overlay-backdrop" id="overlay-backdrop-shared"></div>
    <div class="overlay-modal" role="dialog" aria-modal="true">
      <div class="overlay-modal-head">
        <div class="overlay-modal-head-left">
          ${iconHtml ? `<span class="overlay-modal-icon" style="background:${iconTint || 'var(--accent)'};color:#fff">${iconHtml}</span>` : ''}
          <div>
            <div class="overlay-modal-title">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="overlay-modal-sub">${escapeHtml(subtitle)}</div>` : ''}
          </div>
        </div>
        <button type="button" class="overlay-modal-close" id="overlay-modal-close-shared" aria-label="Close">×</button>
      </div>
      <div class="overlay-modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="overlay-modal-foot">${footerHtml}</div>` : ''}
    </div>
  `;

  const close = () => {
    host.innerHTML = '';
    activeCloseHandler = null;
    if (onClose) onClose();
  };
  activeCloseHandler = close;
  document.getElementById('overlay-backdrop-shared').addEventListener('click', close);
  document.getElementById('overlay-modal-close-shared').addEventListener('click', close);
  setTimeout(() => {
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
    });
  }, 0);
  return close;
}

export function closeOverlay() {
  if (activeCloseHandler) activeCloseHandler();
}

// ============ Onboarding overlays ============

const ONBOARD_FLOWS = {
  human: {
    title: 'Add a person',
    subtitle: 'Invite a teammate, advisor, or investor.',
    iconHtml: '👤',
    iconTint: '#2f6bff',
    steps: [
      'Enter their email address.',
      'Pick a role — Admin / Editor / Viewer.',
      'Scope which sections they can see.',
      'They confirm via email, set a password, and get a guided tour. The first human invited becomes the Owner.',
    ],
  },
  venture: {
    title: 'Add a venture',
    subtitle: 'A second Stewart-managed BU under this workspace.',
    iconHtml: '🏛',
    iconTint: '#0e9f6e',
    steps: [
      'Name the venture + the core goal.',
      'Connect a Paperclip runtime (local or remote).',
      'Point the Stewart at the repo + docs + initial substrate.',
      'The Stewart drafts a 30-day plan for your review.',
    ],
  },
  agent: {
    title: 'Add an expert agent',
    subtitle: 'A Mason specialist that takes on a domain (e.g., CPO, Engineering, Marketing).',
    iconHtml: '🤖',
    iconTint: '#e0683a',
    steps: [
      'Choose specialty (CPO · Engineering · Marketing · QA · custom).',
      'Set monthly budget + runtime (Paperclip / external).',
      'Grant tools + data access scopes.',
      'Coach the first task — agent learns from your edits.',
    ],
  },
};

export function openOnboarding(flowKey) {
  const f = ONBOARD_FLOWS[flowKey];
  if (!f) return;
  const stepsHtml = `
    <div class="onboard-section-label mono">How it works</div>
    <div class="onboard-steps">
      ${f.steps.map((s, i) => `
        <div class="onboard-step">
          <span class="onboard-step-num mono">${i + 1}</span>
          <span class="onboard-step-text">${escapeHtml(s)}</span>
        </div>
      `).join('')}
    </div>
  `;
  const footerHtml = `
    <button type="button" class="onboard-cancel" id="onboard-cancel">Cancel</button>
    <button type="button" class="onboard-begin" id="onboard-begin">Begin</button>
  `;
  openOverlay({
    title: f.title,
    subtitle: f.subtitle,
    iconHtml: f.iconHtml,
    iconTint: f.iconTint,
    bodyHtml: stepsHtml,
    footerHtml,
  });
  document.getElementById('onboard-cancel').addEventListener('click', closeOverlay);
  document.getElementById('onboard-begin').addEventListener('click', async () => {
    await showAlert(`«${f.title}» — backend flow ships in v0.8. For now this is a UI placeholder.`);
    closeOverlay();
  });
}
