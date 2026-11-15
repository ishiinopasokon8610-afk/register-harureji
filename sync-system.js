// ==========================================
// ハイテク音声レジスター - 商品・お会計履歴・タイムカードの複数端末同期システム
// すでに割引バーコード（discount-system.js）は同期対応済み。
// ここでは「商品マスタ（pos_products）」「お会計履歴（pos_history）」
// 「タイムカード（pos_timecard）」を他の端末（スマホ・レジ端末など）とも
// リアルタイムに同期する。
//
// master-mgmt.js / register.js は直接編集せず、
// 定期的にデータの変化を検知して自動的にFirebase経由で送信する方式をとる
//
// 【今回の改良：差分送信】
// これまでは、商品・会計履歴（最大3000件）・タイムカードを、何か1件変わるたびに
// 「全部まるごと」暗号化して送っていた。会計のたびに履歴まるごと（数MB）が全端末へ
// 届き、受け取る側も復号・統合を毎回行うため、同期が遅くなっていた。
// → 変わった分（追加・変更された商品／取引／打刻と、新しい削除記録）だけを送る。
//   受信側は元から「統合（マージ）」方式なので、受信処理は変更不要。
// → ただし差分だけだと、後から参加した端末は過去分を受け取れない。
//   そこで「全部送って」と頼む仕組み（sync-request）を追加した。
//   ・データ用コードを受け取った直後
//   ・前回の依頼から12時間以上たった状態で起動した時
//   に自動で依頼し、すでに動いている端末のうち1台が全データを返す。
//   手動で行いたい時は、コンソールで requestFullSync() を実行する。
// （商品の保存箇所が複数あり、1箇所のフックだけでは拾いきれないため）。
// ==========================================

const SYNC_DEVICE_ID = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);

let lastSyncedProductsSnapshot = null;
let lastSyncedHistorySnapshot = null;
let lastKnownHistoryKeys = null;
let lastKnownHistoryMap = null;   // 取引キー → 中身(JSON文字列)。変更検出用
let lastKnownTimecardMap = null;  // 打刻キー → 中身(JSON文字列)。変更検出用
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

// 会計履歴どうしをマージする（同じ取引を重複させない）
// ------------------------------------------
// 【以前の問題】単純な「和集合（両方とも残す）」方式だったため、
// 返金（refund.js）や履歴削除でこの端末からレコードを消しても、
// 他端末からの同期がその古いレコードをまた運んできてしまい、
// 消したはずの履歴が復活する／他端末には反映されない、という不具合があった。
// 【対応】商品マスタと同じ「削除記録（tombstone）」方式にする。
function keyOfHistory(item) { return item.id || item.dateISO || item.date; }

function getDeletedHistoryFromStorage() {
    try {
        return JSON.parse(localStorage.getItem('pos_deleted_history') || '[]');
    } catch (e) {
        return [];
    }
}

// 削除記録どうしをマージする（同じキーは、より新しい削除時刻を優先）。
// 90日より古い削除記録は間引く（商品の削除記録と同じ方針）。
function mergeDeletedHistoryLists(localList, remoteList) {
    const map = new Map();
    [...(localList || []), ...(remoteList || [])].forEach(d => {
        if (!d || !d.key) return;
        const existing = map.get(d.key);
        if (!existing || d.deletedAt > existing.deletedAt) map.set(d.key, d);
    });
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return Array.from(map.values()).filter(d => d.deletedAt >= cutoff);
}

// この端末で履歴が削除された（返金・履歴削除・全削除）ことを記録する
function recordDeletedHistory(key, deletedAt) {
    if (!key) return;
    const list = getDeletedHistoryFromStorage();
    list.push({ key: key, deletedAt: deletedAt || Date.now() });
    localStorage.setItem('pos_deleted_history', JSON.stringify(mergeDeletedHistoryLists(list, [])));
}

function mergeHistoryLists(localList, remoteList, deletedList) {
    const deletedMap = new Map();
    (deletedList || []).forEach(d => {
        if (d && d.key) deletedMap.set(d.key, d);
    });

    const map = new Map();
    [...localList, ...remoteList].forEach(item => {
        map.set(keyOfHistory(item), item);
    });

    // 削除記録があるものは除外する（返金・履歴削除で消えた取引を復活させない）
    deletedMap.forEach((d, key) => {
        map.delete(key);
    });

    return Array.from(map.values()).sort((a, b) => {
        const ta = a.dateISO ? new Date(a.dateISO).getTime() : new Date(a.date).getTime();
        const tb = b.dateISO ? new Date(b.dateISO).getTime() : new Date(b.date).getTime();
        return tb - ta; // 新しい順
    }).slice(0, 3000);
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
// ※ 実際の定義は上のtombstone対応版（keyOfHistoryを使うもの）を使用する。
//    この位置には以前、和集合のみの単純な旧実装があったが、削除記録を
//    考慮していなかったため上に置き換えた（重複定義になるため削除）。

// 差分送信用：渡された内容を複製する（送信待ちの間に元データが変わっても影響しないように）
function cloneForSync(v) {
    return JSON.parse(JSON.stringify(v));
}

// delta を渡すと「変わった分だけ」、渡さないと「全部」を送る
function broadcastProductsSync(delta) {
    if (typeof channel === 'undefined' || !channel || typeof products === 'undefined') return;
    try {
        const isDelta = delta && typeof delta === 'object' && Array.isArray(delta.products);
        channel.publish('products-sync', {
            products: isDelta ? cloneForSync(delta.products) : products,
            deletedProducts: isDelta ? (delta.deletedProducts || []) : getDeletedProductsFromStorage(),
            partial: !!isDelta,
            senderId: SYNC_DEVICE_ID,
            time: Date.now()
        });
    } catch (err) {
        console.warn('商品データの同期送信に失敗しました:', err);
    }
}

function broadcastHistorySync(delta) {
    if (typeof channel === 'undefined' || !channel) return;
    try {
        const isDelta = delta && typeof delta === 'object' && Array.isArray(delta.history);
        channel.publish('history-sync', {
            history: isDelta ? cloneForSync(delta.history) : getHistoryFromStorage(),
            deletedHistory: isDelta ? (delta.deletedHistory || []) : getDeletedHistoryFromStorage(),
            partial: !!isDelta,
            senderId: SYNC_DEVICE_ID,
            time: Date.now()
        });
    } catch (err) {
        console.warn('会計履歴の同期送信に失敗しました:', err);
    }
}

function broadcastTimecardSync(delta) {
    if (typeof channel === 'undefined' || !channel) return;
    try {
        const isDelta = delta && typeof delta === 'object' && Array.isArray(delta.timecards);
        channel.publish('timecard-sync', {
            timecards: isDelta ? cloneForSync(delta.timecards) : getTimecardFromStorage(),
            partial: !!isDelta,
            senderId: SYNC_DEVICE_ID,
            time: Date.now()
        });
    } catch (err) {
        console.warn('タイムカードの同期送信に失敗しました:', err);
    }
}

function historyMapOf(list) {
    const m = new Map();
    (list || []).forEach(it => { if (it) m.set(keyOfHistory(it), JSON.stringify(it)); });
    return m;
}

function timecardKeyOf(item) { return item.id || `${item.date}_${item.clerkName}`; }

function timecardMapOf(list) {
    const m = new Map();
    (list || []).forEach(it => { if (it) m.set(timecardKeyOf(it), JSON.stringify(it)); });
    return m;
}

/* =========================================================
   全データの送信と、「全部送って」の依頼・返信
   ========================================================= */
function broadcastAllSyncNow() {
    broadcastProductsSync();
    broadcastHistorySync();
    broadcastTimecardSync();
    if (typeof broadcastCustomersSync === 'function') broadcastCustomersSync();
}

const FULL_SYNC_STAMP_KEY = 'pos_sync_last_full_request_at'; // pos_sync_ で始まるので、バックアップ・設定同期の対象外
const FULL_SYNC_AUTO_INTERVAL_MS = 12 * 60 * 60 * 1000;
const pendingFullSyncReplies = new Map(); // requestId → 返信待ちタイマー
let lastFullSyncRequestAt = 0;

function requestFullSync() {
    if (typeof channel === 'undefined' || !channel) return;
    if (window.PosSync && typeof window.PosSync.getCode === 'function' && !window.PosSync.getCode()) return;
    if (Date.now() - lastFullSyncRequestAt < 5000) return; // 立て続けの依頼は1回にまとめる
    lastFullSyncRequestAt = Date.now();
    try { localStorage.setItem(FULL_SYNC_STAMP_KEY, String(Date.now())); } catch (e) { /* 無視 */ }
    channel.publish('sync-request', {
        requestId: SYNC_DEVICE_ID + '_' + Date.now(),
        senderId: SYNC_DEVICE_ID
    });
}
window.requestFullSync = requestFullSync;

function maybeAutoRequestFullSync() {
    let last = 0;
    try { last = Number(localStorage.getItem(FULL_SYNC_STAMP_KEY)) || 0; } catch (e) { /* 無視 */ }
    if (Date.now() - last > FULL_SYNC_AUTO_INTERVAL_MS) requestFullSync();
}

window.addEventListener('pos-sync-ready', maybeAutoRequestFullSync);
window.addEventListener('pos-sync-code-changed', (e) => {
    // データ用コードを「受け取った」直後は、必ず全データを依頼する
    if (e && e.detail && e.detail.received) setTimeout(requestFullSync, 500);
});
if (window.PosSync && typeof window.PosSync.isReady === 'function' && window.PosSync.isReady()) {
    maybeAutoRequestFullSync(); // このファイルの読み込みより前に準備が終わっていた場合の保険
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
            const changedProducts = [];
            const newDeletedProducts = [];
            products.forEach(p => {
                if (!p || !p.jan) return;
                const prev = lastKnownProductsList ? lastKnownProductsList.get(p.jan) : null;
                const prevCompare = prev ? JSON.stringify({ ...prev, updatedAt: undefined }) : null;
                const curCompare = JSON.stringify({ ...p, updatedAt: undefined });
                if (!prev || prevCompare !== curCompare) {
                    p.updatedAt = now;
                    changedProducts.push(p);
                }
            });

            // 前回は存在したのに今回消えている商品 → 削除されたとみなし、tombstoneを記録
            if (lastKnownProductsList) {
                const currentJans = new Set(products.filter(p => p && p.jan).map(p => p.jan));
                lastKnownProductsList.forEach((prevP, jan) => {
                    if (!currentJans.has(jan)) {
                        recordDeletedProduct(jan, now);
                        newDeletedProducts.push({ jan: jan, deletedAt: now });
                    }
                });
            }

            localStorage.setItem('pos_products', JSON.stringify(products));
            lastSyncedProductsSnapshot = JSON.stringify(products);
            lastKnownProductsList = getProductsMapByJan(products);
            // 変わった商品・新しい削除記録だけを送る（並び替えだけ等で変化が無ければ送らない）
            if (changedProducts.length > 0 || newDeletedProducts.length > 0) {
                broadcastProductsSync({ products: changedProducts, deletedProducts: newDeletedProducts });
            }
        }
    }

    const currentHistorySnapshot = localStorage.getItem('pos_history') || '[]';
    if (lastSyncedHistorySnapshot === null) {
        lastSyncedHistorySnapshot = currentHistorySnapshot;
        const initialHistory = getHistoryFromStorage();
        lastKnownHistoryKeys = new Set(initialHistory.map(keyOfHistory));
        lastKnownHistoryMap = historyMapOf(initialHistory);
    } else if (currentHistorySnapshot !== lastSyncedHistorySnapshot) {
        const nowHistory = Date.now();
        const currentHistoryList = getHistoryFromStorage();
        const currentKeys = new Set(currentHistoryList.map(keyOfHistory));
        const currentHistoryMap = historyMapOf(currentHistoryList);

        // 追加・中身が変わった取引だけを送る
        const changedHistory = currentHistoryList.filter(it => {
            if (!it) return false;
            const k = keyOfHistory(it);
            return !lastKnownHistoryMap || lastKnownHistoryMap.get(k) !== currentHistoryMap.get(k);
        });
        const newDeletedHistory = [];

        // 前回は存在したのに今回消えている取引 → 返金・履歴削除されたとみなし、tombstoneを記録
        // （これにより、他端末からの同期で消したはずの履歴が復活するのを防ぐ）
        if (lastKnownHistoryKeys) {
            lastKnownHistoryKeys.forEach(key => {
                if (!currentKeys.has(key)) {
                    recordDeletedHistory(key, nowHistory);
                    newDeletedHistory.push({ key: key, deletedAt: nowHistory });
                }
            });
        }

        lastSyncedHistorySnapshot = currentHistorySnapshot;
        lastKnownHistoryKeys = currentKeys;
        lastKnownHistoryMap = currentHistoryMap;
        if (changedHistory.length > 0 || newDeletedHistory.length > 0) {
            broadcastHistorySync({ history: changedHistory, deletedHistory: newDeletedHistory });
        }
    }

    const currentTimecardSnapshot = localStorage.getItem('pos_timecard') || '[]';
    if (lastSyncedTimecardSnapshot === null) {
        lastSyncedTimecardSnapshot = currentTimecardSnapshot;
        lastKnownTimecardMap = timecardMapOf(getTimecardFromStorage());
    } else if (currentTimecardSnapshot !== lastSyncedTimecardSnapshot) {
        lastSyncedTimecardSnapshot = currentTimecardSnapshot;
        const currentTimecards = getTimecardFromStorage();
        const currentTimecardMap = timecardMapOf(currentTimecards);
        const changedTimecards = currentTimecards.filter(it => {
            if (!it) return false;
            return !lastKnownTimecardMap || lastKnownTimecardMap.get(timecardKeyOf(it)) !== currentTimecardMap.get(timecardKeyOf(it));
        });
        lastKnownTimecardMap = currentTimecardMap;
        if (changedTimecards.length > 0) broadcastTimecardSync({ timecards: changedTimecards });
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
            const remoteDeleted = Array.isArray(msg.data.deletedHistory) ? msg.data.deletedHistory : [];
            const mergedDeleted = mergeDeletedHistoryLists(getDeletedHistoryFromStorage(), remoteDeleted);
            const merged = mergeHistoryLists(localHistory, msg.data.history, mergedDeleted);
            localStorage.setItem('pos_history', JSON.stringify(merged));
            localStorage.setItem('pos_deleted_history', JSON.stringify(mergedDeleted));
            lastSyncedHistorySnapshot = JSON.stringify(merged);
            lastKnownHistoryKeys = new Set(merged.map(keyOfHistory));
            lastKnownHistoryMap = historyMapOf(merged);
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
            lastKnownTimecardMap = timecardMapOf(merged);
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

            const timecardScreen = document.getElementById('timecard-screen');
            if (timecardScreen && timecardScreen.classList.contains('active') && typeof renderTimecardTable === 'function') {
                renderTimecardTable();
            }
        });

        // 他の端末から「全部送って」と頼まれたら、少し待ってから全データを送る。
        // 複数台が同時に返すと無駄なので、ランダムに待ち、先に誰かが返した（sync-full-sent）
        // のを見たら自分の返信はやめる。
        channel.subscribe('sync-request', (msg) => {
            const d = msg && msg.data;
            if (!d || !d.requestId || d.senderId === SYNC_DEVICE_ID) return;
            if (pendingFullSyncReplies.has(d.requestId)) return;
            const timer = setTimeout(() => {
                pendingFullSyncReplies.delete(d.requestId);
                broadcastAllSyncNow();
                try { channel.publish('sync-full-sent', { requestId: d.requestId, senderId: SYNC_DEVICE_ID }); } catch (e) { /* 無視 */ }
            }, 300 + Math.random() * 2200);
            pendingFullSyncReplies.set(d.requestId, timer);
        });
        channel.subscribe('sync-full-sent', (msg) => {
            const d = msg && msg.data;
            if (!d || d.senderId === SYNC_DEVICE_ID) return;
            const timer = pendingFullSyncReplies.get(d.requestId);
            if (timer) { clearTimeout(timer); pendingFullSyncReplies.delete(d.requestId); }
        });
    } else {
        setTimeout(waitForChannelAndSubscribeSync, 500);
    }
})();
