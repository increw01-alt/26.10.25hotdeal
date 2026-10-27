#!/usr/bin/env bash
# Cloudflare 초기 설정 (WSL2 Ubuntu / macOS / Linux). 한 번만 실행하면 되고, 다시 실행해도 안전하다.
# 하는 일: 로그인 확인 → D1 생성(없으면) → wrangler.toml database_id 기입 → 스키마 적용 → 시크릿 입력 → Worker 배포 → Pages 프로젝트 생성 → 샘플 데이터로 첫 배포
# 사용: bash scripts/setup-cloudflare.sh [pages-project-name]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAGES_PROJECT="${1:-hotdeal-hub}"
DB_NAME="hotdeal-hub"

step() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "✘ $1 이(가) 필요합니다"; exit 1; }; }
need node; need npm

step "1/8 의존성 설치"
(cd "$ROOT/worker" && npm ci --no-audit --no-fund)
(cd "$ROOT/site" && npm ci --no-audit --no-fund)
W="npx --prefix $ROOT/worker wrangler"

step "2/8 Cloudflare 인증 (API 토큰)"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  read -r -s -p "CLOUDFLARE_API_TOKEN (대시보드에서 만든 토큰 붙여넣기, 화면에 안 보임): " CLOUDFLARE_API_TOKEN; echo
  export CLOUDFLARE_API_TOKEN
fi
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  read -r -p "CLOUDFLARE_ACCOUNT_ID (32자리): " CLOUDFLARE_ACCOUNT_ID; export CLOUDFLARE_ACCOUNT_ID
fi
$W whoami | head -8 || { echo "✘ 토큰 인증 실패"; exit 1; }

step "3/8 D1 데이터베이스 ($DB_NAME)"
DB_ID="$($W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const r=a.find(x=>x.name===process.argv[1]);console.log(r?r.uuid:"")}catch{console.log("")}})' "$DB_NAME")"
if [ -z "$DB_ID" ]; then
  $W d1 create "$DB_NAME" | tee /tmp/d1-create.log
  DB_ID="$(grep -oE 'database_id = "[0-9a-f-]+"' /tmp/d1-create.log | grep -oE '[0-9a-f-]{36}' | head -1 || true)"
  [ -z "$DB_ID" ] && DB_ID="$($W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log(a.find(x=>x.name===process.argv[1]).uuid)})' "$DB_NAME")"
fi
echo "database_id = $DB_ID"
sed -i.bak -E "s/^database_id = \"[^\"]*\"/database_id = \"$DB_ID\"/" "$ROOT/worker/wrangler.toml" && rm -f "$ROOT/worker/wrangler.toml.bak"

step "4/8 D1 스키마 적용(멱등)"
(cd "$ROOT/worker" && npx wrangler d1 execute "$DB_NAME" --remote --file=./schema.sql >/dev/null) && echo "✔ schema applied"

step "5/8 시크릿 (텔레그램 알림, 비워두면 건너뜀)"
read -r -p "TELEGRAM_BOT_TOKEN (Enter=skip): " TG_TOKEN || true
if [ -n "${TG_TOKEN:-}" ]; then
  printf '%s' "$TG_TOKEN" | (cd "$ROOT/worker" && npx wrangler secret put TELEGRAM_BOT_TOKEN)
  read -r -p "TELEGRAM_CHAT_ID: " TG_CHAT
  printf '%s' "$TG_CHAT" | (cd "$ROOT/worker" && npx wrangler secret put TELEGRAM_CHAT_ID)
fi

step "6/8 설정값 채우기 + Worker 배포"
SITE_URL="https://$PAGES_PROJECT.pages.dev"
SITE_CFG="$ROOT/shared/site.config.json"
if grep -q REPLACE_ "$ROOT/worker/wrangler.toml" "$SITE_CFG"; then
  read -r -p "사이트 이름 (Enter=핫딜 허브): " SITE_NAME; SITE_NAME="${SITE_NAME:-핫딜 허브}"
  read -r -p "운영자 표기 이름 (Enter=$SITE_NAME 운영팀): " OP_NAME; OP_NAME="${OP_NAME:-$SITE_NAME 운영팀}"
  read -r -p "문의 이메일: " OP_EMAIL; OP_EMAIL="${OP_EMAIL:-contact@example.com}"
  for f in "$ROOT/worker/wrangler.toml" "$SITE_CFG"; do
    sed -i.bak -e "s|https://REPLACE_WITH_SITE_URL/about/bot|$SITE_URL/about/|g" -e "s|https://REPLACE_WITH_SITE_URL|$SITE_URL|g" \
      -e "s|REPLACE_SITE_NAME|$SITE_NAME|g" -e "s|REPLACE_OPERATOR_NAME|$OP_NAME|g" -e "s|REPLACE_CONTACT_EMAIL|$OP_EMAIL|g" "$f" && rm -f "$f.bak"
  done
  echo "✔ 설정값 기입: $SITE_NAME / $SITE_URL / $OP_EMAIL"
fi
node "$ROOT/scripts/check-config.mjs" --worker
(cd "$ROOT/worker" && npm test >/dev/null && npm run typecheck >/dev/null && npx wrangler deploy | tee /tmp/worker-deploy.log)
WORKER_URL="$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' /tmp/worker-deploy.log | head -1 || true)"
[ -z "$WORKER_URL" ] && { echo "✘ 배포 출력에서 Worker URL을 찾지 못했습니다"; exit 1; }
echo "Worker URL: $WORKER_URL"
sed -i.bak "s|https://REPLACE_WITH_WORKER_URL|$WORKER_URL|g" "$SITE_CFG" && rm -f "$SITE_CFG.bak"
node "$ROOT/scripts/check-config.mjs" --site

step "7/8 Pages 프로젝트 ($PAGES_PROJECT)"
if ! $W pages project list 2>/dev/null | grep -q "$PAGES_PROJECT"; then
  $W pages project create "$PAGES_PROJECT" --production-branch=main
fi

step "8/8 사이트 첫 배포 (API에 딜이 없으면 샘플 데이터)"
cd "$ROOT/site"
if [ -n "${WORKER_URL:-}" ]; then
  API_BASE="$WORKER_URL" node scripts/build.mjs || ALLOW_EMPTY=1 API_BASE="$WORKER_URL" node scripts/build.mjs
else
  node scripts/build.mjs || ALLOW_EMPTY=1 node scripts/build.mjs
fi
npm run build:css >/dev/null
npx wrangler pages deploy dist --project-name="$PAGES_PROJECT" --branch=main --commit-dirty=true

cat <<MSG

✔ 완료.
  사이트: $SITE_URL
  API:    $WORKER_URL  (상태: $WORKER_URL/api/status.json)

다음을 마무리하세요.
  1) 자동으로 채운 설정값 커밋: git add -A && git commit -m "배포 설정값 입력" && git push
  2) GitHub 저장소 Settings → Secrets and variables → Actions
     - Secrets : CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, (선택) TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
     - Variables: CF_PAGES_PROJECT=$PAGES_PROJECT, API_BASE=${WORKER_URL:-https://api.<도메인>}
  3) 커스텀 도메인: docs/DEPLOY.md 4단계
MSG
