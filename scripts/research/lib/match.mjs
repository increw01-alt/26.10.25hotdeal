/**
 * 카드 비교 사이트 크롤(API 응답 JSON)에서 판매처별 카드 후보를 고르는 순수 함수들. 조사용.
 * 결과(Markdown)는 저장소 밖에 쓴다. 여기 코드와 합성 테스트 픽스처만 저장소에 둔다.
 */
export const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
export const stripTags = (s) => String(s ?? "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(nbsp|middot|lsquo|rsquo|ldquo|rdquo|bull|amp);/g, " ")
  .replace(/\s+/g, " ")
  .trim();

/** `/v1/cards/{숫자}` 응답이고 판매중(is_discon === false)인 레코드만 true */
export function isLiveCardRecord(rec) {
  return !!rec && typeof rec.url === "string" && /\/v1\/cards\/\d+$/.test(rec.url) && !!rec.body && rec.body.is_discon === false;
}

/**
 * top_benefit 태그/제목과 key_benefit 제목/요약에서 판매처 alias를 찾는다.
 * @param {object} body 카드 레코드 body
 * @param {Array<{slug: string, aliases: string[]}>} merchants brands.json merchants
 * @returns {Array<{merchant: string, where: "top_benefit"|"key_benefit", text: string}>} merchants 순서, 판매처당 첫 매칭 1건
 */
export function matchMerchants(body, merchants) {
  const spots = [];
  for (const t of body.top_benefit ?? []) spots.push({ where: "top_benefit", text: [...(t.tags ?? []), t.title].filter(Boolean).join(" ") });
  for (const k of body.key_benefit ?? []) spots.push({ where: "key_benefit", text: k.comment || k.title || "", search: `${k.title ?? ""} ${k.comment ?? ""}` });
  const out = [];
  for (const m of merchants) {
    const aliases = m.aliases.map(norm).filter(Boolean);
    const hit = spots.find((s) => { const n = norm(s.search ?? s.text); return aliases.some((a) => n.includes(a)); });
    if (hit) out.push({ merchant: m.slug, where: hit.where, text: hit.text });
  }
  return out;
}

const KEYWORD = /(상품권|기프트\s*카드|선불|충전)/g;
const EXCLUDED_CTX = /(제외|불가|해당되지|않습니다|않음|안\s*됩니다|대상이\s*아)/;
const VEHICLE_CTX = /(충전소|전기차|수소차|차량|주유|EV)/i;
const POSITIVE_AFTER = /(적립|할인|캐시백|시에도|포함|리워드|별)/;

/** 상품권·선불·충전 언급의 문맥 판정: 제외 문맥이 하나라도 있으면 excluded, 아니면 긍정 표현이 있으면 positive, 둘 다 없으면 none */
export function giftcardStance(text) {
  const t = stripTags(text);
  let positive = false, excluded = false;
  KEYWORD.lastIndex = 0;
  let m;
  while ((m = KEYWORD.exec(t)) !== null) {
    const ctx = t.slice(Math.max(0, m.index - 60), m.index + 60);
    if (m[1] === "충전" && VEHICLE_CTX.test(ctx)) continue;
    if (EXCLUDED_CTX.test(ctx)) { excluded = true; continue; }
    if (POSITIVE_AFTER.test(t.slice(m.index, m.index + 40))) positive = true;
  }
  if (excluded) return "excluded";
  return positive ? "positive" : "none";
}

const cell = (s) => String(s ?? "").replace(/\|/g, "／").replace(/\s+/g, " ").slice(0, 100);
const HEADER = "| idx | 발급사 | 카드 | 종류 | 전월실적 | 연회비 | 매칭 문구 | 상품권 | 참고 |\n|---|---|---|---|---|---|---|---|---|";
const row = (c) => `| ${c.idx} | ${cell(c.issuer)} | ${cell(c.name)} | ${c.type === "CHK" ? "체크" : "신용"} | ${c.prevMonth ? Number(c.prevMonth).toLocaleString("ko-KR") : "없음"} | ${cell(c.annualFee)} | ${cell(c.text)} | ${c.stance} | ${c.refUrl} |`;
const byPlccThenName = (a, b) => Number(!!b.plcc) - Number(!!a.plcc) || String(a.name).localeCompare(String(b.name), "ko");

/**
 * @param {{ byMerchant: Map<string, object[]>, positives: object[] }} input Candidate = { idx, issuer, name, type, prevMonth, annualFee, merchant, text, stance, refUrl, plcc? }
 * @returns {string} Markdown (info 본문은 포함하지 않음)
 */
export function toMarkdown({ byMerchant, positives }) {
  const lines = [
    "# 카드 후보 (조사용, 저장소 밖 보관)", "",
    `생성 ${new Date().toISOString().slice(0, 10)}. 매칭 문구와 참고 링크는 후보를 찾는 용도로만 쓴다. 공개 데이터(shared/cards.json)는 카드사 공식 페이지에서 확인한 뒤 우리 표현으로 적는다.`, "",
  ];
  for (const [slug, list] of byMerchant) {
    lines.push(`## ${slug} (${list.length})`, "", HEADER, ...[...list].sort(byPlccThenName).map(row), "");
  }
  lines.push(`## 상품권·충전 긍정 문맥 (${positives.length})`, "", HEADER, ...positives.map(row), "");
  return lines.join("\n");
}
