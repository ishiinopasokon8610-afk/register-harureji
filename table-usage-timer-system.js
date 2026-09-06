// ==========================================
// table-usage-timer-system.js
// ------------------------------------------
// 【この機能】
// タッチパネルの「テーブルを選んでください」画面で、使用中（占有中）の
// テーブルに「⏱ 使用中 23分」のように、そのテーブルが何分間使われて
// いるかを表示する。
//
// ・テーブルが「使用中」になった瞬間（markTouchPanelTableOccupied）の
//   時刻を別途localStorageに記録しておき、テーブル選択画面を描画する
//   たびに現在時刻との差から経過分数を計算して表示する。
// ・テーブルが「空席」に戻ったら（releaseTouchPanelTable）記録も消す。
// ・30秒おきに自動更新するので、画面を開きっぱなしでも分数が進む。
//
// 【注意】経過時間の起点はこの端末のlocalStorageで管理しているため、
// 複数のタッチパネル端末をまたいで「テーブルが使用中」の状態は既存の
// 仕組み（Ably経由）で同期されるが、開始時刻そのものは既存の仕組みが
// 同期していない値のため、他の端末からその後に開いた場合は開始時刻が
// 分からず時間表示が出ないことがある（テーブルが再び空席→使用中に
// なれば、その端末でも正しく計測が始まる）。
//
// index.html / touch-panel-order-system.js は直接編集せず、
// renderTouchPanelTableGrid() / markTouchPanelTableOccupied() /
// releaseTouchPanelTable() をラップするフック方式で実現する。
// ==========================================

const TP_TABLE_OCCUPIED_AT_KEY = 'pos_touch_panel_table_occupied_at';

function getTableOccupiedAtMap() {
    try {
        const raw = localStorage.getItem(TP_TABLE_OCCUPIED_AT_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function saveTableOccupiedAtMap(map) {
    localStorage.setItem(TP_TABLE_OCCUPIED_AT_KEY, JSON.stringify(map));
}

function tpFormatUsageMinutes(ms) {
    const totalMin = Math.max(0, Math.floor(ms / 60000));
    if (totalMin < 60) return `${totalMin}分`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}時間${m}分`;
}

/* =========================================================
   今表示されているテーブル選択グリッドに、使用中テーブルの
   経過時間バッジを差し込む／更新する
   ========================================================= */
function injectTableUsageTimes() {
    const grid = document.getElementById('tp-table-grid');
    if (!grid) return;

    const map = getTableOccupiedAtMap();
    grid.querySelectorAll('.tp-table-cell.occupied').forEach((cell) => {
        const num = cell.getAttribute('data-table');
        const startedAt = num != null ? map[num] : null;

        let timeEl = cell.querySelector('.tp-table-usage-time');
        if (!startedAt) {
            if (timeEl) timeEl.remove();
            return;
        }
        if (!timeEl) {
            timeEl = document.createElement('span');
            timeEl.className = 'tp-table-usage-time';
            timeEl.style.cssText = [
                'position:absolute', 'left:0', 'right:0', 'bottom:4px',
                'text-align:center', 'font-size:10px', 'font-weight:700',
                'color:#ffcf9e', 'pointer-events:none'
            ].join(';');
            if (!cell.style.position) cell.style.position = 'relative';
            cell.appendChild(timeEl);
        }
        timeEl.textContent = `⏱ ${tpFormatUsageMinutes(Date.now() - startedAt)}`;
    });
}

/* =========================================================
   renderTouchPanelTableGrid() をラップして、描画のたびに
   経過時間バッジを反映する
   ========================================================= */
(function hookTableGridRenderForTimer() {
    function tryHook() {
        if (typeof window.renderTouchPanelTableGrid !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelTableGrid;
        window.renderTouchPanelTableGrid = function (...args) {
            const result = original.apply(this, args);
            injectTableUsageTimes();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   markTouchPanelTableOccupied() / releaseTouchPanelTable() を
   ラップして、開始時刻の記録・削除を行う
   ========================================================= */
(function hookOccupyReleaseForTimer() {
    function tryHook() {
        if (typeof window.markTouchPanelTableOccupied !== 'function' ||
            typeof window.releaseTouchPanelTable !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        const originalMark = window.markTouchPanelTableOccupied;
        window.markTouchPanelTableOccupied = function (num, ...rest) {
            const result = originalMark.apply(this, [num, ...rest]);
            if (num != null) {
                const map = getTableOccupiedAtMap();
                if (!map[num]) {
                    map[num] = Date.now();
                    saveTableOccupiedAtMap(map);
                }
            }
            return result;
        };

        const originalRelease = window.releaseTouchPanelTable;
        window.releaseTouchPanelTable = function (num, ...rest) {
            const result = originalRelease.apply(this, [num, ...rest]);
            if (num != null) {
                const map = getTableOccupiedAtMap();
                if (map[num] != null) {
                    delete map[num];
                    saveTableOccupiedAtMap(map);
                }
            }
            return result;
        };
    }
    tryHook();
})();

// 画面を開きっぱなしでも表示が進むように、定期的に再計算する
setInterval(injectTableUsageTimes, 30000);
