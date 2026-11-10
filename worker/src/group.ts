import { sha1 } from "./dedupe";

/**
 * 일반 딜의 느슨한 "같은 상품" 묶기 (D-19).
 * 완벽한 상품 식별이 아니라 같은 글이 여러 커뮤니티에 올라온 것을 잡는 것이 목적이다.
 * 같은 주차·같은 판매처·같은 가격인 딜 가운데 제목 토큰의 Jaccard 유사도가 기준 이상인 것에 붙인다.
 */
export const GROUP_THRESHOLD = 0.5;

/** 상품을 구별하는 데 쓸모없는 흔한 말 */
export const STOPWORDS = new Set([
  "무료배송", "무배", "무료", "배송", "배송비", "특가", "핫딜", "할인", "쿠폰", "역대가", "최저가", "카드",
  "즉시할인", "청구할인", "오늘만", "한정", "타임딜", "와우", "로켓배송", "품절임박", "재입고",
]);

/** 상품명 → 묶기용 토큰. 소문자, 한글·영문·숫자만, 1글자·불용어 제거, 중복 제거, 정렬 */
export function tokenize(productName: string): string[] {
  const words = productName.toLowerCase().replace(/[^0-9a-z가-힣]+/g, " ").split(" ");
  return [...new Set(words.filter((w) => w.length >= 2 && !STOPWORDS.has(w)))].sort();
}

/** 토큰 집합의 Jaccard 유사도. 어느 한쪽이 비면 0(불용어뿐인 제목끼리 묶이지 않게) */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** 후보 중 기준 이상이면서 가장 비슷한 딜의 id. 동점이면 앞선 후보. 없으면 null */
export function pickGroup(tokens: string[], candidates: Array<{ id: string; tokens: string[] }>, threshold = GROUP_THRESHOLD): string | null {
  let best: string | null = null, bestScore = 0;
  for (const c of candidates) {
    const s = jaccard(tokens, c.tokens);
    if (s >= threshold && s > bestScore) { best = c.id; bestScore = s; }
  }
  return best;
}

/** 판매처 비교 키: 사전 slug, 없으면 정규화한 원문 표기, 둘 다 없으면 "-" */
export function merchantKey(slug: string | null, raw: string | null): string {
  if (slug) return slug;
  const n = (raw ?? "").toLowerCase().replace(/\s+/g, "");
  return n ? `raw:${n}` : "-";
}

/** 일반 딜의 dedupe 키: product|판매처키|가격|토큰 해시|주차. 토큰이 완전히 같을 때만 같은 키가 된다 */
export async function productDedupeKey(p: { merchantKey: string; price: number | null; tokens: string[] }, isoWeek: string): Promise<string> {
  const hash = (await sha1([...p.tokens].sort().join(" "))).slice(0, 12);
  return ["product", p.merchantKey, p.price ?? "-", hash, isoWeek].join("|");
}
