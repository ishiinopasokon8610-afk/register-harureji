// ==========================================
// cart-sync-fixes-system.js
// ------------------------------------------
// 【この機能】既存ファイルを直接いじらず、フック方式で次の2つを直す。
// ① 会員ランク割引の行（isMemberRankDiscount）が常にカートの最後にあるため、
//    「一個取り消す」「半額」「数量変更」がその行に当たってしまい、
//    取り消しても割引行が再生成されて「1つ戻れない」状態になっていた。
//    → これらの操作では割引行をいったん外し、本当の最後の商品に対して実行する。
//      その後 updateReceipt() が割引行を作り直すので、割引は消えず、金額は再計算される。
// ② 担当者管理・AI分析の保存履歴が、他の端末で変更しても画面に反映されない。
//    → localStorage の変化を検知して、メモリ上のデータを読み直し、画面を描き直す。
// index.html の他の追加機能ファイルより「後」に <script> を1行足すこと。
// ==========================================

// ---------- ① 会員ランク割引行を避けて取り消し ----------
(function protectMemberRankDiscountLine() {
    function isAuto(item) { return !!(item && item.isMemberRankDiscount); }

    function withoutAutoLines(fnName, opts) {
        const orig = window[fnName];
        if (typeof orig !== 'function' || orig.__autoLineSafe) return false;
        const wrapped = function () {
            // 選択中の行が割引行なら、取り消せないことを知らせる（取り消しても再生成されるだけのため）
            if (opts && opts.guardSelected && typeof selectedCartIndex !== 'undefined'
                && selectedCartIndex !== -1 && isAuto(cart[selectedCartIndex])) {
                const input = (typeof getJanInput === 'function') ? getJanInput() : null;
                const hasCode = input && input.value.trim();
                if (!hasCode) {
                    if (typeof playSound === 'function') playSound('error');
                    if (typeof speak === 'function') speak("かいいん ならんく わりびき は とりけせ ません");
                    selectedCartIndex = -1;
                    if (typeof focusJanInput === 'function') focusJanInput();
                    return;
                }
            }
            // 割引行を外して本来の処理を実行し、終わったら割引行を作り直す
            for (let i = cart.length - 1; i >= 0; i--) {
                if (isAuto(cart[i])) cart.splice(i, 1);
            }
            try {
                return orig.apply(this, arguments);
            } finally {
                if (typeof window.updateReceipt === 'function') window.updateReceipt();
            }
        };
        wrapped.__autoLineSafe = true;
        window[fnName] = wrapped;
        return true;
    }

    function tryHook() {
        if (typeof cart === 'undefined' || typeof window.updateReceipt !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        withoutAutoLines('removeLastItem');
        withoutAutoLines('applyHalfPrice');
        withoutAutoLines('applyMultiplyQuantity');
        withoutAutoLines('removeSelectedOrInputItem', { guardSelected: true });
    }
    tryHook();
})();

// ---------- ② 担当者・AI分析履歴の即時反映 ----------
(function liveRefreshClerksAndAiHistory() {
    const AI_KEY = 'pos_ai_analysis_saved_history';
    let clerkKey = null;       // 担当者データを保存しているlocalStorageのキー
    let lastClerkRaw = null;
    let lastAiRaw = null;

    function isClerkKeyName(k) {
        return /clerk|staff/i.test(k) && !/wage|timecard|current|selected|last/i.test(k);
    }

    // キー名が分からなくても、メモリ上の clerks と中身が一致するキーを探して特定する
    function detectClerkKey() {
        if (clerkKey) return clerkKey;
        try {
            if (typeof clerks === 'undefined' || !Array.isArray(clerks)) return null;
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith('pos_')) continue;
                if (isClerkKeyName(k)) { clerkKey = k; return k; }
            }
            const mine = JSON.stringify(clerks);
            if (clerks.length > 0) {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('pos_') && localStorage.getItem(k) === mine) { clerkKey = k; return k; }
                }
            }
        } catch (e) { /* 無視 */ }
        return null;
    }

    function rerenderClerks() {
        ['renderClerks', 'renderClerkList', 'renderClerkTable', 'injectClerkWageCells'].forEach((fn) => {
            if (typeof window[fn] === 'function') {
                try { window[fn](); } catch (e) { console.warn('[clerk-sync] 描き直し失敗:', fn, e); }
            }
        });
    }

    function reloadClerksFromStorage(key) {
        const raw = localStorage.getItem(key);
        if (raw === null) return;
        let list;
        try { list = JSON.parse(raw); } catch (e) { return; }
        if (!Array.isArray(list) || typeof clerks === 'undefined') return;
        // let/const どちらで宣言されていても動くよう、配列は中身だけ入れ替える
        clerks.length = 0;
        list.forEach((c) => clerks.push(c));
        rerenderClerks();
    }

    function refreshAi() {
        if (typeof onAiAnalysisSavedHistoryChangedRemotely === 'function') {
            try { onAiAnalysisSavedHistoryChangedRemotely(); } catch (e) { console.warn('[ai-history-sync]', e); }
        } else if (typeof renderAiAnalysisSavedHistory === 'function') {
            try { renderAiAnalysisSavedHistory(); } catch (e) { /* 無視 */ }
        }
    }

    // 設定を受信した時のイベント（extra-settings-sync.js が発行）
    window.addEventListener('pos-setting-synced', (ev) => {
        const key = ev && ev.detail && ev.detail.key;
        if (!key) return;
        if (key === AI_KEY) { lastAiRaw = localStorage.getItem(AI_KEY); refreshAi(); }
        else if (isClerkKeyName(key)) {
            clerkKey = key;
            lastClerkRaw = localStorage.getItem(key);
            reloadClerksFromStorage(key);
        }
    });

    // 保険：受信イベントを取りこぼした場合や、Googleドライブ復元などで
    // localStorageだけ書き換わった場合も、2秒ごとの確認で画面に反映する。
    setInterval(() => {
        try {
            const aiRaw = localStorage.getItem(AI_KEY);
            if (lastAiRaw === null) lastAiRaw = aiRaw;
            else if (aiRaw !== lastAiRaw) { lastAiRaw = aiRaw; refreshAi(); }

            const k = detectClerkKey();
            if (k) {
                const raw = localStorage.getItem(k);
                if (lastClerkRaw === null) lastClerkRaw = raw;
                else if (raw !== lastClerkRaw) {
                    lastClerkRaw = raw;
                    // 自分で保存した直後（メモリと同じ内容）なら読み直し不要
                    if (typeof clerks !== 'undefined' && JSON.stringify(clerks) === raw) rerenderClerks();
                    else reloadClerksFromStorage(k);
                }
            }
        } catch (e) { /* 無視 */ }
    }, 2000);
})();
