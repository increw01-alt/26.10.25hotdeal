import type { Env } from "../types";
import { num, DEFAULT_TIMEOUT_MS, userAgent } from "../config";

export interface RawResponse { status: number; contentType: string; bytes: number; text: string; finalUrl: string; ms: number }

/** timeout·UA 적용 fetch. HTTP 오류도 예외 없이 돌려준다(진단용). */
export interface FetchOpts { accept?: string; ua?: string; headers?: Record<string, string> }

export async function fetchRaw(env: Env, url: string, acceptOrOpts: string | FetchOpts = "*/*"): Promise<RawResponse> {
  const opts: FetchOpts = typeof acceptOrOpts === "string" ? { accept: acceptOrOpts } : acceptOrOpts;
  const accept = opts.accept ?? "*/*";
  const ctrl = new AbortController();
  const started = Date.now();
  // 소스 조사 결과 루리웹이 Worker에서 느리게 응답 → sources.json 기본값(20초) 이상을 보장
  const timeoutMs = Math.max(num(env, "FETCH_TIMEOUT_MS", DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS);
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": userAgent(env, opts.ua), accept, "accept-language": "ko-KR,ko;q=0.9", "cache-control": "no-cache", ...(opts.headers ?? {}) },
      redirect: "follow",
    });
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "";
    return { status: res.status, contentType, bytes: buf.byteLength, text: decodeKorean(buf, contentType), finalUrl: res.url, ms: Date.now() - started };
  } catch (e) {
    const err = e as Error;
    throw new Error(err.name === "AbortError" ? `timeout ${timeoutMs}ms ${url}` : `${err.message} ${url}`);
  } finally {
    clearTimeout(t);
  }
}

/** 본문 텍스트. 2xx가 아니면 예외. */
export async function fetchText(env: Env, url: string, acceptOrOpts: string | FetchOpts = "*/*"): Promise<string> {
  const r = await fetchRaw(env, url, acceptOrOpts);
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} ${url} ${snippet(r.text)}`);
  return r.text;
}

/** 오류 메시지용 응답 요약 (상태 파악에 필요한 최소한만) */
export function snippet(text: string, n = 160): string {
  return `[${text.replace(/\s+/g, " ").slice(0, n)}]`;
}

/** EUC-KR 응답(뽐뿌 등) 대응 */
function decodeKorean(buf: ArrayBuffer, contentType: string): string {
  const head = new TextDecoder("utf-8").decode(buf.slice(0, 2048));
  const declared = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? /encoding="([\w-]+)"/i.exec(head)?.[1] ?? /charset=["']?([\w-]+)/i.exec(head)?.[1];
  const enc = (declared ?? "utf-8").toLowerCase();
  if (/euc-kr|ks_c_5601|cp949/.test(enc)) {
    try { return new TextDecoder("euc-kr").decode(buf); } catch { /* fallthrough */ }
  }
  return new TextDecoder("utf-8").decode(buf);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, "&").trim();
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
