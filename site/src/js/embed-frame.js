/* iframe 임베드 페이지(/embed/)의 쿼리 파라미터 → 위젯 속성 매핑.
 * 예: /embed/?brand=cultureland&limit=5&theme=dark&compact=1&title=이번주%20컬쳐랜드
 * /embed/{slug}/ 페이지는 brand가 고정되어 있고 나머지 파라미터만 반영한다. */
(function () {
  "use strict";
  try {
    var el = document.querySelector("[data-hotdeal-widget]");
    if (!el) return;
    var q = new URLSearchParams(location.search);
    var allow = { brand: /^[a-z0-9_-]{1,40}$/, limit: /^\d{1,2}$/, theme: /^(light|dark|auto)$/, title: /^.{1,60}$/ };
    Object.keys(allow).forEach(function (k) {
      var v = q.get(k);
      if (v && allow[k].test(v) && !(k === "brand" && el.getAttribute("data-brand"))) el.setAttribute("data-" + k, v);
    });
    if (q.get("compact") === "1") el.setAttribute("data-compact", "");
    var t = el.getAttribute("data-theme");
    var dark = t === "dark" || (t === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.body.style.background = dark ? "#0b1220" : "#ffffff";
  } catch (e) { console.error("[embed-frame]", e); }
})();
