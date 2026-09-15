// ==========================================
// api-key-shop-id-migration-fix-system.js
// ------------------------------------------
// このファイルも index.html / shop-id-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【不具合】
// AblyのAPIキーは、index.html内で
//   pos_realtime_settings/{店舗ID（getShopIdForRealtimeKey()の戻り値）}
// というFirestoreの場所に保存・読み込みされている。
// getShopIdForRealtimeKey() は、shop-id-system.js の getShopId()
// （＝店舗ID未設定なら空文字）が空の場合、'default' にフォールバックする
// 仕組みになっている。
//
// そのため、
//   ① 店舗ID（数字10桁）をまだ設定していない状態でAPIキーを保存すると、
//     pos_realtime_settings/default に保存される
//   ② その後で店舗IDを設定すると（saveShopId()は成功後に自動で
//     ページをリロードする）、以後は
//     pos_realtime_settings/{設定した店舗ID} という別の場所だけを
//     見るようになる
// という流れになり、①で保存したAPIキーが②以降は見えなくなって
// しまっていた。画面には「初めて入った人は設定をしてください！」が
// 再び表示され、店員から見ると「APIキーを保存したのに、店舗IDを
// 設定したら何もなかったことになった（消えた）」ように見える。
//
// 【対応】
// APIキーの読み込み（loadPosApiKeyFromFirestoreRaw()）を上書きし、
// 今の店舗IDの場所に見つからなかった場合だけ、念のため
// pos_realtime_settings/default も確認する。そこに残っていた場合は、
//   ・その値を今回の読み込み結果として使う（画面には正しく表示される）
//   ・今の店舗IDの場所にも同じ値を複製保存しておく（savePosApiKeyToFirestore()
//     をそのまま利用）。これにより、次回以降はdefaultを見に行かなくても
//     最初から正しい場所から読み込めるようになる。
// 今の店舗IDの場所に既に値がある場合や、店舗IDがそもそも未設定
// （＝現在も'default'を見ている）場合は、この救済処理自体を行わない
// （defaultをそのまま使うのが正しい状態のため）。
//
// 【前提にしていること】
// loadPosApiKeyFromFirestoreRaw() / getFirestoreForRealtimeKey() /
// getShopIdForRealtimeKey() / savePosApiKeyToFirestore() /
// POS_REALTIME_SETTINGS_COLLECTION は、いずれもindex.html内の
// <script>（通常のグローバルスクリプト）でトップレベルに定義されており、
// 他の追加機能ファイルからも参照・上書きできることを前提にしている。
//
// 【導入方法】
// index.html内で、shop-id-system.js より後ろであればどこでも構わない
// （APIキーの読み込みはページ読み込み時に1回行われるため、なるべく
// 早い段階で読み込んでおくのが望ましい）。
// ==========================================

(function () {
    'use strict';

    function tryHook() {
        if (
            typeof window.loadPosApiKeyFromFirestoreRaw !== 'function' ||
            typeof window.getFirestoreForRealtimeKey !== 'function' ||
            typeof window.getShopIdForRealtimeKey !== 'function' ||
            typeof window.savePosApiKeyToFirestore !== 'function' ||
            typeof POS_REALTIME_SETTINGS_COLLECTION === 'undefined'
        ) {
            setTimeout(tryHook, 300);
            return;
        }

        async function tpFetchApiKeyFromDefaultDoc(db) {
            const snap = await db.collection(POS_REALTIME_SETTINGS_COLLECTION).doc('default').get();
            if (snap.exists && snap.data() && snap.data().apiKey) return snap.data().apiKey;
            return '';
        }

        const originalRaw = window.loadPosApiKeyFromFirestoreRaw;
        window.loadPosApiKeyFromFirestoreRaw = async function (...args) {
            const key = await originalRaw.apply(this, args);
            if (key) return key; // 今の店舗IDの場所にちゃんとあれば、そのまま使う

            const currentShopId = getShopIdForRealtimeKey();
            if (currentShopId === 'default') return key; // 店舗ID未設定＝もともとdefaultを見ているので対象外

            const db = getFirestoreForRealtimeKey();
            if (!db) return key;

            let legacyKey = '';
            try {
                legacyKey = await tpFetchApiKeyFromDefaultDoc(db);
            } catch (e) {
                console.warn('店舗ID設定前のAPIキー（default）の確認に失敗しました:', e);
                return key;
            }
            if (!legacyKey) return key;

            // 見つかった場合は、今の店舗IDの場所にも複製しておく
            // （以後は毎回この救済処理をしなくても正しい場所から読めるように）
            try {
                await savePosApiKeyToFirestore(legacyKey);
            } catch (e) {
                console.warn('店舗ID設定前のAPIキーの複製（移行）に失敗しました。今回の表示には使いますが、次回また救済処理が必要になる可能性があります:', e);
            }
            return legacyKey;
        };
    }
    tryHook();
})();
