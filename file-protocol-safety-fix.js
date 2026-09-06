// ==========================================
// file-protocol-safety-fix.js
// ------------------------------------------
// 【背景】
// このアプリを file:// （フォルダ内のindex.htmlを直接ダブルクリック）で
// 開いた場合、Chrome等のブラウザは history.pushState() / replaceState() を
// 「安全でない操作」としてブロックし、例外(エラー)を投げる。
//
// タッチパネル機能(touch-panel-order-system.js)は、タッチパネルを開いた
// ときにURLのハッシュを#touch-panelに変更するためpushState()を呼んでおり、
// file://環境ではここで例外が発生する。この関数呼び出しはtry/catchで
// 囲まれていないため、例外が発生するとその直後に続くはずだった処理
// （背景・商品写真の反映など）まで一緒に止まってしまい、
// 「背景・写真が急に表示されなくなった」ように見える不具合が起きる。
//
// 【この修正】
// history.pushState / replaceState を、失敗しても例外を外に投げない
// 安全な版に置き換える（＝file://では見た目上ハッシュが変わらないだけで、
// それ以外の動作・見た目には影響しない）。
//
// 【重要】
// これはあくまで応急処置です。file://では他にも
// ・Service Worker(sw.js)がそもそも動作しない
// ・画像URLの検証やアップデート確認など、通信を伴う一部の機能が動かない
// といった制限があるため、できる限り早めに、GitHub Pagesなどの
// https:// のURL、または簡易サーバー経由のhttp://localhost で
// 開く運用に切り替えることを強くおすすめします。
//
// 【導入方法】
// index.html内で、他のどのスクリプトよりも「先」に
// このファイルを読み込んでください（<script src="touch-panel-order-system.js">
// より前）。
// ==========================================

(function makeHistoryApiSafeForFileProtocol() {
    ['pushState', 'replaceState'].forEach((methodName) => {
        const original = history[methodName];
        if (typeof original !== 'function' || original.__tpFileSafePatched) return;

        function safeMethod(...args) {
            try {
                return original.apply(history, args);
            } catch (e) {
                // file:// 環境などでブロックされた場合は、ここで静かに諦める。
                // ページの表示・動作には影響させない（URLのハッシュ表示だけが
                // 変わらない、という見た目上の差にとどめる）。
                console.warn(`[file-protocol-safety-fix] history.${methodName}() が失敗したため無視しました:`, e);
                return undefined;
            }
        }
        safeMethod.__tpFileSafePatched = true;
        history[methodName] = safeMethod;
    });
})();
