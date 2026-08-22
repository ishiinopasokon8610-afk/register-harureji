// ==========================================
// copy-deterrence.js
// 右クリック・開発者ツールのショートカットキー・テキスト選択を無効化する
// ------------------------------------------
// 【重要な前提（正直な説明・必ず読んでください）】
// これは domain-lock.js と違い、「技術的に防ぐ」ものではなく、
// あくまで「なんとなく右クリックした」「なんとなくCtrl+Uを押した」人への
// カジュアルな牽制にしかなりません。以下のようにどれも簡単に回避できます：
//
//   ・右クリック禁止        → ブラウザ右上メニュー →「その他のツール」→
//                            「デベロッパーツール」からソースは普通に見られる
//   ・F12 / Ctrl+Shift+I禁止 → 同上。メニューから開けば無関係
//   ・Ctrl+U禁止             → アドレスバーに view-source:実際のURL と直接入力すれば見える
//   ・テキスト選択禁止        → ブラウザの「翻訳」機能や、開発者ツールでの直接編集で
//                            結局コピーはできる。JS自体をオフにすれば全部無効化される
//
// つまり「本気でコピーしようとする人」は防げません。防げるのは
// 「軽い気持ちで右クリック→ソース表示、くらいの人」までです。
// それでも十分価値があると判断する場合は、このまま使ってください。
//
// register.js / master-mgmt.js / ui.js は直接編集せず、
// 独立したイベントリスナー追加だけで完結させる。
// ==========================================

(function () {
    // 右クリックメニューを無効化
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });

    // 開発者ツールを開く主要なショートカットキーを無効化
    document.addEventListener('keydown', function (e) {
        // F12
        if (e.key === 'F12') {
            e.preventDefault();
            return;
        }
        // Ctrl+Shift+I（要素の検証） / Ctrl+Shift+J（コンソール） / Ctrl+Shift+C（要素選択）
        if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
            e.preventDefault();
            return;
        }
        // Ctrl+U（ページのソースを表示）
        if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            return;
        }
        // Ctrl+S（名前を付けて保存）
        if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            return;
        }
        // Mac用（Cmd+Option+I など）
        if (e.metaKey && e.altKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
            e.preventDefault();
            return;
        }
    });

    // テキスト選択・ドラッグでのコピーを無効化するCSSを差し込む
    const style = document.createElement('style');
    style.textContent = `
        * {
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            user-select: none;
        }
        /* jan-input・各種テキスト入力欄など、店員が実際に文字入力する場所は
           選択禁止にすると使い物にならなくなるため、input/textareaだけは元に戻す */
        input, textarea {
            -webkit-user-select: text;
            -moz-user-select: text;
            -ms-user-select: text;
            user-select: text;
        }
    `;
    document.head.appendChild(style);

    // 画像のドラッグ保存を軽く抑止（こちらも回避は容易）
    document.addEventListener('dragstart', function (e) {
        if (e.target && e.target.tagName === 'IMG') {
            e.preventDefault();
        }
    });
})();
