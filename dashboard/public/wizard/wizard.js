/*
 * i56 first-run wizard — client state machine.
 *
 * Screens: welcome → name-bu → connectors → (redirect to dashboard).
 * All in one HTML doc; no client-side router, no server-side routing per screen.
 * Behavior contract lives in docs/products/i56-forkable-install/BRIEF.md +
 * design-output/DESIGN.md; short form is inline below.
 */

(function () {
  'use strict';

  // ---------- Connector catalog ---------------------------------------------
  //
  // Rendered on Screen 3. Adding a new connector = one entry here.
  // Mapping to module_id must match install-module.js MODULE_BINDING_TEMPLATES
  // where a follow-up binding matters; for github/notion/slack/gdrive/linear
  // the wizard POSTs to /api/module-init which currently ignores unknown
  // module_ids gracefully (no-op binding) so a wrong id won't crash setup.
  const CONNECTORS = [
    { id: 'github',      name: 'GitHub',       icon: 'GH', desc: 'Repos, issues and PRs for your dev agents',
      hint: 'Fine-grained Personal Access Token · Contents R/W + Pull Requests R/W · create one at github.com/settings/tokens' },
    { id: 'notion',      name: 'Notion',       icon: 'NO', desc: 'Docs and databases Genus can read and write',
      hint: 'Internal Integration secret (starts with `secret_` or `ntn_`) — create at notion.so/my-integrations, then share the databases you want Genus to see with the integration' },
    { id: 'slack',       name: 'Slack',        icon: 'SL', desc: 'Notifications and agent chat in your workspace',
      hint: 'Bot User OAuth Token (`xoxb-...`) from a Slack app you create at api.slack.com/apps — needs chat:write + channels:read scopes' },
    { id: 'gdrive',      name: 'Google Drive', icon: 'GD', desc: 'Spreadsheets and files your agents work from',
      hint: 'Service Account key JSON — generate one in Google Cloud Console, share the Drive folder with the service-account email, then paste the whole JSON blob here' },
    { id: 'linear',      name: 'Linear',       icon: 'LN', desc: 'Issues and cycles for planning sync',
      hint: 'Personal API key (`lin_api_...`) from Linear → Settings → API — no scopes to pick, key inherits your permissions' },
  ];

  // ---------- Wizard state ---------------------------------------------------
  //
  // window.__wizardConnectors is intentionally on window (per task spec) so
  // it's inspectable from devtools during operator debugging.
  const state = {
    currentScreen: 'welcome',
    slug: '',
    displayName: '',
    // Snapshot of the slug at first entry to connectors — used to detect a
    // slug change on re-entry from Back → Screen 2 → Continue, which triggers
    // the connector-reset toast (DESIGN.md edit-loop).
    slugAtConnectorsEntry: null,
  };
  window.__wizardConnectors = {};
  for (const c of CONNECTORS) window.__wizardConnectors[c.id] = null; // null = not decided, 'skipped', or { token }

  // ---------- Screen router --------------------------------------------------
  function showScreen(name) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach((s) => s.classList.toggle('on', s.dataset.screen === name));
    state.currentScreen = name;
    if (name === 'connectors') {
      // Detect rename since last entry.
      if (state.slugAtConnectorsEntry != null && state.slugAtConnectorsEntry !== state.slug) {
        // Renamed — wipe selections and inform the operator.
        for (const c of CONNECTORS) window.__wizardConnectors[c.id] = null;
        renderConnectors();
        toast('neutral', 'Connectors reset because you renamed the BU.');
      }
      state.slugAtConnectorsEntry = state.slug;
      updateConnectorsFoot();
    }
    // Move focus to the primary heading of the new screen for a11y.
    const active = document.querySelector('.screen.on h1');
    if (active) active.setAttribute('tabindex', '-1'), active.focus({ preventScroll: false });
  }

  // ---------- Toast ---------------------------------------------------------
  //
  // Bottom-center. Types: 'error' (red, has optional Retry action) or 'neutral'
  // (white). 4s auto-dismiss per DESIGN.md.
  let toastTimer = null;
  function toast(kind, message, retryFn) {
    // Remove any existing toast to prevent stack.
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }

    const el = document.createElement('div');
    el.className = 'toast ' + (kind === 'error' ? 'toast-error' : 'toast-neutral');
    const msg = document.createElement('span');
    msg.textContent = message;
    el.appendChild(msg);
    if (kind === 'error' && typeof retryFn === 'function') {
      const btn = document.createElement('button');
      btn.className = 'link-sm';
      btn.style.color = 'var(--red-fg)';
      btn.style.fontWeight = '700';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => {
        el.remove();
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        retryFn();
      });
      el.appendChild(btn);
    }
    document.body.appendChild(el);
    toastTimer = setTimeout(() => { el.remove(); toastTimer = null; }, 4000);
  }

  // ---------- Screen 1: welcome ---------------------------------------------
  function initWelcome() {
    // Render the Anthropic key banner if the server injected the flag.
    if (window.__ANTHROPIC_KEY_MISSING__ === true) {
      const banner = document.getElementById('anthropic-key-banner');
      if (banner) banner.style.display = 'flex';
    }
    document.querySelectorAll('[data-action="wizard-start"]').forEach((b) => {
      b.addEventListener('click', () => showScreen('name-bu'));
    });
    document.querySelectorAll('[data-action="wizard-skip-to-demo"]').forEach((b) => {
      b.addEventListener('click', () => {
        // Go through the server so it can set a `genus_explored` cookie —
        // otherwise the root `/` handler sees no user BU and redirects the
        // browser straight back to /wizard/. The endpoint responds with a
        // 302 to `/#bu=synthetic`.
        window.location.href = '/_wizard/skip-to-demo';
      });
    });
  }

  // ---------- Screen 2: name-bu ---------------------------------------------
  const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
  const RESERVED_SLUGS = new Set(['synthetic']);
  const slugFoot = () => document.getElementById('name-bu-foot');
  const slugInput = () => document.getElementById('slug-input');
  const displayInput = () => document.getElementById('display-name-input');
  const slugError = () => document.getElementById('slug-error');
  const continueBtn = () => document.getElementById('name-bu-continue');

  function normalizeSlug(raw) {
    // Live-lowercase + space→dash per DESIGN.md (prevention over correction).
    return String(raw || '')
      .toLowerCase()
      .replace(/\s+/g, '-');
  }

  function updateSlugFooter() {
    const slug = state.slug || '<short-name>';
    const el = slugFoot();
    if (el) el.textContent = `this creates bus/${slug}/ on your machine`;
  }

  function setSlugError(message) {
    const err = slugError();
    const input = slugInput();
    if (message) {
      err.textContent = message;
      err.style.display = 'block';
      input.classList.add('err-input');
    } else {
      err.style.display = 'none';
      err.textContent = '';
      input.classList.remove('err-input');
    }
  }

  function validateSlug(slug) {
    if (!slug) return 'Give your venture a short name.';
    if (RESERVED_SLUGS.has(slug)) return `'${slug}' is reserved for the built-in demo. Pick another name.`;
    if (!SLUG_RE.test(slug)) return 'Lowercase letters, numbers and dashes only — no spaces.';
    return null;
  }

  function initNameBu() {
    const input = slugInput();
    const disp = displayInput();
    let firstBlurDone = false;

    input.addEventListener('input', () => {
      const before = input.selectionStart;
      const raw = input.value;
      const norm = normalizeSlug(raw);
      if (raw !== norm) {
        // Preserve caret roughly; norm can only shorten (space→dash is 1:1)
        // so the offset stays valid.
        input.value = norm;
        if (typeof before === 'number') input.setSelectionRange(before, before);
      }
      state.slug = input.value;
      updateSlugFooter();
      // Live-clear an error once the user starts typing again (they saw it).
      if (firstBlurDone) {
        const err = validateSlug(state.slug);
        setSlugError(err);
      }
    });
    input.addEventListener('blur', () => {
      firstBlurDone = true;
      const err = validateSlug(state.slug);
      setSlugError(err);
    });
    disp.addEventListener('input', () => { state.displayName = disp.value; });

    document.querySelectorAll('[data-action="name-bu-back"]').forEach((b) => {
      b.addEventListener('click', () => showScreen('welcome'));
    });
    document.querySelectorAll('[data-action="name-bu-continue"]').forEach((b) => {
      b.addEventListener('click', submitCreateBu);
    });

    // Enter key on inputs = Continue.
    [input, disp].forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitCreateBu(); }
      });
    });
  }

  async function submitCreateBu() {
    const slug = state.slug;
    const err = validateSlug(slug);
    if (err) { setSlugError(err); slugInput().focus(); return; }
    setSlugError(null);

    const btn = continueBtn();
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Creating…';

    const displayName = state.displayName || slug.charAt(0).toUpperCase() + slug.slice(1);

    let res, body;
    try {
      res = await fetch('/api/create-bu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slug, display_name: displayName }),
      });
    } catch (netErr) {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
      toast('error', "Genus couldn't reach the server. Is the container still running?", submitCreateBu);
      return;
    }

    try { body = await res.json(); } catch { body = {}; }

    if (res.ok) {
      // Success → straight to connectors (no interstitial per DESIGN.md D2).
      state.slug = slug; // canonical
      showScreen('connectors');
      btn.disabled = false;
      btn.innerHTML = originalHTML;
      return;
    }

    // Handle 4xx / 5xx.
    btn.disabled = false;
    btn.innerHTML = originalHTML;

    // 409 = already exists (per server/api/create-bu.js).
    // 400 with a message about slug taken (defensive — schema might broaden).
    const msg = String(body.message || '');
    const takenIndicators = /already exists|taken/i;
    if (res.status === 409 || (res.status >= 400 && res.status < 500 && takenIndicators.test(msg))) {
      setSlugError(`That name's taken — bus/${slug}/ already exists on this machine.`);
      slugInput().focus();
      return;
    }
    if (res.status >= 400 && res.status < 500) {
      // Other client error — surface message inline.
      setSlugError(msg || 'That name was rejected by the server.');
      slugInput().focus();
      return;
    }
    // 5xx or unknown — toast with retry.
    toast('error', "Genus couldn't reach the server. Is the container still running?", submitCreateBu);
  }

  // ---------- Screen 3: connectors ------------------------------------------
  function updateConnectorsFoot() {
    const foot = document.getElementById('connectors-foot');
    if (foot) foot.textContent = `tokens are stored in bus/${state.slug || '<short-name>'}/connections.json — they never leave your machine`;
  }

  function renderConnectors() {
    const list = document.getElementById('connector-list');
    if (!list) return;
    list.innerHTML = '';
    for (const c of CONNECTORS) {
      const sel = window.__wizardConnectors[c.id];
      const row = document.createElement('div');
      row.className = 'conn';
      if (sel && typeof sel === 'object' && sel.token) row.classList.add('connected');
      if (sel === 'skipped') row.classList.add('skipped');
      row.dataset.connectorId = c.id;
      row.innerHTML = renderConnectorRow(c, sel);
      list.appendChild(row);
    }
    // Wire row-level buttons after DOM insert.
    list.querySelectorAll('[data-conn-action]').forEach((btn) => {
      btn.addEventListener('click', onConnectorRowClick);
    });
    list.querySelectorAll('[data-conn-save]').forEach((btn) => {
      btn.addEventListener('click', onConnectorSave);
    });
  }

  function renderConnectorRow(c, sel) {
    const head = `<div class="conn-head">
        <div class="conn-icon">${escapeHtml(c.icon)}</div>
        <div class="conn-body">
          <div class="conn-name">${escapeHtml(c.name)}</div>
          <div class="conn-desc">${escapeHtml(c.desc)}</div>
        </div>`;
    if (sel && typeof sel === 'object' && sel.token) {
      return head + `<div class="conn-actions">
          <span class="chip-connected"><span style="width:6px;height:6px;border-radius:99px;background:var(--green)"></span>Connected</span>
          <button class="link-sm" data-conn-action="remove" data-conn-id="${c.id}">Remove</button>
        </div></div>`;
    }
    if (sel === 'skipped') {
      return head + `<div class="conn-actions">
          <span class="chip-skipped">Skipped</span>
          <button class="link-sm" data-conn-action="undo-skip" data-conn-id="${c.id}">Undo</button>
        </div></div>`;
    }
    if (sel === 'entering-token') {
      const hintBlock = c.hint
        ? `<div class="conn-hint">${escapeHtml(c.hint)}</div>`
        : '';
      return head + `</div>
        <div class="conn-token">
          <input type="password" data-conn-token-input="${c.id}" placeholder="paste ${escapeHtml(c.name)} token" autocomplete="off">
          <button class="btn-sm" data-conn-save="${c.id}">Save</button>
          <button class="btn-sm-ghost" data-conn-action="cancel-token" data-conn-id="${c.id}">Cancel</button>
        </div>
        ${hintBlock}`;
    }
    // default: not-connected
    return head + `<div class="conn-actions">
        <button class="btn-connect" data-conn-action="connect" data-conn-id="${c.id}">Connect</button>
        <button class="chip-skip" data-conn-action="skip" data-conn-id="${c.id}">Skip</button>
      </div></div>`;
  }

  function onConnectorRowClick(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.connAction;
    const id = btn.dataset.connId;
    if (!id) return;
    switch (action) {
      case 'connect':
        window.__wizardConnectors[id] = 'entering-token';
        break;
      case 'skip':
        window.__wizardConnectors[id] = 'skipped';
        break;
      case 'undo-skip':
        window.__wizardConnectors[id] = null;
        break;
      case 'remove':
        window.__wizardConnectors[id] = null;
        break;
      case 'cancel-token':
        window.__wizardConnectors[id] = null;
        break;
    }
    renderConnectors();
  }

  function onConnectorSave(e) {
    const id = e.currentTarget.dataset.connSave;
    if (!id) return;
    const input = document.querySelector(`[data-conn-token-input="${id}"]`);
    const token = (input && input.value || '').trim();
    if (!token) {
      // Empty token = treat as cancel; don't lock the user in.
      window.__wizardConnectors[id] = null;
    } else {
      window.__wizardConnectors[id] = { token };
    }
    renderConnectors();
  }

  function initConnectors() {
    document.querySelectorAll('[data-action="connectors-back"]').forEach((b) => {
      b.addEventListener('click', () => showScreen('name-bu'));
    });
    document.querySelectorAll('[data-action="connectors-finish"]').forEach((b) => {
      b.addEventListener('click', finishSetup);
    });
    renderConnectors();
  }

  async function finishSetup() {
    const btn = document.getElementById('finish-setup');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Finishing…';

    // Collect connectors that have a real token (not null, not 'skipped', not 'entering-token').
    const toCommit = [];
    for (const c of CONNECTORS) {
      const sel = window.__wizardConnectors[c.id];
      if (sel && typeof sel === 'object' && sel.token) {
        toCommit.push({ id: c.id, token: sel.token });
      }
    }

    // Fire off /api/module-init for each. Sequential (not parallel) so if the
    // first one fails we can bail cleanly without half-committed state.
    for (const item of toCommit) {
      let res;
      try {
        res = await fetch('/api/module-init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bu: state.slug,
            module_id: item.id,
            action: 'install',
            // config carries the token per task spec. The current /api/module-init
            // ignores unknown fields; a future connector-storage endpoint (phase 5)
            // will honor it.
            config: { token: item.token },
          }),
        });
      } catch (netErr) {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
        toast('error', "Genus couldn't reach the server. Is the container still running?", finishSetup);
        return;
      }
      if (!res.ok) {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
        let body = {}; try { body = await res.json(); } catch {}
        toast('error', `Could not save the ${item.id} connector: ${body.message || res.statusText}`, finishSetup);
        return;
      }
    }

    // All committed (or none selected) → land on the dashboard for the new BU.
    // Hash form per task spec; the main dashboard code today also honors ?bu=,
    // but the wizard's contract with the operator is: hand off cleanly and let
    // the dashboard resolve the BU on its own (fallback to registry default is
    // fine if the hash-parse doesn't land).
    window.location.href = `/#bu=${encodeURIComponent(state.slug)}`;
  }

  // ---------- Utilities -----------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  // ---------- Boot ----------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  function boot() {
    initWelcome();
    initNameBu();
    initConnectors();
    updateSlugFooter();
  }
})();
