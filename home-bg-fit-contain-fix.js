// ==========================================
// home-bg-fit-contain-fix.js
// ------------------------------------------
// 【不具合】
// 「🖼️ ホーム画面の背景の登録」で設定した画像が、ホーム画面
// （#home-screen）で background-size: cover で表示されていたため、
// 画像の縦横比とホーム画面の縦横比が合わない場合に、画像の上下や
// 左右がはみ出て切り取られてしまっていた（auth-system.js の
// applyHomeBg() 参照）。
//
// 【この修正】
// background-size を contain に変更し、画像の縦横比を保ったまま
// 必ず全体が収まるようにする。はみ出さない分、枠の縦横比と合わない
// ところはホーム画面本来の背景色で余白ができる。
//
// index.html / auth-system.js は直接編集せず、
// applyHomeBg() をラップするフック方式で実現する
// （他の追加機能ファイルと同じ方針）。
//
// 【導入方法】
// index.html内で、auth-system.js の後ろに
// このファイルを読み込んでください。
//   <script src="auth-system.js"></script>
//   <script src="home-bg-fit-contain-fix.js"></script>
// ==========================================

(function hookApplyHomeBgForContainFit() {
    function tryHook() {
        if (typeof window.applyHomeBg !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.applyHomeBg;
        window.applyHomeBg = function (...args) {
            const result = original.apply(this, args);

            const homeScreen = document.getElementById('home-screen');
            const bgData = localStorage.getItem('pos_home_bg');
            if (homeScreen && bgData) {
                homeScreen.style.backgroundSize = 'contain';
                // containだと画像の周りに余白ができるため、その余白が
                // 目立たないよう、背景を中央寄せ・繰り返しなしのまま維持する
                homeScreen.style.backgroundPosition = 'center';
                homeScreen.style.backgroundRepeat = 'no-repeat';
            }

            return result;
        };
    }
    tryHook();
})();
