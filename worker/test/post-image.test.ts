import { describe, it, expect } from "vitest";
import { extractPostImage, sanitizeDetailResults } from "../src/detail";
import { pendingDetailsQuery } from "../src/detail-store";

// 커뮤니티 글의 대표 이미지(og:image)를 썸네일로 쓴다 (D-24, 2026-11-11 사용자 결정). HTML 은 지어낸 것.
const page = (img: string) => `<head><meta property="og:title" content="t"><meta property="og:image" content="${img}"></head>`;

describe("extractPostImage", () => {
  it("루리웹: 원본(/ori/) 대신 작은 판(/thumb/) 주소로 바꾼다", () => {
    expect(extractPostImage("ruliweb", page("https://i3.ruliweb.com/ori/26/11/11/abc123.webp"), "https://bbs.ruliweb.com/market/board/1020/read/1"))
      .toBe("https://i3.ruliweb.com/thumb/26/11/11/abc123.webp");
  });
  it("클리앙: 크기 지정(scale=width:740)을 붙인다. 없으면 이미지가 열리지 않는다", () => {
    expect(extractPostImage("clien", page("https://edgio.clien.net/F01/2026/11/1/abc.jpg"), "https://www.clien.net/service/board/jirum/1"))
      .toBe("https://edgio.clien.net/F01/2026/11/1/abc.jpg?scale=width:740");
    expect(extractPostImage("clien", page("https://edgio.clien.net/F01/2026/11/1/abc.jpg?scale=width:200&amp;x=1"), "https://www.clien.net/service/board/jirum/1"))
      .toBe("https://edgio.clien.net/F01/2026/11/1/abc.jpg?scale=width:740");
  });
  it("그 커뮤니티의 이미지 서버가 아니면 쓰지 않는다", () => {
    expect(extractPostImage("clien", page("https://img.other.test/a.jpg"), "https://www.clien.net/service/board/jirum/1")).toBeNull();
    expect(extractPostImage("ruliweb", page("https://edgio.clien.net/F01/a.jpg"), "https://bbs.ruliweb.com/x")).toBeNull();
    expect(extractPostImage("ruliweb", page("https://ruliweb.com.evil.test/ori/a.webp"), "https://bbs.ruliweb.com/x")).toBeNull();
  });
  it("사이트 기본 이미지(로고 등), http, 이미지 없음, 모르는 소스는 null", () => {
    expect(extractPostImage("ruliweb", page("https://img.ruliweb.com/img/2016/common/ruliweb_logo.png"), "https://bbs.ruliweb.com/x")).toBeNull();
    expect(extractPostImage("clien", page("http://edgio.clien.net/F01/a.jpg"), "https://www.clien.net/x")).toBeNull();
    expect(extractPostImage("clien", "<head></head>", "https://www.clien.net/x")).toBeNull();
    expect(extractPostImage("ppomppu", page("https://cdn4.ppomppu.co.kr/zboard/data3/a.jpg"), "https://www.ppomppu.co.kr/x")).toBeNull();
  });
});

describe("sanitizeDetailResults: 쇼핑몰 주소 없이 이미지만 와도 받는다", () => {
  it("글 대표 이미지는 쇼핑몰 주소와 무관하다", () => {
    expect(sanitizeDetailResults([{ source: "ruliweb", post_id: "3", shop_url: null, image_url: "https://i3.ruliweb.com/thumb/a.webp" }]))
      .toEqual([{ source: "ruliweb", postId: "3", shopUrl: null, imageUrl: "https://i3.ruliweb.com/thumb/a.webp" }]);
  });
});

describe("pendingDetailsQuery: 이미지가 없는 딜의 글도 다시 본다", () => {
  it("쇼핑몰 주소가 있어도 딜에 이미지가 없으면 대상(시도 2회 안에서)", () => {
    const q = pendingDetailsQuery(new Date("2026-11-11T12:00:00Z"));
    expect(q.sql).toMatch(/shop_url IS NULL OR/);
    expect(q.sql).toMatch(/SELECT d\.image_url FROM deals d[^)]*\) IS NULL/);
    expect(q.sql).toMatch(/detail_tries < \?/);
  });
});
