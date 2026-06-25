// Costs view — empty-state scaffold (GEN-99).
//
// Full implementation lands with the Finance module (GEN-89). Per the
// handoff spec, Costs surfaces:
//   - every recurring + one-off cost in one list
//   - flag for ad-hoc tools that should be on a recurring plan
//   - anomaly surfacing
//
// For v1 we ship the section + page shell with an honest empty state.

export function renderCosts(_ctx) {
  const root = document.getElementById('route-costs');
  if (!root) return;
  root.innerHTML = `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Cost ledger</span>
        </div>
      </div>
      <div class="empty-cactus">
        <div class="empty-cactus-icon">💸</div>
        <div class="empty-cactus-title">Cost ledger ships with the Finance module</div>
        <div class="empty-cactus-body">
          Once accounting + Stripe are wired (GEN-89), every recurring and one-off cost lands here.
          We'll flag ad-hoc tools that should be on a recurring plan and surface anomalies — the two
          asks the operator made explicit.
        </div>
      </div>
    </div>
  `;
}
