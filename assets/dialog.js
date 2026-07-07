// Shared in-app dialog primitives. Replaces the browser-native
// window.prompt / window.confirm / window.alert calls scattered across the
// dashboard — the operator explicitly asked for messages to come from the
// app, not from Chrome.
//
// All three return promises (native versions were synchronous). Callers must
// `await` — a swap that returns null from prompt or false from confirm on
// cancel matches the native shape closely enough that most sites port with
// no logic changes.
//
// Usage:
//   import { showPrompt, showConfirm, showAlert } from '../dialog.js';
//   const name = await showPrompt('Meeting title:', { defaultValue: 'Working session' });
//   if (name === null) return;   // cancelled
//   if (await showConfirm('Delete this?')) { ... }
//   await showAlert('Saved.');

import { escapeHtml } from './utils.js';

const HOST_ID = 'overlay-host';

function ensureHost() {
  let host = document.getElementById(HOST_ID);
  if (host) return host;
  host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);
  return host;
}

function shell({ title, subtitle, bodyHtml, footerHtml, onKeydown }) {
  const host = ensureHost();
  host.innerHTML = `
    <div id="dlg-scrim" style="position:fixed;inset:0;background:rgba(16,18,28,.34);z-index:70;"></div>
    <div id="dlg-panel" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(480px,94vw);background:#fff;border-radius:14px;box-shadow:0 30px 90px rgba(16,18,28,.28);z-index:71;overflow:hidden;">
      <div style="padding:18px 22px 12px;border-bottom:1px solid rgba(20,22,28,.08);">
        <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#3468d6;text-transform:uppercase;">${escapeHtml(subtitle || 'Genus')}</div>
        <div style="font-size:14px;color:#16181e;margin-top:4px;line-height:1.45;font-weight:500;">${escapeHtml(title || '')}</div>
      </div>
      <div style="padding:14px 22px;">${bodyHtml || ''}</div>
      <div style="padding:12px 22px;border-top:1px solid rgba(20,22,28,.08);display:flex;justify-content:flex-end;gap:8px;">${footerHtml || ''}</div>
    </div>
  `;
  const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', keyHandler); };
  const keyHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onKeydown?.('escape', close); }
    else if (e.key === 'Enter' && !e.shiftKey && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault(); onKeydown?.('enter', close);
    }
  };
  document.addEventListener('keydown', keyHandler);
  document.getElementById('dlg-scrim')?.addEventListener('click', () => onKeydown?.('cancel', close));
  return { close };
}

export function showAlert(message, { subtitle = 'Notice', okLabel = 'OK', tone = 'default' } = {}) {
  return new Promise((resolve) => {
    const footer = `<button type="button" id="dlg-ok" style="padding:8px 18px;background:${tone === 'danger' ? '#c12525' : '#3468d6'};color:#fff;border:none;border-radius:8px;font:600 12.5px inherit;cursor:pointer;">${escapeHtml(okLabel)}</button>`;
    const { close } = shell({
      title: message, subtitle, footerHtml: footer,
      onKeydown: (k, close) => { close(); resolve(); },
    });
    setTimeout(() => document.getElementById('dlg-ok')?.focus(), 30);
    document.getElementById('dlg-ok').addEventListener('click', () => { close(); resolve(); });
  });
}

export function showConfirm(message, { subtitle = 'Confirm', okLabel = 'OK', cancelLabel = 'Cancel', tone = 'default' } = {}) {
  return new Promise((resolve) => {
    const footer = `
      <button type="button" id="dlg-cancel" style="padding:8px 14px;border:1px solid rgba(20,22,28,.14);background:#fff;color:#5b6270;border-radius:8px;font:600 12.5px inherit;cursor:pointer;">${escapeHtml(cancelLabel)}</button>
      <button type="button" id="dlg-ok" style="padding:8px 18px;background:${tone === 'danger' ? '#c12525' : '#3468d6'};color:#fff;border:none;border-radius:8px;font:600 12.5px inherit;cursor:pointer;">${escapeHtml(okLabel)}</button>
    `;
    const { close } = shell({
      title: message, subtitle, footerHtml: footer,
      onKeydown: (k, close) => {
        if (k === 'enter') { close(); resolve(true); }
        else { close(); resolve(false); }
      },
    });
    setTimeout(() => document.getElementById('dlg-ok')?.focus(), 30);
    document.getElementById('dlg-cancel').addEventListener('click', () => { close(); resolve(false); });
    document.getElementById('dlg-ok').addEventListener('click', () => { close(); resolve(true); });
  });
}

export function showPrompt(message, { subtitle = 'Input', defaultValue = '', placeholder = '', okLabel = 'OK', cancelLabel = 'Cancel', multiline = false, type = 'text' } = {}) {
  return new Promise((resolve) => {
    const inputHtml = multiline
      ? `<textarea id="dlg-input" rows="4" placeholder="${escapeHtml(placeholder)}" style="width:100%;padding:9px 12px;border:1px solid rgba(20,22,28,.14);border-radius:8px;font-family:inherit;font-size:13.5px;line-height:1.5;color:#16181e;box-sizing:border-box;resize:vertical;">${escapeHtml(defaultValue)}</textarea>`
      : `<input type="${escapeHtml(type)}" id="dlg-input" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" style="width:100%;padding:9px 12px;border:1px solid rgba(20,22,28,.14);border-radius:8px;font-family:inherit;font-size:13.5px;color:#16181e;box-sizing:border-box;">`;
    const footer = `
      <button type="button" id="dlg-cancel" style="padding:8px 14px;border:1px solid rgba(20,22,28,.14);background:#fff;color:#5b6270;border-radius:8px;font:600 12.5px inherit;cursor:pointer;">${escapeHtml(cancelLabel)}</button>
      <button type="button" id="dlg-ok" style="padding:8px 18px;background:#3468d6;color:#fff;border:none;border-radius:8px;font:600 12.5px inherit;cursor:pointer;">${escapeHtml(okLabel)}</button>
    `;
    const submit = () => {
      const val = document.getElementById('dlg-input')?.value ?? '';
      close();
      resolve(val);
    };
    const { close } = shell({
      title: message, subtitle, bodyHtml: inputHtml, footerHtml: footer,
      onKeydown: (k, close) => {
        if (k === 'enter') submit();
        else { close(); resolve(null); }
      },
    });
    setTimeout(() => {
      const el = document.getElementById('dlg-input');
      el?.focus();
      if (el && !multiline) el.select();
    }, 30);
    document.getElementById('dlg-cancel').addEventListener('click', () => { close(); resolve(null); });
    document.getElementById('dlg-ok').addEventListener('click', submit);
  });
}
