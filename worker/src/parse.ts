import { BRANDS, MERCHANTS, CARD_ISSUERS } from "./config";
import type { ParsedDeal, RawPost } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 가장 긴 alias가 먼저 매칭되도록 정렬 */
const brandIndex = BRANDS.flatMap((b) => b.aliases.map((a) => ({ alias: norm(a), b })))
  .sort((x, y) => y.alias.length - x.alias.length);
const merchantIndex = MERCHANTS.flatMap((m) => m.aliases.map((a) => ({ alias: norm(a), m })))
  .sort((x, y) => y.alias.length - x.alias.length);
const cardIndex = CARD_ISSUERS.flatMap((c) => c.aliases.map((a) => ({ alias: norm(a), c })))
  .sort((x, y) => y.alias.length - x.alias.length);

/** "5만", "50,000", "5만원", "10만" → 원 단위 정수 */
export function parseKRW(token: string): number | null {
  const t = token.replace(/[,\s원]/g, "");
  const m = t.match(/^(\d+(?:\.\d+)?)(만|천)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === "만") return Math.round(n * 10000);
  if (m[2] === "천") return Math.round(n * 1000);
  return Math.round(n);
}

const AMOUNT = "\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?\\s*[만천]|\\d{4,7}";

/** 제목에서 액면가·판매가 후보 추출 */
export function extractPrices(title: string, knownFaceValues: number[]): { face: number | null; sale: number | null } {
  const found: number[] = [];
  const re = new RegExp(`(${AMOUNT})\\s*원?`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    const v = parseKRW(m[1]);
    if (v !== null && v >= 1000 && v <= 5_000_000) found.push(v);
  }
  if (found.length === 0) return { face: null, sale: null };

  // 액면가: 브랜드의 알려진 권종과 일치하는 값 우선, 없으면 "만" 단위 떨어지는 가장 큰 값
  const face = found.find((v) => knownFaceValues.includes(v))
    ?? found.filter((v) => v % 10000 === 0).sort((a, b) => b - a)[0]
    ?? null;
  // 판매가: 액면가보다 작은 값 중 가장 큰 값 (할인가)
  const sale = found.filter((v) => face === null || v < face).sort((a, b) => b - a)[0] ?? null;
  return { face, sale };
}

/** "10% 할인", "8%" 등 퍼센트 할인 표기 */
function extractPercent(title: string): number | null {
  const m = title.match(/(\d{1,2}(?:\.\d)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function extractLimit(title: string): string | null {
  const m = title.match(/(1인|인당|계정당|ID당|아이디당)\s*(?:최대\s*)?(\d+\s*(?:매|장|개|회|만원|만))/i)
    ?? title.match(/(월|주|일|하루)\s*(?:최대\s*)?(\d+\s*(?:매|장|개|회|만원|만))/);
  return m ? `${m[1]} ${m[2]}`.replace(/\s+/g, " ") : null;
}

function extractPaymentNote(title: string): string | null {
  const notes: string[] = [];
  if (/즉시\s*할인/.test(title)) notes.push("즉시할인");
  if (/청구\s*할인/.test(title)) notes.push("청구할인");
  if (/무이자/.test(title)) notes.push("무이자");
  if (/(네이버페이|npay|네페)\s*결제/i.test(title)) notes.push("네이버페이 결제");
  if (/(카카오페이)\s*결제/.test(title)) notes.push("카카오페이 결제");
  if (/토스페이|토스\s*결제/.test(title)) notes.push("토스페이 결제");
  if (/(쿠폰|할인쿠폰)/.test(title)) notes.push("쿠폰 적용");
  return notes.length ? notes.join(", ") : null;
}

/**
 * 커뮤니티 글 제목 → 상테크 딜 필드. 상품권 브랜드가 식별되지 않으면 null.
 * 정규식 1차 파싱 (D-15). confidence < 0.5 인 건은 parse_queue로 넘긴다.
 */
export function parseTitle(post: RawPost): ParsedDeal | null {
  const title = post.title.trim();
  const n = norm(title);

  const brandHit = brandIndex.find((x) => n.includes(x.alias));
  if (!brandHit) return null;
  const brand = brandHit.b;

  // 판매처: 제목 맨 앞 대괄호 우선, 없으면 전체에서 탐색
  let merchant: string | null = null;
  const bracket = title.match(/^\s*[\[(]([^\])]{1,20})[\])]/);
  if (bracket) {
    const bn = norm(bracket[1]);
    merchant = merchantIndex.find((x) => bn.includes(x.alias))?.m.slug ?? null;
  }
  if (!merchant) merchant = merchantIndex.find((x) => n.includes(x.alias))?.m.slug ?? null;

  const { face, sale } = extractPrices(title, brand.face_values);
  const pct = extractPercent(title);

  let faceValue = face;
  let salePrice = sale;
  let discountRate: number | null = null;

  if (faceValue && salePrice) {
    discountRate = +((1 - salePrice / faceValue) * 100).toFixed(2);
  } else if (faceValue && pct !== null) {
    salePrice = Math.round(faceValue * (1 - pct / 100));
    discountRate = pct;
  } else if (pct !== null) {
    discountRate = pct;
  }

  const cardIssuers = [...new Set(cardIndex.filter((x) => n.includes(x.alias)).map((x) => x.c.slug))];
  // "카드" 단어 없이 "신한", "현대"만 나오는 경우 오탐 방지: 카드/할인/결제 문맥이 있을 때만 인정
  const cardContext = /카드|할인|결제|청구|즉시/.test(title);
  const issuers = cardContext ? cardIssuers : cardIssuers.filter((slug) =>
    CARD_ISSUERS.find((c) => c.slug === slug)!.aliases.some((a) => /카드|뱅크/.test(a) && n.includes(norm(a))));

  const cardBenefit = issuers.length
    ? `${issuers.map((s) => CARD_ISSUERS.find((c) => c.slug === s)!.name).join("·")}${pct !== null ? ` ${pct}%` : ""}${/즉시/.test(title) ? " 즉시할인" : /청구/.test(title) ? " 청구할인" : " 할인"}`
    : null;

  // 신뢰도: 가격 정보(판매가 또는 할인율)가 전혀 없으면 0.45 상한 → parse_queue 행
  let confidence = 0.35;
  if (merchant) confidence += 0.1;
  if (faceValue) confidence += 0.15;
  if (salePrice) confidence += 0.2;
  if (discountRate !== null) confidence += 0.2;
  if (salePrice === null && discountRate === null) confidence = Math.min(confidence, 0.45);
  if (discountRate !== null && (discountRate < 0 || discountRate > 60)) confidence = Math.min(confidence, 0.3); // 비정상 할인율 → 큐

  return {
    brand: brand.slug,
    brandName: brand.name,
    category: brand.category,
    merchant,
    faceValue,
    salePrice,
    discountRate,
    cardIssuers: issuers,
    cardBenefit,
    limitPerPerson: extractLimit(title),
    paymentNote: extractPaymentNote(title),
    confidence: Math.max(0, Math.min(1, +confidence.toFixed(2))),
  };
}

/** 상품권·상테크와 무관한 글을 빠르게 거르는 사전 필터 */
export function looksLikeGiftDeal(title: string): boolean {
  return /상품권|기프트|캐시|캐쉬|포인트|페이|관람권|e카드|문상|해머|도문|컬쳐|컬처|북앤|신세계|롯데|현대백|갤러리아|이마트|홈플러스|스타벅스|cgv|구글|넥슨/i.test(title);
}
