/**
 * 글 페이지에서 쇼핑몰 주소를, 쇼핑몰 상품 페이지에서 대표 이미지 주소를 뽑는 순수 함수 (D-22).
 * 중계(relay.ts)와 Worker(api.ts)가 같이 쓴다. 글 본문은 저장하지 않고 주소 하나만 남긴다.
 * 스펙: docs/superpowers/specs/2026-11-10-shop-links-design.md
 */

/** 커뮤니티 도메인: 쇼핑몰 주소가 될 수 없다 */
const COMMUNITY_HOSTS = ["ppomppu.co.kr", "ruliweb.com", "clien.net", "fmkorea.com", "quasarzone.com"];
/** 클리앙 본문에서 쇼핑몰로 보지 않을 도메인(커뮤니티·블로그·영상·SNS·지도·뉴스) */
const NON_SHOP_HOSTS = [
  ...COMMUNITY_HOSTS, "reddit.com", "blog.naver.com", "cafe.naver.com", "news.naver.com", "map.naver.com", "tistory.com", "youtube.com", "youtu.be",
  "facebook.com", "instagram.com", "twitter.com", "x.com", "threads.net", "dcinside.com", "namu.wiki", "wikipedia.org", "google.com", "daum.net", "kakao.com",
];
/** 봇 요청을 막는 판매처(2026-11-10 조사). 대표 이미지를 요청하지 않는다 */
const NO_IMAGE_HOSTS = ["coupang.com", "gmarket.co.kr", "auction.co.kr", "naver.com", "naver.me", "11st.co.kr"];
/** 소스별 글 페이지 도메인 */
// 뽐뿌는 뺐다: 2026-11-10 운영에서 글 페이지 요청이 403 으로 막혔다(RSS 는 허용). 막는 곳은 우회하지 않는다.
const SOURCE_HOSTS: Record<string, string> = { ruliweb: "ruliweb.com", clien: "clien.net" };
/** 상세 수집 대상 소스 */
export const DETAIL_SOURCES = Object.keys(SOURCE_HOSTS);

export const MAX_SHOP_URL = 2000;
export const MAX_IMAGE_URL = 1000;
export const MAX_DETAIL_RESULTS = 20;

const hostIn = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));
const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const parseUrl = (s: string, base?: string): URL | null => { try { return new URL(s, base); } catch { return null; } };

/** 쇼핑몰 주소 검사·정리. http(s) 만, 커뮤니티 주소 거부, utm_ 쿼리 제거 */
export function cleanShopUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const u = parseUrl(raw);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname.includes(".")) return null;
  if (hostIn(u.hostname.toLowerCase(), COMMUNITY_HOSTS)) return null;
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
  // URL 직렬화가 따옴표·꺾쇠를 인코딩하지 않는 자리(쿼리의 작은따옴표 등)까지 막는다
  const out = u.toString().replace(/"/g, "%22").replace(/'/g, "%27").replace(/</g, "%3C").replace(/>/g, "%3E");
  return out.length > MAX_SHOP_URL ? null : out;
}

function base64ToText(b64: string): string | null {
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return null; }
}

/** 글 페이지에서 읽을 최대 길이, 태그 하나의 최대 길이 */
export const MAX_PAGE_CHARS = 1_000_000;
const MAX_TAG_CHARS = 3000;

/**
 * 여는 태그를 차례로 돌려준다. 정규식으로 문서 전체를 훑지 않는다
 * (닫히지 않은 "<a " 가 수만 개인 페이지에서 정규식이 수십 초 걸린다. 쇼핑몰 페이지는 남이 만든 것이다).
 */
function* openTags(html: string, name: string, from = 0, to = html.length): Generator<{ tag: string; index: number; end: number }> {
  const lower = `<${name}`;
  const upper = lower.toUpperCase();
  let i = from;
  // 소문자·대문자 표기의 다음 위치를 따로 기억한다(없는 표기를 매번 문서 끝까지 다시 찾지 않게)
  let nextLower = -2; let nextUpper = -2;
  while (i < to) {
    if (nextLower !== -1 && nextLower < i) nextLower = html.indexOf(lower, i);
    if (nextUpper !== -1 && nextUpper < i) nextUpper = html.indexOf(upper, i);
    const at = nextLower < 0 ? nextUpper : nextUpper < 0 ? nextLower : Math.min(nextLower, nextUpper);
    if (at < 0 || at >= to) return;
    const next = html.charCodeAt(at + lower.length);
    i = at + lower.length;
    if (!(next === 32 || next === 9 || next === 10 || next === 13)) continue; // 태그 이름 뒤가 공백이 아니면 다른 태그
    // ">" 는 태그 길이 상한 안에서만 찾는다(멀리 있는 ">" 를 매번 끝까지 훑지 않게)
    const rel = html.slice(i, at + MAX_TAG_CHARS).indexOf(">");
    if (rel < 0) continue;
    const close = i + rel;
    const tag = html.slice(at, close + 1);
    if (tag.indexOf("<", 1) >= 0) continue; // 닫히기 전에 다른 태그가 시작됨
    yield { tag, index: at, end: close + 1 };
    i = close + 1;
  }
}

/** 대소문자 구분 없는 indexOf (태그 이름은 영문) */
function indexOfCI(html: string, needle: string, from: number): number {
  const a = html.indexOf(needle, from);
  const b = html.indexOf(needle.toUpperCase(), from);
  return a < 0 ? b : b < 0 ? a : Math.min(a, b);
}

/** 태그 조각에서 속성 값. 앞에 공백이 있어야 한다(data-href 를 href 로 읽지 않게) */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
}
const hasClass = (tag: string, cls: string) => (attr(tag, "class") ?? "").split(/\s+/).includes(cls);

function fromPpomppu(html: string): string | null {
  for (const { tag } of openTags(html, "a")) {
    if (!hasClass(tag, "scrap_bx_href")) continue;
    const href = attr(tag, "href");
    const target = href ? parseUrl(href)?.searchParams.get("target") : null;
    if (!target) return null;
    // searchParams 가 "+" 를 공백으로 바꾸므로 되돌린다
    const text = base64ToText(target.replace(/ /g, "+"));
    return text ? cleanShopUrl(text) : null;
  }
  return null;
}

function fromRuliweb(html: string): string | null {
  const i = html.indexOf("source_url");
  if (i < 0) return null;
  for (const { tag } of openTags(html, "a", i, Math.min(html.length, i + 4000))) {
    const href = attr(tag, "href");
    const u = href ? parseUrl(href) : null;
    // link.php?ol=<주소> 형태. 감싸지 않은 직접 주소면 그대로 본다
    return u ? cleanShopUrl(u.searchParams.get("ol") ?? href) : null;
  }
  return null;
}

function fromClien(html: string): string | null {
  let start = -1;
  for (const t of openTags(html, "article")) if (hasClass(t.tag, "post")) { start = t.end; break; }
  if (start < 0) return null;
  const close = indexOfCI(html, "</article>", start);
  const end = close < 0 ? Math.min(html.length, start + 200_000) : close;
  const pick = (from: number, to: number): string | null => {
    for (const { tag } of openTags(html, "a", from, to)) {
      const url = cleanShopUrl(attr(tag, "href"));
      const host = url ? parseUrl(url)?.hostname.toLowerCase() : null;
      if (url && host && !hostIn(host, NON_SHOP_HOSTS)) return url;
    }
    return null;
  };
  // 구매링크 칸(<p class="attached">)이 있으면 먼저 본다
  for (const p of openTags(html, "p", start, end)) {
    if (!hasClass(p.tag, "attached")) continue;
    const pEnd = indexOfCI(html, "</p>", p.end);
    const found = pick(p.end, pEnd < 0 || pEnd > end ? Math.min(end, p.end + 5000) : pEnd);
    if (found) return found;
    break;
  }
  return pick(start, end);
}

/** 글 페이지 HTML → 쇼핑몰 주소. 못 찾으면 null */
export function extractShopUrl(source: string, page: string): string | null {
  const html = page.length > MAX_PAGE_CHARS ? page.slice(0, MAX_PAGE_CHARS) : page;
  if (source === "ppomppu" || source === "ppomppu_coupon") return fromPpomppu(html);
  if (source === "ruliweb") return fromRuliweb(html);
  if (source === "clien") return fromClien(html);
  return null;
}

/** 대표 이미지 주소 검사: https, 길이, 사이트 공통 이미지 제외 */
export function cleanImageUrl(input: unknown, pageUrl?: string): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const u = parseUrl(decodeEntities(input.trim()), pageUrl);
  if (!u || u.protocol !== "https:" || !u.hostname.includes(".")) return null;
  // 파일 이름만 본다(/shared/product/1.jpg 같은 경로를 잘못 거르지 않게)
  if (/og[-_]?image|logo|default|share|favicon/i.test(u.pathname.split("/").pop() ?? "")) return null;
  const out = u.toString().replace(/"/g, "%22").replace(/'/g, "%27").replace(/</g, "%3C").replace(/>/g, "%3E");
  return out.length > MAX_IMAGE_URL ? null : out;
}

/** 쇼핑몰 상품 페이지 HTML → og:image 주소. 쓸 수 있는 첫 값 */
export function extractOgImage(page: string, pageUrl: string): string | null {
  const html = page.length > MAX_PAGE_CHARS ? page.slice(0, MAX_PAGE_CHARS) : page;
  for (const { tag } of openTags(html, "meta")) {
    if ((attr(tag, "property") ?? attr(tag, "name")) !== "og:image") continue;
    const url = cleanImageUrl(attr(tag, "content"), pageUrl);
    if (url) return url;
  }
  return null;
}

/**
 * 글 페이지 응답을 어떻게 셀지. ok: 읽었다(주소가 없어도 시도 1회). gone: 지워진 글(시도 1회).
 * retry: 일시 장애·차단으로 보고 시도로 세지 않는다(다음 루프에 다시).
 */
export function pageOutcome(status: number | null): "ok" | "gone" | "blocked" | "retry" {
  if (status !== null && status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 401 || status === 403) return "blocked"; // 시도로 세고, 그 소스는 이 실행 동안 더 요청하지 않는다
  return "retry";
}

/** DNS 로 얻은 주소가 사설·루프백·링크로컬인지. 주소 형식이 아니면 막는 쪽(true) */
export function isPrivateAddress(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = (mapped ? mapped[1] : lower).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]); const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (!/^[0-9a-f:]+$/.test(lower) || !lower.includes(":")) return true;
  return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
}

/** 이 쇼핑몰 주소로 대표 이미지를 요청할지 */
export function shouldFetchImage(shopUrl: string): boolean {
  const u = parseUrl(shopUrl);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return false;
  const host = u.hostname.toLowerCase();
  // 글에 적힌 주소로 요청하는 것이므로 IP 주소·내부 이름은 거른다
  if (!host.includes(".") || host.includes(":") || host.startsWith("[") || /^[\d.]+$/.test(host) || /\.(local|internal|localhost|lan|home|corp)$/.test(host)) return false;
  return !hostIn(host, NO_IMAGE_HOSTS);
}

/** 상세를 가져올 글 페이지 주소. 소스 도메인이 아니면 null */
export function detailPageUrl(source: string, postUrl: string): string | null {
  const want = SOURCE_HOSTS[source];
  const u = parseUrl(postUrl);
  if (!want || !u || !hostIn(u.hostname.toLowerCase(), [want])) return null;
  u.protocol = "https:";
  if (source === "clien") u.search = ""; // robots.txt: Disallow: /*?*
  u.hash = "";
  return u.toString();
}

export interface DetailResult { source: string; postId: string; shopUrl: string | null; imageUrl: string | null }

/** 중계가 보낸 결과를 믿지 않고 다시 검사한다 */
export function sanitizeDetailResults(input: unknown): DetailResult[] {
  if (!Array.isArray(input)) return [];
  const out: DetailResult[] = [];
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.source !== "string" || typeof o.post_id !== "string" || !o.source || !o.post_id) continue;
    const shopUrl = cleanShopUrl(o.shop_url);
    out.push({ source: o.source.slice(0, 40), postId: o.post_id.slice(0, 80), shopUrl, imageUrl: shopUrl ? cleanImageUrl(o.image_url) : null });
    if (out.length >= MAX_DETAIL_RESULTS) break;
  }
  return out;
}
