// Tiny hash router. Routes are #dashboard / #planning / #kpis / #inputs /
// #outputs / #settings. Default route used when hash is missing or invalid.

const VALID_ROUTES = ['dashboard', 'planning', 'kpis', 'inputs', 'outputs', 'settings'];
let currentRoute = null;
let onChangeCb = () => {};

function readRoute(defaultRoute) {
  const raw = (window.location.hash || '').replace(/^#/, '').toLowerCase();
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
