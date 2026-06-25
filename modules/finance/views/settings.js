// Finance Module — Settings page (GEN-136).
//
// Per SPEC_v1.md §9: every module surfaces a Settings page for connector
// config, agent binding, and threshold tuning. This view is mounted at
// #module-finance-settings (Module → Finance → Settings).
//
// Persistence:
//   - Reads dashboard/public/data/bus/<bu>/modules/finance/settings.json from
//     Orchestrator substrate via /api/substrate.
//   - Writes via POST /api/update-module-settings, which validates against
//     modules/finance/settings.schema.json and commits to Orchestrator.
//   - The next Finance heartbeat reads the new file (GEN-136 acceptance #2).
//
// Agent binding (v1): read-only display of module.json → agent.default_native.
// Full swap UI ships under GEN-105.

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrate } from '../../../assets/substrate-client.js';

const BU = 'medivara';

const ROUTE_ID = 'route-module-finance-settings';
const SETTINGS_REL = `dashboard/public/data/bus/${BU}/modules/finance/settings.json`;
const MANIFEST_URL = '/modules/finance/module.json';
const SCHEMA_URL = '/modules/finance/settings.schema.json';

const DEFAULTS = {
  moneybird: {
    connector_ref: '',
    endpoint_override: '',
    auth_token_ref: '',
    healthcheck_route: '/healthz',
  },
  alerts: {
    runway_days_warning: 90,
    runway_days_critical: 45,
    burn_variance_warning_pct: 15,
    draw_vs_runway_conflict_days: 30,
  },
  digest: {
    enabled: true,
    day_of_month: 1,
    include_categories: ['cash', 'revenue', 'costs', 'runway', 'recommendations'],
  },
  recommendations: {
    expense_recategorization_enabled: true,
    founder_draw_adjustment_enabled: true,
  },
};

const ALL_DIGEST_CATEGORIES = ['cash', 'revenue', 'costs', 'runway', 'recommendations'];

let pageState = {
  loading: true,
  saving: false,
  error: null,
  flash: null,
  manifest: null,
  schema: null,
  settings: null,
  expectedSha: null,
  fieldErrors: {},
};

export async function renderFinanceSettings(ctx) {
  const root = (ctx && ctx.mountEl) || document.getElementById(ROUTE_ID);
  if (!root) return;
  pageState.loading = true;
  pageState.error = null;
  paint(root);

  try {
    const [manifest, schema, settings] = await Promise.all([
      fetchJson(MANIFEST_URL),
      fetchJson(SCHEMA_URL),
      loadSettingsFromSubstrate(),
    ]);
    pageState.manifest = manifest;
    pageState.schema = schema;
    pageState.settings = mergeWithDefaults(settings.value);
    pageState.expectedSha = settings.sha;
  } catch (e) {
    pageState.error = e.message || String(e);
  } finally {
    pageState.loading = false;
    paint(root);
    wire(root);
  }
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.json();
}

async function loadSettingsFromSubstrate() {
  try {
    const result = await fetchSubstrate(SETTINGS_REL);
    return { value: JSON.parse(result.content), sha: result.sha || null };
  } catch (e) {
    if (/HTTP 404/.test(e.message || '')) return { value: null, sha: null };
    console.warn('[finance settings] substrate read failed, using defaults:', e.message || e);
    return { value: null, sha: null };
  }
}

function mergeWithDefaults(stored) {
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  if (!stored || typeof stored !== 'object') return out;
  for (const k of Object.keys(out)) {
    if (stored[k] && typeof stored[k] === 'object' && !Array.isArray(stored[k])) {
      out[k] = { ...out[k], ...stored[k] };
    } else if (Array.isArray(stored[k])) {
      out[k] = [...stored[k]];
    }
  }
  if (Array.isArray(stored.digest?.include_categories)) {
    out.digest.include_categories = [...stored.digest.include_categories];
  }
  return out;
}

function paint(root) {
  if (pageState.loading) {
    root.innerHTML = `<div class="card"><div class="card-body">Loading Finance settings…</div></div>`;
    return;
  }

  if (pageState.error) {
    root.innerHTML = `
      <div class="card">
        <div class="card-body">
          <strong>Could not load Finance settings.</strong>
          <p class="finance-settings-err">${escapeHtml(pageState.error)}</p>
          <p>The substrate Pages Function may be offline, or the dashboard repo can't reach Orchestrator. Try reloading.</p>
        </div>
      </div>`;
    return;
  }

  const s = pageState.settings;
  const m = pageState.manifest || {};
  const agent = m.agent?.default_native || {};
  const swappable = !!m.agent?.binding_policy?.swappable;
  const flash = pageState.flash;
  const errs = pageState.fieldErrors || {};

  root.innerHTML = `
    <div class="finance-settings-shell">
      <header class="finance-settings-header">
        <div class="finance-settings-crumb mono">Modules → Finance → Settings · <code>${escapeHtml(BU)}</code></div>
      </header>

      ${flash ? `<div class="finance-settings-flash finance-settings-flash-${escapeHtml(flash.kind)}">${escapeHtml(flash.message)}</div>` : ''}

      <form id="finance-settings-form" class="finance-settings-form" novalidate>

        <!-- Agent binding (v1: read-only) -->
        <section class="finance-settings-section">
          <h2>Agent binding</h2>
          <p class="finance-settings-sub">The bound agent runs every Finance heartbeat. v1 surfaces the default binding only; the swap UI ships under <a href="https://github.com/Tij8i/Orchestrator/issues" target="_blank" rel="noopener">GEN-105</a>.</p>
          <div class="finance-settings-rows">
            ${row('Default identity', agent.identity_ref || '—', 'mono')}
            ${row('Playbook', agent.playbook_ref || '—', 'mono')}
            ${row('Memory schema', agent.memory_schema_ref || '—', 'mono')}
            ${row('KPI set', agent.kpi_set_ref || '—', 'mono')}
            ${row('Swappable', swappable ? 'yes (UI in GEN-105)' : 'no')}
            ${row('Required capability', m.agent?.binding_policy?.required_capability_tag || '—', 'mono')}
          </div>
        </section>

        <!-- Moneybird connector -->
        <section class="finance-settings-section">
          <h2>Moneybird connector</h2>
          <p class="finance-settings-sub">References a wired connector. Credentials live in <a href="#settings?tab=wiring">Settings → Wiring</a> (GEN-104); this page only points at the connector by id.</p>
          <div class="finance-settings-fields">
            ${textField('moneybird.connector_ref', 'Connector reference', s.moneybird.connector_ref, 'connectors/moneybird/medivara', errs)}
            ${textField('moneybird.endpoint_override', 'Endpoint override', s.moneybird.endpoint_override, 'https://mcp.example/moneybird (optional)', errs)}
            ${textField('moneybird.auth_token_ref', 'Auth token override', s.moneybird.auth_token_ref, 'secrets/moneybird/medivara (optional)', errs)}
            ${textField('moneybird.healthcheck_route', 'Healthcheck route', s.moneybird.healthcheck_route, '/healthz', errs)}
          </div>
        </section>

        <!-- Alert thresholds -->
        <section class="finance-settings-section">
          <h2>Alert thresholds</h2>
          <p class="finance-settings-sub">Drives <code>FIN-RUNWAY-ALERT</code> + <code>FIN-DRAW-CONFLICT-ALERT</code>.</p>
          <div class="finance-settings-fields">
            ${numField('alerts.runway_days_warning', 'Runway warning (days)', s.alerts.runway_days_warning, { min: 1, step: 1 }, 'Yellow when runway < this many days.', errs)}
            ${numField('alerts.runway_days_critical', 'Runway critical (days)', s.alerts.runway_days_critical, { min: 1, step: 1 }, 'Red when runway < this many days.', errs)}
            ${numField('alerts.burn_variance_warning_pct', 'Burn variance warning (%)', s.alerts.burn_variance_warning_pct, { min: 0, max: 200, step: 0.5 }, 'Warn when monthly burn deviates from plan by this %.', errs)}
            ${numField('alerts.draw_vs_runway_conflict_days', 'Founder-draw conflict (days)', s.alerts.draw_vs_runway_conflict_days, { min: 1, step: 1 }, 'Trigger conflict alert when a draw shortens runway by ≥ this many days.', errs)}
          </div>
        </section>

        <!-- Monthly digest -->
        <section class="finance-settings-section">
          <h2>Monthly digest</h2>
          <p class="finance-settings-sub">Settings for the <code>FIN-MONTHLY-DIGEST</code> recipe.</p>
          <div class="finance-settings-fields">
            ${boolField('digest.enabled', 'Send monthly digest', s.digest.enabled)}
            ${numField('digest.day_of_month', 'Day of month', s.digest.day_of_month, { min: 1, max: 28, step: 1 }, 'Day the digest fires (1–28).', errs)}
            ${categoriesField('digest.include_categories', 'Sections included', s.digest.include_categories)}
          </div>
        </section>

        <!-- Recommendations -->
        <section class="finance-settings-section">
          <h2>Recommendations</h2>
          <p class="finance-settings-sub">Per-category enable/disable within the v1 allowed action set (per <code>module.json → actions.allowed</code>).</p>
          <div class="finance-settings-fields">
            ${boolField('recommendations.expense_recategorization_enabled', 'Expense recategorization suggestions', s.recommendations.expense_recategorization_enabled)}
            ${boolField('recommendations.founder_draw_adjustment_enabled', 'Founder-draw adjustment suggestions', s.recommendations.founder_draw_adjustment_enabled)}
          </div>
        </section>

        <div class="finance-settings-actions">
          <button type="submit" class="finance-settings-save" data-write-action ${pageState.saving ? 'disabled' : ''}>
            ${pageState.saving ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" class="finance-settings-reset" id="finance-settings-reset" ${pageState.saving ? 'disabled' : ''}>Reset to defaults</button>
          <span class="finance-settings-foot mono">Writes <code>${escapeHtml(SETTINGS_REL)}</code> on Orchestrator. Takes effect on the next Finance heartbeat.</span>
        </div>
      </form>
    </div>
  `;
}

function row(label, value, kind) {
  const valueHtml = kind === 'mono'
    ? `<code class="finance-settings-mono">${escapeHtml(value)}</code>`
    : `<span>${escapeHtml(value)}</span>`;
  return `
    <div class="finance-settings-row">
      <div class="finance-settings-row-label">${escapeHtml(label)}</div>
      <div class="finance-settings-row-value">${valueHtml}</div>
    </div>`;
}

function fieldError(errors, name) {
  return errors[name] ? `<div class="finance-settings-field-err">${escapeHtml(errors[name])}</div>` : '';
}

function textField(name, label, value, placeholder, errors) {
  return `
    <label class="finance-settings-field">
      <span class="finance-settings-field-label">${escapeHtml(label)}</span>
      <input type="text" name="${escapeHtml(name)}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}" class="finance-settings-input ${errors[name] ? 'finance-settings-input-err' : ''}">
      ${fieldError(errors, name)}
    </label>`;
}

function numField(name, label, value, attrs, help, errors) {
  const attrStr = Object.entries(attrs || {}).map(([k, v]) => `${k}="${escapeHtml(String(v))}"`).join(' ');
  return `
    <label class="finance-settings-field">
      <span class="finance-settings-field-label">${escapeHtml(label)}</span>
      <input type="number" name="${escapeHtml(name)}" value="${escapeHtml(String(value ?? ''))}" ${attrStr} class="finance-settings-input ${errors[name] ? 'finance-settings-input-err' : ''}">
      ${help ? `<span class="finance-settings-field-help">${escapeHtml(help)}</span>` : ''}
      ${fieldError(errors, name)}
    </label>`;
}

function boolField(name, label, value) {
  return `
    <label class="finance-settings-field finance-settings-field-bool">
      <input type="checkbox" name="${escapeHtml(name)}" ${value ? 'checked' : ''}>
      <span class="finance-settings-field-label">${escapeHtml(label)}</span>
    </label>`;
}

function categoriesField(name, label, selected) {
  const sel = new Set(selected || []);
  return `
    <div class="finance-settings-field">
      <span class="finance-settings-field-label">${escapeHtml(label)}</span>
      <div class="finance-settings-checks">
        ${ALL_DIGEST_CATEGORIES.map(cat => `
          <label class="finance-settings-chip">
            <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(cat)}" ${sel.has(cat) ? 'checked' : ''}>
            <span>${escapeHtml(cat)}</span>
          </label>`).join('')}
      </div>
    </div>`;
}

function wire(root) {
  const form = root.querySelector('#finance-settings-form');
  if (!form) return;

  const reset = root.querySelector('#finance-settings-reset');
  if (reset) {
    reset.addEventListener('click', (e) => {
      e.preventDefault();
      if (!window.confirm('Reset all Finance settings to defaults? This does not save until you click "Save settings".')) return;
      pageState.settings = JSON.parse(JSON.stringify(DEFAULTS));
      pageState.fieldErrors = {};
      paint(root);
      wire(root);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pageState.saving) return;

    const next = readFormValues(form);
    const errs = clientValidate(next);
    if (Object.keys(errs).length) {
      pageState.fieldErrors = errs;
      pageState.flash = { kind: 'err', message: 'Fix the highlighted fields and try again.' };
      paint(root);
      wire(root);
      return;
    }

    pageState.saving = true;
    pageState.fieldErrors = {};
    pageState.flash = null;
    paint(root);
    wire(root);

    try {
      const r = await fetch('/api/update-module-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bu: BU,
          module: 'finance',
          settings: next,
          expectedSha: pageState.expectedSha,
          rationale: 'Saved via Module → Finance → Settings',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        const msg = j.errors?.join('; ') || j.message || `HTTP ${r.status}`;
        throw new Error(msg);
      }
      pageState.settings = next;
      pageState.expectedSha = j.new_sha || pageState.expectedSha;
      pageState.flash = { kind: 'ok', message: 'Saved. Takes effect on the next Finance heartbeat.' };
    } catch (err) {
      pageState.flash = { kind: 'err', message: `Save failed: ${err.message || err}` };
    } finally {
      pageState.saving = false;
      paint(root);
      wire(root);
    }
  });
}

function readFormValues(form) {
  const data = JSON.parse(JSON.stringify(pageState.settings));
  for (const el of form.querySelectorAll('input[name]')) {
    const name = el.name;
    if (name === 'digest.include_categories') continue;
    const [section, key] = name.split('.');
    if (!data[section]) data[section] = {};
    if (el.type === 'checkbox') {
      data[section][key] = !!el.checked;
    } else if (el.type === 'number') {
      const raw = el.value.trim();
      if (raw === '') delete data[section][key];
      else data[section][key] = Number(raw);
    } else {
      const raw = el.value.trim();
      if (raw === '') delete data[section][key];
      else data[section][key] = raw;
    }
  }
  const cats = Array.from(form.querySelectorAll('input[name="digest.include_categories"]:checked')).map(c => c.value);
  if (!data.digest) data.digest = {};
  data.digest.include_categories = cats;
  return data;
}

function clientValidate(s) {
  const errs = {};
  const ref = s.moneybird?.connector_ref || '';
  if (!ref) errs['moneybird.connector_ref'] = 'Required.';
  else if (!/^connectors\/[a-z0-9-]+\/[a-z0-9-]+$/.test(ref)) {
    errs['moneybird.connector_ref'] = 'Expected connectors/<provider>/<install>.';
  }
  const tokRef = s.moneybird?.auth_token_ref;
  if (tokRef && !/^secrets\/[a-z0-9/_-]+$/.test(tokRef)) {
    errs['moneybird.auth_token_ref'] = 'Expected secrets/<path>.';
  }
  const hc = s.moneybird?.healthcheck_route;
  if (hc && !/^\/[a-zA-Z0-9/_.-]*$/.test(hc)) {
    errs['moneybird.healthcheck_route'] = 'Must start with /.';
  }
  const endpoint = s.moneybird?.endpoint_override;
  if (endpoint && !/^https?:\/\//.test(endpoint)) {
    errs['moneybird.endpoint_override'] = 'Must be an http(s) URL.';
  }
  for (const [key, opts] of [
    ['alerts.runway_days_warning', { min: 1 }],
    ['alerts.runway_days_critical', { min: 1 }],
    ['alerts.burn_variance_warning_pct', { min: 0, max: 200 }],
    ['alerts.draw_vs_runway_conflict_days', { min: 1 }],
    ['digest.day_of_month', { min: 1, max: 28 }],
  ]) {
    const [sec, k] = key.split('.');
    const v = s[sec]?.[k];
    if (v == null || Number.isNaN(v)) { errs[key] = 'Required.'; continue; }
    if (opts.min != null && v < opts.min) errs[key] = `Must be ≥ ${opts.min}.`;
    if (opts.max != null && v > opts.max) errs[key] = `Must be ≤ ${opts.max}.`;
  }
  return errs;
}

// Legacy export kept for back-compat — the stub from GEN-127 used this name.
export const renderSettings = renderFinanceSettings;
