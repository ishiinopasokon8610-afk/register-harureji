// ==========================================
// fullscreen-lock-system.js
// ------------------------------------------
// 【この機能】
// 次の2つの画面が表示されている間、全画面を「やめさせない」ようにする。
//   ① タッチパネル（#touch-panel-overlay）
//   ② セルフレジ（#self-checkout-root）
// 全画面が解除されたら、0.1秒後に自動で全画面へ戻す。
//
// index.html / touch-panel-order-system.js / self-checkout-system.js は
// 直接編集せず、他の追加機能ファイルと同じ方式（DOM監視＋イベント監視）で動く。
//
// 【ブラウザの仕様上の限界（先にお伝えしておきます）】
// ブラウザは、安全のため「ユーザーが画面を触った／キーを押した直後でないと、
// 全画面にしてよい」と許可しない。そのため、次の3段構えにしている。
//   ① 全画面が解除されたら、0.1秒後に自動で全画面に戻す。
//      （直前に画面を触っていれば、そのまま成功する。お客様が操作中のタッチパネルでは
//        ほとんどの場合これで戻る）
//   ② ブラウザが拒否した場合（しばらく誰も触っていない状態でEscが押された等）は、
//      画面全体を覆う「画面をタッチしてください」を出す。次に画面を触った瞬間に
//      全画面へ戻り、覆いも消える。
//   ③ そもそも解除されにくくするため、Chrome / Edge では Escキー・F11キーを
//      ブラウザから奪う（Keyboard Lock）。Escを押しただけでは全画面が解除されず、
//      長押し（約2秒）した場合だけ解除される。
// ※ F11 や、ブラウザのメニューからの全画面は「ページが要求した全画面」ではないため、
//   ページ側からは制御できない。完全に閉じ込めたい場合は、Chromeを
//   「キオスクモード」（起動オプション --kiosk）で起動してください。
// ※ iPhone のSafariには全画面の仕組み自体が無いため、何もしない（iPadは動く）。
//
// 【解除できる場面】
// ・タッチパネルを閉じる（closeTouchPanel）／セルフレジを終了する（店長認証後）と、
//   その画面が消えるので、自動的に監視もやめる（全画面を戻そうとしない）。
//
// 【公開するもの】
//   window.haruFullscreenLock.enter()  … 今すぐ全画面にする（成功／失敗は気にしない）
//
// 【導入方法】
// index.html内で、touch-panel-order-system.js・self-checkout-system.js の
// どちらより後ろでも前でも構わない。
//   <script src="fullscreen-lock-system.js"></script>
// ==========================================

(function fullscreenLockSystem() {
    'use strict';

    const RETRY_DELAY_MS = 100;            // 全画面が解除されてから、戻そうとするまでの時間
    const POLL_MS = 500;                   // 画面の表示状態を確認する間隔
    const FAIL_COOLDOWN_MS = 30 * 1000;    // 画面を触った直後の要求まで拒否された時は、しばらく覆いを出さない
    const COVER_ID = 'fullscreen-lock-cover';
    const WATCH_IDS = ['touch-panel-overlay', 'self-checkout-root'];

    let coverEl = null;
    let attempting = false;
    let suppressUntil = 0;
    let keysLocked = false;
    let lastGestureAttemptAt = 0;

    function fsElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
    }

    function fsSupported() {
        const d = document.documentElement;
        return !!(d && (d.requestFullscreen || d.webkitRequestFullscreen || d.msRequestFullscreen));
    }

    function isShown(el) {
        if (!el) return false;
        const cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    // いま「全画面を保つべき画面」が表示されているか（キャッシュせず、毎回その場で調べる）
    function needLock() {
        if (!fsSupported()) return false;
        return WATCH_IDS.some((id) => isShown(document.getElementById(id)));
    }

    function requestEnter() {
        const d = document.documentElement;
        const fn = d.requestFullscreen || d.webkitRequestFullscreen || d.msRequestFullscreen;
        if (!fn) return Promise.reject(new Error('NO_FULLSCREEN_API'));
        try {
            const p = fn.call(d);
            return (p && typeof p.then === 'function') ? p : Promise.resolve();
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /* ---------- Escキー・F11キーを奪う（Chrome / Edge のみ。全画面中だけ有効） ---------- */
    function lockKeys() {
        if (keysLocked) return;
        try {
            if (navigator.keyboard && typeof navigator.keyboard.lock === 'function') {
                keysLocked = true;
                navigator.keyboard.lock(['Escape', 'F11']).catch(() => { keysLocked = false; });
            }
        } catch (e) { keysLocked = false; }
    }

    function unlockKeys() {
        if (!keysLocked) return;
        keysLocked = false;
        try { if (navigator.keyboard && typeof navigator.keyboard.unlock === 'function') navigator.keyboard.unlock(); } catch (e) { /* 無視 */ }
    }

    /* ---------- 「画面をタッチしてください」の覆い ---------- */
    function showCover() {
        if (coverEl) return;
        coverEl = document.createElement('div');
        coverEl.id = COVER_ID;
        coverEl.setAttribute('role', 'button');
        coverEl.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483600', 'display:flex', 'flex-direction:column',
            'align-items:center', 'justify-content:center', 'gap:14px', 'text-align:center',
            'background:rgba(0,0,0,0.88)', 'color:#fff', 'cursor:pointer', 'padding:20px',
            "font-family:'Hiragino Sans','Yu Gothic',sans-serif", 'touch-action:manipulation'
        ].join(';');
        coverEl.innerHTML =
            '<div style="font-size:56px;">🖥️</div>' +
            '<div style="font-size:28px;font-weight:900;">画面をタッチしてください</div>' +
            '<div style="font-size:15px;opacity:.8;">Touch the screen to continue</div>';
        // 覆いを触った操作が、下の画面のボタンを押してしまわないようにする
        const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
        ['click', 'touchstart', 'mousedown'].forEach((n) => coverEl.addEventListener(n, swallow, true));
        (document.body || document.documentElement).appendChild(coverEl);
    }

    function hideCover() {
        if (!coverEl) return;
        try { coverEl.remove(); } catch (e) { /* 無視 */ }
        coverEl = null;
    }

    /* ---------- 全画面へ戻す ---------- */
    // fromGesture = true：画面を触った／キーを押した直後の要求
    function tryEnter(fromGesture) {
        if (attempting || fsElement() || !needLock()) return;
        attempting = true;
        requestEnter().then(() => {
            hideCover();
            lockKeys();
        }).catch((err) => {
            if (fromGesture) {
                // 操作の直後なのに拒否された＝この環境では全画面にできない。
                // 画面を触るたびに覆いが出て操作できなくなるのを避けるため、しばらく覆いを出さない。
                hideCover();
                suppressUntil = Date.now() + FAIL_COOLDOWN_MS;
                console.warn('[fullscreen-lock] 全画面にできませんでした:', err);
            } else if (Date.now() >= suppressUntil) {
                showCover(); // 次に画面を触った瞬間に、全画面へ戻す
            }
        }).then(() => { attempting = false; });
    }

    // 全画面が解除された瞬間
    function onFullscreenChange() {
        if (fsElement()) {
            hideCover();
            if (needLock()) lockKeys();
            return;
        }
        unlockKeys();
        if (!needLock()) return; // タッチパネルを閉じた／セルフレジを終了した（正規の解除）
        setTimeout(() => { if (needLock() && !fsElement()) tryEnter(false); }, RETRY_DELAY_MS);
    }
    ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'].forEach((n) => document.addEventListener(n, onFullscreenChange));

    // 画面を触った／キーを押した瞬間（ブラウザが全画面を許可するタイミング）に戻す
    function onUserGesture(ev) {
        if (fsElement() || !needLock()) return;
        if (ev && ev.type === 'keydown' && (ev.key === 'Escape' || ev.key === 'Shift' || ev.key === 'Control' || ev.key === 'Alt' || ev.key === 'Meta')) return;
        const now = Date.now();
        if (now - lastGestureAttemptAt < 300) return;
        lastGestureAttemptAt = now;
        tryEnter(true);
    }
    ['pointerup', 'touchend', 'mousedown', 'keydown'].forEach((n) => document.addEventListener(n, onUserGesture, { capture: true, passive: true }));

    // 画面の表示状態の確認（タッチパネルが開いた／セルフレジが始まった瞬間に全画面へ）
    function poll() {
        if (needLock()) {
            if (fsElement()) { hideCover(); lockKeys(); }
            else if (!coverEl && Date.now() >= suppressUntil) tryEnter(false);
        } else {
            hideCover();
            unlockKeys();
        }
    }
    setInterval(poll, POLL_MS);

    window.haruFullscreenLock = {
        // 今すぐ全画面にする。画面を触った直後（ボタンの処理の中）で呼ぶと成功しやすい
        enter() {
            if (fsElement() || !fsSupported()) return;
            requestEnter().then(() => { hideCover(); lockKeys(); }).catch(() => { /* 拒否された場合は、監視側が覆いを出す */ });
        }
    };
})();
