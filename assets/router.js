// Tiny hash router. Routes are #dashboard / #planning / #kpis / #inputs /
// #outputs / #settings. Default route used when hash is missing or invalid.

const VALID_ROUTES = ['dashboard', 'planning', 'kpis', 'inputs', 'outputs', 'learning', 'layers', 'modules', 'agents', 'people', 'roster', 'agent-detail', 'archetype', 'settings', 'budget', 'costs', 'invoices', 'products', 'vision', 'roadmap', 'backlog', 'releases', 'release-detail', 'design-system', 'decisions', 'decision-detail'];
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
