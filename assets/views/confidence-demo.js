// ConfidenceFrame v1 renderer — test surface (GEN-110).
//
// Three policy-mode panels (silent / warn / block) wired to a fixture set of
// wire-format claims. Demonstrates that the four affordances render without
// any module-specific code — only the shell's renderer + the wire payload.
//
// Also runs a small in-DOM self-check so a reviewer can confirm acceptance
// criteria in the browser without a separate test rig:
//   - compact form normalises to structured
//   - malformed → unknown
//   - silent/warn/block mode pick the right affordances
//   - no L1/L2/L3 vocabulary leaks into the rendered DOM
//
// Accessible at #confidence-demo.

import { escapeHtml } from '../utils.js';
import {
  normalizeConfidence,
  pickAffordance,
  renderClaim,
} from '../confidence.js';

const eur = (n) => '€' + Number(n).toLocaleString('en-US');
const num = (n) => String(n);

// Fixtures: wire-format payloads. No Finance-Module-specific knowledge here —
// these mimic what any Genus module would emit per CONFIDENCE_FRAME.md §7.
const FIXTURES = {
  rent: {
    label: 'Rent (monthly)',
    formatValue: eur,
    claim: { value: 1200, confidence: 'high' },
  },
  payroll: {
    label: 'Payroll (June)',
    formatValue: eur,
    claim: {
      value: 4750,
      confidence: {
        overall: 'medium',
        concerns: [
          {
            summary: 'June social-contributions row is provisional; awaiting final invoice from accountant.',
          },
        ],
      },
    },
  },
  receivables: {
    label: 'Receivables (Q2)',
    formatValue: eur,
    claim: {
      value: 8400,
      confidence: {
        overall: 'low',
        concerns: [
          {
            summary: 'May invoice from Rent vendor missing — expected by 7th of each month, today is 2026-06-24.',
            action: { kind: 'audit-data', label: 'Audit invoices', href: '#invoices' },
          },
        ],
      },
    },
  },
  customerCount: {
    label: 'Active customers',
    formatValue: num,
    claim: {
      value: 14,
      confidence: {
        overall: 'unknown',
        concerns: [
          {
            summary: "No CRM connector wired yet — agent has nothing to back a customer count against.",
            action: { kind: 'connect-source', label: 'Connect CRM', href: '#settings' },
          },
        ],
      },
    },
  },
  sendInvoiceCta: {
    label: 'Send invoice batch',
    formatValue: () => 'Send invoice batch',
    claim: {
      value: 'Send invoice batch',
      confidence: {
        overall: 'low',
        concerns: [
          {
            summary: 'Customer addresses uncategorised in 3 of 12 rows — agent unsure these are billable.',
            action: { kind: 'recategorize', label: 'Re-categorize', href: '#inputs' },
          },
        ],
      },
    },
  },
  malformed: {
    label: 'Malformed wire payload',
    formatValue: (v) => v,
    claim: { value: '???', confidence: 'banana' }, // exercised at the normaliser layer
  },
};

export function renderConfidenceDemo(_ctx) {
  const root = document.getElementById('route-confidence-demo');
  if (!root) return;

  root.innerHTML = `
    <p class="confidence-demo-intro">
      Test surface for the ConfidenceFrame v1 renderer. Each block below is a
      synthetic view bound to a different policy mode. The fixtures are raw
      wire-format payloads — the shell renderer is doing all the work; there is
      no module-specific UI code in this view.
      See <code>CONFIDENCE_FRAME.md</code> §5–§7.
    </p>

    ${renderSection({
      mode: 'silent',
      title: 'Silent mode (default for operator views)',
      sub: 'High claims render plain. Low / unknown claims surface a badge with hover.',
      rows: [
        { fixtureKey: 'rent' },
        { fixtureKey: 'payroll' },
        { fixtureKey: 'receivables' },
        { fixtureKey: 'customerCount' },
      ],
    })}

    ${renderSection({
      mode: 'warn',
      title: 'Warn mode',
      sub: 'Medium gets a badge; low / unknown gets a badge with an alert marker.',
      rows: [
        { fixtureKey: 'rent' },
        { fixtureKey: 'payroll' },
        { fixtureKey: 'receivables' },
      ],
    })}

    ${renderSection({
      mode: 'block',
      title: 'Block mode',
      sub: 'Low / unknown render as hidden (placeholder) or blocking (disabled action) per per-claim hint.',
      rows: [
        { fixtureKey: 'rent' },
        { fixtureKey: 'receivables', claimAffordance: 'hidden' },
        { fixtureKey: 'sendInvoiceCta', claimAffordance: 'blocking' },
      ],
    })}

    <div id="confidence-demo-tests" class="card"></div>
  `;

  runSelfTests(root);
}

function renderSection({ mode, title, sub, rows }) {
  const items = rows.map(({ fixtureKey, claimAffordance }) => {
    const f = FIXTURES[fixtureKey];
    return `<tr>
      <td class="confidence-demo-label">${escapeHtml(f.label)}</td>
      <td class="confidence-demo-claim">${renderClaim(f.claim, { mode, claimAffordance }, { formatValue: f.formatValue })}</td>
    </tr>`;
  }).join('');
  return `
    <div class="card confidence-demo-section" data-policy-mode="${mode}">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">${escapeHtml(title)}</span>
          <p class="card-sub">${escapeHtml(sub)}</p>
        </div>
        <span class="mono confidence-demo-mode">policy: ${mode}</span>
      </div>
      <table class="confidence-demo-table">
        <tbody>${items}</tbody>
      </table>
    </div>
  `;
}

function runSelfTests(root) {
  const results = [];
  const ok = (name) => results.push({ name, pass: true });
  const fail = (name, detail) => results.push({ name, pass: false, detail });

  // 1. Compact form normalises.
  const n1 = normalizeConfidence({ value: 1, confidence: 'high' });
  if (n1.overall === 'high' && Array.isArray(n1.concerns) && n1.concerns.length === 0) ok('compact form normalises');
  else fail('compact form normalises', JSON.stringify(n1));

  // 2. Structured form normalises preserving concerns.
  const n2 = normalizeConfidence(FIXTURES.receivables.claim);
  if (n2.overall === 'low' && n2.concerns.length === 1 && n2.concerns[0].action?.kind === 'audit-data') ok('structured form preserves concerns + valid action');
  else fail('structured form preserves concerns + valid action', JSON.stringify(n2));

  // 3. Malformed payload degrades to unknown.
  const n3 = normalizeConfidence(FIXTURES.malformed.claim);
  if (n3.overall === 'unknown') ok('malformed level → unknown');
  else fail('malformed level → unknown', JSON.stringify(n3));

  // 4. silent + high → no affordance.
  const a1 = pickAffordance({ overall: 'high', concerns: [] }, { mode: 'silent' });
  if (a1.kind === 'none') ok('silent + high → no affordance');
  else fail('silent + high → no affordance', JSON.stringify(a1));

  // 5. silent + low → badge.
  const a2 = pickAffordance({ overall: 'low', concerns: [] }, { mode: 'silent' });
  if (a2.kind === 'badge' && a2.tone === 'low') ok('silent + low → badge');
  else fail('silent + low → badge', JSON.stringify(a2));

  // 6. silent + unknown → badge.
  const a3 = pickAffordance({ overall: 'unknown', concerns: [] }, { mode: 'silent' });
  if (a3.kind === 'badge' && a3.tone === 'unknown') ok('silent + unknown → badge');
  else fail('silent + unknown → badge', JSON.stringify(a3));

  // 7. warn + medium → badge.
  const a4 = pickAffordance({ overall: 'medium', concerns: [] }, { mode: 'warn' });
  if (a4.kind === 'badge' && a4.tone === 'medium') ok('warn + medium → badge');
  else fail('warn + medium → badge', JSON.stringify(a4));

  // 8. warn + low → badge + alert.
  const a5 = pickAffordance({ overall: 'low', concerns: [] }, { mode: 'warn' });
  if (a5.kind === 'badge' && a5.alert) ok('warn + low → badge + alert');
  else fail('warn + low → badge + alert', JSON.stringify(a5));

  // 9. block + low + hint=hidden → hidden.
  const a6 = pickAffordance({ overall: 'low', concerns: [] }, { mode: 'block', claimAffordance: 'hidden' });
  if (a6.kind === 'hidden') ok('block + low + hint=hidden → hidden');
  else fail('block + low + hint=hidden → hidden', JSON.stringify(a6));

  // 10. block + low + hint=blocking → blocking.
  const a7 = pickAffordance({ overall: 'low', concerns: [] }, { mode: 'block', claimAffordance: 'blocking' });
  if (a7.kind === 'blocking') ok('block + low + hint=blocking → blocking');
  else fail('block + low + hint=blocking → blocking', JSON.stringify(a7));

  // 11. block + high → no affordance.
  const a8 = pickAffordance({ overall: 'high', concerns: [] }, { mode: 'block' });
  if (a8.kind === 'none') ok('block + high → no affordance');
  else fail('block + high → no affordance', JSON.stringify(a8));

  // 12. silent + high renders no affordance in the DOM (Rent row).
  const silentSection = root.querySelector('[data-policy-mode="silent"]');
  const rentRow = Array.from(silentSection?.querySelectorAll('tr') || []).find(
    (tr) => tr.querySelector('.confidence-demo-label')?.textContent?.includes('Rent'),
  );
  if (rentRow && !rentRow.querySelector('[data-confidence-affordance]')) ok('silent + high renders no affordance in the DOM');
  else fail('silent + high renders no affordance in the DOM', 'unexpected affordance on rent row');

  // 13. block + hidden hint renders a hidden placeholder.
  const blockSection = root.querySelector('[data-policy-mode="block"]');
  if (blockSection?.querySelector('[data-confidence-affordance="hidden"]')) ok('block + hidden hint renders a hidden placeholder');
  else fail('block + hidden hint renders a hidden placeholder', 'no hidden affordance in block section');

  // 14. block + blocking hint renders a disabled value.
  const blockingNode = blockSection?.querySelector('[data-confidence-affordance="blocking"]');
  if (blockingNode && blockingNode.querySelector('.claim-value--disabled')) ok('block + blocking hint renders a disabled value');
  else fail('block + blocking hint renders a disabled value', 'no blocking affordance with disabled value');

  // 15. No L1/L2/L3 layer vocabulary leaks anywhere in the rendered DOM.
  const html = root.innerHTML || '';
  const text = root.textContent || '';
  const haystack = html + ' ' + text;
  const FORBIDDEN = [
    /\bL1\b/,
    /\bL2\b/,
    /\bL3\b/,
    /mental[_-]model/i,
    /data[_-]grounding/i,
    /\bcoherence\b/i,
  ];
  const leaks = FORBIDDEN.filter((re) => re.test(haystack)).map((re) => String(re));
  if (leaks.length === 0) ok('no L1/L2/L3 vocabulary leaks in rendered DOM');
  else fail('no L1/L2/L3 vocabulary leaks in rendered DOM', leaks.join(', '));

  // Render results card.
  const passCount = results.filter((r) => r.pass).length;
  const allPass = passCount === results.length;
  const testEl = document.getElementById('confidence-demo-tests');
  if (!testEl) return;
  testEl.innerHTML = `
    <div class="card-header-row">
      <div class="card-header-left">
        <span class="card-title">Self-check</span>
        <p class="card-sub">Acceptance criteria run inline against the rendered DOM.</p>
      </div>
      <span class="mono confidence-demo-summary ${allPass ? 'confidence-demo-summary--pass' : 'confidence-demo-summary--fail'}">${passCount}/${results.length} ${allPass ? 'PASS' : 'mixed'}</span>
    </div>
    <ul class="confidence-demo-results">
      ${results
        .map(
          (r) => `<li class="${r.pass ? 'pass' : 'fail'}">
            <span class="confidence-demo-result-name">${escapeHtml(r.name)}</span>
            ${r.detail ? `<span class="confidence-demo-result-detail mono">${escapeHtml(r.detail)}</span>` : ''}
          </li>`,
        )
        .join('')}
    </ul>
  `;
}

export { FIXTURES as _testFixtures };
