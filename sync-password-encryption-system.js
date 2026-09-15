// ==========================================
// sync-password-encryption-system.js
// ------------------------------------------
// このファイルも index.html / shop-id-system.js / sync-system.js を
// 直接編集せず、他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【背景】
// これまでは店舗ID（数字10桁）だけが「同じお店の端末どうしかどうか」の
// 目印になっていた。店舗IDは各端末の画面に平文で表示され、口頭や
// メモで他の端末に伝える運用のため、万が一第三者に店舗IDだけが
// 知られてしまうと（総当たりも含め）、Ably経由でやり取りしている
// 商品・お会計履歴・顧客データ・各種設定などがすべて見えてしまう
// 可能性があった。
//
// 【この機能】
// 店舗IDとは別に「同期用パスワード」（英数字混合・4〜8文字）を
// 追加する。このパスワードから作った暗号鍵で、Ablyのチャンネルの
// やり取り自体を暗号化する（Ablyの「チャンネル暗号化」という
// 標準機能を利用する）。これにより、
//   ・正しい同期用パスワードを設定していない端末は、たとえ同じ
//     店舗IDでAblyチャンネルに繋がっても、送られてくるデータを
//     正しく読み取れない（＝実質的にデータを受信できない）
//   ・同じお店の端末どうしは、店舗IDに加えてこの同期用パスワードも
//     必ず「同じ」値に揃える必要がある
// という形になる。
//
// 【方式：なぜこの実装で「他のファイルを一切変更せずに」全データを
// 　暗号化できるのか】
// sync-system.js・customer-sync-system.js・extra-settings-ably-sync.js
// など、Ablyでリアルタイム同期を行っている既存の各ファイルは、いずれも
// 共通の1つのAblyチャンネル（グローバル変数 channel）に対して
// channel.publish(...) / channel.subscribe(...) を呼んでいる
// （extra-settings-ably-sync.js内のコメントにある通り）。
// Ablyの公式JSライブラリには、チャンネル取得時
// （client.channels.get(name, {cipher:{key}})）に暗号鍵を指定すると、
// 以降そのチャンネルで送受信するメッセージの中身（data部分）を
// 自動的に暗号化・復号してくれる「チャンネル暗号化」という標準機能が
// 用意されている。
// このファイルでは、Ablyクライアントの本体（window.Ably.Realtime）を
// 上書きし、「どのファイルが」「どんな名前で」channels.get()を
// 呼び出しても、同期用パスワードが設定されていれば自動的に
// {cipher:{key: 導出した鍵}} を差し込むようにする。
// これにより、sync-system.js等が今まで通りの書き方のままでも、
// 商品・履歴・タイムカード・顧客・設定（settings-sync）・自動化
// バーコードなど、Ably経由でやり取りするデータすべてが自動的に
// 暗号化の対象になる（新しい機能が増えて新しいチャンネル・イベント名が
// 追加されても、このファイルの変更は不要）。
//
// 【鍵の作り方】
// 同期用パスワードをそのまま鍵として使うと短すぎて弱いため、
// Web Crypto API の PBKDF2（SHA-256・10万回反復）で、店舗IDを
// ソルトとして混ぜたうえで256bitの鍵に引き伸ばしてから使う
// （店舗IDが違えば、同じパスワードを入力しても別の鍵になる）。
// PBKDF2の導出自体は非同期処理だが、このファイルの読み込み時点
// （＝ページ読み込みのごく初期、Firestoreへ問い合わせてAblyの
// APIキーを取得するよりも確実に前）で先に計算を始めておくため、
// 実際にAblyのチャンネルが作られる頃には通常すでに計算が終わっている。
// 万が一チャンネル作成が計算完了より早かった場合でも、鍵の準備が
// できた時点で channel.setOptions({cipher:{key}}) を呼んで後追いで
// 暗号化を有効化するため、通信自体が壊れることはない
// （その一瞬だけ平文でやり取りされる可能性はゼロではないが、
// 　実運用上はAblyへの接続確立自体に数百ms以上かかるため、
// 　PBKDF2の計算（通常数十ms程度）のほうが先に終わるケースが
// 　ほとんどである）。
//
// 【同期用パスワードが未設定の場合】
// これまで通り、暗号化なし（平文）でAably同期する（＝今までの
// 動作のまま何も変わらない）。設定して初めて保護が有効になる、
// 店舗ID自体の導入時と同じ考え方。
//
// 【パスワードの形式】
// 「英数字混合・4〜8文字」（数字だけ・英字だけは不可、必ず両方を
// 含む）としている。もし数字だけのPINコード（例：4〜8桁の数字のみ）
// の方が良い、桁数の範囲を変えたい等あれば、ここ（SYNC_PASSWORD_REGEX）
// だけを直せば変更できる。
//
// 【pos_sync_password をAably自動同期・Google Driveバックアップの
// 対象外にする理由】
// pos_shop_id と全く同じ理由（店舗を分けるための設定であり、自動同期・
// 自動復元してしまうと他店舗・他端末の値を意図せず上書きする事故に
// なり得るため）。
// → extra-settings-ably-sync.js の ABLY_SETTINGS_EXCLUDED_KEYS、
// 　backup-extra-settings-sync.js の EXTRA_BACKUP_EXCLUDED_KEYS に、
// 　それぞれ 'pos_sync_password' を追記済み（このファイルとセットで
// 　導入すること）。
//
// 【導入方法】
// index.html内で、
//   ① Ably本体（https://cdn.ably.com/lib/ably.min-1.js）より後ろ
//   ② shop-id-system.js より後ろ（getShopId()を使うため）
//   ③ sync-system.js より前
// であればどこでも構わない（①②より前だと該当の関数・オブジェクトが
// まだ無いため待機し続けてしまい、③より後ろだと暗号化を差し込む前に
// 最初のチャンネルが作られてしまう可能性が高くなるため）。
// 具体的には、api-key-shop-id-migration-fix-system.js のすぐ後ろ
// あたりに追加するのがおすすめ。
// ==========================================

const SYNC_PASSWORD_STORAGE_KEY = 'pos_sync_password';

// 英数字混合・4〜8文字（数字のみ／英字のみは不可）
const SYNC_PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{4,8}$/;

function isValidSyncPassword(pw) {
    return typeof pw === 'string' && SYNC_PASSWORD_REGEX.test(pw);
}

/* =========================================================
   保存・取得
   ========================================================= */
function getSyncPassword() {
    try {
        const v = localStorage.getItem(SYNC_PASSWORD_STORAGE_KEY) || '';
        if (v && !isValidSyncPassword(v)) {
            // 何らかの理由で不正な形式になっている場合は、無効なものとして
            // 削除する（未設定画面に戻す。shop-id-system.jsのgetShopId()と同じ考え方）
            try { localStorage.removeItem(SYNC_PASSWORD_STORAGE_KEY); } catch (e2) { /* 無視 */ }
            return '';
        }
        return v;
    } catch (e) {
        return '';
    }
}
window.getSyncPassword = getSyncPassword;

function saveSyncPassword(value) {
    const trimmed = (value || '').trim();
    if (!isValidSyncPassword(trimmed)) {
        if (typeof playSound === 'function') playSound('error');
        alert('同期用パスワードは「英字と数字の両方を含む4〜8文字」で入力してください。');
        return false;
    }
    try {
        localStorage.setItem(SYNC_PASSWORD_STORAGE_KEY, trimmed);
    } catch (e) {
        alert('同期用パスワードの保存に失敗しました。');
        return false;
    }
    if (typeof playSound === 'function') playSound('success');
    // 暗号鍵はAablyチャンネル作成のごく初期に一度だけ計算するため、
    // 新しいパスワードを正しく使わせるにはページの再読み込みが必要
    // （saveShopId()と同じ考え方）。
    alert('同期用パスワードを保存しました。ページを再読み込みします。\n※この端末と同期させたい他の端末にも、必ず同じパスワードを設定してください（店舗IDと同様、1台だけ違うと同期できなくなります）。');
    location.reload();
    return true;
}
window.saveSyncPassword = saveSyncPassword;

/* =========================================================
   同期用パスワード（＋店舗ID）から、AES-256の暗号鍵を導出する
   ========================================================= */
async function deriveSyncCipherKeyBytes(password, shopId) {
    if (!(window.crypto && window.crypto.subtle)) {
        throw new Error('SUBTLE_CRYPTO_UNAVAILABLE'); // https等のセキュアコンテキストが必要
    }
    const enc = new TextEncoder();
    const baseKey = await window.crypto.subtle.importKey(
        'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const salt = enc.encode('haru-regi-sync-password:' + (shopId || 'default'));
    const bits = await window.crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        256
    );
    return bits; // ArrayBuffer（32バイト＝256bit）。Ablyのcipher.keyにそのまま渡せる形式。
}

// 同じパスワード・店舗IDの間は再計算しないよう、結果（Promise）をキャッシュする
let cachedSyncCipherKeyPromise = null;
let cachedSyncCipherKeyFor = null; // 'パスワード::店舗ID' の組み合わせを記録

function getSyncCipherKeyPromise() {
    const password = getSyncPassword();
    if (!password) return null; // 未設定 → 暗号化しない（今まで通りの平文同期）

    const shopId = (typeof getShopId === 'function') ? (getShopId() || '') : '';
    const cacheKey = password + '::' + shopId;
    if (cachedSyncCipherKeyPromise && cachedSyncCipherKeyFor === cacheKey) {
        return cachedSyncCipherKeyPromise;
    }
    cachedSyncCipherKeyFor = cacheKey;
    cachedSyncCipherKeyPromise = deriveSyncCipherKeyBytes(password, shopId).catch((e) => {
        console.warn('同期用パスワードからの暗号鍵の作成に失敗しました（暗号化なしで動作を継続します）:', e);
        cachedSyncCipherKeyPromise = null;
        cachedSyncCipherKeyFor = null;
        throw e;
    });
    return cachedSyncCipherKeyPromise;
}

// ページ読み込み後、できるだけ早い段階で鍵の計算を開始しておく
// （実際にAablyチャンネルが作られるより先に終わらせておきたいため）
getSyncCipherKeyPromise();

/* =========================================================
   Ably.Realtime を上書きし、どのファイルが channels.get() を呼んでも
   自動的にチャンネル暗号化（cipher）を差し込むようにする
   ========================================================= */
function tpApplyCipherToChannelWhenReady(channel, requestedOptions) {
    if (requestedOptions && requestedOptions.cipher) return; // 呼び出し元が独自に暗号化指定済みなら尊重し、何もしない
    const keyPromise = getSyncCipherKeyPromise();
    if (!keyPromise) return; // パスワード未設定 → これまで通り平文のまま

    keyPromise.then((keyBytes) => {
        try {
            channel.setOptions({ cipher: { key: keyBytes } });
        } catch (e) {
            console.warn(`チャンネル「${channel && channel.name}」への暗号化設定の適用に失敗しました:`, e);
        }
    }).catch(() => { /* 鍵の作成失敗は deriveSyncCipherKeyBytes 側で警告済みなのでここでは無視 */ });
}

function tpPatchAblyClientChannelsGet(client) {
    if (!client || !client.channels || client.channels.__haruSyncPasswordPatched) return;
    const originalGet = client.channels.get.bind(client.channels);
    client.channels.get = function (name, options) {
        const channel = originalGet(name, options);
        tpApplyCipherToChannelWhenReady(channel, options);
        return channel;
    };
    client.channels.__haruSyncPasswordPatched = true;
}

(function patchAblyRealtimeForChannelEncryption() {
    function tryPatch() {
        if (typeof window.Ably === 'undefined' || typeof window.Ably.Realtime !== 'function') {
            setTimeout(tryPatch, 50);
            return;
        }
        if (window.Ably.Realtime.__haruSyncPasswordPatched) return;

        const OriginalRealtime = window.Ably.Realtime;

        // 【重要】コンストラクタ関数がオブジェクトを明示的にreturnした場合、
        // new演算子で呼び出しても「そのreturnされたオブジェクト」の方が
        // 使われる、というJSの仕様を利用している（sync-system.js側の
        // 「new Ably.Realtime(apiKey)」という書き方は変更不要のまま）。
        function PatchedRealtime(...args) {
            const client = new OriginalRealtime(...args);
            tpPatchAblyClientChannelsGet(client);
            return client;
        }
        PatchedRealtime.prototype = OriginalRealtime.prototype;
        try { Object.setPrototypeOf(PatchedRealtime, OriginalRealtime); } catch (e) { /* 無視 */ }
        // Ably.Realtime.Crypto 等、静的メンバーを引き継ぐ
        Object.keys(OriginalRealtime).forEach((k) => {
            try { PatchedRealtime[k] = OriginalRealtime[k]; } catch (e) { /* 無視 */ }
        });
        PatchedRealtime.__haruSyncPasswordPatched = true;

        window.Ably.Realtime = PatchedRealtime;
    }
    tryPatch();
})();

/* =========================================================
   データ管理画面（migration-screen）に設定ブロックを追加する
   （見た目・操作感は shop-id-system.js の店舗IDブロックと揃えている）
   ========================================================= */
function escapeSyncPwHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSyncPasswordBlock() {
    const container = document.getElementById('sync-password-settings-container');
    if (!container) return;

    const current = getSyncPassword();

    if (current) {
        const masked = '•'.repeat(current.length);
        container.innerHTML = `
            <div class="migration-block" style="background:#e8f5e9; border:2px solid #66bb6a; padding:15px; border-radius:6px; margin-bottom:15px;">
                <h3 class="migration-title" style="color:#2e7d32;">🔐 同期用パスワード</h3>
                <p class="migration-desc">現在のパスワード：<span id="sync-pw-display" data-value="${escapeSyncPwHtml(current)}" style="font-family:monospace; font-size:15px; font-weight:bold;">${masked}</span>
                    <button type="button" onclick="tpToggleSyncPasswordVisibility()" style="margin-left:6px; padding:2px 8px; font-size:11px; border:1px solid #999; border-radius:10px; background:#fff; cursor:pointer;">👁️ 表示</button>
                </p>
                <p class="migration-desc" style="font-size:12px; color:#555;">同じお店の他の端末にも、店舗IDに加えて必ずこの同じパスワードを設定してください。1台でも違う・未設定の端末があると、その端末はデータを正しく受信できません。</p>
                <button class="btn-migration" style="background:#43a047; color:white; padding:8px 12px; border:none; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="showSyncPasswordEditForm()">変更する</button>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="migration-block" style="background:#ffebee; border:2px solid #e53935; padding:15px; border-radius:6px; margin-bottom:15px;">
                <h3 class="migration-title" style="color:#c62828;">⚠️ 同期用パスワードが未設定です</h3>
                <p class="migration-desc" style="font-size:12px; color:#555; line-height:1.6;">
                    店舗IDに加えて、この同期用パスワードも設定すると、Ably経由でやり取りするデータ（商品・お会計履歴・顧客・各種設定など）が暗号化され、
                    正しいパスワードを設定していない端末では中身を受信できなくなります。
                    英字と数字を両方含む4〜8文字で、お店ごとに決めてください。
                </p>
                <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                    <input type="text" id="sync-pw-input" maxlength="8" placeholder="例：ab12cd" style="flex:1; min-width:160px; padding:8px; border:1px solid #ccc; border-radius:4px;">
                    <button class="btn-migration" style="background:#e53935; color:white; padding:8px 14px; border:none; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="saveSyncPassword(document.getElementById('sync-pw-input').value)">保存</button>
                </div>
            </div>
        `;
    }
}
window.renderSyncPasswordBlock = renderSyncPasswordBlock;

function tpToggleSyncPasswordVisibility() {
    const el = document.getElementById('sync-pw-display');
    if (!el) return;
    const real = el.getAttribute('data-value') || '';
    const isMasked = el.innerText !== real;
    el.innerText = isMasked ? real : '•'.repeat(real.length);
}
window.tpToggleSyncPasswordVisibility = tpToggleSyncPasswordVisibility;

function showSyncPasswordEditForm() {
    const container = document.getElementById('sync-password-settings-container');
    if (!container) return;
    container.innerHTML = `
        <div class="migration-block" style="background:#e8f5e9; border:2px solid #66bb6a; padding:15px; border-radius:6px; margin-bottom:15px;">
            <h3 class="migration-title" style="color:#2e7d32;">🔐 同期用パスワードを変更</h3>
            <p class="migration-desc" style="font-size:12px; color:#c62828; line-height:1.6;">
                ⚠️ 変更すると、これまでこの端末が使っていた暗号鍵とは別のものになります。
                他の端末と同期させたい場合は、必ず全端末を同じパスワードに揃えてください。
            </p>
            <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                <input type="text" id="sync-pw-input" maxlength="8" placeholder="英字＋数字 4〜8文字" style="flex:1; min-width:160px; padding:8px; border:1px solid #ccc; border-radius:4px;">
                <button class="btn-migration" style="background:#43a047; color:white; padding:8px 14px; border:none; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="saveSyncPassword(document.getElementById('sync-pw-input').value)">保存</button>
                <button class="btn-migration" style="background:#fff; color:#555; border:1px solid #999; padding:8px 14px; border-radius:4px; cursor:pointer;" onclick="renderSyncPasswordBlock()">キャンセル</button>
            </div>
        </div>
    `;
}
window.showSyncPasswordEditForm = showSyncPasswordEditForm;

/* =========================================================
   #shop-id-settings-container のすぐ後ろに、このブロック用の
   受け皿を自分で作って差し込む（shop-id-system.jsとは異なり、
   専用の受け皿がindex.html側に用意されていないため）
   ========================================================= */
function ensureSyncPasswordContainer() {
    if (document.getElementById('sync-password-settings-container')) {
        renderSyncPasswordBlock();
        return;
    }
    const shopIdContainer = document.getElementById('shop-id-settings-container');
    const migrationScreen = document.getElementById('migration-screen');

    const div = document.createElement('div');
    div.id = 'sync-password-settings-container';

    if (shopIdContainer && shopIdContainer.parentNode) {
        shopIdContainer.insertAdjacentElement('afterend', div);
    } else if (migrationScreen) {
        migrationScreen.appendChild(div);
    } else {
        return; // データ管理画面自体が無ければ何もしない
    }
    renderSyncPasswordBlock();
}

(function hookShowScreenForSyncPasswordBlock() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') ensureSyncPasswordContainer();
            return result;
        };
    }
    tryHook();
})();
