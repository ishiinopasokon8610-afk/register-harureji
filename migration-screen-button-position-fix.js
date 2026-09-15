// ==========================================
// migration-screen-button-position-fix.js
// ------------------------------------------
// このファイルも index.html を直接編集せず、他の追加機能ファイルと同じ
// 「フック方式」で、CSSの上書きのみで実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応】
// 「データ管理・ロゴ設定」画面（#migration-screen）の中の各項目
// （📸 ロゴ登録／🖼️ 背景登録／💾 バックアップ／🚨 商品・履歴データの初期化／
// 🖼️ お会計完了時に表示する画像／🖥️ 客用ディスプレイ指定／
// 🔑 店長認証バーコード変更）それぞれに含まれるボタン（.btn-migration）を、
// 説明文・入力欄との間が開きすぎないよう、少し上に詰めた。
//
// 【ご確認のお願い】
// 実際の余白（margin/padding）の指定は style.css / custom-styles.css
// 側にあり、その中身をこちらで確認できていないため、ここではボタンに
// マイナスのmargin-topを付けることで、見た目の間隔だけを詰めている。
// これで「まだ間隔が空いている／詰めすぎ」という場合は、下の -10px
// という数値を教えてもらえれば（例：-18pxでもっと詰める、-4pxで
// 少しだけにする、など）調整する。
// ==========================================

(function injectMigrationButtonPositionStyle() {
    if (document.getElementById('migration-button-position-style')) return;
    const style = document.createElement('style');
    style.id = 'migration-button-position-style';
    style.textContent = `
        #migration-screen .btn-migration {
            margin-top: -10px !important;
        }
    `;
    document.head.appendChild(style);
})();
