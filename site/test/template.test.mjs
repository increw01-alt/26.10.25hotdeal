// 템플릿 값 이스케이프 (코드 리뷰 I3: 글 제목이 그대로 HTML·JSON-LD 로 들어가면 안 된다)
import { test } from "node:test";
import assert from "node:assert/strict";
import { raw, renderValue, jsonLdText } from "../scripts/lib/template.mjs";

test("보통 문자열은 이스케이프한다", () => {
  assert.equal(renderValue('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  assert.equal(renderValue(null), ""); assert.equal(renderValue(undefined), ""); assert.equal(renderValue(0), "0");
});
test("raw() 로 감싼 값만 그대로 내보낸다", () => {
  assert.equal(renderValue(raw("<li>ok</li>")), "<li>ok</li>");
});
test("'raw:' 로 시작하는 글 제목은 그대로 내보내지 않는다", () => {
  assert.equal(renderValue("raw:<img src=x onerror=alert(1)>"), "raw:&lt;img src=x onerror=alert(1)&gt;");
});
test("JSON-LD 안의 </script> 는 스크립트 블록을 닫지 못한다", () => {
  const text = jsonLdText({ name: "</script><script>alert(2)</script>" });
  assert.ok(!text.includes("</script>")); assert.ok(!text.includes("<"));
  assert.equal(JSON.parse(text)["@graph"].name, "</script><script>alert(2)</script>");
});
