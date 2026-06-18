// Cloudflare Worker entry script for the Genus dashboard deploy.
//
// Cloudflare unified Pages + Workers in 2025. This repo deploys via the new
// Workers-with-assets flow (URL pattern: <name>.<account>.workers.dev).
// In that flow, static assets work out of the box but the `functions/`
// directory auto-detection from legacy Pages is gone — dynamic routes
// need an explicit Worker entry. This file is that entry.
//
// Routing:
//   /api/*  → handler module from functions/api/*.js
//   /*      → static asset (handled by env.ASSETS.fetch)

import * as healthModule from './functions/api/health.js';

// Map of /api/<name> → { GET?: handler, POST?: handler, ... }
// As we add Pages-Functions-style handlers, list them here.
const API_ROUTES = {
  '/api/health': healthModule,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = API_ROUTES[url.pathname];
    if (handler) {
      const methodFn = handler[`onRequest${request.method.charAt(0)}${request.method.slice(1).toLowerCase()}`];
      if (typeof methodFn === 'function') {
        return methodFn({ request, env, ctx, params: {} });
      }
      return new Response(JSON.stringify({ ok: false, message: `Method ${request.method} not allowed on ${url.pathname}` }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Fall through to static assets (Workers Assets binding handles index.html,
    // 404.html, SPA fallbacks, etc.)
    return env.ASSETS.fetch(request);
  },
};
