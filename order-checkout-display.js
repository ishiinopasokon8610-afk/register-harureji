// ==========================================
// order-checkout-display.js
// ------------------------------------------
// order-system-settings.js の「✅ オーダーシステムを利用する」がONの場合、
// 会計が成立するたびに、その会計内容を
//   home-automation-blocks.js が提供する「自動化バーコード」オーバーレイ
//   （ホーム画面を4秒長押しすると開く、#home-automation-blocks-grid）
// の中に、専用カードとして表示する。
//
// 【重要な訂正】
// 以前のバージョンでは、discount-screen（自動化バーコード「作成」画面）の
// 上部にカードを出していたが、実際に会計内容を見たい場所は
// home-automation-blocks.js のホーム長押しオーバーレイの方だった。
// そのため、フック先を home-automation-blocks.js の
//   renderHomeAutomationBlocksGrid()
//   updateHomeAutomationBlockTimers()
// に変更している。
//
// 【実装方針（他の追加機能ファイルと同じ「フック方式」）】
// ・register.js の completeTransaction() を直接編集せず、ラップして
//   呼び出し前後で pos_history の件数を比較し、新しい会計記録が
//   追加されていれば、それを「直近の注文」として保存する。
// ・home-automation-blocks.js / discount-system.js / index.html は
//   直接編集せず、renderHomeAutomationBlocksGrid() と
//   updateHomeAutomationBlockTimers() をラップしてカードを追加する
//   （「後付けブロック」＋「連鎖フック」方式）。
// ・複数端末をAblyでリアルタイム同期している場合は、既存の channel
//   （utils.js の initAbly() が作成するグローバル変数）に新しい
//   イベント名 'order-checkout-event' で publish/subscribe することで、
//   厨房端末がオーバーレイを開いたまま自動的に更新されるようにする
//   （utils.js 自体は編集しない）。
// ==========================================

const ORDER_DISPLAY_STORAGE_KEY = 'pos_last_order_display';

/* =========================================================
   ① 会計成立時の記録を保存する
   ========================================================= */
function saveLastOrderDisplay(record) {
    if (!record) return;
    try {
        localStorage.setItem(ORDER_DISPLAY_STORAGE_KEY, JSON.stringify(record));
    } catch (e) { console.error(e); }
}

function getLastOrderDisplay() {
    try {
        return JSON.parse(localStorage.getItem(ORDER_DISPLAY_STORAGE_KEY) || 'null');
    } catch (e) {
        return null;
    }
}

function broadcastOrderDisplay(record) {
    if (typeof channel !== 'undefined' && channel) {
        channel.publish('order-checkout-event', {
            record: record,
            senderId: (typeof POS_DEVICE_ID !== 'undefined') ? POS_DEVICE_ID : null
        });
    }
}

// オーバーレイが今開いていれば即座に再描画する（既存関数をそのまま利用）
function refreshHomeAutomationBlocksIfOpen() {
    if (typeof renderHomeAutomationBlocksIfVisible === 'function') {
        renderHomeAutomationBlocksIfVisible();
    }
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
                        saveLastOrderDisplay(newRecord);
                        broadcastOrderDisplay(newRecord);
                        refreshHomeAutomationBlocksIfOpen();
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
            if (data.cleared) {
                clearLastOrderDisplay();
                refreshHomeAutomationBlocksIfOpen();
                return;
            }
            if (!data.record) return;
            saveLastOrderDisplay(data.record);
            refreshHomeAutomationBlocksIfOpen();
        });
    }
    tryHook();
})();

/* =========================================================
   ④ home-automation-blocks オーバーレイに注文カードを追加する
   ========================================================= */
function injectOrderHomeBlock() {
    const grid = document.getElementById('home-automation-blocks-grid');
    if (!grid) return;

    // 前回分は一旦消し、毎回最新状態で作り直す
    const old = document.getElementById('order-checkout-home-block');
    if (old) old.remove();

    const useOrderSystem = (typeof isUseOrderSystemEnabled === 'function') ? isUseOrderSystemEnabled() : false;
    if (!useOrderSystem) return;

    const record = getLastOrderDisplay();
    if (!record) return; // まだ会計が一度も無ければ何も出さない

    // discountBarcodes 側が0件のときに出る「ホーム表示に設定された
    // 自動化バーコードがありません」というプレースホルダー文を、
    // 注文カードがある場合は消してから差し替える
    if (grid.textContent.includes('ホーム表示に設定された自動化バーコードがありません')) {
        grid.innerHTML = '';
    }

    const items = Array.isArray(record.cartSnapshot) ? record.cartSnapshot : [];
    const safe = (typeof escapeHtml === 'function') ? escapeHtml : (s) => s;
    const checkedItems = Array.isArray(record.checkedItems) ? record.checkedItems : [];
    const itemsHtml = items.length > 0
        ? items.map((i, idx) => {
            const isChecked = !!checkedItems[idx];
            return `<div class="order-checkout-home-block-item${isChecked ? ' is-checked' : ''}" onclick="toggleOrderHomeItemChecked(${idx})"
                style="display:flex; justify-content:space-between; cursor:pointer; padding:2px 4px; margin:1px 0; border-radius:4px; ${isChecked ? 'background:rgba(255,255,255,0.35); text-decoration:line-through; opacity:0.75;' : ''}">
                <span>${isChecked ? '✅ ' : ''}${safe(i.name)}</span><span>x${i.qty}</span>
            </div>`;
        }).join('')
        : `<div>${safe(record.items || '')}</div>`;
    const allChecked = items.length > 0 && items.every((_, idx) => !!checkedItems[idx]);
    const uncheckedCount = items.length - checkedItems.filter(Boolean).length;

    const card = document.createElement('div');
    card.id = 'order-checkout-home-block';
    card.className = 'order-checkout-home-block';
    card.style.cssText = 'position:relative; width:200px; min-height:110px; background:#fff3e0; border:2px solid #ff9800; border-radius:10px; padding:10px; box-shadow:0 2px 6px rgba(0,0,0,0.3); user-select:none; transition: background-color 0.4s, border-color 0.4s;';
    card.innerHTML = `
        <div class="order-checkout-home-block-timer" style="position:absolute; top:6px; right:8px; font-size:11px; color:#e65100; font-family:monospace;">00:00</div>
        <div class="order-checkout-home-block-title" style="font-weight:bold; color:#e65100; margin-top:2px;">🍽️ 直近のご注文</div>
        <div class="order-checkout-home-block-sub" style="font-size:11px; color:#8d6e63; margin:4px 0;">${safe(record.date || '')}　担当: ${safe(record.clerk || '')}</div>
        <div class="order-checkout-home-block-items" style="font-size:13px; color:#333;">${itemsHtml}</div>
        <div class="order-checkout-home-block-total" style="display:flex; justify-content:space-between; font-weight:bold; margin-top:6px; border-top:1px dashed #ffb74d; padding-top:4px; color:#e65100;">
            <span>合計</span><span>¥${(record.total || 0).toLocaleString()}</span>
        </div>
        ${items.length > 0 ? `
        <button class="order-checkout-home-block-complete-btn" onclick="completeOrderHomeBlock(event)" ${allChecked ? '' : 'disabled'}
            style="margin-top:8px; width:100%; padding:8px; border:none; border-radius:6px; font-size:12px; font-weight:bold; cursor:${allChecked ? 'pointer' : 'not-allowed'}; background:${allChecked ? '#ffffff' : 'rgba(255,255,255,0.3)'}; color:${allChecked ? '#2e7d32' : 'rgba(255,255,255,0.75)'};">
            ${allChecked ? '✅ 受け渡し完了にする' : `商品をタップしてチェック（未チェック${uncheckedCount}件）`}
        </button>` : ''}
    `;

    grid.insertBefore(card, grid.firstChild);
    attachOrderHomeBlockLongPressHandler(card);
    updateOrderHomeBlockTimer();
}

/* =========================================================
   注文カードの2秒長押しで削除する
   ------------------------------------------
   home-automation-blocks.js の attachHomeBlockLongPressHandlers() と
   同じ「2秒長押しで削除」の考え方だが、この注文カードには商品行の
   タップ（チェック切り替え）・完了ボタンのタップという別の操作があるため、
   それらの上から長押しが始まった場合は無視し、カードのそれ以外の部分
   （タイトル・日時・合計など）を長押しした場合のみ削除を発動する。
   ========================================================= */
const ORDER_HOME_BLOCK_DELETE_PRESS_MS = 2000;

function attachOrderHomeBlockLongPressHandler(card) {
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
            deleteOrderHomeBlock();
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

// 長押しで削除（チェック状況にかかわらず、カードをそのまま片付ける）
function deleteOrderHomeBlock() {
    clearLastOrderDisplay();
    broadcastOrderDisplayClear();
    if (typeof playSound === 'function') playSound('click');
    if (typeof speak === 'function') speak('ちゅうもんかーど を さくじょ し まし た');
    refreshHomeAutomationBlocksIfOpen();
}

// 商品行をタップするたびにチェック状態を切り替える（他端末にもAblyで同期する）
function toggleOrderHomeItemChecked(index) {
    const record = getLastOrderDisplay();
    if (!record) return;
    const items = Array.isArray(record.cartSnapshot) ? record.cartSnapshot : [];
    if (index < 0 || index >= items.length) return;

    if (!Array.isArray(record.checkedItems) || record.checkedItems.length !== items.length) {
        record.checkedItems = items.map(() => false);
    }
    record.checkedItems[index] = !record.checkedItems[index];

    saveLastOrderDisplay(record);
    broadcastOrderDisplay(record);

    if (typeof playSound === 'function') playSound('click');
    refreshHomeAutomationBlocksIfOpen();
}

// 全商品がチェック済みのときだけ押せる「受け渡し完了」ボタン。
// 押すと、この注文カードを消す（＝受け渡し完了として片付ける）。
function completeOrderHomeBlock(event) {
    if (event) event.stopPropagation();

    const record = getLastOrderDisplay();
    if (!record) return;
    const items = Array.isArray(record.cartSnapshot) ? record.cartSnapshot : [];
    const checkedItems = Array.isArray(record.checkedItems) ? record.checkedItems : [];
    const allChecked = items.length > 0 && items.every((_, idx) => !!checkedItems[idx]);
    if (!allChecked) return; // ボタンがdisabledでも念のため二重にガードする

    clearLastOrderDisplay();
    broadcastOrderDisplayClear();

    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak('ちゅうもん を うけわたし かんりょう に し まし た');

    refreshHomeAutomationBlocksIfOpen();
}

function clearLastOrderDisplay() {
    try { localStorage.removeItem(ORDER_DISPLAY_STORAGE_KEY); } catch (e) { console.error(e); }
}

function broadcastOrderDisplayClear() {
    if (typeof channel !== 'undefined' && channel) {
        channel.publish('order-checkout-event', {
            cleared: true,
            senderId: (typeof POS_DEVICE_ID !== 'undefined') ? POS_DEVICE_ID : null
        });
    }
}

function updateOrderHomeBlockTimer() {
    const card = document.getElementById('order-checkout-home-block');
    if (!card) return;
    const record = getLastOrderDisplay();
    if (!record) return;
    const timerEl = card.querySelector('.order-checkout-home-block-timer');
    if (!timerEl) return;
    const startAt = record.dateISO ? new Date(record.dateISO).getTime() : Date.now();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const ss = String(elapsedSec % 60).padStart(2, '0');
    timerEl.innerText = `${mm}:${ss}`;

    applyOrderHomeBlockStatusColor(card, elapsedSec);
}

// home-automation-blocks.js の applyHomeBlockStatusColor() と同じ配色ルールを、
// このカード（注文カード）にも反映する。
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
   ⑤ renderHomeAutomationBlocksGrid() / updateHomeAutomationBlockTimers()
      をラップする
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
            updateOrderHomeBlockTimer();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ⑥ チェックボックス切り替え時、オーバーレイが今開いていれば
      即座に表示/非表示を反映する
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
            refreshHomeAutomationBlocksIfOpen();
            return result;
        };
    }
    tryHook();
})();
