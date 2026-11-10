import { describe, it, expect } from "vitest";
import { parseTitle, isRewardEventTitle, extractCardInfo, extractLimit, extractPaymentNote, extractPercent, norm } from "../src/parse";

const post = (title: string) => ({ source: "ppomppu", postId: "1", url: "https://example.test/1", title });

describe("isRewardEventTitle", () => {
  it("적립·추첨 이벤트 글을 알아본다", () => {
    expect(isRewardEventTitle("네이버페이 9,900원 이상 결제시 50% 적립")).toBe(true);
    expect(isRewardEventTitle("신제품 출시 기념 추첨 이벤트")).toBe(true);
  });
  it("상품권·충전 맥락이 있으면 이벤트로 보지 않는다", () => {
    expect(isRewardEventTitle("컬쳐랜드 5만원 충전 시 5% 적립")).toBe(false);
  });
  it("보통 상품 글은 이벤트가 아니다", () => {
    expect(isRewardEventTitle("에어팟 프로 249,000원")).toBe(false);
  });
});

describe("공용 추출 함수", () => {
  it("카드사와 혜택 문구를 뽑는다", () => {
    expect(extractCardInfo("[11번가] 무선 청소기 199,000원 신한카드 7% 즉시할인")).toEqual({ issuers: ["shinhan"], cardBenefit: "신한카드 7% 즉시할인" });
    expect(extractCardInfo("[쿠팡] 삼다수 2L 12개 (9,900원/무료)")).toEqual({ issuers: [], cardBenefit: null });
  });
  it("한도·결제 조건·퍼센트를 뽑는다", () => {
    expect(extractLimit("무선 이어폰 1인 2개 한정")).toBe("1인 2개");
    expect(extractPaymentNote("청소기 199,000원 무이자")).toBe("무이자");
    expect(extractPercent("청소기 15% 할인")).toBe(15);
    expect(norm("G 마켓")).toBe("g마켓");
  });
});

describe("parseTitle.weakOnly", () => {
  it("짧은 alias로만 잡히고 상품권 단서가 없으면 true", () => {
    expect(parseTitle(post("[신세계] 보리차 2L 12개 9,900원"))).toBeNull(); // 대괄호가 판매처면 브랜드로 잡지 않음
    expect(parseTitle(post("스타벅스 텀블러 500ml 19,900원"))!.weakOnly).toBe(true);
  });
  it("상품권 단서가 있으면 false", () => {
    expect(parseTitle(post("[지마켓] 컬쳐랜드 문화상품권 5만원권 (46,000원/무료)"))!.weakOnly).toBe(false);
    expect(parseTitle(post("스타벅스 기프트카드 3만원 27,000원"))!.weakOnly).toBe(false);
  });
});
