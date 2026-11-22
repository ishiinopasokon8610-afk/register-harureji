// ==========================================
// touch-panel-variation-ui-fix-system.js
// タッチパネルの「バリエーション（サイズ・種類）」まわりが、スマホ（幅の狭い・高さの低い画面）で
// 押しつぶされて見える点を直す（見た目だけ。動作は変えない）。
//  ・商品の詳細（下から出る窓）：中身が縮められないようにし、窓の中でスクロールできるようにする
//  ・サイズ・種類のボタン：つぶれず、文字が折れずに、指で押しやすい大きさにする
//  ・店員用の設定ボタン（🔀バリエーション設定 など）：小さい画面でも文字が切れず、折り返して並ぶ
// ==========================================
(function () {
    'use strict';
    if (document.getElementById('tp-variation-ui-fix-style')) return;
    const st = document.createElement('style');
    st.id = 'tp-variation-ui-fix-style';
    st.textContent = `
#touch-panel-overlay .tp-item-modal { display: block !important; overflow-y: auto !important; -webkit-overflow-scrolling: touch; max-height: 92vh; max-height: 92dvh; box-sizing: border-box; }
#touch-panel-overlay .tp-item-modal > *, #touch-panel-overlay .tp-item-modal-body > * { flex-shrink: 0; }
#touch-panel-overlay .tp-item-modal-photo { flex: none !important; height: 180px; min-height: 180px; }
#touch-panel-overlay .tp-item-modal-body { padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)); }
#touch-panel-overlay .tp-modal-variations { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; align-items: stretch; }
#touch-panel-overlay .tp-modal-variations .tp-chip { flex: 0 0 auto !important; min-height: 42px; white-space: nowrap; line-height: 1.2; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; }
#touch-panel-overlay .tp-chip { flex-shrink: 0; }
#touch-panel-overlay .tp-cart-row-variation { white-space: normal; word-break: break-word; }
#touch-panel-overlay .tp-btn { white-space: normal; line-height: 1.3; min-height: 40px; box-sizing: border-box; }
@media (max-height: 520px) {
  #touch-panel-overlay .tp-item-modal { max-height: 98vh; max-height: 98dvh; }
  #touch-panel-overlay .tp-item-modal-photo { height: 110px; min-height: 110px; }
}
@media (max-width: 420px) {
  #touch-panel-overlay .tp-item-modal-body { padding-left: 14px; padding-right: 14px; }
  #touch-panel-overlay .tp-modal-variations .tp-chip { padding: 8px 14px; font-size: 14px; }
}

/* --- 追加補強：スマホで押しつぶされる対策（高さを画面いっぱいに使い、中身を縮めない） --- */
#touch-panel-overlay #tp-item-modal-root { height: 100% !important; align-items: flex-end !important; }
#touch-panel-overlay .tp-item-modal { width: 100% !important; max-width: min(480px, 100vw) !important; max-height: calc(100vh - 8px) !important; max-height: calc(100dvh - 8px) !important; min-height: 0 !important; overflow-y: auto !important; overscroll-behavior: contain; }
#touch-panel-overlay .tp-item-modal-body, #touch-panel-overlay .tp-item-modal-photo, #touch-panel-overlay .tp-modal-section-label, #touch-panel-overlay .tp-modal-variations, #touch-panel-overlay .tp-qty-stepper { flex-shrink: 0 !important; min-height: 0; }
#touch-panel-overlay .tp-item-modal-name, #touch-panel-overlay .tp-item-modal-desc, #touch-panel-overlay .tp-item-modal-price { overflow: visible !important; height: auto !important; white-space: normal; word-break: break-word; }
#touch-panel-overlay .tp-qty-stepper button { flex: 0 0 40px; min-width: 40px; }
@media (max-height: 480px) {
  #touch-panel-overlay .tp-item-modal-photo { display: none !important; }
  #touch-panel-overlay .tp-item-modal-body { padding-top: 10px; }
  #touch-panel-overlay .tp-modal-variations .tp-chip { min-height: 38px; padding: 6px 12px; }
}
`;
    document.head.appendChild(st);
})();
