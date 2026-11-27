// ==========================================
// manual-pdf-download-system.js
// 使い方説明書（PDF）のダウンロード
//  ① データ管理画面に「📖 使い方説明書（PDF）」のブロックを追加し、ボタンでダウンロードできる
//  ② haruレジを開いたとき、この端末でまだ一度もダウンロードしていなければ、案内のポップアップを出す
//     （ホーム画面が開いていて、ほかのポップアップが出ていない時だけ。客用画面・タッチパネルなどには出さない）
//
// ・PDFは index.html と同じフォルダに置いた haruregi-guide.pdf を使う
// ・「ダウンロード済み」の記録は端末ごとに持つ。キーを pos_ で始めないので、
//   ほかの端末への同期・バックアップには入らない（→ 端末ごとに1回ずつ案内される）
// ・ポップアップの「あとで」は今回の起動中だけ、「この端末では案内しない」はずっと案内を止める
//   （客用ディスプレイやタッチパネル用の端末で、案内が出ないようにするため）
// ・データ管理のボタンは、いつでも何度でもダウンロードできる
// ==========================================
(function () {
    'use strict';

    const PDF_URL = './haruregi-guide.pdf';
    const SAVE_NAME = 'haruレジ_機能ガイド.pdf';
    const DONE_KEY = 'harureji_manual_pdf_downloaded_v1';   // この端末でダウンロード済み
    const NEVER_KEY = 'harureji_manual_pdf_never_ask_v1';   // この端末では案内しない
    const LATER_KEY = 'harureji_manual_pdf_later_v1';       // 今回の起動中は案内しない（sessionStorage）
    const STARTED_AT = Date.now();

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無視 */ } }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 無視 */ } }
    function isDone() { return !!lsGet(DONE_KEY); }
    function clickSound() { try { if (typeof playSound === 'function') playSound('click'); } catch (e) { /* 無視 */ } }

    /* ---------- ダウンロード本体 ---------- */
    let downloading = false;
    async function downloadManual() {
        if (downloading) return { ok: false, busy: true };
        downloading = true;
        try {
            const res = await fetch(PDF_URL);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const raw = await res.blob();
            if (!raw || raw.size < 1000) throw new Error('PDFが空です');
            const blob = new Blob([raw], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = SAVE_NAME;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (e) { /* 無視 */ } }, 15000);
            lsSet(DONE_KEY, String(Date.now()));
            return { ok: true };
        } catch (e) {
            console.warn('使い方説明書PDFのダウンロードに失敗しました', e);
            return { ok: false };
        } finally {
            downloading = false;
        }
    }
    window.haruDownloadManualPdf = downloadManual;

    /* ---------- スタイル ---------- */
    function ensureStyle() {
        if (document.getElementById('manual-pdf-style')) return;
        const st = document.createElement('style');
        st.id = 'manual-pdf-style';
        st.textContent = `
        #manual-pdf-prompt { position: fixed; inset: 0; z-index: 99990; display: none; align-items: center; justify-content: center;
            background: rgba(0, 0, 0, 0.55); padding: 12px; box-sizing: border-box; }
        #manual-pdf-prompt .mpd-box { box-sizing: border-box; width: min(92vw, 460px); max-height: 94vh; overflow-y: auto; background: #fff; color: #222;
            border-radius: 14px; padding: 22px 20px 16px; text-align: center; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4); }
        #manual-pdf-prompt .mpd-icon { font-size: 44px; line-height: 1; margin-bottom: 6px; }
        #manual-pdf-prompt .mpd-title { margin: 0 0 8px; font-size: 20px; line-height: 1.35; color: #1a237e; }
        #manual-pdf-prompt .mpd-desc { margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #444; }
        #manual-pdf-prompt .mpd-btn { display: block; width: 100%; box-sizing: border-box; padding: 13px 12px; font-size: 17px; font-weight: 700;
            border: none; border-radius: 8px; cursor: pointer; }
        #manual-pdf-prompt .mpd-btn:disabled { opacity: .6; cursor: default; }
        #manual-pdf-prompt .mpd-main { background: #3949ab; color: #fff; }
        #manual-pdf-prompt .mpd-later { margin-top: 10px; background: #eceff1; color: #37474f; font-size: 15px; padding: 10px 12px; }
        #manual-pdf-prompt .mpd-link { display: inline-block; margin-top: 10px; padding: 6px 8px; font-size: 12px; color: #78909c;
            background: none; border: none; text-decoration: underline; cursor: pointer; }
        #manual-pdf-prompt .mpd-msg { min-height: 20px; margin-top: 8px; font-size: 13px; font-weight: 700; color: #2e7d32; }
        #manual-pdf-prompt .mpd-msg.mpd-err { color: #c62828; }
        #manual-pdf-block .mpd-block-btn { background: #3949ab; color: #fff; padding: 10px 16px; border: none; border-radius: 6px; font-weight: 700; font-size: 15px; cursor: pointer; }
        #manual-pdf-block .mpd-block-btn:disabled { opacity: .6; cursor: default; }
        #manual-pdf-block .mpd-block-status { margin-top: 10px; font-size: 13px; color: #283593; font-weight: 700; }
        `;
        document.head.appendChild(st);
    }

    /* ---------- ① 初回の案内ポップアップ ---------- */
    function promptEl() { return document.getElementById('manual-pdf-prompt'); }
    function promptVisible() { const el = promptEl(); return !!(el && el.style.display === 'flex'); }

    function hidePrompt() {
        const el = promptEl();
        if (!el) return;
        el.style.display = 'none';
        delete el.dataset.done;
        const msg = el.querySelector('#mpd-msg');
        if (msg) { msg.textContent = ''; msg.classList.remove('mpd-err'); }
        const btn = el.querySelector('#mpd-download');
        if (btn) btn.disabled = false;
    }

    function buildPrompt() {
        let el = promptEl();
        if (el) return el;
        ensureStyle();
        el = document.createElement('div');
        el.id = 'manual-pdf-prompt';
        el.innerHTML =
            '<div class="mpd-box" role="dialog" aria-modal="true">' +
            '<div class="mpd-icon">📖</div>' +
            '<h2 class="mpd-title">使い方説明書をダウンロードしてください</h2>' +
            '<p class="mpd-desc">haruレジの使い方をまとめたPDFです。<br>この端末には、まだダウンロードされていません。</p>' +
            '<button type="button" class="mpd-btn mpd-main" id="mpd-download">📥 ダウンロードする</button>' +
            '<div class="mpd-msg" id="mpd-msg"></div>' +
            '<button type="button" class="mpd-btn mpd-later" id="mpd-later">あとで</button>' +
            '<button type="button" class="mpd-link" id="mpd-never">この端末では案内しない</button>' +
            '</div>';
        document.body.appendChild(el);

        const btn = el.querySelector('#mpd-download');
        const msg = el.querySelector('#mpd-msg');
        btn.addEventListener('click', async () => {
            clickSound();
            btn.disabled = true;
            msg.classList.remove('mpd-err');
            msg.textContent = 'ダウンロードしています…';
            const r = await downloadManual();
            if (r.ok) {
                el.dataset.done = '1';
                msg.textContent = '✅ ダウンロードしました（「ダウンロード」フォルダを見てください）';
                setTimeout(hidePrompt, 1600);
            } else {
                btn.disabled = false;
                msg.classList.add('mpd-err');
                msg.textContent = 'ダウンロードできませんでした。通信を確かめて、もう一度押してください。';
            }
        });
        el.querySelector('#mpd-later').addEventListener('click', () => {
            clickSound();
            ssSet(LATER_KEY, '1');
            hidePrompt();
        });
        el.querySelector('#mpd-never').addEventListener('click', () => {
            clickSound();
            lsSet(NEVER_KEY, '1');
            hidePrompt();
        });
        return el;
    }

    function homeActive() {
        const h = document.getElementById('home-screen');
        return !!(h && h.classList.contains('active'));
    }
    function loadingVisible() {
        const lo = document.getElementById('app-loading-overlay');
        return !!(lo && !lo.classList.contains('app-loading-hidden'));
    }
    // 画面の大部分をおおう、ほかのポップアップ（担当者ログイン・お知らせ・休止画面など）が出ているか
    function otherOverlayVisible() {
        const vw = window.innerWidth, vh = window.innerHeight;
        const kids = document.body.children;
        for (let i = 0; i < kids.length; i++) {
            const el = kids[i];
            if (el.id === 'manual-pdf-prompt') continue;
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
            if (el.classList && el.classList.contains('screen')) continue;
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed') continue;
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none') continue;
            const r = el.getBoundingClientRect();
            const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
            const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
            if (w * h >= vw * vh * 0.6) return true;
        }
        return false;
    }

    function shouldAsk() { return !isDone() && !lsGet(NEVER_KEY) && !ssGet(LATER_KEY); }

    function checkPrompt() {
        const el = promptEl();
        const visible = promptVisible();
        if (visible && el.dataset.done === '1') return; // ダウンロード成功の表示中（自分で閉じる）
        if (!shouldAsk()) { if (visible) hidePrompt(); return; }
        if (visible) { if (!homeActive()) hidePrompt(); return; } // ホーム画面を離れたら、いったん隠す
        if (Date.now() - STARTED_AT < 2500) return;               // 起動直後は、画面が落ち着くまで待つ
        if (!homeActive() || loadingVisible() || otherOverlayVisible()) return;
        buildPrompt().style.display = 'flex';
    }

    /* ---------- ② データ管理：ダウンロードのブロック ---------- */
    let blockMsgUntil = 0;
    function refreshBlock() {
        const st = document.getElementById('mpd-block-status');
        if (!st || Date.now() < blockMsgUntil) return;
        st.textContent = isDone() ? '✅ この端末では、ダウンロード済みです。' : 'この端末では、まだダウンロードしていません。';
    }
    function ensureBlock() {
        const scr = document.getElementById('migration-screen');
        if (!scr) return;
        if (document.getElementById('manual-pdf-block')) { refreshBlock(); return; }
        ensureStyle();
        const b = document.createElement('div');
        b.id = 'manual-pdf-block';
        b.className = 'migration-block';
        b.style.cssText = 'background:#e8eaf6;border:2px solid #7986cb;padding:15px;border-radius:6px;margin-bottom:15px';
        b.innerHTML =
            '<h3 class="migration-title" style="color:#283593">📖 使い方説明書（PDF）</h3>' +
            '<p class="migration-desc">haruレジの使い方をまとめた説明書です。ボタンを押すと、この端末にPDFをダウンロードします。</p>' +
            '<button type="button" class="mpd-block-btn" id="mpd-block-btn">📥 使い方説明書をダウンロード</button>' +
            '<div class="mpd-block-status" id="mpd-block-status"></div>';
        const first = scr.querySelector('.migration-block');
        if (first && first.parentNode === scr) scr.insertBefore(b, first); else scr.appendChild(b);

        const btn = b.querySelector('#mpd-block-btn');
        const st = b.querySelector('#mpd-block-status');
        btn.addEventListener('click', async () => {
            clickSound();
            btn.disabled = true;
            blockMsgUntil = Date.now() + 60000;
            st.textContent = 'ダウンロードしています…';
            const r = await downloadManual();
            btn.disabled = false;
            if (r.ok) {
                blockMsgUntil = Date.now() + 6000;
                st.textContent = '✅ ダウンロードしました（「ダウンロード」フォルダを見てください）';
            } else {
                blockMsgUntil = Date.now() + 8000;
                st.textContent = '⚠️ ダウンロードできませんでした。通信を確かめて、もう一度押してください。';
            }
        });
        refreshBlock();
    }

    function tick() {
        try { ensureBlock(); } catch (e) { /* 無視 */ }
        try { checkPrompt(); } catch (e) { /* 無視 */ }
    }
    setInterval(tick, 1500);
    // 【修正】データ管理画面が開かれた瞬間に、すぐブロックを追加する（1.5秒待たない）
    (function watchMigration() {
        const scr = document.getElementById('migration-screen');
        if (!scr || !window.MutationObserver) return;
        let q = false;
        new MutationObserver(() => {
            if (q) return; q = true;
            setTimeout(() => { q = false; try { ensureBlock(); } catch (e) { /* 無視 */ } }, 0);
        }).observe(scr, { attributes: true, attributeFilter: ['class'] });
    })();
})();
