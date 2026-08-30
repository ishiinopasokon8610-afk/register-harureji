// ==========================================
// home-automation-blocks.js
// ホーム画面 長押しで「自動化バーコード」をブロック表示する機能
// ------------------------------------------
// ・自動化バーコード作成画面（discount-system.js）の一覧に、
//   「ホーム表示」チェック列（✅）を追加する。チェックを入れた
//   バーコードだけがホーム画面のブロックに表示される。
// ・ホーム画面のどこか（ボタン等の操作要素を除く）を4秒間長押しすると、
//   「ホーム表示」がONの自動化バーコードをブロックとして一覧表示する。
// ・各ブロックの右上には、表示され始めてからの経過時間を
//   mm:ss 形式（例: 00:00）でリアルタイム表示する。
// ・ブロックを2秒間長押しすると、そのブロックを削除する
//   （＝そのバーコードの「ホーム表示」チェックを自動的にOFFにする）。
//
// discount-system.js / index.html は直接編集せず、
//   ・renderDiscounts() をフックして一覧にチェック列を追加
// という「フック方式」＋ホーム画面へのイベントリスナー追加で実現する
// （他の追加機能ファイルと同じ考え方）。
// ==========================================

const HOME_LONG_PRESS_MS = 4000;
const HOME_BLOCK_DELETE_PRESS_MS = 2000;

/* =========================================================
   ① 自動化バーコード一覧：「ホーム表示」チェック列を追加
   ========================================================= */
(function hookRenderDiscountsForHomeCheckbox() {
    function tryHook() {
        if (typeof window.renderDiscounts !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderDiscounts;
        window.renderDiscounts = function (...args) {
            const result = original.apply(this, args);
            injectHomeBlockCheckboxColumn();
            return result;
        };
    }
    tryHook();
})();

// 新しい列を追加すると、表が横に長くなり画面幅に収まらず見えなくなることがあるため、
// 既存の「操作」列（変更・削除ボタンがある一番右のセル）の中にボタンとして追加する。
function injectHomeBlockCheckboxColumn() {
    const tbody = document.getElementById('discount-tbody');
    if (!tbody || typeof discountBarcodes === 'undefined') return;

    // renderDiscounts() 内と同じ「アーカイブ済みを除いたリスト」の並びに合わせる
    const activeList = discountBarcodes
        .map((disc, index) => ({ disc, index }))
        .filter(({ disc }) => !disc.archived);

    Array.from(tbody.children).forEach((tr, i) => {
        if (tr.querySelector('td[colspan]')) return; // 空リストのプレースホルダー行
        const entry = activeList[i];
        if (!entry) return;

        const actionCell = tr.lastElementChild;
        if (!actionCell) return;

        let btn = actionCell.querySelector('.home-block-toggle-btn');
        const isOn = !!entry.disc.showOnHome;
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'select-btn home-block-toggle-btn';
            btn.style.marginRight = '6px';
            actionCell.insertBefore(btn, actionCell.firstChild);
        }
        btn.setAttribute('onclick', `toggleDiscountShowOnHome(${entry.index})`);
        btn.style.background = isOn ? '#00897b' : '#9e9e9e';
        btn.innerText = isOn ? '🏠 ホーム表示中' : '🏠 ホームに表示';
    });
}

function toggleDiscountShowOnHome(index) {
    if (typeof discountBarcodes === 'undefined' || !discountBarcodes[index]) return;
    const disc = discountBarcodes[index];
    const nowOn = !disc.showOnHome;
    disc.showOnHome = nowOn;
    if (nowOn) {
        disc.homeBlockStartAt = Date.now();
    } else {
        delete disc.homeBlockStartAt;
    }
    localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('click');
    injectHomeBlockCheckboxColumn(); // ボタンの見た目（ON/OFF）をその場で更新する
    renderHomeAutomationBlocksIfVisible();
}

/* =========================================================
   ② ホーム画面：ブロック表示オーバーレイ
   ========================================================= */
let homeLongPressTimer = null;
let homeBlockTickInterval = null;

function ensureHomeBlockOverlay() {
    if (document.getElementById('home-automation-blocks-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'home-automation-blocks-overlay';
    overlay.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:9998; padding:20px; overflow-y:auto;';
    overlay.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h3 style="color:#fff; margin:0;">🏷️ 自動化バーコード（ブロックを2秒長押しで削除）</h3>
            <button onclick="closeHomeAutomationBlocks()" style="border:none; background:#eee; border-radius:6px; padding:8px 14px; font-weight:bold; cursor:pointer;">閉じる</button>
        </div>
        <div id="home-automation-blocks-grid" style="display:flex; flex-wrap:wrap; gap:12px;"></div>
    `;
    document.body.appendChild(overlay);
}

// 全画面表示（Fullscreen API）。許可されない環境（一部のiOS Safari等）では
// 何もしない（例外を投げず、通常のオーバーレイ表示のまま使える）。
function requestOverlayFullscreen(el) {
    if (!el) return;
    const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!request) return;
    try {
        const result = request.call(el);
        if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (e) { /* 全画面が許可されない環境では無視する */ }
}

function exitOverlayFullscreen() {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    if (!isFs) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (!exit) return;
    try {
        const result = exit.call(document);
        if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (e) { /* 無視 */ }
}

function openHomeAutomationBlocks() {
    ensureHomeBlockOverlay();
    renderHomeAutomationBlocksGrid();
    const overlay = document.getElementById('home-automation-blocks-overlay');
    if (overlay) overlay.style.display = 'block';
    if (typeof playSound === 'function') playSound('success');

    requestOverlayFullscreen(overlay);

    if (homeBlockTickInterval) clearInterval(homeBlockTickInterval);
    homeBlockTickInterval = setInterval(updateHomeAutomationBlockTimers, 1000);
}

function closeHomeAutomationBlocks() {
    if (typeof playSound === 'function') playSound('click');
    const overlay = document.getElementById('home-automation-blocks-overlay');
    if (overlay) overlay.style.display = 'none';
    if (homeBlockTickInterval) { clearInterval(homeBlockTickInterval); homeBlockTickInterval = null; }

    exitOverlayFullscreen();
}

function renderHomeAutomationBlocksIfVisible() {
    const overlay = document.getElementById('home-automation-blocks-overlay');
    if (overlay && overlay.style.display === 'block') renderHomeAutomationBlocksGrid();
}

function renderHomeAutomationBlocksGrid() {
    const grid = document.getElementById('home-automation-blocks-grid');
    if (!grid || typeof discountBarcodes === 'undefined') return;

    const shown = discountBarcodes
        .map((disc, index) => ({ disc, index }))
        .filter(({ disc }) => !disc.archived && disc.showOnHome);

    if (shown.length === 0) {
        grid.innerHTML = '<div style="color:#eee;">ホーム表示に設定された自動化バーコードがありません。「🏷️ 自動化バーコード作成」の一覧で「ホーム表示」にチェックを入れてください。</div>';
        return;
    }

    const safe = (typeof escapeHtml === 'function') ? escapeHtml : (s) => s;

    grid.innerHTML = shown.map(({ disc, index }) => `
        <div class="home-automation-block" data-disc-index="${index}"
            style="position:relative; width:160px; min-height:90px; background:#fff; border-radius:10px; padding:10px; box-shadow:0 2px 6px rgba(0,0,0,0.3); user-select:none; transition: background-color 0.4s;">
            <div class="home-automation-block-timer" style="position:absolute; top:6px; right:8px; font-size:11px; color:#888; font-family:monospace;">00:00</div>
            <div class="home-automation-block-title" style="font-weight:bold; color:#6a1b9a; margin-top:14px; word-break:break-all;">🏷️ ${safe(disc.name)}</div>
            <div class="home-automation-block-barcode" style="font-size:11px; color:#999; font-family:monospace; margin-top:4px;">${safe(disc.barcode)}</div>
        </div>
    `).join('');

    attachHomeBlockLongPressHandlers();
    updateHomeAutomationBlockTimers();
}

// 各ブロックの右上に、表示され始めてからの経過時間を mm:ss で表示する
// あわせて、経過時間に応じてブロックの色を変える（3分未満=緑／3〜5分=黄／5分以上=赤）
function updateHomeAutomationBlockTimers() {
    if (typeof discountBarcodes === 'undefined') return;
    document.querySelectorAll('.home-automation-block').forEach(blockEl => {
        const idx = parseInt(blockEl.dataset.discIndex, 10);
        const disc = discountBarcodes[idx];
        const timerEl = blockEl.querySelector('.home-automation-block-timer');
        if (!disc || !timerEl) return;
        const startAt = disc.homeBlockStartAt || Date.now();
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
        const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
        const ss = String(elapsedSec % 60).padStart(2, '0');
        timerEl.innerText = `${mm}:${ss}`;

        applyHomeBlockStatusColor(blockEl, elapsedSec);
    });
}

// 経過時間に応じたブロックの配色（背景色＋文字色）を適用する
// 3分（180秒）未満=緑／3〜5分（180〜300秒）=黄／5分（300秒）以上=赤
function applyHomeBlockStatusColor(blockEl, elapsedSec) {
    let bg, titleColor, subColor, timerColor;
    if (elapsedSec < 180) {
        bg = '#2e7d32'; titleColor = '#ffffff'; subColor = '#e8f5e9'; timerColor = '#e8f5e9';
    } else if (elapsedSec < 300) {
        bg = '#f9a825'; titleColor = '#3e2723'; subColor = '#4e342e'; timerColor = '#4e342e';
    } else {
        bg = '#c62828'; titleColor = '#ffffff'; subColor = '#ffebee'; timerColor = '#ffebee';
    }
    blockEl.style.background = bg;
    const titleEl = blockEl.querySelector('.home-automation-block-title');
    const subEl = blockEl.querySelector('.home-automation-block-barcode');
    const timerEl = blockEl.querySelector('.home-automation-block-timer');
    if (titleEl) titleEl.style.color = titleColor;
    if (subEl) subEl.style.color = subColor;
    if (timerEl) timerEl.style.color = timerColor;
}

// ブロックを2秒間長押しすると削除する（＝「ホーム表示」チェックをOFFにする）
// こちらも同様に、ブロック下部に左から右へ伸びる進捗バーを表示する
function attachHomeBlockLongPressHandlers() {
    document.querySelectorAll('.home-automation-block').forEach(blockEl => {
        if (blockEl.dataset.longPressBound) return;
        blockEl.dataset.longPressBound = '1';
        let pressTimer = null;

        let progressBar = blockEl.querySelector('.home-automation-block-progress-bar');
        if (!progressBar) {
            const track = document.createElement('div');
            track.style.cssText = 'position:absolute; left:0; bottom:0; width:100%; height:4px; background:rgba(0,0,0,0.1); border-radius:0 0 10px 10px; overflow:hidden;';
            progressBar = document.createElement('div');
            progressBar.className = 'home-automation-block-progress-bar';
            progressBar.style.cssText = 'height:100%; width:0%; background:#e53935;';
            track.appendChild(progressBar);
            blockEl.appendChild(track);
        }

        const start = (e) => {
            e.preventDefault();
            progressBar.style.transition = 'none';
            progressBar.style.width = '0%';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    progressBar.style.transition = `width ${HOME_BLOCK_DELETE_PRESS_MS}ms linear`;
                    progressBar.style.width = '100%';
                });
            });
            pressTimer = setTimeout(() => {
                const idx = parseInt(blockEl.dataset.discIndex, 10);
                deleteHomeAutomationBlock(idx);
            }, HOME_BLOCK_DELETE_PRESS_MS);
        };
        const cancel = () => {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
            progressBar.style.transition = 'none';
            progressBar.style.width = '0%';
        };

        blockEl.addEventListener('mousedown', start);
        blockEl.addEventListener('touchstart', start, { passive: false });
        ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(evt => blockEl.addEventListener(evt, cancel));
    });
}

function deleteHomeAutomationBlock(index) {
    if (typeof discountBarcodes === 'undefined' || !discountBarcodes[index]) return;
    const disc = discountBarcodes[index];
    disc.showOnHome = false;
    delete disc.homeBlockStartAt;
    localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('click');
    if (typeof speak === 'function') speak(`${disc.name} の ブロック を さくじょ し まし た`);

    // 自動化バーコード画面が開いていれば、一覧のチェックも連動して外す
    if (typeof renderDiscounts === 'function') renderDiscounts();
    renderHomeAutomationBlocksGrid();
}

/* =========================================================
   ③ ホーム画面：4秒長押しの検知
   ------------------------------------------
   ホーム画面はボタンがほぼ隙間なく並んでいるため、「ボタンの上は
   無視する」形にすると実質どこを押しても反応しなくなってしまう。
   そのため、ボタンの上を含め画面のどこを押しても長押しを検知できる
   ようにし、代わりに「4秒長押しが成立した場合だけ、指を離した時に
   本来そのボタンが実行するはずだったクリック処理をキャンセルする」
   という方式にする（誤って商品管理画面などに遷移してしまうのを防ぐ）。
   また、長押し中は画面上部に左から右へ伸びる進捗バーを表示し、
   あと何秒でブロック表示が開くかを視覚的に分かるようにする。
   ========================================================= */
let homeLongPressTriggered = false;

function ensureHomeLongPressProgressBar() {
    if (document.getElementById('home-longpress-progress-track')) return;
    const track = document.createElement('div');
    track.id = 'home-longpress-progress-track';
    track.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:6px; background:rgba(0,0,0,0.15); z-index:10050;';
    const bar = document.createElement('div');
    bar.id = 'home-longpress-progress-bar';
    bar.style.cssText = 'height:100%; width:0%; background:#26a69a;';
    track.appendChild(bar);
    document.body.appendChild(track);
}

function startHomeLongPressProgressBar() {
    ensureHomeLongPressProgressBar();
    const track = document.getElementById('home-longpress-progress-track');
    const bar = document.getElementById('home-longpress-progress-bar');
    if (!track || !bar) return;
    track.style.display = 'block';
    bar.style.transition = 'none';
    bar.style.width = '0%';
    // 1フレーム後にtransitionを有効化してから幅を100%にすることで、
    // 「0%→100%」への左から右に伸びるアニメーションにする
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            bar.style.transition = `width ${HOME_LONG_PRESS_MS}ms linear`;
            bar.style.width = '100%';
        });
    });
}

function stopHomeLongPressProgressBar() {
    const track = document.getElementById('home-longpress-progress-track');
    const bar = document.getElementById('home-longpress-progress-bar');
    if (!track || !bar) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    track.style.display = 'none';
}

function attachHomeLongPressListener() {
    const homeScreen = document.getElementById('home-screen');
    if (!homeScreen) return;
    if (homeScreen.dataset.longPressBound) return;
    homeScreen.dataset.longPressBound = '1';

    const start = () => {
        homeLongPressTriggered = false;
        startHomeLongPressProgressBar();
        homeLongPressTimer = setTimeout(() => {
            homeLongPressTriggered = true;
            stopHomeLongPressProgressBar();
            openHomeAutomationBlocks();
        }, HOME_LONG_PRESS_MS);
    };
    const cancel = () => {
        if (homeLongPressTimer) { clearTimeout(homeLongPressTimer); homeLongPressTimer = null; }
        stopHomeLongPressProgressBar();
    };

    // 4秒長押しが成立した直後に発生するクリック（ボタンの本来の動作）を1回だけ無効化する。
    // capture:true にして、ボタン自身のonclickより先にこのリスナーを実行させる。
    const suppressClickAfterLongPress = (e) => {
        if (!homeLongPressTriggered) return;
        homeLongPressTriggered = false;
        e.preventDefault();
        e.stopPropagation();
    };

    homeScreen.addEventListener('mousedown', start);
    homeScreen.addEventListener('touchstart', start, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel', 'scroll'].forEach(evt => homeScreen.addEventListener(evt, cancel));
    homeScreen.addEventListener('click', suppressClickAfterLongPress, true);
}

document.addEventListener('DOMContentLoaded', () => {
    (function tryInit() {
        if (!document.getElementById('home-screen')) {
            setTimeout(tryInit, 300);
            return;
        }
        attachHomeLongPressListener();
    })();
});
