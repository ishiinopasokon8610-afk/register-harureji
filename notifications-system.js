// ==========================================
// notifications-system.js - デスクトップ通知
// ------------------------------------------
// ・自動化バーコード(クーポン)／お会計履歴／商品が他の端末で新しく追加された時に、
//   このタブを見ていなくても（最小化・裏タブでも）OSのデスクトップ通知でお知らせする。
// ・1週間以上お会計が行われていない場合に「再開しませんか？今すぐチェック！」と
//   通知するリマインダー機能も持つ。
//
// ※ 重要な制約：この仕組みはあくまで「ブラウザのタブを開いたまま」の場合に
//   機能します。ブラウザを完全に終了している場合や端末の電源が切れている
//   場合には届きません（本アプリはプッシュ通知サーバーを持たないためです）。
//   常に通知を受け取りたい場合は、このアプリのタブを開いたままにしておくか、
//   最小化した状態にしておいてください。
// ==========================================

function isDesktopNotificationEnabled() {
    return localStorage.getItem('pos_notif_enabled') === 'true' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted';
}

async function enableDesktopNotifications() {
    if (typeof playSound === 'function') playSound('click');

    if (typeof Notification === 'undefined') {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("このブラウザはデスクトップ通知に対応していません。", "たいおう し て い ませ ん。", () => {}, false);
        }
        return;
    }

    try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
            localStorage.setItem('pos_notif_enabled', 'true');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    "デスクトップ通知を有効にしました！このタブを開いたまま（最小化でも可）にしておくと、他の端末での追加をお知らせします。",
                    "つうち を ゆうこう に し まし た。",
                    () => {}, false
                );
            }
        } else {
            localStorage.setItem('pos_notif_enabled', 'false');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("通知が許可されませんでした。ブラウザの設定からいつでも許可できます。", "つうち が きょか さ れ ませ ん でし た。", () => {}, false);
            }
        }
    } catch (err) {
        console.warn('通知の許可リクエストに失敗しました:', err);
    }
    updateNotifButtonState();
}

function disableDesktopNotifications() {
    if (typeof playSound === 'function') playSound('click');
    localStorage.setItem('pos_notif_enabled', 'false');
    updateNotifButtonState();
}

function updateNotifButtonState() {
    const btn = document.getElementById('notif-toggle-btn');
    if (!btn) return;
    if (isDesktopNotificationEnabled()) {
        btn.innerText = '🔔 デスクトップ通知: ON（タップでOFFにする）';
        btn.onclick = disableDesktopNotifications;
    } else {
        btn.innerText = '🔕 デスクトップ通知を有効にする';
        btn.onclick = enableDesktopNotifications;
    }
}

function fireDesktopNotification(title, body) {
    if (!isDesktopNotificationEnabled()) return;
    try {
        const n = new Notification(title, { body: body || '' });
        n.onclick = () => { window.focus(); n.close(); };
    } catch (err) {
        console.warn('通知の表示に失敗しました:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updateNotifButtonState();
});

/* =========================================================
   各種同期イベントをフックして、他端末での新規追加を検知する
   ========================================================= */
(function hookNotificationsIntoSync() {
    function tryHook() {
        if (typeof channel === 'undefined' || !channel) {
            setTimeout(tryHook, 700);
            return;
        }

        // 自動化バーコード（クーポン）が増えた時
        let lastKnownDiscountBarcodes = new Set(
            (typeof discountBarcodes !== 'undefined' ? discountBarcodes : []).map(d => d.barcode)
        );
        channel.subscribe('discount-sync', (msg) => {
            if (!msg || !msg.data || !Array.isArray(msg.data.discounts)) return;
            const isOwn = (typeof SYNC_DEVICE_ID !== 'undefined') && msg.data.senderId === SYNC_DEVICE_ID;
            if (!isOwn) {
                msg.data.discounts.forEach(d => {
                    if (!lastKnownDiscountBarcodes.has(d.barcode)) {
                        fireDesktopNotification('🏷️ 新しい自動化バーコードが追加されました', d.name || d.barcode);
                    }
                });
            }
            lastKnownDiscountBarcodes = new Set(msg.data.discounts.map(d => d.barcode));
        });

        // 商品が増えた時
        let lastKnownProductJans = new Set(
            (typeof products !== 'undefined' ? products : []).map(p => p.jan)
        );
        channel.subscribe('products-sync', (msg) => {
            if (!msg || !msg.data || !Array.isArray(msg.data.products)) return;
            const isOwn = (typeof SYNC_DEVICE_ID !== 'undefined') && msg.data.senderId === SYNC_DEVICE_ID;
            if (!isOwn) {
                msg.data.products.forEach(p => {
                    if (!lastKnownProductJans.has(p.jan)) {
                        fireDesktopNotification('📦 新しい商品が追加されました', p.name);
                    }
                });
            }
            lastKnownProductJans = new Set(msg.data.products.map(p => p.jan));
        });

        // お会計履歴が増えた時
        let lastKnownHistoryIds = new Set(
            (JSON.parse(localStorage.getItem('pos_history') || '[]')).map(h => h.id)
        );
        channel.subscribe('history-sync', (msg) => {
            if (!msg || !msg.data || !Array.isArray(msg.data.history)) return;
            const isOwn = (typeof SYNC_DEVICE_ID !== 'undefined') && msg.data.senderId === SYNC_DEVICE_ID;
            if (!isOwn) {
                msg.data.history.forEach(h => {
                    if (!lastKnownHistoryIds.has(h.id)) {
                        fireDesktopNotification('🧾 新しいお会計がありました', `¥${(h.total || 0).toLocaleString()}（担当: ${h.clerk || '-'}）`);
                    }
                });
            }
            lastKnownHistoryIds = new Set(msg.data.history.map(h => h.id));
        });
    }
    tryHook();
})();

/* =========================================================
   1週間お会計が行われていない場合の「再開しませんか？」リマインダー通知
   ========================================================= */
function checkInactivityAndNotify() {
    const historyData = JSON.parse(localStorage.getItem('pos_history') || '[]');
    let lastActivity = 0;
    historyData.forEach(item => {
        const t = item.dateISO ? new Date(item.dateISO).getTime() : (item.date ? new Date(item.date).getTime() : 0);
        if (t > lastActivity) lastActivity = t;
    });

    if (lastActivity === 0) return; // まだお会計履歴が無い場合は対象外

    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - lastActivity < sevenDays) return;

    // 同じ不在期間について、1日1回までしか通知しない
    const lastNudgeKey = 'pos_last_inactivity_nudge';
    const lastNudgeAt = parseInt(localStorage.getItem(lastNudgeKey) || '0', 10);
    if (Date.now() - lastNudgeAt < 24 * 60 * 60 * 1000) return;

    localStorage.setItem(lastNudgeKey, Date.now().toString());
    fireDesktopNotification('👋 1週間ほどお会計がありません', '再開しませんか？今すぐチェック！');
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkInactivityAndNotify, 3000);
    setInterval(checkInactivityAndNotify, 6 * 60 * 60 * 1000); // 6時間ごとに再チェック
});
