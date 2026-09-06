// ==========================================
// hold-sale-system.js
// ------------------------------------------
// 【背景】
// 商品をスキャン中に「財布を忘れた」「追加で商品を取ってきます」等で
// お客様が一時的に列を離れるケースがある。従来は会計を確定するか
// 全取消するかしかなく、列の後ろの人を待たせる原因になっていた。
//
// 【この機能】
// レジ画面に「⏸️ 会計保留」ボタンを追加し、押すと今のカート内容
// （商品・会員情報・預かり金・支払い方法・免税適用状態など）を
// 一旦「保留」として退避し、レジ画面をまっさらな状態に戻して
// 次のお客様の会計に進めるようにする。保留した内容は「📋 保留一覧」
// ボタンからいつでも呼び出して再開できる。
//
// register.js / ui.js / index.html は直接編集せず、既存のグローバル変数
// （cart / activeCustomer / currentDeposit 等）を直接読み書きし、
// DOM注入・フック方式で実現する（他の追加機能ファイルと同じ方針）。
// ==========================================

const HELD_SALES_KEY = 'pos_held_sales';

function getHeldSales() {
    try {
        return JSON.parse(localStorage.getItem(HELD_SALES_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveHeldSales(list) {
    localStorage.setItem(HELD_SALES_KEY, JSON.stringify(list));
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    updateHeldSalesBadge();
}

function getActiveClerkNameForHoldSafe() {
    try {
        if (typeof getCurrentSession === 'function') {
            const s = getCurrentSession();
            if (s && s.user && s.user.name) return s.user.name;
        }
    } catch (e) {}
    return (typeof window.activeClerkName === 'string') ? window.activeClerkName : '';
}

/* =========================================================
   ① 保留する
   ========================================================= */
function holdCurrentTransaction() {
    if (typeof cart === 'undefined' || cart.length === 0) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('カートが空です。保留する内容がありません。', 'かーと が から です。', () => {}, false);
        }
        return;
    }

    const snapshot = {
        id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        heldAt: new Date().toISOString(),
        clerk: getActiveClerkNameForHoldSafe(),
        cart: JSON.parse(JSON.stringify(cart)),
        activeCustomer: (typeof activeCustomer !== 'undefined' && activeCustomer) ? JSON.parse(JSON.stringify(activeCustomer)) : null,
        customerDisplayMemberInfo: (typeof customerDisplayMemberInfo !== 'undefined') ? customerDisplayMemberInfo : null,
        currentDeposit: (typeof currentDeposit !== 'undefined') ? currentDeposit : 0,
        usedPoints: (typeof usedPoints !== 'undefined') ? usedPoints : 0,
        selectedPayment: (typeof selectedPayment !== 'undefined') ? selectedPayment : '現金',
        taxExemptTransaction: (typeof taxExemptTransaction !== 'undefined') ? taxExemptTransaction : false
    };

    const list = getHeldSales();
    list.push(snapshot);
    saveHeldSales(list);

    // レジ画面を空の状態に戻す（clearCart()の確認ダイアログ無し版）
    if (typeof recordCartState === 'function') recordCartState();
    cart.length = 0;
    if (typeof currentDeposit !== 'undefined') currentDeposit = 0;
    if (typeof currentChange !== 'undefined') currentChange = 0;
    if (typeof usedPoints !== 'undefined') usedPoints = 0;
    if (typeof billingAmount !== 'undefined') billingAmount = 0;
    if (typeof lastScannedBarcode !== 'undefined') lastScannedBarcode = '';
    if (typeof selectedPayment !== 'undefined') selectedPayment = '現金';
    if (typeof taxExemptTransaction !== 'undefined') taxExemptTransaction = false;
    if (typeof clearCustomer === 'function') clearCustomer(false);
    if (typeof updateReceipt === 'function') updateReceipt();

    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak('かいけい を ほりゅう し まし た');
    focusJanInputSafe();
}

function focusJanInputSafe() {
    if (typeof getJanInput === 'function') {
        const input = getJanInput();
        if (input) input.focus();
    }
}

/* =========================================================
   ② 保留一覧モーダル
   ========================================================= */
function ensureHeldSalesModal() {
    let modal = document.getElementById('held-sales-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'held-sales-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '7000';
    modal.innerHTML = `
        <div class="modal-box large" style="width:min(480px, 92vw); text-align:left;">
            <h3 class="modal-title" style="color:#00695c;">📋 保留中の会計</h3>
            <div id="held-sales-list-body" style="max-height:60vh; overflow-y:auto;"></div>
            <div class="modal-btn-group">
                <button onclick="closeHeldSalesModal()" class="modal-btn cancel">閉じる</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeHeldSalesModal(); });
    return modal;
}

function closeHeldSalesModal() {
    const modal = document.getElementById('held-sales-modal');
    if (modal) modal.style.display = 'none';
}

function calcHeldSaleTotal(sale) {
    return (sale.cart || []).reduce((sum, item) => sum + (item.price * (item.qty || 1)), 0);
}

function formatHeldSaleTime(iso) {
    try {
        const d = new Date(iso);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (e) {
        return '';
    }
}

function openHeldSalesList() {
    if (typeof playSound === 'function') playSound('click');
    const modal = ensureHeldSalesModal();
    const body = modal.querySelector('#held-sales-list-body');
    const list = getHeldSales();

    if (list.length === 0) {
        body.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">保留中の会計はありません。</p>';
    } else {
        body.innerHTML = '';
        // 新しい順ではなく、待っている順（古い順）に並べる
        list.forEach(sale => {
            const itemCount = (sale.cart || []).reduce((n, i) => n + (i.qty || 1), 0);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px; border:1px solid #ddd; border-radius:8px; padding:10px 12px; margin-bottom:8px;';
            row.innerHTML = `
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:15px;">⏱️ ${formatHeldSaleTime(sale.heldAt)}〜保留 ・ ${itemCount}点</div>
                    <div style="font-size:13px; color:#666;">
                        合計 目安 ¥${calcHeldSaleTotal(sale).toLocaleString()}
                        ${sale.activeCustomer ? ` ・ 👤 ${sale.activeCustomer.name || ''} 様` : ''}
                        ${sale.clerk ? ` ・ 担当: ${sale.clerk}` : ''}
                    </div>
                </div>
                <button class="modal-btn primary" style="white-space:nowrap;" onclick="resumeHeldSale('${sale.id}')">呼び出す</button>
                <button class="modal-btn cancel" style="white-space:nowrap;" onclick="deleteHeldSale('${sale.id}')">削除</button>
            `;
            body.appendChild(row);
        });
    }

    modal.style.display = 'flex';
}

function deleteHeldSale(id) {
    if (typeof showCustomConfirm !== 'function') return;
    showCustomConfirm('この保留を削除しますか？（元に戻せません）', 'この ほりゅう を さくじょ し ます か？', (ok) => {
        if (!ok) return;
        const list = getHeldSales().filter(s => s.id !== id);
        saveHeldSales(list);
        openHeldSalesList();
    }, true);
}

function resumeHeldSaleInner(id) {
    const list = getHeldSales();
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return;
    const sale = list[idx];

    cart.length = 0;
    sale.cart.forEach(item => cart.push(item));
    if (typeof activeCustomer !== 'undefined') activeCustomer = sale.activeCustomer || null;
    if (typeof customerDisplayMemberInfo !== 'undefined') customerDisplayMemberInfo = sale.customerDisplayMemberInfo || null;
    if (typeof currentDeposit !== 'undefined') currentDeposit = sale.currentDeposit || 0;
    if (typeof usedPoints !== 'undefined') usedPoints = sale.usedPoints || 0;
    if (typeof selectedPayment !== 'undefined') selectedPayment = sale.selectedPayment || '現金';
    if (typeof taxExemptTransaction !== 'undefined') taxExemptTransaction = sale.taxExemptTransaction || false;

    list.splice(idx, 1);
    saveHeldSales(list);

    if (typeof updateReceipt === 'function') updateReceipt();
    // 会員表示欄の更新（active-customer-display）は既存のselectClerk/scanCustomer相当の
    // 表示更新関数が無いため、簡易的に会員名があれば表示欄を復元する
    if (sale.activeCustomer && typeof updateActiveCustomerDisplaySafe === 'function') {
        updateActiveCustomerDisplaySafe(sale.activeCustomer);
    }

    closeHeldSalesModal();
    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak('ほりゅう し て い た かいけい を さいかい し ます');
    focusJanInputSafe();
}

// 保留を呼び出す前に、今のカートに何か入っていれば先にそれを保留するか確認する
function resumeHeldSale(id) {
    if (typeof cart !== 'undefined' && cart.length > 0) {
        showCustomConfirm(
            '今スキャン中の内容があります。今の内容を先に保留してから呼び出しますか？',
            'いま の ないよう を さき に ほりゅう し ます か？',
            (ok) => {
                if (ok) {
                    holdCurrentTransaction();
                    resumeHeldSaleInner(id);
                } else {
                    resumeHeldSaleInner(id);
                }
            },
            true
        );
    } else {
        resumeHeldSaleInner(id);
    }
}

// 会員表示欄の簡易復元（会員名・年齢のみ。ポイント等は次回スキャン/操作時に再取得される想定）
function updateActiveCustomerDisplaySafe(cust) {
    const acDisplay = document.getElementById('active-customer-display');
    const nameEl = document.getElementById('ac-name');
    const ageEl = document.getElementById('ac-age');
    if (!acDisplay || !cust) return;
    if (nameEl) nameEl.innerText = cust.name || '';
    if (ageEl) ageEl.innerText = cust.age || '';
    acDisplay.style.display = 'block';
}

/* =========================================================
   ③ 保留件数バッジ（何件たまっているか一目でわかるように）
   ========================================================= */
function updateHeldSalesBadge() {
    const btn = document.getElementById('held-sales-list-btn');
    if (!btn) return;
    const count = getHeldSales().length;
    btn.innerText = count > 0 ? `📋 保留一覧 (${count})` : '📋 保留一覧';
    btn.style.background = count > 0 ? '#ffab00' : '';
}

/* =========================================================
   ⑤ ボタンが1個増えたことでレイアウトが3行になってしまう対策
   ------------------------------------------
   style.cssの.fixed-actions-containerは4列固定(grid-template-columns:
   repeat(4, 1fr))のため、ボタンが8個→9個に増えると2行に収まらず
   3行目に「お会計」だけが余ってしまう。style.cssは直接編集せず、
   <style>タグを1つ追加注入して、9個でも綺麗に2行（5列+4列）に
   収まるよう列数だけを上書きする。
   ========================================================= */
function ensureHoldSaleLayoutStyle() {
    if (document.getElementById('hold-sale-layout-style')) return;
    const style = document.createElement('style');
    style.id = 'hold-sale-layout-style';
    style.textContent = `
        #register-screen .fixed-actions-container {
            grid-template-columns: repeat(5, 1fr) !important;
        }
        #register-screen .fixed-actions-container .action-btn {
            font-size: 12px !important;
        }
        @media screen and (max-width: 900px) {
            #register-screen .fixed-actions-container {
                grid-template-columns: repeat(3, 1fr) !important;
            }
        }
    `;
    document.head.appendChild(style);
}


function ensureHoldSaleButtons() {
    ensureHoldSaleLayoutStyle();
    const actionsContainer = document.querySelector('#register-screen .fixed-actions-container');
    if (actionsContainer && !document.getElementById('hold-sale-btn')) {
        const holdBtn = document.createElement('button');
        holdBtn.id = 'hold-sale-btn';
        holdBtn.className = 'action-btn orange';
        holdBtn.innerHTML = '⏸️ 会計保留<br><small>(お客様が一時離脱)</small>';
        holdBtn.onclick = holdCurrentTransaction;
        // 「お会計」ボタンの直前に置く
        const checkoutBtn = actionsContainer.querySelector('button[onclick="openCheckout()"]');
        if (checkoutBtn) {
            actionsContainer.insertBefore(holdBtn, checkoutBtn);
        } else {
            actionsContainer.appendChild(holdBtn);
        }
    }

    const headerActions = document.querySelector('#register-screen .header-actions');
    if (headerActions && !document.getElementById('held-sales-list-btn')) {
        const listBtn = document.createElement('button');
        listBtn.id = 'held-sales-list-btn';
        listBtn.className = 'btn-refund-reg';
        listBtn.style.background = '';
        listBtn.innerText = '📋 保留一覧';
        listBtn.onclick = openHeldSalesList;
        headerActions.insertBefore(listBtn, headerActions.firstChild);
    }

    updateHeldSalesBadge();
}

(function hookShowScreenForHoldSaleButtons() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'register-screen') ensureHoldSaleButtons();
            return result;
        };
    }
    tryHook();
})();

document.addEventListener('DOMContentLoaded', () => {
    // レジ画面がすでに開いている状態でリロードされた場合にも対応
    if (document.getElementById('register-screen')?.classList.contains('active')) {
        ensureHoldSaleButtons();
    }
    updateHeldSalesBadge();
});
