/**
 * Front presentation helpers injected via FSE footer until theme PHP sync is active.
 * - Card images from public post content (trusted DMM hosts / default)
 * - Taxonomy display cleanup (system series hide, tag dedupe)
 * - CTA click + page_view beacons to WP REST when available
 */
(function () {
  "use strict";

  var SYSTEM_SERIES = {
    "ベスト・総集編": 1,
    ベスト: 1,
    総集編: 1,
    デビュー作: 1,
    完全版: 1,
    周年記念: 1,
  };

  function norm(s) {
    return String(s || "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function trustedImage(url) {
    try {
      var u = new URL(url, location.href);
      return /(^|\.)dmm\.co\.jp$|(^|\.)dmm\.com$/i.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function pickBestImage(html) {
    var urls = [];
    String(html || "").replace(/<img[^>]+src=["']([^"']+)["']/gi, function (_, src) {
      urls.push(src);
      return _;
    });
    var best = null;
    var bestScore = -1;
    urls.forEach(function (src) {
      if (!trustedImage(src)) return;
      var file = (src.split("?")[0] || "").split("/").pop() || "";
      var score = 10;
      if (/pl\./i.test(file)) score = 100;
      else if (/jp-\d+\./i.test(file)) score = 80;
      else if (/ps\.|pt\./i.test(file)) score = 50;
      else if (/-\d+\./i.test(file)) score = 30;
      if (score > bestScore) {
        bestScore = score;
        best = src;
      }
    });
    return best;
  }

  function enhanceCards() {
    var cards = document.querySelectorAll(".otonaselect-card, .otonaselect-home-query .wp-block-post");
    if (!cards.length) return;
    fetch("/wp-json/wp/v2/posts?per_page=12&status=publish&_fields=id,link,content,date")
      .then(function (r) {
        return r.json();
      })
      .then(function (posts) {
        if (!Array.isArray(posts)) return;
        var byLink = {};
        posts.forEach(function (p) {
          if (p && p.link) byLink[p.link.replace(/\/$/, "")] = p;
        });
        cards.forEach(function (card) {
          var a = card.querySelector("h2 a, h3 a, .wp-block-post-title a");
          if (!a) return;
          var key = a.href.replace(/\/$/, "");
          var post = byLink[key];
          if (!post) return;
          var imgUrl = pickBestImage(post.content && post.content.rendered);
          var figure = card.querySelector(".wp-block-post-featured-image");
          if (imgUrl && figure && !figure.querySelector("img")) {
            figure.innerHTML =
              '<a href="' +
              a.href +
              '"><img src="' +
              imgUrl +
              '" alt="" loading="lazy" decoding="async" /></a>';
          } else if (imgUrl && !figure) {
            var wrap = document.createElement("figure");
            wrap.className = "wp-block-post-featured-image otonaselect-card-image";
            wrap.innerHTML =
              '<a href="' +
              a.href +
              '"><img src="' +
              imgUrl +
              '" alt="" loading="lazy" decoding="async" /></a>';
            card.insertBefore(wrap, card.firstChild);
          }
        });
      })
      .catch(function () {});
  }

  function cleanupTaxonomy() {
    var root = document.querySelector(".otonaselect-article-taxonomy");
    if (!root) return;
    var blocked = {};
    root.querySelectorAll(".otonaselect-row-performer a, .otonaselect-row-category a").forEach(function (a) {
      blocked[norm(a.textContent)] = 1;
    });
    Object.keys(SYSTEM_SERIES).forEach(function (k) {
      blocked[norm(k)] = 1;
    });

    var seriesRow = root.querySelector(".otonaselect-row-series");
    if (seriesRow) {
      var keep = [];
      seriesRow.querySelectorAll("a").forEach(function (a) {
        var name = (a.textContent || "").trim();
        if (!SYSTEM_SERIES[name] && !blocked[norm(name)]) keep.push(a);
      });
      if (!keep.length) seriesRow.hidden = true;
      else {
        var terms = seriesRow.querySelector(".wp-block-post-terms, .taxonomy-series");
        if (terms) {
          terms.innerHTML = keep
            .map(function (a) {
              return a.outerHTML;
            })
            .join(" · ");
        }
      }
    }

    var tagRow = root.querySelector(".otonaselect-row-tags");
    if (tagRow) {
      var seen = {};
      var keepTags = [];
      tagRow.querySelectorAll("a").forEach(function (a) {
        var key = norm(a.textContent);
        if (!key || blocked[key] || seen[key]) return;
        seen[key] = 1;
        keepTags.push(a);
      });
      var tagTerms = tagRow.querySelector(".wp-block-post-terms, .taxonomy-post_tag");
      if (tagTerms) {
        tagTerms.innerHTML = keepTags
          .map(function (a) {
            return a.outerHTML;
          })
          .join(" / ");
      }
      if (!keepTags.length) tagRow.hidden = true;
    }

    root.querySelectorAll(".otonaselect-entity-row").forEach(function (row) {
      if (row.hidden) return;
      var has = row.querySelector("a, .wp-block-post-terms:not(:empty)");
      var text = (row.textContent || "").replace(/出演者|カテゴリ|シリーズ|タグ/g, "").trim();
      if (!has && !text) row.hidden = true;
    });
  }

  function postEvent(payload) {
    var endpoint = "/wp-json/otonaselect/v1/events";
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      } else {
        fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function wireAnalytics() {
    var postId = 0;
    var bodyPost = document.body.className.match(/postid-(\d+)/);
    if (bodyPost) postId = parseInt(bodyPost[1], 10) || 0;
    var uniqKey = "otonaselect_uv_" + new Date().toDateString();
    var isUnique = false;
    try {
      if (!localStorage.getItem(uniqKey)) {
        localStorage.setItem(uniqKey, "1");
        isUnique = true;
      }
    } catch (e) {}
    var refHost = "";
    try {
      refHost = document.referrer ? new URL(document.referrer).hostname : "";
    } catch (e) {}
    postEvent({
      type: "page_view",
      postId: postId,
      isUnique: isUnique,
      referrerHost: refHost,
      path: location.pathname,
    });

    document.addEventListener(
      "click",
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var a = t.closest("a");
        if (!a) return;
        var href = a.getAttribute("href") || "";
        var inCta = !!a.closest(".blog-cta, [data-otonaselect-cta]");
        var hostHit = false;
        try {
          hostHit = /(dmm\.co\.jp|dmm\.com|al\.fanza)/i.test(new URL(href, location.href).hostname);
        } catch (e) {}
        if (!inCta && !hostHit) return;
        if (!inCta && !/詳細を確認/.test(a.textContent || "")) return;
        postEvent({
          type: "cta_click",
          postId: postId,
          productId: "",
          provider: "fanza",
          cta: "detail_confirm",
          hrefHost: hostHit ? new URL(href, location.href).hostname : "",
        });
      },
      true
    );
  }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    cleanupTaxonomy();
    enhanceCards();
    wireAnalytics();
  });
})();
