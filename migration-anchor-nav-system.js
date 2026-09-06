// ==========================================
// migration-anchor-nav-system.js（改訂版 v3）
// 【v3での修正】
// データ管理画面（#migration-screen）からアプリ内の別画面に切り替えた際、
// showScreen()フックの分岐でスマホ用ドロワーを閉じる処理・スクロール監視の
// 停止処理は行っていたが、PC・タブレット幅で常時表示している
// #migration-anchor-nav（サイドバー本体）自体は非表示にしていなかったため、
// 別のページに移動してもサイドバーが画面上に残り続けてしまう不具合が
// あった。hideMigrationAnchorNav() を追加し、画面を離れる際にサイドバー・
// 開閉ボタン・本文の余白(migration-has-sidebar)をまとめて解除するように
// 修正した（データ管理画面に戻った際は、既存のscheduleMigrationNavRebuild()
// が再度サイドバーを組み立てて表示を復元する）。
// ------------------------------------------
// データ管理・ロゴ設定画面（#migration-screen）の各設定ブロックに
// アンカー（id）を振り、画面の「サイドバー」に見出しナビゲーションを表示する。
// 項目をクリック（タップ）すると、その設定ブロックまで自動的にスムーズ
// スクロールする。
// ------------------------------------------
// 【v2での改訂内容】
// 以前は画面上部に「横スクロールのヘッダーバー」として表示していたが、
// 画面左側に固定表示する「サイドバー」形式に変更した。
//   ・PC・タブレット幅：画面左端に常時表示の縦型サイドバーとして表示し、
//     本文（各設定ブロック）はサイドバーの幅ぶん右にずらして重ならない
//     ようにする。
//   ・スマホ幅（画面幅 640px 以下）：常時表示のサイドバーだと本文を
//     大きく圧迫してしまうため、普段は画面外に隠しておき、左下の
//     「☰ 項目」ボタンを押した時だけ左からスライドインする開閉式の
//     ドロワーに切り替える。項目をタップすると自動的に閉じる。
// 画面幅が変わった時（回転・リサイズ）にも自動で両モードを切り替える。
// ------------------------------------------
// 【背景】
// データ管理画面には「ロゴ登録」「バックアップ」「初期化」「客画面用画像」
// 「客用ディスプレイ設定」「店長バーコード変更」など複数の設定ブロックが
// 縦に並んでおり、他の追加機能ファイル（tax-exclusive-pricing-system.js等）
// が独自にブロックを追加することもあるため、項目数は固定ではない。
//
// 【この機能】
//   ① #migration-screen 内にある .migration-title を持つブロックを
//      すべて自動的に検出し、それぞれに一意のidを振る
//      （すでにidがある場合はそれを尊重する）。
//   ② 画面左側に「タップでジャンプ」できる見出しボタンの縦並び
//      （サイドバー）を追加する。押すと該当ブロックまでスムーズスクロール
//      し、URLハッシュも #settings/<ブロックid> に更新する
//      （ブラウザの戻るボタンでも辿れるようにするため）。
//   ③ 後から動的にブロックが追加／削除された場合（他の追加機能ファイルが
//      migration-screen にブロックを注入する場合など）にも自動で
//      ナビゲーションを更新する（MutationObserverで監視）。
//   ④ スクロール中も「今どのブロックを見ているか」に応じてサイドバーの
//      該当ボタンが自動でハイライトされる（IntersectionObserver）。
//
// register.js / ui.js / index.html / style.css は直接編集せず、
// showScreen() をフックし、DOMの注入と<style>の動的挿入だけで実現する
// （他の追加機能ファイルと同じ方式）。
// ==========================================

const MIGRATION_NAV_ID = 'migration-anchor-nav';
const MIGRATION_NAV_MOBILE_QUERY = '(max-width: 640px)';
let migrationNavRebuildTimer = null;
let migrationSectionObserver = null;
let migrationNavResizeHandlerAttached = false;

function isMigrationNavMobileMode() {
    return typeof window.matchMedia === 'function'
        ? window.matchMedia(MIGRATION_NAV_MOBILE_QUERY).matches
        : window.innerWidth <= 640;
}

function ensureMigrationAnchorNavStyle() {
    if (document.getElementById('migration-anchor-nav-style')) return;
    const style = document.createElement('style');
    style.id = 'migration-anchor-nav-style';
    style.textContent = `
        /* ---- サイドバー本体（PC・タブレットでは常時表示の左サイドバー） ---- */
        #${MIGRATION_NAV_ID} {
            position: fixed;
            left: 0;
            top: 90px;
            bottom: 0;
            width: 190px;
            z-index: 500;
            display: flex;
            flex-direction: column;
            gap: 6px;
            overflow-y: auto;
            background: #fafafa;
            border-right: 1px solid #e0e0e0;
            padding: 12px 10px;
            box-sizing: border-box;
            -webkit-overflow-scrolling: touch;
            transition: transform 0.25s ease;
        }
        #${MIGRATION_NAV_ID} .migration-anchor-btn {
            flex: 0 0 auto;
            width: 100%;
            box-sizing: border-box;
            text-align: left;
            padding: 9px 12px;
            border: 1px solid #90caf9;
            background: #e3f2fd;
            color: #1565c0;
            border-radius: 8px;
            font-size: 12.5px;
            font-weight: bold;
            line-height: 1.35;
            cursor: pointer;
            white-space: normal;
            word-break: break-word;
        }
        #${MIGRATION_NAV_ID} .migration-anchor-btn:active {
            background: #bbdefb;
        }
        #${MIGRATION_NAV_ID} .migration-anchor-btn.active {
            background: #1565c0;
            color: #fff;
            border-color: #1565c0;
        }

        /* サイドバーの分だけ本文を右にずらす（PC・タブレット幅のみ） */
        #migration-screen.migration-has-sidebar {
            padding-left: 212px;
            box-sizing: border-box;
        }

        /* ---- スマホ幅（640px以下）：開閉式のドロワーに切り替える ---- */
        #migration-nav-toggle-btn {
            display: none;
        }
        #migration-nav-backdrop {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.35);
            z-index: 499;
        }
        @media ${MIGRATION_NAV_MOBILE_QUERY} {
            #${MIGRATION_NAV_ID} {
                top: 0;
                width: 74vw;
                max-width: 260px;
                transform: translateX(-100%);
                box-shadow: 2px 0 12px rgba(0, 0, 0, 0.3);
                padding-top: 60px;
            }
            #${MIGRATION_NAV_ID}.open {
                transform: translateX(0);
            }
            #migration-screen.migration-has-sidebar {
                /* スマホでは常時の余白は不要（ドロワーは本文の上に重ねて表示するため） */
                padding-left: 15px;
            }
            #migration-nav-toggle-btn {
                display: flex;
                align-items: center;
                gap: 6px;
                position: fixed;
                left: 14px;
                bottom: 14px;
                z-index: 501;
                padding: 12px 16px;
                border: none;
                border-radius: 24px;
                background: #1565c0;
                color: #fff;
                font-size: 13px;
                font-weight: bold;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
                cursor: pointer;
            }
            #migration-nav-backdrop.show {
                display: block;
            }
        }
    `;
    document.head.appendChild(style);
}

// 絵文字などを除いた見出しの短いラベルを作る（長すぎるとボタンが太くなるため）
function shortenMigrationTitleLabel(text) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned.length > 22 ? cleaned.slice(0, 22) + '…' : cleaned;
}

// 画面上部バー（.top-bar）の高さぶんだけサイドバーの開始位置を下げる
// （PC・タブレット表示時のみ意味を持つ。スマホ表示は常にtop:0固定）
function updateMigrationNavTopOffset() {
    const nav = document.getElementById(MIGRATION_NAV_ID);
    if (!nav || isMigrationNavMobileMode()) return;

    const container = document.getElementById('migration-screen');
    const topBar = container ? container.querySelector('.top-bar') : null;
    const offset = topBar ? Math.ceil(topBar.getBoundingClientRect().height) + 15 : 90;
    nav.style.top = offset + 'px';

    const toggleBtn = document.getElementById('migration-nav-toggle-btn');
    if (toggleBtn) toggleBtn.dataset.topOffset = String(offset);

    return offset;
}

function openMigrationNavDrawer() {
    const nav = document.getElementById(MIGRATION_NAV_ID);
    const backdrop = document.getElementById('migration-nav-backdrop');
    if (nav) nav.classList.add('open');
    if (backdrop) backdrop.classList.add('show');
}

function closeMigrationNavDrawer() {
    const nav = document.getElementById(MIGRATION_NAV_ID);
    const backdrop = document.getElementById('migration-nav-backdrop');
    if (nav) nav.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
}

// データ管理画面から他の画面に移動する時に呼ぶ。
// サイドバー本体・開閉ボタンを非表示にし、本文の余白(migration-has-sidebar)も
// 解除することで、別ページにサイドバーが残り続けるのを防ぐ。
// データ管理画面に戻った際は buildMigrationAnchorNav() が
// display / クラスを元に戻して再表示する。
function hideMigrationAnchorNav() {
    const nav = document.getElementById(MIGRATION_NAV_ID);
    const toggleBtn = document.getElementById('migration-nav-toggle-btn');
    if (nav) nav.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'none';
    document.querySelectorAll('.migration-has-sidebar').forEach(el => {
        el.classList.remove('migration-has-sidebar');
    });
}

function ensureMigrationNavMobileControls() {
    if (!document.getElementById('migration-nav-backdrop')) {
        const backdrop = document.createElement('div');
        backdrop.id = 'migration-nav-backdrop';
        backdrop.addEventListener('click', closeMigrationNavDrawer);
        document.body.appendChild(backdrop);
    }
    if (!document.getElementById('migration-nav-toggle-btn')) {
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'migration-nav-toggle-btn';
        toggleBtn.type = 'button';
        toggleBtn.innerText = '☰ 項目';
        toggleBtn.setAttribute('aria-label', '設定項目メニューを開く');
        toggleBtn.addEventListener('click', () => {
            const nav = document.getElementById(MIGRATION_NAV_ID);
            const isOpen = nav && nav.classList.contains('open');
            if (isOpen) {
                closeMigrationNavDrawer();
            } else {
                openMigrationNavDrawer();
            }
            if (typeof playSound === 'function') playSound('click');
        });
        document.body.appendChild(toggleBtn);
    }
}

function buildMigrationAnchorNav() {
    const container = document.getElementById('migration-screen');
    if (!container) return;
    ensureMigrationAnchorNavStyle();
    ensureMigrationNavMobileControls();

    const titleEls = Array.from(container.querySelectorAll('.migration-title'));

    let nav = document.getElementById(MIGRATION_NAV_ID);
    if (!nav) {
        nav = document.createElement('div');
        nav.id = MIGRATION_NAV_ID;
        // サイドバーは画面全体の直下に置く（fixed配置なのでDOM上の位置は
        // 見た目に影響しないが、body直下に置いてスクロール等の影響を受けない
        // ようにする）
        document.body.appendChild(nav);
    }

    // 既存ボタンを作り直す（ブロック数が変わった場合にも対応するため）
    nav.innerHTML = '';

    const toggleBtn = document.getElementById('migration-nav-toggle-btn');

    if (titleEls.length === 0) {
        nav.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
        container.classList.remove('migration-has-sidebar');
        return;
    }
    nav.style.display = 'flex';
    if (toggleBtn) toggleBtn.style.display = '';
    container.classList.add('migration-has-sidebar');

    titleEls.forEach((titleEl, i) => {
        const block = titleEl.closest('.migration-block') || titleEl.parentElement || titleEl;
        if (!block.id) block.id = `migration-section-${i + 1}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'migration-anchor-btn';
        btn.dataset.targetId = block.id;
        btn.innerText = shortenMigrationTitleLabel(titleEl.textContent);
        btn.addEventListener('click', () => {
            const target = document.getElementById(block.id);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (window.location.hash.indexOf('#settings') === 0) {
                history.replaceState(null, '', `#settings/${block.id}`);
            }
            setActiveMigrationNavButton(block.id);
            if (typeof playSound === 'function') playSound('click');
            // スマホのドロワーは項目を選んだら自動で閉じる
            if (isMigrationNavMobileMode()) closeMigrationNavDrawer();
        });
        nav.appendChild(btn);
    });

    updateMigrationNavTopOffset();
    setupMigrationSectionScrollSpy(titleEls.map(titleEl => titleEl.closest('.migration-block') || titleEl.parentElement || titleEl));
}

// スクロールしている最中も、画面上部に近いブロックのボタンを自動でハイライトする
function setupMigrationSectionScrollSpy(blocks) {
    if (migrationSectionObserver) {
        migrationSectionObserver.disconnect();
        migrationSectionObserver = null;
    }
    if (!blocks || blocks.length === 0 || typeof IntersectionObserver !== 'function') return;

    const container = document.getElementById('migration-screen');
    const topBar = container ? container.querySelector('.top-bar') : null;
    const topBarHeight = topBar ? Math.ceil(topBar.getBoundingClientRect().height) : 60;

    migrationSectionObserver = new IntersectionObserver((entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length === 0) return;
        // 画面上部に一番近い（かつ画面内に見えている）ブロックをアクティブにする
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActiveMigrationNavButton(visible[0].target.id);
    }, {
        root: null,
        // サイドバー化により、ナビ自体はもう縦方向のスペースを取らないため、
        // 判定ラインのオフセットは「上部バーの高さ」のみを基準にする
        rootMargin: `-${topBarHeight + 8}px 0px -70% 0px`,
        threshold: 0
    });

    blocks.forEach(block => migrationSectionObserver.observe(block));
}

function stopMigrationSectionScrollSpy() {
    if (migrationSectionObserver) {
        migrationSectionObserver.disconnect();
        migrationSectionObserver = null;
    }
}

function setActiveMigrationNavButton(targetId) {
    const nav = document.getElementById(MIGRATION_NAV_ID);
    if (!nav) return;
    nav.querySelectorAll('.migration-anchor-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.targetId === targetId);
    });
}

// ブロックの追加・削除が起きたら少し待ってからナビゲーションを作り直す
// （複数ファイルがほぼ同時にブロックを注入する場合があるため、まとめて処理する）
function scheduleMigrationNavRebuild() {
    clearTimeout(migrationNavRebuildTimer);
    migrationNavRebuildTimer = setTimeout(buildMigrationAnchorNav, 250);
}

function watchMigrationScreenForNav() {
    const container = document.getElementById('migration-screen');
    if (!container || container.dataset.navObserved === '1') return;
    container.dataset.navObserved = '1';

    const observer = new MutationObserver(scheduleMigrationNavRebuild);
    observer.observe(container, { childList: true, subtree: false });
}

// 画面回転・ウィンドウリサイズのたびに、PC/スマホ表示の切り替えと
// サイドバーの開始位置(top)を更新する
function attachMigrationNavResizeHandler() {
    if (migrationNavResizeHandlerAttached) return;
    migrationNavResizeHandlerAttached = true;

    let resizeTimer = null;
    const handleResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const container = document.getElementById('migration-screen');
            if (!container || !container.classList.contains('active')) return;
            updateMigrationNavTopOffset();
            // PC幅に戻った場合は、スマホ用ドロワーの開閉状態をリセットしておく
            if (!isMigrationNavMobileMode()) closeMigrationNavDrawer();
        }, 150);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
}

/* ---------- showScreen() をフックし、データ管理画面を開いた時にナビゲーションを用意する ---------- */
(function hookShowScreenForMigrationNav() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') {
                watchMigrationScreenForNav();
                attachMigrationNavResizeHandler();
                scheduleMigrationNavRebuild();
            } else {
                // データ管理画面から離れたら、無駄なスクロール監視は止め、
                // 開いたままのドロワーも念のため閉じ、常時表示のサイドバー
                // 本体（PC・タブレット幅）も非表示にする
                // （これをしないと別ページにサイドバーが残ってしまう）
                stopMigrationSectionScrollSpy();
                closeMigrationNavDrawer();
                hideMigrationAnchorNav();
            }
            return result;
        };
    }
    tryHook();
})();

/* ---------- データ管理画面を開いたままハッシュが #settings/<id> に変わった場合、該当箇所へスクロールする ---------- */
window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash.indexOf('#settings/') !== 0) return;

    const migrationScreen = document.getElementById('migration-screen');
    if (!migrationScreen || !migrationScreen.classList.contains('active')) return;

    const targetId = hash.slice('#settings/'.length);
    const target = document.getElementById(targetId);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveMigrationNavButton(targetId);
    }
});
