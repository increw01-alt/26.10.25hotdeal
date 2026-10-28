#!/usr/bin/env node
/**
 * 카드 비교 사이트 크롤(API 응답 JSON 폴더)에서 판매처별 카드 후보를 뽑아 Markdown으로 쓴다. 조사용.
 * 사용: node scripts/research/cards-from-crawl.mjs <api폴더> [--out <파일>]
 * - 입력 파일은 JSON.parse로만 읽는다(코드 실행 없음). 데이터 폴더에서 인터프리터를 실행하지 않는다.
 * - 출력 기본 경로는 <api폴더>/../../candidates.md. 저장소 안 경로는 거부한다(제3자 문구를 커밋하지 않기 위해).
 * - 공개 데이터(shared/cards.json)는 이 결과를 보고 카드사 공식 페이지에서 확인한 뒤 우리 표현으로 적는다.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLiveCardRecord, matchMerchants, giftcardStance, toMarkdown, stripTags, norm } from "./lib/match.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const apiDir = args.find((a) => !a.startsWith("--"));
if (!apiDir) { console.error("사용: node scripts/research/cards-from-crawl.mjs <api폴더> [--out <파일>]"); process.exit(2); }
const outIdx = args.indexOf("--out");
const outFile = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.resolve(apiDir, "..", "..", "candidates.md"));
const rel = path.relative(root, outFile);
if (!(rel.startsWith("..") || path.isAbsolute(rel))) { console.error(`출력 경로가 저장소 안입니다: ${outFile} — 저장소 밖 경로를 --out 으로 지정하세요`); process.exit(2); }

const brands = JSON.parse(await readFile(path.join(root, "shared/brands.json"), "utf8"));
const merchants = brands.merchants;
const files = (await readdir(apiDir)).filter((f) => f.endsWith(".json"));
const cards = new Map();
let unreadable = 0;
for (const f of files) {
  let rec;
  try { rec = JSON.parse(await readFile(path.join(apiDir, f), "utf8")); } catch { unreadable++; continue; }
  if (!isLiveCardRecord(rec)) continue;
  if (!cards.has(rec.body.idx)) cards.set(rec.body.idx, rec.body);
}

const byMerchant = new Map(merchants.map((m) => [m.slug, []]));
const positives = [];
for (const b of cards.values()) {
  const infoAll = (b.key_benefit ?? []).map((k) => stripTags(k.info)).join(" ");
  const base = {
    idx: b.idx, issuer: b.corp?.name ?? "", name: b.name ?? "", type: b.cate, prevMonth: b.pre_month_money ?? 0,
    annualFee: b.annual_fee_basic ?? "", refUrl: `https://www.card-gorilla.com/card/detail/${b.idx}`, stance: giftcardStance(infoAll),
  };
  for (const m of matchMerchants(b, merchants)) {
    const def = merchants.find((x) => x.slug === m.merchant);
    const plcc = def.aliases.map(norm).filter(Boolean).some((a) => norm(b.name).includes(a));
    byMerchant.get(m.merchant).push({ ...base, merchant: m.merchant, text: m.text, plcc });
  }
  for (const k of b.key_benefit ?? []) {
    const short = giftcardStance(`${k.title ?? ""} ${k.comment ?? ""}`);
    const long = giftcardStance(stripTags(k.info));
    if (short === "positive" || long === "positive") { positives.push({ ...base, merchant: "-", text: k.comment || k.title || "", stance: "positive", plcc: false }); break; }
  }
}
for (const [slug, list] of [...byMerchant]) if (!list.length) byMerchant.delete(slug);

await writeFile(outFile, toMarkdown({ byMerchant, positives }), "utf8");
const matched = new Set([...byMerchant.values()].flat().map((c) => c.idx)).size;
console.log(`카드 ${cards.size}장 중 판매처 매칭 ${matched}장, 긍정 문맥 ${positives.length}장 → ${outFile}${unreadable ? ` (읽기 실패 ${unreadable}개 건너뜀)` : ""}`);
