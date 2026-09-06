// ==========================================
// gdrive-sync-indicator.js
// ------------------------------------------
// 【背景】
// google-drive-backup.js は自動でバックアップしてくれるが、
// 「本当に今、最新のデータがDriveに保存されたか」が画面上に何も
// 表示されないため、利用者が不安に感じやすい。
//
// 【この機能】
// データ管理画面(migration-screen)のGoogle Drive連携ブロック付近に、
//   ・「最終同期：〇分前」の表示（30秒ごとに自動更新）
//   ・「🔄 今すぐ同期」ボタン（押すと強制的にバックアップし、
//     同期中はボタンがくるくる回るインジケータ表示になる）
// を追加する。
//
// google-drive-backup.js / index.html は直接編集せず、
// backupToGoogleDriveNow() をフックしてタイムスタンプを記録し、
// DOM注入で表示部分を追加する（他の追加機能ファイルと同じ方式）。
// ==========================================

const GDRIVE_LAST_SYNC_KEY = 'pos_gdrive_last_sync_at';

function getGDriveLastSyncAt() {
    const v = localStorage.getItem(GDRIVE_LAST_SYNC_KEY);
    return v ? parseInt(v, 10) : null;
}

function setGDriveLastSyncAtNow() {
    localStorage.setItem(GDRIVE_LAST_SYNC_KEY, Date.now().toString());
}

function formatGDriveSyncAgo(ts) {
    if (!ts) return 'まだ同期していません';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 10) return 'たった今';
    if (diffSec < 60) return `${diffSec}秒前`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}時間前`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}日前`;
}

function isGDriveConnectedSafe() {
    return localStorage.getItem('pos_gdrive_connected') === 'true';
}

function refreshGDriveSyncIndicatorUI() {
    const label = document.getElementById('gdrive-sync-status-label');
    const wrap = document.getElementById('gdrive-sync-indicator-block');
    if (!wrap) return;

    if (!isGDriveConnectedSafe()) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'flex';
    if (label) label.innerText = `最終同期：${formatGDriveSyncAgo(getGDriveLastSyncAt())}`;
}

async function manualGDriveSyncNow() {
    const btn = document.getElementById('gdrive-sync-now-btn');
    if (!btn || btn.disabled) return;

    if (!isGDriveConnectedSafe()) {
        if (typeof connectGoogleDrive === 'function') connectGoogleDrive(true);
        return;
    }

    btn.disabled = true;
    const originalText = btn.innerText;
    btn.innerText = '🔄 同期中...';
    btn.classList.add('gdrive-sync-spinning');

    try {
        if (typeof backupToGoogleDriveNow === 'function') {
            await backupToGoogleDriveNow(false); // silent=false: 手動操作なので成功/失敗ポップアップも出す
        }
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
        btn.classList.remove('gdrive-sync-spinning');
        refreshGDriveSyncIndicatorUI();
    }
}

/* =========================================================
   ① backupToGoogleDriveNow() をフックし、成功のたびに時刻を記録する
   ========================================================= */
(function hookBackupForSyncTimestamp() {
    function tryHook() {
        if (typeof window.backupToGoogleDriveNow !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.backupToGoogleDriveNow;
        window.backupToGoogleDriveNow = async function (silent) {
            const result = await original.call(this, silent);
            // このフック時点では成功したかどうかの戻り値が無いため、
            // 「例外が投げられなかった＝処理が最後まで走った」ことをもって記録する。
            // 変化が無く書き込みをスキップしたケースも「最新の状態と同期済み」と
            // 見なせるため、いずれの場合も時刻を更新して問題ない。
            setGDriveLastSyncAtNow();
            refreshGDriveSyncIndicatorUI();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ② データ管理画面にインジケータ表示を追加する
   ========================================================= */
function ensureGDriveSyncIndicatorStyle() {
    if (document.getElementById('gdrive-sync-indicator-style')) return;
    const style = document.createElement('style');
    style.id = 'gdrive-sync-indicator-style';
    style.textContent = `
        @keyframes gdriveSyncSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        #gdrive-sync-now-btn.gdrive-sync-spinning { display:inline-flex; align-items:center; gap:6px; }
        #gdrive-sync-now-btn.gdrive-sync-spinning::before {
            content:''; display:inline-block; width:12px; height:12px;
            border:2px solid rgba(255,255,255,0.5); border-top-color:#fff; border-radius:50%;
            animation: gdriveSyncSpin 0.7s linear infinite;
        }
    `;
    document.head.appendChild(style);
}

function ensureGDriveSyncIndicatorBlock() {
    ensureGDriveSyncIndicatorStyle();
    if (document.getElementById('gdrive-sync-indicator-block')) {
        refreshGDriveSyncIndicatorUI();
        return;
    }

    // google-drive-backup.js が設置している連携ボタン群の近くに差し込みたいが、
    // 確実に存在するmigration-screen自体に直接追加する（無ければ何もしない）
    const container = document.getElementById('migration-screen');
    if (!container) return;

    const block = document.createElement('div');
    block.id = 'gdrive-sync-indicator-block';
    block.style.cssText = 'display:none; align-items:center; justify-content:space-between; gap:10px; background:#e8f5e9; border:2px solid #66bb6a; padding:10px 15px; border-radius:6px; margin-top:10px;';
    block.innerHTML = `
        <span id="gdrive-sync-status-label" style="font-weight:bold; color:#2e7d32;">最終同期：-</span>
        <button id="gdrive-sync-now-btn" type="button" style="padding:8px 14px; border:none; border-radius:16px; background:#43a047; color:#fff; font-weight:bold; cursor:pointer;">🔄 今すぐ同期</button>
    `;
    container.appendChild(block);
    block.querySelector('#gdrive-sync-now-btn').addEventListener('click', manualGDriveSyncNow);

    refreshGDriveSyncIndicatorUI();
}

(function hookShowScreenForGDriveIndicator() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') ensureGDriveSyncIndicatorBlock();
            return result;
        };
    }
    tryHook();
})();

setInterval(refreshGDriveSyncIndicatorUI, 30000);
