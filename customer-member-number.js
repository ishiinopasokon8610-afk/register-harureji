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
//   ①「会員・顧客管理」画面の一覧（#customer-tbody）で、バーコード欄に番号を併記
//   ②レジ画面で会員バーコードをスキャンした時の表示（#ac-name）に番号を付記
//   ③客用画面の会員カード（#cm-name）に番号を付記
//
// register.js / index.html は直接編集せず、
//   ・buildMemberSummary()（会員スキャン時に1回だけ呼ばれる）をラップして、
//     ac-name の書き換え＆customerDisplayMemberInfo への番号追加を行う
//   ・updateCustomerDisplay() をラップして、客用画面side の cm-name に番号を追記する
//   ・addCustomer()（存在すれば）をラップして、新規登録時にその場で番号を発番する
//   ・#customer-tbody を MutationObserver で監視し、一覧の該当セルに番号を書き足す
// という「フック方式」で実現する。
//
// 【2026-09 不具合修正・その後の方針転換】
// 以前は「会員番号」という新しい列（<th>/<td>）そのものを一覧に追加していた。
// 最初は先頭に追加していたため、他の列（バーコード等）の位置がずれ、行内の
// 1列目を見て会員を特定する処理（一覧の「変更」ボタン等）が該当会員を見つけ
// られず反応しなくなる不具合が起きた。列を末尾に追加する方式に直したが、
// 今度は「末尾＝操作ボタン列」という別の前提を壊しかねない、根本的に同じ
// 種類の不具合（列位置に依存する既存コードとの衝突）を再発させるリスクが
// 残っていた。
// そのため今回、そもそも列（<th>/<td>）を増やすのをやめ、既存の「バーコード」
// セルの中に番号をそのまま書き足す方式に変更した。これなら表の列数・列の
// 並び順は一切変化しないため、変更／削除ボタンなど他の場所のコードが列位置
// を前提にしていても絶対に影響しない。
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
   ③「会員・顧客管理」一覧（#customer-tbody）のバーコードセルに
      番号を書き足す（＝新しい列は増やさない）
   ------------------------------------------
   【方針】
   行の中から「顧客のバーコードと完全一致するセル」を探し（列の位置に
   依存しないので、他の機能が列を増減させても崩れない）、そのセルの
   末尾に会員番号のバッジを追記するだけにする。<tr>のセル数（<td>の数）
   自体は一切変えないため、「変更」ボタンなど他のコードが列の並び順・
   列数に依存していても絶対に影響しない。
   ========================================================= */
function renderCustomerMemberNoColumn() {
    const tbody = document.getElementById('customer-tbody');
    if (!tbody || typeof customers === 'undefined' || !Array.isArray(customers)) return;

    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
        // 空データ時の案内行（colspanで1セルのみ）は対象外
        if (row.cells.length <= 1) return;
        // すでにバッジを書き足し済みの行はスキップ（番号は一度発番したら変わらないため）
        if (row.querySelector('.member-no-badge')) return;

        // 行内のどのセルでもいいので、実際のバーコード値と完全一致する
        // セル（＝バーコード欄）を探す。
        let barcodeCell = null;
        let cust = null;
        for (const td of row.cells) {
            const text = (td.innerText || td.textContent || '').trim();
            if (!text) continue;
            const found = customers.find(c => c.barcode && c.barcode === text);
            if (found) { barcodeCell = td; cust = found; break; }
        }
        if (!barcodeCell || !cust) return; // 一致する顧客が見つからない行は触らない（安全側）

        const no = ensureCustomerMemberNo(cust);

        // すでにバッジを書き足し済みなら、内容だけ更新する
        let badge = barcodeCell.querySelector('.member-no-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'member-no-badge';
            badge.style.cssText = 'font-size:11px; font-weight:bold; color:#5e35b1; margin-top:2px; white-space:nowrap;';
            barcodeCell.appendChild(badge);
        }
        badge.textContent = formatMemberNo(no);
    });
}

(function observeCustomerTbodyForMemberNo() {
    function trySetup() {
        const tbody = document.getElementById('customer-tbody');
        if (!tbody) {
            setTimeout(trySetup, 300);
            return;
        }
        renderCustomerMemberNoColumn();

        const observer = new MutationObserver(() => {
            renderCustomerMemberNoColumn();
        });
        observer.observe(tbody, { childList: true, subtree: false });
    }
    document.addEventListener('DOMContentLoaded', trySetup);
})();
