import type { Env, RawPost, SourceDef } from "../types";
import { fetchText, stripTags, decodeEntities } from "./http";

/**
 * 에펨코리아 핫딜 게시판 HTML 파서 (RSS 없음).
 * 행 구조(2026-10 기준): <li class="li …"> <h3 class="title"><a href="/{id}" class="hotdeal_var8 …">제목 <span class="comment_count">[12]</span></a></h3>
 *   <div class="hotdeal_info"><span>쇼핑몰: <a class="strong">네이버</a></span><span>가격: <a class="strong">46,000원</a></span><span>배송: <a class="strong">무료</a></span></div>
 *   <span class="count">추천수</span> (있을 때)
 * 쇼핑몰·가격이 별도 셀이라 제목에 "[쇼핑몰] … (가격)" 형태로 합쳐서 공통 파서가 읽게 한다.
 */
export function parseFmkoreaList(html: string, source: string): RawPost[] {
  const posts: RawPost[] = [];
  const seen = new Set<string>();
  const rowRe = /<li[^>]*class="[^"]*\bli\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];
    const link = /<h3[^>]*class="[^"]*title[^"]*"[^>]*>\s*<a[^>]*href="([^"]*?\/(\d{6,})(?:[?#][^"]*)?)"[^>]*>([\s\S]*?)<\/a>/i.exec(row)
      ?? /<a[^>]*href="([^"]*?\/(\d{6,}))"[^>]*class="[^"]*hotdeal_var8[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!link || seen.has(link[2])) continue;
    const rawTitle = stripTags(link[3].replace(/<span[^>]*class="[^"]*comment_count[^"]*"[^>]*>[\s\S]*?<\/span>/i, ""));
    if (!rawTitle) continue;
    const comments = Number(/class="[^"]*comment_count[^"]*"[^>]*>\s*\[?(\d+)/i.exec(row)?.[1] ?? 0);
    const votes = Number(/class="[^"]*\bcount\b[^"]*"[^>]*>\s*(\d+)/i.exec(row)?.[1] ?? 0);
    const info = /<div[^>]*class="[^"]*hotdeal_info[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1] ?? "";
    const field = (label: string) => stripTags(new RegExp(`${label}\\s*:?\\s*<a[^>]*>([\\s\\S]*?)<\\/a>`, "i").exec(info)?.[1] ?? "");
    const shop = field("쇼핑몰"), price = field("가격"), ship = field("배송");
    const title = `${shop ? `[${shop}] ` : ""}${rawTitle}${price ? ` (${price}${ship ? `/${ship}` : ""})` : ""}`.trim();
    const href = decodeEntities(link[1]);
    seen.add(link[2]);
    posts.push({ source, postId: link[2], url: href.startsWith("http") ? href : `https://www.fmkorea.com/${link[2]}`, title, votes, comments });
  }
  return posts;
}

export async function fetchFmkorea(env: Env, src: SourceDef): Promise<RawPost[]> {
  const html = await fetchText(env, src.url, "text/html");
  const items = parseFmkoreaList(html, src.slug);
  if (items.length === 0) throw new Error(`empty list ${src.slug} (markup changed or blocked?) [${html.replace(/\s+/g, " ").slice(0, 160)}]`);
  return items;
}
