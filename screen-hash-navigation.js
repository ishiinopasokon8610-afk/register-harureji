// ==========================================
// screen-hash-navigation.js
// 画面が切り替わるたびに、その画面用のURLハッシュ（#OOO）を設定する
// ------------------------------------------
// register.js が「会計スタート」（#register）「客用画面」（#customer）で
// すでに行っているのと同じ考え方を、他の画面（担当者管理・商品管理など）
// にも広げる。ブラウザの戻る/進むボタンやブックマーク、リロード時の
// 画面特定に使えるようにするための識別子。
//
// ui.js は直接編集せず、showScreen() をフックして実現する
// （他の追加機能ファイルと同じ「フック方式」）。
//
// ハッシュ名は以下のとおり、このファイルでの追加にあたり決定した:
//   register-screen      → #register   （register.js が既存で設定）
//   customer-screen       → #customer   （register.js が既存で設定）
//   clerk-screen           → #staff
//   product-screen         → #products
//   history-screen          → #receipts
//   migration-screen        → #settings
//   customer-mgmt-screen     → #members
//   discount-screen           → #auto-barcodes
//   analytics-screen          → #analytics
//   sales-mgmt-screen          → #sales
//   timecard-screen              → #timecard
//   home-screen                    → ''（goHome()が既存でクリアする）
// ==========================================

const SCREEN_HASH_MAP = {
    'home-screen': '#home',
    'register-screen': '#register',
    'customer-screen': '#customer',
    'clerk-screen': '#staff',
    'product-screen': '#products',
    'history-screen': '#receipts',
    'migration-screen': '#settings',
    'customer-mgmt-screen': '#members',
    'discount-screen': '#auto-barcodes',
    'analytics-screen': '#analytics',
    'sales-mgmt-screen': '#sales',
    'timecard-screen': '#timecard'
};

(function hookShowScreenForHash() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            const hash = SCREEN_HASH_MAP[screenId];
            if (hash && window.location.hash !== hash) {
                window.location.hash = hash;
            }
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   認証不要の画面については、リロード時にハッシュから復元する。
   店長認証が必要な画面（商品管理・会員管理・データ管理）は、
   認証を経ずに直接開けてしまうとセキュリティ上望ましくないため、
   ここでは復元の対象外とする（既存の #customer / #register と
   同じ安全設計の考え方を踏襲）。
   ========================================================= */
const SCREEN_HASH_RESTORE_SAFE = {
    '#staff': 'clerk-screen',
    '#receipts': 'history-screen',
    '#auto-barcodes': 'discount-screen',
    '#analytics': 'analytics-screen',
    '#sales': 'sales-mgmt-screen',
    '#timecard': 'timecard-screen'
};

window.addEventListener('load', () => {
    // 初期表示（ハッシュ無し）はホーム画面なので、#home を明示的に設定する
    if (!window.location.hash) {
        const homeScreen = document.getElementById('home-screen');
        if (homeScreen && homeScreen.classList.contains('active')) {
            window.location.hash = '#home';
        }
    }

    const hash = window.location.hash;
    const screenId = SCREEN_HASH_RESTORE_SAFE[hash];
    if (!screenId) return;
    // register.js / ui.js 側の #register・#customer・#clerk の復元処理と
    // 競合しないよう、少し遅らせてから実行する
    setTimeout(() => {
        if (screenId === 'analytics-screen' && typeof openAnalyticsScreen === 'function') {
            openAnalyticsScreen();
        } else if (screenId === 'discount-screen' && typeof showScreen === 'function') {
            showScreen('discount-screen');
            if (typeof renderDiscounts === 'function') renderDiscounts();
        } else if (typeof showScreen === 'function') {
            showScreen(screenId);
        }
    }, 200);
});
