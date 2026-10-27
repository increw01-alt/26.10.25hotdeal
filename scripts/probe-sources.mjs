#!/usr/bin/env node
/**
 * 커뮤니티 소스 접근성 조사. 후보 URL × User-Agent 조합으로 요청해 상태·응답 형식·글 개수를 기록한다.
 * 사용: node scripts/probe-sources.mjs            → 결과를 화면과 probe-result.txt(UTF-8)에 기록
 * 네트워크가 허용된 PC에서 실행한다. 어떤 주소·UA가 통하는지 보고 shared/sources.json 과 fetchers 를 맞춘다.
 */
import { writeFile } from "node:fs/promises";

const UAS = {
  bot: "HotdealHubBot/0.1 (+https://hotdeal-hub.pages.dev/about/)",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  feed: "Mozilla/5.0 (compatible; FeedFetcher/1.0; +https://hotdeal-hub.pages.dev/about/)",
};
const CANDIDATES = [
  ["ppomppu", "https://www.ppomppu.co.kr/rss.php?id=ppomppu"],
  ["ppomppu", "https://www.ppomppu.co.kr/zboard/zboard.php?id=ppomppu"],
  ["ppomppu", "https://www.ppomppu.co.kr/rss.php?id=coupon"],
  ["ppomppu", "https://www.ppomppu.co.kr/rss.php?id=money"],
  ["ppomppu", "https://www.ppomppu.co.kr/rss.php?id=ppomppu4"],
  ["ppomppu", "https://www.ppomppu.co.kr/rss.php?id=ppomppu8"],
  ["ppomppu", "https://www.ppomppu.co.kr/zboard/zboard.php?id=ppomppu&category=5"],
  ["clien", "https://www.clien.net/service/rss/board/jirum"],
  ["clien", "https://www.clien.net/service/board/rss/jirum"],
  ["clien", "https://www.clien.net/service/board/jirum"],
  ["ruliweb", "https://bbs.ruliweb.com/market/board/1020/rss"],
  ["ruliweb", "https://bbs.ruliweb.com/market/board/1020"],
  ["ruliweb", "https://bbs.ruliweb.com/news/board/1020/rss"],
  ["quasarzone", "https://quasarzone.com/bbs/qb_saleinfo"],
  ["quasarzone", "https://quasarzone.com/bbs/qb_saleinfo/rss"],
  ["quasarzone", "https://quasarzone.com/rss/qb_saleinfo"],
  ["fmkorea", "https://www.fmkorea.com/hotdeal"],
  ["fmkorea", "https://www.fmkorea.com/index.php?mid=hotdeal&act=rss"],
  ["fmkorea", "https://www.fmkorea.com/rss/?mid=hotdeal"],
];

function decode(buf, ct, head) {
  const declared = /charset=([\w-]+)/i.exec(ct)?.[1] ?? /encoding="([\w-]+)"/i.exec(head)?.[1] ?? /charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try { return new TextDecoder(declared.toLowerCase()).decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}

async function probe(url, uaName) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000); const started = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UAS[uaName], accept: "application/rss+xml, application/xml, text/html, */*", "accept-language": "ko-KR,ko;q=0.9" } });
    const buf = await res.arrayBuffer(); const ct = res.headers.get("content-type") ?? "";
    const head = new TextDecoder("utf-8").decode(buf.slice(0, 2048));
    const text = decode(buf, ct, head);
    const items = (text.match(/<item\b/gi) ?? []).length + (text.match(/<entry\b/gi) ?? []).length;
    const kind = /<rss|<feed|<rdf/i.test(text.slice(0, 500)) ? "feed" : /<html/i.test(text.slice(0, 500)) ? "html" : "other";
    const botwall = /cf-browser-verification|challenge-platform|captcha|Just a moment|접근이 차단|비정상적인 접근/i.test(text) ? "BOTWALL" : "";
    const title = /<title[^>]*>([^<]{0,60})/i.exec(text)?.[1]?.trim() ?? "";
    const sample = (text.match(/<item\b[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim().slice(0, 70);
    return { status: res.status, ms: Date.now() - started, ct: ct.split(";")[0], bytes: buf.byteLength, kind, items, botwall, title, sample, finalUrl: res.url !== url ? res.url : "" };
  } catch (e) {
    return { status: "ERR", ms: Date.now() - started, error: (e.name === "AbortError" ? "timeout 20s" : e.message).slice(0, 80) };
  } finally { clearTimeout(t); }
}

const lines = [`probe ${new Date().toISOString()} node ${process.version}`];
for (const [src, url] of CANDIDATES) {
  for (const ua of Object.keys(UAS)) {
    const r = await probe(url, ua);
    const line = r.status === "ERR"
      ? `${src.padEnd(10)} ${ua.padEnd(6)} ERR   ${String(r.ms).padStart(5)}ms  ${url}  ${r.error}`
      : `${src.padEnd(10)} ${ua.padEnd(6)} ${String(r.status).padEnd(5)} ${String(r.ms).padStart(5)}ms  ${url}  ${r.kind} items=${r.items} ${r.bytes}B ${r.botwall} ${r.finalUrl ? "-> " + r.finalUrl : ""}${r.sample ? ` | ${r.sample}` : r.title ? ` | title: ${r.title}` : ""}`;
    console.log(line); lines.push(line);
  }
}
await writeFile("probe-result.txt", lines.join("\n") + "\n", "utf8");
console.log("\nsaved: probe-result.txt");
