// ==========================================
// home-screen-mobile-fix.js
// ------------------------------------------
// 【背景】
// ホーム画面（客用画面を開く／会計スタート／各種管理画面などのボタンが
// 並ぶ最初の画面）は、幅700px以下では .home-grid が1列になるよう
// すでに対応済みだった（style.css 425〜461行目あたり）。
//
// しかし .home-btn には white-space: nowrap が指定されており、
// 「👥 会員・顧客管理 (ポイント・情報)」「📁 レシート保存フォルダを設定する
// （自動保存対応）」のような長いラベルのボタンは折り返せない。
// さらにCSS Gridのアイテムはデフォルトで min-width:auto（＝中身の最小幅より
// 縮められない）ため、この「折り返せない長いテキスト」がそのままグリッドの
// 列幅を押し広げてしまい、スマホを縦向きにした時（幅375〜430px程度）に
// ボタンがはみ出す／画面が横スクロールしてしまう、という不具合になっていた。
//
// 【この機能】
// style.css / index.html は直接編集せず、<head>内に<style>タグを1つ
// 追加注入するだけで、
//   ・ .home-btn のテキストを折り返し可能にする（white-space: normal）
//   ・ グリッドアイテム／グリッド列の最小幅を0にして、テキストが列幅を
//     押し広げないようにする（min-width:0 / grid-template-columns の
//     track を minmax(0, 1fr) に）
//   ・ 縦画面の狭い幅でも読みやすいよう、文字サイズ・余白を少し詰める
//   ・ 店長認証ボタン等、右上に固定表示されるボタン類も少し小さくする
// を行う（他の追加機能ファイルと同じ「フック/DOM注入方式」）。
// ==========================================

(function injectHomeScreenMobileFixStyles() {
    if (document.getElementById('home-screen-mobile-fix-style')) return;

    const style = document.createElement('style');
    style.id = 'home-screen-mobile-fix-style';
    style.textContent = `
    /* ===== スマホ縦画面（幅700px以下）：ボタンのはみ出しを解消 ===== */
    @media screen and (max-width: 700px) {
        .home-grid {
            /* 各列の最小幅を0にすることで、中の文字（nowrap指定分）が
               列幅を押し広げるのを防ぐ（横スクロール／はみ出しの根本原因） */
            grid-template-columns: minmax(0, 1fr) !important;
            width: 96% !important;
            gap: 10px !important;
        }
        .home-btn {
            /* 折り返せるようにする（長いラベルのボタン対策） */
            white-space: normal !important;
            /* グリッドアイテムのデフォルト min-width:auto を打ち消す */
            min-width: 0 !important;
            width: 100%;
            box-sizing: border-box;
            padding: 14px 10px !important;
            font-size: 16px !important;
            line-height: 1.4;
            word-break: break-word;
        }
        .home-btn.large {
            font-size: 18px !important;
        }
        .home-header {
            flex-wrap: wrap;
        }
    }

    /* ===== さらに幅の狭いスマホ（〜420px）向けの追加調整 ===== */
    @media screen and (max-width: 420px) {
        .home-btn {
            font-size: 14px !important;
            padding: 12px 8px !important;
        }
        .home-btn.large {
            font-size: 16px !important;
        }
        /* 右上固定の店長認証ボタン・左上固定の担当者表示も、狭い画面では
           少し小さくしてボタン列と重ならないようにする */
        .manager-lock-btn {
            top: 8px;
            right: 8px;
            padding: 6px 10px;
            font-size: 12px;
        }
        #auth-status-display {
            font-size: 12px;
        }
    }
    `;
    document.head.appendChild(style);
})();
