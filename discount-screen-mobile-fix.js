// ==========================================
// discount-screen-mobile-fix.js
// ------------------------------------------
// 【背景】
// 自動化バーコード作成画面（登録フォーム／一覧）は、テーブル→カード化など
// スマホ幅への基本的な対応はすでに入っていたが、以下の点がスマホ縦画面だと
// 窮屈・使いにくいままだった。
//
//   ① バーコード入力欄＋「📷 カメラで読取」ボタンが常に横並びのため、
//      狭い画面だとボタンの文字が詰まったり、入力欄が極端に狭くなる。
//   ② 「自動追加する商品」の商品選択（検索欄／商品一覧ボタン。前回追加分の
//      product-picker-search-system.js / product-picker-block-system.js）が
//      JS側で min-width:220px を直接指定しているため、数量欄・追加ボタンと
//      3つ横に並ぼうとして詰まる。
//   ③ 一部の入力欄（数量・値引き値など）がfont-size 15pxのままで、
//      iOS Safariではタップ時に画面が自動的にズームされてしまう
//      （font-size 16px未満のinputにタップした際の既知の挙動）。
//   ④ ボタン・チェックボックスのタップ領域が小さめで、指での誤タップが起きやすい。
//   ⑤ ホーム長押しオーバーレイ／「商品一覧」選択モーダルのカード幅が
//      固定気味で、幅の狭いスマホ（〜400px）だと少し窮屈。
//
// 【実装方針】
// style.css / custom-styles.css / index.html は一切直接編集せず、
// <head>内に<style>タグを1つ追加注入するだけで対応する
// （他の追加機能ファイルと同じ「フック/DOM注入方式」。
//  同じ理由でJSが組み立てているinline styleを上書きする必要がある箇所は
//  !importantを使う＝外部スタイルシートのimportantはinline styleより優先される）。
// ==========================================

(function injectDiscountMobileFixStyles() {
    if (document.getElementById('discount-mobile-fix-style')) return;

    const style = document.createElement('style');
    style.id = 'discount-mobile-fix-style';
    style.textContent = `
    /* ③ iOSでinputタップ時に勝手に拡大されるのを防ぐ
          （フォームのinput/selectを一律16px以上にする） */
    @media screen and (max-width: 700px) {
        #discount-screen input,
        #discount-screen select,
        #edit-disc-modal input,
        #edit-disc-modal select {
            font-size: 16px !important;
        }
    }

    /* ① バーコード入力＋カメラ読取ボタン：狭い画面では縦積みにする */
    @media screen and (max-width: 480px) {
        .discount-barcode-input-wrap {
            flex-wrap: wrap;
        }
        .discount-barcode-input-wrap input {
            flex: 1 1 100%;
        }
        .discount-camera-btn {
            flex: 1 1 100%;
            padding: 12px 14px;
        }
    }

    /* ② 「自動追加する商品」行：検索欄／商品一覧ボタン（JS注入分含む）・
          数量欄・追加ボタンを、無理に横へ並べず縦積みにする */
    @media screen and (max-width: 480px) {
        .discount-product-picker {
            flex-direction: column;
            align-items: stretch;
        }
        .product-picker-wrapper {
            min-width: 0 !important;
            width: 100% !important;
        }
        .discount-qty-input {
            width: 100% !important;
            box-sizing: border-box;
        }
        .discount-product-picker .discount-add-btn {
            width: 100%;
        }
    }

    /* ④ ボタン・チェックボックスのタップ領域を広げる（誤タップ防止） */
    @media screen and (max-width: 700px) {
        .discount-submit-btn,
        .discount-camera-btn,
        .discount-add-btn,
        .discount-product-picker button {
            min-height: 44px;
        }
        .discount-step-checkbox-label input[type="checkbox"] {
            width: 24px;
            height: 24px;
        }
        /* 一覧（カード形式）内の操作ボタンも押しやすいサイズに */
        #discount-screen .data-table td button {
            min-height: 38px;
            padding: 6px 12px;
        }
    }

    /* ⑤ ホーム長押しオーバーレイ／「商品一覧」選択モーダルのカード幅を、
          幅の狭いスマホ（〜400px）でも綺麗に2列で折り返るよう縮める */
    @media screen and (max-width: 400px) {
        .home-automation-block {
            width: 47% !important;
            min-width: 0 !important;
        }
        #product-block-picker-body div[style*="grid-template-columns"] {
            grid-template-columns: repeat(auto-fill, minmax(46%, 1fr)) !important;
        }
        .order-checkout-home-block {
            width: 100% !important;
        }
    }
    `;
    document.head.appendChild(style);
})();
