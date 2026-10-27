/**
 * 중계 수집기 (relay collector).
 * Worker IP가 차단되는 소스(뽐뿌·루리웹 등)를 다른 네트워크(사용자 PC, 국내 서버)에서 가져와
 * Worker의 /__admin/ingest 로 넘긴다. 파서는 Worker와 같은 코드를 쓴다.
 *
 * 빌드:  npm run build:relay      → dist/relay.mjs (Node 20+ 단일 파일)
 * 실행:  node dist/relay.mjs --api https://…workers.dev --token 비밀번호 [--sources ppomppu,ruliweb] [--loop 60]
 *        환경변수 RELAY_API / RELAY_TOKEN / RELAY_SOURCES 로도 지정 가능
 */
import { SOURCES, relaySources } from "./config";
import { fetchSource } from "./fetchers";
import type { Env, RawPost, SourceDef } from "./types";

type Args = { api: string; token: string; sources: string[]; loop: number; ua: string };

function parseArgs(argv: string[]): Args {
  const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const api = (get("api") ?? process.env.RELAY_API ?? "").replace(/\/$/, "");
  const token = get("token") ?? process.env.RELAY_TOKEN ?? "";
  const sources = (get("sources") ?? process.env.RELAY_SOURCES ?? relaySources().map((s) => s.slug).join(",")).split(",").map((x: string) => x.trim()).filter(Boolean);
  const loop = Number(get("loop") ?? process.env.RELAY_LOOP ?? 0) || 0;
  const ua = process.env.RELAY_UA ?? "Mozilla/5.0 (compatible; HotdealHubRelay/0.1; +https://hotdeal-hub.pages.dev/about/)";
  if (!api || !token) { console.error("사용법: node dist/relay.mjs --api https://<worker> --token <ADMIN_TOKEN> [--sources ppomppu,ruliweb] [--loop 60]"); process.exit(2); }
  return { api, token, sources, loop, ua };
}

/** fetchers가 요구하는 Env 중 네트워크 관련 값만 채운 가짜 env */
function relayEnv(ua: string): Env {
  return { USER_AGENT: ua, FETCH_TIMEOUT_MS: "20000" } as unknown as Env;
}

async function runOnce(a: Args): Promise<void> {
  const env = relayEnv(a.ua);
  const posts: RawPost[] = [];
  const errors: Record<string, string> = {};
  const counts: Record<string, number> = {};
  for (const slug of a.sources) {
    const src: SourceDef | undefined = SOURCES.find((s) => s.slug === slug);
    if (!src) { errors[slug] = "unknown source"; continue; }
    const t = Date.now();
    try {
      const items = await fetchSource(env, src);
      counts[slug] = items.length; posts.push(...items);
      console.log(`[relay] ${slug}: ${items.length}건 (${Date.now() - t}ms)`);
    } catch (e) {
      errors[slug] = (e as Error).message.slice(0, 300);
      console.error(`[relay] ${slug}: 실패 (${Date.now() - t}ms) ${errors[slug].slice(0, 120)}`);
    }
  }
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${a.api}/__admin/ingest`, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-admin-token": a.token, "user-agent": a.ua },
      body: JSON.stringify({ posts, errors, counts, relay: { host: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "relay", at: new Date().toISOString() } }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    console.log(`[relay] → Worker ${res.status} ${body.slice(0, 300)}`);
  } catch (e) {
    console.error(`[relay] Worker 전송 실패: ${(e as Error).message}`);
  } finally { clearTimeout(timer); }
}

const args = parseArgs(process.argv.slice(2));
if (args.loop > 0) {
  console.log(`[relay] ${args.sources.join(",")} → ${args.api} (${args.loop}초마다, Ctrl+C로 종료)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try { await runOnce(args); } catch (e) { console.error("[relay] 오류", (e as Error).message); }
    const wait = Math.max(5_000, args.loop * 1000 - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
} else {
  await runOnce(args);
}
