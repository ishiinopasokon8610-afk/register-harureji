// ==========================================
// json-export-import-block-position-fix.js（改訂版）
// ------------------------------------------
// 【背景】
// json-export-import-system.js の ensureJsonExportImportBlock() は
// container.appendChild(block) のため、「💾 設定データの手動バックアップ
// （gzip圧縮）」ブロックが常に #migration-screen の一番最後（他の追加機能
// ブロックが増えるたびに、さらにその後ろ）に置かれてしまい、内容的に
// 関連が深い「💾 データのバックアップ（データ自動削除対策）」＝
// Googleドライブ連携ブロック（📗 Google Driveと連携／📤 今すぐDriveに
// バックアップ／📥 Driveから復元）から離れた位置に表示されていた。
// サイドバー（migration-anchor-nav-system.js の buildMigrationAnchorNav()）
// は #migration-screen 内の .migration-title を「その時点のDOM順」で
// 読み取って一覧を作る作りなので、DOMの並びさえ正しければサイドバーの
// 並びにも反映される。
//
// 【前回版からの改訂】
// 前回は ensureJsonExportImportBlock() をラップして「作られた直後に
// 動かす」方式にしていたが、これは showScreen() を多重にラップしている
// 他のファイル（migration-anchor-nav-system.js 等）との実行順に依存して
// しまい、タイミングによっては効かない場合があった。
// 今回は #migration-screen を直接 MutationObserver で監視し、
// 「JSONブロックがどこに現れても／動いても、その都度Googleドライブ連携
// ブロックの直後へ強制的に位置を戻す」方式に変更し、フックの実行順に
// 依存しないようにする。
//
// index.html / json-export-import-system.js は直接編集せず、
// 完全に独立した監視処理として実現する（他の追加機能ファイルと同じ方針）。
//
// 【導入方法】
// index.html内のどこでもよいので（json-export-import-system.jsより
// 後ろを推奨）、このファイルを読み込んでください。
//   <script src="json-export-import-system.js"></script>
//   <script src="json-export-import-block-position-fix.js"></script>
// ==========================================

(function setupJsonExportImportBlockPositionFix() {
    function tryInit() {
        const container = document.getElementById('migration-screen');
        if (!container) {
            setTimeout(tryInit, 300);
            return;
        }

        function repositionJsonExportImportBlock() {
            const block = document.getElementById('json-export-import-block');
            if (!block) return; // まだ作られていない

            const gdriveBtn = container.querySelector('[onclick="connectGoogleDrive()"]');
            const gdriveBlock = gdriveBtn ? gdriveBtn.closest('.migration-block') : null;
            if (!gdriveBlock) return; // 見つからない場合は何もしない（安全側）

            // すでに正しい位置（Googleドライブ連携ブロックの直後）にあるなら何もしない
            // （ここでガードしておかないと、この移動操作自体がMutationObserverを
            // 再度呼び出し、無限ループになってしまう）
            if (gdriveBlock.nextElementSibling === block) return;

            gdriveBlock.insertAdjacentElement('afterend', block);
        }

        // すでにブロックが存在する状態でこのファイルが読み込まれた場合にも対応
        repositionJsonExportImportBlock();

        const observer = new MutationObserver(repositionJsonExportImportBlock);
        observer.observe(container, { childList: true });
    }
    tryInit();
})();
