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

// 商品マスタの「前回ポーリング時点でのスナップショット」（jan→商品データの複製）。
// 次回ポーリング時にこれと比較することで、「何が変わったか（追加/編集/削除）」を検出する。
let lastKnownProductsList = null;

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

/* =========================================================
   商品マスタの「マージ型」同期
   ------------------------------------------
   【以前の問題】
   products配列を「丸ごと置き換え」していたため、ほぼ同時（数秒以内）に
   別々の端末で別々の商品を追加・編集すると、後から届いた方の配列で
   先に届いていた側の変更ごと上書きされ、消えてしまうことがあった。
   （例：レジAで商品①を追加した直後に、レジBで商品②を追加すると、
   　　　届く順番によってはどちらかが消える）

   【対応】
   会計履歴・タイムカードと同じ「マージ方式」にする。
   各商品にupdatedAt（最終更新時刻）を持たせ、jan（商品コード）をキーに
   「新しい方を採用」して統合する。削除については、削除したという記録
   （tombstone）をupdatedAt付きで別途保持し、他端末の古い商品データに
   よって復活してしまわないようにする。
   ========================================================= */

function getDeletedProductsFromStorage() {
    try {
        return JSON.parse(localStorage.getItem('pos_deleted_products') || '[]');
    } catch (e) {
        return [];
    }
}

// 削除記録（tombstone）どうしをマージする（同じjanは、より新しい削除時刻を優先）。
// 90日より古い削除記録は、際限なく増え続けないよう間引く。
function mergeDeletedProductLists(localList, remoteList) {
    const map = new Map();
    [...(localList || []), ...(remoteList || [])].forEach(d => {
        if (!d || !d.jan) return;
        const existing = map.get(d.jan);
        if (!existing || d.deletedAt > existing.deletedAt) map.set(d.jan, d);
    });
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return Array.from(map.values()).filter(d => d.deletedAt >= cutoff);
}

// この端末で商品が削除されたことを記録する
function recordDeletedProduct(jan, deletedAt) {
    if (!jan) return;
    const list = getDeletedProductsFromStorage();
    list.push({ jan: jan, deletedAt: deletedAt || Date.now() });
    localStorage.setItem('pos_deleted_products', JSON.stringify(mergeDeletedProductLists(list, [])));
}

// 商品配列を jan → 商品データ（複製） のMapに変換する。
// 複製するのは、後から products 配列側だけを書き換えても
// このMap（＝前回スナップショット）が引きずられて変わってしまわないようにするため。
function getProductsMapByJan(list) {
    const map = new Map();
    (list || []).forEach(p => {
        if (p && p.jan) map.set(p.jan, JSON.parse(JSON.stringify(p)));
    });
    return map;
}

// 商品どうしをマージする（jan単位で、updatedAtが新しい方を採用。削除記録があれば除外する）
function mergeProductLists(localList, remoteList, deletedList) {
    const deletedMap = new Map();
    (deletedList || []).forEach(d => {
        if (d && d.jan) deletedMap.set(d.jan, d);
    });

    const map = new Map();
    [...(localList || []), ...(remoteList || [])].forEach(p => {
        if (!p || !p.jan) return;
        const existing = map.get(p.jan);
        const pTime = p.updatedAt || 0;
        if (!existing || pTime >= (existing.updatedAt || 0)) {
            map.set(p.jan, p);
        }
    });

    deletedMap.forEach((d, jan) => {
        const p = map.get(jan);
        // 削除記録の時刻より後に更新されていない商品だけを、実際に除外する
        // （削除された後に別端末で「同じjanで再登録」された場合は残す）
        if (p && (p.updatedAt || 0) <= d.deletedAt) {
            map.delete(jan);
        }
    });

    return Array.from(map.values());
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
        channel.publish('products-sync', {
            products: products,
            deletedProducts: getDeletedProductsFromStorage(),
            senderId: SYNC_DEVICE_ID,
            time: Date.now()
        });
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
            // 初回は基準を記録するだけ（送信はしない）
            lastSyncedProductsSnapshot = currentProductsSnapshot;
            lastKnownProductsList = getProductsMapByJan(products);
        } else if (currentProductsSnapshot !== lastSyncedProductsSnapshot) {
            const now = Date.now();

            // 追加・変更された商品に updatedAt を付与する
            // （updatedAt自体は比較対象から除外し、中身が変わった商品だけを対象にする）
            products.forEach(p => {
                if (!p || !p.jan) return;
                const prev = lastKnownProductsList ? lastKnownProductsList.get(p.jan) : null;
                const prevCompare = prev ? JSON.stringify({ ...prev, updatedAt: undefined }) : null;
                const curCompare = JSON.stringify({ ...p, updatedAt: undefined });
                if (!prev || prevCompare !== curCompare) {
                    p.updatedAt = now;
                }
            });

            // 前回は存在したのに今回消えている商品 → 削除されたとみなし、tombstoneを記録
            if (lastKnownProductsList) {
                const currentJans = new Set(products.filter(p => p && p.jan).map(p => p.jan));
                lastKnownProductsList.forEach((prevP, jan) => {
                    if (!currentJans.has(jan)) {
                        recordDeletedProduct(jan, now);
                    }
                });
            }

            localStorage.setItem('pos_products', JSON.stringify(products));
            lastSyncedProductsSnapshot = JSON.stringify(products);
            lastKnownProductsList = getProductsMapByJan(products);
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

            const remoteDeleted = Array.isArray(msg.data.deletedProducts) ? msg.data.deletedProducts : [];
            const mergedDeleted = mergeDeletedProductLists(getDeletedProductsFromStorage(), remoteDeleted);
            const merged = mergeProductLists(products, msg.data.products, mergedDeleted);

            products = merged;
            localStorage.setItem('pos_products', JSON.stringify(products));
            localStorage.setItem('pos_deleted_products', JSON.stringify(mergedDeleted));
            // マージ結果を「送信済み」として記録しておく（この処理自体を次回ポーリングで
            // 「ローカルでの変化」と誤検知して再送信ループになるのを防ぐため）
            lastSyncedProductsSnapshot = JSON.stringify(products);
            lastKnownProductsList = getProductsMapByJan(products);
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
