// ==========================================
// checkout-demographics.js
// ------------------------------------------
// お支払い方法（現金／クレジット／QR決済）を選ぶ直前に、
// 「性別」「年齢層」を選んでもらうステップを差し込む機能。
// 会員（ポイントカード会員）は年齢がすでに登録済みのため対象外とし、
// 会員登録のないお客様（非会員）の会計時にだけ聞く。
// もちろん「スキップ」も選べる。
//
// 選んだ内容は、そのお会計の履歴（pos_history）に
//   checkoutGender: '男性' | '女性' | 'その他/回答しない' | null
//   checkoutAgeBracket: '10代以下' | '20代' | ... | '60代以上' | null
// として記録し、analytics-system.js（売上分析）側で集計に使う。
//
// register.js は直接編集せず、
//   ・proceedToPayment()  … お支払い方法選択画面を開く関数
//   ・completeTransaction() … 会計確定処理
// の2つを安全にラップする（他の追加機能ファイルと同じ「フック方式」）。
// モーダルのHTML/CSSもこのファイル内で動的に生成するので、
// index.html側の変更は不要。
// ==========================================

// 分析機能（analytics-system.js）の年齢層区分と揃えている
const CHECKOUT_AGE_BRACKETS = ['10代以下', '20代', '30代', '40代', '50代', '60代以上'];
const CHECKOUT_GENDER_OPTIONS = ['男性', '女性', 'その他/回答しない'];

let selectedCheckoutGender = null;
let selectedCheckoutAgeBracket = null;
let pendingDemographicCallback = null;

/* =========================================================
   モーダルのDOMを一度だけ生成する
   ========================================================= */
function ensureDemographicModal() {
    if (document.getElementById('checkout-demographic-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'checkout-demographic-modal';
    overlay.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:9999; align-items:center; justify-content:center;';

    const genderBtnsHtml = CHECKOUT_GENDER_OPTIONS.map(g =>
        `<button class="demo-gender-btn" data-value="${g}" onclick="selectDemographicGender('${g}')"
            style="padding:12px 10px; border-radius:8px; border:2px solid #ccc; background:#fff; font-size:15px; cursor:pointer; flex:1;">${g}</button>`
    ).join('');

    const ageBtnsHtml = CHECKOUT_AGE_BRACKETS.map(a =>
        `<button class="demo-age-btn" data-value="${a}" onclick="selectDemographicAgeBracket('${a}')"
            style="padding:12px 6px; border-radius:8px; border:2px solid #ccc; background:#fff; font-size:14px; cursor:pointer;">${a}</button>`
    ).join('');

    overlay.innerHTML = `
        <div style="background:#fff; border-radius:12px; padding:24px; width:90%; max-width:420px; max-height:90vh; overflow-y:auto;">
            <h3 style="margin:0 0 4px 0; color:#1a237e;">📋 お客様について</h3>
            <p style="margin:0 0 16px 0; font-size:12px; color:#777;">分かる範囲で構いません（スキップ可）</p>

            <div style="margin-bottom:18px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:8px;">性別</label>
                <div style="display:flex; gap:8px;">${genderBtnsHtml}</div>
            </div>

            <div style="margin-bottom:20px;">
                <label style="font-weight:bold; color:#333; display:block; margin-bottom:8px;">年齢層</label>
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">${ageBtnsHtml}</div>
            </div>

            <div style="display:flex; gap:10px;">
                <button onclick="skipDemographicStep()"
                    style="flex:1; padding:12px; border-radius:8px; border:1px solid #999; background:#eee; color:#333; font-weight:bold; cursor:pointer;">スキップ</button>
                <button onclick="confirmDemographicStep()"
                    style="flex:2; padding:12px; border-radius:8px; border:none; background:#3f51b5; color:#fff; font-weight:bold; cursor:pointer;">次へ（お支払い方法へ）</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
}

/* =========================================================
   選択・表示の切り替え
   ========================================================= */
function selectDemographicGender(value) {
    if (typeof playSound === 'function') playSound('click');
    selectedCheckoutGender = value;
    document.querySelectorAll('.demo-gender-btn').forEach(btn => {
        const isSel = btn.getAttribute('data-value') === value;
        btn.style.borderColor = isSel ? '#3f51b5' : '#ccc';
        btn.style.background = isSel ? '#e8eaf6' : '#fff';
        btn.style.fontWeight = isSel ? 'bold' : 'normal';
    });
}

function selectDemographicAgeBracket(value) {
    if (typeof playSound === 'function') playSound('click');
    selectedCheckoutAgeBracket = value;
    document.querySelectorAll('.demo-age-btn').forEach(btn => {
        const isSel = btn.getAttribute('data-value') === value;
        btn.style.borderColor = isSel ? '#3f51b5' : '#ccc';
        btn.style.background = isSel ? '#e8eaf6' : '#fff';
        btn.style.fontWeight = isSel ? 'bold' : 'normal';
    });
}

/* =========================================================
   ステップの表示・確定・スキップ
   ========================================================= */
function showDemographicStep(onConfirm) {
    ensureDemographicModal();

    // 前回の選択をリセット
    selectedCheckoutGender = null;
    selectedCheckoutAgeBracket = null;
    document.querySelectorAll('.demo-gender-btn, .demo-age-btn').forEach(btn => {
        btn.style.borderColor = '#ccc';
        btn.style.background = '#fff';
        btn.style.fontWeight = 'normal';
    });

    pendingDemographicCallback = onConfirm;

    const modal = document.getElementById('checkout-demographic-modal');
    if (modal) modal.style.display = 'flex';

    if (typeof speak === 'function') speak("せいべつ と ねんれいそう を おしえ て ください");
}

function closeDemographicModal() {
    const modal = document.getElementById('checkout-demographic-modal');
    if (modal) modal.style.display = 'none';
}

function confirmDemographicStep() {
    if (typeof playSound === 'function') playSound('success');
    closeDemographicModal();
    const cb = pendingDemographicCallback;
    pendingDemographicCallback = null;
    if (typeof cb === 'function') cb();
}

function skipDemographicStep() {
    if (typeof playSound === 'function') playSound('click');
    selectedCheckoutGender = null;
    selectedCheckoutAgeBracket = null;
    closeDemographicModal();
    const cb = pendingDemographicCallback;
    pendingDemographicCallback = null;
    if (typeof cb === 'function') cb();
}

/* =========================================================
   フック①：proceedToPayment() の直前に必ず挟む（非会員のみ）
   ------------------------------------------
   openCheckout()（会員でポイント無し・非会員の場合）や
   useAllPoints() / useSomePoints() / skipPoints()（ポイント選択後）は
   いずれも最終的に proceedToPayment() を呼んでお支払い方法選択画面を出すため、
   ここをラップすれば「お会計方法選択前」のすべての経路を確実に押さえられる。
   会員（activeCustomerが設定されている）の場合は、すでに年齢が
   登録済みのため聞かず、そのままお支払い方法選択に進む。
   ========================================================= */
(function hookDemographicsIntoPayment() {
    function tryHook() {
        if (typeof window.proceedToPayment !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalProceedToPayment = window.proceedToPayment;
        window.proceedToPayment = function (...args) {
            const isMember = (typeof activeCustomer !== 'undefined') && !!activeCustomer;
            if (isMember) {
                originalProceedToPayment.apply(this, args);
                return;
            }
            showDemographicStep(() => {
                originalProceedToPayment.apply(this, args);
            });
        };
    }
    tryHook();
})();

/* =========================================================
   フック②：completeTransaction() が保存した「今回の履歴レコード」に
   選択した性別・年齢層をあとから追記する
   ------------------------------------------
   completeTransaction() は関数内部で record を作って直接
   localStorage(pos_history) に保存しているため割り込めない。
   そこで「保存前後で件数が増えていたら、先頭（今回のレコード）に追記する」
   という方式をとる（過不足対応の記録方式と同じ考え方）。
   ========================================================= */
(function hookDemographicsIntoHistory() {
    function tryHook() {
        if (typeof window.completeTransaction !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalCompleteTransaction = window.completeTransaction;
        window.completeTransaction = async function (...args) {
            const genderAtSale = selectedCheckoutGender;
            const ageBracketAtSale = selectedCheckoutAgeBracket;

            const beforeList = JSON.parse(localStorage.getItem('pos_history') || '[]');
            const beforeCount = beforeList.length;

            const result = await originalCompleteTransaction.apply(this, args);

            try {
                const afterList = JSON.parse(localStorage.getItem('pos_history') || '[]');
                if (afterList.length > beforeCount) {
                    afterList[0].checkoutGender = genderAtSale || null;
                    afterList[0].checkoutAgeBracket = ageBracketAtSale || null;
                    localStorage.setItem('pos_history', JSON.stringify(afterList));
                    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                }
            } catch (e) {
                console.warn('性別・年齢層の履歴への追記に失敗しました:', e);
            }

            // 次のお会計のために選択状態をクリア
            selectedCheckoutGender = null;
            selectedCheckoutAgeBracket = null;

            return result;
        };
    }
    tryHook();
})();
