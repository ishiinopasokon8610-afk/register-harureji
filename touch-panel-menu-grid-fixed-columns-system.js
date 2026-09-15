// ==========================================
// touch-panel-menu-grid-fixed-columns-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で、CSSの上書きのみで実現している。
// （index.html には、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の目的】
// 商品メニューのボタン配置は、店員側で最大10列×10行（10×10）まで
// 自由に組めるようになっている想定。
// これまでの touch-panel-order-system.js 側のCSSは
//   grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
// となっており、これは「1マスにつき最低140pxは確保する」という指定のため、
// 画面幅が狭い場合や商品数が多い場合、確保できる列数がどんどん減っていき、
// 最終的には1列（＝見た目が縦一列のリストのような表示）になってしまうことがある。
//
// これでは店員が意図して組んだ「10×10」の配置が崩れてしまうため、
// 列数そのものは減らさない（＝縦表示にはしない）ようにし、その代わりに
// ボタン1つあたりの幅を必要なだけ小さくする、という挙動に変更する。
//
// 【前提にしていること・ご確認のお願い】
// 「10×10」を、常に固定で横10列として扱うようにした（列数を可変にする
// 設定項目は現状のコード内には見当たらなかったため）。
// もし実際には店員側の設定画面などで列数自体を変更できるようになって
// いる（例：ジャンルによって8列にする、など）場合は、その列数がどの
// 変数・data属性に入っているか教えてください。固定の10ではなく、
// その値を使って列数を決めるように修正する。
// ==========================================

(function injectMenuGridFixedColumnsStyle() {
    if (document.getElementById('tp-menu-grid-fixed-columns-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-menu-grid-fixed-columns-style';
    style.textContent = `
        /* 列数は常に10列で固定。画面幅や商品数に応じて列数を減らす
           （＝縦に積み上がっていく）のではなく、1マスの幅の方を
           小さくすることで10列を維持する。 */
        #touch-panel-overlay .tp-menu-grid {
            grid-template-columns: repeat(10, 1fr) !important;
        }

        /* 店員がスマホ等かなり画面幅の狭い端末で確認する場合だけ、
           ボタンが小さくなりすぎて押しにくくならないよう5列に緩和する
           （このときも1列＝縦表示にはしない）。 */
        @media screen and (max-width: 480px) {
            #touch-panel-overlay .tp-menu-grid {
                grid-template-columns: repeat(5, 1fr) !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
