// ==========================================
// auto-home-block-on-use.js
// ------------------------------------------
// 【背景】
// home-automation-blocks.js の「🏠 ホームに表示」ボタンは、これまで
// 自動化バーコード一覧の画面で店員が手動で押さない限りONにならず、
// ホーム画面（長押しオーバーレイ）に出てこなかった。
// 実際の運用では「そのバーコードが実際に使われた瞬間に、押さなくても
// 自動的にホームへ出てきてほしい」という要望のため、この仕組みを追加する。
//
// 【この機能】
// discount-system.js の applyDiscountBarcode(disc) は、期限切れ・
// 同一会計内での二重使用など「弾かれるケース」をすべて確認し終えた
// あとに呼ばれる箇所なので、ここに到達した＝そのバーコードが実際に
// 使われた（＝カートに追加された）とみなせる。
// この瞬間に disc.showOnHome を自動的に true にし、
// home-automation-blocks.js の toggleDiscountShowOnHome() を
// 手動で押したのと同じ状態（ホーム表示ON・経過時間タイマー開始）にする。
//
// すでにホーム表示ONのものは何もしない（再スキャンのたびにタイマーが
// リセットされてしまわないようにするため）。
//
// discount-system.js / home-automation-blocks.js / register.js は
// 直接編集せず、applyDiscountBarcode() をフックして実現する
// （他の追加機能ファイルと同じ「フック方式」）。
// ==========================================

(function hookApplyDiscountBarcodeForAutoHomeBlock() {
    function tryHook() {
        if (typeof window.applyDiscountBarcode !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.applyDiscountBarcode;
        window.applyDiscountBarcode = function (disc) {
            markDiscountShownOnHome(disc);
            return original.call(this, disc);
        };
    }
    tryHook();
})();

function markDiscountShownOnHome(disc) {
    if (!disc || disc.showOnHome) return;

    disc.showOnHome = true;
    disc.homeBlockStartAt = Date.now();

    if (typeof discountBarcodes !== 'undefined') {
        localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
    }
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

    // 自動化バーコード一覧画面が開いていれば、ボタンの見た目（🏠 ホーム表示中）も連動して更新する
    if (typeof injectHomeBlockCheckboxColumn === 'function') injectHomeBlockCheckboxColumn();
    // ホームの長押しオーバーレイがすでに開いていれば、その場でブロックを反映する
    if (typeof renderHomeAutomationBlocksIfVisible === 'function') renderHomeAutomationBlocksIfVisible();
}
