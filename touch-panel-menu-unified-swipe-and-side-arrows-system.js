// ==========================================
// touch-panel-menu-unified-swipe-and-side-arrows-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
//
// 【これまでの経緯・今回このファイルを新設した理由】
// touch-panel-menu-page-side-arrows-system.js は、menu-genre-page-grid-
// system.js の中身が見えない状態で「表示されている文字」を頼りに
// 「次へ／前へ」ボタンを探す、という推測ベースの実装になっていた。
// 実際に menu-genre-page-grid-system.js の中身を確認したところ、
//   ・「スクロールしてもメニューを進められます」という案内文はそもそも
//     存在しない（スクロールで出てくるのではなく、ページの下に常に
//     ‹ 前へ／次へ › という帯（.tp-genre-pager）が表示される作りだった）
//   ・「次へ」「前へ」ボタンの実際の文字は「‹ 前へ」「次へ ›」で、矢印の
//     記号（‹ ›）が touch-panel-menu-page-side-arrows-system.js が
//     探していた記号（◀◁← 〈 など）と一致していなかった
// という2点がわかった。これが「一番下までスクロールしても、元の次へ／
// 前へボタンが消えない・新しい左右の丸ボタンが実質使えない（見た目が
// 薄いまま）」の直接の原因。
//
// また、ジャンルを跨いだ横スワイプ（touch-panel-menu-swipe-navigation-
// system.js）と、ページ送りの横スワイプ（menu-genre-page-grid-system.js
// が内部で持っている）は、どちらも同じ画面（#tp-menu-area）に対して
// それぞれ独立にタッチイベントを見ており、指を離すまで互いを知らない
// ため、条件を満たすと両方が同時に反応してしまうことがあった
// （ページもジャンルも一度に切り替わってしまう、など）。
//
// 【今回の対応】
// 上記の理由から、ページ送り側の左右矢印・横スワイプ・ジャンルを跨いだ
// 横スワイプを、すべてこのファイル1つに統一する。
//   ① menu-genre-page-grid-system.js が作る、下部の「‹ 前へ／次へ ›」の
//     帯（.tp-genre-pager）はCSSで非表示にする（実際のクラス名が
//     わかったので、文字を探すような不確実なやり方は不要になった）。
//   ② 画面の左右の端に、常に表示される丸い矢印ボタンを新設する。
//   ③ 矢印タップ／横スワイプのどちらでも同じ「進む／戻る」処理を呼ぶ
//     ようにし、内容は次の通りにする。
//       ・今のジャンルにまだ次（前）のページがあれば、そのページへ。
//       ・今のジャンルがもう最後（最初）のページなら、次（前）の
//         ジャンルの1ページ目（最後のページ）へ移動する。
//       ・全ジャンル・全ページを見終えたら（＝最後のジャンルの最後の
//         ページから、さらに次へ進もうとしたら）、最初のジャンルの
//         1ページ目に戻る（ループする）。前へ戻る方向も同様に、
//         最初から前へ戻ろうとしたら最後のジャンルの最後のページに戻る。
//     （常にループするため、矢印が「これ以上進めない」薄い表示に
//     なることはない。）
//   ④ ジャンルを跨いだときだけ表示していた元の2つのスワイプ処理
//     （menu-genre-page-grid-system.js 内のページ送りスワイプ、
//     touch-panel-menu-swipe-navigation-system.js のジャンル横断
//     スワイプ）は、二重に反応しないよう、それぞれが最終的に呼んで
//     いる関数（tpGenreSwipeNext / tpGenreSwipePrev /
//     tpNavigateTouchPanelCategoryBySwipe）を、このファイルで
//     「何もしない」処理に上書きして無効化している（どちらも
//     window直下の関数として定義されているため、上書きだけで安全に
//     無効化できる。イベントリスナー自体は残るが、最終的な動作を
//     呼ばなくなるだけなので実害はない）。
//     横スワイプの縦横判定自体は、誤判定が起きにくいよう
//     touch-panel-menu-swipe-navigation-system.js と同じ「動き始めの
//     方向を一度だけロックする」方式をこのファイルでも採用している。
//   ⑤ ページの残り件数がわかるよう、矢印の近くに「n / m ページ」の
//     小さな表示も追加した（totalPagesが1のジャンル＝ページ送り不要な
//     ジャンルのときは表示しない）。
//
// 【前提にしていること・ご確認のお願い】
// ・ジャンルを跨ぐ際、切り替え先のジャンルに何件商品があるか・何ページ
// 　あるかは、menu-genre-page-grid-system.js と同じ計算方法
// 　（getTpGenreGridSettings() の設定、無ければ既定の3列×2行）で
// 　このファイル側でも計算し直している。表示件数設定を変更した場合も
// 　自動的に反映される。
// ・「すべて」タブは touch-panel-menu-swipe-navigation-system.js に
// 　よってタブ一覧から取り除かれている前提のため、このファイルの
// 　ジャンル一覧からも 'all' は除外している。
//
// 【導入方法】
// index.html内で、
//   <script src="touch-panel-menu-page-side-arrows-system.js"></script>
// の行を削除し、代わりに、menu-genre-page-grid-system.js の後ろに
// このファイルを読み込んでください（touch-panel-menu-swipe-navigation-
// system.js より後ろであれば、読み込む順番自体は前後どちらでも動作
// するように作ってあります）。
//   <script src="menu-genre-page-grid-system.js"></script>
//   <script src="touch-panel-menu-unified-swipe-and-side-arrows-system.js"></script>
// ==========================================

(function () {
    'use strict';

    /* =========================================================
       ① 元の下部「‹ 前へ／次へ ›」帯を非表示にする
       ========================================================= */
    (function injectHideOriginalPagerStyle() {
        if (document.getElementById('tp-unified-hide-original-pager-style')) return;
        const style = document.createElement('style');
        style.id = 'tp-unified-hide-original-pager-style';
        style.textContent = `
            #touch-panel-overlay .tp-genre-pager {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    })();

    /* =========================================================
       ② 左右の固定矢印ボタン（＋ページ数表示）のスタイル
       ========================================================= */
    (function injectSideArrowsStyle() {
        if (document.getElementById('tp-unified-side-arrows-style')) return;
        const style = document.createElement('style');
        style.id = 'tp-unified-side-arrows-style';
        style.textContent = `
            #touch-panel-overlay .tp-unified-side-arrow {
                position: fixed;
                top: 50%;
                transform: translateY(-50%);
                width: 56px;
                height: 56px;
                border-radius: 50%;
                border: none;
                background: rgba(0,0,0,0.35);
                color: #fff;
                font-size: 28px;
                line-height: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 60;
                padding: 0;
                transition: transform 0.1s ease;
            }
            #touch-panel-overlay .tp-unified-side-arrow-left { left: 10px; }
            #touch-panel-overlay .tp-unified-side-arrow-right { right: 10px; }
            #touch-panel-overlay .tp-unified-side-arrow.tp-unified-side-arrow-pressed {
                transform: translateY(-50%) scale(0.88);
            }
            #touch-panel-overlay .tp-unified-page-indicator {
                position: fixed;
                bottom: 14px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.35);
                color: #fff;
                font-size: 12px;
                font-weight: 700;
                padding: 5px 12px;
                border-radius: 999px;
                z-index: 60;
                pointer-events: none;
            }
            /* メニュー画面以外（卓番選択・お会計確認など）では表示しない */
            #touch-panel-overlay:not(.tp-theme-menu) .tp-unified-side-arrow,
            #touch-panel-overlay:not(.tp-theme-menu) .tp-unified-page-indicator {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    })();

    /* =========================================================
       ③ ジャンル一覧・ページ数計算まわりの共通処理
       ========================================================= */
    function tpUnifiedGetCategories() {
        if (typeof buildTouchPanelCategoryList !== 'function' || typeof getProductListForTouchPanel !== 'function') return [];
        return buildTouchPanelCategoryList(getProductListForTouchPanel()).filter(c => c.key !== 'all');
    }

    function tpUnifiedFilterByKey(productList, key) {
        if (key === '__reco__') {
            return productList.filter(p => typeof isRecommendedJan === 'function' && isRecommendedJan(p.jan));
        }
        return productList.filter(p => ((p.genre && String(p.genre).trim()) || 'その他') === key);
    }

    function tpUnifiedComputeTotalPages(productList, key) {
        const filtered = tpUnifiedFilterByKey(productList, key);
        const settings = (typeof getTpGenreGridSettings === 'function') ? getTpGenreGridSettings() : {};
        const configured = settings[key];
        const setting = (configured && configured.cols && configured.rows)
            ? configured
            : (typeof TP_GENRE_GRID_DEFAULT !== 'undefined' ? TP_GENRE_GRID_DEFAULT : { cols: 3, rows: 2 });
        const perPage = Math.max(1, setting.cols * setting.rows);
        return Math.max(1, Math.ceil(filtered.length / perPage));
    }

    // 今表示しているジャンルの現在ページ／総ページ数を返す
    function tpUnifiedGetCurrentPageInfo(productList, key) {
        if (typeof tpGenrePageState !== 'undefined' && tpGenrePageState.category === key) {
            return { page: tpGenrePageState.page, totalPages: tpGenrePageState.totalPages };
        }
        return { page: 1, totalPages: tpUnifiedComputeTotalPages(productList, key) };
    }

    // ジャンルを切り替えて指定ページを表示する（selectTouchPanelCategory()
    // を使うと menu-genre-page-grid-system.js 側のフックで強制的に1ページ目に
    // 戻されてしまうため、状態を直接セットしてから再描画する）
    function tpUnifiedGoToGenrePage(genreKey, page) {
        if (typeof touchPanelState === 'undefined') return;
        touchPanelState.activeCategory = genreKey;
        touchPanelState.searchQuery = '';
        if (typeof tpGenrePageState !== 'undefined') {
            tpGenrePageState.category = genreKey;
            tpGenrePageState.page = page;
        }
        if (typeof renderTouchPanelMenuScreen === 'function') {
            renderTouchPanelMenuScreen();
        }
    }

    /* =========================================================
       ④ 「進む／戻る」本体（矢印タップ・スワイプ共通）
       ========================================================= */
    function tpUnifiedStep(direction) {
        if (typeof touchPanelState === 'undefined') return;
        if ((touchPanelState.searchQuery || '').trim()) return; // 検索中は対象外

        const categories = tpUnifiedGetCategories();
        if (categories.length === 0) return;

        const curKey = touchPanelState.activeCategory;
        const curIndex = categories.findIndex(c => c.key === curKey);
        const idx = curIndex === -1 ? 0 : curIndex;

        const productList = (typeof getProductListForTouchPanel === 'function') ? getProductListForTouchPanel() : [];
        const { page, totalPages } = tpUnifiedGetCurrentPageInfo(productList, categories[idx].key);

        if (typeof tpPlaySound === 'function') tpPlaySound('click');

        if (direction > 0) {
            // 進む：同じジャンル内に次のページがあればそこへ
            if (page < totalPages) {
                if (typeof tpGenrePageGoTo === 'function') tpGenrePageGoTo(page + 1);
                return;
            }
            // 最後のページまで来ていたら、次のジャンルの1ページ目へ
            // （最後のジャンルなら最初のジャンルに戻る＝ループ）
            const nextIndex = (idx + 1) % categories.length;
            tpUnifiedGoToGenrePage(categories[nextIndex].key, 1);
        } else {
            // 戻る：同じジャンル内に前のページがあればそこへ
            if (page > 1) {
                if (typeof tpGenrePageGoTo === 'function') tpGenrePageGoTo(page - 1);
                return;
            }
            // 1ページ目まで戻っていたら、前のジャンルの最後のページへ
            // （最初のジャンルなら最後のジャンルに戻る＝ループ）
            const prevIndex = (idx - 1 + categories.length) % categories.length;
            const prevKey = categories[prevIndex].key;
            const prevTotalPages = tpUnifiedComputeTotalPages(productList, prevKey);
            tpUnifiedGoToGenrePage(prevKey, prevTotalPages);
        }
    }

    /* =========================================================
       ⑤ 元の2つのスワイプ実装を無効化する（二重反応の防止）
       ------------------------------------------
       どちらも window直下の関数として定義されているため、
       上書きするだけで安全に無効化できる（イベントリスナー自体は
       残るが、最終的な動作を何も呼ばなくなる）。
       ========================================================= */
    function tpUnifiedDisableOldSwipeHandlers() {
        window.tpGenreSwipeNext = function () {};
        window.tpGenreSwipePrev = function () {};
        window.tpNavigateTouchPanelCategoryBySwipe = function () {};
    }
    // 読み込み順に関わらず無効化できるよう、対象の関数が現れるまで
    // 繰り返し試みる（一度無効化した後も、他ファイルの読み込みタイミング
    // 次第で上書きし直されないよう、少しの間だけ再適用を続ける）
    let tpUnifiedDisableAttempts = 0;
    (function tryDisableOldSwipeHandlersLoop() {
        tpUnifiedDisableOldSwipeHandlers();
        tpUnifiedDisableAttempts++;
        if (tpUnifiedDisableAttempts < 20) setTimeout(tryDisableOldSwipeHandlersLoop, 300);
    })();

    /* =========================================================
       ⑥ 左右の固定矢印ボタン・ページ数表示の生成
       ========================================================= */
    function tpUnifiedHandleArrowTap(btnEl, direction) {
        btnEl.classList.add('tp-unified-side-arrow-pressed');
        setTimeout(() => btnEl.classList.remove('tp-unified-side-arrow-pressed'), 100);
        if (navigator.vibrate) navigator.vibrate(15);
        tpUnifiedStep(direction);
    }

    function tpUnifiedEnsureSideArrows(overlay) {
        if (!overlay) return;

        let prevBtn = overlay.querySelector('.tp-unified-side-arrow-left');
        if (!prevBtn) {
            prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.className = 'tp-unified-side-arrow tp-unified-side-arrow-left';
            prevBtn.setAttribute('aria-label', '前のページ／前のジャンル');
            prevBtn.textContent = '‹';
            prevBtn.addEventListener('click', () => tpUnifiedHandleArrowTap(prevBtn, -1));
            overlay.appendChild(prevBtn);
        }

        let nextBtn = overlay.querySelector('.tp-unified-side-arrow-right');
        if (!nextBtn) {
            nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'tp-unified-side-arrow tp-unified-side-arrow-right';
            nextBtn.setAttribute('aria-label', '次のページ／次のジャンル');
            nextBtn.textContent = '›';
            nextBtn.addEventListener('click', () => tpUnifiedHandleArrowTap(nextBtn, 1));
            overlay.appendChild(nextBtn);
        }

        tpUnifiedUpdatePageIndicator(overlay);
    }

    function tpUnifiedUpdatePageIndicator(overlay) {
        let indicator = overlay.querySelector('.tp-unified-page-indicator');
        if (typeof touchPanelState === 'undefined') return;

        const key = touchPanelState.activeCategory;
        const q = (touchPanelState.searchQuery || '').trim();
        const productList = (typeof getProductListForTouchPanel === 'function') ? getProductListForTouchPanel() : [];
        const { page, totalPages } = tpUnifiedGetCurrentPageInfo(productList, key);

        if (q || totalPages <= 1) {
            if (indicator) indicator.remove();
            return;
        }
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'tp-unified-page-indicator';
            overlay.appendChild(indicator);
        }
        indicator.textContent = `${page} / ${totalPages} ページ`;
    }

    // renderTouchPanelMenuScreen() は overlay.innerHTML を丸ごと入れ替える
    // ため、矢印ボタンも毎回消えてしまう。再描画のたびに作り直す。
    (function hookRenderMenuScreenForArrows() {
        function tryHook() {
            if (typeof window.renderTouchPanelMenuScreen !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            const original = window.renderTouchPanelMenuScreen;
            window.renderTouchPanelMenuScreen = function (...args) {
                const result = original.apply(this, args);
                tpUnifiedEnsureSideArrows(document.getElementById('touch-panel-overlay'));
                return result;
            };
        }
        tryHook();
    })();

    // ページだけを送る tpGenrePageGoTo() は #tp-menu-area の中身だけを
    // 差し替えるため矢印自体は消えないが、ページ数表示だけは更新する
    (function hookPageGoToForIndicator() {
        function tryHook() {
            if (typeof window.tpGenrePageGoTo !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            const original = window.tpGenrePageGoTo;
            window.tpGenrePageGoTo = function (...args) {
                const result = original.apply(this, args);
                tpUnifiedUpdatePageIndicator(document.getElementById('touch-panel-overlay'));
                return result;
            };
        }
        tryHook();
    })();

    /* =========================================================
       ⑦ 横スワイプ（縦スクロールとの誤判定を防ぐ「動き始め一度だけ
          ロック」方式。touch-panel-menu-swipe-navigation-system.js と
          同じ考え方をこのファイル内で完結させている）
       ========================================================= */
    function tpUnifiedBindSwipe(overlay) {
        if (!overlay || overlay.dataset.tpUnifiedSwipeBound === '1') return;
        overlay.dataset.tpUnifiedSwipeBound = '1';

        const DIRECTION_LOCK_THRESHOLD_PX = 15;
        const MIN_SWIPE_DISTANCE_PX = 80;
        const MAX_SWIPE_TIME_MS = 700;
        const HORIZONTAL_DOMINANCE_RATIO = 2;

        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let startedInMenuArea = false;
        let lockedDirection = null; // null | 'horizontal' | 'vertical'
        let justSwiped = false;

        overlay.addEventListener('touchstart', function (ev) {
            const area = ev.target.closest && ev.target.closest('#tp-menu-area');
            startedInMenuArea = !!area && ev.touches && ev.touches.length === 1;
            if (!startedInMenuArea) return;
            startX = ev.touches[0].clientX;
            startY = ev.touches[0].clientY;
            startTime = Date.now();
            lockedDirection = null;
        }, { passive: true });

        overlay.addEventListener('touchmove', function (ev) {
            if (!startedInMenuArea || lockedDirection || !ev.touches || ev.touches.length !== 1) return;
            const dx = ev.touches[0].clientX - startX;
            const dy = ev.touches[0].clientY - startY;
            if (Math.abs(dx) < DIRECTION_LOCK_THRESHOLD_PX && Math.abs(dy) < DIRECTION_LOCK_THRESHOLD_PX) return;
            lockedDirection = (Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO) ? 'horizontal' : 'vertical';
        }, { passive: true });

        overlay.addEventListener('touchend', function (ev) {
            const wasHorizontal = startedInMenuArea && lockedDirection === 'horizontal';
            startedInMenuArea = false;
            lockedDirection = null;
            if (!wasHorizontal) return;

            const t = ev.changedTouches && ev.changedTouches[0];
            if (!t) return;
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            const elapsed = Date.now() - startTime;

            if (
                Math.abs(dx) >= MIN_SWIPE_DISTANCE_PX &&
                Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO &&
                elapsed < MAX_SWIPE_TIME_MS
            ) {
                justSwiped = true;
                tpUnifiedStep(dx < 0 ? 1 : -1); // 左スワイプ＝進む／右スワイプ＝戻る
            }
        }, { passive: true });

        // スワイプ確定直後の1回分のクリックだけ、意図しない商品タップとして
        // キャンセルする（商品カード自体のonclickはそのまま）
        overlay.addEventListener('click', function (ev) {
            if (justSwiped) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                justSwiped = false;
            }
        }, true);
    }

    /* =========================================================
       ⑧ オーバーレイが作られるたびに、矢印・スワイプの初期化を行う
       ========================================================= */
    (function hookOverlayCreationForUnifiedNav() {
        function tryHook() {
            if (typeof window.getOrCreateTouchPanelOverlay !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            const original = window.getOrCreateTouchPanelOverlay;
            window.getOrCreateTouchPanelOverlay = function (...args) {
                const overlay = original.apply(this, args);
                tpUnifiedBindSwipe(overlay);
                tpUnifiedEnsureSideArrows(overlay);
                return overlay;
            };
        }
        tryHook();
    })();
})();
