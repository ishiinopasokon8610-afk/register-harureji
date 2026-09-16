// ==========================================
// product-variant-bulk-add-system.js
// ------------------------------------------
// このファイルも product-variant-system.js / index.html を直接編集せず、
// 他の追加機能ファイルと同じ「フック/DOM注入方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【背景】
// 商品管理画面「🎨 バリエーション設定」の編集画面では、選択肢
// （S・M・Lなど）を「＋ 選択肢を追加」ボタンで1行ずつ増やし、1つずつ
// 入力する形になっていた。バリエーションの数が多い商品（例：シールの
// 絵柄違いが10種類以上あるなど）では、1件ずつボタンを押して入力する
// 手間が大きかった。
//
// 【今回の変更】
// product-variant-system.js が「質問（グループ）を複数追加できる」
// 構成にリニューアルされたのに合わせて、このファイルも対応させた。
//   ・以前は編集画面全体に1つだけあった「＋ 選択肢を追加」ボタンの横に
//     「📋 まとめて追加」を差し込んでいたが、今は質問（サイズ／トッピング
//     など）が複数存在しうるため、質問ブロックが作られるたびに、その
//     ブロック内の「＋ 選択肢を追加」ボタンの横に個別に差し込むように
//     変更した（addProductVariantQuestionBlock() をフックして対応）。
//   ・価格の指定方法が「絶対価格」から「基本価格に対する＋／－の差額」に
//     変わったため、まとめて追加のテキスト欄の記法も合わせて変更した。
//       例：
//         普通            → 差額なし
//         中盛,+50        → ＋50円
//         小盛,-50        → －50円
//     （末尾が「,数字」で符号が無い場合も「+」扱いにする＝そのまま
//     　値上げとして解釈する。符号を付け忘れても意図通りになりやすい
//     　ようにするための配慮）
//
// 既存の「＋ 選択肢を追加」ボタン・1件ずつの手動入力も、これまで通り
// 使える（まとめて追加した後に、個別の行を直接編集・削除することも可能）。
//
// 【前提にしていること】
// ・addProductVariantQuestionBlock() が質問1つぶんのブロック要素（DOM）を
//   返すことを前提にしている。ブロックの中に「.pv-q-add-option」ボタンと
//   「.pv-q-options-list」欄が必ず1つずつあることを前提に、その横へ
//   まとめて追加UIを差し込む。
// ・addProductVariantOptionRow(optionsListEl, opt) が、指定した選択肢欄に
//   1行追加する関数としてそのまま使えることを前提にしている（保存時の
//   処理 saveProductVariantAdminEditor() は変更していないため、まとめて
//   追加した行も、通常の行と同じように保存対象になる）。
//
// 【導入方法】
// index.html内で、product-variant-system.js より後ろであればどこでも
// 構わない。
// ==========================================

(function () {
    'use strict';

    function tryHook() {
        if (typeof window.addProductVariantQuestionBlock !== 'function' || typeof window.addProductVariantOptionRow !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        // 質問ブロックが（編集画面を開いた時・「＋質問を追加」を押した時）
        // 新規に作られるたびに、そのブロックにまとめて追加UIを差し込む
        const originalAddBlock = window.addProductVariantQuestionBlock;
        window.addProductVariantQuestionBlock = function (...args) {
            const block = originalAddBlock.apply(this, args);
            tpInjectBulkAddUI(block);
            return block;
        };
    }
    tryHook();

    function tpInjectBulkAddUI(block) {
        if (!block) return;
        if (block.querySelector('.pv-bulk-toggle')) return; // 二重差し込み防止

        const addBtn = block.querySelector('.pv-q-add-option');
        const optionsList = block.querySelector('.pv-q-options-list');
        if (!addBtn || !optionsList) return;

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'pv-bulk-toggle';
        toggleBtn.innerText = '📋 まとめて追加';
        toggleBtn.style.cssText = 'padding:6px 12px; border:1px dashed #7c4dff; color:#7c4dff; background:#fff; border-radius:6px; cursor:pointer; margin-left:8px;';

        const bulkBox = document.createElement('div');
        bulkBox.className = 'pv-bulk-box';
        bulkBox.style.cssText = 'display:none; flex-direction:column; gap:6px; margin-top:8px; padding:10px; background:#f6f4ff; border-radius:8px;';
        bulkBox.innerHTML = `
            <div style="font-size:12px; color:#555; line-height:1.5;">1行に1つずつ選択肢名を入力してください（改行で区切ります）。基本価格から差額を付けたい場合は、行の末尾に「,+50」「,-50」のように付けてください（付けなければ差額なし）。</div>
            <textarea class="pv-bulk-input" rows="4" placeholder="普通&#10;中盛,+50&#10;小盛,-50" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:6px; font-size:13px; resize:vertical;"></textarea>
            <button type="button" class="pv-bulk-apply" style="align-self:flex-end; padding:6px 14px; border:none; color:#fff; background:#7c4dff; border-radius:6px; cursor:pointer; font-weight:bold;">この内容を選択肢に追加</button>
        `;

        // 「＋ 選択肢を追加」ボタンのすぐ後ろに、トグルボタン→入力欄の順で並べる
        addBtn.insertAdjacentElement('afterend', bulkBox);
        addBtn.insertAdjacentElement('afterend', toggleBtn);

        toggleBtn.addEventListener('click', () => {
            const willShow = bulkBox.style.display === 'none';
            bulkBox.style.display = willShow ? 'flex' : 'none';
            if (willShow) {
                const ta = bulkBox.querySelector('.pv-bulk-input');
                if (ta) ta.focus();
            }
        });

        bulkBox.querySelector('.pv-bulk-apply').addEventListener('click', () => {
            tpApplyBulkVariantOptions(optionsList, bulkBox.querySelector('.pv-bulk-input'));
        });
    }

    // 行の末尾が「,数字」または「,+数字」「,-数字」の形になっていれば
    // 差額とみなし、そうでなければカンマごと選択肢名の一部として扱う。
    // 符号が省略されている場合（例：「中盛,50」）は「+」扱いにする。
    function tpParseBulkVariantLine(line) {
        const commaIdx = line.lastIndexOf(',');
        if (commaIdx === -1) return { label: line, sign: '+', amount: 0 };
        const raw = line.slice(commaIdx + 1).trim();
        const m = raw.match(/^([+-]?)(\d+(?:\.\d+)?)$/);
        if (m) {
            const sign = m[1] === '-' ? '-' : '+';
            return { label: line.slice(0, commaIdx).trim(), sign, amount: Number(m[2]) };
        }
        return { label: line, sign: '+', amount: 0 };
    }

    function tpApplyBulkVariantOptions(optionsListEl, textarea) {
        if (!textarea) return;
        const lines = textarea.value.split(/\r?\n/).map(l => l.trim()).filter(l => l);
        if (lines.length === 0) return;

        let addedCount = 0;
        lines.forEach(line => {
            const { label, sign, amount } = tpParseBulkVariantLine(line);
            if (!label) return;
            addProductVariantOptionRow(optionsListEl, { label, sign, amount });
            addedCount++;
        });

        textarea.value = '';
        if (addedCount > 0 && typeof playSound === 'function') playSound('click');
    }
})();
