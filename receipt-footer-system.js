// ==========================================
// receipt-footer-system.js
// ------------------------------------------
// レシートのロゴのすぐ下（お店の名前やレシート本文が始まる前）に、
// 自由なテキスト・画像を追加できるようにする機能。
// 「データ管理・ロゴ設定」画面（migration-screen）に設定パネルを追加し、
// 内容はlocalStorageに保存されるので、一度設定すれば以降ずっと反映され続ける。
//
// register.js / index.html は直接編集せず、
//   ・generateReceiptHTML() をラップして、レシート本文が組み上がった直後に
//     receipt-capture-area（画像保存の対象領域）内、ロゴ（.receipt-preview-title）の
//     すぐ下・print-receipt-content の直前に差し込む
//   ・migration-screen 内に設定パネルをJSで動的に生成する
// という「フック方式」で実現する。
//
// receipt-coupon-system.js（商品購入によるクーポン表示機能）は、
// このファイルが用意する #receipt-extras-footer コンテナ（レシートの一番下・
// print-receipt-content の直後）の中に、#receipt-footer-coupons という
// 自分専用の領域を作って相乗りする（クーポンは従来どおり末尾表示）。
//
// 【2026-08 追加】
// ・有効期間の指定（開始日・終了日）に対応。期間外は自動的に表示されなくなる
//   （discount-system.js の自動化バーコードと同じ「未設定なら無期限」方式）。
// ・複数端末での同期に対応。設定を保存すると、Ably経由で他端末（他のレジ・
//   スマホ）にもリアルタイムで反映される（discount-system.js の割引バーコード
//   同期と同じ「保存のたびにブロードキャスト」方式）。
// ==========================================

const RECEIPT_FOOTER_TEXT_KEY = 'pos_receipt_footer_text';
const RECEIPT_FOOTER_IMAGE_KEY = 'pos_receipt_footer_image'; // dataURL(base64)
const RECEIPT_FOOTER_FROM_KEY = 'pos_receipt_footer_valid_from'; // YYYY-MM-DD（空なら無期限）
const RECEIPT_FOOTER_TO_KEY = 'pos_receipt_footer_valid_to';
// 【2026-11 追加】画像は、重いデータそのものではなく「URL」で他端末へ同期する。
// （画像データはこの端末にだけ残し、他端末にはGoogle Drive上のURLだけを送る）
const RECEIPT_FOOTER_IMAGE_URL_KEY = 'pos_receipt_footer_image_url';
const RECEIPT_FOOTER_DRIVE_FILENAME = 'haru-pos-receipt-footer.jpg';
// 他端末でURLから取得した画像の控え（pos_sync_ で始まるのでバックアップ・同期の対象外）
const RECEIPT_IMAGE_CACHE_KEY = 'pos_sync_receipt_image_cache';

function getReceiptFooterText() {
    return localStorage.getItem(RECEIPT_FOOTER_TEXT_KEY) || '';
}
function setReceiptFooterText(text) {
    localStorage.setItem(RECEIPT_FOOTER_TEXT_KEY, text || '');
}
function getReceiptFooterImage() {
    return localStorage.getItem(RECEIPT_FOOTER_IMAGE_KEY) || '';
}
function setReceiptFooterImage(dataUrl) {
    if (dataUrl) {
        localStorage.setItem(RECEIPT_FOOTER_IMAGE_KEY, dataUrl);
    } else {
        localStorage.removeItem(RECEIPT_FOOTER_IMAGE_KEY);
    }
}
function getReceiptFooterImageUrl() {
    return localStorage.getItem(RECEIPT_FOOTER_IMAGE_URL_KEY) || '';
}
function setReceiptFooterImageUrl(url) {
    if (url) {
        localStorage.setItem(RECEIPT_FOOTER_IMAGE_URL_KEY, url);
    } else {
        localStorage.removeItem(RECEIPT_FOOTER_IMAGE_URL_KEY);
    }
}

// <img src> に入れてよい値か（自分で作った dataURL か https のURLだけ）
function receiptImageIsSafeSrc(src) {
    return typeof src === 'string' && (src.indexOf('data:image/') === 0 || src.indexOf('https://') === 0);
}

// レシートに表示する画像の取得元を決める（receipt-coupon-system.js からも使う）
//  1) この端末に画像データがあれば、それを使う
//  2) 無ければURLを使う。ただしレシートを画像(PNG)保存するとき、他サイトの画像は
//     写らないことがあるため、裏で一度だけ画像データを取得して控えておき、
//     取得できた後はその控えを使う（取得できない場合はURLのまま表示する）
const receiptImageCacheInFlight = {};
const receiptImageCacheFailed = {};
function receiptImageSrcFor(localData, url) {
    if (localData) return localData;
    if (!url) return '';
    let map = {};
    try { map = JSON.parse(localStorage.getItem(RECEIPT_IMAGE_CACHE_KEY) || '{}') || {}; } catch (e) { map = {}; }
    if (map[url]) return map[url];
    fetchReceiptImageToCache(url);
    return url;
}
async function fetchReceiptImageToCache(url) {
    if (receiptImageCacheInFlight[url] || receiptImageCacheFailed[url]) return;
    receiptImageCacheInFlight[url] = true;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const data = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('読み込み失敗'));
            r.readAsDataURL(blob);
        });
        if (String(data).indexOf('data:image/') !== 0) throw new Error('画像ではありません');
        let map = {};
        try { map = JSON.parse(localStorage.getItem(RECEIPT_IMAGE_CACHE_KEY) || '{}') || {}; } catch (e) { map = {}; }
        const keys = Object.keys(map);
        while (keys.length >= 8) delete map[keys.shift()]; // 古い控えから捨てる
        map[url] = data;
        localStorage.setItem(RECEIPT_IMAGE_CACHE_KEY, JSON.stringify(map));
        if (typeof renderReceiptFooterCustomContent === 'function') renderReceiptFooterCustomContent();
        if (typeof renderReceiptFooterCoupons === 'function') renderReceiptFooterCoupons();
    } catch (e) {
        receiptImageCacheFailed[url] = true; // 取得できない（他サイトの制限など）場合はURL表示のまま
    } finally {
        delete receiptImageCacheInFlight[url];
    }
}

function getReceiptFooterValidFrom() {
    return localStorage.getItem(RECEIPT_FOOTER_FROM_KEY) || '';
}
function getReceiptFooterValidTo() {
    return localStorage.getItem(RECEIPT_FOOTER_TO_KEY) || '';
}
function setReceiptFooterValidPeriod(validFrom, validTo) {
    localStorage.setItem(RECEIPT_FOOTER_FROM_KEY, validFrom || '');
    localStorage.setItem(RECEIPT_FOOTER_TO_KEY, validTo || '');
}

// 有効期間チェック（YYYY-MM-DD形式。どちらか未設定なら期限なし扱い）
// ※ discount-system.js の isDiscountBarcodeInValidPeriod() と同じ考え方
function isReceiptFooterInValidPeriod() {
    const from = getReceiptFooterValidFrom();
    const to = getReceiptFooterValidTo();
    if (!from && !to) return true;
    const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD 形式
    if (from && todayStr < from) return false;
    if (to && todayStr > to) return false;
    return true;
}

// 画像ファイルを、レシート印字に十分なサイズ(幅最大500px)に圧縮してdataURL化する。
// localStorageの容量を圧迫しないための工夫。
function footerResizeImageToDataUrl(file, maxWidth = 500, quality = 0.85) {
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
   レシートへの差し込み①：ロゴのすぐ下に #receipt-header-custom を用意する
   （このファイル専用。カスタムメッセージ・画像はここに表示する）
   ========================================================= */
function ensureReceiptHeaderCustomContainer() {
    const captureArea = document.getElementById('receipt-capture-area');
    if (!captureArea) return null;

    let headerCustom = document.getElementById('receipt-header-custom');
    if (!headerCustom) {
        headerCustom = document.createElement('div');
        headerCustom.id = 'receipt-header-custom';

        const logoTitle = captureArea.querySelector('.receipt-preview-title');
        const printContent = document.getElementById('print-receipt-content');
        if (logoTitle && logoTitle.parentNode === captureArea) {
            // ロゴ（.receipt-preview-title）の直後＝print-receipt-content の直前に挿入
            logoTitle.insertAdjacentElement('afterend', headerCustom);
        } else if (printContent) {
            captureArea.insertBefore(headerCustom, printContent);
        } else {
            captureArea.appendChild(headerCustom);
        }
    }
    return headerCustom;
}

function renderReceiptFooterCustomContent() {
    const el = ensureReceiptHeaderCustomContainer();
    if (!el) return;

    const text = getReceiptFooterText();
    let image = receiptImageSrcFor(getReceiptFooterImage(), getReceiptFooterImageUrl());
    if (!receiptImageIsSafeSrc(image)) image = '';

    if ((!text && !image) || !isReceiptFooterInValidPeriod()) {
        el.innerHTML = '';
        return;
    }

    let html = `<div style="border-bottom: 1px dashed #333; margin: 0 0 10px 0; padding-bottom: 8px; text-align:center;">`;
    if (image) {
        html += `<img src="${image}" style="max-width:100%; max-height:160px; margin-bottom:6px;">`;
    }
    if (text) {
        const safeText = (typeof escapeHtml === 'function') ? escapeHtml(text) : text;
        html += `<div style="white-space:pre-wrap; font-size:12px; color:#333;">${safeText}</div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
}

/* =========================================================
   レシートへの差し込み②：#receipt-extras-footer コンテナ（レシートの一番下）
   （receipt-coupon-system.js が #receipt-footer-coupons として使う）
   ========================================================= */
function ensureReceiptExtrasFooterContainer() {
    const captureArea = document.getElementById('receipt-capture-area');
    if (!captureArea) return null;

    let extras = document.getElementById('receipt-extras-footer');
    if (!extras) {
        extras = document.createElement('div');
        extras.id = 'receipt-extras-footer';
        captureArea.appendChild(extras); // print-receipt-content のすぐ後ろ＝レシートの一番下
    }

    if (!document.getElementById('receipt-footer-coupons')) {
        const couponDiv = document.createElement('div');
        couponDiv.id = 'receipt-footer-coupons';
        extras.appendChild(couponDiv);
    }
    return extras;
}

/* =========================================================
   generateReceiptHTML() をラップし、本文が組み上がった直後に差し込む
   ========================================================= */
(function hookReceiptFooterIntoGenerate() {
    function tryHook() {
        if (typeof window.generateReceiptHTML !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.generateReceiptHTML;
        window.generateReceiptHTML = function (...args) {
            const result = original.apply(this, args);
            renderReceiptFooterCustomContent();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   設定パネル（データ管理・ロゴ設定画面 = migration-screen に差し込む）
   ========================================================= */
function ensureReceiptFooterSettingsPanel() {
    if (document.getElementById('receipt-footer-settings-container')) {
        renderReceiptFooterSettingsPanel();
        return;
    }

    const screen = document.getElementById('migration-screen');
    if (!screen) return;

    const container = document.createElement('div');
    container.id = 'receipt-footer-settings-container';
    screen.appendChild(container); // 画面の一番下に追加（既存の設定ブロックの邪魔をしない）

    renderReceiptFooterSettingsPanel();
}

function renderReceiptFooterSettingsPanel() {
    const container = document.getElementById('receipt-footer-settings-container');
    if (!container) return;

    const text = getReceiptFooterText();
    let image = getReceiptFooterImage() || getReceiptFooterImageUrl();
    if (!receiptImageIsSafeSrc(image)) image = '';
    const validFrom = getReceiptFooterValidFrom();
    const validTo = getReceiptFooterValidTo();

    container.innerHTML = `
        <div class="migration-block" style="background:#fce4ec; border:2px solid #f48fb1; padding:15px; border-radius:6px; margin-bottom:15px;">
            <h3 class="migration-title" style="color:#ad1457;">🧾 レシート（ロゴ下）のメッセージ・画像</h3>
            <p class="migration-desc">レシートのロゴのすぐ下に表示する、自由な文字・画像を設定できます。保存すると他の端末（レジ・スマホ）にも自動で反映されます。</p>

            <div style="margin-bottom:10px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:4px;">文字（そのまま印字されます）</label>
                <textarea id="receipt-footer-text-input" rows="3" placeholder="例: 次回来店時に本レシートをご提示いただくと5%OFF！"
                    style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:13px;">${(typeof escapeHtml === 'function') ? escapeHtml(text) : text}</textarea>
            </div>

            <div style="margin-bottom:10px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:4px;">画像（任意）</label>
                <input type="file" id="receipt-footer-image-input" accept="image/*" onchange="handleReceiptFooterImageUpload(event)">
                ${image ? `<div style="margin-top:8px;"><img src="${image}" style="max-height:100px; border:1px solid #ddd; border-radius:4px;"><br><button onclick="clearReceiptFooterImage()" style="margin-top:6px; padding:4px 10px; background:#f44336; color:#fff; border:none; border-radius:4px; cursor:pointer;">画像を削除</button></div>` : ''}
            </div>

            <div style="margin-bottom:10px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:4px;">有効期間（任意・未指定なら常時表示）</label>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="date" id="receipt-footer-from-input" value="${validFrom}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;">
                    <span>〜</span>
                    <input type="date" id="receipt-footer-to-input" value="${validTo}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;">
                </div>
            </div>

            <button onclick="saveReceiptFooterSettings()" style="padding:10px 16px; background:#ad1457; color:#fff; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">保存</button>
        </div>
    `;
}

async function handleReceiptFooterImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
        const dataUrl = await footerResizeImageToDataUrl(file);
        setReceiptFooterImage(dataUrl);
        setReceiptFooterImageUrl(''); // 新しい画像になったので、古いURLは使わない
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
        if (typeof playSound === 'function') playSound('success');
        renderReceiptFooterSettingsPanel();
        renderReceiptFooterCustomContent();

        // 他端末へは、重い画像データではなくURLだけを送る。
        // Google Driveに画像を1回だけアップロードしてURLを作り、そのURLを同期する。
        // （Driveに未連携などでURLが作れない時は、これまで通り画像データそのものを送る）
        let url = '';
        if (typeof uploadDataUrlToCloudImage === 'function') {
            url = await uploadDataUrlToCloudImage(dataUrl, RECEIPT_FOOTER_DRIVE_FILENAME);
        }
        // アップロード待ちの間に別の画像へ差し替えられていた場合は、古い方のURLを採用しない
        if (url && getReceiptFooterImage() === dataUrl) {
            setReceiptFooterImageUrl(url);
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
        }
        broadcastReceiptFooterSettings();
    } catch (e) {
        console.warn(e);
        if (typeof playSound === 'function') playSound('error');
    }
}

function clearReceiptFooterImage() {
    setReceiptFooterImage(null);
    setReceiptFooterImageUrl('');
    // Drive上の画像も、連携済みなら静かに削除する（失敗しても無視）
    if (typeof deleteGoogleDriveFileByName === 'function') deleteGoogleDriveFileByName(RECEIPT_FOOTER_DRIVE_FILENAME, false);
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    broadcastReceiptFooterSettings();
    if (typeof playSound === 'function') playSound('click');
    renderReceiptFooterSettingsPanel();
    renderReceiptFooterCustomContent();
}

function saveReceiptFooterSettings() {
    const textInput = document.getElementById('receipt-footer-text-input');
    const fromInput = document.getElementById('receipt-footer-from-input');
    const toInput = document.getElementById('receipt-footer-to-input');
    setReceiptFooterText(textInput ? textInput.value : '');
    setReceiptFooterValidPeriod(fromInput ? fromInput.value : '', toInput ? toInput.value : '');
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    broadcastReceiptFooterSettings();
    renderReceiptFooterCustomContent();
    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak('ほぞん し まし た');
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm('レシートのメッセージ設定を保存しました。他の端末にも反映されます。', 'ほぞん し まし た', () => {}, false);
    }
}

/* =========================================================
   API（Ably）経由での複数端末同期
   ------------------------------------------
   discount-system.js の自動化バーコード同期と同じ「保存のたびに
   まるごと送信・受信したらまるごと上書き」方式。
   画像はdataURL(base64)のため、大きな画像を設定するとAblyの
   1メッセージあたりのサイズ上限を超えて送信に失敗する場合がある
   （その場合もこの端末local自体の保存・表示には影響しない）。
   ========================================================= */
function broadcastReceiptFooterSettings() {
    if (typeof channel !== 'undefined' && channel) {
        try {
            // URLがあればURLだけを送る（軽い）。無い時だけ画像データそのものを送る。
            const imageUrl = getReceiptFooterImageUrl();
            channel.publish('receipt-footer-sync', {
                text: getReceiptFooterText(),
                image: imageUrl ? '' : getReceiptFooterImage(),
                imageUrl: imageUrl,
                validFrom: getReceiptFooterValidFrom(),
                validTo: getReceiptFooterValidTo(),
                senderId: (typeof SYNC_DEVICE_ID !== 'undefined') ? SYNC_DEVICE_ID : null,
                time: Date.now()
            });
        } catch (err) {
            console.warn('レシートメッセージの同期送信に失敗しました:', err);
        }
    }
}

(function waitForChannelAndSubscribeReceiptFooterSync() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('receipt-footer-sync', (msg) => {
            if (!msg || !msg.data) return;
            setReceiptFooterText(msg.data.text || '');
            const incomingUrl = msg.data.imageUrl || '';
            const incomingImage = msg.data.image || '';
            if (incomingImage) {
                // 画像データそのものが届いた場合（Drive未連携の端末から送られた時）
                setReceiptFooterImage(incomingImage);
                setReceiptFooterImageUrl('');
            } else if (incomingUrl) {
                // URLだけが届いた場合。URLが今と同じ（自分が送った分のエコー、または文字だけの変更）なら、
                // この端末に残っている画像データは消さない。違うURLなら新しい画像なので、URLに切り替える
                if (incomingUrl !== getReceiptFooterImageUrl()) setReceiptFooterImage(null);
                setReceiptFooterImageUrl(incomingUrl);
            } else {
                setReceiptFooterImage(null);
                setReceiptFooterImageUrl('');
            }
            setReceiptFooterValidPeriod(msg.data.validFrom || '', msg.data.validTo || '');
            if (document.getElementById('receipt-footer-settings-container')) {
                renderReceiptFooterSettingsPanel();
            }
            renderReceiptFooterCustomContent();
        });
    } else {
        setTimeout(waitForChannelAndSubscribeReceiptFooterSync, 500);
    }
})();

/* =========================================================
   初期化
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
    (function tryInitPanel() {
        if (!document.getElementById('migration-screen')) {
            setTimeout(tryInitPanel, 300);
            return;
        }
        ensureReceiptFooterSettingsPanel();
    })();
});
