// ==========================================
// bg-setting-modal-filter-fix.js
// ------------------------------------------
// 【不具合】
// 「🖼️ メニュー変更」画面（お知らせ文言／タッチパネルの背景／商品ごとの
// 写真をまとめて設定する画面）で、お知らせ文言を保存すると、その文字列が
// 下にある「商品ごとの写真」の絞り込み検索欄にも勝手に反映されてしまう。
//
// 【原因】
// touch-panel-order-system.js の tpCurrentBgSettingFilterValue() が、
//     document.querySelector('#tp-bg-setting-root input[type="text"]')
// という「type="text"の最初の1つ」を取得するセレクタになっている。
// このモーダルには type="text" の入力欄が
//   ① お知らせ・キャンペーン文言欄（#tp-promo-text-input）
//   ② 背景画像のURL入力欄（#tp-bg-url-input）
//   ③ 商品名で絞り込み欄（本来この関数が取得したい欄）
// と3つあり、querySelectorは常にDOM順で一番上の①を返してしまう。
// そのため、お知らせ文言を保存した際の再描画
//   renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue())
// で、①の値（お知らせ文言）が③の検索欄の初期値として渡ってしまっていた。
// （背景の削除・URL設定・商品写真のアップロード等、再描画を伴う他の
// 操作でも同じ関数を使っているため、同様に誤動作しうる状態だった。）
//
// 【この修正】
// tpCurrentBgSettingFilterValue() を、DOM順ではなく
// 「oninput="renderTouchPanelBgSettingModal(...)" が指定された入力欄」
// を確実に狙って取得するよう置き換える。この属性を持つのは③の絞り込み
// 欄だけなので、①②を誤って拾うことがなくなる。
//
// index.html / touch-panel-order-system.js は直接編集せず、
// 既存のグローバル関数を安全な実装で上書きするだけの、他の追加機能
// ファイルと同じ方針で実現する。
//
// 【導入方法】
// index.html内で、touch-panel-order-system.js の後ろに
// このファイルを読み込んでください。
//   <script src="touch-panel-order-system.js"></script>
//   <script src="bg-setting-modal-filter-fix.js"></script>
// ==========================================

(function fixBgSettingModalFilterValue() {
    function tryPatch() {
        if (typeof window.tpCurrentBgSettingFilterValue !== 'function') {
            setTimeout(tryPatch, 300);
            return;
        }
        window.tpCurrentBgSettingFilterValue = function () {
            const root = document.getElementById('tp-bg-setting-root');
            if (!root) return '';

            // 本来狙いたい「商品名で絞り込み」欄は、oninputでこの関数自身を
            // 呼んでいる唯一の入力欄なので、それを目印に特定する。
            let input = root.querySelector('input[type="text"][oninput*="renderTouchPanelBgSettingModal"]');

            // 万一見つからない場合（将来の仕様変更等）に備え、その場合だけ
            // 「お知らせ欄」「背景URL欄」を除いた中から探す保険を用意する
            // （完全に見つからなければ従来通り空文字を返す＝安全側に倒す）。
            if (!input) {
                const candidates = Array.from(root.querySelectorAll('input[type="text"]'))
                    .filter(el => el.id !== 'tp-promo-text-input' && el.id !== 'tp-bg-url-input');
                input = candidates[0] || null;
            }

            return input ? input.value : '';
        };
    }
    tryPatch();
})();
