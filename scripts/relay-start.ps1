<#
중계 수집기 실행 (Windows). Worker IP가 차단된 커뮤니티(뽐뿌·루리웹)를 이 PC에서 가져와 Worker로 보낸다.
사용:  powershell -ExecutionPolicy Bypass -File scripts\relay-start.ps1 -Token <ADMIN_TOKEN>
       -Once      : 한 번만 실행하고 종료(점검용)
       -Interval  : 반복 주기(초, 기본 60)
       -Sources   : 기본 "ppomppu,ruliweb"
토큰은 명령줄 대신 환경변수 RELAY_TOKEN 으로 줄 수도 있다. 창을 닫으면 멈춘다. 자동 시작은 docs/DEPLOY.md 참고.
#>
param(
  [string]$Token = $env:RELAY_TOKEN,
  [string]$Api = "https://hotdeal-hub-worker.increw01.workers.dev",
  [string]$Sources = "ppomppu,ruliweb",
  [int]$Interval = 60,
  [switch]$Once
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
if (-not $Token) { $sec = Read-Host "ADMIN_TOKEN" -AsSecureString; $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)) }
$Root = Split-Path -Parent $PSScriptRoot
Push-Location "$Root\worker"
if (-not (Test-Path "node_modules")) { npm ci --no-audit --no-fund }
if (-not (Test-Path "dist\relay.mjs") -or (Get-Item "src\relay.ts").LastWriteTime -gt (Get-Item "dist\relay.mjs").LastWriteTime) { npm run build:relay | Out-Null }
$env:RELAY_TOKEN = $Token
$argsList = @("dist\relay.mjs", "--api", $Api, "--sources", $Sources)
if (-not $Once) { $argsList += @("--loop", "$Interval") }
Write-Host "중계 시작: $Sources → $Api $(if ($Once) {'(1회)'} else {"($Interval 초마다, Ctrl+C로 종료)"})" -ForegroundColor Cyan
& node @argsList
Pop-Location
