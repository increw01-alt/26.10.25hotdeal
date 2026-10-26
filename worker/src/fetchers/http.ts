import type { Env } from "../types";
import { num } from "../config";

/** timeout·UA 적용 fetch. 실패 시 예외. */
export async function fetchText(env: Env, url: string, accept = "*/*"): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), num(env, "FETCH_TIMEOUT_MS", 10000));
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": env.USER_AGENT, accept, "accept-language": "ko-KR,ko;q=0.9" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const buf = await res.arrayBuffer();
    return decodeKorean(buf, res.headers.get("content-type") ?? "");
  } finally {
    clearTimeout(t);
  }
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
