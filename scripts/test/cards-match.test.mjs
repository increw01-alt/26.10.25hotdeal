import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveCardRecord, matchMerchants, giftcardStance, toMarkdown } from "../research/lib/match.mjs";

const merchants = [{ slug: "11st", aliases: ["11번가", "11st"] }, { slug: "naver", aliases: ["네이버", "네이버페이"] }];
const rec = { url: "https://api.example.test/v1/cards/123", body: { idx: 123, cate: "CRD", is_discon: false, corp: { name: "테스트카드" },
  name: "테스트 11번가 카드", pre_month_money: 300000, annual_fee_basic: "국내 [10,000]원",
  top_benefit: [{ title: "할인", tags: ["11번가 7%"] }],
  key_benefit: [{ title: "네이버페이", comment: "네이버페이 결제 2% 적립", info: "<p>상품권 구매 금액은 제외됩니다</p>" }] } };

test("판매중 카드 상세 레코드만 인식", () => {
  assert.equal(isLiveCardRecord(rec), true);
  assert.equal(isLiveCardRecord({ ...rec, url: "https://api.example.test/v1/cards/compare_top3/1" }), false);
  assert.equal(isLiveCardRecord({ ...rec, body: { ...rec.body, is_discon: true } }), false);
});
test("판매처 alias 매칭과 위치", () => {
  const m = matchMerchants(rec.body, merchants);
  assert.deepEqual(m.map((x) => [x.merchant, x.where]), [["11st", "top_benefit"], ["naver", "key_benefit"]]);
  assert.equal(m[1].text, "네이버페이 결제 2% 적립");
});
test("상품권 문맥 판정", () => {
  assert.equal(giftcardStance("상품권 구매 금액은 제외됩니다"), "excluded");
  assert.equal(giftcardStance("상품권 구매 시에도 5% 적립"), "positive");
  assert.equal(giftcardStance("선불카드 충전 시 1% 캐시백"), "positive");
  assert.equal(giftcardStance("주유 10% 할인"), "none");
});
test("Markdown에는 info 본문이 들어가지 않고 판매처별 표가 생긴다", () => {
  const c = { idx: 123, issuer: "테스트카드", name: "테스트 11번가 카드", type: "CRD", prevMonth: 300000, annualFee: "국내 [10,000]원", merchant: "11st", text: "11번가 7%", stance: "excluded", refUrl: "https://ref.example.test/123" };
  const md = toMarkdown({ byMerchant: new Map([["11st", [c]]]), positives: [] });
  assert.match(md, /## 11st/); assert.match(md, /테스트 11번가 카드/); assert.doesNotMatch(md, /제외됩니다/);
});
