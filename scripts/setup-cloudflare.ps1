<#
Cloudflare 초기 설정 (Windows PowerShell). 한 번만 실행하면 되고, 다시 실행해도 안전하다.
사용: powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflare.ps1 [-PagesProject hotdeal-hub]
#>
param([string]$PagesProject = "hotdeal-hub")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DbName = "hotdeal-hub"
function Step($m) { Write-Host "`n▶ $m" -ForegroundColor Cyan }

Step "1/8 의존성 설치"
Push-Location "$Root\worker"; npm ci --no-audit --no-fund; Pop-Location
Push-Location "$Root\site";   npm ci --no-audit --no-fund; Pop-Location

Step "2/8 Cloudflare 로그인 확인"
Push-Location "$Root\worker"
try { npx wrangler whoami | Out-Null } catch { npx wrangler login }
npx wrangler whoami | Select-Object -First 5

Step "3/8 D1 데이터베이스 ($DbName)"
$list = (npx wrangler d1 list --json | ConvertFrom-Json)
$db = $list | Where-Object { $_.name -eq $DbName }
if (-not $db) { npx wrangler d1 create $DbName | Out-Host; $db = (npx wrangler d1 list --json | ConvertFrom-Json) | Where-Object { $_.name -eq $DbName } }
$DbId = $db.uuid
Write-Host "database_id = $DbId"
$toml = Get-Content "$Root\worker\wrangler.toml" -Raw
$toml = [regex]::Replace($toml, 'database_id = "[^"]*"', "database_id = `"$DbId`"")
Set-Content "$Root\worker\wrangler.toml" $toml -NoNewline

Step "4/8 D1 스키마 적용(멱등)"
npx wrangler d1 execute $DbName --remote --file=./schema.sql | Out-Null; Write-Host "✔ schema applied"

Step "5/8 시크릿 (텔레그램 알림, 비워두면 건너뜀)"
$tg = Read-Host "TELEGRAM_BOT_TOKEN (Enter=skip)"
if ($tg) { $tg | npx wrangler secret put TELEGRAM_BOT_TOKEN; $chat = Read-Host "TELEGRAM_CHAT_ID"; $chat | npx wrangler secret put TELEGRAM_CHAT_ID }

Step "6/8 설정 검사 + Worker 배포"
node "$Root\scripts\check-config.mjs" --worker
npm test | Out-Null; npm run typecheck | Out-Null
$deploy = npx wrangler deploy 2>&1 | Tee-Object -Variable deployOut | Out-String
$WorkerUrl = ([regex]::Match($deploy, 'https://[a-z0-9.-]+\.workers\.dev')).Value
Write-Host "Worker URL: $WorkerUrl"
Pop-Location

Step "7/8 Pages 프로젝트 ($PagesProject)"
Push-Location "$Root\worker"
$projects = npx wrangler pages project list 2>&1 | Out-String
if ($projects -notmatch [regex]::Escape($PagesProject)) { npx wrangler pages project create $PagesProject --production-branch=main }
Pop-Location

Step "8/8 사이트 첫 배포 (API에 딜이 없으면 샘플 데이터)"
Push-Location "$Root\site"
if ($WorkerUrl) { $env:API_BASE = $WorkerUrl }
node scripts/build.mjs
if ($LASTEXITCODE -ne 0) { $env:ALLOW_EMPTY = "1"; node scripts/build.mjs }
npm run build:css | Out-Null
npx wrangler pages deploy dist --project-name=$PagesProject --branch=main --commit-dirty=true
Pop-Location

Write-Host @"

✔ 완료. 다음을 마무리하세요.
  1) shared/site.config.json 의 siteUrl / apiBase 를 실제 주소로 바꾸고 커밋
     - apiBase: $WorkerUrl
     - siteUrl: https://$PagesProject.pages.dev  또는 커스텀 도메인
  2) GitHub 저장소 Settings → Secrets and variables → Actions
     - Secrets : CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, (선택) TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
     - Variables: CF_PAGES_PROJECT=$PagesProject, API_BASE=$WorkerUrl
  3) 커스텀 도메인: docs/DEPLOY.md 4단계
"@
