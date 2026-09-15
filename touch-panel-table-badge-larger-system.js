// ==========================================
// touch-panel-table-badge-larger-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で、CSSの上書きのみで実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【対象】
// 客用モードでメニュー画面（注文中の画面）の左下に小さく表示している
// 「卓番◯◯」バッジ（.tp-kiosk-lock-badge.tp-table-num-hidden）。
// ※卓番「選択」画面（数字だけが並ぶマス目のボタン）とは別の要素で、
// 　こちらは注文中ずっと画面の隅に表示され続ける、自分のテーブル番号の
// 　確認用バッジ。
//
// 【今回の対応】
// このバッジが小さく・薄く（文字11px・不透明度0.82程度）て
// 分かりづらいとのことだったので、見やすくなる範囲で大きくした。
// ただし「邪魔にならないように」とのことなので、画面いっぱいに目立たせる
// のではなく、
//   ・文字サイズを 11px → 15px に
//   ・薄くて読みにくかった分、背景・文字の濃さを上げて少しくっきりさせる
//   ・吹き出し自体の大きさ（padding・最大幅）もそれに合わせて少しだけ拡大
// という、控えめな範囲にとどめている。
// 位置（left/bottom）は変更していないので、以前の修正で重ならないように
// 調整済みの注文かごバー（.tp-cart-bar）やジャンルのサイドバー
// （.tp-category-rail）との位置関係もそのまま。
//
// なお、このバッジは長押しで店員用のPIN入力に入るための隠しトリガーも
// 兼ねているため、タップ／長押しの当たり判定（要素そのもの・配置）は
// 変更せず、見た目（文字サイズ・濃さ）だけを調整している。
// ==========================================

(function injectTableBadgeLargerStyle() {
    if (document.getElementById('tp-table-badge-larger-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-table-badge-larger-style';
    style.textContent = `
        #touch-panel-overlay .tp-kiosk-lock-badge.tp-table-num-hidden {
            font-size: 15px !important;
            padding: 10px 14px !important;
            max-width: 120px !important;
            border-radius: 12px !important;
            opacity: 0.95 !important;
        }
        /* このバッジはメニュー画面（tp-theme-menu）でのみ表示されるため、
           そのときの配色（濃い茶色文字）側だけコントラストを上げる */
        #touch-panel-overlay.tp-theme-menu .tp-kiosk-lock-badge.tp-table-num-hidden {
            background: rgba(42,33,24,0.30) !important;
            color: rgba(42,33,24,0.92) !important;
        }
    `;
    document.head.appendChild(style);
})();
