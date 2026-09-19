// ==========================================
// receipt-reissue-system.js
// お会計履歴からの「レシート再発行」機能
// ------------------------------------------
// 【この機能】
// お会計履歴画面（history-screen）に「🧾 レシート再発行」ボタンを追加する。
// 押すと、次のどちらかで過去の取引のレシートを、既存のレシート画面
// （#receipt-print-modal。画像(PNG)保存もそのまま使える）に再表示できる。
//   ① 取引番号を入力して探す（例: R000123 ／ 123 だけでも可。全角も可）
//   ② 「最近の取引」の一覧（新しい順に20件ずつ）から選ぶ
// 履歴画面はバーコード認証（history-auth-modal）を通った後にしか開けないので、
// このボタンも同じ認証の内側にある。
//
// register.js / index.html / 各レシート追加機能ファイルは直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【仕組み】
// generateReceiptHTML()（register.js）は、履歴のレコードではなく、レジの
// 「いまの会計の状態」（cart・billingAmount・selectedPayment など）を読んで
// レシートを組み立てる。そこで再発行では、
//   1. いまの会計の状態を退避する
//   2. 履歴レコードの内容（cartSnapshot・合計・支払方法など）を一時的に入れる
//   3. generateReceiptHTML() を呼ぶ（他の追加機能ファイルのフックも通る）
//   4. すぐにいまの会計の状態へ戻す
// という流れにしている。レジで入力中のカートがあっても消えたり混ざったり
// しない。組み立てはこの一連の間に同期的に終わるので、途中で他の処理が
// 割り込むことはない。
//
// 【再発行のときだけ変えている動き】
// ・レシート上部に「【再発行】」と再発行した日時を入れ、「日時:」は元の取引の
//   日時にする（元のレシートと区別できるようにするため）。
// ・取引番号（history-receipt-number-system.js）・呼び出し番号
//   （call-number-receipt-print.js）は、どちらも「一番新しい会計」ではなく
//   再発行する取引のものを印字する。取引番号が無い古い取引では、番号を
//   新しく採番せず、印字もしない（履歴のデータは一切書き換えない）。
// ・商品連動クーポン（receipt-coupon-system.js）は印字しない
//   （再発行で同じクーポンが何枚も出せてしまうのを防ぐため）。
// ・客用画面の「お会計完了画像」のアニメーションは出さない。
// ・レシート画面を閉じる時に、レジの入力中のカート等を消してしまわない
//   （通常の会計後の closeReceiptPrintModal() は、カートなどを全部リセットする
//   作りのため、再発行中だけは画面を閉じるだけにしている）。閉じたあとは
//   再発行の一覧に戻る。
// ・「累計ポイント残高」は、その取引の時点ではなく現在の残高なので、
//   「現在のポイント残高」という表記に変えている。
//
// 【再発行できない取引】
// 明細データ（cartSnapshot）が保存されていない古い取引は、税率ごとの内訳を
// 再現できないため、一覧では「再発行不可」と表示する。
//
// 【導入方法】
// index.html内で、history-receipt-number-system.js ／ call-number-receipt-print.js
// ／ receipt-coupon-system.js より後ろに読み込んでください
// （読み込み順が違っていても、対象の関数が現れるまで待つので動きます）。
//   <script src="receipt-reissue-system.js"></script>
// ==========================================

(function receiptReissueSystem() {
    const PAGE_SIZE = 20;
    let shownCount = PAGE_SIZE;

    /* ---------------------------------------------------------
       共通ヘルパー
       --------------------------------------------------------- */
    function esc(s) {
        return (typeof escapeHtml === 'function')
            ? escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function getHistory() {
        try {
            const list = JSON.parse(localStorage.getItem('pos_history') || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function hasDetail(rec) {
        return !!(rec && Array.isArray(rec.cartSnapshot) && rec.cartSnapshot.length > 0);
    }

    // 対象の関数が読み込まれるまで待ってから、1回だけ包み直す
    // （optional=true の場合は、一定時間待っても現れなければ諦める）
    function hookWhenReady(name, makeWrapper, optional) {
        let tries = 0;
        function tryHook() {
            if (typeof window[name] !== 'function') {
                tries++;
                if (optional && tries > 100) return;
                setTimeout(tryHook, 300);
                return;
            }
            if (window[name].__receiptReissueApplied) return; // 二重に包まない
            const wrapped = makeWrapper(window[name]);
            wrapped.__receiptReissueApplied = true;
            window[name] = wrapped;
        }
        tryHook();
    }

    // 再発行の対象（generateReceiptHTML() の実行中だけセットされる）
    function currentTarget() {
        return window.__receiptReissueTarget || null;
    }

    // 「取引番号 R000123」の形へそろえる（123 / r123 / Ｒ０００１２３ など全部 R000123 に）
    function normalizeReceiptNoInput(raw) {
        const half = String(raw || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).trim();
        const digits = half.replace(/\D/g, '');
        if (!digits) return '';
        const n = parseInt(digits, 10);
        if (!n) return '';
        return (typeof formatReceiptNo === 'function') ? formatReceiptNo(n) : 'R' + String(n).padStart(6, '0');
    }

    /* ---------------------------------------------------------
       ① 再発行のときだけ、他のレシート追加機能の動きを切り替えるフック
       --------------------------------------------------------- */

    // 取引番号：一番新しい会計ではなく、再発行する取引の番号を印字する（採番はしない）
    hookWhenReady('appendReceiptNoToReceipt', (original) => function (...args) {
        const t = currentTarget();
        if (!t) return original.apply(this, args);

        const content = document.getElementById('print-receipt-content');
        if (!content || !t.receiptNo) return;
        const div = document.createElement('div');
        div.id = 'receipt-no-row';
        div.style.cssText = 'text-align:center; font-size:12px; color:#555; margin-top:10px;';
        div.textContent = `取引番号: ${t.receiptNo}`;
        content.appendChild(div);
    });

    // 呼び出し番号：同じく、再発行する取引の番号を印字する
    hookWhenReady('appendCallNumberToReceipt', (original) => function (...args) {
        const t = currentTarget();
        if (!t) return original.apply(this, args);

        if (typeof isShowCallNumberEnabled !== 'function' || !isShowCallNumberEnabled()) return;
        const content = document.getElementById('print-receipt-content');
        if (!content || !t.callNumber) return;

        const old = document.getElementById('receipt-call-number-block');
        if (old) old.remove();

        const formatted = (typeof formatCallNumber === 'function')
            ? formatCallNumber(t.callNumber)
            : String(t.callNumber).padStart(3, '0');
        const block = document.createElement('div');
        block.id = 'receipt-call-number-block';
        block.style.cssText = 'text-align:center; margin-top:18px; padding-top:12px; border-top:2px dashed #333;';
        block.innerHTML = `
            <div style="font-size:12px; letter-spacing:0.1em; color:#555;">よびだしばんごう</div>
            <div style="font-size:40px; font-weight:900; font-family:monospace; line-height:1.2;">${esc(formatted)}</div>
        `;
        content.appendChild(block);
    });

    // 商品連動クーポン：再発行では印字しない（何枚も出せてしまうのを防ぐ）
    hookWhenReady('getMatchedCouponsForCart', (original) => function (...args) {
        if (currentTarget()) return [];
        return original.apply(this, args);
    }, true);

    // 客用画面の「お会計完了画像」アニメーション：再発行では出さない
    hookWhenReady('triggerCheckoutCompleteImage', (original) => function (...args) {
        if (currentTarget()) return;
        return original.apply(this, args);
    }, true);

    // レシート画面を閉じる：再発行中は、画面を閉じるだけにする
    // （通常の closeReceiptPrintModal() はカート等をすべてリセットするため）
    hookWhenReady('closeReceiptPrintModal', (original) => function (...args) {
        if (!window.__receiptReissueActive) return original.apply(this, args);

        window.__receiptReissueActive = false;
        if (typeof playSound === 'function') playSound('click');
        const printModal = document.getElementById('receipt-print-modal');
        if (printModal) printModal.style.display = 'none';
        showReissueModal(true); // 再発行の一覧に戻る（入力内容・表示件数はそのまま）
    });

    /* ---------------------------------------------------------
       ② 再発行の実行：いまの会計の状態を退避 → 履歴の内容を入れて
          generateReceiptHTML() → すぐ元に戻す
       --------------------------------------------------------- */
    function findCustomerByBarcode(barcode) {
        if (!barcode || typeof customers === 'undefined' || !Array.isArray(customers)) return null;
        return customers.find((c) => c && c.barcode === barcode) || null;
    }

    function decorateReissuedReceipt(rec) {
        const content = document.getElementById('print-receipt-content');
        if (!content) return;

        Array.from(content.children).forEach((el) => {
            const text = (el.textContent || '').trim();
            // 「日時:」は元の取引の日時にする
            if (text.indexOf('日時:') === 0) {
                el.textContent = `日時: ${rec.date || (rec.dateISO ? new Date(rec.dateISO).toLocaleString() : '')}`;
            }
            // 累計ポイント残高は、その取引の時点ではなく現在の残高
            if (text.indexOf('累計ポイント残高') === 0) {
                const label = el.querySelector('span');
                if (label) label.textContent = '現在のポイント残高:';
            }
        });

        const banner = document.createElement('div');
        banner.id = 'receipt-reissue-banner';
        banner.style.cssText = 'text-align:center; font-weight:bold; color:#c62828; border:2px solid #c62828; border-radius:4px; padding:4px 0; margin-bottom:8px;';
        banner.innerHTML = `【 再 発 行 】<div style="font-size:11px; font-weight:normal;">再発行日時: ${esc(new Date().toLocaleString())}</div>`;
        content.insertBefore(banner, content.firstChild);
    }

    function reissueReceipt(rec) {
        if (!hasDetail(rec)) {
            setReissueError('この取引は明細データが無いため、再発行できません（古い取引）。');
            return;
        }
        if (typeof generateReceiptHTML !== 'function') {
            setReissueError('レシート機能が読み込まれていません。ページを開き直してください。');
            return;
        }

        showReissueModal(false); // 一覧を隠して、レシート画面を前面に出す

        const saved = {
            cart, activeClerkName, usedPoints, billingAmount, selectedPayment,
            activeCustomer, currentDeposit, currentChange, earnedPointsThisTime
        };
        window.__receiptReissueTarget = rec;
        try {
            cart = JSON.parse(JSON.stringify(rec.cartSnapshot));
            activeClerkName = rec.clerk || '';
            usedPoints = Number(rec.pointsUsed) || 0;
            billingAmount = Number(rec.total) || 0;
            selectedPayment = rec.payment || '現金';
            currentDeposit = Number(rec.deposit) || 0;
            currentChange = Number(rec.change) || 0;
            earnedPointsThisTime = Number(rec.pointsEarned) || 0;
            activeCustomer = findCustomerByBarcode(rec.customerBarcode);

            window.__receiptReissueActive = true;
            generateReceiptHTML(false);
            decorateReissuedReceipt(rec);
        } catch (err) {
            console.error('レシートの再発行に失敗しました:', err);
            window.__receiptReissueActive = false;
            const printModal = document.getElementById('receipt-print-modal');
            if (printModal) printModal.style.display = 'none';
            showReissueModal(true); // 一覧に戻して、エラーを表示する
            setReissueError('レシートの再発行に失敗しました。');
        } finally {
            // いまの会計の状態を、必ず元へ戻す
            cart = saved.cart;
            activeClerkName = saved.activeClerkName;
            usedPoints = saved.usedPoints;
            billingAmount = saved.billingAmount;
            selectedPayment = saved.selectedPayment;
            activeCustomer = saved.activeCustomer;
            currentDeposit = saved.currentDeposit;
            currentChange = saved.currentChange;
            earnedPointsThisTime = saved.earnedPointsThisTime;
            window.__receiptReissueTarget = null;
        }
    }

    /* ---------------------------------------------------------
       ③ 再発行の画面（取引番号の入力＋最近の取引の一覧）
       --------------------------------------------------------- */
    function ensureReissueModal() {
        let modal = document.getElementById('receipt-reissue-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'receipt-reissue-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box" style="width:min(560px, 94vw); max-height:90vh; overflow-y:auto; box-sizing:border-box;">
                <h3 class="modal-title navy" style="text-align:center;">🧾 レシート再発行</h3>
                <p class="modal-desc" style="text-align:center;">取引番号を入力するか、下の一覧から選んでください。</p>
                <div style="display:flex; gap:8px;">
                    <input id="receipt-reissue-no-input" class="modal-input" placeholder="取引番号（例: R000123 ／ 123）" autocomplete="off">
                    <button id="receipt-reissue-search-btn" class="modal-btn blue" style="flex:none; padding:8px 18px;">探す</button>
                </div>
                <div id="receipt-reissue-error" style="color:#c62828; font-size:12px; min-height:18px; margin:6px 0;"></div>
                <div style="font-weight:bold; margin:4px 0;">最近の取引</div>
                <table class="data-table" style="margin-top:4px;">
                    <thead><tr><th>日時</th><th>取引番号</th><th>合計</th><th>支払</th><th></th></tr></thead>
                    <tbody id="receipt-reissue-tbody"></tbody>
                </table>
                <div style="text-align:center; margin:8px 0;">
                    <button id="receipt-reissue-more-btn" class="select-btn" style="background:#78909c;">さらに${PAGE_SIZE}件表示</button>
                </div>
                <div class="modal-btn-group">
                    <button id="receipt-reissue-close-btn" class="modal-btn cancel">閉じる</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const input = modal.querySelector('#receipt-reissue-no-input');
        if (typeof applyAutoHalfWidth === 'function') {
            try { applyAutoHalfWidth('receipt-reissue-no-input'); } catch (e) { /* 無視 */ }
        }
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); searchByReceiptNo(); }
        });
        modal.querySelector('#receipt-reissue-search-btn').addEventListener('click', searchByReceiptNo);
        modal.querySelector('#receipt-reissue-more-btn').addEventListener('click', () => {
            shownCount += PAGE_SIZE;
            renderReissueList();
        });
        modal.querySelector('#receipt-reissue-close-btn').addEventListener('click', closeReissueModal);
        return modal;
    }

    function setReissueError(msg) {
        const el = document.getElementById('receipt-reissue-error');
        if (el) el.textContent = msg || '';
        if (msg && typeof playSound === 'function') playSound('error');
    }

    function renderReissueList() {
        const tbody = document.getElementById('receipt-reissue-tbody');
        const moreBtn = document.getElementById('receipt-reissue-more-btn');
        if (!tbody) return;

        const history = getHistory();
        const rows = history.slice(0, shownCount);

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#999;">まだお会計の履歴がありません</td></tr>';
        } else {
            tbody.innerHTML = rows.map((rec, i) => {
                const ok = hasDetail(rec);
                const total = Number(rec.total) || 0;
                return `<tr>
                    <td style="font-size:12px;">${esc(rec.date || '')}</td>
                    <td style="font-family:monospace; font-weight:bold; color:#0277bd; white-space:nowrap;">${esc(rec.receiptNo || '—')}</td>
                    <td style="white-space:nowrap;">¥${total.toLocaleString()}</td>
                    <td style="font-size:12px;">${esc(rec.payment || '')}</td>
                    <td>${ok
                        ? `<button class="select-btn" data-reissue-index="${i}">再発行</button>`
                        : '<span style="font-size:11px; color:#999;">再発行不可</span>'}</td>
                </tr>`;
            }).join('');

            tbody.querySelectorAll('button[data-reissue-index]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const rec = getHistory()[parseInt(btn.dataset.reissueIndex, 10)];
                    reissueReceipt(rec);
                });
            });
        }
        if (moreBtn) moreBtn.style.display = history.length > shownCount ? 'inline-block' : 'none';
    }

    function searchByReceiptNo() {
        const input = document.getElementById('receipt-reissue-no-input');
        if (!input) return;
        const target = normalizeReceiptNoInput(input.value);
        if (!target) {
            setReissueError('取引番号を入力してください（例: R000123 ／ 123）。');
            return;
        }
        const rec = getHistory().find((r) => r && r.receiptNo === target);
        if (!rec) {
            setReissueError(`取引番号 ${target} の取引は見つかりませんでした。`);
            return;
        }
        setReissueError('');
        reissueReceipt(rec);
    }

    function showReissueModal(show, resetInput) {
        const modal = ensureReissueModal();
        if (!show) {
            modal.style.display = 'none';
            return;
        }
        if (resetInput) {
            shownCount = PAGE_SIZE;
            const input = document.getElementById('receipt-reissue-no-input');
            if (input) input.value = '';
            setReissueError('');
        }
        renderReissueList();
        modal.style.display = 'flex';
        const input = document.getElementById('receipt-reissue-no-input');
        if (input && resetInput) setTimeout(() => input.focus(), 50);
    }

    function openReceiptReissueModal() {
        if (typeof playSound === 'function') playSound('click');
        showReissueModal(true, true);
    }

    function closeReissueModal() {
        if (typeof playSound === 'function') playSound('click');
        showReissueModal(false);
    }

    window.openReceiptReissueModal = openReceiptReissueModal;

    /* ---------------------------------------------------------
       ④ 履歴画面にボタンを追加する
       --------------------------------------------------------- */
    function injectReissueButton() {
        const container = document.querySelector('#history-screen .history-btn-container');
        if (!container) return false;
        if (container.querySelector('#receipt-reissue-open-btn')) return true;

        const btn = document.createElement('button');
        btn.id = 'receipt-reissue-open-btn';
        btn.className = 'select-btn';
        btn.style.cssText = 'background:#0277bd;';
        btn.textContent = '🧾 レシート再発行';
        btn.addEventListener('click', openReceiptReissueModal);
        container.insertBefore(btn, container.firstChild);
        return true;
    }

    (function tryInjectButton() {
        function attempt() {
            if (!injectReissueButton()) setTimeout(attempt, 300);
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attempt);
        } else {
            attempt();
        }
    })();
})();
