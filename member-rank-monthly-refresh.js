// ==========================================
// member-rank-monthly-refresh.js
// ------------------------------------------
// 【背景】
// member-rank.js の月次ランク判定(maybeEvaluateMonthlyRank)は、
// これまで「会計した瞬間」にしか走らなかった（getCustomerRankInfo()経由でも
// 判定されるよう member-rank.js 側は修正済み）。
// ただし、会員管理画面の一覧(customer-tbody)は renderCustomers() が
// cust.rank を直接参照して描画している可能性があり、その場合は
// 「今月の判定がまだ一度も走っていない会員」が一覧を開いただけでは
// 更新されない（＝誰か1人が来店してくれるまで、画面上ずっと古いランクの
// ままに見えてしまう）。
//
// これを避けるため、会員管理画面(customer-mgmt-screen)を開くたび・
// renderCustomers()が呼ばれるたびに、登録されている全会員に対して
// getCustomerRankInfo()（＝毎月判定＋変更があれば保存）を先に一括で
// 実行してから、既存の描画処理を呼び出す。
//
// master-mgmt.js / ui.js / register.js は直接編集せず、
// showScreen() と renderCustomers()（存在すれば）をフックして実現する。
// ==========================================

function refreshAllCustomerRanksNow() {
    if (typeof customers === 'undefined' || !Array.isArray(customers)) return;
    if (typeof getCustomerRankInfo !== 'function') return;
    customers.forEach(cust => {
        try {
            getCustomerRankInfo(cust); // 内部で毎月判定＋変更時の保存まで行われる
        } catch (e) { /* 1件失敗しても他の会員の判定は続ける */ }
    });
}

(function hookShowScreenForRankRefresh() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            if (screenId === 'customer-mgmt-screen') {
                refreshAllCustomerRanksNow();
            }
            const result = original.apply(this, [screenId, ...rest]);
            return result;
        };
    }
    tryHook();
})();

// renderCustomers() が既に存在する環境では、呼ばれるたびにも判定してから描画する
// （showScreen経由でない再描画―例えば会員の追加・編集直後の再描画―にも対応するため）
(function hookRenderCustomersForRankRefresh() {
    function tryHook() {
        if (typeof window.renderCustomers !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderCustomers;
        window.renderCustomers = function (...args) {
            refreshAllCustomerRanksNow();
            return original.apply(this, args);
        };
    }
    tryHook();
})();
