import { describe, it, expect } from "vitest";
import { parseClienList } from "../src/fetchers/clien";
import { parseFmkoreaList } from "../src/fetchers/fmkorea";

describe("parseClienList", () => {
  const html = `
  <div class="list_content">
    <div class="list_item symph_row jirum" data-board-sn="19100001" data-role="list-row">
      <div class="list_title"><a class="list_subject" href="/service/board/jirum/19100001?od=T31&po=0&category=0" title="컬쳐랜드 5만원 46,000원 (지마켓/무료)">
        <span class="subject_fixed" data-role="list-title-text" title="컬쳐랜드 5만원 46,000원 (지마켓/무료)">컬쳐랜드 5만원 46,000원 (지마켓/무료)</span></a>
        <a class="list_reply reply_symph" href="#"><span class="rSymph05">14</span></a></div>
      <div class="list_symph view_symph" data-role="list-like-count"><span>9</span></div>
      <div class="list_time"><span class="time popover"><span class="timestamp">2026-10-27 09:12:34</span>09:12</span></div>
    </div>
    <div class="list_item symph_row jirum" data-board-sn="19100002">
      <a class="list_subject" href="/service/board/jirum/19100002"><span class="subject_fixed" data-role="list-title-text">해피머니 10만원 8% (옥션)</span></a>
    </div>
    <div class="board-nav"></div>
  </div>`;
  it("행에서 ID·제목·추천·댓글·시각을 읽는다", () => {
    const posts = parseClienList(html, "clien");
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ postId: "19100001", url: "https://www.clien.net/service/board/jirum/19100001", title: "컬쳐랜드 5만원 46,000원 (지마켓/무료)", votes: 9, comments: 14 });
    expect(posts[0].postedAt).toBe("2026-10-27T00:12:34.000Z");
    expect(posts[1]).toMatchObject({ postId: "19100002", votes: 0, comments: 0 });
  });
  it("빈 HTML이면 0건", () => { expect(parseClienList("<html></html>", "clien")).toHaveLength(0); });
});

describe("parseFmkoreaList", () => {
  const html = `
  <ul class="li_best2_pop0">
    <li class="li li_best2_pop0 li_best2_top0">
      <div class="li_wrap"><h3 class="title"><a href="/8812345678" class="hotdeal_var8 pc_voted_count">[네이버] 컬쳐랜드 문화상품권 5만원 <span class="comment_count">[23]</span></a></h3>
      <div class="hotdeal_info"><span>쇼핑몰: <a href="#" class="strong">네이버</a></span><span>가격: <a href="#" class="strong">46,000원</a></span><span>배송: <a href="#" class="strong">무료</a></span></div>
      <span class="count">31</span></div>
    </li>
    <li class="li"><h3 class="title"><a href="https://www.fmkorea.com/8812345679" class="hotdeal_var8">해피머니 10만원 8% 할인</a></h3>
      <div class="hotdeal_info"><span>쇼핑몰: <a class="strong">옥션</a></span><span>가격: <a class="strong">92,000원</a></span></div></li>
  </ul>`;
  it("쇼핑몰·가격을 제목에 합쳐 공통 파서가 읽을 수 있게 한다", () => {
    const posts = parseFmkoreaList(html, "fmkorea");
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ postId: "8812345678", url: "https://www.fmkorea.com/8812345678", votes: 31, comments: 23 });
    expect(posts[0].title).toBe("[네이버] [네이버] 컬쳐랜드 문화상품권 5만원 (46,000원/무료)");
    expect(posts[1].title).toBe("[옥션] 해피머니 10만원 8% 할인 (92,000원)");
    expect(posts[1].url).toBe("https://www.fmkorea.com/8812345679");
  });
});
