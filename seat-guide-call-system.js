// ==========================================
// seat-guide-call-system.js
// ------------------------------------------
// 【この機能】データ管理画面に「🔔 お席案内（呼び出し）」を追加する。
//
//  ① 受付：人数（何名）を入力して受付する。受付番号は選べない。
//     Firebaseで全端末の中で「かぶらない一番小さい番号」が自動で割り当てられる（パスワードは無し）。
//  ② 呼び出し（店員が行う）：「次のお客様を呼ぶ」を押すと、待っている一番若い番号を
//     「◯番のお客様、いらっしゃいますか？」と画面と音声で呼ぶ。
//       ・「いらっしゃる」→ 空いているテーブルを探して「◯番テーブルへどうぞ」と案内し、受付から外す。
//         案内したテーブルは、タッチパネルの「使用中」にして、同じテーブルへ二重に案内しない。
//         空きが無い時は「ただいま満席です」と出して、受付は残しておく。
//       ・「いらっしゃらない」→ その受付を外し、「次のお客様をお呼びいたします」と次の番号を呼ぶ。
//  ③ 受付データは Firebase（pos_sync/{場所}/seat_guide/tickets）で、すべての端末と共有する。
//  ③' お客様用の受付画面（受付タブ）が使われていない間は、店員が呼んだ番号を表示し、10秒に1回読み上げる。
//      お客様が受付時に選んだパスワードの記号を選んで、合っていれば自動で空きテーブルへご案内する
//      （3回間違えるとロック。スタッフが呼び直す）。呼び出し中の番号は pos_sync/{場所}/seat_guide/calling で全端末に共有。
//  ④ お席案内の画面は、開くと全画面モードになる（閉じるのは×の長押し）。
//
// 【空きテーブルの調べ方】touch-panel-order-system.js の
//   getOccupiedTouchPanelTables() / markTouchPanelTableOccupied() をそのまま使う
//   （使用中のテーブル以外のうち、一番小さい番号に案内する）。
// 【席数】初期値は 80 卓。データ管理画面のブロックで変更できる。
//
// index.html / 他のJSは直接編集せず、showScreen() をフックして画面を注入する方式。
// 【導入】index.html で firebase-sync-system.js より後ろ、
//   touch-panel-order-system.js より後ろに読み込む。
//   <script src="seat-guide-call-system.js"></script>
// 【Firebaseルール】pos_sync/{場所}/seat_guide を読み書きできること
//   （registers と同じ pos_sync/{場所} 配下なので、通常は追加設定なし）。
// ==========================================

(function () {
  'use strict';

  var KEY = 'pos_seat_guide_tickets';
  var COUNT_KEY = 'pos_seat_guide_table_count';
  var NODE = 'seat_guide';
  var SYMBOLS = ['☆', '♡', '◇', '♪', '✿', '○', '△', '□', '☀', '☂'];
    var PEOPLE_MAX_LEN = 2;
  var DEFAULT_TABLES = 80;
  var TICKET_TTL_MS = 12 * 60 * 60 * 1000; // 12時間たった受付は自動で消す

  var tickets = {}; // no -> {no, pw(記号1つ), n(人数), at}
  var ui = { tab: 'call', cnt: '', pw: '', calling: '', msg: '', result: null, busy: false, dismissAt: 0, wrong: 0 };
  var resultTimer = null;
  var ticketsRef = null;
  var callingRef = null;
  var attachedHash = '';
  var calling = null;        // いま呼び出し中の受付 {no, at}（全端末で共有）
  var callRepeatTimer = null;
  var CALL_REPEAT_MS = 10000; // お客様用の受付画面は、呼び出し中は10秒に1回読み上げる
  var CALL_EXPIRE_MS = 10 * 60 * 1000;
  var WRONG_MAX = 3;

  /* ---------- 小道具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s === undefined || s === null ? '' : s);
    return d.innerHTML;
  }
  function click() { try { if (typeof playSound === 'function') playSound('click'); } catch (e) {} }
  var K1 = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
  var K10 = ['', 'じゅう', 'にじゅう', 'さんじゅう', 'よんじゅう', 'ごじゅう', 'ろくじゅう', 'ななじゅう', 'はちじゅう', 'きゅうじゅう'];
  var K100 = ['', 'ひゃく', 'にひゃく', 'さんびゃく', 'よんひゃく', 'ごひゃく', 'ろっぴゃく', 'ななひゃく', 'はっぴゃく', 'きゅうひゃく'];
  var K1000 = ['', 'せん', 'にせん', 'さんぜん', 'よんせん', 'ごせん', 'ろくせん', 'ななせん', 'はっせん', 'きゅうせん'];
  // 「1ばん」と書くと「いっぱん」と読まれてしまうので、数字はひらがなで読ませる（いちばん）
  function kana(n) {
    var v = parseInt(n, 10);
    if (!(v >= 1 && v <= 9999)) return String(n);
    return K1000[Math.floor(v / 1000) % 10] + K100[Math.floor(v / 100) % 10] + K10[Math.floor(v / 10) % 10] + K1[v % 10];
  }
  function say(t) { try { if (typeof speak === 'function') speak(t); } catch (e) {} }
  function now() {
    try { if (window.PosSync && window.PosSync.serverNow) return window.PosSync.serverNow(); } catch (e) {}
    return Date.now();
  }
  function backup() { try { if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow(); } catch (e) {} }

  /* ---------- 全画面 ---------- */
  function lockEscape() {
    // Chromeでは Esc を「長押し」しないと全画面が解除されなくなる
    try { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(function () {}); } catch (e) {}
  }
  function isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function enterFullscreen() {
    lockEscape();
    try {
      if (window.haruFullscreenLock && typeof window.haruFullscreenLock.enter === 'function') {
        window.haruFullscreenLock.enter();
        return;
      }
      var de = document.documentElement;
      if (isFs()) return;
      var fn = de.requestFullscreen || de.webkitRequestFullscreen;
      if (fn) {
        var p = fn.call(de);
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
  }

  /* ---------- Firebase（全端末で共有） ---------- */
  function sync() { return window.PosSync || null; }
  function baseRef() {
    var p = sync();
    try {
      if (p && p.isReady && p.isReady() && p.getBaseRef && p.getBaseRef()) return p.getBaseRef().child(NODE);
    } catch (e) {}
    return null;
  }
  function onTickets(snap) {
    var v = {};
    try { v = snap.val() || {}; } catch (e) {}
    var t = now();
    var next = {};
    Object.keys(v).forEach(function (k) {
      var x = v[k];
      if (!x || !x.no) return;
      if (t - (x.at || 0) > TICKET_TTL_MS) {
        // 古い受付は消す（どの端末が消しても同じ結果になる）
        try { if (ticketsRef) ticketsRef.child(k).remove(); } catch (e) {}
        return;
      }
      next[k] = x;
    });
    tickets = next;
    saveLocal();
    refreshBlock();
    if ($('seat-guide-overlay') && !ui.result && ui.tab === 'reg') renderOverlay();
  }
  // 呼び出し中の番号（店員が呼ぶと全端末に共有される）
  function onCalling(snap) {
    var v = null;
    try { v = snap.val(); } catch (e) {}
    var next = (v && v.no && (now() - (v.at || 0) < CALL_EXPIRE_MS)) ? { no: String(v.no), at: v.at || 0 } : null;
    var changed = !calling !== !next || (next && calling && (calling.no !== next.no || calling.at !== next.at));
    if (changed && next) ui.wrong = 0;
    calling = next;
    if (changed && $('seat-guide-overlay') && ui.tab === 'reg' && !ui.result) renderOverlay();
    else updateRepeat();
  }
  function setCalling(no) {
    var at = now();
    calling = no ? { no: String(no), at: at } : null;
    ensureAttached();
    try {
      if (callingRef) { if (no) callingRef.set({ no: String(no), at: at }); else callingRef.remove(); }
    } catch (e) {}
  }
  // お客様用の受付画面が、いま「使われていない」か（人数やパスワードの入力中・結果表示中でない）
  function callPanelShowing() {
    return !!($('seat-guide-overlay') && ui.tab === 'reg' && !ui.result && !ui.busy && !ui.cnt && !ui.pw &&
      calling && tickets[calling.no] && ui.dismissAt !== calling.at);
  }
  function speakCall() {
    if (!calling || !tickets[calling.no]) return;
    say(kana(calling.no) + 'ばん の おきゃくさま、 いらっしゃいますか。 ぱすわーど の きごう を えらんで ください');
  }
  function stopRepeat() { if (callRepeatTimer) { clearInterval(callRepeatTimer); callRepeatTimer = null; } }
  function updateRepeat() {
    if (callPanelShowing()) {
      if (!callRepeatTimer) {
        speakCall();
        callRepeatTimer = setInterval(function () { if (callPanelShowing()) speakCall(); else stopRepeat(); }, CALL_REPEAT_MS);
      }
    } else {
      stopRepeat();
    }
  }

  function ensureAttached() {
    var p = sync();
    if (!p || !p.isReady || !p.isReady() || !p.getPathHash) return;
    var hash = p.getPathHash();
    if (ticketsRef && attachedHash === hash) return;
    var base = baseRef();
    if (!base) return;
    try { if (ticketsRef) ticketsRef.off('value', onTickets); } catch (e) {}
    try { if (callingRef) callingRef.off('value', onCalling); } catch (e) {}
    attachedHash = hash;
    callingRef = base.child('calling');
    callingRef.on('value', onCalling, function () {});
    ticketsRef = base.child('tickets');
    ticketsRef.on('value', onTickets, function (err) {
      console.warn('[seat-guide] 受付データを読めません。Firebaseのルールで pos_sync/{場所}/' + NODE + ' を許可してください:', err && err.message ? err.message : err);
    });
  }

  /* ---------- 受付データ（この端末の控え） ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var o = raw ? JSON.parse(raw) : {};
      tickets = (o && typeof o === 'object') ? o : {};
    } catch (e) { tickets = {}; }
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(tickets)); } catch (e) {}
    backup();
  }
  function activeList() {
    return Object.keys(tickets).map(function (k) { return tickets[k]; })
      .filter(function (x) { return x && x.no; })
      .sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
  }
  function nextAutoNo() {
    for (var i = 1; i <= 9999; i++) {
      if (!tickets[String(i)]) return i;
    }
    return 0;
  }

  /* ---------- テーブル（空き調べ・使用中にする） ---------- */
  function tableCount() {
    var n = parseInt(localStorage.getItem(COUNT_KEY), 10);
    if (!(n > 0)) n = DEFAULT_TABLES;
    try {
      document.querySelectorAll('.tp-table-cell[data-table]').forEach(function (c) {
        var v = parseInt(c.getAttribute('data-table'), 10);
        if (v > n) n = v;
      });
    } catch (e) {}
    return n;
  }
  function occupiedSet() {
    try {
      if (typeof getOccupiedTouchPanelTables === 'function') return getOccupiedTouchPanelTables();
    } catch (e) {}
    return new Set();
  }
  function findFreeTable() {
    var occ = occupiedSet();
    var max = tableCount();
    for (var i = 1; i <= max; i++) { if (!occ.has(i)) return i; }
    return 0;
  }
  function occupy(n) {
    try { if (typeof markTouchPanelTableOccupied === 'function') markTouchPanelTableOccupied(n); } catch (e) {}
    try { if (typeof refreshTouchPanelTableGridIfVisible === 'function') refreshTouchPanelTableGridIfVisible(); } catch (e) {}
  }

  /* ---------- 受付・呼び出しの処理 ---------- */
  // 番号は選べない。全端末の中でかぶらない一番小さい番号を、Firebaseのトランザクションで確保する。
  function claimNumber(data, done) {
    ensureAttached();
    if (!ticketsRef) {
      // オフライン等：この端末の中でだけかぶらない番号にする（つながったら他端末と同期される保証はない）
      var n = nextAutoNo();
      if (!n) return done(0);
      data.no = String(n);
      tickets[data.no] = data;
      saveLocal();
      return done(n);
    }
    var start = nextAutoNo() || 1;
    (function tryNo(i, guard) {
      if (guard > 200 || i > 9999) return done(0);
      var rec = { no: String(i), pw: data.pw, n: data.n, at: data.at };
      ticketsRef.child(String(i)).transaction(function (cur) {
        return cur ? undefined : rec; // すでに誰かが使っていたら中止して、次の番号へ
      }, function (err, committed) {
        if (err) return done(0);
        if (committed) { tickets[rec.no] = rec; saveLocal(); return done(i, rec); }
        tryNo(i + 1, guard + 1);
      }, false);
    })(start, 0);
  }

  function doRegister() {
    if (ui.busy) return;
    var people = parseInt(ui.cnt, 10);
    if (!(people > 0)) { fail('人数を入れてください'); return; }
    if (!ui.pw) { fail('パスワードの記号をえらんでください'); return; }
    ui.busy = true;
    var pw = ui.pw;
    claimNumber({ pw: pw, n: people, at: now() }, function (no) {
      ui.busy = false;
      if (!no) { fail('受付できませんでした。もう一度おためしください'); return; }
      ui.result = { type: 'registered', no: String(no), n: people, pw: pw };
      ui.cnt = ''; ui.pw = ''; ui.msg = '';
      say(kana(no) + 'ばん で ' + kana(people) + 'めいさま うけつけ しました');
      scheduleResultClose(12000);
      refreshBlock();
      renderOverlay();
    });
  }

  function waitingList(exceptNo) {
    return activeList().filter(function (x) { return x.no !== exceptNo; });
  }
  function removeTicket(no, cb) {
    ensureAttached();
    if (!ticketsRef) { delete tickets[no]; saveLocal(); return cb(true); }
    // 受付を消せた（=先に押した）端末だけが成功する
    ticketsRef.child(no).transaction(function (cur) { return cur ? null : undefined; }, function (err, committed) {
      if (!err && committed) { delete tickets[no]; saveLocal(); }
      cb(!err && committed);
    }, false);
  }

  // 店員が「呼ぶ」：その番号を呼び出し中にして、音声で呼ぶ
  function callTicket(no) {
    if (!tickets[no]) { fail('この受付は、すでにありません'); return; }
    ui.calling = no; ui.msg = ''; ui.result = null;
    setCalling(no);
    say(kana(no) + 'ばん の おきゃくさま、 いらっしゃいますか');
    renderOverlay();
  }
  function callNext(exceptNo) {
    var w = waitingList(exceptNo);
    if (!w.length) { ui.calling = ''; setCalling(null); ui.msg = 'お待ちのお客様はいません'; renderOverlay(); return; }
    callTicket(w[0].no);
  }

  // 「いらっしゃる」：空きテーブルへ案内する
  function doGuide() {
    if (ui.busy || !ui.calling) return;
    guideNo(ui.calling);
  }
  // 受付番号 no を空きテーブルへ案内する（店員の「いらっしゃる」と、お客様がパスワードを合わせた時の自動案内の両方）
  function guideNo(no) {
    if (ui.busy) return;
    var tk = tickets[no];
    if (!tk) { fail('この受付は、すでにありません'); return; }
    var table = findFreeTable();
    if (!table) {
      ui.result = { type: 'full', no: no };
      say('ただいま まんせき です。 しばらく おまち ください');
      scheduleResultClose(10000);
      renderOverlay();
      return;
    }
    ui.busy = true;
    removeTicket(no, function (ok) {
      ui.busy = false;
      if (!ok) { ui.calling = ''; fail('この受付は、すでに案内されたか、消えています'); return; }
      occupy(table);
      ui.result = { type: 'guide', no: no, table: table, n: tk.n };
      ui.calling = ''; ui.msg = '';
      if (calling && calling.no === String(no)) setCalling(null);
      say(kana(table) + 'ばん の てーぶる へ どうぞ');
      scheduleResultClose(15000);
      refreshBlock();
      renderOverlay();
    });
  }

  // 「いらっしゃらない」：その受付を外して、次のお客様を呼ぶ
  function doAbsent() {
    if (ui.busy || !ui.calling) return;
    var no = ui.calling;
    ui.busy = true;
    removeTicket(no, function () {
      ui.busy = false;
      ui.calling = '';
      setCalling(null);
      refreshBlock();
      if (!waitingList(no).length) {
        ui.msg = no + '番はいらっしゃいませんでした。お待ちのお客様はいません';
        renderOverlay();
        return;
      }
      say('いらっしゃいませんので、 つぎの おきゃくさま を および いたします');
      ui.msg = '次のお客様をお呼びいたします';
      renderOverlay();
      setTimeout(function () { if ($('seat-guide-overlay') && ui.tab === 'call') callNext(no); }, 3500);
    });
  }

  function fail(m) {
    ui.msg = m;
    try { if (typeof playSound === 'function') playSound('error'); } catch (e) {}
    renderOverlay();
  }
  function scheduleResultClose(ms) {
    clearTimeout(resultTimer);
    resultTimer = setTimeout(function () { ui.result = null; renderOverlay(); }, ms);
  }

  /* ---------- 画面（全画面オーバーレイ） ---------- */
  function ensureStyle() {
    if ($('seat-guide-style')) return;
    var s = document.createElement('style');
    s.id = 'seat-guide-style';
    s.textContent =
      '#seat-guide-overlay{position:fixed;inset:0;z-index:2147483100;background:#fff7ec;color:#2a2118;display:flex;flex-direction:column;font-family:"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Yu Gothic",sans-serif;overflow:auto}' +
      '#seat-guide-overlay .sg-top{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#12203a;color:#fff}' +
      '#seat-guide-overlay .sg-top b{flex:1;font-size:18px}' +
      '#seat-guide-overlay .sg-tab{border:0;border-radius:999px;padding:9px 16px;font-weight:700;font-size:14px;background:#33475f;color:#fff;cursor:pointer}' +
      '#seat-guide-overlay .sg-tab.on{background:#e8491d}' +
      '#seat-guide-overlay .sg-x{border:0;background:transparent;color:#fff;font-size:26px;cursor:pointer;padding:0 8px}' +
      '#seat-guide-overlay .sg-body{flex:1;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 12px 24px}' +
      '#seat-guide-overlay .sg-label{font-size:13px;font-weight:700;color:#8a7a68;margin-bottom:-4px}' +
      '#seat-guide-overlay .sg-disp{min-width:220px;text-align:center;font-size:44px;font-weight:900;letter-spacing:.12em;background:#fff;border:3px solid #eee1cc;border-radius:16px;padding:6px 18px;min-height:64px;font-family:ui-monospace,Menlo,Consolas,monospace}' +
      '#seat-guide-overlay .sg-disp.sym{font-size:38px;letter-spacing:.3em}' +
      '#seat-guide-overlay .sg-grid{display:grid;gap:8px;width:min(360px,94vw)}' +
      '#seat-guide-overlay .sg-keys{grid-template-columns:repeat(3,1fr)}' +
      '#seat-guide-overlay .sg-syms{grid-template-columns:repeat(5,1fr)}' +
      '#seat-guide-overlay .sg-grid button{border:2px solid #eee1cc;background:#fff;border-radius:14px;font-size:24px;font-weight:900;min-height:54px;cursor:pointer;color:#2a2118}' +
      '#seat-guide-overlay .sg-grid button:active{transform:scale(.96);background:#ffe9d6}' +
      '#seat-guide-overlay .sg-grid button.on{background:#ffd9bd;border-color:#e8491d}' +
      '#seat-guide-overlay .sg-q{display:flex;align-items:center;justify-content:space-between;gap:10px;width:min(360px,94vw);background:#fff;border:2px solid #eee1cc;border-radius:12px;padding:8px 12px;font-size:18px;font-weight:800}' +
      '#seat-guide-overlay .sg-q button{border:0;border-radius:10px;background:#5c6bc0;color:#fff;font-weight:800;padding:8px 14px;cursor:pointer}' +
      '#seat-guide-overlay .sg-yes{background:#2e7d32}#seat-guide-overlay .sg-no{background:#757575}' +
      '#seat-guide-overlay .sg-go{width:min(360px,94vw);border:0;border-radius:16px;min-height:60px;font-size:22px;font-weight:900;color:#fff;background:#d64526;cursor:pointer;box-shadow:0 4px 0 #b23217}' +
      '#seat-guide-overlay .sg-msg{min-height:22px;color:#c62828;font-weight:800;font-size:15px}' +
      '#seat-guide-overlay .sg-res{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px}' +
      '#seat-guide-overlay .sg-big{font-size:120px;font-weight:900;line-height:1;color:#d64526;font-family:ui-monospace,Menlo,Consolas,monospace}' +
      '#seat-guide-overlay .sg-res h2{margin:0;font-size:30px}' +
      '#seat-guide-overlay .sg-ok{border:0;border-radius:14px;background:#2e7d32;color:#fff;font-size:20px;font-weight:900;padding:14px 48px;cursor:pointer;margin-top:8px}';
    document.head.appendChild(s);
  }

  function openOverlay(tab) {
    ensureStyle();
    click();
    ensureAttached();
    enterFullscreen(); // ボタンを押した操作の中で呼ぶ（そうしないとブラウザに拒否される）
    ui.tab = tab || 'call'; ui.cnt = ''; ui.pw = ''; ui.calling = ''; ui.msg = ''; ui.result = null; ui.busy = false; ui.dismissAt = 0; ui.wrong = 0;
    var o = $('seat-guide-overlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'seat-guide-overlay';
      o.addEventListener('click', onOverlayClick);
      // 閉じるのは「×」の長押しだけ（お客様が間違って閉じないように）
      var holdTimer = null;
      function cancelHold() { clearTimeout(holdTimer); holdTimer = null; var x = $('sg-close'); if (x) x.style.opacity = ''; }
      o.addEventListener('pointerdown', function (ev) {
        if (!ev.target.closest('#sg-close')) return;
        ev.target.closest('#sg-close').style.opacity = '.5';
        holdTimer = setTimeout(function () { holdTimer = null; closeOverlay(); }, 1500);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { o.addEventListener(n, function (ev) { if (ev.target.closest && ev.target.closest('#sg-close')) cancelHold(); }); });
      o.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
      document.body.appendChild(o);
    }
    renderOverlay();
  }
  function closeOverlay() {
    click();
    clearTimeout(resultTimer);
    stopRepeat();
    var o = $('seat-guide-overlay');
    if (o) o.remove();
  }
  function renderOverlay() {
    renderOverlayInner();
    updateRepeat();
  }
  function renderOverlayInner() {
    var o = $('seat-guide-overlay');
    if (!o) return;
    // 右上の×だけ（タイトル・タブは出さない。呼び出し／受付はデータ管理の画面から開く）
    var top = '<div class="sg-top" style="justify-content:flex-end;background:transparent"><button class="sg-x" id="sg-close" aria-label="長押しで閉じる" title="長押しで閉じる" style="color:#8a7a68">×</button></div>';

    if (ui.result) {
      var r = ui.result, h;
      if (r.type === 'guide') {
        h = '<div style="font-size:20px;font-weight:800">' + esc(r.no) + '番のお客様' + (r.n ? '（' + esc(r.n) + '名様）' : '') + '</div>' +
            '<div class="sg-big">' + esc(r.table) + '</div><h2>番テーブルへどうぞ</h2>';
      } else if (r.type === 'full') {
        h = '<div style="font-size:64px">🙇</div><h2>ただいま満席です</h2>' +
            '<div style="font-size:16px;color:#8a7a68">' + esc(r.no) + '番の受付は残っています。<br>空きが出たら、もう一度「呼び出す」を押してください。</div>';
      } else {
        h = '<div style="font-size:20px;font-weight:800">受付しました（' + esc(r.n) + '名様）</div><div class="sg-big">' + esc(r.no) + '</div>' +
            '<div style="font-size:18px;font-weight:800">パスワード</div><div class="sg-big" style="font-size:80px">' + esc(r.pw || '') + '</div>' +
            '<div style="font-size:16px;color:#8a7a68">この番号と記号を、おぼえておいてください。<br>お席の準備ができたらお呼びします。</div>';
      }
      o.innerHTML = top + '<div class="sg-res">' + h + '<button class="sg-ok" data-act="ok">OK</button></div>';
      return;
    }

    var isReg = ui.tab === 'reg';
    if (!isReg) {
      // 呼び出し（店員が操作する）
      var w = activeList();
      var body;
      if (ui.calling && tickets[ui.calling]) {
        var ct = tickets[ui.calling];
        body = '<div class="sg-big">' + esc(ct.no) + '</div>' +
          '<h2>番のお客様（' + esc(ct.n || '-') + '名様）<br>いらっしゃいますか？</h2>' +
          '<div style="font-size:22px;font-weight:800">パスワード： <span style="font-size:44px">' + esc(ct.pw || '') + '</span></div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:8px">' +
          '<button class="sg-ok" data-act="guide">いらっしゃる → ご案内</button>' +
          '<button class="sg-ok sg-no" data-act="absent" style="background:#757575">いらっしゃらない → 次を呼ぶ</button></div>' +
          '<div class="sg-msg">' + esc(ui.msg) + '</div>' +
          '<button class="sg-tab" data-act="recall" style="background:#33475f;margin-top:4px">もう一度呼ぶ</button>';
        o.innerHTML = top + '<div class="sg-res">' + body + '</div>';
        return;
      }
      var rows = w.map(function (x) {
        return '<div class="sg-q"><span>' + esc(x.no) + '番　' + esc(x.n || '-') + '名　' + esc(x.pw || '') + '</span><button data-act="callno" data-v="' + esc(x.no) + '">呼ぶ</button></div>';
      }).join('');
      o.innerHTML = top +
        '<div class="sg-body">' +
          '<div class="sg-label">お待ちのお客様：' + w.length + '組</div>' +
          (rows || '<div style="color:#8a7a68;font-size:18px;padding:20px 0">お待ちのお客様はいません</div>') +
          '<div class="sg-msg">' + esc(ui.msg) + '</div>' +
          (w.length ? '<button class="sg-go" data-act="next">🔔 次のお客様を呼ぶ</button>' : '') +
        '</div>';
      return;
    }
    if (callPanelShowing()) {
      // お客様用の受付画面が使われていない間は、呼び出し中の番号を出す。
      // 受付した時に選んだパスワードの記号が合えば、自動で空いているテーブルへご案内する。
      var cc = tickets[calling.no];
      var left = Math.max(0, WRONG_MAX - ui.wrong);
      o.innerHTML = top +
        '<div class="sg-res">' +
          '<div class="sg-big">' + esc(cc.no) + '</div>' +
          '<h2>番のお客様（' + esc(cc.n || '-') + '名様）<br>お待たせしました</h2>' +
          '<div style="font-size:20px;font-weight:800">受付の時に選んだ<br>パスワードの記号をえらんでください</div>' +
          '<div class="sg-grid sg-syms">' + SYMBOLS.map(function (m) { return '<button data-act="callsym" data-v="' + m + '"' + (left ? '' : ' disabled') + '>' + m + '</button>'; }).join('') + '</div>' +
          '<div class="sg-msg">' + esc(ui.msg) + '</div>' +
          '<button class="sg-tab" data-act="dismisscall" style="background:#33475f">新しく受付する</button>' +
        '</div>';
      return;
    }
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(function (k) {
      return '<button data-act="key" data-v="' + k + '">' + k + '</button>';
    }).join('');
    o.innerHTML = top +
      '<div class="sg-body">' +
        '<div class="sg-label">人数（何名様か）を入れてください　※受付番号は自動でふられます</div>' +
        '<div class="sg-disp">' + esc(ui.cnt ? ui.cnt + ' 名' : '　') + '</div>' +
        '<div class="sg-grid sg-keys">' + keys + '</div>' +
        '<div class="sg-label">パスワード（記号を1つえらぶ）</div>' +
        '<div class="sg-disp sym">' + esc(ui.pw || '　') + '</div>' +
        '<div class="sg-grid sg-syms">' + SYMBOLS.map(function (m) { return '<button data-act="sym" data-v="' + m + '"' + (ui.pw === m ? ' class="on"' : '') + '>' + m + '</button>'; }).join('') + '</div>' +
        '<div class="sg-msg">' + esc(ui.msg) + '</div>' +
        '<button class="sg-go" data-act="reg">受付する</button>' +
      '</div>';
  }

  function onOverlayClick(ev) {
    if (!isFs()) enterFullscreen(); // 全画面が解けていたら、次のタップで必ず戻す（全画面ガードも見張っている）
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), v = b.getAttribute('data-v');
    if (act === 'ok') { clearTimeout(resultTimer); ui.result = null; return renderOverlay(); }
    if (act === 'tab') { click(); ui.tab = v; ui.cnt = ''; ui.pw = ''; ui.calling = ''; ui.msg = ''; return renderOverlay(); }
    if (act === 'key') {
      click(); ui.msg = '';
      if (v === 'C') ui.cnt = '';
      else if (v === '⌫') ui.cnt = ui.cnt.slice(0, -1);
      else if (ui.cnt.length < PEOPLE_MAX_LEN) ui.cnt += v;
      return renderOverlay();
    }
    if (act === 'sym') { click(); ui.msg = ''; ui.pw = v; return renderOverlay(); }
    if (act === 'reg') return doRegister();
    if (act === 'dismisscall') { click(); if (calling) ui.dismissAt = calling.at; ui.msg = ''; return renderOverlay(); }
    if (act === 'callsym') {
      if (!callPanelShowing() || ui.busy) return;
      var tk = tickets[calling.no];
      if (ui.wrong >= WRONG_MAX) { ui.msg = '間違いが続きました。スタッフをお呼びください'; return renderOverlay(); }
      if (tk && v === tk.pw) { click(); ui.msg = ''; ui.wrong = 0; ui.calling = calling.no; return guideNo(calling.no); }
      ui.wrong++;
      ui.msg = ui.wrong >= WRONG_MAX ? '間違いが続きました。スタッフをお呼びください' : 'パスワードが違います（あと' + (WRONG_MAX - ui.wrong) + '回）';
      try { if (typeof playSound === 'function') playSound('error'); } catch (e) {}
      say('ぱすわーど が ちがい ます');
      return renderOverlay();
    }
    if (act === 'next') { click(); return callNext(''); }
    if (act === 'callno') { click(); return callTicket(v); }
    if (act === 'recall') { click(); return callTicket(ui.calling); }
    if (act === 'guide') { click(); return doGuide(); }
    if (act === 'absent') { click(); return doAbsent(); }
  }

  /* ---------- データ管理画面のブロック ---------- */
  function ensureBlock() {
    var c = $('migration-screen');
    if (!c || $('seat-guide-block')) return;
    var b = document.createElement('div');
    b.id = 'seat-guide-block';
    b.className = 'migration-block';
    b.style.cssText = 'background:#fff3e0;border:2px solid #ffb74d;padding:15px;border-radius:6px;margin-top:15px;';
    b.innerHTML =
      '<h3 class="migration-title" style="color:#e65100">🔔 お席案内（呼び出し）</h3>' +
      '<p class="migration-desc">人数とパスワード（記号1つ）を入れて受付すると、受付番号が自動でふられます（全端末でかぶりません）。' +
      '呼び出しは店員が行います。「次のお客様を呼ぶ」で「◯番のお客様いらっしゃいますか？」と呼び、いらっしゃれば空いているテーブルへ案内（そのテーブルは「使用中」になります）、いらっしゃらなければ次のお客様を呼びます。</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        '<button type="button" id="sg-open-call" style="background:#e65100;color:#fff;padding:10px 16px;border:none;border-radius:6px;font-weight:700;cursor:pointer">🔔 呼び出し画面を開く（店員用）</button>' +
        '<button type="button" id="sg-open-reg" style="background:#5c6bc0;color:#fff;padding:10px 16px;border:none;border-radius:6px;font-weight:700;cursor:pointer">＋ 受付する</button>' +
      '</div>' +
      '<label style="font-size:13px">テーブルの数：<input type="number" id="sg-table-count" min="1" max="200" style="width:70px;padding:4px"> 卓</label>' +
      '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #ffb74d;font-size:13px">' +
        '🔑 店員確認の暗証番号（タッチパネル・4桁）：<input type="text" id="sg-staff-pin" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off" style="width:80px;padding:4px;font-size:16px;letter-spacing:.2em;text-align:center">' +
        ' <button type="button" id="sg-staff-pin-save" style="background:#2e7d32;color:#fff;padding:6px 14px;border:none;border-radius:6px;font-weight:700;cursor:pointer">保存</button>' +
        ' <span id="sg-staff-pin-msg" style="color:#2e7d32"></span>' +
        '<div style="color:#888;margin-top:4px">初期値は 5678 です。保存すると他の端末にも同期されます。</div>' +
      '</div>' +
      '<div id="sg-list" style="margin-top:10px;font-size:14px"></div>';
    c.appendChild(b);
    var pinInp = b.querySelector('#sg-staff-pin');
    var pinMsg = b.querySelector('#sg-staff-pin-msg');
    try { pinInp.value = localStorage.getItem('pos_touch_panel_kiosk_pin') || '5678'; } catch (e) { pinInp.value = '5678'; }
    b.querySelector('#sg-staff-pin-save').addEventListener('click', function () {
      var v = String(pinInp.value || '').replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); }).trim();
      if (!/^\d{4}$/.test(v)) { pinMsg.style.color = '#c62828'; pinMsg.textContent = '4桁の数字で入力してください'; return; }
      try { localStorage.setItem('pos_touch_panel_kiosk_pin', v); } catch (e) {}
      pinInp.value = v;
      pinMsg.style.color = '#2e7d32'; pinMsg.textContent = '保存しました';
      setTimeout(function () { pinMsg.textContent = ''; }, 3000);
      backup();
    });
    b.querySelector('#sg-open-call').addEventListener('click', function () { openOverlay('call'); });
    b.querySelector('#sg-open-reg').addEventListener('click', function () { openOverlay('reg'); });
    var inp = b.querySelector('#sg-table-count');
    inp.value = String(parseInt(localStorage.getItem(COUNT_KEY), 10) || DEFAULT_TABLES);
    inp.addEventListener('change', function () {
      var n = parseInt(inp.value, 10);
      if (n > 0) { try { localStorage.setItem(COUNT_KEY, String(n)); } catch (e) {} backup(); }
    });
    b.querySelector('#sg-list').addEventListener('click', function (ev) {
      var d = ev.target.closest('[data-del]');
      if (!d) return;
      var no = d.getAttribute('data-del');
      click();
      delete tickets[no];
      saveLocal();
      try { if (ticketsRef) ticketsRef.child(no).remove(); } catch (e) {}
      refreshBlock();
    });
    refreshBlock();
  }
  function refreshBlock() {
    var el = $('sg-list');
    if (!el) return;
    var list = activeList();
    el.innerHTML = list.length
      ? '<b>受付中：' + list.length + '組</b><table class="data-table" style="margin-top:6px"><thead><tr><th>番号</th><th>人数</th><th>パスワード</th><th>受付</th><th></th></tr></thead><tbody>' +
        list.map(function (x) {
          var t = new Date(x.at);
          return '<tr><td><b>' + esc(x.no) + '</b></td><td>' + esc(x.n || '-') + '名</td><td style="font-size:20px">' + esc(x.pw || '') + '</td><td>' +
            String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') +
            '</td><td><button type="button" data-del="' + esc(x.no) + '" style="padding:4px 10px">削除</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<span style="color:#888">受付中のお客様はいません</span>';
  }

  /* ---------- 起動 ---------- */
  function hookShowScreen() {
    if (typeof window.showScreen !== 'function') { setTimeout(hookShowScreen, 300); return; }
    if (window.showScreen.__seatGuideHooked) return;
    var orig = window.showScreen;
    var wrapped = function (id) {
      var r = orig.apply(this, arguments);
      if (id === 'migration-screen') ensureBlock();
      return r;
    };
    wrapped.__seatGuideHooked = true;
    window.showScreen = wrapped;
  }

  load();
  hookShowScreen();
  ensureAttached();
  // Firebaseの準備ができるまで待って接続する／別の追加機能がデータ管理画面を先に表示していた場合の保険
  setInterval(function () {
    ensureAttached();
    var m = $('migration-screen');
    if (m && m.classList.contains('active')) ensureBlock();
  }, 2000);

  window.openSeatGuide = openOverlay; // 他の画面からも開けるように
})();
