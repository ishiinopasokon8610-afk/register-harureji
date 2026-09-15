// ==========================================
// shop-id-system.js
// ------------------------------------------
// 【背景】
// index.html内のgetShopIdForRealtimeKey()は、店舗ごとにAblyのAPIキーを
// 分けて保存するために getShopId() / getCurrentShopId() / SHOP_ID等の
// 名前でショップIDを探しに行く作りになっていたが、それを提供する
// はずのshop-id-system.js自体がこれまで存在しておらず、常に見つからず
// 'default' にフォールバックしていた。
// つまりこのFirebaseプロジェクトを使う端末・店舗は全員が同じ
// Firestoreドキュメント（pos_realtime_settings/default）にAblyの
// APIキーを保存しており、後から設定した端末・店舗の内容で他の
// 端末・店舗の分が上書きされてしまう状態だった。
// なお、データ管理画面には <div id="shop-id-settings-container"></div>
// という、このファイルが中身を描画することを想定した受け皿が
// あらかじめ用意されていたため、このファイルではそこに描画する。
//
// 【この機能】
// ① 店舗ID（数字10桁）をlocalStorage（pos_shop_id）に保存・取得する。
//    window.getShopId() として公開し、index.htmlのgetShopIdForRealtimeKey()
//    がそのまま拾えるようにする（候補名のうち最優先で試される名前）。
//    保存時には、店舗ID自体はFirestoreに平文で送らず、SHA-256ハッシュ化
//    したうえで shops/{店舗ID}/config/auth に passphraseHash として
//    登録する（firestore.rules側の「合言葉のハッシュだけを保持する」
//    設計に対応するため）。このクラウド側の登録が失敗した場合は、
//    localStorageへの保存・画面のリロードも行わない（設定できたように
//    見えて実はクラウドに登録されていない、という状態を防ぐため）。
// ② データ管理画面（migration-screen）の #shop-id-settings-container に、
//    他の設定ブロックと同じ見た目のブロックを描画する。
//    ・未設定の場合：赤枠の警告つきで「合言葉を設定してください」の
//      入力欄を表示する（空のままだとAPIキーが他の端末・他のお店と
//      共有されてしまう旨を明記）。
//    ・設定済みの場合：現在の値を表示し、「変更」ボタンで編集できる。
//
// 【重要：この値は「端末ごと」ではなく「お店ごと」に揃える必要がある】
// 同じお店の中で複数台の端末（レジ・タッチパネル注文用タブレット等）を
// Ablyでリアルタイム同期させたい場合、それらの端末には必ず「同じ」
// 合言葉を設定する必要がある（別々の値だと、そもそも別々のFirestore
// ドキュメント＝別々のAblyチャンネルキーを見に行くことになり、
// 同期が成立しない）。逆に、別のお店が同じFirebaseプロジェクトを
// 使って導入する場合は、必ず「違う」合言葉を設定してもらう必要がある。
// 1台目の端末で決めた合言葉を、2台目以降の端末にも同じ文字列で
// 入力してもらう、という使い方を想定している。
//
// 【pos_shop_idをAably自動同期・Google Driveバックアップの対象外にする理由】
// extra-settings-ably-sync.js は「pos_で始まる設定は自動でAably同期する」
// 方針だが、pos_shop_id をこれに含めてしまうと、A店の端末とB店の端末が
// 万一同じAblyチャンネルに繋がった場合に、どちらかの合言葉でもう片方が
// 勝手に上書きされる事故が起こり得る。また、そもそも「端末ごとに意図的に
// 別の値を持たせる（＝店舗を分ける）」ための設定なので、自動同期・
// 自動復元の対象には馴染まない（pos_gdrive_connected等の「この端末固有」
// の設定と同じ扱い）。
// → extra-settings-ably-sync.js のABLY_SETTINGS_EXCLUDED_KEYSに
// 　'pos_shop_id' を追記済み（このファイルとセットで導入すること）。
// → もしGoogle Driveバックアップ側（backup-extra-settings-sync.js。
// 　今回のアップロードには含まれていなかったため未確認・未修正）にも
// 　同様の「pos_で始まる設定は自動対象」という方針がある場合は、
// 　そちらのファイルの除外リストにも 'pos_shop_id' を追記してください
// 　（同じ理由：バックアップの復元によって別端末の合言葉が意図せず
// 　上書きされるのを防ぐため）。
//
// index.html は直接編集せず、既に用意されている
// #shop-id-settings-container にDOM注入で表示部分を追加する
// （他の追加機能ファイルと同じ方式）。
//
// 【導入方法】
// index.html内には既に
//   <script src="shop-id-system.js"></script>
// の読み込みタグが用意されている（1781行目付近）ため、このファイルを
// 同じファイル名でアップロードするだけで有効になる。
// ==========================================

// 【仕様変更】店舗IDは自由入力の「合言葉」ではなく、数字10桁の形式に
// 統一しています（バリデーションは saveShopId() 内で /^\d{10}$/ を使用）。
// 上部の背景説明コメント中の「合言葉」という表現は導入経緯の記録として
// 残していますが、実際の入力形式は数字10桁です。
const SHOP_ID_STORAGE_KEY = 'pos_shop_id';

/* =========================================================
   合言葉（店舗ID）のSHA-256ハッシュをFirestoreに登録する
   ---------------------------------------------------------
   セキュリティルール側（shops/{shopId}/config/auth）が
   「合言葉そのものは保存せず、ハッシュだけを持つ」設計になっている
   ため、こちらでも合言葉の平文はFirestoreに一切送らず、
   Web Crypto API (SubtleCrypto) でSHA-256ハッシュ化してから送信する。
   ========================================================= */
async function sha256HexShopId(text) {
    if (!(window.crypto && window.crypto.subtle)) {
        // SubtleCryptoはhttps（またはlocalhost）等の「セキュアコンテキスト」
        // でのみ使用可能。http配信の場合はここで失敗する。
        throw new Error('SUBTLE_CRYPTO_UNAVAILABLE');
    }
    const data = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getFirestoreForShopIdSystem() {
    try {
        if (typeof firebase !== 'undefined' && firebase.firestore) return firebase.firestore();
    } catch (e) { /* 無視 */ }
    return null;
}

// 店舗ID（＝合言葉）のハッシュを shops/{shopId}/config/auth に登録する。
// ・そのshopIdでまだ未登録の場合：新規作成（セキュリティルールのcreate条件）。
// ・既に登録済みの場合：ハッシュはshopIdから一意に決まるため、通常は
// 　常に同じ値になり、更新の必要はない（そのまま成功として扱う）。
// 認証状態の確定待ちなどによる一時的な失敗に備え、数回リトライする
// （index.html内のloadPosApiKeyFromFirestoreと同じ考え方）。
async function registerShopPassphraseHashRaw(shopId) {
    const db = getFirestoreForShopIdSystem();
    if (!db) throw new Error('FIRESTORE_NOT_READY');
    const hash = await sha256HexShopId(shopId);
    const ref = db.collection('shops').doc(shopId).collection('config').doc('auth');
    const snap = await ref.get();
    if (!snap.exists) {
        await ref.set({ passphraseHash: hash });
    }
    // 既に存在する場合は、同じ店舗IDである以上ハッシュ値も必ず同じになるため
    // 何もしなくてよい（更新が必要になるのは、将来「合言葉」を店舗IDから
    // 切り離して別途変更できるようにした場合のみ）。
    return hash;
}

async function registerShopPassphraseHash(shopId, retries = 3, delayMs = 700) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
        try {
            return await registerShopPassphraseHashRaw(shopId);
        } catch (e) {
            lastError = e;
            console.warn(`店舗IDのハッシュ登録に失敗しました（${i + 1}/${retries}回目）:`, e);
            if (i < retries - 1) {
                await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
            }
        }
    }
    throw lastError || new Error('UNKNOWN_ERROR');
}

function getShopId() {
    try {
        const v = localStorage.getItem(SHOP_ID_STORAGE_KEY) || '';
        if (v && !/^\d{10}$/.test(v)) {
            // 以前のバージョン（英字などを含む自由入力の合言葉）で保存された
            // 値や、何らかの理由で数字10桁になっていない値は、無効なものとして
            // 実際に削除し、改めて数字10桁で設定し直してもらう（未設定画面に戻す）。
            try { localStorage.removeItem(SHOP_ID_STORAGE_KEY); } catch (e2) { /* 無視 */ }
            return '';
        }
        return v;
    } catch (e) {
        return '';
    }
}
window.getShopId = getShopId;

async function saveShopId(value) {
    const trimmed = (value || '').trim().replace(/[^0-9]/g, '');
    if (!trimmed) {
        if (typeof playSound === 'function') playSound('error');
        alert('店舗IDを入力してください。');
        return false;
    }
    if (!/^\d{10}$/.test(trimmed)) {
        if (typeof playSound === 'function') playSound('error');
        alert('店舗IDは数字10桁で入力してください。');
        return false;
    }

    // クラウド側（Firestore: shops/{shopId}/config/auth）への
    // ハッシュ登録が成功して初めて、この端末の設定として確定させる。
    // ここで失敗した場合はlocalStorageも書き換えず、リロードもしない
    // （「見た目上は設定できたのにクラウドには登録されていない」という
    // 状態を防ぐため）。
    try {
        await registerShopPassphraseHash(trimmed);
    } catch (e) {
        console.error('店舗IDのクラウド登録に失敗しました:', e);
        if (typeof playSound === 'function') playSound('error');
        alert('店舗IDのクラウド側への登録に失敗しました。通信環境をご確認のうえ、もう一度お試しください。\n（この端末には保存されていません）');
        return false;
    }

    try {
        localStorage.setItem(SHOP_ID_STORAGE_KEY, trimmed);
    } catch (e) {
        alert('店舗IDの保存に失敗しました。');
        return false;
    }
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('success');
    // Ablyキーの取得はページ読み込み時（DOMContentLoaded）に一度きりの
    // 処理のため、正しい店舗IDで読み直させるためにリロードする
    // （saveApiKey()と同じ考え方）。
    alert('店舗ID（10桁の数字）を保存しました。ページを再読み込みします。\n※この端末と同期させたい他の端末にも、同じ店舗IDを設定してください。');
    location.reload();
    return true;
}
window.saveShopId = saveShopId;

/* =========================================================
   #shop-id-settings-container に設定ブロックを描画する
   ========================================================= */
function escapeShopIdHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderShopIdBlock() {
    const container = document.getElementById('shop-id-settings-container');
    if (!container) return;

    const currentId = getShopId();

    if (currentId) {
        container.innerHTML = `
            <div class="migration-block" style="background:#e8f5e9; border:2px solid #66bb6a; padding:15px; border-radius:6px; margin-bottom:15px;">
                <h3 class="migration-title" style="color:#2e7d32;">🏪 店舗ID</h3>
                <p class="migration-desc">現在の店舗ID：<span style="font-family:monospace; font-size:15px; font-weight:bold;">${escapeShopIdHtml(currentId)}</span></p>
                <p class="migration-desc" style="font-size:12px; color:#555;">同じお店の他の端末にも、必ずこの同じ店舗ID（数字10桁）を設定してください。異なる店舗IDの端末とはAblyのリアルタイム同期（Ably用APIキーの保存場所）が別々になります。</p>
                <button class="btn-migration" style="background:#43a047; color:white; padding:8px 12px; border:none; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="showShopIdEditForm()">変更する</button>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="migration-block" style="background:#ffebee; border:2px solid #e53935; padding:15px; border-radius:6px; margin-bottom:15px;">
                <h3 class="migration-title" style="color:#c62828;">⚠️ 店舗IDが未設定です</h3>
                <p class="migration-desc" style="font-size:12px; color:#555; line-height:1.6;">
                    未設定のままだと、Ably用APIキーの保存場所が他の端末・他のお店と共有されてしまう可能性があります。
                    同じお店の端末どうしは「同じ」店舗IDに、違うお店とは「違う」店舗IDにしてください
                    （数字10桁で、お店ごとに決めてください）。
                </p>
                <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                    <input type="text" id="shop-id-input" inputmode="numeric" pattern="\\d{10}" maxlength="10" placeholder="例：1234567890" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)" style="flex:1; min-width:160px; padding:8px; border:1px solid #ccc; border-radius:4px;">
                    <button class="btn-migration" style="background:#e53935; color:white; padding:8px 14px; border:none; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="saveShopId(document.getElementById('shop-id-input').value)">保存</button>
                </div>
            </div>
        `;
    }
}
window.renderShopIdBlock = renderShopIdBlock;

function showShopIdEditForm() {
    const container = document.getElementById('shop-id-settings-container');
    if (!container) return;
    const currentId = getShopId();
    container.innerHTML = `
        <div class="migration-block" style="background:#e8f5e9; border:2px solid #66bb6a; padding:15px; border-radius:6px; margin-bottom:15px;">
            <h3 class="migration-title" style="color:#2e7d32;">🏪 店舗IDを変更</h3>
            <p class="migration-desc" style="font-size:12px; color:#c62828; line-height:1.6;">
                ⚠️ 変更すると、これまでこの端末が使っていたAPIキー保存場所とは
                別の場所を見るようになります。他の端末と同期させたい場合は、
                必ず全端末を同じ店舗ID（数字10桁）に揃えてください。
            </p>
            <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                <input type="text" id="shop-id-input" inputmode="numeric" pattern="\\d{10}" maxlength="10" value="${escapeShopIdHtml(currentId)}" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)" style="flex:1; min-width:160px; padding:8px; border:1px solid #ccc; border-radius:4px;">
                <button class="btn-migration" style="background:#43a047; color:white; padding:8px 14px; border:none; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="saveShopId(document.getElementById('shop-id-input').value)">保存</button>
                <button class="btn-migration" style="background:#fff; color:#555; border:1px solid #999; padding:8px 14px; border-radius:4px; cursor:pointer;" onclick="renderShopIdBlock()">キャンセル</button>
            </div>
        </div>
    `;
}
window.showShopIdEditForm = showShopIdEditForm;

(function initShopIdBlock() {
    function tryInit() {
        if (!document.getElementById('shop-id-settings-container')) {
            setTimeout(tryInit, 300);
            return;
        }
        renderShopIdBlock();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
})();
