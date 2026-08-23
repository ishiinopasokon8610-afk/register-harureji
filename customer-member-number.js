// ==========================================
// customer-member-number.js
// ------------------------------------------
// 顧客（会員）ひとりひとりに、連番の「会員番号」を自動で発番して付与する機能。
//   ・会員証バーコードとは別に、店舗が独自に管理できる通し番号（No.000001〜）
//   ・一度発番したら customers 配列の各顧客データ（cust.memberNo）に保存される
//     → customers 自体が既存のバックアップ（buildAllDataObject）に含まれているため、
//       この番号も自動的にローカル・Google Driveバックアップの対象になる
//   ・番号を発番するための通し番号カウンター（pos_member_no_counter）だけは
//     auth-system.js の buildAllDataObject / applyImportedDataObject に追加している
//
// 表示箇所：
//   ①「会員・顧客管理」画面の一覧（#customer-tbody）に「会員番号」列を追加
//   ②レジ画面で会員バーコードをスキャンした時の表示（#ac-name）に番号を付記
//   ③客用画面の会員カード（#cm-name）に番号を付記
//
// register.js / index.html は直接編集せず、
//   ・buildMemberSummary()（会員スキャン時に1回だけ呼ばれる）をラップして、
//     ac-name の書き換え＆customerDisplayMemberInfo への番号追加を行う
//   ・updateCustomerDisplay() をラップして、客用画面side の cm-name に番号を追記する
//   ・addCustomer()（存在すれば）をラップして、新規登録時にその場で番号を発番する
//   ・#customer-tbody を MutationObserver で監視し、一覧表示に「会員番号」列を追加する
// という「フック方式」で実現する。
// ==========================================

const CUSTOMER_MEMBER_NO_COUNTER_KEY = 'pos_member_no_counter';

function getNextMemberNo() {
    let counter = parseInt(localStorage.getItem(CUSTOMER_MEMBER_NO_COUNTER_KEY) || '0', 10);
    if (isNaN(counter) || counter < 0) counter = 0;
    counter += 1;
    localStorage.setItem(CUSTOMER_MEMBER_NO_COUNTER_KEY, String(counter));
    return counter;
}

function formatMemberNo(no) {
    if (!no) return '';
    return 'No.' + String(no).padStart(6, '0');
}

// 会員番号が無ければその場で発番して cust に付与する。付与時は customers 配列を保存し、
// 既存のバックアップ（あれば）もその場で走らせる。
function ensureCustomerMemberNo(cust) {
    if (!cust) return null;
    if (!cust.memberNo) {
        cust.memberNo = getNextMemberNo();
        if (typeof customers !== 'undefined' && Array.isArray(customers)) {
            localStorage.setItem('pos_customers', JSON.stringify(customers));
        }
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }
    return cust.memberNo;
}

/* =========================================================
   ①会員バーコード・スキャン時（レジ画面 ac-name／客用画面 cm-name）
   ========================================================= */
(function hookMemberNoIntoBuildMemberSummary() {
    function tryHook() {
        if (typeof buildMemberSummary !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = buildMemberSummary;
        window.buildMemberSummary = function (cust, displayName, rankInfo) {
            const result = original.apply(this, arguments);
            if (cust) {
                const no = ensureCustomerMemberNo(cust);
                if (result) result.memberNo = no;

                // レジ画面側（会員スキャン直後に表示される名前）にも番号を付記する
                const acNameEl = document.getElementById('ac-name');
                if (acNameEl && no) {
                    const name = displayName || cust.name || `${cust.lastName || ''} ${cust.firstName || ''}`.trim();
                    acNameEl.innerText = `${formatMemberNo(no)} ${name}`;
                }
            }
            return result;
        };
    }
    tryHook();
})();

(function hookMemberNoIntoUpdateCustomerDisplay() {
    function tryHook() {
        if (typeof updateCustomerDisplay !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = updateCustomerDisplay;
        window.updateCustomerDisplay = function (...args) {
            const result = original.apply(this, args);
            const nameEl = document.getElementById('cm-name');
            const info = (typeof customerDisplayMemberInfo !== 'undefined') ? customerDisplayMemberInfo : null;
            if (nameEl && info && info.memberNo) {
                nameEl.innerText = `👤 ${formatMemberNo(info.memberNo)} ${info.name || ''} 様`;
            }
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ②新規会員登録時にその場で発番する（addCustomer が存在する場合）
   ========================================================= */
(function hookMemberNoIntoAddCustomer() {
    function tryHook() {
        if (typeof addCustomer !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = addCustomer;
        window.addCustomer = function (...args) {
            const barcodeInput = document.getElementById('new-cust-barcode');
            const barcodeBeforeAdd = barcodeInput ? barcodeInput.value.trim() : '';
            const result = original.apply(this, args);
            if (barcodeBeforeAdd && typeof customers !== 'undefined' && Array.isArray(customers)) {
                const added = customers.find(c => c.barcode === barcodeBeforeAdd);
                if (added) ensureCustomerMemberNo(added);
            }
            renderCustomerMemberNoColumn();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ③「会員・顧客管理」一覧（#customer-tbody）に「会員番号」列を追加する
   ========================================================= */
function ensureCustomerMemberNoHeader() {
    const tbody = document.getElementById('customer-tbody');
    if (!tbody) return;
    const table = tbody.closest('table');
    if (!table) return;
    const headerRow = table.querySelector('thead tr');
    if (!headerRow || headerRow.dataset.memberNoHeaderAdded === 'true') return;

    const th = document.createElement('th');
    th.innerText = '会員番号';
    headerRow.insertBefore(th, headerRow.firstChild);
    headerRow.dataset.memberNoHeaderAdded = 'true';
}

function renderCustomerMemberNoColumn() {
    ensureCustomerMemberNoHeader();

    const tbody = document.getElementById('customer-tbody');
    if (!tbody || typeof customers === 'undefined' || !Array.isArray(customers)) return;

    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
        // すでに番号セルを挿入済みの行はスキップ
        if (row.querySelector('.member-no-cell')) return;

        const firstCell = row.cells[0];
        if (!firstCell) return;
        // 空データ時の案内行（colspanで1セルのみ）は対象外
        if (row.cells.length <= 1) return;

        const barcodeText = firstCell.innerText.trim();
        const cust = customers.find(c => c.barcode === barcodeText);
        if (!cust) return; // 一致する顧客が見つからない行は触らない（安全側）

        const no = ensureCustomerMemberNo(cust);

        const td = document.createElement('td');
        td.className = 'member-no-cell';
        td.style.cssText = 'font-weight:bold; color:#5e35b1; white-space:nowrap;';
        td.innerText = formatMemberNo(no);
        row.insertBefore(td, row.firstChild);
    });
}

(function observeCustomerTbodyForMemberNo() {
    function trySetup() {
        const tbody = document.getElementById('customer-tbody');
        if (!tbody) {
            setTimeout(trySetup, 300);
            return;
        }
        ensureCustomerMemberNoHeader();
        renderCustomerMemberNoColumn();

        const observer = new MutationObserver(() => {
            renderCustomerMemberNoColumn();
        });
        observer.observe(tbody, { childList: true, subtree: false });
    }
    document.addEventListener('DOMContentLoaded', trySetup);
})();
