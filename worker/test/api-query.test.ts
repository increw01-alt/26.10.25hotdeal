import { describe, it, expect } from "vitest";
import { buildDealsQuery, rowToDeal } from "../src/api";

const q = (s: string) => buildDealsQuery(new URLSearchParams(s));

describe("buildDealsQuery", () => {
  it("기본값: 전체 종류, 진행 중, 점수순, 50건", () => {
    const r = q("");
    expect(r.sql).toContain("status != 'ended'");
    expect(r.sql).not.toContain("kind = ?");
    expect(r.sql).toContain("ORDER BY score DESC");
    expect(r.limit).toBe(50);
    expect(r.offset).toBe(0);
    expect(r.binds).toEqual([51, 0]); // has_more 판정용으로 한 건 더 읽는다
  });
  it("kind·merchant·offset, limit 상한 500", () => {
    const r = q("kind=product&merchant=coupang&limit=9999&offset=100");
    expect(r.sql).toContain("kind = ?");
    expect(r.sql).toContain("merchant = ?");
    expect(r.limit).toBe(500);
    expect(r.offset).toBe(100);
    expect(r.binds).toEqual(["product", "coupang", 501, 100]);
  });
  it("알 수 없는 kind는 전체", () => {
    expect(q("kind=bogus").sql).not.toContain("kind = ?");
    expect(q("kind=all").sql).not.toContain("kind = ?");
  });
  it("기존 파라미터(brand, status, sort)는 그대로", () => {
    const r = q("brand=cultureland&status=ended&sort=recent");
    expect(r.sql).toContain("brand = ?");
    expect(r.sql).toContain("status = ?");
    expect(r.sql).toContain("ORDER BY first_seen DESC");
    expect(r.binds).toEqual(["ended", "cultureland", 51, 0]);
  });
  it("음수·문자 offset은 0", () => {
    expect(q("offset=-5").offset).toBe(0);
    expect(q("offset=abc").offset).toBe(0);
  });
});

describe("rowToDeal", () => {
  it("일반 딜: brand_name 없음, 사전에 없는 판매처는 merchant_name 없음, sources 배열", () => {
    const d = rowToDeal({ brand: "-", kind: "product", merchant: null, merchant_raw: "하프클럽", sources: "clien,ppomppu", card_issuers: "[]", is_affiliate: 0 });
    expect(d.brand_name).toBeNull();
    expect(d.merchant_name).toBeNull();
    expect(d.sources).toEqual(["clien", "ppomppu"]);
    expect(d.kind).toBe("product");
  });
  it("일반 딜: 사전에 있는 새 판매처 이름", () => {
    expect(rowToDeal({ brand: "-", kind: "product", merchant: "tossshopping", card_issuers: "[]", sources: "clien" }).merchant_name).toBe("토스쇼핑");
  });
  it("상품권 딜: kind 기본값 gift, 이름 채움, sources 없으면 빈 배열", () => {
    const d = rowToDeal({ brand: "cultureland", merchant: "gmarket", card_issuers: "[\"shinhan\"]", sources: null });
    expect(d.kind).toBe("gift");
    expect(d.brand_name).toBe("컬쳐랜드");
    expect(d.merchant_name).toBe("지마켓");
    expect(d.card_issuers).toEqual(["shinhan"]);
    expect(d.sources).toEqual([]);
  });
});
