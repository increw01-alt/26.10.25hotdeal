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
| D-16 | 참고 사이트 | hotdeal.zip 구조 분석은 네트워크 허용 후 진행. 필드 구성·필터 구조를 비교 반영 예정. | 미정 |
| D-17 | 카드 혜택 데이터 (2026-10-28) | 카드사 **공식 페이지로 확인한 카드만 공개**(`status=verified`, 공식 출처 URL·확인일 필수, 60일 지나면 "재확인 필요" 표시). 제3자 카드 비교 사이트의 문구·이미지·링크는 조사용으로만 쓰고 저장소·사이트에 넣지 않는다. 카드 신청 링크·수수료 없음(모집 아님). 상품권 구매 적용 여부(`giftcard`)는 반드시 명시한다. | `shared/cards.json`, `scripts/check-cards.mjs`, `site/scripts/lib/card-benefits.mjs`, 스펙 `docs/superpowers/specs/2026-10-28-card-benefits-design.md` |

## 미결 사항

- 저장소명: 현재 `increw01-alt/26.10.25hotdeal`에서 진행. 공개 서비스 저장소로 분리할지 Phase 2 전에 결정.
- 사이트 브랜드명·도메인: 미정. 코드에서는 `shared/site.config.json`의 `siteName`으로 참조.
- 푸터 통신판매업 신고번호 표기 여부.
- 7월 상테크 분석(48,898건) 원본 데이터 보관 위치.
- 쿠팡 파트너스 Open API 사용 조건(사이트 완성 후).
