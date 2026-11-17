// ==========================================
// touch-panel-table-force-checkout-system.js
// ------------------------------------------
// 【この機能】
// 卓番選択画面（店員用モード）でテーブルを長押しすると、
//   ・💰 会計する（店長認証あり）
//   ・🔄 データをリセットだけする（こちらも店長認証あり）
//   ・キャンセル
// の3択が出る。
//
// 「会計する」を選ぶと、
//   1. 店長認証（店長バーコード）
//   2. そのテーブルの未会計の注文（「🍽️ テーブルN（…」の注文バーコード）を
//      レジのカートにまとめて読み込み、レジ画面を開く
//   3. 店員がレジの「お会計」ボタンから、いつもどおり支払い方法を選んで会計
//   4. 会計が成立した時点で、そのテーブルを自動で空席に戻す
// という流れになる。お客さん側タブレットの電池切れや、そのテーブルを
// 今すぐ使いたいときに、店員側から強制的に会計して空席にするための機能。
//
// 【安全のための決まり】
// ・レジのカートに商品が入っているとき（別のお客様の会計中の可能性）は、
//   強制会計は始めない（先に会計か全取消をしてもらう）。
// ・そのテーブルに未会計の注文が1件もないときは、会計せずに
//   「空席に戻すだけ」にするかを確認する。
// ・読み込みは、レジでバーコードをスキャンしたときと同じ処理
//   （applyDiscountBarcode）を使うので、年齢確認が必要な商品は
//   これまでどおり年齢確認が入る。
// ・会計をキャンセルして戻った場合や、カートを空にした場合、テーブルは
//   使用中のまま残る（注文バーコードも未使用のまま）。もう一度長押しできる。
//
// 【注意】お客さんのタブレットで「注文する」を押す前だった分は、タブレット
// 側にしか残っていないため、会計には入らない（送信済みの注文だけが対象）。
//
// index.html / touch-panel-order-system.js / register.js / auth-system.js 等は
// 直接編集せず、他の追加機能と同じフック方式で実現している。
//
// 【導入方法】
// index.html内で、touch-panel-table-reset-and-badge-position-system.js と
// table-usage-timer-system.js の「両方より後ろ」に1行追加してください。
//   <script src="touch-panel-table-force-checkout-system.js"></script>
// ==========================================

const TP_FORCE_CHECKOUT_AUTH_TARGET = 'tp-force-checkout';
const TP_FORCE_CHECKOUT_AUTH_VALID_MS = 2 * 60 * 1000; // 認証待ちの有効期間

let tpForceCheckoutAuthCb = null;   // { fn, at }
let tpForceCheckoutPending = null;  // { table, barcodes, loaded }

/* ---------- 小さな共通関数 ---------- */
function tpFcNotice(msg, speech) {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(msg, speech || msg, () => {}, false);
    } else {
        window.alert(msg);
    }
}

function tpFcAsk(msg, speech, onYes) {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(msg, speech || msg, (ok) => { if (ok) onYes(); }, true);
    } else if (window.confirm(msg)) {
        onYes();
    }
}

function tpFcToast(msg) {
    if (typeof showToastAnimation === 'function') showToastAnimation(msg);
    else if (typeof showTouchPanelToast === 'function') showTouchPanelToast(msg);
}

function tpFcReleaseTable(num) {
    if (typeof releaseTouchPanelTable === 'function') releaseTouchPanelTable(num);
    if (typeof refreshTouchPanelTableGridIfVisible === 'function') refreshTouchPanelTableGridIfVisible();
}

/* ---------- そのテーブルの未会計の注文バーコードを探す ---------- */
function tpFindTableOrderBarcodes(num) {
    if (typeof discountBarcodes === 'undefined' || !Array.isArray(discountBarcodes)) return [];
    // 注文バーコードの名前は「🍽️ テーブルN（人数）注文：…」。
    // 「テーブル1（」と「テーブル11（」を区別できるよう、「（」まで含めて探す
    const key = `テーブル${num}（`;
    return discountBarcodes.filter(d =>
        d && !d.archived && d.enabled !== false &&
        typeof d.barcode === 'string' && d.barcode.indexOf('TBL') === 0 &&
        Array.isArray(d.products) && d.products.length > 0 &&
        typeof d.name === 'string' && d.name.indexOf(key) !== -1
    );
}

/* ---------- 長押しで出す3択メニュー ---------- */
function tpShowForceCheckoutMenu(num) {
    const old = document.getElementById('tp-force-checkout-menu');
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.id = 'tp-force-checkout-menu';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);' +
        'display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;color:#222;border-radius:14px;padding:22px 22px 16px;' +
        'width:min(420px,90vw);box-shadow:0 8px 30px rgba(0,0,0,.4);text-align:center;';

    const title = document.createElement('div');
    title.textContent = `テーブル${num}`;
    title.style.cssText = 'font-size:22px;font-weight:700;margin-bottom:6px;';
    const sub = document.createElement('div');
    sub.textContent = 'どうしますか？';
    sub.style.cssText = 'font-size:14px;color:#666;margin-bottom:16px;';
    box.appendChild(title);
    box.appendChild(sub);

    function addBtn(label, bg, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = `display:block;width:100%;margin:8px 0;padding:14px;font-size:17px;font-weight:700;` +
            `border:none;border-radius:10px;color:#fff;background:${bg};cursor:pointer;`;
        b.addEventListener('click', () => { wrap.remove(); onClick(); });
        box.appendChild(b);
    }

    addBtn('💰 会計する（店長認証）', '#2e7d32', () => tpStartForceCheckout(num));
    addBtn('🔄 データをリセットだけする（店長認証）', '#c62828', () => {
        tpRequestManagerThen(() => {
            if (typeof tpOriginalConfirmResetTouchPanelTable === 'function') tpOriginalConfirmResetTouchPanelTable(num);
        });
    });
    addBtn('キャンセル', '#757575', () => {});

    wrap.appendChild(box);
    wrap.addEventListener('click', (ev) => { if (ev.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    if (typeof tpPlaySound === 'function') tpPlaySound('click');
}

/* ---------- ① 店長認証 ---------- */
function tpStartForceCheckout(num) {
    tpRequestManagerThen(() => tpRunForceCheckout(num));
}

// 店長認証を通したあとに fn を実行する（会計・リセットの両方で共通）
function tpRequestManagerThen(fn) {
    if (typeof requestManagerAuth !== 'function') {
        tpFcNotice('店長認証の機能が見つかりません。');
        return;
    }
    tpForceCheckoutAuthCb = { fn: fn, at: Date.now() };

    // 卓番選択画面（全画面のタッチパネル）より手前に、認証モーダルを出す
    const modal = document.getElementById('manager-auth-modal');
    if (modal) modal.style.zIndex = '2147483000';

    requestManagerAuth(TP_FORCE_CHECKOUT_AUTH_TARGET);
}

// 認証が成功すると auth-system.js の verifyManagerAuth() が
// openManagerAuthTarget(target) を呼ぶので、そこをラップして続きを実行する
(function hookOpenManagerAuthTarget() {
    function tryHook() {
        if (typeof window.openManagerAuthTarget !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.openManagerAuthTarget;
        window.openManagerAuthTarget = function (target, ...rest) {
            if (target === TP_FORCE_CHECKOUT_AUTH_TARGET) {
                const cb = tpForceCheckoutAuthCb;
                tpForceCheckoutAuthCb = null;
                // 古い認証待ち（キャンセル後など）は実行しない
                if (cb && (Date.now() - cb.at) <= TP_FORCE_CHECKOUT_AUTH_VALID_MS) cb.fn();
                return;
            }
            return original.apply(this, [target, ...rest]);
        };
    }
    tryHook();
})();

/* ---------- ② 注文をレジに読み込む ---------- */
function tpRunForceCheckout(num) {
    const orders = tpFindTableOrderBarcodes(num);

    if (orders.length === 0) {
        tpFcAsk(
            `テーブル${num}には、会計されていない注文がありません。\n会計はせず、空席に戻すだけにしますか？`,
            `てーぶる${num} に は、 かいけい さ れ て い ない ちゅうもん が あり ませ ん。 くうせき に もどし ます か？`,
            () => {
                tpFcReleaseTable(num);
                tpFcToast(`✅ テーブル${num}を空席に戻しました`);
            }
        );
        return;
    }

    if (typeof cart !== 'undefined' && Array.isArray(cart) && cart.length > 0) {
        if (typeof playSound === 'function') playSound('error');
        tpFcNotice(
            'レジに別のお客様の商品が入っています。先にそのお会計を済ませるか、全取消をしてから、もう一度お試しください。',
            'れじ に べつ の おきゃくさま の しょうひん が はいって い ます。 さき に おかいけい を すませて ください。'
        );
        return;
    }

    // タッチパネルを閉じて、レジ画面を開く
    try { if (typeof closeTouchPanel === 'function') closeTouchPanel(); } catch (e) { /* 無視 */ }
    try { if (typeof openRegister === 'function') openRegister(); } catch (e) { /* 無視 */ }

    tpForceCheckoutPending = { table: num, barcodes: orders.map(d => d.barcode), loaded: false };

    // 1件ずつ、レジでスキャンしたときと同じ処理でカートへ。
    // 年齢確認の途中（pendingDiscountQueue がある間）は、終わるまで待つ
    const queue = orders.slice();
    const myPending = tpForceCheckoutPending;
    (function next() {
        if (tpForceCheckoutPending !== myPending) return; // 途中で中止された
        if (typeof pendingDiscountQueue !== 'undefined' && pendingDiscountQueue) {
            setTimeout(next, 300);
            return;
        }
        const d = queue.shift();
        if (!d) {
            myPending.loaded = true;
            tpFcToast(`🍽️ テーブル${num}の注文を読み込みました。「お会計」を押してください`);
            if (typeof speak === 'function') speak(`てーぶる${num} の ちゅうもん を よみこみ まし た`);
            return;
        }
        if (typeof applyDiscountBarcode === 'function') applyDiscountBarcode(d);
        setTimeout(next, 150);
    })();
}

/* ---------- ③ 会計が成立したら、そのテーブルを空席に戻す ---------- */
// 使い切りバーコードの後始末（cleanupOneTimeDiscountBarcodes）は、会計が
// 成立したときだけ呼ばれるので、そこで「今回の会計にそのテーブルの注文が
// 含まれていたか」を確認して空席にする
(function hookCleanupForForceCheckout() {
    function tryHook() {
        if (typeof window.cleanupOneTimeDiscountBarcodes !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.cleanupOneTimeDiscountBarcodes;
        window.cleanupOneTimeDiscountBarcodes = function (...args) {
            const pending = tpForceCheckoutPending;
            if (pending && pending.loaded && typeof usedOneTimeDiscBarcodesInTransaction !== 'undefined') {
                // 取りこぼしがないよう、このテーブルの注文を使用済みとして確実に含める
                pending.barcodes.forEach(b => usedOneTimeDiscBarcodesInTransaction.add(b));
            }
            const result = original.apply(this, args);
            if (pending && pending.loaded) {
                tpForceCheckoutPending = null;
                tpFcReleaseTable(pending.table);
                tpFcToast(`✅ テーブル${pending.table}を会計して、空席に戻しました`);
            }
            return result;
        };
    }
    tryHook();
})();

// カートが空になった（全取消など）＝会計せずに中止、とみなして待機を解除する
(function hookUpdateReceiptForForceCheckout() {
    function tryHook() {
        if (typeof window.updateReceipt !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.updateReceipt;
        window.updateReceipt = function (...args) {
            const result = original.apply(this, args);
            if (tpForceCheckoutPending && tpForceCheckoutPending.loaded &&
                typeof cart !== 'undefined' && Array.isArray(cart) && cart.length === 0) {
                tpForceCheckoutPending = null;
            }
            return result;
        };
    }
    tryHook();
})();

/* ---------- ④ 既存の長押し（リセット確認）を3択メニューに差し替える ---------- */
// touch-panel-table-reset-and-badge-position-system.js の長押し処理は
// tpConfirmResetTouchPanelTable(num) を呼ぶので、これを差し替える。
// 元の「リセットだけ」の処理は、メニューの2つ目の選択肢として残す。
let tpOriginalConfirmResetTouchPanelTable = null;
(function hookLongPressMenu() {
    function tryHook() {
        if (typeof window.tpConfirmResetTouchPanelTable !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        if (tpOriginalConfirmResetTouchPanelTable) return;
        tpOriginalConfirmResetTouchPanelTable = window.tpConfirmResetTouchPanelTable;
        window.tpConfirmResetTouchPanelTable = function (num) {
            tpShowForceCheckoutMenu(num);
        };
    }
    tryHook();
})();
