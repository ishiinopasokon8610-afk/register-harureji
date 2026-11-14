// ==========================================
// sync-code-ui-system.js
// ------------------------------------------
// 【この機能】
// ホーム画面の「APIキー設定（Ably）」の入力欄（#api-settings-container）を、
// 次の2つのボタンに置き換える。
//   🆕 データ用コードを発行   … 16文字のコードを作る。このコードで他の端末とつながる。
//   📥 データ用コードを受け取る … 他の端末で発行したコードを入力して、同じグループに入る。
// 店舗IDと同期用パスワードも、このコードにまとめたので不要になった
// （shop-id-system.js と sync-password-encryption-system.js は読み込まない）。
//
// このコードを知っている端末は、お店のデータをすべて読み書きできる。
// 人に見られないようにし、アルバイトの方などが辞めた時は、コードを発行し直して
// 全端末で入れ直す。
//
// 通信の仕組みは firebase-sync-system.js（window.PosSync）が行う。
// このファイルは画面だけを担当する。
// ==========================================

(function () {
    'use strict';

    const CONTAINER_ID = 'api-settings-container';
    const MODAL_ID = 'psync-modal';

    const STATUS_TEXT = {
        nocode: '⚪ まだつながっていません（コードを発行するか、受け取ってください）',
        connecting: '🟡 つなげています…',
        online: '🟢 つながっています',
        offline: '🟠 通信が切れています（戻ると自動でつながり直します）',
        error: '🔴 つなげられません（Firebaseの設定・https のページかをご確認ください）'
    };

    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function sync() { return window.PosSync; }

    function playClick() { if (typeof playSound === 'function') playSound('click'); }

    /* =========================================================
       ホーム画面のブロック
       ========================================================= */
    function renderHomeBlock() {
        const c = document.getElementById(CONTAINER_ID);
        if (!c || !sync()) return;

        const code = sync().getCode();
        const status = sync().getStatus();

        c.innerHTML = `
            <div style="font-weight:700;margin-bottom:6px;text-align:left;">🔗 データ用コード（他の端末とつなぐ）</div>
            <div id="psync-status" style="font-size:13px;margin-bottom:8px;text-align:left;">${esc(STATUS_TEXT[status] || '')}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                <span style="font-size:12px;color:#555;">この端末のコード：</span>
                <span id="psync-code-text" style="font-family:monospace;font-size:16px;font-weight:700;letter-spacing:2px;">${code ? esc(sync().formatCode(code)) : '（未設定）'}</span>
                ${code ? '<button type="button" id="psync-copy-btn" class="api-save-btn" style="padding:4px 10px;">コピー</button>' : ''}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" id="psync-issue-btn" class="api-save-btn">🆕 データ用コードを発行</button>
                <button type="button" id="psync-receive-btn" class="api-save-btn">📥 データ用コードを受け取る</button>
                ${code ? '<button type="button" id="psync-clear-btn" class="api-save-btn" style="background:#757575;">この端末のコードを解除</button>' : ''}
            </div>
            <div style="font-size:11px;color:#666;margin-top:8px;text-align:left;line-height:1.6;">
                1台目で「発行」→ 2台目以降で「受け取る」にそのコードを入力します。<br>
                コードを知っている端末は、お店のデータをすべて見られます。人に教えないでください。
            </div>
        `;

        const issueBtn = c.querySelector('#psync-issue-btn');
        const recvBtn = c.querySelector('#psync-receive-btn');
        const copyBtn = c.querySelector('#psync-copy-btn');
        const clearBtn = c.querySelector('#psync-clear-btn');
        if (issueBtn) issueBtn.addEventListener('click', onIssueClick);
        if (recvBtn) recvBtn.addEventListener('click', openReceiveModal);
        if (copyBtn) copyBtn.addEventListener('click', () => copyText(sync().formatCode(sync().getCode()), copyBtn));
        if (clearBtn) clearBtn.addEventListener('click', onClearClick);
    }

    function refreshStatusOnly() {
        const el = document.getElementById('psync-status');
        if (el && sync()) el.textContent = STATUS_TEXT[sync().getStatus()] || '';
    }

    /* =========================================================
       小さなダイアログ（確認ダイアログより下、他のモーダルより上）
       ========================================================= */
    function closeModal() {
        const m = document.getElementById(MODAL_ID);
        if (m) m.remove();
    }

    function openModal(innerHtml) {
        closeModal();
        const m = document.createElement('div');
        m.id = MODAL_ID;
        m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:999990;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;';
        m.innerHTML = `<div style="background:#fff;color:#222;border-radius:12px;padding:20px;width:100%;max-width:420px;max-height:92vh;overflow-y:auto;box-sizing:border-box;">${innerHtml}</div>`;
        document.body.appendChild(m);
        return m;
    }

    function copyText(text, btn) {
        const done = () => {
            if (!btn) return;
            const old = btn.textContent;
            btn.textContent = 'コピーしました';
            setTimeout(() => { btn.textContent = old; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, () => { fallbackCopy(text); done(); });
        } else {
            fallbackCopy(text);
            done();
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-1000px;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* 無視 */ }
        ta.remove();
    }

    function errorText(e) {
        const m = e && e.message ? e.message : '';
        if (m === 'INVALID') return 'コードの形が正しくありません。16文字（英数字）を入力してください。';
        if (m === 'NOT_FOUND') return 'このコードは見つかりません。入力を確認するか、発行した端末のコードを確認してください。';
        if (m === 'TIMEOUT') return '通信できませんでした。インターネットの接続を確認して、もう一度お試しください。';
        if (m === 'SUBTLE_CRYPTO_UNAVAILABLE') return 'このページでは暗号化機能が使えません。https で始まるアドレスで開いてください。';
        if (m === 'NO_DATABASE') return 'Firebaseの通信機能を読み込めていません。ページを再読み込みしてください。';
        return '失敗しました（' + (m || '原因不明') + '）。もう一度お試しください。';
    }

    /* =========================================================
       発行
       ========================================================= */
    function onIssueClick() {
        playClick();
        const code = sync().getCode();
        if (code && typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                'すでにコードがあります。新しく発行すると、今つながっている他の端末とは別のグループになり、全端末でコードを入れ直す必要があります。発行しますか？',
                'あたらしく はっこう する と ほか の たんまつ と は べつ に なり ます。 はっこう し ます か？',
                (ok) => { if (ok) doIssue(); },
                true
            );
        } else {
            doIssue();
        }
    }

    async function doIssue() {
        const m = openModal('<div style="text-align:center;padding:16px 0;">コードを発行しています…</div>');
        try {
            const code = await sync().issueNewCode();
            const text = sync().formatCode(code);
            m.firstElementChild.innerHTML = `
                <h3 style="margin:0 0 10px;">✅ データ用コードを発行しました</h3>
                <div id="psync-issued-code" style="font-family:monospace;font-size:24px;font-weight:700;letter-spacing:3px;text-align:center;background:#f5f5f5;border-radius:8px;padding:14px 6px;word-break:break-all;">${esc(text)}</div>
                <p style="font-size:13px;line-height:1.7;margin:12px 0;">
                    他の端末で「📥 データ用コードを受け取る」を押して、このコードを入力してください。<br>
                    <b>このコードは、お店のデータを開くための鍵です。</b>人に見られないようにしてください。
                </p>
                <div style="display:flex;gap:8px;">
                    <button type="button" id="psync-issued-copy" class="api-save-btn" style="flex:1;">コピー</button>
                    <button type="button" id="psync-issued-close" class="api-save-btn" style="flex:1;background:#757575;">閉じる</button>
                </div>`;
            m.querySelector('#psync-issued-copy').addEventListener('click', (ev) => copyText(text, ev.currentTarget));
            m.querySelector('#psync-issued-close').addEventListener('click', () => { closeModal(); renderHomeBlock(); });
            if (typeof playSound === 'function') playSound('success');
        } catch (e) {
            console.warn('コード発行に失敗:', e);
            m.firstElementChild.innerHTML = `
                <h3 style="margin:0 0 10px;color:#c62828;">発行できませんでした</h3>
                <p style="font-size:13px;line-height:1.7;">${esc(errorText(e))}</p>
                <button type="button" id="psync-err-close" class="api-save-btn" style="width:100%;">閉じる</button>`;
            m.querySelector('#psync-err-close').addEventListener('click', closeModal);
            if (typeof playSound === 'function') playSound('error');
        }
    }

    /* =========================================================
       受け取り
       ========================================================= */
    function formatTyping(raw) {
        const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
        return s.replace(/(.{4})(?=.)/g, '$1-');
    }

    function openReceiveModal() {
        playClick();
        const m = openModal(`
            <h3 style="margin:0 0 10px;">📥 データ用コードを受け取る</h3>
            <p style="font-size:13px;line-height:1.7;margin:0 0 10px;">他の端末で発行したコード（16文字）を入力してください。</p>
            <input id="psync-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                style="width:100%;box-sizing:border-box;font-family:monospace;font-size:20px;letter-spacing:2px;text-align:center;padding:10px;border:2px solid #90a4ae;border-radius:8px;">
            <div id="psync-input-error" style="color:#c62828;font-size:13px;min-height:18px;margin:8px 0;"></div>
            <div style="display:flex;gap:8px;">
                <button type="button" id="psync-input-cancel" class="api-save-btn" style="flex:1;background:#757575;">キャンセル</button>
                <button type="button" id="psync-input-ok" class="api-save-btn" style="flex:1;">受け取る</button>
            </div>`);
        const input = m.querySelector('#psync-input');
        const errEl = m.querySelector('#psync-input-error');
        const okBtn = m.querySelector('#psync-input-ok');

        input.addEventListener('input', () => { input.value = formatTyping(input.value); errEl.textContent = ''; });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } e.stopPropagation(); });
        m.querySelector('#psync-input-cancel').addEventListener('click', closeModal);
        okBtn.addEventListener('click', submit);
        setTimeout(() => input.focus(), 50);

        async function submit() {
            if (okBtn.disabled) return;
            okBtn.disabled = true;
            okBtn.textContent = '確認中…';
            errEl.textContent = '';
            try {
                await sync().applyCode(input.value);
                if (typeof playSound === 'function') playSound('success');
                m.firstElementChild.innerHTML = `
                    <h3 style="margin:0 0 10px;">✅ つながりました</h3>
                    <p style="font-size:13px;line-height:1.7;">この端末に、データ用コードを設定しました。これから、同じコードの端末と同期します。</p>
                    <button type="button" id="psync-done-close" class="api-save-btn" style="width:100%;">閉じる</button>`;
                m.querySelector('#psync-done-close').addEventListener('click', () => { closeModal(); renderHomeBlock(); });
            } catch (e) {
                console.warn('コード受け取りに失敗:', e);
                errEl.textContent = errorText(e);
                okBtn.disabled = false;
                okBtn.textContent = '受け取る';
                if (typeof playSound === 'function') playSound('error');
            }
        }
    }

    /* =========================================================
       解除
       ========================================================= */
    function onClearClick() {
        playClick();
        const run = async () => { await sync().clearCode(); renderHomeBlock(); };
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                'この端末のデータ用コードを解除します。この端末は他の端末と同期しなくなります（端末のデータは消えません）。よろしいですか？',
                'この たんまつ の こーど を かいじょ し ます。 よろしい です か？',
                (ok) => { if (ok) run(); },
                true
            );
        } else {
            run();
        }
    }

    /* =========================================================
       起動
       ========================================================= */
    function init() {
        // 以前の「APIキー設定」の案内・入力欄は使わないので、中身ごと置き換える
        renderHomeBlock();
        window.addEventListener('pos-sync-status', refreshStatusOnly);
        window.addEventListener('pos-sync-code-changed', renderHomeBlock);
    }

    function boot() {
        if (!window.PosSync || !document.getElementById(CONTAINER_ID)) {
            setTimeout(boot, 300);
            return;
        }
        init();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
