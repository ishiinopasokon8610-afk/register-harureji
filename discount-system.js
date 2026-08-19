// ==========================================
// ハイテク音声レジスター - 割引バーコード登録・自動適用システム
// 1つのバーコードに以下を自由に組み合わせて登録できる:
//   ① 自動追加する商品（複数種類・数量指定可）
//   ② 割引（％値引き または 円値引き）
// レジ画面でそのバーコードをスキャンすると、登録した内容が
// まとめて自動的にカートへ反映される。
//
// データ形式（1件）:
// {
//   barcode: string,
//   name: string,
//   enabled: true/false,
//   products: [ { jan: string, qty: number }, ... ],  // 空配列可
//   discount: { type: 'percent'|'yen', value: number } | null
// }
// ==========================================

// 登録済みの割引バーコード一覧
let discountBarcodes = JSON.parse(localStorage.getItem('pos_discounts') || '[]');

// 編集中のインデックス
let editingDiscIndex = -1;

// 新規登録フォーム／編集モーダルで「仮組み」している商品リスト
let newDiscStagedProducts = [];
let editDiscStagedProducts = [];

// 同じ取引内で二重適用しないための管理（バーコード単位）
let usedDiscountBarcodesInTransaction = new Set();
// 「使い切りバーコード」として今回の会計で使用されたものを記録し、会計成立と同時に削除する
let usedOneTimeDiscBarcodesInTransaction = new Set();

// 年齢確認待ちで一時中断している割引処理のキュー
let pendingDiscountQueue = null; // { disc, idx, remainingQtyForRow }

/* =========================================================
   一覧表示・フォーム初期化
   ========================================================= */
function renderDiscounts() {
    populateProductSelect(document.getElementById('new-disc-product-select'));
    populateProductSelect(document.getElementById('edit-disc-product-select'));
    renderStagedProductRows('new');
    renderStagedProductRows('edit');

    const tbody = document.getElementById('discount-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (discountBarcodes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#999;">まだ自動化バーコード作成が登録されていません</td></tr>';
        return;
    }

    discountBarcodes.forEach((disc, index) => {
        const contentText = getDiscountContentText(disc);
        const enabled = disc.enabled !== false;
        const statusBtnStyle = enabled ? 'background:#2e7d32;' : 'background:#9e9e9e;';
        const statusLabel = enabled ? '✅ 有効' : '⛔ 無効';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family:monospace; font-weight:bold; color:#0066cc;">${disc.barcode}</td>
            <td><b>🏷️ ${disc.name}</b></td>
            <td style="line-height:1.6;">${contentText}</td>
            <td><button class="select-btn" style="${statusBtnStyle}" onclick="toggleDiscountEnabled(${index})">${statusLabel}</button></td>
            <td>
                <button class="select-btn" onclick="editDiscountBarcode(${index})" style="background:#ff9800; margin-right:6px;">変更</button>
                <button class="del-btn" onclick="deleteDiscountBarcode(${index})">削除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 内容列（商品追加＋割引の複数表示に対応）
function getDiscountContentText(disc) {
    const parts = [];
    const productList = disc.products || [];

    if (productList.length > 0) {
        const productParts = productList.map(row => {
            const prod = (typeof products !== 'undefined') ? products.find(p => p.jan === row.jan) : null;
            return prod ? `${prod.name} ×${row.qty}` : `<span style="color:#d32f2f;">不明な商品(${row.jan})</span>`;
        });
        parts.push(`📦 商品自動追加: ${productParts.join('、')}`);
    }

    if (disc.discount) {
        const d = disc.discount;
        parts.push(d.type === 'percent' ? `💴 ${d.value}% 値引き` : `💴 ¥${(d.value || 0).toLocaleString()} 値引き`);
    }

    if (disc.validFrom || disc.validTo) {
        const from = disc.validFrom || '指定なし';
        const to = disc.validTo || '指定なし';
        parts.push(`📅 適用期間: ${from} 〜 ${to}`);
    }

    if (disc.oneTime) {
        parts.push(`♻️ 使い切り（会計成立と同時に自動削除）`);
    }

    if (parts.length === 0) return '-';
    return parts.join('<br>');
}

// 商品選択プルダウンに登録商品を流し込む
function populateProductSelect(selectEl) {
    if (!selectEl || typeof products === 'undefined') return;
    const currentVal = selectEl.value;
    selectEl.innerHTML = '';
    if (products.length === 0) {
        selectEl.innerHTML = '<option value="">（商品が登録されていません）</option>';
        return;
    }
    products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.jan;
        opt.innerText = `${p.name} (¥${p.price.toLocaleString()})`;
        selectEl.appendChild(opt);
    });
    if (currentVal) selectEl.value = currentVal;
}

// 割引の入力欄（％/円 + 値）の表示切り替え
function toggleDiscValueRow(prefix) {
    const checkbox = document.getElementById(`${prefix}-disc-use-discount`);
    const row = document.getElementById(`${prefix}-disc-value-row`);
    if (!checkbox || !row) return;
    row.style.display = checkbox.checked ? 'flex' : 'none';
}

/* =========================================================
   自動追加する商品の「仮組みリスト」操作
   ========================================================= */
function addStagedProductRow(prefix) {
    const select = document.getElementById(`${prefix}-disc-product-select`);
    const qtyInput = document.getElementById(`${prefix}-disc-product-qty`);
    if (!select || !select.value) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }
    const jan = select.value;
    const qty = (parseInt(qtyInput.value) > 0) ? parseInt(qtyInput.value) : 1;
    const stagedArr = (prefix === 'new') ? newDiscStagedProducts : editDiscStagedProducts;

    const existing = stagedArr.find(r => r.jan === jan);
    if (existing) {
        existing.qty += qty;
    } else {
        stagedArr.push({ jan, qty });
    }

    if (qtyInput) qtyInput.value = '1';
    if (typeof playSound === 'function') playSound('click');
    renderStagedProductRows(prefix);
}

function removeStagedProductRow(prefix, idx) {
    const stagedArr = (prefix === 'new') ? newDiscStagedProducts : editDiscStagedProducts;
    stagedArr.splice(idx, 1);
    if (typeof playSound === 'function') playSound('click');
    renderStagedProductRows(prefix);
}

function renderStagedProductRows(prefix) {
    const container = document.getElementById(`${prefix}-disc-product-list`);
    if (!container) return;
    const stagedArr = (prefix === 'new') ? newDiscStagedProducts : editDiscStagedProducts;

    if (stagedArr.length === 0) {
        container.innerHTML = '<div style="color:#999; font-size:13px;">（まだ商品が追加されていません）</div>';
        return;
    }

    container.innerHTML = stagedArr.map((row, idx) => {
        const prod = (typeof products !== 'undefined') ? products.find(p => p.jan === row.jan) : null;
        const label = prod ? `${prod.name} × ${row.qty}` : `（不明な商品: ${row.jan}） × ${row.qty}`;
        return `<div style="display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #ddd; border-radius:4px; padding:6px 10px; margin-bottom:4px; font-size:14px;">
            <span>📦 ${label}</span>
            <button type="button" onclick="removeStagedProductRow('${prefix}', ${idx})" style="background:#f44336; color:white; border:none; border-radius:4px; padding:2px 10px; cursor:pointer; font-weight:bold;">×</button>
        </div>`;
    }).join('');
}

// バーコードの適用期間チェック（YYYY-MM-DD形式。どちらか未設定なら期限なし扱い）
function isDiscountBarcodeInValidPeriod(disc) {
    if (!disc.validFrom && !disc.validTo) return true;
    const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD 形式
    if (disc.validFrom && todayStr < disc.validFrom) return false;
    if (disc.validTo && todayStr > disc.validTo) return false;
    return true;
}

/* =========================================================
   新規登録
   ========================================================= */
function addDiscountBarcode() {
    const barcodeInput = document.getElementById('new-disc-barcode');
    const nameInput = document.getElementById('new-disc-name');
    const useDiscountCb = document.getElementById('new-disc-use-discount');
    const typeInput = document.getElementById('new-disc-type');
    const valueInput = document.getElementById('new-disc-value');
    const dateFromInput = document.getElementById('new-disc-date-from');
    const dateToInput = document.getElementById('new-disc-date-to');
    const oneTimeCb = document.getElementById('new-disc-one-time');

    const barcode = (barcodeInput && barcodeInput.value.trim()) ? barcodeInput.value.trim() : Date.now().toString();
    const name = nameInput ? nameInput.value.trim() : '';
    const useDiscount = useDiscountCb ? useDiscountCb.checked : false;

    if (!name) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("割引名を入力してください。", "わりびきめい を にゅうりょく し て ください。", () => {}, true);
        }
        return;
    }

    if (newDiscStagedProducts.length === 0 && !useDiscount) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("「自動追加する商品」または「割引」のどちらか一方以上を設定してください。", "しょうひん の じどう ついか か、 わりびき の どちらか いちいじょう を せってい し て ください。", () => {}, true);
        }
        return;
    }

    let discountObj = null;
    if (useDiscount) {
        const type = typeInput ? typeInput.value : 'percent';
        const value = valueInput ? parseInt(valueInput.value) : NaN;
        if (isNaN(value) || value <= 0 || (type === 'percent' && value > 100)) {
            if (typeof playSound === 'function') playSound('error');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("正しい値引き値を入力してください（パーセントは100%以下）。", "ただしい ねびきち を にゅうりょく し て ください。", () => {}, true);
            }
            return;
        }
        discountObj = { type, value };
    }

    const discData = {
        barcode,
        name,
        enabled: true,
        products: JSON.parse(JSON.stringify(newDiscStagedProducts)),
        discount: discountObj,
        validFrom: dateFromInput && dateFromInput.value ? dateFromInput.value : null,
        validTo: dateToInput && dateToInput.value ? dateToInput.value : null,
        oneTime: oneTimeCb ? oneTimeCb.checked : false
    };

    const existingIndex = discountBarcodes.findIndex(d => d.barcode === barcode);
    if (existingIndex !== -1) {
        discountBarcodes[existingIndex] = discData;
        if (typeof speak === 'function') speak("わりびき バーコード を うわがき ほぞん し まし た");
    } else {
        discountBarcodes.push(discData);
        if (typeof speak === 'function') speak("わりびき バーコード を とうろく し まし た");
    }

    saveDiscounts();

    // フォームをリセット
    if (barcodeInput) barcodeInput.value = '';
    if (nameInput) nameInput.value = '';
    if (valueInput) valueInput.value = '';
    if (useDiscountCb) useDiscountCb.checked = false;
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';
    if (oneTimeCb) oneTimeCb.checked = false;
    toggleDiscValueRow('new');
    newDiscStagedProducts = [];

    renderDiscounts();
    if (typeof playSound === 'function') playSound('success');
}

/* =========================================================
   編集
   ========================================================= */
function editDiscountBarcode(index) {
    if (typeof playSound === 'function') playSound('click');
    editingDiscIndex = index;
    const disc = discountBarcodes[index];
    if (!disc) return;

    const modal = document.getElementById('edit-disc-modal');
    if (modal) {
        modal.dataset.index = index;
        modal.style.display = 'flex';
    }

    const nameDisp = document.getElementById('edit-disc-name-display');
    if (nameDisp) nameDisp.innerText = `${disc.name} の編集 (バーコード: ${disc.barcode})`;

    document.getElementById('edit-disc-name-input').value = disc.name;

    editDiscStagedProducts = JSON.parse(JSON.stringify(disc.products || []));
    populateProductSelect(document.getElementById('edit-disc-product-select'));
    renderStagedProductRows('edit');

    const useDiscCb = document.getElementById('edit-disc-use-discount');
    if (disc.discount) {
        if (useDiscCb) useDiscCb.checked = true;
        document.getElementById('edit-disc-type').value = disc.discount.type;
        document.getElementById('edit-disc-value').value = disc.discount.value;
    } else {
        if (useDiscCb) useDiscCb.checked = false;
        document.getElementById('edit-disc-type').value = 'percent';
        document.getElementById('edit-disc-value').value = '';
    }
    toggleDiscValueRow('edit');

    const dateFromInput = document.getElementById('edit-disc-date-from');
    const dateToInput = document.getElementById('edit-disc-date-to');
    if (dateFromInput) dateFromInput.value = disc.validFrom || '';
    if (dateToInput) dateToInput.value = disc.validTo || '';
    const oneTimeCb = document.getElementById('edit-disc-one-time');
    if (oneTimeCb) oneTimeCb.checked = !!disc.oneTime;

    const err = document.getElementById('edit-disc-error');
    if (err) err.style.display = 'none';

    if (typeof speak === 'function') speak("わりびき バーコード の へんこう");
}

function closeEditDiscModal() {
    if (typeof playSound === 'function') playSound('click');
    const modal = document.getElementById('edit-disc-modal');
    if (modal) modal.style.display = 'none';
    editingDiscIndex = -1;
    editDiscStagedProducts = [];
}

function saveEditDisc() {
    const modal = document.getElementById('edit-disc-modal');
    const index = modal ? parseInt(modal.dataset.index) : editingDiscIndex;
    if (index < 0 || !discountBarcodes[index]) return;

    const name = document.getElementById('edit-disc-name-input').value.trim();
    const useDiscount = document.getElementById('edit-disc-use-discount').checked;
    const err = document.getElementById('edit-disc-error');

    if (!name || (editDiscStagedProducts.length === 0 && !useDiscount)) {
        if (err) err.style.display = 'block';
        if (typeof playSound === 'function') playSound('error');
        return;
    }

    let discountObj = null;
    if (useDiscount) {
        const type = document.getElementById('edit-disc-type').value;
        const value = parseInt(document.getElementById('edit-disc-value').value);
        if (isNaN(value) || value <= 0 || (type === 'percent' && value > 100)) {
            if (err) err.style.display = 'block';
            if (typeof playSound === 'function') playSound('error');
            return;
        }
        discountObj = { type, value };
    }

    const disc = discountBarcodes[index];
    disc.name = name;
    disc.products = JSON.parse(JSON.stringify(editDiscStagedProducts));
    disc.discount = discountObj;
    const dateFromInput = document.getElementById('edit-disc-date-from');
    const dateToInput = document.getElementById('edit-disc-date-to');
    disc.validFrom = dateFromInput && dateFromInput.value ? dateFromInput.value : null;
    disc.validTo = dateToInput && dateToInput.value ? dateToInput.value : null;
    const oneTimeCb = document.getElementById('edit-disc-one-time');
    disc.oneTime = oneTimeCb ? oneTimeCb.checked : false;

    if (err) err.style.display = 'none';
    saveDiscounts();
    closeEditDiscModal();
    renderDiscounts();
    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak("ほぞん し まし た");
}

function toggleDiscountEnabled(index) {
    const disc = discountBarcodes[index];
    if (!disc) return;
    disc.enabled = !(disc.enabled !== false);
    saveDiscounts();
    if (typeof playSound === 'function') playSound('click');
    renderDiscounts();
}

function deleteDiscountBarcode(index) {
    const disc = discountBarcodes[index];
    if (!disc) return;
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            `自動化バーコード作成「${disc.name}」を削除しますか？`,
            "この 自動化バーコード作成 を さくじょ し ます か？",
            (res) => {
                if (!res) return;
                discountBarcodes.splice(index, 1);
                saveDiscounts();
                if (typeof playSound === 'function') playSound('click');
                renderDiscounts();
                if (typeof speak === 'function') speak("さくじょ し まし た");
            },
            true
        );
    }
}

function saveDiscounts() {
    localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    broadcastDiscounts();
}

/* =========================================================
   API（Ably）経由での複数端末同期
   このお店で使っている他の端末（スマホ・レジ端末など）にも
   登録した自動化バーコードをリアルタイムで反映する。
   ========================================================= */
function broadcastDiscounts() {
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('discount-sync', {
                discounts: discountBarcodes,
                time: Date.now(),
                senderId: (typeof SYNC_DEVICE_ID !== 'undefined') ? SYNC_DEVICE_ID : null
            });
        } catch (err) {
            console.warn('割引バーコードの同期送信に失敗しました:', err);
        }
    }
}

(function waitForChannelAndSubscribeDiscountSync() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('discount-sync', (msg) => {
            if (msg && msg.data && Array.isArray(msg.data.discounts)) {
                discountBarcodes = msg.data.discounts;
                localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
                // 割引バーコード管理画面が開いている場合は表示も更新する
                if (document.getElementById('discount-tbody')) {
                    renderDiscounts();
                }
            }
        });
    } else {
        setTimeout(waitForChannelAndSubscribeDiscountSync, 500);
    }
})();

/* =========================================================
   カメラでバーコードを読み取って自動入力する
   （スマホ1台だけで自動化バーコードの登録ができるようにするための機能）
   ========================================================= */
let barcodeCameraStream = null;
let barcodeCameraScanInterval = null;
let barcodeCameraTargetInputId = null;

async function openBarcodeCameraScan(targetInputId) {
    if (typeof playSound === 'function') playSound('click');
    barcodeCameraTargetInputId = targetInputId;

    if (!('BarcodeDetector' in window)) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                "お使いのブラウザはカメラでのバーコード読み取りに対応していません。Android版Chromeなど対応ブラウザでお試しいただくか、バーコードを直接入力してください。",
                "この ぶらうざ は かめら での ばーこーど よみとり に たいおう し て い ませ ん。",
                () => {},
                false
            );
        }
        return;
    }

    const modal = document.getElementById('barcode-camera-modal');
    const video = document.getElementById('barcode-camera-video');
    if (!modal || !video) return;

    try {
        barcodeCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("カメラを起動できませんでした。カメラの使用許可設定をご確認ください。", "かめら を きどう でき ませ ん でし た。", () => {}, false);
        }
        return;
    }

    video.srcObject = barcodeCameraStream;
    video.play();
    modal.style.display = 'flex';

    let detector;
    try {
        detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'] });
    } catch (err) {
        detector = new BarcodeDetector();
    }

    if (barcodeCameraScanInterval) clearInterval(barcodeCameraScanInterval);
    barcodeCameraScanInterval = setInterval(async () => {
        if (!video.videoWidth || video.readyState < 2) return;
        try {
            const barcodes = await detector.detect(video);
            if (barcodes && barcodes.length > 0) {
                const code = barcodes[0].rawValue;
                closeBarcodeCameraScan();
                const targetInput = barcodeCameraTargetInputId ? document.getElementById(barcodeCameraTargetInputId) : null;
                if (targetInput) targetInput.value = code;
                if (typeof playSound === 'function') playSound('success');
                if (typeof speak === 'function') speak("バーコード を よみとり まし た");
            }
        } catch (err) {
            // 検出に失敗した場合は次のフレームを待つ（何もしない）
        }
    }, 350);
}

function closeBarcodeCameraScan() {
    if (barcodeCameraScanInterval) { clearInterval(barcodeCameraScanInterval); barcodeCameraScanInterval = null; }
    if (barcodeCameraStream) {
        barcodeCameraStream.getTracks().forEach(track => track.stop());
        barcodeCameraStream = null;
    }
    const modal = document.getElementById('barcode-camera-modal');
    const video = document.getElementById('barcode-camera-video');
    if (video) video.srcObject = null;
    if (modal) modal.style.display = 'none';
}

/* =========================================================
   レジ画面でのスキャン時 自動適用ロジック
   ========================================================= */

// 割引バーコードがスキャンされたときの入口
// ※ 割引（％/円引き）が設定されているバーコードのみ、同じ会計内での二重適用を防止する。
//   商品自動追加のみのバーコード（例：飲食店のセットメニュー）は、
//   同じ会計内で何度でもスキャンして繰り返し追加できる（同じセットを複数注文する用途のため）。
function applyDiscountBarcode(disc) {
    if (!isDiscountBarcodeInValidPeriod(disc)) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            const from = disc.validFrom || '指定なし';
            const to = disc.validTo || '指定なし';
            showCustomConfirm(`このクーポンの適用期間外です（適用期間: ${from} 〜 ${to}）。`, "この くーぽん は てきよう きかんがい です。", () => { if (typeof focusJanInput === 'function') focusJanInput(); }, false);
        }
        return;
    }

    if (disc.discount && usedDiscountBarcodesInTransaction.has(disc.barcode)) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("この割引はこのお会計ですでに使用されています。", "この わりびき は もう つかわれ て い ます。", () => { if (typeof focusJanInput === 'function') focusJanInput(); }, false);
        }
        return;
    }

    if (typeof playSound === 'function') playSound('beep');
    if (disc.discount) usedDiscountBarcodesInTransaction.add(disc.barcode);
    if (disc.oneTime) usedOneTimeDiscBarcodesInTransaction.add(disc.barcode);
    processDiscountProducts(disc, 0);
}

// お会計が成立したタイミングで register.js から呼び出す。
// 「使い切りバーコード」として今回使用されたものを一覧から自動的に削除する。
function cleanupOneTimeDiscountBarcodes() {
    if (usedOneTimeDiscBarcodesInTransaction.size === 0) return;
    const toDelete = new Set(usedOneTimeDiscBarcodesInTransaction);
    discountBarcodes = discountBarcodes.filter(d => !toDelete.has(d.barcode));
    saveDiscounts();
    if (document.getElementById('discount-tbody')) renderDiscounts();
    usedOneTimeDiscBarcodesInTransaction.clear();
}

// 登録された商品を1件ずつ順番にカートへ追加していく
// （年齢確認が必要な商品がある場合は、確認完了後に続きを処理する）
function processDiscountProducts(disc, idx) {
    const productList = disc.products || [];

    if (idx >= productList.length) {
        applyDiscountValue(disc);
        return;
    }

    const row = productList[idx];
    const prod = (typeof products !== 'undefined') ? products.find(p => p.jan === row.jan) : null;

    if (!prod) {
        // 商品が見つからない場合はスキップして次へ
        processDiscountProducts(disc, idx + 1);
        return;
    }

    const qty = row.qty || 1;
    const needsAgeCheck = prod.ageCheck && typeof ageVerifiedCurrentTransaction !== 'undefined' && !ageVerifiedCurrentTransaction;

    if (needsAgeCheck) {
        // 1点だけ年齢確認フローに乗せ、確認成功／キャンセルのフックで続きを処理する
        pendingDiscountQueue = { disc, idx, remainingQtyForRow: qty - 1 };
        if (typeof checkAndAddToCart === 'function') checkAndAddToCart(prod);
    } else {
        for (let i = 0; i < qty; i++) {
            if (typeof checkAndAddToCart === 'function') checkAndAddToCart(prod);
        }
        processDiscountProducts(disc, idx + 1);
    }
}

// 商品追加がすべて終わった後に割引（％/円）を適用する
function applyDiscountValue(disc) {
    if (disc.discount) {
        if (typeof cart === 'undefined' || cart.length === 0) {
            if (typeof playSound === 'function') playSound('error');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("値引き対象の商品がカートにありません。", "ねびき たいしょう の しょうひん が あり ませ ん。", () => { if (typeof focusJanInput === 'function') focusJanInput(); }, false);
            }
            if (typeof speak === 'function') speak(`とくてん バーコード、${disc.name} を てきよう し まし た`);
            if (typeof focusJanInput === 'function') focusJanInput();
            return;
        }

        if (typeof recordCartState === 'function') recordCartState();

        let discountAmount = disc.discount.type === 'percent'
            ? Math.floor(currentTotal * (disc.discount.value / 100))
            : disc.discount.value;

        if (discountAmount > currentTotal) discountAmount = currentTotal;

        if (discountAmount > 0) {
            cart.push({ name: `🏷️ ${disc.name}`, price: -discountAmount, qty: 1, taxRate: 10, genre: '値引き/その他' });
            if (typeof updateReceipt === 'function') updateReceipt();
        }
    }

    if (typeof speak === 'function') speak(`とくてん バーコード、${disc.name} を てきよう し まし た`);
    if (typeof focusJanInput === 'function') focusJanInput();
}

// register.js / ui.js の各関数を安全にラップして割引バーコード機能を組み込む
(function hookDiscountScanIntoRegister() {
    // スキャン処理へのフック：割引バーコードなら自動適用、それ以外は従来どおり
    if (typeof fetchAndAddItem === 'function') {
        const originalFetchAndAddItem = fetchAndAddItem;
        window.fetchAndAddItem = async function(code) {
            const disc = discountBarcodes.find(d => d.barcode === code && d.enabled !== false);
            if (disc) {
                applyDiscountBarcode(disc);
                return;
            }
            return originalFetchAndAddItem(code);
        };
    }

    // カートが空になったタイミングで、取引内の割引使用履歴をリセットする
    if (typeof updateReceipt === 'function') {
        const originalUpdateReceipt = updateReceipt;
        window.updateReceipt = function(...args) {
            const result = originalUpdateReceipt.apply(this, args);
            if (typeof cart !== 'undefined' && cart.length === 0) {
                if (usedDiscountBarcodesInTransaction.size > 0) usedDiscountBarcodesInTransaction.clear();
                if (usedOneTimeDiscBarcodesInTransaction.size > 0) usedOneTimeDiscBarcodesInTransaction.clear();
            }
            return result;
        };
    }

    // 年齢確認が成功した後、割引バーコードの残りの処理（残り数量・後続商品・割引適用）を続行する
    if (typeof onAgeCheckSuccess === 'function') {
        const originalOnAgeCheckSuccess = onAgeCheckSuccess;
        window.onAgeCheckSuccess = function(...args) {
            const result = originalOnAgeCheckSuccess.apply(this, args);
            if (pendingDiscountQueue) {
                const { disc, idx, remainingQtyForRow } = pendingDiscountQueue;
                pendingDiscountQueue = null;
                const row = (disc.products || [])[idx];
                const prod = row ? products.find(p => p.jan === row.jan) : null;
                if (prod) {
                    for (let i = 0; i < remainingQtyForRow; i++) {
                        if (typeof checkAndAddToCart === 'function') checkAndAddToCart(prod);
                    }
                }
                processDiscountProducts(disc, idx + 1);
            }
            return result;
        };
    }

    // 年齢確認がキャンセルされた場合は、割引バーコードの残りの処理を中止する
    if (typeof onAgeCheckCancel === 'function') {
        const originalOnAgeCheckCancel = onAgeCheckCancel;
        window.onAgeCheckCancel = function(...args) {
            const result = originalOnAgeCheckCancel.apply(this, args);
            if (pendingDiscountQueue) {
                usedDiscountBarcodesInTransaction.delete(pendingDiscountQueue.disc.barcode);
                pendingDiscountQueue = null;
                if (typeof speak === 'function') speak("ねんれい かくにん が できなかった ため、 とくてん バーコード の のこり の しょり を ちゅうし し まし た");
            }
            return result;
        };
    }
})();
