# 진행 상황 (2026-10-28 기준)

다음 세션에서 이 파일부터 읽으면 된다. 코드 작업은 Phase 0~3까지 끝나 **운영 중**이고, 남은 것은 아래 "남은 일"(운영자 계정 작업 + 파서 다듬기)이다.

## 완료된 것

| 구분 | 내용 | 커밋 |
|---|---|---|
| 기획 | 검토 메모, 결정 기록 16건(`DECISIONS.md`), v1.1 변경 요약 | `817ce28`, `5100b29` |
| Phase 0 | 폴더 구조, 소스·브랜드·디자인 토큰·사이트 설정 JSON | `5100b29` |
| Phase 1 | Cloudflare Workers 수집 Cron(1분) + D1 스키마 + 공개 API, 제목 파서, 주차 dedupe, 가드, 테스트 20건 | `5100b29` |
| Phase 2 | 홈·브랜드 허브·딜 상세·주간 비교·소개·데이터 제공·404 템플릿, 빌드 스크립트, 사이트맵 | `94cf693` |
| Phase 3 | 임베드 위젯(테마·간단 모드·자동 높이·코드 생성기), 배포 설정 검사기, Cloudflare 초기화 스크립트, `DEPLOY.md` | `e0709eb` |
| 로컬 PC | Git 2.56, Node 24 설치, 코드 내려받기 완료 → `C:\Users\OK\Desktop\블로그이미지\26.10.25 핫딜` | — |

브랜치: `claude/upbeat-noether-60p86o` (아직 `main` 없음)

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
  - 배경: 사용자가 내려받은 카드고릴라 크롤(`C:\Users\OK\Desktop\블로그이미지\26.10.28카드고릴라`, 저장소 밖)을 검토. 카드 유의사항 대부분이 상품권·선불충전을 혜택에서 제외하므로 "핫딜 × 카드" 자동 결합은 하지 않고, 공식 출처로 검증한 표를 만들기로 함. 최종 목표는 모든 핫딜 + 쇼핑몰별 카드 혜택 정보 사이트(2단계: 일반 핫딜 수집, 3단계: 주간 카드 행사·내 카드 저장·웹앱).
  - 데이터 `shared/cards.json`: 카드 14장(현대 2·신한 5·KB 2·삼성 3·롯데 2), 판매처 9곳(지마켓·옥션·11번가·네이버·쿠팡·SSG닷컴·롯데온·카카오톡 선물하기·토스). 전부 카드사 공식 페이지에서 혜택·실적·한도·상품권 제외 문구 확인 → `giftcard=excluded`. PAYCO 전용 카드와 하나 네이버페이 머니 체크카드는 카드사 사이트에서 찾지 못해 미수록.
  - 검증기 `scripts/check-cards.mjs`(CI·배포 전 실행), 조사 스크립트 `scripts/research/cards-from-crawl.mjs <크롤 api 폴더>`(결과 `candidates.md`는 크롤 폴더 옆에 생성, 저장소 밖).
  - 사이트: 딜 상세에 "{판매처} 카드 혜택" 섹션(상품권 적용 카드 본문 / 제외·미확인 카드는 접힌 목록), `/cards/` 페이지(메뉴 "카드 혜택"), 정적 `api/cards.json`. 테스트: site 8건(`npm test`), scripts 14건(`node --test "scripts/test/*.test.mjs"`).
  - 다음 손볼 것: 카드 확인일이 60일 지나면 "재확인 필요"가 뜨니 12월 말 전에 재확인. 카드 추가 시 공식 페이지 URL·확인일 필수(D-17).

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
| 수집 | 클리앙: Worker Cron 1분 / 뽐뿌·뽐뿌쿠폰·루리웹: **GitHub Actions 중계**(잡당 4.5분 60초 반복). GitHub `schedule`은 10-27 기준 한 번도 자동 실행되지 않음 → **Worker Cron이 중계가 2분 이상 비면 workflow_dispatch로 직접 실행(플랜 B, 동작 확인됨 09:45)**. PC 중계는 예비 / 퀘이사존·에펨코리아: 차단으로 비활성 |
| 배포 | `main` push → Actions. 작업 브랜치 `claude/upbeat-noether-60p86o`는 CI만 |
| 관리 | `/__admin/*` + `x-admin-token` (secret ADMIN_TOKEN, 값은 메모장) |

## 남은 일

- 문의 이메일이 임시값(`contact@example.com`) → 실제 주소로 교체 후 main 배포
- ADMIN_TOKEN을 대화에 노출되지 않은 값으로 교체
- (해결) 중계는 GitHub Actions + Worker 자동 깨우기. PC 중계·VPS는 선택 사항
- GitHub schedule 이 활성화되는지 며칠 지켜보기(안 돼도 플랜 B로 충분). fine-grained PAT 만료(1년) 전 갱신
- (완료 10-28) 클리앙 추천 수 셀렉터. 파싱 실패 큐 점검은 계속(관리 토큰 필요)
- 오탐 딜 `ca0216244403f1f6` 삭제(관리 토큰 필요, 10-28 항목 참고)
- 커스텀 도메인, 검색엔진 사이트맵 제출, 2주 후 점수 가중치 보정

## 멈춘 지점 (10-26 기준, 참고용)

**배포 2단계 Cloudflare 준비** 중. Cloudflare 대시보드에 로그인한 상태까지 확인했다.

- [ ] Account ID 복사 (대시보드 오른쪽 "계정 세부 정보" → `4dc5e566...`으로 시작)
- [ ] Workers Paid 결제 (사용량 패널의 "업그레이드" 버튼) — 이미 결제돼 있을 수도 있음
- [ ] API 토큰 발급 (내 프로필 → API 토큰 → "Cloudflare Workers 편집" 템플릿 + `Cloudflare Pages 편집`, `D1 편집` 권한 추가)

## 내일 할 일 (순서대로)

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
- hotdeal.zip 구조 분석 (로컬 PC 등 네트워크 허용 환경에서)
- 커뮤니티 RSS 실존 확인 — 초기화 스크립트 실행 후 `api/status.json`의 `sources`에서 `consecutive_fail`이 올라가는 소스가 있으면 주소 수정 필요
