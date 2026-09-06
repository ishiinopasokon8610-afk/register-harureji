// ==========================================
// update-notification-system.js
// ------------------------------------------
// 【背景】
// GitHub Pages等でアプリを更新しても、利用者のブラウザに古いキャッシュが
// 残っていると、新機能が動かない・修正済みのはずの不具合が再現する、
// といったことが起きやすい。
//
// 【この機能】
// ① 画面右下に小さくバージョン番号（例: v1.0.0）を常時表示する。
// ② このファイル自体を定期的に（キャッシュを使わず）再取得し、
//    埋め込まれている APP_VERSION の値が今表示しているものと
//    変わっていたら「新しいバージョンがあります。タップしてリロード」
//    という小さな通知を出す（自動リロードはしない＝会計中に
//    突然リロードされて困る、という事態を避けるため）。
// ③ 通知は一度閉じたら、そのタブを閉じる／リロードするまでは
//    再表示しない（sessionStorageで管理。リロードすれば当然
//    新バージョンになっているので、その時点で通知自体が出なくなる）。
//
// 【運用方法】
// このファイルを新しい内容で配布・デプロイするたびに、
// 下の APP_VERSION の値を書き換えてください（例: 'v1.0.0' → 'v1.0.1'）。
// それだけで、開いたままの他端末に通知が届くようになります。
//
// index.html / ui.js は直接編集せず、DOM注入方式で実現する
// （他の追加機能ファイルと同じ方式）。
// ==========================================

// ★リリースのたびに、この値を書き換えてください★
const APP_VERSION = 'v3.0.1';

// このファイル自身のURL（script要素のsrcから逆算する。
// index.html側でファイル名を変更・移動していても追従できるようにするため）
function getSelfScriptUrl() {
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src || '';
        if (src.includes('update-notification-system.js')) return src;
    }
    return null;
}

const UPDATE_CHECK_DISMISSED_KEY = 'pos_update_notice_dismissed_version';
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5分ごと

/* =========================================================
   ① バージョン表示（画面右下）
   ========================================================= */
// 【不具合修正】index.htmlの「常に右下の時計」(#global-clock)も同じ
// 右下の角に固定表示されるため、このバージョン表示とぴったり重なって
// どちらも読みづらくなっていた。時計と衝突しない左下の角に変更する
// （左下は他の追加機能ファイルも使っていない空きスペース）。
function ensureVersionBadge() {
    if (document.getElementById('app-version-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'app-version-badge';
    badge.style.cssText = [
        'position:fixed', 'left:6px', 'bottom:4px', 'z-index:500',
        'font-size:10px', 'color:#9e9e9e', 'background:rgba(255,255,255,0.6)',
        'padding:1px 6px', 'border-radius:4px', 'pointer-events:none',
        'font-family:monospace'
    ].join(';');
    badge.innerText = APP_VERSION;
    document.body.appendChild(badge);
}

/* =========================================================
   ② 新バージョン通知バナー
   ========================================================= */
function showUpdateAvailableNotice(latestVersion) {
    if (document.getElementById('app-update-notice')) return;

    // 同じバージョンへの通知は、一度閉じたら再表示しない
    const dismissed = sessionStorage.getItem(UPDATE_CHECK_DISMISSED_KEY);
    if (dismissed === latestVersion) return;

    // タブを見ていなくても気づけるよう、デスクトップ通知（notifications-system.js）
    // が有効な場合はそちらでも知らせる（無ければ何もしない）
    if (typeof fireDesktopNotification === 'function') {
        fireDesktopNotification('🔄 新しいバージョンがあります', `${latestVersion} が公開されました。タップしてリロードしてください。`);
    }

    const notice = document.createElement('div');
    notice.id = 'app-update-notice';
    notice.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:16px', 'transform:translateX(-50%)',
        'z-index:100000', 'background:#263238', 'color:#fff', 'padding:12px 16px',
        'border-radius:24px', 'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
        'display:flex', 'align-items:center', 'gap:12px', 'font-size:13px',
        'max-width:92vw'
    ].join(';');
    notice.innerHTML = `
        <span>🔄 新しいバージョンがあります</span>
        <button id="app-update-reload-btn" style="background:#42a5f5; color:#fff; border:none; border-radius:16px; padding:6px 14px; font-weight:bold; cursor:pointer; white-space:nowrap;">リロード</button>
        <button id="app-update-dismiss-btn" style="background:transparent; color:#bbb; border:none; cursor:pointer; font-size:16px; line-height:1; padding:0 4px;">×</button>
    `;
    document.body.appendChild(notice);

    notice.querySelector('#app-update-reload-btn').addEventListener('click', () => {
        location.reload();
    });
    notice.querySelector('#app-update-dismiss-btn').addEventListener('click', () => {
        sessionStorage.setItem(UPDATE_CHECK_DISMISSED_KEY, latestVersion);
        notice.remove();
    });
}

/* =========================================================
   ③ 定期チェック：このファイル自身をキャッシュ無視で再取得し、
      APP_VERSION の値を比較する
   ========================================================= */
async function checkForAppUpdate() {
    const url = getSelfScriptUrl();
    if (!url) return; // 直接<script>で読み込まれていない環境（想定外）では何もしない

    try {
        const bustUrl = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
        const res = await fetch(bustUrl, { cache: 'no-store' });
        if (!res.ok) return;
        const text = await res.text();
        const match = text.match(/const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
        if (!match) return;

        const latestVersion = match[1];
        if (latestVersion && latestVersion !== APP_VERSION) {
            showUpdateAvailableNotice(latestVersion);
        }
    } catch (err) {
        // オフライン・通信エラー時は静かに諦める（レジ操作自体は継続できるようにする）
        console.warn('アップデート確認に失敗しました（オフラインの可能性があります）:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ensureVersionBadge();
    // 起動直後はまだ読み込み中の可能性があるため少し待ってから初回チェック
    setTimeout(checkForAppUpdate, 10000);
    setInterval(checkForAppUpdate, UPDATE_CHECK_INTERVAL_MS);
});
