// ==========================================
// sw-update-applied-toast-system.js
// ------------------------------------------
// このファイルも index.html / sw.js / update-notification-system.js を
// 直接編集せず、他の追加機能ファイルと同じ「フック/イベント監視方式」で
// 実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【前提：sw.js側の「アップデートされたらキャッシュを削除する」動作】
// sw.js はすでに、CACHE_VERSIONを上げてデプロイすると
//   ・install時：新しいCACHE_NAMEで、最新のindex.html・追加機能
//     スクリプト一式を丸ごと取り直してキャッシュする
//   ・activate時：今のCACHE_NAME以外（＝古いバージョンのキャッシュ）を
//     すべて削除する
// という動作になっており、「アップデートされたら（古い）キャッシュを
// 削除する」という部分はすでに実現済みだったため、sw.js自体への変更は
// 今回不要と判断した。
//
// 【今回追加したいこと】
// update-notification-system.js の「🔄 新しいバージョンがあります。
// タップしてリロード」という通知は、お会計中に勝手にリロードされて
// 困ることがないよう、あえて「利用者が自分でタップするまで何もしない」
// 作りになっている（そちらの意図は変えず、そのまま残す）。
//
// それとは別に、実際にブラウザの裏側でService Workerが新しいバージョンに
// 切り替わった（＝新しいキャッシュへの入れ替えが完了した）瞬間に、
// 軽く「🔄 アップデートが入りました」という通知を一瞬だけ出す。
// 自動リロードはしない（今の画面・操作中の内容はそのまま）ため、
// お会計中でも安心して出せる、あくまで「お知らせ」だけの表示。
//
// 【判定方法】
// ブラウザ標準の 'controllerchange' イベント
// （navigator.serviceWorker.controller が新しいService Workerに
// 切り替わった時に発火する）を使う。
// ただし、このイベントは「初めてこのアプリを開いた時（＝まだ一度も
// Service Workerに制御されていなかったページが、初めて制御下に入る時）」
// にも発火してしまう。これは「アップデート」ではなく単なる初回起動な
// ので、通知を出したくない。
// そのため、このファイルが最初に実行された時点で、すでに
// navigator.serviceWorker.controller が存在していたかどうかを覚えて
// おき、「元々ある状態で、それが別のものに切り替わった」場合だけを
// 本当のアップデートとみなして通知を出す。
// ==========================================

(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) return;

    // 【文言を修正】controllerchange が起きた時点でわかるのは「裏側のキャッシュが
    // 新しい版に入れ替わった」ことだけで、いま開いている画面のJSは古いまま
    // （リロードするまで新しい版にはならない）。
    // 以前の「アップデートが入りました」だと、画面右下のバージョン表示がまだ古い
    // ままなのに「更新済み」と読めてしまい、「更新されていない」と見えていたため、
    // 実際の状態どおり「取得済み・リロードで反映」と分かる文言にした。
    const UPDATE_APPLIED_TOAST_MESSAGE = '🔄 新しいバージョンを取得しました（リロードで反映されます）';

    // このファイルの実行時点ですでにController（＝以前からのService Worker）が
    // いたかどうか。いなければ「今回が初回起動」とみなし、その後の
    // controllerchangeは通知しない。
    const hadControllerAtLoad = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadControllerAtLoad) return; // 初回起動時の切り替わりは対象外
        showSwUpdateAppliedToast();
    });

    function showSwUpdateAppliedToast() {
        // notifications-system.js等、アプリ側に既存のトースト表示関数
        // （showToast）があれば、見た目を揃えるためそちらを優先して使う。
        if (typeof window.showToast === 'function') {
            window.showToast(UPDATE_APPLIED_TOAST_MESSAGE);
            return;
        }

        // 無ければ、既存の#toast-containerを使って簡易表示する
        // （それも無ければ document.body に直接出す）。
        const host = document.getElementById('toast-container') || document.body;
        const toast = document.createElement('div');
        toast.textContent = UPDATE_APPLIED_TOAST_MESSAGE;
        toast.style.cssText = [
            'position:fixed', 'left:50%', 'bottom:60px', 'transform:translateX(-50%)',
            'z-index:100000', 'background:#263238', 'color:#fff',
            'padding:10px 18px', 'border-radius:20px', 'font-size:13px',
            'box-shadow:0 4px 16px rgba(0,0,0,0.35)', 'pointer-events:none',
            'max-width:92vw', 'text-align:center'
        ].join(';');
        host.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
})();
