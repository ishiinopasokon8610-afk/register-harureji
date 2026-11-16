// ==========================================
// clock-check-system.js
// ------------------------------------------
// 【背景】
// 端末の時計が実際の日本時刻とずれていると、Firebaseとの同期でエラーが起きる
// （同期データの有効期限の判定、「新しい方を採用」の判定、売上の日付などがずれるため）。
// そこで、担当者ログイン（staff-login-gate.js）より前に時計を確認し、
// ずれている間は全画面の警告を出して、先へ進めないようにする。
//
// 【確認する内容】
// ① 端末の時刻と、サーバー（このアプリを配信しているGitHub Pages）が返す
//    現在時刻（HTTPのDateヘッダー）を比べる。2分以上ずれていたら警告する。
// ② 端末のタイムゾーンが日本（UTC+9）でなければ警告する。
//
// 【動作】
// ・起動時に確認し、ずれていれば警告を表示する。
// ・警告中は10秒ごとに自動で再確認する（「直したので再確認」ボタンでもすぐ確認できる）。
// ・直ったら警告を閉じ、ログアウトして担当者ログインからやり直させる（＝再ログイン）。
// ・営業中も10分ごと、およびアプリに戻ってきた時に再確認する。
// ・オフラインなどで確認できない時は、何も表示しない（オフラインでもレジを使えるようにするため）。
//
// index.html には <script> を1行足すだけ。必ず staff-login-gate.js より「前」に置くこと。
// ==========================================

(function clockCheckSystem() {
    'use strict';

    const TOLERANCE_MS = 2 * 60 * 1000;       // これ以上ずれていたら警告
    const JST_OFFSET_MIN = -540;               // Date#getTimezoneOffset() での日本（UTC+9）
    const BLOCKED_RECHECK_MS = 10 * 1000;      // 警告中の自動再確認
    const NORMAL_RECHECK_MS = 10 * 60 * 1000;  // 通常時の再確認

    let blocking = false;
    let wasBlocked = false;
    let overlayEl = null;
    let checking = false;
    let recheckTimer = null;

    window.isClockSkewBlocking = function () { return blocking; };

    /* ---------- サーバー時刻の取得 ---------- */
    // HEADリクエストはService Workerを通らず、必ずネットワークへ行く。
    // URLに毎回違う値を付けて、途中のキャッシュからも返らないようにする。
    // 端末の「実際の時刻」。Date.now() はページ内のスクリプトで書き換えられている可能性が
    // あるため、ブラウザ本体の時計（performance.timeOrigin + performance.now()）を使う。
    function realNow() {
        try {
            if (typeof performance !== 'undefined' && performance.timeOrigin && typeof performance.now === 'function') {
                return Math.round(performance.timeOrigin + performance.now());
            }
        } catch (e) { /* 下のDate.now()を使う */ }
        return Date.now();
    }

    async function fetchServerTime() {
        const t0 = realNow();
        const url = location.pathname + '?_clk=' + Date.now();
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        const t1 = realNow();
        const dateHeader = res.headers.get('Date');
        if (!dateHeader) return null;
        let serverMs = new Date(dateHeader).getTime();
        if (!isFinite(serverMs)) return null;
        // CDNが保存していた応答を返した場合、Dateヘッダーは「作られた時刻」なので、Age（経過秒）を足す
        const age = parseInt(res.headers.get('Age') || '0', 10);
        if (isFinite(age) && age > 0) serverMs += age * 1000;
        // Dateヘッダーは秒単位（切り捨て）なので、通信の往復の真ん中の時刻と比べる
        return { serverMs, deviceMs: Math.round((t0 + t1) / 2) };
    }

    function fmtJst(ms) {
        try {
            return new Date(ms).toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo', hour12: false,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        } catch (e) { return new Date(ms).toISOString(); }
    }

    function fmtDiff(ms) {
        const sec = Math.round(Math.abs(ms) / 1000);
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        let out = '';
        if (d) out += d + '日';
        if (h) out += h + '時間';
        if (m) out += m + '分';
        if (!d && !h) out += s + '秒';
        return out || '0秒';
    }

    /* ---------- 判定 ---------- */
    // 戻り値: { problems: [文字列...], detail: 文字列 } / 確認できない時は null
    async function evaluate() {
        const problems = [];
        let detail = '';

        if (new Date().getTimezoneOffset() !== JST_OFFSET_MIN) {
            problems.push('端末のタイムゾーン（時間帯）が日本（UTC+9）になっていません。');
        }

        let t = null;
        try { t = await fetchServerTime(); } catch (e) { t = null; }

        if (t) {
            const diff = t.deviceMs - t.serverMs; // プラス＝端末が進んでいる
            if (Math.abs(diff) > TOLERANCE_MS) {
                problems.push('端末の時計が、実際の時刻より ' + fmtDiff(diff) + ' ' + (diff > 0 ? '進んでいます。' : '遅れています。'));
            }
            detail = 'この端末の時刻（日本時間）: ' + fmtJst(t.deviceMs) + '\n正しい時刻（日本時間）: ' + fmtJst(t.serverMs);
        } else if (problems.length === 0) {
            return null; // 時刻を確認できなかった（オフライン等）。止めない。
        }

        return problems.length ? { problems, detail } : { problems: [], detail: '' };
    }

    // 参考：ページ内の Date.now() が、ブラウザ本体の時計と大きく違っていないか（原因調査用。画面には出さない）
    function warnIfDateOverridden() {
        try {
            const d = Math.abs(Date.now() - realNow());
            if (d > TOLERANCE_MS) console.warn('[clock-check] ページ内の Date.now() が端末の実際の時刻と ' + fmtDiff(d) + ' ずれています。Date を書き換えているスクリプトがないか確認してください。');
        } catch (e) { /* 無視 */ }
    }

    /* ---------- 警告画面 ---------- */
    function blockKeys(e) {
        if (!blocking) return;
        if (overlayEl && overlayEl.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
    }
    ['keydown', 'keypress', 'keyup'].forEach(type => window.addEventListener(type, blockKeys, true));

    function ensureOverlay() {
        if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
        overlayEl = document.createElement('div');
        overlayEl.id = 'clock-skew-overlay';
        overlayEl.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(20,20,30,.96);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:sans-serif;overflow-y:auto;';
        overlayEl.innerHTML =
            '<div style="font-size:56px;margin-bottom:8px">🕒</div>' +
            '<h1 style="font-size:26px;margin:0 0 14px;line-height:1.4">端末の時計が日本時刻とずれています</h1>' +
            '<p style="font-size:16px;line-height:1.8;max-width:560px;margin:0 0 14px">' +
            '端末の日付・時刻を<b>今の日本時刻</b>に直してから、<b>もう一度ログイン</b>してください。<br>' +
            '時計がずれたままだと、Firebaseとの同期でエラーが起きます。</p>' +
            '<div id="clock-skew-problems" style="font-size:15px;line-height:1.8;color:#ffcc80;margin-bottom:10px"></div>' +
            '<pre id="clock-skew-detail" style="font-size:14px;color:#cfd8dc;margin:0 0 16px;white-space:pre-wrap;font-family:inherit"></pre>' +
            '<p style="font-size:13px;color:#b0bec5;max-width:560px;line-height:1.7;margin:0 0 18px">' +
            '直し方：端末の設定で「日付と時刻」を開き、「自動設定（ネットワーク時刻）」をオンにして、タイムゾーンを「東京（日本標準時）」にしてください。</p>' +
            '<button id="clock-skew-recheck-btn" type="button" style="padding:14px 28px;font-size:18px;font-weight:700;background:#43a047;color:#fff;border:none;border-radius:8px;cursor:pointer">直したので再確認</button>' +
            '<div id="clock-skew-status" style="font-size:13px;color:#b0bec5;margin-top:12px;min-height:18px"></div>';
        document.body.appendChild(overlayEl);
        overlayEl.querySelector('#clock-skew-recheck-btn').addEventListener('click', () => runCheck(true));
        return overlayEl;
    }

    function showBlock(result) {
        const first = !blocking;
        blocking = true;
        wasBlocked = true;
        const el = ensureOverlay();
        el.style.display = 'flex';
        el.querySelector('#clock-skew-problems').innerHTML = '';
        result.problems.forEach(p => {
            const div = document.createElement('div');
            div.textContent = '⚠️ ' + p;
            el.querySelector('#clock-skew-problems').appendChild(div);
        });
        el.querySelector('#clock-skew-detail').textContent = result.detail;
        if (first) {
            // 他の画面・入力欄のフォーカスを外す（スキャナーの入力が裏に入らないように）
            try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
            if (typeof playSound === 'function') { try { playSound('error'); } catch (e) {} }
        }
    }

    function hideBlock() {
        blocking = false;
        if (overlayEl) overlayEl.style.display = 'none';

        if (wasBlocked) {
            wasBlocked = false;
            // 直ったので、担当者ログインからやり直させる（再ログイン）
            try { if (typeof logout === 'function') logout(); } catch (e) {}
            try { if (typeof renderAuthUI === 'function') renderAuthUI(); } catch (e) {}
            try {
                const st = document.getElementById('auth-status-display');
                if (st) st.innerHTML = '';
            } catch (e) {}
            try {
                if (typeof showStaffLoginGate === 'function') showStaffLoginGate('home-screen');
            } catch (e) {}
        }
    }

    /* ---------- 確認の実行・スケジュール ---------- */
    async function runCheck(manual) {
        if (checking) return;
        warnIfDateOverridden();
        checking = true;
        const statusEl = overlayEl ? overlayEl.querySelector('#clock-skew-status') : null;
        if (manual && statusEl) statusEl.textContent = '確認しています…';
        try {
            const result = await evaluate();
            if (result === null) {
                // 確認できなかった。警告中なら、そのまま警告を続ける
                if (blocking && statusEl) statusEl.textContent = '時刻を確認できませんでした。ネットワークに接続して、もう一度お試しください。';
            } else if (result.problems.length) {
                showBlock(result);
                const st = overlayEl.querySelector('#clock-skew-status');
                if (st) st.textContent = manual ? 'まだずれています。端末の設定を直してから、もう一度押してください。' : '';
            } else {
                hideBlock();
            }
        } catch (e) {
            console.warn('[clock-check] 確認に失敗しました:', e);
        } finally {
            checking = false;
            scheduleNext();
        }
    }

    function scheduleNext() {
        if (recheckTimer) clearTimeout(recheckTimer);
        recheckTimer = setTimeout(() => runCheck(false), blocking ? BLOCKED_RECHECK_MS : NORMAL_RECHECK_MS);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') runCheck(false);
    });
    window.addEventListener('online', () => runCheck(false));

    function start() { runCheck(false); }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
