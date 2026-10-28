import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCardIndex, entriesForMerchant, renderDealCardSection, renderCardsPageSections, publicCards } from "../scripts/lib/card-benefits.mjs";

const card = (o) => ({ type: "credit", annual_fee: null, prev_month_min: 0, official_url: "https://x.example/x", verified_at: "2026-10-01", status: "verified", ...o });
const doc = { updated_at: "2026-10-28", stale_after_days: 60, cards: [
  card({ slug: "a-11st", issuer: "shinhan", name: "A 11번가 카드", prev_month_min: 300000, benefits: [{ merchant: "11st", kind: "discount", rate: 7, amount: null, cap: "월 1만원", giftcard: "excluded", note: "앱 결제" }] }),
  card({ slug: "b-11st", issuer: "kb", name: "B 체크", type: "check", verified_at: "2026-06-01", benefits: [{ merchant: "11st", kind: "cashback", rate: null, amount: 2000, cap: null, giftcard: "applies", note: "<b>주의</b>" }] }),
  card({ slug: "c-11st", issuer: "kb", name: "C 미확인", status: "unverified", benefits: [{ merchant: "11st", kind: "points", rate: 10, amount: null, cap: null, giftcard: "applies", note: "" }] }),
  card({ slug: "d-gmarket", issuer: "shinhan", name: "D 지마켓 카드", benefits: [{ merchant: "gmarket", kind: "points", rate: 5, amount: null, cap: null, giftcard: "unknown", note: "" }] }),
] };
const names = { merchantName: { "11st": "11번가", gmarket: "지마켓", naver: "네이버" }, issuerName: { shinhan: "신한카드", kb: "KB국민카드" } };
const index = buildCardIndex(doc, { now: new Date("2026-10-28T00:00:00Z") });

test("verified만 색인하고 applies가 먼저", () => assert.deepEqual(entriesForMerchant(index, "11st").map((e) => e.card.slug), ["b-11st", "a-11st"]));
test("60일 넘은 확인일은 stale", () => { const e = entriesForMerchant(index, "11st"); assert.equal(e[0].stale, true); assert.equal(e[1].stale, false); });
test("판매처 없으면 안내 문구", () => assert.match(renderDealCardSection({ index, merchant: null, ...names }), /판매처가 확인되지 않아 카드 혜택을 연결하지 못했습니다\./));
test("applies는 본문, excluded는 details 안, note 이스케이프, stale 표시, unverified 제외", () => {
  const html = renderDealCardSection({ index, merchant: "11st", ...names });
  assert.match(html, /B 체크/); assert.match(html, /&lt;b&gt;주의&lt;\/b&gt;/); assert.doesNotMatch(html, /<b>주의/);
  assert.ok(html.indexOf("A 11번가 카드") > html.indexOf("<details"));
  assert.match(html, /재확인 필요/); assert.doesNotMatch(html, /C 미확인/);
  assert.match(html, /이 사이트는 카드를 모집하지 않습니다\./);
});
test("applies 없고 excluded·unknown만 있으면 없음 문구 + 접힌 목록", () => {
  const html = renderDealCardSection({ index, merchant: "gmarket", ...names });
  assert.match(html, /지마켓에서 상품권 결제에 혜택을 주는 카드는 없습니다\./); assert.match(html, /<details/); assert.match(html, /상품권 적용 미확인/);
});
test("카드가 하나도 없는 판매처는 없음 문구만", () => {
  const html = renderDealCardSection({ index, merchant: "naver", ...names });
  assert.match(html, /네이버에서 상품권 결제에 혜택을 주는 카드는 없습니다\./); assert.doesNotMatch(html, /<details/);
});
test("딜 제목의 카드 행사 조건이 있으면 카드 자체 혜택과 별개임을 한 줄로 알린다", () => {
  const withPromo = renderDealCardSection({ index, merchant: "gmarket", promoNote: "현대카드 8% 즉시할인", ...names });
  assert.match(withPromo, /현대카드 8% 즉시할인/); assert.match(withPromo, /판매처 행사 조건/);
  assert.ok(withPromo.indexOf("판매처 행사 조건") < withPromo.indexOf("혜택을 주는 카드는 없습니다"));
  const noPromo = renderDealCardSection({ index, merchant: "gmarket", promoNote: null, ...names });
  assert.doesNotMatch(noPromo, /판매처 행사 조건/);
});
test("publicCards는 verified만, merchant_name 포함", () => {
  const pub = publicCards(doc, names); assert.equal(pub.cards.length, 3); assert.equal(pub.cards[0].benefits[0].merchant_name, "11번가");
});
test("cards 페이지는 카드 있는 판매처 섹션만, 순서 유지", () => {
  const html = renderCardsPageSections({ index, merchantsOrder: ["naver", "gmarket", "11st"], ...names });
  assert.doesNotMatch(html, /id="m-naver"/); assert.ok(html.indexOf('id="m-gmarket"') < html.indexOf('id="m-11st"'));
  assert.match(html, /상품권 구매 시/);
});
