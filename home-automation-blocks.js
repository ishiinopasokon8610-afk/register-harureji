// ==========================================
// home-automation-blocks.js
// ホーム画面 長押しで「自動化バーコード」をブロック表示する機能
// ------------------------------------------
// 【2026年9月変更】
// 以前は自動化バーコード一覧に「ホーム表示」チェック（🏠ボタン）があり、
// チェックを入れたものだけがホーム画面のブロックに表示される仕組みだったが、
// 「チェックを付けなくても、登録されている自動化バーコードは強制的にすべて
// ホームのブロック一覧に出るようにしたい」という要望のため、
// チェック機能自体を廃止し、無効化（⛔）・アーカイブされていない
// 自動化バーコードは常に全件、ホームのブロック一覧に表示されるようにした。
// これに伴い、ブロックの2秒長押しで個別に非表示にする機能も廃止した
// （全件を強制表示する方針と矛盾するため）。
// ------------------------------------------
// ・ホーム画面のどこか（ボタン等の操作要素を除く）を4秒間長押しすると、
//   登録されている自動化バーコードをブロックとして一覧表示する。
// ・各ブロックの右上には、初めて表示されてからの経過時間を
//   mm:ss 形式（例: 00:00）でリアルタイム表示する。
//
// discount-system.js / index.html は直接編集せず、ホーム画面への
// イベントリスナー追加＋renderHomeAutomationBlocksGrid()で実現する
// （他の追加機能ファイルと同じ考え方）。
// ==========================================

const HOME_LONG_PRESS_MS = 4000;

// 各ブロックを個別に長押し（2秒）すると、そのバーコードだけを
// アーカイブしてホームのブロック一覧から消す
const HOME_BLOCK_ARCHIVE_LONG_PRESS_MS = 2000;

/* =========================================================
   ホーム画面：ブロック表示オーバーレイ
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
            <h3 style="color:#fff; margin:0;">🏷️ 自動化バーコード一覧</h3>
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

    // 【変更】「ホーム表示」チェックは廃止。無効化・アーカイブされていない
    // 自動化バーコードは強制的にすべて表示対象にする。
    const shown = discountBarcodes
        .map((disc, index) => ({ disc, index }))
        .filter(({ disc }) => !disc.archived);

    if (shown.length === 0) {
        grid.innerHTML = '<div style="color:#eee;">登録されている自動化バーコードがありません。「🏷️ 自動化バーコード作成」から登録してください。</div>';
        return;
    }

    // 初めて画面に出た自動化バーコードには、経過時間タイマーの起点(homeBlockStartAt)を
    // ここで一度だけ記録しておく（無いと毎回「今」を起点にしてしまい、タイマーが進まないため）。
    let needsSave = false;
    shown.forEach(({ disc }) => {
        if (!disc.homeBlockStartAt) {
            disc.homeBlockStartAt = Date.now();
            needsSave = true;
        }
    });
    if (needsSave) {
        localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }

    const safe = (typeof escapeHtml === 'function') ? escapeHtml : (s) => s;
    const displayName = (typeof discDisplayName === 'function') ? discDisplayName : (d) => (d && d.name) || '（名称未設定）';

    grid.innerHTML = shown.map(({ disc, index }) => `
        <div class="home-automation-block" data-disc-index="${index}"
            style="position:relative; width:160px; min-height:90px; background:#fff; border-radius:10px; padding:10px; box-shadow:0 2px 6px rgba(0,0,0,0.3); user-select:none; transition: background-color 0.4s, transform 150ms ease, opacity 150ms ease; overflow:hidden;">
            <div class="home-automation-block-timer" style="position:absolute; top:6px; right:8px; font-size:11px; color:#888; font-family:monospace;">00:00</div>
            <div class="home-automation-block-title" style="font-weight:bold; color:#6a1b9a; margin-top:14px; word-break:break-all;">🏷️ ${safe(displayName(disc))}</div>
            <div class="home-automation-block-barcode" style="font-size:11px; color:#999; font-family:monospace; margin-top:4px;">${safe(disc.barcode)}</div>
            <div class="home-automation-block-archive-bar" style="position:absolute; left:0; bottom:0; height:4px; width:0%; background:#e53935;"></div>
        </div>
    `).join('');

    grid.querySelectorAll('.home-automation-block').forEach(blockEl => {
        const idx = parseInt(blockEl.dataset.discIndex, 10);
        attachBlockArchiveLongPress(blockEl, idx);
    });

    updateHomeAutomationBlockTimers();
}

/* =========================================================
   ブロック単体の長押し（2秒）→ そのバーコードだけをアーカイブする
   ------------------------------------------
   ・押している間：カードがわずかに縮み、下端の赤いバーが左から右へ伸びる
     （「消そうとしている」ことが視覚的にわかるようにするため）
   ・2秒経つ前に指を離した場合：バーを0%に戻し、何も起きない
   ・2秒経過した場合：disc.archived = trueにしてlocalStorageへ保存し、
     一覧を再描画して即座にそのブロックを消す
   ========================================================= */
function archiveDiscountBarcode(index) {
    if (typeof discountBarcodes === 'undefined' || !Array.isArray(discountBarcodes)) return;
    const disc = discountBarcodes[index];
    if (!disc) return;

    disc.archived = true;

    try {
        localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    } catch (e) {
        console.warn('自動化バーコードのアーカイブ保存に失敗しました:', e);
    }

    if (typeof playSound === 'function') playSound('success');

    // 開いたままのオーバーレイに即座に反映する（このブロックが一覧から消える）
    renderHomeAutomationBlocksIfVisible();
}

function attachBlockArchiveLongPress(blockEl, index) {
    const bar = blockEl.querySelector('.home-automation-block-archive-bar');
    let pressTimer = null;
    let archived = false;

    const start = (e) => {
        if (archived) return;
        if (bar) {
            bar.style.transition = 'none';
            bar.style.width = '0%';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    bar.style.transition = `width ${HOME_BLOCK_ARCHIVE_LONG_PRESS_MS}ms linear`;
                    bar.style.width = '100%';
                });
            });
        }
        blockEl.style.transform = 'scale(0.94)';

        pressTimer = setTimeout(() => {
            archived = true;
            blockEl.style.opacity = '0';
            blockEl.style.transform = 'scale(0.85)';
            setTimeout(() => archiveDiscountBarcode(index), 150);
        }, HOME_BLOCK_ARCHIVE_LONG_PRESS_MS);
    };

    const cancel = () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        if (archived) return;
        blockEl.style.transform = 'scale(1)';
        if (bar) {
            bar.style.transition = 'width 150ms ease-out';
            bar.style.width = '0%';
        }
    };

    blockEl.addEventListener('pointerdown', start);
    blockEl.addEventListener('pointerup', cancel);
    blockEl.addEventListener('pointerleave', cancel);
    blockEl.addEventListener('pointercancel', cancel);
    // 長押し中にコンテキストメニューが出て操作が中断されないようにする
    blockEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

// 各ブロックの右上に、初めて表示されてからの経過時間を mm:ss で表示する
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

/* =========================================================
   ホーム画面：4秒長押しの検知
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
