// ==========================================
// discount-barcode-pdf-system.js
// 自動化バーコードのPDF出力（1件ずつ／全件一括）
// ------------------------------------------
// 自動化バーコード作成画面(discount-screen)に登録されている各バーコード
// (discountBarcodes[].barcode) を、customer-barcode-pdf-system.js /
// clerk-barcode-pdf-system.js と同じ考え方・同じライブラリ（JsBarcode + jsPDF）
// を使ってPDFに書き出す。
//   ・1件分だけ … 一覧の各行に追加する「PDF」ボタン
//   ・全件まとめて … 画面右上の「🖨️ バーコード一括PDF」ボタン
//     （A4にラベルシートのように複数件分を敷き詰める）
// アーカイブ済み（使用済み）のバーコードは対象外（discount-tbodyに
// 表示されているものだけを対象にする）。
//
// register.js / ui.js / discount-system.js には一切手を加えず、
// discount-tbody を MutationObserver で監視してボタンを追加する
// 「フック/DOM注入方式」で実現する。
//
// ※ バーコード画像生成・PDF生成・日本語文字化け対策のヘルパーは
//   customer-barcode-pdf-system.js側で定義済みのため使い回す
//   （無い環境でも動くよう、無ければ自前で用意する＝他の追加機能
//   ファイルと同じフォールバック方式）。
// ==========================================

function getDiscountListSafe() {
    try {
        if (typeof discountBarcodes !== 'undefined' && Array.isArray(discountBarcodes)) return discountBarcodes;
        return JSON.parse(localStorage.getItem('pos_discounts') || '[]');
    } catch (e) {
        return [];
    }
}

function discDisplayNameForPdf(disc) {
    if (typeof discDisplayName === 'function') return discDisplayName(disc);
    return (disc && disc.name && disc.name.trim()) ? disc.name.trim() : '（名称未設定）';
}

function renderBarcodeDataUrlForDiscount(value, opts) {
    if (typeof renderBarcodeDataUrl === 'function') return renderBarcodeDataUrl(value, opts);
    if (typeof JsBarcode === 'undefined') return null;
    try {
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, String(value), Object.assign({
            format: 'CODE128', width: 2, height: 70, displayValue: true, fontSize: 16, margin: 6
        }, opts || {}));
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.warn('バーコード画像の生成に失敗しました:', value, e);
        return null;
    }
}

// 【不具合修正】PDF内の日本語（割引名）が文字化けする問題への対応。
// customer-barcode-pdf-system.js側の addPdfTextCentered（テキストを
// canvasで画像化してから貼り付ける方式）があれば使い回し、無い環境
// （このファイル単体導入時）でも同じ考え方の自前版で描画する。
function addPdfTextCenteredForDiscount(doc, text, centerXmm, centerYmm, opts) {
    if (typeof addPdfTextCentered === 'function') {
        addPdfTextCentered(doc, text, centerXmm, centerYmm, opts);
        return;
    }
    opts = opts || {};
    const fontSizePx = opts.fontSizePx || 40;
    const fontWeight = opts.fontWeight || 'bold';
    const fontFamily = opts.fontFamily || "'Hiragino Sans', 'Yu Gothic', 'Meiryo', 'MS PGothic', sans-serif";
    const color = opts.color || '#111111';
    const paddingPx = opts.paddingPx != null ? opts.paddingPx : 6;
    const heightMm = opts.heightMm || 4.2;
    const str = (text === null || text === undefined) ? '' : String(text);

    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
    const textWidthPx = Math.max(1, Math.ceil(measure.measureText(str).width));
    const textHeightPx = Math.ceil(fontSizePx * 1.3);

    const canvas = document.createElement('canvas');
    canvas.width = textWidthPx + paddingPx * 2;
    canvas.height = textHeightPx + paddingPx * 2;
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(str, paddingPx, canvas.height / 2);

    const aspect = canvas.width / canvas.height;
    const widthMm = heightMm * aspect;
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', centerXmm - widthMm / 2, centerYmm - heightMm / 2, widthMm, heightMm);
}

async function ensureJsPdfAndBarcodeReadyForDiscount() {
    if (typeof ensureJsPdfAndBarcodeReady === 'function') return ensureJsPdfAndBarcodeReady();

    if (typeof ensureBarcodePdfLibrariesLoaded === 'function') {
        await ensureBarcodePdfLibrariesLoaded(2);
    }

    if (typeof JsBarcode === 'undefined' || typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('バーコード/PDF生成ライブラリの読み込みに失敗しました。通信環境をご確認のうえ、ページを再読み込みしてからもう一度お試しください。', 'らいぶらり が よみこま れ て い ませ ん。', () => {}, false);
        } else {
            alert('バーコード/PDF生成ライブラリが読み込まれていません。');
        }
        return false;
    }
    return true;
}

/* =========================================================
   ① 1件分のバーコードPDFを出力する
   ========================================================= */
async function exportSingleDiscountBarcodePdf(disc) {
    if (!disc || !disc.barcode) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('このバーコードには値が登録されていません。', 'ばーこーど が とうろく さ れ て い ませ ん。', () => {}, false);
        }
        return;
    }
    if (!(await ensureJsPdfAndBarcodeReadyForDiscount())) return;

    if (typeof playSound === 'function') playSound('click');

    const dataUrl = renderBarcodeDataUrlForDiscount(disc.barcode, { width: 3, height: 100, fontSize: 20 });
    if (!dataUrl) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [90, 55] }); // 名刺サイズ相当

    const name = discDisplayNameForPdf(disc);
    addPdfTextCenteredForDiscount(doc, name, 45, 12, { heightMm: 4.6 });

    const imgWidth = 70;
    const imgHeight = 28;
    doc.addImage(dataUrl, 'PNG', (90 - imgWidth) / 2, 18, imgWidth, imgHeight);

    const today = new Date().toISOString().slice(0, 10);
    doc.save(`自動化バーコード_${name}_${today}.pdf`);

    if (typeof playSound === 'function') playSound('success');
}

/* =========================================================
   ② 全件分をまとめて1つのPDFに出力する（ラベルシート状に敷き詰める）
   ------------------------------------------
   対象は discount-tbody に表示されているもの＝アーカイブ済み（使用済み）
   を除いた現在有効な自動化バーコードのみ。
   ========================================================= */
async function exportAllDiscountBarcodesPdf() {
    if (!(await ensureJsPdfAndBarcodeReadyForDiscount())) return;

    const list = getDiscountListSafe();
    const targets = list.filter(d => d && d.barcode && !d.archived);
    if (targets.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('PDF出力できる自動化バーコードがありません。', 'ばーこーど が あり ませ ん。', () => {}, false);
        }
        return;
    }

    if (typeof playSound === 'function') playSound('click');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // A4に 3列 x 6行 = 18枚/ページ のラベルとして敷き詰める（会員用・担当者用と同じレイアウト）
    const cols = 3, rows = 6;
    const pageW = 210, pageH = 297;
    const marginX = 8, marginY = 10;
    const cellW = (pageW - marginX * 2) / cols;
    const cellH = (pageH - marginY * 2) / rows;

    targets.forEach((disc, idx) => {
        const perPage = cols * rows;
        const posInPage = idx % perPage;
        if (idx > 0 && posInPage === 0) doc.addPage();

        const col = posInPage % cols;
        const row = Math.floor(posInPage / cols);
        const x = marginX + col * cellW;
        const y = marginY + row * cellH;

        doc.setDrawColor(200);
        doc.rect(x + 1, y + 1, cellW - 2, cellH - 2);

        addPdfTextCenteredForDiscount(doc, discDisplayNameForPdf(disc), x + cellW / 2, y + 8, { heightMm: 3.4 });

        const dataUrl = renderBarcodeDataUrlForDiscount(disc.barcode, { width: 1.4, height: 45, fontSize: 12, margin: 2 });
        if (dataUrl) {
            const imgW = cellW - 8;
            const imgH = cellH - 16;
            doc.addImage(dataUrl, 'PNG', x + 4, y + 11, imgW, imgH);
        }
    });

    const today = new Date().toISOString().slice(0, 10);
    doc.save(`自動化バーコード一括_${today}.pdf`);

    if (typeof playSound === 'function') playSound('success');
}

/* =========================================================
   ③ UI注入：一覧の右上に「一括PDF」ボタン、各行に「PDF」ボタン
   ========================================================= */
function ensureDiscountBarcodePdfBulkButton() {
    if (document.getElementById('discount-barcode-pdf-all-btn')) return;
    const topBar = document.querySelector('#discount-screen .top-bar');
    if (!topBar) return;

    const btn = document.createElement('button');
    btn.id = 'discount-barcode-pdf-all-btn';
    btn.className = 'csv-export-btn';
    btn.innerText = '🖨️ バーコード一括PDF';
    btn.onclick = exportAllDiscountBarcodesPdf;
    btn.style.marginLeft = (topBar.children.length > 2) ? '0' : 'auto';

    topBar.appendChild(btn);
}

function injectDiscountBarcodePdfRowButtons() {
    const tbody = document.getElementById('discount-tbody');
    if (!tbody) return;

    const list = getDiscountListSafe();

    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
        if (tr.querySelector('.discount-barcode-pdf-cell')) return;
        if (tr.children.length === 0) return;

        // 列の位置に依存せず、行内のどのセルでもいいので実際のバーコード値と
        // 完全一致するセルを探す方式にする（他の追加機能ファイルが列を増減
        // させても崩れないように、会員用・担当者用と同じ考え方に揃えてある）。
        const cellTexts = Array.from(tr.children).map(td => (td.textContent || '').trim());
        const matched = list.find(d => d.barcode && !d.archived && cellTexts.includes(d.barcode));
        if (!matched) return;

        const td = document.createElement('td');
        td.className = 'discount-barcode-pdf-cell';

        const btn = document.createElement('button');
        btn.innerText = 'PDF';
        btn.title = 'このバーコードをPDF出力';
        btn.style.cssText = 'padding:4px 10px; font-size:12px; background:#5c6bc0; color:#fff; border:none; border-radius:4px; cursor:pointer;';
        btn.addEventListener('click', () => exportSingleDiscountBarcodePdf(matched));

        td.appendChild(btn);
        tr.appendChild(td);
    });
}

function ensureDiscountBarcodePdfHeaderColumn() {
    const table = document.getElementById('discount-tbody') && document.getElementById('discount-tbody').closest('table');
    if (!table) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow || headRow.querySelector('.discount-barcode-pdf-header')) return;
    const th = document.createElement('th');
    th.className = 'discount-barcode-pdf-header';
    th.innerText = 'バーコードPDF';
    headRow.appendChild(th);
}

(function hookShowScreenForDiscountBarcodePdfBulkButton() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'discount-screen') ensureDiscountBarcodePdfBulkButton();
            return result;
        };
    }
    tryHook();
})();

(function observeDiscountTbodyForBarcodePdf() {
    function trySetup() {
        const tbody = document.getElementById('discount-tbody');
        if (!tbody) {
            setTimeout(trySetup, 300);
            return;
        }
        ensureDiscountBarcodePdfHeaderColumn();
        injectDiscountBarcodePdfRowButtons();
        const observer = new MutationObserver(() => {
            ensureDiscountBarcodePdfHeaderColumn();
            injectDiscountBarcodePdfRowButtons();
        });
        observer.observe(tbody, { childList: true, subtree: true });
    }
    trySetup();
})();
