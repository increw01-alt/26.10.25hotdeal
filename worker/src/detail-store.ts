/**
 * 상세 수집(쇼핑몰 주소·대표 이미지)의 DB 쪽 (D-22).
 * 중계가 pendingDetails 로 대상 글을 받아 가고, applyDetails 로 결과를 돌려준다.
 */
import type { Env } from "./types";
import { DETAIL_SOURCES, merchantFromShopUrl, type DetailResult } from "./detail";

export const DETAIL_MAX_TRIES = 2;
export const DETAIL_WINDOW_HOURS = 24;
/** 한 번에 소스마다 줄 글 수. 소스별로 따로 세어, 한 소스가 막혀도 다른 소스의 글이 밀리지 않는다 */
export const DETAIL_BATCH = 4;

/** 상세가 필요한 글: 쇼핑몰 주소가 없고, 시도 2회 미만, 24시간 이내, 닫히지 않은 글. 최신 먼저 */
export function pendingDetailsQuery(now = new Date(), limit = DETAIL_BATCH): { sql: string; binds: unknown[] } {
  const since = new Date(now.getTime() - DETAIL_WINDOW_HOURS * 3600_000).toISOString();
  const marks = DETAIL_SOURCES.map(() => "?").join(",");
  return {
    sql: `SELECT source, post_id, post_url FROM (
            SELECT source, post_id, post_url, first_seen,
                   ROW_NUMBER() OVER (PARTITION BY source ORDER BY first_seen DESC) AS rn
            FROM deal_posts
            WHERE detail_tries < ? AND first_seen > ? AND shop_url IS NULL AND closed = 0 AND source IN (${marks})
          ) WHERE rn <= ? ORDER BY first_seen DESC`,
    binds: [DETAIL_MAX_TRIES, since, ...DETAIL_SOURCES, Math.min(Math.max(1, Math.floor(limit) || DETAIL_BATCH), 10)],
  };
}

export async function pendingDetails(env: Env, limit?: number) {
  const { sql, binds } = pendingDetailsQuery(new Date(), limit);
  return (await env.DB.prepare(sql).bind(...binds).all<{ source: string; post_id: string; post_url: string }>()).results;
}

/**
 * 결과 반영. 글은 시도 횟수를 올리고 주소를 채운다(이미 있으면 유지).
 * 딜은 비어 있을 때만 채운다. 이미지는 그 딜의 쇼핑몰 주소와 같은 글에서 온 것만 받는다.
 */
export async function applyDetails(env: Env, results: DetailResult[]): Promise<{ posts: number; withShop: number; withImage: number }> {
  if (!results.length) return { posts: 0, withShop: 0, withImage: 0 };
  const stmts: D1PreparedStatement[] = [];
  for (const r of results) {
    stmts.push(env.DB.prepare("UPDATE deal_posts SET detail_tries = detail_tries + 1, shop_url = COALESCE(shop_url, ?) WHERE source = ? AND post_id = ?").bind(r.shopUrl, r.source, r.postId));
    if (r.shopUrl) {
      stmts.push(env.DB.prepare(
        `UPDATE deals SET
           image_url = CASE WHEN image_url IS NULL AND (shop_url IS NULL OR shop_url = ?) THEN ? ELSE image_url END,
           shop_url = COALESCE(shop_url, ?),
           merchant = COALESCE(merchant, ?)
         WHERE id = (SELECT deal_id FROM deal_posts WHERE source = ? AND post_id = ?)`,
      ).bind(r.shopUrl, r.imageUrl, r.shopUrl, merchantFromShopUrl(r.shopUrl), r.source, r.postId)); // 제목에 판매처가 없던 딜은 쇼핑몰 도메인으로 채운다
    }
  }
  await env.DB.batch(stmts);
  return { posts: results.length, withShop: results.filter((r) => r.shopUrl).length, withImage: results.filter((r) => r.imageUrl).length };
}
