// customer-fraud-warning-multilang-staff-notice-system.js
// 1) 「詐欺にご注意ください」画面（#customer-fraud-modal）に
//    英語・中国語（簡体字）・韓国語の表示を追加する。
// 2) お客様側で詐欺注意画面が表示されている間、
//    店員側の画面に「お客様が詐欺注意画面を確認中」と表示する。
// index.html 等の中核ファイルは変更せず、DOMとlocalStorage経由で動くフック。
// ※ 店員側への通知は「同じブラウザの別タブ/別ウィンドウ」間で動作します。
//    別端末へ通知する場合は、同期システム側への接続が別途必要です。

(function () {
  "use strict";

  var STORAGE_KEY = "haru_fraud_modal_status";
  var HEARTBEAT_MS = 4000; // 表示中は定期的に生存通知を送る
  var STALE_MS = 12000; // これ以上通知が来なければ「閉じた」とみなす
  var CHANNEL_NAME = "haru_fraud_modal_channel";

  /* ---------- 1) 多言語表示 ---------- */

  function applyMultilang() {
    var modal = document.getElementById("customer-fraud-modal");
    if (!modal) return;
    if (modal.dataset.multilangApplied === "1") return;
    modal.dataset.multilangApplied = "1";

    var titleEl = modal.querySelector(".fraud-title");
    var descEl = modal.querySelector(".fraud-desc");
    var acceptBtn = modal.querySelector(".fraud-btn-accept");

    if (titleEl) {
      titleEl.insertAdjacentHTML(
        "beforeend",
        '<span class="fraud-title-multilang">' +
          '<span class="fraud-lang-line" lang="en">Beware of Scams</span>' +
          '<span class="fraud-lang-line" lang="zh-Hans">请注意诈骗</span>' +
          '<span class="fraud-lang-line" lang="ko">사기에 주의하세요</span>' +
          "</span>"
      );
    }

    if (descEl) {
      descEl.insertAdjacentHTML(
        "beforeend",
        '<span class="fraud-desc-multilang">' +
          '<span class="fraud-lang-line" lang="en">If you are told to use an ATM or pay at a convenience store for reasons such as refunds, prize money, or unfamiliar charges, it may be a scam. If you feel at all uneasy, please talk to a store staff member or the police.</span>' +
          '<span class="fraud-lang-line" lang="zh-Hans">如果对方以退款、中奖奖金或不明账单为由，要求您操作ATM或在便利店付款，可能是诈骗。如有任何不安，请咨询店员或警察。</span>' +
          '<span class="fraud-lang-line" lang="ko">환급금이나 당첨금 수령, 기억에 없는 청구 등을 이유로 ATM 조작이나 편의점 결제를 요구받는다면 사기일 수 있습니다. 조금이라도 불안하시면 매장 직원 또는 경찰에 상담해 주세요.</span>' +
          "</span>"
      );
    }

    if (acceptBtn) {
      acceptBtn.insertAdjacentHTML(
        "beforeend",
        '<span class="fraud-btn-sub">Agree / 同意 / 동의</span>'
      );
    }
  }

  /* ---------- 2) 店員側への「確認中」通知 ---------- */

  function isVisible(el) {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  }

  var channel = null;
  try {
    if (window.BroadcastChannel) channel = new BroadcastChannel(CHANNEL_NAME);
  } catch (e) {}

  var sourceActive = false; // このタブでモーダルが表示中か
  var heartbeatTimer = null;

  function publish(active) {
    var payload = { active: !!active, ts: Date.now() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {}
    try {
      if (channel) channel.postMessage(payload);
    } catch (e) {}
  }

  function checkSource() {
    var modal = document.getElementById("customer-fraud-modal");
    var nowActive = isVisible(modal);
    if (nowActive === sourceActive) return;
    sourceActive = nowActive;
    publish(sourceActive);
    if (sourceActive) {
      heartbeatTimer = setInterval(function () {
        publish(true);
      }, HEARTBEAT_MS);
    } else if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // 受信側（店員側）バナー
  var lastRemote = { active: false, ts: 0 };

  function ensureBanner() {
    var b = document.getElementById("fraud-status-banner");
    if (b) return b;
    b = document.createElement("div");
    b.id = "fraud-status-banner";
    b.setAttribute("role", "status");
    b.innerHTML =
      '<span class="fraud-status-icon">⚠️</span>' +
      "<span>お客様が「詐欺注意」画面を確認中です</span>";
    document.body.appendChild(b);
    return b;
  }

  function renderBanner() {
    var fresh =
      lastRemote.active && Date.now() - lastRemote.ts < STALE_MS;
    // お客様画面自身（モーダルが見えているタブ）には出さない
    var show = fresh && !sourceActive;
    var b = document.getElementById("fraud-status-banner");
    if (show) {
      b = ensureBanner();
      b.style.display = "flex";
    } else if (b) {
      b.style.display = "none";
    }
  }

  function receive(payload) {
    if (!payload || typeof payload.ts !== "number") return;
    lastRemote = { active: !!payload.active, ts: payload.ts };
    renderBanner();
  }

  window.addEventListener("storage", function (e) {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      receive(JSON.parse(e.newValue));
    } catch (err) {}
  });

  if (channel) {
    channel.onmessage = function (e) {
      receive(e.data);
    };
  }

  /* ---------- スタイル ---------- */

  function injectStyle() {
    if (document.getElementById("fraud-multilang-style")) return;
    var style = document.createElement("style");
    style.id = "fraud-multilang-style";
    style.textContent =
      ".fraud-title-multilang{display:block;margin-top:8px;font-size:.55em;font-weight:500;line-height:1.6;opacity:.85}" +
      ".fraud-title-multilang .fraud-lang-line{display:block}" +
      ".fraud-desc-multilang{display:block;margin-top:12px;padding-top:10px;border-top:1px solid rgba(0,0,0,.08);font-size:.82em;line-height:1.7;opacity:.8}" +
      ".fraud-desc-multilang .fraud-lang-line{display:block;margin-top:6px}" +
      ".fraud-btn-sub{display:block;font-size:.58em;font-weight:400;opacity:.85;margin-top:3px;letter-spacing:.02em}" +
      "#fraud-status-banner{display:none;position:fixed;top:0;left:0;right:0;z-index:2147483000;" +
      "align-items:center;justify-content:center;gap:8px;padding:10px 14px;" +
      "background:#d97706;color:#fff;font-weight:700;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
      "#fraud-status-banner .fraud-status-icon{font-size:18px}";
    document.head.appendChild(style);
  }

  /* ---------- 初期化 ---------- */

  function tick() {
    applyMultilang();
    checkSource();
    renderBanner(); // 通知が途絶えた場合に自動で消す
  }

  function init() {
    injectStyle();
    tick();
    setInterval(tick, 500);

    // 起動時点で既に他タブが表示中だった場合に拾う
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) receive(JSON.parse(raw));
    } catch (e) {}

    // タブを閉じたとき/遷移したときは「閉じた」と通知
    window.addEventListener("pagehide", function () {
      if (sourceActive) publish(false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
