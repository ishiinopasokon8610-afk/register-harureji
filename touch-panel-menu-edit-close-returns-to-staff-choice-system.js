// ==========================================
// touch-panel-menu-edit-close-returns-to-staff-choice-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回直したいこと】
// 客用画面の脱出防止バッジ（画面隅の小さなバッジ）を長押し→暗証番号
// →「🔒 店員確認OK どちらの操作をしますか？」画面（openTouchPanelKioskActionChoice()）
// →「🖼️ メニュー変更（背景・商品写真）」を選ぶと、設定画面
// （openTouchPanelBgSettingModal()）が開く。
//
// これまでは、この「メニュー変更」画面の×（closeTouchPanelBgSettingModal()）
// を押すと、そのままお客様の画面（ロック中のメニュー画面）まで戻って
// しまっていた。そのため、続けて別の商品の写真も直したい・もう一度
// 何か設定したい、という場合に、毎回バッジ長押し→暗証番号入力から
// やり直す必要があり、店員にとって手間だった。
//
// 【今回の対応】
// 「メニュー変更」画面を閉じた（×を押した／背景をタップした）際に、
// お客様の画面まで戻さず、一つ前にいた「どちらの操作をしますか？」
// 画面（openTouchPanelKioskActionChoice()）を出し直すようにした。
// これにより、
//   ・続けて「🖼️ メニュー変更」を選べば、暗証番号なしですぐにまた
//     設定画面に戻れる
//   ・本当に終了してお客様の画面に戻したい場合は、この
//     「どちらの操作をしますか？」画面自身の×（closeTouchPanelKioskActionChoice()）
//     を押せばよい（これは元々あった動作のまま変更していない）
// という形になり、「×を押すまで、直前にいじっていた店員用の画面が
// 表示され続ける」という状態になる。
//
// なお、closeTouchPanelBgSettingModal() には元々「メニュー画面が表示中
// であれば再描画して、変更した写真をすぐに反映させる」という処理が
// 入っており、これはそのまま活かした上で（＝先に元の関数を呼んでから）
// 「どちらの操作をしますか？」画面を出し直している。
//
// 【前提にしていること】
// closeTouchPanelBgSettingModal() は、「メニュー変更」画面の×ボタンと
// 背景タップの2箇所からしか呼ばれておらず、他の用途（例えば店員用
// モード側の簡易背景設定 openTouchPanelBgSettingPrompt() など）では
// 使われていないことを確認済み。そのため、この関数を上書きしても、
// 「メニュー変更」画面を閉じる場面以外に影響は出ない。
//
// 【導入方法】
// index.html内で、touch-panel-order-system.js より後ろであれば
// どこでも構わない。
// ==========================================

(function () {
    'use strict';

    function tryHook() {
        if (typeof window.closeTouchPanelBgSettingModal !== 'function' || typeof window.openTouchPanelKioskActionChoice !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        const original = window.closeTouchPanelBgSettingModal;
        window.closeTouchPanelBgSettingModal = function (...args) {
            // まず元の処理（モーダルを消す・メニュー画面の再描画）はそのまま行う
            const result = original.apply(this, args);

            // タッチパネル自体がまだ開いていれば、一つ前の
            // 「どちらの操作をしますか？」画面を出し直す
            // （お客様の画面までは戻さない。そちらへ戻すのは、この
            // 画面自身の×が押された時だけ）
            const overlay = document.getElementById('touch-panel-overlay');
            if (overlay) {
                openTouchPanelKioskActionChoice();
            }

            return result;
        };
    }
    tryHook();
})();
