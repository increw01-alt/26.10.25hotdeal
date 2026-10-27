<#
Cloudflare 초기 설정 (Windows PowerShell 5.1 / PowerShell 7). 한 번만 실행하면 되고, 다시 실행해도 안전하다.
사용: powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflare.ps1 [-PagesProject hotdeal-hub]
인증: 실행 중 API 토큰과 Account ID를 물어본다(브라우저 로그인 불필요).
      미리 $env:CLOUDFLARE_API_TOKEN / $env:CLOUDFLARE_ACCOUNT_ID 를 설정해 두면 묻지 않는다.
#>
param([string]$PagesProject = "hotdeal-hub")
$ErrorActionPreference = "Stop"

# --- 한글 깨짐 방지: 콘솔·파일 모두 UTF-8 ---
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

$Root = Split-Path -Parent $PSScriptRoot
$DbName = "hotdeal-hub"
$Toml = Join-Path $Root "worker\wrangler.toml"

function Step($m) { Write-Host "`n▶ $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`n✘ $m" -ForegroundColor Red; exit 1 }
function Run([string]$Label, [scriptblock]$Cmd) {
  # 네이티브 명령의 실패(종료코드≠0)를 잡아서 멈춘다 ($ErrorActionPreference만으로는 안 잡힘)
  $global:LASTEXITCODE = 0
  & $Cmd
  if ($LASTEXITCODE -ne 0) { Fail "$Label 실패 (exit $LASTEXITCODE). 위의 오류 메시지를 확인하세요." }
}
$SiteCfg = Join-Path $Root "shared\site.config.json"
function ReplaceInFile($path, [hashtable]$map) {
  $t = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  foreach ($k in $map.Keys) { $t = $t.Replace($k, [string]$map[$k]) }
  [System.IO.File]::WriteAllText($path, $t, $Utf8NoBom)
}
function HasPlaceholder($path) { ([System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)) -match "REPLACE_" }
function ReadToml { [System.IO.File]::ReadAllText($Toml, [System.Text.Encoding]::UTF8) }
function WriteToml($text) { [System.IO.File]::WriteAllText($Toml, $text, $Utf8NoBom) }

# 깨진 wrangler.toml 복구(이전 실행에서 인코딩이 손상된 경우)
$tomlText = ReadToml
if ($tomlText -match "[�]" -or $tomlText -notmatch 'RATES_SOURCE_NAME = "') {
  Write-Host "wrangler.toml 인코딩 손상 감지 → git에서 복구" -ForegroundColor Yellow
  Push-Location $Root; git checkout -- worker/wrangler.toml; Pop-Location
}

Step "1/8 의존성 설치"
Push-Location "$Root\worker"; Run "worker npm ci" { npm ci --no-audit --no-fund }; Pop-Location
Push-Location "$Root\site";   Run "site npm ci"   { npm ci --no-audit --no-fund }; Pop-Location

Step "2/8 Cloudflare 인증 (API 토큰)"
Push-Location "$Root\worker"
if (-not $env:CLOUDFLARE_API_TOKEN) {
  Write-Host "Cloudflare 대시보드에서 만든 API 토큰을 붙여 넣으세요 (입력해도 화면에 안 보입니다)."
  $sec = Read-Host "CLOUDFLARE_API_TOKEN" -AsSecureString
  $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
  $env:CLOUDFLARE_ACCOUNT_ID = (Read-Host "CLOUDFLARE_ACCOUNT_ID (대시보드 오른쪽 '계정 세부 정보'의 32자리)").Trim()
}
$who = npx wrangler whoami 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $who -match "not authenticated|ERROR") { Write-Host $who; Fail "토큰 인증 실패. 토큰을 다시 확인하세요 (권한: Workers 편집 + Cloudflare Pages 편집 + D1 편집)." }
Write-Host ($who -split "`n" | Select-String "Account|account|email" | Select-Object -First 3 | Out-String)

Step "3/8 D1 데이터베이스 ($DbName)"
$listJson = npx wrangler d1 list --json 2>$null | Out-String
if ($LASTEXITCODE -ne 0 -or -not $listJson.Trim()) { Fail "D1 목록 조회 실패. 토큰에 'D1: 편집' 권한이 있는지 확인하세요." }
$db = ($listJson | ConvertFrom-Json) | Where-Object { $_.name -eq $DbName }
if (-not $db) {
  Run "D1 생성" { npx wrangler d1 create $DbName | Out-Host }
  $db = ((npx wrangler d1 list --json | Out-String) | ConvertFrom-Json) | Where-Object { $_.name -eq $DbName }
}
if (-not $db -or -not $db.uuid) { Fail "D1 database_id를 얻지 못했습니다." }
$DbId = $db.uuid
Write-Host "database_id = $DbId"
WriteToml ([regex]::Replace((ReadToml), 'database_id = "[^"]*"', "database_id = `"$DbId`""))

Step "4/8 D1 스키마 적용(멱등)"
Run "D1 스키마" { npx wrangler d1 execute $DbName --remote --file=./schema.sql | Out-Null }
Write-Host "✔ schema applied"

Step "5/8 시크릿 (텔레그램 알림, 비워두면 건너뜀)"
$tg = Read-Host "TELEGRAM_BOT_TOKEN (Enter=skip)"
if ($tg) {
  $tg | npx wrangler secret put TELEGRAM_BOT_TOKEN
  $chat = Read-Host "TELEGRAM_CHAT_ID"
  $chat | npx wrangler secret put TELEGRAM_CHAT_ID
}

Step "6/8 설정값 채우기 + Worker 배포"
$SiteUrl = "https://$PagesProject.pages.dev"
if ((HasPlaceholder $Toml) -or (HasPlaceholder $SiteCfg)) {
  Write-Host "사이트 기본 정보를 입력하세요. 나중에 shared/site.config.json, worker/wrangler.toml 에서 바꿀 수 있습니다."
  $SiteName = Read-Host "사이트 이름 (Enter=핫딜 허브)"; if (-not $SiteName) { $SiteName = "핫딜 허브" }
  $OpName   = Read-Host "운영자 표기 이름 (Enter=$SiteName 운영팀)"; if (-not $OpName) { $OpName = "$SiteName 운영팀" }
  $OpEmail  = Read-Host "문의 이메일"; if (-not $OpEmail) { $OpEmail = "contact@example.com" }
  $map = @{
    "REPLACE_SITE_NAME" = $SiteName
    "https://REPLACE_WITH_SITE_URL/about/bot" = "$SiteUrl/about/"
    "https://REPLACE_WITH_SITE_URL" = $SiteUrl
    "REPLACE_OPERATOR_NAME" = $OpName
    "REPLACE_CONTACT_EMAIL" = $OpEmail
  }
  ReplaceInFile $Toml $map
  ReplaceInFile $SiteCfg $map
  Write-Host "✔ 설정값 기입: $SiteName / $SiteUrl / $OpEmail" -ForegroundColor Green
}
Run "설정 검사" { node "$Root\scripts\check-config.mjs" --worker }
Run "테스트" { npm test | Out-Null }
Run "타입검사" { npm run typecheck | Out-Null }
$deployOut = npx wrangler deploy 2>&1 | Tee-Object -Variable deployLines | Out-String
Write-Host $deployOut
if ($LASTEXITCODE -ne 0) { Fail "Worker 배포 실패" }
$WorkerUrl = ([regex]::Match($deployOut, 'https://[a-z0-9.-]+\.workers\.dev')).Value
if (-not $WorkerUrl) { Fail "배포 출력에서 Worker URL을 찾지 못했습니다. 위 출력의 https://...workers.dev 주소를 shared/site.config.json 의 apiBase 에 직접 넣어 주세요." }
Write-Host "Worker URL: $WorkerUrl" -ForegroundColor Green
ReplaceInFile $SiteCfg @{ "https://REPLACE_WITH_WORKER_URL" = $WorkerUrl }
Pop-Location

Step "7/8 Pages 프로젝트 ($PagesProject)"
Push-Location "$Root\worker"
$projects = npx wrangler pages project list 2>&1 | Out-String
if ($projects -notmatch [regex]::Escape($PagesProject)) { Run "Pages 프로젝트 생성" { npx wrangler pages project create $PagesProject --production-branch=main } }
Pop-Location

Step "8/8 사이트 첫 배포 (API에 딜이 없으면 샘플 데이터)"
Push-Location "$Root\site"
$env:API_BASE = $WorkerUrl
Run "설정 검사(site)" { node "$Root\scripts\check-config.mjs" --site }
node scripts/build.mjs
if ($LASTEXITCODE -ne 0) { Write-Host "API에 아직 딜이 없어 샘플 데이터로 빌드합니다." -ForegroundColor Yellow; $env:ALLOW_EMPTY = "1"; Run "빌드" { node scripts/build.mjs } }
Run "CSS 빌드" { npm run build:css | Out-Null }
Run "Pages 배포" { npx wrangler pages deploy dist --project-name=$PagesProject --branch=main --commit-dirty=true }
Pop-Location

Write-Host @"

✔ 완료.
  사이트:  $SiteUrl
  API:     $WorkerUrl   (상태: $WorkerUrl/api/status.json)

다음을 마무리하세요.
  1) 방금 자동으로 채운 설정값을 저장소에 올립니다.
       git add -A
       git commit -m "배포 설정값 입력"
       git push
  2) GitHub 저장소 Settings → Secrets and variables → Actions
     - Secrets : CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, (선택) TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
     - Variables: CF_PAGES_PROJECT=$PagesProject, API_BASE=$WorkerUrl
  3) main 브랜치 생성: git checkout -b main ; git push -u origin main
  4) 커스텀 도메인: docs/DEPLOY.md 4단계
"@ -ForegroundColor Green
