// Finance Module — Settings panel stub (GEN-127).
//
// Full settings UI ships under GEN-123 child L. This stub exists so the
// manifest's `views.settings.component_ref` resolves to a real file when the
// module loader (GEN-113) wires module settings into the dashboard's Settings
// route. The actual schema fields live in `../settings.schema.json`.

export function renderFinanceSettings(ctx) {
  const root = ctx && ctx.mountEl;
  if (!root) return;
  root.innerHTML = `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Finance settings</span>
          <p class="card-sub">Module settings UI ships under child L of GEN-123. The schema is locked in <code>settings.schema.json</code>.</p>
        </div>
      </div>
      <div class="empty-cactus">
        <div class="empty-cactus-icon">🧮</div>
        <div class="empty-cactus-title">Settings panel ships with child L</div>
        <div class="empty-cactus-body">
          Until then, the manifest's <code>settings.schema.json</code> documents the configurable fields (Moneybird connector ref, alert thresholds, digest cadence, recommendation toggles).
        </div>
      </div>
    </div>
  `;
}
