#!/usr/bin/env node
/**
 * shared/cards.json 검사 (CI·배포 전). 문제가 있으면 목록을 출력하고 종료 코드 1.
 * 사용: node scripts/check-cards.mjs
 * 규칙: scripts/lib/cards-schema.mjs (스펙 docs/superpowers/specs/2026-10-28-card-benefits-design.md)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCards } from "./lib/cards-schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brands = JSON.parse(await readFile(path.join(root, "shared/brands.json"), "utf8"));
const doc = JSON.parse(await readFile(path.join(root, "shared/cards.json"), "utf8"));
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST 기준 날짜

const problems = validateCards(doc, {
  merchantSlugs: new Set(brands.merchants.map((m) => m.slug)),
  issuerSlugs: new Set(brands.card_issuers.map((c) => c.slug)),
  today,
});

if (problems.length) {
  console.error("✘ 카드 데이터 검사 실패:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}
const verified = doc.cards.filter((c) => c.status === "verified").length;
console.log(`✓ cards.json: 카드 ${doc.cards.length}장, verified ${verified}장`);
