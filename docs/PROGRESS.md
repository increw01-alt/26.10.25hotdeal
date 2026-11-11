# 진행 상황 (2026-11-11 기준)

다음 세션에서 이 파일부터 읽으면 된다. Phase 0~3, 카드 혜택 1단계, **2단계 일반 핫딜 수집(D-18~D-21), 쇼핑몰 바로가기·상품 이미지(D-22), 판매처 검색 연결(D-23)**까지 모두 main에 반영돼 **운영 중**이다. 날짜별 경과는 아래 절에 있다.

## 다음에 할 일

1. **2026-11-24 무렵**: 묶기 기준 0.5와 점수 가중치를 실제 데이터로 재검토(D-10, D-19). 11-11 점검으로는 기준을 바꿀 근거가 없었다(아래 "묶기 점검").
2. **사용자 확인 필요**: Workers 요금제(무료면 D1 쿼리 한도), `/__admin/queue`에 쌓인 글, 10월의 오탐 딜 `ca0216244403f1f6`(48시간 규칙으로 이미 종료됐을 가능성이 높다). 관리자 토큰이 필요하다.
3. **지마켓·네이버 검색 링크**가 실제로 잘 열리는지 사용자가 눌러 보기로 했다(자동 확인 불가).
4. 미룬 작은 것: 종료된 일반 딜 행 정리, 괄호 밖 품절 표시, 상품명에 남는 카드 문구, 검색 주소가 없는 판매처(SSG·오늘의집·토스 등), 목록 탭의 접근성 속성.
5. 3단계 후보: 주간 카드 행사 수집, 내 카드 저장, 웹앱.

## 완료된 것

| 구분 | 내용 | 커밋 |
|---|---|---|
| 기획 | 검토 메모, 결정 기록 16건(`DECISIONS.md`), v1.1 변경 요약 | `817ce28`, `5100b29` |
| Phase 0 | 폴더 구조, 소스·브랜드·디자인 토큰·사이트 설정 JSON | `5100b29` |
| Phase 1 | Cloudflare Workers 수집 Cron(1분) + D1 스키마 + 공개 API, 제목 파서, 주차 dedupe, 가드, 테스트 20건 | `5100b29` |
| Phase 2 | 홈·브랜드 허브·딜 상세·주간 비교·소개·데이터 제공·404 템플릿, 빌드 스크립트, 사이트맵 | `94cf693` |
| Phase 3 | 임베드 위젯(테마·간단 모드·자동 높이·코드 생성기), 배포 설정 검사기, Cloudflare 초기화 스크립트, `DEPLOY.md` | `e0709eb` |
| 로컬 PC | Git 2.56, Node 24 설치, 코드 내려받기 완료 → `C:\Users\OK\Desktop\블로그이미지\26.10.25 핫딜` | — |

브랜치: 배포는 `main`, 작업 브랜치 `claude/upbeat-noether-60p86o`(같이 push). 2단계는 `claude/nice-neumann-6afeab`(별도 worktree).

## 2026-11-11 사용자 제보: 품절된 딜이 진행 중으로 표시

"아디다스 방한화" 상세가 진행 중인데 쇼핑몰에서는 판매중지였고, 판매처도 "미확인"이었다.

- 원인 1: 클리앙은 품절을 제목이 아니라 목록 행의 class(sold_out)와 "품절" 아이콘으로 표시한다. 파서가 제목만 읽어 품절을 몰랐다. 품절 글도 목록 첫 쪽에 남아 있어 계속 "마지막 확인"이 갱신되며 살아 있었다. 품절 행은 제목 앞에 [품절]을 붙여 넘기도록 고쳤다(뒤 단계가 종료 처리).
- 원인 2: 제목에 판매처가 없으면 쇼핑몰 주소가 brand.naver.com이어도 판매처를 비워 두었다. 쇼핑몰 도메인으로 판매처를 채운다(저장할 때, 그리고 API 응답에서 옛 행도).
- 남은 한계: 뽐뿌·루리웹은 글쓴이가 제목에 품절·종료를 적어야만 알 수 있다. 쇼핑몰 쪽 품절은 확인하지 않는다.

## 2026-11-11 묶기 점검

여러 커뮤니티 글이 묶인 딜이 0건이라 운영 일반 딜 210건(뽐뿌 166, 루리웹 33, 클리앙 11)을 전수 비교했다.

- **묶기는 고장이 아니다.** 다른 커뮤니티끼리 제목 유사도 0.3 이상인 쌍은 1건뿐이었다. 0.15까지 낮춰도 나머지 11쌍은 모두 다른 상품이었다. 이틀 동안 세 커뮤니티에 실제로 겹쳐 올라온 글이 거의 없었다는 뜻이다.
- 그 1건(삼성 360 스탠드 마그넷, 같은 가격, 유사도 0.60)은 클리앙의 `[SEC]`를 삼성닷컴으로 못 읽어 안 묶였다. 별칭 추가로 고쳤다. 이미 저장된 그 두 딜은 그대로 둔다.
- 함께 찾은 것: 가격 앞에 "카드", "티멤", "토스페이", "페이코" 같은 말이 붙으면 숫자 가격을 못 읽고 "무료"나 서술형으로 저장했다(210건 중 약 10건). 숫자가 바로 뒤따를 때 그 말을 떼고 읽도록 고쳤다. 가격을 못 읽으면 묶기 대상에서도 빠지므로 묶기에도 영향이 있었다.
- 판매처 미인식은 210건 중 29건이고 대부분 사전에 없는 작은 몰이다(하림몰, 겜우리, 퀸잇 등). "카카오" 3건은 어느 서비스인지 제목만으로는 알 수 없어 그대로 둔다.

## 2026-11-11 판매처 검색 연결 (D-23)

- 하루 뒤 운영 수치: 진행 중 196건 가운데 쇼핑몰 주소 42건. 루리웹 32건 중 31건, 클리앙 11건 중 11건, 뽐뿌 152건 중 0건(D-22에서 제외). 여러 커뮤니티 글이 묶인 딜은 0건이라 따로 점검이 필요하다.
- 쇼핑몰 주소가 없는 일반 딜을 판매처 검색 결과로 연결했다. 운영 데이터로 빌드하면 일반 핫딜 목록 첫 쪽 50건 중 쇼핑몰 8건, 검색 32건.
- 검색 주소 확인: 옥션·롯데온·쿠팡·11번가는 브라우저에서 결과가 뜨는 것을 확인. GS샵·컬리·예스24·교보·알라딘·스팀은 응답 200. **지마켓은 자동화 브라우저에서 봇 확인 화면이 떠서, 네이버쇼핑은 열 수 없어서 눈으로 확인하지 못했다**(지마켓은 옥션과 같은 주소 형식).
- 뺀 곳: 하이마트(주소 404), SSG·이마트·오늘의집·올리브영(봇 요청 403이라 확인 불가).
- main 반영(`1d33c97`, 2026-11-11): 배포 성공. 운영 일반 핫딜 목록 첫 쪽 50건 중 쇼핑몰 8건, 검색 31건(지마켓 14, 옥션 4, 롯데온 3, 네이버 3, 11번가 3, 쿠팡 2, GS샵 2). 지마켓·네이버 검색 링크는 사용자가 직접 눌러 확인하기로 함.
- 한계: 검색 결과라 같은 상품·가격이 아닐 수 있다. 판매처가 사전에 없거나 검색 주소가 없는 딜(토스, 카카오 등)은 그대로 원문 글로 간다.

## 2026-11-10 쇼핑몰 바로가기·상품 이미지 (D-22)

방문자가 커뮤니티 글을 거치지 않고 쇼핑몰 상품 페이지로 가게 했다. 스펙은 `docs/superpowers/specs/2026-11-10-shop-links-design.md`.

- **수집**: 중계가 루프마다 `/__admin/pending-details`로 글 8건을 받아 글 페이지에서 쇼핑몰 주소를, 쇼핑몰 페이지에서 og:image 주소를 뽑아 `/__admin/details`로 돌려준다. 추출은 `worker/src/detail.ts`(순수 함수), DB는 `detail-store.ts`, 마이그레이션 `0003_shop_links.sql`.
- **사이트**: 카드에 썸네일(없으면 판매처 첫 글자)과 "쇼핑몰 ›" 링크, 상세의 주 버튼이 "쇼핑몰에서 보기 (도메인)". 주소가 없으면 예전처럼 원문 글. 소개 페이지 출처 정책 갱신.
- **API**: 딜에 `shop_url`, `image_url`, 상세 `posts[]`에 `shop_url`.
- **로컬 확인(실제 글 37건)**: 쇼핑몰 주소 31건, 이미지 15건. 쿠팡·지마켓·네이버는 이미지가 없다.
- **스펙과 다르게 한 것**: 엔드포인트는 `/__relay/`가 아니라 기존 토큰 검사를 쓰는 `/__admin/` 아래에 두었다. 이미지 요청 제외 판매처는 `brands.json`이 아니라 `detail.ts`의 도메인 목록으로 두었다(판매처가 아니라 도메인으로 판단해야 해서). 클리앙은 판매처 사전 우선 없이 구매링크 칸, 그다음 본문 첫 쇼핑몰 링크. 썸네일은 64px.
- **알려진 한계**: 큰 판매처는 이미지 없음. 글쓴이 추천 코드가 든 주소가 그대로 나감. GitHub 예약 실행이 멈추면 상세 수집도 멈춤. 사이트는 매시 빌드라 쇼핑몰 링크가 최대 1시간 늦게 보임. 중계가 글에 적힌 주소로 요청하므로 IP·내부 이름은 거르지만 리다이렉트 뒤 주소까지는 검사하지 않는다.

**main 반영 뒤 운영에서 드러난 것 (2026-11-10 10:08 UTC)**
- **뽐뿌가 글 페이지 요청을 403으로 막는다.** GitHub Actions에서 바로 403이 났고, 로컬 확인 때는 되던 PC에서도 이후 403으로 바뀌었다(RSS는 계속 200). 막는 곳은 우회하지 않으므로 뽐뿌와 뽐뿌 쿠폰게시판을 상세 수집에서 뺐다. **뽐뿌 글만 있는 딜은 쇼핑몰 링크와 이미지가 없고 원문 글로 간다.** 루리웹이나 클리앙에도 올라온 딜은 그쪽에서 채워진다.
- 막힌 뽐뿌 글이 대기 목록 앞 8건을 차지해 루리웹·클리앙 글까지 밀렸다. 대기 목록을 소스별로 4건씩 주도록 바꿨다.
- 401·403은 시도로 세고, 장애·차단이 난 소스는 그 실행(약 4.5분) 동안 더 요청하지 않는다.

- 수정 배포(`2992822`) 뒤 확인: 마이그레이션 0003 적용, 약 10분 만에 진행 중 80건 가운데 쇼핑몰 주소 14건(루리웹 9, 클리앙 5), 이미지 5건. 클리앙 글 페이지는 GitHub Actions에서도 열린다. 사이트 재빌드 뒤 홈에 쇼핑몰 링크 12개, 이미지 3개가 나온다.
- 다음에 볼 것: 하루 뒤 쇼핑몰 주소 비율, 루리웹·클리앙의 상세 요청이 막히지 않는지(Relay Collect 로그의 "이 실행 동안 쉼").

**코드 리뷰 반영(치명 0, 중요 3)**
- 결과를 글마다 바로 보낸다. 예전에는 8건을 모아 보내서 작업이 끊기면 같은 글을 다시 요청했다. `RELAY_BUDGET_SEC`로 마감 35초 전에는 새 글을 시작하지 않는다.
- 글 페이지를 읽었거나 지워진 글(404, 410)만 시도로 센다. 429·5xx·시간 초과는 세지 않고 그 소스는 그 루프에서 쉰다.
- 쇼핑몰 요청은 리다이렉트를 직접 따라가며 단계마다 주소를 검사한다(최대 3번). 이름이 사설·루프백 주소로 풀리면 요청하지 않는다.
- 함께 고친 것: 닫히지 않은 태그가 많은 페이지에서 정규식이 수십 초 걸리던 것(태그를 indexOf로 순회), `data-href`를 href로 읽던 것, og:image 판정(파일 이름만, `name` 속성, 빈 첫 태그), 제휴 딜의 버튼.
- 미룬 것: EUC-KR 쿼리가 든 주소에서 utm 제거 시 깨짐, 쓰이지 않는 인덱스 `idx_posts_detail_pending`, 이미지 요청이 한 번 실패하면 다시 안 함, 클리앙 본문 첫 링크가 뉴스·이미지 호스트일 수 있음, `detail-store.ts`와 관리 경로의 단위 테스트 없음(로컬 Worker로만 확인), DNS 검사와 실제 연결 사이의 시간차.

## 2026-11-10 일반 핫딜 수집 확장 (2단계)

스펙 `docs/superpowers/specs/2026-11-10-general-hotdeals-design.md`, 계획 `docs/superpowers/plans/2026-11-10-general-hotdeals.md`. 결정은 D-16(마감), D-18 ~ D-21.

**한 일**
- **스키마**: `worker/migrations/`로 전환(D-21). `deals`에 `kind`, `product_name`, `merchant_raw`, `price_kind`, `price_text`, `shipping`, `product_category`, `title_tokens`, `deal_posts`에 `closed` 추가. 로컬 D1에서 빈 DB와 기존 스키마 DB 두 경우 모두 적용 확인(두 번째 실행은 "No migrations to apply").
- **판매처 사전**: 13곳에서 41곳으로. 새 28곳은 `product_only`(상품권 파서는 기존 13곳만 본다).
- **수집**: `route.ts`가 글 한 건의 갈래(상품권 / 큐 / 일반 / 다시 봄 / 닫힘 / 건너뜀)를 정하고, `parse-product.ts`가 일반 딜 제목을 파싱, `group.ts`가 묶기(Jaccard 0.5), `collect.ts`가 저장한다. 일반 딜 수명 12/24시간, 점수에 등장 커뮤니티 수 항, 점수는 0.002 이상 달라졌을 때만 다시 쓴다.
- **API**: `kind`·`merchant`·`offset`·`has_more`, `limit` 상한 500, 응답에 일반 딜 필드와 `sources`, `status.json`에 `active_by_kind`. 기본값이 전체로 바뀜.
- **사이트**: 홈 종류 탭(전체/상품권/일반 핫딜)과 판매처 필터, `/deals/`·`/deals/gift/`·`/deals/product/` 목록(50건/쪽), 일반 딜 카드와 상세(판매처 카드 혜택 섹션, 상품권 칩 없음), 헤더 메뉴, 소개·데이터 제공 문구. 임베드 위젯·주간 비교·브랜드 허브는 상품권 전용 유지.
- **검증**: worker 테스트 33건(기존, 무수정) + 신규, site 테스트 9건(기존) + 신규, scripts 14건, `check-cards.mjs`, 타입검사, 샘플 빌드. 로컬 Worker에 개발용 주입(`/__dev/ingest`)으로 상품권 1건·일반 4건이 맞는 종류로 저장되고, 뽐뿌·클리앙의 같은 상품 글이 한 딜로 묶이며, 한 글만 [종료]면 딜이 남고 둘 다 닫히면 종료, 표시가 사라지면 되살아나는 것을 확인. 로컬 Worker를 상대로 API 모드 빌드도 확인.

**코드 리뷰 반영 (같은 날)**
- 사전 필터가 놓친 상품권 글("해피머니 5만원")이 일반 딜로 저장되던 문제를 막았다(1단계처럼 건너뛴다).
- 일반 딜 제목의 "삼성", "현대", "우리" 같은 낱말을 카드사로 읽지 않는다("카드"가 붙은 표기만 인정).
- 불용어뿐인 제목끼리 한 딜로 묶이던 문제, 본문의 "20,000mAh"·"5천원 할인"을 가격으로 읽던 문제, 상품명 속 퍼센트를 할인율로 쓰던 문제를 고쳤다.
- 사이트 빌드의 이스케이프를 고쳤다: "raw:"로 시작하는 제목과 JSON-LD 안의 `</script>`가 그대로 HTML이 될 수 있었다(1단계부터 있던 문제, `site/scripts/lib/template.mjs`).
- 수집 한 번에 글마다 하던 조회를 40건씩 묶었고, 진행 중 조건을 인덱스를 타는 형태로 바꿨으며, `deal_posts(first_seen)` 인덱스를 더했다.
- 미룬 것: 종료된 일반 딜 정리(행이 계속 쌓인다), 괄호 밖 품절 표시, 목록 페이지 탭의 ARIA, 임베드 스크립트 캐시 1시간 동안 위젯에 일반 딜이 섞일 수 있는 점.

**main 반영 뒤 확인할 것**
1. Actions의 Deploy Worker에서 "D1 마이그레이션 적용" 단계가 0001·0002를 적용했는지(두 번째 배포부터는 "No migrations to apply").
2. `Worker주소/api/status.json`의 `active_by_kind.product`가 올라가는지, `/api/deals.json?kind=product`에 딜이 보이는지.
3. `/__admin/queue`에 `product low confidence` 건이 과하게 쌓이지 않는지. 쌓이면 `parse-product.ts`의 신뢰도 가중치나 제목 관례를 손본다.
4. Deploy Worker가 끝난 뒤 Deploy Site를 한 번 다시 돌린다(둘이 동시에 시작해 사이트가 옛 Worker 응답으로 빌드될 수 있다. 그대로 둬도 매시 7분 빌드에서 반영된다).
5. Workers 요금제 확인: 무료 요금제는 실행당 D1 쿼리 수 한도가 낮아 첫 수집에서 실패할 수 있다(유료면 문제없음).
6. 운영 2주 뒤(2026-11-24 무렵) 묶기 기준 0.5와 점수 가중치를 실제 데이터로 재검토(D-10, D-19).

**main 반영 결과 (2026-11-10 09:16 UTC, `e58ded6`)**
- 1번 완료: Deploy Worker의 마이그레이션 단계가 운영 DB에 0001·0002를 적용했다(기존 테이블은 그대로, 0002만 실제 변경).
- 2번 완료: 배포 몇 분 뒤 `active_by_kind`가 gift 11, product 16. `/api/deals.json?kind=product`에 클리앙·뽐뿌 글이 일반 딜로 보인다. 소스 실패 0, guard 미발동.
- 4번 완료: 첫 사이트 빌드는 일반 딜 0건이라 Deploy Site를 수동으로 한 번 더 돌렸다. 홈에 일반 딜 11건·상품권 11건, `/deals/` 목록과 일반 딜 상세(카드 혜택 섹션 포함)가 200으로 뜬다.
- 5번: 첫 수집이 실패 없이 돌았다. 요금제 자체는 여전히 미확인이라 글이 몰리는 시간대에 status의 `consecutive_fail`을 한 번 더 본다.
- 남음: 3번(`/__admin/queue`는 관리자 토큰이 필요해 확인하지 않음), 6번(2026-11-24 무렵 재검토). 두 커뮤니티 글이 한 딜로 묶인 실제 사례는 아직 없다(로컬에서만 확인).

**이후 단계 메모**: 뽐뿌·루리웹 목록 HTML 수집(추천 수), 가격 변동 추적, 카테고리 분류, 판매처 허브 페이지, 주간 카드 행사, 내 카드 저장, 웹앱(3단계).

## 2026-10-28 아침 점검 (클라우드 세션에서 확인)

- **GitHub `schedule`이 살아났다.** Deploy Site 매시 재빌드가 10-27 15:18 UTC부터 자동 실행 중(15:18, 20:39, 00:28 …), Relay Collect도 schedule 이벤트로 실행됨.
- 중계는 밤새 132회 실행(플랜 B dispatch + schedule), 전부 성공. 플랜 B 확장(사이트 재빌드 깨우기)은 **불필요**해짐.
- 이후 작업은 사용자 로컬 PC의 Claude Code 세션에서 진행하기로 함(이 파일이 인수인계 문서).

## 2026-10-28 로컬 세션 진행

- 클리앙 추천 수 수정(`bef4cae`) 배포 후 실제 목록 페이지(31행)로 검증: 24행에서 추천 수가 읽히고(최대 7), 제목 끝에 댓글 수가 붙는 건 0.
- 파서 오탐 보강(`2404cdc`, Deploy Worker 성공 01:19 UTC):
  - 맨 앞 대괄호가 판매처로 판별되면 브랜드는 대괄호 밖에서만 찾음 → "[신세계] 진한 보리차 …"처럼 판매처명이 브랜드 alias와 겹치는 오탐 차단. SSG닷컴 판매처 alias에 `신세계`·`신세계몰` 추가.
  - 짧은 alias(신세계·갤러리아·해머·문상·도문·넥슨·스타벅스·스벅·cgv·구글플레이·네이버페이·네페·카카오페이)로만 잡힌 브랜드는 상품권 단서(`GIFT_CONTEXT`)나 액면가+판매가가 없으면 confidence 0.45 → `parse_queue`로 보냄(딜 확정 안 함).
  - 테스트 33건 통과(`parse.test.ts`에 "실데이터 오탐 (2026-10-28)" 5건 추가).
- **DB에 남은 오탐 딜 1건** `ca0216244403f1f6`("[신세계] 진한 보리차 진액"): 관리 토큰으로 삭제 필요. 안 지우면 10-29 09:03 UTC 이후 자동 종료(48시간 규칙).
  `curl.exe -s -H "x-admin-token: $T" "$A/__admin/delete?id=ca0216244403f1f6"`
- 점검 결과: `active_deals` 3(컬쳐랜드 5만·CGV 관람권·위 오탐 1), 중계 stale 없음, Deploy Site schedule 매시 정상, 홈 지연 배너는 `hidden`(정상).
- **쇼핑몰별 카드 혜택 1단계 완료** (설계 `docs/superpowers/specs/2026-10-28-card-benefits-design.md`, 계획 `docs/superpowers/plans/2026-10-28-card-benefits-phase1.md`, 결정 D-17):
  - 배경: 사용자가 내려받은 카드고릴라 크롤(로컬 PC의 `26.10.28카드고릴라` 폴더, 저장소 밖)을 검토. 카드 유의사항 대부분이 상품권·선불충전을 혜택에서 제외하므로 "핫딜 × 카드" 자동 결합은 하지 않고, 공식 출처로 검증한 표를 만들기로 함. 최종 목표는 모든 핫딜 + 쇼핑몰별 카드 혜택 정보 사이트(2단계: 일반 핫딜 수집, 3단계: 주간 카드 행사·내 카드 저장·웹앱).
  - 데이터 `shared/cards.json`: 카드 14장(현대 2·신한 5·KB 2·삼성 3·롯데 2), 판매처 9곳(지마켓·옥션·11번가·네이버·쿠팡·SSG닷컴·롯데온·카카오톡 선물하기·토스). 전부 카드사 공식 페이지에서 혜택·실적·한도·상품권 제외 문구 확인 → `giftcard=excluded`. PAYCO 전용 카드와 하나 네이버페이 머니 체크카드는 카드사 사이트에서 찾지 못해 미수록.
  - 검증기 `scripts/check-cards.mjs`(CI·배포 전 실행), 조사 스크립트 `scripts/research/cards-from-crawl.mjs <크롤 api 폴더>`(결과 `candidates.md`는 크롤 폴더 옆에 생성, 저장소 밖).
  - 사이트: 딜 상세에 "{판매처} 카드 혜택" 섹션(상품권 적용 카드 본문 / 제외·미확인 카드는 접힌 목록), `/cards/` 페이지(메뉴 "카드 혜택"), 정적 `api/cards.json`. 테스트: site 10건(`npm test`), scripts 17건(`node --test "scripts/test/*.test.mjs"`), worker 33건(`npm test`).
  - 다음 손볼 것: 카드 확인일이 60일 지나면 "재확인 필요"가 뜨니 12월 말 전에 재확인. 카드 추가 시 공식 페이지 URL·확인일 필수(D-17).
  - 리뷰 반영(같은 날): 딜의 카드 행사 조건이 있으면 카드 자체 혜택과 별개임을 한 줄 안내, 연회비 미표시 카드는 "연회비 미확인"으로 표기, `/open-data/`에 `api/cards.json` 행, 검증기에 카드 내 판매처 중복·미래 날짜·발급사 공식 도메인(`brands.json` `card_issuers[].domains`) 검사 추가.
  - 2단계(일반 핫딜 수집 확장)는 별도 세션에서 브레인스토밍 중. 현재 상태와 재개 방법은 맨 위 "내일 이어서 할 일" 참고.
- 하루 마무리 상태: `main` == `origin/main`(`a254522` + 이 문서 갱신 커밋), 작업 트리 깨끗함. 라이브 반영 확인: `/cards/`의 "연회비 미확인" 표기, `/open-data/`의 `api/cards.json` 행. Deploy Site는 첫 실행이 API 일시 조회 실패로 한 번 실패했다가 재실행으로 성공(일시적 네트워크, 조치 불필요).

## 시작할 때

1. 이 파일을 읽고 아래 "확인 순서"를 먼저 돈다.
2. 로컬 PC: `cd "C:\Users\OK\Desktop\블로그이미지\26.10.25 핫딜"` → `git pull origin main`
3. 작업은 `claude/upbeat-noether-60p86o`에 올리고 `main`에도 바로 반영한다(사용자 승인됨). `main` push = 자동 배포.

### 확인 순서
- (해결됨 10-28) GitHub schedule 자동 실행 정상. 플랜 B는 보조로 유지.
- `https://hotdeal-hub-worker.increw01.workers.dev/api/status.json`: `relay[].stale`이 전부 false인지, `active_deals`가 늘고 있는지.
- 관리 점검(두 번째 PowerShell, `worker` 폴더): `$T="<ADMIN_TOKEN>"; $A="https://hotdeal-hub-worker.increw01.workers.dev"` 후
  `curl.exe -s -H "x-admin-token: $T" "$A/__admin/sources"`, `"$A/__admin/queue"`(파싱 보류 글 확인).

### 바로 할 수 있는 작은 일
- 문의 이메일 교체: `shared/site.config.json`의 `operator.email`(현재 `contact@example.com`) → 실제 주소. push하면 다음 빌드에 반영.
- ADMIN_TOKEN 교체(대화에 노출됨): `"새값" | npx wrangler secret put ADMIN_TOKEN` → GitHub secret `RELAY_TOKEN`도 같은 값으로 갱신.
- (완료 10-28) 클리앙 추천 수 셀렉터 수정·실제 마크업으로 검증.
- 오탐 딜 `ca0216244403f1f6` 삭제(위 10-28 항목의 명령, 관리 토큰 필요).
- 파싱 보류 큐(`parse_queue`) 내용 보고 파서 규칙 보강 — 10-28 보강분 배포 후 큐에 쌓이는 글을 보고, 짧은 alias 규칙이 정상 딜을 큐로 보내면 `parse.ts`의 `GIFT_CONTEXT`·`WEAK_ALIASES` 조정.

### 이번 주 안에
- 커스텀 도메인 결정·연결(`docs/DEPLOY.md` 4단계).
- Google Search Console·네이버 서치어드바이저에 `sitemap.xml` 제출.
- 2주 뒤 `score.ts` 가중치 보정(소스별 중앙값 데이터 확인).

## 2026-10-27 진행

- Cloudflare 초기화 완료: D1 `hotdeal-hub`, Worker `https://hotdeal-hub-worker.increw01.workers.dev`, Pages `https://hotdeal-hub.pages.dev`(샘플 데이터).
- 설정값 기입(사이트명 "핫딜 허브", 운영자, 메일) → 로컬 커밋됨. **아직 `git push`·GitHub Secrets·main 브랜치 전**.
- 관리 엔드포인트 `/__admin/*` (secret `ADMIN_TOKEN`, 값은 메모장에만 보관), 소스 조사 결과:
  - 클리앙: Worker에서 HTML 파서로 수집 성공
  - 뽐뿌(빈 응답)·루리웹(522)·퀘이사존(403)·에펨코리아(430): Worker IP 차단 → **중계 수집기**(`scripts/relay-start.ps1`) 도입. 뽐뿌·루리웹은 PC에서 중계.
- 중계 수집기 PC에서 상시 실행 중(60초, 뽐뿌 15건·루리웹 28건/회). 클리앙은 Worker Cron.
- `git push` → GitHub Secrets/Variables 등록 → `main` 브랜치 생성·기본 브랜치 전환 완료.
- **2026-10-27 17:13 Deploy Worker / Deploy Site 첫 실행 성공** (수동 dispatch). 이후 `main` push 시 자동, 사이트는 매시 7분 재빌드.
- 파서 오탐(적립 이벤트·브랜드명 내부 판매처) 수정 완료, 오탐 딜 1건 삭제(`/__admin/delete`).
- 뽐뿌 쿠폰게시판(`rss.php?id=coupon`) 소스 추가. `money`·`ppomppu4`·`ppomppu8`은 무관 게시판이라 제외.
- GitHub Actions 중계(`relay.yml`) 도입 → GitHub IP는 차단 안 됨 확인 → 기본 경로로 전환(5분 잡 + 60초 루프).
- GitHub `schedule`이 자동 실행되지 않아 **플랜 B**: Worker Cron이 중계 공백 2분 초과 시 `workflow_dispatch`(fine-grained PAT, secret `GITHUB_DISPATCH_TOKEN`). 09:45 자동 실행 확인.
- 중계 전용 소스(`relay_only`)는 Worker가 직접 시도하지 않도록 변경(서킷 브레이커 오작동 방지).
- 저장소는 공개(Actions 무료). secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `RELAY_TOKEN` / vars: `CF_PAGES_PROJECT`, `API_BASE`. Worker secrets: `ADMIN_TOKEN`, `GITHUB_DISPATCH_TOKEN`.

## 운영 중 상태 (요약)

| 항목 | 값 |
|---|---|
| 사이트 | https://hotdeal-hub.pages.dev |
| API | https://hotdeal-hub-worker.increw01.workers.dev (`/api/status.json`) |
| 수집 | 클리앙: Worker Cron 1분 / 뽐뿌·뽐뿌쿠폰·루리웹: **GitHub Actions 중계**(잡당 4.5분 60초 반복). GitHub `schedule`은 10-27 15:18 UTC부터 자동 실행됨(10-28 확인). Worker Cron이 중계가 2분 이상 비면 workflow_dispatch로 깨우는 플랜 B는 보조로 유지. PC 중계는 예비 / 퀘이사존·에펨코리아: 차단으로 비활성 |
| 배포 | `main` push → Actions. 작업 브랜치 `claude/upbeat-noether-60p86o`는 CI만 |
| 관리 | `/__admin/*` + `x-admin-token` (secret ADMIN_TOKEN, 값은 메모장) |

## 남은 일

- 2단계(일반 핫딜 수집 확장) 설계·구현 — 별도 세션, 맨 위 "내일 이어서 할 일" 참고
- 문의 이메일이 임시값(`contact@example.com`) → 실제 주소로 교체 후 main 배포
- ADMIN_TOKEN을 대화에 노출되지 않은 값으로 교체
- (해결) 중계는 GitHub Actions + Worker 자동 깨우기. PC 중계·VPS는 선택 사항
- (해결 10-28) GitHub schedule 자동 실행 확인됨. fine-grained PAT 만료(1년) 전 갱신
- (완료 10-28) 클리앙 추천 수 셀렉터. 파싱 실패 큐 점검은 계속(관리 토큰 필요)
- 오탐 딜 `ca0216244403f1f6` 삭제(관리 토큰 필요, 10-28 항목 참고)
- 커스텀 도메인, 검색엔진 사이트맵 제출, 2주 후 점수 가중치 보정

## 10-26 배포 준비 기록 (모두 완료, 참고용)

(10-27에 전부 끝났다. 아래는 당시 기록.) **배포 2단계 Cloudflare 준비** 중. Cloudflare 대시보드에 로그인한 상태까지 확인했다.

- [x] Account ID 복사 (대시보드 오른쪽 "계정 세부 정보" → `4dc5e566...`으로 시작)
- [x] Workers Paid 결제 (사용량 패널의 "업그레이드" 버튼) — 이미 결제돼 있을 수도 있음
- [x] API 토큰 발급 (내 프로필 → API 토큰 → "Cloudflare Workers 편집" 템플릿 + `Cloudflare Pages 편집`, `D1 편집` 권한 추가)

### 당시 배포 절차 (완료)

1. 위 체크 3개를 끝내고 메모장에 **Account ID**와 **API 토큰**을 적어 둔다.
2. PowerShell에서 초기화 스크립트 실행:
   ```powershell
   cd "C:\Users\OK\Desktop\블로그이미지\26.10.25 핫딜"
   git pull origin claude/upbeat-noether-60p86o
   powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflare.ps1
   ```
   브라우저 허용 → Allow, 텔레그램 질문 → Enter. 끝나면 **Worker 주소**와 **Pages 주소**를 메모.
3. `shared\site.config.json`, `worker\wrangler.toml`의 `REPLACE_` 값 채우기 (사이트명, 두 주소, 운영자명, 메일). 확인: `node scripts\check-config.mjs`
4. `git add -A` → `git commit -m "설정값 입력"` → `git push`
5. GitHub 저장소 Settings → Secrets and variables → Actions
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables: `CF_PAGES_PROJECT` = `hotdeal-hub`, `API_BASE` = Worker 주소
6. `git checkout -b main` → `git push -u origin main` → GitHub Settings → General → Default branch를 `main`으로.
7. Actions 탭에서 Deploy Worker / Deploy Site 초록 체크 확인. `Worker주소/api/status.json`에서 `last_updated` 갱신 확인.

자세한 설명은 `docs/DEPLOY.md`, 쉬운 설명은 이 세션의 대화 기록 참고.

## 아직 정하지 않은 것

- 사이트 이름, 도메인, 운영자 표기 (3단계에서 필요)
- 푸터 통신판매업 신고번호 표기 여부
- 쿠팡 파트너스 (사이트 완성 후 검토, 현재 off)
- 커뮤니티 RSS 실존 확인 — 초기화 스크립트 실행 후 `api/status.json`의 `sources`에서 `consecutive_fail`이 올라가는 소스가 있으면 주소 수정 필요
