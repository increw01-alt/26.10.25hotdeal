import type { Env, ParsedDeal, RawPost } from "./types";
import { enabledSources } from "./config";
import { fetchSource } from "./fetchers";
import { parseTitle, looksLikeGiftDeal } from "./parse";
import { dedupeKey, dealId, isoWeekKST, dateKST, sha1 } from "./dedupe";
import { computeScore, median } from "./score";
import { checkActiveRatio, isPaused, recordSourceFail, recordSourceOk } from "./guards";
import { notifyOps } from "./notify";
import { loadRates, rateForBrand } from "./rates";

const ENDED_AFTER_HOURS = 48;   // 48시간 동안 어느 소스에서도 안 보이면 종료
const ENDING_AFTER_HOURS = 24;  // 24시간 넘게 안 보이면 종료 임박

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
  for (const src of enabledSources(env)) {
    if (relayed.has(src.slug)) continue; // 중계 수집기가 담당 중
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

  summary.activeDeals = (await env.DB.prepare("SELECT COUNT(*) AS c FROM deals WHERE status != 'ended'").first<{ c: number }>())?.c ?? 0;

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
export async function ingestPosts(env: Env, posts: RawPost[], ctx: IngestCtx): Promise<{ parsed: number; newDeals: number; queued: number; skipped: number }> {
  const out = { parsed: 0, newDeals: 0, queued: 0, skipped: 0 };
  for (const post of posts) {
    if (ctx.blocked.has(`${post.source}:${post.postId}`)) { out.skipped++; continue; }
    if (!looksLikeGiftDeal(post.title)) { out.skipped++; continue; }
    const parsed = parseTitle(post);
    if (!parsed) { out.skipped++; continue; }
    if (parsed.confidence < 0.5) {
      await enqueueParse(env, post, `low confidence ${parsed.confidence}`);
      out.queued++;
      continue;
    }
    out.parsed++;
    if (await upsertDeal(env, post, parsed, ctx)) out.newDeals++;
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

async function updateStatuses(env: Env, nowIso: string): Promise<void> {
  const endedBefore = new Date(Date.now() - ENDED_AFTER_HOURS * 3600000).toISOString();
  const endingBefore = new Date(Date.now() - ENDING_AFTER_HOURS * 3600000).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE deals SET status='ended', ended_at=?, updated_at=? WHERE status != 'ended' AND last_seen < ?").bind(nowIso, nowIso, endedBefore),
    env.DB.prepare("UPDATE deals SET status='ending', updated_at=? WHERE status = 'live' AND last_seen < ?").bind(nowIso, endingBefore),
  ]);
}

/** 활성 딜 점수 재계산 (소스별 중앙값 정규화, D-10) */
async function refreshScores(env: Env, medians: Record<string, { votes: number; comments: number }>, now: Date): Promise<void> {
  const rows = (await env.DB.prepare(`
    SELECT d.id, d.discount_rate, d.first_seen,
      COALESCE(SUM(p.votes),0) AS votes, COALESCE(SUM(p.comments),0) AS comments,
      GROUP_CONCAT(DISTINCT p.source) AS sources
    FROM deals d LEFT JOIN deal_posts p ON p.deal_id = d.id
    WHERE d.status != 'ended' GROUP BY d.id
  `).all<{ id: string; discount_rate: number | null; first_seen: string; votes: number; comments: number; sources: string | null }>()).results;
  if (rows.length === 0) return;
  const stmts = rows.map((r) => {
    const srcs = (r.sources ?? "").split(",").filter(Boolean);
    const mv = srcs.length ? Math.max(...srcs.map((s) => medians[s]?.votes ?? 1)) : 1;
    const mc = srcs.length ? Math.max(...srcs.map((s) => medians[s]?.comments ?? 1)) : 1;
    const hours = (now.getTime() - new Date(r.first_seen).getTime()) / 3600000;
    const score = computeScore({ votes: r.votes, comments: r.comments, medianVotes: mv, medianComments: mc, discountRate: r.discount_rate, hoursSinceFirstSeen: hours });
    return env.DB.prepare("UPDATE deals SET score=?, votes_total=?, comments_total=? WHERE id=?").bind(score, r.votes, r.comments, r.id);
  });
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
  const activeDeals = (await env.DB.prepare("SELECT COUNT(*) AS c FROM deals WHERE status != 'ended'").first<{ c: number }>())?.c ?? 0;
  await env.DB.prepare(
    "INSERT INTO run_log (ran_at, active_deals, new_deals, fetched, parsed, guard_tripped, note) VALUES (?,?,?,?,?,0,?)",
  ).bind(new Date().toISOString(), activeDeals, r.newDeals, r.received, r.parsed, `relay ${Object.keys(r.counts).join(",")}${Object.keys(r.errors).length ? " errors: " + Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(" | ").slice(0, 600) : ""}`).run();
  return { activeDeals };
}
