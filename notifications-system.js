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

// タッチパネルからの「呼び出し」「お会計希望」は、0円引きの自動化バーコードとして
// 登録される（touch-panel-order-system.js）。名前の先頭アイコンで判別し、
// 他の通常の自動化バーコードと違う分かりやすい通知にする。
const TOUCH_PANEL_CALL_ICONS = ['🔔', '🧊', '🚬', '✋', '💰'];
function isTouchPanelCallDiscountName(name) {
    return !!name && TOUCH_PANEL_CALL_ICONS.some(icon => name.startsWith(icon));
}

// 【今回追加】通知にアイコン画像を付けられるように、第3引数(iconUrl)を追加。
// 省略した場合はこれまで通り（ブラウザ標準のアイコン）で、既存の呼び出し
// 箇所はすべて無改造のまま動く。
function fireDesktopNotification(title, body, iconUrl) {
    if (!isDesktopNotificationEnabled()) return;
    try {
        const options = { body: body || '' };
        if (iconUrl) options.icon = iconUrl;
        const n = new Notification(title, options);
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
                        if (isTouchPanelCallDiscountName(d.name)) {
                            fireDesktopNotification('🍽️ タッチパネルからの呼び出しです', d.name);
                        } else {
                            fireDesktopNotification('🏷️ 新しい自動化バーコードが追加されました', d.name || d.barcode);
                        }
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

        // タイムカード（出勤/退勤の打刻）が増えた時
        // ------------------------------------------
        // sync-system.js がすでに 'timecard-sync' で他端末へ配信しているが、
        // これまでは通知の対象になっていなかったため追加する。
        // 新しい「打刻の1回」を検知したいので、record単位ではなく
        // record内の各打刻(clockIn/breakStart/breakEnd/clockOut)の値を
        // 「日付＋担当者名＋打刻種別＋時刻」のキーにして前回との差分を取る。
        const buildTimecardStampKeys = (timecards) => {
            const keys = new Set();
            (timecards || []).forEach(rec => {
                ['clockIn', 'breakStart', 'breakEnd', 'clockOut'].forEach(type => {
                    if (rec[type]) keys.add(`${rec.date}_${rec.clerkName}_${type}_${rec[type]}`);
                });
            });
            return keys;
        };
        const timecardStampLabel = { clockIn: '出勤', breakStart: '休憩開始', breakEnd: '休憩終了', clockOut: '退勤' };

        let lastKnownTimecardStamps = buildTimecardStampKeys(
            JSON.parse(localStorage.getItem('pos_timecard') || '[]')
        );
        channel.subscribe('timecard-sync', (msg) => {
            if (!msg || !msg.data || !Array.isArray(msg.data.timecards)) return;
            const isOwn = (typeof SYNC_DEVICE_ID !== 'undefined') && msg.data.senderId === SYNC_DEVICE_ID;
            const newStamps = buildTimecardStampKeys(msg.data.timecards);
            if (!isOwn) {
                msg.data.timecards.forEach(rec => {
                    ['clockIn', 'breakStart', 'breakEnd', 'clockOut'].forEach(type => {
                        if (!rec[type]) return;
                        const key = `${rec.date}_${rec.clerkName}_${type}_${rec[type]}`;
                        if (!lastKnownTimecardStamps.has(key)) {
                            fireDesktopNotification('🕒 タイムカードが記録されました', `${rec.clerkName || '担当者'}: ${timecardStampLabel[type] || type}（${rec[type]}）`);
                        }
                    });
                });
            }
            lastKnownTimecardStamps = newStamps;
        });

        // 新しい会員が登録された時
        let lastKnownCustomerBarcodes = new Set(
            (JSON.parse(localStorage.getItem('pos_customers') || '[]')).map(c => c.barcode)
        );
        channel.subscribe('customers-sync', (msg) => {
            if (!msg || !msg.data || !Array.isArray(msg.data.customers)) return;
            const isOwn = (typeof SYNC_DEVICE_ID !== 'undefined') && msg.data.senderId === SYNC_DEVICE_ID;
            if (!isOwn) {
                msg.data.customers.forEach(c => {
                    if (c && c.barcode && !lastKnownCustomerBarcodes.has(c.barcode)) {
                        const name = c.name || `${c.lastName || ''} ${c.firstName || ''}`.trim() || c.barcode;
                        fireDesktopNotification('👤 新しい会員が登録されました', name);
                    }
                });
            }
            lastKnownCustomerBarcodes = new Set(msg.data.customers.filter(c => c && c.barcode).map(c => c.barcode));
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

    // 同じ不在期間についての再通知間隔（以前は1日1回までだったが、頻度を上げてほしい
    // という要望があったため8時間おきに短縮した）
    const lastNudgeKey = 'pos_last_inactivity_nudge';
    const lastNudgeAt = parseInt(localStorage.getItem(lastNudgeKey) || '0', 10);
    if (Date.now() - lastNudgeAt < 8 * 60 * 60 * 1000) return;

    localStorage.setItem(lastNudgeKey, Date.now().toString());
    fireDesktopNotification('👋 1週間ほどお会計がありません', '再開しませんか？今すぐチェック！');
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkInactivityAndNotify, 3000);
    // 頻度を上げてほしいという要望に合わせ、チェック間隔を6時間→1時間に短縮
    // （実際に通知が届く間隔は上のlastNudgeKeyによる8時間おきの制限がベースになる）
    setInterval(checkInactivityAndNotify, 60 * 60 * 1000);
});

/* =========================================================
   保留会計（hold-sale-system.js）が長時間放置されている場合の通知
   ========================================================= */
const HELD_SALE_STALE_MINUTES = 20;      // 何分放置されたら通知するか
const HELD_SALE_RENOTIFY_MINUTES = 20;   // 同じ保留を何分おきに再通知するか
const HELD_SALE_NOTIFIED_KEY = 'pos_held_sale_notified_at';

function getHeldSaleNotifiedMap() {
    try { return JSON.parse(localStorage.getItem(HELD_SALE_NOTIFIED_KEY) || '{}'); } catch (e) { return {}; }
}

function checkHeldSalesAndNotify() {
    let heldSales = [];
    try { heldSales = JSON.parse(localStorage.getItem('pos_held_sales') || '[]'); } catch (e) { return; }
    if (heldSales.length === 0) return;

    const notifiedMap = getHeldSaleNotifiedMap();
    const now = Date.now();
    let changed = false;

    heldSales.forEach(sale => {
        if (!sale || !sale.id || !sale.heldAt) return;
        const heldAgeMin = (now - new Date(sale.heldAt).getTime()) / 60000;
        if (heldAgeMin < HELD_SALE_STALE_MINUTES) return;

        const lastNotifiedAt = notifiedMap[sale.id] || 0;
        if (now - lastNotifiedAt < HELD_SALE_RENOTIFY_MINUTES * 60000) return;

        fireDesktopNotification('⏸️ 保留中の会計があります', `${Math.floor(heldAgeMin)}分前から保留中です（担当: ${sale.clerk || '-'}）`);
        notifiedMap[sale.id] = now;
        changed = true;
    });

    // 呼び出し済み・削除済みの保留IDはマップから間引く（際限なく増えないように）
    const currentIds = new Set(heldSales.map(s => s.id));
    Object.keys(notifiedMap).forEach(id => { if (!currentIds.has(id)) { delete notifiedMap[id]; changed = true; } });

    if (changed) localStorage.setItem(HELD_SALE_NOTIFIED_KEY, JSON.stringify(notifiedMap));
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkHeldSalesAndNotify, 5000);
    setInterval(checkHeldSalesAndNotify, 5 * 60 * 1000);
});

/* =========================================================
   Google Driveへの自動バックアップが失敗した場合の通知
   ------------------------------------------
   google-drive-backup.js の backupToGoogleDriveNow() をラップし、
   例外（通信失敗・認証切れ等）が発生した場合にデスクトップ通知を出す。
   gdrive-sync-indicator.js 側の同名フックとは独立して動作する
   （他の追加機能ファイルと同じ「多重フックOK」の方式）。
   ========================================================= */
(function hookGDriveBackupForFailureNotification() {
    function tryHook() {
        if (typeof window.backupToGoogleDriveNow !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.backupToGoogleDriveNow;
        window.backupToGoogleDriveNow = async function (silent) {
            try {
                return await original.call(this, silent);
            } catch (err) {
                fireDesktopNotification('☁️ Google Drive同期に失敗しました', '通信環境をご確認のうえ、後でもう一度お試しください。');
                throw err;
            }
        };
    }
    tryHook();
})();
