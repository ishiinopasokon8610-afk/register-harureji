// ==========================================
// discount-home-state-sync-fix.js
// ------------------------------------------
// このファイルも discount-system.js / home-automation-blocks.js /
// home-automation-blocks-longpress-delete-system.js /
// auto-home-block-on-use.js / index.html を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【背景（不具合）】
// discount-system.js のAbly同期（'discount-sync'）は、自動化バーコードの
// 一覧（discountBarcodes）を「丸ごと」送り、受け取った端末は自分の一覧を
// 「丸ごと」置き換える方式になっている。
// 一方、次の3つの情報は saveDiscounts() を通さず、localStorageへ直接
// 書いていたため、他の端末には送られず、しかも他の端末から一覧が届くたびに
// 上書きされて消えていた。
//   ① 経過時間タイマーの起点（homeBlockStartAt）
//        home-automation-blocks.js が、ブロックを初めて表示した時に
//        その端末だけで記録していた
//   ② ホームから隠す（hideFromHome）
//        長押し（home-automation-blocks-longpress-delete-system.js）で
//        手動登録の割引バーコードを隠した時
//   ③ 使われた時のホーム表示ON（showOnHome）と起点
//        auto-home-block-on-use.js
// その結果、たとえばタッチパネルが新しい呼び出しを登録するたびに、
// 店員端末の他のブロックの経過時間が 00:00 に戻ったり、隠したはずの
// ブロックが復活したりするはずだった。
//
// 【この機能】
// ① 登録した瞬間に homeBlockStartAt を付ける
//    （discount-system.js の finalizeAddDiscountBarcode() をフック）。
//    起点が登録内容と一緒に全端末へ届くので、どの端末でも同じ経過時間に
//    なり、他端末からの一覧で上書きされても起点が消えない。
//    タッチパネルからの登録（registerAutomationBarcodeViaForm →
//    addDiscountBarcode）もこの関数を通る。
// ② 直接保存していた次の4か所の「直後」に、いま持っている一覧を
//    全端末へ送る（discount-system.js の broadcastDiscounts() を呼ぶ）。
//    保存の仕組み自体はそのままで、送信だけを足している。
//    ・renderHomeAutomationBlocksGrid() が、起点の無い古いデータに
//      初めて起点を付けた時（登録時に起点が付く前に作られたバーコード用）
//    ・tpHandleAutomationBarcodeLongPressComplete() が
//      ホームから隠した時（長押し）
//    ・archiveDiscountBarcode() がホームから隠した時
//      （home-automation-blocks.js 本来の実装。現在は上の長押し処理に
//      置き換わっているが、読み込み順が変わった時の保険）
//    ・markDiscountShownOnHome() が、初めて使われた時に
//      showOnHome／起点を付けた時
//
// 【この対応で変わる動き】
// ・経過時間は、「その端末でブロックを初めて表示した時」ではなく
//   「登録した時」から数える（全端末で同じ値になる）。
//   ただし、初めてスキャンされた時に auto-home-block-on-use.js が
//   起点をその時刻に付け直す動きは、これまで通り（その値が全端末に届く）。
// ・「ホームから隠す」操作が、その端末だけでなく全端末に反映される。
//
// 【この対応で直らないこと（別件）】
// discount-system.js の「一覧を丸ごと置き換える」同期方式そのものは
// 変えていない。オフラインなどで古い一覧を持っている端末が、何かを
// 保存すると、その古い一覧が全端末に配られ、他の端末で追加された
// バーコードが消えることがある。この点は別の対応が必要。
//
// 【導入方法】
// index.html内で、auto-home-block-on-use.js より後ろに読み込んでください
// （読み込み順が違っていても、対象の関数が現れるまで待つので動きますが、
// 後ろに置くのが確実です）。
//   <script src="auto-home-block-on-use.js"></script>
//   <script src="discount-home-state-sync-fix.js"></script>
// ==========================================

(function fixDiscountHomeStateSync() {
    'use strict';

    // いま持っている一覧を全端末へ送る（discount-system.js の関数）。
    // 未読み込み・未接続（channelが無い）の場合は何もしない。
    function broadcastDiscountsNow() {
        if (typeof broadcastDiscounts !== 'function') return;
        try {
            broadcastDiscounts();
        } catch (e) {
            console.warn('自動化バーコードの同期送信に失敗しました:', e);
        }
    }

    function getDiscountByIndex(index) {
        return (typeof discountBarcodes !== 'undefined' && Array.isArray(discountBarcodes))
            ? discountBarcodes[index]
            : null;
    }

    // 対象の関数が読み込まれるまで待ってから、1回だけ包み直す
    function hookWhenReady(name, makeWrapper) {
        function tryHook() {
            if (typeof window[name] !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            if (window[name].__discHomeStateSyncFixApplied) return; // 二重に包まない
            const wrapped = makeWrapper(window[name]);
            wrapped.__discHomeStateSyncFixApplied = true;
            window[name] = wrapped;
        }
        tryHook();
    }

    /* ---------------------------------------------------------
       ① 登録した瞬間に、経過時間タイマーの起点を付ける
       --------------------------------------------------------- */
    hookWhenReady('finalizeAddDiscountBarcode', (original) => function (discData, ...rest) {
        if (discData && typeof discData === 'object' && !discData.homeBlockStartAt) {
            discData.homeBlockStartAt = Date.now();
        }
        return original.call(this, discData, ...rest);
    });

    /* ---------------------------------------------------------
       ② -a ブロック描画時に、起点の無い古いデータへ起点が付いたら送信する
       （描画前に「起点が無いもの」を控えておき、描画後に付いていたら送る。
       　home-automation-blocks.js 側の絞り込み条件を真似せずに済む）
       --------------------------------------------------------- */
    hookWhenReady('renderHomeAutomationBlocksGrid', (original) => function (...args) {
        const list = (typeof discountBarcodes !== 'undefined' && Array.isArray(discountBarcodes))
            ? discountBarcodes
            : [];
        const missingBefore = list.filter((d) => d && !d.homeBlockStartAt);

        const result = original.apply(this, args);

        if (missingBefore.some((d) => d.homeBlockStartAt)) {
            broadcastDiscountsNow();
        }
        return result;
    });

    /* ---------------------------------------------------------
       ② -b ホームから隠した時（長押し）に送信する
       ・削除した場合は、元の処理が saveDiscounts() 経由で送信済みなので
         何もしない（隠しただけの場合のみ送る）
       --------------------------------------------------------- */
    function wrapHideByIndex(name) {
        hookWhenReady(name, (original) => function (index, ...rest) {
            const disc = getDiscountByIndex(index);
            const wasHidden = !!(disc && disc.hideFromHome);

            const result = original.call(this, index, ...rest);

            if (disc && disc.hideFromHome && !wasHidden) {
                broadcastDiscountsNow();
            }
            return result;
        });
    }
    wrapHideByIndex('tpHandleAutomationBarcodeLongPressComplete');
    wrapHideByIndex('archiveDiscountBarcode');

    /* ---------------------------------------------------------
       ② -c 初めて使われた時の showOnHome／起点の書き換えを送信する
       （すでにホーム表示ONのものは元の処理が何もしないので、送らない）
       --------------------------------------------------------- */
    hookWhenReady('markDiscountShownOnHome', (original) => function (disc, ...rest) {
        const wasShown = !!(disc && disc.showOnHome);

        const result = original.call(this, disc, ...rest);

        if (disc && disc.showOnHome && !wasShown) {
            broadcastDiscountsNow();
        }
        return result;
    });
})();
