import { describe, it, expect } from "vitest";
import { parseTitle, parseKRW, extractPrices, looksLikeGiftDeal } from "../src/parse";

const post = (title: string) => ({ source: "ppomppu", postId: "1", url: "https://example.test/1", title });

describe("parseKRW", () => {
  it("한글 단위와 쉼표를 처리한다", () => {
    expect(parseKRW("5만")).toBe(50000);
    expect(parseKRW("5만원")).toBe(50000);
    expect(parseKRW("4.6만")).toBe(46000);
    expect(parseKRW("50,000")).toBe(50000);
    expect(parseKRW("46000원")).toBe(46000);
    expect(parseKRW("abc")).toBeNull();
  });
});

describe("extractPrices", () => {
  it("액면가와 판매가를 구분한다", () => {
    expect(extractPrices("컬쳐랜드 5만원권 46,000원", [50000])).toEqual({ face: 50000, sale: 46000 });
    expect(extractPrices("해피머니 10만원 → 92,000원 (무료)", [100000])).toEqual({ face: 100000, sale: 92000 });
  });
});

describe("parseTitle", () => {
  it("뽐뿌 스타일 제목을 파싱한다", () => {
    const d = parseTitle(post("[지마켓] 컬쳐랜드 문화상품권 5만원권 (46,000원/무료) 신한카드 1인 3매"));
    expect(d).not.toBeNull();
    expect(d!.brand).toBe("cultureland");
    expect(d!.merchant).toBe("gmarket");
    expect(d!.faceValue).toBe(50000);
    expect(d!.salePrice).toBe(46000);
    expect(d!.discountRate).toBe(8);
    expect(d!.cardIssuers).toEqual(["shinhan"]);
    expect(d!.limitPerPerson).toBe("1인 3매");
    expect(d!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("퍼센트 표기로 판매가를 계산한다", () => {
    const d = parseTitle(post("[옥션] 해피머니 상품권 10만원 8% 할인 (현대카드 즉시할인)"));
    expect(d!.merchant).toBe("auction");
    expect(d!.faceValue).toBe(100000);
    expect(d!.salePrice).toBe(92000);
    expect(d!.discountRate).toBe(8);
    expect(d!.cardIssuers).toEqual(["hyundai"]);
    expect(d!.paymentNote).toContain("즉시할인");
    expect(d!.cardBenefit).toContain("현대카드 8% 즉시할인");
  });

  it("브랜드명 '롯데'와 카드사 '롯데카드'를 혼동하지 않는다", () => {
    const d = parseTitle(post("[롯데온] 롯데상품권 10만원 95,000원 무료배송"));
    expect(d!.brand).toBe("lotte");
    expect(d!.merchant).toBe("lotteon");
    expect(d!.cardIssuers).toEqual([]);
  });

  it("카드 문맥이 있을 때만 '신한'을 카드사로 인정한다", () => {
    expect(parseTitle(post("[11번가] 신세계상품권 5만원 47,000원 신한 할인"))!.cardIssuers).toEqual(["shinhan"]);
    expect(parseTitle(post("[11번가] 신세계상품권 5만원 47,000원"))!.cardIssuers).toEqual([]);
  });

  it("상품권이 아니면 null", () => {
    expect(parseTitle(post("[쿠팡] 삼성 갤럭시 버즈 99,000원"))).toBeNull();
  });

  it("판매가·판매처가 없으면 confidence가 낮아 큐로 간다", () => {
    const d = parseTitle(post("컬쳐랜드 이벤트 정보 공유"));
    expect(d!.confidence).toBeLessThan(0.5);
  });

  it("비정상 할인율은 confidence를 깎는다", () => {
    const d = parseTitle(post("[지마켓] 컬쳐랜드 5만원 1,000원"));
    expect(d!.confidence).toBeLessThan(0.5);
  });
});

describe("looksLikeGiftDeal", () => {
  it("사전 필터", () => {
    expect(looksLikeGiftDeal("[지마켓] 문화상품권 5만원")).toBe(true);
    expect(looksLikeGiftDeal("[쿠팡] 노트북 거치대")).toBe(false);
  });
});

describe("parseTitle confidence 규칙", () => {
  it("가격 정보가 없으면 판매처가 있어도 0.5 미만", () => {
    const d = parseTitle({ source: "ppomppu", postId: "9", url: "https://x.test/9", title: "컬쳐랜드 앱 이벤트 정보 공유합니다" });
    expect(d).not.toBeNull();
    expect(d!.confidence).toBeLessThan(0.5);
  });
  it("액면가+퍼센트만 있어도 판매가가 계산되어 통과", () => {
    const d = parseTitle({ source: "ppomppu", postId: "9", url: "https://x.test/9", title: "[지마켓] 컬쳐랜드 5만원권 8% 할인" });
    expect(d!.salePrice).toBe(46000);
    expect(d!.confidence).toBeGreaterThanOrEqual(0.5);
  });
});
