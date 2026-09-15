// ==========================================
// touch-panel-table-reset-and-badge-position-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応（2点）】
// ① 卓番選択画面で、テーブルのマス目を長押しすると
// 　　「テーブル◯◯のデータをリセットしますか？」と確認が出て、
// 　　OKすると、そのテーブルの「使用中」状態を解除するようにした。
// ② 客用モードの注文中に画面左下へ小さく表示している「卓番◯◯」バッジ
// 　　（touch-panel-table-badge-larger-system.jsで大きくしたもの）の
// 　　位置を、より本当の左下寄りに調整した。
//
// ------------------------------------------
// ① 長押しでテーブルのデータをリセット
// ------------------------------------------
// もともと touch-panel-order-system.js には、店員用モードで「使用中」の
// テーブルを"タップ"した場合だけ、空席に戻すかどうかを確認する
// tpStaffPickOccupiedTable() が用意されていた。
// 今回はこれとは別に、"長押し"（約0.6秒）というジェスチャーで、
// 使用中かどうかに関わらずどのテーブルに対してもリセット確認を
// 出せるようにした（例えば「戻る」操作の不具合等で使用中のまま
// 固まってしまったテーブルを、店員がすぐに元に戻せるようにするため）。
// リセットの中身は、既存の releaseTouchPanelTable() をそのまま呼んで
// 「使用中」フラグを解除するだけで、これまでの空席化の仕組み
// （localStorage保存＋他端末へのAbly同期）をそのまま利用している。
//
// お客様が誤って他のテーブルをリセットできてしまうと困るため、この
// 長押し機能は店員用モード（touchPanelState.mode === 'staff'）のときだけ
// 有効にしている（客用モードでは長押ししても何も起きない）。
//
// ------------------------------------------
// ② 卓番バッジの位置調整
// ------------------------------------------
// このバッジは以前、画面左側にあったジャンル切り替え帯
// （.tp-category-rail、幅92px）と重ならないよう、少し内側
// （left: 108px）に寄せてあった。
// その後 touch-panel-menu-genre-top-tabs-system.js により、ジャンル帯は
// 画面左側から上部のタブへ移動したため、左側に避けるべきサイドバーは
// 現在は無い。そのため、バッジを本来の左下（left: 16px）に戻した。
// 上下位置（bottom）は、客用モードで画面下いっぱいに表示される
// 注文かごバー（.tp-cart-bar）と重ならないよう引き上げていたもので、
// こちらは今回も引き続き必要なため変更していない。
//
// 【導入方法】
// index.html内で、touch-panel-order-system.js より後ろ（できれば
// touch-panel-table-badge-larger-system.js の後ろ）に読み込んでください。
// ==========================================

/* =========================================================
   ① 長押しでテーブルのデータをリセット
   ========================================================= */
const TP_TABLE_RESET_LONG_PRESS_MS = 600;

function tpConfirmResetTouchPanelTable(num) {
    if (typeof tpPlaySound === 'function') tpPlaySound('click');
    const doReset = () => {
        if (typeof releaseTouchPanelTable === 'function') releaseTouchPanelTable(num);
        if (typeof tpPlaySound === 'function') tpPlaySound('success');
        if (typeof showTouchPanelToast === 'function') showTouchPanelToast(`✅ テーブル${num}のデータをリセットしました`);
        if (typeof refreshTouchPanelTableGridIfVisible === 'function') refreshTouchPanelTableGridIfVisible();
    };
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            `テーブル${num}のデータをリセットしますか？`,
            `てーぶる${num} の でーた を りせっと し ます か？`,
            (ok) => { if (ok) doReset(); },
            true
        );
    } else if (window.confirm(`テーブル${num}のデータをリセットしますか？`)) {
        doReset();
    }
}

function tpSetupTableGridLongPressReset(grid) {
    if (!grid || grid.dataset.tpLongPressResetBound === '1') return;
    grid.dataset.tpLongPressResetBound = '1';

    let pressTimer = null;
    let longPressFired = false;

    function clearPressTimer() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }

    grid.addEventListener('touchstart', function (ev) {
        // 店員用モードのときだけ有効（客用モードでは何もしない）
        if (typeof touchPanelState === 'undefined' || touchPanelState.mode !== 'staff') return;
        const cell = ev.target.closest('.tp-table-cell');
        if (!cell) return;
        longPressFired = false;
        clearPressTimer();
        pressTimer = setTimeout(() => {
            longPressFired = true;
            const num = parseInt(cell.dataset.table, 10);
            if (!isNaN(num)) tpConfirmResetTouchPanelTable(num);
        }, TP_TABLE_RESET_LONG_PRESS_MS);
    }, { passive: true });

    ['touchend', 'touchmove', 'touchcancel'].forEach(evtName => {
        grid.addEventListener(evtName, clearPressTimer, { passive: true });
    });

    // 長押しが発火した直後の1回分のタップは、通常のテーブル選択／
    // 使用中確認ダイアログが二重に開かないようキャンセルする
    grid.addEventListener('click', function (ev) {
        if (longPressFired) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            longPressFired = false;
        }
    }, true);
}

(function hookRenderTouchPanelTableGridForLongPressReset() {
    function tryHook() {
        if (typeof window.renderTouchPanelTableGrid !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelTableGrid;
        window.renderTouchPanelTableGrid = function (...args) {
            const result = original.apply(this, args);
            tpSetupTableGridLongPressReset(document.getElementById('tp-table-grid'));
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ② 卓番バッジを本来の左下位置に戻す
   ========================================================= */
(function injectTableBadgeBottomLeftStyle() {
    if (document.getElementById('tp-table-badge-bottom-left-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-table-badge-bottom-left-style';
    style.textContent = `
        #touch-panel-overlay .tp-kiosk-lock-badge.tp-table-num-hidden {
            left: 16px !important;
        }
    `;
    document.head.appendChild(style);
})();
