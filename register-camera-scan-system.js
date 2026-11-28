// ==========================================
// register-camera-scan-system.js
// レジ画面で、カメラでもバーコードをスキャンできるようにする
//
//  ・JANコード入力欄の横に「📷 カメラ」ボタンを追加する
//  ・押すと、画面の右下に小さなカメラ画面が出る（レジ画面は隠れない）
//  ・バーコードを読み取るたびに、バーコードリーダーで打ったときと同じ動き
//    （入力欄に番号を入れて Enter）で、商品を追加する
//  ・カメラはつけたまま、続けて何点でも読める
//    （同じバーコードは2秒あけないと、もう一度は読まない＝二重登録を防ぐ）
//  ・ホームなど、レジ画面から離れたら自動でカメラを止める
//
// 読み取りの方法
//  ・ブラウザの BarcodeDetector があればそれを使う（Chrome / Edge / Android など。速い）
//  ・無ければ ZXing（読み取りライブラリ）を読み込んで使う（Safariなど）
//
// ・register.js / index.html / 他のJSは変更しない（後から重ねる方式）。
// ・index.html には <script src="register-camera-scan-system.js"></script> を1行足すだけ。
// ・カメラを使うには https（GitHub Pages なら大丈夫）とカメラの許可が必要。
// ==========================================
(function registerCameraScan() {
    'use strict';
    if (window.__registerCameraScanInstalled) return;
    window.__registerCameraScanInstalled = true;

    const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    const SAME_CODE_WAIT_MS = 2000;   // 同じバーコードをもう一度読むまでの待ち時間
    const ANY_CODE_WAIT_MS = 700;     // 続けて読みすぎないための待ち時間
    const DETECT_INTERVAL_MS = 120;

    let panel = null, video = null, statusEl = null;
    let stream = null, timer = null, zxingReader = null;
    let running = false;
    let lastCode = '', lastCodeAt = 0, lastAnyAt = 0;
    let statusTimer = null;

    const registerScreen = () => document.getElementById('register-screen');
    const janInput = () => document.getElementById('jan-input');

    /* ---------- 見た目 ---------- */
    function ensureStyle() {
        if (document.getElementById('rcs-style')) return;
        const st = document.createElement('style');
        st.id = 'rcs-style';
        st.textContent = `
        #register-screen .jan-input-area { display: flex !important; gap: 6px; align-items: center; }
        #register-screen .jan-input-area #jan-input { flex: 1 1 auto; min-width: 0; }
        #jan-camera-btn { flex: 0 0 auto; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; font-weight: 700;
            background: #1976d2; color: #fff; cursor: pointer; white-space: nowrap; }
        #jan-camera-btn.rcs-on { background: #c62828; }
        #jan-camera-panel { position: fixed; right: 12px; bottom: 12px; width: 300px; max-width: calc(100vw - 24px); z-index: 8500;
            background: #111; color: #fff; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.5); overflow: hidden; display: none; font-family: inherit; }
        #jan-camera-panel.rcs-show { display: block; }
        #jan-camera-panel .rcs-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 6px 12px; font-size: 13px; font-weight: 700; background: #1976d2; }
        #jan-camera-panel .rcs-close { border: none; background: rgba(255,255,255,.2); color: #fff; font-size: 14px; font-weight: 700; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
        #jan-camera-panel video { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: #000; }
        #jan-camera-panel .rcs-guide { position: absolute; left: 12%; right: 12%; top: 40%; height: 22%; border: 2px solid rgba(255,255,255,.8); border-radius: 6px; pointer-events: none; box-shadow: 0 0 0 999px rgba(0,0,0,.25); }
        #jan-camera-panel .rcs-body { position: relative; }
        #jan-camera-panel .rcs-status { padding: 6px 10px; font-size: 12px; min-height: 18px; background: #222; color: #ddd; word-break: break-all; }
        #jan-camera-panel .rcs-status.ok { background: #2e7d32; color: #fff; }
        #jan-camera-panel .rcs-status.err { background: #b71c1c; color: #fff; }`;
        document.head.appendChild(st);
    }

    function setStatus(text, kind, keepMs) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = 'rcs-status' + (kind ? ' ' + kind : '');
        clearTimeout(statusTimer);
        if (keepMs) statusTimer = setTimeout(() => { if (running) setStatus('バーコードを枠に合わせてください', ''); }, keepMs);
    }

    function ensurePanel() {
        ensureStyle();
        if (panel && document.body.contains(panel)) return;
        panel = document.createElement('div');
        panel.id = 'jan-camera-panel';
        panel.innerHTML = '<div class="rcs-head"><span>📷 カメラでスキャン</span><button type="button" class="rcs-close">✕ 閉じる</button></div>' +
            '<div class="rcs-body"><video playsinline muted autoplay></video><div class="rcs-guide"></div></div>' +
            '<div class="rcs-status"></div>';
        document.body.appendChild(panel);
        video = panel.querySelector('video');
        statusEl = panel.querySelector('.rcs-status');
        panel.querySelector('.rcs-close').addEventListener('click', stop);
    }

    function ensureButton() {
        const input = janInput();
        const area = input && input.parentElement;
        if (!area) return;
        if (document.getElementById('jan-camera-btn')) return;
        ensureStyle();
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'jan-camera-btn';
        b.textContent = '📷 カメラ';
        b.title = 'カメラでバーコードを読み取る';
        // ボタンを押してもJAN入力欄のフォーカスが外れないようにする
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => { running ? stop() : start(); });
        input.insertAdjacentElement('afterend', b);
    }

    function updateButton() {
        const b = document.getElementById('jan-camera-btn');
        if (!b) return;
        b.classList.toggle('rcs-on', running);
        b.textContent = running ? '📷 カメラを止める' : '📷 カメラ';
    }

    /* ---------- 読み取った番号をレジに渡す ---------- */
    // ふつうのバーコードリーダー（キーボードのように「番号＋Enter」を打つ機械）と
    // 同じ動きにするので、register.js 側の処理をそのまま使える
    function sendToRegister(code) {
        const input = janInput();
        if (!input) return;
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const opt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        input.dispatchEvent(new KeyboardEvent('keydown', opt));
        input.dispatchEvent(new KeyboardEvent('keypress', opt));
        input.dispatchEvent(new KeyboardEvent('keyup', opt));
    }

    // 画面にダイアログ（会計・確認など）が出ているときは、読み取っても渡さない
    function modalOpen() {
        const list = document.querySelectorAll('.modal-overlay');
        for (const m of list) {
            const st = getComputedStyle(m);
            if (st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0') return true;
        }
        return false;
    }

    function onDetect(raw) {
        const code = String(raw || '').trim();
        if (!code || !running) return;
        const now = Date.now();
        if (now - lastAnyAt < ANY_CODE_WAIT_MS) return;
        if (code === lastCode && now - lastCodeAt < SAME_CODE_WAIT_MS) { lastCodeAt = now; return; }
        const scr = registerScreen();
        if (!scr || !scr.classList.contains('active')) return;
        if (modalOpen()) { setStatus('ダイアログを閉じてから読み取ってください', 'err', 1500); return; }
        lastCode = code; lastCodeAt = now; lastAnyAt = now;
        sendToRegister(code);
        try { if (typeof playSound === 'function') playSound('click'); } catch (e) { /* 無視 */ }
        setStatus('✅ ' + code, 'ok', 1200);
    }

    /* ---------- 読み取りの開始・停止 ---------- */
    function loadZXing() {
        if (window.ZXing) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = ZXING_URL;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('読み取りライブラリを読み込めませんでした'));
            document.head.appendChild(s);
        });
    }

    async function startWithBarcodeDetector() {
        let formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
        try {
            const sup = await window.BarcodeDetector.getSupportedFormats();
            const f = formats.filter(x => sup.includes(x));
            if (f.length) formats = f;
        } catch (e) { /* そのまま */ }
        const detector = new window.BarcodeDetector({ formats });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
        let busy = false;
        timer = setInterval(async () => {
            if (busy || !running || document.hidden || video.readyState < 2) return;
            busy = true;
            try {
                const found = await detector.detect(video);
                if (found && found.length) onDetect(found[0].rawValue);
            } catch (e) { /* 読み取れなかったフレームは無視 */ }
            busy = false;
        }, DETECT_INTERVAL_MS);
    }

    async function startWithZXing() {
        await loadZXing();
        const Z = window.ZXing;
        const hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A,
            Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF]);
        zxingReader = new Z.BrowserMultiFormatReader(hints);
        await zxingReader.decodeFromVideoDevice(null, video, (result) => {
            if (result) onDetect(result.getText());
        });
    }

    async function start() {
        if (running) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('このブラウザではカメラを使えません。（https のページで開いているか確認してください）');
            return;
        }
        ensurePanel();
        running = true;
        lastCode = ''; lastCodeAt = 0; lastAnyAt = 0;
        panel.classList.add('rcs-show');
        updateButton();
        setStatus('カメラを起動しています…', '');
        try {
            if ('BarcodeDetector' in window) await startWithBarcodeDetector();
            else await startWithZXing();
            if (running) setStatus('バーコードを枠に合わせてください', '');
        } catch (e) {
            console.warn('カメラ起動エラー', e);
            const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
            setStatus(denied ? 'カメラが許可されていません。ブラウザの設定で許可してください' : 'カメラを起動できませんでした', 'err');
            stopStream();   // 画面は出したまま、原因を見られるようにする
            running = false;
            updateButton();
        }
        try { if (typeof focusJanInput === 'function') focusJanInput(); } catch (e) { /* 無視 */ }
    }

    function stopStream() {
        clearInterval(timer); timer = null;
        if (zxingReader) { try { zxingReader.reset(); } catch (e) { /* 無視 */ } zxingReader = null; }
        if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* 無視 */ } }); stream = null; }
        if (video) { try { video.pause(); } catch (e) { /* 無視 */ } video.srcObject = null; }
    }

    function stop() {
        running = false;
        stopStream();
        if (panel) panel.classList.remove('rcs-show');
        updateButton();
        try { if (typeof focusJanInput === 'function') focusJanInput(); } catch (e) { /* 無視 */ }
    }

    /* ---------- 画面を離れたら止める／ボタンが消えたら作り直す ---------- */
    setInterval(() => {
        ensureButton();
        const scr = registerScreen();
        const active = !!(scr && scr.classList.contains('active'));
        if (!active && (running || (panel && panel.classList.contains('rcs-show')))) stop();
    }, 1000);
    document.addEventListener('visibilitychange', () => { if (document.hidden && running) stop(); });
    window.addEventListener('pagehide', stopStream);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton); else ensureButton();
})();
