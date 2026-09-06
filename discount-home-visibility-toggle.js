// ==========================================
// discount-home-visibility-toggle.js
// ------------------------------------------
// 【背景】
// 以前は自動化バーコードごとに「ホームに表示する／しない」を個別に
// 設定できたが、一時期「登録されているものは強制的に全件ホームの
// ブロック一覧に出るようにしたい」という要望で、この個別設定機能は
// 廃止されていた（home-automation-blocks.js側）。
// 今回、この「ホームのブロック一覧に表示しない」個別設定を復活させたい
// という要望のため、あらためて追加する。
//
// 【この機能】
// 自動化バーコード1件ごとに hideFromHome（真偽値）を持たせ、
//   ① 新規登録モーダル／編集モーダルにチェックボックスを追加
//      （「🏠 このバーコードはホームのブロック一覧に表示しない」）
//   ② 自動化バーコード一覧（discount-tbody）の各行にも、開かずに
//      素早く切り替えられるボタン（🏠 表示中 / 🚫 非表示中）を追加
// のどちらからでも切り替えられるようにする。
// hideFromHome が付いた自動化バーコードは、home-automation-blocks.js
// 側の絞り込みでホームのブロック一覧に出なくなる（バーコード自体は
// 今まで通りスキャンで使える。あくまで「ホームの一覧に出すかどうか」だけの設定）。
//
// discount-system.js / index.html は直接編集せず、他の追加機能ファイルと
// 同じ「フック/DOM注入方式」で実現する。
// ==========================================

const DISC_HIDE_FROM_HOME_FIELD = 'hideFromHome';

/* =========================================================
   ① 新規登録モーダル／編集モーダルへのチェックボックス注入
   ========================================================= */
function buildHideFromHomeSectionHtml(prefix) {
    return `
    <div class="discount-form-section" data-hide-from-home-section="${prefix}">
        <label class="discount-step-header discount-step-checkbox-label">
            <input type="checkbox" id="${prefix}-disc-hide-from-home">
            <span class="discount-step-badge">5</span>
            <span>🏠 ホームのブロック一覧に表示しない</span>
            <span class="discount-step-optional">任意</span>
        </label>
        <p class="discount-step-note">チェックすると、ホーム画面を4秒長押しして開くブロック一覧にこのバーコードが出なくなります（バーコード自体は今まで通りスキャンで使えます）。</p>
    </div>`;
}

function injectHideFromHomeCheckboxes() {
    // 新規登録：登録ボタンの直前に差し込む
    if (!document.querySelector('[data-hide-from-home-section="new"]')) {
        const submitBtn = document.querySelector('#discount-screen .discount-submit-btn');
        if (submitBtn) {
            submitBtn.insertAdjacentHTML('beforebegin', buildHideFromHomeSectionHtml('new'));
        }
    }

    // 編集モーダル：ボタン群（キャンセル／保存）の直前に差し込む
    if (!document.querySelector('[data-hide-from-home-section="edit"]')) {
        const btnGroup = document.querySelector('#edit-disc-modal .modal-btn-group');
        if (btnGroup) {
            btnGroup.insertAdjacentHTML('beforebegin', buildHideFromHomeSectionHtml('edit'));
        }
    }
}

(function tryInjectCheckboxes() {
    function attempt() {
        injectHideFromHomeCheckboxes();
        if (!document.querySelector('[data-hide-from-home-section="new"]') || !document.querySelector('[data-hide-from-home-section="edit"]')) {
            setTimeout(attempt, 300);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attempt);
    } else {
        attempt();
    }
})();

/* =========================================================
   ② 新規登録の保存に hideFromHome を含める
   ------------------------------------------
   addDiscountBarcode() 自体は discData をローカル変数として組み立てて
   finalizeAddDiscountBarcode(discData, existingIndex) を呼ぶだけなので、
   この finalizeAddDiscountBarcode をフックし、実際に保存される直前に
   チェックボックスの状態を discData に追加する。
   ========================================================= */
(function hookFinalizeAddForHideFromHome() {
    function tryHook() {
        if (typeof window.finalizeAddDiscountBarcode !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.finalizeAddDiscountBarcode;
        window.finalizeAddDiscountBarcode = function (discData, existingIndex) {
            const cb = document.getElementById('new-disc-hide-from-home');
            if (discData) discData[DISC_HIDE_FROM_HOME_FIELD] = !!(cb && cb.checked);

            const result = original.apply(this, arguments);

            // 他の項目（割引名・数量など）と同じく、登録後はチェックを未チェックに戻す
            if (cb) cb.checked = false;

            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ③ 編集モーダルを開いた時、チェックボックスに現在の値を反映する
   ========================================================= */
(function hookEditDiscountBarcodeForHideFromHome() {
    function tryHook() {
        if (typeof window.editDiscountBarcode !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.editDiscountBarcode;
        window.editDiscountBarcode = function (index) {
            const result = original.apply(this, arguments);
            injectHideFromHomeCheckboxes(); // 万一まだ注入されていない場合の保険
            const disc = (typeof discountBarcodes !== 'undefined') ? discountBarcodes[index] : null;
            const cb = document.getElementById('edit-disc-hide-from-home');
            if (cb) cb.checked = !!(disc && disc[DISC_HIDE_FROM_HOME_FIELD]);
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ④ 編集モーダルの保存時に hideFromHome を反映する
   ------------------------------------------
   saveEditDisc() は discountBarcodes[index] を直接書き換えて
   saveDiscounts() を呼ぶ実装のため、その直前（＝同じオブジェクトに）
   hideFromHome を設定しておけば、saveDiscounts() での保存に含まれる。
   ========================================================= */
(function hookSaveEditDiscForHideFromHome() {
    function tryHook() {
        if (typeof window.saveEditDisc !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.saveEditDisc;
        window.saveEditDisc = function (...args) {
            const modal = document.getElementById('edit-disc-modal');
            const index = modal ? parseInt(modal.dataset.index) : -1;
            const disc = (typeof discountBarcodes !== 'undefined' && index >= 0) ? discountBarcodes[index] : null;
            const cb = document.getElementById('edit-disc-hide-from-home');
            if (disc && cb) disc[DISC_HIDE_FROM_HOME_FIELD] = cb.checked;

            return original.apply(this, args);
        };
    }
    tryHook();
})();

/* =========================================================
   ⑤ 一覧（discount-tbody）の各行にも、開かずに切り替えられる
      🏠ボタンを追加する
   ------------------------------------------
   renderDiscounts() は毎回 discount-tbody をまるごと作り直すため、
   renderDiscounts() 自体をフックし、元の描画が終わった直後に列を追加する。
   行の並び順・インデックスは、renderDiscounts() 内部の絞り込み
   （!disc.archived、discountBarcodes配列の順のまま）と同じ考え方で
   ここでも組み立て直すことで、行とバーコードのインデックスを対応させる。
   ========================================================= */
function ensureHideFromHomeHeaderColumn() {
    const tbody = document.getElementById('discount-tbody');
    const table = tbody && tbody.closest('table');
    if (!table) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow || headRow.querySelector('.discount-hide-from-home-header')) return;
    const th = document.createElement('th');
    th.className = 'discount-hide-from-home-header';
    th.innerText = 'ホーム表示';
    headRow.appendChild(th);
}

function injectHideFromHomeRowButtons() {
    const tbody = document.getElementById('discount-tbody');
    if (!tbody || typeof discountBarcodes === 'undefined') return;

    ensureHideFromHomeHeaderColumn();

    // renderDiscounts() が絞り込んで表示している行（アーカイブされていないもの）と
    // 同じ順番・同じインデックスの組み合わせを再現する
    const activeList = discountBarcodes
        .map((disc, index) => ({ disc, index }))
        .filter(({ disc }) => !disc.archived);

    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length !== activeList.length) return; // 「まだ登録がありません」等のプレースホルダー行の場合は何もしない

    rows.forEach((tr, i) => {
        if (tr.querySelector('.discount-hide-from-home-cell')) return;
        const { disc, index } = activeList[i];

        const td = document.createElement('td');
        td.className = 'discount-hide-from-home-cell';

        const hidden = !!disc[DISC_HIDE_FROM_HOME_FIELD];
        const btn = document.createElement('button');
        btn.className = 'select-btn';
        btn.style.cssText = hidden ? 'background:#9e9e9e;' : 'background:#26a69a;';
        btn.innerText = hidden ? '🚫 非表示中' : '🏠 表示中';
        btn.title = hidden ? 'クリックでホームのブロック一覧に表示する' : 'クリックでホームのブロック一覧から隠す';
        btn.addEventListener('click', () => toggleDiscHideFromHome(index));

        td.appendChild(btn);
        tr.appendChild(td);
    });
}

function toggleDiscHideFromHome(index) {
    const disc = discountBarcodes[index];
    if (!disc) return;
    disc[DISC_HIDE_FROM_HOME_FIELD] = !disc[DISC_HIDE_FROM_HOME_FIELD];
    saveDiscounts();
    if (typeof playSound === 'function') playSound('click');
    renderDiscounts();
    if (typeof renderHomeAutomationBlocksIfVisible === 'function') renderHomeAutomationBlocksIfVisible();
}

(function hookRenderDiscountsForHideFromHomeColumn() {
    function tryHook() {
        if (typeof window.renderDiscounts !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderDiscounts;
        window.renderDiscounts = function (...args) {
            const result = original.apply(this, args);
            injectHideFromHomeRowButtons();
            return result;
        };
    }
    tryHook();
})();
