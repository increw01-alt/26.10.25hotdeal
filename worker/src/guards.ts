import type { Env } from "./types";
import { num } from "./config";

/** 수집 급감 가드 (D-03): 직전 스냅샷 대비 활성 딜 비율 */
export async function checkActiveRatio(env: Env, currentActive: number): Promise<{ ok: boolean; previous: number; ratio: number }> {
  const prev = await env.DB.prepare(
    "SELECT active_deals FROM run_log WHERE guard_tripped = 0 ORDER BY id DESC LIMIT 1"
  ).first<{ active_deals: number }>();
  const previous = prev?.active_deals ?? 0;
  if (previous < 10) return { ok: true, previous, ratio: 1 }; // 초기 운영·소규모일 때는 판정 안 함
  const ratio = currentActive / previous;
  return { ok: ratio >= num(env, "GUARD_MIN_ACTIVE_RATIO", 0.5), previous, ratio };
}

/** 서킷 브레이커 (D-03) */
export async function isPaused(env: Env, source: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT paused_until FROM source_state WHERE source = ?").bind(source).first<{ paused_until: string | null }>();
  return !!row?.paused_until && new Date(row.paused_until).getTime() > Date.now();
}

export async function recordSourceOk(env: Env, source: string, count: number): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO source_state (source, consecutive_fail, paused_until, last_ok_at, last_error, last_item_count, updated_at)
    VALUES (?, 0, NULL, ?, NULL, ?, ?)
    ON CONFLICT(source) DO UPDATE SET consecutive_fail = 0, paused_until = NULL, last_ok_at = excluded.last_ok_at,
      last_error = NULL, last_item_count = excluded.last_item_count, updated_at = excluded.updated_at
  `).bind(source, new Date().toISOString(), count, new Date().toISOString()).run();
}

export async function recordSourceFail(env: Env, source: string, error: string): Promise<{ tripped: boolean; fails: number }> {
  const threshold = num(env, "CB_FAIL_THRESHOLD", 5);
  const cooldownMin = num(env, "CB_COOLDOWN_MIN", 60);
  const row = await env.DB.prepare("SELECT consecutive_fail FROM source_state WHERE source = ?").bind(source).first<{ consecutive_fail: number }>();
  const fails = (row?.consecutive_fail ?? 0) + 1;
  const tripped = fails >= threshold;
  const pausedUntil = tripped ? new Date(Date.now() + cooldownMin * 60_000).toISOString() : null;
  await env.DB.prepare(`
    INSERT INTO source_state (source, consecutive_fail, paused_until, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET consecutive_fail = excluded.consecutive_fail, paused_until = excluded.paused_until,
      last_error = excluded.last_error, updated_at = excluded.updated_at
  `).bind(source, tripped ? 0 : fails, pausedUntil, error.slice(0, 500), new Date().toISOString()).run();
  return { tripped, fails };
}
