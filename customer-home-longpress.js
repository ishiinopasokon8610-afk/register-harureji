// ==========================================
// customer-home-longpress.js
// 客用画面の「何もない部分」を5秒長押しするとホームに戻る
// ------------------------------------------
// 誤って（またはいたずらで）画面に触れてもすぐには戻らないよう、ボタンは置かず、
// 画面のどこでもよいので5秒間押し続けた場合のみ goHome() を実行する。
// customer-screen 内には他に押せるボタン・入力欄が無いため、
// customer-screen 全体を対象に長押しを監視する。
// 押している間は画面の一番上に細い進捗バーを表示する。
// ==========================================

(function setupCustomerHomeLongPress() {
    const HOLD_MS = 5000;

    function init() {
        const screenEl = document.getElementById('customer-screen');
        const progress = document.getElementById('customer-home-back-progress');
        if (!screenEl || !progress) {
            setTimeout(init, 300);
            return;
        }

        let holding = false;
        let completed = false;

        function startHold(e) {
            if (holding) return;
            holding = true;
            completed = false;

            // 一旦0%に戻してから、次のフレームでtransitionを付けて100%まで伸ばす
            // （transitionを確実に発火させるため、間に強制リフローを挟む）
            progress.style.transition = 'none';
            progress.style.width = '0%';
            void progress.offsetWidth;
            progress.style.transition = `width ${HOLD_MS}ms linear`;
            progress.style.width = '100%';
        }

        function cancelHold() {
            if (!holding || completed) {
                holding = false;
                return;
            }
            holding = false;
            progress.style.transition = 'width 150ms ease-out';
            progress.style.width = '0%';
        }

        progress.addEventListener('transitionend', (e) => {
            if (e.propertyName !== 'width' || !holding) return;
            // 途中でキャンセルされて0%に戻る際のtransitionendは無視する
            if (parseFloat(progress.style.width) < 99) return;

            completed = true;
            holding = false;
            progress.style.transition = 'none';
            progress.style.width = '0%';

            if (typeof playSound === 'function') playSound('success');
            if (typeof speak === 'function') speak('ホームがめん に もどり ます');
            if (typeof goHome === 'function') goHome();
        });

        screenEl.addEventListener('pointerdown', startHold);
        screenEl.addEventListener('pointerup', cancelHold);
        screenEl.addEventListener('pointerleave', cancelHold);
        screenEl.addEventListener('pointercancel', cancelHold);
        // 画面外（画面遷移などでポインターが離れた扱いになる場合）でも確実にキャンセルする
        window.addEventListener('blur', cancelHold);
        // 長押し中にコンテキストメニュー（右クリック/長押しメニュー）が出て
        // 操作が中断されないようにする
        screenEl.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    init();
})();
