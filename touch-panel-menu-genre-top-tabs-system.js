// ==========================================
// touch-panel-menu-genre-top-tabs-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で、CSSの上書きのみで実現している。
// （index.html には、このファイルを読み込む <script> タグを1行追加しただけ）
//
// 【今回の目的】
// 共有していただいた実店舗のタッチパネル注文機の写真は、ジャンル
// （キッズ／冬のフェア／ハンバーグ／サイドおつまみ…）の切り替えが、
// 画面上部の“タブ”を横に並べた帯になっている。
// これまでは画面左側に、アイコン付きのボタンを縦に並べた細い帯
// （.tp-category-rail）でジャンルを切り替える作りだったため、
// 見た目をこの写真に近づけるため、ジャンル切り替えを画面「上部」の
// タブ帯（複数行に折り返す）に変更する。
//
// ・商品カード自体の見た目（写真は上、商品名・価格は下の白いエリア）は
// 　touch-panel-menu-card-clear-display-system.js で既に対応済み。
// 　このファイルは「ジャンルの切り替え方（ナビゲーション）」だけを
// 　写真に近づけるもの。
// ・写真の左側に写っている「メニュー／クーポン番号入力／注文履歴／
// 　サービス」や言語切り替えは、このタッチパネル注文システムには
// 　存在しない別画面（実店舗の別システムの一部）と思われるため、
// 　存在しない機能を新たに作ることはせず、対象外としている。
// 　もしこの部分（画面全体の左メニュー）も必要であれば、別途どんな
// 　機能にするか教えてもらえれば追加で対応可能。
//
// 【追記：タブボタンに丸みを持たせる調整】
// 各タブに角丸（border-radius）をつけた。ただし、これまでのように
// タブ同士がぴったりくっついたままだと角丸が見えないため、
// タブ間に少し隙間（gap）を空け、区切り線用に入れていた
// inset box-shadow は不要になったため削除した。
// 未選択タブは白背景、選択中タブはアクセントカラー背景＋白文字にして、
// 丸いチップ（ピル）のような見た目で選択状態が分かりやすいようにした。
// ==========================================

(function injectMenuGenreTopTabsStyle() {
    if (document.getElementById('tp-menu-genre-top-tabs-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-menu-genre-top-tabs-style';
    style.textContent = `
        /* メニュー画面本体を「左：ジャンル帯／右：商品一覧」の横並びから
           「上：ジャンル帯／下：商品一覧」の縦並びに変更する */
        #touch-panel-overlay .tp-body.tp-menu-body {
            flex-direction: column !important;
        }

        /* ジャンル帯：縦長の細い帯から、写真のように横に折り返す
           タブ帯（グリッド）に変更する */
        #touch-panel-overlay .tp-category-rail {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)) !important;
            gap: 6px !important;
            width: 100% !important;
            height: auto !important;
            max-height: none !important;
            border-right: none !important;
            border-bottom: 2px solid var(--tp-card-border) !important;
            background: var(--tp-ivory-2) !important;
            padding: 6px !important;
        }

        /* 各タブ：アイコンは写真に合わせて非表示にし、文字だけのタブにする。
           丸みを持たせ、白背景の「チップ」のような見た目にする */
        #touch-panel-overlay .tp-rail-item {
            border: none !important;
            border-radius: 14px !important;
            background: #fff !important;
            color: var(--tp-ink-soft) !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            padding: 12px 6px !important;
            box-shadow: 0 1px 2px rgba(0,0,0,0.10) !important;
        }
        #touch-panel-overlay .tp-rail-item .tp-rail-icon {
            display: none !important;
        }

        /* 選択中のタブ：アクセントカラーの背景＋白文字の丸いチップにして、
           他のタブより手前（選択中）にはっきり見えるようにする */
        #touch-panel-overlay .tp-rail-item.active {
            background: var(--tp-accent) !important;
            color: #fff !important;
            font-weight: 900 !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.18) !important;
        }
    `;
    document.head.appendChild(style);
})();
