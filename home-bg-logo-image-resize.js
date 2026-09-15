// ==========================================
// home-bg-logo-image-resize.js
// ------------------------------------------
// 【背景】
// receipt-footer-system.js（footerResizeImageToDataUrl）や
// receipt-coupon-system.js（couponResizeImageToDataUrl）の画像設定は、
// アップロード時にCanvasで幅・画質を落としてから保存しているのに対し、
// ホーム画面の背景（uploadHomeBg）・お店のロゴ（uploadShopLogo）は
// auth-system.js側でファイルをそのままBase64化して保存しているだけで、
// 圧縮・リサイズが一切行われていなかった。
//
// スマホ等で撮った写真をそのまま背景に設定すると、元データが数MBのまま
// localStorageに入り、extra-settings-ably-sync.js経由でAablyへ送ろうと
// した際にメッセージサイズ上限へ引っかかりやすくなる。
// （zip等の後掛け圧縮は、JPEG/PNGがすでに圧縮済み形式のためほとんど
// 　縮まらない。効果があるのは「保存前に解像度・画質そのものを
// 　落とす」方式であり、これはfooter/couponの画像設定で既に採用
// 　実績のある方式のため、それをそのまま踏襲する）。
//
// 【この機能】
// auth-system.js の uploadHomeBg() / uploadShopLogo() を上書きし、
// 保存前にCanvas経由で幅・画質を圧縮する。保存後の流れ（localStorageの
// キー名・applyHomeBg()/applyShopLogo()の呼び出し・完了メッセージ）は
// 元の実装と同じにしてあるため、呼び出し元のHTML
// （onchange="uploadHomeBg(event)" 等）は変更不要。
//
// 背景はロゴより大きく表示されるため、ロゴよりやや大きめのサイズを
// 許容している。それでも元が非常に高解像度の写真だった場合、圧縮後も
// Aablyのメッセージサイズ上限を超える可能性はゼロではない。その場合の
// 挙動（コンソール警告のみ・アプリ動作は継続・Google Driveバックアップ
// 経由でページの開き直し時に他端末へ反映）はextra-settings-ably-sync.js
// 側の対応のまま変わらない。
//
// auth-system.js は直接編集せず、関数の上書き（フック方式）で対応する。
// ==========================================

// footer/couponと同じ考え方のリサイズ処理（Canvasで再エンコードしてdataURL化する）
function resizeImageFileToDataUrl(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.width);
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

/* =========================================================
   ホーム背景：最大幅1200px・画質0.75で保存する
   （写真的な内容が多く、多少画質を落としても背景としては気になりにくいため）
   ========================================================= */
(function overrideUploadHomeBgForResize() {
    function tryHook() {
        if (typeof window.uploadHomeBg !== 'function' || typeof window.applyHomeBg !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        window.uploadHomeBg = async function (event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const dataUrl = await resizeImageFileToDataUrl(file, 1200, 0.75);
                localStorage.setItem('pos_home_bg', dataUrl);
                applyHomeBg();
                if (typeof playSound === 'function') playSound('success');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm('ホーム画面の背景を保存しました！', 'ほーむがめん の はいけい を ほぞん し まし た', () => {}, false);
                }
            } catch (e) {
                console.warn('背景画像の圧縮・保存に失敗しました:', e);
                if (typeof playSound === 'function') playSound('error');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm('背景画像の保存に失敗しました。', 'はいけい がぞう の ほぞん に しっぱい し まし た', () => {}, true);
                }
            }
        };
    }
    tryHook();
})();

/* =========================================================
   お店のロゴ：最大幅800px・画質0.85で保存する
   （文字・線が含まれることが多く、背景より画質を残したいため）
   ========================================================= */
(function overrideUploadShopLogoForResize() {
    function tryHook() {
        if (typeof window.uploadShopLogo !== 'function' || typeof window.applyShopLogo !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        window.uploadShopLogo = async function (event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const dataUrl = await resizeImageFileToDataUrl(file, 800, 0.85);
                localStorage.setItem('pos_shop_logo', dataUrl);
                applyShopLogo();
                if (typeof playSound === 'function') playSound('success');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm('お店のロゴ画像を保存しました！', 'ろご がぞう を ほぞん し まし た', () => {}, false);
                }
            } catch (e) {
                console.warn('ロゴ画像の圧縮・保存に失敗しました:', e);
                if (typeof playSound === 'function') playSound('error');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm('ロゴ画像の保存に失敗しました。', 'ろご がぞう の ほぞん に しっぱい し まし た', () => {}, true);
                }
            }
        };
    }
    tryHook();
})();
