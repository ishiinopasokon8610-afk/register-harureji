// ==========================================
// first-visit-notice-system.js
// 初めてこのレジを開いたときに、配布・利用にあたっての注意事項
// (安全性についての説明) を一度だけモーダルで表示する
// ------------------------------------------
// 「確認しました」ボタンを押すとlocalStorageにフラグを保存し、
// 以降は表示しない。
// index.html / ui.js は直接編集せず、DOMContentLoaded時にモーダルを
// 動的に追加する（他の追加機能ファイルと同じ「後付けブロック」方式）。
// ==========================================

const FIRST_VISIT_NOTICE_KEY = 'pos_safety_notice_acknowledged';

const FIRST_VISIT_NOTICE_TEXT = `
【利用規約・プライバシーポリシー】

本書は、本レジシステム（以下「本システム」といいます）の利用規約であると同時に、お客様・従業員の個人情報の取り扱いに関する方針（プライバシーポリシー）を兼ねるものです。導入担当者様・運用責任者様は、ご利用を開始される前に、必ず最後までお読みください。また、本書は本システムを従業員の方へ引き継ぐ際や、社内でルールを整備する際の参考資料としてもご活用いただけます。

■1. 本システムの動作の仕組み

・本システムは、ブラウザ上で動作するWebアプリケーションです。特別なインストール作業を行わなくても、対応するブラウザさえあれば動作します。パソコン・タブレットなど、複数の端末でも同じように利用できるよう設計されています。
・対応ブラウザとしては、Google Chrome・Microsoft Edge等の最新版のご利用を推奨します。古いバージョンのブラウザや、一部の機能を制限したブラウザ（プライベートブラウジングモードなど）では、localStorageへの保存やWeb Speech API（音声読み上げ）、Wake Lock（画面スリープ防止）等、一部機能が正しく動作しない場合があります。
・会計データ、会員情報、勤怠（タイムカード）記録、割引・自動化バーコードの登録内容、レシートに印字するクーポンの登録内容などの主なデータは、基本的にご利用の端末のブラウザ内（localStorage）に保存される仕組みになっています。これは、レジとしての操作をオフライン環境でも問題なく行えるようにするための仕組みです。
・localStorageはブラウザ・端末ごとに独立しています。そのため、複数のレジ端末で同じ商品マスタ・割引設定・会員情報を共有したい場合は、後述するAblyによるリアルタイム同期機能、およびクラウドバックアップ機能を必ず利用してください。同期機能を使わずに複数端末で個別に操作を続けると、端末ごとにデータの内容がずれてしまう可能性があります。
・ただし、localStorageのみに保存している場合、ブラウザの履歴・データを消去したり、端末が故障・紛失したり、ブラウザやOSを入れ替えたりすると、それまでの記録が失われてしまう恐れがあります。売上や勤怠の記録が失われることは、事業運営上、大きな支障となり得ます。
・そのため本システムでは、Firebase・Google Drive等のGoogle APIを利用したクラウドバックアップ機能をあらかじめ用意しています。運用を開始される際は、必ずこれらのバックアップ機能を有効にし、定期的にデータが同期・保存される状態にしておくことを強くおすすめします。localStorageだけに頼った運用は推奨しません。
・バックアップ機能を有効にした場合、データはご自身で設定したGoogleアカウント上のクラウド（Firebase／Google Drive）に送信・保存されます。外部の見知らぬサーバーへ無条件に送信され続けるような仕組みではなく、あくまでご自身が管理するアカウント内に保存される点をご理解ください。
・バックアップの実行タイミングは、データ保存操作（会計成立、設定変更など）のたびに自動的に呼び出される仕組みになっています。ただし、通信環境（Wi-Fi等）が不安定な状況では、バックアップが遅延・失敗する場合があります。日々の営業終了後などに、通信が安定した状態で一度端末を開き、直近の操作までバックアップが反映されているかをあわせてご確認いただくと、より安心です。

■2. 外部との通信について

本システムは、以下の外部サービスと通信する場合があります。導入・配布にあたっては、これらのサービス自体の利用規約・プライバシーポリシーも併せてご確認ください。

・Firebase（Google）：認証、データのクラウド保存・バックアップ
・Ably：複数端末間のリアルタイム同期（例：レジ端末と客用画面、複数レジ間での情報共有、割引・自動化バーコードや商品連動クーポンの登録内容の同期）
・Google Drive API：データのバックアップ
・Open-Meteo（archive-api.open-meteo.com／api.open-meteo.com）：売上分析画面での天気表示のための、端末の位置情報を利用した天気データ取得（過去日分はarchive-api.open-meteo.com、本日分の天気予報はapi.open-meteo.comを使用）
・cdn.sheetjs.com、cdnjs.cloudflare.com、gstatic.com、ably.com等のCDN：ライブラリ（Excel出力・PDF出力・画像生成等）の読み込み

上記以外の、身に覚えのないサーバーへの通信や、外部への不正な情報送信は、レビューした範囲では確認されていません。ただし、本システムは今後も機能追加・修正が行われる可能性があるため、配布・アップデートのたびに最新の内容をご確認いただくことを推奨します。

なお、社内のネットワーク環境（ファイアウォール、Webフィルタリング等）によっては、上記の通信先が意図せずブロックされ、同期・バックアップ・天気表示等の一部機能が正常に動作しない場合があります。導入時には、上記ドメインへの通信が許可されているかについても、ネットワーク管理者様にご確認いただくことをおすすめします。

■3. 導入前に確認・設定していただきたいこと

配布を受けた方は、ご自身の環境で使用を始める前に、以下の設定を必ずご自身の情報に置き換えてください。初期設定のまま公開・運用してしまうと、認証を突破されたり、意図しない相手にバーコードを使われたりする可能性があります。

・Firebase等の各種APIキー・接続設定
・Google Drive等のクラウドバックアップ連携設定（アカウント連携・保存先フォルダ等）
・店長認証用バーコード、担当者（店員）バーコードの初期値
・店舗名・ロゴ等の表示情報
・割引・自動化バーコードの登録内容（初期設定のまま公開すると、他の店舗・関係者と登録番号が重複したり、意図しない値引きが適用されたりするおそれがあります）
・レシート印字用のクーポン内容・呼び出し番号／オーダーシステムに関する設定

また、運用を開始した後は、実際にバックアップが正しく行われているか、テスト的にデータを保存・復元してみるなどして、一度必ずご確認ください。バックアップの設定を有効にしただけで満足せず、実際に機能しているかどうかまで確認することが重要です。

さらに、複数端末で運用される場合は、Ablyによるリアルタイム同期が正しく機能しているかについても、実際に別端末からの操作が反映されるかをテストしたうえで、本番運用を開始することをおすすめします。

■4. 取得する情報・個人情報の取り扱い（プライバシーポリシー）

・本システムは、レジとしての機能上、会員（お客様）の氏名・生年月日（年齢算出のため）・性別・購入履歴・保有ポイント・ランク、および従業員の氏名・出退勤（タイムカード）記録といった情報を取り扱います。
・これらの情報は、■1.に記載のとおり、原則としてご利用の端末のブラウザ内（localStorage）に保存され、クラウドバックアップを有効にしている場合は、運用事業者様ご自身が設定したFirebase／Google Driveのアカウント上に送信・保存されます。
・本システムそのものには、取得した情報を開発者や第三者へ無断で送信する機能は確認されていません（■2.に記載の外部通信先一覧が、確認できた送信先のすべてです）。
・本システムが取り扱う情報の利用目的は、レジ業務（会計・会員管理・在庫や割引の管理）、ポイント・ランク等の会員サービスの提供、および従業員の勤怠管理に限られます。
・取得した情報を、本システムの提供者が独自に第三者へ提供することはありません。
・配布・導入する事業者様は、ご自身の事業に適用される個人情報保護関連法令等を遵守したうえで本システムをご利用ください。会員・従業員の方への説明（利用目的の明示、問い合わせ窓口の案内など）や、社内での取り扱いルールの整備は、運用事業者様側でご対応いただく必要があります。
・保存された情報の管理責任は、本システムを導入・運用する事業者様にあります。
・端末を廃棄・譲渡・買い替えする際は、localStorageに残っている会計データ・会員情報・勤怠記録等が第三者の手に渡らないよう、ブラウザデータの削除等、適切な処分方法をご検討ください。
・同一の端末・ブラウザを複数の従業員で共有して利用する運用形態の場合、操作履歴（誰がどの会計・設定変更を行ったか）の管理方法についても、あわせて事業者様側で運用ルールを定めていただくことをおすすめします。
・情報の開示・訂正・削除等のご依頼については、本システムを導入している店舗・事業者様（運用事業者様）が窓口となります。本システムの提供者に直接お問い合わせいただいても対応できませんので、あらかじめご了承ください。

■5. 免責事項

・本システムは現状有姿（as-is）で提供されるものであり、動作の完全性・安全性・特定目的への適合性についていかなる保証も行うものではありません。
・本システムの利用・改変・配布によって生じた損害、またバックアップの未設定・不備によるデータ消失について、提供者は責任を負いません。
・通信環境の不具合、外部サービス（Firebase・Ably・Google Drive・Open-Meteo等）側の障害・仕様変更・提供終了等により本システムの一部または全部の機能が利用できなくなった場合についても、提供者は責任を負いません。
・本システムの二次配布・改変を行う場合は、配布先においても本注意事項を併せて共有してください。

■6. お問い合わせ

本システムのご利用中に不具合、不審な挙動、その他ご不明な点がございましたら、下記までご連絡ください。
連絡先：ishiinopasokon8610@gmail.com

（本文書は「利用規約」と「プライバシーポリシー」を1つにまとめた固定の文章であり、店舗側の操作で編集することはできません。）
`.trim();

function ensureFirstVisitNoticeModal() {
    if (document.getElementById('first-visit-notice-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'first-visit-notice-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.75); z-index:1000000; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff; border-radius:10px; max-width:640px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 10px 40px rgba(0,0,0,0.4);';

    box.innerHTML = `
        <div style="padding:20px 24px 10px 24px; border-bottom:1px solid #eee;">
            <h2 style="margin:0; color:#5e35b1; font-size:20px;">⚠️ ご利用にあたっての注意事項</h2>
        </div>
        <div id="first-visit-notice-body" style="padding:16px 24px; overflow-y:auto; white-space:pre-wrap; line-height:1.7; font-size:14px; color:#333;">${FIRST_VISIT_NOTICE_TEXT}</div>
        <div style="padding:14px 24px; border-top:1px solid #eee; text-align:right;">
            <p id="first-visit-notice-hint" style="margin:0 0 10px 0; font-size:12px; color:#e65100; text-align:left;">↓ 最後までスクロールして内容をご確認ください</p>
            <button id="first-visit-notice-close-btn" disabled style="padding:10px 24px; font-size:15px; font-weight:bold; background:#bdbdbd; color:#fff; border:none; border-radius:6px; cursor:not-allowed;">確認しました</button>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const bodyEl = document.getElementById('first-visit-notice-body');
    const hintEl = document.getElementById('first-visit-notice-hint');
    const closeBtn = document.getElementById('first-visit-notice-close-btn');

    // 最後までスクロールしたかどうかを判定し、ボタンを有効化する
    function checkScrolledToBottom() {
        if (!bodyEl || closeBtn.disabled === false) return;
        const reachedBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 4;
        if (reachedBottom) {
            closeBtn.disabled = false;
            closeBtn.style.background = '#5e35b1';
            closeBtn.style.cursor = 'pointer';
            if (hintEl) hintEl.style.display = 'none';
        }
    }

    // そもそもスクロールが発生しないほど短い（画面が大きい等）場合にも対応する
    checkScrolledToBottom();
    bodyEl.addEventListener('scroll', checkScrolledToBottom);
    window.addEventListener('resize', checkScrolledToBottom);

    closeBtn.addEventListener('click', () => {
        if (closeBtn.disabled) return;
        localStorage.setItem(FIRST_VISIT_NOTICE_KEY, 'true');
        overlay.remove();
        if (typeof playSound === 'function') playSound('click');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem(FIRST_VISIT_NOTICE_KEY) === 'true') return;
    ensureFirstVisitNoticeModal();
});
