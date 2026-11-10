import { describe, it, expect } from "vitest";
import { computeScore } from "../src/score";

const base = { votes: 10, comments: 4, medianVotes: 5, medianComments: 2, discountRate: 8, hoursSinceFirstSeen: 6 };

describe("computeScore: 등장 커뮤니티 수", () => {
  it("한 곳이거나 값이 없으면 기존 점수와 같다", () => {
    const s = computeScore(base);
    expect(computeScore({ ...base, sourceCount: 1 })).toBe(s);
    expect(computeScore({ ...base, sourceCount: 0 })).toBe(s);
  });
  it("두 곳이면 +0.1", () => {
    expect(computeScore({ ...base, sourceCount: 2 })).toBeCloseTo(computeScore(base) + 0.1, 4);
  });
  it("세 곳 이상이면 +0.2", () => {
    expect(computeScore({ ...base, sourceCount: 3 })).toBeCloseTo(computeScore(base) + 0.2, 4);
    expect(computeScore({ ...base, sourceCount: 5 })).toBeCloseTo(computeScore(base) + 0.2, 4);
  });
});
