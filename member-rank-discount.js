// ==========================================
// member-rank-discount.js
// 「会員ランク」に応じたお会計金額の自動割引
// ------------------------------------------
// member-rank.js の MEMBER_RANKS に discountRate（%）を追加済み：
//   レギュラー/シルバー: 0%（割引なし）
//   ゴールド: 3%
//   ダイヤモンド: 5%
// これまでランクは「ポイント還元率」「バッジ表示」にしか使われておらず、
// お会計金額そのものへは自動反映されていなかったため、ここでカートへの
// 自動反映を行う。
//
// 【方式】
// 会員バーコードをスキャンした時点・カートの中身が変わった時点の両方で、
// カート内に「会員ランク割引」の行（目印: isMemberRankDiscount）を
// 自動的に追加・更新・削除する。店員が手動で値引きボタンを押す必要はない。
//
// register.js は直接編集せず、
//   ・updateReceipt()   … カート再計算のたびに割引行を更新
//   ・fetchAndAddItem() … 会員バーコードをスキャンした直後にも即反映
//   ・clearCustomer()   … 会員解除時に割引行を削除
// をフックして実現する（他の追加システムと同じフック方式）。
// ==========================================

const MEMBER_RANK_DISCOUNT_ITEM_NAME_PREFIX = '会員ランク割引';

// データ管理の設定（pos_member_rank_discount_enabled）。未設定はON。
const MEMBER_RANK_DISCOUNT_KEY = 'pos_member_rank_discount_enabled';
function isMemberRankDiscountEnabled() {
    try { return localStorage.getItem(MEMBER_RANK_DISCOUNT_KEY) !== 'false'; } catch (e) { return true; }
}
(function memberRankDiscountSetting() {
    function ensureBlock() {
        const scr = document.getElementById('migration-screen');
        if (!scr || document.getElementById('rank-discount-block')) return;
        const b = document.createElement('div');
        b.id = 'rank-discount-block';
        b.className = 'migration-block';
        b.style.cssText = 'background:#e8f5e9;border:2px solid #81c784;padding:15px;border-radius:6px;margin-bottom:15px';
        b.innerHTML = '<h3 class="migration-title" style="color:#2e7d32">🏅 会員ランク割引</h3>' +
            '<p class="migration-desc">ONにすると、ゴールド3%・ダイヤモンド5%の自動割引を会計に適用します。OFFにすると割引しません（ポイント還元は変わりません）。</p>' +
            '<label style="display:flex;gap:8px;align-items:center;font-weight:700;cursor:pointer"><input type="checkbox" id="rank-discount-check" style="width:20px;height:20px"> 会員ランク割引を適用する</label>';
        const first = scr.querySelector('.migration-block');
        if (first && first.parentNode === scr) scr.insertBefore(b, first); else scr.appendChild(b);
        const cb = b.querySelector('#rank-discount-check');
        cb.checked = isMemberRankDiscountEnabled();
        cb.onchange = () => {
            try { localStorage.setItem(MEMBER_RANK_DISCOUNT_KEY, cb.checked ? 'true' : 'false'); } catch (e) {}
            try { if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow(); } catch (e) {}
            if (typeof playSound === 'function') playSound('click');
            if (typeof window.updateReceipt === 'function') window.updateReceipt();
        };
    }
    function sync() {
        const cb = document.getElementById('rank-discount-check');
        if (cb) cb.checked = isMemberRankDiscountEnabled();
        if (typeof window.updateReceipt === 'function') window.updateReceipt();
    }
    window.addEventListener('storage', (e) => { if (e.key === MEMBER_RANK_DISCOUNT_KEY) sync(); });
    window.addEventListener('pos-setting-synced', (e) => { if (e && e.detail && e.detail.key === MEMBER_RANK_DISCOUNT_KEY) sync(); });
    setInterval(ensureBlock, 1500);
})();

// カートから「会員ランク割引」の行を取り除き、必要なら現在のランクに応じた
// 割引行を新しく追加し直す。表示（レンダリング）は行わず、cart配列の中身だけを整える。
function recalcMemberRankDiscountLine() {
    if (typeof cart === 'undefined' || !Array.isArray(cart)) return;

    // 既存の割引行を除去（毎回作り直すことで、カート内容の変化に追従させる）
    for (let i = cart.length - 1; i >= 0; i--) {
        if (cart[i] && cart[i].isMemberRankDiscount) {
            cart.splice(i, 1);
        }
    }

    if (!isMemberRankDiscountEnabled()) return; // データ管理でOFFなら割引しない
    if (typeof activeCustomer === 'undefined' || !activeCustomer) return;
    if (typeof getCustomerRankInfo !== 'function') return;

    const rankInfo = getCustomerRankInfo(activeCustomer);
    const discountRate = rankInfo && rankInfo.discountRate ? rankInfo.discountRate : 0;
    if (discountRate <= 0) return;

    // 割引対象小計（割引行を除いた、現時点のカート合計）
    const subtotal = cart.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0);
    if (subtotal <= 0) return;

    const discountAmount = Math.floor(subtotal * (discountRate / 100));
    if (discountAmount <= 0) return;

    cart.push({
        name: `${MEMBER_RANK_DISCOUNT_ITEM_NAME_PREFIX}（${rankInfo.name} ${discountRate}%）`,
        price: -discountAmount,
        qty: 1,
        taxRate: 10,
        genre: '値引き/その他',
        isMemberRankDiscount: true
    });
}

/* ---------- フック①：カート再計算のたびに割引行を更新する ---------- */
(function hookMemberRankDiscountIntoUpdateReceipt() {
    function tryHook() {
        if (typeof window.updateReceipt !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.updateReceipt;
        window.updateReceipt = function (...args) {
            recalcMemberRankDiscountLine();
            return original.apply(this, args);
        };
    }
    tryHook();
})();

/* ---------- フック②：会員バーコードをスキャンした直後にも即座に反映する ---------- */
(function hookMemberRankDiscountIntoFetchAndAddItem() {
    function tryHook() {
        if (typeof window.fetchAndAddItem !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.fetchAndAddItem;
        window.fetchAndAddItem = async function (...args) {
            const result = await original.apply(this, args);
            // 会員スキャン時（カートの中身自体は変わらない）でも割引行を反映させるため、
            // 改めて updateReceipt() を呼ぶ（フック①が割引行の更新も行う）。
            if (typeof window.updateReceipt === 'function') window.updateReceipt();
            return result;
        };
    }
    tryHook();
})();

/* ---------- フック③：会員解除時に割引行を削除する ---------- */
(function hookMemberRankDiscountIntoClearCustomer() {
    function tryHook() {
        if (typeof window.clearCustomer !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.clearCustomer;
        window.clearCustomer = function (...args) {
            const result = original.apply(this, args);
            if (typeof window.updateReceipt === 'function') window.updateReceipt();
            return result;
        };
    }
    tryHook();
})();
