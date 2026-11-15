// ==========================================
// mobile-ui-polish-system.js
// ------------------------------------------
// 【この機能】スマホ向けの見た目の補正を、専用の <style> 1つで行う。
// style.css / custom-styles.css / index.html は直接編集しない
// （他の追加機能ファイルと同じ方式。index.html に <script> を1行足すだけ）。
//
// ① スマホを横向きにした時にUIが崩れるのを防ぐ（未対応8）
//   ・iPhone/iPadのSafariは、横向きにすると文字を勝手に大きくする（文字サイズの
//     自動調整）。これが「横向きにすると文字があふれる・ボタンが崩れる」主な原因の
//     ひとつなので、自動調整を止める。
//   ・横向きは画面の高さが低い（約300〜450px）ので、上のバーの余白を詰め、
//     モーダル（ポップアップ）が画面からはみ出す場合は、中でスクロールできるようにする。
//   ・画像・動画・キャンバスが画面の幅を超えないようにし、画面全体が横に
//     ずれてしまうのを防ぐ。
// ② 自動化バーコードの「商品一覧」（追加した商品の一覧）が、スマホで大きすぎる
//   のを小さくする（未対応9）。行の文字・余白・ボタンを小さくし、行が増えても
//   一覧自体は一定の高さでスクロールするようにする。
//
// ※ style.css を見ずに作った「第1弾」です。まだ崩れる画面があれば、その画面の
//   スクリーンショットか style.css をもらえれば、その画面専用に直します。
// ==========================================

(function mobileUiPolish() {
    const STYLE_ID = 'mobile-ui-polish-style';

    const CSS = `
/* ---- 文字サイズの自動調整を止める（横向きで文字が膨らむのを防ぐ） ---- */
html {
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
}
img, video, canvas, svg { max-width: 100%; }
html, body { overflow-x: hidden; }

/* ---- ② 商品一覧（自動化バーコード） ---- */
@media (max-width: 820px) {
    .discount-staged-list {
        max-height: 150px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }
    .discount-staged-list > div {
        font-size: 12px !important;
        padding: 3px 8px !important;
        margin-bottom: 3px !important;
        line-height: 1.35;
    }
    .discount-staged-list > div button {
        padding: 1px 8px !important;
        font-size: 12px !important;
        line-height: 1.3;
    }
    .discount-product-picker select,
    .discount-product-picker input {
        font-size: 13px;
        min-height: 34px;
        padding-top: 4px;
        padding-bottom: 4px;
    }
}

/* ---- ① 横向きのスマホ（高さが低い画面） ---- */
@media (orientation: landscape) and (max-height: 520px) {
    .top-bar {
        padding-top: 4px !important;
        padding-bottom: 4px !important;
        min-height: 0 !important;
    }
    .top-bar-title { font-size: 16px !important; }
    /* ポップアップが画面の高さを超える時は、中でスクロールする */
    [id$="-modal"] > div,
    .modal-content {
        max-height: 94vh;
        max-height: 94dvh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }
}
`;

    function ensureStyle() {
        let el = document.getElementById(STYLE_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            el.textContent = CSS;
        }
        // 他のCSSより後ろに置いて、確実に上書きできるようにする
        (document.head || document.documentElement).appendChild(el);
    }

    ensureStyle();
    // 後から読み込まれる追加機能のCSSに負けないよう、画面の準備後にもう一度末尾へ移す
    window.addEventListener('load', ensureStyle);
})();
