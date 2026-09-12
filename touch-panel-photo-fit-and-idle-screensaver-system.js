// ==========================================
// touch-panel-photo-fit-and-idle-screensaver-system.js
// ------------------------------------------
// このファイルは2つの独立した修正・追加をまとめている。
// index.html / touch-panel-order-system.js は直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現する。
//
// 【① 商品写真・背景写真が見切れる問題の修正】
// これまで商品カード（.tp-menu-card）・おすすめバナー（.tp-banner-card）・
// 商品詳細ポップアップの写真（.tp-item-modal-photo）は、いずれも
// background-size: cover で表示していた。coverは「はみ出た部分を
// 切り取ってでも枠を隙間なく埋める」表示方法のため、正方形や横長など
// カードの縦横比と写真の縦横比が違うと、写真の左右（または上下）が
// 切り取られて「見切れる」状態になっていた（横長のロゴ画像などで顕著）。
// これを background-size: contain に変更し、写真の縦横比を保ったまま
// 全体が必ず収まるようにする（枠の縦横比と合わない分は、カード本来の
// 背景色で余白ができる）。
//
// 【② 5分間操作がない場合の「テーブル使用中です」画面（アイドル画面）】
// タッチパネルを5分間操作しないと、画面全体に朱色の背景・白い大きな
// 文字で「テーブル使用中です」と表示する。これは、お会計後の
// 「ありがとうございました」画面（tp-checkout-thanks-area）で既に
// 使われている配色（背景 #e8491d ＝朱色、白文字）と統一している。
// 画面のどこでもタップすると、この表示だけが消えて元の画面（裏側では
// 何も変えていないので、そのまま）に戻る。
// ==========================================

/* =========================================================
   ① 写真が見切れる問題の修正（cover → contain）
   ========================================================= */
(function injectPhotoFitOverrideStyle() {
    if (document.getElementById('tp-photo-fit-override-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-photo-fit-override-style';
    style.textContent = `
        #touch-panel-overlay .tp-menu-card,
        #touch-panel-overlay .tp-banner-card,
        #touch-panel-overlay .tp-item-modal-photo {
            background-size: contain !important;
            background-repeat: no-repeat !important;
            background-position: center !important;
        }
    `;
    document.head.appendChild(style);
})();

/* =========================================================
   ② 5分間操作がない場合の「テーブル使用中です」アイドル画面
   ========================================================= */
const TP_IDLE_SCREENSAVER_TIMEOUT_MS = 5 * 60 * 1000; // 5分

let tpIdleScreensaverTimer = null;
let tpIdleScreensaverActive = false;

(function injectIdleScreensaverStyle() {
    if (document.getElementById('tp-idle-screensaver-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-idle-screensaver-style';
    style.textContent = `
        #tp-idle-screensaver-root {
            position: absolute; inset: 0; z-index: 900000;
            background: #e8491d;
            display: flex; align-items: center; justify-content: center;
            padding: 24px; text-align: center;
        }
        #tp-idle-screensaver-root .tp-idle-screensaver-text {
            color: #fff; font-size: 40px; font-weight: 900; line-height: 1.4;
            letter-spacing: 0.04em;
        }
        @media (max-width: 480px) {
            #tp-idle-screensaver-root .tp-idle-screensaver-text { font-size: 28px; }
        }
    `;
    document.head.appendChild(style);
})();

function showTpIdleScreensaver() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay || tpIdleScreensaverActive) return;
    // すでに「お会計後・ありがとうございました」画面など、同じ趣旨の
    // 表示が出ている場合は重ねて表示しない
    if (overlay.querySelector('.tp-checkout-thanks-area')) return;

    tpIdleScreensaverActive = true;
    const root = document.createElement('div');
    root.id = 'tp-idle-screensaver-root';
    root.innerHTML = '<span class="tp-idle-screensaver-text">テーブル使用中です</span>';
    overlay.appendChild(root);
}

function hideTpIdleScreensaver() {
    const root = document.getElementById('tp-idle-screensaver-root');
    if (root) root.remove();
    if (tpIdleScreensaverActive) {
        tpIdleScreensaverActive = false;
        // 消えた直後の操作そのものも「操作があった」扱いにして、
        // そこから改めて5分をカウントし直す
        resetTpIdleScreensaverTimer();
    }
}

function resetTpIdleScreensaverTimer() {
    if (tpIdleScreensaverTimer) {
        clearTimeout(tpIdleScreensaverTimer);
        tpIdleScreensaverTimer = null;
    }
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return; // タッチパネルが閉じている間はタイマーを回さない
    tpIdleScreensaverTimer = setTimeout(showTpIdleScreensaver, TP_IDLE_SCREENSAVER_TIMEOUT_MS);
}

function stopTpIdleScreensaverTimer() {
    if (tpIdleScreensaverTimer) {
        clearTimeout(tpIdleScreensaverTimer);
        tpIdleScreensaverTimer = null;
    }
    tpIdleScreensaverActive = false;
    const root = document.getElementById('tp-idle-screensaver-root');
    if (root) root.remove();
}

// オーバーレイ全体に対するタップ／クリックを「操作があった」とみなし、
// アイドル画面が出ていればそれを消し、出ていなければタイマーを
// リセットするだけにする（＝5分間何も押さなければ再度表示される）。
// overlay自身に一度だけリスナーを付ければ、画面が innerHTML で
// 差し替わっても（子要素ではなくoverlay自身に付けているため）
// 消えずに効き続ける。
function bindTpIdleScreensaverActivityListeners(overlay) {
    if (!overlay || overlay.dataset.tpIdleBound === '1') return;
    overlay.dataset.tpIdleBound = '1';

    const onActivity = () => {
        if (tpIdleScreensaverActive) {
            hideTpIdleScreensaver();
        } else {
            resetTpIdleScreensaverTimer();
        }
    };
    overlay.addEventListener('pointerdown', onActivity, true);
    overlay.addEventListener('touchstart', onActivity, { capture: true, passive: true });
}

// アイドル画面が出ている最中に、他の要因（他端末からの同期イベント等）で
// overlay.innerHTML が丸ごと差し替えられると、アイドル画面のdiv自体も
// 一緒に消えてしまう。その場合は「まだ5分経過後の状態のまま」なので、
// 操作があったわけではないのに元の画面が見えてしまわないよう、
// MutationObserverで監視して必要なら即座に表示し直す。
let tpIdleScreensaverObserver = null;
function ensureTpIdleScreensaverObserver(overlay) {
    if (tpIdleScreensaverObserver || !overlay) return;
    tpIdleScreensaverObserver = new MutationObserver(() => {
        if (tpIdleScreensaverActive && !document.getElementById('tp-idle-screensaver-root')) {
            tpIdleScreensaverActive = false; // 一旦リセットしてから出し直す
            showTpIdleScreensaver();
        }
    });
    tpIdleScreensaverObserver.observe(overlay, { childList: true });
}

// タッチパネルが開かれる（＝getOrCreateTouchPanelOverlayが呼ばれる）
// たびに、リスナーの取り付け・タイマーの開始を行う。
(function hookOverlayCreationForIdleScreensaver() {
    function tryHook() {
        if (typeof window.getOrCreateTouchPanelOverlay !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.getOrCreateTouchPanelOverlay;
        window.getOrCreateTouchPanelOverlay = function (...args) {
            const overlay = original.apply(this, args);
            bindTpIdleScreensaverActivityListeners(overlay);
            ensureTpIdleScreensaverObserver(overlay);
            resetTpIdleScreensaverTimer();
            return overlay;
        };
    }
    tryHook();
})();

// タッチパネルを閉じたら、タイマーとアイドル画面の状態を完全にリセットする
(function hookCloseForIdleScreensaver() {
    function tryHook() {
        if (typeof window.closeTouchPanel !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.closeTouchPanel;
        window.closeTouchPanel = function (...args) {
            const result = original.apply(this, args);
            stopTpIdleScreensaverTimer();
            if (tpIdleScreensaverObserver) {
                tpIdleScreensaverObserver.disconnect();
                tpIdleScreensaverObserver = null;
            }
            return result;
        };
    }
    tryHook();
})();
