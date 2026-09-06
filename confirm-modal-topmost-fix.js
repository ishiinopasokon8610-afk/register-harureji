// ==========================================
// confirm-modal-topmost-fix.js
// ------------------------------------------
// 【不具合の背景】
// showCustomConfirm()（はい/いいえの確認ダイアログ、「削除しますか？」等）が
// 使っている #custom-confirm-modal は、style.cssの .modal-overlay 既定値
// （z-index: 1000）のままだった。
// 一方、後から追加された各種モーダル・一覧オーバーレイは、確認ダイアログより
// 手前に出す必要がある画面（商品一覧モーダル z-index:9000、保留一覧モーダル
// z-index:7000 等）が増えてきており、それらを開いた状態のまま
// showCustomConfirm()（例：自動化バーコードの「削除しますか？」、保留の
// 「この保留を削除しますか？」等）が呼ばれると、確認ダイアログが
// 一覧モーダルの「下」に描画されてしまい、ボタンが見えない・押せない
// （＝一覧側が最前面のままクリックを奪ってしまう）状態になっていた。
//
// 【この機能】
// 確認ダイアログ（#custom-confirm-modal）は「今まさにユーザーの判断を
// 待っている、最優先で割り込むべきUI」という性質上、常にどのモーダルより
// も手前（最前面）に表示されるべきなので、既存のどの追加機能モーダルよりも
// 大きいz-indexを固定で与える。
//
// index.html / ui.js / style.css は直接編集せず、DOM注入（<style>追加）
// だけで実現する（他の追加機能ファイルと同じ方式）。
// ==========================================

(function ensureConfirmModalTopmostStyle() {
    if (document.getElementById('confirm-modal-topmost-style')) return;
    const style = document.createElement('style');
    style.id = 'confirm-modal-topmost-style';
    // 今後さらに大きいz-indexのモーダルが追加される可能性も踏まえ、
    // 十分大きな値にしておく。
    style.textContent = `
        #custom-confirm-modal {
            z-index: 999999 !important;
        }
    `;
    document.head.appendChild(style);
})();
