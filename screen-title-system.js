// ==========================================
// screen-title-system.js
// 画面が切り替わるたびに、ページタイトル（ブラウザのタブに表示される文字）も
// その画面名に合わせて切り替える
// ------------------------------------------
// screen-hash-navigation.js が showScreen() をフックしてURLハッシュを
// 設定しているのと同じ考え方で、ここでも showScreen() をフックし、
// 「画面名-haruレジ」という形式でタイトルを設定する。
// ホーム画面のときは、元々の <title>haruレジ</title> のままにする。
//
// ui.js は直接編集せず、他の追加機能ファイルと同じ「フック方式」で実現する。
// ==========================================

const BASE_PAGE_TITLE = 'haruレジ';

const SCREEN_TITLE_MAP = {
    'home-screen': null, // ホームはベースタイトルのまま
    'register-screen': 'レジ作業',
    'customer-screen': '客用画面',
    'clerk-screen': '担当者管理',
    'product-screen': '商品管理',
    'history-screen': '会計履歴',
    'migration-screen': 'データ管理',
    'customer-mgmt-screen': '会員管理',
    'discount-screen': '自動化バーコード',
    'analytics-screen': '売上分析',
    'sales-mgmt-screen': '売上管理・精算',
    'timecard-screen': 'タイムカード'
};

function updatePageTitleForScreen(screenId) {
    const label = SCREEN_TITLE_MAP[screenId];
    document.title = label ? `${label}-${BASE_PAGE_TITLE}` : BASE_PAGE_TITLE;
}

(function hookShowScreenForTitle() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            updatePageTitleForScreen(screenId);
            return result;
        };
    }
    tryHook();
})();
