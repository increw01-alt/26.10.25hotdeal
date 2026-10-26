/* 임베드 위젯 (D-04)
 * <div data-hotdeal-widget data-brand="cultureland" data-limit="5" data-theme="light|dark|auto" data-compact data-title="..."></div>
 * <script async src="https://SITE/embed.js"></script>
 * - 같은 페이지에 위젯 여러 개 가능, 스크립트는 한 번만 넣으면 됨
 * - data-api: 피드 주소 재정의(기본값은 빌드 시 주입), data-static: API 실패 시 대체 정적 피드
 * - iframe 안에서 실행되면 부모 창에 높이를 postMessage로 알림 ({type:"hotdeal-widget:height", height})
 */
(function () {
  "use strict";
  var script = document.currentScript || (function () { var s = document.getElementsByTagName("script"); return s[s.length - 1]; })();
  var origin = (function () { try { return new URL(script.src, location.href).origin; } catch (e) { return ""; } })();
  var DEFAULT_API = script.getAttribute("data-api") || "__API_BASE__";
  var SITE_NAME = "__SITE_NAME__";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var krw = function (n) { return n == null ? "—" : Number(n).toLocaleString("ko-KR") + "원"; };
  var fmtTime = function (iso) { try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

  var THEMES = {
    light: { bg: "#ffffff", fg: "#0f172a", muted: "#64748b", faint: "#94a3b8", line: "#e2e8f0", head: "#f8fafc", accent: "#1d58f0", chip: "#eef6ff" },
    dark: { bg: "#0b1220", fg: "#e2e8f0", muted: "#94a3b8", faint: "#64748b", line: "#1e293b", head: "#111a2e", accent: "#8ec2ff", chip: "#142157" }
  };
  function theme(el) {
    var t = el.getAttribute("data-theme") || "light";
    if (t === "auto") t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    return THEMES[t] || THEMES.light;
  }

  function render(el, data) {
    var c = theme(el);
    var limit = Math.max(1, Math.min(20, Number(el.getAttribute("data-limit") || 5)));
    var compact = el.hasAttribute("data-compact");
    var brand = el.getAttribute("data-brand");
    var deals = (data.deals || []).filter(function (d) { return d.status !== "ended"; }).slice(0, limit);
    var head = el.getAttribute("data-title") || (brand && deals[0] ? deals[0].brand_name + " 핫딜" : brand ? "핫딜" : "상품권 핫딜 TOP " + limit);
    var more = (origin || (data.source && data.source.url) || "") + (brand ? "/brands/" + encodeURIComponent(brand) + "/" : "/");
    var font = "font:14px/1.45 -apple-system,BlinkMacSystemFont,'Pretendard Variable',Pretendard,system-ui,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;";
    var html = '<div role="region" aria-label="' + esc(head) + '" style="' + font + 'border:1px solid ' + c.line + ';border-radius:12px;overflow:hidden;background:' + c.bg + ';color:' + c.fg + ';box-sizing:border-box">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:' + (compact ? "8px 12px" : "10px 14px") + ';background:' + c.head + ';border-bottom:1px solid ' + c.line + ';font-weight:700">'
      + '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(head) + '</span>'
      + '<a href="' + esc(more) + '" target="_blank" rel="noopener" style="font-size:12px;color:' + c.accent + ';text-decoration:none;font-weight:600;white-space:nowrap">더 보기 →</a></div>';
    if (!deals.length) html += '<p style="margin:0;padding:16px;color:' + c.muted + ';font-size:13px">지금 진행 중인 딜이 없습니다.</p>';
    deals.forEach(function (d) {
      var cond = [d.card_benefit, d.limit_per_person && "한도 " + d.limit_per_person].filter(Boolean).join(" · ");
      var status = d.status === "ending" ? '<span style="font-size:10px;padding:1px 6px;border-radius:999px;background:' + c.chip + ';color:' + c.accent + ';margin-left:6px;vertical-align:middle">종료 임박</span>' : "";
      html += '<a href="' + esc((origin || "") + "/deal/" + d.id + "/") + '" target="_blank" rel="noopener" style="display:block;padding:' + (compact ? "7px 12px" : "10px 14px") + ';border-bottom:1px solid ' + c.line + ';text-decoration:none;color:inherit">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.brand_name || d.brand) + (d.merchant_name || d.merchant ? ' · ' + esc(d.merchant_name || d.merchant) : "") + status + '</span>'
        + '<span style="font-weight:700;color:' + c.accent + ';white-space:nowrap">' + esc(d.discount_rate != null ? d.discount_rate + "%" : "") + '</span></div>'
        + (compact ? "" : '<div style="font-size:12px;color:' + c.muted + ';margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(krw(d.sale_price)) + (d.face_value ? " / 액면 " + esc(krw(d.face_value)) : "") + (cond ? " · " + esc(cond) : "") + '</div>')
        + '</a>';
    });
    html += '<div style="display:flex;justify-content:space-between;gap:8px;padding:' + (compact ? "6px 12px" : "8px 14px") + ';font-size:11px;color:' + c.faint + ';background:' + c.head + '"><span>출처: <a href="' + esc(origin || "/") + '" target="_blank" rel="noopener" style="color:' + c.muted + '">' + esc(SITE_NAME) + '</a></span>'
      + (data.last_updated ? '<span>갱신 ' + esc(fmtTime(data.last_updated)) + '</span>' : "") + '</div></div>';
    el.innerHTML = html;
    el.setAttribute("data-rendered", "1");
    notifyHeight();
  }

  function notifyHeight() {
    try {
      if (window.parent === window) return;
      var h = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: "hotdeal-widget:height", height: h, name: window.name || "" }, "*");
    } catch (e) { /* ignore */ }
  }

  function load(el) {
    if (el.getAttribute("data-loading")) return;
    el.setAttribute("data-loading", "1");
    var brand = el.getAttribute("data-brand");
    var api = el.getAttribute("data-api") || DEFAULT_API;
    var urls = [];
    if (api && !/__API/.test(api) && !/REPLACE_/.test(api)) urls.push(brand ? api + "/api/brands/" + encodeURIComponent(brand) + ".json?limit=20" : api + "/api/deals.json?limit=20");
    var st = el.getAttribute("data-static"); if (st) urls.push(/^https?:/.test(st) ? st : (origin || "") + st);
    if (!urls.length) { el.innerHTML = ""; return; }
    var c = theme(el);
    el.innerHTML = '<div style="padding:14px;border:1px solid ' + c.line + ';border-radius:12px;color:' + c.faint + ';font:13px sans-serif;background:' + c.bg + '">핫딜 불러오는 중…</div>';
    (function tryNext(i) {
      if (i >= urls.length) { el.innerHTML = '<p style="font:13px sans-serif;color:' + c.faint + ';margin:0">핫딜 정보를 불러오지 못했습니다.</p>'; notifyHeight(); return; }
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
      fetch(urls[i], ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (data) {
          clearTimeout(t);
          if (brand) data.deals = (data.deals || []).filter(function (d) { return d.brand === brand; });
          render(el, data);
        })
        .catch(function () { clearTimeout(t); tryNext(i + 1); });
    })(0);
  }

  function init() {
    try { Array.prototype.forEach.call(document.querySelectorAll("[data-hotdeal-widget]"), load); } catch (e) { console.error("[hotdeal-widget]", e); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.addEventListener("resize", notifyHeight);
  // 외부에서 동적으로 추가한 위젯을 수동 초기화할 때: window.HotdealWidget.init()
  window.HotdealWidget = { init: init, version: "0.3" };
})();
