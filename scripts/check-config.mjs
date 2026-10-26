#!/usr/bin/env node
/**
 * 배포 전 설정 검사 (preflight). REPLACE_ 플레이스홀더가 남아 있으면 실패한다.
 * 사용: node scripts/check-config.mjs [--site] [--worker]   (옵션 없으면 둘 다)
 * 환경변수 API_BASE가 있으면 site.config.json의 apiBase 대신 그 값을 검사한다.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const checkSite = args.size === 0 || args.has("--site");
const checkWorker = args.size === 0 || args.has("--worker");
const problems = [];

if (checkSite) {
  const cfg = JSON.parse(await readFile(path.join(root, "shared/site.config.json"), "utf8"));
  const apiBase = process.env.API_BASE || cfg.apiBase;
  for (const [k, v] of [["siteName", cfg.siteName], ["siteUrl", cfg.siteUrl], ["apiBase", apiBase], ["operator.name", cfg.operator?.name], ["operator.email", cfg.operator?.email]]) {
    if (!v || /REPLACE_/.test(v)) problems.push(`shared/site.config.json: ${k} 값을 채워야 합니다 (현재: ${v})`);
  }
  if (cfg.siteUrl && !/^https:\/\/[^/]+$/.test(cfg.siteUrl)) problems.push(`siteUrl은 https:// 로 시작하고 끝에 / 가 없어야 합니다 (현재: ${cfg.siteUrl})`);
  if (apiBase && /\/$/.test(apiBase)) problems.push(`apiBase 끝의 / 를 제거하세요 (현재: ${apiBase})`);
  if (cfg.rates?.enabled && /REPLACE_/.test(cfg.rates.jsonUrl ?? "")) problems.push("rates.enabled=true 인데 rates.jsonUrl이 비어 있습니다");
}
if (checkWorker) {
  const toml = await readFile(path.join(root, "worker/wrangler.toml"), "utf8");
  if (/database_id\s*=\s*"REPLACE_/.test(toml)) problems.push("worker/wrangler.toml: database_id를 채워야 합니다 (npm run db:create 출력값)");
  for (const key of ["SITE_NAME", "SITE_URL", "USER_AGENT"]) {
    const m = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
    if (!m || /REPLACE_/.test(m[1])) problems.push(`worker/wrangler.toml: [vars] ${key} 값을 채워야 합니다`);
  }
  if (/^RATES_ENABLED\s*=\s*"true"/m.test(toml) && /^RATES_JSON_URL\s*=\s*"https:\/\/REPLACE_/m.test(toml)) problems.push("worker/wrangler.toml: RATES_ENABLED=true 인데 RATES_JSON_URL이 비어 있습니다");
}

if (problems.length) {
  console.error("✘ 설정 검사 실패:\n" + problems.map((p) => "  - " + p).join("\n") + "\n\n자세한 순서: docs/DEPLOY.md");
  process.exit(1);
}
console.log("✔ 설정 검사 통과" + (checkSite ? " (site)" : "") + (checkWorker ? " (worker)" : ""));
