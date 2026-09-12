// ==========================================
// menu-genre-page-grid-system.js
// ------------------------------------------
// 【この機能】
// メニュー画面で、特定のジャンル（またはおすすめ）を選んでいるとき、
// これまでは該当する商品を全件、縦スクロールのグリッドで表示していた。
//
// 【今回の変更】
// ガストのタッチパネルのように、縦スクロールではなく「横にスワイプして
// めくる」ページ送り表示に変更する。ジャンルごとに「1ページに何列×何行で
// 表示するか」を店員側で設定でき、未設定のジャンルもデフォルトの列数×行数
// （3列×2行）で自動的にページ送り表示になる（＝タッチパネルを使うときは
// 常にスワイプでめくる形になる）。ページ送りボタン（‹ 前へ／次へ ›）に
// 加えて、画面を指で左右にスワイプしてもページがめくれる。
//
// ・「すべて」表示（ジャンル別横スクロール帯）・検索中は対象外
//   （元の仕様のまま。こちらはもともと横スクロールの見せ方のため）。
// ・設定はlocalStorageに保存し、既存の「自動化バーコード」等と同じ
//   Ably連携（broadcastTouchPanelMenuSettingEvent / channel.subscribe）に
//   相乗りする形で、他のタッチパネル端末にもリアルタイムで共有される。
//   pos_ から始まるキーなので backup-extra-settings-sync.js による
//   Google Driveバックアップの対象にも自動的に含まれる。
//
// index.html / touch-panel-order-system.js は直接編集せず、
// renderTouchPanelMenuAreaHtml() / renderTouchPanelMenuScreen() /
// selectTouchPanelCategory() / getOrCreateTouchPanelOverlay() を
// ラップするフック方式で実現する。
// ==========================================

const TP_GENRE_GRID_STORAGE_KEY = 'pos_touch_panel_genre_grid_settings';
// 店員が列数×行数を設定していないジャンルに使う既定値。
// これにより「設定していないジャンルは今まで通りスクロール」ではなく、
// 全ジャンルが常にページ送り（＝スワイプでめくる）表示になる。
const TP_GENRE_GRID_DEFAULT = { cols: 3, rows: 2 };

function getTpGenreGridSettings() {
    try {
        const raw = localStorage.getItem(TP_GENRE_GRID_STORAGE_KEY);
        const obj = raw ? JSON.parse(raw) : {};
        return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
        return {};
    }
}

function saveTpGenreGridSettingsToStorage(obj) {
    localStorage.setItem(TP_GENRE_GRID_STORAGE_KEY, JSON.stringify(obj));
}

/* =========================================================
   ページ状態（この端末の画面上だけの一時的な状態。永続化しない）
   ========================================================= */
let tpGenrePageState = { category: null, page: 1, totalPages: 1 };

function tpResetGenrePageForKey(key) {
    if (tpGenrePageState.category === key) tpGenrePageState.page = 1;
}

function tpRefreshMenuAreaIfShowingCategory(key) {
    if (typeof touchPanelState === 'undefined') return;
    const q = (touchPanelState.searchQuery || '').trim();
    if (q) return;
    if (touchPanelState.activeCategory !== key) return;
    const area = document.getElementById('tp-menu-area');
    if (!area || typeof window.renderTouchPanelMenuAreaHtml !== 'function') return;
    area.innerHTML = window.renderTouchPanelMenuAreaHtml(
        (typeof getProductListForTouchPanel === 'function') ? getProductListForTouchPanel() : []
    );
}

/* =========================================================
   ページ送りグリッド本体（renderTouchPanelMenuAreaHtml のフック）
   ========================================================= */
function tpBuildPagerHtml(page, totalPages) {
    return `
        <div class="tp-genre-pager">
            <button class="tp-btn tp-cancel" ${page <= 1 ? 'disabled' : ''} onclick="tpGenrePageGoTo(${page - 1})">‹ 前へ</button>
            <span class="tp-genre-pager-label">${page} / ${totalPages} ページ（左右にスワイプでもめくれます）</span>
            <button class="tp-btn tp-primary" ${page >= totalPages ? 'disabled' : ''} onclick="tpGenrePageGoTo(${page + 1})">次へ ›</button>
        </div>
    `;
}

function tpGenrePageGoTo(page) {
    tpPlaySound('click');
    tpGenrePageState.page = page;
    const area = document.getElementById('tp-menu-area');
    if (!area || typeof window.renderTouchPanelMenuAreaHtml !== 'function') return;
    area.innerHTML = window.renderTouchPanelMenuAreaHtml(
        (typeof getProductListForTouchPanel === 'function') ? getProductListForTouchPanel() : []
    );
    area.scrollTop = 0;
}

function tpGenreSwipeNext() {
    if (tpGenrePageState.page < tpGenrePageState.totalPages) {
        tpGenrePageGoTo(tpGenrePageState.page + 1);
    }
}

function tpGenreSwipePrev() {
    if (tpGenrePageState.page > 1) {
        tpGenrePageGoTo(tpGenrePageState.page - 1);
    }
}

(function hookMenuAreaHtmlForGenrePaging() {
    function tryHook() {
        if (typeof window.renderTouchPanelMenuAreaHtml !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelMenuAreaHtml;
        window.renderTouchPanelMenuAreaHtml = function (productList) {
            const cat = (typeof touchPanelState !== 'undefined') ? (touchPanelState.activeCategory || 'all') : 'all';
            const q = (typeof touchPanelState !== 'undefined') ? (touchPanelState.searchQuery || '').trim() : '';

            // 検索中／「すべて」表示中はこれまで通り（横スクロール帯のため対象外）
            if (q || cat === 'all') {
                return original.call(this, productList);
            }

            // 設定していないジャンルは既定値（3列×2行）で自動的にページ送り
            const configured = getTpGenreGridSettings()[cat];
            const setting = (configured && configured.cols && configured.rows) ? configured : TP_GENRE_GRID_DEFAULT;

            if (tpGenrePageState.category !== cat) {
                tpGenrePageState.category = cat;
                tpGenrePageState.page = 1;
            }

            const filtered = (typeof filterTouchPanelProducts === 'function') ? filterTouchPanelProducts() : [];
            const perPage = setting.cols * setting.rows;
            const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
            if (tpGenrePageState.page > totalPages) tpGenrePageState.page = totalPages;
            if (tpGenrePageState.page < 1) tpGenrePageState.page = 1;
            tpGenrePageState.totalPages = totalPages;

            const start = (tpGenrePageState.page - 1) * perPage;
            const pageItems = filtered.slice(start, start + perPage);
            const cardsHtml = pageItems.map(p => renderTouchPanelMenuCard(p, false)).join('') ||
                '<p class="tp-empty-msg">該当する商品がありません。</p>';
            const pagerHtml = totalPages > 1 ? tpBuildPagerHtml(tpGenrePageState.page, totalPages) : '';

            return `<div class="tp-menu-grid tp-genre-paged-grid" style="grid-template-columns: repeat(${setting.cols}, 1fr);">${cardsHtml}</div>${pagerHtml}`;
        };
    }
    tryHook();
})();

/* =========================================================
   横スワイプでのページめくり（ガストのタッチパネル風）
   ------------------------------------------
   #tp-menu-area は再描画のたびに中身が丸ごと入れ替わるため、
   要素自体にではなくoverlay全体にリスナーを1回だけ付け、
   タッチ開始位置が#tp-menu-area内かどうかで判定する
   （table-usage-timer-system.js等と同じ委譲方式）。
   ========================================================= */
let tpGenreSwipeStartX = null;
let tpGenreSwipeStartY = null;

function bindTpGenreSwipeListeners(overlay) {
    if (!overlay || overlay.dataset.tpGenreSwipeBound === '1') return;
    overlay.dataset.tpGenreSwipeBound = '1';

    overlay.addEventListener('touchstart', (e) => {
        const area = e.target.closest && e.target.closest('#tp-menu-area');
        if (!area || !e.touches || e.touches.length !== 1) {
            tpGenreSwipeStartX = null;
            return;
        }
        tpGenreSwipeStartX = e.touches[0].clientX;
        tpGenreSwipeStartY = e.touches[0].clientY;
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
        if (tpGenreSwipeStartX == null) return;
        const startX = tpGenreSwipeStartX;
        const startY = tpGenreSwipeStartY;
        tpGenreSwipeStartX = null;

        const touch = e.changedTouches && e.changedTouches[0];
        if (!touch) return;

        // ページ送り対象のジャンルを表示中でなければ何もしない
        if (typeof touchPanelState === 'undefined') return;
        const q = (touchPanelState.searchQuery || '').trim();
        if (q || touchPanelState.activeCategory !== tpGenrePageState.category) return;

        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        // 横方向にしっかり動いた（かつ縦より横優位）ときだけスワイプ扱い
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.3) return;

        if (dx < 0) {
            tpGenreSwipeNext(); // 左スワイプ＝次のページ
        } else {
            tpGenreSwipePrev(); // 右スワイプ＝前のページ
        }
    }, { passive: true });
}

(function hookOverlayCreationForGenreSwipe() {
    function tryHook() {
        if (typeof window.getOrCreateTouchPanelOverlay !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.getOrCreateTouchPanelOverlay;
        window.getOrCreateTouchPanelOverlay = function (...args) {
            const overlay = original.apply(this, args);
            bindTpGenreSwipeListeners(overlay);
            return overlay;
        };
    }
    tryHook();
})();

// カテゴリ（ジャンル）ボタンを手で切り替えたときは、必ず1ページ目から
(function hookCategorySelectForGenrePagingReset() {
    function tryHook() {
        if (typeof window.selectTouchPanelCategory !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.selectTouchPanelCategory;
        window.selectTouchPanelCategory = function (key) {
            tpGenrePageState.category = key;
            tpGenrePageState.page = 1;
            return original.apply(this, arguments);
        };
    }
    tryHook();
})();

/* =========================================================
   店員用：ジャンルごとの列数×行数 設定モーダル
   ------------------------------------------
   「🔢 表示件数設定」ボタン（店員用モードのみ、topbarへ後付け）から開く。
   ========================================================= */
(function injectGenreGridSettingStyle() {
    if (document.getElementById('tp-genre-grid-setting-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-genre-grid-setting-style';
    style.textContent = `
        #touch-panel-overlay .tp-genre-pager {
            display:flex; align-items:center; justify-content:center; gap:18px;
            margin-top:18px; padding:10px 0 4px;
        }
        #touch-panel-overlay .tp-genre-pager-label { font-size:13px; font-weight:700; color:var(--tp-ink-soft); }
        #touch-panel-overlay .tp-genre-pager button[disabled] { opacity:0.35; pointer-events:none; }
        #touch-panel-overlay .tp-genre-grid-setting-row input[type="number"]::-webkit-outer-spin-button,
        #touch-panel-overlay .tp-genre-grid-setting-row input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none; margin: 0;
        }
        @keyframes tpGenrePageFadeIn {
            from { opacity: 0; transform: translateX(8px); }
            to { opacity: 1; transform: translateX(0); }
        }
        #touch-panel-overlay .tp-genre-paged-grid {
            animation: tpGenrePageFadeIn 0.16s ease;
        }
    `;
    document.head.appendChild(style);
})();

function openTpGenreGridSettingModal() {
    tpPlaySound('click');
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-genre-grid-setting-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-genre-grid-setting-root';
        overlay.appendChild(root);
    }
    renderTpGenreGridSettingModal();
}

function closeTpGenreGridSettingModal() {
    const root = document.getElementById('tp-genre-grid-setting-root');
    if (root) root.remove();
}

function renderTpGenreGridSettingModal() {
    const root = document.getElementById('tp-genre-grid-setting-root');
    if (!root) return;

    const productList = (typeof getProductListForTouchPanel === 'function') ? getProductListForTouchPanel() : [];
    const categories = (typeof buildTouchPanelCategoryList === 'function') ? buildTouchPanelCategoryList(productList) : [];
    const genreCats = categories.filter(c => c.key !== 'all');
    const settings = getTpGenreGridSettings();

    const rowsHtml = genreCats.map((c, i) => {
        const cur = settings[c.key];
        return `
            <div class="tp-genre-grid-setting-row" style="display:flex; align-items:center; gap:6px; padding:8px 0; border-bottom:1px solid #eee;">
                <div style="flex:1; min-width:0; font-size:13px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.icon} ${tpEsc(c.label)}</div>
                <input type="number" min="1" max="12" inputmode="numeric" placeholder="列" value="${cur ? cur.cols : ''}"
                    id="tp-ggs-cols-${i}"
                    style="width:48px; box-sizing:border-box; padding:6px; border:1px solid #ccc; border-radius:6px; font-size:13px; text-align:center;">
                <span style="font-size:12px; color:var(--tp-ink-soft);">×</span>
                <input type="number" min="1" max="12" inputmode="numeric" placeholder="行" value="${cur ? cur.rows : ''}"
                    id="tp-ggs-rows-${i}"
                    style="width:48px; box-sizing:border-box; padding:6px; border:1px solid #ccc; border-radius:6px; font-size:13px; text-align:center;">
                <button class="tp-btn tp-primary" style="padding:6px 10px; font-size:11px; white-space:nowrap;" onclick="saveTpGenreGridRow('${tpAttr(c.key)}', ${i})">保存</button>
                ${cur ? `<button class="tp-btn tp-cancel" style="padding:6px 10px; font-size:11px; white-space:nowrap;" onclick="clearTpGenreGridRow('${tpAttr(c.key)}')">解除</button>` : ''}
            </div>
        `;
    }).join('') || '<p style="text-align:center; color:#999; font-size:13px; padding:16px 0;">ジャンルが登録されていません。</p>';

    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTpGenreGridSettingModal()"></div>
        <div class="tp-pin-modal tp-pop" style="width:min(480px, 92vw); max-height:82vh; overflow-y:auto; text-align:left;">
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeTpGenreGridSettingModal()">×</button>
            <div class="tp-pin-title">🔢 ジャンルごとの表示件数</div>
            <div class="tp-pin-sub" style="margin-bottom:12px;">
                列数×行数を設定すると、そのジャンルは1ページその件数ずつ「‹ 前へ／次へ ›」または横スワイプでめくれるページ送り表示になります。空欄のジャンルは既定値（3列×2行）で自動的にページ送りになります。
            </div>
            <div>${rowsHtml}</div>
        </div>
    `;
}

function saveTpGenreGridRow(key, i) {
    const colsInput = document.getElementById(`tp-ggs-cols-${i}`);
    const rowsInput = document.getElementById(`tp-ggs-rows-${i}`);
    const cols = parseInt(colsInput && colsInput.value, 10);
    const rows = parseInt(rowsInput && rowsInput.value, 10);
    if (!cols || !rows || cols < 1 || rows < 1) {
        tpPlaySound('error');
        showTouchPanelToast('⚠️ 列数・行数を1以上の数字で入力してください');
        return;
    }
    const settings = getTpGenreGridSettings();
    settings[key] = { cols: Math.min(cols, 12), rows: Math.min(rows, 12) };
    saveTpGenreGridSettingsToStorage(settings);
    broadcastTouchPanelMenuSettingEvent({ action: 'set-genre-grid', genreKey: key, cols: settings[key].cols, rows: settings[key].rows });
    tpBackupNowSafe();
    tpResetGenrePageForKey(key);
    renderTpGenreGridSettingModal();
    tpRefreshMenuAreaIfShowingCategory(key);
    tpPlaySound('success');
}

function clearTpGenreGridRow(key) {
    const settings = getTpGenreGridSettings();
    delete settings[key];
    saveTpGenreGridSettingsToStorage(settings);
    broadcastTouchPanelMenuSettingEvent({ action: 'clear-genre-grid', genreKey: key });
    tpBackupNowSafe();
    tpResetGenrePageForKey(key);
    renderTpGenreGridSettingModal();
    tpRefreshMenuAreaIfShowingCategory(key);
    tpPlaySound('click');
}

// topbarへ「🔢 表示件数設定」ボタンを後付け（店員用モードのみ）
function injectGenreGridSettingsButton() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay || typeof touchPanelState === 'undefined' || touchPanelState.mode !== 'staff') return;
    const actions = overlay.querySelector('.tp-topbar-actions');
    if (!actions || actions.querySelector('.tp-genre-grid-setting-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'tp-btn tp-cancel tp-genre-grid-setting-btn';
    btn.textContent = '🔢 表示件数設定';
    btn.onclick = openTpGenreGridSettingModal;
    actions.insertBefore(btn, actions.firstChild);
}

(function hookMenuScreenForGenreGridSettingsButton() {
    function tryHook() {
        if (typeof window.renderTouchPanelMenuScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelMenuScreen;
        window.renderTouchPanelMenuScreen = function (...args) {
            const result = original.apply(this, args);
            injectGenreGridSettingsButton();
            return result;
        };
    }
    tryHook();
})();

// 【修正】暗証番号入力後に出る小さな選択肢メニューに直接ボタンを置く。
// このプロジェクトには暗証番号後の選択メニューが2種類存在する
// （①人数選択後の客用/店員用選択画面から入る openTouchPanelStaffActionSheet、
// 　②注文中の脱出防止バッジから入る openTouchPanelKioskActionChoice
// 　＝「🔒 店員確認OK／どちらの操作をしますか？」の画面）。
// どちらから入っても設定できるよう、両方に同じボタンを追加する。
function injectGenreGridSettingsButtonIntoActionSheet(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    if (root.querySelector('.tp-genre-grid-setting-action-btn')) return;
    const list = root.querySelector('.tp-pin-modal > div');
    if (!list) return;
    const btn = document.createElement('button');
    btn.className = 'tp-btn tp-primary tp-genre-grid-setting-action-btn';
    btn.style.width = '100%';
    btn.textContent = '🔢 表示件数設定（ジャンルごと）';
    btn.onclick = function () {
        if (rootId === 'tp-staff-action-root' && typeof closeTouchPanelStaffActionSheet === 'function') {
            closeTouchPanelStaffActionSheet();
        } else if (rootId === 'tp-kiosk-action-root' && typeof closeTouchPanelKioskActionChoice === 'function') {
            closeTouchPanelKioskActionChoice();
        }
        openTpGenreGridSettingModal();
    };
    list.appendChild(btn);
}

(function hookStaffActionSheetForGenreGridButton() {
    function tryHook() {
        if (typeof window.openTouchPanelStaffActionSheet !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.openTouchPanelStaffActionSheet;
        window.openTouchPanelStaffActionSheet = function (...args) {
            const result = original.apply(this, args);
            injectGenreGridSettingsButtonIntoActionSheet('tp-staff-action-root');
            return result;
        };
    }
    tryHook();
})();

(function hookKioskActionChoiceForGenreGridButton() {
    function tryHook() {
        if (typeof window.openTouchPanelKioskActionChoice !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.openTouchPanelKioskActionChoice;
        window.openTouchPanelKioskActionChoice = function (...args) {
            const result = original.apply(this, args);
            injectGenreGridSettingsButtonIntoActionSheet('tp-kiosk-action-root');
            return result;
        };
    }
    tryHook();
})();


/* =========================================================
   他端末（Ably）からの設定変更を、この端末にも反映する
   ------------------------------------------
   touch-panel-order-system.js 側の既存チャンネル購読
   （'touch-panel-menu-setting-event'）に、このファイル用の
   購読を追加で登録する（Ablyは同じイベント名に複数のsubscribe()を
   重ねて登録でき、既存の購読を上書きすることはない）。
   ========================================================= */
(function hookAblyForGenreGridSettings() {
    function tryHook() {
        if (typeof channel === 'undefined' || !channel) {
            setTimeout(tryHook, 500);
            return;
        }
        channel.subscribe('touch-panel-menu-setting-event', (message) => {
            const data = message.data || {};
            if (data.action !== 'set-genre-grid' && data.action !== 'clear-genre-grid') return;
            if (data.genreKey == null) return;

            const settings = getTpGenreGridSettings();
            if (data.action === 'set-genre-grid') {
                settings[data.genreKey] = { cols: data.cols, rows: data.rows };
            } else {
                delete settings[data.genreKey];
            }
            saveTpGenreGridSettingsToStorage(settings);
            tpResetGenrePageForKey(data.genreKey);
            tpRefreshMenuAreaIfShowingCategory(data.genreKey);
            if (document.getElementById('tp-genre-grid-setting-root')) {
                renderTpGenreGridSettingModal();
            }
        });
    }
    tryHook();
})();
