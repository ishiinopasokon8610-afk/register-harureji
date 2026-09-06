// ==========================================
// home-automation-blocks.js
// ホーム画面 長押しで「自動化バーコード」をブロック表示する機能
// ------------------------------------------
// 【2026年9月変更・その後さらに変更】
// 一時期「登録されているものは強制的に全件ホームのブロック一覧に出す」
// 方針にして、個別の「ホーム表示」チェック機能を廃止していたが、
// discount-home-visibility-toggle.js 側で個別設定（hideFromHome）が
// 復活したため、このファイルのブロック一覧の絞り込みでも
// hideFromHome が付いている自動化バーコードは除外するようにした
// （discount-home-visibility-toggle.js が discountBarcodes の各要素に
// hideFromHome フィールドを追加・切り替えるので、ここではそれを
// 読むだけで良い。discount-system.js は直接編集しない）。
// ------------------------------------------
// 【2026年9月変更・追加分】
// ① 情報不足の解消
//    以前は各ブロックに「名前」と「バーコード番号」しか表示されず、
//    その自動化バーコードが実際に何を行うのか（自動追加される商品／
//    値引き内容／適用期間／使い切りかどうか）が一覧からは分からなかった。
//    discount-system.js の一覧表示（discount-tbody）ですでに使われている
//    getDiscountContentText() をそのまま流用し、同じ内容をブロック内にも
//    表示するようにした（表示ロジックの二重管理を避けるため）。
//    あわせて、無効化（⛔）されているものは badge で分かるようにした。
//
// ② 画面を開き直さなくてもリアルタイムに更新されるように
//    以前はこのブロック一覧（オーバーレイ）を開いた瞬間にしか再描画されず、
//    ・オーバーレイを開いたまま（例：常時表示しているスタッフ用端末）
//      他の端末で自動化バーコードを新規登録／編集／削除しても、
//      いったん閉じて開き直すまで一覧に反映されなかった
//    という問題があった。
//    discount-system.js の saveDiscounts()（＝この端末での登録・編集・削除・
//    有効/無効切替・復元のすべてがここを通る）をフックし、保存の都度
//    オーバーレイが開いていれば自動で再描画するようにした。
//    また、他端末からの変更は saveDiscounts() を経由せず Ably の
//    'discount-sync' イベント経由で届くため、discount-system.js が
//    購読しているのと同じイベントにこのファイル側からも別途購読者として
//    参加し、届いた直後に再描画するようにした（discount-system.js /
//    index.html は直接編集しない、という既存方針のまま実現）。
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
// ホーム非表示（hideFromHome）にしてホームのブロック一覧から消す
// （会計成立後に使えなくなる「使用済み(archived)」にはしない。あくまで
// ホーム画面に出すかどうかだけの設定で、レジでは引き続き使える）
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

    // 【変更】discount-home-visibility-toggle.js で復活した個別設定
    // （hideFromHome）が付いているものはホームのブロック一覧から除外する。
    // アーカイブされていないもの・かつ hideFromHome が付いていないものだけを対象にする。
    const shown = discountBarcodes
        .map((disc, index) => ({ disc, index }))
        .filter(({ disc }) => !disc.archived && !disc.hideFromHome);

    if (shown.length === 0) {
        // 「そもそも登録が無い」のか「登録はあるが全部ホーム非表示にしている」のかで
        // 案内文を分ける（後者を前者のメッセージのまま出すと、登録済みの人が
        // 混乱してしまうため）。
        const anyActiveAtAll = discountBarcodes.some(d => !d.archived);
        grid.innerHTML = anyActiveAtAll
            ? '<div style="color:#eee;">表示できる自動化バーコードがありません（登録済みのものは、すべて「ホームのブロック一覧に表示しない」設定になっています）。</div>'
            : '<div style="color:#eee;">登録されている自動化バーコードがありません。「🏷️ 自動化バーコード作成」から登録してください。</div>';
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
    // 商品自動追加／値引き/適用期間/使い切りの内容は discount-system.js の
    // 一覧表示（discount-tbody）と全く同じ getDiscountContentText() を使い回す
    // （表示ロジックを二重管理しないため。無ければ空欄のまま）
    const getContentHtml = (typeof getDiscountContentText === 'function') ? getDiscountContentText : () => '';

    grid.innerHTML = shown.map(({ disc, index }) => {
        const disabledBadge = (disc.enabled === false)
            ? '<span class="home-automation-block-disabled-badge" style="display:inline-block; background:rgba(0,0,0,0.35); font-size:10px; font-weight:bold; padding:1px 6px; border-radius:4px; margin-left:6px; vertical-align:middle;">⛔ 無効</span>'
            : '';
        return `
        <div class="home-automation-block" data-disc-index="${index}"
            style="position:relative; width:230px; min-height:90px; background:#fff; border-radius:10px; padding:10px 10px 14px; box-shadow:0 2px 6px rgba(0,0,0,0.3); user-select:none; transition: background-color 0.4s, transform 150ms ease, opacity 150ms ease; overflow:hidden;">
            <div class="home-automation-block-timer" style="position:absolute; top:6px; right:8px; font-size:11px; color:#888; font-family:monospace;">00:00</div>
            <div class="home-automation-block-title" style="font-weight:bold; color:#6a1b9a; margin-top:14px; word-break:break-all;">🏷️ ${safe(displayName(disc))}${disabledBadge}</div>
            <div class="home-automation-block-barcode" style="font-size:11px; color:#999; font-family:monospace; margin-top:4px;">${safe(disc.barcode)}</div>
            <div class="home-automation-block-content" style="font-size:12px; color:#555; line-height:1.5; margin-top:6px; word-break:break-word;">${getContentHtml(disc)}</div>
            <div class="home-automation-block-archive-bar" style="position:absolute; left:0; bottom:0; height:4px; width:0%; background:#e53935;"></div>
        </div>
    `;
    }).join('');

    grid.querySelectorAll('.home-automation-block').forEach(blockEl => {
        const idx = parseInt(blockEl.dataset.discIndex, 10);
        attachBlockArchiveLongPress(blockEl, idx);
    });

    updateHomeAutomationBlockTimers();
}

/* =========================================================
   ブロック単体の長押し（2秒）→ そのバーコードをホームの一覧から消す
   ------------------------------------------
   ・押している間：カードがわずかに縮み、下端の赤いバーが左から右へ伸びる
     （「消そうとしている」ことが視覚的にわかるようにするため）
   ・2秒経つ前に指を離した場合：バーを0%に戻し、何も起きない
   ・2秒経過した場合：disc.hideFromHome = trueにしてlocalStorageへ保存し、
     一覧を再描画して即座にそのブロックを消す
   ------------------------------------------
   【不具合修正】以前はここで disc.archived = true にしていたが、
   archived は「会計成立後の使用済みバーコード」を表すフラグで、
   discount-system.js 側のレジ画面スキャン処理（fetchAndAddItemのフック）が
   archived === true のバーコードをスキャン対象から除外してしまうため、
   「ホーム画面のブロック一覧から消しただけ」のつもりが、実際には
   そのバーコードがレジで一切使えなくなってしまっていた。
   ホーム画面に表示するかどうかだけを切り替えたい場合は、
   discount-home-visibility-toggle.js が使っている hideFromHome
   フラグ（レジでの使用には影響しない・一覧表示のみ制御する）を
   代わりに使うようにした。
   ========================================================= */
function archiveDiscountBarcode(index) {
    if (typeof discountBarcodes === 'undefined' || !Array.isArray(discountBarcodes)) return;
    const disc = discountBarcodes[index];
    if (!disc) return;

    disc.hideFromHome = true;

    try {
        localStorage.setItem('pos_discounts', JSON.stringify(discountBarcodes));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    } catch (e) {
        console.warn('自動化バーコードのホーム非表示設定の保存に失敗しました:', e);
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
    const contentEl = blockEl.querySelector('.home-automation-block-content');
    const timerEl = blockEl.querySelector('.home-automation-block-timer');
    if (titleEl) titleEl.style.color = titleColor;
    if (subEl) subEl.style.color = subColor;
    if (contentEl) contentEl.style.color = subColor;
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

/* =========================================================
   画面を開き直さなくてもブロック一覧をリアルタイム更新する
   ------------------------------------------
   ① この端末での変更（新規登録／編集／削除／有効・無効切替／
      アーカイブの復元・完全削除）は、discount-system.js側で
      すべて saveDiscounts() を経由するため、saveDiscounts() を
      フックしてその都度オーバーレイが開いていれば再描画する。
   ========================================================= */
(function hookSaveDiscountsForHomeBlocksLiveRefresh() {
    function tryHook() {
        if (typeof window.saveDiscounts !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.saveDiscounts;
        window.saveDiscounts = function (...args) {
            const result = original.apply(this, args);
            renderHomeAutomationBlocksIfVisible();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ② 他端末での変更は saveDiscounts() を経由せず、Ably の
      'discount-sync' イベントで届く（discount-system.js側の
      購読処理が discountBarcodes とlocalStorageを更新する）。
      discount-system.js は直接編集せず、同じイベントに
      このファイルからも別の購読者として登録し、届いた直後に
      再描画する（Ablyは1つのイベントに複数の購読者を登録できる）。
      discount-system.js側の購読処理が先に discountBarcodes を
      更新し終えてから読むよう、setTimeoutで1つ後回しにする。
   ========================================================= */
(function subscribeHomeBlocksToDiscountSyncForLiveRefresh() {
    function tryHook() {
        if (typeof channel === 'undefined' || !channel) {
            setTimeout(tryHook, 500);
            return;
        }
        channel.subscribe('discount-sync', () => {
            setTimeout(renderHomeAutomationBlocksIfVisible, 0);
        });
    }
    tryHook();
})();
