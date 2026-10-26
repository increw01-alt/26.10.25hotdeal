/* 임베드 위젯 (D-04). 사용법: <div data-hotdeal-widget data-brand="cultureland" data-limit="5"></div><script async src="https://SITE/embed.js"></script> */
(function () {
  "use strict";
  var script = document.currentScript || (function () { var s = document.getElementsByTagName("script"); return s[s.length - 1]; })();
  var origin = (function () { try { return new URL(script.src).origin; } catch (e) { return ""; } })();
  var API = script.getAttribute("data-api") || "__API_BASE__";
  var SITE_NAME = "__SITE_NAME__";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var krw = function (n) { return n == null ? "—" : Number(n).toLocaleString("ko-KR") + "원"; };

  function render(el, data) {
    var limit = Number(el.getAttribute("data-limit") || 5);
    var deals = (data.deals || []).filter(function (d) { return d.status !== "ended"; }).slice(0, limit);
    var brand = el.getAttribute("data-brand");
    var head = brand && deals[0] ? deals[0].brand_name + " 핫딜" : "상품권 핫딜 TOP " + limit;
    var html = '<div style="font:14px/1.45 -apple-system,BlinkMacSystemFont,Pretendard,system-ui,sans-serif;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff;color:#0f172a">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700">' + esc(head)
      + '<a href="' + esc(origin || data.source && data.source.url || "/") + (brand ? "/brands/" + esc(brand) + "/" : "/") + '" target="_blank" rel="noopener" style="font-size:12px;color:#1d58f0;text-decoration:none;font-weight:600">더 보기 →</a></div>';
    if (!deals.length) html += '<p style="margin:0;padding:16px;color:#64748b;font-size:13px">지금 진행 중인 딜이 없습니다.</p>';
    deals.forEach(function (d) {
      var cond = [d.card_benefit, d.limit_per_person && "한도 " + d.limit_per_person].filter(Boolean).join(" · ");
      html += '<a href="' + esc((origin || "") + "/deal/" + d.id + "/") + '" target="_blank" rel="noopener" style="display:block;padding:10px 14px;border-bottom:1px solid #f1f5f9;text-decoration:none;color:inherit">'
        + '<div style="display:flex;justify-content:space-between;gap:8px"><span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.brand_name || d.brand) + (d.merchant_name || d.merchant ? ' · ' + esc(d.merchant_name || d.merchant) : '') + '</span>'
        + '<span style="font-weight:700;color:#1d58f0;white-space:nowrap">' + esc(d.discount_rate != null ? d.discount_rate + "%" : "") + '</span></div>'
        + '<div style="font-size:12px;color:#64748b;margin-top:2px">' + esc(krw(d.sale_price)) + (d.face_value ? " / 액면 " + esc(krw(d.face_value)) : "") + (cond ? " · " + esc(cond) : "") + '</div></a>';
    });
    html += '<div style="padding:8px 14px;font-size:11px;color:#94a3b8;background:#f8fafc">출처: <a href="' + esc(origin || "/") + '" target="_blank" rel="noopener" style="color:#64748b">' + esc(SITE_NAME) + '</a>'
      + (data.last_updated ? ' · 갱신 ' + esc(new Date(data.last_updated).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })) : "") + '</div></div>';
    el.innerHTML = html;
  }

  function load(el) {
    var brand = el.getAttribute("data-brand");
    var urls = [];
    if (API && !/__API/.test(API)) urls.push(brand ? API + "/api/brands/" + encodeURIComponent(brand) + ".json" : API + "/api/deals.json?limit=20");
    var st = el.getAttribute("data-static"); if (st) urls.push((origin || "") + st);
    if (!urls.length) { el.innerHTML = ""; return; }
    var tryNext = function (i) {
      if (i >= urls.length) { el.innerHTML = '<p style="font:13px sans-serif;color:#94a3b8">핫딜 정보를 불러오지 못했습니다.</p>'; return; }
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
      fetch(urls[i], ctrl ? { signal: ctrl.signal } : undefined).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) { clearTimeout(t); if (brand && st && i === urls.length - 1) data.deals = (data.deals || []).filter(function (d) { return d.brand === brand; }); render(el, data); })
        .catch(function () { clearTimeout(t); tryNext(i + 1); });
    };
    tryNext(0);
  }

  try { Array.prototype.forEach.call(document.querySelectorAll("[data-hotdeal-widget]"), load); } catch (e) { console.error("[hotdeal-widget]", e); }
})();
