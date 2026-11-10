import { describe, it, expect } from "vitest";
import { parseProductTitle, isClosedTitle } from "../src/parse-product";

// 제목은 모두 지어낸 것이다(실제 커뮤니티 글이나 벤치마킹 자료에서 복사하지 않음).
const p = (title: string) => parseProductTitle({ source: "ppomppu", postId: "1", url: "https://example.test/1", title });

describe("parseProductTitle: 뽐뿌·루리웹 관례", () => {
  it("[쇼핑몰] 상품명 (가격/배송비)", () => {
    const d = p("[쿠팡] 제주 삼다수 2L 12개 (9,900원/무료)")!;
    expect(d.merchant).toBe("coupang");
    expect(d.merchantRaw).toBeNull();
    expect(d.salePrice).toBe(9900);
    expect(d.priceKind).toBe("exact");
    expect(d.shipping).toBe("무료");
    expect(d.productName).toBe("제주 삼다수 2L 12개");
    expect(d.tokens).toEqual(["12개", "2l", "삼다수", "제주"]);
    expect(d.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("[쇼핑몰] 상품명 (가격) (배송비) + 카드 조건", () => {
    const d = p("[11번가] 무선 청소기 V12 (199,000원) (무료배송) 신한카드 7% 즉시할인")!;
    expect(d.merchant).toBe("11st");
    expect(d.salePrice).toBe(199000);
    expect(d.shipping).toBe("무료");
    expect(d.cardIssuers).toEqual(["shinhan"]);
    expect(d.cardBenefit).toBe("신한카드 7% 즉시할인");
    expect(d.paymentNote).toBe("즉시할인");
  });

  it("사전에 없는 판매처는 원문 표기를 보존한다", () => {
    const d = p("[하프클럽] 겨울 패딩 조끼 (29,900원/2,500원)")!;
    expect(d.merchant).toBeNull();
    expect(d.merchantRaw).toBe("하프클럽");
    expect(d.salePrice).toBe(29900);
    expect(d.shipping).toBe("2,500원");
    expect(d.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("새 판매처(토스쇼핑)는 토스가 아니라 토스쇼핑으로 잡는다", () => {
    const d = p("[토스쇼핑] 핸드크림 3종 세트 (5,900원/무배)")!;
    expect(d.merchant).toBe("tossshopping");
    expect(d.shipping).toBe("무료");
  });

  it("끝 괄호에 가격이 없으면 본문의 마지막 금액을 쓴다", () => {
    const d = p("[쿠팡] 건전지 AA 20개 4,990원 (와우무료)")!;
    expect(d.salePrice).toBe(4990);
    expect(d.shipping).toBe("조건부 무료");
    expect(d.productName).toBe("건전지 AA 20개");
  });

  it("상품명 속 괄호는 남긴다", () => {
    const d = p("[지마켓] 휴대폰 케이스 (블랙) (7,900원/무료)")!;
    expect(d.productName).toBe("휴대폰 케이스 (블랙)");
    expect(d.salePrice).toBe(7900);
  });
});

describe("parseProductTitle: 클리앙 관례", () => {
  it("상품명 (쇼핑몰/가격/배송)", () => {
    const d = p("무선 이어폰 프로 2세대 (네이버/249,000원/무료)")!;
    expect(d.merchant).toBe("naver");
    expect(d.salePrice).toBe(249000);
    expect(d.shipping).toBe("무료");
    expect(d.productName).toBe("무선 이어폰 프로 2세대");
  });

  it("쉼표·원 없는 숫자도 슬래시 묶음 안에서는 가격으로 읽는다", () => {
    const d = p("기계식 키보드 87키 (옥션/45900/3000)")!;
    expect(d.merchant).toBe("auction");
    expect(d.salePrice).toBe(45900);
    expect(d.shipping).toBe("3,000원");
  });
});

describe("parseProductTitle: 가격 종류", () => {
  it("가격다양은 서술형 가격으로 받는다", () => {
    const d = p("[지마켓] 캠핑 의자 모음전 (가격다양/무료)")!;
    expect(d.priceKind).toBe("descriptive");
    expect(d.priceText).toBe("가격다양");
    expect(d.salePrice).toBeNull();
    expect(d.shipping).toBe("무료");
    expect(d.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("괄호에 무료만 있으면 가격이 무료다", () => {
    const d = p("[스팀] 인디 게임 번들 (무료)")!;
    expect(d.merchant).toBe("steam");
    expect(d.priceKind).toBe("descriptive");
    expect(d.priceText).toBe("무료");
    expect(d.shipping).toBeNull();
  });

  it("외화 가격은 서술형으로 두고 말머리는 판매처로 쓰지 않는다", () => {
    const d = p("[해외] 블루투스 스피커 미니 ($29/무료)")!;
    expect(d.merchant).toBeNull();
    expect(d.merchantRaw).toBeNull();
    expect(d.priceKind).toBe("descriptive");
    expect(d.priceText).toBe("$29");
    expect(d.shipping).toBe("무료");
  });

  it("용량·모델 숫자를 가격으로 읽지 않는다", () => {
    const d = p("[옥션] 갤럭시 S25 256GB 자급제 (1,099,000원/무료)")!;
    expect(d.salePrice).toBe(1099000);
    expect(d.productName).toBe("갤럭시 S25 256GB 자급제");
  });

  it("가격 표기가 없으면 신뢰도가 0.5 미만이다", () => {
    const d = p("[롯데온] 2025년형 김치냉장고 1+1 행사")!;
    expect(d.salePrice).toBeNull();
    expect(d.priceKind).toBeNull();
    expect(d.confidence).toBeLessThan(0.5);
  });

  it("범위(100원~5,000만원) 밖 금액은 가격으로 쓰지 않는다", () => {
    const d = p("[쿠팡] 볼펜 한 자루 (50원/무료)")!;
    expect(d.salePrice).toBeNull();
    expect(d.priceKind).toBeNull();
    expect(d.confidence).toBeLessThan(0.5);
    expect(p("[쿠팡] 건물 한 채 (9,900,000,000원/무료)")!.salePrice).toBeNull();
  });

  it("만 단위 표기를 읽는다", () => {
    expect(p("[하이마트] 55인치 TV (59.9만원/무료)")!.salePrice).toBe(599000);
  });
});

describe("parseProductTitle: 기타", () => {
  it("한도와 할인율을 뽑는다", () => {
    const d = p("[쿠팡] 라면 20봉 (11,900원/무료) 1인 2개 30% 할인")!;
    expect(d.limitPerPerson).toBe("1인 2개");
    expect(d.discountRate).toBe(30);
  });
  it("상품명이 너무 짧으면 null", () => {
    expect(p("ㅁ")).toBeNull();
    expect(p("[쿠팡] (9,900원/무료)")).toBeNull();
  });
});

describe("isClosedTitle", () => {
  it("말머리·괄호의 종료 표시를 알아본다", () => {
    expect(isClosedTitle("[종료] [쿠팡] 삼다수 (9,900원/무료)")).toBe(true);
    expect(isClosedTitle("[품절] 무선 이어폰")).toBe(true);
    expect(isClosedTitle("무선 이어폰 (품절)")).toBe(true);
    expect(isClosedTitle("(종료) 삼다수 2L")).toBe(true);
    expect(isClosedTitle("[쿠팡] 삼다수 (9,900원/무료) [판매종료]")).toBe(true);
  });
  it("본문 속 낱말은 종료 표시로 보지 않는다", () => {
    expect(isClosedTitle("마감된 딜입니다 삼다수")).toBe(false);
    expect(isClosedTitle("[쿠팡] 품절 대란 났던 그 라면 (9,900원/무료)")).toBe(false);
    expect(isClosedTitle("[쿠팡] 삼다수 (9,900원/무료)")).toBe(false);
  });
});
