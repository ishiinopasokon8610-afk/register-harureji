// ==========================================
// clerk-font-size-system.js（改訂版）
// 担当者ごとに「文字の大きさ」を設定・記憶し、担当者バーコードを
// 読み取ってログイン（切り替え）した瞬間に自動でその大きさへ変更する
// ------------------------------------------
// 【改訂の理由】
// 以前の版はブラウザの拡大表示機構（zoom）で画面全体を拡大していたが、
// 固定高さ（100vh）のレイアウトやボタンの余白計算とかみ合わず、
// レイアウトが崩れて逆に見づらくなってしまう問題があった。
// そこで今回は、文字を含む主要な要素（ボタン・入力欄・見出し・表など）
// だけを対象に、それぞれの「元のfont-size」を基準に必要な分だけ
// font-sizeそのものを大きくする方式に変更した。ボタンの大きさ・配置は
// そのままなので、レイアウト崩れが起きにくい。
//
// 右上の共通ドロワー（矢印タブを押すと出てくるパネル）に
// 「🔤 文字サイズ」ボタンを設置し、押すたびに 標準→大きめ→特大 を巡回する。
// 選んだ大きさは「今ログインしている担当者名」に紐づけて保存し、
// login()（担当者バーコード読み取り時に呼ばれる）をフックして
// ログインした瞬間に自動反映する。
//
// register.js / ui.js / simple-auth-system.js / index.html は直接編集せず、
// login() をフックし、DOM注入だけで実現する（他の追加機能ファイルと同じ方式）。
// ==========================================

const CLERK_FONT_SCALE_KEY = 'pos_clerk_font_scale_prefs';

// 標準 → 大きめ → 特大 の順で巡回する（zoom方式より控えめな倍率にしてある）
const CLERK_FONT_SCALE_STEPS = [
    { id: 'normal', label: '標準',  scale: 1.0 },
    { id: 'large',  label: '大きめ', scale: 1.15 },
    { id: 'xlarge', label: '特大',  scale: 1.3 }
];

// 文字サイズ変更の対象にする要素（ボタン・入力欄・見出し・表・レシート等、
// 「読む／押す」ために大きさが重要な要素に絞る。装飾用の小さなアイコン等は対象外）
const CLERK_FONT_SCALE_TARGET_SELECTOR = [
    'body', 'button', 'input', 'select', 'textarea', 'label',
    'td', 'th', 'h1', 'h2', 'h3',
    '.action-btn', '.num-btn', '.home-btn', '.btn-migration',
    '.receipt-body', '.display-total', '.display-total-label',
    '.migration-title', '.migration-desc', '.top-bar-title',
    '.active-clerk-display', '.cust-info-main', '.cust-info-sub',
    '.migration-anchor-btn'
].join(', ');

let clerkFontScaleCurrentMultiplier = 1.0;

function getClerkFontScalePrefs() {
    try {
        return JSON.parse(localStorage.getItem(CLERK_FONT_SCALE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function saveClerkFontScalePref(clerkName, stepId) {
    if (!clerkName) return;
    const prefs = getClerkFontScalePrefs();
    prefs[clerkName] = stepId;
    localStorage.setItem(CLERK_FONT_SCALE_KEY, JSON.stringify(prefs));
}

// 「今ログインしている担当者名」を可能な限り取得する
function getActiveClerkNameSafe() {
    try {
        if (typeof getCurrentSession === 'function') {
            const session = getCurrentSession();
            if (session && session.user && session.user.name) return session.user.name;
        }
    } catch (e) {}
    if (typeof window.activeClerkName === 'string' && window.activeClerkName) return window.activeClerkName;
    return null;
}

// 要素ごとに「元のfont-size」を一度だけ記録しておく（何度切り替えても基準がぶれないように）
function getElementBaseFontSize(el) {
    if (!el.dataset.posBaseFontSize) {
        const computed = window.getComputedStyle(el).fontSize;
        const parsed = parseFloat(computed);
        el.dataset.posBaseFontSize = String(isNaN(parsed) ? 14 : parsed);
    }
    return parseFloat(el.dataset.posBaseFontSize);
}

function applyFontScaleToElement(el, multiplier) {
    if (multiplier === 1) {
        el.style.fontSize = ''; // 標準に戻す時は元のCSSにそのまま任せる
        return;
    }
    const base = getElementBaseFontSize(el);
    el.style.fontSize = (base * multiplier) + 'px';
}

function applyFontScaleToAllTargets(multiplier) {
    document.querySelectorAll(CLERK_FONT_SCALE_TARGET_SELECTOR).forEach(el => {
        applyFontScaleToElement(el, multiplier);
    });
}

// 拡大中に後から追加される要素（履歴の行、モーダルの中身など）にも追従させる
const clerkFontScaleObserver = new MutationObserver(mutations => {
    if (clerkFontScaleCurrentMultiplier === 1) return;
    mutations.forEach(m => {
        m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches(CLERK_FONT_SCALE_TARGET_SELECTOR)) {
                applyFontScaleToElement(node, clerkFontScaleCurrentMultiplier);
            }
            if (node.querySelectorAll) {
                node.querySelectorAll(CLERK_FONT_SCALE_TARGET_SELECTOR).forEach(el => {
                    applyFontScaleToElement(el, clerkFontScaleCurrentMultiplier);
                });
            }
        });
    });
});

let currentClerkFontScaleIndex = 0;

function applyClerkFontScaleStep(stepId, opts) {
    const silent = !!(opts && opts.silent);
    let idx = CLERK_FONT_SCALE_STEPS.findIndex(s => s.id === stepId);
    if (idx === -1) idx = 0;
    currentClerkFontScaleIndex = idx;
    const step = CLERK_FONT_SCALE_STEPS[idx];

    clerkFontScaleCurrentMultiplier = step.scale;
    applyFontScaleToAllTargets(step.scale);

    const btn = document.getElementById('clerk-font-scale-btn');
    if (btn) btn.innerText = `🔤 文字:${step.label}`;

    if (!silent) {
        if (typeof playSound === 'function') playSound('click');
        if (typeof speak === 'function') speak(`もじ の おおき さ を ${step.label} に しました`);
    }
}

function cycleClerkFontScale() {
    const nextIndex = (currentClerkFontScaleIndex + 1) % CLERK_FONT_SCALE_STEPS.length;
    const nextStep = CLERK_FONT_SCALE_STEPS[nextIndex];
    applyClerkFontScaleStep(nextStep.id);

    const clerkName = getActiveClerkNameSafe();
    if (clerkName) saveClerkFontScalePref(clerkName, nextStep.id);
}

function applyFontScaleForClerk(clerkName) {
    if (!clerkName) return;
    const prefs = getClerkFontScalePrefs();
    const stepId = prefs[clerkName] || 'normal';
    applyClerkFontScaleStep(stepId, { silent: true });
}

/* =========================================================
   共通ドロワー（右端の矢印タブを押すとパネルがひょこっと出てくるUI）
   ------------------------------------------
   night-mode-system.js からも同じ仕組みを使うため、同じidの
   要素がすでにあればそれを再利用する（重複生成しない）。
   ========================================================= */
function ensurePosUtilityToolbarStyle() {
    if (document.getElementById('pos-utility-toolbar-style')) return;
    const style = document.createElement('style');
    style.id = 'pos-utility-toolbar-style';
    style.textContent = `
        #pos-utility-drawer { position: fixed; top: 70px; right: 0; z-index: 8000; display: flex; align-items: flex-start; }
        #pos-utility-panel { max-width: 0; overflow: hidden; transition: max-width 0.25s ease; background: #fff; border-radius: 10px 0 0 10px; box-shadow: -2px 2px 8px rgba(0,0,0,0.25); }
        #pos-utility-drawer.open #pos-utility-panel { max-width: 220px; }
        #pos-utility-panel-inner { display: flex; flex-direction: column; gap: 6px; padding: 8px; white-space: nowrap; }
        #pos-utility-tab { border: none; background: #37474f; color: #fff; font-size: 16px; font-weight: bold; padding: 14px 8px; border-radius: 10px 0 0 10px; cursor: pointer; box-shadow: -2px 2px 8px rgba(0,0,0,0.25); }
    `;
    document.head.appendChild(style);
}

function ensurePosUtilityToolbar() {
    ensurePosUtilityToolbarStyle();
    let inner = document.getElementById('pos-utility-panel-inner');
    if (inner) return inner;

    const drawer = document.createElement('div');
    drawer.id = 'pos-utility-drawer';

    const panel = document.createElement('div');
    panel.id = 'pos-utility-panel';

    inner = document.createElement('div');
    inner.id = 'pos-utility-panel-inner';
    panel.appendChild(inner);

    const tab = document.createElement('button');
    tab.id = 'pos-utility-tab';
    tab.type = 'button';
    tab.innerText = '◀';
    tab.setAttribute('aria-label', '設定パネルを開く・閉じる');
    tab.addEventListener('click', () => {
        const isOpen = drawer.classList.toggle('open');
        tab.innerText = isOpen ? '▶' : '◀';
    });

    drawer.appendChild(panel);
    drawer.appendChild(tab);
    document.body.appendChild(drawer);
    return inner;
}

function ensureClerkFontScaleButton() {
    const panel = ensurePosUtilityToolbar();
    if (document.getElementById('clerk-font-scale-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'clerk-font-scale-btn';
    btn.type = 'button';
    btn.innerText = '🔤 文字:標準';
    btn.style.cssText = [
        'padding:8px 12px', 'font-size:12px', 'font-weight:bold',
        'background:#f5f5f5', 'color:#333', 'border:1px solid #bbb',
        'border-radius:16px', 'cursor:pointer'
    ].join(';');
    btn.addEventListener('click', cycleClerkFontScale);
    panel.appendChild(btn);
}

/* ---------- login() をフックし、ログインした担当者の設定を自動適用する ---------- */
(function hookLoginForClerkFontScale() {
    function tryHook() {
        if (typeof window.login !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.login;
        window.login = function (name, barcode, roleId) {
            const result = original.apply(this, [name, barcode, roleId]);
            if (roleId && String(roleId).toUpperCase() !== 'CUSTOMER') {
                applyFontScaleForClerk(name);
            }
            return result;
        };
    }
    tryHook();
})();

/* ---------- 起動時：ボタン設置＋既にログイン済みなら設定を復元 ---------- */
document.addEventListener('DOMContentLoaded', () => {
    ensureClerkFontScaleButton();
    clerkFontScaleObserver.observe(document.body, { childList: true, subtree: true });

    const clerkName = getActiveClerkNameSafe();
    if (clerkName) applyFontScaleForClerk(clerkName);
});
