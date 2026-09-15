// ==========================================
// touch-panel-table-number-80-and-bigger-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応（2点）】
// ① 卓番（テーブル番号）選択の最大数を、これまでの50卓から80卓に拡大した。
// ② 卓番ボタンを、以前の対応（touch-panel-table-number-buttons-larger-system.js
//    で4列・数字20→24pxにした対応）よりも、さらに大きくした。
//
// ------------------------------------------
// ① 80卓への拡大について
// ------------------------------------------
// 卓番の最大数は touch-panel-order-system.js 内で
//     const TOUCH_PANEL_TABLE_COUNT = 50;
// という定数で決まっており、卓番グリッドを描画する renderTouchPanelTableGrid()
// の中の for (let i = 1; i <= TOUCH_PANEL_TABLE_COUNT; i++) でそのまま
// 使われている。この定数は const 宣言で、かつ他ファイルから差し替える
// 仕組みが用意されていないため、値そのものを外から変えることができない
// （index.html / touch-panel-order-system.js を直接編集しない方針のため）。
//
// そのため renderTouchPanelTableGrid() を丸ごと置き換えるのではなく、
// 元の関数をそのまま呼び出して1〜50卓分は今まで通り描画させたうえで、
// 51〜80卓分のボタンだけを、同じ見た目・同じ処理（使用中判定／タップ時の
// 動作）で追加描画する方式にした。ボタンのHTML・onclickの中身は、
// renderTouchPanelTableGrid()内の元のコードと完全に同じにしてあるので、
// 見た目や動作の差は生じない。
//
// ------------------------------------------
// ② ボタンをさらに大きくすることについて
// ------------------------------------------
// これまで4列（狭い端末では3列）にしていたところを、3列（狭い端末では
// 2列）まで減らし、文字サイズ・ボタン間の余白もあわせて拡大した。
// 列を減らした分、80卓すべてを表示するにはこれまで以上に縦スクロールが
// 必要になるが、.tp-body側で元々スクロールできるようになっているため、
// 動作上の問題はない（押しやすさ・見やすさを優先）。
// ※「目立たないくらいに大きく」とのことだったが、文脈から「目立つくらい
// 大きく」という意図と判断して対応した。もし逆の意図であれば教えてほしい。
//
// このファイルは touch-panel-table-number-buttons-larger-system.js より
// 後ろに読み込む前提（同じ箇所へのCSS上書きのため、後から読み込んだ
// このファイルの数値が優先される）。
//
// 【導入方法】
// index.html内で、touch-panel-table-number-buttons-larger-system.js の
// 後ろにこのファイルを読み込んでください。
//   <script src="touch-panel-table-number-buttons-larger-system.js"></script>
//   <script src="touch-panel-table-number-80-and-bigger-system.js"></script>
// ==========================================

/* =========================================================
   ① 卓番を80まで拡大
   ========================================================= */
const TOUCH_PANEL_TABLE_COUNT_EXTENDED = 80; // 50 → 80

(function hookRenderTouchPanelTableGridForMoreTables() {
    function tryHook() {
        if (typeof window.renderTouchPanelTableGrid !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelTableGrid;
        window.renderTouchPanelTableGrid = function (...args) {
            const result = original.apply(this, args);

            const grid = document.getElementById('tp-table-grid');
            if (!grid) return result;

            const existingCount = grid.querySelectorAll('.tp-table-cell').length;
            if (existingCount >= TOUCH_PANEL_TABLE_COUNT_EXTENDED) return result;

            const occupiedTables = (typeof getOccupiedTouchPanelTables === 'function')
                ? getOccupiedTouchPanelTables()
                : new Set();
            const isCustomerMode = (typeof touchPanelState !== 'undefined')
                ? touchPanelState.mode !== 'staff'
                : true;

            let extraHtml = '';
            for (let i = existingCount + 1; i <= TOUCH_PANEL_TABLE_COUNT_EXTENDED; i++) {
                const occupied = occupiedTables.has(i);
                let onclickAttr;
                if (occupied && isCustomerMode) {
                    onclickAttr = `tpNotifyTableOccupied(${i})`;
                } else if (occupied) {
                    onclickAttr = `tpStaffPickOccupiedTable(${i})`;
                } else {
                    onclickAttr = `selectTouchPanelTable(${i})`;
                }
                extraHtml += `
                    <button class="tp-table-cell ${occupied ? 'occupied' : ''}" data-table="${i}" onclick="${onclickAttr}">
                        <span class="tp-table-cell-num">${i}</span>
                        ${occupied ? '<span class="tp-table-cell-tag">使用中</span>' : ''}
                    </button>`;
            }
            grid.insertAdjacentHTML('beforeend', extraHtml);

            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ② 卓番ボタンをさらに大きく
   ========================================================= */
(function injectTableNumberButtonsEvenLargerStyle() {
    if (document.getElementById('tp-table-number-buttons-even-larger-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-table-number-buttons-even-larger-style';
    style.textContent = `
        #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers {
            grid-template-columns: repeat(3, 1fr) !important;
            max-width: 1040px !important;
            gap: 18px !important;
        }
        #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers .tp-table-cell-num {
            font-size: 32px !important;
        }

        /* 画面の狭い端末では、3列だとまだ小さく感じる場合があるため
           さらに2列にして、ボタンの大きさを優先する */
        @media screen and (max-width: 640px) {
            #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers {
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 14px !important;
            }
            #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers .tp-table-cell-num {
                font-size: 28px !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
