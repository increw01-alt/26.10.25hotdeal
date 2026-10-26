/* /open-data/ 임베드 코드 생성기: 옵션 선택 → 스니펫 갱신 + 라이브 미리보기 */
(function () {
  "use strict";
  try {
    var form = document.querySelector("[data-embed-config]");
    if (!form) return;
    var siteUrl = form.getAttribute("data-site-url");
    var outScript = document.querySelector("[data-embed-out=script]");
    var outIframe = document.querySelector("[data-embed-out=iframe]");
    var preview = document.querySelector("[data-embed-preview]");
    var copyBtns = document.querySelectorAll("[data-copy]");
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

    function update() {
      var brand = form.brand.value, limit = form.limit.value, theme = form.theme.value, compact = form.compact.checked;
      var attrs = ' data-hotdeal-widget' + (brand ? ' data-brand="' + brand + '"' : "") + ' data-limit="' + limit + '"' + (theme !== "light" ? ' data-theme="' + theme + '"' : "") + (compact ? " data-compact" : "");
      outScript.textContent = "<div" + attrs + "></div>\n<script async src=\"" + siteUrl + "/embed.js\"></script>";
      var q = [];
      if (limit !== "5") q.push("limit=" + limit);
      if (theme !== "light") q.push("theme=" + theme);
      if (compact) q.push("compact=1");
      var src = siteUrl + "/embed/" + (brand ? brand + "/" : "") + (q.length ? "?" + q.join("&") : "");
      var height = compact ? 40 + Number(limit) * 38 + 30 : 48 + Number(limit) * 58 + 34;
      outIframe.textContent = '<iframe src="' + src + '" width="100%" height="' + height + '" loading="lazy" title="상품권 핫딜 위젯" style="border:0;max-width:480px"></iframe>';
      if (preview) {
        preview.innerHTML = "<div" + attrs + ' data-static="/api/deals.json"></div>';
        if (window.HotdealWidget) window.HotdealWidget.init();
      }
    }
    form.addEventListener("change", update);
    form.addEventListener("input", update);
    Array.prototype.forEach.call(copyBtns, function (btn) {
      btn.addEventListener("click", function () {
        var target = document.querySelector(btn.getAttribute("data-copy"));
        if (!target || !navigator.clipboard) return;
        navigator.clipboard.writeText(target.textContent).then(function () {
          var old = btn.textContent; btn.textContent = "복사됨"; setTimeout(function () { btn.textContent = old; }, 1500);
        }).catch(function () {});
      });
    });
    // embed.js 로드 이후 초기화 (async)
    var tries = 0; (function waitWidget() { if (window.HotdealWidget || tries++ > 50) update(); else setTimeout(waitWidget, 100); })();
  } catch (e) { console.error("[embed-config]", e); }
})();
