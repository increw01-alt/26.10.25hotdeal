/**
 * 템플릿 값 처리. 커뮤니티 글 제목처럼 밖에서 온 문자열은 모두 이스케이프한다.
 * 이미 이스케이프한 HTML 조각만 raw() 로 감싸서 넘긴다.
 * (예전에는 "raw:" 로 시작하는 문자열을 그대로 내보냈다. 제목이 "raw:<img …>" 인 글이 그대로 HTML 이 될 수 있었다.)
 */
import { esc } from "./card-benefits.mjs";

const RAW = Symbol("raw-html");

/** 이미 안전한 HTML 조각임을 표시한다 */
export const raw = (html) => ({ [RAW]: String(html ?? "") });

/** 템플릿 자리에 넣을 문자열: raw() 값은 그대로, 나머지는 이스케이프 */
export function renderValue(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "object" && RAW in v) return v[RAW];
  return esc(v);
}

/** <script type="application/ld+json"> 안에 넣을 JSON. "<" 를 유니코드 이스케이프로 바꿔 </script> 로 블록이 닫히지 않게 한다 */
export function jsonLdText(graph) {
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}
