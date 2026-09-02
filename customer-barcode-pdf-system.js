// ==========================================
// customer-barcode-pdf-system.js
// 会員バーコードのPDF出力（1人ずつ／全員一括）
// ------------------------------------------
// 会員・顧客管理画面(customer-mgmt-screen)の各会員が持つ「会員証バーコード」
// (cust.barcode) を、印刷して会員証として使えるようバーコード画像＋名前入りの
// PDFとして書き出す。
//   ・1人分だけ … 一覧の各行に追加する「PDF」ボタン
//   ・全員まとめて … 画面右上の「🖨️ バーコード一括PDF」ボタン（ラベルシートのように
//     複数人分を1つのPDFに敷き詰める）
//
// バーコード画像の生成には JsBarcode を使う（CODE128形式）。
// index.htmlに以下の読み込みを追加してください（jsPDFの近くでOKです）。
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js"></script>
//
// register.js / ui.js（会員管理の一覧描画本体）には一切手を加えず、
// customer-tbody を MutationObserver で監視してボタンを追加する
// 「フック/DOM注入方式」で実現する。
// ==========================================

/* =========================================================
   ライブラリの自動読み込み・自己修復
   ------------------------------------------
   【不具合修正】店舗のWi-Fi環境などでCDN(cdnjs.cloudflare.com)からの
   JsBarcode / jsPDF の読み込みがまれに失敗し、実際にはただの通信の
   一時的な失敗なだけなのに「ライブラリが読み込まれていません」と
   表示されてボタンが使えなくなってしまうことがあった。
   ページ読み込み後、バックグラウンドで読み込み状況を確認し、
   もし読み込めていなければ別のCDN(jsdelivr)から自動的に再取得を
   試みる。ボタンを押した瞬間にも、その場で最後にもう一度だけ
   読み込みを試みてから、それでもダメな場合にだけエラーを表示する。
   ========================================================= */
function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-autoload-src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === '1') { resolve(); return; }
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('load failed: ' + src)));
            return;
        }
        const s = document.createElement('script');
        s.src = src;
        s.dataset.autoloadSrc = src;
        s.onload = () => { s.dataset.loaded = '1'; resolve(); };
        s.onerror = () => reject(new Error('load failed: ' + src));
        document.head.appendChild(s);
    });
}

function isBarcodePdfLibsReady() {
    return typeof JsBarcode !== 'undefined' &&
        typeof window.jspdf !== 'undefined' &&
        typeof window.jspdf.jsPDF !== 'undefined';
}

async function ensureBarcodePdfLibrariesLoaded(maxAttempts) {
    if (isBarcodePdfLibsReady()) return true;
    maxAttempts = maxAttempts || 3;

    // cdnjsが失敗した場合に備え、別CDN(jsdelivr)もミラーとして順番に試す
    const jsBarcodeMirrors = [
        'https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js',
        'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js'
    ];
    const jsPdfMirrors = [
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
    ];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (typeof JsBarcode === 'undefined') {
            for (const url of jsBarcodeMirrors) {
                try { await loadScriptOnce(url); } catch (e) { /* 次のミラーを試す */ }
                if (typeof JsBarcode !== 'undefined') break;
            }
        }
        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            for (const url of jsPdfMirrors) {
                try { await loadScriptOnce(url); } catch (e) { /* 次のミラーを試す */ }
                if (typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF !== 'undefined') break;
            }
        }
        if (isBarcodePdfLibsReady()) return true;
        await new Promise(r => setTimeout(r, 800));
    }
    return isBarcodePdfLibsReady();
}

// ページ読み込み後、ボタンが押される前にバックグラウンドで一度読み込みを試みておく
if (document.readyState === 'complete') {
    ensureBarcodePdfLibrariesLoaded();
} else {
    window.addEventListener('load', () => ensureBarcodePdfLibrariesLoaded());
}

// バーコード値からPNGのdataURLを作る（オフスクリーンcanvas使用）
function renderBarcodeDataUrl(value, opts) {
    if (typeof JsBarcode === 'undefined') return null;
    try {
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, String(value), Object.assign({
            format: 'CODE128',
            width: 2,
            height: 70,
            displayValue: true,
            fontSize: 16,
            margin: 6
        }, opts || {}));
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.warn('バーコード画像の生成に失敗しました:', value, e);
        return null;
    }
}

async function ensureJsPdfAndBarcodeReady() {
    if (!isBarcodePdfLibsReady()) {
        // 【不具合修正】即座にエラーを出す前に、その場でもう一度だけ読み込みを試みる
        // （バックグラウンド読み込みがまだ間に合っていないだけの場合はこれで解決する）
        await ensureBarcodePdfLibrariesLoaded(2);
    }

    if (typeof JsBarcode === 'undefined') {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('バーコード生成ライブラリ(JsBarcode)の読み込みに失敗しました。通信環境をご確認のうえ、ページを再読み込みしてからもう一度お試しください。', 'らいぶらり が よみこま れ て い ませ ん。', () => {}, false);
        } else {
            alert('バーコード生成ライブラリ(JsBarcode)が読み込まれていません。');
        }
        return false;
    }
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('PDF生成ライブラリ(jsPDF)の読み込みに失敗しました。通信環境をご確認のうえ、ページを再読み込みしてからもう一度お試しください。', 'らいぶらり が よみこま れ て い ませ ん。', () => {}, false);
        } else {
            alert('PDF生成ライブラリ(jsPDF)が読み込まれていません。');
        }
        return false;
    }
    return true;
}

/* =========================================================
   ① 1人分のバーコードPDFを出力する
   ========================================================= */
async function exportSingleCustomerBarcodePdf(cust) {
    if (!cust || !cust.barcode) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('この会員にはバーコードが登録されていません。', 'ばーこーど が とうろく さ れ て い ませ ん。', () => {}, false);
        }
        return;
    }
    if (!(await ensureJsPdfAndBarcodeReady())) return;

    if (typeof playSound === 'function') playSound('click');

    const dataUrl = renderBarcodeDataUrl(cust.barcode, { width: 3, height: 100, fontSize: 20 });
    if (!dataUrl) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [90, 55] }); // 名刺サイズ相当のカード

    const name = getCustomerDisplayNameSafeForPdf(cust);
    doc.setFontSize(12);
    doc.text(name || '会員証', 45, 12, { align: 'center' });

    const imgWidth = 70;
    const imgHeight = 28;
    doc.addImage(dataUrl, 'PNG', (90 - imgWidth) / 2, 18, imgWidth, imgHeight);

    const today = new Date().toISOString().slice(0, 10);
    doc.save(`会員バーコード_${name || cust.barcode}_${today}.pdf`);

    if (typeof playSound === 'function') playSound('success');
}

function getCustomerDisplayNameSafeForPdf(cust) {
    if (typeof getCustomerDisplayNameSafe === 'function') return getCustomerDisplayNameSafe(cust);
    return cust.name || `${cust.lastName || ''} ${cust.firstName || ''}`.trim();
}

/* =========================================================
   ② 全員分をまとめて1つのPDFに出力する（ラベルシート状に敷き詰める）
   ========================================================= */
async function exportAllCustomerBarcodesPdf() {
    if (!(await ensureJsPdfAndBarcodeReady())) return;

    const customerList = (typeof getCustomerListSafe === 'function')
        ? getCustomerListSafe()
        : JSON.parse(localStorage.getItem('pos_customers') || '[]');

    const targets = customerList.filter(c => c && c.barcode);
    if (targets.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('バーコードが登録されている会員がいません。', 'ばーこーど が とうろく さ れ て い る かいいん が い ませ ん。', () => {}, false);
        }
        return;
    }

    if (typeof playSound === 'function') playSound('click');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // A4に 3列 x 6行 = 18枚/ページ のラベルとして敷き詰める
    const cols = 3, rows = 6;
    const pageW = 210, pageH = 297;
    const marginX = 8, marginY = 10;
    const cellW = (pageW - marginX * 2) / cols;
    const cellH = (pageH - marginY * 2) / rows;

    targets.forEach((cust, idx) => {
        const perPage = cols * rows;
        const posInPage = idx % perPage;
        if (idx > 0 && posInPage === 0) doc.addPage();

        const col = posInPage % cols;
        const row = Math.floor(posInPage / cols);
        const x = marginX + col * cellW;
        const y = marginY + row * cellH;

        // 枠線（切り取り線代わり）
        doc.setDrawColor(200);
        doc.rect(x + 1, y + 1, cellW - 2, cellH - 2);

        const name = getCustomerDisplayNameSafeForPdf(cust);
        doc.setFontSize(9);
        doc.text(name || '会員証', x + cellW / 2, y + 8, { align: 'center' });

        const dataUrl = renderBarcodeDataUrl(cust.barcode, { width: 1.4, height: 45, fontSize: 12, margin: 2 });
        if (dataUrl) {
            const imgW = cellW - 8;
            const imgH = cellH - 16;
            doc.addImage(dataUrl, 'PNG', x + 4, y + 11, imgW, imgH);
        }
    });

    const today = new Date().toISOString().slice(0, 10);
    doc.save(`会員バーコード一括_${today}.pdf`);

    if (typeof playSound === 'function') playSound('success');
}

/* =========================================================
   ③ UI注入：一覧の右上に「一括PDF」ボタン、各行に「PDF」ボタン
   ========================================================= */
function ensureCustomerBarcodePdfBulkButton() {
    if (document.getElementById('customer-barcode-pdf-all-btn')) return;
    const topBar = document.querySelector('#customer-mgmt-screen .top-bar');
    if (!topBar) return;

    const btn = document.createElement('button');
    btn.id = 'customer-barcode-pdf-all-btn';
    btn.className = 'csv-export-btn';
    btn.innerText = '🖨️ バーコード一括PDF';
    btn.onclick = exportAllCustomerBarcodesPdf;
    // すでに右上に別のボタン（XLSX出力等）が並んでいる場合はその隣に、
    // 無ければ margin-left:auto で右端に押し出す（読み込み順に依存しないようにする）
    btn.style.marginLeft = (topBar.children.length > 2) ? '0' : 'auto';

    topBar.appendChild(btn);
}

function injectCustomerBarcodePdfRowButtons() {
    const tbody = document.getElementById('customer-tbody');
    if (!tbody) return;

    const customerList = (typeof getCustomerListSafe === 'function')
        ? getCustomerListSafe()
        : JSON.parse(localStorage.getItem('pos_customers') || '[]');

    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
        if (tr.querySelector('.cust-barcode-pdf-cell')) return;
        if (tr.children.length === 0) return;

        // 【不具合修正】以前は「バーコードは1列目」という前提で tr.children[0] を
        // 読んでいたが、member-number-system.js が一覧の先頭に「会員番号」列を
        // 差し込むため列位置がずれ、常に無関係な値を読んでしまい
        // （＝該当会員が見つからず）ボタンが無反応になっていた。
        // 列の位置に依存せず、行内のどのセルでもいいので実際の会員のbarcode値と
        // 完全一致するセルを探す方式にする（他の機能が列を増減させても崩れない）。
        const cellTexts = Array.from(tr.children).map(td => (td.textContent || '').trim());
        const matchedCust = customerList.find(c => c.barcode && cellTexts.includes(c.barcode));
        if (!matchedCust) return;

        const td = document.createElement('td');
        td.className = 'cust-barcode-pdf-cell';

        const btn = document.createElement('button');
        btn.innerText = 'PDF';
        btn.title = 'このバーコードをPDF出力';
        btn.style.cssText = 'padding:4px 10px; font-size:12px; background:#5c6bc0; color:#fff; border:none; border-radius:4px; cursor:pointer;';
        btn.addEventListener('click', () => exportSingleCustomerBarcodePdf(matchedCust));

        td.appendChild(btn);
        tr.appendChild(td);
    });
}

function ensureCustomerBarcodePdfHeaderColumn() {
    const table = document.getElementById('customer-tbody') && document.getElementById('customer-tbody').closest('table');
    if (!table) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow || headRow.querySelector('.cust-barcode-pdf-header')) return;
    const th = document.createElement('th');
    th.className = 'cust-barcode-pdf-header';
    th.innerText = 'バーコードPDF';
    headRow.appendChild(th);
}

(function hookShowScreenForCustomerBarcodePdfBulkButton() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'customer-mgmt-screen') ensureCustomerBarcodePdfBulkButton();
            return result;
        };
    }
    tryHook();
})();

(function observeCustomerTbodyForBarcodePdf() {
    function trySetup() {
        const tbody = document.getElementById('customer-tbody');
        if (!tbody) {
            setTimeout(trySetup, 300);
            return;
        }
        ensureCustomerBarcodePdfHeaderColumn();
        injectCustomerBarcodePdfRowButtons();
        const observer = new MutationObserver(() => {
            ensureCustomerBarcodePdfHeaderColumn();
            injectCustomerBarcodePdfRowButtons();
        });
        observer.observe(tbody, { childList: true, subtree: true });
    }
    trySetup();
})();
