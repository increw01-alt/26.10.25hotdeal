# 결정 기록 (Decision Log)

기획서 v1 검토 메모(`REVIEW-plan-v1.md`)의 항목별로 2026-10-26 협의에서 확정한 내용.
이 문서가 기획서 v1과 충돌하면 이 문서가 우선한다.

| # | 항목 | 결정 | 반영 위치 |
|---|---|---|---|
| D-01 | A-1 핵심 지표 프레임 | 사이트 정체성은 **상테크(상품권+재테크) 정보 허브**. 현금화 계산기가 아님. 지표명은 "시세 대비 할인 폭"으로 바꾸되 **카드 조건 딜에서도 지표를 표시한다**(카드사 혜택이 핵심 정보). 제거하는 것은 "구매 → 매도"를 한 화면에서 유도하는 CTA 흐름뿐. 카드 조건·판매처 정책·한도·유효기간을 1급 필드로 둔다. | `worker/schema.sql` deals 테이블, `shared/brands.json` |
| D-02 | A-2 dedupe 시간 창 | **ISO 주차 버킷 방식**. `dedupe_key = brand|merchant|face_value|sale_price|YYYY-Www`. 일 단위 비교는 `deal_prices` 일별 이력 테이블로 처리. | `worker/src/dedupe.ts` |
| D-03 | A-3 배포 가드 | 세 가지 안전장치 모두 적용. 기준값(활성 딜 50%, 갱신 지연 2시간)은 설정값으로 분리. 알림 단계는 실패해도 배포를 막지 않음. | `worker/src/guards.ts`, `.github/workflows/deploy-site.yml` |
| D-04 | A-4 네트워크 위젯 | **독립 사이트**로 제작. 모두의시세 페이지에 위젯을 심는 설계(§10-3)는 폐기. 대신 새 사이트가 **정보 제공자**가 되어 모두의시세·한국상품권협회 등 외부 사이트가 가져다 쓸 수 있는 공개 피드와 임베드 위젯을 제공한다. 외부 데이터(시세)를 가져올 때는 출처 1줄 표기. | `worker/src/api.ts`, `docs/PLAN-v1.1.md` §10 |
| D-05 | A-5 제휴 고지 | **쿠팡 파트너스는 사이트 완성 후 검토**. 지금은 가능성만 열어둔다. `affiliate` 필드와 라벨·상단 고지 컴포넌트는 만들되 기본값 off. | `site/templates/partials/affiliate-notice.html`, `shared/site.config.json` |
| D-06 | B-1 데이터 커밋 | git에 데이터를 커밋하지 않는다. 딜 데이터는 **Cloudflare D1**에 저장. | 스택 전환(D-09) |
| D-07 | B-2 Pages 한도 | 종료 30일 지난 딜은 개별 페이지 생성 중단(Pages `_redirects`가 410을 지원하지 않아 404 페이지에서 아카이브로 안내). 과거 딜은 **주차별 아카이브 페이지**로 묶음. 종료 딜 상세는 noindex. 배포 명령에 `--branch=main` 명시. | `site/scripts/build.mjs` |
| D-08 | B-3 Tailwind | Phase 1부터 **Tailwind CLI 빌드**. CDN 사용 안 함. | `site/package.json` |
| D-09 | 스택 | **Cloudflare Workers(Cron 1분) + D1 + Pages**. GitHub Actions는 코드 변경 시 빌드·배포만 담당. 수집은 Workers Cron이 담당. 예상 비용 월 $5(Workers Paid) + 도메인. | `worker/wrangler.toml` |
| D-10 | B-4 점수 정규화 | 소스별 최근 7일 추천 수 중앙값으로 나눈 상대값을 `log1p()`에 넣는다. 운영 2주 후 실제 데이터로 보정. | `worker/src/score.ts` |
| D-11 | B-5 종료 딜 CTA | 종료 딜은 구매 버튼 비활성화, "같은 브랜드 진행 중 딜 보기"로 대체. | `site/templates/deal.html` |
| D-12 | B-6 blocklist | 저장소에는 게시글 ID·소스·반영일만. 요청자 정보는 비공개 보관. | `worker/schema.sql` blocklist 테이블 |
| D-13 | B-7 secrets | 공개 URL은 `vars`, 토큰·키만 `secrets`. | `worker/wrangler.toml` |
| D-14 | B-8 FAQ 스키마 | FAQPage JSON-LD는 넣되 리치결과 노출은 기대하지 않음. 본문 FAQ는 콘텐츠로 유지. | `site/templates/brand.html` |
| D-15 | 소스 우선순위 | 1차: 뽐뿌·클리앙·루리웹(RSS), 퀘이사존(HTML). 2차: 에펨코리아(차단 여부 확인 후). 제목 파싱은 정규식 1차, 실패 건만 LLM. | `shared/sources.json` |
| D-16 | 참고 사이트 (2026-11-10 마감) | hotdeal.zip 구조 분석 완료. **반영한 것**: 가격 종류 구분(`price_kind` = exact / descriptive), 판매처 사전을 실측 상위 판매처 순으로 확장, 카테고리 열(`product_category`, 값은 이후 단계). **따라 하지 않는 것**: 그쪽 API·데이터를 수집원으로 쓰는 것, 썸네일 복제, 제휴 링크 구조, 글 본문·이동 주소 기반 판매처 판별(우리는 제목과 링크만 수집). 분석 자료는 저장소 밖에 보관하고 코드·응답·이미지를 저장소와 사이트에 넣지 않는다(D-17과 같은 원칙). | 스펙 `docs/superpowers/specs/2026-11-10-general-hotdeals-design.md` |
| D-17 | 카드 혜택 데이터 (2026-10-28) | 카드사 **공식 페이지로 확인한 카드만 공개**(`status=verified`, 공식 출처 URL·확인일 필수, 60일 지나면 "재확인 필요" 표시). 제3자 카드 비교 사이트의 문구·이미지·링크는 조사용으로만 쓰고 저장소·사이트에 넣지 않는다. 카드 신청 링크·수수료 없음(모집 아님). 상품권 구매 적용 여부(`giftcard`)는 반드시 명시한다. | `shared/cards.json`, `scripts/check-cards.mjs`, `site/scripts/lib/card-benefits.mjs`, 스펙 `docs/superpowers/specs/2026-10-28-card-benefits-design.md` |
| D-18 | 일반 핫딜 수집 (2026-11-10) | 같은 커뮤니티 글에서 상품권이 아닌 **일반 상품 핫딜도 저장**한다. 딜은 `kind = gift | product`로 나눈다. 소스는 그대로(뽐뿌·뽐뿌 쿠폰게시판·클리앙·루리웹, 쿠폰게시판은 상품권만). 일반 딜은 **전부 저장**하고 홈은 **전체 딜이 기본**(점수순 상위 60건 + 진행 중 상품권 전부, 탭으로 상품권만·일반만), 전체는 `/deals/`에서 최신순으로 넘겨 본다. 상품권 판정·dedupe 키·식별자는 1단계와 같다(새 판매처 28곳은 `product_only`라 상품권 파서가 보지 않는다). 적립·추첨 이벤트 글과 가격 표기가 없는 글은 일반 딜로 받지 않는다. 일반 딜은 12시간 미관측이면 종료 임박, 24시간이면 종료(상품권은 24/48시간 그대로). 글 제목에 품절·종료 표시가 붙으면 그 글만 닫고, 연결된 글이 모두 닫히면 딜을 종료한다. 점수에 등장 커뮤니티 수 항을 더한다(2곳 +0.1, 3곳 이상 +0.2). 공개 API `/api/deals.json`의 **기본값은 전체**(`kind=all`)로 바뀌고 `kind`·`merchant`·`offset`을 받는다(`limit` 상한 500). 주간 비교·브랜드 허브·임베드 위젯은 상품권 전용으로 남는다. | `worker/src/route.ts`, `parse-product.ts`, `collect.ts`, `api.ts`, `shared/brands.json`, `shared/sources.json`, `site/scripts/build.mjs` |
| D-19 | 같은 상품 묶기 (2026-11-10) | 목적은 완벽한 상품 식별이 아니라 **같은 글이 여러 커뮤니티에 올라온 것**을 잡는 것. ① 같은 커뮤니티 글(`source`, `post_id`)은 처음 연결된 딜에 남는다(제목이 바뀌어도 새 딜을 만들지 않는다). ② 새 글은 **같은 주차·같은 판매처(slug, 없으면 정규화한 원문 표기)·같은 가격**의 진행 중 일반 딜 가운데 제목 토큰 Jaccard 유사도가 **0.5 이상**인 것 중 가장 높은 딜에 붙인다. ③ 없으면 새 딜: `product|판매처키|가격|토큰 해시|주차`, 식별자는 키의 SHA-1 앞 16자. ④ 판매처를 모르는 글과 서술형 가격 글은 토큰이 완전히 같을 때만 묶인다. ⑤ 가격이 다르면 다른 딜이다(가격 변동 추적은 이후 단계). 기준값 0.5는 **운영 2주 뒤(2026-11-24 무렵)** 실제로 묶인 결과를 보고 조정한다. 상품권 딜의 dedupe(D-02)는 바꾸지 않는다. | `worker/src/group.ts`, `worker/src/collect.ts` |
| D-20 | 일반 딜 상세·카드 혜택 표시 (2026-11-10) | 일반 딜 상세 페이지는 **종료 후 3일까지만** 만든다(상품권은 D-07의 30일 그대로, Pages 파일 한도 20,000개 대비). 3일이 지난 일반 딜을 가리키는 사이트 내부 링크는 `/deals/product/`로 걸고, 밖에서 들어온 옛 주소는 404 안내 페이지가 받는다(리다이렉트 없음). 일반 딜 상세의 "{판매처} 카드 혜택" 섹션은 그 판매처의 확인된 카드를 **전부 본문 목록**으로 보여 주고(혜택률 높은 순) **상품권 칩(적용/제외/미확인)을 붙이지 않는다**: 일반 결제에는 해당 없는 정보라, 붙이면 혜택이 없는 것처럼 읽힌다. 판매처가 사전에 없으면 원문 표기로 "아직 카드 혜택 표에 없습니다"라고 알린다. 상품권 딜의 카드 섹션은 1단계 그대로다. | `site/scripts/lib/card-benefits.mjs`, `site/scripts/lib/deals.mjs`, `site/templates/product-deal.html`, `shared/site.config.json` |
| D-21 | D1 스키마 변경 방식 (2026-11-10) | 스키마 변경은 **wrangler D1 마이그레이션 파일**(`worker/migrations/NNNN_*.sql`)로 한다. 적용 여부를 DB 안의 기록표로 관리하므로 한 번만 실행된다(`ALTER TABLE ADD COLUMN`은 두 번 실행하면 실패한다). `0001_init.sql`은 기존 스키마 그대로(`CREATE TABLE IF NOT EXISTS`)라 운영 DB에서는 아무것도 바꾸지 않는다. `worker/schema.sql`은 참고용 전체 스냅샷으로 함께 갱신한다. 배포 워크플로와 `npm run db:migrate:*`는 `wrangler d1 migrations apply`를 쓴다. | `worker/migrations/`, `.github/workflows/deploy-worker.yml`, `worker/package.json` |
| D-22 | 쇼핑몰 바로가기·상품 이미지 (2026-11-10) | 사용자 결정으로 D-16의 "제목과 링크만 수집"을 바꾼다. **글 페이지에서 쇼핑몰 주소 하나만** 뽑아 저장하고 본문은 저장하지 않는다(뽐뿌 `scrap_bx_href`, 루리웹 `source_url`, 클리앙 구매링크 칸 또는 본문 첫 쇼핑몰 링크). 수집은 **중계 한 곳**에서만 하고 글당 최대 2회, 24시간 이내 글만. 이미지는 **쇼핑몰 상품 페이지의 og:image 주소만** 보관하고 파일은 저장하지 않으며, 커뮤니티 글의 이미지는 쓰지 않는다. 봇을 막는 판매처(쿠팡·지마켓·옥션·네이버·11번가)에는 요청하지 않아 이미지가 비고, 브라우저 위장은 하지 않는다. 주소는 글에 올라온 그대로(utm_ 만 제거), 제휴 링크로 바꾸지 않는다. 카드 제목은 계속 우리 상세 페이지로 가고, 쇼핑몰 주소가 있으면 상세의 주 버튼이 쇼핑몰이다. 세 커뮤니티 robots.txt가 글 보기 경로를 허용함을 확인(클리앙은 쿼리 없는 주소만). | 스펙 `docs/superpowers/specs/2026-11-10-shop-links-design.md`, `worker/src/detail.ts` |

## 미결 사항

- 저장소명: 현재 `increw01-alt/26.10.25hotdeal`에서 진행. 공개 서비스 저장소로 분리할지 Phase 2 전에 결정.
- 사이트 브랜드명·도메인: 미정. 코드에서는 `shared/site.config.json`의 `siteName`으로 참조.
- 푸터 통신판매업 신고번호 표기 여부.
- 7월 상테크 분석(48,898건) 원본 데이터 보관 위치.
- 쿠팡 파트너스 Open API 사용 조건(사이트 완성 후).
