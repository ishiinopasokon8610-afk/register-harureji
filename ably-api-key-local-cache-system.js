// ==========================================
// ably-api-key-local-cache-system.js
// ------------------------------------------
// このファイルも index.html / api-key-shop-id-migration-fix-system.js を
// 直接編集せず、他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【背景】
// 店舗ID（pos_shop_id）・配色設定（pos_color_mode）は、それぞれ
// shop-id-system.js・dark-mode-system.js の時点で既にlocalStorageに
// 保存されている。一方、AblyのAPIキーだけはこれまでFirestoreからのみ
// 取得しており（loadPosApiKeyFromFirestoreRaw()）、localStorageには
// 一切保存されていなかった。そのため、ページを開くたびに必ず
// Firestoreへの通信が発生し、通信状況が悪い・一時的にオフライン
// といった場面ではAPIキーの取得に失敗し、リアルタイム同期が使えない
// まま起動してしまうことがあった。
//
// 【今回の対応】
// Firestoreから正常にAPIキーを取得できた場合、店舗ID（未設定なら
// 'default'）ごとにlocalStorageへもキャッシュしておく
// （キー：pos_ably_api_key_cache_{店舗IDまたはdefault}）。
// 次回以降、何らかの理由でFirestoreからの取得に失敗した場合は、
// このキャッシュを代わりに使う（あくまで「取得できないよりまし」な
// 保険。Firestoreから正常に取れた場合は毎回最新の値で上書きする
// ため、キャッシュが古いまま使われ続けることはない）。
//
// なお、api-key-shop-id-migration-fix-system.js が
// loadPosApiKeyFromFirestoreRaw() を既に1回ラップしている
// （店舗ID設定前に保存されたキーの救済用）ため、このファイルは
// さらにその外側から重ねてラップする形になる。
//
// 【前提にしていること】
// loadPosApiKeyFromFirestoreRaw() / getShopIdForRealtimeKey() は、
// index.html内の<script>（通常のグローバルスクリプト）でトップレベルに
// 定義されており、他の追加機能ファイルからも参照・上書きできることを
// 前提にしている。
//
// 【導入方法】
// index.html内で、api-key-shop-id-migration-fix-system.js より
// 後ろに読み込んでください。
//   <script src="api-key-shop-id-migration-fix-system.js"></script>
//   <script src="ably-api-key-local-cache-system.js"></script>
// ==========================================

(function () {
    'use strict';

    function tryHook() {
        if (
            typeof window.loadPosApiKeyFromFirestoreRaw !== 'function' ||
            typeof window.getShopIdForRealtimeKey !== 'function'
        ) {
            setTimeout(tryHook, 300);
            return;
        }

        function tpAblyApiKeyCacheKey() {
            const shopId = (typeof getShopIdForRealtimeKey === 'function') ? getShopIdForRealtimeKey() : '';
            return `pos_ably_api_key_cache_${shopId || 'default'}`;
        }

        const originalRaw = window.loadPosApiKeyFromFirestoreRaw;
        window.loadPosApiKeyFromFirestoreRaw = async function (...args) {
            const cacheKey = tpAblyApiKeyCacheKey();

            try {
                const key = await originalRaw.apply(this, args);
                if (key) {
                    // Firestoreから正常に取得できた＝最新の値なので、
                    // localStorageのキャッシュを常に最新化しておく
                    try { localStorage.setItem(cacheKey, key); } catch (e) { /* 無視 */ }
                }
                return key;
            } catch (e) {
                console.warn('AblyのAPIキー取得（Firestore）に失敗しました。ローカルのキャッシュを確認します:', e);
                let cached = '';
                try {
                    cached = localStorage.getItem(cacheKey) || '';
                } catch (e2) { /* 無視 */ }
                if (cached) return cached;
                throw e; // キャッシュも無い場合は、これまで通りエラーとして扱う
            }
        };
    }
    tryHook();
})();
