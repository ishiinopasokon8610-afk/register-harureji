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
// 【今回の対応】
// 編集画面の「＋ 選択肢を追加」ボタンの横に「📋 まとめて追加」ボタンを
// 追加した。押すと、複数行入力できるテキストエリアが開き、
//   ・1行に1つずつ選択肢名を入力（例：S / M / L のように改行で区切る）
//   ・価格も指定したい場合は、行の末尾に「,価格」を付ける
//     （例：L,1200 と入力すると、選択肢名「L」・価格1200円になる）
// という形で複数まとめて入力し、「この内容を選択肢に追加」を押すと、
// 既存の addProductVariantOptionRow() を行数ぶん呼び出して、選択肢の
// 一覧に一気に追加する（1件ずつ「＋」を押す手間を無くすだけで、
// 追加された後の見た目・保存の仕組みは、手動で1件ずつ追加した場合と
// 完全に同じ）。
//
// 既存の「＋ 選択肢を追加」ボタン・1件ずつの手動入力も、これまで通り
// 使える（まとめて追加した後に、個別の行を直接編集・削除することも可能）。
//
// 【前提にしていること】
// ・addProductVariantOptionRow(label, price) が、選択肢の入力欄を1行
// 　増やす関数としてそのまま使えることを前提にしている（保存時の処理
// 　saveProductVariantAdminEditor() は変更していないため、まとめて追加
// 　した行も、通常の行と同じように保存対象になる）。
// ・価格の判定は、行の末尾がカンマ区切りの数字だった場合のみ「価格」と
// 　みなす（数字でなければ、カンマも含めて選択肢名の一部として扱う。
// 　例えば「メロン,ソーダ味」のように選択肢名自体にカンマを含みたい
// 　場合でも、末尾が数字でなければ意図せず価格欄に分割されることはない）。
//
// 【導入方法】
// index.html内で、product-variant-system.js より後ろであればどこでも
// 構わない。
// ==========================================

(function () {
    'use strict';

    function tryHook() {
        if (typeof window.ensureProductVariantAdminModal !== 'function' || typeof window.addProductVariantOptionRow !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        // モーダルが（初回だけ）新規に作られたタイミングで、
        // まとめて追加用のUIを差し込む
        const originalEnsure = window.ensureProductVariantAdminModal;
        window.ensureProductVariantAdminModal = function (...args) {
            const modal = originalEnsure.apply(this, args);
            tpInjectBulkAddUI(modal);
            return modal;
        };

        // 別の商品の編集を開いた際、前回開いていた時の「まとめて追加」
        // テキストエリアの入力内容が残らないよう、開くたびにリセットする
        if (typeof window.openProductVariantEditor === 'function') {
            const originalOpenEditor = window.openProductVariantEditor;
            window.openProductVariantEditor = function (...args) {
                const result = originalOpenEditor.apply(this, args);
                tpResetBulkAddUI();
                return result;
            };
        }
    }
    tryHook();

    function tpResetBulkAddUI() {
        const box = document.getElementById('pv-admin-bulk-box');
        const textarea = document.getElementById('pv-admin-bulk-input');
        if (box) box.style.display = 'none';
        if (textarea) textarea.value = '';
    }

    function tpInjectBulkAddUI(modal) {
        if (!modal || document.getElementById('pv-admin-bulk-toggle')) return;
        const addBtn = modal.querySelector('#pv-admin-add-option');
        if (!addBtn) return;

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.id = 'pv-admin-bulk-toggle';
        toggleBtn.innerText = '📋 まとめて追加';
        toggleBtn.style.cssText = 'padding:6px 12px; border:1px dashed #7c4dff; color:#7c4dff; background:#fff; border-radius:6px; cursor:pointer; margin-bottom:14px; margin-left:8px;';

        const bulkBox = document.createElement('div');
        bulkBox.id = 'pv-admin-bulk-box';
        bulkBox.style.cssText = 'display:none; flex-direction:column; gap:6px; margin-bottom:14px; padding:10px; background:#f6f4ff; border-radius:8px;';
        bulkBox.innerHTML = `
            <div style="font-size:12px; color:#555; line-height:1.5;">1行に1つずつ選択肢名を入力してください（改行で区切ります）。価格も指定したい場合は行の末尾に「,価格」を付けてください。</div>
            <textarea id="pv-admin-bulk-input" rows="5" placeholder="S&#10;M&#10;L,1200" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:6px; font-size:13px; resize:vertical;"></textarea>
            <button type="button" id="pv-admin-bulk-apply" style="align-self:flex-end; padding:6px 14px; border:none; color:#fff; background:#7c4dff; border-radius:6px; cursor:pointer; font-weight:bold;">この内容を選択肢に追加</button>
        `;

        // 「＋ 選択肢を追加」ボタンのすぐ後ろに、トグルボタン→入力欄の順で並べる
        addBtn.insertAdjacentElement('afterend', bulkBox);
        addBtn.insertAdjacentElement('afterend', toggleBtn);

        toggleBtn.addEventListener('click', () => {
            const willShow = bulkBox.style.display === 'none';
            bulkBox.style.display = willShow ? 'flex' : 'none';
            if (willShow) {
                const ta = document.getElementById('pv-admin-bulk-input');
                if (ta) ta.focus();
            }
        });

        bulkBox.querySelector('#pv-admin-bulk-apply').addEventListener('click', tpApplyBulkVariantOptions);
    }

    // 行の末尾が「,数字」の形になっていれば価格とみなし、そうでなければ
    // カンマごと選択肢名の一部として扱う
    function tpParseBulkVariantLine(line) {
        const commaIdx = line.lastIndexOf(',');
        if (commaIdx === -1) return { label: line, price: null };
        const maybePrice = line.slice(commaIdx + 1).trim();
        if (/^\d+(\.\d+)?$/.test(maybePrice)) {
            return { label: line.slice(0, commaIdx).trim(), price: Number(maybePrice) };
        }
        return { label: line, price: null };
    }

    function tpApplyBulkVariantOptions() {
        const textarea = document.getElementById('pv-admin-bulk-input');
        if (!textarea) return;
        const lines = textarea.value.split(/\r?\n/).map(l => l.trim()).filter(l => l);
        if (lines.length === 0) return;

        let addedCount = 0;
        lines.forEach(line => {
            const { label, price } = tpParseBulkVariantLine(line);
            if (!label) return;
            addProductVariantOptionRow(label, price);
            addedCount++;
        });

        textarea.value = '';
        if (addedCount > 0 && typeof playSound === 'function') playSound('click');
    }
})();
