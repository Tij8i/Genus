// Roadmap i15 — MCP endpoint on Cloudflare Workers.
//
// Minimal Streamable HTTP MCP server exposing 3 tools to external instances:
//   - read_substrate(bu, path)       → reads a JSON substrate file
//   - write_substrate(bu, path, content) → writes a JSON substrate file
//   - list_agents(bu)                → returns agent bindings for the BU
//
// Auth: existing external-access tokens (SHA-256 hash lookup, see i30).
// Transport: single POST endpoint; JSON-RPC 2.0 payloads.
// v0.9 scope: proof of connectivity + a real tool call the operator can
// execute from an external Claude instance. Iterations: SSE upgrade + more
// tools + per-tool scope enforcement (see v1.0 cards i68/i69/i70).

import { getFile, putFile, jsonResponse } from './_gh.js';
import { verifyExternalToken } from './_external_auth.js';

const PROTO_VERSION = '2025-11-25';
const SERVER_INFO = { name: 'genus-mcp', version: '0.9.0' };

const TOOLS = [
  {
    name: 'read_substrate',
    description: 'Read a JSON substrate file from a BU. Returns parsed contents.',
    inputSchema: {
      type: 'object',
      properties: {
        bu: { type: 'string', description: 'Business unit id (e.g. "genus", "medivara")' },
        path: { type: 'string', description: 'Path within the BU dir, e.g. "product/roadmap.json"' },
      },
      required: ['bu', 'path'],
    },
  },
  {
    name: 'write_substrate',
    description: 'Write a JSON substrate file in a BU. Replaces existing content.',
    inputSchema: {
      type: 'object',
      properties: {
        bu: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'object', description: 'JSON body to write' },
        commit_message: { type: 'string', description: 'Optional git commit message' },
      },
      required: ['bu', 'path', 'content'],
    },
  },
  {
    name: 'list_agents',
    description: 'List agent bindings (Stewards, Masons) currently active for a BU.',
    inputSchema: {
      type: 'object',
      properties: { bu: { type: 'string' } },
      required: ['bu'],
    },
  },
];

function rpc(id, result, error) {
  const msg = { jsonrpc: '2.0', id };
  if (error) msg.error = error;
  else msg.result = result;
  return msg;
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  // Auth via Bearer token (external-access tokens). Rejects unauthenticated.
  const tokenCheck = await verifyExternalToken(request, env);
  if (tokenCheck.status === 'unauthenticated' || tokenCheck.status === 'invalid') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'authentication required (Bearer token)' } }), {
      status: 401, headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': PROTO_VERSION },
    });
  }
  const grant = tokenCheck.entry;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { jsonrpc: '2.0', error: { code: -32700, message: 'parse error' } }); }
  const { id, method, params } = body || {};

  try {
    if (method === 'initialize') {
      return new Response(JSON.stringify(rpc(id, {
        protocolVersion: PROTO_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      })), { headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': PROTO_VERSION } });
    }
    if (method === 'tools/list') {
      return new Response(JSON.stringify(rpc(id, { tools: TOOLS })), { headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      const bu = (args.bu || '').toString().trim().toLowerCase();
      // Scope: token's bu_scope must include the requested BU (or wildcard).
      const allowedBus = grant?.bu_scope || [];
      const wildcard = allowedBus.includes('*');
      if (!wildcard && !allowedBus.includes(bu)) {
        return new Response(JSON.stringify(rpc(id, null, { code: -32003, message: `token not scoped for BU '${bu}'` })), { headers: { 'Content-Type': 'application/json' } });
      }

      if (name === 'read_substrate') {
        const path = `dashboard/public/data/bus/${bu}/${(args.path || '').toString().replace(/^\//, '')}`;
        const file = await getFile(env.GITHUB_PAT, path);
        return new Response(JSON.stringify(rpc(id, {
          content: [{ type: 'text', text: file.content }],
          isError: false,
        })), { headers: { 'Content-Type': 'application/json' } });
      }
      if (name === 'write_substrate') {
        // Requires 'write' scope
        const scopes = grant?.scopes || [];
        if (!scopes.includes('write') && !scopes.includes('*')) {
          return new Response(JSON.stringify(rpc(id, null, { code: -32003, message: "token lacks 'write' scope" })), { headers: { 'Content-Type': 'application/json' } });
        }
        const path = `dashboard/public/data/bus/${bu}/${(args.path || '').toString().replace(/^\//, '')}`;
        const commit = args.commit_message || `mcp: write ${path} via external agent`;
        let sha = null;
        try { const existing = await getFile(env.GITHUB_PAT, path); sha = existing.sha; } catch (_) {}
        const contentStr = typeof args.content === 'string' ? args.content : JSON.stringify(args.content, null, 2) + '\n';
        const result = await putFile(env.GITHUB_PAT, path, contentStr, sha, commit);
        return new Response(JSON.stringify(rpc(id, {
          content: [{ type: 'text', text: `wrote ${path} @ ${result.commit.sha}` }],
          isError: false,
        })), { headers: { 'Content-Type': 'application/json' } });
      }
      if (name === 'list_agents') {
        try {
          const bindingsFile = await getFile(env.GITHUB_PAT, 'dashboard/public/data/system/agent_bindings.json');
          const bindings = JSON.parse(bindingsFile.content);
          const buAgents = (bindings.bindings || []).filter(b => b.bu === bu);
          return new Response(JSON.stringify(rpc(id, {
            content: [{ type: 'text', text: JSON.stringify(buAgents, null, 2) }],
            isError: false,
          })), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          return new Response(JSON.stringify(rpc(id, null, { code: -32603, message: 'could not read agent bindings: ' + (e.message || String(e)) })), { headers: { 'Content-Type': 'application/json' } });
        }
      }
      return new Response(JSON.stringify(rpc(id, null, { code: -32601, message: `unknown tool: ${name}` })), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(rpc(id, null, { code: -32601, message: `method not supported: ${method}` })), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify(rpc(id, null, { code: -32603, message: e.message || String(e) })), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

export function onRequestGet() {
  // Health check + tools discovery via GET (some MCP clients probe)
  return new Response(JSON.stringify({
    ok: true, mcp: true, serverInfo: SERVER_INFO, protocolVersion: PROTO_VERSION, tools: TOOLS.length,
  }), { headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': PROTO_VERSION } });
}
