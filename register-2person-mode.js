// ==========================================
// register-2person-mode.js
// ------------------------------------------
// レジ画面のヘッダーに「1人態勢 / 2人態勢」を切り替える、
// 邪魔にならない小さなトグルボタンを追加する。
// 状態はlocalStorageに保存され、端末を閉じても引き継がれる。
//
// 【2026-08 変更】
// 「2人態勢」に切り替える際、もう一人（相方）の店員を
// バーコードスキャン／一覧タップで読み込むまでは
// 実際には2人態勢が有効にならないようにした。
//   ・トグルボタンを押しても、すぐには pos_two_person_mode を true にしない。
//     まず「もう一人の店員」を選ぶモーダルを表示し、選択（またはバーコード
//     スキャン）が完了した時点で初めて2人態勢がONになる。
//   ・選んだ相方の名前も担当表示（#active-clerk-display）に付記する。
//   ・現在の担当（activeClerkName）自身を相方として選ぶことはできない
//     （＝本当に別の店員が確認したことにならないため）。
//   ・稼働中に担当（activeClerkName）が切り替わり、相方と同一人物に
//     なってしまった場合は、自動的に相方の選び直しを求める。
//   ・キャンセルした場合は1人態勢のまま（＝ONにはならない）。
//
// register.js / master-mgmt.js / index.html は直接編集せず、
// レジ画面のヘッダー（.header-actions）にJSでボタンを追加し、
// 独自のモーダルをDOMに追加する（他の追加機能ファイルと同じ「フック方式」）。
//
// 【バーコードスキャンの取り込み方について】
// モーダル内に専用の入力欄を別途置くと、スキャナーの入力が
// メインのJAN入力欄（#jan-input）と競合し、Enterが二重に処理されて
// しまう問題があった。そのため専用入力欄は置かず、他の追加機能
// ファイルと同じく fetchAndAddItem() をフックして、既存のJAN入力欄
// （バーコード読み取りの唯一の経路）をそのまま利用する。
// ==========================================

const TWO_PERSON_MODE_KEY = 'pos_two_person_mode';
const SECOND_CLERK_NAME_KEY = 'pos_second_clerk_name';

let awaitingSecondClerkScan = false;

function isTwoPersonModeOn() {
    return localStorage.getItem(TWO_PERSON_MODE_KEY) === 'true';
}

function getSecondClerkName() {
    return localStorage.getItem(SECOND_CLERK_NAME_KEY) || '';
}

// 実際に「2人態勢が成立している」とみなせるかどうか
// （フラグが立っていて、かつ相方が現在の担当者とは別人であること）
function isTwoPersonModeActuallyEstablished() {
    if (!isTwoPersonModeOn()) return false;
    const second = getSecondClerkName();
    if (!second) return false;
    if (typeof activeClerkName !== 'undefined' && second === activeClerkName) return false;
    return true;
}

/* =========================================================
   ヘッダーのトグルボタン
   ========================================================= */
function ensureTwoPersonModeButton() {
    if (document.getElementById('two-person-mode-btn')) {
        updateTwoPersonModeButtonUI();
        return;
    }

    const headerActions = document.querySelector('#register-screen .header-actions');
    if (!headerActions) return;

    const btn = document.createElement('button');
    btn.id = 'two-person-mode-btn';
    btn.onclick = toggleTwoPersonMode;
    btn.style.cssText = 'padding:4px 10px; border:none; border-radius:12px; font-size:11px; font-weight:bold; cursor:pointer; margin-left:6px;';
    headerActions.appendChild(btn);

    updateTwoPersonModeButtonUI();
}

function updateTwoPersonModeButtonUI() {
    const btn = document.getElementById('two-person-mode-btn');
    if (!btn) return;
    const on = isTwoPersonModeActuallyEstablished();
    btn.innerText = on ? '👥 2人態勢' : '🧍 1人態勢';
    btn.style.background = on ? '#00897b' : '#cfd8dc';
    btn.style.color = on ? '#fff' : '#455a64';
    updateActiveClerkDisplayWithSecond();
}

// #active-clerk-display は register.js / master-mgmt.js の複数箇所から
// 直接書き換えられるため、個別にフックするのではなく定期的に
// 「2人態勢なら相方の名前も付記する」形で上書きする
// （utils.jsの時計更新や他の追加機能と同じ、setIntervalによる同期方式）
function updateActiveClerkDisplayWithSecond() {
    const el = document.getElementById('active-clerk-display');
    if (!el || typeof activeClerkName === 'undefined') return;
    const safe = (typeof escapeHtml === 'function') ? escapeHtml : (s) => s;
    if (isTwoPersonModeActuallyEstablished()) {
        el.innerText = `担当: ${safe(activeClerkName)} ／ 相方: ${safe(getSecondClerkName())}`;
    } else if (!el.innerText.startsWith('担当:') || el.innerText.indexOf('／ 相方:') !== -1) {
        el.innerText = `担当: ${safe(activeClerkName)}`;
    }
}

setInterval(() => {
    updateTwoPersonModeButtonUI();
    // 稼働中に担当者が変わって相方と同一人物になってしまった場合は、
    // 2人態勢が崩れているので相方の選び直しを求める
    if (isTwoPersonModeOn() && getSecondClerkName() && !isTwoPersonModeActuallyEstablished() && !awaitingSecondClerkScan) {
        if (typeof playSound === 'function') playSound('error');
        showSecondClerkModal(true);
    }
}, 1000);

/* =========================================================
   トグル本体
   ========================================================= */
function toggleTwoPersonMode() {
    if (isTwoPersonModeActuallyEstablished()) {
        // OFFにする
        localStorage.setItem(TWO_PERSON_MODE_KEY, 'false');
        localStorage.removeItem(SECOND_CLERK_NAME_KEY);
        awaitingSecondClerkScan = false;
        closeSecondClerkModal();
        if (typeof playSound === 'function') playSound('click');
        updateTwoPersonModeButtonUI();
        if (typeof speak === 'function') speak("1人態勢に戻しました");
        return;
    }

    // ONにする場合は、まだフラグを立てずに「もう一人」の選択を求める
    const candidates = (typeof clerks !== 'undefined' ? clerks : []).filter(c => c.name !== activeClerkName);
    if (candidates.length === 0) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("2人態勢にするには、もう一人の店員を先に登録してください。", "もう ひとり の てんいん を とうろく し て ください。", () => {}, false);
        } else {
            alert('2人態勢にするには、もう一人の店員を先に登録してください。');
        }
        return;
    }

    showSecondClerkModal(false);
}

/* =========================================================
   「もう一人（相方）」選択モーダル
   ========================================================= */
function ensureSecondClerkModal() {
    if (document.getElementById('second-clerk-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'second-clerk-modal';
    // .modal-overlay クラスを付けることで、register.js側の
    // focusJanInput()の「モーダル表示中はJAN入力欄にフォーカスしない」判定
    // （.modal, .modal-overlay, #checkout-modal ... を対象）に自動的に乗る
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center;';

    overlay.innerHTML = `
        <div style="background:#fff; border-radius:12px; padding:24px; width:90%; max-width:420px; max-height:85vh; overflow-y:auto;">
            <h3 style="margin:0 0 6px 0; color:#1a237e;">👥 2人態勢：相方を確認</h3>
            <p id="second-clerk-modal-desc" style="margin:0 0 14px 0; font-size:12px; color:#777;">
                下のJAN入力欄にもう一人の店員のバーコードをスキャンするか、一覧からタップしてください。
            </p>

            <div id="second-clerk-options" style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;"></div>

            <button onclick="cancelSecondClerkSetup()"
                style="width:100%; padding:12px; border-radius:8px; border:1px solid #999; background:#eee; color:#333; font-weight:bold; cursor:pointer;">キャンセル（1人態勢のまま）</button>
        </div>
    `;

    document.body.appendChild(overlay);
}

function renderSecondClerkOptions() {
    const container = document.getElementById('second-clerk-options');
    if (!container) return;
    const safe = (typeof escapeHtml === 'function') ? escapeHtml : (s) => s;

    const candidates = (typeof clerks !== 'undefined' ? clerks : []).filter(c => c.name !== activeClerkName);
    if (candidates.length === 0) {
        container.innerHTML = '<div style="color:#999; font-size:13px;">選べる店員がいません</div>';
        return;
    }

    container.innerHTML = candidates.map(c =>
        `<button class="second-clerk-option-btn" data-name="${safe(c.name)}" onclick="confirmSecondClerk('${safe(c.name).replace(/'/g, "\\'")}')"
            style="padding:12px; border-radius:8px; border:2px solid #ccc; background:#fff; font-size:15px; cursor:pointer; text-align:left;">${safe(c.name)}</button>`
    ).join('');
}

// forceReconfirm: 稼働中に相方が担当者と同一人物になってしまった場合の再選択かどうか
function showSecondClerkModal(forceReconfirm) {
    ensureSecondClerkModal();
    renderSecondClerkOptions();

    const desc = document.getElementById('second-clerk-modal-desc');
    if (desc) {
        desc.innerText = forceReconfirm
            ? '担当が変わり、相方と同一人物になりました。もう一人の店員を選び直してください。'
            : 'もう一人の店員のバーコードをスキャンするか、下の一覧からタップしてください。';
    }

    awaitingSecondClerkScan = true;
    const overlay = document.getElementById('second-clerk-modal');
    if (overlay) overlay.style.display = 'flex';

    // モーダル表示中も、スキャンは既存のJAN入力欄で受ける
    // （overlayは視覚的に覆うだけで、フォーカス自体は妨げない）
    setTimeout(() => {
        const jan = (typeof getJanInput === 'function') ? getJanInput() : document.getElementById('jan-input');
        if (jan) jan.focus();
    }, 50);
}

function closeSecondClerkModal() {
    const overlay = document.getElementById('second-clerk-modal');
    if (overlay) overlay.style.display = 'none';
    awaitingSecondClerkScan = false;
}

// 既存のJAN入力欄からのバーコードスキャンを、fetchAndAddItem()経由で受け取る
// （他の追加機能ファイルと同じ「フック方式」。専用の入力欄を持たないため、
// スキャナー入力の競合によるEnterの二重処理が起きない）
(function hookFetchAndAddItemForSecondClerk() {
    function tryHook() {
        if (typeof window.fetchAndAddItem !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.fetchAndAddItem;
        window.fetchAndAddItem = async function (code) {
            if (!awaitingSecondClerkScan) {
                return original(code);
            }

            // 相方確認モーダルの表示中は、通常のバーコード処理（担当切替・
            // 会員呼び出し・商品追加など）を行わせず、ここで完結させる
            const found = (typeof clerks !== 'undefined' ? clerks : []).find(c => c.barcode && c.barcode === code);
            if (!found) {
                if (typeof playSound === 'function') playSound('error');
                if (typeof speak === 'function') speak("見つかりません");
                return;
            }
            if (found.name === activeClerkName) {
                if (typeof playSound === 'function') playSound('error');
                if (typeof speak === 'function') speak("本人ではなく、もう一人の方をスキャンしてください");
                return;
            }
            confirmSecondClerk(found.name);
        };
    }
    tryHook();
})();

function confirmSecondClerk(name) {
    if (!name || name === activeClerkName) return;
    localStorage.setItem(SECOND_CLERK_NAME_KEY, name);
    localStorage.setItem(TWO_PERSON_MODE_KEY, 'true');
    closeSecondClerkModal();
    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak(`${name} さんを相方に設定しました`);
    updateTwoPersonModeButtonUI();
}

function cancelSecondClerkSetup() {
    // 選び直し中（forceReconfirm）にキャンセルされた場合も、
    // 崩れた2人態勢は維持できないため1人態勢に戻す
    localStorage.setItem(TWO_PERSON_MODE_KEY, 'false');
    localStorage.removeItem(SECOND_CLERK_NAME_KEY);
    closeSecondClerkModal();
    if (typeof playSound === 'function') playSound('click');
    updateTwoPersonModeButtonUI();
}

/* =========================================================
   初期化
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
    (function tryInit() {
        if (!document.querySelector('#register-screen .header-actions')) {
            setTimeout(tryInit, 300);
            return;
        }
        ensureTwoPersonModeButton();
    })();
});
