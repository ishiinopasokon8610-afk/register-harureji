// ==========================================
// auto-hide-cursor-system.js
// ------------------------------------------
// 【この機能】
// 何も操作せずに5秒たったら、マウスカーソルを非表示にする。
// マウスを動かす・クリックする・スクロールする・キーを押す・画面をタッチする、
// のどれかをすると、すぐにまた表示される。
// （レジの画面で、カーソルが商品や文字に重なったまま見づらい、という時のため。
// 　客用ディスプレイなど、ずっと置きっぱなしの画面でも、カーソルが出っぱなしに
// 　ならない。全ての画面で同じように動く。）
//
// index.html / style.css は直接編集せず、他の追加機能ファイルと同じ方式で、
// 専用の <style> を1つ差し込み、<html> 要素に 'cursor-idle' クラスを付け外し
// することで実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【注意していること】
// Chromeなどでは、画面の一部が書き換わる（例: 経過時間の表示が1秒ごとに
// 更新される）と、マウスを動かしていなくても、ブラウザが同じ位置での
// 'mousemove' を勝手に発火させることがある。これをそのまま「操作された」と
// 扱うと、カーソルがすぐ復活してしまうため、前回と座標が同じ 'mousemove' は
// 無視している。
//
// 【変更したい場合】
// 下の CURSOR_HIDE_IDLE_MS（ミリ秒）を書き換えてください（5秒 = 5000）。
//
// 【導入方法】
// index.html内のどこでもよいので、このファイルを読み込んでください。
//   <script src="auto-hide-cursor-system.js"></script>
// ==========================================

(function autoHideCursorSystem() {
    const CURSOR_HIDE_IDLE_MS = 5000; // 操作がなくなってから、カーソルを消すまでの時間
    const IDLE_CLASS = 'cursor-idle';
    const STYLE_ID = 'auto-hide-cursor-style';

    let idleTimer = null;
    let lastX = null;
    let lastY = null;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        // ボタンなどに個別の cursor 指定があっても消えるよう !important を付ける
        style.textContent = `html.${IDLE_CLASS}, html.${IDLE_CLASS} * { cursor: none !important; }`;
        (document.head || document.documentElement).appendChild(style);
    }

    function hideCursor() {
        document.documentElement.classList.add(IDLE_CLASS);
    }

    function showCursorAndRestartTimer() {
        document.documentElement.classList.remove(IDLE_CLASS);
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(hideCursor, CURSOR_HIDE_IDLE_MS);
    }

    function onMouseMove(e) {
        // 座標が前回と同じ mousemove は、実際にはマウスが動いていない
        // （画面の書き換えでブラウザが発火させたもの）ため無視する
        if (e.clientX === lastX && e.clientY === lastY) return;
        lastX = e.clientX;
        lastY = e.clientY;
        showCursorAndRestartTimer();
    }

    function start() {
        ensureStyle();

        window.addEventListener('mousemove', onMouseMove, { passive: true });
        ['mousedown', 'wheel', 'keydown', 'touchstart', 'pointerdown'].forEach((type) => {
            window.addEventListener(type, showCursorAndRestartTimer, { passive: true, capture: true });
        });

        // 起動直後から数えはじめる（何も操作しなければ、5秒後に消える）
        showCursorAndRestartTimer();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
