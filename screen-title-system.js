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
// 下の SCREEN_TITLES に登録した画面を開いている間、タブのタイトルを
// 「〇〇 - haruレジ」に変更する。他の画面に移動したら、元のタイトル
// （index.htmlの<title>にある「haruレジ」）に戻す。
//
// 【今回の強化：絶対にタイトルが変わるようにする】
// これまではshowScreen()をフックして直後にタイトルを設定するだけ
// だったが、もし他のどこかのコード（例：register.jsが画面を開く関数の
// 中で showScreen(...) を呼んだ直後に続けて document.title = '...' を
// 実行しているようなケース）がshowScreen()の呼び出しより「後」に
// document.titleへ直接書き込んでいた場合、そちらで上書きされてしまい、
// 狙った画面名が反映されないことがありえる。
//
// これに対応するため、<title>要素自体をMutationObserverで常時監視し、
// このアプリが管理している画面（.screen.active）の内容と食い違う
// タイトルに書き換えられた場合は、即座に正しい内容へ書き戻す。
// どのタイミング・どこから書き換えられても、最終的には必ず
// SCREEN_TITLESの内容が画面に反映される。
//
// ただし、タッチパネル注文画面（#touch-panel-overlay）が開いている間は
// touch-panel-order-system.js側の既存のタイトル制御（「タッチパネル -
// haruレジ」）を尊重し、このファイルは一切介入しない。
//
// index.html / ui.js / register.js は直接編集せず、showScreen()を
// フックする方式＋<title>要素の監視のみで実現する
// （他の追加機能ファイルと同じ方針）。
//
// 【今後、他の画面にもタイトルを付けたい場合】
// 下の SCREEN_TITLES に { 画面ID: 表示したい見出し } を追加するだけでよい。
// ==========================================

const SCREEN_TITLES = {
    'migration-screen': 'データ管理',
    'timecard-screen': 'タイムカード管理',
    'customer-mgmt-screen': '会員・顧客管理',
    'clerk-screen': '担当者管理',
    'product-screen': '商品管理',
    'discount-screen': '自動化バーコード作成',
    'analytics-screen': '売上分析',
    'register-screen': 'レジ',
    'history-screen': 'お会計履歴',
    'sales-mgmt-screen': '売上管理・精算',
    'customer-screen': '客用画面'
};

let baseAppTitleForScreenTitle = null;
// 自分自身でdocument.titleを書き戻している最中かどうかのフラグ。
// これが無いと、下のMutationObserverが自分の書き込みにも反応して
// 無限ループになってしまう。
let isEnforcingScreenTitle = false;

function isTouchPanelOpen() {
    return !!document.getElementById('touch-panel-overlay');
}

function expectedTitleForCurrentScreen() {
    const active = document.querySelector('.screen.active');
    const screenId = active ? active.id : null;
    const label = screenId ? SCREEN_TITLES[screenId] : null;
    return label ? `${label} - ${baseAppTitleForScreenTitle}` : baseAppTitleForScreenTitle;
}

function applyScreenTitle(screenId) {
    if (baseAppTitleForScreenTitle === null) {
        baseAppTitleForScreenTitle = document.title;
    }
    const label = SCREEN_TITLES[screenId];
    const next = label ? `${label} - ${baseAppTitleForScreenTitle}` : baseAppTitleForScreenTitle;
    isEnforcingScreenTitle = true;
    document.title = next;
    isEnforcingScreenTitle = false;
}

/* =========================================================
   ① showScreen()をフックし、画面が切り替わった直後にタイトルを設定する
   （従来通りの主な仕組み）
   ========================================================= */
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
    // すでにいずれかの画面が開いた状態でリロードされた場合にも対応
    const active = document.querySelector('.screen.active');
    if (active && active.id) applyScreenTitle(active.id);
});

/* =========================================================
   ②【強化】<title>要素をMutationObserverで監視し、①以外の経路で
   document.titleが直接書き換えられても、最終的に必ずSCREEN_TITLESの
   内容へ書き戻す（＝「絶対にタイトルが変わる」ことを保証する）。
   タッチパネル表示中（#touch-panel-overlay がある間）だけは介入しない。
   ========================================================= */
(function watchTitleElementAndEnforce() {
    function trySetup() {
        const titleEl = document.querySelector('head > title');
        if (!titleEl) { setTimeout(trySetup, 300); return; }

        const observer = new MutationObserver(() => {
            if (isEnforcingScreenTitle) return; // 自分自身の書き戻しには反応しない
            if (baseAppTitleForScreenTitle === null) return; // まだ初期化前
            if (isTouchPanelOpen()) return; // タッチパネル側の独自制御を尊重する

            const expected = expectedTitleForCurrentScreen();
            if (document.title !== expected) {
                isEnforcingScreenTitle = true;
                document.title = expected;
                isEnforcingScreenTitle = false;
            }
        });
        observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
    trySetup();
})();
