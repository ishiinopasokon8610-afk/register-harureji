// ==========================================
// ハイテク音声レジスター - 商品・お会計履歴・タイムカードの複数端末同期システム
// すでに割引バーコード（discount-system.js）は同期対応済み。
// ここでは「商品マスタ（pos_products）」「お会計履歴（pos_history）」
// 「タイムカード（pos_timecard）」を他の端末（スマホ・レジ端末など）とも
// リアルタイムに同期する。
//
// master-mgmt.js / register.js は直接編集せず、
// 定期的にデータの変化を検知して自動的にAbly経由で送信する方式をとる
// （商品の保存箇所が複数あり、1箇所のフックだけでは拾いきれないため）。
// ==========================================

const SYNC_DEVICE_ID = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);

let lastSyncedProductsSnapshot = null;
let lastSyncedHistorySnapshot = null;
let lastSyncedTimecardSnapshot = null;

function getHistoryFromStorage() {
    try {
        return JSON.parse(localStorage.getItem('pos_history') || '[]');
    } catch (e) {
        return [];
    }
}

function getTimecardFromStorage() {
    try {
        return JSON.parse(localStorage.getItem('pos_timecard') || '[]');
    } catch (e) {
        return [];
    }
}

// タイムカードどうしをマージする（同じ記録[id]は、より多く打刻されている方を優先する）
function mergeTimecardLists(localList, remoteList) {
    const fillCount = (r) => ['clockIn', 'breakStart', 'breakEnd', 'clockOut'].filter(k => r && r[k]).length;
    const map = new Map();
    const keyOf = (item) => item.id || `${item.date}_${item.clerkName}`;

    [...localList, ...remoteList].forEach(item => {
        const key = keyOf(item);
        const existing = map.get(key);
        if (!existing || fillCount(item) >= fillCount(existing)) {
            map.set(key, item);
        }
    });

    return Array.from(map.values()).sort((a, b) => (b.id || 0) - (a.id || 0));
}

// 会計履歴どうしをマージする（同じ取引を重複させない）
function mergeHistoryLists(localList, remoteList) {
    const map = new Map();
    const keyOf = (item) => item.id || item.dateISO || item.date;

    [...localList, ...remoteList].forEach(item => {
        map.set(keyOf(item), item);
    });

    return Array.from(map.values()).sort((a, b) => {
        const ta = a.dateISO ? new Date(a.dateISO).getTime() : new Date(a.date).getTime();
        const tb = b.dateISO ? new Date(b.dateISO).getTime() : new Date(b.date).getTime();
        return tb - ta; // 新しい順
    }).slice(0, 3000);
}

function broadcastProductsSync() {
    if (typeof channel === 'undefined' || !channel || typeof products === 'undefined') return;
    try {
        channel.publish('products-sync', { products: products, senderId: SYNC_DEVICE_ID, time: Date.now() });
    } catch (err) {
        console.warn('商品データの同期送信に失敗しました:', err);
    }
}

function broadcastHistorySync() {
    if (typeof channel === 'undefined' || !channel) return;
    try {
        channel.publish('history-sync', { history: getHistoryFromStorage(), senderId: SYNC_DEVICE_ID, time: Date.now() });
    } catch (err) {
        console.warn('会計履歴の同期送信に失敗しました:', err);
    }
}

function broadcastTimecardSync() {
    if (typeof channel === 'undefined' || !channel) return;
    try {
        channel.publish('timecard-sync', { timecards: getTimecardFromStorage(), senderId: SYNC_DEVICE_ID, time: Date.now() });
    } catch (err) {
        console.warn('タイムカードの同期送信に失敗しました:', err);
    }
}

// 2秒ごとに、商品・会計履歴がローカルで変化していないかチェックし、
// 変化していれば他端末へ自動送信する
setInterval(() => {
    if (typeof products !== 'undefined') {
        const currentProductsSnapshot = JSON.stringify(products);
        if (lastSyncedProductsSnapshot === null) {
            lastSyncedProductsSnapshot = currentProductsSnapshot;
        } else if (currentProductsSnapshot !== lastSyncedProductsSnapshot) {
            lastSyncedProductsSnapshot = currentProductsSnapshot;
            broadcastProductsSync();
        }
    }

    const currentHistorySnapshot = localStorage.getItem('pos_history') || '[]';
    if (lastSyncedHistorySnapshot === null) {
        lastSyncedHistorySnapshot = currentHistorySnapshot;
    } else if (currentHistorySnapshot !== lastSyncedHistorySnapshot) {
        lastSyncedHistorySnapshot = currentHistorySnapshot;
        broadcastHistorySync();
    }

    const currentTimecardSnapshot = localStorage.getItem('pos_timecard') || '[]';
    if (lastSyncedTimecardSnapshot === null) {
        lastSyncedTimecardSnapshot = currentTimecardSnapshot;
    } else if (currentTimecardSnapshot !== lastSyncedTimecardSnapshot) {
        lastSyncedTimecardSnapshot = currentTimecardSnapshot;
        broadcastTimecardSync();
    }
}, 2000);

// 他端末からの同期データを受信する
(function waitForChannelAndSubscribeSync() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('products-sync', (msg) => {
            if (!msg || !msg.data || msg.data.senderId === SYNC_DEVICE_ID) return;
            if (!Array.isArray(msg.data.products)) return;

            products = msg.data.products;
            localStorage.setItem('pos_products', JSON.stringify(products));
            lastSyncedProductsSnapshot = JSON.stringify(products);
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

            // 商品一覧・割引バーコード作成画面のプルダウンなど、開いている画面があれば更新する
            const productScreen = document.getElementById('product-screen');
            if (productScreen && productScreen.classList.contains('active') && typeof renderProducts === 'function') {
                renderProducts();
            }
            if (typeof populateProductSelect === 'function') {
                populateProductSelect(document.getElementById('new-disc-product-select'));
                populateProductSelect(document.getElementById('edit-disc-product-select'));
            }
        });

        channel.subscribe('history-sync', (msg) => {
            if (!msg || !msg.data || msg.data.senderId === SYNC_DEVICE_ID) return;
            if (!Array.isArray(msg.data.history)) return;

            const localHistory = getHistoryFromStorage();
            const merged = mergeHistoryLists(localHistory, msg.data.history);
            localStorage.setItem('pos_history', JSON.stringify(merged));
            lastSyncedHistorySnapshot = JSON.stringify(merged);
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

            const historyScreen = document.getElementById('history-screen');
            if (historyScreen && historyScreen.classList.contains('active') && typeof renderHistory === 'function') {
                renderHistory();
            }
            if (typeof renderAnalytics === 'function') {
                const analyticsScreen = document.getElementById('analytics-screen');
                if (analyticsScreen && analyticsScreen.classList.contains('active')) renderAnalytics();
            }
        });

        channel.subscribe('timecard-sync', (msg) => {
            if (!msg || !msg.data || msg.data.senderId === SYNC_DEVICE_ID) return;
            if (!Array.isArray(msg.data.timecards)) return;

            const localTimecards = getTimecardFromStorage();
            const merged = mergeTimecardLists(localTimecards, msg.data.timecards);
            localStorage.setItem('pos_timecard', JSON.stringify(merged));
            lastSyncedTimecardSnapshot = JSON.stringify(merged);
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

            const timecardScreen = document.getElementById('timecard-screen');
            if (timecardScreen && timecardScreen.classList.contains('active') && typeof renderTimecardTable === 'function') {
                renderTimecardTable();
            }
        });
    } else {
        setTimeout(waitForChannelAndSubscribeSync, 500);
    }
})();
