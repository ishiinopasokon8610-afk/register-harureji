// ==========================================
// self-checkout-system.js
// ------------------------------------------
// 【新機能】セルフレジ（お客様が自分でスキャン → 会計（お支払い）はレジで行う）
//
// ■ お客様側（セルフレジ画面）
//   ・データ管理画面の「🛒 この端末をセルフレジ画面にする」を押すと、その端末が
//     セルフレジ画面（全画面）になる。ページを開き直しても、セルフレジ画面のまま。
//   ・バーコードの読み取り方は2通り（どちらも使える）
//       ① バーコードスキャナー（キーボード入力のタイプ）／手入力
//       ② 📷 カメラで読み取る（対応ブラウザは標準機能、非対応は ZXing を読み込んで読み取る）
//   ・読み取るたびに「ピッ」と音が鳴り、商品名と価格を読み上げる。
//     商品の一覧には、数量の＋−・削除ボタンがある。
//   ・「お会計へ進む」を押すと、注文番号とバーコード（SC123456 のような形）が出る。
//     お客様はそれをレジの店員に見せる。
//   ・レジで会計が終わると「ありがとうございました」が出て、自動で最初の画面に戻る。
//   ・画面の左下の 🔒 から、店長認証をしないと、セルフレジ画面を終了できない。
//
// ■ レジ（店員）側
//   ・セルフレジから注文が届くと、音と読み上げでお知らせし、レジ画面の右下に
//     「🛒 セルフレジ待ち N件」が出る（押すと一覧。「読み込む」でカートに入る）。
//   ・注文のバーコード（SC123456）を、いつものバーコード欄で読み取っても、同じように
//     カートに入る。あとは、いつも通りお支払い（現金・クレジット・QR・ポイント）に進む。
//   ・年齢確認・詐欺注意が必要な商品は、レジで通常のスキャンと同じ確認の画面が出る。
//   ・会計が完了すると、セルフレジ側に「ありがとうございました」を送る。
//
// 通信は、他の機能と同じ同期の窓口（channel／firebase-sync-system.js）を使う。
// register.js / ui.js / index.html は直接編集せず、フック方式で実現する。
//
// 【今回の更新内容】
// ・スキャンした商品（と会員カード）を、変更のたびに localStorage（pos_sync_self_cart）へ控えるようにした。
//   間違えてページを更新しても、読み取り済みの商品が消えず、そのまま戻る。
//   控えを消すのは：レジで支払い済みになった時／最初の画面に戻った時／セルフレジを終了した時／
//   最後の操作から30分たった時（次のお客様に前の人の商品が出ないように）。
// ・ホーム画面：「客用画面」「セルフレジ」の2つのボタンを、専用の枠（flex）で囲むのをやめ、
//   他の行（担当者管理／商品管理 など）と同じ2列の表（グリッド）の中に直接置くようにした。
//   これで、左右の端・ボタン同士のすき間・列の位置が下の行とぴったり揃う。
// ・セルフレジを始めた直後に店長ロックをかける（auth-system.js の managerAuthDone を
//   false に戻す）。終了する時は、もう一度店長バーコードの入力が必要。
//   ※ホーム画面への移動や「店長ロックをかけました」の読み上げはしない。
// ・「レジへ送信しました」の画面は、5秒後に自動で最初の画面
//   （いらっしゃいませ／ロゴ／会計スタート）へ戻る。送信済みの注文はレジ側にそのまま残る。
// ・最初の画面に「いらっしゃいませ」を表示するようにした。
// ・セルフレジを始めたら、必ず全画面にする（全画面を保ち続ける仕組みは
//   fullscreen-lock-system.js。こちらは開始の瞬間に全画面を要求する）。
// ・注文・状態・見守りの通信は、すべて firebase-sync-system.js の channel
//   （＝Firebase Realtime Database）で行う。送信する前に Firebase とつながっているか
//   を確認し、つながっていない時は「レジへ送信しました」とは表示せず、
//   お客様に店員を呼んでもらうようにした（実際は届いていないのに、会計に来られて
//   しまうのを防ぐ）。
//
// 【導入方法】
// index.html内で、register.js・ui.js・auth-system.js・firebase-sync-system.js・
// cart-sync-fixes-system.js・checkout-demographics.js より後ろに読み込む。
//   <script src="self-checkout-system.js"></script>
// ==========================================

(function selfCheckoutSystem() {
    'use strict';

    /* =========================================================
       設定・共通部品
       ========================================================= */
    const MODE_KEY = 'pos_sync_self_checkout_mode';          // この端末がセルフレジ画面か（端末ごと。pos_sync_ なので同期されない）
    const PENDING_KEY = 'pos_sync_self_orders';              // レジ側：届いている注文（端末ごと）
    const DONE_KEY = 'pos_sync_self_orders_done';            // レジ側：処理済みの注文ID（再配信で二重に出さないため）
    const ORDER_TTL_MS = 30 * 60 * 1000;                     // 30分たった注文は無効
    const EV_ORDER = 'self-checkout-order';
    const EV_STATUS = 'self-checkout-status';
    const EV_LIVE = 'self-checkout-live';
    const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    const EXIT_TARGET = 'self-checkout-exit';
    const START_TARGET = 'self-checkout-start';
    const CART_KEY = 'pos_sync_self_cart';                   // お客様側：スキャン中の商品の控え（端末ごと。pos_sync_ なので同期・バックアップされない）
    const CART_TTL_MS = 30 * 60 * 1000;                      // 最後の操作から30分たった控えは、次のお客様のため捨てる

    const MY_ID = (typeof SYNC_DEVICE_ID !== 'undefined' && SYNC_DEVICE_ID)
        ? SYNC_DEVICE_ID
        : 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2);

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s === undefined || s === null ? '' : s);
        return d.innerHTML;
    }

    function yen(n) { return '¥' + (Number(n) || 0).toLocaleString(); }

    function sound(type) { try { if (typeof playSound === 'function') playSound(type); } catch (e) { /* 無視 */ } }
    function say(text) { try { if (typeof speak === 'function') speak(text); } catch (e) { /* 無視 */ } }

    function readJson(key, fallback) {
        try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; }
        catch (e) { return fallback; }
    }
    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 無視 */ }
    }

    function publish(name, data) {
        if (typeof channel === 'undefined' || !channel) return false;
        try {
            channel.publish(name, Object.assign({ senderId: MY_ID, time: Date.now() }, data));
            return true;
        } catch (e) {
            console.warn('[self-checkout] 送信に失敗しました:', name, e);
            return false;
        }
    }

    function isSelfMode() { return localStorage.getItem(MODE_KEY) === '1'; }

    // 全画面にする（fullscreen-lock-system.js があればそちらを使う。無ければ標準の方法で要求する）
    function forceFullscreen() {
        try {
            if (window.haruFullscreenLock && typeof window.haruFullscreenLock.enter === 'function') { window.haruFullscreenLock.enter(); return; }
        } catch (e) { /* 無視 */ }
        try {
            if (typeof requestFullscreen === 'function') { requestFullscreen(); return; }
            const d = document.documentElement;
            const fn = d.requestFullscreen || d.webkitRequestFullscreen;
            if (fn) { const p = fn.call(d); if (p && p.catch) p.catch(() => {}); }
        } catch (e) { /* 無視 */ }
    }

    // Firebase（firebase-sync-system.js）とつながっていて、注文を送れる状態か。
    // 'connecting'（つなぎ中）は、つながり次第送られるので送れる扱い。
    // 'nocode'（データ用コード未設定）・'error'・'offline' は、届かないので送れない扱い。
    function canSendToFirebase() {
        try {
            if (window.PosSync && typeof window.PosSync.getStatus === 'function') {
                const s = window.PosSync.getStatus();
                return s === 'online' || s === 'connecting';
            }
        } catch (e) { /* 無視 */ }
        return typeof channel !== 'undefined' && !!channel; // PosSyncが無い構成では、従来どおり
    }

    function isActiveScreen(id) {
        const el = $(id);
        return !!(el && el.classList.contains('active'));
    }

    /* =========================================================
       見た目（セルフレジ画面・レジ側の表示で共通）
       ========================================================= */
    function ensureStyle() {
        if ($('self-checkout-style')) return;
        const st = document.createElement('style');
        st.id = 'self-checkout-style';
        st.textContent = `
        #self-checkout-root { position:fixed; inset:0; z-index:900; display:none; flex-direction:column;
            background:#eef3f9; color:#1f2933; font-family:'Hiragino Sans','Yu Gothic',sans-serif; }
        #self-checkout-root * { box-sizing:border-box; }
        .sc-top { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 16px;
            background:#1e3a5f; color:#fff; flex-wrap:wrap; }
        .sc-title { font-size:20px; font-weight:900; }
        .sc-sub { font-size:13px; opacity:.85; }
        .sc-iconbtn { background:rgba(255,255,255,.15); color:#fff; border:none; border-radius:10px; padding:8px 12px; font-size:14px; cursor:pointer; }
        .sc-main { flex:1; min-height:0; display:flex; gap:12px; padding:12px; }
        .sc-left { flex:1.4; min-width:0; display:flex; flex-direction:column; gap:8px; }
        .sc-right { flex:1; min-width:260px; display:flex; flex-direction:column; gap:10px; }
        .sc-list { flex:1; min-height:120px; overflow-y:auto; background:#fff; border-radius:14px; padding:6px 12px;
            box-shadow:0 2px 8px rgba(0,0,0,.08); -webkit-overflow-scrolling:touch; }
        .sc-empty { text-align:center; color:#7b8794; padding:36px 8px; font-size:16px; line-height:1.8; }
        .sc-row { display:flex; align-items:center; gap:8px; padding:10px 0; border-bottom:1px dashed #d9e2ec; }
        .sc-row-name { flex:1; min-width:0; font-weight:700; font-size:16px; word-break:break-all; }
        .sc-row-note { display:block; font-size:12px; font-weight:400; color:#c62828; margin-top:2px; }
        .sc-row-price { font-size:13px; color:#52606d; white-space:nowrap; }
        .sc-qty { display:flex; align-items:center; gap:6px; }
        .sc-qty button { width:34px; height:34px; border-radius:50%; border:2px solid #cbd2d9; background:#fff; font-size:18px; font-weight:900; cursor:pointer; color:#1f2933; }
        .sc-qty span { min-width:24px; text-align:center; font-weight:900; font-size:17px; }
        .sc-row-sub { min-width:78px; text-align:right; font-weight:900; font-size:16px; }
        .sc-del { background:none; border:none; font-size:20px; cursor:pointer; }
        .sc-panel { background:#fff; border-radius:14px; padding:14px; box-shadow:0 2px 8px rgba(0,0,0,.08); }
        .sc-input { width:100%; padding:14px; font-size:18px; border:2px solid #9fb3c8; border-radius:12px; }
        .sc-input:focus { outline:3px solid #7aa7d9; }
        .sc-btn { width:100%; border:none; border-radius:14px; padding:14px; font-size:16px; font-weight:900; cursor:pointer; color:#fff; }
        .sc-btn.blue { background:#3b6fb6; } .sc-btn.gray { background:#6b7785; } .sc-btn.red { background:#c0392b; }
        .sc-btn.green { background:#1f9d55; font-size:22px; padding:20px; }
        .sc-btn:disabled { opacity:.4; cursor:not-allowed; }
        .sc-total { display:flex; justify-content:space-between; align-items:baseline; font-weight:900; }
        .sc-total .big { font-size:34px; color:#c0392b; }
        .sc-msg { min-height:24px; font-size:15px; font-weight:700; color:#c62828; }
        .sc-msg.ok { color:#1f7a3f; }
        .sc-cam-wrap { display:none; }
        .sc-cam-wrap video { width:100%; max-height:260px; background:#000; border-radius:12px; }
        .sc-center { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; text-align:center; padding:20px; }
        .sc-logo { max-width:min(90%,720px); max-height:38vh; width:auto; height:auto; object-fit:contain; image-rendering:auto; }
        .sc-bigcode { font-size:56px; font-weight:900; letter-spacing:4px; color:#1e3a5f; }
        .sc-bigtext { font-size:24px; font-weight:900; line-height:1.5; }
        .sc-status { font-size:18px; font-weight:700; color:#8a5a00; }
        .sc-barcode-box { background:#fff; padding:12px 18px; border-radius:14px; box-shadow:0 2px 8px rgba(0,0,0,.1); max-width:100%; overflow-x:auto; }
        .sc-lock { position:absolute; left:10px; bottom:10px; width:44px; height:44px; border-radius:50%; border:none;
            background:rgba(0,0,0,.08); font-size:18px; cursor:pointer; }
        @media (max-width: 760px) {
            .sc-main { flex-direction:column; overflow-y:auto; }
            .sc-left { flex:none; min-height:240px; }
            .sc-right { min-width:0; flex:none; }
            .sc-bigcode { font-size:40px; }
        }
        /* レジ側：セルフレジ待ちの表示 */
        #sc-pending-badge { position:fixed; right:14px; bottom:64px; z-index:8000; display:none; border:none;
            background:#e67e22; color:#fff; font-weight:900; font-size:15px; padding:12px 18px; border-radius:999px;
            box-shadow:0 6px 18px rgba(0,0,0,.35); cursor:pointer; animation:scPulse 1.4s ease-in-out infinite; }
        @keyframes scPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.07); } }
        #sc-pending-modal { position:fixed; inset:0; z-index:20000; background:rgba(0,0,0,.55); display:none;
            align-items:center; justify-content:center; padding:12px; }
        #sc-pending-modal .box { background:#fff; color:#1f2933; border-radius:14px; width:100%; max-width:520px; max-height:88vh;
            overflow-y:auto; padding:16px; }
        .sc-order { border:2px solid #cbd2d9; border-radius:12px; padding:10px 12px; margin-bottom:10px; }
        .sc-order b.code { font-size:20px; letter-spacing:2px; color:#1e3a5f; }
        .sc-order-btns { display:flex; gap:8px; margin-top:8px; }
        .sc-order-btns button { flex:1; border:none; border-radius:10px; padding:10px; font-weight:900; cursor:pointer; color:#fff; }
        `;
        document.head.appendChild(st);
    }

    /* =========================================================
       ■ お客様側：セルフレジ画面
       ========================================================= */
    const S = {
        view: 'start',          // 'start' | 'card' | 'scan' | 'wait' | 'thanks'
        memberBarcode: '',      // ポイントカード（会員）のバーコード。持っていなければ空
        items: [],              // { jan, name, price, qty, taxRate, genre, ageCheck, fraudCheck }
        order: null,            // 送信済みの注文 { id, code }
        lastCode: '', lastAt: 0,
        msgTimer: null, thanksTimer: null, waitTimer: null,
        scanner: null
    };

    /* ---------- スキャン中の商品の控え（間違えてページを更新しても消えないように） ---------- */
    // 商品・会員カード・画面の状態を、変更のたびに localStorage へ控える。
    // 会計が終わる（レジで支払い済み）・最初の画面に戻る・セルフレジを終了する時は、控えを消す。
    function saveCart() {
        try {
            if (!isSelfMode()) return;
            if (S.items.length === 0 && !S.order) { localStorage.removeItem(CART_KEY); return; }
            localStorage.setItem(CART_KEY, JSON.stringify({
                savedAt: Date.now(),
                view: S.view,
                memberBarcode: S.memberBarcode || '',
                items: S.items,
                order: S.order
            }));
        } catch (e) { /* 無視 */ }
    }

    function clearSavedCart() {
        try { localStorage.removeItem(CART_KEY); } catch (e) { /* 無視 */ }
    }

    // 控えを S に戻す。戻せたら true。古い（30分超）・壊れている・空の控えは捨てる
    function restoreCart() {
        try {
            const d = JSON.parse(localStorage.getItem(CART_KEY));
            if (!d || !Array.isArray(d.items) || (Date.now() - (Number(d.savedAt) || 0)) > CART_TTL_MS) { clearSavedCart(); return false; }
            const items = d.items.filter(i => i && i.name && Number(i.qty) > 0);
            if (items.length === 0) { clearSavedCart(); return false; }
            S.items = items;
            S.memberBarcode = d.memberBarcode || '';
            S.order = null;
            S.view = 'scan';
            // レジへ送信済みだった場合は、「送信しました」画面に戻し、5秒後に最初の画面へ（通常の流れと同じ）
            if (d.view === 'wait' && d.order && d.order.id) { S.order = d.order; S.view = 'wait'; }
            return true;
        } catch (e) { clearSavedCart(); return false; }
    }

    function findProduct(code) {
        const list = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
        return list.find(p => p && (String(p.jan) === String(code) || p.name === code)) || null;
    }

    function totals() {
        let count = 0, sum = 0;
        S.items.forEach(i => { count += i.qty; sum += i.price * i.qty; });
        return { count, sum };
    }

    function buildRoot() {
        ensureStyle();
        let root = $('self-checkout-root');
        if (root) return root;
        root = document.createElement('div');
        root.id = 'self-checkout-root';
        root.innerHTML = `
            <div class="sc-top">
                <div><span class="sc-title">🛒 セルフレジ</span> <span class="sc-sub" id="sc-top-sub"></span></div>
                <div><button type="button" class="sc-iconbtn" id="sc-fs-btn">⛶ 全画面</button></div>
            </div>
            <div id="sc-view" style="flex:1;min-height:0;display:flex;flex-direction:column;"></div>
            <button type="button" class="sc-lock" id="sc-lock-btn" title="終了（店長認証）">🔒</button>`;
        document.body.appendChild(root);
        root.querySelector('#sc-lock-btn').addEventListener('click', requestExit);
        root.querySelector('#sc-fs-btn').addEventListener('click', () => {
            forceFullscreen();
        });
        return root;
    }

    function flash(text, ok) {
        const el = $('sc-msg');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'sc-msg' + (ok ? ' ok' : '');
        if (S.msgTimer) clearTimeout(S.msgTimer);
        if (text) S.msgTimer = setTimeout(() => { const e2 = $('sc-msg'); if (e2) e2.textContent = ''; }, 4000);
    }

    /* ---------- 商品の追加・変更 ---------- */
    function addProduct(prod) {
        const price = Number(prod.price) || 0;
        const taxRate = (prod.taxRate === undefined || prod.taxRate === null) ? 10 : prod.taxRate;
        const ex = S.items.find(i => i.jan === String(prod.jan) && i.price === price);
        if (ex) ex.qty += 1;
        else S.items.push({
            jan: String(prod.jan || ''), name: prod.name, price: price, qty: 1, taxRate: taxRate,
            genre: prod.genre || 'その他商品', ageCheck: !!prod.ageCheck, fraudCheck: !!prod.fraudCheck
        });
        renderScanList();
        sound('beep');
        // 合計の点数（「1点」「2点」…）を読み上げる。同じ商品なら「同じ商品がスキャンされました」
        const total = totals().count;
        if (ex) {
            say(`おなじ しょうひん が すきゃん さ れ まし た。 ごうけい ${total} てん`);
            flash(`同じ商品がスキャンされました（合計 ${total}点）`, true);
        } else {
            say(`${prod.name}、 ${price} えん。 ごうけい ${total} てん`);
            flash(`${prod.name} を追加しました（合計 ${total}点）`, true);
        }
        if (prod.ageCheck) flash('🔞 この商品は、レジで店員が年齢確認をします', true);
    }

    function handleScanned(raw) {
        if (S.view !== 'scan') return;
        const code = String(raw || '').trim();
        if (!code) return;
        const t = Date.now();
        if (code === S.lastCode && t - S.lastAt < 700) return; // スキャナーの二重読み取りを防ぐ
        S.lastCode = code;
        S.lastAt = t;
        const prod = findProduct(code);
        if (!prod) {
            sound('error');
            say('この しょうひん は とうろく さ れ て い ませ ん。 てんいん を および ください');
            flash('この商品は登録されていません。店員をお呼びください');
            return;
        }
        addProduct(prod);
    }

    function changeQty(index, delta) {
        const it = S.items[index];
        if (!it) return;
        it.qty += delta;
        if (it.qty <= 0) S.items.splice(index, 1);
        sound('click');
        renderScanList();
    }

    function removeItem(index) {
        S.items.splice(index, 1);
        sound('click');
        renderScanList();
    }

    function undoLast() {
        if (S.items.length === 0) { sound('error'); return; }
        const last = S.items[S.items.length - 1];
        last.qty -= 1;
        if (last.qty <= 0) S.items.pop();
        sound('click');
        say(`${last.name} を とりけし まし た`);
        renderScanList();
    }

    function clearAll() {
        if (S.items.length === 0) return;
        const doIt = () => { S.items = []; sound('click'); renderScanList(); flash('最初からやり直します', true); };
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('読み取った商品をすべて消して、最初からやり直しますか？', 'ぜんぶ けして さいしょ から やりなおし ます か？', (res) => { if (res) doIt(); }, true);
        } else if (window.confirm('読み取った商品をすべて消しますか？')) {
            doIt();
        }
    }

    /* ---------- 画面の描画 ---------- */
    // レジ側の「様子を見る」画面へ、いまのスキャン状況をリアルタイムで知らせる（万引き防止の見守り用）
    function publishLive(gone) {
        const t = totals();
        publish(EV_LIVE, {
            gone: !!gone,
            view: S.view,
            hasMember: !!S.memberBarcode,
            count: t.count,
            total: t.sum,
            items: S.items.map(i => ({ name: i.name, qty: i.qty, price: i.price }))
        });
    }

    function clearWaitTimer() {
        if (S.waitTimer) { clearTimeout(S.waitTimer); S.waitTimer = null; }
    }

    function setView(v) {
        // 「レジへ送信しました」画面から別の画面へ移る時は、5秒後に戻すタイマーを止める
        if (v !== 'wait') clearWaitTimer();
        S.view = v;
        if (v === 'start' || v === 'thanks') clearSavedCart(); else saveCart();
        renderView(); publishLive(false);
    }

    // 最初の画面へ戻す（次のお客様のために、商品・会員カード・注文の紐づけをすべて空にする）
    function resetToStart() {
        clearWaitTimer();
        if (S.thanksTimer) { clearTimeout(S.thanksTimer); S.thanksTimer = null; }
        S.items = [];
        S.order = null;       // レジ側へ送信済みの注文は、レジに残る（ここでは何も取り消さない）
        S.memberBarcode = '';
        clearSavedCart();
        setView('start');
    }

    function renderView() {
        const host = $('sc-view');
        if (!host) return;
        stopScanner();
        if (S.view === 'start') renderStartView(host);
        else if (S.view === 'card') renderCardView(host);
        else if (S.view === 'scan') renderScanView(host);
        else if (S.view === 'wait') renderWaitView(host);
        else renderThanksView(host);
    }

    /* ---------- 最初の画面（店のロゴ＋会計スタート） ---------- */
    function getShopLogoSrc() {
        // ホーム画面で使っているロゴ（設定済みならそれ）を、そのままの解像度で使う
        const home = $('home-shop-logo');
        if (home && home.getAttribute('src')) return home.getAttribute('src');
        try { return localStorage.getItem('pos_shop_logo') || ''; } catch (e) { return ''; }
    }

    function renderStartView(host) {
        $('sc-top-sub').textContent = '';
        const logo = getShopLogoSrc();
        host.innerHTML = `
            <div class="sc-center">
                <div class="sc-bigtext" style="font-size:44px;">いらっしゃいませ</div>
                ${logo ? `<img src="${esc(logo)}" alt="" class="sc-logo">` : ''}
                <button type="button" class="sc-btn green" id="sc-start-btn" style="max-width:480px;font-size:30px;padding:30px;">会計スタート</button>
            </div>`;
        $('sc-start-btn').addEventListener('click', () => {
            sound('click');
            S.memberBarcode = '';
            say('ぽいんと かーど は おもち です か');
            setView('card');
        });
    }

    /* ---------- ポイントカードはお持ちですか？ ---------- */
    function renderCardView(host) {
        $('sc-top-sub').textContent = '';
        host.innerHTML = `
            <div class="sc-center">
                <div class="sc-bigtext" style="font-size:34px">ポイントカードはお持ちですか？</div>
                <div id="sc-card-area" style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;width:100%;">
                    <button type="button" class="sc-btn blue" id="sc-card-yes" style="max-width:260px;font-size:24px;padding:26px;">はい</button>
                    <button type="button" class="sc-btn gray" id="sc-card-no" style="max-width:260px;font-size:24px;padding:26px;">いいえ</button>
                </div>
            </div>`;
        $('sc-card-no').addEventListener('click', () => { sound('click'); S.memberBarcode = ''; setView('scan'); });
        $('sc-card-yes').addEventListener('click', () => {
            sound('click');
            say('かーど の ばーこーど を よみとって ください');
            $('sc-card-area').innerHTML = `
                <div style="width:100%;max-width:480px;">
                    <input type="text" id="sc-card-input" class="sc-input" inputmode="numeric" autocomplete="off"
                           placeholder="ポイントカードのバーコードを読み取る">
                    <div class="sc-msg" id="sc-msg"></div>
                    <button type="button" class="sc-btn gray" id="sc-card-skip">カードなしで進む</button>
                </div>`;
            const input = $('sc-card-input');
            try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const v = input.value.trim();
                input.value = '';
                if (!v) return;
                const list = (typeof customers !== 'undefined' && Array.isArray(customers)) ? customers : [];
                const c = list.find(x => x && x.barcode === v);
                if (!c) { sound('error'); say('この かーど は とうろく さ れ て い ませ ん'); flash('このカードは登録されていません'); return; }
                S.memberBarcode = v;
                sound('success');
                say('かーど を かくにん し まし た');
                setView('scan');
            });
            $('sc-card-skip').addEventListener('click', () => { sound('click'); S.memberBarcode = ''; setView('scan'); });
        });
    }

    /* ---------- バーコードが付いていない商品：商品一覧から選ぶ ---------- */
    function openProductPicker() {
        sound('click');
        const old = $('sc-picker'); if (old) old.remove();
        const list = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
        const m = document.createElement('div');
        m.id = 'sc-picker';
        m.style.cssText = 'position:absolute;inset:0;z-index:5;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
        m.innerHTML = `<div style="background:#fff;border-radius:14px;width:100%;max-width:640px;max-height:92%;display:flex;flex-direction:column;padding:14px;">
            <h3 style="margin:0 0 8px;">バーコードがない商品を選ぶ</h3>
            <input type="text" id="sc-picker-search" class="sc-input" placeholder="🔍 商品名で検索" style="margin-bottom:8px;">
            <div id="sc-picker-list" style="flex:1;min-height:120px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;"></div>
            <button type="button" class="sc-btn gray" id="sc-picker-close" style="margin-top:10px;">閉じる</button></div>`;
        $('self-checkout-root').appendChild(m);
        const draw = () => {
            const q = ($('sc-picker-search').value || '').trim().toLowerCase();
            const box = $('sc-picker-list');
            const shown = list.filter(p => p && p.name && !p.archived && (!q || p.name.toLowerCase().includes(q)));
            box.innerHTML = shown.length ? '' : '<div class="sc-empty" style="grid-column:1/-1;">該当する商品がありません</div>';
            shown.forEach((p) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.style.cssText = 'border:2px solid #9fb3c8;background:#f5f9ff;border-radius:12px;padding:12px 8px;font-size:15px;font-weight:700;cursor:pointer;color:#1f2933;';
                b.innerHTML = `${esc(p.name)}<br><small style="font-weight:400;">${yen(p.price)}</small>`;
                b.addEventListener('click', () => { addProduct(p); });
                box.appendChild(b);
            });
        };
        $('sc-picker-search').addEventListener('input', draw);
        $('sc-picker-close').addEventListener('click', () => { sound('click'); m.remove(); focusScanInput(); });
        draw();
    }

    function renderScanView(host) {
        $('sc-top-sub').textContent = 'バーコードを読み取ってください';
        host.innerHTML = `
            <div class="sc-main">
                <div class="sc-left">
                    <div class="sc-list" id="sc-list"></div>
                </div>
                <div class="sc-right">
                    <div class="sc-panel">
                        <input type="text" id="sc-scan-input" class="sc-input" inputmode="numeric" autocomplete="off"
                               placeholder="バーコードを読み取る（または番号を入力して Enter）">
                        <div class="sc-msg" id="sc-msg"></div>
                        <button type="button" class="sc-btn blue" id="sc-cam-btn">📷 カメラで読み取る</button>
                        <button type="button" class="sc-btn gray" id="sc-pick-btn" style="margin-top:8px;">📋 バーコードがない商品（一覧から選ぶ）</button>
                        <div class="sc-cam-wrap" id="sc-cam-wrap">
                            <video id="sc-video" playsinline muted></video>
                            <div style="font-size:12px;color:#52606d;text-align:center;margin-top:4px;">バーコードを枠の中に入れてください</div>
                        </div>
                    </div>
                    <div class="sc-panel">
                        <div class="sc-total"><span>合計（<span id="sc-count">0</span>点）</span><span class="big" id="sc-sum">¥0</span></div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button type="button" class="sc-btn gray" id="sc-undo-btn">1つ取り消す</button>
                        <button type="button" class="sc-btn gray" id="sc-clear-btn">最初から</button>
                    </div>
                    <button type="button" class="sc-btn green" id="sc-pay-btn">お会計へ進む ▶</button>
                </div>
            </div>`;

        const input = $('sc-scan-input');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; handleScanned(v); }
        });
        $('sc-cam-btn').addEventListener('click', toggleCamera);
        $('sc-pick-btn').addEventListener('click', openProductPicker);
        $('sc-undo-btn').addEventListener('click', undoLast);
        $('sc-clear-btn').addEventListener('click', clearAll);
        $('sc-pay-btn').addEventListener('click', goToPayment);
        renderScanList();
        focusScanInput();
    }

    function renderScanList() {
        saveCart();
        const list = $('sc-list');
        if (!list) return;
        const t = totals();
        if (S.items.length === 0) {
            list.innerHTML = `<div class="sc-empty">🛒<br>商品のバーコードを<br>スキャナーに かざしてください</div>`;
        } else {
            list.innerHTML = S.items.map((it, i) => `
                <div class="sc-row">
                    <div style="min-width:30px;height:30px;border-radius:50%;background:#1e3a5f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;">${i + 1}</div>
                    <div class="sc-row-name">${esc(it.name)}
                        ${(it.ageCheck || it.fraudCheck) ? '<span class="sc-row-note">🔞 レジで店員が確認します</span>' : ''}
                        <div class="sc-row-price">${yen(it.price)}</div></div>
                    <div class="sc-qty"><button type="button" data-act="minus" data-i="${i}">−</button><span>${it.qty}</span><button type="button" data-act="plus" data-i="${i}">＋</button></div>
                    <div class="sc-row-sub">${yen(it.price * it.qty)}</div>
                    <button type="button" class="sc-del" data-act="del" data-i="${i}" title="削除">🗑</button>
                </div>`).join('');
            list.scrollTop = list.scrollHeight;
            list.querySelectorAll('button[data-act]').forEach((b) => {
                b.addEventListener('click', () => {
                    const i = Number(b.getAttribute('data-i'));
                    const act = b.getAttribute('data-act');
                    if (act === 'minus') changeQty(i, -1);
                    else if (act === 'plus') changeQty(i, 1);
                    else removeItem(i);
                });
            });
        }
        const c = $('sc-count'); if (c) c.textContent = String(t.count);
        const s = $('sc-sum'); if (s) s.textContent = yen(t.sum);
        const pay = $('sc-pay-btn'); if (pay) pay.disabled = S.items.length === 0;
        const undo = $('sc-undo-btn'); if (undo) undo.disabled = S.items.length === 0;
        publishLive(false);
    }

    function focusScanInput() {
        // スマホ等（指で操作する端末）では、キーボードが勝手に出ないよう自動のフォーカスはしない
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const input = $('sc-scan-input');
        if (!input || coarse) return;
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    }

    // 画面のどこかを押してもスキャナーの入力欄に戻す（スキャナー用。ボタン・入力欄を押した時は除く）
    document.addEventListener('click', (e) => {
        if (!isSelfMode() || S.view !== 'scan') return;
        if (e.target && e.target.closest && e.target.closest('button, input, video, .modal')) return;
        focusScanInput();
    });

    /* ---------- お会計へ（注文をレジへ送る） ---------- */
    function newOrderCode() {
        return 'SC' + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    }

    function goToPayment() {
        if (S.items.length === 0) { sound('error'); return; }
        if (!canSendToFirebase()) {
            // 送れない状態で「送信しました」と出さない。商品はそのまま残す
            sound('error');
            say('つうしん が できま せ ん。 てんいん を および ください');
            flash('通信できないため、レジへ送信できません。店員をお呼びください');
            try { console.warn('[self-checkout] 送信できません。同期の状態:', window.PosSync && window.PosSync.getStatus && window.PosSync.getStatus()); } catch (e) { /* 無視 */ }
            return;
        }
        sound('success');
        const t = totals();
        const code = newOrderCode();
        const order = {
            id: MY_ID + '_' + Date.now().toString(36),
            code: code,
            items: S.items.map(i => Object.assign({}, i)),
            count: t.count,
            total: t.sum,
            memberBarcode: S.memberBarcode || '',
            createdAt: Date.now()
        };
        S.order = { id: order.id, code: code, status: 'sent', total: t.sum, count: t.count };
        publish(EV_ORDER, order);
        say('れじ に そうしん し まし た。 おかいけい は れじ で おねがい し ます');
        setView('wait');
        // 5秒たったら、最初の画面（いらっしゃいませ／ロゴ／会計スタート）へ自動で戻る
        clearWaitTimer();
        S.waitTimer = setTimeout(() => {
            S.waitTimer = null;
            if (isSelfMode() && S.view === 'wait') resetToStart();
        }, 5000);
    }

    function renderWaitView(host) {
        const o = S.order;
        $('sc-top-sub').textContent = 'お会計はレジで行います';
        host.innerHTML = `
            <div class="sc-center">
                <div class="sc-bigtext">レジへ送信しました。<br>レジでお会計をお願いします</div>
                <div class="sc-bigtext">${o.count}点　合計 ${yen(o.total)}</div>
                <div class="sc-status" id="sc-wait-status">しばらくお待ちください</div>
            </div>`;
        // 送信後は、お客様側から商品の追加・変更はできない（変更は店員がレジで行う）
    }

    function renderThanksView(host) {
        $('sc-top-sub').textContent = '';
        host.innerHTML = `
            <div class="sc-center">
                <div style="font-size:84px">🙏</div>
                <div class="sc-bigtext" style="font-size:34px">ありがとうございました</div>
                <div class="sc-status" style="color:#1f7a3f">またのご来店をお待ちしております</div>
            </div>`;
    }

    function onStatus(d) {
        if (!isSelfMode() || !S.order || d.orderId !== S.order.id) return;
        if (d.senderId === MY_ID) return;
        if (d.status === 'loaded') {
            S.order.status = 'loaded';
            const el = $('sc-wait-status');
            if (el) el.textContent = '店員が確認しています。そのままお待ちください';
        } else if (d.status === 'paid') {
            sound('success');
            say('ありがとう ござい まし た');
            S.items = [];
            S.order = null;
            clearSavedCart();
            setView('thanks');
            if (S.thanksTimer) clearTimeout(S.thanksTimer);
            S.thanksTimer = setTimeout(() => { S.thanksTimer = null; if (isSelfMode()) { S.memberBarcode = ''; setView('start'); } }, 8000);
        } else if (d.status === 'cancelled' || d.status === 'discarded') {
            // レジ側で取り消された：商品はそのまま残し、最初の画面に戻す
            S.order = null;
            setView('scan');
            flash('会計が取り消されました。店員にお声がけください');
            sound('error');
        }
    }

    /* ---------- カメラ読み取り ---------- */
    function loadZxing() {
        if (window.ZXing && window.ZXing.MultiFormatReader) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = ZXING_URL;
            el.onload = () => (window.ZXing ? resolve() : reject(new Error('ZXING_NOT_READY')));
            el.onerror = () => reject(new Error('ZXING_LOAD_FAILED'));
            document.head.appendChild(el);
        });
    }

    function stopScanner() {
        if (S.scanner) { S.scanner.stop(); S.scanner = null; }
        const wrap = $('sc-cam-wrap'); if (wrap) wrap.style.display = 'none';
        const btn = $('sc-cam-btn'); if (btn) btn.textContent = '📷 カメラで読み取る';
    }

    async function toggleCamera() {
        sound('click');
        if (S.scanner) { stopScanner(); return; }
        const wrap = $('sc-cam-wrap'), btn = $('sc-cam-btn'), video = $('sc-video');
        if (!wrap || !video) return;
        wrap.style.display = 'block';
        btn.textContent = '⏹ カメラをとめる';

        let stopped = false, stream = null, timer = null;
        const handle = { stop() {
            stopped = true;
            if (timer) clearInterval(timer);
            if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* 無視 */ } });
            try { video.srcObject = null; } catch (e) { /* 無視 */ }
        } };
        S.scanner = handle;

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('NO_CAMERA_API');
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
            if (stopped) { handle.stop(); return; }
            video.srcObject = stream;
            await video.play();

            // 読み取り方法：標準のBarcodeDetector（あれば）→ なければ ZXing
            let detector = null, zx = null;
            if ('BarcodeDetector' in window) {
                try { detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] }); }
                catch (e) { detector = null; }
            }
            if (!detector) {
                flash('読み取りの部品を準備しています…', true);
                await loadZxing();
                const Z = window.ZXing;
                const hints = new Map();
                hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A,
                    Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]);
                hints.set(Z.DecodeHintType.TRY_HARDER, true);
                const reader = new Z.MultiFormatReader();
                reader.setHints(hints);
                zx = { Z, reader, canvas: document.createElement('canvas') };
                zx.ctx = zx.canvas.getContext('2d', { willReadFrequently: true });
                flash('', true);
            }
            if (stopped) return;

            let busy = false, pausedUntil = 0;
            timer = setInterval(async () => {
                if (stopped || busy || Date.now() < pausedUntil || video.readyState < 2 || !video.videoWidth) return;
                busy = true;
                try {
                    let text = '';
                    if (detector) {
                        const found = await detector.detect(video);
                        if (found && found.length) text = found[0].rawValue || '';
                    } else {
                        const scale = Math.min(1, 800 / video.videoWidth);
                        zx.canvas.width = Math.round(video.videoWidth * scale);
                        zx.canvas.height = Math.round(video.videoHeight * scale);
                        zx.ctx.drawImage(video, 0, 0, zx.canvas.width, zx.canvas.height);
                        const img = zx.ctx.getImageData(0, 0, zx.canvas.width, zx.canvas.height);
                        const lum = new Uint8ClampedArray(zx.canvas.width * zx.canvas.height);
                        for (let i = 0; i < lum.length; i++) {
                            const p = i * 4;
                            lum[i] = (img.data[p] * 0.3 + img.data[p + 1] * 0.59 + img.data[p + 2] * 0.11) | 0;
                        }
                        const src = new zx.Z.RGBLuminanceSource(lum, zx.canvas.width, zx.canvas.height);
                        const bmp = new zx.Z.BinaryBitmap(new zx.Z.HybridBinarizer(src));
                        try { text = zx.reader.decode(bmp).getText(); } catch (e) { text = ''; } // 見つからない時は例外になる（普通のこと）
                    }
                    if (text && !stopped) {
                        pausedUntil = Date.now() + 1300; // 同じバーコードを続けて読まないよう、少し休む
                        handleScanned(text);
                    }
                } catch (e) { /* 1フレームの失敗は無視して続ける */ }
                busy = false;
            }, 200);
        } catch (e) {
            handle.stop();
            S.scanner = null;
            wrap.style.display = 'none';
            btn.textContent = '📷 カメラで読み取る';
            const name = e && e.name ? e.name : '';
            if (name === 'NotAllowedError' || name === 'SecurityError') flash('カメラの使用が許可されていません。ブラウザの設定で許可してください');
            else if (name === 'NotFoundError' || (e && e.message === 'NO_CAMERA_API')) flash('この端末ではカメラを使えません。バーコードスキャナーをお使いください');
            else if (e && /ZXING/.test(e.message || '')) flash('読み取りの部品を読み込めませんでした。通信を確認してください');
            else flash('カメラを開始できませんでした');
            console.warn('[self-checkout] カメラ開始に失敗:', e);
        }
    }

    /* ---------- 開始・終了 ---------- */
    // reopen = true：ページを開き直した時（控えがあれば、商品をそのまま戻す）
    function showRoot(reopen) {
        const root = buildRoot();
        root.style.display = 'flex';
        clearWaitTimer();
        S.view = 'start';
        S.memberBarcode = '';
        S.items = [];
        S.order = null;
        const restored = !!reopen && restoreCart();
        if (!restored) clearSavedCart();
        renderView();
        if (restored) {
            publishLive(false);
            if (S.view === 'wait') {
                S.waitTimer = setTimeout(() => { S.waitTimer = null; if (isSelfMode() && S.view === 'wait') resetToStart(); }, 5000);
            } else {
                flash('読み取り済みの商品を元に戻しました', true);
            }
        }
    }

    // 店長ロックをかける（auth-system.js の lockManagerAuth() と同じ状態にする）。
    // lockManagerAuth() そのものは、ホーム画面へ移動し「てんちょう ロック を かけ まし た」と
    // 読み上げてしまうため、セルフレジ中には使えない。そこで、状態だけを同じにして、
    // 画面移動・読み上げはしない。
    //   ・managerAuthDone を false にする（requestManagerAuth はこれを見て、認証済みなら
    //     バーコード入力を飛ばしてしまう。false にしておけば、必ず入力画面が出る）
    //   ・sessionStorage の認証フラグ（pos_manager_auth / pos_manager_auth_time）を消す
    //   ・「店長ロック」ボタンの表示を「店長認証」に戻し、データ用コード欄を隠す
    function lockManagerNow() {
        try {
            if (typeof managerAuthDone !== 'undefined') managerAuthDone = false;
            sessionStorage.removeItem('pos_manager_auth');
            sessionStorage.removeItem('pos_manager_auth_time');
            if (typeof updateManagerButtonState === 'function') updateManagerButtonState();
            const api = $('api-settings-container');
            if (api) api.style.display = 'none';
            return true;
        } catch (e) {
            console.warn('[self-checkout] 店長ロックに失敗しました:', e);
            return false;
        }
    }

    function activateSelfCheckout() {
        // 全画面の要求は、操作の直後でないとブラウザに拒否されることがあるため、一番最初に行う
        forceFullscreen();
        try { localStorage.setItem(MODE_KEY, '1'); } catch (e) { /* 無視 */ }
        showRoot();
        sound('success');
        say('せるふ れじ を かいし し ます');
        // 店長認証の成功直後（managerAuthDone が true になった後）にロックをかける
        lockManagerNow();
        setTimeout(lockManagerNow, 400); // 念のため、後続の処理で認証済みに戻されていた場合に備える
    }

    function exitSelfCheckout() {
        try { localStorage.removeItem(MODE_KEY); } catch (e) { /* 無視 */ }
        stopScanner();
        clearWaitTimer();
        if (S.thanksTimer) { clearTimeout(S.thanksTimer); S.thanksTimer = null; }
        if (S.order) publish(EV_STATUS, { orderId: S.order.id, status: 'cancelled', by: 'self' });
        S.items = []; S.order = null;
        clearSavedCart();
        publishLive(true);
        const root = $('self-checkout-root');
        if (root) root.style.display = 'none';
        sound('success');
        if (typeof goHome === 'function') goHome();
    }

    // 終了には店長認証が必要
    function requestExit() {
        sound('click');
        lockManagerNow(); // 認証済みのままでも、必ずもう一度店長認証を求める
        if (typeof requestManagerAuth === 'function') {
            setTimeout(() => requestManagerAuth(EXIT_TARGET), 60);
        } else if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('セルフレジ画面を終了しますか？', 'せるふ れじ を しゅうりょう し ます か？', (res) => { if (res) exitSelfCheckout(); }, true);
        }
    }

    // 店長認証が成功した時、auth-system.js の openManagerAuthTarget() から呼ばれる。
    // 知らない目的（target）だとホームへ移動してしまうので、この目的だけを横取りして処理する。
    (function hookManagerAuthTarget() {
        function tryHook() {
            if (typeof window.openManagerAuthTarget !== 'function') { setTimeout(tryHook, 300); return; }
            if (window.openManagerAuthTarget.__selfCheckoutHooked) return;
            const original = window.openManagerAuthTarget;
            const wrapped = function (target, ...rest) {
                if (target === EXIT_TARGET) { exitSelfCheckout(); return; }
                if (target === START_TARGET) { activateSelfCheckout(); return; }
                return original.call(this, target, ...rest);
            };
            wrapped.__selfCheckoutHooked = true;
            window.openManagerAuthTarget = wrapped;
        }
        tryHook();
    })();

    /* =========================================================
       ■ データ管理画面のボタン
       ========================================================= */
    function ensureMigrationBlock() {
        const container = $('migration-screen');
        if (!container || $('self-checkout-block')) return;
        const block = document.createElement('div');
        block.id = 'self-checkout-block';
        block.className = 'migration-block';
        block.style.cssText = 'background:#e8f5e9;border:2px solid #66bb6a;padding:15px;border-radius:6px;margin-top:15px;';
        block.innerHTML = `
            <h3 class="migration-title" style="color:#1b5e20;">👀 セルフレジの様子を見る（万引き防止）</h3>
            <p class="migration-desc">セルフレジで、お客様が今どんな商品をスキャンしていて、何点・いくらかを、リアルタイムで確認できます。<br>
                ※セルフレジを始めるには、ホーム画面の「客用画面」の右にある「セルフレジ」ボタンを押してください（店長認証が必要です）。</p>
            <button type="button" id="self-checkout-start-btn" style="padding:12px 20px;border:none;border-radius:16px;background:#2e7d32;color:#fff;font-weight:bold;cursor:pointer;font-size:15px;">👀 セルフレジの様子を見る</button>`;
        container.appendChild(block);
        block.querySelector('#self-checkout-start-btn').addEventListener('click', () => {
            sound('click');
            openMonitor();
        });
    }

    (function hookShowScreen() {
        function tryHook() {
            if (typeof window.showScreen !== 'function') { setTimeout(tryHook, 300); return; }
            if (window.showScreen.__selfCheckoutHooked) return;
            const original = window.showScreen;
            const wrapped = function (screenId, ...rest) {
                const result = original.apply(this, [screenId, ...rest]);
                if (screenId === 'migration-screen') ensureMigrationBlock();
                return result;
            };
            wrapped.__selfCheckoutHooked = true;
            window.showScreen = wrapped;
        }
        tryHook();
    })();

    /* =========================================================
       ■ レジ（店員）側：注文の受け取りとカートへの読み込み
       ========================================================= */
    let pending = [];                 // 届いている注文
    const loadedOrderIds = new Set(); // このレジのカートに読み込んだ注文（会計完了で「支払い済み」を送る）
    let inCompleteTransaction = false;

    function loadPending() {
        const list = readJson(PENDING_KEY, []);
        const cutoff = Date.now() - ORDER_TTL_MS;
        pending = (Array.isArray(list) ? list : []).filter(o => o && o.id && o.createdAt >= cutoff);
    }
    function savePending() { writeJson(PENDING_KEY, pending); }

    function doneIds() { const l = readJson(DONE_KEY, []); return Array.isArray(l) ? l : []; }
    function markDone(id) {
        const l = doneIds();
        if (!l.includes(id)) l.push(id);
        writeJson(DONE_KEY, l.slice(-200));
    }

    function removePending(id) {
        const before = pending.length;
        pending = pending.filter(o => o.id !== id);
        if (pending.length !== before) savePending();
        updateBadge();
        if ($('sc-pending-modal') && $('sc-pending-modal').style.display === 'flex') renderPendingList();
    }

    function isRegisterSide() {
        if (isSelfMode()) return false;
        if (isActiveScreen('customer-screen')) return false; // 客用画面の端末は受け取らない
        return true;
    }

    function onOrder(order) {
        if (!order || !order.id || !Array.isArray(order.items) || order.items.length === 0) return;
        if (order.senderId === MY_ID) return;
        if (!isRegisterSide()) return;
        if (Date.now() - (order.createdAt || 0) > ORDER_TTL_MS) return;
        if (doneIds().includes(order.id)) return;
        if (pending.some(o => o.id === order.id)) return;
        pending.push(order);
        savePending();
        updateBadge();
        sound('success');
        say('せるふ れじ から おかいけい の よびだし です');
        if (typeof showToastAnimation === 'function') {
            try { showToastAnimation(`🛒 セルフレジ ${order.code}（${order.count}点 ${yen(order.total)}）`); } catch (e) { /* 無視 */ }
        }
        // レジ画面を開いていて、カートが空なら、そのままカートに自動で読み込む（お客様は番号を見せなくてよい）
        if (isActiveScreen('register-screen') && typeof cart !== 'undefined' && cart.length === 0) {
            loadOrderIntoCart(order);
        }
    }

    function onStatusAtRegister(d) {
        // 他のレジが読み込んだ／お客様が取り消した注文は、この端末の待ちからも消す
        if (!d || !d.orderId || d.senderId === MY_ID) return;
        if (d.status === 'loaded' || d.status === 'cancelled' || d.status === 'paid') {
            markDone(d.orderId);
            removePending(d.orderId);
        }
    }

    /* ---------- バッジと一覧 ---------- */
    function ensureBadge() {
        ensureStyle();
        if ($('sc-pending-badge')) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'sc-pending-badge';
        b.addEventListener('click', () => { sound('click'); openPendingModal(); });
        document.body.appendChild(b);
    }

    function updateBadge() {
        ensureBadge();
        const b = $('sc-pending-badge');
        const show = isRegisterSide() && pending.length > 0 && isActiveScreen('register-screen');
        b.style.display = show ? 'block' : 'none';
        if (show) b.textContent = `🛒 セルフレジ待ち ${pending.length}件`;
    }

    function ensurePendingModal() {
        ensureStyle();
        let m = $('sc-pending-modal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'sc-pending-modal';
        m.innerHTML = `<div class="box"><h3 style="margin:0 0 10px;">🛒 セルフレジの注文</h3>
            <div id="sc-pending-list"></div>
            <button type="button" id="sc-pending-close" style="width:100%;border:none;border-radius:10px;padding:12px;background:#6b7785;color:#fff;font-weight:900;cursor:pointer;">閉じる</button></div>`;
        document.body.appendChild(m);
        m.querySelector('#sc-pending-close').addEventListener('click', () => { m.style.display = 'none'; });
        return m;
    }

    function openPendingModal() {
        const m = ensurePendingModal();
        renderPendingList();
        m.style.display = 'flex';
    }

    function renderPendingList() {
        const host = $('sc-pending-list');
        if (!host) return;
        if (pending.length === 0) {
            host.innerHTML = '<div style="text-align:center;color:#7b8794;padding:20px;">待っている注文はありません</div>';
            return;
        }
        host.innerHTML = pending.map((o) => {
            const d = new Date(o.createdAt);
            const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const names = o.items.slice(0, 3).map(i => esc(i.name) + (i.qty > 1 ? '×' + i.qty : '')).join('、') + (o.items.length > 3 ? ' ほか' : '');
            return `<div class="sc-order" data-id="${esc(o.id)}">
                <div><b class="code">${esc(o.code)}</b>　${o.count}点　<b>${yen(o.total)}</b>　<span style="color:#7b8794;">${hhmm}</span></div>
                <div style="font-size:13px;color:#52606d;margin-top:4px;">${names}</div>
                <div class="sc-order-btns">
                    <button type="button" style="background:#1f9d55;" data-act="load">読み込む</button>
                    <button type="button" style="background:#c0392b;" data-act="discard">破棄</button>
                </div></div>`;
        }).join('');
        host.querySelectorAll('.sc-order').forEach((card) => {
            const id = card.getAttribute('data-id');
            card.querySelector('[data-act="load"]').addEventListener('click', () => {
                const o = pending.find(x => x.id === id);
                if (o) { $('sc-pending-modal').style.display = 'none'; requestLoad(o); }
            });
            card.querySelector('[data-act="discard"]').addEventListener('click', () => {
                sound('click');
                publish(EV_STATUS, { orderId: id, status: 'discarded' });
                markDone(id);
                removePending(id);
            });
        });
    }

    /* ---------- カートへの読み込み ---------- */
    function cartQtyOf(name, price) {
        if (typeof cart === 'undefined') return 0;
        return cart.filter(c => c.name === name && c.price === price && !c.isMemberRankDiscount).reduce((s, c) => s + c.qty, 0);
    }

    function requestLoad(order) {
        if (typeof cart !== 'undefined' && cart.some(c => !c.isMemberRankDiscount)) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm('いまのカートに商品が入っています。セルフレジの商品を、このカートに追加しますか？',
                    'いまの かーと に、 せるふ れじ の しょうひん を ついか し ます か？',
                    (res) => { if (res) loadOrderIntoCart(order); }, true);
                return;
            }
        }
        loadOrderIntoCart(order);
    }

    // 年齢確認・詐欺注意が必要な商品：通常のスキャンと同じ確認を通し、通った後で残りの数量を足す
    function addFlaggedItem(it, qty) {
        const prod = {
            jan: it.jan, name: it.name, price: it.price, taxRate: it.taxRate, genre: it.genre,
            ageCheck: !!it.ageCheck, fraudCheck: !!it.fraudCheck
        };
        const before = cartQtyOf(it.name, it.price);
        checkAndAddToCart(prod);
        if (qty <= 1) return;
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            if (cartQtyOf(it.name, it.price) > before) {
                clearInterval(timer);
                const ex = cart.find(c => c.name === it.name && c.price === it.price && !c.isMemberRankDiscount);
                if (ex) { ex.qty += qty - 1; if (typeof updateReceipt === 'function') updateReceipt(); }
            } else if (tries > 300) {
                clearInterval(timer); // 120秒たっても確認が通らなければ、残りは追加しない
            }
        }, 400);
    }

    function loadOrderIntoCart(order) {
        if (typeof cart === 'undefined' || typeof addToCart !== 'function') {
            sound('error');
            alert('レジの機能を読み込めていないため、注文を読み込めません。');
            return;
        }
        if (typeof recordCartState === 'function') recordCartState(); // 「1つ戻る」で戻せるように

        // お客様がポイントカードを読み取っていた場合は、会員としてレジに読み込む
        if (order.memberBarcode && typeof window.fetchAndAddItem === 'function') {
            try { window.fetchAndAddItem(order.memberBarcode); } catch (e) { console.warn('[self-checkout] 会員の読み込みに失敗:', e); }
        }

        const flagged = [];
        let added = 0;
        order.items.forEach((it) => {
            const qty = Math.max(1, parseInt(it.qty, 10) || 1);
            const price = Number(it.price) || 0;
            const taxRate = (it.taxRate === undefined || it.taxRate === null) ? 10 : it.taxRate;
            if ((it.ageCheck || it.fraudCheck) && typeof checkAndAddToCart === 'function') {
                flagged.push({ it: Object.assign({}, it, { price, taxRate }), qty });
                return;
            }
            const ex = cart.find(c => c.name === it.name && c.price === price && c.taxRate === taxRate && !c.isMemberRankDiscount && !c.taxExempt);
            if (ex) ex.qty += qty;
            else cart.push({ name: it.name, price: price, qty: qty, taxRate: taxRate, genre: it.genre || 'その他商品' });
            added += qty;
        });
        if (typeof updateReceipt === 'function') updateReceipt();
        flagged.forEach(f => addFlaggedItem(f.it, f.qty));

        loadedOrderIds.add(order.id);
        markDone(order.id);
        removePending(order.id);
        publish(EV_STATUS, { orderId: order.id, status: 'loaded' });
        sound('success');
        say(`せるふ れじ の しょうひん を よみこみ まし た。 ごうけい ${order.total} えん です`);
        if (typeof focusJanInput === 'function') focusJanInput();
    }

    // 注文のバーコード（SC123456）を、いつものバーコード欄で読み取った時
    (function hookFetchAndAddItem() {
        function tryHook() {
            if (typeof window.fetchAndAddItem !== 'function') { setTimeout(tryHook, 300); return; }
            if (window.fetchAndAddItem.__selfCheckoutHooked) return;
            const original = window.fetchAndAddItem;
            const wrapped = async function (code, ...rest) {
                const c = String(code || '').trim().toUpperCase();
                if (/^SC\d{6}$/.test(c)) {
                    const o = pending.find(x => String(x.code).toUpperCase() === c);
                    if (o) { requestLoad(o); return; }
                    sound('error');
                    say('その ちゅうもん ばんごう は みつかり ませ ん');
                    return;
                }
                return original.call(this, code, ...rest);
            };
            wrapped.__selfCheckoutHooked = true;
            window.fetchAndAddItem = wrapped;
        }
        tryHook();
    })();

    // 会計が完了したら、セルフレジ側へ「支払い済み」を送る
    (function hookCompleteTransaction() {
        function historyCount() { const l = readJson('pos_history', []); return Array.isArray(l) ? l.length : 0; }
        function tryHook() {
            if (typeof window.completeTransaction !== 'function') { setTimeout(tryHook, 300); return; }
            if (window.completeTransaction.__selfCheckoutHooked) return;
            const original = window.completeTransaction;
            const wrapped = async function (...args) {
                const ids = Array.from(loadedOrderIds);
                const before = historyCount();
                inCompleteTransaction = true;
                try {
                    return await original.apply(this, args);
                } finally {
                    inCompleteTransaction = false;
                    if (ids.length && historyCount() > before) {
                        ids.forEach(id => publish(EV_STATUS, { orderId: id, status: 'paid' }));
                        loadedOrderIds.clear();
                    }
                }
            };
            wrapped.__selfCheckoutHooked = true;
            window.completeTransaction = wrapped;
        }
        tryHook();
    })();

    // 会計の途中でカートをクリアした（会計せずに取りやめた）時は、セルフレジ側へ「取り消し」を送る
    (function hookClearCart() {
        function tryHook() {
            if (typeof window.clearCart !== 'function') { setTimeout(tryHook, 300); return; }
            if (window.clearCart.__selfCheckoutHooked) return;
            const original = window.clearCart;
            const wrapped = function (...args) {
                const result = original.apply(this, args);
                if (!inCompleteTransaction && loadedOrderIds.size > 0) {
                    loadedOrderIds.forEach(id => publish(EV_STATUS, { orderId: id, status: 'cancelled', by: 'register' }));
                    loadedOrderIds.clear();
                }
                return result;
            };
            wrapped.__selfCheckoutHooked = true;
            window.clearCart = wrapped;
        }
        tryHook();
    })();

    /* =========================================================
       受信の登録・起動
       ========================================================= */
    /* =========================================================
       ■ レジ側：セルフレジの「いま何をスキャンしているか」を見る（万引き防止）
       ========================================================= */
    const liveBoard = new Map(); // senderId → { at, view, hasMember, count, total, items }
    const LIVE_STALE_MS = 60 * 60 * 1000;

    function onLive(d) {
        if (!d || !d.senderId || d.senderId === MY_ID) return;
        if (!isRegisterSide()) return;
        if (d.gone) liveBoard.delete(d.senderId);
        else liveBoard.set(d.senderId, { at: Date.now(), view: d.view, hasMember: !!d.hasMember, count: d.count || 0, total: d.total || 0, items: Array.isArray(d.items) ? d.items : [] });
        updateMonitorBadge();
        if ($('sc-monitor-modal') && $('sc-monitor-modal').style.display === 'flex') renderMonitor();
    }

    function liveEntries() {
        const now = Date.now();
        liveBoard.forEach((v, k) => { if (now - v.at > LIVE_STALE_MS) liveBoard.delete(k); });
        return Array.from(liveBoard.values());
    }

    function updateMonitorBadge() {
        ensureStyle();
        let b = $('sc-monitor-badge');
        if (!b) {
            b = document.createElement('button');
            b.type = 'button';
            b.id = 'sc-monitor-badge';
            b.style.cssText = 'position:fixed;right:14px;bottom:112px;z-index:8000;display:none;border:none;background:#37474f;color:#fff;font-weight:900;font-size:14px;padding:10px 16px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer;';
            b.addEventListener('click', openMonitor);
            document.body.appendChild(b);
        }
        const active = liveEntries().filter(e => e.view === 'scan' || e.view === 'wait');
        const show = isRegisterSide() && active.length > 0 && isActiveScreen('register-screen');
        b.style.display = show ? 'block' : 'none';
        if (show) b.textContent = '👀 セルフレジ ' + active.reduce((s, e) => s + e.count, 0) + '点';
    }

    function openMonitor() {
        sound('click');
        let m = $('sc-monitor-modal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'sc-monitor-modal';
            m.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:12px;';
            m.innerHTML = '<div style="background:#fff;color:#1f2933;border-radius:14px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;padding:16px;">' +
                '<h3 style="margin:0 0 10px;">👀 セルフレジの様子</h3><div id="sc-monitor-body"></div>' +
                '<button type="button" id="sc-monitor-close" style="width:100%;margin-top:10px;border:none;border-radius:10px;padding:12px;background:#6b7785;color:#fff;font-weight:900;cursor:pointer;">閉じる</button></div>';
            document.body.appendChild(m);
            m.querySelector('#sc-monitor-close').addEventListener('click', () => { m.style.display = 'none'; });
        }
        m.style.display = 'flex';
        renderMonitor();
    }

    function renderMonitor() {
        const body = $('sc-monitor-body');
        if (!body) return;
        const list = liveEntries();
        if (list.length === 0) { body.innerHTML = '<div style="text-align:center;color:#7b8794;padding:20px;">いまセルフレジを使っているお客様はいません</div>'; return; }
        const label = { start: '開始前', card: 'ポイントカード確認中', scan: 'スキャン中', wait: 'レジへ送信済み（会計待ち）', thanks: '会計完了' };
        body.innerHTML = list.map((e, n) => `
            <div style="border:2px solid #cbd2d9;border-radius:12px;padding:10px 12px;margin-bottom:10px;">
                <div style="font-weight:900;">セルフレジ ${n + 1}　<span style="color:#c0392b;">${e.count}点　${yen(e.total)}</span></div>
                <div style="font-size:12px;color:#52606d;margin:2px 0 6px;">${esc(label[e.view] || '')}${e.hasMember ? '　／ポイントカードあり' : ''}</div>
                ${e.items.length ? e.items.map((i, k) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px dashed #d9e2ec;font-size:14px;"><span>${k + 1}. ${esc(i.name)}${i.qty > 1 ? ' ×' + i.qty : ''}</span><span>${yen(i.price * i.qty)}</span></div>`).join('') : '<div style="color:#7b8794;font-size:13px;">まだスキャンされていません</div>'}
            </div>`).join('');
    }

    /* =========================================================
       ■ ホーム画面：「客用画面を開く」→「客用画面」、その右に「セルフレジ」ボタン
       ========================================================= */
    function ensureHomeButton() {
        if ($('home-self-checkout-btn')) return;
        const custBtn = document.querySelector('#home-screen button[onclick*="openCustomerScreen"]');
        if (!custBtn) return;
        custBtn.textContent = '客用画面';

        // ホームのボタン表は2列のグリッド。専用の枠で囲むと、下の行（担当者管理／商品管理 など）と
        // 列の位置・すき間がずれてしまうため、2つのボタンをグリッドの中に直接並べる。
        // ※.large は横2列ぶんを使う設定なので、1列ぶん（auto）に上書きする。
        const fit = (el) => {
            el.style.setProperty('grid-column', 'auto', 'important');
            el.style.setProperty('width', 'auto', 'important');
            el.style.setProperty('min-width', '0', 'important');
            el.style.setProperty('margin', '0', 'important');
            el.style.setProperty('white-space', 'nowrap');
        };
        fit(custBtn);

        // 色：style.css は「2番目の .large ボタン」を青くする指定のため、ボタンの順番が変わると
        // 色が入れ替わってしまう。順番に関係なく、客用画面＝緑、セルフレジ＝青 に固定する。
        custBtn.style.setProperty('background', 'linear-gradient(to bottom, #4caf50, #388e3c)');
        custBtn.style.setProperty('border-color', '#2e7d32');

        // ホームのボタン表の2列を、同じ幅（1fr 1fr）にそろえる。
        // 上の行・下の行・客用画面／セルフレジで列の位置を一致させるため。
        // ボタンの文字が入りきらない時は、自動で列が広がる（1fr の通常の動き）。
        // 幅700px以下のスマホは、style.css の1列表示のまま。
        if (!$('sc-home-grid-style')) {
            const gs = document.createElement('style');
            gs.id = 'sc-home-grid-style';
            gs.textContent = '@media screen and (min-width: 701px) { #home-screen .home-grid { grid-template-columns: 1fr 1fr !important; } }';
            document.head.appendChild(gs);
        }

        const sc = document.createElement('button');
        sc.id = 'home-self-checkout-btn';
        sc.type = 'button';
        sc.className = custBtn.className;
        sc.textContent = '🛒 セルフレジ';
        sc.addEventListener('click', () => {
            sound('click');
            // セルフレジを始める時は、店長認証（店長ロック）が必要
            if (typeof requestManagerAuth === 'function') requestManagerAuth(START_TARGET);
        });
        custBtn.after(sc);
        fit(sc);
        sc.style.setProperty('background', 'linear-gradient(to bottom, #2196f3, #1565c0)');
        sc.style.setProperty('border-color', '#0d47a1');
    }

    (function subscribeWhenReady() {
        function tryRun() {
            if (typeof channel === 'undefined' || !channel) { setTimeout(tryRun, 500); return; }
            channel.subscribe(EV_LIVE, (msg) => { if (msg && msg.data) onLive(msg.data); });
            channel.subscribe(EV_ORDER, (msg) => { if (msg && msg.data) onOrder(msg.data); });
            channel.subscribe(EV_STATUS, (msg) => {
                if (!msg || !msg.data) return;
                if (isSelfMode()) onStatus(msg.data);
                else onStatusAtRegister(msg.data);
            });
        }
        tryRun();
    })();

    function start() {
        ensureStyle();
        loadPending();
        ensureBadge();
        updateBadge();
        ensureHomeButton();
        setInterval(() => { loadPending(); updateBadge(); updateMonitorBadge(); ensureHomeButton(); }, 1500);
        if (isSelfMode()) showRoot(true); // セルフレジ画面のまま、ページを開き直した時（商品の控えがあれば戻す）
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    // 確認・手動操作用
    window.haruSelfCheckout = { activate: activateSelfCheckout, exit: exitSelfCheckout, pending: () => pending.slice() };
})();
