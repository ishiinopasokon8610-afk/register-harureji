// ==========================================
// customer-export-system.js
// 会員・顧客管理画面の「XLSX出力」機能
// ------------------------------------------
// 商品管理・タイムカード管理にすでにあるXLSX出力と同じ考え方で、
// 会員・顧客管理（pos_customers）の内容も実ファイル（.xlsx）として
// 書き出せるようにする。
//
// すでに読み込まれているSheetJS（XLSX.utils / XLSX.writeFile）を利用する。
// register.js / ui.js（会員の追加・編集・削除ロジック本体）には
// 一切手を加えず、pos_customers を読み取るだけの独立機能として実装する。
//
// 【会員ランクについて】
// 会員ランクは member-rank.js（今回は未共有）が計算しているため、
// このファイルだけではランクの正確な計算方法が分からない。
// そのため、ランクを判定する関数（getMemberRank / calculateMemberRank 等）が
// 見つかった場合のみ利用し、無ければランク欄は空欄にする（誤った値を
// 書き出さないため）。
// ==========================================

function getCustomerListSafe() {
    try {
        if (typeof customers !== 'undefined' && Array.isArray(customers)) return customers;
        return JSON.parse(localStorage.getItem('pos_customers') || '[]');
    } catch (e) {
        return [];
    }
}

function getCustomerDisplayNameSafe(cust) {
    return cust.name || `${cust.lastName || ''} ${cust.firstName || ''}`.trim();
}

function getCustomerKanaSafe(cust) {
    return `${cust.lastKana || ''} ${cust.firstKana || ''}`.trim();
}

// member-rank.js の関数名が分からないため、いくつかの候補名を安全に試す
function getCustomerRankSafe(cust) {
    const candidates = ['getMemberRank', 'calculateMemberRank', 'getCustomerRank', 'getMemberRankLabel'];
    for (const fnName of candidates) {
        if (typeof window[fnName] === 'function') {
            try {
                const result = window[fnName](cust);
                if (typeof result === 'string') return result;
                if (result && typeof result.label === 'string') return result.label;
                if (result && typeof result.name === 'string') return result.name;
            } catch (e) { /* 次の候補を試す */ }
        }
    }
    return '';
}

function getPointExpiryLabelSafe(cust) {
    if (!cust.pointsUpdatedAt || !cust.points || cust.points <= 0) return '';
    const updatedAt = new Date(cust.pointsUpdatedAt).getTime();
    if (isNaN(updatedAt)) return '';
    const expiry = new Date(updatedAt + 365 * 24 * 60 * 60 * 1000);
    return expiry.toLocaleDateString('ja-JP');
}

function exportCustomersXlsx() {
    if (typeof playSound === 'function') playSound('click');

    if (typeof XLSX === 'undefined') {
        console.warn('SheetJS(XLSX)が読み込まれていないため、会員情報を書き出せません。');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出し機能の読み込みに失敗しました。ページを再読み込みしてからもう一度お試しください。', 'しょだし きのう の よみこみ に しっぱい し まし た。', () => {}, false);
        }
        return;
    }

    const customerList = getCustomerListSafe();
    if (customerList.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('登録されている会員がまだいません。', 'とうろく さ れ て い る かいいん が い ませ ん。', () => {}, false);
        }
        return;
    }

    // フリガナ順（五十音）に並べ替えて書き出す
    const sorted = [...customerList].sort((a, b) => {
        return getCustomerKanaSafe(a).localeCompare(getCustomerKanaSafe(b), 'ja');
    });

    const rows = sorted.map(cust => ({
        'バーコード': cust.barcode || '',
        'お名前': getCustomerDisplayNameSafe(cust),
        'フリガナ': getCustomerKanaSafe(cust),
        '生年月日': cust.birthday || '',
        '年齢': (typeof calculateAge === 'function') ? calculateAge(cust) : (cust.age !== undefined ? cust.age : ''),
        '会員ランク': getCustomerRankSafe(cust),
        '保有ポイント': cust.points !== undefined ? cust.points : 0,
        'ポイント有効期限': getPointExpiryLabelSafe(cust),
        '電話番号': cust.phone || '',
        '住所': cust.address || ''
    }));

    try {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet['!cols'] = [
            { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 6 },
            { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 24 }
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '会員一覧');

        const today = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(workbook, `会員一覧_${today}.xlsx`);

        if (typeof speak === 'function') speak('かいいん いちらん を しょだし し まし た');
        if (typeof playSound === 'function') playSound('success');
    } catch (err) {
        console.warn('会員情報のXLSX書き出しに失敗しました:', err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出しに失敗しました。', 'しょだし に しっぱい し まし た。', () => {}, false);
        }
    }
}

/* =========================================================
   会員・顧客管理画面(customer-mgmt-screen)を開いた時、
   タイトル行の右上にボタンが無ければ自動で追加する
   ========================================================= */
function ensureCustomerExportButton() {
    if (document.getElementById('customer-export-btn')) return;
    const topBar = document.querySelector('#customer-mgmt-screen .top-bar');
    if (!topBar) return;

    const btn = document.createElement('button');
    btn.id = 'customer-export-btn';
    btn.className = 'csv-export-btn';
    btn.innerText = '📊 XLSX出力';
    btn.onclick = exportCustomersXlsx;
    // すでに右上に別のボタン（一括PDF等）が並んでいる場合はその隣に、
    // 無ければ margin-left:auto で右端に押し出す（読み込み順に依存しないようにする）
    btn.style.marginLeft = (topBar.children.length > 2) ? '0' : 'auto';

    topBar.appendChild(btn);
}

(function hookShowScreenForCustomerExportButton() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'customer-mgmt-screen') ensureCustomerExportButton();
            return result;
        };
    }
    tryHook();
})();
