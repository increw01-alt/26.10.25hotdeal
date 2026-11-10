/**
 * 딜 목록 도우미 (스펙: docs/superpowers/specs/2026-11-10-general-hotdeals-design.md "사이트").
 * build.mjs가 import하는 순수 함수 모음.
 */

/** 딜 종류. kind 가 없는 옛 응답·정적 사본은 상품권으로 본다 */
export const dealKind = (d) => (d?.kind === "product" ? "product" : "gift");

const byScore = (a, b) => (b.score ?? 0) - (a.score ?? 0);

/**
 * 홈에 보여 줄 딜: 진행 중인 딜 중 점수순 상위 limit 건.
 * 진행 중인 상품권 딜은 상위에 못 들어도 뒤에 모두 붙인다(상품권 탭이 비지 않게).
 */
export function pickHomeDeals(deals, limit = 60) {
  const active = deals.filter((d) => d.status !== "ended").sort(byScore);
  const top = active.slice(0, limit);
  const rest = active.slice(limit).filter((d) => dealKind(d) === "gift");
  return [...top, ...rest];
}

/** size 건씩 쪽으로 나눈다. 빈 목록이면 빈 쪽 하나 */
export function paginate(list, size = 50) {
  const pages = [];
  for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size));
  return pages.length ? pages : [[]];
}

/** 전체 딜 목록 주소. kind: all | gift | product */
export function listPath(kind, page = 1) {
  const base = kind === "gift" ? "/deals/gift/" : kind === "product" ? "/deals/product/" : "/deals/";
  return page > 1 ? `${base}${page}/` : base;
}

/** 일반 딜 상세를 만들지: 진행 중이거나 종료 후 days 일 이내 (D-20) */
export function productPageEligible(d, now = new Date(), days = 3) {
  if (d.status !== "ended" || !d.ended_at) return true;
  return (now - new Date(d.ended_at)) / 86400000 <= days;
}

/** 가격 표시: 숫자 가격 → "9,900원", 서술형 → 원문, 없으면 "—" */
export function priceLabel(d) {
  if (d.sale_price != null) return `${Number(d.sale_price).toLocaleString("ko-KR")}원`;
  if (d.price_kind === "descriptive" && d.price_text) return String(d.price_text);
  return "—";
}

/** 판매처 표시: 사전 이름 → 원문 표기 → "판매처 미확인" */
export function merchantLabel(d, merchantName) {
  if (d.merchant) return merchantName[d.merchant] ?? d.merchant;
  return d.merchant_raw || "판매처 미확인";
}
