import { describe, it, expect } from "vitest";
import { tokenize, jaccard, pickGroup, merchantKey, productDedupeKey } from "../src/group";

describe("tokenize", () => {
  it("소문자화하고 불용어·1글자 토큰을 버리고 정렬한다", () => {
    expect(tokenize("삼다수 2L 12개 무료배송 특가!")).toEqual(["12개", "2l", "삼다수"]);
  });
  it("중복을 없앤다", () => {
    expect(tokenize("커피 커피 믹스 A")).toEqual(["믹스", "커피"]);
  });
  it("불용어뿐이면 빈 배열", () => {
    expect(tokenize("특가 핫딜 무배")).toEqual([]);
  });
});

describe("jaccard", () => {
  it("같은 집합은 1", () => expect(jaccard(["a1", "b1"], ["a1", "b1"])).toBe(1));
  it("빈 집합끼리는 0 (불용어뿐인 제목을 묶지 않는다)", () => {
    expect(jaccard([], [])).toBe(0);
    expect(jaccard([], ["a1"])).toBe(0);
  });
  it("교집합/합집합", () => expect(jaccard(["삼다수", "2l", "12개"], ["삼다수", "2l", "24개"])).toBeCloseTo(0.5));
});

describe("pickGroup", () => {
  const target = ["12개", "2l", "삼다수"];
  it("기준 이상 중 가장 비슷한 딜을 고른다", () => {
    expect(pickGroup(target, [{ id: "x", tokens: ["생수", "500ml"] }, { id: "y", tokens: ["12개", "2l", "삼다수", "제주"] }, { id: "z", tokens: ["12개", "2l", "삼다수"] }])).toBe("z");
  });
  it("기준(0.5) 미만이면 null", () => {
    expect(pickGroup(["삼다수"], [{ id: "x", tokens: ["생수"] }])).toBeNull();
    expect(pickGroup(target, [])).toBeNull();
  });
  it("정확히 0.5면 묶는다", () => {
    expect(pickGroup(["삼다수", "2l", "12개"], [{ id: "x", tokens: ["삼다수", "2l", "24개"] }])).toBe("x");
  });
  it("동점이면 앞선 후보", () => {
    expect(pickGroup(["a1", "b1"], [{ id: "p", tokens: ["a1", "b1"] }, { id: "q", tokens: ["b1", "a1"] }])).toBe("p");
  });
});

describe("merchantKey", () => {
  it("slug 우선, 없으면 정규화한 원문, 둘 다 없으면 -", () => {
    expect(merchantKey("coupang", null)).toBe("coupang");
    expect(merchantKey(null, "하프 클럽")).toBe("raw:하프클럽");
    expect(merchantKey(null, null)).toBe("-");
  });
});

describe("productDedupeKey", () => {
  it("product|판매처키|가격|토큰 해시|주차", async () => {
    expect(await productDedupeKey({ merchantKey: "coupang", price: 9900, tokens: ["a1"] }, "2026-W46")).toMatch(/^product\|coupang\|9900\|[a-f0-9]{12}\|2026-W46$/);
  });
  it("가격이 없으면 -", async () => {
    expect(await productDedupeKey({ merchantKey: "-", price: null, tokens: ["a1"] }, "2026-W46")).toMatch(/^product\|-\|-\|[a-f0-9]{12}\|2026-W46$/);
  });
  it("토큰 순서가 달라도 같은 키, 토큰이 다르면 다른 키", async () => {
    const k = (tokens: string[]) => productDedupeKey({ merchantKey: "coupang", price: 9900, tokens }, "2026-W46");
    expect(await k(["b1", "a1"])).toBe(await k(["a1", "b1"]));
    expect(await k(["a1"])).not.toBe(await k(["a1", "b1"]));
  });
});
