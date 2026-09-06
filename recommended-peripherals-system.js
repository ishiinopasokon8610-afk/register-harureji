// ==========================================
// recommended-peripherals-system.js
// ------------------------------------------
// データ管理画面に「動作確認済みのおすすめ周辺機器」リンク集を追加する。
// リンク先はAmazonアソシエイト等のアフィリエイトリンクに差し替え可能。
// ------------------------------------------
// ★差し替え方法★
// 下の PERIPHERAL_LINKS 配列の url を、それぞれの商品のアフィリエイト
// リンクに書き換えてください（タグ未設定の場合は通常の商品リンクのままでもOK）。
//
// index.html / master-mgmt.js は直接編集せず、migration-screen が
// 表示されるタイミング（showScreen()フック）でブロックをDOMに追加する
// （order-system-settings.js と同じ「後付けブロック」方式）。
// ==========================================

const PERIPHERAL_LINKS = [
    { icon: '📷', name: 'バーコードスキャナー（1次元/2次元対応）', desc: 'スマホ画面のバーコードも読み取れるタイプがおすすめです。', url: 'https://www.amazon.co.jp/s?k=バーコードスキャナー+2次元+Bluetooth' },
    { icon: '🖨️', name: 'レシートプリンター（Bluetooth/USB）', desc: 'ブラウザ印刷（このアプリのレシート印刷）に対応した感熱式がおすすめです。', url: 'https://www.amazon.co.jp/s?k=レシートプリンター+Bluetooth+感熱' },
    { icon: '📱', name: 'タブレットスタンド', desc: 'レジ・客用画面それぞれに固定して使う場合に便利です。', url: 'https://www.amazon.co.jp/s?k=タブレットスタンド+レジ' }
];

function ensureRecommendedPeripheralsBlock() {
    if (document.getElementById('recommended-peripherals-block')) return;
    const container = document.getElementById('migration-screen');
    if (!container) return;

    const linksHtml = PERIPHERAL_LINKS.map(item => `
        <a href="${item.url}" target="_blank" rel="noopener noreferrer sponsored"
           style="display:flex; align-items:center; gap:10px; background:#fff; border:1px solid #ddd; border-radius:8px; padding:10px 12px; text-decoration:none; color:#333; margin-bottom:8px;">
            <span style="font-size:22px;">${item.icon}</span>
            <span style="flex:1;">
                <span style="font-weight:bold; display:block;">${item.name}</span>
                <span style="font-size:12px; color:#777;">${item.desc}</span>
            </span>
            <span style="color:#1565c0; font-weight:bold; white-space:nowrap;">見る →</span>
        </a>
    `).join('');

    const block = document.createElement('div');
    block.id = 'recommended-peripherals-block';
    block.className = 'migration-block';
    block.style.cssText = 'background:#fafafa; border:2px solid #bdbdbd; padding:15px; border-radius:6px; margin-top:15px;';
    block.innerHTML = `
        <h3 class="migration-title" style="color:#424242;">🛒 動作確認済みのおすすめ周辺機器</h3>
        <p style="font-size:12px; color:#777; margin:4px 0 10px;">
            ※ Amazonアソシエイト等のリンクを含みます。購入いただくと運営者に紹介料が入る場合がありますが、価格は変わりません。
        </p>
        ${linksHtml}
    `;
    container.appendChild(block);
}

(function hookShowScreenForPeripheralsBlock() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') ensureRecommendedPeripheralsBlock();
            return result;
        };
    }
    tryHook();
})();
