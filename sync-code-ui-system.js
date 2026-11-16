// ==========================================
// sync-code-ui-system.js
// ------------------------------------------
// 【この機能】
// ホーム画面の旧「APIキー設定」の入力欄（#api-settings-container）を、
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
// 【今回の追加】
//   ・この端末のコードは、普段は伏字（••••-••••-••••-••••）で表示し、「👁 表示」を
//     押した時だけ見せる（30秒たつと自動で伏字に戻る）。
//   ・「QR表示」ボタン … コードをQRコードにして表示する（他の端末のカメラで読み取れる）。
//   ・「📷 カメラで読み取る」 … 受け取り画面でQRコードを読み取ってコードを入力する。
//     読み取りは、対応ブラウザは標準のBarcodeDetector、非対応ブラウザは jsQR で行う。
//   QR表示・読み取りの部品（qrcode-generator / jsQR）は、使う時だけCDNから読み込む。
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

    /* =========================================================
       QRコードの表示・読み取り用の部品
       ========================================================= */
    const QR_GEN_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    const scriptPromises = {};

    function loadScriptOnce(url, isReady) {
        if (isReady()) return Promise.resolve();
        if (scriptPromises[url]) return scriptPromises[url];
        scriptPromises[url] = new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = url;
            el.onload = () => (isReady() ? resolve() : reject(new Error('LIB_NOT_READY')));
            el.onerror = () => { delete scriptPromises[url]; reject(new Error('LIB_LOAD_FAILED')); };
            document.head.appendChild(el);
        });
        return scriptPromises[url];
    }

    // 文字列をQRコードのcanvasにして返す
    async function makeQrCanvas(text, targetPx) {
        await loadScriptOnce(QR_GEN_URL, () => typeof window.qrcode === 'function');
        const qr = window.qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        const n = qr.getModuleCount();
        const quiet = 4;
        const scale = Math.max(3, Math.floor((targetPx || 240) / (n + quiet * 2)));
        const size = (n + quiet * 2) * scale;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000';
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
            }
        }
        canvas.style.cssText = 'width:100%;max-width:260px;height:auto;image-rendering:pixelated;display:block;margin:0 auto;border:1px solid #ddd;border-radius:8px;';
        return canvas;
    }

    // カメラでQRを読み取る。stop() で止められる。見つかったら onText(文字列) を1回呼ぶ。
    async function startQrScan(videoEl, onText, onFail) {
        let stopped = false;
        let stream = null;
        let timer = null;

        function stop() {
            stopped = true;
            if (timer) clearInterval(timer);
            if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* 無視 */ } });
            try { videoEl.srcObject = null; } catch (e) { /* 無視 */ }
        }

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('NO_CAMERA_API');
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
            if (stopped) { stop(); return { stop }; }
            videoEl.setAttribute('playsinline', 'true');
            videoEl.muted = true;
            videoEl.srcObject = stream;
            await videoEl.play();

            let detector = null;
            if ('BarcodeDetector' in window) {
                try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
            }
            if (!detector) await loadScriptOnce(JSQR_URL, () => typeof window.jsQR === 'function');

            const work = document.createElement('canvas');
            const wctx = work.getContext('2d', { willReadFrequently: true });
            let busy = false;

            timer = setInterval(async () => {
                if (stopped || busy || videoEl.readyState < 2 || !videoEl.videoWidth) return;
                busy = true;
                try {
                    let text = '';
                    if (detector) {
                        const found = await detector.detect(videoEl);
                        if (found && found.length) text = found[0].rawValue || '';
                    } else {
                        const scale = Math.min(1, 640 / videoEl.videoWidth);
                        work.width = Math.round(videoEl.videoWidth * scale);
                        work.height = Math.round(videoEl.videoHeight * scale);
                        wctx.drawImage(videoEl, 0, 0, work.width, work.height);
                        const img = wctx.getImageData(0, 0, work.width, work.height);
                        const res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                        if (res && res.data) text = res.data;
                    }
                    if (text && !stopped) onText(text);
                } catch (e) { /* 1フレーム失敗しても続ける */ }
                busy = false;
            }, 250);
        } catch (e) {
            stop();
            if (onFail) onFail(e);
        }
        return { stop };
    }

    function playClick() { if (typeof playSound === 'function') playSound('click'); }

    /* =========================================================
       ホーム画面のブロック
       ========================================================= */
    const MASKED_CODE = '••••-••••-••••-••••';
    const REVEAL_MS = 30 * 1000;
    let revealTimer = null;
    let codeRevealed = false;

    function hideCodeAgain() {
        if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
        codeRevealed = false;
        applyCodeMask();
    }

    function applyCodeMask() {
        const el = document.getElementById('psync-code-text');
        const btn = document.getElementById('psync-reveal-btn');
        if (!el || !sync()) return;
        const code = sync().getCode();
        el.textContent = !code ? '（未設定）' : (codeRevealed ? sync().formatCode(code) : MASKED_CODE);
        if (btn) btn.textContent = codeRevealed ? '🙈 隠す' : '👁 表示';
    }

    function onRevealClick() {
        playClick();
        if (codeRevealed) { hideCodeAgain(); return; }
        codeRevealed = true;
        applyCodeMask();
        if (revealTimer) clearTimeout(revealTimer);
        revealTimer = setTimeout(hideCodeAgain, REVEAL_MS); // 見せっぱなしにしない
    }

    function renderHomeBlock() {
        const c = document.getElementById(CONTAINER_ID);
        if (!c || !sync()) return;
        codeRevealed = false;
        if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }

        const code = sync().getCode();
        const status = sync().getStatus();

        c.innerHTML = `
            <div style="font-weight:700;margin-bottom:6px;text-align:left;">🔗 データ用コード（他の端末とつなぐ）</div>
            <div id="psync-status" style="font-size:13px;margin-bottom:8px;text-align:left;">${esc(statusLine(status))}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                <span style="font-size:12px;color:#555;">この端末のコード：</span>
                <span id="psync-code-text" style="font-family:monospace;font-size:16px;font-weight:700;letter-spacing:2px;">${code ? MASKED_CODE : '（未設定）'}</span>
                ${code ? '<button type="button" id="psync-reveal-btn" class="api-save-btn" style="padding:4px 10px;">👁 表示</button>' : ''}
                ${code ? '<button type="button" id="psync-qr-btn" class="api-save-btn" style="padding:4px 10px;">QR表示</button>' : ''}
                ${code ? '<button type="button" id="psync-copy-btn" class="api-save-btn" style="padding:4px 10px;">コピー</button>' : ''}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" id="psync-issue-btn" class="api-save-btn">🆕 データ用コードを発行</button>
                <button type="button" id="psync-receive-btn" class="api-save-btn">📥 データ用コードを受け取る</button>
                ${code ? '<button type="button" id="psync-clear-btn" class="api-save-btn" style="background:#757575;">この端末のコードを解除</button>' : ''}
            </div>
            <div style="font-size:11px;color:#666;margin-top:8px;text-align:left;line-height:1.6;">
                1台目で「発行」→ 2台目以降で「受け取る」にそのコードを入力（またはQRコードを読み取り）します。<br>
                コードを知っている端末は、お店のデータをすべて見られます。人に教えないでください。
            </div>
        `;

        const issueBtn = c.querySelector('#psync-issue-btn');
        const recvBtn = c.querySelector('#psync-receive-btn');
        const copyBtn = c.querySelector('#psync-copy-btn');
        const revealBtn = c.querySelector('#psync-reveal-btn');
        const qrBtn = c.querySelector('#psync-qr-btn');
        const clearBtn = c.querySelector('#psync-clear-btn');
        if (issueBtn) issueBtn.addEventListener('click', onIssueClick);
        if (recvBtn) recvBtn.addEventListener('click', openReceiveModal);
        if (copyBtn) copyBtn.addEventListener('click', () => copyText(sync().formatCode(sync().getCode()), copyBtn));
        if (revealBtn) revealBtn.addEventListener('click', onRevealClick);
        if (qrBtn) qrBtn.addEventListener('click', openQrModal);
        if (clearBtn) clearBtn.addEventListener('click', onClearClick);
    }

    // 状態の文字＋「同期中の端末 N台」
    function statusLine(status) {
        let text = STATUS_TEXT[status] || '';
        const ps = sync();
        if (ps && ps.getCode() && ps.isReady() && typeof ps.getDeviceCount === 'function') {
            const n = ps.getDeviceCount();
            if (n > 0) text += (text ? '　／　' : '') + `📱 同期中の端末: ${n}台（この端末を含む）`;
        }
        return text;
    }

    function refreshStatusOnly() {
        const el = document.getElementById('psync-status');
        if (el && sync()) el.textContent = statusLine(sync().getStatus());
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
        if (m === 'LIB_LOAD_FAILED' || m === 'LIB_NOT_READY') return 'QRコードの部品を読み込めませんでした。インターネットの接続を確認して、もう一度お試しください。';
        return '失敗しました（' + (m || '原因不明') + '）。もう一度お試しください。';
    }

    /* =========================================================
       QR表示（ホームの「QR表示」ボタン）
       ========================================================= */
    async function openQrModal() {
        playClick();
        const code = sync() && sync().getCode();
        if (!code) return;
        const m = openModal('<div style="text-align:center;padding:16px 0;">QRコードを作っています…</div>');
        let autoClose = null;
        const close = () => { if (autoClose) clearTimeout(autoClose); closeModal(); };
        try {
            const canvas = await makeQrCanvas(sync().formatCode(code), 260);
            m.firstElementChild.innerHTML = `
                <h3 style="margin:0 0 10px;">📷 QRコードで受け渡し</h3>
                <p style="font-size:13px;line-height:1.7;margin:0 0 10px;">受け取る端末で「📥 データ用コードを受け取る」→「📷 カメラで読み取る」を押し、このQRコードを写してください。</p>
                <div id="psync-qr-holder"></div>
                <p style="font-size:12px;color:#c62828;line-height:1.6;margin:12px 0;">このQRコードは、お店のデータを開く鍵です。他の人に見られない場所で使ってください（60秒で自動的に閉じます）。</p>
                <button type="button" id="psync-qr-close" class="api-save-btn" style="width:100%;">閉じる</button>`;
            m.querySelector('#psync-qr-holder').appendChild(canvas);
            m.querySelector('#psync-qr-close').addEventListener('click', close);
            autoClose = setTimeout(close, 60 * 1000);
        } catch (e) {
            console.warn('QR表示に失敗:', e);
            m.firstElementChild.innerHTML = `
                <h3 style="margin:0 0 10px;color:#c62828;">QRコードを表示できません</h3>
                <p style="font-size:13px;line-height:1.7;">${esc(errorText(e))}</p>
                <button type="button" id="psync-err-close" class="api-save-btn" style="width:100%;">閉じる</button>`;
            m.querySelector('#psync-err-close').addEventListener('click', closeModal);
        }
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
                <div id="psync-issued-qr" style="margin:12px 0 0;"></div>
                <p style="font-size:13px;line-height:1.7;margin:12px 0;">
                    他の端末で「📥 データ用コードを受け取る」を押して、このコードを入力（またはQRコードを読み取り）してください。<br>
                    <b>このコードは、お店のデータを開くための鍵です。</b>人に見られないようにしてください。
                </p>
                <div style="display:flex;gap:8px;">
                    <button type="button" id="psync-issued-copy" class="api-save-btn" style="flex:1;">コピー</button>
                    <button type="button" id="psync-issued-close" class="api-save-btn" style="flex:1;background:#757575;">閉じる</button>
                </div>`;
            m.querySelector('#psync-issued-copy').addEventListener('click', (ev) => copyText(text, ev.currentTarget));
            // QRは読み込みに失敗しても、コードの文字は使えるので、失敗は静かに無視する
            makeQrCanvas(text, 220).then((cv) => {
                const holder = m.querySelector('#psync-issued-qr');
                if (holder) holder.appendChild(cv);
            }).catch((qe) => console.warn('QR表示に失敗（コードの文字は使えます）:', qe));
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
            <button type="button" id="psync-scan-btn" class="api-save-btn" style="width:100%;margin-top:10px;background:#5c6bc0;">📷 カメラで読み取る</button>
            <div id="psync-scan-area" style="display:none;margin-top:10px;">
                <video id="psync-scan-video" style="width:100%;max-height:280px;background:#000;border-radius:8px;" playsinline muted></video>
                <div style="font-size:12px;color:#555;text-align:center;margin-top:4px;">QRコードを枠に入れてください</div>
            </div>
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
        let scanner = null;
        function stopScanner() {
            if (scanner) { scanner.stop(); scanner = null; }
            const area = m.querySelector('#psync-scan-area');
            if (area) area.style.display = 'none';
            const sb = m.querySelector('#psync-scan-btn');
            if (sb) sb.textContent = '📷 カメラで読み取る';
        }
        function closeAll() { stopScanner(); closeModal(); }

        m.querySelector('#psync-input-cancel').addEventListener('click', closeAll);
        okBtn.addEventListener('click', submit);

        m.querySelector('#psync-scan-btn').addEventListener('click', async () => {
            playClick();
            if (scanner) { stopScanner(); return; }
            errEl.textContent = '';
            m.querySelector('#psync-scan-area').style.display = 'block';
            m.querySelector('#psync-scan-btn').textContent = '⏹ 読み取りをやめる';
            scanner = await startQrScan(m.querySelector('#psync-scan-video'), (text) => {
                const code = sync().normalizeCode(text);
                if (!code) { errEl.textContent = 'このQRコードは、データ用コードではないようです。'; return; }
                stopScanner();
                input.value = formatTyping(code);
                submit(); // 読み取れたらそのまま受け取りを実行する
            }, (e) => {
                stopScanner();
                const name = e && e.name ? e.name : '';
                if (name === 'NotAllowedError' || name === 'SecurityError') errEl.textContent = 'カメラの使用が許可されていません。ブラウザの設定でカメラを許可してください。';
                else if (name === 'NotFoundError' || (e && e.message === 'NO_CAMERA_API')) errEl.textContent = 'この端末ではカメラを使えません。コードを手入力してください。';
                else errEl.textContent = errorText(e);
            });
        });
        setTimeout(() => input.focus(), 50);

        async function submit() {
            if (okBtn.disabled) return;
            okBtn.disabled = true;
            okBtn.textContent = '確認中…';
            errEl.textContent = '';
            stopScanner();
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
        window.addEventListener('pos-sync-devices', refreshStatusOnly);
        window.addEventListener('pos-sync-ready', () => setTimeout(refreshStatusOnly, 1500));
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
