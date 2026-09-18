// ==========================================
// google-drive-token-local-cache-system.js
// ------------------------------------------
// このファイルも index.html / google-drive-backup.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【背景】
// AblyのAPIキー（ably-api-key-local-cache-system.js）と同じ問題が、
// Google Driveのアクセストークンにもあった。
// google-drive-backup.js は取得したアクセストークンを
// gDriveAccessToken / gDriveAccessTokenExpiresAt というトップレベルの
// 変数にのみ保持しており、localStorageには一切保存していなかった。
// そのため、店舗ID変更時の自動リロード（shop-id-system.js の
// saveShopId()）など、ページが再読み込みされるたびにトークンが
// 失われ、次にバックアップが必要になった時点で ensureGoogleDriveToken()
// 経由の再認証が必要になっていた（自動実行時は画面を一切出さない設計
// のため、実質的にその回の自動バックアップがスキップされてしまう）。
//
// 【今回の対応】
// Ablyキーの時と同じ考え方で、Google Driveのアクセストークンも
// localStorageへキャッシュしておく（キー：pos_gdrive_token_cache）。
//   ・ページ読み込み時：キャッシュされたトークンがまだ有効期限内で
//     あれば、google-drive-backup.js側の変数（gDriveAccessToken /
//     gDriveAccessTokenExpiresAt）に復元してから使う。
//   ・connectGoogleDrive() で新しいトークンを取得できた場合：
//     常に最新の値でキャッシュを上書きする。
// アクセストークン自体はGoogle側の仕様で数時間ほどで失効するため、
// あくまで「ページを再読み込みした直後、まだ有効期限が残っている間
// だけ再認証を省ける」という限定的な効果だが、店舗ID設定直後の
// 自動リロード等で毎回接続が切れたように見える不便さは解消できる。
//
// 【重要：前提にしていること】
// google-drive-backup.js は gDriveAccessToken / gDriveAccessTokenExpiresAt を
// トップレベルの let 宣言で持っている（window.gDriveAccessTokenのような
// windowプロパティではない）。通常の<script>タグ（type="module"では
// ない）は同じページ内でトップレベルの字句スコープを共有するため、
// 後から読み込む本ファイルからも、同じ変数として直接参照・代入できる
// （extra-settings-ably-sync.js が channel 変数を同じ方法で参照している
// のと同じ仕組み）。google-drive-backup.js側の実装がこの前提と違う形に
// 変わった場合は、この直接参照の部分だけ直す必要がある。
//
// 【導入方法】
// index.html内で、google-drive-backup.js より後ろに読み込んでください。
//   <script src="google-drive-backup.js"></script>
//   <script src="google-drive-token-local-cache-system.js"></script>
// ==========================================

const GDRIVE_TOKEN_CACHE_KEY = 'pos_gdrive_token_cache';

function loadCachedGoogleDriveTokenIntoMemory() {
    try {
        const raw = localStorage.getItem(GDRIVE_TOKEN_CACHE_KEY);
        if (!raw) return;
        const cached = JSON.parse(raw);
        if (!cached || !cached.token || !cached.expiresAt) return;
        if (Date.now() >= cached.expiresAt - 60 * 1000) return; // 既に失効・まもなく失効しているものは使わない

        if (typeof gDriveAccessToken !== 'undefined') {
            gDriveAccessToken = cached.token;
            gDriveAccessTokenExpiresAt = cached.expiresAt;
        }
    } catch (e) {
        // キャッシュが壊れていた場合は無視する（これまで通り未接続扱いになるだけ）
    }
}

function saveGoogleDriveTokenToLocalCache() {
    try {
        if (typeof gDriveAccessToken === 'undefined' || !gDriveAccessToken) return;
        localStorage.setItem(GDRIVE_TOKEN_CACHE_KEY, JSON.stringify({
            token: gDriveAccessToken,
            expiresAt: (typeof gDriveAccessTokenExpiresAt !== 'undefined') ? gDriveAccessTokenExpiresAt : 0
        }));
    } catch (e) {
        // 無視
    }
}

/* =========================================================
   ① ページ読み込み時、有効なキャッシュがあれば変数に復元する
   ========================================================= */
(function tryRestoreGoogleDriveTokenOnLoad() {
    function attempt() {
        if (typeof gDriveAccessToken === 'undefined') {
            setTimeout(attempt, 300);
            return;
        }
        loadCachedGoogleDriveTokenIntoMemory();
    }
    attempt();
})();

/* =========================================================
   ② connectGoogleDrive() で新しいトークンを取得できたら、
   　 キャッシュを常に最新化する
   ========================================================= */
(function hookConnectGoogleDriveForTokenCaching() {
    function tryHook() {
        if (typeof window.connectGoogleDrive !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.connectGoogleDrive;
        window.connectGoogleDrive = async function (...args) {
            const result = await original.apply(this, args);
            saveGoogleDriveTokenToLocalCache();
            return result;
        };
    }
    tryHook();
})();
