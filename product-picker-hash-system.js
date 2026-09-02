// ==========================================
// product-picker-hash-system.js
// 「商品一覧」ブロック選択モーダル（product-picker-block-system.js の
// #product-block-picker-modal）が開いている間、URLハッシュとページタイトルを
// 専用の値に切り替える
// ------------------------------------------
// admin-auth-hash-system.js / home-blocks-hash-navigation.js と同じ考え方。
// このモーダルは openProductBlockList() / closeProductBlockList() という
// 明確な開閉関数を持つため、それらをラップする「フック方式」で実現する
// （product-picker-block-system.js / index.html は直接編集しない）。
//
// ハッシュ： #product-picker
// タイトル： 商品選択-haruレジ　（screen-title-system.js と同じ「OO-haruレジ」形式）
// ==========================================

const PRODUCT_PICKER_HASH = '#product-picker';
const PRODUCT_PICKER_TITLE_LABEL = '商品選択';

let productPickerHashBeforeOpen = null;
let productPickerTitleBeforeOpen = null;

function getHashTitleBaseSafe() {
    return (typeof BASE_PAGE_TITLE !== 'undefined') ? BASE_PAGE_TITLE : 'haruレジ';
}

(function hookProductPickerOpenCloseForHash() {
    function tryHook() {
        if (typeof window.openProductBlockList !== 'function' || typeof window.closeProductBlockList !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        const originalOpen = window.openProductBlockList;
        window.openProductBlockList = function (...args) {
            const result = originalOpen.apply(this, args);
            productPickerHashBeforeOpen = window.location.hash;
            productPickerTitleBeforeOpen = document.title;
            if (window.location.hash !== PRODUCT_PICKER_HASH) {
                window.location.hash = PRODUCT_PICKER_HASH;
            }
            document.title = `${PRODUCT_PICKER_TITLE_LABEL}-${getHashTitleBaseSafe()}`;
            return result;
        };

        const originalClose = window.closeProductBlockList;
        window.closeProductBlockList = function (...args) {
            const result = originalClose.apply(this, args);
            if (window.location.hash === PRODUCT_PICKER_HASH) {
                if (productPickerHashBeforeOpen) {
                    window.location.hash = productPickerHashBeforeOpen;
                } else {
                    // 開く前のハッシュが無かった場合は、履歴を1つ戻して消す
                    history.back();
                }
            }
            if (productPickerTitleBeforeOpen !== null) {
                document.title = productPickerTitleBeforeOpen;
            }
            productPickerHashBeforeOpen = null;
            productPickerTitleBeforeOpen = null;
            return result;
        };
    }
    tryHook();
})();

// ブラウザの戻る/進むボタンで #product-picker から離れたら、
// モーダルが開いたままにならないよう自動的に閉じる
window.addEventListener('hashchange', () => {
    if (window.location.hash === PRODUCT_PICKER_HASH) return;
    const modal = document.getElementById('product-block-picker-modal');
    if (modal && modal.style.display === 'flex' && typeof closeProductBlockList === 'function') {
        closeProductBlockList();
    }
});
