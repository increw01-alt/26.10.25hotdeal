# 핫딜 허브 (커뮤니티 핫딜 + 쇼핑몰별 카드 혜택)

커뮤니티(뽐뿌·클리앙·루리웹)의 핫딜을 1분 단위로 모아 **판매처, 가격, 배송비, 카드 조건**과 **그 쇼핑몰에서 혜택을 주는 카드**를 함께 보여주는 정보 사이트.
딜은 일반 상품 핫딜(`kind = product`)과 상품권 딜(`kind = gift`) 두 가지이며(D-18), 상품권 딜은 1인 한도, 할인율, 반복 주차, 시세 대비 할인 폭까지 비교한다.
외부 사이트가 가져다 쓸 수 있는 **공개 피드 API**도 함께 제공한다.

- 기획 검토: [`docs/REVIEW-plan-v1.md`](docs/REVIEW-plan-v1.md)
- 확정 결정: [`docs/DECISIONS.md`](docs/DECISIONS.md) (기획서 v1과 충돌 시 이 문서 우선)
- v1.1 변경 요약: [`docs/PLAN-v1.1.md`](docs/PLAN-v1.1.md)

## 폴더 구조

```
26.10.25hotdeal/
├─ docs/                      기획 검토·결정 기록
├─ shared/                    단일 출처 데이터 (worker·site 공용)
│  ├─ sources.json            커뮤니티 소스 정의(RSS/HTML, 확인일)
│  ├─ brands.json             상품권 브랜드·판매처(product_only = 일반 딜 전용)·카드사 별칭
│  ├─ design-tokens.json      색상·서체·간격 토큰
│  ├─ cards.json              쇼핑몰별 카드 혜택(카드사 공식 페이지로 확인한 카드만, D-17)
│  └─ site.config.json        사이트명·URL·제휴(off)·가드 기준값
├─ scripts/                   배포 전 검사·조사 도구
│  ├─ check-config.mjs        REPLACE_ 플레이스홀더 검사
│  ├─ check-cards.mjs         cards.json 검사 (lib/cards-schema.mjs, test/)
│  └─ research/               카드 비교 사이트 크롤에서 후보 추출 (결과는 저장소 밖)
├─ worker/                    Cloudflare Workers (수집 Cron 1분 + 공개 API) + D1
│  ├─ wrangler.toml           바인딩·vars·cron
│  ├─ migrations/             D1 마이그레이션 (D-21, wrangler d1 migrations apply)
│  ├─ schema.sql              D1 스키마 전체 스냅샷(참고용)
│  ├─ src/
│  │  ├─ index.ts             fetch(API) / scheduled(Cron) 진입점
│  │  ├─ collect.ts           수집 파이프라인(가드·서킷브레이커·점수)
│  │  ├─ route.ts             글 한 건의 갈래 판정(상품권·일반·닫힘·큐)
│  │  ├─ parse.ts             상품권 제목 → 브랜드/판매처/액면가/판매가/카드/한도
│  │  ├─ parse-product.ts     일반 딜 제목 → 판매처/상품명/가격/배송비
│  │  ├─ group.ts             같은 상품 묶기(토큰 Jaccard, D-19)
│  │  ├─ dedupe.ts            ISO 주차 버킷 dedupe_key
│  │  ├─ api.ts               /api/deals.json 등 공개 피드
│  │  ├─ fetchers/            rss.ts, quasarzone.ts, http.ts(EUC-KR 대응)
│  │  ├─ guards.ts, score.ts, rates.ts, notify.ts
│  └─ test/                   vitest (파서·dedupe·RSS) + fixtures
├─ site/                      정적 사이트 (Tailwind CLI 빌드 → Cloudflare Pages)
│  ├─ scripts/build.mjs       API → HTML 빌드 (API 실패 시 빌드 중단)
│  ├─ scripts/lib/card-benefits.mjs  딜 상세 카드 섹션·/cards/ 페이지·api/cards.json 렌더링 (test/)
│  ├─ scripts/lib/deals.mjs   홈 선택·쪽 나누기·일반 딜 보존 판정 (test/)
│  ├─ templates/              index.html, deals.html, deal.html(상품권), product-deal.html(일반), cards.html + partials
│  ├─ src/styles/input.css    Tailwind 진입 CSS
│  ├─ src/js/site.js          메뉴·필터·갱신지연 배너
│  └─ data/sample.*.json      샘플 데이터(개발용)
├─ .github/workflows/         ci.yml, deploy-worker.yml, deploy-site.yml
```

## 스택과 비용 (D-09)

| 구성 | 기술 | 비용 |
|---|---|---|
| 수집·API | Cloudflare Workers (Cron `* * * * *`) + D1 | Workers Paid $5/월 (D1 포함량 내) |
| 사이트 | 정적 HTML + Tailwind CLI → Cloudflare Pages | 무료 |
| 배포 | GitHub Actions (코드 변경 시) | 무료 범위 |

## 로컬 실행

필요: Node 22+, npm. Windows는 PowerShell, WSL2 Ubuntu는 bash 기준 동일.

```bash
git clone https://github.com/increw01-alt/26.10.25hotdeal.git
cd 26.10.25hotdeal

# 1) Worker
cd worker
npm install
npm test                      # 파서·dedupe·RSS 테스트
npm run typecheck
npm run db:migrate:local      # 로컬 D1에 마이그레이션 적용 (worker/migrations)
npx wrangler dev --test-scheduled --var DEV_INGEST:true
#   http://localhost:8787/health
#   http://localhost:8787/api/deals.json
#   curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"     ← Cron 1회 실행
#   네트워크 없이 파서 검증(개발용 주입):
#   curl -X POST -H "content-type: application/json" --data @test/fixtures/posts.sample.json http://localhost:8787/__dev/ingest

# 2) Site
cd ../site
npm install
node scripts/build.mjs --sample && npm run build:css   # dist/ 생성 (샘플 데이터)
npx serve dist                                          # http://localhost:3000
```

## 배포 절차

자세한 단계는 [`docs/DEPLOY.md`](docs/DEPLOY.md). 요약:

1. **Cloudflare 초기화(한 번)**: `powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflare.ps1` (WSL/macOS는 `bash scripts/setup-cloudflare.sh`). D1 생성·스키마·Worker 배포·Pages 프로젝트·첫 배포까지 자동.
2. **설정값**: `shared/site.config.json`, `worker/wrangler.toml`의 `REPLACE_*`를 실제 값으로 교체. `node scripts/check-config.mjs`로 확인(배포 워크플로가 같은 검사를 먼저 돌린다).
3. **GitHub**: Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; Variables `CF_PAGES_PROJECT`, `API_BASE`.
4. `main`에 push → `deploy-worker.yml`, `deploy-site.yml` 자동 실행. 사이트는 매시 7분에도 재빌드.
5. (선택) 커스텀 도메인: Pages Custom domains + `wrangler.toml`의 `routes` 주석 해제.

## 공개 피드 API (D-04)

| 경로 | 설명 |
|---|---|
| `GET /api/deals.json?limit=50&status=active&brand=cultureland&sort=score` | 딜 목록 (status: active/live/ending/ended, sort: score/recent/discount) |
| `GET /api/brands.json` | 브랜드 목록 |
| `GET /api/brands/{slug}.json` | 브랜드별 딜 |
| `GET /api/weekly/{YYYY-Www}.json` | 주차별 딜(브랜드별 묶음) |
| `GET /api/deals/{id}.json` | 딜 상세(출처 글, 일별 가격, 과거 반복 주차) |
| `GET /api/status.json` | 마지막 갱신·가드·소스 상태 |

CORS 허용, 15분 캐시, 응답에 `source`(출처 표기용) 포함. 이용 조건 페이지는 Phase 2에서 `/open-data/`에 추가.

## 사이트 페이지 (Phase 2 완료)

| 경로 | 템플릿 | 비고 |
|---|---|---|
| `/` | `index.html` | 히어로, 필터, 점수순 딜 카드 |
| `/brands/`, `/brands/{slug}/` | `brands-index.html`, `brand.html` | 브랜드 허브(1급 색인). 진행 중·자주 보이는 조건·8주 흐름·지난 딜·FAQ(FAQPage JSON-LD) |
| `/deal/{id}/` | `deal.html` | 조건·일별 가격·과거 반복·출처 글. 종료 딜은 noindex + 구매 버튼 비활성화(D-11). 종료 30일 후 미생성(D-07) |
| `/weekly/`, `/weekly/{YYYY-Www}/` | `weekly-index.html`, `weekly.html` | 최근 8주 비교·아카이브(D-02) |
| `/about/` | `about.html` | 소개·출처 정책·제외 요청·정확성·제휴 안내 |
| `/open-data/` | `open-data.html` | 피드 문서·이용 조건·임베드 코드·미리보기(D-04) |
| `/embed/`, `/embed/{slug}/`, `/embed.js` | `embed.html`, `src/js/embed.js` | iframe/script 임베드 위젯. noindex |
| `404.html` | `404.html` | 만료 딜 안내 |

빌드 산출물에는 `sitemap.xml`, `robots.txt`, `_headers`(CORS·캐시), `/api/deals.json` 정적 사본이 포함된다.

## 임베드 위젯 (Phase 3 완료)

- 스크립트: `<div data-hotdeal-widget data-brand="cultureland" data-limit="5" data-theme="light|dark|auto" data-compact></div><script async src="https://<SITE>/embed.js"></script>`
- iframe: `https://<SITE>/embed/{slug}/?limit=5&theme=dark&compact=1`. 부모 창에 `hotdeal-widget:height` 메시지로 높이를 알린다.
- `/open-data/`에 옵션 선택형 코드 생성기와 라이브 미리보기.

## 아직 안 된 것

- hotdeal.zip 구조 분석 반영, 소스별 RSS 실존 확인(이 환경은 네트워크 차단)
- 에펨코리아 파서, 파싱 실패 큐의 LLM 보조 파싱
- 사이트명·도메인·운영자 정보 확정 (`REPLACE_*`)
