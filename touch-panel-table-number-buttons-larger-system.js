// ==========================================
// touch-panel-table-number-buttons-larger-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で、CSSの上書きのみで実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応】
// 卓番（テーブル番号）を選ぶ画面のボタンが小さいとのことだったので、
// 大きくした。
//
// 卓番選択は最大50卓分のボタンを並べる想定になっており、これまでは
// 画面に収まりやすくするため5列・やや小さめ（数字は20px）にしていた
// （.tp-table-grid-numbers）。これを4列（画面の狭い端末ではさらに
// 3列）に減らし、1つ1つのボタンの面積そのものを大きくした。
// ボタンは正方形（aspect-ratio: 1/1）を保ったままなので、横幅が
// 増えた分、縦（高さ）も同じだけ大きくなる。
// 列を減らした分、50卓すべてを表示するには今まで以上に縦スクロールが
// 必要になるが、.tp-body側で元々スクロールできるようになっているため、
// 動作上の問題はない（押しやすさを優先した）。
//
// 人数選択（何人ですか）の丸いボタンの方（.tp-table-grid、
// -numbersが付かない方）は、元々列数が少なく大きめだったため、
// 今回は変更していない。
// ==========================================

(function injectTableNumberButtonsLargerStyle() {
    if (document.getElementById('tp-table-number-buttons-larger-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-table-number-buttons-larger-style';
    style.textContent = `
        #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers {
            grid-template-columns: repeat(4, 1fr) !important;
            max-width: 980px !important;
            gap: 14px !important;
        }
        #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers .tp-table-cell-num {
            font-size: 24px !important;
        }

        /* 画面の狭い端末では、4列だとまだ小さく感じる場合があるため
           さらに3列にして、ボタンの大きさを優先する */
        @media screen and (max-width: 640px) {
            #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers {
                grid-template-columns: repeat(3, 1fr) !important;
                gap: 10px !important;
            }
            #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers .tp-table-cell-num {
                font-size: 21px !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
