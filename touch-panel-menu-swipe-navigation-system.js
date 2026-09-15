// ==========================================
// touch-panel-menu-swipe-navigation-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【このファイルの内容（2点）】
// ① 「すべて」タブ（ジャンルごとに見出し＋横スクロール帯を縦に並べる
// 　　表示）をやめ、常にどれか1つのジャンル（またはおすすめ）を選んだ
// 　　状態で、写真中心の通常グリッドだけを表示するようにする。
// ② メニュー表示エリアを横にスワイプすると、前後のジャンルタブに
// 　　切り替わるようにする。
//
// 【2026-09 不具合修正】
// 縦にスクロールしようとしただけなのに、指が少し斜めに動いた拍子に
// 「横スワイプ」と誤判定され、ジャンルタブが勝手に切り替わってしまう
// 不具合が起きていた。
// 原因は、touchstart（触れた瞬間）とtouchend（指を離した瞬間）の
// 「最終的な移動量」だけで縦横を判定していたこと。特に縦に長い距離を
// 斜めにドラッグした場合、離した時点での横方向の移動量がたまたま
// 大きくなり、横スワイプと誤判定しやすかった。
// これを、指を動かし始めた「ごく初期の動き」だけを見て縦か横かを
// 最初に一度だけ判定し、以後はその判定を指を離すまで変えない方式に
// 修正した（一般的なカルーセル等の縦横判定と同じ考え方）。
// これにより、動き始めが縦方向のスクロール（や、途中から斜めになった
// だけの動き）は最後まで「縦」として扱われるため、ジャンルが勝手に
// 切り替わることはなくなる。
//
// ------------------------------------------
// ① 「すべて」タブの廃止について
// ------------------------------------------
// 「すべて」タブは touch-panel-order-system.js の
//   buildTouchPanelCategoryList() … タブ一覧に { key:'all', label:'すべて' } を追加
//   renderTouchPanelMenuAreaHtml() … activeCategoryが'all'のときだけ、
//     ジャンルごとの見出し＋横スクロール帯を縦に並べて表示
// という2箇所で作られている。
// buildTouchPanelCategoryList() を差し替えて、一覧から'all'を取り除くこと
// で、タブとしては選べなくしている。
// ただし、卓の状態保存・初期表示などでは touchPanelState.activeCategory が
// 今まで通り'all'になっている場面があるため（起動直後の初期値、
// リセット時など）、renderTouchPanelMenuAreaHtml() /
// renderTouchPanelCategoryRailHtml() が呼ばれる直前に、activeCategoryが
// 'all'のままだったら「タブ一覧の先頭（おすすめがあればおすすめ、
// なければ最初のジャンル）」に置き換えるようにしている。
//
// ------------------------------------------
// ② 横スワイプでジャンル切り替えについて
// ------------------------------------------
// #tp-menu-area（商品グリッドの表示エリア）で、動き始めから明確に
// 横方向優位（縦方向の2倍以上）だった場合だけ「横スワイプ候補」として
// 判定を確定（ロック）し、実際に指を離した時点で最終的な移動量が
// 80px以上・0.7秒以内であれば、タブ一覧の中で「今のジャンルの次／前」
// に切り替える（selectTouchPanelCategory()をそのまま呼ぶので、切り替え
// 後の見た目・保存処理は既存のタブタップと完全に同じ）。
// 最後のジャンルから右方向へさらにスワイプすると先頭に戻る（ループする）。
// 縦方向の判定がロックされた場合は横スワイプの判定自体を行わないため、
// 通常の縦スクロールの動きには影響しない。
// また、検索中（検索欄に文字が入っている間）はジャンルという概念が
// ないため、横スワイプでの切り替えは行わない。
// 横スワイプが確定した直後だけ、その勢いで意図せず商品カードがタップ
// されて商品詳細が開いてしまわないよう、直後の1回分のクリックだけ
// キャンセルしている（商品カードそのもののonclickは変更していない）。
//
// 【導入方法】
// index.html内で、touch-panel-menu-genre-top-tabs-system.js の後ろに
// このファイルを読み込んでください。
//   <script src="touch-panel-menu-genre-top-tabs-system.js"></script>
//   <script src="touch-panel-menu-swipe-navigation-system.js"></script>
// ==========================================

/* =========================================================
   ① 「すべて」タブをタブ一覧から取り除く
   ========================================================= */
(function hookRemoveAllCategoryTab() {
    function tryHook() {
        if (typeof window.buildTouchPanelCategoryList !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.buildTouchPanelCategoryList;
        window.buildTouchPanelCategoryList = function (...args) {
            const list = original.apply(this, args);
            return list.filter(c => c.key !== 'all');
        };
    }
    tryHook();
})();

// activeCategoryが'all'のままだったら、タブ一覧の先頭に置き換える共通処理
function tpEscapeAllCategoryIfNeeded(productList) {
    if (typeof touchPanelState === 'undefined') return;
    if (touchPanelState.activeCategory !== 'all') return;
    if (typeof buildTouchPanelCategoryList !== 'function') return;
    const categories = buildTouchPanelCategoryList(productList);
    if (categories.length > 0) {
        touchPanelState.activeCategory = categories[0].key;
    }
}

(function hookMenuAreaAndRailToAvoidAllCategory() {
    function tryHook() {
        if (typeof window.renderTouchPanelMenuAreaHtml !== 'function' || typeof window.renderTouchPanelCategoryRailHtml !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalArea = window.renderTouchPanelMenuAreaHtml;
        window.renderTouchPanelMenuAreaHtml = function (productList) {
            tpEscapeAllCategoryIfNeeded(productList);
            return originalArea.apply(this, [productList]);
        };

        const originalRail = window.renderTouchPanelCategoryRailHtml;
        window.renderTouchPanelCategoryRailHtml = function (categories) {
            if (typeof touchPanelState !== 'undefined' && touchPanelState.activeCategory === 'all' && categories.length > 0) {
                touchPanelState.activeCategory = categories[0].key;
            }
            return originalRail.apply(this, [categories]);
        };
    }
    tryHook();
})();

/* =========================================================
   ② 横スワイプでジャンル切り替え（縦スクロールとの誤判定を防止）
   ========================================================= */
function tpNavigateTouchPanelCategoryBySwipe(direction) {
    if (typeof touchPanelState === 'undefined') return;
    if ((touchPanelState.searchQuery || '').trim()) return; // 検索中は対象外
    if (typeof buildTouchPanelCategoryList !== 'function' || typeof getProductListForTouchPanel !== 'function') return;

    const categories = buildTouchPanelCategoryList(getProductListForTouchPanel());
    if (categories.length <= 1) return;

    const currentIndex = categories.findIndex(c => c.key === touchPanelState.activeCategory);
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (baseIndex + direction + categories.length) % categories.length;

    if (typeof selectTouchPanelCategory === 'function') {
        selectTouchPanelCategory(categories[nextIndex].key);
    }
}

function tpSetupMenuAreaSwipeNavigation(area) {
    if (!area || area.dataset.tpSwipeBound === '1') return;
    area.dataset.tpSwipeBound = '1';

    const DIRECTION_LOCK_THRESHOLD_PX = 15; // これだけ動いたら縦横どちらかに一度だけ判定する
    const MIN_SWIPE_DISTANCE_PX = 80;       // 「横スワイプ」として確定させるために必要な最終的な移動量
    const MAX_SWIPE_TIME_MS = 700;
    const HORIZONTAL_DOMINANCE_RATIO = 2;   // 横方向が縦方向より何倍大きく動いている必要があるか

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let lockedDirection = null; // null | 'horizontal' | 'vertical'
    let justSwiped = false;

    area.addEventListener('touchstart', function (ev) {
        if (ev.touches.length !== 1) return;
        startX = ev.touches[0].clientX;
        startY = ev.touches[0].clientY;
        startTime = Date.now();
        lockedDirection = null;
    }, { passive: true });

    area.addEventListener('touchmove', function (ev) {
        if (lockedDirection || ev.touches.length !== 1) return;
        const dx = ev.touches[0].clientX - startX;
        const dy = ev.touches[0].clientY - startY;
        if (Math.abs(dx) < DIRECTION_LOCK_THRESHOLD_PX && Math.abs(dy) < DIRECTION_LOCK_THRESHOLD_PX) return;
        // 動き始めの方向だけを見て一度だけ判定し、以後は指を離すまで変えない
        lockedDirection = (Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO) ? 'horizontal' : 'vertical';
    }, { passive: true });

    area.addEventListener('touchend', function (ev) {
        const t = ev.changedTouches && ev.changedTouches[0];
        const wasHorizontal = lockedDirection === 'horizontal';
        lockedDirection = null;
        if (!t || !wasHorizontal) return;

        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const elapsed = Date.now() - startTime;

        if (
            Math.abs(dx) >= MIN_SWIPE_DISTANCE_PX &&
            Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO &&
            elapsed < MAX_SWIPE_TIME_MS
        ) {
            justSwiped = true;
            tpNavigateTouchPanelCategoryBySwipe(dx < 0 ? 1 : -1);
        }
    }, { passive: true });

    // 横スワイプ確定直後の1回分のクリックだけ、意図しない商品タップとして
    // キャンセルする（商品カード自体のonclickはそのまま）
    area.addEventListener('click', function (ev) {
        if (justSwiped) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            justSwiped = false;
        }
    }, true);
}

(function hookRenderMenuScreenForSwipeSetup() {
    function tryHook() {
        if (typeof window.renderTouchPanelMenuScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelMenuScreen;
        window.renderTouchPanelMenuScreen = function (...args) {
            const result = original.apply(this, args);
            tpSetupMenuAreaSwipeNavigation(document.getElementById('tp-menu-area'));
            return result;
        };
    }
    tryHook();
})();
