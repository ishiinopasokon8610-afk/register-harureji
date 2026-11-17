// customer-fraud-warning-multilang-staff-notice-system.js
// 1) 「詐欺にご注意ください」画面（#customer-fraud-modal）に
//    英語・中国語（簡体字）・韓国語の表示を追加する。
// 2) 年齢確認・詐欺注意の確認中、確認を始めたレジの画面に「確認中」の帯と
//    「この商品を取り消す」ボタンを表示する。
//    firebase-sync-system.js の channel の 'age-check-event' / 'fraud-warning-event'
//    を見張るので、お客様画面が別端末でも動く。
// index.html 等の中核ファイルは変更しないフック。

(function () {
  "use strict";

  var STALE_MS = 90000; // 「同意」が来なくても、これだけ経ったら帯を消す

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

  /* ---------- 2) 店員側の「確認中」表示＋取り消しボタン ---------- */
  // 年齢確認（age-check-event）と詐欺注意（fraud-warning-event）の両方を見張る。
  // 表示するのは、確認を始めた「このレジ」だけ（ほかのレジには出さない）。

  var hideTimer = null;
  var currentMode = ""; // "age" か "fraud"
  var fraudModalSavedDisplay = null;

  function isCustomerDisplay() {
    try {
      return typeof isCustomerDisplayDevice === "function" && isCustomerDisplayDevice();
    } catch (e) {
      return false;
    }
  }

  function isOwn(data) {
    try {
      if (data && data.senderId && typeof POS_DEVICE_ID !== "undefined") {
        return data.senderId === POS_DEVICE_ID;
      }
    } catch (e) {}
    return true; // 送信元が分からないときは表示する
  }

  function myId() {
    try {
      return typeof POS_DEVICE_ID !== "undefined" ? POS_DEVICE_ID : null;
    } catch (e) {
      return null;
    }
  }

  function ensureBanner() {
    var b = document.getElementById("fraud-status-banner");
    if (b) return b;
    b = document.createElement("div");
    b.id = "fraud-status-banner";
    b.setAttribute("role", "status");
    b.innerHTML =
      '<span class="fraud-status-icon">⚠️</span>' +
      '<span class="fraud-status-text"></span>' +
      '<button type="button" class="fraud-status-cancel">この商品を取り消す</button>';
    b.querySelector(".fraud-status-cancel").addEventListener("click", onCancelClick);
    document.body.appendChild(b);
    return b;
  }

  function showBanner(mode) {
    if (isCustomerDisplay()) return; // お客様画面には出さない
    currentMode = mode;
    var b = ensureBanner();
    b.querySelector(".fraud-status-text").textContent =
      mode === "age"
        ? "お客様が年齢確認中です"
        : "お客様が「詐欺注意」画面を確認中です";
    b.style.display = "flex";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideBanner, STALE_MS);
  }

  function hideBanner() {
    clearTimeout(hideTimer);
    currentMode = "";
    var b = document.getElementById("fraud-status-banner");
    if (b) b.style.display = "none";
  }

  function onCancelClick() {
    var mode = currentMode;
    hideBanner();
    if (typeof channel === "undefined" || !channel || !channel.publish) return;
    var payload = { action: "cancel", senderId: myId() };
    if (mode === "age") {
      // 既存の「年齢確認を取り消す」処理（お客様が「同意しない」を押したときと同じ流れ）
      channel.publish("age-check-event", payload);
    } else if (mode === "fraud") {
      channel.publish("fraud-warning-event", payload);
    }
  }

  // 詐欺注意の取り消し（既存の処理には「取り消し」が無いため、ここで行う）
  function applyFraudCancel() {
    try {
      if (typeof pendingFraudCheckItem !== "undefined") pendingFraudCheckItem = null;
    } catch (e) {}
    var m = document.getElementById("customer-fraud-modal");
    if (m && m.style.display !== "none") {
      fraudModalSavedDisplay = m.style.display;
      m.style.display = "none";
    }
    hideBanner();
  }

  // 次に詐欺注意が始まるとき、取り消しで隠した表示を元に戻す
  function restoreFraudModalIfHidden() {
    var m = document.getElementById("customer-fraud-modal");
    if (m && fraudModalSavedDisplay !== null && m.style.display === "none") {
      m.style.display = fraudModalSavedDisplay;
    }
    fraudModalSavedDisplay = null;
  }

  function onAgeEvent(message) {
    var data = (message && message.data) || {};
    if (data.action === "start") {
      if (isOwn(data)) showBanner("age");
    } else if (data.action === "success" || data.action === "cancel") {
      if (currentMode === "age") hideBanner();
    }
  }

  function onFraudEvent(message) {
    var data = (message && message.data) || {};
    if (data.action === "start") {
      restoreFraudModalIfHidden();
      if (isOwn(data)) showBanner("fraud");
    } else if (data.action === "success") {
      if (currentMode === "fraud") hideBanner();
    } else if (data.action === "cancel") {
      applyFraudCancel();
    }
  }

  var subscribed = false;
  function trySubscribe() {
    if (subscribed) return;
    if (typeof channel === "undefined" || !channel || !channel.subscribe) return;
    subscribed = true;
    channel.subscribe("age-check-event", onAgeEvent);
    channel.subscribe("fraud-warning-event", onFraudEvent);
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
      "#fraud-status-banner .fraud-status-icon{font-size:18px}" +
      "#fraud-status-banner .fraud-status-cancel{margin-left:10px;min-height:40px;padding:6px 16px;border:0;border-radius:8px;background:#fff;color:#b45309;font-weight:700;font-size:14px;cursor:pointer}" +
      "#fraud-status-banner .fraud-status-cancel:active{opacity:.7}";
    document.head.appendChild(style);
  }

  /* ---------- 初期化 ---------- */

  function tick() {
    applyMultilang();
    trySubscribe();
  }

  function init() {
    injectStyle();
    tick();
    setInterval(tick, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
