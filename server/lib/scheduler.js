// In-Node scheduler for autonomous background ticks.
//
// Boots inside the Node server; polls every N minutes (default: 60 in dev /
// operator can override via GENUS_SCHEDULE_INTERVAL_MINUTES). Skips entirely
// if ANTHROPIC_API_KEY isn't set — no work possible, no noise.
//
// Ticks currently registered (each iterates BUs in _registry.json, minus
// synthetic):
//   1. memo tick — process unprocessed memos → file task suggestions
//   2. retro tick (feature e) — find plans where completed_at + 30d has
//      elapsed AND retrospective_generated_at is unset; file an auto-approved
//      retrospective task to the Strategy Stewart.
//
// Future ticks (KPI captures, campaign-age scan, red-check) plug into the
// same loop.

import { getFile } from '../storage/index.js';
import { processMemosForBu } from '../api/process-memos.js';
import { generateRetrospectiveForBu } from '../api/generate-retrospective.js';

const PAT = 'local-mode-no-pat';
const RETRO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days post plan.completed_at

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

// Feature (e): 30-day auto-retro tick. For each configured BU, find plans where
// completed_at + 30d ≤ now AND retrospective_generated_at is null. File the
// retrospective task once per eligible plan. Runs on the same interval as memo
// tick; safe to fire on top of unchanged state (no-op when nothing is due).
async function retroTickOnce() {
  const bus = await listBus();
  const summary = [];
  const now = Date.now();
  for (const bu of bus) {
    try {
      let plans = [];
      try { plans = JSON.parse((await getFile(PAT, `dashboard/public/data/bus/${bu}/plans.json`)).content); } catch { continue; }
      if (!Array.isArray(plans) || plans.length === 0) continue;
      const eligible = plans.filter(p =>
        p.status === 'completed' &&
        p.completed_at &&
        !p.retrospective_generated_at &&
        (new Date(p.completed_at).getTime() + RETRO_WINDOW_MS) <= now
      );
      for (const plan of eligible) {
        try {
          await generateRetrospectiveForBu({ bu, plan_id: plan.id, pat: PAT });
          summary.push(`${bu}: filed retro for ${plan.id}`);
        } catch (e) {
          summary.push(`${bu}: retro-error ${plan.id} — ${e?.message || e}`);
        }
      }
    } catch (e) {
      summary.push(`${bu}: retro-scan ERROR ${e?.message || e}`);
    }
  }
  if (summary.length) {
    console.log('[scheduler] retro tick →', summary.join(' | '));
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
  setTimeout(() => {
    tickOnce().catch(e => console.error('[scheduler] first-tick error:', e?.message || e));
    retroTickOnce().catch(e => console.error('[scheduler] first-retro-tick error:', e?.message || e));
  }, 30_000);
  timer = setInterval(() => {
    tickOnce().catch(e => console.error('[scheduler] tick error:', e?.message || e));
    retroTickOnce().catch(e => console.error('[scheduler] retro-tick error:', e?.message || e));
  }, intervalMs);
  // Node keeps running as long as the timer exists — no ref/unref needed
  // since the parent express server holds the event loop open.
}

export function stopAutonomousScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
