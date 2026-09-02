// ==========================================
// product-export-system.js
// 商品管理画面の「XLSX出力」機能
// ------------------------------------------
// タイムカード管理画面にすでにある「XLSX出力」ボタン
// (timecard-export-system.js の exportTimecardXlsx()) と同じ考え方で、
// 商品管理画面（pos_products）の内容も実ファイル（.xlsx）として
// 書き出せるようにする。バックアップ・棚卸し・他店舗との共有・
// 表計算ソフトでの一括確認などに使える。
//
// すでに読み込まれているSheetJS（XLSX.utils / XLSX.writeFile）を利用する。
// register.js / ui.js（商品管理の追加・編集・削除ロジック本体）には
// 一切手を加えず、pos_products を読み取るだけの独立機能として実装する。
//
// index.htmlの商品管理画面（product-screen）に、以下のボタンを
// 追加してください（タイムカード画面の書き方と同じ形です）。
//   <button class="csv-export-btn" onclick="exportProductsXlsx()">XLSX出力</button>
// ==========================================

function getProductListSafe() {
    try {
        // 実行中のページであれば、localStorageより先に最新のグローバル変数を優先する
        if (typeof products !== 'undefined' && Array.isArray(products)) return products;
        return JSON.parse(localStorage.getItem('pos_products') || '[]');
    } catch (e) {
        return [];
    }
}

function exportProductsXlsx() {
    if (typeof playSound === 'function') playSound('click');

    if (typeof XLSX === 'undefined') {
        console.warn('SheetJS(XLSX)が読み込まれていないため、商品を書き出せません。');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出し機能の読み込みに失敗しました。ページを再読み込みしてからもう一度お試しください。', 'しょだし きのう の よみこみ に しっぱい し まし た。', () => {}, false);
        }
        return;
    }

    const productList = getProductListSafe();
    if (productList.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('登録されている商品がまだありません。', 'とうろく さ れ て い る しょうひん が あり ませ ん。', () => {}, false);
        }
        return;
    }

    // ジャンル→JANコードの順に並べ替えて書き出す（棚卸し等で見やすくするため）
    const sorted = [...productList].sort((a, b) => {
        const ag = a.genre || 'その他商品';
        const bg = b.genre || 'その他商品';
        if (ag !== bg) return ag < bg ? -1 : 1;
        return (a.jan || '').localeCompare(b.jan || '');
    });

    const rows = sorted.map(p => ({
        'JANコード': p.jan || '',
        '商品名': p.name || '',
        'ジャンル': p.genre || 'その他商品',
        '価格(税込)': p.price !== undefined ? p.price : '',
        '税率(%)': p.taxRate !== undefined ? p.taxRate : '',
        '年齢確認': p.ageCheck ? '要' : '',
        '詐欺注意表示': p.fraudCheck ? '表示' : ''
    }));

    try {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet['!cols'] = [
            { wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '商品一覧');

        const today = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(workbook, `商品一覧_${today}.xlsx`);

        if (typeof speak === 'function') speak('しょうひん いちらん を しょだし し まし た');
        if (typeof playSound === 'function') playSound('success');
    } catch (err) {
        console.warn('商品のXLSX書き出しに失敗しました:', err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出しに失敗しました。', 'しょだし に しっぱい し まし た。', () => {}, false);
        }
    }
}

/* =========================================================
   商品管理画面(product-screen)を開いた時、ボタンが無ければ自動で追加する
   ------------------------------------------
   index.htmlに手動でボタンを追加しなくても動くよう、念のため
   showScreen()をフックしてボタンを自動注入する（無ければ追加、
   すでに手動で追加済みならそちらを使うので何もしない）。
   ========================================================= */
function ensureProductExportButton() {
    if (document.getElementById('product-export-btn')) return;
    const topBar = document.querySelector('#product-screen .top-bar');
    if (!topBar) return;

    const btn = document.createElement('button');
    btn.id = 'product-export-btn';
    btn.className = 'csv-export-btn';
    btn.innerText = '📊 XLSX出力';
    btn.onclick = exportProductsXlsx;
    // top-bar は左寄せのflexなので、margin-left:auto で右端に押し出す
    btn.style.marginLeft = 'auto';

    topBar.appendChild(btn);
}

(function hookShowScreenForProductExportButton() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'product-screen') ensureProductExportButton();
            return result;
        };
    }
    tryHook();
})();
