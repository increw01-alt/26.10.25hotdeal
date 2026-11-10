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
const SOURCE_HOSTS: Record<string, string> = { ppomppu: "ppomppu.co.kr", ppomppu_coupon: "ppomppu.co.kr", ruliweb: "ruliweb.com", clien: "clien.net" };
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

/** 태그 조각에서 href 값 */
const hrefOf = (tag: string): string | null => { const m = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i); return m ? decodeEntities(m[1] ?? m[2] ?? "") : null; };

function fromPpomppu(html: string): string | null {
  const tag = html.match(/<a\b[^>]*class\s*=\s*["'][^"']*\bscrap_bx_href\b[^"']*["'][^>]*>/i)?.[0];
  const href = tag ? hrefOf(tag) : null;
  const u = href ? parseUrl(href) : null;
  const target = u?.searchParams.get("target");
  if (!target) return null;
  // searchParams 가 "+" 를 공백으로 바꾸므로 되돌린다
  const text = base64ToText(target.replace(/ /g, "+"));
  return text ? cleanShopUrl(text) : null;
}

function fromRuliweb(html: string): string | null {
  const i = html.search(/class\s*=\s*["'][^"']*\bsource_url\b/i);
  if (i < 0) return null;
  const tag = html.slice(i, i + 3000).match(/<a\b[^>]*>/i)?.[0];
  const href = tag ? hrefOf(tag) : null;
  const u = href ? parseUrl(href) : null;
  if (!u) return null;
  // link.php?ol=<주소> 형태. 감싸지 않은 직접 주소면 그대로 본다
  return cleanShopUrl(u.searchParams.get("ol") ?? href);
}

function fromClien(html: string): string | null {
  const start = html.search(/<article\b[^>]*class\s*=\s*["'][^"']*\bpost\b/i);
  if (start < 0) return null;
  const endRel = html.slice(start).search(/<\/article>/i);
  const article = endRel < 0 ? html.slice(start, start + 200_000) : html.slice(start, start + endRel);
  const pick = (chunk: string): string | null => {
    for (const m of chunk.matchAll(/<a\b[^>]*>/gi)) {
      const url = cleanShopUrl(hrefOf(m[0]));
      const host = url ? parseUrl(url)?.hostname.toLowerCase() : null;
      if (url && host && !hostIn(host, NON_SHOP_HOSTS)) return url;
    }
    return null;
  };
  const attached = article.match(/<p\b[^>]*class\s*=\s*["'][^"']*\battached\b[^"']*["'][^>]*>[\s\S]*?<\/p>/i)?.[0];
  return (attached ? pick(attached) : null) ?? pick(article);
}

/** 글 페이지 HTML → 쇼핑몰 주소. 못 찾으면 null */
export function extractShopUrl(source: string, html: string): string | null {
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
  if (/og[-_]?image|logo|default|share|favicon/i.test(u.pathname)) return null;
  const out = u.toString().replace(/"/g, "%22").replace(/'/g, "%27").replace(/</g, "%3C").replace(/>/g, "%3E");
  return out.length > MAX_IMAGE_URL ? null : out;
}

/** 쇼핑몰 상품 페이지 HTML → og:image 주소 */
export function extractOgImage(html: string, pageUrl: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\bproperty\s*=\s*["']og:image["']/i.test(tag)) continue;
    const c = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    return c ? cleanImageUrl(c[1] ?? c[2] ?? "", pageUrl) : null;
  }
  return null;
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
