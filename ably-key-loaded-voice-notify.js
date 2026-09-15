// ==========================================
// ably-key-loaded-voice-notify.js
// ------------------------------------------
// 【背景】
// Ably用のAPIキーは index.html 側で Firestore（pos_realtime_settings）
// から非同期に取得しており、取得できたかどうかは画面上の案内文
// （#api-guide-msg）を見ないと分からない。
// このアプリは「音声レジ」なので、取得できた時にも音声で知らせておくと、
// トラブル時に「そもそもAblyのキーが取れているかどうか」を画面を
// 見なくても判断しやすくなる。
//
// 【この機能（2点）】
// index.html が発火する 'pos-ably-key-ready' イベント
// （取得の成功・失敗いずれの場合も、読み込み処理が完了するたびに
// 1回発火される。post-update-gdrive-resync.js経由の再取得時も同様）
// を購読し、detail.apiKeyが取得できていた（＝成功）場合だけ、
//   ① speakVoice() で読み上げる
//   ② 画面右上に、小さく右からスライドインするアニメーション付きの
//     通知（トースト）を数秒間だけ表示する
// の両方で知らせる。未設定・読み込み失敗時はどちらも行わない
// （エラー時に毎回鳴る／出ると煩わしいため、成功時のみとする）。
//
// 客用ディスプレイ端末（isCustomerDisplayDevice()がtrueの端末）では
// 音声・通知どちらも出さない（お客様に聞かれる／見られる必要が無い
// 内部確認用のお知らせのため）。
//
// index.html は直接編集せず、既存のイベントを購読するだけの
// 独立したファイルとして実装する（他の追加機能ファイルと同じ方針）。
//
// 【導入方法】
// index.html内のどこでもよいので（index.htmlの本体スクリプトより
// 後ろであれば確実）、このファイルを読み込んでください。
//   <script src="ably-key-loaded-voice-notify.js"></script>
// ==========================================

/* =========================================================
   ② 右上スライドイン通知
   ========================================================= */
function ensureAblyKeyToastStyle() {
    if (document.getElementById('ably-key-toast-style')) return;
    const style = document.createElement('style');
    style.id = 'ably-key-toast-style';
    style.textContent = `
        #ably-key-toast-wrap {
            position: fixed;
            top: 14px;
            right: 14px;
            z-index: 100060;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        }
        .ably-key-toast {
            background: rgba(46, 125, 50, 0.95);
            color: #fff;
            font-size: 12px;
            font-weight: bold;
            padding: 8px 14px;
            border-radius: 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            white-space: nowrap;
            transform: translateX(120%);
            opacity: 0;
            transition: transform 300ms ease, opacity 300ms ease;
        }
        .ably-key-toast.ably-key-toast-show {
            transform: translateX(0);
            opacity: 1;
        }
    `;
    document.head.appendChild(style);
}

function ensureAblyKeyToastWrap() {
    let wrap = document.getElementById('ably-key-toast-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'ably-key-toast-wrap';
        document.body.appendChild(wrap);
    }
    return wrap;
}

function showAblyKeyLoadedToast(message) {
    ensureAblyKeyToastStyle();
    const wrap = ensureAblyKeyToastWrap();

    const toast = document.createElement('div');
    toast.className = 'ably-key-toast';
    toast.textContent = message;
    wrap.appendChild(toast);

    // 描画された直後にクラスを付けることで、スライドインの
    // トランジションが確実に発火するようにする
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('ably-key-toast-show');
        });
    });

    setTimeout(() => {
        toast.classList.remove('ably-key-toast-show');
        setTimeout(() => toast.remove(), 350); // スライドアウトのアニメーションが終わってから消す
    }, 2500);
}

/* =========================================================
   ① + ② 'pos-ably-key-ready' を購読して、音声＋通知の両方で知らせる
   ========================================================= */
(function notifyAblyKeyLoaded() {
    window.addEventListener('pos-ably-key-ready', (e) => {
        const apiKey = e && e.detail ? e.detail.apiKey : '';
        if (!apiKey) return; // 未設定・読み込み失敗時は何もしない（成功時のみ）

        const isCustDisplay = typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice();
        if (isCustDisplay) return;

        if (typeof speakVoice === 'function') {
            speakVoice('Ablyの接続キーを取得しました');
        }
        showAblyKeyLoadedToast('✅ Ablyキーを取得しました');
    });
})();
