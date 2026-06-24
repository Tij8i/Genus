// ConfidenceFrame v1 renderer — regression check (GEN-110).
// Runs the renderer's pure functions (normalize, pickAffordance, renderClaim)
// against the spec's conformance rules. No DOM, no test runner.
//
//   node tests/confidence.spec.mjs   # exit 0 on success, 1 on failure
//
// In-browser DOM assertions live in assets/views/confidence-demo.js and run
// inline on the #confidence-demo route.

import { normalizeConfidence, pickAffordance, renderClaim } from '../assets/confidence.js';

let passed = 0;
let failed = 0;
const log = (name, ok, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('normalizeConfidence');
log('compact "high" → {overall:"high", concerns:[]}',
  eq(normalizeConfidence({ value: 1, confidence: 'high' }), { overall: 'high', concerns: [] }));
log('compact "low" → low',
  normalizeConfidence({ value: 1, confidence: 'low' }).overall === 'low');
log('compact "unknown" → unknown',
  normalizeConfidence({ value: 1, confidence: 'unknown' }).overall === 'unknown');
log('compact "banana" → unknown',
  normalizeConfidence({ value: 1, confidence: 'banana' }).overall === 'unknown');
log('missing confidence field → unknown',
  normalizeConfidence({ value: 1 }).overall === 'unknown');
log('null claim → unknown',
  normalizeConfidence(null).overall === 'unknown');
log('structured preserves concerns + valid action',
  (() => {
    const n = normalizeConfidence({
      value: 1,
      confidence: { overall: 'low', concerns: [{ summary: 'x', action: { kind: 'audit-data', label: 'A', href: '/x' } }] },
    });
    return n.overall === 'low' && n.concerns.length === 1 && n.concerns[0].action?.kind === 'audit-data';
  })());
log('structured invalid action → null action',
  (() => {
    const n = normalizeConfidence({
      value: 1,
      confidence: { overall: 'low', concerns: [{ summary: 'x', action: { kind: 'banana', label: 'A' } }] },
    });
    return n.concerns[0].action === null;
  })());
log('structured invalid overall → unknown',
  normalizeConfidence({ value: 1, confidence: { overall: 'banana' } }).overall === 'unknown');

console.log('\npickAffordance');
log('silent + high → none',
  pickAffordance({ overall: 'high', concerns: [] }, { mode: 'silent' }).kind === 'none');
log('silent + medium → none',
  pickAffordance({ overall: 'medium', concerns: [] }, { mode: 'silent' }).kind === 'none');
log('silent + low → badge',
  pickAffordance({ overall: 'low', concerns: [] }, { mode: 'silent' }).kind === 'badge');
log('silent + unknown → badge',
  pickAffordance({ overall: 'unknown', concerns: [] }, { mode: 'silent' }).kind === 'badge');
log('warn + high → none',
  pickAffordance({ overall: 'high', concerns: [] }, { mode: 'warn' }).kind === 'none');
log('warn + medium → badge',
  pickAffordance({ overall: 'medium', concerns: [] }, { mode: 'warn' }).kind === 'badge');
log('warn + low → badge + alert',
  (() => {
    const a = pickAffordance({ overall: 'low', concerns: [] }, { mode: 'warn' });
    return a.kind === 'badge' && a.alert === true;
  })());
log('block + high → none',
  pickAffordance({ overall: 'high', concerns: [] }, { mode: 'block' }).kind === 'none');
log('block + low + hint=hidden → hidden',
  pickAffordance({ overall: 'low', concerns: [] }, { mode: 'block', claimAffordance: 'hidden' }).kind === 'hidden');
log('block + low + hint=blocking → blocking',
  pickAffordance({ overall: 'low', concerns: [] }, { mode: 'block', claimAffordance: 'blocking' }).kind === 'blocking');
log('block + low default → hidden (safe-side fallback)',
  pickAffordance({ overall: 'low', concerns: [] }, { mode: 'block' }).kind === 'hidden');
log('unknown mode falls back to silent semantics (low → badge)',
  pickAffordance({ overall: 'low', concerns: [] }, { mode: 'wat' }).kind === 'badge');

console.log('\nrenderClaim — leak audit on rendered HTML');
const surfaces = [
  { mode: 'silent' },
  { mode: 'warn' },
  { mode: 'block', claimAffordance: 'hidden' },
  { mode: 'block', claimAffordance: 'blocking' },
];
const claims = [
  { value: 1200, confidence: 'high' },
  {
    value: 8400,
    confidence: {
      overall: 'low',
      concerns: [{ summary: 'May invoice missing.', action: { kind: 'audit-data', label: 'Audit invoices', href: '#invoices' } }],
    },
  },
  {
    value: 14,
    confidence: {
      overall: 'unknown',
      concerns: [{ summary: 'No CRM connector wired yet.', action: { kind: 'connect-source', label: 'Connect', href: '#settings' } }],
    },
  },
];
let allHtml = '';
for (const s of surfaces) for (const c of claims) allHtml += renderClaim(c, s) + '\n';

const FORBIDDEN = [/\bL1\b/, /\bL2\b/, /\bL3\b/, /mental[_-]model/i, /data[_-]grounding/i, /\bcoherence\b/i];
const leaks = FORBIDDEN.filter((re) => re.test(allHtml)).map((re) => String(re));
log(`no L1/L2/L3 vocabulary in any rendered HTML across ${surfaces.length}×${claims.length} variations`, leaks.length === 0, leaks.join(', '));

// XSS smoke test — value is escaped.
const xssHtml = renderClaim({ value: '<script>alert(1)</script>', confidence: 'high' }, { mode: 'silent' });
log('value is HTML-escaped (no raw <script>)', !/<script>/.test(xssHtml));

// Hidden affordance: no value text leaks.
const hiddenHtml = renderClaim({ value: 8400, confidence: 'low' }, { mode: 'block', claimAffordance: 'hidden' });
log('block+hidden does not surface the underlying value', !hiddenHtml.includes('8400'));

// Blocking affordance: value visible but marked disabled.
const blockingHtml = renderClaim({ value: 'Send batch', confidence: 'low' }, { mode: 'block', claimAffordance: 'blocking' });
log('block+blocking renders disabled value', /claim-value--disabled/.test(blockingHtml) && blockingHtml.includes('Send batch'));

// Action kind is preserved.
log('action kind survives normalisation into rendered button',
  /data-action-kind="audit-data"/.test(renderClaim(claims[1], { mode: 'silent' })));

// Layer-vocab in incoming summary is stripped.
const leakyHtml = renderClaim(
  { value: 1, confidence: { overall: 'low', concerns: [{ summary: 'L2 said data_grounding is bad and coherence too' }] } },
  { mode: 'silent' },
);
log('leaky summary tokens are stripped before render',
  !/\bL2\b/.test(leakyHtml) && !/data_grounding/i.test(leakyHtml) && !/coherence/i.test(leakyHtml));

console.log(`\n${passed}/${passed + failed} passed${failed > 0 ? ', ' + failed + ' failed' : ''}`);
process.exit(failed === 0 ? 0 : 1);
