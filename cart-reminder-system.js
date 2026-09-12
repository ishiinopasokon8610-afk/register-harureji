// ==========================================
// cart-reminder-system.js
// ------------------------------------------
// 【この機能】
// タッチパネルの客用モードで、商品をカート（注文かご）に入れたまま
// 5分間、注文が確定（送信）されなかった場合に、
//   ・画面に「ご注文が確定しておりません。注文してください。」と表示
//   ・同じ内容を読み上げる（tpSpeak、＝register.js等にある共通の speak()
//     をそのまま利用。他ファイルの音声案内と同じ仕組みなので、
//     ミュート設定などがあればそれにも自然に従う）
// ことでお客様に注文の送信を促す。
//
// すでに「テーブル使用中です」のアイドル画面
// （touch-panel-photo-fit-and-idle-screensaver-system.js）が表示されて
// いる場合は、この案内を優先して見せるため、アイドル画面は一時的に
// 消す（＝アイドル判定の仕組み自体を止めるわけではなく、あくまで
// 今回の案内が出ている間だけ隠す。案内を閉じれば、また触れずに
// 5分経過すれば通常通りアイドル画面が出る）。
//
// 【表示を消すタイミング】
// ・画面をタップする（アイドル画面と同じ操作感）
// ・注文が確定（送信）される
// ・カートの中身が空になる（数量を0まで減らす等）
// ・タッチパネルを閉じる／最初からやり直す
//
// index.html / touch-panel-order-system.js は直接編集せず、
// renderTouchPanelOrderList()（カートの中身が変わるたびに呼ばれる） /
// submitTouchPanelOrder()（注文確定時） / resetTouchPanelState() /
// closeTouchPanel() をラップするフック方式で実現する
// （他の追加機能ファイルと同じ方針）。
//
// 【導入方法】
// index.html内で、touch-panel-order-system.js と
// touch-panel-photo-fit-and-idle-screensaver-system.js の両方より後ろに
// このファイルを読み込んでください。
//   <script src="touch-panel-order-system.js"></script>
//   <script src="touch-panel-photo-fit-and-idle-screensaver-system.js"></script>
//   <script src="cart-reminder-system.js"></script>
// ==========================================

const TP_CART_REMINDER_TIMEOUT_MS = 5 * 60 * 1000; // 5分
const TP_CART_REMINDER_TEXT = 'ご注文が確定しておりません。\n注文してください。';
const TP_CART_REMINDER_VOICE_TEXT = 'ごちゅうもん が かくてい して おりません ちゅうもん して ください';

let tpCartReminderTimer = null;
let tpCartReminderActive = false;

(function injectCartReminderStyle() {
    if (document.getElementById('tp-cart-reminder-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-cart-reminder-style';
    style.textContent = `
        #tp-cart-reminder-root {
            position: absolute; inset: 0; z-index: 950000;
            background: #e8491d;
            display: flex; align-items: center; justify-content: center;
            padding: 24px; text-align: center;
        }
        #tp-cart-reminder-root .tp-cart-reminder-text {
            color: #fff; font-size: 34px; font-weight: 900; line-height: 1.5;
            letter-spacing: 0.02em; white-space: pre-line;
        }
        @media (max-width: 480px) {
            #tp-cart-reminder-root .tp-cart-reminder-text { font-size: 24px; }
        }
    `;
    document.head.appendChild(style);
})();

/* =========================================================
   カートに商品が入ったまま5分間動きが無かったら呼ばれる
   ========================================================= */
function showTpCartReminder() {
    tpCartReminderTimer = null;

    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay || tpCartReminderActive) return;

    // 店員用モードでは出さない
    if (typeof touchPanelState === 'undefined' || touchPanelState.mode === 'staff') return;
    // カートが空になっている／すでに送信済みなら何もしない
    if (!touchPanelState.order || touchPanelState.order.length === 0) return;
    // お会計後の「ありがとうございました」画面等では出さない
    if (touchPanelState.screen && touchPanelState.screen !== 'menu') return;
    if (overlay.querySelector('.tp-checkout-thanks-area')) return;

    // カートドロワーや商品詳細ポップアップを操作中なら、今は割り込まず
    // 少し待ってから改めて確認する
    if (document.getElementById('tp-cart-drawer-root') || document.getElementById('tp-item-modal-root')) {
        tpCartReminderTimer = setTimeout(showTpCartReminder, 30 * 1000);
        return;
    }

    // すでに「テーブル使用中です」のアイドル画面が出ている場合は、
    // この案内を優先するため一旦消す（一時的に隠すだけで、アイドル
    // 判定の仕組み自体はそのまま残る）
    if (document.getElementById('tp-idle-screensaver-root') && typeof hideTpIdleScreensaver === 'function') {
        hideTpIdleScreensaver();
    }

    tpCartReminderActive = true;
    const root = document.createElement('div');
    root.id = 'tp-cart-reminder-root';
    root.innerHTML = `<span class="tp-cart-reminder-text">${TP_CART_REMINDER_TEXT}</span>`;
    root.addEventListener('pointerdown', hideTpCartReminder);
    root.addEventListener('touchstart', hideTpCartReminder, { passive: true });
    overlay.appendChild(root);

    if (typeof tpSpeak === 'function') tpSpeak(TP_CART_REMINDER_VOICE_TEXT);
}

function hideTpCartReminder() {
    const root = document.getElementById('tp-cart-reminder-root');
    if (root) root.remove();
    if (tpCartReminderActive) {
        tpCartReminderActive = false;
        // 消えた直後を「動きがあった」扱いにして、まだカートに商品が
        // 残っていればそこから改めて5分をカウントし直す
        resetTpCartReminderTimer();
    }
}

function resetTpCartReminderTimer() {
    if (tpCartReminderTimer) {
        clearTimeout(tpCartReminderTimer);
        tpCartReminderTimer = null;
    }
    if (typeof touchPanelState === 'undefined') return;
    if (!touchPanelState.order || touchPanelState.order.length === 0) return;
    if (touchPanelState.mode === 'staff') return;
    tpCartReminderTimer = setTimeout(showTpCartReminder, TP_CART_REMINDER_TIMEOUT_MS);
}

function stopTpCartReminderTimer() {
    if (tpCartReminderTimer) {
        clearTimeout(tpCartReminderTimer);
        tpCartReminderTimer = null;
    }
    tpCartReminderActive = false;
    const root = document.getElementById('tp-cart-reminder-root');
    if (root) root.remove();
}

/* =========================================================
   カートの中身が変わるたび（商品追加・数量変更）に
   renderTouchPanelOrderList() が呼ばれるので、そこでタイマーの
   リセット／停止を行う
   ========================================================= */
(function hookOrderListRenderForCartReminder() {
    function tryHook() {
        if (typeof window.renderTouchPanelOrderList !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelOrderList;
        window.renderTouchPanelOrderList = function (...args) {
            const result = original.apply(this, args);
            if (touchPanelState.order && touchPanelState.order.length > 0) {
                resetTpCartReminderTimer();
            } else {
                stopTpCartReminderTimer();
            }
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   注文が確定（送信）されたら表示・タイマーを止める
   ========================================================= */
(function hookSubmitOrderForCartReminder() {
    function tryHook() {
        if (typeof window.submitTouchPanelOrder !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.submitTouchPanelOrder;
        window.submitTouchPanelOrder = function (...args) {
            const result = original.apply(this, args);
            // 送信に成功していればtouchPanelState.orderは空になっている
            if (!touchPanelState.order || touchPanelState.order.length === 0) {
                stopTpCartReminderTimer();
            }
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   タッチパネルを閉じた／最初からやり直した際は、表示・タイマーを
   完全にリセットする
   ========================================================= */
(function hookResetStateForCartReminder() {
    function tryHook() {
        if (typeof window.resetTouchPanelState !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.resetTouchPanelState;
        window.resetTouchPanelState = function (...args) {
            const result = original.apply(this, args);
            stopTpCartReminderTimer();
            return result;
        };
    }
    tryHook();
})();

(function hookCloseForCartReminder() {
    function tryHook() {
        if (typeof window.closeTouchPanel !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.closeTouchPanel;
        window.closeTouchPanel = function (...args) {
            const result = original.apply(this, args);
            stopTpCartReminderTimer();
            return result;
        };
    }
    tryHook();
})();
