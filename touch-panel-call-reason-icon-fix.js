// ==========================================
// touch-panel-call-reason-icon-fix.js
// ------------------------------------------
// このファイルも touch-panel-order-system.js / index.html を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【不具合】
// 「🔔 店員を呼ぶ」を押したときに選べる用件一覧（TOUCH_PANEL_CALL_REASONS）
// のうち、key:'ashtray'（ラベルは「取り皿がほしい」）だけ、icon が
// 🚬（本来は灰皿・たばこ向けのマーク）のままになっており、「取り皿」の
// 用件なのにボタンには🚬が表示されてしまっていた。あわせて notifyTitle
// （通知タイトル）も ☕（コーヒー）のままで、こちらも取り皿とは無関係な
// マークだった。
//
// 【対応】
// TOUCH_PANEL_CALL_REASONS は const で宣言されているが、配列そのものを
// 差し替えるのではなく、該当要素（key:'ashtray'）の icon / notifyTitle
// というプロパティだけを書き換える（constは再代入を禁止するだけで、
// 中身のオブジェクトのプロパティ変更は問題なく行える）。
// label（「取り皿がほしい」）・voice（読み上げ）・key・notifyBodySuffixは
// 元々正しい内容だったため変更していない。
//
// 【導入方法】
// index.html内で、touch-panel-order-system.js より後ろに読み込んでください。
// ==========================================

(function fixTouchPanelPlateReasonIcon() {
    function tryFix() {
        if (typeof TOUCH_PANEL_CALL_REASONS === 'undefined' || !Array.isArray(TOUCH_PANEL_CALL_REASONS)) {
            setTimeout(tryFix, 300);
            return;
        }
        const plateReason = TOUCH_PANEL_CALL_REASONS.find(r => r.key === 'ashtray');
        if (plateReason) {
            plateReason.icon = '🍽️';
            plateReason.notifyTitle = '🍽️ 取り皿の依頼';
        }
    }
    tryFix();
})();
