/**
 * 쇼핑몰 바로가기·썸네일 HTML (스펙: docs/superpowers/specs/2026-11-10-shop-links-design.md "사이트", D-22).
 * build.mjs가 import하는 순수 함수 모음. 주소는 커뮤니티 글에서 온 값이라 여기서 한 번 더 검사하고 이스케이프한다.
 */
import { esc } from "./card-benefits.mjs";

/** http(s) 주소만 돌려준다. httpsOnly 면 https 만 */
export function safeUrl(u, { httpsOnly = false } = {}) {
  if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return null;
  let url;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:")) return null;
  return u;
}

/** 이동할 도메인(www 제외). 방문자가 어디로 가는지 알 수 있게 버튼에 적는다 */
export function shopHost(u) {
  const ok = safeUrl(u);
  return ok ? new URL(ok).hostname.replace(/^www\./, "") : null;
}

/**
 * 카드 썸네일. 자리 표시(판매처 첫 글자)를 밑에 깔고 이미지를 위에 얹는다.
 * 이미지를 못 불러오면 site.js 가 img 를 지워 자리 표시가 보인다. 쇼핑몰에 방문자 주소를 넘기지 않는다(no-referrer).
 */
export function thumbHtml(d, label) {
  const initial = [...String(label ?? "").trim()][0] ?? "·";
  const img = safeUrl(d?.image_url, { httpsOnly: true });
  return `<div class="thumb" aria-hidden="true"><span>${esc(initial)}</span>${img ? `<img src="${esc(img)}" alt="" width="64" height="64" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-thumb>` : ""}</div>`;
}

/** 검색을 흐리는 행사 문구 */
const NOISE = new Set(["할인", "특가", "초특가", "핫딜", "무료배송", "무배", "무료", "증정", "사은품", "다양", "외", "등", "최대", "쿠폰", "적립", "행사", "세일", "기획전", "모음전", "균일가", "한정", "오늘만", "타임딜", "역대가", "최저가", "다수"]);

/** 검색어: 괄호·대괄호 안, 기호, 행사 문구, 퍼센트를 빼고 앞 5단어, 40자 이내. 긴 제목 그대로는 검색 결과가 안 나온다 */
export function searchQuery(name) {
  const words = String(name ?? "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}.%]+/gu, " ").trim().split(/\s+/)
    .filter((w) => w && !NOISE.has(w) && !/^\d+(\.\d+)?%$/.test(w)).slice(0, 5);
  let q = "";
  for (const w of words) { const next = q ? `${q} ${w}` : w; if (next.length > 40) break; q = next; }
  return q;
}

/**
 * 쇼핑몰 주소를 못 얻은 일반 딜(뽐뿌 글 등)을 판매처 검색 결과로 연결한다 (D-23).
 * 판매처 사전에 search_url 이 있는 곳만. 정확한 상품 페이지가 아니므로 화면에는 "검색"이라고 적는다.
 * @returns {{ url: string, merchantName: string } | null}
 */
export function shopSearch(d, merchants) {
  if (!d || d.kind !== "product" || d.status === "ended" || safeUrl(d.shop_url) || !d.merchant) return null;
  const m = (merchants ?? []).find((x) => x.slug === d.merchant);
  const q = searchQuery(d.product_name ?? d.title);
  if (!m?.search_url || !q) return null;
  const url = safeUrl(m.search_url.replace("{q}", encodeURIComponent(q)), { httpsOnly: true });
  return url ? { url, merchantName: m.name } : null;
}

/** 카드의 쇼핑몰 링크. 진행 중이고 쇼핑몰 주소가 있으면 "쇼핑몰", 없고 검색 주소가 있으면 "{판매처} 검색" */
export function shopLinkHtml(d, search = null) {
  const cls = "shrink-0 font-semibold text-brand-700 hover:underline";
  const url = d?.status === "ended" ? null : safeUrl(d?.shop_url);
  if (url) return `<a href="${esc(url)}" rel="nofollow noopener" target="_blank" class="${cls}">쇼핑몰 <span aria-hidden="true">›</span></a>`;
  const s = d?.status === "ended" ? null : safeUrl(search?.url);
  return s ? `<a href="${esc(s)}" rel="nofollow noopener" target="_blank" class="${cls}">${esc(search.merchantName)} 검색 <span aria-hidden="true">›</span></a>` : "";
}

/**
 * 상세 페이지의 구매 버튼. 쇼핑몰 주소가 있으면 주 버튼이 쇼핑몰, 원문 글은 보조 링크.
 * 쇼핑몰 주소가 없고 검색 주소(search)가 있으면 주 버튼이 판매처 검색, 원문 글이 보조.
 * 둘 다 없으면 예전처럼 원문 글이 주 버튼이다. rel 은 원문 글 버튼용(제휴 표시 등).
 */
export function buyButtonsHtml({ shopUrl, postUrl, rel = "nofollow noopener", search = null }) {
  const shop = safeUrl(shopUrl);
  const post = safeUrl(postUrl);
  const s = shop ? null : safeUrl(search?.url);
  if (s) {
    return `<a href="${esc(s)}" rel="nofollow noopener" target="_blank" class="btn-primary mt-4 w-full">${esc(search.merchantName)}에서 상품명으로 검색</a>`
      + (post ? `<a href="${esc(post)}" rel="${esc(rel)}" target="_blank" class="btn-ghost mt-2 w-full">원문 글에서 정확한 링크 확인</a>` : "")
      + `<p class="mt-2 text-xs text-ink-500">검색 결과라 같은 상품·가격이 아닐 수 있습니다. 정확한 구매 링크는 원문 글에 있습니다.</p>`;
  }
  if (!shop) return post ? `<a href="${esc(post)}" rel="${esc(rel)}" target="_blank" class="btn-primary mt-4 w-full">원문 글에서 구매처 확인</a>` : "";
  return `<a href="${esc(shop)}" rel="nofollow noopener" target="_blank" class="btn-primary mt-4 w-full">쇼핑몰에서 보기 (${esc(shopHost(shop))})</a>`
    + (post ? `<a href="${esc(post)}" rel="${esc(rel)}" target="_blank" class="btn-ghost mt-2 w-full">커뮤니티 원문 글</a>` : "")
    + `<p class="mt-2 text-xs text-ink-500">쇼핑몰 주소는 커뮤니티 글에 올라온 그대로입니다. 가격과 재고는 쇼핑몰에서 확인하세요.</p>`;
}
