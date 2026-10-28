/**
 * shared/cards.json 검증 (스펙: docs/superpowers/specs/2026-10-28-card-benefits-design.md "데이터 모델").
 * 순수 함수. 문제 목록(string[])을 돌려주며 비어 있으면 통과.
 * 메시지 형식: `cards[i] <slug>: <필드> <설명>`
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TYPES = new Set(["credit", "check"]);
const STATUSES = new Set(["verified", "unverified", "discontinued"]);
const KINDS = new Set(["discount", "points", "cashback"]);
const GIFTCARD = new Set(["applies", "excluded", "unknown"]);

const isDate = (s) => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isNullableString = (v) => v === null || v === undefined || typeof v === "string";

/**
 * @param {object} doc shared/cards.json 내용
 * @param {{ merchantSlugs: Set<string>, issuerSlugs: Set<string>, today: string }} ctx today는 YYYY-MM-DD
 * @returns {string[]} 문제 목록
 */
export function validateCards(doc, { merchantSlugs, issuerSlugs, today }) {
  const problems = [];
  if (!doc || typeof doc !== "object") return ["문서가 객체가 아닙니다"];
  if (!isDate(doc.updated_at)) problems.push(`updated_at 은 YYYY-MM-DD 여야 합니다 (현재: ${doc.updated_at})`);
  if (!Number.isInteger(doc.stale_after_days) || doc.stale_after_days <= 0) problems.push(`stale_after_days 는 양의 정수여야 합니다 (현재: ${doc.stale_after_days})`);
  if (!Array.isArray(doc.cards)) return [...problems, "cards 는 배열이어야 합니다"];

  const seen = new Set();
  doc.cards.forEach((c, i) => {
    const tag = `cards[${i}] ${c?.slug ?? "(slug 없음)"}:`;
    const p = (msg) => problems.push(`${tag} ${msg}`);
    if (!c || typeof c !== "object") return p("카드가 객체가 아닙니다");

    if (typeof c.slug !== "string" || !SLUG_RE.test(c.slug)) p(`slug 는 kebab-case 여야 합니다 (현재: ${c.slug})`);
    else if (seen.has(c.slug)) p("slug 중복");
    else seen.add(c.slug);
    if (!issuerSlugs.has(c.issuer)) p(`issuer "${c.issuer}" 는 brands.json card_issuers 에 없습니다`);
    if (typeof c.name !== "string" || !c.name.trim()) p("name 이 비어 있습니다");
    if (!TYPES.has(c.type)) p(`type 은 credit|check 여야 합니다 (현재: ${c.type})`);
    if (!isNullableString(c.annual_fee)) p("annual_fee 는 문자열 또는 null 이어야 합니다");
    if (!Number.isInteger(c.prev_month_min) || c.prev_month_min < 0) p(`prev_month_min 은 0 이상 정수여야 합니다 (현재: ${c.prev_month_min})`);
    if (typeof c.official_url !== "string" || !c.official_url.startsWith("https://")) p(`official_url 은 https:// 로 시작해야 합니다 (현재: ${c.official_url})`);
    else if (/card-gorilla\.com/i.test(c.official_url)) p("official_url 에 card-gorilla.com 은 쓸 수 없습니다 (카드사 공식 페이지만)");
    if (!isDate(c.verified_at)) p(`verified_at 은 YYYY-MM-DD 여야 합니다 (현재: ${c.verified_at})`);
    else if (c.verified_at > today) p(`verified_at 이 오늘(${today}) 이후입니다 (현재: ${c.verified_at})`);
    if (!STATUSES.has(c.status)) p(`status 는 verified|unverified|discontinued 여야 합니다 (현재: ${c.status})`);
    if (!Array.isArray(c.benefits) || c.benefits.length === 0) return p("benefits 는 1개 이상이어야 합니다");

    c.benefits.forEach((b, j) => {
      const q = (msg) => p(`benefits[${j}].${msg}`);
      if (!b || typeof b !== "object") return q("(객체 아님)");
      if (!merchantSlugs.has(b.merchant)) q(`merchant "${b.merchant}" 는 brands.json merchants 에 없습니다`);
      if (!KINDS.has(b.kind)) q(`kind 는 discount|points|cashback 여야 합니다 (현재: ${b.kind})`);
      const hasRate = typeof b.rate === "number" && b.rate >= 0 && b.rate <= 100;
      const hasAmount = Number.isInteger(b.amount) && b.amount > 0;
      if (!hasRate && !hasAmount) q("rate(0~100) 또는 amount(양의 정수) 중 하나는 있어야 합니다");
      if (!isNullableString(b.cap)) q("cap 은 문자열 또는 null 이어야 합니다");
      if (!GIFTCARD.has(b.giftcard)) q(`giftcard 는 applies|excluded|unknown 중 하나를 반드시 적어야 합니다 (현재: ${b.giftcard})`);
      if (typeof b.note !== "string" || b.note.length > 120) q(`note 는 120자 이하 문자열이어야 합니다 (현재: ${typeof b.note === "string" ? `${b.note.length}자` : typeof b.note})`);
    });
  });
  return problems;
}
