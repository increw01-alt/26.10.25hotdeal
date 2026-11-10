# 일반 핫딜 수집 확장(2단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 커뮤니티 글에서 일반 상품 핫딜도 저장해(`kind = product`) 홈·목록·상세에 보여 주고, 일반 딜 상세에 판매처 카드 혜택을 붙인다.

**Architecture:** `deals` 표에 열을 더해 상품권 딜과 일반 딜을 함께 둔다. 글 한 건의 갈래 판정(상품권 / 큐 / 일반 / 닫힘 / 건너뜀)은 순수 함수로 빼서 테스트하고, DB 쓰기는 `collect.ts`가 맡는다. 사이트는 빌드 때 종류별로 다른 카드·상세 템플릿을 고른다.

**Tech Stack:** Cloudflare Workers(TypeScript, vitest), D1(wrangler migrations), Node 22 정적 빌드(`node --test`), Tailwind CLI.

**Spec:** `docs/superpowers/specs/2026-11-10-general-hotdeals-design.md`

## Global Constraints

- 기존 worker 테스트 33건은 **파일을 고치지 않고** 통과해야 한다. 상품권 딜의 `brand`·`merchant`·dedupe 키·식별자가 바뀌면 실패다.
- 기존 site 테스트 9건, scripts 테스트 14건, `node scripts/check-cards.mjs`가 그대로 통과해야 한다.
- 상품권 파서는 `product_only`가 아닌 판매처 13곳만 본다. 기존 13곳의 slug·alias를 바꾸지 않는다.
- 일반 딜 상세에는 상품권 칩(적용/제외/미확인)을 붙이지 않는다. 상품권 딜의 카드 섹션 출력은 한 글자도 바뀌지 않는다.
- 벤치마킹 자료의 제목·응답·이미지를 저장소에 넣지 않는다. 픽스처 제목은 지어낸다.
- `shared/*.json`이 단일 출처. 파일은 CRLF. 정규식이 든 파일은 Write/Edit 도구로 쓴다.
- 수치: 묶기 Jaccard 0.5, 일반 딜 12시간 종료 임박 / 24시간 종료, 일반 딜 상세 종료 후 3일, 홈 상위 60건, 목록 50건/쪽, API `limit` 상한 500, 가격 범위 100원 ~ 5,000만원, 신뢰도 기준 0.5.
- `main`에는 사용자 승인 뒤에만 올린다.

## Review Focus

1. 일반 딜로 저장된 글의 제목이 나중에 상품권 제목으로 바뀌는 경우: 글 없는 상품권 딜이 생기면 안 된다. Task 6에서 이미 일반 딜에 연결된 글은 상품권 경로에 태우지 않는다(`routePost` 테스트).
2. 대괄호가 판매처가 아닌 말머리인 제목(`[종료] …`, `[품절] …`, `[해외] …`): 판매처 원문으로 저장되면 안 된다. Task 5 테스트.
3. 가격처럼 보이는 숫자가 상품명에 든 제목(`갤럭시 S25 256GB`, `1+1`, `2025년`): 용량·연도를 가격으로 읽으면 안 된다. Task 5 테스트.
4. 빈 토큰 집합끼리의 유사도(둘 다 불용어뿐인 제목): 1.0으로 묶이면 안 된다. Task 4 테스트.
5. API가 새 열 없는 옛 행을 돌려줄 때(`kind` 없음, 정적 사본·임베드): 상품권으로 취급해야 한다. Task 9·10 테스트.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `worker/migrations/0001_init.sql` | 지금 `schema.sql` 그대로(신규) |
| `worker/migrations/0002_product_deals.sql` | 새 열·인덱스(신규) |
| `worker/schema.sql` | 전체 스냅샷으로 갱신 |
| `shared/brands.json`, `shared/sources.json`, `shared/site.config.json` | 판매처 28곳, 소스 `kinds`, `archive.productDealPageDaysAfterEnd: 3` |
| `worker/src/config.ts`, `types.ts` | `GIFT_MERCHANTS`, `sourceKinds()`, 새 타입 |
| `worker/src/parse.ts` | 공용 추출 함수 export, `weakOnly` 필드 |
| `worker/src/group.ts` | 토큰화·Jaccard·후보 선택·일반 딜 키(신규) |
| `worker/src/parse-product.ts` | 일반 딜 파서, 종료 표시 판정(신규) |
| `worker/src/route.ts` | 글 한 건의 갈래 판정 순수 함수(신규) |
| `worker/src/collect.ts`, `score.ts` | 갈래별 저장, 닫힘 처리, 종류별 수명, 점수 |
| `worker/src/api.ts` | `kind`·`merchant`·`offset`, 새 필드 |
| `site/scripts/lib/card-benefits.mjs` | 일반 딜용 카드 섹션 |
| `site/scripts/lib/deals.mjs` | 홈 선택·쪽 나누기·보존 판정(신규) |
| `site/scripts/build.mjs`, `site/templates/*`, `site/src/js/*` | 홈 탭, `/deals/`, 일반 딜 카드·상세 |
| `site/data/sample.*.json` | 일반 딜 예시 |
| `docs/DECISIONS.md`, `docs/PROGRESS.md`, `README.md` | 기록 |

---

### Task 1: D1 마이그레이션 전환

**Files:**
- Create: `worker/migrations/0001_init.sql`, `worker/migrations/0002_product_deals.sql`
- Modify: `worker/schema.sql`, `worker/package.json`, `.github/workflows/deploy-worker.yml`, `docs/DEPLOY.md`(스키마 적용 명령이 적힌 곳)

**Interfaces:**
- Produces: `deals`의 새 열 `kind`(TEXT NOT NULL DEFAULT 'gift'), `product_name`, `merchant_raw`, `price_kind`, `price_text`, `shipping`, `product_category`, `title_tokens`(모두 TEXT, NULL 허용). `deal_posts.closed`(INTEGER NOT NULL DEFAULT 0). 인덱스 `idx_deals_kind_status_score (kind, status, score DESC)`, `idx_deals_kind_week_merchant_price (kind, iso_week, merchant, sale_price)`.

- [ ] **Step 1:** `0001_init.sql`에 현재 `schema.sql`을 그대로 복사한다. `0002_product_deals.sql`에 `ALTER TABLE … ADD COLUMN` 9개와 `CREATE INDEX IF NOT EXISTS` 2개를 쓴다.
- [ ] **Step 2:** `schema.sql`을 새 열·인덱스가 든 스냅샷으로 고치고, 머리 주석에 "참고용 스냅샷, 적용은 migrations"라고 적는다.
- [ ] **Step 3:** `package.json`의 `db:migrate:local` / `db:migrate:remote`를 `wrangler d1 migrations apply hotdeal-hub --local` / `--remote`로 바꾼다. 워크플로의 "D1 스키마 적용(멱등)" 단계를 `npx wrangler d1 migrations apply hotdeal-hub --remote`로 바꾼다.
- [ ] **Step 4: 빈 DB 확인.** 스크래치패드 폴더를 `--persist-to`로 주고 `migrations apply --local`을 두 번 실행한다.
  Expected: 첫 실행은 2건 적용, 두 번째는 "No migrations to apply".
- [ ] **Step 5: 기존 DB 확인.** 다른 `--persist-to` 폴더에 `git show main:worker/schema.sql`을 `d1 execute --local --file`로 넣고 딜 한 줄을 INSERT한 뒤 `migrations apply --local`을 실행한다.
  Expected: 2건 적용, 기존 행의 `kind`가 `gift`, `PRAGMA table_info(deals)`에 새 열 8개.
- [ ] **Step 6:** Commit `feat(worker): D1 스키마를 마이그레이션 파일로 전환, 일반 딜 열 추가`

### Task 2: 판매처 사전·소스 종류·설정

**Files:**
- Modify: `shared/brands.json`, `shared/sources.json`, `shared/site.config.json`, `worker/src/config.ts`, `worker/src/types.ts`, `worker/src/parse.ts:9`
- Test: `worker/test/config.test.ts`(신규)

**Interfaces:**
- Produces:
  - `MERCHANTS: Array<{ slug; name; aliases; product_only?: boolean }>`(전체), `GIFT_MERCHANTS`(= `product_only`가 아닌 것)
  - `sourceKinds(slug: string): Array<"gift" | "product">` — 소스 정의의 `kinds`, 없으면 `["gift","product"]`
  - `SourceDef.kinds?: Array<"gift" | "product">`
  - `site.archive.productDealPageDaysAfterEnd = 3`

- [ ] **Step 1: 실패하는 테스트.**

```ts
it("새 판매처는 product_only이고 기존 13곳은 그대로다", () => {
  expect(GIFT_MERCHANTS.map((m) => m.slug)).toEqual(["gmarket","auction","11st","coupang","naver","ssg","lotteon","kakao","toss","payco","cardmall","cultureland_direct","happymoney_direct"]);
  expect(MERCHANTS.length).toBe(41);
  expect(MERCHANTS.find((m) => m.slug === "tossshopping")!.product_only).toBe(true);
});
it("뽐뿌 쿠폰게시판은 상품권만 받는다", () => {
  expect(sourceKinds("ppomppu_coupon")).toEqual(["gift"]);
  expect(sourceKinds("clien")).toEqual(["gift", "product"]);
  expect(sourceKinds("unknown")).toEqual(["gift", "product"]);
});
it("상품권 파서는 새 판매처를 보지 않는다", () => {
  expect(parseTitle(post("토스쇼핑 컬쳐랜드 5만원권 46,000원"))!.merchant).toBe("toss");
});
```

- [ ] **Step 2:** `npx vitest run test/config.test.ts` → FAIL.
- [ ] **Step 3:** `brands.json`의 `merchants`에 스펙의 28곳을 `"product_only": true`로 더한다(alias는 한글 이름·영문 표기·흔한 줄임말, 예: `kakaoshopping` = 카카오쇼핑·톡딜·카카오톡딜, `aliexpress` = 알리익스프레스·알리·aliexpress, `himart` = 하이마트·롯데하이마트). `sources.json`의 `ppomppu_coupon`에 `"kinds": ["gift"]`. `config.ts`에 위 export, `parse.ts`의 `merchantIndex`를 `GIFT_MERCHANTS`로.
- [ ] **Step 4:** `npm test`(전체 통과), `npm run typecheck`, 저장소 루트에서 `node scripts/check-cards.mjs`, `node --test "scripts/test/*.test.mjs"`.
- [ ] **Step 5:** Commit `feat(shared): 일반 딜용 판매처 28곳과 소스별 kinds`

### Task 3: 상품권 파서의 공용 함수 꺼내기

**Files:**
- Modify: `worker/src/parse.ts`, `worker/src/types.ts`
- Test: `worker/test/parse-shared.test.ts`(신규)

**Interfaces:**
- Produces (모두 `parse.ts` export):
  - `norm(s: string): string`, `AMOUNT: string`
  - `isRewardEventTitle(title: string): boolean` — `/적립|캐시백|페이백|추첨|응모/`에 걸리고 `/상품권|기프트|충전|권\s*구매|교환권|관람권/`에 안 걸리면 true
  - `extractLimit(title): string | null`, `extractPaymentNote(title): string | null`, `extractPercent(title): number | null`
  - `extractCardInfo(title: string): { issuers: string[]; cardBenefit: string | null }` — `parseTitle` 안의 카드사 추출을 그대로 옮긴 것
  - `ParsedDeal.weakOnly: boolean` — 짧은 alias로만 잡혔고 상품권 단서도 액면가+판매가도 없을 때 true(지금 신뢰도를 0.45로 누르는 조건과 같다)

- [ ] **Step 1: 실패하는 테스트.** `isRewardEventTitle("네이버페이 9,900원 이상 결제시 50% 적립")` true, `("컬쳐랜드 5만원 충전 시 5% 적립")` false, `("에어팟 프로 249,000원")` false. `extractCardInfo("[11번가] 무선 청소기 199,000원 신한카드 7% 즉시할인")`은 `{ issuers: ["shinhan"], cardBenefit: "신한카드 7% 즉시할인" }`. `parseTitle(post("[신세계] 보리차 2L 12개 9,900원")).weakOnly`는 true, `parseTitle(post("[지마켓] 컬쳐랜드 문화상품권 5만원권 (46,000원/무료)")).weakOnly`는 false.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 함수를 꺼내 export하고 `parseTitle`이 그것을 쓰게 한다. 동작은 바꾸지 않는다.
- [ ] **Step 4:** `npm test` 전체 통과(기존 33건 포함), `npm run typecheck`.
- [ ] **Step 5:** Commit `refactor(worker): 카드·한도·이벤트 판정을 공용 함수로 분리`

### Task 4: 묶기 순수 함수

**Files:**
- Create: `worker/src/group.ts`
- Test: `worker/test/group.test.ts`

**Interfaces:**
- Produces:
  - `tokenize(productName: string): string[]` — 소문자화, 한글·영문·숫자 밖은 공백, 1글자 토큰과 불용어 제거, 중복 제거, 정렬
  - `jaccard(a: string[], b: string[]): number` — 어느 한쪽이 비면 0
  - `pickGroup(tokens: string[], candidates: Array<{ id: string; tokens: string[] }>, threshold = 0.5): string | null` — 기준 이상 중 최고, 동점은 앞선 것
  - `merchantKey(slug: string | null, raw: string | null): string` — slug, 없으면 `raw:` + 소문자·공백 제거 원문, 둘 다 없으면 `-`
  - `productDedupeKey(p: { merchantKey: string; price: number | null; tokens: string[] }, isoWeek: string): Promise<string>` — `product|판매처키|가격 또는 -|토큰 문자열 SHA-1 앞 12자|주차`
  - `STOPWORDS: Set<string>`

- [ ] **Step 1: 실패하는 테스트.**

```ts
expect(tokenize("삼다수 2L 12개 무료배송 특가!")).toEqual(["12개", "2l", "삼다수"]);
expect(jaccard(["a1", "b1"], ["a1", "b1"])).toBe(1);
expect(jaccard([], [])).toBe(0);
expect(jaccard(["삼다수", "2l", "12개"], ["삼다수", "2l", "24개"])).toBeCloseTo(0.5);
expect(pickGroup(["삼다수", "2l", "12개"], [{ id: "x", tokens: ["생수", "500ml"] }, { id: "y", tokens: ["12개", "2l", "삼다수", "제주"] }])).toBe("y");
expect(pickGroup(["삼다수"], [{ id: "x", tokens: ["생수"] }])).toBeNull();
expect(merchantKey(null, "하프 클럽")).toBe("raw:하프클럽");
expect(await productDedupeKey({ merchantKey: "coupang", price: 9900, tokens: ["a1"] }, "2026-W46")).toMatch(/^product\|coupang\|9900\|[a-f0-9]{12}\|2026-W46$/);
```

  가격이 없을 때 키의 가격 자리는 `-`이고, 토큰 순서가 달라도 같은 키가 나오는 것도 확인한다.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 불용어: 무료배송, 무배, 무료, 배송, 특가, 핫딜, 할인, 쿠폰, 역대가, 최저가, 카드, 즉시할인, 청구할인, 오늘만, 한정, 타임딜, 와우, 로켓배송.
- [ ] **Step 4:** PASS 확인.
- [ ] **Step 5:** Commit `feat(worker): 같은 상품 묶기용 토큰화·유사도 함수`

### Task 5: 일반 딜 파서

**Files:**
- Create: `worker/src/parse-product.ts`
- Modify: `worker/src/types.ts`
- Test: `worker/test/parse-product.test.ts`

**Interfaces:**
- Consumes: Task 2 `MERCHANTS`, Task 3 공용 함수와 `parseKRW`, Task 4 `tokenize`
- Produces:

```ts
export interface ParsedProduct {
  merchant: string | null; merchantRaw: string | null;
  productName: string; tokens: string[];
  salePrice: number | null; priceKind: "exact" | "descriptive" | null; priceText: string | null;
  shipping: string | null; discountRate: number | null;
  cardIssuers: string[]; cardBenefit: string | null; limitPerPerson: string | null; paymentNote: string | null;
  confidence: number;
}
export function parseProductTitle(post: RawPost): ParsedProduct | null;
export function isClosedTitle(title: string): boolean;
```

- [ ] **Step 1: 실패하는 테스트**(제목은 지어낸 것).

| 제목 | 기대 |
|---|---|
| `[쿠팡] 제주 삼다수 2L 12개 (9,900원/무료)` | merchant `coupang`, salePrice 9900, priceKind `exact`, shipping `무료`, productName `제주 삼다수 2L 12개`, confidence ≥ 0.9 |
| `[11번가] 무선 청소기 V12 (199,000원) (무료배송) 신한카드 7% 즉시할인` | `11st`, 199000, `무료`, cardIssuers `["shinhan"]` |
| `[하프클럽] 겨울 패딩 조끼 (29,900원/2,500원)` | merchant null, merchantRaw `하프클럽`, 29900, shipping `2,500원` |
| `무선 이어폰 프로 2세대 (네이버/249,000원/무료)` | `naver`, 249000, `무료`, productName `무선 이어폰 프로 2세대` |
| `[지마켓] 캠핑 의자 모음전 (가격다양/무료)` | priceKind `descriptive`, priceText `가격다양`, salePrice null, confidence ≥ 0.5 |
| `[스팀] 인디 게임 번들 (무료)` | `steam`, priceKind `descriptive`, priceText `무료`, shipping null |
| `[토스쇼핑] 핸드크림 3종 (5,900원/무배)` | `tossshopping` |
| `[옥션] 갤럭시 S25 256GB 자급제 (1,099,000원/무료)` | 1099000 (256을 가격으로 읽지 않음) |
| `[롯데온] 2025년형 김치냉장고 1+1 행사` | 가격 없음, confidence < 0.5 |
| `[쿠팡] 건전지 AA 20개 4,990원 (와우무료)` | 4990 (끝 괄호에 가격이 없으면 본문의 마지막 금액), shipping `조건부 무료` 또는 원문 |
| `[쿠팡] 볼펜 (50원/무료)` | 범위 밖 가격은 가격 없음 처리 |
| `[종료] [쿠팡] 삼다수 (9,900원/무료)` | `isClosedTitle` true |
| `[품절] 무선 이어폰`, `무선 이어폰 (품절)`, `(종료) 삼다수`, `마감된 딜입니다 삼다수` | 앞 셋 true, 마지막 false(본문 속 낱말은 보지 않음) |
| `[해외] 블루투스 스피커 ($29/무료)` | merchantRaw에 `해외`를 넣지 않는다(말머리 목록: 해외, 국내, 종료, 품절, 마감, 완판, 정보, 질문, 기타, 이벤트) |
| `ㅁ` | null |

- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 순서: 앞머리 말머리 제거 → 앞 대괄호/소괄호 판매처(전체 사전, 긴 alias 우선) → 끝 괄호 묶음(연속 두 개까지)을 `/`로 나눠 조각 판정 → 가격(금액 표기는 쉼표·`만`·`천`·`원`이 붙은 것만 인정, 끝 괄호 밖에서는 `원`이나 쉼표가 있는 표기만) → 배송비 정규화 → 상품명 → 카드·한도 → 신뢰도(기본 0.3, 판매처 +0.2, 숫자 가격 +0.35, 서술형 +0.25, 배송비 +0.1, 토큰 2개 이상 +0.05, 가격 없으면 최대 0.45, 상품명 2자 미만이면 null). `isClosedTitle`은 제목 맨 앞 말머리와 괄호 표기만 본다.
- [ ] **Step 4:** `npm test`, `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(worker): 일반 핫딜 제목 파서`

### Task 6: 글 한 건의 갈래 판정

**Files:**
- Create: `worker/src/route.ts`
- Test: `worker/test/route.test.ts`

**Interfaces:**
- Consumes: `looksLikeGiftDeal`, `parseTitle`, `isRewardEventTitle`, `parseProductTitle`, `isClosedTitle`, `sourceKinds`
- Produces:

```ts
export type Route =
  | { action: "gift"; parsed: ParsedDeal }
  | { action: "queue"; reason: string }
  | { action: "product"; parsed: ParsedProduct }
  | { action: "touch" }    // 이미 일반 딜에 연결된 글: 다시 본 것만 기록
  | { action: "close" }    // 이미 일반 딜에 연결된 글에 종료 표시가 붙음
  | { action: "skip" };
/** linked: 이 글(source, post_id)이 이미 연결된 딜의 종류. 없으면 null */
export function routePost(post: RawPost, linked: "gift" | "product" | null): Route;
```

규칙(스펙 "수집 흐름" 순서):
1. `linked === "product"`이면 상품권 판정을 하지 않는다. 종료 표시면 `close`, 아니면 `touch`.
2. 상품권 판정: `looksLikeGiftDeal` → `parseTitle`. 신뢰도 ≥ 0.5면 `gift`. 미만이고 `weakOnly`가 아니면 `queue`(`low confidence N`). 그 밖은 3으로.
3. `linked === "gift"`이면 `skip`(상품권 딜에 붙은 글을 일반 딜로 옮기지 않는다).
4. 소스 `kinds`에 `product`가 없으면 `skip`. 이벤트 글이면 `skip`. 종료 표시면 `skip`(새 딜 안 만듦).
5. `parseProductTitle`: null이면 `skip`, 신뢰도 ≥ 0.5면 `product`, 아니면 `queue`(`product low confidence N`).

- [ ] **Step 1: 실패하는 테스트.** 위 규칙마다 한 건 이상:
  - `[지마켓] 컬쳐랜드 문화상품권 5만원권 (46,000원/무료)` + null → `gift`
  - `[쿠팡] 삼다수 2L 12개 (9,900원/무료)` + null → `product`
  - `[신세계] 보리차 2L 12개 (9,900원/무료)` + null → `product`(짧은 alias, 상품권 단서 없음)
  - `해피머니 상품권 관련 소식` + null → `queue`(기존 동작)
  - `네이버페이 9,900원 이상 결제시 50% 적립` + null → `skip`
  - 소스 `ppomppu_coupon`의 `[쿠팡] 삼다수 (9,900원/무료)` → `skip`
  - `[종료] [쿠팡] 삼다수 (9,900원/무료)` + null → `skip`, + `"product"` → `close`
  - `[쿠팡] 삼다수 (9,900원/무료)` + `"product"` → `touch`
  - `[지마켓] 컬쳐랜드 5만원권 (46,000원/무료)` + `"product"` → `touch`(Review Focus 1)
  - `[쿠팡] 삼다수 (9,900원/무료)` + `"gift"` → `skip`
  - `[롯데온] 김치냉장고 행사` + null → `queue`
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS 확인.
- [ ] **Step 5:** Commit `feat(worker): 글의 갈래 판정(상품권·일반·닫힘) 순수 함수`

### Task 7: 수집 저장·수명·점수

**Files:**
- Modify: `worker/src/collect.ts`, `worker/src/score.ts`
- Test: `worker/test/score.test.ts`(신규)

**Interfaces:**
- Consumes: `routePost`, `pickGroup`, `merchantKey`, `productDedupeKey`, `dealId`
- Produces:
  - `computeScore`에 선택 입력 `sourceCount?: number` — 2면 +0.1, 3 이상이면 +0.2
  - `ingestPosts` 반환값에 `products: number` 추가(기존 필드 유지)
  - 상수 `PRODUCT_ENDING_AFTER_HOURS = 12`, `PRODUCT_ENDED_AFTER_HOURS = 24`, `SCORE_WRITE_DELTA = 0.002`

- [ ] **Step 1: 실패하는 테스트.** `computeScore`가 `sourceCount` 1·없음일 때 지금 값과 같고, 2면 정확히 0.1, 3·5면 0.2 높다.
- [ ] **Step 2:** FAIL 확인 → `score.ts` 구현 → PASS.
- [ ] **Step 3: `ingestPosts`.** 글마다 `deal_posts`와 `deals`를 조인해 연결된 딜의 `id`·`kind`를 한 번 읽고 `routePost`에 넘긴다.
  - `gift`: 기존 `upsertDeal` 그대로.
  - `product`: 후보 조회(같은 `iso_week`, `kind='product'`, `status != 'ended'`, 같은 `sale_price`, slug가 있으면 같은 `merchant`, 없으면 `merchant IS NULL`이고 JS에서 `merchantKey` 비교). 숫자 가격이고 판매처 키가 `-`가 아닐 때만 `pickGroup`을 쓴다. 맞는 딜이 있으면 그 딜에 글을 붙이고 `last_seen`·`status='live'`·`ended_at=NULL`을 갱신한다. 없으면 `productDedupeKey`로 새 딜을 넣는다(`brand='-'`, `category='product'`, `ON CONFLICT(id)`는 붙이기와 같은 갱신). `deal_prices`에도 그날 가격을 넣는다.
  - `touch`: 글의 추천·댓글·`last_seen`을 갱신하고 `closed=0`으로, 딜의 `last_seen`을 갱신하고 되살린다.
  - `close`: 글을 `closed=1`로. 딜 id를 모아 둔다.
  - 끝에: 모아 둔 딜 중 `closed=0`인 글이 하나도 없는 딜을 `ended`로 바꾼다.
- [ ] **Step 4: `updateStatuses`.** 상품권은 24/48시간(`kind='gift'`), 일반은 12/24시간(`kind='product'`).
- [ ] **Step 5: `refreshScores`.** 조회에 현재 `score`·`votes_total`·`comments_total`을 더하고, 점수 차이가 0.002 미만이고 추천·댓글 합이 같으면 쓰지 않는다. `sourceCount`는 글의 서로 다른 소스 수.
- [ ] **Step 6:** `npm test`, `npm run typecheck`.
- [ ] **Step 7:** Commit `feat(worker): 일반 딜 저장·묶기·닫힘 처리와 종류별 수명`

### Task 8: 공개 API

**Files:**
- Modify: `worker/src/api.ts`
- Test: `worker/test/api-query.test.ts`(신규)

**Interfaces:**
- Produces:
  - `export function buildDealsQuery(q: URLSearchParams): { sql: string; binds: unknown[]; limit: number; offset: number }` — `limit + 1`건을 읽어 `has_more`를 정한다
  - `export function rowToDeal(r)` — `kind`(없으면 `gift`), `sources: string[]`, 일반 딜의 `brand_name: null`, `merchant_name`은 사전 이름, 없으면 null
  - 응답: `{ …, count, has_more, deals }`
  - `/api/status.json`에 `active_by_kind: { gift: number; product: number }`

- [ ] **Step 1: 실패하는 테스트.**
  - 파라미터 없음: `kind` 조건 없음, `status != 'ended'`, limit 50, offset 0, 정렬 `score DESC`
  - `kind=product&merchant=coupang&limit=9999&offset=100`: `kind = ?`, `merchant = ?`, limit 500, offset 100, binds 끝이 `[…, 501, 100]`
  - `kind=bogus`: 조건 없음(전체)
  - `brand=cultureland`: `brand = ?` 유지
  - `rowToDeal({ brand: "-", kind: "product", merchant: null, merchant_raw: "하프클럽", sources: "clien,ppomppu", card_issuers: "[]" })`: `brand_name` null, `merchant_name` null, `sources` `["clien","ppomppu"]`
  - `rowToDeal({ brand: "cultureland", card_issuers: "[]", sources: null })`: `kind` `gift`, `sources` `[]`
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. `DEAL_COLUMNS`에 새 열과 `(SELECT GROUP_CONCAT(DISTINCT source) FROM deal_posts p WHERE p.deal_id = deals.id) AS sources`. `weeklyPayload`는 `kind = 'gift'`만. `dealDetail`의 과거 반복은 상품권만 계산하고 일반 딜은 `history: []`, `repeat_weeks: 1`.
- [ ] **Step 4:** `npm test`, `npm run typecheck`.
- [ ] **Step 5: 로컬 확인.** Task 1의 빈 DB에 `wrangler dev --local --var DEV_INGEST:true`를 띄우고 `/__dev/ingest`에 지어낸 글 6건을 넣는다: 상품권 1, 일반 2(클리앙·뽐뿌에 같은 상품·같은 가격), 사전에 없는 판매처 1, 서술형 가격 1, 이벤트 글 1.
  Expected: `/api/deals.json`에 상품권 1건(`kind: gift`), 일반 3건, 묶인 딜의 `sources` 길이 2. `?kind=gift`는 1건. 같은 글에 `[종료]`를 붙여 다시 넣으면 그 글만 닫히고, 두 글 모두 닫으면 딜이 `ended`.
- [ ] **Step 6:** Commit `feat(worker): API에 kind·merchant·offset과 일반 딜 필드`

### Task 9: 일반 딜용 카드 섹션과 목록 도우미

**Files:**
- Modify: `site/scripts/lib/card-benefits.mjs`
- Create: `site/scripts/lib/deals.mjs`
- Test: `site/test/card-benefits.test.mjs`(추가만), `site/test/deals.test.mjs`(신규)

**Interfaces:**
- Produces:
  - `renderDealCardSection({ index, merchant, merchantName, issuerName, promoNote, kind = "gift", merchantRaw = null })` — `kind`가 `product`일 때만 새 동작
  - `dealKind(d): "gift" | "product"` — `d.kind`가 `product`가 아니면 `gift`
  - `pickHomeDeals(deals, limit = 60)` — 진행 중인 딜을 점수순으로 `limit`건, 거기 못 든 진행 중 상품권 딜을 뒤에 붙임
  - `paginate(list, size = 50): Array<Array>` — 빈 목록이면 `[[]]`
  - `listPath(kind: "all" | "gift" | "product", page: number): string` — `/deals/`, `/deals/2/`, `/deals/product/`, `/deals/product/2/`
  - `productPageEligible(d, now, days = 3): boolean` — 진행 중이거나 `ended_at`이 없거나 종료 후 `days`일 이내
  - `priceLabel(d): string` — 숫자면 `9,900원`, 서술형이면 `price_text`, 없으면 `—`

- [ ] **Step 1: 실패하는 테스트**(기존 픽스처 `doc`·`names` 재사용).
  - `kind: "product", merchant: "11st"`: 도입 문장 "11번가에서 일반 상품을 결제할 때 혜택을 주는 카드입니다. 전월 실적과 월 한도를 함께 확인하세요.", `<details` 없음, "상품권 적용"·"상품권 제외"·"상품권 적용 미확인" 문자열 없음, 카드 순서는 혜택률 높은 순(`A 11번가 카드`가 `B 체크`보다 앞), 고정 안내 문구 있음
  - `kind: "product", merchant: "naver"`: "확인된 카드 중 네이버에서 혜택을 주는 카드가 아직 없습니다."
  - `kind: "product", merchant: null, merchantRaw: "하프클럽"`: "이 판매처(하프클럽)는 아직 카드 혜택 표에 없습니다."
  - `kind: "product", merchant: null`: 1단계 문구 그대로
  - `kind: "product"`에 `promoNote`: "판매처 행사 조건" 한 줄
  - `pickHomeDeals`: 일반 딜 70건(점수 높음) + 상품권 3건(점수 낮음)이면 길이 63, 상품권 3건 모두 포함, 종료 딜 제외
  - `paginate` 120건 → 길이 [50, 50, 20], `listPath("product", 2)` → `/deals/product/2/`, `dealKind({})` → `gift`
  - `productPageEligible`: 종료 2일 전 true, 4일 전 false, 진행 중 true
- [ ] **Step 2:** `npm test`(site) → FAIL.
- [ ] **Step 3:** 구현. 일반 딜 정렬은 혜택률 내림차순(금액형은 0으로), 그다음 카드명. 카드 행은 칩 없는 변형을 쓴다.
- [ ] **Step 4:** PASS, 기존 9건 포함.
- [ ] **Step 5:** Commit `feat(site): 일반 딜용 카드 혜택 섹션과 목록 도우미`

### Task 10: 사이트 빌드·템플릿·샘플

**Files:**
- Modify: `site/scripts/build.mjs`, `site/templates/index.html`, `site/templates/partials/header.html`, `site/templates/about.html`, `site/templates/open-data.html`, `site/templates/partials/deal-card.html`(`data-kind="gift"` 속성만), `site/src/js/site.js`, `site/src/js/embed.js`, `site/data/sample.deals.json`, `site/data/sample.details.json`, `shared/site.config.json`(tagline)
- Create: `site/templates/partials/product-card.html`, `site/templates/product-deal.html`, `site/templates/deals.html`
- Test: `site/test/build-sample.test.mjs`(신규, 샘플 빌드를 돌려 결과 파일을 읽는다)

**Interfaces:**
- Consumes: Task 9의 모든 함수, Task 8의 응답 형식

- [ ] **Step 1: 샘플 데이터.** `sample.deals.json`에 일반 딜 6건(지어낸 제목): 쿠팡 진행 중(카드 혜택 표에 있는 판매처), 사전에 없는 판매처, 서술형 가격, 두 커뮤니티에 올라온 딜(`sources` 2개), 종료 1일 전, 종료 10일 전. 기존 상품권 4건에는 `kind: "gift"`를 넣지 않는다(옛 응답 호환 확인용). `sample.details.json`에 맞춰 넣는다.
- [ ] **Step 2: 실패하는 테스트.** `node scripts/build.mjs --sample`을 실행한 뒤:
  - `dist/index.html`에 `data-kind-tab="all"`, `"gift"`, `"product"`가 있고 `data-kind="product"` 카드와 `data-kind="gift"` 카드가 모두 있다
  - `dist/deals/index.html`, `dist/deals/gift/index.html`, `dist/deals/product/index.html`이 있다
  - 쿠팡 일반 딜 상세에 "쿠팡 카드 혜택"과 "일반 상품을 결제할 때"가 있고 "상품권 제외"가 없다
  - 사전에 없는 판매처 딜 상세에 "아직 카드 혜택 표에 없습니다"
  - 종료 10일 전 일반 딜의 상세 파일이 없고, 종료 1일 전 딜의 상세에는 `noindex`가 있다
  - 상품권 딜 상세에는 "액면가"가 그대로 있다
  - `dist/api/deals.json`의 딜에 `kind`가 `product`인 것이 있다
  - `dist/sitemap.xml`에 `/deals/`와 진행 중 일반 딜 상세 주소가 있다
- [ ] **Step 3:** FAIL 확인.
- [ ] **Step 4: `loadData`.** 진행 중 딜은 `limit=500`으로 `has_more`가 없을 때까지 `offset`을 올려 받는다. 종료 딜은 `kind=gift&limit=200`, `kind=product&limit=500` 두 번. 딜 상세 조회는 동시에 6개.
- [ ] **Step 5: 카드와 홈.** `dealCard`가 종류에 따라 `deal-card` / `product-card`를 고른다. 일반 딜 카드: 판매처(없으면 원문, 그것도 없으면 "판매처 미확인") · 상품명 · 가격 · 배송비 · 카드 조건 칩 · "N곳에 올라옴" 칩(2곳 이상) · 출처 · 상세 링크, `data-kind`·`data-merchant` 속성. 홈은 `pickHomeDeals` 결과, 탭 세 개, 판매처 select(목록에 있는 판매처만), 브랜드 select는 상품권 탭에서만, "전체 딜 보기" 링크. 히어로는 "커뮤니티 핫딜과 카드 혜택을 한곳에서" 방향으로 고치고 수집처 이름은 `sources.json`의 활성 소스에서 만든다.
- [ ] **Step 6: `site.js`.** 탭 클릭으로 `data-kind`를 거르고, 판매처 필터를 더한다. 탭 상태는 `aria-pressed`로 표시한다. 기존 상태·카드 필터 동작은 유지한다.
- [ ] **Step 7: `/deals/` 목록.** 종류 세 가지 × 쪽. 진행 중 딜을 `first_seen` 최신순으로. 이전·다음 링크, 종류 전환 링크. 2쪽 이후는 사이트맵에서 뺀다.
- [ ] **Step 8: 일반 딜 상세.** 스펙 "일반 딜 상세"의 구성. `dealHref`는 일반 딜이 보존 기간을 넘겼으면 `/deals/product/`. 종료 딜은 버튼을 끄고 `/deals/product/`로 안내. JSON-LD `Offer`는 숫자 가격일 때만 `price`.
- [ ] **Step 9: 나머지.** 헤더 메뉴(홈 / 전체 딜 / 상품권 브랜드 / 주간 비교 / 카드 혜택 / 데이터 제공 / 소개), 소개·데이터 제공 문구(새 파라미터, 기본값이 전체로 바뀜), 브랜드 허브·주간은 상품권만 걸러 쓰기, `embed.js`는 API 주소에 `kind=gift`를 붙이고 정적 사본은 `kind`가 `product`인 딜을 뺀다.
- [ ] **Step 10:** site `npm test` 전체 통과, `node scripts/build.mjs --sample && npm run build:css` 성공.
- [ ] **Step 11: 화면 확인.** 미리보기 서버로 홈 탭 전환, `/deals/product/`, 일반 딜 상세를 데스크톱·모바일 폭에서 본다.
- [ ] **Step 12:** Commit `feat(site): 전체 딜 홈·목록·일반 딜 상세`

### Task 11: 기록과 전체 검증

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/PROGRESS.md`, `README.md`, `.github/workflows/ci.yml`(필요하면)

- [ ] **Step 1:** `DECISIONS.md`에 D-16 마감, D-18 ~ D-21을 스펙 "결정 기록에 적을 것" 그대로 적는다. `PROGRESS.md`에 2026-11-10 진행 기록, `README.md`의 구조·명령(마이그레이션)을 고친다.
- [ ] **Step 2: 전체 검증.** worker `npm test` + `npm run typecheck`, site `npm test` + 샘플 빌드 + CSS, 루트 `node --test "scripts/test/*.test.mjs"`, `node scripts/check-cards.mjs`.
  Expected: 모두 통과. worker 기존 33건, site 기존 9건, scripts 14건이 수정 없이 포함된다.
- [ ] **Step 3:** Commit `docs: 일반 핫딜 수집 결정(D-16 마감, D-18~D-21)과 진행 기록`
- [ ] **Step 4:** 코드 리뷰를 받고 지적을 반영한다. `main` 반영은 사용자 승인 뒤에 한다.
