// Shared helpers for Cloudflare Pages Functions that read/write GitHub repo files.

export const GITHUB_REPO = 'Tij8i/Orchestrator';
export const BRANCH = 'main';

export function ghHeaders(pat) {
  return {
    'Authorization': `Bearer ${pat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'genus-dashboard-fn',
    'Content-Type': 'application/json',
  };
}

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Decode base64 → UTF-8 text properly. atob alone returns a Latin-1 binary
// string; if the file has non-ASCII (§, accented letters, emojis), the JS
// string contains mojibake. JSON.parse then "succeeds" but the parsed values
// are corrupted. Re-serializing + base64'ing + PUTting back then DOUBLE-encodes,
// and the corruption compounds on every round-trip. We learned this the hard
// way — tasks.json grew to 4MB of recursive mojibake on a single "§" character.
// Always pair atob with TextDecoder('utf-8') when reading file contents.
export function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function getFile(pat, path) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${BRANCH}`;
  const r = await fetch(url, { headers: ghHeaders(pat) });
  if (!r.ok) {
    const text = await r.text();
    throw { status: r.status, message: `GitHub GET ${r.status}: ${text}` };
  }
  const data = await r.json();

  // GitHub's Contents API returns empty content (or encoding="none") for
  // files >1MB. We still need the SHA from this call for the subsequent PUT,
  // but we have to fetch the bytes via the raw URL when the file is large.
  // See https://docs.github.com/en/rest/repos/contents#get-repository-content
  const tooLarge = !data.content || data.encoding === 'none' || (data.size && data.size > 1024 * 1024);
  let content;
  if (tooLarge) {
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/${path}`;
    const rawResp = await fetch(rawUrl, {
      headers: {
        'Authorization': `Bearer ${pat}`,
        'User-Agent': 'genus-dashboard-fn',
        'Accept': 'application/vnd.github.raw',
      },
    });
    if (!rawResp.ok) {
      const txt = await rawResp.text();
      throw { status: rawResp.status, message: `GitHub raw GET ${rawResp.status}: ${txt}` };
    }
    content = await rawResp.text();
  } else {
    content = base64ToUtf8(data.content);
  }

  return { sha: data.sha, content };
}

export async function putFile(pat, path, content, sha, commitMessage) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: ghHeaders(pat),
    body: JSON.stringify({
      message: commitMessage,
      content: utf8ToBase64(content),
      sha,
      branch: BRANCH,
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw { status: r.status, message: `GitHub PUT ${r.status}: ${text}` };
  }
  return await r.json();
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function todayISO() {
  return new Date().toISOString();
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}
