# 핫딜 허브 기획 v1.1 (변경 요약)

기획서 v1(PDF 21p)에서 **바뀐 부분만** 정리한다. 변경 근거는 `DECISIONS.md`의 D-번호를 따른다.
바뀌지 않은 섹션(출처 정책, 색인 구조, 백링크 원칙, 운영 원칙)은 v1 그대로 유효하다.

## §1 사이트 정의 (D-01)

- 한 줄 정의: **상품권 상테크 정보를 커뮤니티 핫딜에서 모아 한눈에 보여주는 정보 허브**.
- 제공 가치: 지금 어느 판매처에서 어떤 카드로 얼마에 살 수 있는지, 1인 한도는 얼마인지, 같은 조건이 몇 주째 반복되는지, 현재 시세와 비교하면 얼마나 싼지.
- 하지 않는 것: 상품권 판매·중개, 매도 유도, 현금화 수익 계산.

## §4-3 지표 정의 (D-01)

| 지표 | 정의 | 표시 조건 |
|---|---|---|
| 할인율 | `(1 - sale_price / face_value) × 100` | 모든 딜 |
| 실구매가 | 카드 즉시할인·청구할인 반영 후 가격 | 카드 조건이 있는 딜 |
| 시세 대비 할인 폭 | `buy_rate - (sale_price / face_value × 100)` (%p) | 시세 데이터가 있는 브랜드. 설명 문구: "현재 매입 시세보다 N%p 낮은 가격" |
| 반복 주차 | 같은 `brand|merchant|face_value|sale_price` 조합이 등장한 최근 8주 중 주 수 | 모든 딜 |

"구매 → 매도" 흐름을 한 화면에서 유도하는 문구와 CTA는 두지 않는다. "보유 상품권 시세 확인" 링크는 정보 제공 목적으로 상세 하단에만 둔다.

## §5-1 중복 처리 (D-02)

```
dedupe_key = f"{brand}|{merchant}|{face_value}|{sale_price}|{iso_week}"
iso_week   = first_seen(KST) 기준 ISO 8601 주차, 예: 2026-W44
```

- 같은 주차 안에서 여러 커뮤니티에 올라온 동일 조건 글은 하나의 딜로 병합하고 `sources[]`에 출처를 누적한다.
- 주차가 바뀌면 새 딜이 된다. 상세 페이지에 "지난 N주 동안 같은 조건 딜 목록"을 함께 표시한다.
- 일별 가격 이력은 `deal_prices(deal_id, date, sale_price, buy_rate)`에 하루 1행씩 쌓는다.

## §5-4 점수 산식 (D-10)

```
rel_votes = votes / median_votes_7d(source)
score     = w1 × log1p(rel_votes) + w2 × log1p(comments / median_comments_7d(source))
          + w3 × discount_rate + w4 × recency_decay(hours)
```

가중치 초기값 `w = (0.35, 0.15, 0.35, 0.15)`. 운영 2주 후 보정.

## §7-3 제휴 (D-05)

- Phase 1~2에서는 제휴 링크를 사용하지 않는다.
- 데이터 모델에 `affiliate_url`, `is_affiliate` 필드를 두고, 템플릿에 제휴 라벨·상단 고지·푸터 고지 컴포넌트를 준비한다. `site.config.json`의 `affiliate.enabled=false`가 기본.
- 켤 때의 고지 위치: 딜 카드·CTA 옆 "제휴 링크" 라벨, 상세 상단 1줄, 푸터 의무 문구.

## §10 외부 연계 (D-04)

v1 §10-3 "네트워크 위젯"은 폐기한다. 대신:

- **공개 피드**: `GET /api/deals.json`, `GET /api/brands/{slug}.json`, `GET /api/weekly/{YYYY-Www}.json`. CORS 허용, 15분 캐시, 응답에 `source: {name, url}` 포함.
- **임베드 위젯**: `/embed/{slug}` iframe 또는 `<script>` 스니펫. 출처 링크를 위젯 안에 고정 표시.
- **이용 조건 페이지**: 출처 표기 필수, 재판매 금지, 호출 제한 안내.
- 외부 데이터(모두의시세 rates.json)를 가져올 때는 해당 수치 옆에 "시세 출처: 모두의시세" 1줄 표기.

## §11 기술 스택 (D-06, D-08, D-09)

| 구성 | v1 | v1.1 |
|---|---|---|
| 수집 | GitHub Actions 30분 Cron, Python | **Cloudflare Workers Cron 1분**, TypeScript |
| 저장 | `data/deals.json` git 커밋 | **Cloudflare D1** |
| 피드 API | 정적 JSON 빌드 산출물 | **Workers 라우트**(D1 실시간 조회) |
| 페이지 | 정적 HTML, Tailwind CDN | 정적 HTML, **Tailwind CLI 빌드** |
| 배포 | Actions → Pages | Actions(코드 변경 시) → Pages. 데이터는 Workers가 담당 |
| 알림 | 텔레그램 | 텔레그램(Workers에서 발행, 실패해도 수집 계속) |

예상 비용: Workers Paid $5/월(D1 포함량 내), Pages 무료, 도메인 연 1.5만원 안팎.

## §11-3 운영 가드 (D-03)

| 가드 | 기준 | 동작 |
|---|---|---|
| 수집 급감 | 활성 딜 수가 직전 스냅샷 대비 `GUARD_MIN_ACTIVE_RATIO`(기본 0.5) 미만 | 스냅샷 갱신 중단, 운영 알림 |
| 갱신 지연 | `last_updated`가 `GUARD_STALE_HOURS`(기본 2) 초과 | 사이트 상단 배너 자동 표시 |
| 소스 차단 | 같은 소스 연속 `CB_FAIL_THRESHOLD`(기본 5)회 실패 | 해당 소스 `CB_COOLDOWN_MIN`(기본 60)분 일시 중지 |
| 알림 실패 | 텔레그램 발행 오류 | 로그만 남기고 계속 |

## §12 페이지 구성 (D-07, D-11)

- 홈, 브랜드 허브(1급 색인), 딜 상세, **주차별 비교/아카이브**, 소개·출처 정책·외부 제공 안내.
- 종료 30일 지난 딜: 개별 페이지 생성 중단(410), 주차 아카이브에서만 조회.
- 종료 딜 상세: 구매 버튼 비활성화 → "같은 브랜드 진행 중 딜 보기".

## 로드맵

| Phase | 범위 | 기간 |
|---|---|---|
| 0 | 저장소 구조, 결정 기록, 소스·브랜드·토큰 정의, D1 스키마 | 1~2일 |
| 1 | 수집 Worker(RSS 3 + HTML 1), 제목 파서, dedupe, 서킷 브레이커, 공개 API | 3~5일 |
| 2 | 사이트 템플릿·빌드, 상테크 UI, SEO, 가드 배너, 제휴 컴포넌트(off) | 5~7일 |
| 3 | Pages 배포, 도메인, 임베드 위젯, 점수 보정 | 2일 |
