// ==========================================
// order-system-settings.js
// 「データ管理・ロゴ設定」画面に、以下2つのチェックボックス（✅）を追加する。
//   ① 呼び出し番号を出す
//   ② オーダーシステムを利用する
// 設定値はlocalStorageに保存し、他の機能から
//   isShowCallNumberEnabled() / isUseOrderSystemEnabled()
// で参照できるようにする。
//
// index.html / master-mgmt.js は直接編集せず、migration-screenが
// 表示されるタイミング（showScreen()フック）でブロックをDOMに追加する
// （shop-id-settings-container と同じ「後付けブロック」方式）。
// ==========================================

const SHOW_CALL_NUMBER_KEY = 'pos_show_call_number';
const USE_ORDER_SYSTEM_KEY = 'pos_use_order_system';

function isShowCallNumberEnabled() {
    return localStorage.getItem(SHOW_CALL_NUMBER_KEY) === 'true';
}
function isUseOrderSystemEnabled() {
    return localStorage.getItem(USE_ORDER_SYSTEM_KEY) === 'true';
}

function toggleShowCallNumber() {
    const cb = document.getElementById('show-call-number-check');
    localStorage.setItem(SHOW_CALL_NUMBER_KEY, (cb && cb.checked) ? 'true' : 'false');
    if (typeof playSound === 'function') playSound('click');
}

function toggleUseOrderSystem() {
    const cb = document.getElementById('use-order-system-check');
    localStorage.setItem(USE_ORDER_SYSTEM_KEY, (cb && cb.checked) ? 'true' : 'false');
    if (typeof playSound === 'function') playSound('click');
}

function ensureOrderSystemSettingsBlock() {
    if (document.getElementById('order-system-settings-block')) {
        syncOrderSystemCheckboxes();
        return;
    }
    const container = document.getElementById('migration-screen');
    if (!container) return;

    const block = document.createElement('div');
    block.id = 'order-system-settings-block';
    block.className = 'migration-block';
    block.style.cssText = 'background:#fff8e1; border:2px solid #ffca28; padding:15px; border-radius:6px; margin-top:15px;';
    block.innerHTML = `
        <h3 class="migration-title" style="color:#f57f17;">🔢 呼び出し番号・オーダーシステムの設定</h3>
        <label style="font-weight:bold; display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <input type="checkbox" id="show-call-number-check" onchange="toggleShowCallNumber()">
            ✅ 呼び出し番号を出す
        </label>
        <label style="font-weight:bold; display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="use-order-system-check" onchange="toggleUseOrderSystem()">
            ✅ オーダーシステムを利用する
        </label>
    `;
    container.appendChild(block);
    syncOrderSystemCheckboxes();
}

function syncOrderSystemCheckboxes() {
    const cb1 = document.getElementById('show-call-number-check');
    const cb2 = document.getElementById('use-order-system-check');
    if (cb1) cb1.checked = isShowCallNumberEnabled();
    if (cb2) cb2.checked = isUseOrderSystemEnabled();
}

(function hookShowScreenForOrderSettings() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId) {
            const result = original(screenId);
            if (screenId === 'migration-screen') ensureOrderSystemSettingsBlock();
            return result;
        };
    }
    tryHook();
})();
