// ==========================================
// dual-backup-system.js
// ------------------------------------------
// 【この機能】Google Drive と Firebase の「二重保存」と、食い違い確認画面
//
// ① 二重保存
//    これまでのバックアップ先は Google Drive（google-drive-backup.js）と、
//    この端末の IndexedDB／フォルダ（local-backup.js）だった。
//    それに加えて、Firebase にも、全データを【暗号化して】保存する。
//    保存場所は、データ用コードから作った暗号名のフォルダ（pos_backup/〜）。
//    暗号化は同期（firebase-sync-system.js）と同じ鍵なので、コードを知らない人は
//    中身を読めない。
//    ・データが変わるたびに保存の予約を入れ、45秒まとめて1回だけ保存する
//    ・内容が前回と同じなら保存しない（他の端末がすでに同じ内容を保存していても保存しない）
//    ・大きな画像（ロゴ・お会計完了画像・レシート画像など）は、Firebaseの
//      バックアップには含めない（Google Drive・JSONファイルのバックアップには入る）。
//      Firebaseから戻す時も、画像は今の端末のものをそのまま残す。
//
// ② 食い違い確認画面
//    「この端末」「Firebase」「Google Drive」の3つについて、保存日時と件数
//    （商品・会計履歴・会員）を並べて表示し、
//      ・この端末のまま使う（Firebase・Driveを今の内容で上書き保存する）
//      ・Firebaseの内容に戻す
//      ・Driveの内容に戻す
//    のどれかを選べる。
//    ・起動時（1タブにつき1回）に自動で比べ、FirebaseとDriveの保存日時が10分以上
//      離れていて、かつ件数も違う時だけ、自動でこの画面を出す（普段は出さない）。
//    ・データ管理画面の「🔍 バックアップの状態を確認」ボタンからは、いつでも開ける。
//
// 客用ディスプレイ端末では、保存も確認画面も行わない。
// auth-system.js / google-drive-backup.js などは直接編集せず、
// 既存の関数（buildAllDataObject / applyImportedDataObject / haruPosBackupNow /
// ensureGoogleDriveToken など）を呼ぶだけの独立したファイルとして実装する。
//
// 【導入方法】
// index.html内で、firebase-sync-system.js・auth-system.js・google-drive-backup.js・
// local-backup.js より後ろに読み込んでください。
//   <script src="dual-backup-system.js"></script>
//
// 【Firebase側の設定】
// database.rules.json の pos_backup の書き込み条件を更新したものを、
// Firebaseコンソール（Realtime Database → ルール）に貼り付けて公開してください。
// ==========================================

(function dualBackupSystem() {
    'use strict';

    const SAVE_DEBOUNCE_MS = 45 * 1000;
    const BIG_DATA_URL_CHARS = 200000;            // これより大きい画像（data:〜）はFirebaseの控えに含めない
    const AUTO_COMPARE_DELAY_MS = 15 * 1000;      // 起動してから、自動比較までの待ち時間
    const AUTO_COMPARE_MIN_GAP_MS = 10 * 60 * 1000; // FirebaseとDriveの保存日時がこれ以上離れていたら「食い違い」候補
    const LAST_BACKUP_AT_KEY = 'pos_sync_last_backup_at'; // pos_sync_ で始まるので、同期・バックアップの対象外
    const COMPARED_SESSION_KEY = 'pos_dualbackup_compared';

    let saveTimer = null;
    let saving = false;

    /* ---------- 共通の小さな部品 ---------- */
    function ps() { return window.PosSync; }

    function isCustomerDisplay() {
        return typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice();
    }

    function firebaseReady() {
        return !!(ps() && ps().getCode() && ps().isReady() && ps().getPathHash() &&
            window.firebase && firebase.database);
    }

    function backupRef() {
        return firebase.database().ref('pos_backup/' + ps().getPathHash());
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s === undefined || s === null ? '' : s);
        return d.innerHTML;
    }

    function fmtTime(ms) {
        if (!ms) return '（なし）';
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function playClick() { if (typeof playSound === 'function') playSound('click'); }

    // 大きな画像（data:〜）を除いたバックアップを作る（Firebaseに送る分）
    function stripBigImages(value, depth) {
        if (typeof value === 'string') {
            return (value.startsWith('data:') && value.length > BIG_DATA_URL_CHARS) ? undefined : value;
        }
        if (depth < 1 && value && typeof value === 'object' && !Array.isArray(value)) {
            const out = {};
            Object.keys(value).forEach((k) => {
                const v = stripBigImages(value[k], depth + 1);
                if (v !== undefined) out[k] = v;
            });
            return out;
        }
        return value;
    }

    function buildBackupForFirebase() {
        if (typeof buildAllDataObject !== 'function') return null;
        const src = buildAllDataObject();
        const out = {};
        Object.keys(src).forEach((k) => {
            const v = stripBigImages(src[k], 0);
            if (v !== undefined) out[k] = v;
        });
        return out;
    }

    function summaryOf(obj) {
        if (!obj) return null;
        let at = 0;
        if (obj.savedAt) {
            const t = Date.parse(obj.savedAt);
            if (!isNaN(t)) at = t;
        }
        return {
            at: at,
            p: Array.isArray(obj.products) ? obj.products.length : 0,
            hi: Array.isArray(obj.history) ? obj.history.length : 0,
            c: Array.isArray(obj.customers) ? obj.customers.length : 0
        };
    }

    async function sha256Hex(text) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    }

    /* =========================================================
       ① Firebaseへの保存
       ========================================================= */
    async function saveFirebaseBackup(force) {
        if (saving) return false;
        if (isCustomerDisplay() || !firebaseReady()) return false;
        saving = true;
        try {
            const obj = buildBackupForFirebase();
            if (!obj) return false;

            const forHash = Object.assign({}, obj);
            delete forHash.savedAt; // 保存した時刻は毎回変わるので、内容の比較からは除く
            const hash = await sha256Hex(JSON.stringify(forHash));

            const ref = backupRef();
            if (!force) {
                const remoteHash = (await ref.child('h').once('value')).val();
                if (remoteHash === hash) return false; // すでに同じ内容が保存されている
            }

            const s = summaryOf(obj);
            const cipher = await ps().encryptJson(obj);
            await ref.set({
                d: cipher,
                h: hash,
                at: firebase.database.ServerValue.TIMESTAMP,
                s: ps().DEVICE_TAG,
                n: { p: s.p, hi: s.hi, c: s.c }
            });
            try { localStorage.setItem(LAST_BACKUP_AT_KEY, String(Date.now())); } catch (e) { /* 無視 */ }
            return true;
        } catch (e) {
            console.warn('[dual-backup] Firebaseへのバックアップに失敗しました:', e && e.message ? e.message : e);
            return false;
        } finally {
            saving = false;
        }
    }

    function scheduleFirebaseBackup() {
        if (isCustomerDisplay()) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { saveTimer = null; saveFirebaseBackup(false); }, SAVE_DEBOUNCE_MS);
    }

    // 既存のバックアップ（haruPosBackupNow）に相乗りし、同じタイミングで予約を入れる
    (function hookExistingBackup() {
        function tryHook() {
            if (typeof window.haruPosBackupNow !== 'function') {
                setTimeout(tryHook, 500);
                return;
            }
            if (window.haruPosBackupNow.__dualBackupHooked) return;
            const original = window.haruPosBackupNow;
            const wrapped = function (...args) {
                const result = original.apply(this, args);
                scheduleFirebaseBackup();
                return result;
            };
            wrapped.__dualBackupHooked = true;
            window.haruPosBackupNow = wrapped;
        }
        tryHook();
    })();

    window.addEventListener('pos-sync-ready', () => setTimeout(scheduleFirebaseBackup, 20 * 1000));

    /* =========================================================
       ② 食い違い確認
       ========================================================= */
    async function readFirebaseMeta() {
        if (!firebaseReady()) return null;
        const ref = backupRef();
        const [at, who, n] = await Promise.all(['at', 's', 'n'].map(k => ref.child(k).once('value').then(x => x.val())));
        if (!at) return null; // まだ保存されていない
        return { at: at, who: who || '', p: (n && n.p) || 0, hi: (n && n.hi) || 0, c: (n && n.c) || 0 };
    }

    async function readFirebaseBackupObject() {
        const cipher = (await backupRef().child('d').once('value')).val();
        if (!cipher) throw new Error('NO_FIREBASE_BACKUP');
        return ps().decryptJson(cipher);
    }

    async function readDriveBackupObject() {
        if (typeof ensureGoogleDriveToken !== 'function' || typeof findGoogleDriveBackupFileId !== 'function' ||
            typeof gDriveApiFetch !== 'function') return null;
        if (localStorage.getItem('pos_gdrive_connected') !== 'true') return null;
        const ok = await ensureGoogleDriveToken(false); // 自動の時は画面を出さない（トークンが無ければ諦める）
        if (!ok) return null;
        const fileId = await findGoogleDriveBackupFileId();
        if (!fileId) return null;
        const res = await gDriveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
        if (!res.ok) return null;
        return res.json();
    }

    function closeOverlay() {
        const o = document.getElementById('dual-backup-overlay');
        if (o) o.remove();
    }

    function confirmThenApply(dataObj, sourceLabel) {
        const msg = `${sourceLabel}の内容で、この端末のデータを上書きします。よろしいですか？\n（この後、他の端末にも自動で反映されます）`;
        const run = () => {
            try {
                applyImportedDataObject(dataObj);
                closeOverlay();
            } catch (e) {
                console.warn('[dual-backup] 復元に失敗しました:', e);
                alert('復元に失敗しました。もう一度お試しください。');
            }
        };
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(msg, 'ふっきゅう し ます。 よろしい です か？', (res) => { if (res) run(); }, true);
        } else if (window.confirm(msg)) {
            run();
        }
    }

    function cardHtml(title, color, s, extra, badge) {
        if (!s) {
            return `<div style="flex:1;min-width:150px;border:2px solid #ccc;border-radius:10px;padding:10px;background:#fafafa;">
                <div style="font-weight:bold;margin-bottom:6px;">${esc(title)}</div>
                <div style="color:#888;font-size:13px;">${esc(extra || '保存された内容がありません')}</div></div>`;
        }
        return `<div style="flex:1;min-width:150px;border:2px solid ${color};border-radius:10px;padding:10px;background:#fff;">
            <div style="font-weight:bold;margin-bottom:6px;">${esc(title)}${badge ? ` <span style="background:#e53935;color:#fff;border-radius:8px;padding:1px 6px;font-size:11px;">${esc(badge)}</span>` : ''}</div>
            <div style="font-size:12px;color:#555;">保存日時<br><b style="font-size:13px;color:#222;">${esc(fmtTime(s.at))}</b></div>
            <div style="font-size:13px;margin-top:6px;line-height:1.6;">商品 <b>${s.p}</b> 件<br>会計履歴 <b>${s.hi}</b> 件<br>会員 <b>${s.c}</b> 人</div>
            ${extra ? `<div style="font-size:11px;color:#777;margin-top:4px;">${esc(extra)}</div>` : ''}</div>`;
    }

    async function showCompareScreen(opts) {
        opts = opts || {};
        closeOverlay();
        const overlay = document.createElement('div');
        overlay.id = 'dual-backup-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100070;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;';
        overlay.innerHTML = `<div id="dual-backup-box" style="background:#fff;color:#222;border-radius:14px;width:100%;max-width:640px;max-height:92vh;overflow-y:auto;padding:16px;box-sizing:border-box;text-align:left;">
            <div style="text-align:center;padding:20px 0;">バックアップの状態を調べています…</div></div>`;
        document.body.appendChild(overlay);
        const box = overlay.firstElementChild;

        const local = summaryOf(typeof buildAllDataObject === 'function' ? buildAllDataObject() : null);
        if (local) local.at = Date.now();

        let fbMeta = null, driveObj = null, driveErr = false, fbErr = false;
        try { fbMeta = await readFirebaseMeta(); } catch (e) { fbErr = true; console.warn('[dual-backup]', e); }
        try { driveObj = await readDriveBackupObject(); } catch (e) { driveErr = true; console.warn('[dual-backup]', e); }
        const drive = driveObj ? summaryOf(driveObj) : null;

        // 新しい方に「いちばん新しい」を付ける
        let newest = '';
        if (fbMeta && drive) newest = fbMeta.at >= drive.at ? 'fb' : 'drive';
        else if (fbMeta) newest = 'fb';
        else if (drive) newest = 'drive';

        const fbExtra = fbErr ? '読み込めませんでした' : (fbMeta ? (fbMeta.who ? `保存した端末: ${fbMeta.who}` : '') : '保存された内容がありません');
        const driveExtra = driveErr ? '読み込めませんでした'
            : (!drive ? (localStorage.getItem('pos_gdrive_connected') === 'true' ? '読み込めません（再ログインが必要な可能性があります）' : '未連携です') : '');

        box.innerHTML = `
            <h3 style="margin:0 0 6px;">🔍 バックアップの状態</h3>
            <p style="font-size:13px;line-height:1.7;margin:0 0 12px;color:#444;">
                ${opts.auto ? '<b style="color:#c62828;">FirebaseとGoogle Driveの内容に食い違いがあります。</b><br>' : ''}
                どの内容を使うか選んでください。日時が新しい方が、通常は最新です。</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${cardHtml('📱 この端末（今）', '#1976d2', local, '')}
                ${cardHtml('🔥 Firebase', '#f57c00', fbMeta, fbExtra, newest === 'fb' ? '新しい' : '')}
                ${cardHtml('📗 Google Drive', '#2e7d32', drive, driveExtra, newest === 'drive' ? '新しい' : '')}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
                <button type="button" id="dual-keep-local" style="padding:12px;border:none;border-radius:10px;background:#1976d2;color:#fff;font-weight:bold;cursor:pointer;">📱 この端末のまま使う（FirebaseとDriveを今の内容で上書き保存）</button>
                <button type="button" id="dual-restore-fb" ${fbMeta ? '' : 'disabled'} style="padding:12px;border:none;border-radius:10px;background:#f57c00;color:#fff;font-weight:bold;cursor:pointer;${fbMeta ? '' : 'opacity:.4;'}">🔥 Firebaseの内容に戻す</button>
                <button type="button" id="dual-restore-drive" ${drive ? '' : 'disabled'} style="padding:12px;border:none;border-radius:10px;background:#2e7d32;color:#fff;font-weight:bold;cursor:pointer;${drive ? '' : 'opacity:.4;'}">📗 Google Driveの内容に戻す</button>
                <button type="button" id="dual-close" style="padding:10px;border:none;border-radius:10px;background:#757575;color:#fff;cursor:pointer;">あとで決める（閉じる）</button>
            </div>
            <p style="font-size:11px;color:#777;line-height:1.6;margin:10px 0 0;">※「戻す」を選ぶと、この端末のデータがその内容に置き換わり、同じデータ用コードの他の端末にも反映されます。画像（ロゴ・お会計完了画像など）は、Firebaseのバックアップには含まれないため、Firebaseから戻しても今の画像がそのまま残ります。</p>`;

        box.querySelector('#dual-close').addEventListener('click', () => { playClick(); closeOverlay(); });

        box.querySelector('#dual-keep-local').addEventListener('click', async (ev) => {
            playClick();
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.textContent = '保存しています…';
            const okFb = await saveFirebaseBackup(true);
            let okDrive = null;
            if (localStorage.getItem('pos_gdrive_connected') === 'true' && typeof backupToGoogleDriveNow === 'function') {
                try { await backupToGoogleDriveNow(true); okDrive = true; } catch (e) { okDrive = false; }
            }
            btn.textContent = `✅ 保存しました（Firebase: ${okFb ? '成功' : '失敗'}${okDrive === null ? '' : ' / Drive: ' + (okDrive ? '成功' : '失敗')}）`;
            setTimeout(closeOverlay, 1800);
        });

        const fbBtn = box.querySelector('#dual-restore-fb');
        if (fbMeta) {
            fbBtn.addEventListener('click', async () => {
                playClick();
                fbBtn.disabled = true;
                try {
                    const obj = await readFirebaseBackupObject();
                    fbBtn.disabled = false;
                    confirmThenApply(obj, 'Firebase');
                } catch (e) {
                    fbBtn.disabled = false;
                    alert('Firebaseの内容を読み込めませんでした（データ用コードが違う可能性があります）。');
                }
            });
        }
        const driveBtn = box.querySelector('#dual-restore-drive');
        if (drive) {
            driveBtn.addEventListener('click', () => { playClick(); confirmThenApply(driveObj, 'Google Drive'); });
        }
    }

    // 起動時の自動チェック：FirebaseとDriveが「大きく」食い違う時だけ画面を出す
    async function autoCompareOnStartup() {
        if (isCustomerDisplay() || !firebaseReady()) return;
        try { if (sessionStorage.getItem(COMPARED_SESSION_KEY) === '1') return; } catch (e) { /* 無視 */ }
        try { sessionStorage.setItem(COMPARED_SESSION_KEY, '1'); } catch (e) { /* 無視 */ }
        try {
            const fb = await readFirebaseMeta();
            if (!fb) return;
            const driveObj = await readDriveBackupObject();
            if (!driveObj) return;
            const dr = summaryOf(driveObj);
            const farApart = Math.abs(fb.at - dr.at) > AUTO_COMPARE_MIN_GAP_MS;
            const countsDiffer = fb.p !== dr.p || fb.hi !== dr.hi || fb.c !== dr.c;
            if (farApart && countsDiffer) showCompareScreen({ auto: true });
        } catch (e) {
            console.warn('[dual-backup] 起動時の確認に失敗しました（無視して続行します）:', e);
        }
    }

    window.addEventListener('pos-sync-ready', () => setTimeout(autoCompareOnStartup, AUTO_COMPARE_DELAY_MS));
    if (window.PosSync && typeof window.PosSync.isReady === 'function' && window.PosSync.isReady()) {
        setTimeout(autoCompareOnStartup, AUTO_COMPARE_DELAY_MS); // 読み込みより前に準備が終わっていた場合の保険
    }

    /* =========================================================
       データ管理画面の「バックアップの状態を確認」ボタン
       ========================================================= */
    function ensureCompareBlock() {
        if (isCustomerDisplay()) return;
        const container = document.getElementById('migration-screen');
        if (!container || document.getElementById('dual-backup-block')) return;
        const block = document.createElement('div');
        block.id = 'dual-backup-block';
        block.className = 'migration-block';
        block.style.cssText = 'background:#fff3e0;border:2px solid #ffb74d;padding:15px;border-radius:6px;margin-top:10px;';
        block.innerHTML = `
            <h3 class="migration-title" style="color:#e65100;">🔥 Firebaseにも二重保存しています</h3>
            <p style="font-size:13px;line-height:1.7;margin:0 0 10px;">
                Google Driveに加えて、Firebaseにも暗号化して自動でバックアップしています（データ用コードを設定している時だけ）。<br>
                この端末・Firebase・Google Driveの内容を比べて、使う内容を選べます。</p>
            <button type="button" id="dual-open-btn" style="padding:10px 16px;border:none;border-radius:16px;background:#ef6c00;color:#fff;font-weight:bold;cursor:pointer;">🔍 バックアップの状態を確認</button>`;
        container.appendChild(block);
        block.querySelector('#dual-open-btn').addEventListener('click', () => { playClick(); showCompareScreen({ auto: false }); });
    }

    (function hookShowScreen() {
        function tryHook() {
            if (typeof window.showScreen !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            if (window.showScreen.__dualBackupHooked) return;
            const original = window.showScreen;
            const wrapped = function (screenId, ...rest) {
                const result = original.apply(this, [screenId, ...rest]);
                if (screenId === 'migration-screen') ensureCompareBlock();
                return result;
            };
            wrapped.__dualBackupHooked = true;
            window.showScreen = wrapped;
        }
        tryHook();
    })();

    // コンソールから手動で使いたい時用
    window.haruDualBackup = { saveNow: () => saveFirebaseBackup(true), openCompare: () => showCompareScreen({ auto: false }) };
})();
