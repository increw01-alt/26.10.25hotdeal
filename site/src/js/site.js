/* 사이트 공통 스크립트: 모바일 메뉴, 클라이언트 필터(종류 탭 포함), 갱신 지연 배너 실시간 확인 */
(function () {
  "use strict";
  try {
    var toggle = document.querySelector("[data-menu-toggle]");
    var menu = document.getElementById("mobile-menu");
    if (toggle && menu) {
      toggle.addEventListener("click", function () {
        var open = menu.classList.toggle("hidden") === false;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
      });
    }
  } catch (e) { console.error("[menu]", e); }

  try {
    var form = document.querySelector("[data-filter-form]");
    var grid = document.querySelector("[data-deal-grid]");
    var empty = document.querySelector("[data-empty]");
    if (form && grid) {
      var tabs = document.querySelectorAll("[data-kind-tab]");
      var kind = "all"; // all | gift | product
      var apply = function () {
        // 브랜드 필터는 상품권 탭에서만 쓴다(일반 딜에는 브랜드가 없다)
        var brandSel = form.brand;
        if (brandSel) {
          var giftTab = kind === "gift";
          brandSel.classList.toggle("hidden", !giftTab);
          if (!giftTab) brandSel.value = "";
        }
        var brand = brandSel ? brandSel.value : "";
        var merchant = form.merchant ? form.merchant.value : "";
        var status = form.status.value, card = form.card.value, shown = 0;
        grid.querySelectorAll("[data-deal-id]").forEach(function (el) {
          var ok = true;
          if (kind !== "all" && (el.dataset.kind || "gift") !== kind) ok = false;
          if (brand && el.dataset.brand !== brand) ok = false;
          if (merchant && el.dataset.merchant !== merchant) ok = false;
          if (status ? el.dataset.status !== status : el.dataset.status === "ended") ok = false;
          var hasCard = el.querySelector(".chip-card") !== null;
          if (card === "yes" && !hasCard) ok = false;
          if (card === "no" && hasCard) ok = false;
          el.classList.toggle("hidden", !ok);
          if (ok) shown++;
        });
        if (empty) empty.classList.toggle("hidden", shown > 0);
      };
      tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
          kind = tab.getAttribute("data-kind-tab") || "all";
          tabs.forEach(function (t) { t.setAttribute("aria-pressed", String(t === tab)); });
          apply();
        });
      });
      form.addEventListener("change", apply);
      apply();
    }
  } catch (e) { console.error("[filter]", e); }

  // 빌드 시점이 아니라 지금 기준으로 갱신 지연을 확인 (API 실패 시 조용히 무시)
  try {
    var api = document.documentElement.getAttribute("data-api-base");
    var staleHours = Number(document.documentElement.getAttribute("data-stale-hours") || 2);
    if (api && !/REPLACE_/.test(api) && typeof fetch === "function") {
      var ctrl = new AbortController(); var t = setTimeout(function () { ctrl.abort(); }, 5000);
      fetch(api + "/api/status.json", { signal: ctrl.signal }).then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
        clearTimeout(t);
        if (!s) return;
        var stale = s.stale || (s.last_updated && (Date.now() - new Date(s.last_updated).getTime()) / 36e5 > staleHours);
        var banner = document.querySelector("[data-stale-banner]");
        if (banner) banner.classList.toggle("hidden", !stale);
      }).catch(function () { clearTimeout(t); });
    }
  } catch (e) { console.error("[status]", e); }
})();
