# 배포 가이드

전체 구성: **Cloudflare Workers(수집 Cron + API) + D1 + Pages(정적 사이트)**, 코드 배포는 GitHub Actions.
한 번만 하는 계정 작업(1~2단계)은 직접 해야 하고, 그 뒤로는 `main`에 push하면 자동 배포된다.

## 0. 준비물

| 항목 | 비고 |
|---|---|
| Cloudflare 계정 | Workers Paid($5/월) 결제: 대시보드 → Workers & Pages → Plans |
| Cloudflare API 토큰 | 대시보드 → My Profile → API Tokens → "Edit Cloudflare Workers" 템플릿 + **Account: Cloudflare Pages: Edit**, **Account: D1: Edit** 권한 추가 |
| Account ID | 대시보드 Workers & Pages 우측 패널에 표시 |
| Node 22+ | Windows는 nodejs.org LTS, WSL2는 `nvm install 22` |
| (선택) 텔레그램 봇 | BotFather로 토큰 발급, 알림 받을 채팅의 chat_id |

## 1. Cloudflare 초기화 (한 번)

저장소 루트에서 스크립트 하나로 끝난다. 실행 중 **API 토큰**과 **Account ID**, 그리고 **사이트 이름·운영자명·문의 메일**을 물어본다. 사이트 주소와 API 주소는 자동으로 기입되므로 2단계의 수동 입력은 대부분 필요 없다.

```powershell
# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflare.ps1 -PagesProject hotdeal-hub
```
```bash
# WSL2 / macOS / Linux
bash scripts/setup-cloudflare.sh hotdeal-hub
```

스크립트가 하는 일: D1 생성 → `worker/wrangler.toml`에 `database_id` 기입 → 스키마 적용 → 텔레그램 시크릿(선택) → Worker 배포 → Pages 프로젝트 생성 → 샘플 데이터로 첫 사이트 배포.
끝나면 Worker 주소(`https://hotdeal-hub-worker.<계정>.workers.dev`)와 Pages 주소(`https://hotdeal-hub.pages.dev`)가 출력된다.

수동으로 하려면 같은 순서로 `worker/package.json`의 `db:create`, `db:migrate:remote`, `deploy` 스크립트와 `wrangler pages project create`, `wrangler pages deploy`를 실행하면 된다.

## 2. 설정값 채우기

`REPLACE_`로 표시된 값을 실제 값으로 바꾸고 커밋한다. 배포 워크플로는 `scripts/check-config.mjs`로 이 값을 검사하며, 남아 있으면 배포를 중단한다.

| 파일 | 키 | 값 |
|---|---|---|
| `shared/site.config.json` | `siteName` | 사이트 이름 |
| | `siteUrl` | `https://hotdeal-hub.pages.dev` 또는 커스텀 도메인 (끝에 `/` 없음) |
| | `apiBase` | Worker 주소 (끝에 `/` 없음) |
| | `operator.name`, `operator.email` | 운영자 표기·문의 메일 |
| `worker/wrangler.toml` | `SITE_NAME`, `SITE_URL`, `USER_AGENT` | 위와 동일. USER_AGENT의 URL은 `/about/`로 |
| | `database_id` | 스크립트가 기입. 수동이면 `wrangler d1 list` |

로컬에서 확인: `node scripts/check-config.mjs`

## 3. GitHub Actions 연결

저장소 **Settings → Secrets and variables → Actions**

| 종류 | 이름 | 값 |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | 0단계 토큰 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| Secret | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | (선택) 배포 결과 알림 |
| Variable | `CF_PAGES_PROJECT` | `hotdeal-hub` (1단계에서 만든 Pages 프로젝트명) |
| Variable | `API_BASE` | Worker 주소. `site.config.json`의 `apiBase`보다 우선 |

워크플로 동작:

| 워크플로 | 트리거 | 내용 |
|---|---|---|
| `ci.yml` | main 외 브랜치 push, PR | Worker 테스트·타입검사, 사이트 샘플 빌드 |
| `deploy-worker.yml` | `worker/`, `shared/` 변경이 main에 push | 설정 검사 → 테스트 → D1 스키마(멱등) → `wrangler deploy` |
| `deploy-site.yml` | `site/`, `shared/` 변경 push, **매시 7분**, 수동 | 설정 검사 → API에서 데이터 빌드 → Pages 배포. API 실패·0건이면 중단(기존 배포 유지) |

`main` 브랜치가 아직 없으면 작업 브랜치에서 만든다: `git checkout -b main && git push -u origin main`. 저장소 기본 브랜치를 `main`으로 바꾼다(Settings → General → Default branch).

## 4. 커스텀 도메인 (선택)

도메인을 Cloudflare DNS로 옮긴 뒤:

1. **사이트**: Workers & Pages → `hotdeal-hub` → Custom domains → `example.com`, `www.example.com` 추가. 인증서는 자동.
2. **API**: `worker/wrangler.toml`의 주석을 풀어 `routes = [{ pattern = "api.example.com", custom_domain = true }]`로 설정하고 Worker를 다시 배포. DNS 레코드도 자동 생성된다.
3. `site.config.json`의 `siteUrl`/`apiBase`, `wrangler.toml`의 `SITE_URL`, GitHub Variable `API_BASE`를 새 주소로 바꾸고 커밋.
4. `www` → apex 리다이렉트가 필요하면 Cloudflare Rules → Redirect Rules에서 설정.

## 5. 배포 후 점검 체크리스트

```bash
# Worker
curl -s https://<API>/health
curl -s https://<API>/api/status.json          # last_updated가 1~2분 안으로 갱신되는지, sources의 consecutive_fail 확인
curl -s "https://<API>/api/deals.json?limit=3"

# 사이트
curl -sI https://<SITE>/ | head -3
curl -s https://<SITE>/sitemap.xml | head
curl -s https://<SITE>/api/deals.json | head -c 300   # 정적 사본
```

- Cloudflare 대시보드 → Workers → `hotdeal-hub-worker` → Logs: `[collect] fetched=… parsed=…` 로그가 1분마다 찍히는지.
- 소스가 전부 `consecutive_fail`이면 RSS 주소·차단 여부 확인 → `shared/sources.json` 수정 후 push.
- Google Search Console·네이버 서치어드바이저에 `sitemap.xml` 제출.
- 2주 뒤 `source_state.median_votes_7d`를 보고 `worker/src/score.ts` 가중치 보정(D-10).

## 6. 관리용 진단 엔드포인트

`worker` 폴더에서 `npx wrangler secret put ADMIN_TOKEN`으로 비밀번호를 정해 두면 아래 주소를 쓸 수 있다. 헤더 `x-admin-token`이 일치해야 하며, 없으면 403.

```powershell
$T = "비밀번호"; $A = "https://hotdeal-hub-worker.increw01.workers.dev"
curl.exe -s -H "x-admin-token: $T" "$A/__admin/sources"                 # 소스별 상태 + 마지막 오류
curl.exe -s -H "x-admin-token: $T" "$A/__admin/run"                     # 수집 1회 즉시 실행
curl.exe -s -H "x-admin-token: $T" "$A/__admin/fetch?source=ppomppu"    # 한 소스만 가져와 파싱 결과 확인
curl.exe -s -H "x-admin-token: $T" "$A/__admin/probe?url=https://www.ppomppu.co.kr/rss.php?id=ppomppu"  # Worker 관점의 원본 응답
curl.exe -s -H "x-admin-token: $T" "$A/__admin/queue"                   # 파싱 실패 큐
curl.exe -s -H "x-admin-token: $T" "$A/__admin/reset"                   # 서킷 브레이커 일시 중지 해제 (?source=슬러그 로 하나만)
curl.exe -s -H "x-admin-token: $T" "$A/__admin/probe?url=…&ua=feed&h=Referer:https://www.ppomppu.co.kr/"  # UA 프리셋·추가 헤더로 시험
```

봇 UA는 두 가지(`bot`, `feed`) 모두 봇임을 밝히고 연락처 URL을 포함한다. 브라우저로 위장하는 UA는 출처 정책상 쓰지 않는다.

## 7. 운영 명령 모음

```bash
cd worker
npx wrangler tail                                   # 실시간 로그
npx wrangler d1 execute hotdeal-hub --remote --command "SELECT source, consecutive_fail, paused_until, last_item_count FROM source_state"
npx wrangler d1 execute hotdeal-hub --remote --command "SELECT COUNT(*) FROM deals WHERE status!='ended'"
npx wrangler d1 execute hotdeal-hub --remote --command "SELECT source, post_id, title FROM parse_queue WHERE resolved=0 ORDER BY id DESC LIMIT 20"
# 제외 요청 반영 (D-12: 글 ID·소스만 기록)
npx wrangler d1 execute hotdeal-hub --remote --command "INSERT OR IGNORE INTO blocklist (source, post_id) VALUES ('ppomppu','123456'); DELETE FROM deal_posts WHERE source='ppomppu' AND post_id='123456'"
```

## 8. 임베드 위젯 배포 확인

- `https://<SITE>/open-data/`에서 옵션을 고르면 코드가 생성되고 미리보기가 실제 피드로 그려진다.
- 외부 사이트 테스트: 아무 HTML 파일에 아래를 넣고 연다.
  ```html
  <div data-hotdeal-widget data-brand="cultureland" data-limit="5" data-theme="auto"></div>
  <script async src="https://<SITE>/embed.js"></script>
  ```
- iframe 자동 높이: 부모 페이지에서
  ```html
  <script>addEventListener("message",e=>{if(e.data&&e.data.type==="hotdeal-widget:height"){document.querySelectorAll("iframe[src*='/embed/']").forEach(f=>{if(f.contentWindow===e.source)f.style.height=e.data.height+"px"})}})</script>
  ```
