// ==========================================
// member-number-system.js
// 会員番号機能
// ------------------------------------------
// 既存の「バーコード」（会員証などの物理バーコード）とは別に、
// お客様に分かりやすく伝えられる「会員番号」（例: M000001）を
// 自動採番して各会員に付与する。
//   ・会員登録時に自動的に発行（店員が入力する必要はない）
//   ・会員管理画面の一覧、レジ画面の会員情報、レシートに表示
//   ・レジのJAN入力欄に会員番号を直接入力してもヒットする
//     （物理カードを忘れたお客様に、口頭で番号を伝えてもらう用途）
//
// 【採番の重複防止（複数端末対応）】
// 会員登録は店員が手動で行う低頻度な操作のため、厳密な分散ロックまでは
// 用意せず、以下のシンプルな方式にする:
//   1. 採番カウンター(pos_member_no_counter)を各端末のlocalStorageに保持する
//      （このキー自体はauth-system.jsのバックアップ処理にすでに存在した）
//   2. 新規会員登録時、ローカルのカウンターを+1して採番し、即座にAblyで
//      他端末へ新しいカウンター値をブロードキャストする
//   3. 他端末はカウンターを受信したら「大きい方の値」を採用する
//      （カウンターは常に増加する方向にしか動かさないため、
//        古い情報で上書きされてしまう心配がない）
//   4. 万一ほぼ同時に複数端末で採番されて番号が重複した場合に備え、
//      customer-sync-system.js が会員データをマージした直後に
//      resolveDuplicateMemberNos() を呼び出し、重複を検知して
//      後から発行された側を自動的に採番し直す
//
// master-mgmt.js / register.js は直接編集せず、
//   ・addCustomer() をフックして新規登録時にだけ会員番号を自動付与
//   ・renderCustomers() をフックして一覧に「会員番号」列を追加表示
//   ・generateReceiptHTML() をフックしてレシートに会員番号を追記
//   ・fetchAndAddItem() をフックして会員番号での呼び出しにも対応
// という「フック方式」で実現する。
//
// ※ customer-sync-system.js（会員データそのものの同期）と併せて
//    読み込むこと。customer-sync-system.js が無いと、会員登録した
//    端末以外には会員番号・会員データ自体が反映されない。
// ==========================================

const MEMBER_NO_COUNTER_KEY = 'pos_member_no_counter';
const MEMBER_NO_PREFIX = 'M';
const MEMBER_NO_DIGITS = 6;

function getMemberNoCounter() {
    return parseInt(localStorage.getItem(MEMBER_NO_COUNTER_KEY), 10) || 0;
}

// カウンターは常に増加方向にしか動かさない（他端末からの古い値で巻き戻さない）
function setMemberNoCounter(value, broadcast) {
    if (broadcast === undefined) broadcast = true;
    const current = getMemberNoCounter();
    if (value <= current) return;
    localStorage.setItem(MEMBER_NO_COUNTER_KEY, String(value));
    if (broadcast) broadcastMemberNoCounter(value);
}

function formatMemberNo(n) {
    return MEMBER_NO_PREFIX + String(n).padStart(MEMBER_NO_DIGITS, '0');
}

// 新しい会員番号を1つ発行する（採番と同時にカウンターを進めて他端末へ通知する）
function issueNewMemberNo() {
    const next = getMemberNoCounter() + 1;
    setMemberNoCounter(next, true);
    return formatMemberNo(next);
}

/* =========================================================
   API（Ably）経由でのカウンター同期
   ========================================================= */
function broadcastMemberNoCounter(value) {
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('member-no-counter-sync', {
                counter: value,
                senderId: (typeof SYNC_DEVICE_ID !== 'undefined') ? SYNC_DEVICE_ID : null,
                time: Date.now()
            });
        } catch (err) {
            console.warn('会員番号カウンターの同期送信に失敗しました:', err);
        }
    }
}

(function waitForChannelAndSubscribeMemberNoSync() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('member-no-counter-sync', (msg) => {
            if (msg && msg.data && typeof msg.data.counter === 'number') {
                // 受信した値をそのまま反映する（再送信はしない＝無限ループ防止）
                setMemberNoCounter(msg.data.counter, false);
            }
        });
    } else {
        setTimeout(waitForChannelAndSubscribeMemberNoSync, 500);
    }
})();

/* =========================================================
   既存会員への後付け採番・重複解消
   ========================================================= */

// 会員番号を持っていない既存会員に、まとめて後付けで採番する
// （この機能を導入した直後の移行措置。導入前から登録されていた会員が対象）
function ensureAllCustomersHaveMemberNo() {
    if (typeof customers === 'undefined') return;
    let changed = false;
    customers.forEach(cust => {
        if (!cust.memberNo) {
            cust.memberNo = issueNewMemberNo();
            cust.memberNoIssuedAt = Date.now();
            changed = true;
        }
    });
    if (changed) {
        localStorage.setItem('pos_customers', JSON.stringify(customers));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }
}

// 会員番号の重複を検知し、後から発行された側を採番し直す
// （customer-sync-system.js が他端末のデータをマージした直後に呼び出される）
function resolveDuplicateMemberNos() {
    if (typeof customers === 'undefined') return false;
    const seen = new Map(); // memberNo -> 発行時刻が最も早い顧客のbarcode
    let changed = false;

    // 発行が古い順に見ていき、後から出てきた重複だけを採番し直す
    const sorted = [...customers].sort((a, b) => (a.memberNoIssuedAt || 0) - (b.memberNoIssuedAt || 0));
    sorted.forEach(cust => {
        if (!cust.memberNo) return;
        if (seen.has(cust.memberNo)) {
            cust.memberNo = issueNewMemberNo();
            cust.memberNoIssuedAt = Date.now();
            changed = true;
        } else {
            seen.set(cust.memberNo, cust.barcode);
        }
    });

    if (changed) {
        localStorage.setItem('pos_customers', JSON.stringify(customers));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }
    return changed;
}

/* =========================================================
   フック①：新規会員登録時に会員番号を自動付与する
   ------------------------------------------
   addCustomer()は既存会員の上書き保存にも使われる関数のため、
   フォーム送信前のバーコード入力値をもとに「今回が新規登録だったか」を
   先に判定してから、元の関数を呼び出す。
   ========================================================= */
(function hookMemberNoIntoAddCustomer() {
    function tryHook() {
        if (typeof window.addCustomer !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalAddCustomer = window.addCustomer;
        window.addCustomer = function (...args) {
            const barcodeInput = document.getElementById('new-cust-barcode');
            const barcode = barcodeInput ? barcodeInput.value.trim() : null;
            const isNew = !!barcode && typeof customers !== 'undefined' && !customers.some(c => c.barcode === barcode);

            const result = originalAddCustomer.apply(this, args);

            if (isNew && typeof customers !== 'undefined') {
                const added = customers.find(c => c.barcode === barcode);
                if (added && !added.memberNo) {
                    added.memberNo = issueNewMemberNo();
                    added.memberNoIssuedAt = Date.now();
                    localStorage.setItem('pos_customers', JSON.stringify(customers));
                    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                    if (typeof renderCustomers === 'function') renderCustomers();
                }
            }
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   フック②：会員一覧に「会員番号」列を追加表示する
   ------------------------------------------
   renderCustomers()はtbodyの中身を1から作り直す関数のため、
   実行後にDOM側から1列（先頭）を追加で差し込む。
   ========================================================= */
(function hookMemberNoIntoRenderCustomers() {
    function tryHook() {
        if (typeof window.renderCustomers !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalRenderCustomers = window.renderCustomers;
        window.renderCustomers = function (...args) {
            const result = originalRenderCustomers.apply(this, args);
            injectMemberNoColumn();
            return result;
        };
    }
    tryHook();
})();

function injectMemberNoColumn() {
    const tbody = document.getElementById('customer-tbody');
    if (!tbody || typeof customers === 'undefined') return;

    // ヘッダーに「会員番号」列が無ければ先頭に追加する
    const table = tbody.closest('table');
    const headerRow = table ? table.querySelector('thead tr') : null;
    if (headerRow && !headerRow.querySelector('.member-no-header')) {
        const th = document.createElement('th');
        th.className = 'member-no-header';
        th.innerText = '会員番号';
        headerRow.insertBefore(th, headerRow.firstChild);
    }

    Array.from(tbody.children).forEach((tr, i) => {
        if (tr.querySelector('td[colspan]')) return; // プレースホルダー行はスキップ
        if (tr.querySelector('.member-no-cell')) return; // すでに追加済み
        const cust = customers[i];
        if (!cust) return;
        const td = document.createElement('td');
        td.className = 'member-no-cell';
        td.style.cssText = 'font-family:monospace; font-weight:bold; color:#6a1b9a; white-space:nowrap;';
        td.innerText = cust.memberNo || '(未採番)';
        tr.insertBefore(td, tr.firstChild);
    });
}

/* =========================================================
   フック③：レシートに会員番号を印字する
   ========================================================= */
(function hookMemberNoIntoReceipt() {
    function tryHook() {
        if (typeof window.generateReceiptHTML !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.generateReceiptHTML;
        window.generateReceiptHTML = function (...args) {
            const result = original.apply(this, args);
            appendMemberNoToReceipt();
            return result;
        };
    }
    tryHook();
})();

function appendMemberNoToReceipt() {
    if (typeof activeCustomer === 'undefined' || !activeCustomer || !activeCustomer.memberNo) return;
    const content = document.getElementById('print-receipt-content');
    if (!content) return;

    // 「会員: 〇〇 様」の行を探し、その直後に会員番号の行を差し込む
    const rows = Array.from(content.children);
    const memberRow = rows.find(el => el.textContent && el.textContent.indexOf('会員:') === 0);
    if (!memberRow) return;
    if (memberRow.nextElementSibling && memberRow.nextElementSibling.id === 'receipt-member-no-row') return;

    const div = document.createElement('div');
    div.id = 'receipt-member-no-row';
    div.style.fontSize = '12px';
    div.innerText = `会員番号: ${activeCustomer.memberNo}`;
    memberRow.insertAdjacentElement('afterend', div);
}

/* =========================================================
   フック④：JAN入力欄に会員番号を直接入力しても会員を呼び出せるようにする
   ------------------------------------------
   discount-system.js が fetchAndAddItem() をすでにラップしているため、
   最終的な呼び出し順は index.html の <script> 読み込み順に依存するが、
   どちらが先でも「該当しなければ次に回す」方式のため問題なく共存する。
   ========================================================= */
(function hookMemberNoIntoFetchAndAddItem() {
    function tryHook() {
        if (typeof window.fetchAndAddItem !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalFetchAndAddItem = window.fetchAndAddItem;
        window.fetchAndAddItem = async function (code) {
            if (typeof customers !== 'undefined') {
                const foundByMemberNo = customers.find(c => c.memberNo === code);
                if (foundByMemberNo) {
                    return originalFetchAndAddItem(foundByMemberNo.barcode);
                }
            }
            return originalFetchAndAddItem(code);
        };
    }
    tryHook();
})();

/* =========================================================
   初期化：既存会員への後付け採番
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
    (function tryInit() {
        if (typeof customers === 'undefined') {
            setTimeout(tryInit, 300);
            return;
        }
        ensureAllCustomersHaveMemberNo();
    })();
});
