/*
 * Demo banner controller — companion to demo-banner.html.
 *
 * Not auto-injected. The dashboard shell (or a subsequent phase) calls
 * mountDemoBanner(hostEl) after checking:
 *   1. current BU === 'synthetic'
 *   2. no other user BU exists in the registry
 *   3. sessionStorage.getItem('genus.demoBanner.dismissed') !== '1'
 *
 * The banner's "Create your own BU →" link re-enters the wizard at Screen 2
 * (per DESIGN.md — don't re-repeat the pitch). Since the wizard has no
 * screen-level routing, we send them to /wizard/?screen=name-bu and let
 * wizard.js check the query param.
 *
 * Dismissal is session-scoped: banner returns on next launch while the
 * condition still holds.
 */
(function () {
  'use strict';
  const STORAGE_KEY = 'genus.demoBanner.dismissed';

  async function loadTemplate() {
    const res = await fetch('/wizard/demo-banner.html', { cache: 'no-store' });
    if (!res.ok) throw new Error('demo-banner.html not reachable');
    return await res.text();
  }

  async function mountDemoBanner(hostEl) {
    if (!hostEl) throw new Error('mountDemoBanner requires a host element');
    if (sessionStorage.getItem(STORAGE_KEY) === '1') return null;

    const html = await loadTemplate();
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const el = wrap.firstElementChild;
    hostEl.prepend(el);

    el.querySelector('[data-action="demo-banner-create"]')?.addEventListener('click', () => {
      window.location.href = '/wizard/?screen=name-bu';
    });
    el.querySelector('[data-action="demo-banner-dismiss"]')?.addEventListener('click', () => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      el.remove();
    });
    return el;
  }

  // Expose as a global. The dashboard shell can call:
  //   window.Genus.mountDemoBanner(document.querySelector('.app-shell'))
  window.Genus = window.Genus || {};
  window.Genus.mountDemoBanner = mountDemoBanner;
})();
