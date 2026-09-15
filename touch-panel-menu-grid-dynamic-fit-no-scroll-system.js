// ==========================================
// touch-panel-menu-grid-dynamic-fit-no-scroll-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
//
// 【背景】
// touch-panel-compact-menu-for-less-scrolling-system.js で商品ボタンを
// 正方形に近い比率に固定サイズで小さくしたが、これは「決め打ちで小さく
// する」だけの対応だったため、列数×行数の設定や端末の画面サイズに
// よっては依然としてページ内スクロールが必要になる場合があった
// （逆に、1行など件数が少ない設定なのに無駄にスクロールが発生する、
// 　という不自然な状態も起こり得た）。
//
// 【今回の対応】
// 商品ボタンの大きさを固定値で決めるのではなく、「今、画面に実際に
// 表示できる高さ」を毎回JSで計算し、そのジャンルの行数ぶんで均等に
// 割った高さに商品ボタンをぴったり合わせる方式に変更した。
// これにより、行数がいくつに設定されていても（1行でも6行でも）、
// 画面の高さに収まる分だけの大きさに自動調整され、ページ内スクロールは
// 基本的に発生しなくなる。
//
// 具体的には、
//   ・ページ送りグリッド（.tp-genre-paged-grid）の実際の表示開始位置
//     （本日のおすすめバナー・検索欄・店員用案内文の下）から、注文
//     かごバー用に空けている余白の手前までの高さを測る
//   ・そのジャンルの設定行数で割った高さを、グリッドの
//     grid-template-rows に指定する（1fr×行数）
//   ・商品ボタン自体は、これまでの「縦横比で高さを決める」方式をやめ、
//     「割り当てられた行の高さぴったりに広がる」方式に変更する
// という形にしている。
//
// ただし、行数の設定が多すぎる・画面が極端に小さいなどの理由で、
// 1行あたり40px未満にしかならない場合は、タップしやすさを優先して
// 無理に詰め込まず、これまで通りのスクロール表示に任せる（安全策）。
//
// 【2026-09 不具合修正：写真が消えて名前・価格だけになる】
// 上記の「1行あたり40px未満なら諦める」という安全策だけでは不十分で、
// 40pxはクリアしていても、商品名・価格を表示するinfo部分（文字がある分
// の高さを必ず必要とする）に高さを取られた結果、写真を表示する余白
// （カードの残りの部分）が実質0pxまで潰れてしまうケースがあった
// （行数を多く設定したジャンル・縦に狭い画面で発生しやすい）。
// これに対応するため、高さを一旦適用した直後に、実際にレンダリングされた
// カードで「写真エリアとして残っている高さ」（カード全体の高さ－info部分
// の高さ）を測り直し、それが一定以下（写真が実質見えないレベル）まで
// 潰れていた場合は、詰め込みをやめてスクロール表示に戻すようにした。
//
// 【前提にしていること】
// ・menu-genre-page-grid-system.js の tpGenrePageState / 
// 　getTpGenreGridSettings() / TP_GENRE_GRID_DEFAULT をそのまま参照
// 　して、今のジャンルの行数を取得している。
// ・「すべて」タブの横スクロール帯・検索結果一覧（どちらもページ送り
// 　グリッドではない）は対象外（これまで通りの縦スクロール一覧のまま）。
//
// 【導入方法】
// index.html内で、他のタッチパネル関連ファイルより後ろに読み込んで
// ください（menu-genre-page-grid-system.js より後ろであれば大丈夫です）。
// ==========================================

(function () {
    'use strict';

    /* =========================================================
       商品ボタンを「縦横比」ではなく「割り当てられた高さいっぱい」に
       広げるためのCSS（ページ送りグリッドの中だけに限定）
       ========================================================= */
    (function injectDynamicFitStyle() {
        if (document.getElementById('tp-genre-paged-grid-dynamic-fit-style')) return;
        const style = document.createElement('style');
        style.id = 'tp-genre-paged-grid-dynamic-fit-style';
        style.textContent = `
            #touch-panel-overlay .tp-genre-paged-grid .tp-menu-card {
                aspect-ratio: unset !important;
                height: 100% !important;
                min-height: 0 !important;
            }
        `;
        document.head.appendChild(style);
    })();

    const TP_MIN_ROW_HEIGHT_PX = 40; // これより低くなる場合は無理に詰めない
    const TP_MIN_PHOTO_AREA_PX = 50; // 写真エリアとしてこれ未満まで潰れる場合は詰め込みをやめる

    // 実際にレンダリングされたカード1枚を測り、「カード全体の高さ－info部分
    // （商品名・価格）の高さ」＝写真の表示に使える高さが、潰れすぎていないか確認する
    function tpIsPhotoAreaTooSmall(grid) {
        const card = grid.querySelector('.tp-menu-card');
        if (!card) return false; // カードがまだ無い（描画前）場合は判定できないので詰め込みを許可する
        const cardHeight = card.getBoundingClientRect().height;
        const infoEl = card.querySelector('.tp-menu-card-info');
        const infoHeight = infoEl ? infoEl.getBoundingClientRect().height : 0;
        return (cardHeight - infoHeight) < TP_MIN_PHOTO_AREA_PX;
    }

    function tpGetCurrentGenreRowCount() {
        if (typeof touchPanelState === 'undefined') return 2;
        const key = touchPanelState.activeCategory;
        const settings = (typeof getTpGenreGridSettings === 'function') ? getTpGenreGridSettings() : {};
        const configured = settings[key];
        const setting = (configured && configured.cols && configured.rows)
            ? configured
            : (typeof TP_GENRE_GRID_DEFAULT !== 'undefined' ? TP_GENRE_GRID_DEFAULT : { cols: 3, rows: 2 });
        return Math.max(1, setting.rows);
    }

    function tpComputeAvailableGridHeight(grid, menuMain) {
        const mainRect = menuMain.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const paddingBottom = parseFloat(getComputedStyle(menuMain).paddingBottom) || 0;
        const buffer = 6; // 端数での意図しないスクロールを防ぐ余裕
        return mainRect.bottom - paddingBottom - gridRect.top - buffer;
    }

    function tpFitGenrePagedGrid() {
        const overlay = document.getElementById('touch-panel-overlay');
        if (!overlay || !overlay.classList.contains('tp-theme-menu')) return;

        const menuMain = overlay.querySelector('.tp-menu-main');
        const grid = overlay.querySelector('#tp-menu-area .tp-genre-paged-grid');
        if (!menuMain || !grid) return;

        const rows = tpGetCurrentGenreRowCount();
        const available = tpComputeAvailableGridHeight(grid, menuMain);

        if (!available || available < rows * TP_MIN_ROW_HEIGHT_PX) {
            // 収まりきらないくらい狭い場合は、高さ指定をやめて
            // これまで通りスクロールできる状態に戻す（安全策）
            grid.style.height = '';
            grid.style.gridTemplateRows = '';
            return;
        }

        grid.style.height = `${Math.floor(available)}px`;
        grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

        // 適用した結果、写真がほぼ表示できないくらい潰れていないかを
        // 実際のレンダリング結果で確認する。潰れる場合は詰め込みをやめ、
        // これまで通りのスクロール表示に戻す（安全策）。
        if (tpIsPhotoAreaTooSmall(grid)) {
            grid.style.height = '';
            grid.style.gridTemplateRows = '';
        }
    }

    // 連続で何度も呼ばれても重くならないよう、直近のフレームにまとめる
    let tpFitScheduled = false;
    function tpScheduleFit() {
        if (tpFitScheduled) return;
        tpFitScheduled = true;
        requestAnimationFrame(() => {
            tpFitScheduled = false;
            tpFitGenrePagedGrid();
        });
    }

    /* =========================================================
       #tp-menu-area の中身が入れ替わるたびに再計算する
       （ページ送り／ジャンル切り替え／画面の再描画、いずれにも対応）
       ========================================================= */
    let tpFitObserver = null;
    function ensureTpFitObserver(overlay) {
        if (tpFitObserver || !overlay) return;
        tpFitObserver = new MutationObserver(() => {
            tpScheduleFit();
        });
        tpFitObserver.observe(overlay, { childList: true, subtree: true });
    }

    // 画面回転・ウィンドウサイズ変更にも対応
    window.addEventListener('resize', tpScheduleFit);

    (function hookOverlayCreationForDynamicFit() {
        function tryHook() {
            if (typeof window.getOrCreateTouchPanelOverlay !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            const original = window.getOrCreateTouchPanelOverlay;
            window.getOrCreateTouchPanelOverlay = function (...args) {
                const overlay = original.apply(this, args);
                ensureTpFitObserver(overlay);
                tpScheduleFit();
                return overlay;
            };
        }
        tryHook();
    })();
})();
