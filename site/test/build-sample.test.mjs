// 샘플 데이터로 사이트를 실제로 빌드해 결과 파일을 확인한다(일반 핫딜 2단계).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (p) => path.join(root, "dist", p);
const read = (p) => readFileSync(dist(p), "utf8");
const ID = { coupang: "b1a2c3d4e5f60718", promo: "b2a2c3d4e5f60719", raw: "b3a2c3d4e5f6071a", descriptive: "b4a2c3d4e5f6071b", ended1: "b5a2c3d4e5f6071c", ended10: "b6a2c3d4e5f6071d", gift: "8815d95475eac671" };
/** 홈·목록의 카드 한 장 HTML */
const cardOf = (html, id) => { const s = html.slice(html.indexOf(`data-deal-id="${id}"`)); return s.slice(0, s.indexOf("</article>")); };

before(() => { execFileSync(process.execPath, ["scripts/build.mjs", "--sample"], { cwd: root, stdio: "pipe" }); });

test("홈: 종류 탭 세 개와 두 종류의 카드", () => {
  const html = read("index.html");
  for (const k of ["all", "gift", "product"]) assert.ok(html.includes(`data-kind-tab="${k}"`), k);
  assert.ok(html.includes('data-kind="product"')); assert.ok(html.includes('data-kind="gift"'));
  assert.ok(html.includes('href="/deals/"'));
  assert.ok(!html.includes(`data-deal-id="${ID.ended1}"`), "종료 딜은 홈에 없다");
});
test("홈: 일반 딜 카드에 판매처·가격·배송비·묶음 칩", () => {
  const html = read("index.html");
  const one = cardOf(html, ID.coupang);
  assert.match(one, /쿠팡/); assert.match(one, /제주 삼다수 2L 12개/); assert.match(one, /9,900원/); assert.match(one, /무료/); assert.match(one, /2곳에 올라옴/);
  assert.ok(html.includes(`data-deal-id="${ID.coupang}" data-kind="product" data-merchant="coupang"`));
  assert.match(cardOf(html, ID.raw), /하프클럽/);
  assert.match(cardOf(html, ID.descriptive), /가격다양/);
  assert.doesNotMatch(cardOf(html, ID.raw), /곳에 올라옴/);
});
test("전체 목록 페이지 세 종류", () => {
  for (const p of ["deals/index.html", "deals/gift/index.html", "deals/product/index.html"]) assert.ok(existsSync(dist(p)), p);
  assert.ok(read("deals/product/index.html").includes(`data-deal-id="${ID.coupang}"`));
  assert.ok(!read("deals/product/index.html").includes('data-kind="gift"'));
  assert.ok(!read("deals/gift/index.html").includes('data-kind="product"'));
  assert.ok(read("deals/index.html").includes('data-kind="gift"') && read("deals/index.html").includes('data-kind="product"'));
});
test("일반 딜 상세: 카드 혜택 섹션(상품권 칩 없음)", () => {
  const html = read(`deal/${ID.coupang}/index.html`);
  assert.match(html, /쿠팡 카드 혜택/); assert.match(html, /일반 상품을 결제할 때/);
  assert.doesNotMatch(html, /상품권 제외<|상품권 적용</);
  assert.doesNotMatch(html, /액면가/);
  assert.match(html, /배송비/); assert.match(html, /clien\.net/);
  assert.match(html, /"@type":"Offer"/); assert.match(html, /"price":9900/);
});
test("일반 딜 상세: 사전에 없는 판매처, 카드 행사 조건, 서술형 가격", () => {
  assert.match(read(`deal/${ID.raw}/index.html`), /이 판매처\(하프클럽\)는 아직 카드 혜택 표에 없습니다\./);
  assert.match(read(`deal/${ID.promo}/index.html`), /판매처 행사 조건/);
  const d = read(`deal/${ID.descriptive}/index.html`); assert.match(d, /가격다양/); assert.doesNotMatch(d, /"price":/);
});
test("일반 딜 상세는 종료 후 3일까지만 만든다", () => {
  assert.ok(!existsSync(dist(`deal/${ID.ended10}/index.html`)));
  const html = read(`deal/${ID.ended1}/index.html`);
  assert.match(html, /noindex/); assert.match(html, /href="\/deals\/product\/"/); assert.match(html, /종료된 딜입니다/);
});
test("상품권 딜 상세는 그대로다", () => {
  const html = read(`deal/${ID.gift}/index.html`);
  assert.match(html, /액면가/); assert.match(html, /지마켓 카드 혜택/); assert.match(html, /같은 조건의 과거 딜/);
});
test("정적 사본·사이트맵·헤더", () => {
  const api = JSON.parse(read("api/deals.json"));
  assert.ok(api.deals.some((d) => d.kind === "product")); assert.ok(api.deals.every((d) => d.status !== "ended"));
  assert.ok(api.deals.every((d) => !("_ended_days_ago" in d)));
  const sm = read("sitemap.xml");
  assert.match(sm, /\/deals\/<\/loc>/); assert.match(sm, /\/deals\/product\/<\/loc>/); assert.ok(sm.includes(`/deal/${ID.coupang}/`)); assert.ok(!sm.includes(`/deal/${ID.ended1}/`));
  assert.match(read("index.html"), /href="\/deals\/"[^>]*>전체 딜</);
});
test("주간 비교·브랜드 허브에는 일반 딜이 없다", () => {
  for (const f of ["weekly/index.html", "brands/index.html"]) assert.ok(!read(f).includes("삼다수"), f);
  assert.ok(!existsSync(dist("brands/-/index.html")));
});
