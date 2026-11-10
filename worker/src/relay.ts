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
import { fetchRaw } from "./fetchers/http";
import { detailPageUrl, extractOgImage, extractShopUrl, isPrivateAddress, pageOutcome, shouldFetchImage } from "./detail";
import type { Env, RawPost, SourceDef } from "./types";

type Args = { api: string; token: string; sources: string[]; loop: number; ua: string; deadline: number };

function parseArgs(argv: string[]): Args {
  const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const api = (get("api") ?? process.env.RELAY_API ?? "").replace(/\/$/, "");
  const token = get("token") ?? process.env.RELAY_TOKEN ?? "";
  const sources = (get("sources") ?? process.env.RELAY_SOURCES ?? relaySources().map((s) => s.slug).join(",")).split(",").map((x: string) => x.trim()).filter(Boolean);
  const loop = Number(get("loop") ?? process.env.RELAY_LOOP ?? 0) || 0;
  const ua = process.env.RELAY_UA ?? "Mozilla/5.0 (compatible; HotdealHubRelay/0.1; +https://hotdeal-hub.pages.dev/about/)";
  if (!api || !token) { console.error("사용법: node dist/relay.mjs --api https://<worker> --token <ADMIN_TOKEN> [--sources ppomppu,ruliweb] [--loop 60]"); process.exit(2); }
  // RELAY_BUDGET_SEC: 이 프로세스가 쓸 수 있는 시간(Actions 는 timeout 270 으로 끊는다). 상세 수집이 끊기기 직전에 새 글을 시작하지 않게 한다
  const budget = Number(process.env.RELAY_BUDGET_SEC ?? 0) || 0;
  return { api, token, sources, loop, ua, deadline: budget > 0 ? Date.now() + budget * 1000 : Infinity };
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 이름이 공인 주소로만 풀리는지. 글에 적힌 주소로 요청하므로 사설·루프백 주소로 풀리는 이름은 거른다 */
async function resolvesPublic(hostname: string): Promise<boolean> {
  try {
    // worker tsconfig 에는 Node 타입이 없어 모듈 형태를 직접 적는다
    const dns = (await import("node:dns/promises" as string)) as { lookup(h: string, o: { all: true }): Promise<Array<{ address: string }>> };
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((x) => !isPrivateAddress(x.address));
  } catch { return false; }
}

/**
 * 쇼핑몰 상품 페이지의 앞부분만 읽는다(전체 8초, 300KB). 실패하면 null.
 * 리다이렉트는 직접 따라가며 단계마다 주소를 다시 검사한다(최대 3번). 단축 주소가 봇을 막는 판매처나 내부 주소로 가면 그만둔다.
 */
async function fetchShopHead(startUrl: string, ua: string): Promise<{ html: string; url: string } | null> {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    let url = startUrl;
    for (let hop = 0; hop <= 3; hop++) {
      if (!shouldFetchImage(url) || !(await resolvesPublic(new URL(url).hostname))) return null;
      const res = await fetch(url, { signal: ctrl.signal, redirect: "manual", headers: { "user-agent": ua, accept: "text/html", "accept-language": "ko-KR,ko;q=0.9" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) return null;
        url = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok || !res.body || !/html/i.test(res.headers.get("content-type") ?? "")) { await res.body?.cancel().catch(() => {}); return null; }
      const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (size < 300_000) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); size += value.byteLength; }
      await reader.cancel().catch(() => {});
      return { html: new TextDecoder("utf-8").decode(Buffer.concat(chunks)), url };
    }
    return null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/**
 * 상세 수집 (D-22): Worker가 준 글 목록의 글 페이지에서 쇼핑몰 주소를, 쇼핑몰 페이지에서 대표 이미지 주소를 뽑아 돌려준다.
 * 글 본문은 어디에도 저장하지 않는다.
 * - 결과는 글마다 바로 보낸다(작업이 중간에 끊겨도 한 일은 남는다).
 * - 글 페이지를 읽었거나 글이 지워진 경우만 시도로 센다. 일시 장애(429, 5xx, 시간 초과)는 보내지 않고, 그 소스는 이번 루프에서 더 요청하지 않는다.
 * - deadline 이 가까우면 새 글을 시작하지 않는다.
 */
/** 차단·장애로 쉬는 소스. 프로세스가 사는 동안(Actions 는 약 4.5분) 유지한다 */
const paused = new Set<string>();

async function runDetails(a: Args, deadline = Infinity): Promise<void> {
  const env = relayEnv(a.ua);
  const headers = { "content-type": "application/json", "x-admin-token": a.token, "user-agent": a.ua };
  let pending: Array<{ source: string; post_id: string; post_url: string }> = [];
  try {
    const res = await fetch(`${a.api}/__admin/pending-details`, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pending = ((await res.json()) as { posts?: typeof pending }).posts ?? [];
  } catch (e) { console.error(`[relay] 상세 대상 조회 실패: ${(e as Error).message}`); return; }
  const stat = { done: 0, shop: 0, image: 0, retry: 0 };
  for (const p of pending) {
    if (Date.now() > deadline - 35_000) break; // 글 하나에 최악 30초 남짓
    if (paused.has(p.source)) continue;
    let shop: string | null = null; let image: string | null = null;
    const pageUrl = detailPageUrl(p.source, p.post_url);
    if (pageUrl) {
      let status: number | null = null; let text = "";
      try {
        const src = SOURCES.find((s) => s.slug === p.source);
        const r = await fetchRaw(env, pageUrl, { accept: "text/html", ua: src?.ua, headers: src?.headers });
        status = r.status; text = r.text;
      } catch (e) { console.error(`[relay] 상세 ${p.source}/${p.post_id}: ${(e as Error).message.slice(0, 120)}`); }
      const outcome = pageOutcome(status);
      if (outcome === "retry" || outcome === "blocked") { paused.add(p.source); console.error(`[relay] 상세 ${p.source}: 응답 ${status ?? "없음"} → 이 실행 동안 쉼`); }
      if (outcome === "retry") { stat.retry++; continue; }
      if (outcome === "ok") shop = extractShopUrl(p.source, text);
      if (shop) { const head = await fetchShopHead(shop, a.ua); if (head) image = extractOgImage(head.html, head.url); }
    }
    try {
      const res = await fetch(`${a.api}/__admin/details`, { method: "POST", headers, body: JSON.stringify({ results: [{ source: p.source, post_id: p.post_id, shop_url: shop, image_url: image }] }), signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      stat.done++; if (shop) stat.shop++; if (image) stat.image++;
    } catch (e) { console.error(`[relay] 상세 전송 실패: ${(e as Error).message}`); break; }
    await sleep(1500);
  }
  if (pending.length) console.log(`[relay] 상세 ${stat.done}/${pending.length}건 (쇼핑몰 ${stat.shop}, 이미지 ${stat.image}, 미룸 ${stat.retry})`);
}

const args = parseArgs(process.argv.slice(2));
if (args.loop > 0) {
  console.log(`[relay] ${args.sources.join(",")} → ${args.api} (${args.loop}초마다, Ctrl+C로 종료)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try { await runOnce(args); await runDetails(args, args.deadline); } catch (e) { console.error("[relay] 오류", (e as Error).message); }
    const wait = Math.max(5_000, args.loop * 1000 - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
} else {
  await runOnce(args);
  await runDetails(args);
}
