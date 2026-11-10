import { test } from "node:test";
import assert from "node:assert/strict";
import { dealKind, pickHomeDeals, paginate, listPath, productPageEligible, priceLabel, merchantLabel } from "../scripts/lib/deals.mjs";
import { safeUrl, shopHost, thumbHtml, shopLinkHtml, buyButtonsHtml } from "../scripts/lib/shop.mjs";

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

// ---------- 쇼핑몰 바로가기·썸네일 (D-22) ----------
test("safeUrl: http(s) 만, 이미지는 https 만", () => {
  assert.equal(safeUrl("https://shop.test/a?b=1"), "https://shop.test/a?b=1");
  assert.equal(safeUrl("http://shop.test/a"), "http://shop.test/a");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//shop.test/a", "shop.test", "", null, undefined, 7]) assert.equal(safeUrl(bad), null);
  assert.equal(safeUrl("http://img.test/a.jpg", { httpsOnly: true }), null);
  assert.equal(safeUrl("https://img.test/a.jpg", { httpsOnly: true }), "https://img.test/a.jpg");
});
test("shopHost: www 를 뗀 도메인", () => {
  assert.equal(shopHost("https://www.lotteon.com/p/1"), "lotteon.com");
  assert.equal(shopHost("https://link.coupang.com/a/x"), "link.coupang.com");
  assert.equal(shopHost("nope"), null);
});
test("thumbHtml: 이미지가 있으면 img, 없으면 판매처 첫 글자 자리 표시", () => {
  const withImg = thumbHtml({ image_url: "https://img.test/a.jpg?x=1&y=2" }, "롯데온");
  assert.match(withImg, /<img [^>]*src="https:\/\/img\.test\/a\.jpg\?x=1&amp;y=2"/);
  assert.match(withImg, /loading="lazy"/); assert.match(withImg, /referrerpolicy="no-referrer"/); assert.match(withImg, /alt=""/); assert.match(withImg, /data-thumb/);
  assert.match(withImg, />롯</); // 이미지가 안 뜰 때 보일 자리 표시가 밑에 깔려 있다
  const noImg = thumbHtml({ image_url: null }, "쿠팡");
  assert.doesNotMatch(noImg, /<img/); assert.match(noImg, />쿠</);
  assert.doesNotMatch(thumbHtml({ image_url: "javascript:alert(1)" }, "x"), /<img/);
  assert.doesNotMatch(thumbHtml({ image_url: "http://img.test/a.jpg" }, "x"), /<img/);
  assert.match(thumbHtml({}, "<b>"), /&lt;/); assert.doesNotMatch(thumbHtml({}, "<b>"), /<b>/);
  assert.match(thumbHtml({}, ""), />·</);
});
test("thumbHtml: 주소의 따옴표는 속성을 깨지 못한다", () => {
  const html = thumbHtml({ image_url: 'https://img.test/a.jpg"onerror="alert(1)' }, "x");
  assert.doesNotMatch(html, /"onerror="/);
});
test("shopLinkHtml: 쇼핑몰 주소가 있을 때만 카드 링크", () => {
  const html = shopLinkHtml({ shop_url: "https://www.shop.test/p?a=1&b=2", status: "live" });
  assert.match(html, /href="https:\/\/www\.shop\.test\/p\?a=1&amp;b=2"/); assert.match(html, /rel="nofollow noopener"/); assert.match(html, /target="_blank"/); assert.match(html, /쇼핑몰/);
  assert.equal(shopLinkHtml({ shop_url: null, status: "live" }), "");
  assert.equal(shopLinkHtml({ shop_url: "javascript:alert(1)", status: "live" }), "");
  assert.equal(shopLinkHtml({ shop_url: "https://shop.test/p", status: "ended" }), "");
});
test("buyButtonsHtml: 쇼핑몰 주소가 있으면 주 버튼은 쇼핑몰, 원문은 보조", () => {
  const html = buyButtonsHtml({ shopUrl: "https://www.shop.test/p/1", postUrl: "https://community.test/1" });
  assert.match(html, /href="https:\/\/www\.shop\.test\/p\/1"[^>]*class="btn-primary/);
  assert.match(html, /쇼핑몰에서 보기 \(shop\.test\)/);
  assert.match(html, /href="https:\/\/community\.test\/1"/); assert.match(html, /커뮤니티 원문 글/);
  assert.ok(html.indexOf("쇼핑몰에서 보기") < html.indexOf("커뮤니티 원문 글"));
  assert.match(html, /쇼핑몰 주소는 커뮤니티 글에 올라온 그대로입니다/);
});
test("buyButtonsHtml: 쇼핑몰 주소가 없거나 이상하면 원문 글이 주 버튼", () => {
  for (const shopUrl of [null, "javascript:alert(1)"]) {
    const html = buyButtonsHtml({ shopUrl, postUrl: "https://community.test/1", rel: "nofollow noopener sponsored" });
    assert.match(html, /href="https:\/\/community\.test\/1" rel="nofollow noopener sponsored"[^>]*class="btn-primary/);
    assert.match(html, /원문 글에서 구매처 확인/); assert.doesNotMatch(html, /쇼핑몰에서 보기/);
  }
});
