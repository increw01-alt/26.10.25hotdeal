/**
 * 정적 사이트 빌드 (Phase 2).
 *  페이지: 홈, /brands/, /brands/{slug}/, /deal/{id}/, /weekly/, /weekly/{YYYY-Www}/, /about/, /open-data/,
 *          /embed/, /embed/{slug}/, 404.html, embed.js, sitemap.xml, robots.txt, _headers, /api/deals.json(정적 사본)
 *  데이터: Worker API → 실패 또는 0건이면 종료(빈 사이트 배포 방지, D-03)
 *          --sample 또는 ALLOW_EMPTY=1 : data/sample.*.json 사용
 *  정책:   종료 30일 지난 딜은 상세 페이지 미생성(D-07, Pages는 _redirects로 410을 지원하지 않아 404.html로 안내)
 *          종료 딜 상세는 noindex, 구매 버튼 비활성화 + 브랜드 허브 링크(D-11)
 * 사용:    node scripts/build.mjs [--sample]
 */
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");
const useSample = process.argv.includes("--sample") || process.env.ALLOW_EMPTY === "1";
const NOW = new Date();

// ---------- 공용 설정 ----------
const site = JSON.parse(await readFile(path.join(root, "../shared/site.config.json"), "utf8"));
const apiBase = process.env.API_BASE || site.apiBase;
const brandsJson = JSON.parse(await readFile(path.join(root, "../shared/brands.json"), "utf8"));
const sourcesJson = JSON.parse(await readFile(path.join(root, "../shared/sources.json"), "utf8"));
const BRANDS = brandsJson.brands;
const brandName = Object.fromEntries(BRANDS.map((b) => [b.slug, b.name]));
const merchantName = Object.fromEntries(brandsJson.merchants.map((m) => [m.slug, m.name]));
const issuerName = Object.fromEntries(brandsJson.card_issuers.map((c) => [c.slug, c.name]));
const sourceName = Object.fromEntries(sourcesJson.sources.map((s) => [s.slug, s.name]));
const CATEGORY_LABEL = { gift: "문화·도서 상품권", dept: "백화점 상품권", mart: "마트 상품권", pay: "간편결제 포인트", digital: "디지털 콘텐츠", cafe: "카페·외식", ticket: "영화·공연" };

// ---------- 날짜·주차 ----------
const KST = 9 * 3600000;
function isoWeekKST(date = NOW) {
  const kst = new Date(date.getTime() + KST);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - ys) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}
/** ISO 주차 → [월요일, 일요일] (KST 날짜 문자열) */
function weekRange(week) {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4)); const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4); monday.setUTCDate(jan4.getUTCDate() - day + 1 + (w - 1) * 7);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const f = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return { monday, sunday, label: `${f(monday)} ~ ${f(sunday)}` };
}
function prevWeek(week, n = 1) {
  const { monday } = weekRange(week);
  return isoWeekKST(new Date(monday.getTime() - n * 7 * 86400000 - KST + 12 * 3600000));
}
const recentWeeks = (n = 8) => Array.from({ length: n }, (_, i) => prevWeek(isoWeekKST(), i)).reverse(); // 오래된 → 최신

// ---------- 데이터 ----------
async function fetchJson(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
async function loadData() {
  if (!useSample && apiBase && !apiBase.includes("REPLACE_")) {
    try {
      const [active, ended] = await Promise.all([
        fetchJson(`${apiBase}/api/deals.json?limit=200&status=active`),
        fetchJson(`${apiBase}/api/deals.json?limit=200&status=ended&sort=recent`),
      ]);
      if (!Array.isArray(active.deals)) throw new Error("API payload malformed");
      if (active.deals.length === 0 && process.env.ALLOW_EMPTY !== "1") throw new Error("API returned 0 active deals; refusing to build an empty site (ALLOW_EMPTY=1 to override)");
      const weekly = {};
      for (const w of recentWeeks()) { try { weekly[w] = await fetchJson(`${apiBase}/api/weekly/${w}.json`); } catch { weekly[w] = null; } }
      const detailCache = new Map();
      return {
        mode: "api", meta: active,
        deals: [...active.deals, ...ended.deals],
        weekly,
        detail: async (id) => { if (!detailCache.has(id)) detailCache.set(id, await fetchJson(`${apiBase}/api/deals/${id}.json`).catch(() => null)); return detailCache.get(id); },
      };
    } catch (e) {
      console.error(`[build] API fetch failed: ${e.message}`);
      process.exit(2);
    }
  }
  const sample = JSON.parse(await readFile(path.join(root, "data/sample.deals.json"), "utf8"));
  const details = JSON.parse(await readFile(path.join(root, "data/sample.details.json"), "utf8"));
  console.warn("[build] using SAMPLE data");
  const weekly = {};
  for (const w of recentWeeks()) {
    const ds = sample.deals.filter((d) => d.iso_week === w);
    weekly[w] = ds.length ? { week: w, count: ds.length, brands: Object.groupBy(ds, (d) => d.brand) } : null;
  }
  return {
    mode: "sample", meta: sample, deals: sample.deals, weekly,
    detail: async (id) => { const d = sample.deals.find((x) => x.id === id); const x = details[id] ?? { posts: [], prices: [], history: [] }; return d ? { deal: d, ...x, repeat_weeks: (x.history?.length ?? 0) + 1 } : null; },
  };
}

// ---------- 템플릿 엔진 ----------
const tplCache = new Map();
async function tpl(name) {
  if (!tplCache.has(name)) tplCache.set(name, await readFile(path.join(root, "templates", `${name}.html`), "utf8"));
  return tplCache.get(name);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const raw = (s) => `raw:${s}`;
async function render(name, vars) {
  let html = await tpl(name);
  for (const m of [...html.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)]) html = html.replace(m[0], await render(`partials/${m[1]}`, vars));
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined || v === null) return "";
    return typeof v === "string" && v.startsWith("raw:") ? v.slice(4) : esc(v);
  });
}

// ---------- 포맷 ----------
const faceLabel = (v) => (v >= 10000 ? `${v / 10000}만원` : `${v / 1000}천원`);
const krw = (n) => (n == null ? "—" : `${Number(n).toLocaleString("ko-KR")}원`);
const pct = (n) => (n == null ? "—" : `${Number(n) % 1 ? Number(n).toFixed(1) : Number(n)}%`);
const kstLabel = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const kstDate = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" }) : "—");
const statusMeta = { live: ["chip-live", "진행 중"], ending: ["chip-ending", "종료 임박"], ended: ["chip-ended", "종료"] };
const chip = (cls, text) => `<li class="${cls}">${esc(text)}</li>`;
const titleClean = (t) => String(t ?? "").replace(/^\s*[\[(][^\])]{1,20}[\])]\s*/, "");
const issuers = (d) => (d.card_issuers ?? []).map((s) => issuerName[s] ?? s);
const link = (href, text, cls = "text-brand-700 hover:underline") => `<a href="${esc(href)}" class="${cls}">${esc(text)}</a>`;
const crumbs = (items) => raw(items.map((c, i) => `<li class="flex items-center gap-1.5">${i ? '<span aria-hidden="true">/</span>' : ""}${c.href ? link(c.href, c.name, "hover:text-brand-700") : `<span aria-current="page" class="text-ink-700">${esc(c.name)}</span>`}</li>`).join(""));
const breadcrumbLd = (items) => ({ "@type": "BreadcrumbList", itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${site.siteUrl}${c.href ?? ""}` })) });
const ld = (graph) => raw(JSON.stringify({ "@context": "https://schema.org", "@graph": graph }));

// ---------- 빌드 시작 ----------
const data = await loadData();
await rm(dist, { recursive: true, force: true });
for (const p of ["assets", "api", "brands", "deal", "weekly", "about", "open-data", "embed"]) await mkdir(path.join(dist, p), { recursive: true });

const lastUpdated = data.meta.last_updated ?? data.meta.generated_at;
const staleNow = !lastUpdated || (NOW - new Date(lastUpdated)) / 36e5 > site.guards.staleHours;
const activeDeals = data.deals.filter((d) => d.status !== "ended");
const endedDeals = data.deals.filter((d) => d.status === "ended");
const dealById = new Map(data.deals.map((d) => [d.id, d]));
const dealEligible = (d) => d.status !== "ended" || !d.ended_at || (NOW - new Date(d.ended_at)) / 86400000 <= site.archive.dealPageDaysAfterEnd;
const dealHref = (d) => (dealById.has(d.id) && dealEligible(dealById.get(d.id)) ? `/deal/${d.id}/` : `/weekly/${d.iso_week}/`);

const staleBannerHtml = (await render("partials/stale-banner", { lastUpdated, lastUpdatedLabel: kstLabel(lastUpdated) }))
  .replace('<div role="status" class="', `<div role="status" data-stale-banner class="${staleNow ? "" : "hidden "}`);
const common = {
  siteName: site.siteName, siteUrl: site.siteUrl, apiBase, tagline: site.tagline,
  operatorName: site.operator.name, operatorEmail: site.operator.email, year: NOW.getFullYear(),
  lastUpdated, lastUpdatedLabel: kstLabel(lastUpdated),
  staleBanner: raw(staleBannerHtml),
  affiliateTop: raw(site.affiliate.enabled ? await render("partials/affiliate-notice", { affiliateTopNotice: site.affiliate.topNotice }) : ""),
  affiliateFooter: raw(site.affiliate.enabled ? `<p>${esc(site.affiliate.footerNotice)}</p>` : ""),
  robots: "index,follow",
};
const orgLd = [{ "@type": "Organization", name: site.siteName, url: site.siteUrl }, { "@type": "WebSite", name: site.siteName, url: site.siteUrl, inLanguage: "ko" }];
const urls = [];
async function emit(relPath, html, { indexable = true, lastmod } = {}) {
  const file = relPath.endsWith("/") ? `${relPath}index.html` : relPath;
  await mkdir(path.join(dist, path.dirname(file)), { recursive: true });
  await writeFile(path.join(dist, file), html.replace('<html lang="ko">', `<html lang="ko" data-api-base="${esc(apiBase)}" data-stale-hours="${site.guards.staleHours}">`));
  if (indexable && relPath.endsWith("/")) urls.push({ loc: `${site.siteUrl}${relPath}`, lastmod: (lastmod ?? NOW.toISOString()).slice(0, 10) });
}

// ---------- 딜 카드 ----------
async function dealCard(d) {
  const [chipClass, label] = statusMeta[d.status] ?? statusMeta.live;
  const iss = issuers(d);
  return (await render("partials/deal-card", {
    id: d.id, brand: d.brand, status: d.status,
    brandName: d.brand_name ?? brandName[d.brand] ?? d.brand,
    merchantName: merchantName[d.merchant] ?? (d.merchant ?? "판매처 미확인"),
    titleClean: titleClean(d.title), statusChipClass: chipClass, statusLabel: label,
    salePriceLabel: krw(d.sale_price), faceValueLabel: krw(d.face_value), discountLabel: pct(d.discount_rate),
    cardChip: raw(iss.length ? chip("chip-card", d.card_benefit ?? `${iss.join("·")} 조건`) : ""),
    limitChip: raw(d.limit_per_person ? chip("chip bg-surface-muted text-ink-700", `한도 ${d.limit_per_person}`) : ""),
    paymentChip: raw(d.payment_note && !iss.length ? chip("chip bg-surface-muted text-ink-700", d.payment_note) : ""),
    repeatChip: raw((d.repeat_weeks ?? 1) > 1 ? chip("chip bg-surface-muted text-ink-700", `${d.repeat_weeks}주째 반복`) : chip("chip bg-accent-400/20 text-accent-600", "이번 주 신규")),
    rateGapChip: raw(d.rate_gap != null ? chip("chip bg-surface-muted text-ink-700", `시세 대비 ${Number(d.rate_gap).toFixed(1)}%p 낮음`) : ""),
    affiliateChip: raw(site.affiliate.enabled && d.is_affiliate ? chip("chip-affiliate", site.affiliate.label) : ""),
    votes: d.votes_total ?? 0, comments: d.comments_total ?? 0,
    sourcesLabel: (d.sources ?? []).map((s) => sourceName[s] ?? s).join("·") || "커뮤니티",
  })).replaceAll(`href="/deal/${d.id}/"`, `href="${dealHref(d)}"`);
}
const cards = async (list) => (await Promise.all(list.map(dealCard))).join("\n");
const byScore = (a, b) => (b.score ?? 0) - (a.score ?? 0);

// ---------- 1. 홈 ----------
await emit("/", await render("index", {
  ...common,
  title: `${site.siteName} | ${site.tagline}`,
  description: "뽐뿌·클리앙·루리웹·퀘이사존의 상품권 핫딜을 모아 카드 조건, 1인 한도, 할인율, 반복 주차까지 정리해 보여주는 상테크 정보 허브.",
  canonical: `${site.siteUrl}/`, jsonld: ld(orgLd),
  week: data.meta.week ?? isoWeekKST(), activeCount: activeDeals.length,
  brandOptions: raw([...new Set(data.deals.map((d) => d.brand))].map((b) => `<option value="${esc(b)}">${esc(brandName[b] ?? b)}</option>`).join("")),
  dealCards: raw(await cards([...data.deals].sort(byScore))),
}));

// ---------- 2. 브랜드 ----------
const weeklyDeals = Object.values(data.weekly).filter(Boolean).flatMap((w) => Object.values(w.brands ?? {}).flat());
const weeklyByBrand = Object.groupBy(weeklyDeals, (d) => d.brand);
const faqFor = (b) => {
  const cat = CATEGORY_LABEL[b.category] ?? "상품권";
  return [
    [`${b.name} 할인은 어디서 자주 나오나요?`, `최근 8주 수집 기준으로 위 "자주 보이는 조건"의 판매처 순입니다. 오픈마켓(지마켓·옥션·11번가) 카드사 제휴 행사와 카드사몰 특가가 대부분을 차지하며, 판매처별로 1인 구매 한도가 다릅니다.`],
    [`즉시할인과 청구할인은 무엇이 다른가요?`, `즉시할인은 결제 시점에 할인된 금액이 승인되고, 청구할인은 결제는 정가로 되고 다음 달 카드 청구서에서 차감됩니다. 청구할인은 카드 실적 산정과 한도 소진 방식이 카드사마다 달라 공지를 확인해야 합니다.`],
    [`"N주째 반복" 표시는 무슨 뜻인가요?`, `같은 브랜드·판매처·액면가·판매가 조합이 ISO 주차 기준으로 연속 또는 반복해서 등장한 횟수입니다. 반복 주차가 길수록 상시 특가에 가깝고, "이번 주 신규"는 이번 주 처음 보인 조건입니다.`],
    [`시세 대비 할인 폭은 무엇인가요?`, `현재 ${cat} 매입 시세(%)와 이 딜의 판매가 비율(%)의 차이입니다. 예를 들어 시세가 액면가의 95%이고 딜이 92%면 3%p 낮은 가격입니다. 참고 지표일 뿐 매도를 권유하는 수치가 아닙니다.`],
    [`정보가 틀리면 어떻게 하나요?`, `가격과 조건은 커뮤니티 글 제목에서 자동 추출하므로 오차가 있을 수 있습니다. 구매 전 판매처 상품 페이지와 카드사 공지를 확인해 주세요. 오류 제보는 하단 문의 메일로 보내주시면 반영합니다.`],
  ];
};
const brandCardsHtml = [];
for (const b of BRANDS) {
  const act = activeDeals.filter((d) => d.brand === b.slug).sort(byScore);
  const past = endedDeals.filter((d) => d.brand === b.slug).sort((x, y) => new Date(y.ended_at ?? y.last_seen) - new Date(x.ended_at ?? x.last_seen)).slice(0, 6);
  const recent = weeklyByBrand[b.slug] ?? [];
  const count = (arr, key, nameMap) => Object.entries(Object.groupBy(arr.filter((d) => d[key]), (d) => d[key])).sort((x, y) => y[1].length - x[1].length).slice(0, 5)
    .map(([k, v]) => `<li class="flex justify-between gap-3"><span>${esc(nameMap[k] ?? k)}</span><span class="tabular-nums text-ink-500">${v.length}건</span></li>`).join("") || '<li class="text-ink-500">수집된 데이터가 아직 없습니다.</li>';
  const cardStats = Object.entries(Object.groupBy(recent.flatMap((d) => d.card_issuers ?? []), (s) => s)).sort((x, y) => y[1].length - x[1].length).slice(0, 5)
    .map(([k, v]) => `<li class="flex justify-between gap-3"><span>${esc(issuerName[k] ?? k)}</span><span class="tabular-nums text-ink-500">${v.length}건</span></li>`).join("") || '<li class="text-ink-500">카드 조건이 붙은 딜이 아직 없습니다.</li>';
  const weekRows = recentWeeks().map((w) => {
    const ds = recent.filter((d) => d.iso_week === w);
    const minSale = ds.filter((d) => d.sale_price).sort((x, y) => x.sale_price - y.sale_price)[0];
    const maxDisc = ds.filter((d) => d.discount_rate != null).sort((x, y) => y.discount_rate - x.discount_rate)[0];
    return `<tr><td class="py-2 pr-3">${ds.length ? link(`/weekly/${w}/`, w) : esc(w)}</td><td class="py-2 pr-3 tabular-nums">${ds.length}</td><td class="py-2 pr-3 tabular-nums">${minSale ? `${krw(minSale.sale_price)} <span class="text-ink-500">/ ${krw(minSale.face_value)}</span>` : "—"}</td><td class="py-2 tabular-nums">${maxDisc ? pct(maxDisc.discount_rate) : "—"}</td></tr>`;
  }).join("");
  const best = act.filter((d) => d.discount_rate != null).sort((x, y) => y.discount_rate - x.discount_rate)[0];
  const weeksSeen = new Set(recent.map((d) => d.iso_week)).size;
  const faq = faqFor(b);
  const crumbItems = [{ name: "홈", href: "/" }, { name: "브랜드별", href: "/brands/" }, { name: b.name }];
  const intro = `${b.name} ${CATEGORY_LABEL[b.category] ?? "상품권"} 핫딜을 뽐뿌·클리앙·루리웹·퀘이사존에서 모아 판매처, 카드 할인 조건, 1인 한도, 반복 주차순으로 정리했습니다. 권종은 ${b.face_values.length ? b.face_values.map(faceLabel).join("·") : "판매처별 상이"}이며, 가격과 조건은 구매 전 판매처에서 다시 확인해 주세요.`;
  await emit(`/brands/${b.slug}/`, await render("brand", {
    ...common,
    title: `${b.name} 핫딜 · 카드 할인 모음 | ${site.siteName}`,
    description: `${b.name} 상품권 핫딜 ${act.length}건 진행 중. 판매처별 가격, 카드사 즉시·청구할인, 1인 한도, 최근 8주 흐름을 한 페이지에서 비교합니다.`,
    canonical: `${site.siteUrl}/brands/${b.slug}/`,
    jsonld: ld([...orgLd, breadcrumbLd(crumbItems), { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }]),
    crumbs: crumbs(crumbItems),
    brandName: b.name, categoryLabel: CATEGORY_LABEL[b.category] ?? "상품권", intro,
    activeCount: act.length, bestDiscount: best ? pct(best.discount_rate) : "—", weeksSeen,
    rateBox: raw(site.rates.enabled && b.rates_key && act.some((d) => d.buy_rate != null) ? `<p class="mt-4 text-sm text-ink-700">현재 매입 시세 ${pct(act.find((d) => d.buy_rate != null).buy_rate)} <span class="text-ink-500">(${esc(site.rates.attribution)})</span></p>` : ""),
    activeCards: raw(await cards(act)),
    activeEmpty: raw(act.length ? "" : `<p class="mt-4 rounded-md bg-surface-muted p-6 text-center text-sm text-ink-500">지금 진행 중인 ${esc(b.name)} 딜이 없습니다. 새 딜이 올라오면 1분 안에 반영됩니다.</p>`),
    merchantStats: raw(count(recent, "merchant", merchantName)), cardStats: raw(cardStats), weekRows: raw(weekRows),
    pastCards: raw(await cards(past)),
    pastEmpty: raw(past.length ? "" : '<p class="mt-4 rounded-md bg-surface-muted p-6 text-center text-sm text-ink-500">최근 종료된 딜 기록이 없습니다.</p>'),
    faqItems: raw(faq.map(([q, a]) => `<details class="group py-4"><summary class="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold"><span>${esc(q)}</span><span class="text-ink-300 transition group-open:rotate-45" aria-hidden="true">+</span></summary><p class="mt-2 text-sm leading-relaxed text-ink-700">${esc(a)}</p></details>`).join("")),
  }));
  brandCardsHtml.push(`<a href="/brands/${b.slug}/" class="card flex items-center justify-between gap-4 p-5 hover:ring-brand-300 transition"><div><p class="text-xs font-medium text-ink-500">${esc(CATEGORY_LABEL[b.category] ?? "상품권")}</p><h2 class="mt-0.5 text-lg font-bold">${esc(b.name)}</h2><p class="mt-1 text-sm text-ink-500">진행 중 ${act.length}건${best ? ` · 최대 ${pct(best.discount_rate)}` : ""}</p></div><span class="text-brand-700" aria-hidden="true">→</span></a>`);
}
{
  const crumbItems = [{ name: "홈", href: "/" }, { name: "브랜드별" }];
  await emit("/brands/", await render("brands-index", {
    ...common, title: `브랜드별 상품권 핫딜 | ${site.siteName}`,
    description: "컬쳐랜드, 해피머니, 북앤라이프, 신세계·롯데·현대백화점 상품권 등 브랜드별 핫딜과 카드 할인 조건을 모아 봅니다.",
    canonical: `${site.siteUrl}/brands/`, jsonld: ld([...orgLd, breadcrumbLd(crumbItems)]), crumbs: crumbs(crumbItems),
    brandCards: raw(brandCardsHtml.join("\n")),
  }));
}

// ---------- 3. 딜 상세 ----------
let dealPages = 0;
for (const d of data.deals.filter(dealEligible)) {
  const det = await data.detail(d.id);
  if (!det) continue;
  const deal = { ...d, ...det.deal };
  const [chipClass, label] = statusMeta[deal.status] ?? statusMeta.live;
  const ended = deal.status === "ended";
  const iss = issuers(deal);
  const cond = [
    ["카드 조건", deal.card_benefit ?? (iss.length ? `${iss.join("·")} 조건` : "카드 조건 없음")],
    ["1인 한도", deal.limit_per_person ?? "제목에 표기 없음"],
    ["결제 조건", deal.payment_note ?? "—"],
    ["유효기간/종료", deal.valid_until ?? (ended ? `종료 ${kstDate(deal.ended_at)}` : "미표기")],
    ["판매처", merchantName[deal.merchant] ?? deal.merchant ?? "미확인"],
    ["수집 주차", deal.iso_week],
  ].map(([k, v]) => `<div class="stat"><dt>${esc(k)}</dt><dd class="text-sm font-semibold">${esc(v)}</dd></div>`).join("");
  const priceRows = (det.prices ?? []).map((p) => `<tr><td class="py-2 pr-3">${esc(p.date)}</td><td class="py-2 pr-3 tabular-nums">${krw(p.sale_price)}</td><td class="py-2 pr-3 tabular-nums">${p.buy_rate != null ? pct(p.buy_rate) : "—"}</td><td class="py-2 pr-3 tabular-nums">${p.votes ?? 0}</td><td class="py-2 tabular-nums">${p.comments ?? 0}</td></tr>`).join("") || '<tr><td colspan="5" class="py-3 text-ink-500">아직 하루치 기록만 있습니다.</td></tr>';
  const weekHasPage = (w) => !!data.weekly[w] || w === isoWeekKST();
  const historyRows = (det.history ?? []).map((h) => `<li class="flex items-center justify-between gap-3 py-2"><span>${weekHasPage(h.iso_week) ? link(`/weekly/${h.iso_week}/`, h.iso_week) : esc(h.iso_week)} <span class="text-ink-500">· ${esc(statusMeta[h.status]?.[1] ?? h.status)}</span></span><span class="tabular-nums">${krw(h.sale_price)}</span></li>`).join("") || '<li class="py-2 text-ink-500">이번 주 처음 등장한 조건입니다.</li>';
  const sourceRows = (det.posts ?? []).map((p) => `<li class="card p-3"><a href="${esc(p.post_url)}" rel="nofollow noopener ugc" target="_blank" class="font-medium hover:underline">${esc(p.title)}</a><p class="mt-1 text-xs text-ink-500">${esc(sourceName[p.source] ?? p.source)} · ${kstLabel(p.posted_at)} · 추천 ${p.votes ?? 0} · 댓글 ${p.comments ?? 0}</p></li>`).join("") || '<li class="text-ink-500">출처 정보를 불러오지 못했습니다.</li>';
  const related = activeDeals.filter((x) => x.brand === deal.brand && x.id !== deal.id).sort(byScore).slice(0, 4);
  const relatedRows = related.map((x) => `<li><a href="${dealHref(x)}" class="flex justify-between gap-2 hover:underline"><span class="truncate">${esc(merchantName[x.merchant] ?? x.merchant ?? "판매처")} · ${krw(x.sale_price)}</span><span class="shrink-0 font-semibold text-brand-700">${pct(x.discount_rate)}</span></a></li>`).join("") || '<li class="text-ink-500">다른 진행 중 딜이 없습니다.</li>';
  const buyUrl = site.affiliate.enabled && deal.is_affiliate && deal.affiliate_url ? deal.affiliate_url : deal.deal_url;
  const ctaButton = ended
    ? `<a href="/brands/${esc(deal.brand)}/" class="btn-primary mt-4 w-full">같은 브랜드 진행 중 딜 보기</a><button type="button" class="btn mt-2 w-full" aria-disabled="true" disabled>종료된 딜입니다</button>`
    : `<a href="${esc(buyUrl)}" rel="nofollow noopener${site.affiliate.enabled && deal.is_affiliate ? " sponsored" : ""}" target="_blank" class="btn-primary mt-4 w-full">원문 글에서 구매처 확인</a>`;
  const crumbItems = [{ name: "홈", href: "/" }, { name: brandName[deal.brand] ?? deal.brand, href: `/brands/${deal.brand}/` }, { name: titleClean(deal.title).slice(0, 40) }];
  const h1 = `${brandName[deal.brand] ?? deal.brand} ${deal.face_value ? `${faceLabel(deal.face_value)}권 ` : ""}${krw(deal.sale_price)}${deal.discount_rate != null ? ` (${pct(deal.discount_rate)} 할인)` : ""} · ${merchantName[deal.merchant] ?? deal.merchant ?? "커뮤니티 핫딜"}`;
  await emit(`/deal/${deal.id}/`, await render("deal", {
    ...common,
    robots: ended ? "noindex,follow" : "index,follow",
    title: `${h1} | ${site.siteName}`,
    description: `${titleClean(deal.title)} — ${deal.card_benefit ? deal.card_benefit + ", " : ""}${deal.limit_per_person ? "한도 " + deal.limit_per_person + ", " : ""}${ended ? "종료된 딜" : "진행 중"}. 출처 커뮤니티 글과 일별 가격 추이를 확인하세요.`,
    canonical: `${site.siteUrl}/deal/${deal.id}/`,
    jsonld: ld([...orgLd, breadcrumbLd(crumbItems), { "@type": "Offer", name: titleClean(deal.title), price: deal.sale_price ?? undefined, priceCurrency: "KRW", availability: ended ? "https://schema.org/SoldOut" : "https://schema.org/InStock", url: `${site.siteUrl}/deal/${deal.id}/`, seller: deal.merchant ? { "@type": "Organization", name: merchantName[deal.merchant] ?? deal.merchant } : undefined }]),
    crumbs: crumbs(crumbItems),
    brand: deal.brand, brandName: brandName[deal.brand] ?? deal.brand, merchantName: merchantName[deal.merchant] ?? deal.merchant ?? "판매처 미확인",
    statusChipClass: chipClass, statusLabel: label,
    affiliateChip: raw(site.affiliate.enabled && deal.is_affiliate ? `<span class="chip-affiliate">${esc(site.affiliate.label)}</span>` : ""),
    titleClean: titleClean(deal.title), firstSeen: deal.first_seen, firstSeenLabel: kstLabel(deal.first_seen), lastSeen: deal.last_seen, lastSeenLabel: kstLabel(deal.last_seen), isoWeek: deal.iso_week,
    salePriceLabel: krw(deal.sale_price), faceValueLabel: krw(deal.face_value), discountLabel: pct(deal.discount_rate),
    fourthLabel: deal.rate_gap != null ? "시세 대비" : "커뮤니티 반응", fourthValue: deal.rate_gap != null ? `${Number(deal.rate_gap).toFixed(1)}%p ↓` : `추천 ${deal.votes_total ?? 0}`,
    conditionRows: raw(cond), priceRows: raw(priceRows), historyRows: raw(historyRows), repeatWeeks: det.repeat_weeks ?? 1, sourceRows: raw(sourceRows), relatedRows: raw(relatedRows),
    ctaCaption: ended ? "이 딜은 종료되었습니다" : "구매는 원문 글의 링크로 이동합니다",
    ctaButton: raw(ctaButton),
    ctaNote: ended ? "종료 후에도 조건 비교를 위해 기록을 남겨 둡니다." : "판매처 페이지에서 가격·카드 조건·한도를 반드시 다시 확인하세요. 이 사이트는 판매·중개를 하지 않습니다.",
    rateAside: raw(deal.buy_rate != null ? `<div class="card p-5 text-sm"><h2 class="font-bold">시세 참고</h2><p class="mt-1 text-ink-700">현재 매입 시세 ${pct(deal.buy_rate)} 대비 이 딜의 가격 비율은 ${pct((deal.sale_price / deal.face_value) * 100)}입니다.</p><p class="mt-2 text-xs text-ink-500">${esc(site.rates.attribution)} · 참고 지표이며 매도를 권유하지 않습니다.</p></div>` : ""),
  }), { indexable: !ended, lastmod: deal.last_seen });
  dealPages++;
}

// ---------- 4. 주간 ----------
const weeks = recentWeeks();
{
  const crumbItems = [{ name: "홈", href: "/" }, { name: "주간 비교" }];
  const rows = [...weeks].reverse().map((w) => {
    const wd = data.weekly[w]; const ds = wd ? Object.values(wd.brands ?? {}).flat() : [];
    const maxDisc = ds.filter((d) => d.discount_rate != null).sort((x, y) => y.discount_rate - x.discount_rate)[0];
    return `<tr><td class="py-2 pr-3 font-medium">${ds.length ? link(`/weekly/${w}/`, w) : esc(w)}${w === isoWeekKST() ? ' <span class="chip-live ml-1">이번 주</span>' : ""}</td><td class="py-2 pr-3 text-ink-500">${esc(weekRange(w).label)}</td><td class="py-2 pr-3 tabular-nums">${ds.length}</td><td class="py-2 pr-3 tabular-nums">${new Set(ds.map((d) => d.brand)).size}</td><td class="py-2 tabular-nums">${maxDisc ? `${pct(maxDisc.discount_rate)} <span class="text-ink-500">(${esc(brandName[maxDisc.brand] ?? maxDisc.brand)})</span>` : "—"}</td></tr>`;
  }).join("");
  await emit("/weekly/", await render("weekly-index", {
    ...common, title: `주간 상품권 핫딜 비교 | ${site.siteName}`,
    description: "최근 8주 상품권 핫딜을 주차별로 비교합니다. 반복되는 상시 특가와 단발 딜을 구분하고 브랜드별 최저가 흐름을 확인하세요.",
    canonical: `${site.siteUrl}/weekly/`, jsonld: ld([...orgLd, breadcrumbLd(crumbItems)]), crumbs: crumbs(crumbItems), weekRows: raw(rows),
  }));
}
for (const [i, w] of weeks.entries()) {
  const wd = data.weekly[w];
  if (!wd && w !== isoWeekKST()) continue;
  const brandsMap = wd?.brands ?? {};
  const ds = Object.values(brandsMap).flat();
  const sections = (await Promise.all(Object.entries(brandsMap).sort((a, b) => b[1].length - a[1].length).map(async ([slug, list]) =>
    `<section class="mt-10" aria-labelledby="h-${esc(slug)}"><div class="flex items-baseline justify-between"><h2 id="h-${esc(slug)}" class="text-xl font-extrabold">${link(`/brands/${slug}/`, brandName[slug] ?? slug, "hover:underline")}</h2><span class="text-sm text-ink-500">${list.length}건</span></div><div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${await cards([...list].sort((a, b) => (b.discount_rate ?? 0) - (a.discount_rate ?? 0)))}</div></section>`))).join("")
    || '<p class="mt-8 rounded-md bg-surface-muted p-6 text-center text-sm text-ink-500">이번 주에 수집된 딜이 아직 없습니다.</p>';
  const crumbItems = [{ name: "홈", href: "/" }, { name: "주간 비교", href: "/weekly/" }, { name: w }];
  const prevW = weeks[i - 1], nextW = weeks[i + 1];
  await emit(`/weekly/${w}/`, await render("weekly", {
    ...common, title: `${w} 상품권 핫딜 비교 (${weekRange(w).label}) | ${site.siteName}`,
    description: `${w} (${weekRange(w).label}) 한 주 동안 커뮤니티에 올라온 상품권 핫딜 ${ds.length}건을 브랜드별로 비교합니다.`,
    canonical: `${site.siteUrl}/weekly/${w}/`, jsonld: ld([...orgLd, breadcrumbLd(crumbItems)]), crumbs: crumbs(crumbItems),
    week: w, rangeLabel: weekRange(w).label, count: ds.length, brandCount: Object.keys(brandsMap).length,
    prevLink: raw(prevW && data.weekly[prevW] ? link(`/weekly/${prevW}/`, `← ${prevW}`, "btn-ghost") : ""),
    nextLink: raw(nextW && (data.weekly[nextW] || nextW === isoWeekKST()) ? link(`/weekly/${nextW}/`, `${nextW} →`, "btn-ghost") : ""),
    brandSections: raw(sections),
  }));
}

// ---------- 5. 소개·데이터 제공·임베드·404 ----------
{
  const crumbItems = [{ name: "홈", href: "/" }, { name: "소개·출처 정책" }];
  await emit("/about/", await render("about", {
    ...common, title: `소개와 출처 정책 | ${site.siteName}`,
    description: `${site.siteName}의 운영 목적, 커뮤니티 핫딜 수집 범위와 제외 요청 절차, 정확성 안내, 제휴 정책을 설명합니다.`,
    canonical: `${site.siteUrl}/about/`, jsonld: ld([...orgLd, breadcrumbLd(crumbItems)]), crumbs: crumbs(crumbItems),
    sourceList: sourcesJson.sources.filter((s) => s.enabled !== false).map((s) => s.name).join(", "),
    affiliateStatement: site.affiliate.enabled
      ? "일부 구매 링크는 제휴 링크이며, 구매 시 운영자가 수수료를 받을 수 있습니다. 제휴 링크에는 \"제휴 링크\" 라벨을 표시하고, 제휴 여부가 딜의 순위나 표시 조건에 영향을 주지 않습니다."
      : "현재 제휴 링크와 광고를 사용하지 않습니다. 향후 도입하는 경우 해당 링크에 \"제휴 링크\" 라벨을 표시하고 이 페이지에 먼저 공지합니다.",
  }));
}
{
  const crumbItems = [{ name: "홈", href: "/" }, { name: "데이터 제공" }];
  const sample = activeDeals[0] ?? data.deals[0];
  await emit("/open-data/", await render("open-data", {
    ...common, title: `데이터 제공 · 임베드 위젯 | ${site.siteName}`,
    description: "상품권 핫딜 데이터를 JSON 피드와 임베드 위젯으로 제공합니다. 출처 표기 조건과 엔드포인트, 임베드 코드 안내.",
    canonical: `${site.siteUrl}/open-data/`, jsonld: ld([...orgLd, breadcrumbLd(crumbItems)]), crumbs: crumbs(crumbItems),
    sampleJson: sample ? JSON.stringify(sample, null, 2) : "{}",
    brandSlugs: raw(BRANDS.map((b) => `<code class="rounded bg-surface-muted px-1">${esc(b.slug)}</code>`).join(" ")),
  }));
}
await emit("/embed/", await render("embed", { title: `${site.siteName} 핫딜 TOP 5`, brandSlug: "" }), { indexable: false });
for (const b of BRANDS) await emit(`/embed/${b.slug}/`, await render("embed", { title: `${site.siteName} ${b.name} 핫딜`, brandSlug: b.slug }), { indexable: false });
await emit("/404.html", await render("404", { ...common, title: `페이지를 찾을 수 없습니다 | ${site.siteName}`, description: "요청한 페이지가 없습니다.", canonical: `${site.siteUrl}/404.html`, robots: "noindex", jsonld: ld(orgLd) }), { indexable: false });

// ---------- 6. 자산·메타 파일 ----------
await cp(path.join(root, "src/js/site.js"), path.join(dist, "assets/site.js"));
await writeFile(path.join(dist, "embed.js"), (await readFile(path.join(root, "src/js/embed.js"), "utf8")).replaceAll("__API_BASE__", apiBase).replaceAll("__SITE_NAME__", site.siteName));
await writeFile(path.join(dist, "assets/favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1d58f0"/><path d="M8 15h16v10H8z M6 10h20v5H6z M16 10v15" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>`);
await writeFile(path.join(dist, "api/deals.json"), JSON.stringify({ ...data.meta, deals: activeDeals }));
await writeFile(path.join(dist, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /embed/\nSitemap: ${site.siteUrl}/sitemap.xml\n`);
await writeFile(path.join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`);
await writeFile(path.join(dist, "_headers"), `/api/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n/embed.js\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=3600\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
console.log(`[build] mode=${data.mode} deals=${data.deals.length} active=${activeDeals.length} dealPages=${dealPages} brandPages=${BRANDS.length} weekPages=${weeks.filter((w) => data.weekly[w] || w === isoWeekKST()).length} sitemapUrls=${urls.length} stale=${staleNow}`);
