/** 점수 산식 (D-10): 소스별 중앙값 정규화 + 할인율 + 최신성 */
export const WEIGHTS = { votes: 0.35, comments: 0.15, discount: 0.35, recency: 0.15 };

export function recencyDecay(hoursSinceFirstSeen: number): number {
  // 0h=1.0, 24h≈0.5, 72h≈0.125
  return Math.pow(0.5, Math.max(0, hoursSinceFirstSeen) / 24);
}

export function computeScore(input: {
  votes: number; comments: number; medianVotes: number; medianComments: number;
  discountRate: number | null; hoursSinceFirstSeen: number;
  sourceCount?: number; // 이 딜이 올라온 커뮤니티 수
}): number {
  const relVotes = input.votes / Math.max(1, input.medianVotes);
  const relComments = input.comments / Math.max(1, input.medianComments);
  const discount = Math.min(1, Math.max(0, (input.discountRate ?? 0) / 20)); // 20% 할인 = 만점
  const s = WEIGHTS.votes * Math.log1p(relVotes)
    + WEIGHTS.comments * Math.log1p(relComments)
    + WEIGHTS.discount * discount
    + WEIGHTS.recency * recencyDecay(input.hoursSinceFirstSeen)
    + sourceBonus(input.sourceCount ?? 1);
  return +s.toFixed(4);
}

/** 여러 커뮤니티에 올라온 딜 가산점: 2곳 +0.1, 3곳 이상 +0.2 (D-18). 추천 수가 없는 RSS 소스의 인기 신호 */
export function sourceBonus(sourceCount: number): number {
  return sourceCount >= 3 ? 0.2 : sourceCount === 2 ? 0.1 : 0;
}

export function median(values: number[]): number {
  if (values.length === 0) return 1;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
