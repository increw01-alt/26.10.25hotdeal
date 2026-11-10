import { describe, it, expect } from "vitest";
import { routePost } from "../src/route";
import { parseProductTitle } from "../src/parse-product";
import { extractCardInfo } from "../src/parse";
import { productDedupeKey } from "../src/group";
import { buildDealsQuery } from "../src/api";
import { linkLookupStatements } from "../src/collect";

// 최종 코드 리뷰(2026-11-10)에서 나온 지적의 재현 테스트. 제목은 모두 지어낸 것이다.
const post = (title: string, source = "ppomppu") => ({ source, postId: "1", url: "https://example.test/1", title });
const p = (title: string) => parseProductTitle(post(title));

describe("C1: 사전 필터가 놓친 상품권 글을 일반 딜로 저장하지 않는다", () => {
  it("상품권 브랜드 이름이 든 글은 1단계처럼 건너뛴다", () => {
    for (const t of ["[지마켓] 해피머니 5만원 (46,500원/무료)", "[11번가] 해피머니 10만원권 92,000원", "해피머니 5만원권 (지마켓/46,500원/무료)"]) {
      expect(routePost(post(t), null).action, t).toBe("skip");
    }
  });
  it("짧은 alias(스벅)만 있는 일반 상품은 여전히 일반 딜", () => {
    expect(routePost(post("[네이버] 스벅 텀블러 500ml (19,900원/무료)"), null).action).toBe("product");
  });
});

describe("I1: 일반 딜에서 상품 브랜드를 카드사로 읽지 않는다", () => {
  it("삼성·현대·하나·우리·농협은 '카드'가 붙을 때만 카드사", () => {
    expect(p("[롯데온] 삼성 갤럭시 버즈3 프로 (179,000원/무료) 즉시할인")!.cardIssuers).toEqual([]);
    expect(p("[롯데온] 삼성 갤럭시 버즈3 프로 (179,000원/무료) 즉시할인")!.cardBenefit).toBeNull();
    expect(p("[현대Hmall] LG 스탠바이미 (890,000원/무료) 카드할인")!.cardIssuers).toEqual([]);
    expect(p("[쿠팡] 우리쌀 10kg 할인 (29,900원/무료)")!.cardIssuers).toEqual([]);
  });
  it("'삼성카드'처럼 분명하면 잡는다", () => {
    expect(p("[롯데온] 갤럭시 버즈3 프로 (179,000원/무료) 삼성카드 5% 청구할인")!.cardIssuers).toEqual(["samsung"]);
  });
  it("상품권 파서가 쓰는 기본 동작은 그대로다", () => {
    expect(extractCardInfo("[11번가] 신세계상품권 5만원 47,000원 신한 할인").issuers).toEqual(["shinhan"]);
    expect(extractCardInfo("[11번가] 신세계상품권 5만원 47,000원 신한 할인", { strict: true }).issuers).toEqual([]);
  });
});

describe("I2: 토큰이 비면 글마다 다른 키", () => {
  it("unique 값이 다르면 키가 다르다", async () => {
    const k = (unique: string) => productDedupeKey({ merchantKey: "coupang", price: 9900, tokens: [], unique }, "2026-W46");
    expect(await k("ppomppu:1")).not.toBe(await k("ppomppu:2"));
    expect(await k("ppomppu:1")).toBe(await k("ppomppu:1"));
  });
  it("토큰이 있으면 unique 는 키에 영향을 주지 않는다", async () => {
    const k = (unique: string) => productDedupeKey({ merchantKey: "coupang", price: 9900, tokens: ["a1"], unique }, "2026-W46");
    expect(await k("ppomppu:1")).toBe(await k("clien:9"));
  });
});

describe("I6: 본문의 숫자를 가격으로 잘못 읽지 않는다", () => {
  it("단위 없는 쉼표 숫자(용량)는 가격이 아니다", () => {
    const d = p("[쿠팡] 보조배터리 20,000mAh (무료배송)")!;
    expect(d.salePrice).toBeNull();
    expect(d.confidence).toBeLessThan(0.5);
  });
  it("'3만원 이상 5천원 할인 쿠폰'은 가격이 아니다", () => {
    const d = p("[쿠팡] 3만원 이상 구매시 5천원 할인 쿠폰")!;
    expect(d.salePrice).toBeNull();
    expect(d.confidence).toBeLessThan(0.5);
  });
  it("본문의 '4,990원'은 계속 읽는다", () => {
    expect(p("[쿠팡] 건전지 AA 20개 4,990원 (와우무료)")!.salePrice).toBe(4990);
  });
});

describe("상품명 속 퍼센트를 할인율로 쓰지 않는다", () => {
  it("할인·쿠폰이 붙은 퍼센트만 할인율", () => {
    expect(p("[쿠팡] 알콜 70% 소독 티슈 100매 (3,900원/무료)")!.discountRate).toBeNull();
    expect(p("[쿠팡] 순면 100% 수건 10장 (15,900원/무료)")!.discountRate).toBeNull();
    expect(p("[쿠팡] 라면 20봉 (11,900원/무료) 30% 할인")!.discountRate).toBe(30);
    expect(p("[11번가] 무선 청소기 V12 (199,000원) (무료배송) 신한카드 7% 즉시할인")!.discountRate).toBe(7);
  });
});

describe("I5·API: 진행 중 조건과 limit", () => {
  it("진행 중은 status IN ('live','ending') 로 찾는다(인덱스를 탈 수 있게)", () => {
    expect(buildDealsQuery(new URLSearchParams("")).sql).toContain("status IN ('live','ending')");
  });
  it("소수 limit·offset 은 정수로", () => {
    const r = buildDealsQuery(new URLSearchParams("limit=10.5&offset=3.7"));
    expect(r.limit).toBe(10);
    expect(r.offset).toBe(3);
    expect(r.binds).toEqual([11, 3]);
  });
});

describe("I4: 글 연결 조회를 묶어서 한다", () => {
  it("글 100건이면 조회문은 3개(40건씩)이고 바인드는 문장당 100개 이하", () => {
    const posts = Array.from({ length: 100 }, (_, i) => ({ source: "clien", postId: String(i) }));
    const stmts = linkLookupStatements(posts);
    expect(stmts.length).toBe(3);
    expect(stmts.every((s) => s.binds.length <= 100)).toBe(true);
    expect(stmts[0].binds.slice(0, 4)).toEqual(["clien", "0", "clien", "1"]);
    expect(stmts[2].binds.length).toBe(40);
  });
  it("글이 없으면 조회하지 않는다", () => {
    expect(linkLookupStatements([])).toEqual([]);
  });
});
