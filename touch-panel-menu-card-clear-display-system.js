// ==========================================
// touch-panel-menu-card-clear-display-system.js
// ------------------------------------------
// このファイルは index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で、CSSの上書きのみで実現している。
// （index.html には、このファイルを読み込む <script> タグを1行追加しただけ）
//
// 【今回の目的】
// 共有していただいた実店舗のタッチパネル注文機の写真と同じように、
// どのジャンル（メニュー／キッズ／ハンバーグ／サイドおつまみ…どれを
// 選んでも）商品カードが
//   ・写真はカード上部に、切れずにきれいに収まる
//   ・商品名と価格は、写真の下の「白いエリア」に濃い色でくっきり表示
// という、見やすく統一されたデザインになるようにする。
//
// これまでは商品写真の上に商品名・価格を半透明の黒いグラデーションで
// 重ねて表示していたため、写真によっては文字が読みにくいことがあった。
// 今回、写真エリアと文字エリアを完全に分けることで、どんな写真でも
// 商品名・価格がはっきり読めるようにする。
//
// 対象は .tp-menu-card（通常のグリッド表示と、「すべて」表示時の
// ジャンル別横スクロール帯の両方で共通して使われているクラスなので、
// ここを直せば全ジャンルの表示に反映される）と、メニュー画面上部の
// 「本日のおすすめ」横スクロールバナー（.tp-banner-card）。
//
// なお、写真を見切れさせず収める設定（cover→contain）は既存の
// touch-panel-photo-fit-and-idle-screensaver-system.js でも行われて
// いるが、このファイル単体でも同じ設定を含めているため、読み込み順に
// 関わらず単独で正しく動作する。
// ==========================================

(function injectMenuCardClearDisplayStyle() {
    if (document.getElementById('tp-menu-card-clear-display-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-menu-card-clear-display-style';
    style.textContent = `
        /* ---- 写真エリア：白背景の上に、切れずに収まる形で表示 ---- */
        #touch-panel-overlay .tp-menu-card,
        #touch-panel-overlay .tp-banner-card {
            background-color: #fff !important;
            background-size: contain !important;
            background-repeat: no-repeat !important;
            background-position: center top !important;
            border: 1px solid var(--tp-card-border) !important;
        }

        /* カード全体の縦横比：写真＋商品名2行＋価格が余裕をもって
           収まるよう、正方形に近い比率から少し縦長にする */
        #touch-panel-overlay .tp-menu-card {
            aspect-ratio: 3 / 4 !important;
        }
        /* おすすめバナーは横長カードのまま、高さだけ少しゆとりを持たせる */
        #touch-panel-overlay .tp-banner-card {
            height: 150px !important;
        }

        /* ---- 商品名・価格エリア：写真に重ねる黒グラデーションをやめ、
           白背景＋濃い色文字にしてはっきり読めるようにする ---- */
        #touch-panel-overlay .tp-menu-card-info,
        #touch-panel-overlay .tp-banner-card-info {
            background: #fff !important;
            padding: 8px 10px 10px !important;
            border-top: 1px solid var(--tp-card-border) !important;
        }
        #touch-panel-overlay .tp-menu-card-name,
        #touch-panel-overlay .tp-banner-card-name {
            color: var(--tp-ink) !important;
            font-size: 14px !important;
            font-weight: 800 !important;
            line-height: 1.35 !important;
            /* 長い商品名は3行目以降を省略し、カードの高さを揃える */
            display: -webkit-box !important;
            -webkit-line-clamp: 2 !important;
            -webkit-box-orient: vertical !important;
            overflow: hidden !important;
        }
        #touch-panel-overlay .tp-menu-card-price,
        #touch-panel-overlay .tp-banner-card-price {
            color: var(--tp-accent) !important;
            font-size: 14px !important;
            font-weight: 900 !important;
            margin-top: 3px !important;
        }

        /* カード同士の余白を少し広げ、境目を分かりやすくする */
        #touch-panel-overlay .tp-menu-grid {
            gap: 16px !important;
        }
    `;
    document.head.appendChild(style);
})();
