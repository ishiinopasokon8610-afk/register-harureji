// ==========================================
// firebase-sync-system.js
// ------------------------------------------
// 【この機能】
// 従来の外部同期サービスの代わりに Firebase Realtime Database で、端末どうしのリアルタイム同期を行う。
//
// これまで sync-system.js / customer-sync-system.js / discount-system.js /
// extra-settings-sync.js / order-checkout-display.js / touch-panel-order-system.js
// などは、すべて「channel」というグローバル変数に対して
//     channel.publish(イベント名, データ)
//     channel.subscribe(イベント名, (msg) => { msg.data ... })
// を呼ぶだけで同期していた（使っていたのはこの2つだけ）。
// このファイルは、同じ書き方で使える「Firebase版の channel」を作って
// グローバル変数 channel に入れる。だから、それらのファイルは書き換えずにそのまま動く。
//
// 【仕組み】（Firebase のデータを「作る」「消す」で通信する）
//   データ用コード（16文字）から、
//     ① 保存場所の名前（コードのハッシュ。コードそのものは保存しない）
//     ② 暗号鍵（AES-256-GCM。送るデータはすべて暗号化してから保存する）
//   を作る。通信は次の2か所にデータを作る（push）ことで行い、古いものは消す。
//     pos_sync/{場所}/events … 商品・会員・履歴・設定など。24時間残る
//                              （オフラインだった端末が、戻った時に取りこぼしを受け取れる）
//     pos_sync/{場所}/live   … カートの内容・年齢確認など「その場限り」のもの。5分で消す
//   受け取る側は、その場所を見張っていて、新しいデータが作られたら
//   復号して、登録されている subscribe の処理に渡す。
//
// 【従来方式との違い】
//   ・自分が送った update-cart は、自分には返さない（古い状態でカートが巻き戻るのを防ぐ）。
//     それ以外のイベントは、従来と同じく自分にも返す（年齢確認などが自分の端末で動くため）。
//   ・データ用コードが未設定の端末は、送信も受信もしない。
//
// 【今回の更新：同期の遅延対策】
//   ① 送信：これまでは1件ごとに「サーバーが受け取った」返事を待ってから次を送っていた。
//      そのため、通信1往復分×件数だけ後ろの送信が遅れた（カート更新が連続すると特に遅れる）。
//      → 暗号化だけ順番に行い、書き込みは待たずに続けて出す（Firebaseは順番通りに届ける）。
//   ② update-cart（カートの内容）は、送信待ちの間に新しいものが来たら古いものを捨てて
//      最新の1件だけ送る（古いカート状態を送っても意味がないため）。
//   ③ 受信：これまでは「その場限り(live)」のカート表示・年齢確認が、大きなデータ
//      （商品一覧・画像入りの設定など）の復号待ちの後ろに並んでいた。
//      → 受信の処理待ち行列を events と live で分け、live が詰まらないようにした。
//   ④ 計測：送信してから受信されるまでの時間（遅延）・データの大きさを記録し、
//      遅いとき（3秒以上）はコンソールに警告を出す。原因調査用に
//      PosSync.getStats() で直近の状況を見られる。
//
// 【このファイルが公開するもの】
//   window.PosSync … データ用コードの発行・受け取り・状態確認など（sync-code-ui-system.js が使う）
//
// 【導入方法】
// index.html で、firebase の SDK（app / database）より後ろ、state.js より後ろ、
// sync-system.js 等より前に読み込む。
// ==========================================

(function () {
    'use strict';

    const CODE_KEY = 'pos_sync_code';              // pos_sync_ で始まるため、バックアップ・設定同期の対象外
    const LAST_SEEN_KEY = 'pos_sync_last_seen';    // 同上
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32文字（I, O, 0, 1 は間違えやすいので使わない）
    const CODE_LENGTH = 16;
    const DURABLE_TTL_MS = 24 * 60 * 60 * 1000;
    const LIVE_TTL_MS = 5 * 60 * 1000;
    const MAX_PAYLOAD_CHARS = 9000000;             // Firebase の 1回の書き込み上限（約16MB）に余裕を持たせる

    // 「その場限り」のイベント（liveに作る。戻ってきた端末に再生しない）
    const LIVE_EVENTS = new Set([
        'update-cart', 'age-check-event', 'fraud-warning-event',
        'checkout-image-event', 'checkout-image-hide-event',
        'sync-request', 'sync-full-sent',  // 「全部送って」の依頼と返信（古い依頼を後から再生しないため）
        'self-checkout-live',              // セルフレジのスキャン状況の見守り（その場限り）
        // 【今回追加】セルフレジの注文と状態通知。
        // これまで events（24時間残る・1本の順番待ちで受信）に入っていたため、前に大きなデータが
        // あると注文がレジに届かず、4桁の番号を打っても「未登録商品」になっていた。
        // live は別の順番待ちで受信されるので詰まらない。注文は30分で無効になる設計のため、
        // 5分で消える live で問題ない（レジを開き直した場合の備えは、自動化バーコード SELF番号）
        'self-checkout-order', 'self-checkout-status'
    ]);
    // 自分には返さないイベント
    const NO_ECHO_EVENTS = new Set(['update-cart']);

    const DEVICE_TAG = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    const handlers = new Map();   // イベント名 → Set(関数)
    const anyHandlers = new Set();
    const pending = [];           // 準備ができる前に送ろうとしたもの
    const st = {
        code: '', hash: '', key: null, db: null, refs: null,
        status: 'nocode', ready: false, online: false, infoBound: false,
        seen: new Set(), lastSeen: 0, lastSeenId: '', attachLastId: '', offset: 0,
        queue: Promise.resolve(), queueLive: Promise.resolve(), pubQueue: Promise.resolve(),
        cartPending: null, cartScheduled: false, gen: 0, saveTimer: null
    };

    // 遅延などの計測（原因調査用）
    const stats = { lags: [], sent: 0, received: 0, droppedCarts: 0, lastSendMs: 0, bigSends: [] };
    function recordLag(name, lagMs) {
        stats.received++;
        stats.lags.push({ name, lagMs, at: Date.now() });
        if (stats.lags.length > 50) stats.lags.shift();
        if (lagMs > 3000) console.warn(`[sync] 受信が遅れました（${name}）: 送信から約${Math.round(lagMs / 1000)}秒`);
    }

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    /* =========================================================
       小さな道具
       ========================================================= */
    function dispatch(name, detail) {
        try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) { /* 無視 */ }
    }

    function withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(label || 'TIMEOUT')), ms);
            promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
        });
    }

    function b64enc(bytes) {
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        }
        return btoa(s);
    }

    function b64dec(str) {
        const bin = atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function subtle() {
        const c = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
        if (!c || !c.subtle) throw new Error('SUBTLE_CRYPTO_UNAVAILABLE');
        return c;
    }

    async function sha256Hex(text) {
        const buf = await subtle().subtle.digest('SHA-256', enc.encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function pathHashOf(code) {
        return (await sha256Hex('haru-pos-sync-path-v1:' + code)).slice(0, 32);
    }

    async function deriveAll(code) {
        const c = subtle();
        const base = await c.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
        const key = await c.subtle.deriveKey(
            { name: 'PBKDF2', salt: enc.encode('haru-pos-sync-enc-v1'), iterations: 100000, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
        return { key, hash: await pathHashOf(code) };
    }

    async function encryptJson(obj) {
        const c = subtle();
        const iv = c.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, st.key, enc.encode(JSON.stringify(obj))));
        const out = new Uint8Array(12 + ct.length);
        out.set(iv, 0);
        out.set(ct, 12);
        return b64enc(out);
    }

    async function decryptJson(str) {
        const c = subtle();
        const buf = b64dec(str);
        const pt = await c.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, st.key, buf.subarray(12));
        return JSON.parse(dec.decode(pt));
    }

    /* =========================================================
       データ用コード
       ========================================================= */
    function generateCode() {
        const c = subtle();
        let out = '';
        while (out.length < CODE_LENGTH) {
            const bytes = c.getRandomValues(new Uint8Array(32));
            for (let i = 0; i < bytes.length && out.length < CODE_LENGTH; i++) {
                out += ALPHABET[bytes[i] & 31]; // 256は32で割り切れるので偏りなし
            }
        }
        return out;
    }

    // 入力されたコードを正しい形（大文字16文字）に整える。正しくなければ空文字
    function normalizeCode(input) {
        const s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (s.length !== CODE_LENGTH) return '';
        for (const ch of s) if (!ALPHABET.includes(ch)) return '';
        return s;
    }

    function formatCode(code) {
        const s = String(code || '');
        return s.replace(/(.{4})(?=.)/g, '$1-');
    }

    function loadCode() {
        try { return normalizeCode(localStorage.getItem(CODE_KEY)); } catch (e) { return ''; }
    }

    function saveCode(code) {
        try {
            if (code) localStorage.setItem(CODE_KEY, code);
            else localStorage.removeItem(CODE_KEY);
        } catch (e) { /* 無視 */ }
    }

    /* =========================================================
       つながり状態
       ========================================================= */
    function serverNow() { return Date.now() + st.offset; }

    function getDb() {
        try {
            if (typeof firebase !== 'undefined' && typeof firebase.database === 'function') return firebase.database();
        } catch (e) { /* 無視 */ }
        return null;
    }

    function computeStatus() {
        if (!st.code) return 'nocode';
        if (!getDb()) return 'error';
        if (!st.ready) return 'connecting';
        return st.online ? 'online' : 'offline';
    }

    function refreshStatus() {
        const next = computeStatus();
        if (next === st.status) return;
        st.status = next;
        dispatch('pos-sync-status', { status: next });
    }

    function bindInfoListeners(db) {
        if (st.infoBound) return;
        st.infoBound = true;
        try {
            db.ref('.info/connected').on('value', (s) => { st.online = !!s.val(); refreshStatus(); });
            db.ref('.info/serverTimeOffset').on('value', (s) => { st.offset = Number(s.val()) || 0; });
        } catch (e) { console.warn('[sync] 接続状態の監視を開始できませんでした:', e); }
    }

    /* =========================================================
       受信
       ========================================================= */
    function deliver(msg) {
        const set = handlers.get(msg.name);
        if (set) set.forEach(fn => { try { fn(msg); } catch (e) { console.error('[sync] 受信処理でエラー:', msg.name, e); } });
        anyHandlers.forEach(fn => { try { fn(msg); } catch (e) { console.error('[sync] 受信処理でエラー:', msg.name, e); } });
    }

    function loadLastSeenFor(hash) {
        try {
            const all = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || '{}');
            const v = all && all[hash];
            if (v && typeof v.t === 'number') return v;
        } catch (e) { /* 無視 */ }
        return { t: 0, id: '' };
    }

    function scheduleSaveLastSeen() {
        if (st.saveTimer) return;
        st.saveTimer = setTimeout(() => {
            st.saveTimer = null;
            if (!st.hash) return;
            try {
                const all = {};
                all[st.hash] = { t: st.lastSeen, id: st.lastSeenId }; // コードを変えた時に古い記録が残らないよう、今の1件だけ持つ
                localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(all));
            } catch (e) { /* 無視 */ }
        }, 1000);
    }

    function bump(t, id) {
        if (typeof t === 'number' && t >= st.lastSeen) {
            st.lastSeen = t;
            st.lastSeenId = id;
            scheduleSaveLastSeen();
        }
    }

    async function processEvent(id, v, durable, gen) {
        if (gen !== st.gen) return;
        const own = v.s === DEVICE_TAG;
        if (own && NO_ECHO_EVENTS.has(v.n)) { if (durable) bump(v.t, id); return; }

        let data;
        try {
            data = await decryptJson(v.d);
        } catch (e) {
            console.warn('[sync] 受信データを読めませんでした（コードが違う・壊れている）:', v.n, e);
            if (durable) bump(v.t, id);
            return;
        }
        if (gen !== st.gen) return;
        if (durable) bump(v.t, id);
        if (!own && typeof v.t === 'number') recordLag(v.n, serverNow() - v.t);
        deliver({ name: v.n, data, id, timestamp: v.t, clientId: v.s, own });
    }

    function onChild(snap, gen, durable) {
        if (gen !== st.gen) return;
        const id = snap.key;
        if (st.seen.has(id)) return;
        st.seen.add(id);
        if (st.seen.size > 3000) {
            const keep = Array.from(st.seen).slice(-1500);
            st.seen = new Set(keep);
        }
        if (durable && id === st.attachLastId) return; // 前回までに処理済みの最後の1件
        const v = snap.val();
        if (!v || typeof v.d !== 'string' || !v.n) return;
        if (durable) {
            st.queue = st.queue.then(() => processEvent(id, v, durable, gen)).catch(() => {});
        } else {
            st.queueLive = st.queueLive.then(() => processEvent(id, v, durable, gen)).catch(() => {});
        }
    }

    function onListenError(err) {
        console.warn('[sync] 受信の監視でエラー:', err);
        st.ready = false;
        setTimeout(() => { start(); }, 5000); // しばらくしてつなぎ直す
        refreshStatus();
    }

    /* ---------------------------------------------------------
       同期中の端末の数
       ---------------------------------------------------------
       同じデータ用コードでつながっている端末が、pos_sync/{暗号名}/presence/ に
       「いま接続中」の目印を1つずつ置く。通信が切れる（アプリを閉じる・電源が落ちる等）と、
       Firebase側が自動で目印を消すので、残っている目印の数＝いま同期中の端末の数になる。
       目印の中身は、置いた時刻だけ（個人情報・店のデータは入らない）。 */
    function detachPresence() {
        const p = st.presence;
        st.presence = null;
        if (!p) return;
        try { p.connRef.off('value', p.onConn); } catch (e) { /* 無視 */ }
        try { p.listRef.off('value', p.onList); } catch (e) { /* 無視 */ }
        try { p.meRef.remove(); } catch (e) { /* 無視 */ }
        st.deviceCount = 0;
    }

    function attachPresence(base, gen) {
        detachPresence();
        const db = st.db;
        const listRef = base.child('presence');
        const meRef = listRef.child(DEVICE_TAG);
        const connRef = db.ref('.info/connected');
        const onConn = (s) => {
            if (!s.val() || gen !== st.gen) return;
            // つながるたびに（再接続の時も）、切れたら消える設定をしてから目印を置く
            meRef.onDisconnect().remove().then(() => {
                meRef.set({ t: firebase.database.ServerValue.TIMESTAMP });
            }).catch(() => {});
        };
        const onList = (s) => {
            const n = s.numChildren();
            if (n !== st.deviceCount) {
                st.deviceCount = n;
                dispatch('pos-sync-devices', { count: n });
            }
        };
        connRef.on('value', onConn);
        listRef.on('value', onList);
        st.presence = { listRef, meRef, connRef, onConn, onList };
    }

    function detach() {
        detachPresence();
        const r = st.refs;
        st.refs = null;
        if (!r) return;
        try { if (r.durableQ) r.durableQ.off(); } catch (e) { /* 無視 */ }
        try { if (r.liveQ) r.liveQ.off(); } catch (e) { /* 無視 */ }
    }

    function attach(gen) {
        const db = st.db;
        const base = db.ref('pos_sync/' + st.hash);
        const saved = loadLastSeenFor(st.hash);
        // 保存された「最後に受け取った時刻」が未来(5分超)だと、それ以降の通信を全部読み飛ばしてしまうので捨てる
        if (saved.t && saved.t > serverNow() + 5 * 60 * 1000) { saved.t = 0; saved.id = ''; }
        const first = !saved.t;
        st.lastSeen = saved.t || (serverNow() - 10000); // 初めての端末は「今から」のものだけ受け取る
        st.lastSeenId = saved.id || '';
        st.attachLastId = saved.id || '';
        st.seen = new Set();

        const durableQ = base.child('events').orderByChild('t').startAt(st.lastSeen);
        const liveQ = base.child('live').orderByChild('t').startAt(serverNow() - 3000);
        st.refs = { base, durableQ, liveQ };
        attachPresence(base, gen);
        durableQ.on('child_added', (s) => onChild(s, gen, true), onListenError);
        liveQ.on('child_added', (s) => onChild(s, gen, false), onListenError);
        if (first) { /* 初回は特別な処理なし（過去分はバックアップとの照合で受け取る） */ }
    }

    /* =========================================================
       送信
       ========================================================= */
    // 暗号化（順番どおりに1件ずつ）→ 書き込み（返事は待たず、続けて出す）
    async function writeEvent(name, data, gen) {
        const t0 = Date.now();
        const d = await encryptJson(data === undefined ? null : data);
        if (d.length > MAX_PAYLOAD_CHARS) throw new Error('PAYLOAD_TOO_LARGE');
        if (gen !== st.gen || !st.refs) return false;
        if (d.length > 500000) {
            stats.bigSends.push({ name, chars: d.length, at: Date.now() });
            if (stats.bigSends.length > 20) stats.bigSends.shift();
            console.warn(`[sync] 大きなデータを送っています（${name}: 約${Math.round(d.length / 1000)}KB）。他端末の受信が遅くなる原因になります`);
        }
        const live = LIVE_EVENTS.has(name);
        const ref = st.refs.base.child(live ? 'live' : 'events').push();
        // set() は呼んだ順にサーバーへ送られる。返事（Promise）は待たない。
        ref.set({ n: name, t: firebase.database.ServerValue.TIMESTAMP, s: DEVICE_TAG, d }).then(() => {
            stats.lastSendMs = Date.now() - t0;
        }).catch((e) => {
            console.warn(`[sync] 送信に失敗しました（${name}）:`, e && e.message ? e.message : e);
        });
        stats.sent++;
        return true;
    }

    function enqueueWrite(name, data) {
        const gen = st.gen;

        // カート更新は、送信待ちの間に来た古いものを捨て、最新の1件だけ送る
        if (name === 'update-cart') {
            if (st.cartPending) stats.droppedCarts++;
            st.cartPending = { data };
            if (st.cartScheduled) return st.pubQueue;
            st.cartScheduled = true;
            st.pubQueue = st.pubQueue.then(() => {
                st.cartScheduled = false;
                const p = st.cartPending;
                st.cartPending = null;
                return p ? writeEvent('update-cart', p.data, gen) : false;
            }).catch((e) => {
                console.warn('[sync] 送信に失敗しました（update-cart）:', e && e.message ? e.message : e);
                return false;
            });
            return st.pubQueue;
        }

        // 送る順番を守るため、暗号化は1件ずつ順に行う（暗号化の時間差で順番が入れ替わらないように）
        st.pubQueue = st.pubQueue.then(() => writeEvent(name, data, gen)).catch((e) => {
            console.warn(`[sync] 送信に失敗しました（${name}）:`, e && e.message ? e.message : e);
            return false;
        });
        return st.pubQueue;
    }

    function publish(name, data) {
        if (!name) return Promise.resolve(false);
        if (!st.code) return Promise.resolve(false); // データ用コード未設定：送らない
        if (!st.ready) {
            if (name === 'update-cart') {
                // 準備前に溜めるカート更新は最新の1件だけ残す
                const i = pending.findIndex(p => p.name === 'update-cart');
                if (i >= 0) pending.splice(i, 1);
            }
            if (pending.length < 300) pending.push({ name, data });
            return Promise.resolve(false);
        }
        return enqueueWrite(name, data);
    }

    function flushPending() {
        const list = pending.splice(0, pending.length);
        list.forEach(p => enqueueWrite(p.name, p.data));
    }

    /* =========================================================
       古いデータの掃除（Firebaseのデータを「消す」）
       ========================================================= */
    async function cleanRef(ref, limitT) {
        const snap = await ref.orderByChild('t').endAt(limitT).limitToFirst(300).once('value');
        const upd = {};
        let n = 0;
        snap.forEach((c) => { upd[c.key] = null; n++; });
        if (n > 0) await ref.update(upd);
        return n;
    }

    async function cleanupOld() {
        if (!st.ready || !st.online || !st.refs) return;
        try {
            await cleanRef(st.refs.base.child('events'), serverNow() - DURABLE_TTL_MS);
            await cleanRef(st.refs.base.child('live'), serverNow() - LIVE_TTL_MS);
        } catch (e) {
            console.warn('[sync] 古いデータの掃除に失敗しました（次回また試します）:', e && e.message ? e.message : e);
        }
    }
    setInterval(cleanupOld, 20 * 60 * 1000);

    /* =========================================================
       開始・コード操作
       ========================================================= */
    async function start() {
        const gen = ++st.gen;
        detach();
        st.ready = false;
        st.key = null;
        st.hash = '';
        st.code = loadCode();

        if (!st.code) { refreshStatus(); return; }
        const db = getDb();
        if (!db) { st.status = ''; refreshStatus(); console.warn('[sync] Firebase Realtime Database を使えません（SDKの読み込みを確認してください）'); return; }
        st.db = db;
        bindInfoListeners(db);
        refreshStatus();

        let derived;
        try {
            derived = await deriveAll(st.code);
        } catch (e) {
            console.warn('[sync] 暗号鍵を作れませんでした（https のページで開いてください）:', e);
            st.status = '';
            st.status = 'error';
            dispatch('pos-sync-status', { status: 'error' });
            return;
        }
        if (gen !== st.gen) return;
        st.key = derived.key;
        st.hash = derived.hash;
        attach(gen);
        st.ready = true;
        refreshStatus();
        flushPending();
        setTimeout(cleanupOld, 3000);
        dispatch('pos-sync-ready', { code: st.code });
    }

    async function codeExists(code) {
        const db = getDb();
        if (!db) throw new Error('NO_DATABASE');
        const hash = await pathHashOf(code);
        const snap = await withTimeout(db.ref('pos_sync/' + hash + '/meta').once('value'), 8000, 'TIMEOUT');
        return snap.exists();
    }

    async function issueNewCode() {
        const db = getDb();
        if (!db) throw new Error('NO_DATABASE');
        const code = generateCode();
        const hash = await pathHashOf(code);
        await withTimeout(db.ref('pos_sync/' + hash + '/meta').set({ createdAt: firebase.database.ServerValue.TIMESTAMP, v: 1 }), 10000, 'TIMEOUT');
        saveCode(code);
        await start();
        dispatch('pos-sync-code-changed', { code, issued: true });
        return code;
    }

    async function applyCode(input) {
        const code = normalizeCode(input);
        if (!code) throw new Error('INVALID');
        const exists = await codeExists(code);
        if (!exists) throw new Error('NOT_FOUND');
        saveCode(code);
        await start();
        dispatch('pos-sync-code-changed', { code, received: true });
        return code;
    }

    async function clearCode() {
        saveCode('');
        await start();
        dispatch('pos-sync-code-changed', { code: '' });
    }

    /* =========================================================
       従来の channel と同じ形の入れ物
       ========================================================= */
    function toNameList(a) {
        if (Array.isArray(a)) return a.filter(x => typeof x === 'string');
        if (typeof a === 'string') return [a];
        return [];
    }

    const shim = {
        publish(a, b) {
            // publish(name, data) と publish({name, data}) の両方に対応
            if (a && typeof a === 'object' && !Array.isArray(a)) return publish(a.name, a.data);
            return publish(a, b);
        },
        subscribe(a, b) {
            if (typeof a === 'function') { anyHandlers.add(a); return Promise.resolve(); }
            if (typeof b !== 'function') return Promise.resolve();
            toNameList(a).forEach((n) => {
                if (!handlers.has(n)) handlers.set(n, new Set());
                handlers.get(n).add(b);
            });
            return Promise.resolve();
        },
        unsubscribe(a, b) {
            if (typeof a === 'function') { anyHandlers.delete(a); return; }
            toNameList(a).forEach((n) => {
                const set = handlers.get(n);
                if (!set) return;
                if (typeof b === 'function') set.delete(b); else set.clear();
            });
        },
        presence: {
            enter() { return Promise.resolve(); },
            leave() { return Promise.resolve(); },
            get() { return Promise.resolve([]); },
            subscribe() { return Promise.resolve(); },
            unsubscribe() { }
        },
        __isPosSyncChannel: true
    };

    // グローバル変数 channel（state.js で宣言済み）に入れる。
    // 作り直さずに同じ入れ物を使い続けるので、あとから subscribe した処理も、
    // データ用コードを変えた後も、そのまま使える。
    channel = shim;

    /* =========================================================
       起動時の同期の準備（initRealtimeSync）
       ------------------------------------------
       以前は ui.js が、画面入力欄のAPIキーを読んで接続し、
       カート表示（update-cart）・年齢確認・詐欺注意の受信を登録していた。
       接続はこのファイルが行うので、受信の登録だけを同じ内容で行う。
       ========================================================= */
    let coreRegistered = false;
    function registerCoreSubscriptions() {
        if (coreRegistered) return;
        coreRegistered = true;

        shim.subscribe('update-cart', (message) => {
            cart = message.data.cart;
            currentTotal = message.data.total;
            billingAmount = message.data.billing || currentTotal;
            currentDeposit = message.data.deposit || 0;
            currentChange = message.data.change || 0;
            usedPoints = message.data.pointsUsed || 0;
            isRegisterPaused = !!message.data.isPaused;
            lastScannedBarcode = message.data.lastBarcode || '';
            selectedPayment = message.data.payment || selectedPayment;
            customerDisplayMemberInfo = message.data.member || null;
            updatePauseUI();
            updateCustomerDisplay();
        });

        shim.subscribe('age-check-event', (message) => {
            const data = message.data || {};
            const isOwnDevice = data.senderId && typeof POS_DEVICE_ID !== 'undefined' && data.senderId === POS_DEVICE_ID;
            const isCustDisplay = typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice();
            if (data.action === 'start') {
                if (!isOwnDevice && !isCustDisplay) return;
                pendingAgeCheckItem = data.item;
                showAgeCheckModals();
            } else if (data.action === 'cancel' || data.action === 'success') {
                if (!isOwnDevice && !pendingAgeCheckItem) return;
                if (data.action === 'cancel') onAgeCheckCancel();
                else onAgeCheckSuccess();
            }
        });

        shim.subscribe('fraud-warning-event', (message) => {
            const data = message.data || {};
            const isOwnDevice = data.senderId && typeof POS_DEVICE_ID !== 'undefined' && data.senderId === POS_DEVICE_ID;
            const isCustDisplay = typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice();
            if (data.action === 'start') {
                if (!isOwnDevice && !isCustDisplay) return;
                pendingFraudCheckItem = data.item;
                showFraudWarningModal();
            } else if (data.action === 'success') {
                if (!isOwnDevice && !pendingFraudCheckItem) return;
                onFraudWarningAgreed();
            }
        });
    }

    window.initRealtimeSync = function () { registerCoreSubscriptions(); };
    registerCoreSubscriptions();

    /* =========================================================
       外に見せるもの
       ========================================================= */
    window.PosSync = {
        DEVICE_TAG,
        getCode() { return st.code; },
        formatCode,
        normalizeCode,
        getStatus() { return st.status; },
        isReady() { return st.ready; },
        start,
        issueNewCode,
        applyCode,
        clearCode,
        codeExists,
        publish,
        serverNow,
        encryptJson,
        decryptJson,
        // 二重保存（バックアップ）が、同じコードの保存場所を使うためのもの
        // 遅延の調査用：コンソールで PosSync.getStats() を実行して確認する
        getStats() {
            const lags = stats.lags.map(x => x.lagMs);
            const avg = lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) : 0;
            const max = lags.length ? Math.max.apply(null, lags) : 0;
            return {
                status: st.status, online: st.online,
                sent: stats.sent, received: stats.received, droppedCarts: stats.droppedCarts,
                recentLagAvgMs: avg, recentLagMaxMs: max,
                recent: stats.lags.slice(-10),
                lastSendAckMs: stats.lastSendMs,
                bigSends: stats.bigSends.slice(-5)
            };
        },
        // いま同期中の端末の数（この端末を含む）。0なら未接続
        getDeviceCount() { return st.ready ? (st.deviceCount || 0) : 0; },
        getBaseRef() { return st.refs ? st.refs.base : null; },
        getPathHash() { return st.hash; }
    };

    // 画面の準備ができたら開始（Firebase の初期化は index.html の先頭で済んでいる）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // 回線が戻った時、タブに戻った時に、つなぎ直しの確認をする
    window.addEventListener('online', () => { if (st.code && !st.ready) start(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && st.code && !st.ready) start();
    });
})();
