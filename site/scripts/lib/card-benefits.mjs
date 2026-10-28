/**
 * 쇼핑몰별 카드 혜택 렌더링 (스펙: docs/superpowers/specs/2026-10-28-card-benefits-design.md "페이지 동작").
 * build.mjs가 import하는 순수 함수 모음. 데이터는 shared/cards.json, verified 카드만 다룬다.
 */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const KIND_LABEL = { discount: "할인", points: "적립", cashback: "캐시백" };
export const CARD_NOTICE = "카드 혜택은 카드사 공식 안내를 기준으로 확인한 값입니다. 혜택 개편이 잦으니 결제 전 카드사 앱에서 다시 확인하세요. 이 사이트는 카드를 모집하지 않습니다.";

const isApplies = (e) => e.benefit.giftcard === "applies";
const byPriority = (a, b) => Number(!isApplies(a)) - Number(!isApplies(b)) || (b.benefit.rate ?? 0) - (a.benefit.rate ?? 0) || a.card.name.localeCompare(b.card.name, "ko");

/**
 * @param {object} doc shared/cards.json
 * @param {{ now?: Date }} opts
 * @returns {{ byMerchant: Map<string, Array<{card: object, benefit: object, stale: boolean}>>, staleAfterDays: number, updatedAt: string }}
 */
export function buildCardIndex(doc, { now = new Date() } = {}) {
  const staleAfterDays = doc.stale_after_days ?? 60;
  const byMerchant = new Map();
  for (const card of doc.cards ?? []) {
    if (card.status !== "verified") continue;
    const stale = (now - new Date(`${card.verified_at}T00:00:00Z`)) / 86400000 > staleAfterDays;
    for (const benefit of card.benefits ?? []) {
      if (!byMerchant.has(benefit.merchant)) byMerchant.set(benefit.merchant, []);
      byMerchant.get(benefit.merchant).push({ card, benefit, stale });
    }
  }
  for (const list of byMerchant.values()) list.sort(byPriority);
  return { byMerchant, staleAfterDays, updatedAt: doc.updated_at };
}

/** 판매처의 항목. 상품권 적용(applies) 먼저, 그다음 rate 내림차순, 그다음 카드명 */
export function entriesForMerchant(index, merchant) {
  return merchant ? [...(index.byMerchant.get(merchant) ?? [])] : [];
}

export function benefitSummary(b) {
  const value = b.rate != null ? `${b.rate}%` : `${Number(b.amount).toLocaleString("ko-KR")}원`;
  return `${value} ${KIND_LABEL[b.kind] ?? b.kind}${b.cap ? ` · ${b.cap}` : ""}`;
}
export function prevMonthLabel(n) {
  if (!n) return "실적 조건 없음";
  return `전월 ${n % 10000 === 0 ? `${n / 10000}만원` : `${n.toLocaleString("ko-KR")}원`} 이상`;
}
const typeLabel = (card) => (card.type === "check" ? "체크" : "신용");
const giftChip = (g) => g === "applies"
  ? '<span class="chip bg-green-50 text-status-live">상품권 적용</span>'
  : g === "excluded"
    ? '<span class="chip bg-surface-muted text-ink-700">상품권 제외</span>'
    : '<span class="chip bg-surface-muted text-ink-700">상품권 적용 미확인</span>';
const staleChip = (stale) => (stale ? ' <span class="chip bg-amber-50 text-amber-800">재확인 필요</span>' : "");
const sourceLink = (card) => `<a href="${esc(card.official_url)}" rel="nofollow noopener" target="_blank" class="underline">공식 안내</a>`;

function cardRow({ card, benefit, stale }, issuerName) {
  return `<li class="card p-4 text-sm">`
    + `<div class="flex flex-wrap items-center gap-2"><span class="font-semibold">${esc(card.name)}</span><span class="text-ink-500">${esc(issuerName[card.issuer] ?? card.issuer)} · ${typeLabel(card)}</span>${giftChip(benefit.giftcard)}${staleChip(stale)}</div>`
    + `<p class="mt-1 font-semibold text-brand-700">${esc(benefitSummary(benefit))}</p>`
    + (benefit.note ? `<p class="mt-1 text-ink-700">${esc(benefit.note)}</p>` : "")
    + `<p class="mt-1 text-xs text-ink-500">${esc(prevMonthLabel(card.prev_month_min))}${card.annual_fee ? ` · 연회비 ${esc(card.annual_fee)}` : ""} · 확인 ${esc(card.verified_at)} · ${sourceLink(card)}</p>`
    + `</li>`;
}

/**
 * 딜 상세의 "{판매처} 카드 혜택" 섹션.
 * promoNote: 딜 제목에서 뽑은 판매처 카드 행사 조건(deal.card_benefit). 있으면 카드 자체 혜택과 별개임을 한 줄로 알린다
 * (행사 조건은 "구매 조건"에 이미 있으므로 여기서 반복하지 않고 관계만 설명).
 */
export function renderDealCardSection({ index, merchant, merchantName, issuerName, promoNote = null }) {
  const mName = merchant ? (merchantName[merchant] ?? merchant) : null;
  const promo = promoNote
    ? `<p class="mt-3 text-sm text-ink-700">이 딜의 "${esc(promoNote)}"은 판매처 행사 조건(위 구매 조건)이며, 아래의 카드 자체 상시 혜택과는 별개입니다.</p>`
    : "";
  const head = `<section class="mt-8" aria-labelledby="h-cards"><h2 id="h-cards" class="text-lg font-bold">${mName ? `${esc(mName)} 카드 혜택` : "카드 혜택"}</h2>${promo}`;
  const foot = `<p class="mt-3 text-xs text-ink-500">${esc(CARD_NOTICE)}</p></section>`;
  if (!merchant) return `${head}<p class="mt-3 text-sm text-ink-500">판매처가 확인되지 않아 카드 혜택을 연결하지 못했습니다.</p>${foot}`;

  const entries = entriesForMerchant(index, merchant);
  const applies = entries.filter(isApplies);
  const others = entries.filter((e) => !isApplies(e));
  let body = applies.length
    ? `<ul class="mt-3 space-y-2">${applies.map((e) => cardRow(e, issuerName)).join("")}</ul>`
    : `<p class="mt-3 text-sm text-ink-700">확인된 카드 중 ${esc(mName)}에서 상품권 결제에 혜택을 주는 카드는 없습니다. 대부분의 카드는 상품권·선불충전을 적립·할인에서 제외합니다.</p>`;
  if (others.length) {
    body += `<details class="mt-3"><summary class="cursor-pointer text-sm font-semibold text-ink-700">일반 상품 결제 시 혜택 (상품권은 제외) · ${others.length}장</summary><ul class="mt-2 space-y-2">${others.map((e) => cardRow(e, issuerName)).join("")}</ul></details>`;
  }
  return head + body + foot;
}

/** /cards/ 페이지의 판매처별 섹션(표). 카드 없는 판매처는 생략 */
export function renderCardsPageSections({ index, merchantsOrder, merchantName, issuerName }) {
  return merchantsOrder.filter((m) => (index.byMerchant.get(m) ?? []).length > 0).map((m) => {
    const rows = entriesForMerchant(index, m).map((e) =>
      `<tr><td class="py-2 pr-3"><span class="font-semibold">${esc(e.card.name)}</span><br><span class="text-xs text-ink-500">${esc(issuerName[e.card.issuer] ?? e.card.issuer)} · ${typeLabel(e.card)}${e.card.annual_fee ? ` · 연회비 ${esc(e.card.annual_fee)}` : ""}</span></td>`
      + `<td class="py-2 pr-3">${esc(benefitSummary(e.benefit))}${e.benefit.note ? `<br><span class="text-xs text-ink-500">${esc(e.benefit.note)}</span>` : ""}</td>`
      + `<td class="py-2 pr-3 whitespace-nowrap">${esc(prevMonthLabel(e.card.prev_month_min))}</td>`
      + `<td class="py-2 pr-3">${giftChip(e.benefit.giftcard)}</td>`
      + `<td class="py-2 whitespace-nowrap text-xs text-ink-500">${esc(e.card.verified_at)}${staleChip(e.stale)}<br>${sourceLink(e.card)}</td></tr>`).join("");
    return `<section id="m-${esc(m)}" class="mt-10" aria-labelledby="h-m-${esc(m)}"><h2 id="h-m-${esc(m)}" class="text-xl font-extrabold">${esc(merchantName[m] ?? m)}</h2>`
      + `<div class="mt-3 overflow-x-auto"><table class="w-full text-sm"><thead class="text-left text-xs text-ink-500"><tr><th class="py-2 pr-3 font-medium">카드</th><th class="py-2 pr-3 font-medium">혜택 · 월 한도</th><th class="py-2 pr-3 font-medium">전월실적</th><th class="py-2 pr-3 font-medium">상품권 구매 시</th><th class="py-2 font-medium">확인일 · 출처</th></tr></thead><tbody class="divide-y divide-ink-100">${rows}</tbody></table></div></section>`;
  }).join("");
}

/** 정적 api/cards.json: verified 카드만, benefits[].merchant_name 추가 */
export function publicCards(doc, { merchantName }) {
  return {
    updated_at: doc.updated_at,
    stale_after_days: doc.stale_after_days,
    cards: (doc.cards ?? []).filter((c) => c.status === "verified").map((c) => ({
      ...c,
      benefits: c.benefits.map((b) => ({ ...b, merchant_name: merchantName[b.merchant] ?? b.merchant })),
    })),
  };
}
