/**
 * First-party analytics + optional GA4 + affiliate CTA click beacons.
 * Does not rewrite affiliate hrefs / no redirect hop.
 */
(function () {
  "use strict";

  var cfg = window.otonaselectAnalytics || {};
  var endpoint = cfg.endpoint;
  if (!endpoint) return;

  function postEvent(payload) {
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
        return;
      }
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body,
        keepalive: true,
        credentials: "omit",
      }).catch(function () {});
    } catch (e) {}
  }

  function dayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function referrerHost() {
    try {
      if (!document.referrer) return "";
      return new URL(document.referrer).hostname || "";
    } catch (e) {
      return "";
    }
  }

  // Unique-visit approx per browser day (local only).
  var uniqKey = "otonaselect_uv_" + dayKey();
  var isUnique = false;
  try {
    if (!window.localStorage.getItem(uniqKey)) {
      window.localStorage.setItem(uniqKey, "1");
      isUnique = true;
    }
  } catch (e) {}

  postEvent({
    type: "page_view",
    postId: cfg.postId || 0,
    isUnique: isUnique,
    referrerHost: referrerHost(),
    path: cfg.path || location.pathname,
  });

  function isAffiliateCta(anchor) {
    if (!anchor || anchor.tagName !== "A") return false;
    var href = anchor.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#") return false;
    var inCta = !!anchor.closest(".blog-cta, .otonaselect-cta, [data-otonaselect-cta]");
    var text = (anchor.textContent || "").replace(/\s+/g, "");
    var labelHit = /詳細を確認|公式で確認|FANZA|アフィリエイト/.test(text);
    var hostHit = false;
    try {
      var u = new URL(href, location.href);
      hostHit = /(dmm\.co\.jp|dmm\.com|al\.fanza\.co\.jp|affiliate\.dmm)/i.test(u.hostname);
    } catch (e) {}
    return inCta || (hostHit && labelHit) || (inCta && hostHit);
  }

  document.addEventListener(
    "click",
    function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var a = t.closest("a");
      if (!isAffiliateCta(a)) return;
      var href = a.getAttribute("href") || "";
      var host = "";
      try {
        host = new URL(href, location.href).hostname;
      } catch (e) {}
      postEvent({
        type: "cta_click",
        postId: cfg.postId || 0,
        productId: cfg.productId || a.getAttribute("data-product-id") || "",
        provider: cfg.provider || a.getAttribute("data-provider") || "fanza",
        cta: a.getAttribute("data-cta") || "detail_confirm",
        hrefHost: host,
      });

      if (cfg.ga4Id && window.gtag) {
        try {
          window.gtag("event", "affiliate_cta_click", {
            post_id: cfg.postId || 0,
            product_id: cfg.productId || "",
            provider: cfg.provider || "fanza",
          });
        } catch (e) {}
      }
    },
    true
  );

  // Optional GA4 (Measurement ID from WP option / wp-config — never hardcoded secrets).
  if (cfg.ga4Id && /^G-[A-Z0-9]+$/.test(cfg.ga4Id)) {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(cfg.ga4Id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", cfg.ga4Id, { anonymize_ip: true });
  }
})();
