// self-checkout-call-number-register-assign-system.js
// ------------------------------------------
// セルフレジで「お会計へ進む」を押したあとの案内を追加するフック。
//
//  1) お客様のセルフレジ画面に、4桁の「お会計番号」を大きく表示する。
//  2) レジが2台以上つながっている時は、空いているレジを1台選んで
//     「◯番レジへお進みください」と案内し、注文もそのレジにだけ届ける
//     （全レジに同時に届いて、同じ注文を取り合う事故を防ぐ）。
//     レジが1台しかつながっていない時は、レジ番号は出さず「待ち」と案内する。
//  3) レジ側には「◯◯◯◯番のお客様の会計をお願いします」と表示する
//     （セルフレジ待ちの一覧にも、SC○○○○○○ の代わりに 4桁の番号を表示）。
//  4) レジ画面の右上に、このレジの番号を小さく表示する（タップで番号を変更）。
//
// 【仕組み】
//  ・つながっているレジの一覧は、Firebase（pos_sync/{場所}/registers/{端末}）に
//    各レジが自分で置く（切断で自動的に消える）。
//  ・振り分け結果（番号・レジ）は、self-checkout-system.js が送る注文に
//    callNo / registerNo / registerTag を足して送る。
//  ・self-checkout-system.js 自体は変更しない。channel.publish / subscribe を
//    包んで実現するため、self-checkout-system.js より「前」に読み込むこと。
//  ・割り当てられたレジが途中で落ちた時は、残っているレジのうち一番番号が小さい
//    1台が、その注文を引き継ぐ。
//
// 【導入】index.html で firebase-sync-system.js より後ろ、
//   self-checkout-system.js より前に読み込む。
// ------------------------------------------

(function () {
  "use strict";

  var EV_ORDER = "self-checkout-order";
  var EV_STATUS = "self-checkout-status";
  var MODE_KEY = "pos_sync_self_checkout_mode"; // self-checkout-system.js と同じ
  var PENDING_KEY = "pos_sync_self_orders"; // 同上（レジ側の待ち一覧）
  var NO_KEY = "pos_sync_register_no"; // この端末のレジ番号（端末ごと・同期されない）
  var FLAG_KEY = "pos_sync_is_register"; // この端末はレジ（レジ画面を開いたことがある）
  var NODE = "registers";

  var STALE_MS = 90000; // 90秒更新が無いレジは、いないものとして扱う
  var HEARTBEAT_MS = 30000;
  var ORDER_TTL_MS = 30 * 60 * 1000;
  var OVERLAY_MS = 20000;
  var FALLBACK_GRACE_MS = 10000;
  var RECENT_ASSIGN_MS = 6000;

  /* ---------- 小道具 ---------- */

  function $(id) {
    return document.getElementById(id);
  }
  function sync() {
    return window.PosSync || null;
  }
  function myTag() {
    var p = sync();
    return p && p.DEVICE_TAG ? p.DEVICE_TAG : "";
  }
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s === undefined || s === null ? "" : s);
    return d.innerHTML;
  }
  function isSelfMode() {
    try {
      return localStorage.getItem(MODE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }
  function isActiveScreen(id) {
    var e = $(id);
    return !!(e && e.classList.contains("active"));
  }
  function isCustomerDisplay() {
    try {
      return typeof isCustomerDisplayDevice === "function" && isCustomerDisplayDevice();
    } catch (e) {
      return false;
    }
  }
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }
  function say(t) {
    try {
      if (typeof speak === "function") speak(t);
    } catch (e) {}
  }
  // 【今回の変更】番号は「ななはちいちろく」と1桁ずつ読まず、「ななせんはっぴゃくじゅうろく」と
  // ふつうの数として読み上げる（読みが変わる「3000=さんぜん」「800=はっぴゃく」等も対応）
  var ONES = ["", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];
  var TENS = ["", "じゅう", "にじゅう", "さんじゅう", "よんじゅう", "ごじゅう", "ろくじゅう", "ななじゅう", "はちじゅう", "きゅうじゅう"];
  var HUNDREDS = ["", "ひゃく", "にひゃく", "さんびゃく", "よんひゃく", "ごひゃく", "ろっぴゃく", "ななひゃく", "はっぴゃく", "きゅうひゃく"];
  var THOUSANDS = ["", "せん", "にせん", "さんぜん", "よんせん", "ごせん", "ろくせん", "ななせん", "はっせん", "きゅうせん"];
  function digitsKana(n) {
    var v = parseInt(n, 10);
    if (!(v >= 1 && v <= 9999)) return String(n); // 想定外の数は、そのまま読ませる
    return (
      THOUSANDS[Math.floor(v / 1000) % 10] +
      HUNDREDS[Math.floor(v / 100) % 10] +
      TENS[Math.floor(v / 10) % 10] +
      ONES[v % 10]
    );
  }

  /* ---------- このレジの番号・レジかどうか ---------- */

  function getMyNo() {
    var n = parseInt(lsGet(NO_KEY), 10);
    return n > 0 ? n : 0;
  }
  function isRegisterDevice() {
    return (
      (lsGet(FLAG_KEY) === "1" || isActiveScreen("register-screen")) &&
      !isSelfMode() &&
      !isCustomerDisplay() &&
      !isActiveScreen("customer-screen")
    );
  }

  /* ---------- つながっているレジの一覧（Firebase） ---------- */

  var regs = [];
  var regsLoaded = false;
  var regsRef = null;
  var connRef = null;
  var attachedHash = "";
  var lastPubKey = "";
  var lastPubAt = 0;

  function freshRegs() {
    var p = sync();
    var now = p && p.serverNow ? p.serverNow() : Date.now();
    return regs.filter(function (r) {
      return !r.t || now - r.t < STALE_MS;
    });
  }

  function onRegs(snap) {
    var list = [];
    try {
      snap.forEach(function (c) {
        var v = c.val() || {};
        if (typeof v.no === "number") {
          list.push({ tag: c.key, no: v.no, load: v.load || 0, t: v.t || 0 });
        }
      });
    } catch (e) {}
    regs = list;
    regsLoaded = true;
  }

  function onConn(s) {
    if (!s || !s.val()) return;
    // つながるたびに、切れたら消える設定をしてから、自分の目印を置く
    var p = sync();
    if (!p || !regsRef) return;
    if (!isRegisterDevice() || !getMyNo()) return;
    var me = regsRef.child(myTag());
    me.onDisconnect()
      .remove()
      .then(function () {
        publishPresence(true);
      })
      .catch(function () {});
  }

  function detach() {
    try {
      if (regsRef) regsRef.off("value", onRegs);
    } catch (e) {}
    try {
      if (connRef) connRef.off("value", onConn);
    } catch (e) {}
    regsRef = null;
    connRef = null;
    attachedHash = "";
    regsLoaded = false;
  }

  function ensureAttached() {
    var p = sync();
    if (!p || !p.isReady || !p.isReady() || !p.getBaseRef || !p.getBaseRef()) return;
    var hash = p.getPathHash();
    if (attachedHash === hash && regsRef) return;
    detach();
    attachedHash = hash;
    regsRef = p.getBaseRef().child(NODE);
    regsRef.on("value", onRegs, function (err) {
      console.warn(
        "[register-assign] レジ一覧を読めません。Firebaseのルールで pos_sync/{場所}/" + NODE + " を許可してください:",
        err && err.message ? err.message : err
      );
    });
    try {
      connRef = firebase.database().ref(".info/connected");
      connRef.on("value", onConn);
    } catch (e) {}
  }

  // 自分のレジ情報を置く（番号・いまの忙しさ）
  var mine = {}; // このレジに割り当てられて、まだ終わっていない注文 id -> 時刻
  function myLoad() {
    var n = 0;
    try {
      if (typeof cart !== "undefined" && cart && cart.length > 0) n += 1;
    } catch (e) {}
    var now = Date.now();
    Object.keys(mine).forEach(function (id) {
      if (now - mine[id] > ORDER_TTL_MS) delete mine[id];
      else n += 1;
    });
    return n;
  }

  function publishPresence(force) {
    var p = sync();
    if (!regsRef || !p) return;
    var me = regsRef.child(myTag());
    if (!isRegisterDevice() || !getMyNo()) {
      if (lastPubKey) {
        try {
          me.remove();
        } catch (e) {}
        lastPubKey = "";
      }
      return;
    }
    var key = getMyNo() + ":" + myLoad();
    var now = Date.now();
    if (!force && key === lastPubKey && now - lastPubAt < HEARTBEAT_MS) return;
    lastPubKey = key;
    lastPubAt = now;
    try {
      me.set({
        no: getMyNo(),
        load: myLoad(),
        t: firebase.database.ServerValue.TIMESTAMP
      });
    } catch (e) {}
  }

  function autoAssignMyNo() {
    if (getMyNo() || !isRegisterDevice() || !regsLoaded) return;
    var used = {};
    freshRegs().forEach(function (r) {
      if (r.tag !== myTag()) used[r.no] = true;
    });
    var n = 1;
    while (used[n]) n++;
    lsSet(NO_KEY, String(n));
  }

  /* ---------- 4桁の番号と、レジの振り分け（セルフレジ端末側） ---------- */

  var usedNos = {}; // 4桁の番号 -> 発行された時刻
  var callNos = {}; // 注文id -> 4桁の番号
  var recentAssign = []; // 直近に割り当てたレジ（忙しさの反映が追いつかない分の補正）

  function issueCallNo() {
    var now = Date.now();
    Object.keys(usedNos).forEach(function (k) {
      if (now - usedNos[k] > ORDER_TTL_MS) delete usedNos[k];
    });
    var n;
    var guard = 0;
    do {
      n = 1000 + Math.floor(Math.random() * 9000);
      guard++;
    } while (usedNos[n] && guard < 50);
    usedNos[n] = now;
    return n;
  }

  function chooseRegister() {
    var list = freshRegs();
    if (list.length < 1) return null; // つながっているレジが無い：レジ番号は案内しない（1台でもあれば案内する）
    var now = Date.now();
    recentAssign = recentAssign.filter(function (a) {
      return now - a.t < RECENT_ASSIGN_MS;
    });
    list = list.map(function (r) {
      var extra = recentAssign.filter(function (a) {
        return a.tag === r.tag;
      }).length;
      return { tag: r.tag, no: r.no, load: (r.load || 0) + extra };
    });
    list.sort(function (a, b) {
      return a.load - b.load || a.no - b.no;
    });
    return list[0];
  }

  function decorateOrder(order) {
    var n = issueCallNo();
    order.callNo = n;
    // レジ番号は案内しない（レジで店員が番号を入力して呼び出す方式）
    showOverlay(n, null);
  }

  /* ---------- お客様画面の案内 ---------- */

  var overlayTimer = null;

  function ensureStyle() {
    if ($("haru-regassign-style")) return;
    var st = document.createElement("style");
    st.id = "haru-regassign-style";
    st.textContent =
      "#haru-callno-overlay{position:fixed;inset:0;z-index:2147483100;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(10,20,40,.94);color:#fff;text-align:center;padding:24px;font-family:inherit}" +
      "#haru-callno-overlay .lbl{font-size:22px;letter-spacing:.1em;color:#b8c7e0;margin-bottom:6px}" +
      "#haru-callno-overlay .num{font-size:min(30vw,170px);font-weight:900;line-height:1;font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em}" +
      "#haru-callno-overlay .guide{margin-top:22px;font-size:min(7vw,36px);font-weight:900;line-height:1.5}" +
      "#haru-callno-overlay .guide b{display:inline-block;background:#ffd54a;color:#1a2540;border-radius:14px;padding:2px 18px;margin:0 6px}" +
      "#haru-callno-overlay .wait{display:inline-block;background:#ffd54a;color:#1a2540;border-radius:14px;padding:2px 22px;margin-right:8px}" +
      "#haru-callno-overlay .sub{margin-top:14px;font-size:min(4.4vw,20px);color:#d7e1f2;line-height:1.6}" +
      "#haru-callno-overlay button{margin-top:26px;min-height:52px;padding:10px 34px;border:0;border-radius:14px;font-size:18px;font-weight:900;background:#fff;color:#1a2540;cursor:pointer}" +
      "#haru-register-no-badge{position:fixed;top:calc(env(safe-area-inset-top,0px) + 6px);right:8px;z-index:9000;" +
      "padding:3px 9px;border:0;border-radius:999px;background:rgba(30,40,60,.55);color:#fff;font-size:12px;font-weight:700;" +
      "opacity:.78;cursor:pointer;display:none;line-height:1.5}" +
      "#haru-register-no-badge:active{opacity:1}";
    document.head.appendChild(st);
  }

  function hideOverlay() {
    clearTimeout(overlayTimer);
    var o = $("haru-callno-overlay");
    if (o) o.remove();
  }

  // 注文を「自動化バーコード」としても発行する（レジ専用）。
  // 割引バーコードの同期（discount-sync）は他の端末へ確実に届いているので、
  // 注文の中身をそのバーコードに持たせて、レジの「🏷️ 自動化バーコード一覧」から
  // タップ（またはホームの一覧）で呼び出せるようにする。
  function publishOrderBarcode(order) {
    try {
      if (!order || !order.callNo) return;
      if (typeof discountBarcodes === "undefined" || !Array.isArray(discountBarcodes)) return;
      var code = "SELF" + order.callNo;
      if (discountBarcodes.some(function (d) { return d && d.barcode === code && !d.archived; })) return;
      var rows = [];
      (order.items || []).forEach(function (it) {
        if (!it || !it.jan) return;
        if (typeof products !== "undefined" && !products.some(function (p) { return p.jan === String(it.jan); })) return;
        var r = rows.find(function (x) { return x.jan === String(it.jan); });
        if (r) r.qty += Math.max(1, parseInt(it.qty, 10) || 1);
        else rows.push({ jan: String(it.jan), qty: Math.max(1, parseInt(it.qty, 10) || 1) });
      });
      if (!rows.length) return;
      discountBarcodes.push({
        barcode: code,
        name: "🧾 セルフレジ " + order.callNo + "番（¥" + (Number(order.total) || 0).toLocaleString() + "）",
        enabled: true,
        products: rows,
        discount: null,
        validFrom: null,
        validTo: null,
        oneTime: true,
        registerOnly: true,
        selfOrderId: order.id
      });
      if (typeof saveDiscounts === "function") saveDiscounts();
    } catch (e) {
      console.warn("[register-assign] 注文バーコードの発行に失敗しました:", e);
    }
  }

  function showOverlay(callNo, registerNo) {
    ensureStyle();
    hideOverlay();
    var o = document.createElement("div");
    o.id = "haru-callno-overlay";
    // お客様の画面は「セルフレジお会計は6903番です」だけ。空いているレジが分かるときだけ、案内を1行添える
    var guide = registerNo
      ? '<div class="guide"><b>' + esc(registerNo) + "番</b>レジへお進みください</div>"
      : "";
    o.innerHTML =
      "<div>" +
      '<div class="guide" style="margin-top:0">セルフレジお会計は</div>' +
      '<div class="num">' + esc(callNo) + "</div>" +
      '<div class="guide">番です</div>' +
      guide +
      '<button type="button">閉じる</button>' +
      "</div>";
    o.querySelector("button").addEventListener("click", hideOverlay);
    document.body.appendChild(o);
    overlayTimer = setTimeout(hideOverlay, OVERLAY_MS);
    // self-checkout-system.js の「レジへ送信しました」の読み上げが終わったあとに読み上げる
    setTimeout(function () {
      if (!$("haru-callno-overlay")) return;
      say(
        "せるふ れじ おかいけい は " + digitsKana(callNo) + " ばん です。" +
          (registerNo ? " " + registerNo + " ばん れじ へ おすすみ ください" : "")
      );
    }, 3200);
  }

  /* ---------- レジ側：注文の受け取り（割り当てがあれば、そのレジだけ） ---------- */

  var orderHandlers = []; // self-checkout-system.js が登録した、注文を受け取る処理
  var standby = {}; // 別のレジに割り当てられた注文（そのレジが落ちた時の引き継ぎ用）

  function filterOrder(msg, handler) {
    var d = msg && msg.data;
    if (d && !d.registerTag && d.callNo && d.id && !isSelfMode() && isRegisterDevice()) {
      // 番号付きの注文：レジでは勝手にカートへ入れず、店員が番号を入力するまで待つ
      mine[d.id] = Date.now();
      standby[d.id] = { msg: msg, tag: myTag(), missingSince: 0 };
      return;
    }
    if (!d || !d.registerTag || isSelfMode()) return handler(msg);
    if (d.registerTag === myTag()) {
      if (d.id) mine[d.id] = Date.now();
      // 4桁の番号が付いた注文は、勝手にカートへ入れず、店員が番号を入力するまで待つ
      if (d.callNo && d.id) {
        standby[d.id] = { msg: msg, tag: d.registerTag, missingSince: 0 };
        return;
      }
      return handler(msg);
    }
    // 別のレジが担当：この端末では受け取らない（引き継ぎ用に控えだけ持つ）
    if (d.id) standby[d.id] = { msg: msg, tag: d.registerTag, missingSince: 0 };
  }

  function evaluateFallback() {
    if (!regsLoaded || !isRegisterDevice()) return;
    var ids = Object.keys(standby);
    if (!ids.length) return;
    var list = freshRegs();
    var me = list.filter(function (r) {
      return r.tag === myTag();
    })[0];
    if (!me) return;
    var lowest = list.reduce(function (a, b) {
      return b.no < a.no ? b : a;
    }, me);
    var now = Date.now();
    ids.forEach(function (id) {
      var s = standby[id];
      var d = s.msg && s.msg.data;
      if (!d || now - (d.createdAt || 0) > ORDER_TTL_MS) {
        delete standby[id];
        return;
      }
      var alive = list.some(function (r) {
        return r.tag === s.tag;
      });
      if (alive) {
        s.missingSince = 0;
        return;
      }
      if (!s.missingSince) {
        s.missingSince = now;
        return;
      }
      if (now - s.missingSince < FALLBACK_GRACE_MS) return;
      if (lowest.tag !== myTag()) return; // 引き継ぐのは、番号が一番小さい1台だけ
      delete standby[id];
      mine[id] = now;
      orderHandlers.forEach(function (h) {
        try {
          h(s.msg);
        } catch (e) {}
      });
    });
  }

  function toastAtRegister(callNo) {
    try {
      if (typeof showToastAnimation === "function") {
        showToastAnimation("🔢 " + callNo + "番のお客様の会計をお願いします");
      }
    } catch (e) {}
  }

  // 待ち一覧の SC○○○○○○ を、4桁の番号に置き換える
  function callNoOf(id) {
    if (callNos[id]) return callNos[id];
    try {
      var list = JSON.parse(lsGet(PENDING_KEY) || "[]");
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id && list[i].callNo) return list[i].callNo;
      }
    } catch (e) {}
    return 0;
  }

  function relabelPendingList() {
    var host = $("sc-pending-list");
    if (!host) return;
    host.querySelectorAll(".sc-order").forEach(function (card) {
      var n = callNoOf(card.getAttribute("data-id"));
      var c = card.querySelector(".code");
      if (n && c && c.getAttribute("data-haru") !== "1") {
        c.textContent = n + "番";
        c.setAttribute("data-haru", "1");
      }
    });
  }

  function watchPendingList() {
    var host = $("sc-pending-list");
    if (!host || host.__haruObs) return;
    host.__haruObs = new MutationObserver(relabelPendingList);
    host.__haruObs.observe(host, { childList: true });
    relabelPendingList();
  }

  /* ---------- channel の包み込み ---------- */

  var patched = false;
  function patchChannel() {
    if (patched) return;
    if (typeof channel === "undefined" || !channel || !channel.publish || !channel.subscribe) return;
    if (channel.__haruRegAssignPatched) {
      patched = true;
      return;
    }
    patched = true;
    channel.__haruRegAssignPatched = true;

    var origPublish = channel.publish;
    var origSubscribe = channel.subscribe;

    channel.publish = function (name, data) {
      try {
        if (name === EV_ORDER && data && Array.isArray(data.items) && isSelfMode()) {
          decorateOrder(data);
          publishOrderBarcode(data);
        }
      } catch (e) {
        console.warn("[register-assign] 番号の付与に失敗しました:", e);
      }
      return origPublish.apply(this, arguments);
    };

    channel.subscribe = function (name, handler) {
      if (name === EV_ORDER && typeof handler === "function") {
        orderHandlers.push(handler);
        return origSubscribe.call(this, name, function (msg) {
          return filterOrder(msg, handler);
        });
      }
      return origSubscribe.apply(this, arguments);
    };

    // 受け取った注文の番号を控える（フィルターの外側で、すべての注文を見る）
    origSubscribe.call(channel, EV_ORDER, function (msg) {
      var d = msg && msg.data;
      if (!d || !d.id || !d.callNo) return;
      callNos[d.id] = d.callNo;
      usedNos[d.callNo] = Date.now();
      if (
        isRegisterDevice() &&
        d.senderId !== (typeof SYNC_DEVICE_ID !== "undefined" ? SYNC_DEVICE_ID : "") &&
        (!d.registerTag || d.registerTag === myTag())
      ) {
        setTimeout(function () {
          showArrivalModal(d.callNo);
          say(d.callNo ? digitsKana(d.callNo) + " ばん の おきゃくさま が き ます。 ばんごう を かくにん して にゅうりょく して ください" : "");
        }, 1500);
      }
    });

    origSubscribe.call(channel, EV_STATUS, function (msg) {
      var d = msg && msg.data;
      if (!d || !d.orderId) return;
      if (d.status === "loaded" || d.status === "paid" || d.status === "cancelled" || d.status === "discarded") {
        delete standby[d.orderId];
        delete mine[d.orderId];
      }
    });
  }

  /* ---------- 別のレジ宛ての注文でも、番号を打てばパッと読み込む ---------- */
  // 注文は割り当てられたレジにしか届かないが、お客様が別のレジに来てしまった時も、
  // 4桁の番号を打てば、自動化バーコードのように一瞬でカートに入るようにする。
  function isKnownCode(c) {
    try {
      if (typeof clerks !== "undefined" && clerks.some(function (x) { return x && x.barcode && String(x.barcode) === c; })) return true;
      if (typeof customers !== "undefined" && customers.some(function (x) { return x && String(x.barcode) === c; })) return true;
      if (typeof products !== "undefined" && products.some(function (x) { return x && (String(x.jan) === c || x.name === c); })) return true;
    } catch (e) {}
    return false;
  }

  function hookTypedCallNo() {
    if (typeof window.fetchAndAddItem !== "function") return;
    if (window.fetchAndAddItem.__haruCallNoHooked) return;
    var original = window.fetchAndAddItem;
    var wrapped = function (code) {
      var rest = arguments;
      var txt = String(code || "")
        .trim()
        .replace(/[０-９]/g, function (c) {
          return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
        })
        .replace(/番$/, "");
      if (/^\d{4}$/.test(txt) && !isKnownCode(txt)) {
        var found = null;
        Object.keys(standby).forEach(function (id) {
          var d = standby[id] && standby[id].msg && standby[id].msg.data;
          if (d && String(d.callNo) === txt) found = id;
        });
        if (found) {
          var s = standby[found];
          delete standby[found];
          mine[found] = Date.now();
          var autoLoads = false;
          try {
            autoLoads = isActiveScreen("register-screen") && typeof cart !== "undefined" && cart.length === 0;
          } catch (e) {}
          orderHandlers.forEach(function (h) {
            try {
              h(s.msg);
            } catch (e) {}
          });
          // カートが空なら受け取った瞬間に自動で入る。入っている時は、待ち一覧に入ったので同じ番号でもう一度処理する
          if (autoLoads) return;
          return window.fetchAndAddItem.apply(this, rest);
        }
      }
      if (/^\d{4}$/.test(txt) && !isKnownCode(txt)) {
        try {
          var bc = "SELF" + txt;
          if (typeof discountBarcodes !== "undefined" && discountBarcodes.some(function (d) { return d && d.barcode === bc && d.enabled !== false && !d.archived; })) {
            return original.call(this, bc);
          }
        } catch (e) {}
      }
      return original.apply(this, rest);
    };
    wrapped.__haruCallNoHooked = true;
    window.fetchAndAddItem = wrapped;
  }

  /* ---------- レジ側：「○○○○番のお客様が来ます」の案内（入力されるまで出し続ける） ---------- */
  function renderArrival() {
    var now = Date.now();
    var nums = [];
    if (isRegisterDevice() && isActiveScreen("register-screen")) {
      Object.keys(standby).forEach(function (id) {
        var s = standby[id];
        var d = s && s.msg && s.msg.data;
        if (!d || s.tag !== myTag() || !d.callNo) return;
        if (now - (d.createdAt || 0) > ORDER_TTL_MS) return;
        nums.push(d.callNo);
      });
    }
    var b = $("haru-arrival-banner");
    if (!nums.length) {
      if (b) b.style.display = "none";
      return;
    }
    if (!b) {
      b = document.createElement("div");
      b.id = "haru-arrival-banner";
      b.style.cssText =
        "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9500;max-width:94vw;" +
        "background:#e65100;color:#fff;font-weight:900;font-size:20px;line-height:1.5;text-align:center;" +
        "padding:10px 22px;border-radius:14px;box-shadow:0 6px 18px rgba(0,0,0,.4)";
      document.body.appendChild(b);
    }
    b.innerHTML = nums.map(function (n) { return esc(n) + "番"; }).join("、") +
      "のお客様が来ます<br><span style=\"font-size:15px;font-weight:700\">番号を確認して入力してください</span>";
    b.style.display = "block";
  }

  /* ---------- 注文が届いた時：どの画面を見ていても知らせ、OKでレジ画面へ移動 ---------- */
  var REGISTER_URL = "https://ishiinopasokon8610-afk.github.io/register-harureji/index_min.html#register";

  function showArrivalModal(callNo) {
    ensureStyle();
    var m = $("haru-arrival-modal");
    var line = esc(callNo) + "番のお客様が来ます";
    if (m) {
      // すでに出ている時は、番号を追記する
      var list = m.querySelector(".nums");
      if (list && list.textContent.indexOf(callNo + "番") === -1) list.innerHTML += "<br>" + line;
      return;
    }
    m = document.createElement("div");
    m.id = "haru-arrival-modal";
    m.style.cssText =
      "position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px";
    m.innerHTML =
      '<div style="background:#fff;color:#1f2933;border-radius:18px;padding:28px 24px;max-width:420px;width:100%;text-align:center">' +
      '<div style="font-size:44px">🛒</div>' +
      '<div style="font-size:22px;font-weight:900;margin:6px 0">セルフレジのお客様が来ました</div>' +
      '<div class="nums" style="font-size:28px;font-weight:900;color:#e65100;margin:10px 0">' + line + "</div>" +
      '<div style="font-size:15px;color:#52606d;margin-bottom:18px">番号を確認して入力してください</div>' +
      '<button type="button" style="width:100%;min-height:56px;border:0;border-radius:14px;background:#1f9d55;color:#fff;font-size:22px;font-weight:900;cursor:pointer">OK</button>' +
      "</div>";
    m.querySelector("button").addEventListener("click", function () {
      m.remove();
      location.href = REGISTER_URL;
    });
    document.body.appendChild(m);
  }

  /* ---------- レジ番号バッジ ---------- */

  function ensureBadge() {
    var b = $("haru-register-no-badge");
    if (b) return b;
    ensureStyle();
    b = document.createElement("button");
    b.type = "button";
    b.id = "haru-register-no-badge";
    b.title = "タップでレジ番号を変更";
    b.addEventListener("click", changeMyNo);
    document.body.appendChild(b);
    return b;
  }

  function changeMyNo() {
    var cur = getMyNo() || "";
    var input = window.prompt("このレジの番号を入力してください（1〜99）", String(cur));
    if (input === null) return;
    var n = parseInt(String(input).replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    }), 10);
    if (!(n >= 1 && n <= 99)) {
      window.alert("1〜99の数字で入力してください");
      return;
    }
    var clash = freshRegs().some(function (r) {
      return r.no === n && r.tag !== myTag();
    });
    if (clash) {
      window.alert(n + "番は、ほかのレジがすでに使っています");
      return;
    }
    lsSet(NO_KEY, String(n));
    publishPresence(true);
    updateBadge();
  }

  function updateBadge() {
    var b = ensureBadge();
    var show = isRegisterDevice() && isActiveScreen("register-screen") && !!getMyNo();
    b.style.display = show ? "block" : "none";
    if (show) b.textContent = "レジ" + getMyNo();
  }

  /* ---------- 定期処理 ---------- */

  var discountSyncBound = false;
  function bindDiscountSyncRefresh() {
    if (discountSyncBound || typeof channel === "undefined" || !channel || typeof channel.subscribe !== "function") return;
    discountSyncBound = true;
    channel.subscribe("discount-sync", function (msg) {
      try {
        var list = msg && msg.data && msg.data.discounts;
        if (Array.isArray(list)) {
          discountBarcodes = list;
          localStorage.setItem("pos_discounts", JSON.stringify(list));
        }
        if (typeof renderDiscounts === "function") renderDiscounts();
        if (typeof renderHomeAutomationBlocksIfVisible === "function") renderHomeAutomationBlocksIfVisible();
        if ($("automation-barcode-list-overlay") && typeof renderAutomationBarcodeListBox === "function") renderAutomationBarcodeListBox();
      } catch (e) {}
    });
  }

  function tick() {
    patchChannel();
    bindDiscountSyncRefresh();
    hookTypedCallNo();
    ensureAttached();
    // レジ画面を開いた端末は「レジ」として覚える（客用・セルフレジ端末は数えない）
    if (isActiveScreen("register-screen") && !isSelfMode() && !isCustomerDisplay() && lsGet(FLAG_KEY) !== "1") {
      lsSet(FLAG_KEY, "1");
    }
    autoAssignMyNo();
    publishPresence(false);
    evaluateFallback();
    updateBadge();
    renderArrival();
    watchPendingList();
  }

  function init() {
    ensureStyle();
    patchChannel();
    tick();
    setInterval(tick, 1500);
  }

  // channel の包み込みは、できるだけ早く行う（self-checkout-system.js が購読する前に）
  patchChannel();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 確認用：コンソールで haruRegisterAssign.state() を実行
  window.haruRegisterAssign = {
    state: function () {
      return {
        myNo: getMyNo(),
        isRegister: isRegisterDevice(),
        registers: freshRegs(),
        mine: Object.keys(mine),
        standby: Object.keys(standby)
      };
    }
  };
})();
