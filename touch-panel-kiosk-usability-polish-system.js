// ==========================================
// touch-panel-kiosk-usability-polish-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の目的】
// 「使いやすいように調整して、本格的なタッチパネルのようにして」という
// ご依頼を受けて、見た目（配置・色・大きさ）ではなく、触ったときの
// 挙動・手応えの面で、量販店のタブレットに入れたWebページ然としてしまう
// 部分をなるべく減らし、専用の券売機・タッチパネル注文機に近づける調整。
//
// なお、タップ時の反応（少し縮む手応え）・長押しでの文字選択防止・
// ダブルタップでの部分的な拡大防止・タップ時の青いハイライト消し・
// 最小タップサイズ44pxの確保などは、touch-panel-order-system.js側に
// 既に実装されていたため、今回は重複させず対象外にしている。
//
// 【今回追加した4点】
//
// ① 横スクロール帯のスクロールバーを非表示に
// 　ジャンルタブ・「すべて」表示のジャンル別横スクロール帯・おすすめ
// 　バナーの下に出ていた細いスクロールバーを消した。実店舗の専用機は
// 　マウスがなくスクロールバーが出ないため、指でスワイプする前提の
// 　見た目に近づけている（スクロール自体は今まで通りできる）。
//
// ② 2本指でのピンチズーム・画面全体の拡大縮小を防止
// 　タッチパネル画面を開いている間だけ、viewportのuser-scalableを
// 　一時的にoffにし、誤って画面全体がズームしてしまうのを防ぐ。
// 　閉じたら元の設定に戻すので、レジ・店員側の操作には影響しない。
//
// ③ 画面が自動で暗く・スリープしてしまうのを防止（対応端末のみ）
// 　これまでの「5分操作がないとテーブル使用中です画面になる」機能は
// 　あくまでアプリ内の表示の話で、タブレット本体側が省電力設定で画面を
// 　暗くしたりロックしたりするのは別問題として残っていた。
// 　対応しているブラウザでは、タッチパネル画面を開いている間、
// 　画面のスリープを防ぐ Wake Lock という仕組みを使うようにした。
// 　※Wake Lockは対応していないブラウザ・OSもあるため、その場合は
// 　これまで通り端末側の「自動スリープしない」設定を店舗側で行って
// 　いただく必要がある（対応外の場合でもエラーにはならず、単に効かない
// 　だけなので他の動作に影響はしない）。
//
// ④ 「カートに追加」「はい、お会計する」「店員呼び出し（理由選択後）」
// 　を、誤って連打・二度押ししても、注文やカートへの追加が二重に
// 　登録されないようにした（同じボタンに対して、短い時間内の2回目以降
// 　のタップは無視する）。実際の処理（カートに追加する・注文を確定する
// 　といった中身）自体は一切変更しておらず、「短時間の連打をひとつの
// 　タップとして扱う」ことだけを追加している。
//
// 【今回やっていないこと（技術的な限界）】
// ブラウザのアドレスバーを完全に消す・スワイプで前のページに戻る動作を
// 完全に禁止する、といったところまでは、Webページの中からの調整だけ
// では難しく（ブラウザやOSの「キオスクモード」機能が必要）、今回は
// 対応していない。もしタブレットを完全な専用機として使いたい場合は、
// 端末側でキオスクモード（例：Fully Kiosk Browser等）を使う方法もある
// ので、必要であれば案内できる。
// ==========================================

/* =========================================================
   ① 横スクロール帯のスクロールバーを非表示に
   ========================================================= */
(function injectHideScrollbarStyle() {
    if (document.getElementById('tp-kiosk-hide-scrollbar-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-kiosk-hide-scrollbar-style';
    style.textContent = `
        #touch-panel-overlay .tp-category-rail,
        #touch-panel-overlay .tp-genre-rail,
        #touch-panel-overlay .tp-banner-rail {
            scrollbar-width: none !important;
        }
        #touch-panel-overlay .tp-category-rail::-webkit-scrollbar,
        #touch-panel-overlay .tp-genre-rail::-webkit-scrollbar,
        #touch-panel-overlay .tp-banner-rail::-webkit-scrollbar {
            display: none !important;
            height: 0 !important;
        }
    `;
    document.head.appendChild(style);
})();

/* =========================================================
   ② ピンチズーム防止 ③ 画面スリープ防止
   ------------------------------------------
   どちらも「タッチパネル画面が開いている間だけ」有効にしたいので、
   同じ開閉フックの中でまとめて面倒を見る。
   ========================================================= */
let tpKioskOriginalViewportContent = null;
let tpKioskWakeLockSentinel = null;

function tpKioskLockZoom() {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    if (tpKioskOriginalViewportContent === null) {
        tpKioskOriginalViewportContent = meta.getAttribute('content') || '';
    }
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function tpKioskUnlockZoom() {
    if (tpKioskOriginalViewportContent === null) return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) meta.setAttribute('content', tpKioskOriginalViewportContent);
    tpKioskOriginalViewportContent = null;
}

async function tpKioskRequestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            tpKioskWakeLockSentinel = await navigator.wakeLock.request('screen');
        }
    } catch (e) {
        // 対応していない端末・ブラウザ設定によっては失敗することがあるが、
        // 他の動作には影響させたくないので、ここでは何もしない
    }
}

function tpKioskReleaseWakeLock() {
    if (tpKioskWakeLockSentinel) {
        try { tpKioskWakeLockSentinel.release(); } catch (e) { /* 無視 */ }
        tpKioskWakeLockSentinel = null;
    }
}

// タブが非表示→表示に戻ったタイミングでWake Lockは自動解除されている
// 仕様のため、タッチパネル画面が開いたままであれば取り直す
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && document.getElementById('touch-panel-overlay')) {
        tpKioskRequestWakeLock();
    }
});

(function hookOverlayOpenCloseForZoomAndWakeLock() {
    function tryHook() {
        if (typeof window.getOrCreateTouchPanelOverlay !== 'function' || typeof window.closeTouchPanel !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalOpen = window.getOrCreateTouchPanelOverlay;
        window.getOrCreateTouchPanelOverlay = function (...args) {
            const overlay = originalOpen.apply(this, args);
            tpKioskLockZoom();
            tpKioskRequestWakeLock();
            return overlay;
        };
        const originalClose = window.closeTouchPanel;
        window.closeTouchPanel = function (...args) {
            const result = originalClose.apply(this, args);
            tpKioskUnlockZoom();
            tpKioskReleaseWakeLock();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ④ 連打による二重登録の防止
   （カートに追加／お会計を確定する／店員呼び出しの送信）
   ========================================================= */
(function injectDoubleTapGuard() {
    const TP_GUARD_INTERVAL_MS = 800;
    // 二重送信を防ぎたい「最終アクション」の関数名（onclick属性の中身の
    // 書き出し部分で判定する。中身のロジックは一切変更しない）
    const guardedFunctionPrefixes = [
        'confirmAddTouchPanelModalItem(',
        'confirmTouchPanelCheckout(',
        'sendTouchPanelCallRequest(',
    ];
    const lastTriggeredAt = new WeakMap();

    document.addEventListener('click', function (ev) {
        const overlay = document.getElementById('touch-panel-overlay');
        if (!overlay || !overlay.contains(ev.target)) return;

        const el = ev.target.closest('[onclick]');
        if (!el) return;
        const onclickAttr = el.getAttribute('onclick') || '';
        const isGuarded = guardedFunctionPrefixes.some(prefix => onclickAttr.trim().startsWith(prefix));
        if (!isGuarded) return;

        const now = Date.now();
        const last = lastTriggeredAt.get(el) || 0;
        if (now - last < TP_GUARD_INTERVAL_MS) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            return;
        }
        lastTriggeredAt.set(el, now);
    }, true);
})();
