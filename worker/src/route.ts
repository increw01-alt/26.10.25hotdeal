import type { ParsedDeal, ParsedProduct, RawPost } from "./types";
import { sourceKinds } from "./config";
import { looksLikeGiftDeal, parseTitle, isRewardEventTitle, hasStrongGiftBrand } from "./parse";
import { parseProductTitle, isClosedTitle } from "./parse-product";

/** 신뢰도가 이 값 미만이면 딜로 확정하지 않고 parse_queue 로 보낸다 (D-15) */
export const MIN_CONFIDENCE = 0.5;

export type Route =
  | { action: "gift"; parsed: ParsedDeal }
  | { action: "queue"; reason: string }
  | { action: "product"; parsed: ParsedProduct }
  | { action: "touch" }   // 이미 일반 딜에 연결된 글: 다시 본 것만 기록
  | { action: "close" }   // 이미 일반 딜에 연결된 글에 종료 표시가 붙음
  | { action: "skip" };

/**
 * 글 한 건이 어느 갈래로 가는지 정한다(DB를 보지 않는 순수 함수).
 * linked: 이 글(source, post_id)이 이미 연결된 딜의 종류. 처음 보는 글이면 null.
 *
 * 순서(스펙 "수집 흐름"):
 *  1. 일반 딜에 이미 연결된 글은 그 딜에 남는다(제목이 바뀌어도 새 딜을 만들지 않는다, D-19 ①).
 *  2. 상품권 판정은 1단계와 똑같다. 종료 표시가 있어도 상품권 경로는 건드리지 않는다.
 *  3. 상품권이 아니면 일반 딜 후보: 소스가 일반 딜을 받는지 → 이벤트 글 제외 → 종료 표시 제외 → 일반 파서.
 */
export function routePost(post: RawPost, linked: "gift" | "product" | null): Route {
  if (linked === "product") return isClosedTitle(post.title) ? { action: "close" } : { action: "touch" };

  if (looksLikeGiftDeal(post.title)) {
    const gift = parseTitle(post);
    if (gift && gift.confidence >= MIN_CONFIDENCE) return { action: "gift", parsed: gift };
    // 상품권 브랜드가 분명한데 가격 정보가 모자란 글은 지금처럼 큐로.
    // 짧은 alias로만 잡힌 글("스타벅스 텀블러")은 일반 상품일 가능성이 높아 아래로 넘긴다.
    if (gift && !gift.weakOnly) return { action: "queue", reason: `low confidence ${gift.confidence}` };
  } else if (hasStrongGiftBrand(post.title)) {
    // 사전 필터가 놓친 상품권 글("해피머니 5만원"): 1단계에서도 건너뛰던 글이다. 일반 딜로 저장하면 안 된다.
    return { action: "skip" };
  }

  if (linked === "gift") return { action: "skip" };
  if (!sourceKinds(post.source).includes("product")) return { action: "skip" };
  if (isRewardEventTitle(post.title)) return { action: "skip" };
  if (isClosedTitle(post.title)) return { action: "skip" };

  const product = parseProductTitle(post);
  if (!product) return { action: "skip" };
  if (product.confidence >= MIN_CONFIDENCE) return { action: "product", parsed: product };
  return { action: "queue", reason: `product low confidence ${product.confidence}` };
}
