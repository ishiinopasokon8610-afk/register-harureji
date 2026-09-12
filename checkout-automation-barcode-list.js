// ==========================================
// checkout-automation-barcode-list.js
// ------------------------------------------
// 【この機能】
// レジ画面（会計画面）の「お会計」ボタンの左に
// 「🏷️ 自動化バーコード一覧」ボタンを追加する。
// このボタンを押すと、登録済みの自動化バーコード（「自動化バーコード作成」
// 画面で作った各バーコード）がブロック形式の一覧で表示され、
// ブロックを【タップ】すると、そのバーコードを実際にスキャンしたのと
// 同じ扱いで即座にカートへ反映される。
// ブロックを【長押し】（0.6秒）すると、その場でこのクイック一覧から
// 「アーカイブ」される（一覧から消える）。
//
// 【実現方法】
// register.js内部のバーコード読み取り処理の関数名などは分からないため、
// 他の追加機能ファイルと同じ「既存の仕組みをそのまま利用する」方針に
// 沿って、以下の2点だけを使う。
//   ①一覧のデータは、自動化バーコード管理画面がすでに描画している
//     #discount-tbody の各行（バーコード／割引名／内容）をそのまま読み取る。
//     （customer-member-number.jsと同じ「DOM読み取り方式」。内部データの
//     配列名・プロパティ名に依存しないため、他の機能と衝突しない。）
//   ②バーコードの「適用」は、実際にハンディスキャナーでスキャンした
//     ときと同じ動作（#jan-input に値を入れてEnterキー入力イベントを
//     発生させる）を疑似的に再現することで行う。これにより、レジ本体側の
//     スキャン処理を直接呼び出す必要がなく、将来register.js側の実装が
//     変わっても壊れにくい。
//
// 【長押しアーカイブについて（重要な注意）】
// 「自動化バーコード管理」画面（discount-screen）自体には、使い切り
// バーコードが会計で実際に使用された時にだけ移動する「使用済み
// （アーカイブ）」一覧（#discount-archive-tbody）が別途存在するが、
// これは register.js 側が管理する会計履歴の記録であり、この追加機能
// からは中身も発番タイミングも分からないため、絶対に触らない・混同
// しない。
// 今回の「長押しでアーカイブ」は、あくまで【このクイック一覧（お会計
// 画面のポップアップ）だけで、よく使わないバーコードを一時的に
// 非表示にする】ための、完全に独立した機能。実データ（discountBarcodes
// や #discount-tbody の中身）は一切変更・削除しない。localStorageに
// 「このクイック一覧では隠す」バーコードの一覧を保存しているだけなので、
// 自動化バーコード管理画面側の一覧・件数には何の影響も与えない。
//
// index.html / register.js は直接編集せず、DOM注入（ボタン追加＋独自の
// オーバーレイ表示）のフック方式で実現する（他の追加機能ファイルと同じ方針）。
// ==========================================

// このクイック一覧専用の「非表示（アーカイブ）」バーコード一覧の保存キー。
// #discount-archive-tbody（会計成立時の使用済みアーカイブ）とは無関係。
const AUTOMATION_BARCODE_QUICKLIST_ARCHIVE_KEY = 'pos_automation_barcode_quicklist_archived';

// 長押し判定にかかる時間（ミリ秒）
const AUTOMATION_BARCODE_LONGPRESS_MS = 600;

// 現在の一覧表示モード（'normal' = 通常一覧 / 'archived' = アーカイブ済み一覧）
// オーバーレイを開き直すたびに 'normal' にリセットする。
let automationBarcodeListViewMode = 'normal';

/* =========================================================
   ①「お会計」ボタンの左にボタンを差し込む
   ========================================================= */
(function injectAutomationBarcodeListButton() {
    function tryInject() {
        const checkoutBtn = document.querySelector('.fixed-actions-container [onclick="openCheckout()"]');
        if (!checkoutBtn) {
            setTimeout(tryInject, 300);
            return;
        }
        if (document.getElementById('automation-barcode-list-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'automation-barcode-list-btn';
        btn.type = 'button';
        btn.className = 'action-btn';
        btn.style.background = '#2e7d32';
        btn.innerHTML = '<span style="color:#fff;">🏷️ 自動化</span><br><small style="color:#f1ebff; opacity:1;">バーコード一覧</small>';
        btn.addEventListener('click', openAutomationBarcodeListOverlay);
        checkoutBtn.parentNode.insertBefore(btn, checkoutBtn);
    }
    tryInject();
})();

/* =========================================================
   長押し進捗バー用のスタイル（他の追加機能の長押しバーと
   衝突しないよう、専用クラス名にしている）
   ========================================================= */
(function injectAutomationBarcodeArchiveBarStyle() {
    if (document.getElementById('automation-barcode-archive-bar-style')) return;
    const style = document.createElement('style');
    style.id = 'automation-barcode-archive-bar-style';
    style.textContent = `
        .automation-barcode-block {
            position: relative;
            overflow: hidden;
            -webkit-user-select: none;
            user-select: none;
            touch-action: manipulation;
        }
        .automation-barcode-archive-bar {
            position: absolute;
            left: 0; bottom: 0; top: 0;
            width: 0%;
            background: rgba(211, 47, 47, 0.18);
            pointer-events: none;
            z-index: 0;
        }
        .automation-barcode-block > * {
            position: relative;
            z-index: 1;
        }
        .automation-barcode-block.automation-barcode-archiving {
            opacity: 0.4;
        }
    `;
    document.head.appendChild(style);
})();

/* =========================================================
   ②一覧オーバーレイの表示・非表示
   ========================================================= */
function openAutomationBarcodeListOverlay() {
    // 表示するたびに、可能であれば一覧の描画を最新化しておく
    if (typeof renderDiscounts === 'function') {
        try { renderDiscounts(); } catch (e) { /* 失敗しても現状の表示内容で続行する */ }
    }

    automationBarcodeListViewMode = 'normal';

    // 既に開いていれば一旦消してから作り直す（多重表示防止）
    const existing = document.getElementById('automation-barcode-list-overlay');
    if (existing) existing.remove();

    const root = document.createElement('div');
    root.id = 'automation-barcode-list-overlay';
    root.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:100000',
        'background:rgba(0,0,0,0.5)', 'display:flex',
        'align-items:center', 'justify-content:center', 'padding:16px'
    ].join(';');

    const box = document.createElement('div');
    box.id = 'automation-barcode-list-box';
    box.style.cssText = [
        'background:#fff', 'border-radius:12px', 'width:100%', 'max-width:520px',
        'max-height:80vh', 'display:flex', 'flex-direction:column', 'overflow:hidden',
        'box-shadow:0 8px 30px rgba(0,0,0,0.3)'
    ].join(';');

    root.appendChild(box);

    // 背景（黒い部分）をタップしたら閉じる
    root.addEventListener('click', (e) => {
        if (e.target === root) closeAutomationBarcodeListOverlay();
    });

    document.body.appendChild(root);

    renderAutomationBarcodeListBox();
}

function closeAutomationBarcodeListOverlay() {
    const root = document.getElementById('automation-barcode-list-overlay');
    if (root) root.remove();
    const input = document.getElementById('jan-input');
    if (input) input.focus();
}

// 現在の automationBarcodeListViewMode に応じて、箱（ヘッダー＋本文）の
// 中身を丸ごと描き直す。タブ切り替え・アーカイブ後の再描画で共通して使う。
function renderAutomationBarcodeListBox() {
    const box = document.getElementById('automation-barcode-list-box');
    if (!box) return;
    box.innerHTML = '';

    const archivedSet = getAutomationBarcodeQuicklistArchivedSet();
    const allItems = collectAutomationBarcodeItems();
    const isArchivedView = automationBarcodeListViewMode === 'archived';
    const items = isArchivedView
        ? allItems.filter((item) => archivedSet.has(item.barcode))
        : allItems.filter((item) => !archivedSet.has(item.barcode));

    /* ---- ヘッダー ---- */
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:14px 16px; border-bottom:1px solid #eee; flex-shrink:0;';

    const titleEl = document.createElement('h3');
    titleEl.style.cssText = 'margin:0; font-size:16px; color:#5e35b1; flex:1; min-width:0;';
    titleEl.textContent = isArchivedView ? '📦 アーカイブ済み一覧' : '🏷️ 自動化バーコード一覧';
    header.appendChild(titleEl);

    if (isArchivedView) {
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.textContent = '← 戻る';
        backBtn.style.cssText = 'background:#f0ebfa; color:#5e35b1; border:none; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:bold; cursor:pointer; white-space:nowrap;';
        backBtn.addEventListener('click', () => {
            automationBarcodeListViewMode = 'normal';
            renderAutomationBarcodeListBox();
        });
        header.appendChild(backBtn);
    } else {
        const archiveToggleBtn = document.createElement('button');
        archiveToggleBtn.type = 'button';
        const archivedCount = allItems.filter((item) => archivedSet.has(item.barcode)).length;
        archiveToggleBtn.textContent = `📦 アーカイブ (${archivedCount})`;
        archiveToggleBtn.style.cssText = 'background:#f0ebfa; color:#5e35b1; border:none; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:bold; cursor:pointer; white-space:nowrap;';
        archiveToggleBtn.addEventListener('click', () => {
            automationBarcodeListViewMode = 'archived';
            renderAutomationBarcodeListBox();
        });
        header.appendChild(archiveToggleBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.style.cssText = 'background:none; border:none; font-size:24px; line-height:1; color:#888; cursor:pointer; padding:0 4px;';
    closeBtn.addEventListener('click', closeAutomationBarcodeListOverlay);
    header.appendChild(closeBtn);

    /* ---- 本文 ---- */
    const body = document.createElement('div');
    body.style.cssText = 'padding:14px 16px; overflow-y:auto; display:flex; flex-direction:column; gap:10px;';

    if (!isArchivedView) {
        const hint = document.createElement('p');
        hint.style.cssText = 'margin:0 0 2px; font-size:11px; color:#aaa;';
        hint.textContent = 'タップで適用 ／ 長押しでアーカイブ（一覧から非表示）';
        body.appendChild(hint);
    }

    if (items.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'color:#999; text-align:center; margin:20px 0;';
        empty.textContent = isArchivedView
            ? 'アーカイブされた自動化バーコードはありません'
            : '登録されている自動化バーコードがありません';
        body.appendChild(empty);
    } else {
        items.forEach((item) => {
            body.appendChild(
                isArchivedView
                    ? buildArchivedAutomationBarcodeBlock(item)
                    : buildAutomationBarcodeBlock(item)
            );
        });
    }

    box.appendChild(header);
    box.appendChild(body);
}

function escapeHtmlForAutomationList(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/* =========================================================
   ③ #discount-tbody（自動化バーコード管理画面の一覧）から、
      現在登録されている（アーカイブ済みを除く）バーコード情報を読み取る。
      内部データ構造（配列名・プロパティ名）には依存しない。
   ========================================================= */
function collectAutomationBarcodeItems() {
    const tbody = document.getElementById('discount-tbody');
    if (!tbody) return [];

    const items = [];
    Array.from(tbody.querySelectorAll('tr')).forEach((row) => {
        if (row.cells.length < 3) return; // 「登録がありません」等の案内行を除外
        const barcode = (row.cells[0].innerText || row.cells[0].textContent || '').trim();
        const name = (row.cells[1].innerText || row.cells[1].textContent || '').trim();
        const content = (row.cells[2].innerText || row.cells[2].textContent || '').trim();
        if (!barcode) return;
        items.push({ barcode, name, content });
    });
    return items;
}

/* =========================================================
   ④バーコードの適用：ハンディスキャナーでスキャンしたのと同じ動作を
     #jan-input 上で疑似的に再現する。
   ========================================================= */
function applyAutomationBarcode(barcode) {
    closeAutomationBarcodeListOverlay();

    const input = document.getElementById('jan-input');
    if (!input || !barcode) return;

    input.focus();
    input.value = barcode;
    input.dispatchEvent(new Event('input', { bubbles: true }));

    ['keydown', 'keyup'].forEach((type) => {
        input.dispatchEvent(new KeyboardEvent(type, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
        }));
    });
}

/* =========================================================
   ⑤クイック一覧専用「アーカイブ（非表示）」の読み書き
   ------------------------------------------
   discountBarcodes配列・#discount-archive-tbody は一切触らず、
   localStorageだけで「このクイック一覧では隠す」バーコードを管理する。
   ========================================================= */
function getAutomationBarcodeQuicklistArchivedList() {
    try {
        const raw = localStorage.getItem(AUTOMATION_BARCODE_QUICKLIST_ARCHIVE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function getAutomationBarcodeQuicklistArchivedSet() {
    return new Set(getAutomationBarcodeQuicklistArchivedList());
}

function saveAutomationBarcodeQuicklistArchivedList(list) {
    localStorage.setItem(AUTOMATION_BARCODE_QUICKLIST_ARCHIVE_KEY, JSON.stringify(list));
    // 他の追加機能と同様、レジのバックアップ機構があれば一緒に保存する
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
}

function archiveAutomationBarcodeInQuicklist(barcode) {
    if (!barcode) return;
    const list = getAutomationBarcodeQuicklistArchivedList();
    if (!list.includes(barcode)) {
        list.push(barcode);
        saveAutomationBarcodeQuicklistArchivedList(list);
    }
}

function restoreAutomationBarcodeInQuicklist(barcode) {
    const list = getAutomationBarcodeQuicklistArchivedList().filter((b) => b !== barcode);
    saveAutomationBarcodeQuicklistArchivedList(list);
}

/* =========================================================
   ⑥通常一覧のブロック（タップで適用／長押しでアーカイブ）
   ========================================================= */
function buildAutomationBarcodeBlock(item) {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'automation-barcode-block';
    block.style.cssText = [
        'text-align:left', 'width:100%', 'border:1px solid #d8ccf0', 'background:#f7f4fc',
        'border-radius:10px', 'padding:12px 14px', 'cursor:pointer', 'display:flex',
        'flex-direction:column', 'gap:4px'
    ].join(';');
    block.innerHTML = `
        <span style="font-weight:bold; color:#4a2f8a; font-size:15px;">${escapeHtmlForAutomationList(item.name || '(名称未設定)')}</span>
        ${item.content ? `<span style="font-size:12px; color:#666;">${escapeHtmlForAutomationList(item.content)}</span>` : ''}
        <span style="font-size:11px; color:#9c8fc4; font-family:monospace;">📷 ${escapeHtmlForAutomationList(item.barcode)}</span>
    `;

    const progressBar = document.createElement('div');
    progressBar.className = 'automation-barcode-archive-bar';
    block.appendChild(progressBar);

    let pressTimer = null;
    let archiving = false; // 長押しが完了してアーカイブ処理に入ったら true

    function clearPress() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
        progressBar.style.transition = 'none';
        progressBar.style.width = '0%';
    }

    function startPress() {
        archiving = false;
        clearPress();
        // reflow を挟んでから transition を効かせることで、0%→100%への
        // アニメーションを確実に再生させる
        // eslint-disable-next-line no-unused-expressions
        progressBar.offsetWidth;
        progressBar.style.transition = `width ${AUTOMATION_BARCODE_LONGPRESS_MS}ms linear`;
        progressBar.style.width = '100%';

        pressTimer = setTimeout(() => {
            archiving = true;
            block.classList.add('automation-barcode-archiving');
            archiveAutomationBarcodeInQuicklist(item.barcode);
            // その場でこのブロックだけ消す（一覧全体は再描画しない＝
            // スクロール位置や他ブロックの表示を崩さないため）
            setTimeout(() => {
                block.remove();
                // ヘッダーのアーカイブ件数バッジも最新化する
                renderAutomationBarcodeListBox();
            }, 150);
        }, AUTOMATION_BARCODE_LONGPRESS_MS);
    }

    function endPress(shouldApply) {
        const wasArchiving = archiving;
        clearPress();
        if (shouldApply && !wasArchiving) {
            applyAutomationBarcode(item.barcode);
        }
    }

    // pointerdown/up系で統一し、通常のclickイベントには依存しない
    // （applyAutomationBarcodeの二重発火を避けるため）
    block.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return; // 左クリック／タッチのみ対象
        startPress();
    });
    block.addEventListener('pointerup', () => endPress(true));
    block.addEventListener('pointerleave', () => endPress(false));
    block.addEventListener('pointercancel', () => endPress(false));
    // 長押し中にブラウザの右クリックメニュー等が出ないようにする
    block.addEventListener('contextmenu', (e) => e.preventDefault());

    return block;
}

/* =========================================================
   ⑦アーカイブ済み一覧のブロック（タップでは何もせず「復元」ボタンのみ）
   ========================================================= */
function buildArchivedAutomationBarcodeBlock(item) {
    const block = document.createElement('div');
    block.style.cssText = [
        'width:100%', 'border:1px solid #e0e0e0', 'background:#fafafa',
        'border-radius:10px', 'padding:12px 14px', 'display:flex',
        'align-items:center', 'gap:10px'
    ].join(';');

    const info = document.createElement('div');
    info.style.cssText = 'flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;';
    info.innerHTML = `
        <span style="font-weight:bold; color:#777; font-size:15px;">${escapeHtmlForAutomationList(item.name || '(名称未設定)')}</span>
        ${item.content ? `<span style="font-size:12px; color:#999;">${escapeHtmlForAutomationList(item.content)}</span>` : ''}
        <span style="font-size:11px; color:#bbb; font-family:monospace;">📷 ${escapeHtmlForAutomationList(item.barcode)}</span>
    `;

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.textContent = '↩️ 復元';
    restoreBtn.style.cssText = 'flex-shrink:0; background:#5e35b1; color:#fff; border:none; border-radius:8px; padding:8px 12px; font-size:12px; font-weight:bold; cursor:pointer;';
    restoreBtn.addEventListener('click', () => {
        restoreAutomationBarcodeInQuicklist(item.barcode);
        renderAutomationBarcodeListBox();
    });

    block.appendChild(info);
    block.appendChild(restoreBtn);
    return block;
}
