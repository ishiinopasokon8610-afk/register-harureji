// ==========================================
// screen-title-system.js
// ------------------------------------------
// 【背景】
// タッチパネル注文画面(touch-panel-order-system.js)を開いたときだけ、
// ブラウザ／タブのタイトルが「タッチパネル - haruレジ」に変わるように
// なっていた一方、レジ本体側の各画面（データ管理画面など）を開いても
// タイトルは常に固定の「haruレジ」のままで変化しなかった。
// 複数のタブ・ウィンドウを開いて作業しているときに、タブの見た目だけで
// 「どの画面を開いているタブか」が分かりづらいという不便があった。
//
// 【この機能】
// データ管理画面(migration-screen)を開いている間だけ、タブのタイトルを
// 「データ管理 - haruレジ」に変更する。他の画面に移動したら、元の
// タイトル（index.htmlの<title>にある「haruレジ」）に戻す。
//
// index.html / ui.js は直接編集せず、showScreen() をラップする
// 「フック方式」で実現する（他の追加機能ファイルと同じ方針）。
//
// 【今後、他の画面にもタイトルを付けたい場合】
// 下の SCREEN_TITLES に { 画面ID: 表示したい見出し } を追加するだけでよい。
// ==========================================

const SCREEN_TITLES = {
    'migration-screen': 'データ管理'
};

let baseAppTitleForScreenTitle = null;

function applyScreenTitle(screenId) {
    if (baseAppTitleForScreenTitle === null) {
        baseAppTitleForScreenTitle = document.title;
    }
    const label = SCREEN_TITLES[screenId];
    document.title = label ? `${label} - ${baseAppTitleForScreenTitle}` : baseAppTitleForScreenTitle;
}

(function hookShowScreenForScreenTitle() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            applyScreenTitle(screenId);
            return result;
        };
    }
    tryHook();
})();

document.addEventListener('DOMContentLoaded', () => {
    // すでにデータ管理画面が開いた状態でリロードされた場合にも対応
    const active = document.querySelector('.screen.active');
    if (active && active.id) applyScreenTitle(active.id);
});
