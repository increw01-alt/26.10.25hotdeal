import type { Env, RawPost, SourceDef } from "../types";
import { fetchText, stripTags } from "./http";

/**
 * 퀘이사존 지름/할인정보 게시판 HTML 목록 파서.
 * 구조 변경에 대비해 느슨한 패턴을 쓰고, 0건이면 예외를 던져 서킷 브레이커가 잡게 한다.
 * 네트워크 허용 후 실제 마크업으로 셀렉터를 확정할 것.
 */
export function parseQuasarzoneList(html: string, source: string): RawPost[] {
  const posts: RawPost[] = [];
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const link = /href="([^"]*\/bbs\/qb_saleinfo\/views\/(\d+)[^"]*)"/i.exec(row);
    if (!link) continue;
    const titleHtml = /<span[^>]*class="[^"]*ellipsis-with-reply-cnt[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(row)?.[1]
      ?? /<a[^>]*href="[^"]*views\/\d+[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(row)?.[1] ?? "";
    const title = stripTags(titleHtml);
    if (!title) continue;
    const category = stripTags(/<span[^>]*class="[^"]*category[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(row)?.[1] ?? "");
    const comments = Number(/<span[^>]*class="[^"]*(?:reply|cmt|comment)[^"]*"[^>]*>\s*(\d+)/i.exec(row)?.[1] ?? 0);
    const votes = Number(/<span[^>]*class="[^"]*(?:count|recommend|num)[^"]*"[^>]*>\s*(\d+)\s*<\/span>/i.exec(row)?.[1] ?? 0);
    const url = link[1].startsWith("http") ? link[1] : `https://quasarzone.com${link[1]}`;
    posts.push({ source, postId: link[2], url, title, category: category || undefined, comments, votes });
  }
  return posts;
}

export async function fetchQuasarzone(env: Env, src: SourceDef): Promise<RawPost[]> {
  const html = await fetchText(env, src.url, { accept: "text/html", ua: src.ua, headers: src.headers });
  const items = parseQuasarzoneList(html, src.slug);
  if (items.length === 0) throw new Error(`empty list ${src.slug} (markup changed?)`);
  return items;
}
