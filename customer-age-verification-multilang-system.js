// customer-age-verification-multilang-system.js
// 「年齢確認をお願いします」画面（#customer-age-modal）に
// 英語・中国語（簡体字）・韓国語の表示を追加するフック。
// index.html・touch-panel-order-system.js 等の中核ファイルは変更せず、
// 既存要素にDOMから多言語テキストを差し込む方式。

(function () {
  function applyMultilang() {
    var modal = document.getElementById("customer-age-modal");
    if (!modal) return;

    var titleEl = modal.querySelector(".age-title");
    var descEl = modal.querySelector(".age-desc");
    var declineBtn = modal.querySelector(".age-btn-decline");
    var acceptBtn = modal.querySelector(".age-btn-accept");

    // 二重適用防止（他フックとの重複読み込み対策）
    if (modal.dataset.multilangApplied === "1") return;
    modal.dataset.multilangApplied = "1";

    if (titleEl) {
      titleEl.innerHTML =
        "年齢確認をお願いします" +
        '<span class="age-title-multilang">' +
        '<span class="age-lang-line" lang="en">Age Verification Required</span>' +
        '<span class="age-lang-line" lang="zh-Hans">需要进行年龄确认</span>' +
        '<span class="age-lang-line" lang="ko">연령 확인이 필요합니다</span>' +
        "</span>";
    }

    if (descEl) {
      descEl.innerHTML =
        "こちらの商品は対象年齢の確認が必要です。<br>" +
        "身分証明書の提示をお願いする場合がございます。<br>" +
        "あなたは対象の年齢を満たしていますか？" +
        '<span class="age-desc-multilang">' +
        '<span class="age-lang-line" lang="en">This item requires age verification. We may ask you to show ID. Do you meet the required age?</span>' +
        '<span class="age-lang-line" lang="zh-Hans">此商品需要进行年龄确认，可能需要您出示身份证件。您是否达到所需年龄？</span>' +
        '<span class="age-lang-line" lang="ko">이 상품은 연령 확인이 필요합니다. 신분증 제시를 요청드릴 수 있습니다. 요구되는 연령을 충족하십니까?</span>' +
        "</span>";
    }

    if (declineBtn) {
      declineBtn.innerHTML =
        "同意しない" +
        '<span class="age-btn-sub">Decline / 不同意 / 거부</span>';
    }
    if (acceptBtn) {
      acceptBtn.innerHTML =
        "同意する" +
        '<span class="age-btn-sub">Agree / 同意 / 동의</span>';
    }
  }

  function injectStyle() {
    if (document.getElementById("age-multilang-style")) return;
    var style = document.createElement("style");
    style.id = "age-multilang-style";
    style.textContent =
      ".age-title-multilang{display:block;margin-top:8px;font-size:.48em;font-weight:500;line-height:1.6;opacity:.85}" +
      ".age-title-multilang .age-lang-line{display:block}" +
      ".age-desc-multilang{display:block;margin-top:12px;padding-top:10px;border-top:1px solid rgba(0,0,0,.08);font-size:.82em;line-height:1.7;opacity:.8}" +
      ".age-desc-multilang .age-lang-line{display:block;margin-top:6px}" +
      ".age-btn-sub{display:block;font-size:.58em;font-weight:400;opacity:.85;margin-top:3px;letter-spacing:.02em}";
    document.head.appendChild(style);
  }

  function init() {
    injectStyle();
    applyMultilang();

    // customer-age-modal は他の仕組みで表示/非表示が切り替わるため、
    // モーダルが後から生成/再描画されるケースに備えて監視しておく
    var target = document.body;
    if (target && window.MutationObserver) {
      var observer = new MutationObserver(function () {
        applyMultilang();
      });
      observer.observe(target, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
