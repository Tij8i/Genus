// Invoices view — empty-state scaffold (GEN-99).
//
// Full implementation lands with the Finance module (GEN-89). Per the
// handoff spec, Invoices surfaces:
//   - to issue / issued / paid
//   - flag for invoices that still need to be issued
//
// For v1 we ship the section + page shell with an honest empty state.

export function renderInvoices(_ctx) {
  const root = document.getElementById('route-invoices');
  if (!root) return;
  root.innerHTML = `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Invoices</span>
        </div>
      </div>
      <div class="empty-cactus">
        <div class="empty-cactus-icon">🧾</div>
        <div class="empty-cactus-title">Invoice tracking ships with the Finance module</div>
        <div class="empty-cactus-body">
          Once Moneybird (or equivalent) is wired (GEN-89), invoices to issue, issued, and paid land here.
          The "still needs to be issued" flag is first-class — that's the one operator-explicit thing this
          view exists to surface.
        </div>
      </div>
    </div>
  `;
}
