// ==========================================
// hold-list-manager-auth-button-system.js
// ------------------------------------------
// 【この機能】
// レジ画面の「保留一覧」ボタン（hold-sale-system.js が作るボタン）の
// すぐ左に、「店長認証」ボタンを追加する。
//   ・未認証のとき … 「🔑 店長認証」→ 押すと店長認証モーダルが開く
//   ・認証済みのとき … 「🔓 店長ロック」→ 押すと店長ロックをかける
// ホーム画面の店長認証ボタン（#manager-lock-btn）と違い、
// 認証してもロックしても【レジ画面から移動しない】（会計の途中で
// ホームに飛ばされないようにするため）。
//
// 0円会計（zero-total-manager-auth-system.js）や、店長認証が必要な
// レジ操作の前に、画面を離れずその場で認証しておくための近道。
//
// ■ 実装方針（他の追加機能ファイルと同じ「フック方式」）
//   ・auth-system.js / hold-sale-system.js / index.html は編集しない。
//   ・「保留一覧」ボタンは hold-sale-system.js が後から動的に作るので、
//     ボタンの文字（保留一覧）で探し、MutationObserverで
//     再描画されても自動で付け直す。
//   ・auth-system.js の openManagerAuthTarget() は、未知のtargetだと
//     ホームに移動してしまうため、このボタン専用のtarget
//     'stay-on-screen' だけは何もしない（＝画面に留まる）ようラップする。
//   ・店長認証の判定は、これまで通り isManagerAuthorized() を使う
//     （Firebase認証まで含めた本物の判定。ここで独自に判定しない）。
//
// 【導入方法】
// index.html内で、auth-system.js と hold-sale-system.js の
// 両方より後ろに読み込んでください。
//   <script src="hold-sale-system.js"></script>
//   <script src="hold-list-manager-auth-button-system.js"></script>
// ==========================================

(function holdListManagerAuthButton() {
    const BTN_ID = 'hold-list-manager-auth-btn';
    const STAY_TARGET = 'stay-on-screen';
    const HOLD_LABEL = '保留一覧';

    /* ---------- 認証状態の判定・表示 ---------- */
    function isAuthed() {
        if (typeof isManagerAuthorized === 'function') return !!isManagerAuthorized();
        return typeof managerAuthDone !== 'undefined' && !!managerAuthDone;
    }

    function refreshLabel() {
        const btn = document.getElementById(BTN_ID);
        if (!btn) return;
        if (isAuthed()) {
            btn.textContent = '🔓 店長ロック';
            btn.style.background = '#2e7d32';
        } else {
            btn.textContent = '🔑 店長認証';
            btn.style.background = '#455a64';
        }
    }

    /* ---------- ボタンの動作 ---------- */
    // 画面を移動せずにロックする（lockManagerAuth() は goHome() してしまうため、
    // 同じ後始末だけをここで行う）
    function lockWithoutLeavingScreen() {
        if (typeof playSound === 'function') playSound('click');
        if (typeof managerAuthDone !== 'undefined') managerAuthDone = false;
        sessionStorage.removeItem('pos_manager_auth');
        sessionStorage.removeItem('pos_manager_auth_time');

        if (typeof updateManagerButtonState === 'function') updateManagerButtonState();
        const apiSettings = document.getElementById('api-settings-container');
        if (apiSettings) apiSettings.style.display = 'none';

        if (typeof playSound === 'function') playSound('success');
        if (typeof speak === 'function') speak('てんちょう ロック を かけ まし た');
        refreshLabel();
    }

    function onClick() {
        if (isAuthed()) {
            lockWithoutLeavingScreen();
        } else if (typeof requestManagerAuth === 'function') {
            requestManagerAuth(STAY_TARGET);
        }
    }

    /* ---------- 「保留一覧」ボタンを探して、左に差し込む ---------- */
    function findHoldListButton() {
        const all = Array.from(document.querySelectorAll('button'))
            .filter(b => b.id !== BTN_ID && (b.textContent || '').includes(HOLD_LABEL));
        if (all.length === 0) return null;
        // レジ画面内のものを優先（保留一覧モーダル内の同名ボタン等を避ける）
        return all.find(b => b.closest('#register-screen')) || all[0];
    }

    function ensureButton() {
        const holdBtn = findHoldListButton();
        if (!holdBtn || !holdBtn.parentNode) return;

        let btn = document.getElementById(BTN_ID);
        // すでに「保留一覧」の直前にあれば何もしない
        if (btn && btn.nextElementSibling === holdBtn) return;

        if (!btn) {
            btn = document.createElement('button');
            btn.id = BTN_ID;
            btn.type = 'button';
            // 見た目は「保留一覧」ボタンに揃える（同じclass）
            btn.className = holdBtn.className;
            btn.style.cssText = (holdBtn.getAttribute('style') || '') +
                ';color:#fff;margin-right:6px;white-space:nowrap;';
            btn.addEventListener('click', onClick);
        }
        holdBtn.parentNode.insertBefore(btn, holdBtn); // 保留一覧の左
        refreshLabel();
    }

    /* ---------- 認証後にレジ画面から移動しないようにする ---------- */
    function hookOpenManagerAuthTarget() {
        if (typeof window.openManagerAuthTarget !== 'function') {
            setTimeout(hookOpenManagerAuthTarget, 300);
            return;
        }
        const original = window.openManagerAuthTarget;
        window.openManagerAuthTarget = function (target, ...rest) {
            if (target === STAY_TARGET) {
                refreshLabel();
                return; // 画面はそのまま
            }
            return original.call(this, target, ...rest);
        };
    }

    /* ---------- 他の経路での認証・ロック（自動ロック等）にも表示を連動 ---------- */
    function hookUpdateManagerButtonState() {
        if (typeof window.updateManagerButtonState !== 'function') {
            setTimeout(hookUpdateManagerButtonState, 300);
            return;
        }
        const original = window.updateManagerButtonState;
        window.updateManagerButtonState = function (...args) {
            const r = original.apply(this, args);
            refreshLabel();
            return r;
        };
    }

    function start() {
        hookOpenManagerAuthTarget();
        hookUpdateManagerButtonState();
        ensureButton();

        // 保留一覧ボタンは動的に作られ・作り直されるため、DOMの変化を見て付け直す
        let scheduled = false;
        new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => { scheduled = false; ensureButton(); }, 100);
        }).observe(document.body, { childList: true, subtree: true });

        // Firebase認証の状態など、イベントで拾えない変化の保険
        setInterval(refreshLabel, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
