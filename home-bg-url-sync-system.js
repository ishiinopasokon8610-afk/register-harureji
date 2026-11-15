// ==========================================
// home-bg-url-sync-system.js（新規）
// ------------------------------------------
// 【目的】ホーム画面の背景画像（pos_home_bg）を、重い画像データのまま他端末へ
// 同期するのをやめ、Google Drive上のURL（pos_home_bg_url）だけを同期する。
// ・アップロード時：uploadHomeBg の完了後、保存された画像をDriveへ上げ、URLを pos_home_bg_url に保存
// ・他端末：pos_home_bg_url の変更を受け取ると、pos_home_bg にそのURLを入れて applyHomeBg() で反映
// ・削除：pos_home_bg が空になったら pos_home_bg_url も消す（他端末の背景も消える）
// ・Driveに未接続のときはURL化できないため、その端末だけの背景になる（他端末へは行かない）
// 読み込み位置：firebase-image-storage.js（uploadDataUrlToCloudImage）より後ろ
// ==========================================
(function homeBgUrlSync() {
    const BG_KEY = 'pos_home_bg';
    const URL_KEY = 'pos_home_bg_url';
    const FILENAME = 'haru-pos-home-bg.jpg';

    function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

    // 他端末から受け取ったURLを、この端末の背景として反映する
    window.applyHomeBgFromSyncedUrl = function () {
        const url = get(URL_KEY);
        try {
            if (url && url.indexOf('https://') === 0) localStorage.setItem(BG_KEY, url);
            else localStorage.removeItem(BG_KEY);
        } catch (e) {}
        lastBg = get(BG_KEY); // 自分で消した扱いにならないよう記録を更新
        if (typeof window.applyHomeBg === 'function') window.applyHomeBg();
    };

    let lastBg = get(BG_KEY);

    function hookUpload() {
        if (typeof window.uploadHomeBg !== 'function' || typeof window.uploadDataUrlToCloudImage !== 'function') {
            setTimeout(hookUpload, 300);
            return;
        }
        const original = window.uploadHomeBg;
        window.uploadHomeBg = async function (event) {
            const result = await original.apply(this, arguments);
            const data = get(BG_KEY);
            lastBg = data;
            if (data.indexOf('data:') === 0) {
                const url = await window.uploadDataUrlToCloudImage(data, FILENAME);
                if (url) {
                    try { localStorage.setItem(URL_KEY, url); } catch (e) {}
                    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                } else {
                    // Driveに上げられなかった：古いURLが残ると他端末に古い背景が出続けるため消す
                    try { localStorage.removeItem(URL_KEY); } catch (e) {}
                }
            }
            return result;
        };
    }
    hookUpload();

    // 起動時：この端末に画像データが無く、同期されたURLがあれば反映する
    function initialApply() {
        if (!get(BG_KEY) && get(URL_KEY)) window.applyHomeBgFromSyncedUrl();
    }
    setTimeout(initialApply, 1500);

    // 背景が削除されたら（pos_home_bgが空になったら）URLも消して他端末へ伝える
    setInterval(function () {
        const cur = get(BG_KEY);
        if (lastBg && !cur && get(URL_KEY)) {
            try { localStorage.removeItem(URL_KEY); } catch (e) {}
            if (typeof window.deleteGoogleDriveFileByName === 'function') {
                window.deleteGoogleDriveFileByName(FILENAME, false);
            }
        }
        lastBg = cur;
    }, 2000);
})();
