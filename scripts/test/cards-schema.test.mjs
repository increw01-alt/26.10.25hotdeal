import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCards } from "../lib/cards-schema.mjs";

const ctx = { merchantSlugs: new Set(["11st", "gmarket"]), issuerSlugs: new Set(["shinhan"]), issuerDomains: new Map([["shinhan", ["shinhancard.com"]]]), today: "2026-10-28" };
const ok = () => ({ updated_at: "2026-10-28", stale_after_days: 60, cards: [{
  slug: "shinhan-11st", issuer: "shinhan", name: "11번가 신한카드", type: "credit", annual_fee: "국내 1만원",
  prev_month_min: 300000, official_url: "https://www.shinhancard.com/x", verified_at: "2026-10-28", status: "verified",
  benefits: [{ merchant: "11st", kind: "discount", rate: 7, amount: null, cap: "월 1만원", giftcard: "excluded", note: "앱 결제 시" }],
}] });

test("정상 문서는 문제 0건", () => assert.deepEqual(validateCards(ok(), ctx), []));
test("빈 cards 배열도 정상", () => assert.deepEqual(validateCards({ updated_at: "2026-10-28", stale_after_days: 60, cards: [] }, ctx), []));
test("없는 판매처 slug는 카드 slug와 값을 들어 거부", () => {
  const d = ok(); d.cards[0].benefits[0].merchant = "kurly";
  const p = validateCards(d, ctx); assert.equal(p.length, 1); assert.match(p[0], /shinhan-11st/); assert.match(p[0], /kurly/);
});
test("없는 발급사 slug 거부", () => { const d = ok(); d.cards[0].issuer = "citi"; assert.match(validateCards(d, ctx)[0], /issuer/); });
test("card-gorilla.com 출처와 http 출처 거부", () => {
  const d1 = ok(); d1.cards[0].official_url = "https://www.card-gorilla.com/card/detail/1"; assert.match(validateCards(d1, ctx)[0], /card-gorilla/);
  const d2 = ok(); d2.cards[0].official_url = "http://www.shinhancard.com/x"; assert.match(validateCards(d2, ctx)[0], /https/);
});
test("rate와 amount가 모두 없으면 거부", () => { const d = ok(); d.cards[0].benefits[0].rate = null; assert.match(validateCards(d, ctx)[0], /rate|amount/); });
test("giftcard 누락·enum 밖 거부", () => {
  const d1 = ok(); delete d1.cards[0].benefits[0].giftcard; assert.match(validateCards(d1, ctx)[0], /giftcard/);
  const d2 = ok(); d2.cards[0].benefits[0].giftcard = "yes"; assert.match(validateCards(d2, ctx)[0], /giftcard/);
});
test("verified_at 형식 오류와 미래 날짜 거부", () => {
  const d1 = ok(); d1.cards[0].verified_at = "2026/10/28"; assert.match(validateCards(d1, ctx)[0], /verified_at/);
  const d2 = ok(); d2.cards[0].verified_at = "2026-10-29"; assert.match(validateCards(d2, ctx)[0], /verified_at/);
});
test("slug 중복 거부", () => { const d = ok(); d.cards.push(structuredClone(d.cards[0])); assert.match(validateCards(d, ctx).at(-1), /중복/); });
test("note 120자 초과 거부", () => { const d = ok(); d.cards[0].benefits[0].note = "가".repeat(121); assert.match(validateCards(d, ctx)[0], /note/); });
test("한 카드 안에 같은 판매처가 두 번 나오면 거부", () => {
  const d = ok(); d.cards[0].benefits.push({ ...d.cards[0].benefits[0] });
  const p = validateCards(d, ctx); assert.equal(p.length, 1); assert.match(p[0], /benefits\[1\]\.merchant/); assert.match(p[0], /중복/);
});
test("updated_at 미래 날짜 거부", () => { const d = ok(); d.updated_at = "2026-10-29"; assert.match(validateCards(d, ctx)[0], /updated_at/); });
test("official_url 호스트가 발급사 공식 도메인이 아니면 거부, 서브도메인은 허용", () => {
  const d1 = ok(); d1.cards[0].official_url = "https://www.example.com/card"; const p = validateCards(d1, ctx);
  assert.equal(p.length, 1); assert.match(p[0], /official_url/); assert.match(p[0], /shinhancard\.com/);
  const d2 = ok(); d2.cards[0].official_url = "https://pc.shinhancard.com/x"; assert.deepEqual(validateCards(d2, ctx), []);
  const d3 = ok(); d3.cards[0].official_url = "https://shinhancard.com.evil.test/x"; assert.equal(validateCards(d3, ctx).length, 1);
  const noDomains = { ...ctx, issuerDomains: new Map() }; assert.deepEqual(validateCards(d1, noDomains), []);
});
