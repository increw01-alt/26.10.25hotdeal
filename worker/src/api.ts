import type { Env } from "./types";
import { num, BRANDS, MERCHANTS } from "./config";
import { isoWeekKST } from "./dedupe";
import { buildIngestCtx, finalizeRun, ingestPosts } from "./collect";
import type { RawPost } from "./types";

/**
 * 공개 피드 API (D-04). 외부 사이트(모두의시세·협회 등)가 가져다 쓰는 엔드포인트.
 *  GET /api/deals.json?limit=50&status=live&brand=cultureland&category=gift
 *  GET /api/brands/{slug}.json
 *  GET /api/weekly/{YYYY-Www}.json
 *  GET /api/deals/{id}.json
 *  GET /api/status.json   (가드·소스 상태, 사이트 배너용)
 *  GET /health
 */
export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  // 개발용 주입: wrangler dev --var DEV_INGEST:true 일 때만. 네트워크 없이 파서·병합·API를 검증한다.
  if (path === "/__dev/ingest" && req.method === "POST") {
    if (env.DEV_INGEST !== "true") return json({ error: "disabled" }, 403);
    const posts = (await req.json()) as RawPost[];
    const ctx = await buildIngestCtx(env);
    const r = await ingestPosts(env, posts, ctx);
    await finalizeRun(env, ctx.medians);
    return json({ ok: true, ...r }, 200, env, 0);
  }
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  try {
    if (path === "/health") return json({ ok: true, time: new Date().toISOString() });
    if (path === "/api/status.json") return json(await statusPayload(env), 200, env, 60);
    if (path === "/api/deals.json") return json(await dealsPayload(env, url.searchParams), 200, env);
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/api\/brands\/([a-z0-9_-]+)\.json$/))) {
      if (!BRANDS.some((b) => b.slug === m![1])) return json({ error: "unknown brand" }, 404);
      const p = new URLSearchParams(url.searchParams); p.set("brand", m[1]);
      return json(await dealsPayload(env, p), 200, env);
    }
    if ((m = path.match(/^\/api\/weekly\/(\d{4}-W\d{2})\.json$/))) return json(await weeklyPayload(env, m[1]), 200, env, 3600);
    if ((m = path.match(/^\/api\/deals\/([a-f0-9]{16})\.json$/))) {
      const d = await dealDetail(env, m[1]);
      return d ? json(d, 200, env) : json({ error: "not found" }, 404);
    }
    if (path === "/api/brands.json") return json({ brands: BRANDS.map(({ slug, name, category }) => ({ slug, name, category })) }, 200, env, 86400);
    return json({ error: "not found", docs: `${env.SITE_URL}/open-data/` }, 404);
  } catch (e) {
    console.error("[api]", (e as Error).message);
    return json({ error: "internal" }, 500);
  }
}

const DEAL_COLUMNS = `id, iso_week, brand, merchant, category, title, face_value, sale_price, discount_rate,
  card_issuers, card_benefit, limit_per_person, payment_note, valid_until, buy_rate, rate_gap, rate_source,
  deal_url, is_affiliate, affiliate_url, status, score, votes_total, comments_total, first_seen, last_seen, ended_at`;

function rowToDeal(r: Record<string, unknown>) {
  const b = BRANDS.find((x) => x.slug === r.brand);
  return {
    ...r,
    brand_name: b?.name ?? r.brand,
    merchant_name: MERCHANTS.find((m) => m.slug === r.merchant)?.name ?? r.merchant ?? null,
    card_issuers: safeJson(r.card_issuers as string, []),
    is_affiliate: !!r.is_affiliate,
    // 제휴 미사용(D-05) 시 affiliate_url은 노출하지 않음
    affiliate_url: r.is_affiliate ? r.affiliate_url : undefined,
  };
}

async function dealsPayload(env: Env, q: URLSearchParams) {
  const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 50) || 50));
  const status = q.get("status") ?? "active"; // active = live+ending
  const where: string[] = []; const binds: unknown[] = [];
  if (status === "active") where.push("status != 'ended'");
  else if (["live", "ending", "ended"].includes(status)) { where.push("status = ?"); binds.push(status); }
  if (q.get("brand")) { where.push("brand = ?"); binds.push(q.get("brand")); }
  if (q.get("category")) { where.push("category = ?"); binds.push(q.get("category")); }
  if (q.get("week")) { where.push("iso_week = ?"); binds.push(q.get("week")); }
  const sort = q.get("sort") === "recent" ? "first_seen DESC" : q.get("sort") === "discount" ? "discount_rate DESC NULLS LAST" : "score DESC";
  const sql = `SELECT ${DEAL_COLUMNS} FROM deals ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${sort} LIMIT ?`;
  const rows = (await env.DB.prepare(sql).bind(...binds, limit).all<Record<string, unknown>>()).results;
  const last = await env.DB.prepare("SELECT ran_at FROM run_log ORDER BY id DESC LIMIT 1").first<{ ran_at: string }>();
  return {
    source: { name: env.SITE_NAME, url: env.SITE_URL, terms: `${env.SITE_URL}/open-data/` },
    generated_at: new Date().toISOString(),
    last_updated: last?.ran_at ?? null,
    week: isoWeekKST(),
    count: rows.length,
    deals: rows.map(rowToDeal),
  };
}

async function weeklyPayload(env: Env, week: string) {
  const rows = (await env.DB.prepare(`SELECT ${DEAL_COLUMNS} FROM deals WHERE iso_week = ? ORDER BY brand, discount_rate DESC`).bind(week).all<Record<string, unknown>>()).results;
  const byBrand: Record<string, unknown[]> = {};
  for (const r of rows) (byBrand[r.brand as string] ??= []).push(rowToDeal(r));
  return { source: { name: env.SITE_NAME, url: env.SITE_URL }, week, count: rows.length, brands: byBrand };
}

async function dealDetail(env: Env, id: string) {
  const deal = await env.DB.prepare(`SELECT ${DEAL_COLUMNS}, dedupe_key FROM deals WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!deal) return null;
  const posts = (await env.DB.prepare("SELECT source, post_url, title, posted_at, votes, comments FROM deal_posts WHERE deal_id = ? ORDER BY first_seen").bind(id).all()).results;
  const prices = (await env.DB.prepare("SELECT date, sale_price, buy_rate, votes, comments FROM deal_prices WHERE deal_id = ? ORDER BY date").bind(id).all()).results;
  // 같은 조건(주차 제외)의 과거 딜: 반복 주차 표시용 (D-02)
  const baseKey = String(deal.dedupe_key).split("|").slice(0, 4).join("|") + "|";
  const history = (await env.DB.prepare("SELECT id, iso_week, sale_price, status, first_seen FROM deals WHERE dedupe_key LIKE ? AND id != ? ORDER BY iso_week DESC LIMIT 8").bind(baseKey + "%", id).all()).results;
  const { dedupe_key: _k, ...rest } = deal;
  return { source: { name: env.SITE_NAME, url: env.SITE_URL }, deal: rowToDeal(rest), posts, prices, history, repeat_weeks: history.length + 1 };
}

async function statusPayload(env: Env) {
  const last = await env.DB.prepare("SELECT ran_at, active_deals, guard_tripped FROM run_log ORDER BY id DESC LIMIT 1").first<{ ran_at: string; active_deals: number; guard_tripped: number }>();
  const sources = (await env.DB.prepare("SELECT source, consecutive_fail, paused_until, last_ok_at, last_item_count FROM source_state").all()).results;
  const staleHours = num(env, "GUARD_STALE_HOURS", 2);
  const ageHours = last ? (Date.now() - new Date(last.ran_at).getTime()) / 3600000 : null;
  return {
    last_updated: last?.ran_at ?? null,
    active_deals: last?.active_deals ?? 0,
    stale: ageHours === null || ageHours > staleHours,
    guard_tripped: !!last?.guard_tripped,
    sources,
  };
}

function safeJson<T>(s: string, fallback: T): T { try { return JSON.parse(s) as T; } catch { return fallback; } }

function cors(): Record<string, string> {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" };
}

function json(body: unknown, status = 200, env?: Env, cacheSeconds?: number): Response {
  const maxAge = cacheSeconds ?? (env ? num(env, "FEED_CACHE_SECONDS", 900) : 0);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": status === 200 ? `public, max-age=${maxAge}, s-maxage=${maxAge}` : "no-store", ...cors() },
  });
}
