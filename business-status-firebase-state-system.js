// business-status-firebase-state-system.js
// 売上管理（業務の開始・終了）の「いまの状態」を Firebase に保存し、
// 開いていなかった端末が、後から開いたときにも追いつけるようにするフック。
//
// 【これまで】
//   sales-mgmt.js は、業務の開始・終了を channel.publish('business-status') で
//   その場にいる端末にだけ知らせていた。端末を閉じていた間の開始・終了や、
//   24時間以上あとに開いた端末、初めてつないだ端末には届かなかった。
//
// 【このファイル】
//   ・業務の開始・終了のたびに、いまの状態を
//       pos_sync/{場所}/business_state
//     に1件だけ（上書きで）保存する。中身は firebase-sync-system.js と同じ鍵で暗号化する。
//   ・同期がつながったとき、および他の端末が更新したときに読み込み、
//     自分より新しければ localStorage に反映して画面（終了オーバーレイ）も更新する。
//   保存する内容：業務が終了中か、釣銭準備金（pos_start_cash）、直近の過不足（pos_last_close_diff）。
//
// 【導入】index.html の最後のほうで、sales-mgmt.js と firebase-sync-system.js より後ろに読み込む。

(function () {
  "use strict";

  var NODE = "business_state";
  var LOCAL_T_KEY = "pos_sync_business_state_t"; // pos_sync_ で始まるのでバックアップ・設定同期の対象外

  var attachedHash = "";
  var attachedRef = null;
  var attachedHandler = null;
  var pendingSave = false;
  var applying = false;

  /* ---------- 小道具 ---------- */

  function sync() {
    return window.PosSync || null;
  }

  function readLocalT() {
    try {
      return Number(localStorage.getItem(LOCAL_T_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function writeLocalT(t) {
    try {
      localStorage.setItem(LOCAL_T_KEY, String(t));
    } catch (e) {}
  }

  function snapshotLocal() {
    var closed = false;
    var startCash = 0;
    var diff = null;
    try {
      closed = localStorage.getItem("pos_business_closed") === "true";
      startCash = parseInt(localStorage.getItem("pos_start_cash"), 10) || 0;
      var raw = localStorage.getItem("pos_last_close_diff");
      diff = raw ? JSON.parse(raw) : null;
    } catch (e) {}
    return { closed: closed, startCash: startCash, diff: diff };
  }

  function hasMeaningfulLocalState(s) {
    return s.closed || s.startCash > 0 || !!s.diff;
  }

  function isReady() {
    var p = sync();
    return !!(p && p.isReady && p.isReady() && p.getBaseRef && p.getBaseRef());
  }

  /* ---------- 保存 ---------- */

  function save() {
    var p = sync();
    if (!isReady()) {
      pendingSave = true;
      return;
    }
    pendingSave = false;
    var snap = snapshotLocal();
    var payload = {
      t: p.serverNow(),
      by: p.DEVICE_TAG,
      closed: snap.closed,
      startCash: snap.startCash,
      diff: snap.diff
    };
    p.encryptJson(payload)
      .then(function (enc) {
        writeLocalT(payload.t);
        return p.getBaseRef().child(NODE).set({
          d: enc,
          t: firebase.database.ServerValue.TIMESTAMP
        });
      })
      .catch(function (e) {
        pendingSave = true; // つながり直したときに、もう一度保存する
        console.warn("[business-state] Firebaseへの保存に失敗しました:", e && e.message ? e.message : e);
      });
  }

  /* ---------- 読み込み・反映 ---------- */

  function applyRemote(payload) {
    if (!payload || typeof payload.t !== "number") return;
    var p = sync();
    if (p && payload.by === p.DEVICE_TAG) return; // 自分が書いたもの
    if (payload.t <= readLocalT()) return; // 自分のほうが新しい（または同じ）

    applying = true;
    try {
      if (payload.closed) localStorage.setItem("pos_business_closed", "true");
      else localStorage.removeItem("pos_business_closed");

      if (typeof payload.startCash === "number") {
        localStorage.setItem("pos_start_cash", String(payload.startCash));
      }
      if (payload.diff) {
        localStorage.setItem("pos_last_close_diff", JSON.stringify(payload.diff));
      } else {
        localStorage.removeItem("pos_last_close_diff");
      }
      writeLocalT(payload.t);
      if (typeof checkBusinessStatus === "function") checkBusinessStatus();
    } catch (e) {
      console.warn("[business-state] 反映に失敗しました:", e);
    }
    applying = false;
  }

  function onRemoteValue(snap) {
    var v = snap && snap.val();
    var p = sync();
    if (!v || !v.d) {
      // 保存されたものがまだ無い：この端末に意味のある状態があれば、最初の1件として保存する
      if (p && hasMeaningfulLocalState(snapshotLocal())) save();
      return;
    }
    p.decryptJson(v.d)
      .then(applyRemote)
      .catch(function (e) {
        console.warn("[business-state] 復号に失敗しました（データ用コードが違う可能性）:", e && e.message ? e.message : e);
      });
  }

  /* ---------- つなぎ込み ---------- */

  function detach() {
    if (attachedRef && attachedHandler) {
      try {
        attachedRef.off("value", attachedHandler);
      } catch (e) {}
    }
    attachedRef = null;
    attachedHandler = null;
    attachedHash = "";
  }

  function ensureAttached() {
    var p = sync();
    if (!isReady()) return;
    var hash = p.getPathHash();
    if (attachedHash === hash && attachedRef) {
      if (pendingSave) save();
      return;
    }
    detach();
    attachedHash = hash;
    attachedRef = p.getBaseRef().child(NODE);
    attachedHandler = onRemoteValue;
    attachedRef.on("value", attachedHandler, function (err) {
      console.warn(
        "[business-state] 読み込みできません。Firebaseのルールで pos_sync/{場所}/" + NODE + " を許可してください:",
        err && err.message ? err.message : err
      );
    });
    if (pendingSave) save();
  }

  /* ---------- sales-mgmt.js のフック ---------- */

  function wrapBroadcast() {
    if (typeof window.broadcastBusinessStatus !== "function") return false;
    if (window.broadcastBusinessStatus.__fbStateWrapped) return true;
    var original = window.broadcastBusinessStatus;
    var wrapped = function () {
      var result = original.apply(this, arguments);
      // localStorage の更新は、この呼び出しより前に終わっている
      if (!applying) setTimeout(save, 0);
      return result;
    };
    wrapped.__fbStateWrapped = true;
    window.broadcastBusinessStatus = wrapped;
    return true;
  }

  function init() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (wrapBroadcast() || tries > 20) clearInterval(t);
    }, 500);
    wrapBroadcast();

    setInterval(ensureAttached, 2000);
    window.addEventListener("pos-sync-status", ensureAttached);
    ensureAttached();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
