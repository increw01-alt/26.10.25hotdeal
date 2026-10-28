# 쇼핑몰별 카드 혜택 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공식 출처로 검증한 "쇼핑몰 × 카드 혜택" 표를 `shared/cards.json`에 만들고, 딜 상세와 새 `/cards/` 페이지에 상품권 적용 여부를 구분해 보여 준다.

**Architecture:** 데이터는 `shared/cards.json` 한 파일, 검증기는 `scripts/check-cards.mjs`(CI·배포 전 실행). 카드고릴라 크롤에서 후보를 뽑는 조사 스크립트는 `scripts/research/`에 두되 결과는 저장소 밖에 쓴다. 사이트는 기존 `build.mjs` 템플릿 방식 그대로, 렌더링 로직만 `site/scripts/lib/card-benefits.mjs`로 분리해 `node:test`로 검증한다.

**Tech Stack:** Node 22+ ESM, `node:test` + `node:assert/strict`(새 의존성 없음), 기존 Tailwind CLI 빌드, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-28-card-benefits-design.md`

## Global Constraints

- 저장소는 공개다. 카드고릴라 문구·이미지·링크는 코드·문서·픽스처 어디에도 넣지 않는다. 테스트 픽스처는 합성 문자열만 쓴다.
- `official_url`은 `https://`로 시작하고 `card-gorilla.com`을 포함하지 않는다. `verified_at`은 `YYYY-MM-DD`, 오늘 이후 불가.
- `giftcard`는 `applies` | `excluded` | `unknown` 중 하나를 반드시 적는다. `status=verified`만 공개한다.
- 파일은 CRLF. Bash heredoc으로 코드를 쓰지 않는다(백슬래시 소실). Write/Edit 도구를 쓴다.
- 새 npm 의존성을 추가하지 않는다. 테스트는 `node --test`.
- 작업 브랜치 `feat/card-benefits`에서 커밋하고, Task 7에서 검증 후 `main`에 fast-forward로 올린다(`main` push = 배포).
- 공개 문구(스펙 "페이지 동작"의 따옴표 문장)는 글자 그대로 쓴다.

## Review Focus

1. `deal.merchant`가 `null`인 딜 → 섹션이 "판매처가 확인되지 않아 카드 혜택을 연결하지 못했습니다."를 내고 빌드가 멈추지 않는다. (Task 4 테스트)
2. 해당 판매처의 verified 카드가 전부 `excluded`/`unknown` → "…혜택을 주는 카드는 없습니다." 문구가 나오고, 그 카드들은 접힌 목록에 남는다. (Task 4 테스트)
3. `verified_at`이 60일을 넘은 카드 → 숨기지 않고 "재확인 필요" 표시만 붙는다. (Task 4 테스트)
4. `benefits[].merchant`가 `brands.json`에 없는 slug → 검증기가 카드 slug와 잘못된 값을 함께 말하며 실패한다. (Task 1 테스트)
5. 샘플 데이터 빌드(CI)에서 cards.json의 판매처가 샘플 딜에 없어도 `/cards/`와 딜 페이지가 모두 생성된다. (Task 6 검증 단계)

---

### Task 1: cards.json 스키마와 검증기

**Files:**
- Create: `shared/cards.json`
- Create: `scripts/lib/cards-schema.mjs`
- Create: `scripts/check-cards.mjs`
- Test: `scripts/test/cards-schema.test.mjs`
- Modify: `.github/workflows/ci.yml` (site 잡), `.github/workflows/deploy-site.yml` (설정 검사 단계 뒤)

**Interfaces:**
- Produces: `validateCards(doc, { merchantSlugs: Set<string>, issuerSlugs: Set<string>, today: string }) → string[]` (문제 없으면 빈 배열). 메시지 형식: `cards[i] <slug>: <필드> <설명>`.
- Produces: `shared/cards.json` 구조(스펙 "데이터 모델" 그대로). 초기값은 `cards: []`, `updated_at: "2026-10-28"`, `stale_after_days: 60`.

- [ ] **Step 1: 실패하는 테스트 작성** — `scripts/test/cards-schema.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCards } from "../lib/cards-schema.mjs";

const ctx = { merchantSlugs: new Set(["11st", "gmarket"]), issuerSlugs: new Set(["shinhan"]), today: "2026-10-28" };
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
```

- [ ] **Step 2: 실패 확인** — Run: `node --test scripts/test/` → Expected: `ERR_MODULE_NOT_FOUND` (cards-schema.mjs 없음)

- [ ] **Step 3: `scripts/lib/cards-schema.mjs` 구현** — `export function validateCards(doc, ctx)`. 검사 항목: 최상위 `updated_at`(날짜)·`stale_after_days`(양의 정수)·`cards`(배열); 카드별 `slug`(`/^[a-z0-9]+(-[a-z0-9]+)*$/`, 중복), `issuer`∈issuerSlugs, `name` 비어 있지 않음, `type`∈{credit,check}, `prev_month_min` 0 이상 정수, `official_url`(https·card-gorilla 금지), `verified_at`(형식·`ctx.today` 이하), `status`∈{verified,unverified,discontinued}, `benefits` 1개 이상; 혜택별 `merchant`∈merchantSlugs, `kind`∈{discount,points,cashback}, `rate`(0~100 숫자) 또는 `amount`(양의 정수) 중 하나, `giftcard`∈{applies,excluded,unknown}, `note` 문자열 120자 이하. `annual_fee`·`cap`은 문자열 또는 null.

- [ ] **Step 4: 테스트 통과 확인** — Run: `node --test scripts/test/` → Expected: `pass 10`

- [ ] **Step 5: `scripts/check-cards.mjs` CLI** — `shared/brands.json`에서 slug 집합을 만들고 `shared/cards.json`을 검증. `today`는 KST 기준 `YYYY-MM-DD`. 문제가 있으면 `✘ 카드 데이터 검사 실패:` 뒤에 줄마다 출력하고 `process.exit(1)`, 없으면 `✓ cards.json: 카드 N장, verified M장` 출력. `shared/cards.json`을 초기값으로 생성.

- [ ] **Step 6: 수동 확인** — Run: `node scripts/check-cards.mjs` → Expected: `✓ cards.json: 카드 0장, verified 0장`, 종료 코드 0

- [ ] **Step 7: CI·배포 워크플로에 단계 추가** — `ci.yml` site 잡의 `npm ci` 다음에 `- run: node --test ../scripts/test/` 와 `- run: node ../scripts/check-cards.mjs`. `deploy-site.yml`의 "설정 검사" 단계 다음에 `- name: 카드 데이터 검사` / `run: node ../scripts/check-cards.mjs`.

- [ ] **Step 8: 커밋**

```bash
git checkout -b feat/card-benefits
git add shared/cards.json scripts/lib/cards-schema.mjs scripts/check-cards.mjs scripts/test/cards-schema.test.mjs .github/workflows/ci.yml .github/workflows/deploy-site.yml
git commit -m "feat(cards): 쇼핑몰별 카드 혜택 데이터 스키마와 검증기, CI·배포 전 검사"
```

---

### Task 2: 카드고릴라 크롤 후보 추출 스크립트(조사용)

**Files:**
- Create: `scripts/research/lib/match.mjs`
- Create: `scripts/research/cards-from-crawl.mjs`
- Test: `scripts/test/cards-match.test.mjs`

**Interfaces:**
- Produces: `isLiveCardRecord(rec) → boolean` (`rec.url`이 `/v1/cards/<숫자>`로 끝나고 `rec.body.is_discon === false`)
- Produces: `matchMerchants(body, merchants) → Array<{ merchant: string, where: "top_benefit"|"key_benefit", text: string }>` (`merchants`는 `brands.json`의 `[{slug, aliases}]`, 정규화: 소문자·공백 제거, `includes`)
- Produces: `giftcardStance(text) → "excluded"|"positive"|"none"`
- Produces: `toMarkdown({ byMerchant: Map<string, Candidate[]>, positives: Candidate[] }) → string`; `Candidate = { idx, issuer, name, type: "CRD"|"CHK", prevMonth: number, annualFee: string, merchant, text, stance, refUrl }`

- [ ] **Step 1: 실패하는 테스트 작성** — `scripts/test/cards-match.test.mjs` (픽스처는 합성 문자열)

```js
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
```

- [ ] **Step 2: 실패 확인** — Run: `node --test scripts/test/cards-match.test.mjs` → Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: `scripts/research/lib/match.mjs` 구현** — 위 네 함수. `giftcardStance`: `상품권|기프트카드|선불` 근처(앞뒤 60자) `제외|불가|해당되지|않습니다`면 `excluded`; `(상품권|선불|충전)[^.]{0,30}(적립|할인|캐시백|시에도|포함)`이고 제외 문맥이 아니면 `positive`; 그 외 `none`. `toMarkdown`: 판매처별 `## <slug>` 아래 표(`| idx | 발급사 | 카드 | 종류 | 전월실적 | 연회비 | 매칭 문구 | 상품권 | 참고 |`), 카드명에 판매처 alias가 들어간 전용 카드를 먼저, 마지막에 `## 상품권·충전 긍정 문맥` 표.

- [ ] **Step 4: 테스트 통과 확인** — Run: `node --test scripts/test/` → Expected: `pass 14`

- [ ] **Step 5: `scripts/research/cards-from-crawl.mjs` CLI** — 인자 `<api폴더> [--out <파일>]`. 폴더의 `*.json`을 `JSON.parse`로만 읽고(실패 파일은 건너뜀, 개수만 집계), `isLiveCardRecord`로 거르고 `body.idx`로 중복 제거, `shared/brands.json` merchants로 `matchMerchants`, 각 후보의 `stance`는 해당 카드의 모든 `key_benefit[].info`를 태그 제거 후 이어 붙여 `giftcardStance`로 판정. `refUrl`은 `https://www.card-gorilla.com/card/detail/<idx>`(조사 파일에만 기록). 기본 출력 경로는 `path.resolve(apiDir, "..", "..", "candidates.md")`. 마지막에 `카드 N장 중 판매처 매칭 M장, 긍정 문맥 K장 → <경로>` 출력. 출력 경로가 저장소 안이면 오류로 종료.

- [ ] **Step 6: 실제 크롤로 실행** — Run: `node scripts/research/cards-from-crawl.mjs "<로컬 크롤 폴더>/output/api"` (저장소 밖) → Expected: 요약 한 줄, `<로컬 크롤 폴더>/candidates.md` 생성, `git status`에 새 파일 없음

- [ ] **Step 7: 커밋**

```bash
git add scripts/research scripts/test/cards-match.test.mjs
git commit -m "feat(research): 카드고릴라 크롤에서 판매처별 카드 후보 추출 스크립트(결과는 저장소 밖)"
```

---

### Task 3: 카드 데이터 시드(공식 출처 검증)

**Files:**
- Modify: `shared/cards.json`
- Modify(필요 시): `shared/brands.json` (`merchants`, `card_issuers` 추가)

**Interfaces:**
- Consumes: Task 2의 `candidates.md`, Task 1의 `validateCards`.
- Produces: `status=verified` 카드 12~20장, 판매처 `gmarket, auction, 11st, naver, ssg, coupang, lotteon, kakao, toss, payco` 중 8개 이상 커버.

- [ ] **Step 1: 후보 선정** — `candidates.md`에서 판매처별로 전용 카드(PLCC) 우선 1~3장을 고른다. 카드고릴라 문구는 보지 않은 것으로 치고, 카드사 공식 페이지를 찾는 열쇠(발급사·카드명)로만 쓴다.

- [ ] **Step 2: 공식 페이지 확인** — 카드마다 발급사 공식 상품 페이지(또는 공식 유의사항 PDF)를 열어 (a) 해당 판매처 혜택의 종류·율/금액·월 한도·전월실적, (b) 상품권·선불충전 제외 문구를 읽는다. 읽은 그대로 `giftcard`를 정하고, 확인한 URL을 `official_url`, 오늘 날짜를 `verified_at`에 적는다. 공식 페이지에서 확인하지 못한 카드는 `status: "unverified"`로 넣고 `verified_at`은 조사일로 둔다.

- [ ] **Step 3: brands.json 보강** — 필요한 발급사·판매처가 없으면 추가(예: `card_issuers`에 `{ "slug": "ibk", "name": "IBK기업은행", "aliases": ["기업은행카드", "ibk카드"] }`). 판매처 alias는 딜 파서에도 쓰이므로 짧은 일반어는 넣지 않는다.

- [ ] **Step 4: 검증** — Run: `node scripts/check-cards.mjs` → Expected: `✓ cards.json: 카드 N장, verified M장` (M ≥ 12). brands.json을 바꿨으면 Run: `cd worker && npx vitest run` → Expected: 전부 통과.

- [ ] **Step 5: 커밋** — 메시지에 verified/unverified 장수와 커버한 판매처를 적는다.

```bash
git add shared/cards.json shared/brands.json
git commit -m "data(cards): 공식 출처로 확인한 카드 N장 시드 (판매처 8곳)"
```

---

### Task 4: 사이트 렌더링 라이브러리

**Files:**
- Create: `site/scripts/lib/card-benefits.mjs`
- Test: `site/test/card-benefits.test.mjs`
- Modify: `site/package.json` (`"test": "node --test test/"`), `.github/workflows/ci.yml` site 잡에 `- run: npm test`

**Interfaces:**
- Produces: `esc(s) → string` (build.mjs의 것과 동일 동작, Task 5에서 build.mjs가 이것을 import)
- Produces: `buildCardIndex(doc, { now: Date }) → { byMerchant: Map<string, Entry[]>, staleAfterDays: number, updatedAt: string }`, `Entry = { card, benefit, stale: boolean }`, verified만 포함
- Produces: `entriesForMerchant(index, merchant) → Entry[]` 정렬: `giftcard==="applies"` 먼저, 그다음 `rate ?? 0` 내림차순, 그다음 카드명
- Produces: `renderDealCardSection({ index, merchant, merchantName, issuerName }) → string` (section HTML 전체, 제목 `<h2 id="h-cards">`)
- Produces: `renderCardsPageSections({ index, merchantsOrder: string[], merchantName, issuerName }) → string` (판매처별 `<section id="m-<slug>">`, 카드 없는 판매처는 생략)
- Produces: `publicCards(doc, { merchantName }) → { updated_at, stale_after_days, cards }` (verified만, `benefits[].merchant_name` 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `site/test/card-benefits.test.mjs`

```js
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
test("publicCards는 verified만, merchant_name 포함", () => {
  const pub = publicCards(doc, names); assert.equal(pub.cards.length, 3); assert.equal(pub.cards[0].benefits[0].merchant_name, "11번가");
});
test("cards 페이지는 카드 있는 판매처 섹션만, 순서 유지", () => {
  const html = renderCardsPageSections({ index, merchantsOrder: ["naver", "gmarket", "11st"], ...names });
  assert.doesNotMatch(html, /id="m-naver"/); assert.ok(html.indexOf('id="m-gmarket"') < html.indexOf('id="m-11st"'));
  assert.match(html, /상품권 구매 시/);
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd site && node --test test/` → Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: `site/scripts/lib/card-benefits.mjs` 구현** — 위 Interfaces의 함수. 혜택 요약 문자열은 `kind` 라벨(할인/적립/캐시백) + `rate`면 `${rate}%`, 아니면 `${amount.toLocaleString("ko-KR")}원` + `cap`이 있으면 ` · ${cap}`. 전월실적은 0이면 "실적 조건 없음", 아니면 `${만원 단위}만원 이상`. 각 카드 행에 `확인 ${verified_at}` 과 `<a href=official_url rel="nofollow noopener" target="_blank">공식 안내</a>`, stale면 `<span class="chip bg-amber-50 text-amber-800">재확인 필요</span>`. `unknown`이면 `<span class="chip bg-surface-muted text-ink-700">상품권 적용 미확인</span>`, `excluded`면 `상품권 제외` 칩. 딜 섹션 고정 안내문은 스펙 문장 그대로. 기존 클래스(`.card`, `.chip`, `.stat`, `text-ink-500`)만 사용.

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd site && npm test` → Expected: `pass 8`

- [ ] **Step 5: 커밋**

```bash
git add site/scripts/lib/card-benefits.mjs site/test/card-benefits.test.mjs site/package.json .github/workflows/ci.yml
git commit -m "feat(site): 카드 혜택 렌더링 라이브러리(판매처별 색인·딜 섹션·카드 페이지·공개 JSON) + 테스트"
```

---

### Task 5: 딜 상세 페이지에 카드 혜택 섹션 연결

**Files:**
- Modify: `site/templates/deal.html` ("구매 조건" `</section>` 바로 뒤에 `{{cardBenefits}}`)
- Modify: `site/scripts/build.mjs` (공용 설정 블록에서 `shared/cards.json` 로드와 `buildCardIndex`; 딜 상세 `render("deal", {...})`에 `cardBenefits: raw(renderDealCardSection({ index: cardIndex, merchant: deal.merchant ?? null, merchantName, issuerName }))`; 로컬 `esc`를 lib import로 교체)

**Interfaces:**
- Consumes: Task 4의 `esc`, `buildCardIndex`, `renderDealCardSection`.

- [ ] **Step 1: 템플릿과 build.mjs 수정** — 위 Files대로. `cardIndex`는 `NOW` 기준.

- [ ] **Step 2: 샘플 빌드 확인** — Run: `cd site && node scripts/build.mjs --sample && grep -c 'id="h-cards"' dist/deal/8815d95475eac671/index.html && grep -c "이 사이트는 카드를 모집하지 않습니다" dist/deal/8815d95475eac671/index.html` → Expected: 두 줄 모두 `1`, 빌드 로그 `[build] mode=sample …` 정상

- [ ] **Step 3: 기존 테스트 회귀 확인** — Run: `cd site && npm test` → Expected: `pass 8`

- [ ] **Step 4: 커밋**

```bash
git add site/templates/deal.html site/scripts/build.mjs
git commit -m "feat(site): 딜 상세에 판매처 카드 혜택 섹션(상품권 적용/제외 구분)"
```

---

### Task 6: `/cards/` 페이지, 메뉴, 정적 `api/cards.json`

**Files:**
- Create: `site/templates/cards.html`
- Modify: `site/templates/partials/header.html` (데스크톱·모바일 메뉴 "주간 비교" 다음에 `<a href="/cards/">카드 혜택</a>`)
- Modify: `site/scripts/build.mjs` (`mkdir` 목록에 `"cards"`; 섹션 5 뒤에 `/cards/` emit; 섹션 6에 `api/cards.json` 기록)

**Interfaces:**
- Consumes: Task 4의 `renderCardsPageSections`, `publicCards`.
- `/cards/` 템플릿 변수: `{{intro}}`(스펙 도입 문단: 상품권 제외 원칙 설명, 우리 표현), `{{updatedAt}}`, `{{merchantSections}}`, `{{crumbs}}`, 공용 변수.

- [ ] **Step 1: 템플릿 작성** — `brands-index.html` 골격을 따른다. `<h1>쇼핑몰별 카드 혜택</h1>`, 도입 문단, "상품권 구매 시" 열의 의미를 설명하는 범례 3줄(적용/제외/미확인), `{{merchantSections}}`, 마지막에 스펙 고정 안내문.

- [ ] **Step 2: build.mjs 연결** — `emit("/cards/", await render("cards", { ...common, title: "쇼핑몰별 카드 혜택 | " + site.siteName, description: "지마켓·11번가·네이버·SSG닷컴 등 쇼핑몰별로 지금 혜택을 주는 카드와 상품권 구매 적용 여부를 공식 안내 기준으로 정리했습니다.", canonical: site.siteUrl + "/cards/", jsonld: ld([...orgLd, breadcrumbLd(crumbItems)]), crumbs, intro, updatedAt, merchantSections: raw(...) }))`. `merchantsOrder`는 `brandsJson.merchants.map((m) => m.slug)`. `writeFile(dist/api/cards.json, JSON.stringify(publicCards(cardsDoc, { merchantName })))`.

- [ ] **Step 3: 샘플 빌드 확인** — Run: `cd site && node scripts/build.mjs --sample && test -s dist/cards/index.html && grep -c 'href="/cards/"' dist/index.html && node -e "const j=require('./dist/api/cards.json'); console.log(j.cards.every(c=>c.status==='verified'), j.cards.length)" && grep -c "/cards/" dist/sitemap.xml` → Expected: 메뉴 링크 `2` 이상(데스크톱+모바일), `true N`, 사이트맵 `1`

- [ ] **Step 4: CSS 빌드 확인** — Run: `cd site && npm run build:css && test -s dist/assets/site.css` → Expected: 성공

- [ ] **Step 5: 커밋**

```bash
git add site/templates/cards.html site/templates/partials/header.html site/scripts/build.mjs
git commit -m "feat(site): /cards/ 쇼핑몰별 카드 혜택 페이지, 메뉴 링크, 정적 api/cards.json"
```

---

### Task 7: 문서, main 반영, 배포 확인

**Files:**
- Modify: `docs/DECISIONS.md` (D-17 추가), `README.md` (폴더 구조에 `shared/cards.json`, `scripts/research/`, `/cards/`), `docs/PROGRESS.md` (10-28 항목에 결과 기록)

- [ ] **Step 1: D-17 작성** — 표에 한 줄: `D-17 | 카드 혜택 데이터 | 카드사 공식 페이지로 확인한 카드만 공개(status=verified, 출처 URL·확인일 필수, 60일 지나면 "재확인 필요"). 제3자 비교 사이트 문구·이미지는 조사용으로만 쓰고 저장소·사이트에 넣지 않음. 카드 신청 링크·수수료 없음(모집 아님). 상품권 적용 여부(giftcard)는 반드시 명시. | shared/cards.json, scripts/check-cards.mjs, site/scripts/lib/card-benefits.mjs`

- [ ] **Step 2: 전체 검증** — Run: `node --test scripts/test/ && node scripts/check-cards.mjs && (cd worker && npx vitest run) && (cd site && npm test && node scripts/build.mjs --sample && npm run build:css)` → Expected: 전부 통과

- [ ] **Step 3: 커밋 후 main 반영**

```bash
git add docs/DECISIONS.md README.md docs/PROGRESS.md
git commit -m "docs: 카드 혜택 데이터 정책(D-17), 폴더 구조, 10-28 진행 기록"
git checkout main && git merge --ff-only feat/card-benefits
git push origin main main:claude/upbeat-noether-60p86o
```

- [ ] **Step 4: 배포 확인** — Run: `gh run list --workflow="Deploy Site" --limit 1` 로 run id 확인 후 `gh run watch <id> --exit-status` → Expected: success. 이어서 `curl.exe -s https://hotdeal-hub.pages.dev/cards/ | grep -c "쇼핑몰별 카드 혜택"` → `1` 이상, `curl.exe -s https://hotdeal-hub.pages.dev/api/cards.json | head -c 200` 에 `"cards"` 포함.
