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
const APP_VERSION = 'v3.0.65';

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
const UPDATE_CHECK_INTERVAL_MS = 60 * 1000; // 1分ごと
const UPDATE_CHECK_MIN_GAP_MS = 30 * 1000; // タブに戻った時の再チェックは、前回から最低30秒あける
let lastAppUpdateCheckAt = 0;

// 【不具合修正】latest !== APP_VERSION（「違えば通知」）だと、push直後の
// CDN反映の途中で、まだ古いファイルを返す経路に当たった場合に、
// すでに新しい版を使っている端末へ「新しいバージョンがあります（古い版の番号）」と
// 逆向きの通知を出してしまう。数字として比べ、サーバー側の方が
// 「新しい」時だけ通知する（v3.0.9 < v3.0.10 も正しく比べられる）。
function isNewerAppVersion(latest, current) {
    const toNums = (v) => (String(v).match(/\d+/g) || []).map(Number);
    const a = toNums(latest);
    const b = toNums(current);
    // 数字で比べられない形式の場合は、従来どおり「違えば通知」にする
    if (a.length === 0 || b.length === 0) return latest !== current;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const x = a[i] || 0;
        const y = b[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
    }
    return false;
}

// 【不具合修正】リロード直前に、今ページが使っているindex.html／JS／CSSを
// 「HTTPキャッシュを使わず」取り直しておく。GitHub Pagesのファイルには
// Cache-Control: max-age=600が付くため、直近10分以内に取得したファイルが
// あると、location.reload()しても（Chromeは再読み込み時にメインのHTML以外を
// 再確認しないため）古いファイルがそのまま使われ、バージョンが変わらない
// 現象が起きていた。cache:'reload'で取得するとHTTPキャッシュ自体が最新に
// 上書きされるので、そのあとのリロードで確実に新しい版が使われる。
async function refreshAppAssetsBypassingHttpCache() {
    const urls = new Set();
    urls.add(location.origin + location.pathname);
    document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach((el) => {
        const u = el.src || el.href;
        if (u && u.startsWith(location.origin)) urls.add(u);
    });
    const all = Promise.all([...urls].map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
    // 通信が遅くても、リロードが延々と始まらないよう最大8秒で切り上げる
    const timeout = new Promise((resolve) => setTimeout(resolve, 8000));
    await Promise.race([all, timeout]);
}

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

// 客用画面・タッチパネル・呼び出し画面（お席案内）・セルフレジでは、バージョン表示を出さない
function isBadgeHiddenScreen() {
    const shown = (id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0);
    };
    try {
        if (isTouchPanelInUse()) return true;
        if (typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice()) return true;
        const cs = document.getElementById('customer-screen');
        if (cs && cs.classList.contains('active')) return true;
        return ['touch-panel-overlay', 'seat-guide-overlay', 'self-checkout-root'].some(shown);
    } catch (e) { return false; }
}
setInterval(() => {
    const b = document.getElementById('app-version-badge');
    if (b) b.style.display = isBadgeHiddenScreen() ? 'none' : '';
}, 500);

/* =========================================================
   ② 新バージョン通知バナー
   ========================================================= */
// 【追加】タッチパネル（お客様が操作する画面）を表示している間は、更新の通知もリロードも
// 行わない。リロードされると操作中の画面が初期化され、入力途中の個人情報が
// 消える／見えてしまうため。タッチパネルから離れたあとの次回チェックで通知する。
function isTouchPanelInUse() {
    try {
        if (typeof window.tpGuardDebug === 'function') return !!window.tpGuardDebug();
        if (document.getElementById('seat-guide-overlay')) return true;
    } catch (e) {}
    return false;
}

function showUpdateAvailableNotice(latestVersion) {
    if (document.getElementById('app-update-notice')) return;
    if (isTouchPanelInUse()) return;

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

    notice.querySelector('#app-update-reload-btn').addEventListener('click', async (ev) => {
        // 連打防止＋「押した」ことが分かるように表示を変える
        if (isTouchPanelInUse()) return; // タッチパネル操作中はリロードしない
        const reloadBtn = ev.currentTarget;
        reloadBtn.disabled = true;
        reloadBtn.textContent = '更新中…';
        // 【不具合修正】location.reload()だけだと、Service Workerや
        // ブラウザのキャッシュに残っている「古いファイル」がそのまま
        // 再度読み込まれてしまい、バージョンが変わらないまま
        // 「新しいバージョンがあります」が繰り返し表示され続ける
        // という現象が起きていた。
        // リロード前にCache Storageを空にし、Service Workerの登録も
        // 解除しておくことで、次の読み込みが確実にネットワークから
        // 最新ファイルを取得するようにする。
        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
            }
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.unregister()));
            }
            // ※必ず上のキャッシュ削除より「後」に行うこと。先に行うと、まだ生きている
            //   古いService Workerが、Cache Storageの古いコピーをそのまま返してしまう。
            await refreshAppAssetsBypassingHttpCache();
        } catch (err) {
            console.warn('キャッシュ削除に失敗しました（そのままリロードします）:', err);
        } finally {
            location.reload();
        }
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
    lastAppUpdateCheckAt = Date.now();

    try {
        const bustUrl = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
        const res = await fetch(bustUrl, { cache: 'no-store' });
        if (!res.ok) return;
        const text = await res.text();
        const match = text.match(/const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
        if (!match) return;

        const latestVersion = match[1];
        if (latestVersion && isNewerAppVersion(latestVersion, APP_VERSION)) {
            showUpdateAvailableNotice(latestVersion);
            autoApplyUpdate(latestVersion);
        }
    } catch (err) {
        // オフライン・通信エラー時は静かに諦める（レジ操作自体は継続できるようにする）
        console.warn('アップデート確認に失敗しました（オフラインの可能性があります）:', err);
    }
}

// 新しい版が見つかったら、すぐ自動で更新（リロード）する。
// ・タッチパネル（お客様の画面・お席案内）を表示している端末は、これまで通り自動更新しない
// ・会計の途中（カートに商品がある）の間は待ち、空になってから更新する
// ・同じ版への自動更新は1タブ1回まで（古いキャッシュが残って無限に再読み込みするのを防ぐ）
const AUTO_UPDATE_DONE_KEY = 'pos_auto_update_done_version';
let autoUpdateWaiting = false;
function autoApplyUpdate(latestVersion) {
    try { if (sessionStorage.getItem(AUTO_UPDATE_DONE_KEY) === latestVersion) return; } catch (e) {}
    if (autoUpdateWaiting) return;
    autoUpdateWaiting = true;
    const tryNow = () => {
        if (isTouchPanelInUse()) { autoUpdateWaiting = false; return; }
        let busy = false;
        try { busy = (typeof cart !== 'undefined' && Array.isArray(cart) && cart.length > 0); } catch (e) {}
        if (busy) { setTimeout(tryNow, 5000); return; }
        try { sessionStorage.setItem(AUTO_UPDATE_DONE_KEY, latestVersion); sessionStorage.removeItem(UPDATE_CHECK_DISMISSED_KEY); } catch (e) {}
        showUpdateAvailableNotice(latestVersion);
        const b = document.getElementById('app-update-reload-btn');
        if (b) b.click(); else location.reload();
    };
    tryNow();
}

document.addEventListener('DOMContentLoaded', () => {
    ensureVersionBadge();
    setInterval(() => {
        const n = document.getElementById('app-update-notice');
        if (n && isTouchPanelInUse()) n.remove();
    }, 1000);
    // 起動直後はまだ読み込み中の可能性があるため少し待ってから初回チェック
    setTimeout(checkForAppUpdate, 10000);
    setInterval(checkForAppUpdate, UPDATE_CHECK_INTERVAL_MS);

    // 【追加】タブ／アプリを開き直した（画面に戻ってきた）時にもすぐ確認する。
    // タブレット等ではバックグラウンド中にsetIntervalが止まることがあり、
    // 「push後、しばらく開いていなかった端末に戻ったら古いまま」を減らすため。
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - lastAppUpdateCheckAt < UPDATE_CHECK_MIN_GAP_MS) return;
        checkForAppUpdate();
    });
});
