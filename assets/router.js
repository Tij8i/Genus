// Tiny hash router. Routes are #dashboard / #planning / #kpis / #inputs /
// #outputs / #settings. Default route used when hash is missing or invalid.

const VALID_ROUTES = ['dashboard', 'planning', 'kpis', 'inputs', 'outputs', 'learning', 'layers', 'modules', 'people', 'settings', 'budget', 'costs', 'invoices'];
let currentRoute = null;
let onChangeCb = () => {};

function readRoute(defaultRoute) {
  // Strip leading # AND any ?query-params (so #planning?tab=backlog is still
  // recognized as the 'planning' route — pages can use query params for
  // sub-tab state without breaking the router).
  const raw = (window.location.hash || '').replace(/^#/, '').split('?')[0].toLowerCase();
  return VALID_ROUTES.includes(raw) ? raw : defaultRoute;
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
