import { describe, it, expect } from "vitest";
import { MERCHANTS, GIFT_MERCHANTS, sourceKinds } from "../src/config";
import { parseTitle } from "../src/parse";

const post = (title: string) => ({ source: "ppomppu", postId: "1", url: "https://example.test/1", title });

describe("판매처 사전", () => {
  it("새 판매처는 product_only이고 기존 13곳은 그대로다", () => {
    expect(GIFT_MERCHANTS.map((m) => m.slug)).toEqual(["gmarket", "auction", "11st", "coupang", "naver", "ssg", "lotteon", "kakao", "toss", "payco", "cardmall", "cultureland_direct", "happymoney_direct"]);
    expect(MERCHANTS.length).toBe(41);
    expect(MERCHANTS.find((m) => m.slug === "tossshopping")!.product_only).toBe(true);
  });
  it("slug가 겹치지 않는다", () => {
    expect(new Set(MERCHANTS.map((m) => m.slug)).size).toBe(MERCHANTS.length);
  });
  it("상품권 파서는 새 판매처를 보지 않는다", () => {
    expect(parseTitle(post("토스쇼핑 컬쳐랜드 5만원권 46,000원"))!.merchant).toBe("toss");
  });
});

describe("sourceKinds", () => {
  it("뽐뿌 쿠폰게시판은 상품권만 받는다", () => {
    expect(sourceKinds("ppomppu_coupon")).toEqual(["gift"]);
    expect(sourceKinds("clien")).toEqual(["gift", "product"]);
    expect(sourceKinds("unknown")).toEqual(["gift", "product"]);
  });
});
