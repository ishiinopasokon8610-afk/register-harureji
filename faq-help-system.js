// ==========================================
// faq-help-system.js
// ------------------------------------------
// 【背景】
// アプリ自体に不具合が無くても、利用者側の環境要因で必ず起きる
// 問い合わせがある（Google Driveに繋がらない、バーコードスキャナーで
// 文字化け・誤動作する等）。これらの解決方法をあらかじめ設定画面に
// 置いておくことで、開発者への問い合わせ対応の手間を減らす。
//
// 【この機能】
// データ管理画面(migration-screen)に「❓ よくある質問・トラブルシューティング」
// ブロックを追加する。各項目はクリックで開閉するアコーディオン形式。
//
// index.html / master-mgmt.js は直接編集せず、migration-screenが
// 表示されるタイミング（showScreen()フック）でブロックをDOMに追加する
// （他の追加機能ファイルと同じ「後付けブロック」方式）。
//
// 【今後、項目を追加する場合】
// 下の FAQ_ITEMS 配列に { q, a } を追加するだけでよい。
// ==========================================

const FAQ_ITEMS = [
    {
        q: 'Google Driveに接続できない／連携ボタンを押しても反応しない',
        a: 'ブラウザの「サードパーティCookieのブロック」機能が原因になっていることがあります。Chromeの場合はアドレスバー右側の設定アイコンからこのサイトのCookieを許可するか、シークレットモード（プライベートブラウジング）ではなく通常モードでお試しください。また、拡張機能（広告ブロッカー等）がGoogleとの通信をブロックしている場合もあるため、一時的に無効にしてお試しいただくのも有効です。それでも解決しない場合は、一度ログアウトし、ブラウザを再起動してから再度連携をお試しください。'
    },
    {
        q: 'バーコードスキャナーで読み込むと文字化けする／勝手に改行されて会計されてしまう',
        a: '多くのバーコードスキャナーは「読み取った文字の末尾に改行(Enter)を自動送信する」設定になっており、この設定が原因で意図せず即座に会計処理（Enterキー相当の送信）が走ってしまうことがあります。スキャナー本体の設定シート（メーカー提供のマニュアルに付属のバーコード）で「サフィックス（末尾文字）：なし」に変更するか、逆に本アプリの入力欄はEnterで確定する仕様のため、通常はこの改行設定のままで問題なく使えます。文字化けする場合は、スキャナーの読み取りモードが「JAN/EAN」等の対象規格に対応しているか、また文字コード設定（UTF-8等）をご確認ください。'
    },
    {
        q: '売上データが急に消えた／計算が合わない気がする',
        a: 'まず、他の端末やGoogle Driveバックアップに直近のデータが残っていないかをご確認ください。本アプリはブラウザのlocalStorageにデータを保存しているため、ブラウザの「閲覧データを削除」操作や、シークレットモードでの利用、端末の初期化などによってデータが失われることがあります。データ管理画面のJSONバックアップ・Google Drive連携・XLSX出力を、営業終了後などのタイミングで定期的にご利用いただくことを強くおすすめします。'
    },
    {
        q: '複数の端末で内容が食い違う（片方にしか反映されない）',
        a: '複数端末で運用する場合は、Ablyによるリアルタイム同期が必要です。全ての端末で同じ店舗ID・接続設定になっているか、また各端末が同時にオンラインになっているかをご確認ください。一時的に通信が途切れていた端末は、後から再接続された際にその時点の内容で上書きされる場合があります。'
    }
];

/* =========================================================
   ① データ管理画面へのブロック追加
   ========================================================= */
function ensureFaqHelpBlock() {
    if (document.getElementById('faq-help-block')) return;
    const container = document.getElementById('migration-screen');
    if (!container) return;

    const itemsHtml = FAQ_ITEMS.map((item, i) => `
        <div class="faq-item" style="border:1px solid #ddd; border-radius:6px; margin-bottom:8px; overflow:hidden;">
            <button type="button" class="faq-question-btn" data-faq-index="${i}" style="width:100%; text-align:left; background:#f5f5f5; border:none; padding:12px 14px; font-weight:bold; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <span>Q. ${escapeFaqHtml(item.q)}</span>
                <span class="faq-toggle-icon" style="flex-shrink:0;">▼</span>
            </button>
            <div class="faq-answer" style="display:none; padding:12px 14px; font-size:13px; line-height:1.7; color:#444; background:#fff;">
                ${escapeFaqHtml(item.a)}
            </div>
        </div>
    `).join('');

    const block = document.createElement('div');
    block.id = 'faq-help-block';
    block.className = 'migration-block';
    block.style.cssText = 'background:#e8eaf6; border:2px solid #7986cb; padding:15px; border-radius:6px; margin-top:15px;';
    block.innerHTML = `
        <h3 class="migration-title" style="color:#283593;">❓ よくある質問・トラブルシューティング</h3>
        <div id="faq-items-wrap">${itemsHtml}</div>
        <p style="font-size:12px; color:#666; margin-top:10px;">
            上記で解決しない場合は、ishiinopasokon8610@gmail.com までご連絡ください。
        </p>
    `;
    container.appendChild(block);

    block.querySelectorAll('.faq-question-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleFaqItem(btn));
    });
}

function toggleFaqItem(btn) {
    if (typeof playSound === 'function') playSound('click');
    const item = btn.closest('.faq-item');
    const answer = item.querySelector('.faq-answer');
    const icon = item.querySelector('.faq-toggle-icon');
    const isOpen = answer.style.display === 'block';
    answer.style.display = isOpen ? 'none' : 'block';
    icon.innerText = isOpen ? '▼' : '▲';
}

function escapeFaqHtml(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

(function hookShowScreenForFaqHelpBlock() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') ensureFaqHelpBlock();
            return result;
        };
    }
    tryHook();
})();

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('migration-screen')?.classList.contains('active')) {
        ensureFaqHelpBlock();
    }
});
