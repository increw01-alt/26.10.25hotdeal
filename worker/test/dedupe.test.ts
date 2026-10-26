import { describe, it, expect } from "vitest";
import { isoWeekKST, dedupeKey, dealId, dateKST } from "../src/dedupe";

describe("isoWeekKST", () => {
  it("KST 기준 ISO 주차", () => {
    expect(isoWeekKST(new Date("2026-10-26T00:00:00Z"))).toBe("2026-W44"); // 월요일
    expect(isoWeekKST(new Date("2026-10-25T14:59:00Z"))).toBe("2026-W43"); // KST 10/25 23:59 일요일
    expect(isoWeekKST(new Date("2026-10-25T15:00:00Z"))).toBe("2026-W44"); // KST 10/26 00:00 월요일
    expect(isoWeekKST(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
  it("KST 날짜", () => {
    expect(dateKST(new Date("2026-10-25T15:00:00Z"))).toBe("2026-10-26");
  });
});

describe("dedupeKey / dealId", () => {
  it("주차가 다르면 다른 딜", async () => {
    const p = { brand: "cultureland", merchant: "gmarket", faceValue: 50000, salePrice: 46000 };
    const k1 = dedupeKey(p, "2026-W43"); const k2 = dedupeKey(p, "2026-W44");
    expect(k1).toBe("cultureland|gmarket|50000|46000|2026-W43");
    expect(k1).not.toBe(k2);
    const id1 = await dealId(k1); const id2 = await dealId(k2);
    expect(id1).toMatch(/^[a-f0-9]{16}$/);
    expect(id1).not.toBe(id2);
    expect(await dealId(k1)).toBe(id1);
  });
  it("누락 필드는 '-'", () => {
    expect(dedupeKey({ brand: "x", merchant: null, faceValue: null, salePrice: null }, "2026-W01")).toBe("x|-|-|-|2026-W01");
  });
});
