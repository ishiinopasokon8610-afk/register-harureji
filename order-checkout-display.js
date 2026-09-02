// ==========================================
// order-checkout-display.js
// ------------------------------------------
// order-system-settings.js の「✅ オーダーシステムを利用する」がONの場合、
// 会計が成立するたびに、その会計内容を2箇所に表示する。
//   ① home-automation-blocks.js のホーム長押しオーバーレイ内
//     （#home-automation-blocks-grid）
//   ② ホーム画面に常時浮かぶ小さなウィジェット（★今回追加）
//      ------------------------------------------
//      以前は①のオーバーレイ（ホームを4秒長押ししないと開かない）の
//      中にしかカードが出なかったが、それだと会計のたびに毎回長押しする
//      必要があり実用的でないため、「オーダーシステムを利用する」が
//      ONの間は、長押し・ホーム表示チェックなしで、ホーム画面を
//      開いているだけで自動的にカードが見えるようにした。
//      中身（チェック・受け渡し完了・長押し削除）は①と全く同じ機能を持つ。
//
// 【実装方針（他の追加機能ファイルと同じ「フック方式」）】
// ・register.js の completeTransaction() を直接編集せず、ラップして
//   呼び出し前後で pos_history の件数を比較し、新しい会計記録が
//   追加されていれば、それを「直近の注文」として保存する。
// ・home-automation-blocks.js / discount-system.js / index.html は
//   直接編集せず、renderHomeAutomationBlocksGrid() と
//   updateHomeAutomationBlockTimers() をラップし、加えて showScreen() も
//   フックしてホーム画面ウィジェットの表示/非表示を切り替える
//   （「後付けブロック」＋「連鎖フック」方式）。
// ・複数端末をAblyでリアルタイム同期している場合は、既存の channel
//   （utils.js の initAbly() が作成するグローバル変数）に新しい
//   イベント名 'order-checkout-event' で publish/subscribe することで、
//   厨房端末が画面を開いたまま自動的に更新されるようにする
//   （utils.js 自体は編集しない）。
// ==========================================

const ORDER_DISPLAY_STORAGE_KEY = 'pos_last_order_display'; // 【2026年9月変更】キー名はそのままだが、中身は「直近1件」ではなく「未完了の会計を全件」保持する配列にする

function generateOrderId() {
    return `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* =========================================================
   ★不具合修正：「オーダーシステムを利用する」をONにしていても
   自動化バーコード（＋通常商品）を含む会計内容が①のオーバーレイ
   （home-automation-blocks-grid）に反映されないことがあった件について
   ------------------------------------------
   【原因】
   home-automation-blocks.js の #home-automation-blocks-grid は、
   ホーム画面を4秒長押しして openHomeAutomationBlocks() が一度でも
   呼ばれるまでDOM上に存在しない（ensureHomeBlockOverlay()が
   その中でしか呼ばれていなかったため）。
   injectOrderHomeBlock() は grid が無い場合は何もせず return するだけ
   だったので、店員が一度も長押ししていない状態で会計が成立すると、
   注文データ自体はlocalStorage/Ablyには正しく保存・送信されているのに、
   カードを差し込む先が存在せず、画面には一切表示されないままだった。
   【対応】
   ページ読み込み時に、home-automation-blocks.js の
   ensureHomeBlockOverlay() を先回りして呼び、グリッド要素を
   あらかじめ用意しておく（オーバーレイ自体は非表示のまま）。
   これにより、長押しで一度も開いていない状態でも
   injectOrderHomeBlock() が確実にカードを描画できるようにする。
   さらに、新しい注文が来た瞬間に「出前館」のような着信音を鳴らし、
   オーバーレイを自動的に開いて店員に気づかせるようにする
   （下の ⑫ playNewOrderChime() / autoOpenForNewOrder() を参照）。
   ========================================================= */
(function ensureOrderGridExistsEarly() {
    function tryEnsure() {
        if (typeof window.ensureHomeBlockOverlay !== 'function') {
            setTimeout(tryEnsure, 300);
            return;
        }
        window.ensureHomeBlockOverlay();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryEnsure);
    } else {
        tryEnsure();
    }
})();

/* =========================================================
   ① 会計成立時の記録を「キュー（配列）」として保存する
   ------------------------------------------
   【2026年9月変更】以前は「直近1件」を丸ごと上書きしていたため、
   会計が続けて成立すると前の注文が消えてしまっていた。
   今回から、受け渡し完了（または長押し削除）されるまでは
   すべての会計をキューに残し、まとめて表示できるようにする。
   以前のバージョンでlocalStorageに残っている「単一オブジェクト形式」の
   データが読み込まれた場合も壊れないよう、自動的に配列形式へ
   変換してから使う（後方互換のマイグレーション）。
   ========================================================= */
function getOrderQueue() {
    let raw;
    try {
        raw = JSON.parse(localStorage.getItem(ORDER_DISPLAY_STORAGE_KEY) || 'null');
    } catch (e) {
        raw = null;
    }
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    // 旧形式（単一オブジェクト）→ 配列形式へ変換して保存し直す
    if (!raw.orderId) raw.orderId = generateOrderId();
    const migrated = [raw];
    saveOrderQueue(migrated);
    return migrated;
}

function saveOrderQueue(queue) {
    try {
        localStorage.setItem(ORDER_DISPLAY_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) { console.error(e); }
}

// 新しい会計記録をキューの先頭（＝最新）に追加する
function addOrderToQueue(record) {
    if (!record) return null;
    if (!record.orderId) record.orderId = generateOrderId();
    const queue = getOrderQueue();
    queue.unshift(record);
    saveOrderQueue(queue);
    return record;
}

// キュー内の1件を上書き（チェック状態の更新等）。無ければ先頭に追加する
function upsertOrderInQueue(record) {
    if (!record || !record.orderId) return;
    const queue = getOrderQueue();
    const idx = queue.findIndex(r => r.orderId === record.orderId);
    if (idx >= 0) {
        queue[idx] = record;
    } else {
        queue.unshift(record);
    }
    saveOrderQueue(queue);
}

// 指定した注文だけをキューから取り除く（受け渡し完了・長押し削除の両方で使用）
function removeOrderFromQueue(orderId) {
    const queue = getOrderQueue().filter(r => r.orderId !== orderId);
    saveOrderQueue(queue);
}

function getOrderById(orderId) {
    return getOrderQueue().find(r => r.orderId === orderId) || null;
}

// 互換のため残す（他ファイルや古いコードから呼ばれた場合に備える）。
// 「直近1件」ではなく、キューの先頭（＝一番新しい未完了の注文）を返す。
function getLastOrderDisplay() {
    const queue = getOrderQueue();
    return queue.length > 0 ? queue[0] : null;
}

// 全件クリア（トラブル対応・動作確認用。通常操作では使わない）
function clearAllOrderDisplays() {
    try { localStorage.removeItem(ORDER_DISPLAY_STORAGE_KEY); } catch (e) { console.error(e); }
}

function broadcastOrderEvent(payload) {
    if (typeof channel !== 'undefined' && channel) {
        channel.publish('order-checkout-event', Object.assign({
            senderId: (typeof POS_DEVICE_ID !== 'undefined') ? POS_DEVICE_ID : null
        }, payload));
    }
}

// ①オーバーレイと②ホームウィジェットの両方を、今の状態にあわせて再描画する
// （どちらか片方しか存在しない場合は、存在する方だけ更新される）
function renderAllOrderCards() {
    injectOrderHomeBlock();
    renderOrderHomeWidget();
}

/* =========================================================
   ⑫ 新しい注文が届いた時の「出前館」風お知らせ音＋自動オープン
   ------------------------------------------
   ・utils.js の playSound() とは別に、複数の高さの音を短く連続で
     鳴らす「ピンポン♪」のような着信チャイムを鳴らす
     （出前館・Uber Eats等の「新規注文」通知音に近いイメージ）。
   ・鳴らすと同時に、ホーム長押しオーバーレイ（①）を自動的に開き、
     4秒長押ししなくても新しい注文にすぐ気づけるようにする。
     すでに開いている場合は開き直さず、中身の更新のみ行う。
   ========================================================= */
function playNewOrderChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        // ピンポンパンポン、のような4音の軽快なチャイム
        const notes = [
            { freq: 880, start: 0.00, dur: 0.16 },
            { freq: 660, start: 0.18, dur: 0.16 },
            { freq: 880, start: 0.42, dur: 0.16 },
            { freq: 1046, start: 0.60, dur: 0.22 }
        ];
        notes.forEach(n => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.start);
            gain.gain.setValueAtTime(0.0001, ctx.currentTime + n.start);
            gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + n.start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.start + n.dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + n.start);
            osc.stop(ctx.currentTime + n.start + n.dur + 0.05);
        });
    } catch (e) {
        console.warn('新規注文チャイムの再生に失敗しました:', e);
    }
}

// 新しい注文が来たことを知らせる（音声「ご注文が入りました」＋チャイム）。
// 【変更】以前はここでオーバーレイを自動的に開いていたが、
// 「オーバーレイが勝手に開くのはやめてほしい」との要望のため廃止。
// 音とアナウンスだけで知らせ、カードの中身はオーバーレイ・グリッドが
// 存在していれば静かに更新しておく（開くのはあくまで4秒長押し操作のみ）。
function notifyAndShowNewOrder() {
    if (typeof isUseOrderSystemEnabled !== 'function' || !isUseOrderSystemEnabled()) return;

    playNewOrderChime();
    if (typeof speak === 'function') speak('ごちゅうもん が はいり まし た');

    renderAllOrderCards();
}

/* =========================================================
   ② completeTransaction() をラップし、会計成立を検知する
   ------------------------------------------
   completeTransaction() は「お預かり不足」等の場合は途中で return し、
   pos_history には何も追加されない。そのため、呼び出し前後で
   pos_history の件数を比較し、実際に増えていた場合だけ
   「会計が成立した」とみなして直近の記録として扱う。
   ========================================================= */
(function hookCompleteTransactionForOrderDisplay() {
    function tryHook() {
        if (typeof window.completeTransaction !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.completeTransaction;
        window.completeTransaction = async function (...args) {
            let beforeLen = 0;
            try {
                beforeLen = (JSON.parse(localStorage.getItem('pos_history')) || []).length;
            } catch (e) {}

            const result = await original.apply(this, args);

            if (typeof isUseOrderSystemEnabled === 'function' && isUseOrderSystemEnabled()) {
                try {
                    const historyList = JSON.parse(localStorage.getItem('pos_history')) || [];
                    if (historyList.length > beforeLen) {
                        const newRecord = historyList[0]; // 直近の会計は先頭にunshiftされる
                        addOrderToQueue(newRecord); // 既存の未完了注文は消さず、キューに追加する
                        broadcastOrderEvent({ action: 'upsert', record: newRecord });
                        notifyAndShowNewOrder();
                    }
                } catch (e) { console.error(e); }
            }

            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ③ 他端末からのリアルタイム更新（Ably）
   ========================================================= */
(function hookAblyForOrderDisplay() {
    function tryHook() {
        if (typeof channel === 'undefined' || !channel) {
            setTimeout(tryHook, 500);
            return;
        }
        channel.subscribe('order-checkout-event', (message) => {
            const data = message.data || {};

            if (data.action === 'remove' && data.orderId) {
                removeOrderFromQueue(data.orderId);
                renderAllOrderCards();
                return;
            }
            if (data.action === 'upsert' && data.record) {
                upsertOrderInQueue(data.record);
                notifyAndShowNewOrder();
                return;
            }

            // 旧バージョンの端末からの互換用（cleared / record のみを送ってくる形式）
            if (data.cleared) {
                clearAllOrderDisplays();
                renderAllOrderCards();
                return;
            }
            if (data.record) {
                upsertOrderInQueue(data.record);
                notifyAndShowNewOrder();
            }
        });
    }
    tryHook();
})();

/* =========================================================
   ④ 注文カードの中身（HTML）を組み立てる共通処理
   ------------------------------------------
   ①オーバーレイ内のカードと②ホームウィジェットのカードは、
   見た目・機能（チェック／受け渡し完了／長押し削除）が全く同じなので、
   中身の組み立てをここに共通化する。
   ========================================================= */
function buildOrderCardInnerHTML(record) {
    const orderId = record.orderId;
    const items = Array.isArray(record.cartSnapshot) ? record.cartSnapshot : [];
    const safe = (typeof escapeHtml === 'function') ? escapeHtml : (s) => s;
    const checkedItems = Array.isArray(record.checkedItems) ? record.checkedItems : [];
    const itemsHtml = items.length > 0
        ? items.map((i, idx) => {
            const isChecked = !!checkedItems[idx];
            return `<div class="order-checkout-home-block-item${isChecked ? ' is-checked' : ''}" onclick="toggleOrderHomeItemChecked('${orderId}', ${idx})"
                style="display:flex; justify-content:space-between; cursor:pointer; padding:2px 4px; margin:1px 0; border-radius:4px; ${isChecked ? 'background:rgba(255,255,255,0.35); text-decoration:line-through; opacity:0.75;' : ''}">
                <span>${isChecked ? '✅ ' : ''}${safe(i.name)}</span><span>x${i.qty}</span>
            </div>`;
        }).join('')
        : `<div>${safe(record.items || '')}</div>`;
    const allChecked = items.length > 0 && items.every((_, idx) => !!checkedItems[idx]);
    const uncheckedCount = items.length - checkedItems.filter(Boolean).length;

    return `
        <div class="order-checkout-home-block-timer" style="position:absolute; top:6px; right:8px; font-size:11px; color:#e65100; font-family:monospace;">00:00</div>
        <div class="order-checkout-home-block-title" style="font-weight:bold; color:#e65100; margin-top:2px;">🍽️ ご注文</div>
        <div class="order-checkout-home-block-sub" style="font-size:11px; color:#8d6e63; margin:4px 0;">${safe(record.date || '')}　担当: ${safe(record.clerk || '')}</div>
        ${record.receiptNo ? `<div class="order-checkout-home-block-receipt-no" style="font-size:11px; color:#8d6e63; font-family:monospace; margin-bottom:4px;">伝票番号: ${safe(record.receiptNo)}</div>` : ''}
        ${record.callNumber ? `<div class="order-checkout-home-block-call-no" style="font-size:13px; font-weight:bold; color:#c62828; background:rgba(255,255,255,0.5); border-radius:6px; padding:2px 6px; display:inline-block; margin-bottom:6px;">🔔 呼び出し番号 ${String(record.callNumber).padStart(3, '0')}</div>` : ''}
        <div class="order-checkout-home-block-items" style="font-size:13px; color:#333;">${itemsHtml}</div>
        <div class="order-checkout-home-block-total" style="display:flex; justify-content:space-between; font-weight:bold; margin-top:6px; border-top:1px dashed #ffb74d; padding-top:4px; color:#e65100;">
            <span>合計</span><span>¥${(record.total || 0).toLocaleString()}</span>
        </div>
        ${items.length > 0 ? `
        <button class="order-checkout-home-block-complete-btn" onclick="completeOrderHomeBlock(event, '${orderId}')" ${allChecked ? '' : 'disabled'}
            style="margin-top:8px; width:100%; padding:8px; border:none; border-radius:6px; font-size:12px; font-weight:bold; cursor:${allChecked ? 'pointer' : 'not-allowed'}; background:${allChecked ? '#ffffff' : 'rgba(255,255,255,0.3)'}; color:${allChecked ? '#2e7d32' : 'rgba(255,255,255,0.75)'};">
            ${allChecked ? '✅ 受け渡し完了にする' : `商品をタップしてチェック（未チェック${uncheckedCount}件）`}
        </button>` : ''}
    `;
}

/* =========================================================
   ⑤ home-automation-blocks オーバーレイに注文カードを追加する
   ========================================================= */
function injectOrderHomeBlock() {
    const grid = document.getElementById('home-automation-blocks-grid');
    if (!grid) return; // オーバーレイが一度も開かれていなければ何もしない

    // 前回分のカードは一旦すべて消し、毎回最新状態で作り直す
    grid.querySelectorAll('.order-checkout-home-block').forEach(el => el.remove());

    const useOrderSystem = (typeof isUseOrderSystemEnabled === 'function') ? isUseOrderSystemEnabled() : false;
    if (!useOrderSystem) return;

    // 【2026年9月変更】「直近1件」ではなく、受け渡し・確認が完了していない
    // 会計をすべてキューから取り出して並べる。
    const queue = getOrderQueue();
    if (queue.length === 0) return; // 未完了の会計が無ければ何も出さない

    // discountBarcodes 側が0件のときに出る「ホーム表示に設定された
    // 自動化バーコードがありません」というプレースホルダー文を、
    // 注文カードがある場合は消してから差し替える
    if (grid.textContent.includes('ホーム表示に設定された自動化バーコードがありません')) {
        grid.innerHTML = '';
    }

    // キューは先頭が最新（unshiftで追加）。逆順に処理してから毎回先頭へ差し込むことで、
    // 見た目上も「一番新しい注文が一番手前（先頭）」に並ぶようにする。
    [...queue].reverse().forEach(record => {
        const card = document.createElement('div');
        card.className = 'order-checkout-home-block order-checkout-card';
        card.dataset.orderId = record.orderId;
        card.style.cssText = 'position:relative; width:200px; min-height:110px; background:#fff3e0; border:2px solid #ff9800; border-radius:10px; padding:10px; box-shadow:0 2px 6px rgba(0,0,0,0.3); user-select:none; transition: background-color 0.4s, border-color 0.4s;';
        card.innerHTML = buildOrderCardInnerHTML(record);

        grid.insertBefore(card, grid.firstChild);
        attachOrderHomeBlockLongPressHandler(card, record.orderId);
    });

    updateAllOrderCardTimers();
}

/* =========================================================
   ⑥ ホーム画面：長押し不要で常時表示するウィジェット
   ------------------------------------------
   #home-screen の中身とは独立させ、document.body直下に
   position:fixedで置く（ホーム画面のボタン配置に一切手を加えないため）。
   ホーム画面が表示されている間だけ見えるようにする。
   ========================================================= */
function ensureOrderHomeWidgetContainer() {
    let wrap = document.getElementById('order-checkout-home-widget-wrap');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = 'order-checkout-home-widget-wrap';
    wrap.style.cssText = 'display:none; position:fixed; right:16px; bottom:16px; z-index:9500; width:200px;';
    document.body.appendChild(wrap);
    return wrap;
}

function isHomeScreenActive() {
    const homeScreen = document.getElementById('home-screen');
    return !!(homeScreen && homeScreen.classList.contains('active'));
}

function renderOrderHomeWidget() {
    const wrap = ensureOrderHomeWidgetContainer();

    // ★2026年9月変更：ホーム画面右下の常時ウィジェット表示は不要という要望のため、
    // ここで常にfalseにして無効化する（①長押しオーバーレイ内のカード表示は残す）。
    // 元に戻したい場合は、このshouldShow行を削除して下のコメントアウトを戻してください。
    const shouldShow = false;
    // const useOrderSystem = (typeof isUseOrderSystemEnabled === 'function') ? isUseOrderSystemEnabled() : false;
    // const record = getLastOrderDisplay(); // ※復活させる場合は「未完了1件だけ」の表示になる点に注意
    // const shouldShow = useOrderSystem && !!record && isHomeScreenActive();

    if (!shouldShow) {
        wrap.style.display = 'none';
        return;
    }

    let card = document.getElementById('order-checkout-home-widget-block');
    if (!card) {
        card = document.createElement('div');
        card.id = 'order-checkout-home-widget-block';
        wrap.appendChild(card);
    }
    card.className = 'order-checkout-home-block order-checkout-card';
    card.dataset.orderId = record.orderId;
    card.style.cssText = 'position:relative; width:200px; min-height:110px; background:#fff3e0; border:2px solid #ff9800; border-radius:10px; padding:10px; box-shadow:0 6px 20px rgba(0,0,0,0.35); user-select:none; transition: background-color 0.4s, border-color 0.4s;';
    card.innerHTML = buildOrderCardInnerHTML(record);

    wrap.style.display = 'block';
    attachOrderHomeBlockLongPressHandler(card, record.orderId);
    updateAllOrderCardTimers();
}

/* =========================================================
   ⑦ 注文カードの2秒長押しで削除する
   ------------------------------------------
   home-automation-blocks.js の attachHomeBlockLongPressHandlers() と
   同じ「2秒長押しで削除」の考え方だが、この注文カードには商品行の
   タップ（チェック切り替え）・完了ボタンのタップという別の操作があるため、
   それらの上から長押しが始まった場合は無視し、カードのそれ以外の部分
   （タイトル・日時・合計など）を長押しした場合のみ削除を発動する。
   ①オーバーレイのカード・②ホームウィジェットのカードのどちらにも使う。
   ========================================================= */
const ORDER_HOME_BLOCK_DELETE_PRESS_MS = 2000;

function attachOrderHomeBlockLongPressHandler(card, orderId) {
    if (!card || card.dataset.longPressBound) return;
    card.dataset.longPressBound = '1';
    let pressTimer = null;

    const track = document.createElement('div');
    track.style.cssText = 'position:absolute; left:0; bottom:0; width:100%; height:4px; background:rgba(0,0,0,0.15); border-radius:0 0 10px 10px; overflow:hidden;';
    const progressBar = document.createElement('div');
    progressBar.style.cssText = 'height:100%; width:0%; background:rgba(255,255,255,0.9);';
    track.appendChild(progressBar);
    card.appendChild(track);

    function isInteractiveTarget(target) {
        return !!(target.closest('.order-checkout-home-block-item') || target.closest('.order-checkout-home-block-complete-btn'));
    }

    const start = (e) => {
        if (isInteractiveTarget(e.target)) return;
        progressBar.style.transition = 'none';
        progressBar.style.width = '0%';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                progressBar.style.transition = `width ${ORDER_HOME_BLOCK_DELETE_PRESS_MS}ms linear`;
                progressBar.style.width = '100%';
            });
        });
        pressTimer = setTimeout(() => {
            deleteOrderHomeBlock(orderId);
        }, ORDER_HOME_BLOCK_DELETE_PRESS_MS);
    };
    const cancel = () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        progressBar.style.transition = 'none';
        progressBar.style.width = '0%';
    };

    card.addEventListener('mousedown', start);
    card.addEventListener('touchstart', start, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(evt => card.addEventListener(evt, cancel));
}

// 長押しで削除（チェック状況にかかわらず、その1件だけをそのまま片付ける。
// 他に表示されている未完了の注文はそのまま残る）
function deleteOrderHomeBlock(orderId) {
    if (!orderId) return;
    removeOrderFromQueue(orderId);
    broadcastOrderEvent({ action: 'remove', orderId });
    if (typeof playSound === 'function') playSound('click');
    if (typeof speak === 'function') speak('ちゅうもんかーど を さくじょ し まし た');
    renderAllOrderCards();
}

// 商品行をタップするたびにチェック状態を切り替える（他端末にもAblyで同期する）
function toggleOrderHomeItemChecked(orderId, index) {
    const record = getOrderById(orderId);
    if (!record) return;
    const items = Array.isArray(record.cartSnapshot) ? record.cartSnapshot : [];
    if (index < 0 || index >= items.length) return;

    if (!Array.isArray(record.checkedItems) || record.checkedItems.length !== items.length) {
        record.checkedItems = items.map(() => false);
    }
    record.checkedItems[index] = !record.checkedItems[index];

    upsertOrderInQueue(record);
    broadcastOrderEvent({ action: 'upsert', record });

    if (typeof playSound === 'function') playSound('click');
    renderAllOrderCards();
}

// 全商品がチェック済みのときだけ押せる「受け渡し完了」ボタン。
// 押すと、その注文カード（1件）だけを消す（＝受け渡し完了として片付ける）。
// 他に表示されている未完了の注文はそのまま残る。
function completeOrderHomeBlock(event, orderId) {
    if (event) event.stopPropagation();
    if (!orderId) return;

    const record = getOrderById(orderId);
    if (!record) return;
    const items = Array.isArray(record.cartSnapshot) ? record.cartSnapshot : [];
    const checkedItems = Array.isArray(record.checkedItems) ? record.checkedItems : [];
    const allChecked = items.length > 0 && items.every((_, idx) => !!checkedItems[idx]);
    if (!allChecked) return; // ボタンがdisabledでも念のため二重にガードする

    removeOrderFromQueue(orderId);
    broadcastOrderEvent({ action: 'remove', orderId });

    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak('ちゅうもん を うけわたし かんりょう に し まし た');

    renderAllOrderCards();
}

/* =========================================================
   ⑧ 経過時間タイマー・配色更新
   ------------------------------------------
   ①オーバーレイのカード・②ホームウィジェットのカードは
   どちらも共通クラス .order-checkout-card を持つため、
   querySelectorAllでまとめて更新する。
   ========================================================= */
function updateAllOrderCardTimers() {
    // 【2026年9月変更】カードが複数同時に並ぶため、「直近1件」の経過時間を
    // 全カードに使い回すのではなく、カードごとに data-order-id から
    // 対応する注文を引いて、それぞれ自分の経過時間を計算する。
    document.querySelectorAll('.order-checkout-card[data-order-id]').forEach(card => {
        const record = getOrderById(card.dataset.orderId);
        if (!record) return;

        const timerEl = card.querySelector('.order-checkout-home-block-timer');
        if (!timerEl) return;
        const startAt = record.dateISO ? new Date(record.dateISO).getTime() : Date.now();
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
        const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
        const ss = String(elapsedSec % 60).padStart(2, '0');
        timerEl.innerText = `${mm}:${ss}`;

        applyOrderHomeBlockStatusColor(card, elapsedSec);
    });
}

// 互換のため残す（updateHomeAutomationBlockTimers()からのフック用）
function updateOrderHomeBlockTimer() {
    updateAllOrderCardTimers();
}

// home-automation-blocks.js の applyHomeBlockStatusColor() と同じ配色ルールを、
// この注文カードにも反映する。
// 3分（180秒）未満=緑／3〜5分（180〜300秒）=黄／5分（300秒）以上=赤
function applyOrderHomeBlockStatusColor(card, elapsedSec) {
    let bg, titleColor, subColor, timerColor, itemsColor;
    if (elapsedSec < 180) {
        bg = '#2e7d32'; titleColor = '#ffffff'; subColor = '#e8f5e9'; timerColor = '#e8f5e9'; itemsColor = '#ffffff';
    } else if (elapsedSec < 300) {
        bg = '#f9a825'; titleColor = '#3e2723'; subColor = '#4e342e'; timerColor = '#4e342e'; itemsColor = '#3e2723';
    } else {
        bg = '#c62828'; titleColor = '#ffffff'; subColor = '#ffebee'; timerColor = '#ffebee'; itemsColor = '#ffffff';
    }
    card.style.background = bg;
    card.style.borderColor = bg;

    const titleEl = card.querySelector('.order-checkout-home-block-title');
    const subEl = card.querySelector('.order-checkout-home-block-sub');
    const timerEl = card.querySelector('.order-checkout-home-block-timer');
    const itemsEl = card.querySelector('.order-checkout-home-block-items');
    const totalEl = card.querySelector('.order-checkout-home-block-total');
    if (titleEl) titleEl.style.color = titleColor;
    if (subEl) subEl.style.color = subColor;
    if (timerEl) timerEl.style.color = timerColor;
    if (itemsEl) itemsEl.style.color = itemsColor;
    if (totalEl) totalEl.style.color = titleColor;
}

/* =========================================================
   ⑨ renderHomeAutomationBlocksGrid() / updateHomeAutomationBlockTimers()
      をラップする（①オーバーレイ用）
   ========================================================= */
(function hookRenderGridForOrder() {
    function tryHook() {
        if (typeof window.renderHomeAutomationBlocksGrid !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderHomeAutomationBlocksGrid;
        window.renderHomeAutomationBlocksGrid = function (...args) {
            const result = original.apply(this, args);
            injectOrderHomeBlock();
            return result;
        };
    }
    tryHook();
})();

(function hookUpdateTimersForOrder() {
    function tryHook() {
        if (typeof window.updateHomeAutomationBlockTimers !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.updateHomeAutomationBlockTimers;
        window.updateHomeAutomationBlockTimers = function (...args) {
            const result = original.apply(this, args);
            updateAllOrderCardTimers();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ⑩ ホーム画面ウィジェット（②）の表示切り替え
   ------------------------------------------
   ・showScreen() をフックし、画面が切り替わるたびに
     （ホーム画面に来た/離れた）即座に表示・非表示を反映する。
   ・加えて、ホーム画面に留まっている間もタイマー表示を進める必要が
     あるため、home-automation-blocks.js のオーバーレイとは無関係に、
     このファイル自身で1秒ごとの独立したインターバルを持つ。
   ========================================================= */
(function hookShowScreenForOrderWidget() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            renderOrderHomeWidget();
            return result;
        };
    }
    tryHook();
})();

setInterval(() => {
    renderOrderHomeWidget();
    updateAllOrderCardTimers();
}, 1000);

document.addEventListener('DOMContentLoaded', () => {
    renderOrderHomeWidget();
});

/* =========================================================
   ⑪ チェックボックス切り替え時、オーバーレイ／ウィジェットの
      表示・非表示を即座に反映する
   ========================================================= */
(function hookToggleForOrderDisplay() {
    function tryHook() {
        if (typeof window.toggleUseOrderSystem !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.toggleUseOrderSystem;
        window.toggleUseOrderSystem = function (...args) {
            const result = original.apply(this, args);
            renderAllOrderCards();
            return result;
        };
    }
    tryHook();
})();
