// ==========================================
// page-save-password-guard-and-touch-panel-devtools-block-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」（イベント監視＋DOM注入のみ）で
// 実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応（3点）】
// ① ページ全体：Ctrl+S（Macはcmd+S）でページを保存しようとした際、
// 　　ブラウザ標準の保存ダイアログを止め、代わりにパスワード入力画面を
// 　　表示する。
// ② タッチパネル（#touch-panel-overlay）表示中：Ctrl+I を無効化する。
// ③ ページ全体（常時）：右クリックメニュー・長押しメニュー（「名前を
// 　　付けて保存」「ページのソースを表示」等）を開かせず、代わりに①と
// 　　同じパスワード画面をその場で表示する。
//
// 【重要：ご確認のお願い（1点）】
// ・②は「タッチパネルを見ているときは」というご依頼だったため、
// 　タッチパネル表示中（#touch-panel-overlayが存在する間）だけに
// 　限定している。レジ画面など他の画面でも常に無効化したい場合は
// 　教えてほしい（その場合はdocument全体へ常時適用する形に直せる）。
// ・①③共通の注意点として、ブラウザの仕様上の限界がある：Ctrl+Sや
// 　右クリック保存の標準動作（保存ダイアログ・メニュー）
// 　を止めてしまった後は、たとえ正しいパスワードが入力されても
// 　スクリプト側から改めて「保存」を実行することはできない（そもそも
// 　そういう操作をJSに許してしまうとセキュリティ上大きな問題になる
// 　ため、ブラウザ側で意図的に禁止されている）。そのためこの画面は
// 　「パスワードを知らない人には無断で保存させない・思いとどまらせる」
// 　ための目隠し・抑止の画面であり、正しいパスワードを入れても
// 　実際にファイルがダウンロードされるわけではない、という前提で
// 　作っている。もし想定と違う場合は教えてほしい。
//
// 【パスワードについて】
// 下の PAGE_SAVE_GUARD_PASSWORD を、実際に使いたいパスワードに
// 書き換えてください（初期値は仮の値になっています）。
//
// 【導入方法】
// index.html内で、どこでも構わない（他の追加機能ファイルと同じく、
// 一番最後のあたりに読み込むのが分かりやすい）。
// ==========================================

const PAGE_SAVE_GUARD_PASSWORD = '0000'; // ← ここを実際のパスワードに変更してください

/* =========================================================
   ① Ctrl+S / Cmd+S でページ保存しようとした際のパスワード画面
   ========================================================= */
function ensurePageSaveGuardStyle() {
    if (document.getElementById('page-save-guard-style')) return;
    const style = document.createElement('style');
    style.id = 'page-save-guard-style';
    style.textContent = `
        #page-save-guard-modal {
            display: none; position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,0.75);
            align-items: center; justify-content: center;
        }
        #page-save-guard-modal.active { display: flex; }
        #page-save-guard-box {
            background: #fff; border-radius: 12px; padding: 24px;
            width: min(320px, 90vw); text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
        }
        #page-save-guard-box h3 { margin: 0 0 10px; font-size: 17px; }
        #page-save-guard-box p { margin: 0 0 14px; font-size: 12px; color: #666; line-height: 1.6; }
        #page-save-guard-input {
            width: 100%; box-sizing: border-box; padding: 10px; font-size: 18px;
            text-align: center; letter-spacing: 4px; border: 1px solid #ccc; border-radius: 6px;
            margin-bottom: 8px;
        }
        #page-save-guard-error { color: #e53935; font-size: 12px; min-height: 16px; margin-bottom: 8px; }
        #page-save-guard-buttons { display: flex; gap: 8px; }
        #page-save-guard-buttons button {
            flex: 1; padding: 10px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer;
        }
        #page-save-guard-ok { background: #43a047; color: #fff; }
        #page-save-guard-cancel { background: #eee; color: #333; }
    `;
    document.head.appendChild(style);
}

function ensurePageSaveGuardModal() {
    ensurePageSaveGuardStyle();
    let modal = document.getElementById('page-save-guard-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'page-save-guard-modal';
    modal.innerHTML = `
        <div id="page-save-guard-box">
            <h3>🔒 保存が制限されています</h3>
            <p>このページを保存するには、管理者パスワードの入力が必要です。</p>
            <input type="password" id="page-save-guard-input" inputmode="text" autocomplete="off" placeholder="パスワード">
            <div id="page-save-guard-error"></div>
            <div id="page-save-guard-buttons">
                <button type="button" id="page-save-guard-cancel">閉じる</button>
                <button type="button" id="page-save-guard-ok">確認</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#page-save-guard-cancel').addEventListener('click', closePageSaveGuardModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closePageSaveGuardModal(); });
    modal.querySelector('#page-save-guard-ok').addEventListener('click', submitPageSaveGuardPassword);
    modal.querySelector('#page-save-guard-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitPageSaveGuardPassword();
        e.stopPropagation(); // このダイアログ内のキー入力が、他のショートカット監視に拾われないようにする
    });

    return modal;
}

function openPageSaveGuardModal() {
    const modal = ensurePageSaveGuardModal();
    const input = document.getElementById('page-save-guard-input');
    const error = document.getElementById('page-save-guard-error');
    if (input) input.value = '';
    if (error) error.textContent = '';
    modal.classList.add('active');
    if (input) setTimeout(() => input.focus(), 50);
}

function closePageSaveGuardModal() {
    const modal = document.getElementById('page-save-guard-modal');
    if (modal) modal.classList.remove('active');
}

function submitPageSaveGuardPassword() {
    const input = document.getElementById('page-save-guard-input');
    const error = document.getElementById('page-save-guard-error');
    const value = input ? input.value : '';

    if (value === PAGE_SAVE_GUARD_PASSWORD) {
        if (error) error.textContent = '';
        closePageSaveGuardModal();
        // ブラウザの仕様上、ここから改めて「保存」を実行することはできない
        // （Ctrl+Sの標準動作は既に止めているため）。あくまでパスワード確認が
        // 目的の画面のため、確認できたことだけを伝える。
        if (typeof showTouchPanelToast === 'function') {
            showTouchPanelToast('パスワードを確認しました');
        } else {
            alert('パスワードを確認しました。');
        }
    } else {
        if (error) error.textContent = 'パスワードが違います';
        if (input) { input.value = ''; input.focus(); }
    }
}

/* =========================================================
   ①②：キー操作の監視
   ========================================================= */
document.addEventListener('keydown', function (ev) {
    const key = (ev.key || '').toLowerCase();
    const ctrlOrCmd = ev.ctrlKey || ev.metaKey;
    if (!ctrlOrCmd) return;

    // ① Ctrl+S / Cmd+S：画面を問わず、常にパスワード画面を出す
    if (key === 's') {
        ev.preventDefault();
        openPageSaveGuardModal();
        return;
    }

    // ② Ctrl+I：タッチパネル表示中だけ無効化する
    if (key === 'i') {
        const overlay = document.getElementById('touch-panel-overlay');
        if (overlay) {
            ev.preventDefault();
        }
    }
}, true);

/* =========================================================
   ③：右クリック（マウス）メニュー（「名前を付けて保存」「ページのソースを
   　　表示」等）からのダウンロード試行にも、即座にパスワード画面を出す。
   　　タッチパネル表示中に限定せず、ページ全体（常時）に適用する。
   　　※タッチ操作（長押し）は対象外にする。タッチデバイスの長押しは
   　　　ホーム画面ブロックの削除など、このアプリの正規の操作としても
   　　　随所で使われており、そのたびにパスワード画面が割り込んで
   　　　しまっていたため。タッチデバイスの長押しメニューには、そもそも
   　　　「名前を付けて保存」自体が出ないことが多く、実害も小さい。
   ========================================================= */
var PAGE_SAVE_GUARD_IS_TOUCH_DEVICE = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

document.addEventListener('contextmenu', function (ev) {
    if (PAGE_SAVE_GUARD_IS_TOUCH_DEVICE) return;

    // パスワード入力画面自体の操作（入力欄の右クリックなど）で
    // 自分自身が再度開いてしまわないようにする
    const guardModal = document.getElementById('page-save-guard-modal');
    if (guardModal && guardModal.contains(ev.target)) return;

    ev.preventDefault();
    openPageSaveGuardModal();
}, true);
