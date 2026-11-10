import { describe, it, expect } from "vitest";
import { extractShopUrl, cleanShopUrl, extractOgImage, shouldFetchImage, sanitizeDetailResults, detailPageUrl } from "../src/detail";

// HTML 조각은 모두 지어낸 것이다(구조만 실제와 같다).
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("extractShopUrl: 뽐뿌", () => {
  const page = (target: string) => `<td><!--DCM_BODY--><a class="scrap_bx_href" href="https://s.ppomppu.co.kr?idno=ppomppu_1&amp;target=${target}&amp;encode=on" target="_blank"><div class="scrap_bx"></div></a></td>`;
  it("target 을 base64 로 풀어 쇼핑몰 주소를 얻는다", () => {
    expect(extractShopUrl("ppomppu", page(b64("https://www.example-shop.test/p/123?a=1&b=2")))).toBe("https://www.example-shop.test/p/123?a=1&b=2");
  });
  it("뽐뿌 쿠폰게시판도 같은 규칙", () => {
    expect(extractShopUrl("ppomppu_coupon", page(b64("https://shop.test/x")))).toBe("https://shop.test/x");
  });
  it("target 이 없거나 풀리지 않으면 null", () => {
    expect(extractShopUrl("ppomppu", `<a class="scrap_bx_href" href="https://s.ppomppu.co.kr?idno=1">x</a>`)).toBeNull();
    expect(extractShopUrl("ppomppu", page("%%%"))).toBeNull();
    expect(extractShopUrl("ppomppu", "<p>링크 없음</p>")).toBeNull();
  });
  it("풀린 값이 주소가 아니면 null", () => {
    expect(extractShopUrl("ppomppu", page(b64("javascript:alert(1)")))).toBeNull();
  });
});

describe("extractShopUrl: 루리웹", () => {
  const page = (ol: string) => `<div class="source_url box_line_with_shadow"><span class="text_bar">출처 : </span> <a href="https://web.ruliweb.com/link.php?ol=${ol}&amp;bbs=1020" target="_blank">x</a></div>`;
  it("ol 값을 디코딩한다", () => {
    expect(extractShopUrl("ruliweb", page(encodeURIComponent("https://m.example-shop.test/vi/product/42")))).toBe("https://m.example-shop.test/vi/product/42");
  });
  it("출처 칸이 없으면 null", () => {
    expect(extractShopUrl("ruliweb", `<a href="https://shop.test/a">본문 링크</a>`)).toBeNull();
  });
  it("출처가 루리웹 자기 주소면 null", () => {
    expect(extractShopUrl("ruliweb", page(encodeURIComponent("https://bbs.ruliweb.com/market/board/1020/read/1")))).toBeNull();
  });
});

describe("extractShopUrl: 클리앙", () => {
  const wrap = (inner: string) => `<nav><a href="https://ad.example.test/banner">광고</a></nav><main><article class="post"><header><h1>제목</h1></header>${inner}</article><section class="comments"><a href="https://comment-shop.test/z">댓글 링크</a></section></main>`;
  it("구매링크 칸을 먼저 쓴다", () => {
    const html = wrap(`<p class="attached">구매링크 <a href="https://brand.example-shop.test/p/1?x=1&amp;y=2" target="_blank">t</a></p><div class="content"><a href="https://other.test/a">다른 링크</a></div>`);
    expect(extractShopUrl("clien", html)).toBe("https://brand.example-shop.test/p/1?x=1&y=2");
  });
  it("구매링크 칸이 없으면 본문의 첫 링크, 단 블로그·레딧·유튜브·커뮤니티는 건너뛴다", () => {
    const html = wrap(`<div class="content"><a href="https://www.reddit.com/r/x">r</a><a href="https://m.blog.naver.com/abc/1">b</a><a href="https://youtu.be/abc">y</a><a href="https://www.clien.net/service/board/jirum/1">c</a><a href="https://www.example-shop.test/item/9">shop</a></div>`);
    expect(extractShopUrl("clien", html)).toBe("https://www.example-shop.test/item/9");
  });
  it("글 밖(머리말, 댓글)의 링크는 보지 않는다", () => {
    expect(extractShopUrl("clien", wrap(`<div class="content"><p>링크 없는 글</p></div>`))).toBeNull();
  });
});

describe("extractShopUrl: 그 밖의 소스", () => {
  it("모르는 소스는 null", () => expect(extractShopUrl("fmkorea", `<a href="https://shop.test/a">x</a>`)).toBeNull());
});

describe("cleanShopUrl", () => {
  it("http, https 만 허용", () => {
    expect(cleanShopUrl("https://shop.test/a")).toBe("https://shop.test/a");
    expect(cleanShopUrl("http://shop.test/a")).toBe("http://shop.test/a");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://shop.test/a", "//shop.test/a", "shop.test/a", "", null, undefined, 42]) expect(cleanShopUrl(bad as never)).toBeNull();
  });
  it("커뮤니티 주소는 쇼핑몰이 아니다", () => {
    for (const u of ["https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1", "https://s.ppomppu.co.kr?target=x", "https://bbs.ruliweb.com/a", "https://www.clien.net/service/board/jirum/1", "https://www.fmkorea.com/1", "https://quasarzone.com/a"]) expect(cleanShopUrl(u)).toBeNull();
  });
  it("utm_ 쿼리만 지우고 나머지는 그대로", () => {
    expect(cleanShopUrl("https://shop.test/p?id=3&utm_source=a&utm_medium=b&ref=zz")).toBe("https://shop.test/p?id=3&ref=zz");
    expect(cleanShopUrl("https://shop.test/p?utm_campaign=x")).toBe("https://shop.test/p");
  });
  it("2,000자를 넘으면 null, 앞뒤 공백은 정리", () => {
    expect(cleanShopUrl("https://shop.test/" + "a".repeat(2001))).toBeNull();
    expect(cleanShopUrl("  https://shop.test/a  ")).toBe("https://shop.test/a");
  });
  it("따옴표·꺾쇠가 든 주소는 인코딩된 형태로만 나온다", () => {
    const out = cleanShopUrl(`https://shop.test/a"onmouseover="x<script>`);
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/["<>]/);
  });
});

describe("extractOgImage", () => {
  const meta = (c: string) => `<head><meta property="og:title" content="t"><meta property="og:image" content="${c}"></head>`;
  it("절대 https 주소", () => expect(extractOgImage(meta("https://img.shop.test/item/1.jpg"), "https://shop.test/p/1")).toBe("https://img.shop.test/item/1.jpg"));
  it("content 가 property 앞에 와도 읽는다", () => {
    expect(extractOgImage(`<meta content="https://img.shop.test/2.png" property="og:image">`, "https://shop.test/p")).toBe("https://img.shop.test/2.png");
  });
  it("프로토콜 생략·상대 주소는 페이지 주소로 완성", () => {
    expect(extractOgImage(meta("//img.shop.test/goods/3.png"), "https://shop.test/p")).toBe("https://img.shop.test/goods/3.png");
    expect(extractOgImage(meta("/goods/4.jpg"), "https://shop.test/p/1")).toBe("https://shop.test/goods/4.jpg");
  });
  it("http 이미지와 주소가 아닌 값은 null", () => {
    expect(extractOgImage(meta("http://img.shop.test/5.jpg"), "https://shop.test/p")).toBeNull();
    expect(extractOgImage(meta("javascript:alert(1)"), "https://shop.test/p")).toBeNull();
    expect(extractOgImage("<head></head>", "https://shop.test/p")).toBeNull();
  });
  it("사이트 공통 이미지(로고, og-image, 기본, 공유용)는 null", () => {
    for (const p of ["/static/img/global/og-image.png", "/img/og_image.jpg", "/assets/logo.png", "/images/default.jpg", "/common/share.png", "/favicon.ico"]) {
      expect(extractOgImage(meta(`https://shop.test${p}`), "https://shop.test/p")).toBeNull();
    }
  });
  it("&amp; 를 풀고 1,000자를 넘으면 null", () => {
    expect(extractOgImage(meta("https://img.shop.test/6.jpg?w=1&amp;h=2"), "https://shop.test/p")).toBe("https://img.shop.test/6.jpg?w=1&h=2");
    expect(extractOgImage(meta("https://img.shop.test/" + "a".repeat(1001)), "https://shop.test/p")).toBeNull();
  });
});

describe("shouldFetchImage", () => {
  it("봇을 막는 큰 판매처는 요청하지 않는다", () => {
    for (const u of ["https://www.coupang.com/vp/products/1", "https://link.coupang.com/a/x", "https://m.gmarket.co.kr/vi/product/1", "https://item.auction.co.kr/1", "https://brand.naver.com/a/products/1", "https://smartstore.naver.com/a/products/1", "https://naver.me/abc", "https://www.11st.co.kr/products/1"]) expect(shouldFetchImage(u)).toBe(false);
  });
  it("그 밖의 판매처는 요청한다", () => {
    expect(shouldFetchImage("https://www.example-shop.test/p/1")).toBe(true);
    expect(shouldFetchImage("https://notcoupang.com.shop.test/p")).toBe(true);
  });
  it("주소가 아니면 false", () => expect(shouldFetchImage("x")).toBe(false));
  it("IP 주소·내부 이름으로는 요청하지 않는다", () => {
    for (const u of ["http://127.0.0.1/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/x", "http://localhost/x", "http://intra.local/x", "http://db.internal/x"]) expect(shouldFetchImage(u)).toBe(false);
  });
});

describe("detailPageUrl", () => {
  it("클리앙은 쿼리를 떼고(robots 가 ? 를 막는다) https 로 맞춘다", () => {
    expect(detailPageUrl("clien", "https://www.clien.net/service/board/jirum/123?od=T31&po=0")).toBe("https://www.clien.net/service/board/jirum/123");
    expect(detailPageUrl("ppomppu", "http://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=7")).toBe("https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=7");
  });
  it("소스의 도메인이 아니면 null (엉뚱한 곳으로 요청하지 않는다)", () => {
    expect(detailPageUrl("clien", "https://evil.test/service/board/jirum/1")).toBeNull();
    expect(detailPageUrl("ruliweb", "https://bbs.ruliweb.com/market/board/1020/read/9")).toBe("https://bbs.ruliweb.com/market/board/1020/read/9");
    expect(detailPageUrl("fmkorea", "https://www.fmkorea.com/1")).toBeNull();
  });
});

describe("sanitizeDetailResults", () => {
  it("형식이 맞는 건만, 주소는 다시 검사, 최대 20건", () => {
    const out = sanitizeDetailResults([
      { source: "ppomppu", post_id: "1", shop_url: "https://shop.test/a?utm_source=x", image_url: "https://img.shop.test/a.jpg" },
      { source: "clien", post_id: "2", shop_url: "javascript:alert(1)", image_url: "http://img.shop.test/a.jpg" },
      { source: "ruliweb", post_id: "3", shop_url: null, image_url: "https://img.shop.test/b.jpg" },
      { source: 5, post_id: "4" }, null, "x",
    ]);
    expect(out).toEqual([
      { source: "ppomppu", postId: "1", shopUrl: "https://shop.test/a", imageUrl: "https://img.shop.test/a.jpg" },
      { source: "clien", postId: "2", shopUrl: null, imageUrl: null },
      { source: "ruliweb", postId: "3", shopUrl: null, imageUrl: null }, // 쇼핑몰 주소 없이 이미지만 오면 버린다
    ]);
    expect(sanitizeDetailResults(Array.from({ length: 30 }, (_, i) => ({ source: "clien", post_id: String(i), shop_url: null, image_url: null })))).toHaveLength(20);
    expect(sanitizeDetailResults({ nope: 1 })).toEqual([]);
  });
});
