# 핫딜 허브 (상품권 상테크 정보 허브)

커뮤니티(뽐뿌·클리앙·루리웹·퀘이사존)의 상품권 핫딜을 1분 단위로 모아 **카드 조건, 1인 한도, 할인율, 반복 주차, 시세 대비 할인 폭**을 정리해 보여주는 정보 사이트.
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
│  ├─ brands.json             상품권 브랜드·판매처·카드사 별칭
│  ├─ design-tokens.json      색상·서체·간격 토큰
│  └─ site.config.json        사이트명·URL·제휴(off)·가드 기준값
├─ worker/                    Cloudflare Workers (수집 Cron 1분 + 공개 API) + D1
│  ├─ wrangler.toml           바인딩·vars·cron
│  ├─ schema.sql              D1 스키마
│  ├─ src/
│  │  ├─ index.ts             fetch(API) / scheduled(Cron) 진입점
│  │  ├─ collect.ts           수집 파이프라인(가드·서킷브레이커·점수)
│  │  ├─ parse.ts             제목 → 브랜드/판매처/액면가/판매가/카드/한도
│  │  ├─ dedupe.ts            ISO 주차 버킷 dedupe_key
│  │  ├─ api.ts               /api/deals.json 등 공개 피드
│  │  ├─ fetchers/            rss.ts, quasarzone.ts, http.ts(EUC-KR 대응)
│  │  ├─ guards.ts, score.ts, rates.ts, notify.ts
│  └─ test/                   vitest (파서·dedupe·RSS) + fixtures
├─ site/                      정적 사이트 (Tailwind CLI 빌드 → Cloudflare Pages)
│  ├─ scripts/build.mjs       API → HTML 빌드 (API 실패 시 빌드 중단)
│  ├─ templates/              index.html + partials(헤더·푸터·딜 카드·배너·제휴고지)
│  ├─ src/styles/input.css    Tailwind 진입 CSS
│  ├─ src/js/site.js          메뉴·필터·갱신지연 배너
│  └─ data/sample.deals.json  샘플 데이터(개발용)
└─ .github/workflows/         ci.yml, deploy-worker.yml, deploy-site.yml
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
npm run db:migrate:local      # 로컬 D1에 스키마 적용
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

## 배포 절차 (계정 작업은 직접 수행)

1. **Cloudflare**: Workers Paid 결제 → `cd worker && npm run db:create` → 출력된 `database_id`를 `wrangler.toml`에 기입 → `npm run db:migrate:remote` → `npx wrangler secret put TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` → `npm run deploy`.
2. **Pages**: Cloudflare 대시보드에서 Pages 프로젝트 생성(Direct Upload).
3. **GitHub**: Settings → Secrets에 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, (선택) `TELEGRAM_*`; Variables에 `CF_PAGES_PROJECT`, `API_BASE`(Worker URL).
4. `shared/site.config.json`과 `worker/wrangler.toml`의 `REPLACE_*` 값을 실제 값으로 교체.
5. `main`에 push → `deploy-worker.yml`, `deploy-site.yml` 자동 실행. 최초 1회는 Actions에서 `Deploy Site`를 `allow_empty=true`로 수동 실행해 샘플 데이터로 올릴 수 있음.

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

## 아직 안 된 것 (Phase 2~3)

- 브랜드 허브·딜 상세·주간 비교·소개/출처 정책/데이터 제공 페이지 템플릿
- 임베드 위젯(`/embed/{slug}`)
- hotdeal.zip 구조 분석 반영, 소스별 RSS 실존 확인(이 환경은 네트워크 차단)
- 에펨코리아 파서, 파싱 실패 큐의 LLM 보조 파싱
- 사이트명·도메인·운영자 정보 확정 (`REPLACE_*`)
