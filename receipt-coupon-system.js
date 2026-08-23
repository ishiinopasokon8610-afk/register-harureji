// ==========================================
// receipt-coupon-system.js
// ------------------------------------------
// 特定の商品を1点、またはセット（複数商品の組み合わせ）で購入した会計の
// レシート末尾に、登録しておいたクーポン（文字・画像）を自動的に印字する機能。
//
// データ形式（pos_receipt_coupons に配列で保存）:
// {
//   id: string,
//   name: string,                 // 管理用の名前
//   enabled: true/false,
//   triggerProducts: [ { jan, qty } ],  // これらが全て、指定数量以上カートに
//                                        // 入っていればクーポン対象（1商品だけ登録すれば「単品」条件になる）
//   couponText: string,
//   couponImage: string (dataURL) | '',
//   validFrom: string (YYYY-MM-DD) | null,  // 未設定なら無期限
//   validTo: string (YYYY-MM-DD) | null
// }
//
// register.js / index.html は直接編集せず、
//   ・generateReceiptHTML() をラップして、対象クーポンを判定・印字する
//     （receipt-footer-system.js が用意する #receipt-footer-coupons に差し込む）
//   ・migration-screen 内に登録・管理パネルをJSで動的に生成する
// という「フック方式」で実現する。
//
// 【2026-08 追加】
// ・クーポンごとに有効期間（開始日・終了日）を指定可能に（discount-system.js の
//   自動化バーコードと同じ「未設定なら無期限」方式）。期間外のクーポンは
//   条件を満たしていてもレシートに印字されない。
// ・クーポンの登録内容をAbly経由で他端末（他のレジ・スマホ）にもリアルタイムで
//   同期する（discount-system.js の割引バーコード同期と同じ方式）。
// ==========================================

const RECEIPT_COUPONS_KEY = 'pos_receipt_coupons';

let receiptCoupons = JSON.parse(localStorage.getItem(RECEIPT_COUPONS_KEY) || '[]');
let couponStagedProducts = []; // 登録フォームで「仮組み」している対象商品リスト
let editingCouponId = null;    // nullなら新規登録、文字列ならそのidを編集中

function saveReceiptCoupons() {
    localStorage.setItem(RECEIPT_COUPONS_KEY, JSON.stringify(receiptCoupons));
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    broadcastReceiptCoupons();
}

// 有効期間チェック（YYYY-MM-DD形式。どちらか未設定なら期限なし扱い）
// ※ discount-system.js の isDiscountBarcodeInValidPeriod() と同じ考え方
function isReceiptCouponInValidPeriod(coupon) {
    if (!coupon.validFrom && !coupon.validTo) return true;
    const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD 形式
    if (coupon.validFrom && todayStr < coupon.validFrom) return false;
    if (coupon.validTo && todayStr > coupon.validTo) return false;
    return true;
}

/* =========================================================
   API（Ably）経由での複数端末同期
   discount-system.js の自動化バーコード同期と同じ「保存のたびに
   まるごと送信・受信したらまるごと上書き」方式。
   ========================================================= */
function broadcastReceiptCoupons() {
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('receipt-coupon-sync', {
                coupons: receiptCoupons,
                senderId: (typeof SYNC_DEVICE_ID !== 'undefined') ? SYNC_DEVICE_ID : null,
                time: Date.now()
            });
        } catch (err) {
            console.warn('商品連動クーポンの同期送信に失敗しました:', err);
        }
    }
}

(function waitForChannelAndSubscribeReceiptCouponSync() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('receipt-coupon-sync', (msg) => {
            if (msg && msg.data && Array.isArray(msg.data.coupons)) {
                receiptCoupons = msg.data.coupons;
                localStorage.setItem(RECEIPT_COUPONS_KEY, JSON.stringify(receiptCoupons));
                // クーポン管理パネルが開いている場合は表示も更新する
                if (document.getElementById('receipt-coupon-settings-container')) {
                    renderReceiptCouponSettingsPanel();
                }
            }
        });
    } else {
        setTimeout(waitForChannelAndSubscribeReceiptCouponSync, 500);
    }
})();

function couponResizeImageToDataUrl(file, maxWidth = 500, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

/* =========================================================
   判定ロジック：今回のカートで、どのクーポンが対象になるか
   ========================================================= */
function getMatchedCouponsForCart(cartList) {
    if (!Array.isArray(cartList) || cartList.length === 0) return [];

    // カートの商品行には jan が保存されていないため、商品名で数量を集計する
    // （register.js の addToCart() が name/price/taxRate/genre のみ保持する仕様のため）。
    // 値引き行（price < 0）は対象外。
    const qtyByName = {};
    cartList.forEach(item => {
        if (!item || !item.name || item.price < 0) return;
        qtyByName[item.name] = (qtyByName[item.name] || 0) + (item.qty || 1);
    });

    return receiptCoupons.filter(c => {
        if (c.enabled === false) return false;
        if (!isReceiptCouponInValidPeriod(c)) return false;
        const triggers = c.triggerProducts || [];
        if (triggers.length === 0) return false;
        return triggers.every(t => (qtyByName[t.name] || 0) >= (t.qty || 1));
    });
}

function renderReceiptFooterCoupons() {
    if (typeof ensureReceiptExtrasFooterContainer === 'function') ensureReceiptExtrasFooterContainer();
    const el = document.getElementById('receipt-footer-coupons');
    if (!el) return;

    const matched = (typeof cart !== 'undefined') ? getMatchedCouponsForCart(cart) : [];

    if (matched.length === 0) {
        el.innerHTML = '';
        return;
    }

    let html = '';
    matched.forEach(c => {
        html += `<div style="border-top: 1px dashed #d81b60; margin: 10px 0 8px 0; padding-top: 8px; text-align:center;">`;
        html += `<div style="font-weight:bold; color:#d81b60; font-size:12px; margin-bottom:4px;">🎫 クーポン</div>`;
        if (c.couponImage) {
            html += `<img src="${c.couponImage}" style="max-width:100%; max-height:160px; margin-bottom:6px;">`;
        }
        if (c.couponText) {
            const safeText = (typeof escapeHtml === 'function') ? escapeHtml(c.couponText) : c.couponText;
            html += `<div style="white-space:pre-wrap; font-size:12px; color:#333;">${safeText}</div>`;
        }
        html += `</div>`;
    });
    el.innerHTML = html;
}

(function hookCouponsIntoReceiptGenerate() {
    function tryHook() {
        if (typeof window.generateReceiptHTML !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.generateReceiptHTML;
        window.generateReceiptHTML = function (...args) {
            const result = original.apply(this, args);
            renderReceiptFooterCoupons();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   管理パネル（migration-screen に差し込む）
   ========================================================= */
function ensureReceiptCouponSettingsPanel() {
    if (document.getElementById('receipt-coupon-settings-container')) {
        renderReceiptCouponSettingsPanel();
        return;
    }

    const screen = document.getElementById('migration-screen');
    if (!screen) return;

    const container = document.createElement('div');
    container.id = 'receipt-coupon-settings-container';
    screen.appendChild(container);

    renderReceiptCouponSettingsPanel();
}

function renderReceiptCouponSettingsPanel() {
    const container = document.getElementById('receipt-coupon-settings-container');
    if (!container) return;

    const productOptionsHtml = (typeof products !== 'undefined' ? products : [])
        .map(p => `<option value="${p.jan}">${(typeof escapeHtml === 'function') ? escapeHtml(p.name) : p.name} (¥${p.price.toLocaleString()})</option>`)
        .join('');

    const stagedRowsHtml = couponStagedProducts.map((row, idx) => {
        const prod = (typeof products !== 'undefined') ? products.find(p => p.jan === row.jan) : null;
        const label = prod ? prod.name : `不明な商品(${row.jan})`;
        return `<div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:6px 10px; border-radius:4px; margin-bottom:4px; font-size:13px;">
            <span>${(typeof escapeHtml === 'function') ? escapeHtml(label) : label} ×${row.qty}</span>
            <button onclick="removeCouponStagedProductRow(${idx})" style="border:none; background:#f44336; color:#fff; border-radius:4px; padding:2px 8px; cursor:pointer;">×</button>
        </div>`;
    }).join('') || '<div style="font-size:12px; color:#999;">まだ対象商品が追加されていません</div>';

    const editingLabel = editingCouponId ? '（編集中）' : '（新規登録）';

    const listRowsHtml = receiptCoupons.map(c => {
        const triggerText = (c.triggerProducts || []).map(t => {
            const prod = (typeof products !== 'undefined') ? products.find(p => p.jan === t.jan) : null;
            return prod ? `${prod.name}×${t.qty}` : `不明な商品(${t.jan})×${t.qty}`;
        }).join('、');
        const periodText = (c.validFrom || c.validTo)
            ? `<br><small style="color:#e65100;">📅 ${c.validFrom || '指定なし'} 〜 ${c.validTo || '指定なし'}</small>`
            : '';
        const enabled = c.enabled !== false;
        return `
            <tr>
                <td><b>🎫 ${(typeof escapeHtml === 'function') ? escapeHtml(c.name) : c.name}</b></td>
                <td style="font-size:12px;">${triggerText}${periodText}</td>
                <td><button class="select-btn" style="${enabled ? 'background:#2e7d32;' : 'background:#9e9e9e;'}" onclick="toggleReceiptCouponEnabled('${c.id}')">${enabled ? '✅ 有効' : '⛔ 無効'}</button></td>
                <td>
                    <button class="select-btn" style="background:#ff9800; margin-right:6px;" onclick="editReceiptCoupon('${c.id}')">変更</button>
                    <button class="del-btn" onclick="deleteReceiptCoupon('${c.id}')">削除</button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="migration-block" style="background:#fff3e0; border:2px solid #ffb74d; padding:15px; border-radius:6px; margin-bottom:15px;">
            <h3 class="migration-title" style="color:#e65100;">🎫 商品連動クーポン ${editingLabel}</h3>
            <p class="migration-desc">特定の商品を1点、またはセットで購入した時だけ、レシート末尾にクーポンを印字します。</p>

            <div style="margin-bottom:10px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:4px;">クーポン名（管理用）</label>
                <input type="text" id="coupon-name-input" placeholder="例: プリン購入者限定クーポン" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px;">
            </div>

            <div style="margin-bottom:10px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:4px;">対象商品（1つでも「単品」条件になります。複数追加すると「セット」条件になります）</label>
                <div style="display:flex; gap:6px; margin-bottom:6px;">
                    <select id="coupon-product-select" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;">${productOptionsHtml}</select>
                    <input type="number" id="coupon-product-qty" value="1" min="1" style="width:60px; padding:8px; border:1px solid #ccc; border-radius:4px;">
                    <button onclick="addCouponStagedProductRow()" style="padding:8px 12px; background:#1565c0; color:#fff; border:none; border-radius:4px; cursor:pointer;">追加</button>
                </div>
                <div id="coupon-staged-products">${stagedRowsHtml}</div>
            </div>

            <div style="margin-bottom:10px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:4px;">クーポンの文字</label>
                <textarea id="coupon-text-input" rows="3" placeholder="例: このクーポンご提示で次回ドリンク1杯無料！"
                    style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:13px;"></textarea>
            </div>

            <div style="margin-bottom:10px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:4px;">クーポンの画像（任意）</label>
                <input type="file" id="coupon-image-input" accept="image/*" onchange="handleCouponImageUpload(event)">
                <div id="coupon-image-preview"></div>
            </div>

            <div style="margin-bottom:10px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:4px;">有効期間（任意・未指定なら無期限）</label>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="date" id="coupon-valid-from-input" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;">
                    <span>〜</span>
                    <input type="date" id="coupon-valid-to-input" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;">
                </div>
            </div>

            <div style="display:flex; gap:10px;">
                <button onclick="saveReceiptCouponForm()" style="flex:1; padding:10px 16px; background:#e65100; color:#fff; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">${editingCouponId ? '更新して保存' : 'クーポンを登録'}</button>
                ${editingCouponId ? `<button onclick="cancelEditReceiptCoupon()" style="padding:10px 16px; background:#999; color:#fff; border:none; border-radius:4px; cursor:pointer;">編集をやめる</button>` : ''}
            </div>

            <hr style="margin:16px 0; border:none; border-top:1px solid #ffcc80;">

            <table class="data-table" style="width:100%; font-size:13px;">
                <thead><tr><th>クーポン名</th><th>対象商品</th><th>状態</th><th>操作</th></tr></thead>
                <tbody>${listRowsHtml || '<tr><td colspan="4" style="text-align:center; color:#999;">まだクーポンが登録されていません</td></tr>'}</tbody>
            </table>
        </div>
    `;

    // 編集中クーポンの画像プレビュー・有効期間を反映
    if (editingCouponId) {
        const editing = receiptCoupons.find(c => c.id === editingCouponId);
        if (editing) {
            const nameInput = document.getElementById('coupon-name-input');
            const textInput = document.getElementById('coupon-text-input');
            const fromInput = document.getElementById('coupon-valid-from-input');
            const toInput = document.getElementById('coupon-valid-to-input');
            if (nameInput) nameInput.value = editing.name || '';
            if (textInput) textInput.value = editing.couponText || '';
            if (fromInput) fromInput.value = editing.validFrom || '';
            if (toInput) toInput.value = editing.validTo || '';
            renderCouponImagePreview(editing.couponImage || '');
        }
    }
}

function renderCouponImagePreview(dataUrl) {
    const el = document.getElementById('coupon-image-preview');
    if (!el) return;
    el.innerHTML = dataUrl
        ? `<div style="margin-top:8px;"><img src="${dataUrl}" style="max-height:100px; border:1px solid #ddd; border-radius:4px;"><br><button onclick="clearCouponImagePreview()" style="margin-top:6px; padding:4px 10px; background:#f44336; color:#fff; border:none; border-radius:4px; cursor:pointer;">画像を削除</button></div>`
        : '';
    el.dataset.value = dataUrl || '';
}

function clearCouponImagePreview() {
    renderCouponImagePreview('');
}

async function handleCouponImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
        const dataUrl = await couponResizeImageToDataUrl(file);
        renderCouponImagePreview(dataUrl);
        if (typeof playSound === 'function') playSound('success');
    } catch (e) {
        console.warn(e);
        if (typeof playSound === 'function') playSound('error');
    }
}

function addCouponStagedProductRow() {
    const select = document.getElementById('coupon-product-select');
    const qtyInput = document.getElementById('coupon-product-qty');
    if (!select || !select.value) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }
    const jan = select.value;
    const qty = (parseInt(qtyInput.value) > 0) ? parseInt(qtyInput.value) : 1;
    const prod = (typeof products !== 'undefined') ? products.find(p => p.jan === jan) : null;
    if (!prod) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }

    const existing = couponStagedProducts.find(r => r.jan === jan);
    if (existing) {
        existing.qty += qty;
    } else {
        // name も一緒に保存しておく（カートの行はjanを持たず商品名で照合するため）
        couponStagedProducts.push({ jan, name: prod.name, qty });
    }
    if (qtyInput) qtyInput.value = '1';
    if (typeof playSound === 'function') playSound('click');
    renderReceiptCouponSettingsPanel();
}

function removeCouponStagedProductRow(idx) {
    couponStagedProducts.splice(idx, 1);
    if (typeof playSound === 'function') playSound('click');
    renderReceiptCouponSettingsPanel();
}

function saveReceiptCouponForm() {
    const nameInput = document.getElementById('coupon-name-input');
    const textInput = document.getElementById('coupon-text-input');
    const imagePreviewEl = document.getElementById('coupon-image-preview');
    const fromInput = document.getElementById('coupon-valid-from-input');
    const toInput = document.getElementById('coupon-valid-to-input');
    const name = nameInput ? nameInput.value.trim() : '';
    const couponText = textInput ? textInput.value.trim() : '';
    const couponImage = imagePreviewEl ? (imagePreviewEl.dataset.value || '') : '';
    const validFrom = fromInput && fromInput.value ? fromInput.value : null;
    const validTo = toInput && toInput.value ? toInput.value : null;

    if (!name) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') showCustomConfirm('クーポン名を入力してください。', 'なまえ を にゅうりょく し て ください', () => {}, true);
        return;
    }
    if (couponStagedProducts.length === 0) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') showCustomConfirm('対象商品を1つ以上追加してください。', 'たいしょう しょうひん を ついか し て ください', () => {}, true);
        return;
    }
    if (!couponText && !couponImage) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') showCustomConfirm('クーポンの文字か画像、どちらか一方は入力してください。', 'ないよう を にゅうりょく し て ください', () => {}, true);
        return;
    }

    if (editingCouponId) {
        const target = receiptCoupons.find(c => c.id === editingCouponId);
        if (target) {
            target.name = name;
            target.triggerProducts = couponStagedProducts.slice();
            target.couponText = couponText;
            target.couponImage = couponImage;
            target.validFrom = validFrom;
            target.validTo = validTo;
        }
    } else {
        receiptCoupons.push({
            id: `coupon_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            name,
            enabled: true,
            triggerProducts: couponStagedProducts.slice(),
            couponText,
            couponImage,
            validFrom,
            validTo
        });
    }

    saveReceiptCoupons();
    editingCouponId = null;
    couponStagedProducts = [];

    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak('くーぽん を ほぞん し まし た');
    renderReceiptCouponSettingsPanel();
}

function editReceiptCoupon(id) {
    const target = receiptCoupons.find(c => c.id === id);
    if (!target) return;
    editingCouponId = id;
    couponStagedProducts = (target.triggerProducts || []).map(t => {
        const prod = (typeof products !== 'undefined') ? products.find(p => p.jan === t.jan) : null;
        return { jan: t.jan, name: t.name || (prod ? prod.name : ''), qty: t.qty };
    });
    if (typeof playSound === 'function') playSound('click');
    renderReceiptCouponSettingsPanel();
}

function cancelEditReceiptCoupon() {
    editingCouponId = null;
    couponStagedProducts = [];
    if (typeof playSound === 'function') playSound('click');
    renderReceiptCouponSettingsPanel();
}

function toggleReceiptCouponEnabled(id) {
    const target = receiptCoupons.find(c => c.id === id);
    if (!target) return;
    target.enabled = target.enabled === false ? true : false;
    saveReceiptCoupons();
    if (typeof playSound === 'function') playSound('click');
    renderReceiptCouponSettingsPanel();
}

function deleteReceiptCoupon(id) {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm('このクーポンを削除しますか？', 'さくじょ し ます か？', (res) => {
            if (!res) return;
            receiptCoupons = receiptCoupons.filter(c => c.id !== id);
            if (editingCouponId === id) { editingCouponId = null; couponStagedProducts = []; }
            saveReceiptCoupons();
            if (typeof playSound === 'function') playSound('click');
            renderReceiptCouponSettingsPanel();
        }, true);
    }
}

/* =========================================================
   初期化
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
    (function tryInitPanel() {
        if (!document.getElementById('migration-screen') || typeof products === 'undefined') {
            setTimeout(tryInitPanel, 300);
            return;
        }
        ensureReceiptCouponSettingsPanel();
    })();
});
