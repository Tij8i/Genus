// GET /api/coverage?bu=<bu>
//
// Returns the computed area × layer matrix for the Business Coverage View.
// Per the design-handoff spec: each area lists its module(s), agent(s), human(s),
// and connected tools; coverage state is derived from layers 2–4 (tools do NOT
// affect state).
//
// Owner / admin / member / observer — all read-only. BU-scoped: non-owners
// must have the BU in their ventures list (requireAdmin enforces the gate
// + the BU param check).

import { getFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';

const REGISTRY_PATH = 'dashboard/public/data/bus/_registry.json';
const ROLES_PATH = 'dashboard/public/data/system/roles.json';
const BINDINGS_PATH = 'dashboard/public/data/system/agent_bindings.json';
const RUNTIMES_PATH = 'dashboard/public/data/system/runtimes.json';

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  const url = new URL(request.url);
  const bu = (url.searchParams.get('bu') || '').toString().trim().toLowerCase();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu query param required' });

  // Reuse requireAdmin so role + BU-scoping gates apply uniformly. Note: this
  // also accepts member/observer for reads (we relaxed the role check below
  // since coverage is read-only). Defense in depth: never expose users from
  // other BUs.
  const gate = await requireAdmin(request, env, { bu });
  // requireAdmin returns a Response on failure; for reads we tolerate
  // member/observer (they're allowed read access to their ventures). Allow
  // members + observers through by re-checking ventures directly.
  let viewer;
  if (gate instanceof Response) {
    // Could be a 403 'insufficient role' for member/observer — fall back to
    // identity + manual ventures check.
    const { getViewerIdentity } = await import('./_identity.js');
    viewer = await getViewerIdentity(request, env);
    if (!viewer || viewer.role === 'unauthenticated' || viewer.role === 'unknown') {
      return jsonResponse(403, { ok: false, message: 'Authentication required' });
    }
    const allowed = viewer.role === 'owner'
      || (Array.isArray(viewer.ventures) && (viewer.ventures.includes('*') || viewer.ventures.includes(bu)));
    if (!allowed) return jsonResponse(403, { ok: false, message: `Viewer not authorized for BU '${bu}'` });
  } else {
    viewer = gate;
  }

  // Load substrate
  const reads = await Promise.all([
    safeRead(env.GITHUB_PAT, `dashboard/public/data/bus/${bu}/business_areas.json`),
    safeRead(env.GITHUB_PAT, REGISTRY_PATH),
    safeRead(env.GITHUB_PAT, BINDINGS_PATH),
    safeRead(env.GITHUB_PAT, ROLES_PATH),
    safeRead(env.GITHUB_PAT, RUNTIMES_PATH),
  ]);
  const [businessAreas, registry, bindingsData, rolesData, runtimesData] = reads;

  if (!businessAreas || !Array.isArray(businessAreas.areas)) {
    return jsonResponse(200, { ok: true, bu, empty: true, areas: [], summary: emptySummary() });
  }

  const allBindings = (bindingsData?.bindings || []).filter(b => b.bu === bu);
  const allUsers = rolesData?.users || [];
  const allRuntimes = runtimesData?.runtimes || [];
  const availableModules = registry?.available_modules || [];
  const buEntry = (registry?.business_units || []).find(b => b.id === bu);
  const installedModuleIds = new Set(buEntry?.modules_installed || []);

  // Build module → covers_areas lookup. v1 doesn't yet have covers_areas in
  // available_modules; we use a sensible default mapping (module id matches
  // area id, plus 'strategy' is cross-cutting and may cover any area it claims).
  const moduleCoverage = computeModuleCoverage(availableModules);

  const areas = businessAreas.areas.map(area => {
    // Modules covering this area
    const modules = availableModules
      .filter(m => installedModuleIds.has(m.id))
      .filter(m => moduleCoverage[m.id]?.includes(area.id))
      .map(m => ({
        id: m.id,
        display_name: m.display_name,
        version: m.version,
        icon: m.icon,
        color: m.color,
      }));

    // Agents covering this area
    const agents = allBindings
      .filter(b => Array.isArray(b.covers_areas)
        ? b.covers_areas.includes(area.id)
        : moduleCoverage[b.module_id]?.includes(area.id))
      .map(b => {
        const runtime = allRuntimes.find(r => r.id === b.runtime_id);
        return {
          agent_id: b.agent_id,
          module_id: b.module_id,
          archetype: 'Stewart',
          runtime_id: b.runtime_id,
          runtime_display_name: runtime?.display_name || b.runtime_id,
          runtime_kind: runtime?.kind || 'unknown',
          hitl_owner_email: b.hitl_owner_email,
          lead: b.lead === true || b.lead === undefined,
        };
      });

    // Humans (HITL owners) for this area — from roles.json responsible_for_areas
    // (new field) OR by inference: anyone listed as hitl_owner on an agent in
    // this area is "the human for the area" too.
    const explicitHumans = allUsers.filter(u =>
      Array.isArray(u.responsible_for_areas) && u.responsible_for_areas.includes(area.id)
      && (Array.isArray(u.ventures) && (u.ventures.includes('*') || u.ventures.includes(bu)))
    );
    const inferredHumans = agents
      .map(a => a.hitl_owner_email)
      .filter(Boolean)
      .filter((e, i, arr) => arr.indexOf(e) === i)
      .filter(e => !explicitHumans.some(u => (u.email || '').toLowerCase() === e.toLowerCase()))
      .map(e => allUsers.find(u => (u.email || '').toLowerCase() === e.toLowerCase()))
      .filter(Boolean);
    const humans = [...explicitHumans, ...inferredHumans].map(u => ({
      email: u.email,
      display_name: u.display_name || u.email,
      role: u.role,
      title: u.title || '',
      explicit: explicitHumans.includes(u),
    }));

    // Coverage state (layers 2-4 only)
    const hasModule = modules.length > 0;
    const hasAgent = agents.length > 0;
    const hasHuman = humans.length > 0;
    let state;
    if (agents.length >= 2 && !agents.some(a => a.lead === true && agents.filter(x => x.lead === true).length === 1)) {
      // Multiple agents with no clear single lead → overlap
      state = 'overlap';
    } else if (hasModule && hasAgent && hasHuman) {
      state = 'fully';
    } else if (hasModule || hasAgent || hasHuman) {
      state = 'partial';
    } else {
      state = 'uncovered';
    }

    return {
      id: area.id,
      display_name: area.display_name,
      description: area.description,
      critical: !!area.critical,
      operator_confirmed: !!area.operator_confirmed,
      genus_agent_notes: area.genus_agent_notes || '',
      state,
      modules,
      agents,
      humans,
      tools: area.tools || [],
    };
  });

  const summary = {
    total: areas.length,
    fully: areas.filter(a => a.state === 'fully').length,
    partial: areas.filter(a => a.state === 'partial').length,
    uncovered: areas.filter(a => a.state === 'uncovered').length,
    overlap: areas.filter(a => a.state === 'overlap').length,
    critical_uncovered: areas.filter(a => a.state === 'uncovered' && a.critical).map(a => a.id),
    overlapping_area_ids: areas.filter(a => a.state === 'overlap').map(a => a.id),
  };

  return jsonResponse(200, { ok: true, bu, areas, summary });
}

function emptySummary() {
  return { total: 0, fully: 0, partial: 0, uncovered: 0, overlap: 0, critical_uncovered: [], overlapping_area_ids: [] };
}

// Default module-to-areas mapping. Until each module declares covers_areas
// in its module.json, infer: module id matches area id directly; strategy
// module is cross-cutting (declared elsewhere).
function computeModuleCoverage(available_modules) {
  const out = {};
  for (const m of available_modules) {
    if (Array.isArray(m.covers_areas) && m.covers_areas.length > 0) {
      out[m.id] = m.covers_areas;
      continue;
    }
    // Defaults
    if (m.id === 'strategy') {
      out[m.id] = ['strategy', 'product', 'growth'];
    } else if (m.id === 'finance') {
      out[m.id] = ['finance'];
    } else {
      out[m.id] = [m.id];
    }
  }
  return out;
}

async function safeRead(pat, path) {
  try {
    const file = await getFile(pat, path);
    return JSON.parse(file.content);
  } catch (_) {
    return null;
  }
}
