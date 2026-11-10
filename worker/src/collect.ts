import type { Env, ParsedDeal, ParsedProduct, RawPost } from "./types";
import { cronSources } from "./config";
import { fetchSource } from "./fetchers";
import { routePost } from "./route";
import { merchantKey, pickGroup, productDedupeKey } from "./group";
import { dedupeKey, dealId, isoWeekKST, dateKST, sha1 } from "./dedupe";
import { computeScore, median } from "./score";
import { checkActiveRatio, isPaused, recordSourceFail, recordSourceOk } from "./guards";
import { notifyOps } from "./notify";
import { loadRates, rateForBrand } from "./rates";

const ENDED_AFTER_HOURS = 48;   // 상품권: 48시간 동안 어느 소스에서도 안 보이면 종료
const ENDING_AFTER_HOURS = 24;  // 상품권: 24시간 넘게 안 보이면 종료 임박
export const PRODUCT_ENDED_AFTER_HOURS = 24;  // 일반 딜은 빨리 소진된다 (D-18)
export const PRODUCT_ENDING_AFTER_HOURS = 12;
/** 점수가 이만큼 이상 달라졌을 때만 다시 쓴다(1분마다 진행 중 딜 전부를 쓰지 않기 위해) */
export const SCORE_WRITE_DELTA = 0.002;
/** 이미 연결된 일반 딜 글은 이 간격 안에 다시 봐도 쓰지 않는다(추천·댓글이 늘었거나 닫힘이 풀릴 때는 쓴다) */
const TOUCH_INTERVAL_MIN = 10;

export interface RunSummary {
  fetched: number; parsed: number; newDeals: number; activeDeals: number; guardTripped: boolean; errors: string[];
}

/** Cron 1회 실행 파이프라인 */
export async function runCollection(env: Env): Promise<RunSummary> {
  const now = new Date();
  const nowIso = now.toISOString();
  const summary: RunSummary = { fetched: 0, parsed: 0, newDeals: 0, activeDeals: 0, guardTripped: false, errors: [] };

  const ctx = await buildIngestCtx(env, now);
  const { medians } = ctx;

  const relayed = await recentlyRelayed(env);
  for (const src of cronSources(env)) {
    if (relayed.has(src.slug)) continue; // (relay_only 가 아니어도) 최근 중계가 들어온 소스는 건너뜀
    if (await isPaused(env, src.slug)) continue;
    let posts: RawPost[];
    try {
      posts = await fetchSource(env, src);
      await recordSourceOk(env, src.slug, posts.length);
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push(`${src.slug}: ${msg}`);
      const r = await recordSourceFail(env, src.slug, msg);
      if (r.tripped) await notifyOps(env, `소스 일시 중지: ${src.name} (연속 실패 ${r.fails}회) — ${msg}`);
      continue;
    }
    summary.fetched += posts.length;
    const r = await ingestPosts(env, posts, ctx);
    summary.parsed += r.parsed; summary.newDeals += r.newDeals;
  }

  await finalizeRun(env, medians, now);

  summary.activeDeals = (await env.DB.prepare("SELECT COUNT(*) AS c FROM deals WHERE status IN ('live','ending')").first<{ c: number }>())?.c ?? 0;

  const guard = await checkActiveRatio(env, summary.activeDeals);
  summary.guardTripped = !guard.ok;
  if (!guard.ok) {
    await notifyOps(env, `수집 급감 가드 발동: 활성 딜 ${summary.activeDeals} / 직전 ${guard.previous} (${(guard.ratio * 100).toFixed(0)}%). 스냅샷 갱신 중단.`);
  }
  await env.DB.prepare(
    "INSERT INTO run_log (ran_at, active_deals, new_deals, fetched, parsed, guard_tripped, note) VALUES (?,?,?,?,?,?,?)",
  ).bind(nowIso, summary.activeDeals, summary.newDeals, summary.fetched, summary.parsed, guard.ok ? 0 : 1, summary.errors.join(" | ").slice(0, 1000) || null).run();

  return summary;
}

export interface IngestCtx {
  week: string; today: string; nowIso: string;
  rates: Awaited<ReturnType<typeof loadRates>>;
  medians: Record<string, { votes: number; comments: number }>;
  blocked: Set<string>;
}

/** 원본 글 목록 → 파싱 → 딜 upsert. Cron과 개발용 주입(/__dev/ingest)이 공유한다. */
export async function ingestPosts(env: Env, posts: RawPost[], ctx: IngestCtx): Promise<{ parsed: number; newDeals: number; queued: number; skipped: number; products: number }> {
  const out = { parsed: 0, newDeals: 0, queued: 0, skipped: 0, products: 0 };
  const closedDeals = new Set<string>(); // 이번 실행에서 글이 닫힌 일반 딜
  // 글마다 조회하지 않고 한 번에 묶어 읽는다(실행당 D1 쿼리 수를 줄이려고)
  const links = new Map<string, PostLink>();
  for (const s of linkLookupStatements(posts)) {
    for (const r of (await env.DB.prepare(s.sql).bind(...s.binds).all<PostLink & { source: string; post_id: string }>()).results) links.set(`${r.source}:${r.post_id}`, r);
  }
  for (const post of posts) {
    if (ctx.blocked.has(`${post.source}:${post.postId}`)) { out.skipped++; continue; }
    const link = links.get(`${post.source}:${post.postId}`) ?? null;
    const route = routePost(post, link ? (link.kind === "product" ? "product" : "gift") : null);
    switch (route.action) {
      case "gift":
        out.parsed++;
        if (await upsertDeal(env, post, route.parsed, ctx)) out.newDeals++;
        break;
      case "product":
        out.parsed++; out.products++;
        if (await upsertProductDeal(env, post, route.parsed, ctx)) out.newDeals++;
        break;
      case "touch":
        out.parsed++; out.products++;
        await touchProductPost(env, post, link!, ctx);
        break;
      case "close":
        if (!link!.closed) await env.DB.prepare("UPDATE deal_posts SET closed = 1 WHERE source = ? AND post_id = ?").bind(post.source, post.postId).run();
        closedDeals.add(link!.deal_id);
        out.skipped++;
        break;
      case "queue":
        await enqueueParse(env, post, route.reason);
        out.queued++;
        break;
      default:
        out.skipped++;
    }
  }
  await endFullyClosedDeals(env, [...closedDeals], ctx.nowIso);
  return out;
}

interface PostLink { deal_id: string; closed: number; votes: number; comments: number; last_seen: string; kind: string; status: string }

const LINK_LOOKUP_CHUNK = 40; // (source, post_id) 2개씩 바인드 → 문장당 80개 (D1 한도 100개)
/** 글 목록이 이미 어느 딜에 연결돼 있는지 묻는 조회문들. 40건씩 묶는다 */
export function linkLookupStatements(posts: Array<{ source: string; postId: string }>): Array<{ sql: string; binds: string[] }> {
  const out: Array<{ sql: string; binds: string[] }> = [];
  for (let i = 0; i < posts.length; i += LINK_LOOKUP_CHUNK) {
    const chunk = posts.slice(i, i + LINK_LOOKUP_CHUNK);
    out.push({
      sql: `SELECT p.source, p.post_id, p.deal_id, p.closed, p.votes, p.comments, p.last_seen, d.kind, d.status
            FROM deal_posts p JOIN deals d ON d.id = p.deal_id WHERE ${chunk.map(() => "(p.source = ? AND p.post_id = ?)").join(" OR ")}`,
      binds: chunk.flatMap((p) => [p.source, p.postId]),
    });
  }
  return out;
}

export async function buildIngestCtx(env: Env, now = new Date()): Promise<IngestCtx> {
  const blocked = new Set(
    (await env.DB.prepare("SELECT source || ':' || post_id AS k FROM blocklist").all<{ k: string }>()).results.map((r) => r.k),
  );
  return { week: isoWeekKST(now), today: dateKST(now), nowIso: now.toISOString(), rates: await loadRates(env), medians: await loadMedians(env), blocked };
}

/** 상태 전이·점수 재계산 (Cron 말미와 개발용 주입 후 공통) */
export async function finalizeRun(env: Env, medians: IngestCtx["medians"], now = new Date()): Promise<void> {
  await updateStatuses(env, now.toISOString());
  await refreshScores(env, medians, now);
}

async function loadMedians(env: Env): Promise<Record<string, { votes: number; comments: number }>> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = (await env.DB.prepare("SELECT source, votes, comments FROM deal_posts WHERE first_seen >= ?").bind(since).all<{ source: string; votes: number; comments: number }>()).results;
  const by: Record<string, { votes: number[]; comments: number[] }> = {};
  for (const r of rows) {
    (by[r.source] ??= { votes: [], comments: [] }).votes.push(r.votes);
    by[r.source].comments.push(r.comments);
  }
  const out: Record<string, { votes: number; comments: number }> = {};
  for (const [s, v] of Object.entries(by)) out[s] = { votes: Math.max(1, median(v.votes)), comments: Math.max(1, median(v.comments)) };
  return out;
}

async function enqueueParse(env: Env, post: RawPost, reason: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO parse_queue (source, post_id, post_url, title, reason) VALUES (?,?,?,?,?)",
  ).bind(post.source, post.postId, post.url, post.title, reason).run();
}

async function upsertDeal(
  env: Env, post: RawPost, p: ParsedDeal,
  ctx: IngestCtx,
): Promise<boolean> {
  const key = dedupeKey(p, ctx.week);
  const id = await dealId(key);
  const buyRate = rateForBrand(ctx.rates, p.brand);
  const rateGap = buyRate !== null && p.faceValue && p.salePrice ? +(buyRate - (p.salePrice / p.faceValue) * 100).toFixed(2) : null;
  const authorHash = post.url ? (await sha1(post.url)).slice(0, 12) : null;

  const existing = await env.DB.prepare("SELECT id FROM deals WHERE id = ?").bind(id).first<{ id: string }>();
  const isNew = !existing;

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO deals (id, dedupe_key, iso_week, brand, merchant, category, title, face_value, sale_price, discount_rate,
        card_issuers, card_benefit, limit_per_person, payment_note, buy_rate, rate_gap, rate_source, deal_url,
        status, first_seen, last_seen, parse_method, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'live',?,?, 'regex', ?)
      ON CONFLICT(id) DO UPDATE SET
        last_seen = excluded.last_seen, status = 'live', ended_at = NULL,
        sale_price = COALESCE(excluded.sale_price, deals.sale_price),
        discount_rate = COALESCE(excluded.discount_rate, deals.discount_rate),
        card_issuers = CASE WHEN excluded.card_issuers != '[]' THEN excluded.card_issuers ELSE deals.card_issuers END,
        card_benefit = COALESCE(excluded.card_benefit, deals.card_benefit),
        limit_per_person = COALESCE(excluded.limit_per_person, deals.limit_per_person),
        payment_note = COALESCE(excluded.payment_note, deals.payment_note),
        buy_rate = COALESCE(excluded.buy_rate, deals.buy_rate),
        rate_gap = COALESCE(excluded.rate_gap, deals.rate_gap),
        rate_source = COALESCE(excluded.rate_source, deals.rate_source),
        updated_at = excluded.updated_at
    `).bind(id, key, ctx.week, p.brand, p.merchant, p.category, post.title, p.faceValue, p.salePrice, p.discountRate,
      JSON.stringify(p.cardIssuers), p.cardBenefit, p.limitPerPerson, p.paymentNote, buyRate, rateGap,
      buyRate !== null ? env.RATES_SOURCE_NAME : null, post.url, ctx.nowIso, ctx.nowIso, ctx.nowIso),
    env.DB.prepare(`
      INSERT INTO deal_posts (deal_id, source, post_id, post_url, title, author_hash, posted_at, votes, comments, first_seen, last_seen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source, post_id) DO UPDATE SET
        votes = MAX(deal_posts.votes, excluded.votes), comments = MAX(deal_posts.comments, excluded.comments), last_seen = excluded.last_seen
    `).bind(id, post.source, post.postId, post.url, post.title, authorHash, post.postedAt ?? null, post.votes ?? 0, post.comments ?? 0, ctx.nowIso, ctx.nowIso),
    env.DB.prepare(`
      INSERT INTO deal_prices (deal_id, date, sale_price, buy_rate, votes, comments) VALUES (?,?,?,?,?,?)
      ON CONFLICT(deal_id, date) DO UPDATE SET
        sale_price = COALESCE(excluded.sale_price, deal_prices.sale_price), buy_rate = COALESCE(excluded.buy_rate, deal_prices.buy_rate),
        votes = MAX(deal_prices.votes, excluded.votes), comments = MAX(deal_prices.comments, excluded.comments)
    `).bind(id, ctx.today, p.salePrice, buyRate, post.votes ?? 0, post.comments ?? 0),
  ]);
  return isNew;
}

/**
 * 일반 딜 저장 (D-18, D-19). 같은 주차·같은 판매처·같은 가격의 진행 중 딜 가운데 제목이 비슷한 딜이 있으면 거기에 붙이고,
 * 없으면 새 딜을 만든다. 새 딜이면 true.
 */
async function upsertProductDeal(env: Env, post: RawPost, p: ParsedProduct, ctx: IngestCtx): Promise<boolean> {
  const mKey = merchantKey(p.merchant, p.merchantRaw);
  let id: string | null = null;
  // 판매처와 숫자 가격을 모두 아는 글만 유사도로 묶는다. 그 밖은 토큰이 완전히 같을 때(같은 키)만 묶인다.
  if (p.priceKind === "exact" && p.salePrice !== null && mKey !== "-") {
    const rows = (await env.DB.prepare(
      `SELECT id, merchant, merchant_raw, title_tokens FROM deals
       WHERE kind = 'product' AND iso_week = ? AND sale_price = ? AND status IN ('live','ending') AND ${p.merchant ? "merchant = ?" : "merchant IS NULL"}
       ORDER BY first_seen LIMIT 50`,
    ).bind(...(p.merchant ? [ctx.week, p.salePrice, p.merchant] : [ctx.week, p.salePrice])).all<{ id: string; merchant: string | null; merchant_raw: string | null; title_tokens: string | null }>()).results;
    id = pickGroup(p.tokens, rows.filter((r) => merchantKey(r.merchant, r.merchant_raw) === mKey).map((r) => ({ id: r.id, tokens: (r.title_tokens ?? "").split(" ").filter(Boolean) })));
  }
  const key = await productDedupeKey({ merchantKey: mKey, price: p.salePrice, tokens: p.tokens, unique: `${post.source}:${post.postId}` }, ctx.week);
  const grouped = id !== null;
  id ??= await dealId(key);
  const existing = grouped ? { id } : await env.DB.prepare("SELECT id FROM deals WHERE id = ?").bind(id).first<{ id: string }>();
  const authorHash = post.url ? (await sha1(post.url)).slice(0, 12) : null;

  const dealStmt = existing
    ? env.DB.prepare(`
        UPDATE deals SET last_seen = ?, status = 'live', ended_at = NULL, updated_at = ?,
          shipping = COALESCE(shipping, ?),
          card_issuers = CASE WHEN ? != '[]' THEN ? ELSE card_issuers END,
          card_benefit = COALESCE(?, card_benefit),
          limit_per_person = COALESCE(?, limit_per_person),
          payment_note = COALESCE(?, payment_note)
        WHERE id = ?
      `).bind(ctx.nowIso, ctx.nowIso, p.shipping, JSON.stringify(p.cardIssuers), JSON.stringify(p.cardIssuers), p.cardBenefit, p.limitPerPerson, p.paymentNote, id)
    : env.DB.prepare(`
        INSERT INTO deals (id, dedupe_key, iso_week, kind, brand, merchant, merchant_raw, category, title, product_name, title_tokens,
          sale_price, price_kind, price_text, shipping, discount_rate,
          card_issuers, card_benefit, limit_per_person, payment_note, deal_url,
          status, first_seen, last_seen, parse_method, updated_at)
        VALUES (?,?,?,'product','-',?,?,'product',?,?,?, ?,?,?,?,?, ?,?,?,?,?, 'live',?,?,'regex',?)
        ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, status = 'live', ended_at = NULL, updated_at = excluded.updated_at
      `).bind(id, key, ctx.week, p.merchant, p.merchantRaw, post.title, p.productName, p.tokens.join(" "),
        p.salePrice, p.priceKind, p.priceText, p.shipping, p.discountRate,
        JSON.stringify(p.cardIssuers), p.cardBenefit, p.limitPerPerson, p.paymentNote, post.url,
        ctx.nowIso, ctx.nowIso, ctx.nowIso);

  await env.DB.batch([
    dealStmt,
    env.DB.prepare(`
      INSERT INTO deal_posts (deal_id, source, post_id, post_url, title, author_hash, posted_at, votes, comments, first_seen, last_seen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source, post_id) DO UPDATE SET
        votes = MAX(deal_posts.votes, excluded.votes), comments = MAX(deal_posts.comments, excluded.comments), last_seen = excluded.last_seen
    `).bind(id, post.source, post.postId, post.url, post.title, authorHash, post.postedAt ?? null, post.votes ?? 0, post.comments ?? 0, ctx.nowIso, ctx.nowIso),
    env.DB.prepare(`
      INSERT INTO deal_prices (deal_id, date, sale_price, buy_rate, votes, comments) VALUES (?,?,?,NULL,?,?)
      ON CONFLICT(deal_id, date) DO UPDATE SET
        sale_price = COALESCE(excluded.sale_price, deal_prices.sale_price),
        votes = MAX(deal_prices.votes, excluded.votes), comments = MAX(deal_prices.comments, excluded.comments)
    `).bind(id, ctx.today, p.salePrice, post.votes ?? 0, post.comments ?? 0),
  ]);
  return !existing;
}

/**
 * 이미 일반 딜에 연결된 글을 다시 본 경우: 딜을 살려 두고 추천·댓글을 갱신한다. 닫혀 있던 글이면 닫힘을 푼다.
 * 쓰기를 줄이려고, 최근에 이미 기록했고 달라진 것이 없으면 아무것도 쓰지 않는다.
 */
async function touchProductPost(env: Env, post: RawPost, link: PostLink, ctx: IngestCtx): Promise<void> {
  const votes = Math.max(link.votes, post.votes ?? 0), comments = Math.max(link.comments, post.comments ?? 0);
  const ageMin = (new Date(ctx.nowIso).getTime() - new Date(link.last_seen).getTime()) / 60000;
  const changed = link.closed !== 0 || link.status !== "live" || votes !== link.votes || comments !== link.comments;
  if (!changed && ageMin < TOUCH_INTERVAL_MIN) return;
  await env.DB.batch([
    env.DB.prepare("UPDATE deal_posts SET votes = ?, comments = ?, last_seen = ?, closed = 0 WHERE source = ? AND post_id = ?").bind(votes, comments, ctx.nowIso, post.source, post.postId),
    env.DB.prepare("UPDATE deals SET last_seen = ?, status = 'live', ended_at = NULL, updated_at = ? WHERE id = ?").bind(ctx.nowIso, ctx.nowIso, link.deal_id),
    env.DB.prepare(`
      INSERT INTO deal_prices (deal_id, date, sale_price, buy_rate, votes, comments)
      SELECT id, ?, sale_price, NULL, ?, ? FROM deals WHERE id = ?
      ON CONFLICT(deal_id, date) DO UPDATE SET votes = MAX(deal_prices.votes, excluded.votes), comments = MAX(deal_prices.comments, excluded.comments)
    `).bind(ctx.today, votes, comments, link.deal_id),
  ]);
}

/** 연결된 글이 모두 닫힌 일반 딜을 종료로 바꾼다. 닫히지 않은 다른 커뮤니티 글이 있으면 딜은 남는다 */
async function endFullyClosedDeals(env: Env, dealIds: string[], nowIso: string): Promise<void> {
  for (let i = 0; i < dealIds.length; i += 50) {
    const ids = dealIds.slice(i, i + 50);
    await env.DB.prepare(
      `UPDATE deals SET status = 'ended', ended_at = ?, updated_at = ?
       WHERE kind = 'product' AND status IN ('live','ending') AND id IN (${ids.map(() => "?").join(",")})
         AND NOT EXISTS (SELECT 1 FROM deal_posts p WHERE p.deal_id = deals.id AND p.closed = 0)`,
    ).bind(nowIso, nowIso, ...ids).run();
  }
}

async function updateStatuses(env: Env, nowIso: string): Promise<void> {
  const before = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE deals SET status='ended', ended_at=?, updated_at=? WHERE kind = 'gift' AND status IN ('live','ending') AND last_seen < ?").bind(nowIso, nowIso, before(ENDED_AFTER_HOURS)),
    env.DB.prepare("UPDATE deals SET status='ending', updated_at=? WHERE kind = 'gift' AND status = 'live' AND last_seen < ?").bind(nowIso, before(ENDING_AFTER_HOURS)),
    env.DB.prepare("UPDATE deals SET status='ended', ended_at=?, updated_at=? WHERE kind = 'product' AND status IN ('live','ending') AND last_seen < ?").bind(nowIso, nowIso, before(PRODUCT_ENDED_AFTER_HOURS)),
    env.DB.prepare("UPDATE deals SET status='ending', updated_at=? WHERE kind = 'product' AND status = 'live' AND last_seen < ?").bind(nowIso, before(PRODUCT_ENDING_AFTER_HOURS)),
  ]);
}

/** 활성 딜 점수 재계산 (소스별 중앙값 정규화, D-10) */
async function refreshScores(env: Env, medians: Record<string, { votes: number; comments: number }>, now: Date): Promise<void> {
  const rows = (await env.DB.prepare(`
    SELECT d.id, d.discount_rate, d.first_seen, d.score, d.votes_total, d.comments_total,
      COALESCE(SUM(p.votes),0) AS votes, COALESCE(SUM(p.comments),0) AS comments,
      GROUP_CONCAT(DISTINCT p.source) AS sources
    FROM deals d LEFT JOIN deal_posts p ON p.deal_id = d.id
    WHERE d.status IN ('live','ending') GROUP BY d.id
  `).all<{ id: string; discount_rate: number | null; first_seen: string; score: number; votes_total: number; comments_total: number; votes: number; comments: number; sources: string | null }>()).results;
  if (rows.length === 0) return;
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const srcs = (r.sources ?? "").split(",").filter(Boolean);
    const mv = srcs.length ? Math.max(...srcs.map((s) => medians[s]?.votes ?? 1)) : 1;
    const mc = srcs.length ? Math.max(...srcs.map((s) => medians[s]?.comments ?? 1)) : 1;
    const hours = (now.getTime() - new Date(r.first_seen).getTime()) / 3600000;
    const score = computeScore({ votes: r.votes, comments: r.comments, medianVotes: mv, medianComments: mc, discountRate: r.discount_rate, hoursSinceFirstSeen: hours, sourceCount: srcs.length });
    // 일반 딜까지 1분마다 전부 다시 쓰면 쓰기가 크게 늘어, 눈에 띄게 달라진 행만 쓴다
    if (Math.abs(score - r.score) < SCORE_WRITE_DELTA && r.votes === r.votes_total && r.comments === r.comments_total) continue;
    stmts.push(env.DB.prepare("UPDATE deals SET score=?, votes_total=?, comments_total=? WHERE id=?").bind(score, r.votes, r.comments, r.id));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

const RELAY_FRESH_MIN = 10;

/** 최근 RELAY_FRESH_MIN 분 안에 중계가 들어온 소스 */
export async function recentlyRelayed(env: Env): Promise<Set<string>> {
  try {
    const since = new Date(Date.now() - RELAY_FRESH_MIN * 60_000).toISOString();
    const rows = (await env.DB.prepare("SELECT source FROM relay_state WHERE last_at >= ?").bind(since).all<{ source: string }>()).results;
    return new Set(rows.map((r) => r.source));
  } catch { return new Set(); } // 테이블이 아직 없으면 무시
}

/** 중계 수집 결과를 source_state·run_log에 반영 (상태 페이지·가드가 중계도 인식하도록) */
export async function recordRelayRun(env: Env, r: { counts: Record<string, number>; errors: Record<string, string>; parsed: number; newDeals: number; received: number; host?: string }): Promise<{ activeDeals: number }> {
  const now = new Date().toISOString();
  for (const slug of new Set([...Object.keys(r.counts), ...Object.keys(r.errors)])) {
    await env.DB.prepare("INSERT INTO relay_state (source, last_at, host) VALUES (?,?,?) ON CONFLICT(source) DO UPDATE SET last_at = excluded.last_at, host = excluded.host").bind(slug, now, r.host ?? null).run();
  }
  for (const [slug, n] of Object.entries(r.counts)) await recordSourceOk(env, slug, n);
  for (const [slug, msg] of Object.entries(r.errors)) await recordSourceFail(env, slug, `relay: ${msg}`);
  const activeDeals = (await env.DB.prepare("SELECT COUNT(*) AS c FROM deals WHERE status IN ('live','ending')").first<{ c: number }>())?.c ?? 0;
  await env.DB.prepare(
    "INSERT INTO run_log (ran_at, active_deals, new_deals, fetched, parsed, guard_tripped, note) VALUES (?,?,?,?,?,0,?)",
  ).bind(new Date().toISOString(), activeDeals, r.newDeals, r.received, r.parsed, `relay ${Object.keys(r.counts).join(",")}${Object.keys(r.errors).length ? " errors: " + Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(" | ").slice(0, 600) : ""}`).run();
  return { activeDeals };
}
