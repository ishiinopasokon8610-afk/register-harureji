// ==========================================
// touch-panel-side-arrow-taller-and-table-badge-corner-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」（CSSの上書きのみ）で実現している。
//
// 【今回の対応（2点）】
// ① 左右のページ送り矢印ボタン（touch-panel-menu-unified-swipe-and-
// 　　side-arrows-system.js で追加した丸ボタン）を、小さい丸から、
// 　　もっと押しやすい縦長のボタンに変更した。
// ② 客用モードでメニュー画面の左下に出している「卓番◯◯」バッジを、
// 　　画面の隅（左端・下端）にぴったり張り付くように配置し、透けて
// 　　いた背景を透明度ゼロ（完全に不透明）にした。
//
// ------------------------------------------
// ① 矢印ボタンを縦長に
// ------------------------------------------
// これまでは直径56pxの円形ボタンだったが、指の腹でしっかり押せる
// ようにするため、縦長の角丸長方形に変更した。
//
// 【追記：スマホでも押しやすいようサイズ調整】
// 幅64px×高さ160pxを基本としつつ、画面幅が狭い端末（640px以下・
// 420px以下）ではメディアクエリで少し高さを抑えて画面に収まりやすく
// している。ただし「押しやすさ」に直結する幅は、狭い画面でも
// 50px以上は確保するようにした（画面端の余白も、狭い端末ではより
// 端に寄せて少しでも表示・タップ領域を稼いでいる）。
//
// ------------------------------------------
// ② 卓番バッジを画面左下の隅に張り付ける
// ------------------------------------------
// これまで touch-panel-table-reset-and-badge-position-system.js で
// left:16px（画面端から少し内側）、touch-panel-order-system.js側の
// 元のCSSで bottom:84px（客用モードの注文かごバーと重ならないよう
// 上に引き上げた位置）になっていた。
//
// 今回は「画面に張り付いている感じ」にしたいとのことなので、
// left:0・bottom:0 にして画面の角にぴったり合わせ、角丸も左下だけ
// なくして四角い隅にしている。
//
// 客用モードの注文かごバー（.tp-cart-bar）は、この卓番バッジと
// 重ならないよう、もともと left:100px から始まる位置にずらされている
// （ensureTouchPanelCartBar() 内の tp-cart-bar-shifted）。そのため
// バッジの幅さえ100pxより小さく収まっていれば、bottom:0にしても
// かごバーとは重ならない。念のため max-width を90pxに少し縮めて、
// この100pxの余白の中に確実に収まるようにしている。
//
// 背景色は、これまでの半透明（rgba(...,0.14〜0.30)）から、完全に
// 不透明な色（濃い茶色の背景＋白文字）に変更し、opacityも1にして
// 透けない見た目にしている。
//
// 【導入方法】
// index.html内で、他のタッチパネル関連ファイルより後ろ（できれば
// 一番最後）に読み込んでください。
// ==========================================

(function injectSideArrowTallerAndBadgeCornerStyle() {
    if (document.getElementById('tp-side-arrow-taller-badge-corner-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-side-arrow-taller-badge-corner-style';
    style.textContent = `
        /* ---- ① 左右矢印ボタン：丸→縦長・押しやすいサイズに ---- */
        #touch-panel-overlay .tp-unified-side-arrow {
            width: 64px !important;
            height: 160px !important;
            border-radius: 32px !important;
            font-size: 38px !important;
        }
        #touch-panel-overlay .tp-unified-side-arrow-left { left: 6px !important; }
        #touch-panel-overlay .tp-unified-side-arrow-right { right: 6px !important; }

        /* スマホ幅（横幅が狭い端末）でも指の腹でしっかり押せるよう、
           高さは画面に収まる範囲まで少し抑えつつ、幅（押しやすさに
           直結する部分）はなるべく確保する */
        @media screen and (max-width: 640px) {
            #touch-panel-overlay .tp-unified-side-arrow {
                width: 56px !important;
                height: 130px !important;
                border-radius: 28px !important;
                font-size: 34px !important;
            }
        }
        @media screen and (max-width: 420px) {
            #touch-panel-overlay .tp-unified-side-arrow {
                width: 50px !important;
                height: 104px !important;
                border-radius: 25px !important;
                font-size: 30px !important;
            }
            #touch-panel-overlay .tp-unified-side-arrow-left { left: 4px !important; }
            #touch-panel-overlay .tp-unified-side-arrow-right { right: 4px !important; }
        }

        /* ---- ② 卓番バッジ：画面左下の隅に張り付ける・不透明にする ---- */
        #touch-panel-overlay .tp-kiosk-lock-badge.tp-table-num-hidden {
            left: 0 !important;
            bottom: 0 !important;
            max-width: 90px !important;
            border-radius: 14px 14px 14px 0 !important;
            opacity: 1 !important;
        }
        #touch-panel-overlay.tp-theme-menu .tp-kiosk-lock-badge.tp-table-num-hidden {
            background: rgba(42,33,24,1) !important;
            color: #fff !important;
        }
    `;
    document.head.appendChild(style);
})();
