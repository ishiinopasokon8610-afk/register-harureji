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
// ① 店舗ID（＝合言葉）をlocalStorage（pos_shop_id）に保存・取得する。
//    window.getShopId() として公開し、index.htmlのgetShopIdForRealtimeKey()
//    がそのまま拾えるようにする（候補名のうち最優先で試される名前）。
//    ランダムな文字列ではなく「お店の人が覚えられる合言葉」を想定した
//    自由入力にしている（他の端末に伝える・控えておく際に、意味のない
//    ランダム文字列よりも間違えにくいため）。
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

const SHOP_ID_STORAGE_KEY = 'pos_shop_id';

function getShopId() {
    try {
        return localStorage.getItem(SHOP_ID_STORAGE_KEY) || '';
    } catch (e) {
        return '';
    }
}
window.getShopId = getShopId;

function saveShopId(value) {
    const trimmed = (value || '').trim();
    if (!trimmed) {
        if (typeof playSound === 'function') playSound('error');
        alert('合言葉（店舗ID）を入力してください。');
        return false;
    }
    try {
        localStorage.setItem(SHOP_ID_STORAGE_KEY, trimmed);
    } catch (e) {
        alert('合言葉の保存に失敗しました。');
        return false;
    }
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('success');
    // Ablyキーの取得はページ読み込み時（DOMContentLoaded）に一度きりの
    // 処理のため、正しい店舗IDで読み直させるためにリロードする
    // （saveApiKey()と同じ考え方）。
    alert('合言葉を保存しました。ページを再読み込みします。\n※この端末と同期させたい他の端末にも、同じ合言葉を設定してください。');
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
                <h3 class="migration-title" style="color:#2e7d32;">🏪 店舗の合言葉</h3>
                <p class="migration-desc">現在の合言葉：<span style="font-family:monospace; font-size:15px; font-weight:bold;">${escapeShopIdHtml(currentId)}</span></p>
                <p class="migration-desc" style="font-size:12px; color:#555;">同じお店の他の端末にも、必ずこの同じ合言葉を設定してください。異なる合言葉の端末とはAblyのリアルタイム同期（Ably用APIキーの保存場所）が別々になります。</p>
                <button class="btn-migration" style="background:#43a047; color:white; padding:8px 12px; border:none; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="showShopIdEditForm()">変更する</button>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="migration-block" style="background:#ffebee; border:2px solid #e53935; padding:15px; border-radius:6px; margin-bottom:15px;">
                <h3 class="migration-title" style="color:#c62828;">⚠️ 店舗の合言葉が未設定です</h3>
                <p class="migration-desc" style="font-size:12px; color:#555; line-height:1.6;">
                    未設定のままだと、Ably用APIキーの保存場所が他の端末・他のお店と共有されてしまう可能性があります。
                    同じお店の端末どうしは「同じ」合言葉に、違うお店とは「違う」合言葉にしてください
                    （お店の名前など、覚えやすい単語で構いません）。
                </p>
                <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                    <input type="text" id="shop-id-input" placeholder="例：お店の名前など" style="flex:1; min-width:160px; padding:8px; border:1px solid #ccc; border-radius:4px;">
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
            <h3 class="migration-title" style="color:#2e7d32;">🏪 合言葉を変更</h3>
            <p class="migration-desc" style="font-size:12px; color:#c62828; line-height:1.6;">
                ⚠️ 変更すると、これまでこの端末が使っていたAPIキー保存場所とは
                別の場所を見るようになります。他の端末と同期させたい場合は、
                必ず全端末を同じ合言葉に揃えてください。
            </p>
            <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                <input type="text" id="shop-id-input" value="${escapeShopIdHtml(currentId)}" style="flex:1; min-width:160px; padding:8px; border:1px solid #ccc; border-radius:4px;">
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
