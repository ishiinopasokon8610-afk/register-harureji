// ==========================================
// touch-panel-hide-product-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js /
// product-variant-system.js を直接編集せず、他の追加機能ファイルと
// 同じ「フック/DOM注入方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回追加したいこと】
// 商品管理画面で、商品を「個別に」選んで「タッチパネルには表示しない」
// を設定できるようにする（例：レジ担当者しか使わない裏メニュー的な
// 商品や、テスト用に登録しただけの商品を、お客様用タッチパネルの
// メニュー一覧から隠したい、というケース向け）。
//
// レジ本体のボタン（generateCustomButtons）には一切影響しない。
// あくまで「客用／店員用タッチパネルのメニュー画面に出すかどうか」
// だけを切り替える機能。
//
// 【データ構造】
// 商品データ（products配列）自体は書き換えず、product-variant-system.js
// の pos_product_variants と同じ考え方で、別のlocalStorageキーに
// JANコードをキーにしたオブジェクトとして保持する。
//   pos_touch_panel_hidden_jans = {
//     "<JANコード>": true,   // タッチパネルに表示しない
//     ...
//   }
// 存在しない・値がfalseのJANは「通常通り表示する」扱い。
//
// 【商品管理画面での挙動】
// product-screenのtop-barに「🚫 タッチパネル非表示設定」ボタンを追加する
// （product-variant-system.jsの「🎨 バリエーション設定」ボタンと同じ
// 差し込み方式・見た目）。
// 押すと、登録済み商品がジャンルごとのカード一覧で表示されるモーダルが
// 開き、カードをタップするたびに「表示中 ⇔ 🚫 非表示」がその場で
// 切り替わる（バリエーション設定のような別画面の編集ステップは無く、
// タップ＝即トグルの一段階にしている）。
//
// 【タッチパネル側の挙動】
// touch-panel-order-system.js の getProductListForTouchPanel() を
// フックし、その戻り値から「非表示」指定されたJANの商品を除外する。
// メニューグリッド・ジャンル別サイドバー・「すべて」タブの横スクロール
// 帯・検索結果は、すべてこの関数経由で商品一覧を取得しているため、
// ここ1箇所をフックするだけで全体に反映される。
//
// 【前提にしていること】
// ・product-variant-system.js が先に読み込まれていて、
// 　getProductListForVariantsSafe()（商品一覧を安全に取得する共通関数）
// 　がグローバルに存在すること（商品管理画面のモーダル用に流用する）。
// ・touch-panel-order-system.js が先に読み込まれていて、
// 　getProductListForTouchPanel() がグローバルに存在すること。
//
// 【導入方法】
// index.html内で、product-variant-system.js と touch-panel-order-system.js
// の両方より後ろであれば、どこでも構わない。
// ==========================================

(function () {
    'use strict';

    const TP_HIDDEN_PRODUCTS_KEY = 'pos_touch_panel_hidden_jans';

    /* =========================================================
       商品管理画面のtop-barは「左から順にボタンを積んでいく」作りに
       なっており、折り返し設定が無い。XLSX出力・バリエーション設定
       ボタンに続けて今回のボタンを追加すると、画面幅によっては
       右端からはみ出して見えなくなる（＝「ボタンが無い」ように
       見えてしまう）ことがあったため、top-barが画面に収まりきらない
       場合は折り返して2段目に表示されるようにするCSSを追加しておく。
       ========================================================= */
    (function injectTopBarWrapStyle() {
        if (document.getElementById('tp-hide-admin-topbar-wrap-style')) return;
        const style = document.createElement('style');
        style.id = 'tp-hide-admin-topbar-wrap-style';
        style.textContent = `
            #product-screen .top-bar {
                flex-wrap: wrap !important;
                row-gap: 8px !important;
            }
        `;
        document.head.appendChild(style);
    })();

    /* =========================================================
       データ層
       ========================================================= */
    function getTouchPanelHiddenJanMap() {
        try {
            return JSON.parse(localStorage.getItem(TP_HIDDEN_PRODUCTS_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function isProductHiddenFromTouchPanel(jan) {
        if (!jan) return false;
        const map = getTouchPanelHiddenJanMap();
        return !!map[jan];
    }

    function setProductHiddenFromTouchPanel(jan, hidden) {
        if (!jan) return;
        const map = getTouchPanelHiddenJanMap();
        if (hidden) {
            map[jan] = true;
        } else {
            delete map[jan];
        }
        localStorage.setItem(TP_HIDDEN_PRODUCTS_KEY, JSON.stringify(map));
    }

    function getProductListForHideAdminSafe() {
        if (typeof getProductListForVariantsSafe === 'function') return getProductListForVariantsSafe();
        try {
            if (typeof products !== 'undefined' && Array.isArray(products)) return products;
            return JSON.parse(localStorage.getItem('pos_products') || '[]');
        } catch (e) {
            return [];
        }
    }

    /* =========================================================
       タッチパネル側：商品一覧から非表示指定を除外する
       ========================================================= */
    function tryHookTouchPanelProductList() {
        if (typeof window.getProductListForTouchPanel !== 'function') {
            setTimeout(tryHookTouchPanelProductList, 300);
            return;
        }
        const original = window.getProductListForTouchPanel;
        window.getProductListForTouchPanel = function (...args) {
            const list = original.apply(this, args);
            if (!Array.isArray(list)) return list;
            return list.filter(p => !isProductHiddenFromTouchPanel(p && p.jan));
        };
    }
    tryHookTouchPanelProductList();

    /* =========================================================
       商品管理画面：top-barにボタンを追加
       ========================================================= */
    function ensureTouchPanelHideAdminButton() {
        if (document.getElementById('tp-hide-admin-btn')) return;
        const topBar = document.querySelector('#product-screen .top-bar');
        if (!topBar) return;

        const btn = document.createElement('button');
        btn.id = 'tp-hide-admin-btn';
        btn.className = 'csv-export-btn';
        btn.innerText = '🚫 タッチパネル非表示設定';
        btn.style.marginLeft = '8px';
        btn.onclick = openTouchPanelHideAdminModal;

        topBar.appendChild(btn);
    }

    (function hookShowScreenForHideAdminButton() {
        function tryHook() {
            if (typeof window.showScreen !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            const original = window.showScreen;
            window.showScreen = function (screenId, ...rest) {
                const result = original.apply(this, [screenId, ...rest]);
                if (screenId === 'product-screen') ensureTouchPanelHideAdminButton();
                return result;
            };
        }
        tryHook();
    })();

    // 【追加の保険】
    // index.htmlにはshowScreen()を上書きしているファイルが他にも多数あり、
    // その中のどれかが「元の関数を呼ばずに丸ごと差し替えて」いた場合、
    // 上のフックだけでは（それより後に読み込まれる限り）ボタンが
    // 差し込まれないことがある。そのため、showScreenのフックに頼らず、
    // 「#product-screen 自体に active クラスが付いたかどうか」を
    // MutationObserverで直接監視する方式も、保険として並行して仕込んでおく。
    // ensureTouchPanelHideAdminButton() は二重に呼ばれても安全
    // （既にボタンがあれば何もしない）ため、両方仕込んでも問題ない。
    (function watchProductScreenActiveClass() {
        function trySetup() {
            const screen = document.getElementById('product-screen');
            if (!screen) {
                setTimeout(trySetup, 300);
                return;
            }
            const check = () => {
                if (screen.classList.contains('active')) ensureTouchPanelHideAdminButton();
            };
            new MutationObserver(check).observe(screen, { attributes: true, attributeFilter: ['class'] });
            check(); // 仕込んだ時点で既にactiveになっている場合にも対応
        }
        trySetup();
    })();

    /* =========================================================
       商品管理画面：非表示設定モーダル
       ========================================================= */
    function ensureTouchPanelHideAdminModal() {
        let modal = document.getElementById('tp-hide-admin-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'tp-hide-admin-modal';
        modal.style.cssText = [
            'display:none', 'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.5)',
            'z-index:9000', 'align-items:center', 'justify-content:center'
        ].join(';');

        modal.innerHTML = `
            <div style="background:#fff; width:min(760px, 94vw); max-height:88vh; border-radius:10px; padding:16px; display:flex; flex-direction:column;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; gap:10px;">
                    <h3 style="margin:0; white-space:nowrap;">🚫 タッチパネル非表示設定</h3>
                    <input type="text" id="tp-hide-admin-search" placeholder="商品名で検索..." autocomplete="off"
                        style="flex:1; min-width:0; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:14px; box-sizing:border-box;">
                    <button type="button" id="tp-hide-admin-close" style="padding:6px 14px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; white-space:nowrap;">閉じる ✕</button>
                </div>
                <div style="font-size:12px; color:#888; margin-bottom:10px;">商品カードをタップするたびに「表示中 ⇔ 🚫 非表示」が切り替わります（レジ本体のボタンには影響しません）。</div>
                <div id="tp-hide-admin-list-body" style="overflow-y:auto; max-height:65vh; padding-right:4px;"></div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#tp-hide-admin-close').addEventListener('click', closeTouchPanelHideAdminModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeTouchPanelHideAdminModal(); });
        modal.querySelector('#tp-hide-admin-search').addEventListener('input', (e) => renderTouchPanelHideAdminList(e.target.value));

        return modal;
    }

    function closeTouchPanelHideAdminModal() {
        const modal = document.getElementById('tp-hide-admin-modal');
        if (modal) modal.style.display = 'none';
    }

    function openTouchPanelHideAdminModal() {
        if (typeof playSound === 'function') playSound('click');
        ensureTouchPanelHideAdminModal();
        const search = document.getElementById('tp-hide-admin-search');
        if (search) search.value = '';
        renderTouchPanelHideAdminList('');
        const modal = document.getElementById('tp-hide-admin-modal');
        modal.style.display = 'flex';
    }

    function renderTouchPanelHideAdminList(query) {
        const body = document.getElementById('tp-hide-admin-list-body');
        if (!body) return;
        body.innerHTML = '';

        const q = (query || '').trim().toLowerCase();
        const productList = getProductListForHideAdminSafe();
        const filtered = !q ? productList : productList.filter(p => (p.name || '').toLowerCase().includes(q));

        if (filtered.length === 0) {
            body.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">該当する商品が見つかりません。</p>';
            return;
        }

        const grouped = {};
        filtered.forEach(p => {
            const genre = p.genre || 'その他商品';
            if (!grouped[genre]) grouped[genre] = [];
            grouped[genre].push(p);
        });

        Object.keys(grouped).sort().forEach(genre => {
            const section = document.createElement('div');
            section.style.marginBottom = '14px';

            const heading = document.createElement('div');
            heading.style.cssText = 'font-weight:bold; color:#555; margin:6px 0; font-size:13px;';
            heading.innerText = genre;
            section.appendChild(heading);

            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px;';

            grouped[genre].forEach(p => {
                const card = document.createElement('button');
                card.type = 'button';
                card.dataset.jan = p.jan;
                renderTouchPanelHideAdminCardState(card, p);
                card.addEventListener('click', () => {
                    const nowHidden = isProductHiddenFromTouchPanel(p.jan);
                    setProductHiddenFromTouchPanel(p.jan, !nowHidden);
                    if (typeof playSound === 'function') playSound('click');
                    renderTouchPanelHideAdminCardState(card, p);
                });
                grid.appendChild(card);
            });

            section.appendChild(grid);
            body.appendChild(section);
        });
    }

    function renderTouchPanelHideAdminCardState(card, p) {
        const hidden = isProductHiddenFromTouchPanel(p.jan);
        card.style.cssText = [
            'padding:12px 10px', 'border:2px solid', hidden ? 'border-color:#e53935;' : 'border-color:#ddd;',
            'border-radius:10px', hidden ? 'background:#fff3f2;' : 'background:#fafafa;',
            'cursor:pointer', 'font-size:13px', 'font-weight:bold', 'text-align:center'
        ].join(';');
        const safeName = (typeof escapeHtml === 'function') ? escapeHtml(p.name) : p.name;
        card.innerHTML = `${safeName}${hidden ? '<br><small style="color:#e53935; font-weight:normal;">🚫 非表示</small>' : '<br><small style="color:#43a047; font-weight:normal;">👁️ 表示中</small>'}`;
    }
})();
