// ==========================================
// home-automation-blocks-archive-staff-call-only-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js / home-automation-blocks.js
// を直接編集せず、他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応】
// これまで home-automation-blocks.js の「ホーム画面 → 4秒長押しで開く
// 『🏷️ 自動化バーコード一覧』」では、一覧に並んでいるブロックを
// 個別に2秒長押しすると、割引バーコード・呼び出しバーコードの区別なく
// "どれでも" アーカイブ（ホームのブロック一覧から非表示）できていた。
//
// 今回は、この長押しアーカイブの対象を
//   「🔔 店員を呼ぶ」を押したときに自動登録される呼び出しバーコード
// だけに限定する。それ以外（店員が手動で登録した割引バーコード、
// 「お冷・おしぼり」「灰皿がほしい」「その他のご用件」「💰 お会計希望」
// 「送信済みの注文」など、他のすべてのバーコード）は、今回から
// このブロック一覧での長押しではアーカイブされなくなる（長押ししても
// 反応しない・進捗バーも表示されない）。
//
// 【前提にしていること・ご確認のお願い】
// タッチパネル側（touch-panel-order-system.js）を見る限り、「🔔 店員を
// 呼ぶ」を選んだときに登録される自動化バーコードの名前（disc.name）は、
//     `${reason.icon} ${reason.label}です${tableLabelForTouchPanel()}`
// という形で作られており、店員を呼ぶ（key:'staff'）の場合は
//   icon = '🔔' , label = '店員を呼ぶ'
// なので、名前は必ず「🔔 店員を呼ぶです…」から始まる。
// 同じ呼び出しメニュー内の他の用件（お冷・おしぼり／灰皿がほしい／
// その他のご用件）は icon・labelがそれぞれ異なるため「🔔」と
// 「店員を呼ぶ」が両方は含まれず、また「💰 お会計希望です…」や、
// 店員が自由に付ける割引バーコードの名前（例：「缶ビール1本＋10%オフ」）
// にもこの組み合わせが偶然含まれる可能性は低いと判断し、
// 「名前に '🔔' と '店員を呼ぶ' の両方を含むかどうか」で判定している。
// もし店員が独自に登録する割引バーコードの名前にたまたまこの組み合わせ
// を使っていて誤判定される、あるいは逆に判定方法をもっと厳密にしたい、
// という場合は教えてもらえれば調整する。
//
// 【導入方法】
// index.html内で、home-automation-blocks.js の後ろにこのファイルを
// 読み込んでください。
//   <script src="home-automation-blocks.js"></script>
//   <script src="home-automation-blocks-archive-staff-call-only-system.js"></script>
// ==========================================

// 「🔔 店員を呼ぶ」を押したときに登録された自動化バーコードかどうかを判定する
function tpIsStaffCallAutomationBarcode(disc) {
    if (!disc || typeof disc.name !== 'string') return false;
    return disc.name.includes('🔔') && disc.name.includes('店員を呼ぶ');
}

(function hookAttachBlockArchiveLongPressForStaffCallOnly() {
    function tryHook() {
        if (typeof window.attachBlockArchiveLongPress !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.attachBlockArchiveLongPress;
        window.attachBlockArchiveLongPress = function (blockEl, index) {
            const disc = (typeof discountBarcodes !== 'undefined' && Array.isArray(discountBarcodes))
                ? discountBarcodes[index]
                : null;

            if (!tpIsStaffCallAutomationBarcode(disc)) {
                // 対象外のバーコード：長押しアーカイブの当たり判定自体を
                // 付けない。「長押しできそうに見えるのに反応しない」と
                // 誤解されないよう、進捗表示用の赤いバー（下端の帯）も
                // あらかじめ消しておく。
                const bar = blockEl.querySelector('.home-automation-block-archive-bar');
                if (bar) bar.style.display = 'none';
                return;
            }

            // 「🔔 店員を呼ぶ」のバーコードは、これまで通りの
            // 長押し（2秒）→アーカイブの動作をそのまま使う。
            original(blockEl, index);
        };
    }
    tryHook();
})();
