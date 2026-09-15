// ==========================================
// touch-panel-compact-menu-for-less-scrolling-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」（CSSの上書きのみ）で実現している。
//
// 【今回の目的】
// 「なるべく縦スクロールしなくても済むように」というご依頼を受けて、
// ジャンル選択中の1ページ分（列数×行数はジャンルごとに店員が設定した
// 数、未設定なら既定の3列×2行）が、できるだけ画面の高さに収まる
// ようにする。
//
// ページ送り（menu-genre-page-grid-system.js）自体は、1ページに表示
// する件数（列数×行数）を減らすことでも「ページ内スクロール」を無くせる
// が、それだと1ページに表示できる商品数が減ってしまう。今回は表示件数は
// 変えず、代わりに
//   ① 商品ボタン（.tp-menu-card）自体を縦に短く・コンパクトにする
//   ② 商品ボタン以外の部分（本日のおすすめバナー・検索欄まわりの余白・
// 　　上部のジャンルタブ）も少しずつ縦の余白を削る
// という2段構えで、同じ列数×行数の設定でも縦方向に必要な高さを
// 減らし、スクロールなしで収まりやすくしている。
//
// 【変更点まとめ】
// ・商品ボタンの縦横比：3:4（少し縦長）→ 1:1（正方形に近い比率）
// ・商品ボタン内の余白・文字サイズを一回り小さく
// ・商品ボタン同士の隙間（gap）を16px→8pxに
// ・本日のおすすめバナーの高さ：150px→100px
// ・検索欄の下の余白、店員用モードの案内文の余白・文字サイズを縮小
// ・上部のジャンルタブの余白・文字サイズを一回り小さく
//
// 見た目のバランスが崩れて見える・逆に小さすぎる、といった場合は
// 教えてもらえれば数値を再調整する。
// ==========================================

(function injectCompactMenuForLessScrollingStyle() {
    if (document.getElementById('tp-compact-menu-less-scrolling-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-compact-menu-less-scrolling-style';
    style.textContent = `
        /* ---- 商品ボタン本体：一回り小さく ---- */
        #touch-panel-overlay .tp-menu-card {
            aspect-ratio: 1 / 1 !important;
        }
        #touch-panel-overlay .tp-menu-card-info {
            padding: 5px 8px 6px !important;
        }
        #touch-panel-overlay .tp-menu-card-name {
            font-size: 12px !important;
            line-height: 1.2 !important;
        }
        #touch-panel-overlay .tp-menu-card-price {
            font-size: 12px !important;
            margin-top: 2px !important;
        }
        #touch-panel-overlay .tp-menu-grid {
            gap: 8px !important;
        }

        /* ---- 本日のおすすめバナー：少し低く ---- */
        #touch-panel-overlay .tp-banner-card {
            height: 100px !important;
        }

        /* ---- 検索欄・店員用案内文まわりの余白を縮小 ---- */
        #touch-panel-overlay .tp-search-row {
            margin-bottom: 6px !important;
        }
        #touch-panel-overlay .tp-staff-hint {
            padding: 5px 10px !important;
            margin-bottom: 6px !important;
            font-size: 11px !important;
        }
        #touch-panel-overlay .tp-menu-main {
            padding: 8px 12px 90px !important;
        }

        /* ---- 上部のジャンルタブ：一回り小さく ---- */
        #touch-panel-overlay .tp-category-rail {
            padding: 4px !important;
            gap: 4px !important;
        }
        #touch-panel-overlay .tp-rail-item {
            padding: 8px 6px !important;
            font-size: 11px !important;
        }
    `;
    document.head.appendChild(style);
})();
