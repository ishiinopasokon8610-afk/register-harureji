// ==========================================
// clerk-wage-system.js
// ------------------------------------------
// 【背景】
// タイムカードのXLSX書き出しに「給料」を反映してほしいという要望があったが、
// これまで担当者(clerks)には時給の項目が存在しなかった。
//
// 【この機能】
// ・担当者管理画面(clerk-screen)の追加フォームに「時給(円)」欄を追加する。
// ・すでに登録されている担当者の行にも、時給を後から入力・編集できる
//   欄を追加する(担当者名ごとに保存)。
// ・時給は clerkName をキーに localStorage(pos_clerk_wages)へ保存する。
//   ※ clerks 配列そのもの(pos_clerks等)は直接編集せず、
//     完全に独立したデータとして持つ(他の追加機能ファイルと同じ考え方)。
//
// index.html / ui.js(担当者管理のレンダリング本体)は直接編集せず、
// ①追加フォームは showScreen('clerk-screen') をフックしてDOM注入、
// ②既存行への時給欄は clerk-tbody の MutationObserver で都度注入、
// ③addClerk() をフックして、追加と同時に入力した時給を保存する。
// という「フック/DOM注入方式」で実現する。
// ==========================================

const CLERK_WAGE_STORAGE_KEY = 'pos_clerk_wages';

function getClerkWageMap() {
    try {
        return JSON.parse(localStorage.getItem(CLERK_WAGE_STORAGE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function saveClerkWageMap(map) {
    localStorage.setItem(CLERK_WAGE_STORAGE_KEY, JSON.stringify(map));
}

function getClerkWage(clerkName) {
    const map = getClerkWageMap();
    const v = map[clerkName];
    return (typeof v === 'number' && v > 0) ? v : 0;
}

function setClerkWage(clerkName, wage) {
    if (!clerkName) return;
    const map = getClerkWageMap();
    const n = Number(wage);
    if (!n || n <= 0) {
        delete map[clerkName];
    } else {
        map[clerkName] = n;
    }
    saveClerkWageMap(map);
}

/* =========================================================
   ① 担当者追加フォームに「時給」入力欄を追加する
   ========================================================= */
function ensureClerkWageInputField() {
    if (document.getElementById('new-clerk-wage')) return;
    const nameInput = document.getElementById('new-clerk-name');
    const form = document.getElementById('new-clerk-barcode') && document.getElementById('new-clerk-barcode').parentElement;
    if (!nameInput || !form) return;

    const wageInput = document.createElement('input');
    wageInput.type = 'number';
    wageInput.id = 'new-clerk-wage';
    wageInput.placeholder = '時給(円・任意)';
    wageInput.className = 'input-clerk-age';
    wageInput.min = '0';
    wageInput.step = '1';

    // 「追加」ボタンの直前に挿入する
    const addBtn = form.querySelector('button[onclick="addClerk()"]');
    if (addBtn) {
        form.insertBefore(wageInput, addBtn);
    } else {
        form.appendChild(wageInput);
    }
}

(function hookShowScreenForClerkWageForm() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'clerk-screen') ensureClerkWageInputField();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ② addClerk() をラップし、入力した時給を保存する
   ------------------------------------------
   addClerk() 自体の実装(担当者名の取得やバリデーション)には触れず、
   実行後に「新しく登録されたであろう担当者名」に対して時給を紐付ける。
   直前に #new-clerk-name に入っていた値を実行前に控えておくことで、
   addClerk() がフォームをクリアした後でも名前を特定できるようにする。
   ========================================================= */
(function hookAddClerkForWage() {
    function tryHook() {
        if (typeof window.addClerk !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.addClerk;
        window.addClerk = function (...args) {
            const nameInput = document.getElementById('new-clerk-name');
            const wageInput = document.getElementById('new-clerk-wage');
            const enteredName = nameInput ? nameInput.value.trim() : '';
            const enteredWage = wageInput ? wageInput.value : '';

            const result = original.apply(this, args);

            if (enteredName && enteredWage) {
                setClerkWage(enteredName, enteredWage);
            }
            if (wageInput) wageInput.value = '';

            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ③ 既存の担当者一覧(clerk-tbody)の各行にも、時給の編集欄を追加する
   ------------------------------------------
   renderClerks() 等の内部関数名が分からなくても対応できるよう、
   MutationObserver で clerk-tbody の再描画を検知し、都度末尾へ
   時給セルを追加する(何度呼ばれても重複しないようガードする)。
   ========================================================= */
function injectClerkWageCells() {
    const tbody = document.getElementById('clerk-tbody');
    if (!tbody) return;

    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
        if (tr.querySelector('.clerk-wage-cell')) return;
        if (tr.children.length === 0) return; // 「登録がありません」等の行

        // 「店員名 / フリガナ (年齢)」列からテキストで店員名を取得する
        const nameCell = tr.children[2];
        if (!nameCell) return;
        const nameMatch = (nameCell.textContent || '').trim();
        const clerkName = nameMatch.split(/[\s／/]/)[0].replace(/\(.*\)$/, '').trim();
        if (!clerkName) return;

        const td = document.createElement('td');
        td.className = 'clerk-wage-cell';
        td.style.whiteSpace = 'nowrap';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.style.width = '80px';
        input.placeholder = '時給';
        input.value = getClerkWage(clerkName) || '';
        input.title = `${clerkName} さんの時給(円)`;
        input.addEventListener('change', () => {
            setClerkWage(clerkName, input.value);
            if (typeof playSound === 'function') playSound('click');
        });

        const label = document.createElement('span');
        label.style.cssText = 'font-size:11px; color:#666; display:block;';
        label.innerText = '時給(円)';

        td.appendChild(label);
        td.appendChild(input);
        tr.appendChild(td);
    });
}

// 見出し行にも「時給」列を一度だけ足しておく
function ensureClerkWageHeaderColumn() {
    const table = document.getElementById('clerk-tbody') && document.getElementById('clerk-tbody').closest('table');
    if (!table) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow || headRow.querySelector('.clerk-wage-header')) return;
    const th = document.createElement('th');
    th.className = 'clerk-wage-header';
    th.innerText = '時給';
    headRow.appendChild(th);
}

(function observeClerkTbodyForWage() {
    function trySetup() {
        const tbody = document.getElementById('clerk-tbody');
        if (!tbody) {
            setTimeout(trySetup, 300);
            return;
        }
        ensureClerkWageHeaderColumn();
        injectClerkWageCells();
        const observer = new MutationObserver(() => {
            ensureClerkWageHeaderColumn();
            injectClerkWageCells();
        });
        observer.observe(tbody, { childList: true, subtree: true });
    }
    trySetup();
})();
