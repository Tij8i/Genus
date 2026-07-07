// Tiny hash router. Routes are #dashboard / #planning / #kpis / #inputs /
// #outputs / #settings. Default route used when hash is missing or invalid.

const VALID_ROUTES = [
  // Core (venture-wide)
  'dashboard', 'planning', 'kpis', 'inputs', 'outputs', 'learning', 'layers',
  'modules', 'agents', 'people', 'roster', 'agent-detail', 'archetype', 'settings',
  // i65 central task pool + i107 meetings + i47 A/B + i40 onboarding
  'tasks', 'meetings', 'ab-runs', 'onboarding',
  // Product module content items
  'products', 'vision', 'roadmap', 'backlog', 'releases', 'release-detail',
  'design-system', 'decisions', 'decision-detail', 'workshop',
  // Finance module content items
  'budget', 'costs', 'invoices',
  // Module top-level routes (Workflows / Tasks / Settings sub-nav)
  'finance-overview', 'finance-workflows', 'finance-tasks', 'finance-discipline',
  'finance-settings-rules', 'finance-settings-general', 'finance-settings-connections', 'finance-settings-permissions',
  'strategy-overview', 'strategy-workflows', 'strategy-tasks', 'strategy-discipline',
  'strategy-settings-rules', 'strategy-settings-general', 'strategy-settings-connections', 'strategy-settings-permissions',
  'product-overview', 'product-workflows', 'product-tasks', 'product-discipline',
  'product-settings-rules', 'product-settings-general', 'product-settings-connections', 'product-settings-permissions',
  'development-overview', 'development-workflows', 'development-tasks', 'development-discipline',
  'development-settings-rules', 'development-settings-general', 'development-settings-connections', 'development-settings-permissions',
  'dev-tests', 'dev-bugs', 'dev-deploys', 'dev-synthetic', 'dev-workflow-detail',
  'operations-overview', 'operations-workflows', 'operations-tasks',
  // v0.9 new modules (i48/i49/i50/i51/i52)
  'learning-overview', 'hr-overview', 'hr-catalog', 'hr-plan-optimizer',
  'sales-overview', 'marketing-overview',
  // Misc
  'workflow-detail', 'confidence-demo',
];
let currentRoute = null;
let onChangeCb = () => {};

function readRoute(defaultRoute) {
  // Strip leading # AND any ?query-params (so #planning?tab=backlog is still
  // recognized as the 'planning' route — pages can use query params for
  // sub-tab state without breaking the router). Also split on '/' so
  // path-style routes like #agent-detail/fin resolve to the 'agent-detail'
  // route and views pull the trailing segment from window.location.hash.
  const raw = (window.location.hash || '').replace(/^#/, '').split('?')[0].split('/')[0].toLowerCase();
  return VALID_ROUTES.includes(raw) ? raw : defaultRoute;
}

// Read the path segment after the route key. For #agent-detail/fin → 'fin'.
// Returns '' if no segment present.
export function getPathSegment() {
  const raw = (window.location.hash || '').replace(/^#/, '').split('?')[0];
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : '';
}

// Read a query param from the hash. For #roster?tab=people&x=1 → tab=people.
export function getQueryParam(key) {
  const raw = (window.location.hash || '').replace(/^#/, '');
  const q = raw.split('?')[1];
  if (!q) return null;
  return new URLSearchParams(q).get(key);
}

export function initRouter(defaultRoute = 'dashboard') {
  const handle = () => {
    const next = readRoute(defaultRoute);
    if (next !== currentRoute) {
      currentRoute = next;
      onChangeCb(currentRoute);
    }
  };
  window.addEventListener('hashchange', handle);
  // Fire initial render
  handle();
}

export function onRouteChange(cb) {
  onChangeCb = cb;
}

export function getCurrentRoute() {
  return currentRoute;
}

export function navigateTo(route) {
  if (!VALID_ROUTES.includes(route)) return;
  window.location.hash = `#${route}`;
}
