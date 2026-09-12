// ==========================================
// checkout-image-hide-on-home.js
// ------------------------------------------
// 【この機能】
// checkout-image.js は、これまで「次のお会計の1品目がスキャンされた
// タイミング」でのみ、客用画面に表示中の「お会計完了時の画像」を消す
// 仕様になっていた（hideCheckoutImageOnNewTransaction 参照）。
//
// これだと、お会計完了後にレジ担当者がホーム画面（home-screen）に
// 戻っただけでは画像が消えず、次のお客様の会計が始まるまで前のお客様
// 向けの画像が客用画面に表示されたままになってしまう。
//
// この修正では、ホーム画面（home-screen）に戻ったタイミングでも、
// 表示中の画像を消す（＝他端末の客用ディスプレイにもAbly経由で
// 「消してください」を伝える）ようにする。
//
// checkout-image.js に元々ある hideCheckoutCompleteImageAndBroadcast()
// をそのまま呼ぶだけなので、消し方・他端末との同期の仕組みは完全に
// 共通のまま（挙動の重複・矛盾は起きない）。
//
// index.html / register.js は直接編集せず、
// screen-title-system.js と同様に showScreen() をラップする
// フック方式で実現する（他の追加機能ファイルと同じ方針）。
//
// 【導入方法】
// index.html内で、checkout-image.js の後ろ（順不同で構いませんが
// showScreen が定義された後）に、このファイルを読み込んでください。
//   <script src="checkout-image.js"></script>
//   <script src="checkout-image-hide-on-home.js"></script>
// ==========================================

(function hookShowScreenForCheckoutImageHide() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'home-screen' && typeof hideCheckoutCompleteImageAndBroadcast === 'function') {
                hideCheckoutCompleteImageAndBroadcast();
            }
            return result;
        };
    }
    tryHook();
})();
