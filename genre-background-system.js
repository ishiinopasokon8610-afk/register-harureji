// ==========================================
// genre-background-system.js
// ------------------------------------------
// 【この機能】
// タッチパネルのメニュー画面で、左のジャンル（カテゴリ）を選んだときに、
// そのジャンルごとに背景色 or 背景画像を変えられるようにする。
// （例：「ドリンク」は水色っぽい背景、「デザート」はピンク系の背景、など）
//
// ・店員用モードでメニュー画面を開くと、右上に「🎨 ジャンル背景」ボタンが出る。
// ・特定のジャンルを選んだ状態でボタンを押すと、そのジャンル専用の
//   背景設定（単色 or 画像アップロード）ができる。
// ・「すべて」「おすすめ」タブには設定できない（ジャンル横断のため）。
//   その場合は元の背景（設定なし）に戻る。
// ・設定はブラウザのlocalStorageに保存される（店舗の端末ごと）。
//
// index.html / touch-panel-order-system.js は直接編集せず、
// renderTouchPanelMenuScreen() をラップするフック方式で実現する
// （他の追加機能ファイルと同じ方針）。
// ==========================================

const TP_GENRE_BG_KEY = 'pos_touch_panel_genre_bg';

function getGenreBgMap() {
    try {
        const raw = localStorage.getItem(TP_GENRE_BG_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function saveGenreBgMap(map) {
    localStorage.setItem(TP_GENRE_BG_KEY, JSON.stringify(map));
    // 他の追加機能と同様、レジのバックアップ機構があれば一緒に保存する
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
}

/* =========================================================
   選択中ジャンルに応じて .tp-body の背景を実際に切り替える
   ========================================================= */
function applyGenreBackground() {
    const overlay = document.getElementById('touch-panel-overlay');
    const body = overlay && overlay.querySelector('.tp-body');
    if (!body || typeof touchPanelState === 'undefined') return;

    const cat = touchPanelState.activeCategory || 'all';
    const map = getGenreBgMap();
    const setting = map[cat];

    if (setting && setting.type === 'color') {
        body.style.backgroundImage = '';
        body.style.backgroundColor = setting.value;
    } else if (setting && setting.type === 'image' && setting.value) {
        body.style.backgroundColor = '';
        const safeUrl = String(setting.value).replace(/'/g, "%27");
        // 商品カードや文字が読みやすいよう、白を薄く重ねてから画像を敷く
        body.style.backgroundImage =
            `linear-gradient(rgba(255,255,255,0.82), rgba(255,255,255,0.82)), url('${safeUrl}')`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
        body.style.backgroundRepeat = 'no-repeat';
    } else {
        // 設定なし・「すべて」「おすすめ」タブ → 元の見た目に戻す
        body.style.backgroundColor = '';
        body.style.backgroundImage = '';
    }
}

/* =========================================================
   店員用：メニュー画面右上に「🎨 ジャンル背景」ボタンを差し込む
   ========================================================= */
function injectGenreBgButtonIfStaff() {
    if (typeof touchPanelState === 'undefined' || touchPanelState.mode !== 'staff') return;
    const actions = document.querySelector('#touch-panel-overlay .tp-topbar-actions');
    if (!actions || document.getElementById('tp-genre-bg-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'tp-genre-bg-btn';
    btn.className = 'tp-btn tp-cancel';
    btn.textContent = '🎨 ジャンル背景';
    btn.addEventListener('click', openGenreBgPrompt);
    actions.insertBefore(btn, actions.firstChild);
}

/* =========================================================
   ジャンル背景設定モーダル
   ========================================================= */
function openGenreBgPrompt() {
    const cat = typeof touchPanelState !== 'undefined' ? touchPanelState.activeCategory : null;
    if (!cat || cat === 'all' || cat === '__reco__') {
        if (typeof showTouchPanelToast === 'function') {
            showTouchPanelToast('⚠️ 左のジャンルを1つ選んでから設定してください');
        } else {
            alert('左のジャンルを1つ選んでから設定してください');
        }
        return;
    }
    if (typeof tpPlaySound === 'function') tpPlaySound('click');

    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;

    let root = document.getElementById('tp-genre-bg-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-genre-bg-root';
        overlay.appendChild(root);
    }

    const map = getGenreBgMap();
    const current = map[cat];
    const currentColor = (current && current.type === 'color') ? current.value : '#fff8ee';
    const esc = (typeof tpEsc === 'function') ? tpEsc : (s => s);

    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeGenreBgPrompt()"></div>
        <div class="tp-pin-modal tp-pop" style="width:320px; max-width:90vw; text-align:left;">
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeGenreBgPrompt()">×</button>
            <div class="tp-pin-title" style="margin-bottom:12px;">🎨「${esc(cat)}」の背景</div>

            <label style="display:block; font-size:13px; margin-bottom:4px;">単色で塗る</label>
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:14px;">
                <input type="color" id="tp-genre-bg-color-input" value="${currentColor}" style="width:48px; height:36px; border:none; padding:0; background:none;">
                <button class="tp-btn tp-confirm" style="flex:1;" onclick="saveGenreBgColor()">この色で保存</button>
            </div>

            <div style="text-align:center; color:#999; font-size:12px; margin:8px 0;">── または ──</div>

            <label style="display:block; font-size:13px; margin:4px 0;">画像をアップロード</label>
            <input type="file" id="tp-genre-bg-file-input" accept="image/*" style="width:100%; margin-bottom:14px;">

            <button class="tp-btn tp-cancel" style="width:100%;" onclick="clearGenreBg()">この背景を解除する</button>
        </div>
    `;

    const fileInput = document.getElementById('tp-genre-bg-file-input');
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const m = getGenreBgMap();
            m[cat] = { type: 'image', value: reader.result };
            saveGenreBgMap(m);
            applyGenreBackground();
            closeGenreBgPrompt();
        };
        reader.readAsDataURL(file);
    });
}

function saveGenreBgColor() {
    const cat = touchPanelState.activeCategory;
    const input = document.getElementById('tp-genre-bg-color-input');
    if (!cat || !input) return;
    const m = getGenreBgMap();
    m[cat] = { type: 'color', value: input.value };
    saveGenreBgMap(m);
    applyGenreBackground();
    closeGenreBgPrompt();
}

function clearGenreBg() {
    const cat = touchPanelState.activeCategory;
    if (!cat) return;
    const m = getGenreBgMap();
    delete m[cat];
    saveGenreBgMap(m);
    applyGenreBackground();
    closeGenreBgPrompt();
}

function closeGenreBgPrompt() {
    const root = document.getElementById('tp-genre-bg-root');
    if (root) root.innerHTML = '';
}

/* =========================================================
   renderTouchPanelMenuScreen() をラップして、描画のたびに
   背景反映＋ボタン差し込みを行う
   ========================================================= */
(function hookMenuRenderForGenreBg() {
    function tryHook() {
        if (typeof window.renderTouchPanelMenuScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelMenuScreen;
        window.renderTouchPanelMenuScreen = function (...args) {
            const result = original.apply(this, args);
            applyGenreBackground();
            injectGenreBgButtonIfStaff();
            return result;
        };
    }
    tryHook();
})();
