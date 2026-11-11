import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { searchQuery, shopSearch, shopLinkHtml, buyButtonsHtml } from "../scripts/lib/shop.mjs";

// 쇼핑몰 주소를 못 얻은 딜(뽐뿌 글 등)은 판매처 검색 결과로 연결한다. 상품명은 모두 지어낸 것.
const merchants = [
  { slug: "gmarket", name: "지마켓", search_url: "https://www.gmarket.co.kr/n/search?keyword={q}" },
  { slug: "toss", name: "토스" },
];
const deal = (o) => ({ kind: "product", status: "live", merchant: "gmarket", product_name: "테스트 물티슈 100매 10팩", shop_url: null, ...o });

test("searchQuery: 괄호·대괄호 안과 기호를 빼고 앞 5단어", () => {
  assert.equal(searchQuery("[특가] 테스트 물티슈 100매 10팩 (9,900원/무료) + 사은품 증정 외 다수"), "테스트 물티슈 100매 10팩");
  assert.equal(searchQuery("테스트 청소기 V12, 신형/블랙"), "테스트 청소기 V12 신형 블랙");
  assert.equal(searchQuery("   "), "");
  // 행사 문구와 퍼센트는 검색을 흐리므로 뺀다
  assert.equal(searchQuery("테스트 패딩 FW 40~50% 할인 자켓, 바지 등 다양"), "테스트 패딩 FW 40 자켓");
  assert.equal(searchQuery("특가 무료배송 최대 쿠폰"), "");
  assert.equal(searchQuery(null), "");
});
test("searchQuery: 40자를 넘지 않게 단어 단위로 자른다", () => {
  const q = searchQuery("가나다라마바사아자차 가나다라마바사아자차 가나다라마바사아자차 가나다라마바사아자차 끝");
  assert.ok(q.length <= 40); assert.equal(q, "가나다라마바사아자차 가나다라마바사아자차 가나다라마바사아자차");
});
test("shopSearch: 검색 주소가 있는 판매처의 일반 딜만", () => {
  const s = shopSearch(deal(), merchants);
  assert.equal(s.url, `https://www.gmarket.co.kr/n/search?keyword=${encodeURIComponent("테스트 물티슈 100매 10팩")}`);
  assert.equal(s.merchantName, "지마켓");
  assert.equal(shopSearch(deal({ merchant: "toss" }), merchants), null);
  assert.equal(shopSearch(deal({ merchant: null }), merchants), null);
  assert.equal(shopSearch(deal({ kind: "gift" }), merchants), null);
  assert.equal(shopSearch(deal({ product_name: "(가격다양)" }), merchants), null);
});
test("shopSearch: 쇼핑몰 주소가 이미 있거나 종료된 딜은 만들지 않는다", () => {
  assert.equal(shopSearch(deal({ shop_url: "https://shop.test/p" }), merchants), null);
  assert.equal(shopSearch(deal({ status: "ended" }), merchants), null);
});
test("shopSearch: 상품명의 기호는 검색어에서 빠지고 주소는 인코딩된다", () => {
  const s = shopSearch(deal({ product_name: `테스트 "A&B" <x> 50%` }), merchants);
  assert.doesNotMatch(s.url, /["<>&]|keyword=.*[ ]/);
  assert.equal(s.url, `https://www.gmarket.co.kr/n/search?keyword=${encodeURIComponent("테스트 A B x")}`);
});
test("shopLinkHtml: 검색 링크는 '검색'이라고 적는다", () => {
  const html = shopLinkHtml(deal(), shopSearch(deal(), merchants));
  assert.match(html, /지마켓 검색/); assert.match(html, /href="https:\/\/www\.gmarket\.co\.kr\/n\/search\?keyword=/); assert.match(html, /rel="nofollow noopener"/);
  assert.doesNotMatch(shopLinkHtml(deal({ shop_url: "https://shop.test/p" }), null), /검색/);
  assert.equal(shopLinkHtml(deal(), null), "");
});
test("buyButtonsHtml: 검색 링크가 주 버튼, 원문 글이 보조, 검색 결과임을 알린다", () => {
  const html = buyButtonsHtml({ shopUrl: null, postUrl: "https://community.test/1", search: shopSearch(deal(), merchants) });
  assert.match(html, /class="btn-primary[^"]*">지마켓에서 상품명으로 검색</);
  assert.match(html, /href="https:\/\/community\.test\/1"[^>]*class="btn-ghost[^"]*">원문 글에서 정확한 링크 확인</);
  assert.match(html, /검색 결과라 같은 상품·가격이 아닐 수 있습니다/);
  assert.doesNotMatch(html, /쇼핑몰에서 보기/);
});
test("buyButtonsHtml: 쇼핑몰 주소가 있으면 검색 링크를 쓰지 않는다", () => {
  const html = buyButtonsHtml({ shopUrl: "https://www.shop.test/p", postUrl: "https://community.test/1", search: { url: "https://x.test/s?q=1", merchantName: "지마켓" } });
  assert.match(html, /쇼핑몰에서 보기/); assert.doesNotMatch(html, /상품명으로 검색/);
});
test("brands.json: 검색 주소는 https 이고 {q} 자리가 하나", async () => {
  const brands = JSON.parse(await readFile(new URL("../../shared/brands.json", import.meta.url), "utf8"));
  const withSearch = brands.merchants.filter((m) => m.search_url);
  assert.ok(withSearch.length >= 8);
  for (const m of withSearch) {
    assert.match(m.search_url, /^https:\/\/[^{}]+\{q\}[^{}]*$/, m.slug);
  }
  for (const slug of ["gmarket", "auction", "11st", "lotteon", "coupang", "naver"]) assert.ok(withSearch.some((m) => m.slug === slug), slug);
});
