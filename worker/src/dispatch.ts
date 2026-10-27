import type { Env } from "./types";
import { relaySources } from "./config";

const RELAY_STALE_MIN = 6;      // 중계가 이 시간 이상 비면 GitHub 워크플로를 깨운다
const DISPATCH_COOLDOWN_MIN = 5; // 한 번 깨운 뒤 최소 대기(잡 자체가 ~4.5분 돌기 때문)
const DISPATCH_KEY = "__dispatch";

/**
 * 플랜 B: GitHub 스케줄 지연에 대비해 Worker Cron이 relay.yml 을 workflow_dispatch 로 직접 실행한다.
 * secret GITHUB_DISPATCH_TOKEN(fine-grained PAT, 이 저장소 Actions: Read and write)이 없으면 아무 것도 하지 않는다.
 */
export async function maybeDispatchRelay(env: Env): Promise<{ dispatched: boolean; reason: string }> {
  if (!env.GITHUB_DISPATCH_TOKEN) return { dispatched: false, reason: "no token" };
  const repo = env.GITHUB_REPO ?? "";
  const workflow = env.RELAY_WORKFLOW ?? "relay.yml";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { dispatched: false, reason: "GITHUB_REPO var missing" };
  if (relaySources().length === 0) return { dispatched: false, reason: "no relay sources" };

  const rows = (await env.DB.prepare("SELECT source, last_at FROM relay_state").all<{ source: string; last_at: string }>().catch(() => ({ results: [] as { source: string; last_at: string }[] }))).results;
  const now = Date.now();
  const lastDispatch = rows.find((r) => r.source === DISPATCH_KEY);
  if (lastDispatch && now - new Date(lastDispatch.last_at).getTime() < DISPATCH_COOLDOWN_MIN * 60_000) return { dispatched: false, reason: "cooldown" };
  const slugs = new Set(relaySources().map((s) => s.slug));
  const newest = Math.max(0, ...rows.filter((r) => slugs.has(r.source)).map((r) => new Date(r.last_at).getTime()));
  if (newest && now - newest < RELAY_STALE_MIN * 60_000) return { dispatched: false, reason: "relay fresh" };

  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      method: "POST", signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": env.USER_AGENT,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: env.RELAY_REF ?? "main" }),
    });
    const ok = res.status === 204;
    await env.DB.prepare("INSERT INTO relay_state (source, last_at, host) VALUES (?,?,?) ON CONFLICT(source) DO UPDATE SET last_at = excluded.last_at, host = excluded.host")
      .bind(DISPATCH_KEY, new Date().toISOString(), ok ? "dispatched" : `HTTP ${res.status}`).run();
    if (!ok) console.error("[dispatch] GitHub", res.status, (await res.text()).slice(0, 200));
    return { dispatched: ok, reason: ok ? "dispatched" : `HTTP ${res.status}` };
  } catch (e) {
    console.error("[dispatch] failed", (e as Error).message);
    return { dispatched: false, reason: (e as Error).message };
  } finally { clearTimeout(t); }
}
