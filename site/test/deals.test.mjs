import { test } from "node:test";
import assert from "node:assert/strict";
import { dealKind, pickHomeDeals, paginate, listPath, productPageEligible, priceLabel, merchantLabel } from "../scripts/lib/deals.mjs";

const deal = (o) => ({ id: "x", status: "live", score: 0, ...o });

test("dealKind: kind가 없거나 모르는 값이면 상품권", () => {
  assert.equal(dealKind({}), "gift");
  assert.equal(dealKind({ kind: "gift" }), "gift");
  assert.equal(dealKind({ kind: "product" }), "product");
  assert.equal(dealKind({ kind: "other" }), "gift");
});

test("pickHomeDeals: 점수순 상위 60건 + 못 든 진행 중 상품권 전부, 종료 딜 제외", () => {
  const products = Array.from({ length: 70 }, (_, i) => deal({ id: `p${i}`, kind: "product", score: 100 - i }));
  const gifts = [deal({ id: "g1", score: 1 }), deal({ id: "g2", kind: "gift", score: 0.5, status: "ending" }), deal({ id: "g3", score: 0.1 })];
  const ended = [deal({ id: "e1", score: 999, status: "ended" }), deal({ id: "e2", kind: "product", score: 999, status: "ended" })];
  const out = pickHomeDeals([...gifts, ...ended, ...products]);
  assert.equal(out.length, 63);
  assert.deepEqual(out.slice(0, 2).map((d) => d.id), ["p0", "p1"]);
  assert.deepEqual(out.slice(60).map((d) => d.id), ["g1", "g2", "g3"]);
  assert.ok(!out.some((d) => d.status === "ended"));
});
test("pickHomeDeals: 상위 안에 든 상품권은 두 번 넣지 않는다", () => {
  const out = pickHomeDeals([deal({ id: "g1", score: 5 }), deal({ id: "p1", kind: "product", score: 3 })], 60);
  assert.deepEqual(out.map((d) => d.id), ["g1", "p1"]);
});

test("paginate: 50건씩, 빈 목록은 빈 쪽 하나", () => {
  assert.deepEqual(paginate(Array.from({ length: 120 }, (_, i) => i)).map((p) => p.length), [50, 50, 20]);
  assert.deepEqual(paginate([]), [[]]);
  assert.deepEqual(paginate([1, 2, 3], 2), [[1, 2], [3]]);
});

test("listPath", () => {
  assert.equal(listPath("all", 1), "/deals/");
  assert.equal(listPath("all", 2), "/deals/2/");
  assert.equal(listPath("gift", 1), "/deals/gift/");
  assert.equal(listPath("product", 1), "/deals/product/");
  assert.equal(listPath("product", 2), "/deals/product/2/");
});

test("productPageEligible: 진행 중이거나 종료 후 3일 이내", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  assert.equal(productPageEligible({ status: "live" }, now), true);
  assert.equal(productPageEligible({ status: "ended", ended_at: "2026-11-08T00:00:00Z" }, now), true);
  assert.equal(productPageEligible({ status: "ended", ended_at: "2026-11-06T00:00:00Z" }, now), false);
  assert.equal(productPageEligible({ status: "ended", ended_at: null }, now), true);
  assert.equal(productPageEligible({ status: "ended", ended_at: "2026-11-06T00:00:00Z" }, now, 30), true);
});

test("priceLabel: 숫자 가격, 서술형 가격, 없음", () => {
  assert.equal(priceLabel({ sale_price: 9900, price_kind: "exact" }), "9,900원");
  assert.equal(priceLabel({ sale_price: null, price_kind: "descriptive", price_text: "가격다양" }), "가격다양");
  assert.equal(priceLabel({ sale_price: null }), "—");
});

test("merchantLabel: 사전 이름 → 원문 표기 → 미확인", () => {
  const names = { coupang: "쿠팡" };
  assert.equal(merchantLabel({ merchant: "coupang" }, names), "쿠팡");
  assert.equal(merchantLabel({ merchant: null, merchant_raw: "하프클럽" }, names), "하프클럽");
  assert.equal(merchantLabel({ merchant: null, merchant_raw: null }, names), "판매처 미확인");
  assert.equal(merchantLabel({ merchant: "newshop" }, names), "newshop");
});
