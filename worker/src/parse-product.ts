import { MERCHANTS } from "./config";
import { norm, parseKRW, extractCardInfo, extractLimit, extractPaymentNote } from "./parse";
import { tokenize } from "./group";
import type { ParsedProduct, RawPost } from "./types";

/**
 * 일반 상품 핫딜 제목 파서 (D-18). 정규식 1차 파싱, 신뢰도 0.5 미만은 parse_queue 로 간다(D-15).
 * 지원 관례:
 *   뽐뿌·루리웹  [쇼핑몰] 상품명 (가격/배송비) · [쇼핑몰] 상품명 (가격) (배송비) · [쇼핑몰] 상품명 가격 (배송비)
 *   클리앙      상품명 (쇼핑몰/가격/배송)
 * 제목과 링크만 다룬다(본문·이미지·이동 주소는 보지 않는다, 출처 정책).
 */

const PRICE_MIN = 100;
const PRICE_MAX = 50_000_000;

/** 전체 판매처 사전(상품권 파서와 달리 product_only 포함). 긴 alias 우선 */
const merchantIndex = MERCHANTS.flatMap((m) => m.aliases.map((a) => ({ alias: norm(a), slug: m.slug })))
  .sort((x, y) => y.alias.length - x.alias.length);

/** 판매처가 아닌 말머리. 맨 앞 대괄호가 이 중 하나면 떼고 다음 대괄호를 본다 */
const TAGS = new Set(["해외", "국내", "정보", "질문", "기타", "이벤트", "핫딜", "특가", "공지", "후기", "잡담", "끌올", "재업", "수정"]);
const CLOSED = new Set(["종료", "품절", "마감", "완판", "판매종료", "종료됨", "품절됨", "매진", "마감됨", "종료된딜"]);

const GROUP = /[\[(]([^\[\]()]*)[\])]/g;
const LEAD = /^\s*[\[(]([^\[\]()]{1,20})[\])]\s*/;

/** 가격 앞에 붙는 조건·결제수단 표기. 숫자가 바로 뒤따를 때만 뗀다 */
const PRICE_LABEL = /^(?:카드가?|쿠폰가?|최종가?|할인가|특가|체감가?|실구매가?|회원가|앱가?|와우|[t티]멤(?:버십)?|[t티]맴버십|토스(?:페이)?|페이코|네이버페이|네페|카카오페이|카페이|삼성페이|스마일페이)(?=\d)/i;

/** 금액 표기 한 조각 전체("9,900원", "5.9만", "45900"). marker: 쉼표·만·천·원 중 하나가 있어 금액임이 분명한가 */
function readAmount(piece: string): { value: number; marker: boolean } | null {
  // 가격 앞에 붙는 말("카드25,780원", "쿠폰가 9,900원", "최종 12,300원")은 떼고 읽는다
  const t = norm(piece).replace(PRICE_LABEL, "").replace(/^약/, "").replace(/[~대]$/, "");
  if (!/^(?:(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?[만천]|\d{3,11})원?|\d{1,2}원)$/.test(t)) return null;
  const value = parseKRW(t);
  return value === null ? null : { value, marker: /[,만천원]/.test(t) };
}
const inRange = (v: number) => v >= PRICE_MIN && v <= PRICE_MAX;
const won = (v: number) => `${v.toLocaleString("ko-KR")}원`;

const DESCRIPTIVE = new Set(["다양", "가격다양", "다양한가격", "상품별", "상품별상이", "옵션별", "옵션별상이", "가격상이", "각종", "공짜", "나눔"]);
const FREE = new Set(["무료", "0원"]);
const isForeign = (piece: string) => /^[$€£¥]\s*\d/.test(piece.trim()) || /^\d[\d.,]*\s*(달러|유로|엔|위안|파운드|usd|eur|jpy)$/i.test(piece.trim());

/** 배송비 표기 정규화. 배송비로 볼 수 없으면 null */
function readShipping(piece: string): string | null {
  const n = norm(piece);
  if (/^(무료|무배|무료배송|배송무료|무료배달|무료택배|택배무료|배송비무료|0원)$/.test(n)) return "무료";
  if (/착불/.test(n)) return "착불";
  if (/조건부|무료|무배/.test(n)) return "조건부 무료"; // "와우무료", "3만원 이상 무료", "조건부 무배"
  const m = n.match(/^(?:배송비?|택배비?|배)(\d[\d,.]*[만천]?)원?$/);
  if (m) { const v = parseKRW(m[1]); if (v !== null) return v === 0 ? "무료" : won(v); }
  if (/^(유료|유배|유료배송)$/.test(n)) return "유료";
  return null;
}

function lookupMerchant(text: string, strict: boolean): string | null {
  const n = norm(text);
  if (!n) return null;
  const hit = merchantIndex.find((x) => n.includes(x.alias) && (!strict || n.length <= x.alias.length + 4));
  return hit?.slug ?? null;
}

/** 제목 맨 앞 말머리나 괄호 표기로 딜이 끝났다고 알리는 글인지. 본문 속 낱말("품절 대란")은 보지 않는다 */
export function isClosedTitle(title: string): boolean {
  for (const m of title.matchAll(GROUP)) if (CLOSED.has(norm(m[1]))) return true;
  return false;
}

export function parseProductTitle(post: RawPost): ParsedProduct | null {
  const title = post.title.trim();
  let body = title;

  // 1) 말머리·종료 표시 괄호 제거
  body = body.replace(GROUP, (all, inner: string) => (CLOSED.has(norm(inner)) ? " " : all));
  for (let m = body.match(LEAD); m && TAGS.has(norm(m[1])); m = body.match(LEAD)) body = body.slice(m[0].length);

  // 2) 맨 앞 괄호 = 판매처
  let merchant: string | null = null;
  let merchantRaw: string | null = null;
  const lead = body.match(LEAD);
  if (lead && !readAmount(lead[1]) && !readShipping(lead[1])) {
    merchant = lookupMerchant(lead[1], false);
    if (!merchant && !lead[1].includes("/") && /[a-z가-힣]/i.test(lead[1])) merchantRaw = lead[1].trim();
    if (merchant || merchantRaw) body = body.slice(lead[0].length);
  }

  // 3) 정보 괄호(가격·배송비·판매처가 든 괄호)를 찾아 조각으로 나눈다. 상품명 속 괄호("(블랙)")는 남긴다
  type Piece = { text: string; amount: ReturnType<typeof readAmount> };
  const pieces: Piece[] = [];
  body = body.replace(GROUP, (all, inner: string) => {
    const parts = inner.split("/").map((x) => x.trim()).filter(Boolean);
    if (parts.length === 0) return all;
    const multi = parts.length >= 2;
    const read = parts.map((text) => {
      const a = readAmount(text);
      return { text, amount: a && (a.marker || multi) ? a : null };
    });
    const isInfo = read.some((x) => x.amount || DESCRIPTIVE.has(norm(x.text)) || FREE.has(norm(x.text)) || isForeign(x.text) || readShipping(x.text) || lookupMerchant(x.text, true));
    if (!isInfo) return all;
    pieces.push(...read);
    return " ";
  });

  // 4) 가격: 괄호 안의 숫자 가격 → 본문의 마지막 금액 → 서술형
  const used = new Set<number>();
  let salePrice: number | null = null;
  let priceKind: ParsedProduct["priceKind"] = null;
  let priceText: string | null = null;
  const sawAmount = pieces.some((x) => x.amount);
  const exactIdx = pieces.findIndex((x) => x.amount && inRange(x.amount.value));
  if (exactIdx >= 0) {
    salePrice = pieces[exactIdx].amount!.value; priceKind = "exact"; used.add(exactIdx);
  } else if (!sawAmount) {
    // 본문에서는 "원"이 붙은 금액만 가격으로 본다("20,000mAh" 같은 숫자 제외).
    // 뒤에 이상·할인·쿠폰·적립이 오면 가격이 아니라 조건이다("3만원 이상 5천원 할인").
    const inBody = [...body.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*[만천]|\d{3,8})\s*원(?!\s*(?:이상|이하|할인|쿠폰|적립|당|씩|대))/g)];
    const last = inBody[inBody.length - 1];
    const v = last ? parseKRW(last[1]) : null;
    if (last && v !== null && inRange(v)) {
      salePrice = v; priceKind = "exact";
      body = body.slice(0, last.index) + " " + body.slice(last.index! + last[0].length);
    }
  }
  if (priceKind === null && !sawAmount) {
    const i = pieces.findIndex((x) => DESCRIPTIVE.has(norm(x.text)) || FREE.has(norm(x.text)) || isForeign(x.text));
    if (i >= 0) { priceKind = "descriptive"; priceText = pieces[i].text; used.add(i); }
  }

  // 5) 판매처(클리앙 관례: 괄호 안 조각)와 배송비
  let shipping: string | null = null;
  pieces.forEach((x, i) => {
    if (used.has(i)) return;
    if (!merchant && !x.amount) {
      const slug = lookupMerchant(x.text, true);
      if (slug) { merchant = slug; merchantRaw = null; used.add(i); return; }
    }
    if (shipping !== null) return;
    if (x.amount) {
      if (priceKind === "exact" && i > exactIdx && x.amount.value <= 100_000) { shipping = x.amount.value === 0 ? "무료" : won(x.amount.value); used.add(i); }
      return;
    }
    const s = readShipping(x.text);
    if (s) { shipping = s; used.add(i); return; }
    // 가격 뒤에 온 알 수 없는 조각은 배송 조건 원문으로 둔다("(9,900원/편의점픽업)")
    if (priceKind !== null && exactIdx >= 0 && i > exactIdx && x.text.length <= 20) { shipping = x.text; used.add(i); }
  });

  // 6) 상품명
  const productName = body.replace(/\s+/g, " ").replace(/^[\s\-·,|/~]+|[\s\-·,|/~]+$/g, "").trim();
  if (productName.length < 2) return null;
  const tokens = tokenize(productName);

  const { issuers, cardBenefit } = extractCardInfo(title, { strict: true });
  // 상품명 속 퍼센트("알콜 70%", "순면 100%")는 할인율이 아니다. 할인·쿠폰·세일이 붙은 퍼센트만 쓴다.
  const pct = title.match(/(\d{1,2}(?:\.\d)?)\s*%\s*(?:즉시|청구|추가|중복|카드)?\s*(?:할인|쿠폰|세일|off)/i);

  let confidence = 0.3;
  if (merchant || merchantRaw) confidence += 0.2;
  if (priceKind === "exact") confidence += 0.35;
  if (priceKind === "descriptive") confidence += 0.25;
  if (shipping) confidence += 0.1;
  if (tokens.length >= 2) confidence += 0.05;
  if (priceKind === null) confidence = Math.min(confidence, 0.45); // 가격 표기가 전혀 없으면 큐로

  return {
    merchant, merchantRaw, productName, tokens,
    salePrice, priceKind, priceText, shipping,
    discountRate: pct ? parseFloat(pct[1]) : null,
    cardIssuers: issuers, cardBenefit,
    limitPerPerson: extractLimit(title),
    paymentNote: extractPaymentNote(title),
    confidence: Math.max(0, Math.min(1, +confidence.toFixed(2))),
  };
}
