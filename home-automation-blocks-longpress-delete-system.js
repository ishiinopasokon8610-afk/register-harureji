// ==========================================
// home-automation-blocks-longpress-delete-system.js
// ------------------------------------------
// このファイルも home-automation-blocks.js / index.html を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【このファイルの位置づけ】
// home-automation-staff-call-actual-delete-system.js（前回追加分）を
// 置き換えるものです。前回は「呼び出し系（'CALL'発番）」のバーコード
// だけを長押し削除の対象にしていましたが、今回は対象を
//   ・タッチパネルから作られたバーコード（呼び出し 'CALL' ／
//     💰お会計希望 'BILL'）→ 長押しで完全に削除する
//   ・それ以外（店員が管理画面で手動登録した割引バーコードなど）
//     → これまで通り、長押ししてもホームの一覧から隠すだけ
//       （hideFromHome。バーコード自体は削除されず、レジでは
//       引き続きスキャンして使える）
// という形に分けます。
// home-automation-blocks-archive-staff-call-only-system.js が導入した
// 「対象外のバーコードには長押し判定自体を付けない」という制限は、
// このファイルで attachBlockArchiveLongPress() 自体を丸ごと上書きして
// 解除しており（全ブロックに長押しが付く、home-automation-blocks.js
// 本来の挙動に戻す）、その代わりに「長押しが完了した時の処理内容」の
// 方を、バーコードの発行元によって振り分けています。
//
// 【今回の対応（2点）】
// ① ホーム画面の「🏷️ 自動化バーコード一覧」ブロックの2秒長押し
// 　　→ タッチパネル発行なら完全削除・それ以外なら従来通りホームから
// 　　　非表示（hideFromHome）にするだけ、に振り分ける。
// ② 商品管理側の「自動化バーコード一覧」画面（discount-tbody の行）にも、
// 　　同じ振り分けで2秒長押しの操作を追加する（従来この画面には
// 　　長押し操作が一切無かったため、①と合わせて新設）。
//
// 【判定方法】
// タッチパネル発行かどうかは、touch-panel-order-system.js が
// generateTouchPanelBarcode('CALL') / generateTouchPanelBarcode('BILL')
// で発番している事実を利用し、「バーコード番号が 'CALL' または 'BILL'
// から始まるかどうか」で判定している。店員が管理画面で手動登録する
// 割引バーコードは、この2つのプレフィックスとは異なる発番のため
// 対象外として扱われる。
//
// 【削除（①②共通）の実体】
// discountBarcodes 配列から該当要素を splice で取り除いたうえで、
// discount-system.js の saveDiscounts()（存在すれば）を呼ぶ。
// 見つからない場合のみ、保険として localStorage への直接保存に
// フォールバックする。
//
// 【ホームから隠すだけ（①②共通・タッチパネル発行以外）の実体】
// home-automation-blocks.js の元の archiveDiscountBarcode() と全く同じ
// （disc.hideFromHome = true にして localStorage へ直接保存）。
// バーコード自体は削除しないため、レジでは引き続き使える。
//
// 【導入方法】
// index.html内で、home-automation-blocks.js より後ろであれば
// どこでも構わない（home-automation-blocks-archive-staff-call-only-system.js
// より後ろに置いておけば、その制限を確実に上書きできる）。
// これまで読み込んでいた home-automation-staff-call-actual-delete-system.js
// は不要になるため、index.html からは読み込みを外してください。
// ==========================================

/* =========================================================
   タッチパネル発行のバーコードかどうかの判定
   （呼び出し系 'CALL' ／ お会計希望 'BILL'）
   ========================================================= */
function tpIsTouchPanelOriginatedBarcode(disc) {
    if (!disc || typeof disc.barcode !== 'string') return false;
    return disc.barcode.startsWith('CALL') || disc.barcode.startsWith('BILL');
}

/* =========================================================
   共通：自動化バーコードを配列から完全に削除する
   ========================================================= */
function tpDeleteAutomationBarcodeEntirely(index) {
    if (typeof discountBarcodes === 'undefined' || !Array.isArray(discountBarcodes)) return false;
    if (!discountBarcodes[index]) return false;

    discountBarcodes.splice(index, 1);

    if (typeof saveDiscounts === 'function') {
        saveDiscounts();
    } else {
        try {
            localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
        } catch (e) {
            console.warn('自動化バーコードの削除の保存に失敗しました:', e);
        }
    }

    if (typeof playSound === 'function') playSound('success');
    return true;
}

// 「削除しました」の一瞬だけのトースト表示
// （home-automation-blocks.js の showHomeAutomationArchiveToast() と
// 同じ見た目だが、文言が異なるためこちらでは別関数として用意する）
function tpShowAutomationBarcodeDeletedToast() {
    const existing = document.getElementById('tp-automation-barcode-deleted-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'tp-automation-barcode-deleted-toast';
    toast.textContent = '🗑 削除しました';
    toast.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
        'z-index:100050', 'background:rgba(0,0,0,0.8)', 'color:#fff',
        'padding:10px 18px', 'border-radius:20px', 'font-size:13px', 'font-weight:bold',
        'box-shadow:0 4px 14px rgba(0,0,0,0.3)', 'transition:opacity 300ms ease',
        'opacity:1', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 1300);
}

/* =========================================================
   共通：長押しが完了したときの振り分け処理
   ------------------------------------------
   ・タッチパネル発行（'CALL'/'BILL'）→ 完全削除
   ・それ以外（店員が手動登録した割引バーコード等）→ ホームから
     隠すだけ（hideFromHome。home-automation-blocks.js の元の
     archiveDiscountBarcode() と同じ実装）
   ========================================================= */
function tpHandleAutomationBarcodeLongPressComplete(index) {
    if (typeof discountBarcodes === 'undefined' || !Array.isArray(discountBarcodes)) return;
    const disc = discountBarcodes[index];
    if (!disc) return;

    if (tpIsTouchPanelOriginatedBarcode(disc)) {
        const deleted = tpDeleteAutomationBarcodeEntirely(index);
        if (deleted) tpShowAutomationBarcodeDeletedToast();
    } else {
        disc.hideFromHome = true;
        try {
            localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
        } catch (e) {
            console.warn('自動化バーコードのアーカイブ設定の保存に失敗しました:', e);
        }
        if (typeof playSound === 'function') playSound('success');
        if (typeof showHomeAutomationArchiveToast === 'function') showHomeAutomationArchiveToast();
    }

    if (typeof renderHomeAutomationBlocksIfVisible === 'function') renderHomeAutomationBlocksIfVisible();
    if (typeof renderDiscounts === 'function') renderDiscounts();
}

/* =========================================================
   ① ホーム画面のブロック長押し：全ブロックに長押しを付け直し、
   　 完了時の処理を振り分け処理に差し替える
   ------------------------------------------
   home-automation-blocks-archive-staff-call-only-system.js が
   window.attachBlockArchiveLongPress を「対象外なら何も付けない」形に
   上書きしていたため、ここでさらに上書きして home-automation-blocks.js
   本来の「全ブロックに長押しを付ける」実装に戻す（押している間の見た目
   ・タイミングは元の実装と同じ。呼び出す先だけ archiveDiscountBarcode()
   から tpHandleAutomationBarcodeLongPressComplete() に差し替えている）。
   ========================================================= */
(function overrideAttachBlockArchiveLongPressForAllBlocks() {
    function tryHook() {
        if (typeof HOME_BLOCK_ARCHIVE_LONG_PRESS_MS === 'undefined') {
            setTimeout(tryHook, 300);
            return;
        }
        window.attachBlockArchiveLongPress = function (blockEl, index) {
            const bar = blockEl.querySelector('.home-automation-block-archive-bar');
            let pressTimer = null;
            let done = false;

            const start = () => {
                if (done) return;
                if (bar) {
                    bar.style.transition = 'none';
                    bar.style.width = '0%';
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            bar.style.transition = `width ${HOME_BLOCK_ARCHIVE_LONG_PRESS_MS}ms linear`;
                            bar.style.width = '100%';
                        });
                    });
                }
                blockEl.style.transform = 'scale(0.94)';

                pressTimer = setTimeout(() => {
                    done = true;
                    blockEl.style.opacity = '0';
                    blockEl.style.transform = 'scale(0.85)';
                    setTimeout(() => tpHandleAutomationBarcodeLongPressComplete(index), 150);
                }, HOME_BLOCK_ARCHIVE_LONG_PRESS_MS);
            };

            const cancel = () => {
                if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
                if (done) return;
                blockEl.style.transform = 'scale(1)';
                if (bar) {
                    bar.style.transition = 'width 150ms ease-out';
                    bar.style.width = '0%';
                }
            };

            blockEl.addEventListener('pointerdown', start);
            blockEl.addEventListener('pointerup', cancel);
            blockEl.addEventListener('pointerleave', cancel);
            blockEl.addEventListener('pointercancel', cancel);
            blockEl.addEventListener('contextmenu', (e) => e.preventDefault());
        };
    }
    tryHook();
})();

/* =========================================================
   ② 自動化バーコード一覧（discount-tbody）の全行に、2秒長押しでの
   　 振り分け処理（削除 or ホーム非表示）を追加する
   ========================================================= */
const TP_DISCOUNT_ROW_LONG_PRESS_MS = 2000;

function tpAttachDiscountRowLongPress(tr, index) {
    let pressTimer = null;
    let fired = false;
    const originalBg = tr.style.backgroundColor;

    const start = () => {
        fired = false;
        tr.style.transition = `background-color ${TP_DISCOUNT_ROW_LONG_PRESS_MS}ms linear`;
        tr.style.backgroundColor = 'rgba(229,57,53,0.35)';
        pressTimer = setTimeout(() => {
            fired = true;
            tr.style.transition = '';
            tpHandleAutomationBarcodeLongPressComplete(index);
        }, TP_DISCOUNT_ROW_LONG_PRESS_MS);
    };

    const cancel = () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        if (fired) return;
        tr.style.transition = 'background-color 150ms ease-out';
        tr.style.backgroundColor = originalBg || '';
    };

    tr.addEventListener('pointerdown', start);
    tr.addEventListener('pointerup', cancel);
    tr.addEventListener('pointerleave', cancel);
    tr.addEventListener('pointercancel', cancel);
    tr.addEventListener('contextmenu', (e) => e.preventDefault());

    // 長押しが発火した直後の1回分のクリックは、行の編集などが
    // 開いてしまわないようキャンセルする
    tr.addEventListener('click', (e) => {
        if (fired) {
            e.preventDefault();
            e.stopImmediatePropagation();
            fired = false;
        }
    }, true);
}

function tpSetupDiscountRowLongPress() {
    const tbody = document.getElementById('discount-tbody');
    if (!tbody || typeof discountBarcodes === 'undefined' || !Array.isArray(discountBarcodes)) return;

    // renderDiscounts() が絞り込んで表示している行（アーカイブされていないもの）と
    // 同じ順番・同じインデックスの組み合わせを再現する
    const activeList = discountBarcodes
        .map((disc, index) => ({ disc, index }))
        .filter(({ disc }) => !disc.archived);

    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length !== activeList.length) return; // 「まだ登録がありません」等のプレースホルダー行の場合は何もしない

    rows.forEach((tr, i) => {
        const { index } = activeList[i];
        tpAttachDiscountRowLongPress(tr, index);
    });
}

(function hookRenderDiscountsForRowLongPress() {
    function tryHook() {
        if (typeof window.renderDiscounts !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderDiscounts;
        window.renderDiscounts = function (...args) {
            const result = original.apply(this, args);
            tpSetupDiscountRowLongPress();
            return result;
        };
    }
    tryHook();
})();
