// ==========================================
// touch-panel-language-button-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」（DOM監視＋ボタン差し込みのみ）
// で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ。
//  必ず language-system.js より後ろに読み込んでください）
//
// 【今回追加したいこと（3点）】
// ① タッチパネルの「注文履歴」ボタン（onclick="openTouchPanelOrderHistoryModal()"）
// 　　のすぐ左側に、言語切り替え用のボタンを追加する。
// 　　アイコンには、以下の画像URLを使用する：
// 　　https://raw.githubusercontent.com/ishiinopasokon8610-afk/image-list/main/images/ei-translation.png
// 　　押すと、既存の言語選択モーダル（language-system.js の
// 　　openLanguageMenu()）を開き、日本語 / English / 中文（簡体）/ 한국어に
// 　　画面全体を切り替えられる（Google翻訳のウィジェットを利用する既存の
// 　　仕組みをそのまま呼び出すだけで、新しい翻訳機能は作っていない）。
// ② ボタンの画像（アイコン）の右側に「Language」という文字を表示する。
// ③ Google翻訳が有効になると画面上部に強制的に出てくる
// 　「Google　英語▼に翻訳されました　原文を表示　オプション▼　✕」
// 　というバー（Googleの標準ウィジェットが表示するもの）を、CSSで
// 　強制的に非表示にする。このバーはページ全体（body）を下に
// 　押し下げる分の余白（body { top: 40px; } 等）もGoogle側のJSが
// 　自動で付けてくるため、その余白もあわせて0に戻す。
//
// 【実装方針・ご確認のお願い】
// 「注文履歴」ボタン自体がどのファイルで、画面のどの位置（客用/店員用
// トップバー、カートドロワー等）に生成されているかをこちら側では特定
// できなかった（touch-panel-order-system.js は圧縮・難読化されており
// 直接編集もできない）。そのため、他のフック機能ファイルと同様に、
// 実際に描画されたDOM上で onclick="openTouchPanelOrderHistoryModal()"
// を持つボタンをそのつど探し、そのすぐ前（＝見た目としては左隣）に
// 言語ボタンを差し込む方式にしている。
// タッチパネルの中身が再描画されるたびに探し直すので、「注文履歴」
// ボタンがどの画面に出てきても追従して、その左に表示されるはず。
// もし実際の画面で位置がずれる・出てこない場合は、注文履歴ボタンが
// 実際にどのHTML（class名・親要素）で出力されているか教えてほしい。
//
// 【導入方法】
// index.html内で、language-system.js と touch-panel-order-system.js の
// 両方より後ろに読み込んでください。
//   <script src="language-system.js"></script>
//   ...
//   <script src="touch-panel-order-system.js"></script>
//   <script src="touch-panel-language-button-system.js"></script>
// ==========================================

(function () {
    'use strict';

    const LANG_BTN_ID = 'tp-lang-switch-btn';
    const LANG_BTN_CLASS = 'tp-lang-switch-btn-class';
    const LANG_ICON_URL = 'https://raw.githubusercontent.com/ishiinopasokon8610-afk/image-list/main/images/ei-translation.png';

    /* =========================================================
       ③ Google翻訳の上部バーを常に非表示にするCSS。
       ------------------------------------------------------------
       【重要】前回の版では、このCSSが「タッチパネルが開いている
       ときだけ」差し込まれる関数の中に入っていたため、タッチパネル
       以外の画面（通常のレジ画面など）で翻訳した場合にバーが消えず
       残ってしまっていた。今回は画面の状態に関係なく、このファイルが
       読み込まれた時点で無条件・即時に（ページ全体に）差し込むように
       修正した。
       Googleのバー用要素は class名が微妙に異なる場合があるため、
       想定される候補をまとめて非表示にしている。
       ========================================================= */
    function injectGlobalGoogleTranslateBannerHideStyle() {
        if (document.getElementById('tp-goog-translate-banner-hide-style')) return;
        const style = document.createElement('style');
        style.id = 'tp-goog-translate-banner-hide-style';
        style.textContent = `
            .goog-te-banner-frame,
            .goog-te-banner-frame.skiptranslate,
            iframe.goog-te-banner-frame,
            iframe[id^="goog-te-banner"],
            iframe[class*="goog-te-banner"],
            #goog-te-banner,
            .skiptranslate > iframe,
            body > iframe.skiptranslate {
                display: none !important;
                visibility: hidden !important;
                height: 0 !important;
                width: 0 !important;
            }
            html, html body,
            html.translated-ltr body,
            html.translated-rtl body,
            body.translated-ltr,
            body.translated-rtl {
                top: 0px !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }
    injectGlobalGoogleTranslateBannerHideStyle();
    if (document.head) {
        // documentがまだ head を持たない極端に早いタイミングで
        // 読み込まれた場合の保険（headが出来たらもう一度差し込む）
        document.addEventListener('DOMContentLoaded', injectGlobalGoogleTranslateBannerHideStyle);
    }

    // 【保険】上のCSSに加えて、GoogleのJSが後からインラインstyleや
    // 新しい要素を追加してバーを再表示・再配置してくることがあるため、
    // JS側からも継続的に強制的に打ち消す（MutationObserverで即座に検知
    // ＋setIntervalでの定期チェックの二重構え）
    function tpForceHideGoogleTranslateBanner() {
        try {
            if (document.body && document.body.style.top && document.body.style.top !== '0px') {
                document.body.style.top = '0px';
            }
            if (document.documentElement && document.documentElement.style.top && document.documentElement.style.top !== '0px') {
                document.documentElement.style.top = '0px';
            }
            const bannerSelectors = [
                'iframe.goog-te-banner-frame',
                'iframe[id^="goog-te-banner"]',
                'iframe[class*="goog-te-banner"]',
                '#goog-te-banner',
                'body > iframe.skiptranslate'
            ];
            bannerSelectors.forEach(function (sel) {
                document.querySelectorAll(sel).forEach(function (el) {
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                    el.style.height = '0';
                });
            });
        } catch (e) {}
    }
    setInterval(tpForceHideGoogleTranslateBanner, 300);
    new MutationObserver(tpForceHideGoogleTranslateBanner).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });

    /* =========================================================
       ボタンの見た目（既存の .tp-btn に近い、丸みのある押しやすいボタン。
       アイコン画像＋右側に「Language」の文字）
       ========================================================= */
    function injectLangButtonStyle() {
        if (document.getElementById('tp-lang-switch-style')) return;
        const style = document.createElement('style');
        style.id = 'tp-lang-switch-style';
        style.textContent = `
            #touch-panel-overlay .${LANG_BTN_CLASS} {
                border: none;
                border-radius: 12px;
                cursor: pointer;
                padding: 9px 14px;
                background: #37474f;
                color: #fff;
                box-shadow: 0 4px 0 rgba(0,0,0,0.3);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                font-weight: 700;
                font-size: 13px;
                transition: transform 60ms ease;
                margin-right: 8px;
                flex-shrink: 0;
                white-space: nowrap;
            }
            #touch-panel-overlay .${LANG_BTN_CLASS}:active {
                transform: translateY(3px);
                box-shadow: 0 1px 0 rgba(0,0,0,0.3);
            }
            #touch-panel-overlay .${LANG_BTN_CLASS} img {
                width: 22px;
                height: 22px;
                display: block;
                pointer-events: none;
                flex-shrink: 0;
            }
            #touch-panel-overlay .${LANG_BTN_CLASS} span {
                pointer-events: none;
            }
            /* 言語選択モーダルが、タッチパネル（z-index:500000）より
               さらに手前に確実に表示されるようにしておく */
            #language-menu-modal {
                z-index: 600001 !important;
            }
        `;
        document.head.appendChild(style);
    }

    function createLangButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = LANG_BTN_ID;
        btn.className = LANG_BTN_CLASS;
        btn.setAttribute('aria-label', '言語を選択 / Select Language');
        btn.innerHTML = '<img src="' + LANG_ICON_URL + '" alt="言語 / Language"><span>Language</span>';
        btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (typeof openLanguageMenu === 'function') {
                openLanguageMenu();
            }
        });
        return btn;
    }

    /* =========================================================
       「注文履歴」ボタンを探し、その左隣に言語ボタンを差し込む
       ========================================================= */
    function tpInsertLanguageButtons() {
        const overlay = document.getElementById('touch-panel-overlay');
        if (!overlay) return;
        injectLangButtonStyle();

        const historyButtons = overlay.querySelectorAll('[onclick*="openTouchPanelOrderHistoryModal"]');
        historyButtons.forEach(function (historyBtn) {
            const prev = historyBtn.previousElementSibling;
            if (prev && prev.id === LANG_BTN_ID) return; // 既に追加済み
            const langBtn = createLangButton();
            historyBtn.parentNode.insertBefore(langBtn, historyBtn);
        });
    }

    // タッチパネルの中身が再描画されるたびに探し直す
    let tpLangObserver = null;
    function ensureTpLangObserver(overlay) {
        if (tpLangObserver || !overlay) return;
        tpLangObserver = new MutationObserver(function () {
            tpInsertLanguageButtons();
        });
        tpLangObserver.observe(overlay, { childList: true, subtree: true });
    }

    (function hookOverlayCreationForLangButton() {
        function tryHook() {
            if (typeof window.getOrCreateTouchPanelOverlay !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            const original = window.getOrCreateTouchPanelOverlay;
            window.getOrCreateTouchPanelOverlay = function (...args) {
                const overlay = original.apply(this, args);
                ensureTpLangObserver(overlay);
                tpInsertLanguageButtons();
                return overlay;
            };
        }
        tryHook();
    })();

    // 【保険】他のフックが効かない・想定外の再描画経路がある場合に備え、
    // 定期的にも確認する（負荷は軽いので常時実行しておく）
    setInterval(tpInsertLanguageButtons, 800);
})();
