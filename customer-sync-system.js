// ==========================================
// customer-sync-system.js
// 会員・顧客データ（pos_customers）の複数端末リアルタイム同期
// ------------------------------------------
// これまで商品マスタ・お会計履歴・タイムカード・自動化バーコード・
// レシートメッセージ・商品連動クーポンはAbly経由で他端末と同期されていたが、
// 会員・顧客データ（pos_customers）だけは同期対象になっておらず、
// ある端末で新規会員登録やポイント変更をしても他端末には反映されなかった。
//
// member-number-system.js（会員番号機能）が複数端末で正しく機能するためにも、
// まずはここで顧客データそのものの同期を実現する。
//
// 【方式】
// sync-system.js の商品マスタ同期と同じ「マージ型」:
// 各顧客にupdatedAt（最終更新時刻）を持たせ、barcode（会員証バーコード）を
// キーに「新しい方を採用」して統合する。削除（退会）についてはtombstone
// （削除記録）をupdatedAt付きで別途保持し、他端末の古い顧客データによって
// 復活してしまわないようにする。
//
// master-mgmt.js は直接編集せず、既存のsync-system.jsと同じ「2秒ごとの
// ポーリングで変化を検知して自動送信する」方式をとる（会員登録・編集・退会・
// ポイント変更の保存箇所が複数あり、1箇所のフックだけでは拾いきれないため）。
// ==========================================

let lastSyncedCustomersSnapshot = null;
let lastKnownCustomersMap = null;

function getDeletedCustomersFromStorage() {
    try {
        return JSON.parse(localStorage.getItem('pos_deleted_customers') || '[]');
    } catch (e) {
        return [];
    }
}

// 削除記録（tombstone）どうしをマージする（同じbarcodeは、より新しい削除時刻を優先）。
// 90日より古い削除記録は、際限なく増え続けないよう間引く（sync-system.jsの商品と同じ）。
function mergeDeletedCustomerLists(localList, remoteList) {
    const map = new Map();
    [...(localList || []), ...(remoteList || [])].forEach(d => {
        if (!d || !d.barcode) return;
        const existing = map.get(d.barcode);
        if (!existing || d.deletedAt > existing.deletedAt) map.set(d.barcode, d);
    });
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return Array.from(map.values()).filter(d => d.deletedAt >= cutoff);
}

// この端末で会員が退会（削除）されたことを記録する
function recordDeletedCustomer(barcode, deletedAt) {
    if (!barcode) return;
    const list = getDeletedCustomersFromStorage();
    list.push({ barcode, deletedAt: deletedAt || Date.now() });
    localStorage.setItem('pos_deleted_customers', JSON.stringify(mergeDeletedCustomerLists(list, [])));
}

// 顧客配列を barcode → 顧客データ（複製） のMapに変換する
function getCustomersMapByBarcode(list) {
    const map = new Map();
    (list || []).forEach(c => {
        if (c && c.barcode) map.set(c.barcode, JSON.parse(JSON.stringify(c)));
    });
    return map;
}

// 顧客どうしをマージする（barcode単位で、updatedAtが新しい方を採用。削除記録があれば除外する）
function mergeCustomerLists(localList, remoteList, deletedList) {
    const deletedMap = new Map();
    (deletedList || []).forEach(d => {
        if (d && d.barcode) deletedMap.set(d.barcode, d);
    });

    const map = new Map();
    [...(localList || []), ...(remoteList || [])].forEach(c => {
        if (!c || !c.barcode) return;
        const existing = map.get(c.barcode);
        const cTime = c.updatedAt || 0;
        if (!existing || cTime >= (existing.updatedAt || 0)) {
            map.set(c.barcode, c);
        }
    });

    deletedMap.forEach((d, barcode) => {
        const c = map.get(barcode);
        // 削除記録の時刻より後に更新されていない顧客だけを、実際に除外する
        // （退会後に別端末で「同じbarcodeで再登録」された場合は残す）
        if (c && (c.updatedAt || 0) <= d.deletedAt) {
            map.delete(barcode);
        }
    });

    return Array.from(map.values());
}

function broadcastCustomersSync() {
    if (typeof channel === 'undefined' || !channel || typeof customers === 'undefined') return;
    try {
        channel.publish('customers-sync', {
            customers: customers,
            deletedCustomers: getDeletedCustomersFromStorage(),
            senderId: (typeof SYNC_DEVICE_ID !== 'undefined') ? SYNC_DEVICE_ID : null,
            time: Date.now()
        });
    } catch (err) {
        console.warn('会員データの同期送信に失敗しました:', err);
    }
}

// 2秒ごとに、会員データがローカルで変化していないかチェックし、
// 変化していれば他端末へ自動送信する（sync-system.jsの商品マスタ同期と同じ方式）
setInterval(() => {
    if (typeof customers === 'undefined') return;

    const currentSnapshot = JSON.stringify(customers);
    if (lastSyncedCustomersSnapshot === null) {
        // 初回は基準を記録するだけ（送信はしない）
        lastSyncedCustomersSnapshot = currentSnapshot;
        lastKnownCustomersMap = getCustomersMapByBarcode(customers);
        return;
    }
    if (currentSnapshot === lastSyncedCustomersSnapshot) return;

    const now = Date.now();

    // 追加・変更された会員に updatedAt を付与する
    // （updatedAt自体は比較対象から除外し、中身が変わった会員だけを対象にする）
    customers.forEach(c => {
        if (!c || !c.barcode) return;
        const prev = lastKnownCustomersMap ? lastKnownCustomersMap.get(c.barcode) : null;
        const prevCompare = prev ? JSON.stringify({ ...prev, updatedAt: undefined }) : null;
        const curCompare = JSON.stringify({ ...c, updatedAt: undefined });
        if (!prev || prevCompare !== curCompare) {
            c.updatedAt = now;
        }
    });

    // 前回は存在したのに今回消えている会員 → 退会したとみなし、tombstoneを記録
    if (lastKnownCustomersMap) {
        const currentBarcodes = new Set(customers.filter(c => c && c.barcode).map(c => c.barcode));
        lastKnownCustomersMap.forEach((prevC, barcode) => {
            if (!currentBarcodes.has(barcode)) {
                recordDeletedCustomer(barcode, now);
            }
        });
    }

    localStorage.setItem('pos_customers', JSON.stringify(customers));
    lastSyncedCustomersSnapshot = JSON.stringify(customers);
    lastKnownCustomersMap = getCustomersMapByBarcode(customers);
    broadcastCustomersSync();
}, 2000);

// 他端末からの会員データ同期を受信する
(function waitForChannelAndSubscribeCustomerSync() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('customers-sync', (msg) => {
            if (!msg || !msg.data) return;
            if (msg.data.senderId && typeof SYNC_DEVICE_ID !== 'undefined' && msg.data.senderId === SYNC_DEVICE_ID) return;
            if (!Array.isArray(msg.data.customers)) return;

            const remoteDeleted = Array.isArray(msg.data.deletedCustomers) ? msg.data.deletedCustomers : [];
            const mergedDeleted = mergeDeletedCustomerLists(getDeletedCustomersFromStorage(), remoteDeleted);
            customers = mergeCustomerLists(customers, msg.data.customers, mergedDeleted);

            // 会員番号の重複があれば解消する（member-number-system.js が読み込まれていれば）
            if (typeof resolveDuplicateMemberNos === 'function') {
                resolveDuplicateMemberNos();
            }

            localStorage.setItem('pos_customers', JSON.stringify(customers));
            localStorage.setItem('pos_deleted_customers', JSON.stringify(mergedDeleted));
            // マージ結果を「送信済み」として記録しておく（この処理自体を次回ポーリングで
            // 「ローカルでの変化」と誤検知して再送信ループになるのを防ぐため）
            lastSyncedCustomersSnapshot = JSON.stringify(customers);
            lastKnownCustomersMap = getCustomersMapByBarcode(customers);
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

            // レジ画面でアクティブな会員が更新されていた場合は、表示にも反映する
            if (typeof activeCustomer !== 'undefined' && activeCustomer) {
                const updated = customers.find(c => c.barcode === activeCustomer.barcode);
                if (updated) {
                    activeCustomer = updated;
                    const acNameEl = document.getElementById('ac-name');
                    const acPtsEl = document.getElementById('ac-points');
                    if (acNameEl) acNameEl.innerText = updated.name || `${updated.lastName || ''} ${updated.firstName || ''}`;
                    if (acPtsEl) acPtsEl.innerText = updated.points;
                }
            }

            // 会員管理画面を開いている場合は表示も更新する
            const customerMgmtScreen = document.getElementById('customer-mgmt-screen');
            if (customerMgmtScreen && customerMgmtScreen.classList.contains('active') && typeof renderCustomers === 'function') {
                renderCustomers();
            }
        });
    } else {
        setTimeout(waitForChannelAndSubscribeCustomerSync, 500);
    }
})();
