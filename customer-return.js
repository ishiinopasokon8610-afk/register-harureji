/* =========================================================
   customer-return.js

   客用画面（#customer-screen）に常設の「ホームに戻る」ボタンを
   置かないための代替手段をまとめたファイル。

   1. 画面を5秒間長押し（タッチ／マウス長押し）するとホームに戻る
      → お客様の目の前の画面なので、誤操作でレジ側に戻れてしまわない
        ようにするため、ワンタップではなく5秒の長押しにしている。
   2. Androidの「戻る」ボタン（ブラウザ履歴の戻る）でもホームに戻る
      → ボタンが無いままAndroidの戻るを押すと、アプリごと閉じてしまったり
        画面表示と内部状態がズレたりするため、ここで拾って goHome() を呼ぶ。
   3. スマホでの全画面表示をより確実にするための補助
      → Fullscreen APIはユーザー操作（タップ）の直後にしか呼び出せない上、
        端末側の都合（通知バーの引き下げ、回転など）で全画面が解除される
        ことがあるため、客用画面・レジ画面表示中に全画面が外れていたら
        次にその画面をタップした瞬間に再度リクエストし直す。
   ========================================================= */

(function () {
    const LONG_PRESS_MS = 5000;

    let pressTimer = null;
    let pressStartX = 0;
    let pressStartY = 0;
    const MOVE_CANCEL_THRESHOLD = 20; // px。長押し中に指がこれ以上動いたらキャンセル

    function getCustomerScreen() {
        return document.getElementById('customer-screen');
    }

    function isCustomerScreenActive() {
        const el = getCustomerScreen();
        return !!(el && el.classList.contains('active'));
    }

    function showLongPressUI() {
        const indicator = document.getElementById('customer-longpress-indicator');
        const bar = document.getElementById('customer-longpress-bar');
        if (!indicator || !bar) return;
        bar.classList.remove('animating');
        // リフローを挟んでからクラスを付け直すことで、確実にアニメーションを最初から再生する
        void bar.offsetWidth;
        indicator.classList.add('active');
        bar.classList.add('animating');
    }

    function hideLongPressUI() {
        const indicator = document.getElementById('customer-longpress-indicator');
        const bar = document.getElementById('customer-longpress-bar');
        if (!indicator || !bar) return;
        indicator.classList.remove('active');
        bar.classList.remove('animating');
        bar.style.width = '0%';
        void bar.offsetWidth;
        bar.style.width = '';
    }

    function startPress(x, y) {
        if (!isCustomerScreenActive()) return;
        if (pressTimer) return; // 二重開始防止
        pressStartX = x;
        pressStartY = y;
        showLongPressUI();
        pressTimer = setTimeout(() => {
            pressTimer = null;
            hideLongPressUI();
            if (typeof playSound === 'function') playSound('click');
            if (typeof goHome === 'function') goHome();
        }, LONG_PRESS_MS);
    }

    function cancelPress() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
        hideLongPressUI();
    }

    function movedTooFar(x, y) {
        return Math.abs(x - pressStartX) > MOVE_CANCEL_THRESHOLD ||
               Math.abs(y - pressStartY) > MOVE_CANCEL_THRESHOLD;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const custScreen = getCustomerScreen();
        if (!custScreen) return;

        // タッチ操作（スマホ・タブレット）
        custScreen.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            if (t) startPress(t.clientX, t.clientY);
        }, { passive: true });

        custScreen.addEventListener('touchmove', (e) => {
            const t = e.touches[0];
            if (t && movedTooFar(t.clientX, t.clientY)) cancelPress();
        }, { passive: true });

        custScreen.addEventListener('touchend', cancelPress);
        custScreen.addEventListener('touchcancel', cancelPress);

        // マウス操作（PC・タブレット外付けキーボード運用時の動作確認用）
        custScreen.addEventListener('mousedown', (e) => startPress(e.clientX, e.clientY));
        custScreen.addEventListener('mousemove', (e) => {
            if (pressTimer && movedTooFar(e.clientX, e.clientY)) cancelPress();
        });
        custScreen.addEventListener('mouseup', cancelPress);
        custScreen.addEventListener('mouseleave', cancelPress);
    });

    /* ---------------------------------------------------------
       Androidの「戻る」ボタン対応

       openCustomerScreen() / openRegister() では location.hash を
       書き換えており、これはブラウザ履歴に新しいエントリを積む。
       そのため戻るボタンを押すと hashchange イベントが発生する。
       客用画面が表示中にこのイベントが発生した場合は、通常の
       goHome() と同じ後処理（全画面解除＋ホーム画面表示）を行う。
       すでに履歴は戻った後なので、ここでは location.hash を
       あらためて書き換えない（二重に履歴が動くのを防ぐため）。
       --------------------------------------------------------- */
    window.addEventListener('hashchange', () => {
        if (isCustomerScreenActive() && window.location.hash !== '#customer') {
            cancelPress();
            if (typeof exitFullscreen === 'function') exitFullscreen();
            if (typeof showScreen === 'function') showScreen('home-screen');
        }
    });

    /* ---------------------------------------------------------
       全画面表示の維持
       通知バーの引き下げ・画面回転などで全画面が解除された場合、
       レジ画面／客用画面を表示中に次に画面へ触れた瞬間に
       もう一度 requestFullscreen() を試みる（ユーザー操作直後で
       ないとブラウザが全画面化を許可しないため、タップに便乗する）。
       --------------------------------------------------------- */
    function isFullscreenActive() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    }

    function maybeReenterFullscreen() {
        const reg = document.getElementById('register-screen');
        const cust = document.getElementById('customer-screen');
        const shouldBeFullscreen =
            (reg && reg.classList.contains('active')) ||
            (cust && cust.classList.contains('active'));

        if (shouldBeFullscreen && !isFullscreenActive() && typeof requestFullscreen === 'function') {
            requestFullscreen();
        }
    }

    document.addEventListener('touchstart', maybeReenterFullscreen, { passive: true });
    document.addEventListener('click', maybeReenterFullscreen);
})();
