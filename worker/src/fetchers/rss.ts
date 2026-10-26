import type { Env, RawPost, SourceDef } from "../types";
import { fetchText, decodeEntities, stripTags } from "./http";

/** RSS 2.0 / Atom 공용 파서 (Workers에 DOMParser가 없어 정규식 사용) */
export function parseFeed(xml: string, source: string): RawPost[] {
  const items: RawPost[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks) {
    const title = pick(block, "title");
    let link = pick(block, "link");
    if (!link) link = /<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? "";
    const guid = pick(block, "guid") || pick(block, "id") || link;
    const date = pick(block, "pubDate") || pick(block, "published") || pick(block, "updated") || pick(block, "dc:date");
    if (!title || !link) continue;
    const postId = extractPostId(link, guid);
    const posted = date ? new Date(date) : null;
    items.push({
      source,
      postId,
      url: decodeEntities(link),
      title: stripTags(title),
      postedAt: posted && !isNaN(posted.getTime()) ? posted.toISOString() : undefined,
      category: pick(block, "category") || undefined,
    });
  }
  return items;
}

function pick(block: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  return m ? decodeEntities(m[1]) : "";
}

/** URL에서 게시글 ID 추출 (no=, id=, 마지막 경로 숫자 순) */
export function extractPostId(link: string, guid: string): string {
  const u = decodeEntities(link);
  // 1) 게시글 번호 파라미터 우선 (no, wr_id, num, idx, sn)
  const q = /[?&](?:no|wr_id|num|idx|sn)=(\d+)/i.exec(u)?.[1];
  if (q) return q;
  // 2) 경로의 마지막 4자리 이상 숫자 세그먼트 (게시판 번호가 아니라 글 번호)
  const segs = [...u.matchAll(/\/(\d{4,})(?=[/?#]|$)/g)].map((m) => m[1]);
  if (segs.length) return segs[segs.length - 1];
  // 3) id= 파라미터 (뽐뿌는 id=게시판명이라 숫자일 때만)
  const idq = /[?&]id=(\d+)/i.exec(u)?.[1];
  if (idq) return idq;
  return guid || u;
}

export async function fetchRss(env: Env, src: SourceDef): Promise<RawPost[]> {
  const xml = await fetchText(env, src.url, "application/rss+xml, application/xml, text/xml, */*");
  const items = parseFeed(xml, src.slug);
  if (items.length === 0) throw new Error(`empty feed ${src.slug}`);
  return items;
}
