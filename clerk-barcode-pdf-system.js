// ==========================================
// clerk-barcode-pdf-system.js
// 担当者バーコードのPDF出力（1人ずつ／全員一括）
// ------------------------------------------
// 担当者管理画面(clerk-screen)の各担当者が持つ「店員用バーコード」
// (clerk.barcode) を、印刷して使えるようバーコード画像＋名前入りの
// PDFとして書き出す。customer-barcode-pdf-system.js（会員用）と同じ考え方・
// 同じライブラリ（JsBarcode + jsPDF）を使う独立機能。
//   ・1人分だけ … 一覧の各行に追加する「PDF」ボタン
//   ・全員まとめて … 画面右上の「🖨️ バーコード一括PDF」ボタン
//     （A4にラベルシートのように複数人分を敷き詰める）
//
// register.js / ui.js（担当者管理の一覧描画本体）には一切手を加えず、
// clerk-tbody を MutationObserver で監視してボタンを追加する
// 「フック/DOM注入方式」で実現する。
//
// ※ バーコード画像生成・PDF生成のライブラリ（JsBarcode / jsPDF）は
//   customer-barcode-pdf-system.js 側ですでに読み込み指示済みのため、
//   index.htmlへの追加は不要です（このファイルの<script>だけ足してください）。
// ==========================================

function getClerkListSafe() {
    try {
        if (typeof clerks !== 'undefined' && Array.isArray(clerks)) return clerks;
        return JSON.parse(localStorage.getItem('pos_clerks') || '[]');
    } catch (e) {
        return [];
    }
}

// customer-barcode-pdf-system.js が既に定義していれば使い回し、
// 無い環境（このファイル単体導入時）でも動くよう、無ければ自前で用意する
function renderBarcodeDataUrlForClerk(value, opts) {
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

async function ensureJsPdfAndBarcodeReadyForClerk() {
    // customer-barcode-pdf-system.js側の判定・自動読み込み再試行ロジックがあればそれを使い回す
    if (typeof ensureJsPdfAndBarcodeReady === 'function') return ensureJsPdfAndBarcodeReady();

    // 【不具合修正】customer-barcode-pdf-system.js が無い単体導入時も、
    // 即座にエラーを出す前にその場で読み込みを試みる（別CDNへのフォールバックも行う）
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
   ① 1人分のバーコードPDFを出力する
   ========================================================= */
async function exportSingleClerkBarcodePdf(clerk) {
    if (!clerk || !clerk.barcode) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('この担当者にはバーコードが登録されていません。', 'ばーこーど が とうろく さ れ て い ませ ん。', () => {}, false);
        }
        return;
    }
    if (!(await ensureJsPdfAndBarcodeReadyForClerk())) return;

    if (typeof playSound === 'function') playSound('click');

    const dataUrl = renderBarcodeDataUrlForClerk(clerk.barcode, { width: 3, height: 100, fontSize: 20 });
    if (!dataUrl) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [90, 55] }); // 名刺サイズ相当

    const name = clerk.name || '担当者';
    doc.setFontSize(12);
    doc.text(name, 45, 12, { align: 'center' });

    const imgWidth = 70;
    const imgHeight = 28;
    doc.addImage(dataUrl, 'PNG', (90 - imgWidth) / 2, 18, imgWidth, imgHeight);

    const today = new Date().toISOString().slice(0, 10);
    doc.save(`担当者バーコード_${name}_${today}.pdf`);

    if (typeof playSound === 'function') playSound('success');
}

/* =========================================================
   ② 全員分をまとめて1つのPDFに出力する（ラベルシート状に敷き詰める）
   ========================================================= */
async function exportAllClerkBarcodesPdf() {
    if (!(await ensureJsPdfAndBarcodeReadyForClerk())) return;

    const clerkList = getClerkListSafe();
    const targets = clerkList.filter(c => c && c.barcode);
    if (targets.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('バーコードが登録されている担当者がいません。', 'ばーこーど が とうろく さ れ て い る たんとうしゃ が い ませ ん。', () => {}, false);
        }
        return;
    }

    if (typeof playSound === 'function') playSound('click');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // A4に 3列 x 6行 = 18枚/ページ のラベルとして敷き詰める（会員用と同じレイアウト）
    const cols = 3, rows = 6;
    const pageW = 210, pageH = 297;
    const marginX = 8, marginY = 10;
    const cellW = (pageW - marginX * 2) / cols;
    const cellH = (pageH - marginY * 2) / rows;

    targets.forEach((clerk, idx) => {
        const perPage = cols * rows;
        const posInPage = idx % perPage;
        if (idx > 0 && posInPage === 0) doc.addPage();

        const col = posInPage % cols;
        const row = Math.floor(posInPage / cols);
        const x = marginX + col * cellW;
        const y = marginY + row * cellH;

        doc.setDrawColor(200);
        doc.rect(x + 1, y + 1, cellW - 2, cellH - 2);

        doc.setFontSize(9);
        doc.text(clerk.name || '担当者', x + cellW / 2, y + 8, { align: 'center' });

        const dataUrl = renderBarcodeDataUrlForClerk(clerk.barcode, { width: 1.4, height: 45, fontSize: 12, margin: 2 });
        if (dataUrl) {
            const imgW = cellW - 8;
            const imgH = cellH - 16;
            doc.addImage(dataUrl, 'PNG', x + 4, y + 11, imgW, imgH);
        }
    });

    const today = new Date().toISOString().slice(0, 10);
    doc.save(`担当者バーコード一括_${today}.pdf`);

    if (typeof playSound === 'function') playSound('success');
}

/* =========================================================
   ③ UI注入：一覧の右上に「一括PDF」ボタン、各行に「PDF」ボタン
   ========================================================= */
function ensureClerkBarcodePdfBulkButton() {
    if (document.getElementById('clerk-barcode-pdf-all-btn')) return;
    const topBar = document.querySelector('#clerk-screen .top-bar');
    if (!topBar) return;

    const btn = document.createElement('button');
    btn.id = 'clerk-barcode-pdf-all-btn';
    btn.className = 'csv-export-btn';
    btn.innerText = '🖨️ バーコード一括PDF';
    btn.onclick = exportAllClerkBarcodesPdf;
    btn.style.marginLeft = (topBar.children.length > 2) ? '0' : 'auto';

    topBar.appendChild(btn);
}

function injectClerkBarcodePdfRowButtons() {
    const tbody = document.getElementById('clerk-tbody');
    if (!tbody) return;

    const clerkList = getClerkListSafe();

    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
        if (tr.querySelector('.clerk-barcode-pdf-cell')) return;
        if (tr.children.length === 0) return;

        // 列の位置に依存せず、行内のどのセルでもいいので実際の担当者のbarcode値と
        // 完全一致するセルを探す方式にする（他の機能が列を増減させても崩れないように、
        // customer-barcode-pdf-system.jsと同じ考え方に揃えてある）。
        const cellTexts = Array.from(tr.children).map(td => (td.textContent || '').trim());
        const matchedClerk = clerkList.find(c => c.barcode && cellTexts.includes(c.barcode));
        if (!matchedClerk) return;

        const td = document.createElement('td');
        td.className = 'clerk-barcode-pdf-cell';

        const btn = document.createElement('button');
        btn.innerText = 'PDF';
        btn.title = 'このバーコードをPDF出力';
        btn.style.cssText = 'padding:4px 10px; font-size:12px; background:#5c6bc0; color:#fff; border:none; border-radius:4px; cursor:pointer;';
        btn.addEventListener('click', () => exportSingleClerkBarcodePdf(matchedClerk));

        td.appendChild(btn);
        tr.appendChild(td);
    });
}

function ensureClerkBarcodePdfHeaderColumn() {
    const table = document.getElementById('clerk-tbody') && document.getElementById('clerk-tbody').closest('table');
    if (!table) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow || headRow.querySelector('.clerk-barcode-pdf-header')) return;
    const th = document.createElement('th');
    th.className = 'clerk-barcode-pdf-header';
    th.innerText = 'バーコードPDF';
    headRow.appendChild(th);
}

(function hookShowScreenForClerkBarcodePdfBulkButton() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'clerk-screen') ensureClerkBarcodePdfBulkButton();
            return result;
        };
    }
    tryHook();
})();

(function observeClerkTbodyForBarcodePdf() {
    function trySetup() {
        const tbody = document.getElementById('clerk-tbody');
        if (!tbody) {
            setTimeout(trySetup, 300);
            return;
        }
        ensureClerkBarcodePdfHeaderColumn();
        injectClerkBarcodePdfRowButtons();
        const observer = new MutationObserver(() => {
            ensureClerkBarcodePdfHeaderColumn();
            injectClerkBarcodePdfRowButtons();
        });
        observer.observe(tbody, { childList: true, subtree: true });
    }
    trySetup();
})();
