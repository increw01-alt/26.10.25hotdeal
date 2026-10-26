/**
 * 정적 사이트 빌드 (Phase 0 뼈대).
 *  - 데이터: Worker API /api/deals.json → 실패 시 종료(빈 사이트 배포 방지, D-03)
 *  - --sample 또는 ALLOW_EMPTY=1 : data/sample.deals.json 사용 (로컬 개발·초기 배포)
 *  - 산출물: dist/ (index.html, assets/, api 캐시 사본)
 * 사용: node scripts/build.mjs [--sample]
 */
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");
const useSample = process.argv.includes("--sample") || process.env.ALLOW_EMPTY === "1";

const site = JSON.parse(await readFile(path.join(root, "../shared/site.config.json"), "utf8"));
const brandsJson = JSON.parse(await readFile(path.join(root, "../shared/brands.json"), "utf8"));
const brandName = Object.fromEntries(brandsJson.brands.map((b) => [b.slug, b.name]));
const merchantName = Object.fromEntries(brandsJson.merchants.map((m) => [m.slug, m.name]));
const issuerName = Object.fromEntries(brandsJson.card_issuers.map((c) => [c.slug, c.name]));
const sourceName = Object.fromEntries(JSON.parse(await readFile(path.join(root, "../shared/sources.json"), "utf8")).sources.map((s) => [s.slug, s.name]));

// ---------- 데이터 ----------
async function loadDeals() {
  const apiBase = process.env.API_BASE || site.apiBase;
  if (!useSample && apiBase && !apiBase.includes("REPLACE_")) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${apiBase}/api/deals.json?limit=120`, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`API HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.deals)) throw new Error("API payload malformed");
      if (data.deals.length === 0 && process.env.ALLOW_EMPTY !== "1") throw new Error("API returned 0 deals; refusing to build an empty site (set ALLOW_EMPTY=1 to override)");
      return { data, mode: "api" };
    } catch (e) {
      console.error(`[build] API fetch failed: ${e.message}`);
      process.exit(2); // 빈 사이트 배포 방지
    } finally { clearTimeout(t); }
  }
  const data = JSON.parse(await readFile(path.join(root, "data/sample.deals.json"), "utf8"));
  console.warn("[build] using SAMPLE data (data/sample.deals.json)");
  return { data, mode: "sample" };
}

// ---------- 템플릿 ----------
const tplCache = new Map();
async function tpl(name) {
  if (!tplCache.has(name)) tplCache.set(name, await readFile(path.join(root, "templates", name.endsWith(".html") ? name : `${name}.html`), "utf8"));
  return tplCache.get(name);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function render(name, vars) {
  let html = await tpl(name);
  // 파셜 {{> name}}
  for (const m of [...html.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)]) html = html.replace(m[0], await render(`partials/${m[1]}`, vars));
  // 변수 {{key}} — 값이 raw:로 시작하면 이스케이프 없이 삽입
  return html.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined || v === null) return "";
    return typeof v === "string" && v.startsWith("raw:") ? v.slice(4) : esc(v);
  });
}
const raw = (s) => `raw:${s}`;

// ---------- 포맷 ----------
const krw = (n) => (n == null ? "—" : `${Number(n).toLocaleString("ko-KR")}원`);
const pct = (n) => (n == null ? "—" : `${Number(n).toFixed(n % 1 ? 1 : 0)}%`);
const kstLabel = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const statusMeta = { live: ["chip-live", "진행 중"], ending: ["chip-ending", "종료 임박"], ended: ["chip-ended", "종료"] };
const chip = (cls, text) => `<li class="${cls}">${esc(text)}</li>`;

async function dealCard(d) {
  const [chipClass, label] = statusMeta[d.status] ?? statusMeta.live;
  const issuers = (d.card_issuers ?? []).map((s) => issuerName[s] ?? s);
  const titleClean = d.title.replace(/^\s*[\[(][^\])]{1,20}[\])]\s*/, "");
  return render("partials/deal-card", {
    id: d.id, brand: d.brand, status: d.status,
    brandName: d.brand_name ?? brandName[d.brand] ?? d.brand,
    merchantName: merchantName[d.merchant] ?? (d.merchant ?? "판매처 미확인"),
    titleClean,
    statusChipClass: chipClass, statusLabel: label,
    salePriceLabel: krw(d.sale_price), faceValueLabel: krw(d.face_value), discountLabel: pct(d.discount_rate),
    cardChip: raw(issuers.length ? chip("chip-card", d.card_benefit ?? `${issuers.join("·")} 조건`) : ""),
    limitChip: raw(d.limit_per_person ? chip("chip bg-surface-muted text-ink-700", `한도 ${d.limit_per_person}`) : ""),
    paymentChip: raw(d.payment_note && !issuers.length ? chip("chip bg-surface-muted text-ink-700", d.payment_note) : ""),
    repeatChip: raw(d.repeat_weeks > 1 ? chip("chip bg-surface-muted text-ink-700", `${d.repeat_weeks}주째 반복`) : chip("chip bg-accent-400/20 text-accent-600", "이번 주 신규")),
    rateGapChip: raw(d.rate_gap != null ? chip("chip bg-surface-muted text-ink-700", `시세 대비 ${Number(d.rate_gap).toFixed(1)}%p 낮음`) : ""),
    affiliateChip: raw(site.affiliate.enabled && d.is_affiliate ? chip("chip-affiliate", site.affiliate.label) : ""),
    votes: d.votes_total ?? 0, comments: d.comments_total ?? 0,
    sourcesLabel: (d.sources ?? []).map((s) => sourceName[s] ?? s).join("·") || "커뮤니티",
  });
}

// ---------- 빌드 ----------
const { data, mode } = await loadDeals();
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "assets"), { recursive: true });
await mkdir(path.join(dist, "api"), { recursive: true });

const lastUpdated = data.last_updated ?? data.generated_at;
const staleNow = !lastUpdated || (Date.now() - new Date(lastUpdated).getTime()) / 36e5 > site.guards.staleHours;
const active = data.deals.filter((d) => d.status !== "ended");
const common = {
  siteName: site.siteName, siteUrl: site.siteUrl, tagline: site.tagline,
  operatorName: site.operator.name, operatorEmail: site.operator.email,
  year: new Date().getFullYear(),
  lastUpdated, lastUpdatedLabel: kstLabel(lastUpdated),
  staleBanner: raw((await render("partials/stale-banner", { lastUpdated, lastUpdatedLabel: kstLabel(lastUpdated) })).replace('<div role="status"', `<div role="status" data-stale-banner${staleNow ? "" : ' class="hidden"'}`).replace(/class="hidden"\s+class="/, 'class="hidden ')),
  affiliateTop: raw(site.affiliate.enabled ? await render("partials/affiliate-notice", { affiliateTopNotice: site.affiliate.topNotice }) : ""),
  affiliateFooter: raw(site.affiliate.enabled ? `<p>${esc(site.affiliate.footerNotice)}</p>` : ""),
};

const jsonld = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: site.siteName, url: site.siteUrl },
    { "@type": "WebSite", name: site.siteName, url: site.siteUrl, inLanguage: "ko" },
  ],
});

let html = await render("index", {
  ...common,
  title: `${site.siteName} | ${site.tagline}`,
  description: "뽐뿌·클리앙·루리웹·퀘이사존의 상품권 핫딜을 모아 카드 조건, 1인 한도, 할인율, 반복 주차까지 정리해 보여주는 상테크 정보 허브.",
  canonical: `${site.siteUrl}/`, robots: "index,follow", jsonld: raw(jsonld),
  week: data.week, activeCount: active.length,
  brandOptions: raw([...new Set(data.deals.map((d) => d.brand))].map((b) => `<option value="${esc(b)}">${esc(brandName[b] ?? b)}</option>`).join("")),
  dealCards: raw((await Promise.all([...data.deals].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map(dealCard))).join("\n")),
});
html = html.replace("<html lang=\"ko\">", `<html lang="ko" data-api-base="${esc(site.apiBase)}" data-stale-hours="${site.guards.staleHours}">`);
await writeFile(path.join(dist, "index.html"), html);

// 정적 자산
await cp(path.join(root, "src/js/site.js"), path.join(dist, "assets/site.js"));
await writeFile(path.join(dist, "assets/favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1d58f0"/><path d="M8 15h16v10H8z M6 10h20v5H6z M16 10v15" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>`);
// 외부 제공용 정적 사본 (API 장애 시에도 마지막 데이터 제공, D-04)
await writeFile(path.join(dist, "api/deals.json"), JSON.stringify(data));
await writeFile(path.join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${site.siteUrl}/sitemap.xml\n`);
await writeFile(path.join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${site.siteUrl}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);
await writeFile(path.join(dist, "_headers"), `/api/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
console.log(`[build] done mode=${mode} deals=${data.deals.length} active=${active.length} stale=${staleNow} → ${path.relative(root, dist)}/`);
