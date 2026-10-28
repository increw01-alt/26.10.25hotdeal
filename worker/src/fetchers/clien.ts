import type { Env, RawPost, SourceDef } from "../types";
import { fetchText, stripTags, decodeEntities } from "./http";

/**
 * 클리앙 알뜰구매(jirum) 게시판 HTML 파서. RSS가 404라 목록 페이지를 읽는다.
 * 행 구조(2026-10-28 실서비스 확인): <div class="list_item symph_row jirum" data-board-sn=… data-comment-count=…> 안에
 *   <div class="list_symph view_symph" data-role="list-like-count"><em class="none">추천</em></div>
 *   <span class="list_subject" title="제목"><a href="/service/board/jirum/{id}…" data-role="list-title-text">제목</a>
 *     <a class="list_reply …"><span class="rSymph05">댓글수</span></a></span>
 *   <span class="timestamp">2026-10-27 09:12:00</span>
 * 추천 수는 <em>/<span> 어느 쪽이든, 제목은 <a>/<span> 어느 쪽이든 읽히도록 느슨하게 잡는다.
 */
export function parseClienList(html: string, source: string): RawPost[] {
  const posts: RawPost[] = [];
  const seen = new Set<string>();
  const rowRe = /<div[^>]*class="[^"]*list_item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*list_item[^"]*"|<div[^>]*class="[^"]*board-nav|<\/body>)/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];
    const link = /href="(\/service\/board\/jirum\/(\d+)[^"]*)"/i.exec(row);
    if (!link || seen.has(link[2])) continue;
    const titleHtml = /data-role="list-title-text"[^>]*>([\s\S]*?)<\/(?:a|span)>/i.exec(row)?.[1]
      ?? /class="[^"]*subject_fixed[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(row)?.[1]
      ?? /class="[^"]*list_subject[^"]*"[^>]*title="([^"]+)"/i.exec(row)?.[1] ?? "";
    const title = stripTags(titleHtml);
    if (!title) continue;
    if (/공지|notice/i.test(row.slice(0, 300)) && /list_notice|notice_row/i.test(row)) continue;
    const comments = Number(/data-comment-count="?(\d+)/i.exec(m[0])?.[1]
      ?? /class="[^"]*rSymph05[^"]*"[^>]*>\s*(\d+)/i.exec(row)?.[1] ?? 0);
    const likeHtml = /data-role="list-like-count"[^>]*>([\s\S]*?)<\/(?:div|span)>/i.exec(row)?.[1]
      ?? /class="[^"]*list_symph[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i.exec(row)?.[1] ?? "";
    const votes = Number(/\d+/.exec(stripTags(likeHtml))?.[0] ?? 0);
    const ts = /class="[^"]*timestamp[^"]*"[^>]*>\s*([\d-]+\s[\d:]+)/i.exec(row)?.[1];
    const postedAt = ts ? new Date(ts.replace(" ", "T") + "+09:00") : null;
    seen.add(link[2]);
    posts.push({
      source, postId: link[2],
      url: `https://www.clien.net${decodeEntities(link[1]).split("?")[0]}`,
      title, votes, comments,
      postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt.toISOString() : undefined,
    });
  }
  return posts;
}

export async function fetchClien(env: Env, src: SourceDef): Promise<RawPost[]> {
  const html = await fetchText(env, src.url, { accept: "text/html", ua: src.ua, headers: src.headers });
  const items = parseClienList(html, src.slug);
  if (items.length === 0) throw new Error(`empty list ${src.slug} (markup changed?) [${html.replace(/\s+/g, " ").slice(0, 160)}]`);
  return items;
}
