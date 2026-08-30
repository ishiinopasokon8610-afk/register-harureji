// ==========================================
// screen-loading-bar.js
// 画面が切り替わるたびに、画面上部に細い「処理中」プログレスバーを一瞬だけ表示する
// ------------------------------------------
// closeBusiness() 等で使っている画面全体を覆う黒いローディング表示
// （app-loading-overlay / showAppLoading）は、画面切り替えのたびに毎回出すと
// 目障りになってしまうため、ここでは使わない。
// 代わりに、画面の一番上に細いバーがサッと伸びて消えるだけの、控えめな表示にする。
// 内容を隠さず、クリックも妨げないため（pointer-events: none）、
// 何度画面を切り替えても邪魔にならない。
//
// ui.js は直接編集せず、showScreen() をフックして実現する
// （他の追加機能ファイルと同じ「フック方式」）。
// ==========================================

const SCREEN_LOADING_BAR_ID = 'screen-loading-bar';
// 「一瞬で消えて存在に気づかない」のを防ぐための最短表示時間。
// これより短い処理でも、最低限これだけは見えるようにする（それ以上は伸ばさない）。
const SCREEN_LOADING_MIN_VISIBLE_MS = 180;

let screenLoadingBarEl = null;
let screenLoadingHideTimer = null;
let screenLoadingResetTimer = null;
let screenLoadingShownAt = 0;

function ensureScreenLoadingBar() {
    if (screenLoadingBarEl) return screenLoadingBarEl;
    const bar = document.createElement('div');
    bar.id = SCREEN_LOADING_BAR_ID;
    bar.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'height:3px', 'width:0%',
        'background:linear-gradient(90deg, #7c4dff, #536dfe)',
        'z-index:999999', 'opacity:0', 'pointer-events:none',
        'box-shadow:0 0 6px rgba(124,77,255,0.7)',
        'transition:width 220ms ease-out, opacity 150ms ease-out'
    ].join(';');
    document.body.appendChild(bar);
    screenLoadingBarEl = bar;
    return bar;
}

// 画面切り替え開始時：バーを0%から一気に80%くらいまで伸ばす（100%までは伸ばしきらない。
// 「まだ処理中です」という見た目にするため。仕上げは finishScreenLoadingBar() で行う）
function startScreenLoadingBar() {
    const bar = ensureScreenLoadingBar();
    clearTimeout(screenLoadingHideTimer);
    clearTimeout(screenLoadingResetTimer);

    // 連続で画面遷移が起きても（複数ファイルからのフックの重なり等）チカチカしないよう、
    // 一旦0%に戻してから改めて伸ばす（すでに表示中でも自然に見えるようにする）
    bar.style.transition = 'none';
    bar.style.width = '0%';
    bar.style.opacity = '1';
    void bar.offsetWidth; // 強制リフローでtransitionを確実に効かせる
    bar.style.transition = 'width 220ms ease-out, opacity 150ms ease-out';
    bar.style.width = '80%';

    screenLoadingShownAt = Date.now();
}

// 画面切り替え完了時：100%まで伸ばしてからフェードアウトする
function finishScreenLoadingBar() {
    const bar = ensureScreenLoadingBar();
    const elapsed = Date.now() - screenLoadingShownAt;
    const wait = Math.max(0, SCREEN_LOADING_MIN_VISIBLE_MS - elapsed);

    screenLoadingHideTimer = setTimeout(() => {
        bar.style.width = '100%';
        screenLoadingResetTimer = setTimeout(() => {
            bar.style.opacity = '0';
        }, 120);
    }, wait);
}

(function hookShowScreenForLoadingBar() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            startScreenLoadingBar();
            const result = original.apply(this, [screenId, ...rest]);
            finishScreenLoadingBar();
            return result;
        };
    }
    tryHook();
})();
