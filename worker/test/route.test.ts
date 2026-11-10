import { describe, it, expect } from "vitest";
import { routePost } from "../src/route";

// 제목은 모두 지어낸 것이다.
const post = (title: string, source = "ppomppu") => ({ source, postId: "1", url: "https://example.test/1", title });
const action = (title: string, linked: "gift" | "product" | null = null, source = "ppomppu") => routePost(post(title, source), linked).action;

describe("routePost: 새 글", () => {
  it("상품권 글은 상품권 딜로", () => {
    const r = routePost(post("[지마켓] 컬쳐랜드 문화상품권 5만원권 (46,000원/무료)"), null);
    expect(r.action).toBe("gift");
    if (r.action === "gift") expect(r.parsed.brand).toBe("cultureland");
  });
  it("일반 상품 글은 일반 딜로", () => {
    const r = routePost(post("[쿠팡] 제주 삼다수 2L 12개 (9,900원/무료)"), null);
    expect(r.action).toBe("product");
    if (r.action === "product") expect(r.parsed.merchant).toBe("coupang");
  });
  it("상품권 브랜드와 이름이 겹치는 판매처의 일반 상품은 일반 딜로", () => {
    expect(action("[신세계] 보리차 2L 12개 (9,900원/무료)")).toBe("product");
    expect(action("[쿠팡] 스타벅스 텀블러 500ml (19,900원/무료)")).toBe("product");
  });
  it("상품권 브랜드가 분명한데 가격이 없으면 지금처럼 큐로", () => {
    const r = routePost(post("해피머니 상품권 관련 소식"), null);
    expect(r).toEqual({ action: "queue", reason: "low confidence 0.35" });
  });
  it("적립·추첨 이벤트 글은 어느 쪽으로도 받지 않는다", () => {
    expect(action("네이버페이 9,900원 이상 결제시 50% 적립")).toBe("skip");
    expect(action("[쿠팡] 신제품 출시 기념 추첨 이벤트 (무료)")).toBe("skip");
  });
  it("상품권만 받는 소스의 일반 글은 건너뛴다(큐에도 넣지 않는다)", () => {
    expect(action("[쿠팡] 제주 삼다수 2L 12개 (9,900원/무료)", null, "ppomppu_coupon")).toBe("skip");
    expect(action("[롯데온] 김치냉장고 기획전", null, "ppomppu_coupon")).toBe("skip");
    expect(action("[지마켓] 컬쳐랜드 문화상품권 5만원권 (46,000원/무료)", null, "ppomppu_coupon")).toBe("gift");
  });
  it("종료 표시가 붙은 새 글은 딜을 만들지 않는다", () => {
    expect(action("[종료] [쿠팡] 제주 삼다수 2L 12개 (9,900원/무료)")).toBe("skip");
  });
  it("가격 없는 일반 글은 큐로", () => {
    const r = routePost(post("[롯데온] 김치냉장고 기획전"), null);
    expect(r.action).toBe("queue");
    if (r.action === "queue") expect(r.reason).toMatch(/^product low confidence 0\.\d+$/);
  });
  it("상품명을 못 뽑으면 건너뛴다", () => {
    expect(action("ㅁ")).toBe("skip");
  });
});

describe("routePost: 이미 딜에 연결된 글", () => {
  it("일반 딜에 연결된 글은 다시 본 것만 기록한다", () => {
    expect(action("[쿠팡] 제주 삼다수 2L 12개 (9,900원/무료)", "product")).toBe("touch");
  });
  it("일반 딜에 연결된 글에 종료 표시가 붙으면 닫는다", () => {
    expect(action("[종료] [쿠팡] 제주 삼다수 2L 12개 (9,900원/무료)", "product")).toBe("close");
  });
  it("일반 딜에 연결된 글의 제목이 상품권처럼 바뀌어도 상품권 딜을 만들지 않는다", () => {
    expect(action("[지마켓] 컬쳐랜드 문화상품권 5만원권 (46,000원/무료)", "product")).toBe("touch");
  });
  it("상품권 딜에 연결된 글은 상품권 경로 그대로", () => {
    expect(action("[지마켓] 컬쳐랜드 문화상품권 5만원권 (46,000원/무료)", "gift")).toBe("gift");
  });
  it("상품권 딜에 연결된 글은 일반 딜로 옮기지 않는다", () => {
    expect(action("[쿠팡] 제주 삼다수 2L 12개 (9,900원/무료)", "gift")).toBe("skip");
  });
});
