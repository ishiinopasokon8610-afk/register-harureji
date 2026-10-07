// ==========================================
// zero-total-manager-auth-system.js
// ------------------------------------------
// 【背景】
// register.js の openCheckout() は、
//     if (cart.length === 0 || currentTotal <= 0) { ...エラー表示して return }
// となっており、合計金額が0円のとき（無料サービス品・全額値引き・
// 試供品の提供など）は、お会計画面に進めなかった。
//
// 【この機能】
// 「カートに商品があり、合計がちょうど0円」の場合に限り、
//   ・店長認証済み（auth-system.js の isManagerAuthorized() が true）
//       → そのままお会計（支払い画面）に進める
//   ・店長認証していない
//       → 進めない（従来どおり）。ただしメッセージを
//         「0円で会計するには店長認証が必要です」に変えて案内する
// カートが空の場合・合計がマイナスの場合は、従来どおり進めない。
//
// 0円のときは、ポイント利用の選択画面は出さず、直接お支払い画面
// （proceedToPayment）に進む（0円でポイントを使う意味が無いため）。
// 以降の completeTransaction() 側は、billingAmount が0のときも
// 問題なく通る作りになっているため、変更していない
// （deposit-shortage-guard-system.js も「預かり < 請求額」のときだけ
// 止める判定なので、0円なら止まらない）。
//
// register.js / auth-system.js / deposit-shortage-guard-system.js は
// 直接編集せず、openCheckout() をラップするフック方式で実現する。
//
// 【導入方法】
// index.html内で、register.js と deposit-shortage-guard-system.js の
// 両方より後ろに、このファイルを読み込んでください。
//   <script src="deposit-shortage-guard-system.js"></script>
//   <script src="zero-total-manager-auth-system.js"></script>
// ==========================================

(function hookOpenCheckoutForZeroTotalManagerAuth() {
    function isZeroTotalCart() {
        return typeof cart !== 'undefined' && Array.isArray(cart) && cart.length > 0 &&
            typeof currentTotal !== 'undefined' && currentTotal === 0;
    }

    function isManagerOk() {
        return typeof isManagerAuthorized === 'function' && isManagerAuthorized();
    }

    // 店長認証済みで合計0円のとき：openCheckout() の「0円以下ならエラー」の
    // 判定だけを除いた処理（register.js の openCheckout() と同じ初期化）
    function openCheckoutForZeroTotal() {
        if (typeof playSound === 'function') playSound('click');

        usedPoints = 0;
        billingAmount = currentTotal; // 0
        earnedPointsThisTime = 0;

        const modal = document.getElementById('checkout-modal');
        if (modal) modal.style.display = 'flex';

        const somePointsInput = document.getElementById('some-points-input');
        if (somePointsInput) somePointsInput.value = '';
        const somePointsArea = document.getElementById('some-points-input-area');
        if (somePointsArea) somePointsArea.style.display = 'none';

        // proceedToPayment() は請求額0円のとき「ポイントでのお支払いですね」と
        // 読み上げてしまうため、この呼び出しの間だけ案内文を差し替える
        const originalSpeak = window.speak;
        if (typeof originalSpeak === 'function') {
            window.speak = function (text, ...rest) {
                const t = (typeof text === 'string' && text.includes('ポイント で の おしはらい'))
                    ? 'ごうけい ぜろえん です。 てんちょう にんしょう ずみ です'
                    : text;
                return originalSpeak.call(this, t, ...rest);
            };
        }
        try {
            proceedToPayment();
        } finally {
            if (typeof originalSpeak === 'function') window.speak = originalSpeak;
        }

        if (typeof refreshDepositShortageUI === 'function') refreshDepositShortageUI();
    }

    function tryHook() {
        if (typeof window.openCheckout !== 'function' || typeof window.proceedToPayment !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.openCheckout;
        window.openCheckout = function (...args) {
            if (isZeroTotalCart()) {
                if (isManagerOk()) {
                    return openCheckoutForZeroTotal();
                }
                if (typeof playSound === 'function') playSound('error');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm(
                        '合計金額が0円です。0円で会計するには、店長認証が必要です。',
                        'ごうけい きんがく が ぜろえん です。 ぜろえん で かいけい する に は、 てんちょう にんしょう が ひつよう です。',
                        () => { if (typeof focusJanInput === 'function') focusJanInput(); },
                        true
                    );
                }
                return;
            }
            return original.apply(this, args);
        };
    }
    tryHook();
})();
