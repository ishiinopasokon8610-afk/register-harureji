// ==========================================
// ably-connection-system.js
// ------------------------------------------
// 【背景】
// sync-system.js / customer-sync-system.js / discount-system.js /
// extra-settings-ably-sync.js は、いずれも「channel」というグローバル変数
// （Ablyのチャンネル接続オブジェクト）がどこかで既に作られていることを
// 前提にしており、
//   if (typeof channel === 'undefined' || !channel) return;
// というガードで始まっている。
//
// しかし、index.html はAbly SDKの読み込みとAPIキーの取得
// （window.POS_ABLY_API_KEY / 'pos-ably-key-ready'イベント）までしか
// 行っておらず、実際に Ably へ接続して channel を作成する処理が
// どのファイルにも存在していなかった。
// そのため channel は常に undefined のままとなり、上記すべての
// 同期機能が最初から一度も動作していなかった（＝他端末と全く
// 同期しない不具合の直接の原因）。
//
// 【この機能】
// 'pos-ably-key-ready' イベント（またはこのファイルの読み込みより前に
// 既にAPIキー取得が完了していた場合はその場で）を検知し、
// window.POS_ABLY_API_KEY を使って Ably.Realtime に接続、
// 'hightech-pos-channel' チャンネルを取得してグローバル変数 channel に
// 格納する。他の同期ファイルは、この channel が使えるようになるのを
// （既存の setTimeout ポーリングで）待っているだけなので、
// このファイル側からそれらを直接呼び出す必要はない。
//
// APIキーが空（未設定・読み込み失敗）の場合は接続を試みない
// （channel は null のままとなり、各同期機能は「未接続」として
// 何もしない状態を維持する＝安全側に倒す）。
//
// index.html は直接編集せず、他の追加機能ファイルと同じ方針で
// 独立したファイルとして追加する。
//
// 【導入方法】
// index.html内で、Ably SDK（<script src="https://cdn.ably.com/lib/ably.min-1.js">）
// より後ろであればどこでも構わないが、sync-system.js 等より前に
// 置いておくと分かりやすい（実行順そのものはリスナー登録が
// DOMContentLoaded前に完了するため厳密には問わない）。
//   <script src="ably-connection-system.js"></script>
// ==========================================

let channel = null;
let ablyRealtimeClient = null;

// このアプリが使うAblyチャンネル名（index.html内の案内文にも
// 記載されている固定名。APIキー発行時にCapabilitiesのChannelsを
// これに限定するよう案内している）
const ABLY_POS_CHANNEL_NAME = 'hightech-pos-channel';

function connectAblyChannel(apiKey) {
    if (!apiKey) return; // 未設定・取得失敗時は接続しない（安全側）
    if (channel) return; // 既に接続済みなら何もしない
                          // （'pos-ably-key-ready'はpost-update-gdrive-resync.js等
                          //   経由の再取得時にも発火するため、二重接続を防ぐ）

    try {
        ablyRealtimeClient = new Ably.Realtime({ key: apiKey });

        ablyRealtimeClient.connection.on('connected', () => {
            console.log('[Ably] 接続しました');
        });
        ablyRealtimeClient.connection.on('failed', (stateChange) => {
            // APIキーの権限不足・形式誤り等で接続自体が失敗した場合ここに来る。
            // 画面上には出さず、コンソールで確認できるようにするだけに留める
            // （エラー時に毎回音声・通知が出ると煩わしいため）。
            console.error('[Ably] 接続に失敗しました。APIキーの権限・入力内容をご確認ください:', stateChange);
        });
        ablyRealtimeClient.connection.on('disconnected', () => {
            console.warn('[Ably] 接続が切断されました。自動的に再接続を試みます。');
        });

        channel = ablyRealtimeClient.channels.get(ABLY_POS_CHANNEL_NAME);
    } catch (e) {
        console.error('[Ably] チャンネルの作成に失敗しました:', e);
    }
}

// このファイルの読み込みより前に、既にAPIキー取得が完了して
// イベントが発火し終えていた場合への対応（読み込み順の保険）
if (window.POS_ABLY_API_KEY) {
    connectAblyChannel(window.POS_ABLY_API_KEY);
}

window.addEventListener('pos-ably-key-ready', (e) => {
    const apiKey = e && e.detail ? e.detail.apiKey : '';
    connectAblyChannel(apiKey);
});
