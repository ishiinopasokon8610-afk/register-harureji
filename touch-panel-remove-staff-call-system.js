// ==========================================
// touch-panel-remove-staff-call-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応】
// 客用モードの注文かごバーにある「🔔 店員を呼ぶ」ボタン（用件選択
// ポップアップ経由で自動化バーコードを登録する機能）を削除する。
//
// 「💰 お会計」ボタン（同じく registerAutomationBarcodeViaForm() を
// 使って自動化バーコードを登録している）は今回の対象外で、これまで
// 通り残している。「🔔 店員を呼ぶ」機能だけをピンポイントで無効化する。
//
// ------------------------------------------
// 【対応内容（2点）】
// ① ボタン自体を非表示に
// 　注文かごバーに表示されている「🔔 店員を呼ぶ」ボタン
// 　（.tp-btn.tp-call、onclick="openTouchPanelCallMenu()"）をCSSで
// 　display:noneにする。ボタンが押せなければ、以降の用件選択
// 　ポップアップ・自動化バーコード登録も発生しない。
//
// ② 念のため関数自体も無効化
// 　ボタンを消すだけでなく、万一どこか別の場所（今後追加される機能等）
// 　から openTouchPanelCallMenu() / sendTouchPanelCallRequest() が
// 　呼ばれても、用件選択ポップアップの表示や自動化バーコードの登録が
// 　行われないよう、関数の中身を空にしている（安全策）。
// 　これにより、既存の TOUCH_PANEL_CALL_REASONS（お冷・おしぼり／
// 　取り皿／その他のご用件を含む用件一覧）や
// 　registerAutomationBarcodeViaForm() の実装そのものは変更していない
// 　が、「🔔 店員を呼ぶ」を起点にした一連の流れ（ポップアップ表示 →
// 　用件選択 → 自動化バーコード登録）はすべて動かなくなる。
//
// 【導入方法】
// index.html内で、touch-panel-order-system.js より後ろであれば
// どこでも構わない（他のタッチパネル関連ファイルの前後どちらでも可）。
// ==========================================

/* =========================================================
   ① 「🔔 店員を呼ぶ」ボタンを非表示に
   ========================================================= */
(function injectHideStaffCallButtonStyle() {
    if (document.getElementById('tp-remove-staff-call-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-remove-staff-call-style';
    style.textContent = `
        #touch-panel-overlay .tp-btn.tp-call {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
})();

/* =========================================================
   ② 念のため、呼び出し用件ポップアップ・自動化バーコード登録の
   　 関数自体も無効化する
   ========================================================= */
(function disableStaffCallFunctions() {
    function tryHook() {
        if (typeof window.openTouchPanelCallMenu !== 'function' || typeof window.sendTouchPanelCallRequest !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        window.openTouchPanelCallMenu = function () {
            // 「🔔 店員を呼ぶ」機能は削除済みのため、何もしない
        };
        window.sendTouchPanelCallRequest = function () {
            // 「🔔 店員を呼ぶ」機能は削除済みのため、何もしない
            // （自動化バーコードは登録しない）
        };
    }
    tryHook();
})();
