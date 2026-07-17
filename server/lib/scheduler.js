// In-Node scheduler for autonomous memo processing.
//
// Closes the "operator drops a memo, comes back later, suggestion is
// there" loop without an external cron. Boots inside the Node server;
// polls every N minutes (default: 60 in dev / operator can override via
// GENUS_SCHEDULE_INTERVAL_MINUTES). Skips entirely if ANTHROPIC_API_KEY
// isn't set — no work possible, no noise.
//
// v0 does one thing: iterate BUs in _registry.json, call processMemosForBu
// for each. Future ticks (KPI captures, campaign-age scan, red-check) plug
// into the same loop.

import { getFile } from '../storage/index.js';
import { processMemosForBu } from '../api/process-memos.js';

const PAT = 'local-mode-no-pat';

function readIntervalMs() {
  const raw = process.env.GENUS_SCHEDULE_INTERVAL_MINUTES;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 1) return Math.round(parsed) * 60_000;
  return 60 * 60_000; // 60min default
}

async function listBus() {
  try {
    const { content } = await getFile(PAT, 'dashboard/public/data/bus/_registry.json');
    const parsed = JSON.parse(content);
    const list = (parsed?.business_units || []).map(b => b?.id).filter(Boolean);
    return list.filter(id => id !== 'synthetic'); // synthetic is a demo, never process
  } catch { return []; }
}

async function tickOnce() {
  const bus = await listBus();
  const summary = [];
  for (const bu of bus) {
    try {
      const r = await processMemosForBu({ bu, max: 10 });
      if (r.processed_count > 0 || r.tasks_filed?.length) {
        summary.push(`${bu}: processed ${r.processed_count} memos, filed ${r.tasks_filed?.length || 0} tasks`);
      }
    } catch (e) {
      summary.push(`${bu}: ERROR ${e?.message || e}`);
    }
  }
  if (summary.length) {
    console.log('[scheduler] memo tick →', summary.join(' | '));
  }
}

let timer = null;

export function startAutonomousScheduler() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log('[scheduler] ANTHROPIC_API_KEY not set — autonomous processing disabled. Set the key in .env + restart to enable.');
    return;
  }
  if (timer) return;
  const intervalMs = readIntervalMs();
  console.log(`[scheduler] autonomous memo processing enabled (every ${Math.round(intervalMs / 60_000)} min)`);
  // Kick off the first tick 30s after boot so the server has time to settle
  // and any first-run seed can complete before we start hitting substrate.
  setTimeout(() => { tickOnce().catch(e => console.error('[scheduler] first-tick error:', e?.message || e)); }, 30_000);
  timer = setInterval(() => {
    tickOnce().catch(e => console.error('[scheduler] tick error:', e?.message || e));
  }, intervalMs);
  // Node keeps running as long as the timer exists — no ref/unref needed
  // since the parent express server holds the event loop open.
}

export function stopAutonomousScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
