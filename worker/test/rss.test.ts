import { describe, it, expect } from "vitest";
import { parseFeed, extractPostId } from "../src/fetchers/rss";
import { parseQuasarzoneList } from "../src/fetchers/quasarzone";

describe("parseFeed", () => {
  it("RSS 2.0 item을 읽는다 (CDATA·엔티티 포함)", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?><rss><channel>
      <item><title><![CDATA[[지마켓] 컬쳐랜드 5만원 (46,000원/무료)]]></title>
        <link>https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&amp;no=123456</link>
        <pubDate>Mon, 26 Oct 2026 09:00:00 +0900</pubDate></item>
      <item><title>해피머니 &amp; 컬쳐랜드 8%</title><link>https://www.clien.net/service/board/jirum/19048864</link></item>
    </channel></rss>`;
    const items = parseFeed(xml, "ppomppu");
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("[지마켓] 컬쳐랜드 5만원 (46,000원/무료)");
    expect(items[0].url).toBe("https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123456");
    expect(items[0].postId).toBe("123456");
    expect(items[0].postedAt).toBe("2026-10-26T00:00:00.000Z");
    expect(items[1].title).toBe("해피머니 & 컬쳐랜드 8%");
    expect(items[1].postId).toBe("19048864");
  });
  it("Atom entry도 읽는다", () => {
    const xml = `<feed><entry><title>t</title><link href="https://x.test/board/555555"/><id>urn:1</id><updated>2026-10-26T00:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml, "s")[0].postId).toBe("555555");
  });
});

describe("extractPostId", () => {
  it("쿼리·경로에서 ID", () => {
    expect(extractPostId("https://a.test/view.php?id=ppomppu&no=42", "")).toBe("42");
    expect(extractPostId("https://bbs.ruliweb.com/market/board/1020/read/12345678", "")).toBe("12345678");
  });
});

describe("parseQuasarzoneList", () => {
  it("목록 행에서 글을 추출한다", () => {
    const html = `<table><tr><td><span class="category">상품권</span></td><td>
      <a href="/bbs/qb_saleinfo/views/1608380"><span class="ellipsis-with-reply-cnt">[네이버] 컬쳐랜드 5만원 46,000원</span></a>
      <span class="reply-count">12</span></td><td><span class="count">34</span></td></tr></table>`;
    const posts = parseQuasarzoneList(html, "quasarzone");
    expect(posts).toHaveLength(1);
    expect(posts[0].postId).toBe("1608380");
    expect(posts[0].title).toBe("[네이버] 컬쳐랜드 5만원 46,000원");
    expect(posts[0].category).toBe("상품권");
    expect(posts[0].url).toBe("https://quasarzone.com/bbs/qb_saleinfo/views/1608380");
  });
});
