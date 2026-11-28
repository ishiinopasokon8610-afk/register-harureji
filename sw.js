// ==========================================
// sw.js
// ------------------------------------------
// 【今回の改良】
// 従来は index.html / manifest.json を「キャッシュ優先・一度取得したら
// ずっとキャッシュから返す」方式にしていたため、update-notification-system.js
// が「新バージョンがあります」と通知して利用者がリロードしても、
// このService Worker自体が index.html を古いキャッシュのまま返し続けて
// しまい、実質的に更新が反映されない、という食い違いが起きうる状態だった。
// （JSファイル本体は元々ASSETSに含まれておらずキャッシュされないため
// 　問題なかったが、殻となるindex.htmlだけがずっと古いままになりうる。）
//
// 今回、以下の2点を改良する。
// ① CACHE_NAME にバージョン番号を持たせ、activateのタイミングで
//    古い世代のキャッシュを自動的に削除する（更新のたびに手動で
//    キャッシュ名を変える運用にしておけば、確実に総入れ替えできる）。
// ② index.html／'./'（アプリの殻）へのアクセスは「まずネットワークから
//    取得し、取れたらキャッシュも更新する。オフライン等で失敗した
//    ときだけキャッシュを使う」方式（ネットワーク優先）に変更する。
//    これにより、通常のオンライン時は常に最新のindex.htmlが使われ、
//    オフラインでも今まで通りアプリを開けるという両立ができる。
// それ以外の静的ファイル（manifest.jsonなど）は、これまで通り
// キャッシュ優先のままにしておく（会計中の通信が不安定な瞬間でも、
// レジ本体の表示が引っかからないようにするため）。
//
// 【運用方法】
// 今後、大きな更新を配布するときは CACHE_VERSION の値も
// （例: 'v2' → 'v3'）書き換えておくと、activate時に古いキャッシュが
// 確実に一掃されます（update-notification-system.js の APP_VERSION と
// 同じタイミングで一緒に上げておくと分かりやすいです）。
// ==========================================

// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・新機能: メニュー画面で、ジャンルごとに「列数×行数（1ページの件数）」を
//   設定できるようにした（menu-genre-page-grid-system.js）。設定した
//   ジャンルは「‹ 前へ／次へ ›」のページ送り表示になる。未設定のジャンルは
//   これまで通り全件スクロール表示のまま（非破壊）。設定はAblyで他端末にも
//   共有される。
// ・不具合修正: 「🔔 店員を呼ぶ」で登録される自動化バーコード（CALL〜）が
//   使い切り（oneTime）設定になっておらず、対応後もバーコード一覧に残り
//   続けていた点を修正（call-staff-barcode-onetime-fix.js）。
// ・不具合修正: manifest.json の icons に、完全に同一内容のアイコンが
//   誤って2つ登録されていた（重複）ため、1つに整理した。
// これらのJSファイルはASSETSに含めておらずキャッシュ対象外のため常に
// 最新が読み込まれるが、index.htmlに新しい<script>タグを追加したため、
// 念のためCACHE_VERSIONを上げて古いindex.htmlキャッシュを一掃する。
// ==========================================
// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・不具合修正: install時にASSETS（index.html/manifest.jsonのみ）しか
//   キャッシュしておらず、追加機能スクリプト（register.js等80個近く）が
//   一切キャッシュ対象外だったため、オフライン時に殻（index.html）だけ
//   開けて中身が動かない状態だった点を修正。index.htmlの<script src>を
//   動的に読み取って同一オリジンのスクリプトも全てプリキャッシュする
//   ように変更（shop-id-system.js。詳細は下のinstallハンドラのコメント参照）。
// ==========================================
// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・不具合修正: 「pushした直後だと、アップデートされていない状態が出る」
//   原因の1つは、GitHub Pagesが返すファイルにCache-Control: max-age=600
//   （＝ブラウザが10分間は再確認せず手元のコピーを使ってよい）が付くこと。
//   install時のプリキャッシュ（cache.addAll / cache.add）も、アプリの殻の
//   ネットワーク優先（fetch(req)）も、この「ブラウザ標準のHTTPキャッシュ」を
//   経由していたため、直近10分以内に一度取得したファイルは、サーバーに
//   新しい版があっても「古い版」がそのまま新しいCACHE_NAMEのキャッシュへ
//   入ってしまっていた。そのうえ scriptはキャッシュ優先なので、一度古い版が
//   入るとCACHE_VERSIONを次に上げるまで古いまま固定されてしまう。
//   → プリキャッシュは cache:'reload'（HTTPキャッシュを使わず必ずサーバーから
//   取得）、アプリの殻のネットワーク優先は cache:'no-cache'（毎回サーバーに
//   確認）に変更した。
// ・改善: ネットワークから取れた応答が正常（res.ok）な時だけ殻のキャッシュを
//   更新する（エラー応答で正しいキャッシュを上書きしないため）。
//   オフライン時、殻のURLがキャッシュと完全一致しなくても
//   ./index.html を返せるようにした。
// ==========================================
// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・不具合修正: Googleドライブ連携済みの端末で、アプリを開き直すたびに
//   「データの取り込みが完了しました」の通知が毎回出てしまう点を修正した
//   （google-drive-auto-restore-dedup-fix.js）。起動時の自動復元
//   （autoRestoreFromGoogleDriveOnLoad）の実行中だけ、Driveバックアップの
//   保存時刻（savedAt）が前回自動取り込みした時と同じであれば、取り込み処理
//   （＝完了通知も含む）自体をスキップする。手動の「📥 Driveから復元」や
//   JSONファイルからの復元は、これまで通り毎回きちんと取り込む。
// ・このファイルは index.html に <script> タグを追加するだけで、上のinstall時の
//   動的プリキャッシュ（<script src>の自動読み取り）の対象に自動で入る。
//   sw.js にファイル名を書き足す必要はない。ただし、配布する時は
//   CACHE_VERSION（このファイル）と APP_VERSION（update-notification-system.js）
//   の2つを、手動で一緒に上げること（CACHE_VERSIONが同じままだと、
//   キャッシュ優先のスクリプトが古いまま入れ替わらない）。
// ==========================================
// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・不具合修正: セルフレジの注文（self-checkout-order）がレジに届かず、4桁の番号を
//   打っても「未登録商品」になる点を修正（firebase-sync-system.js の LIVE_EVENTS に
//   注文・状態通知を追加）。スクリプトはキャッシュ優先のため CACHE_VERSION を v29 に上げた。
// ==========================================
// ・変更: セルフレジの4桁の番号の読み上げを、1桁ずつ（ななはちいちろく）ではなく、
//   ふつうの数（ななせんはっぴゃくじゅうろく）にした（self-checkout-call-number-register-assign-system.js）。
//   CACHE_VERSION を v30 に上げた。
// ・追加: セルフレジ画面の「全画面」ボタンを「管理」に変更。店長認証のあと、発行した番号のうち
//   まだ使われていないものを、発行順に見られる（self-checkout-call-number-register-assign-system.js）。
//   CACHE_VERSION を v31 に上げた。
// ・不具合修正: レジでアーカイブした自動化バーコード（SELF番号）が、セルフレジで新しく注文すると
//   復活して出てくる点を修正。セルフレジ端末が古い一覧を同期していたのをやめ、バーコードは
//   注文を受け取ったレジ側で作るようにした（self-checkout-call-number-register-assign-system.js）。
//   CACHE_VERSION を v32 に上げた。
// ・不具合修正: セルフレジの自動化バーコード（SELF番号）が作られない／一覧に出ない点と、
//   使い終わっても一覧に残り続ける点を修正した（self-checkout-call-number-register-assign-system.js）。
//   使われた注文（読み込み済み・会計済み・取消）のバーコードは自動でアーカイブへ移し、
//   作れなかった注文は、レジが待っている間 自動で作り直す。
//   CACHE_VERSION を v34 に上げた。
// ・不具合修正: 言語メニューで「日本語」を選んでも翻訳が解除されなかった点を修正（language-system.js）。
//   CACHE_VERSION を v35 に上げた。
// ・不具合修正: 他の端末（タッチパネル・作成画面・レジ）で作った自動化バーコードが連携されない／消える／
//   アーカイブが復活する点を修正。同期が「一覧を丸ごと上書き」する方式だったため、ほぼ同時に作ると片方が消え、
//   古い一覧を持った端末が1件作るだけで全端末が古い状態に戻っていた。バーコードごとに新しい方を残す
//   マージ方式に変更した（discount-system.js、self-checkout-call-number-register-assign-system.js）。
//   CACHE_VERSION を v36 に上げた。
// ・変更: お席案内（seat-guide-call-system.js）。受付番号は自動（Firebaseで全端末かぶらない）、
//   人数を入力、パスワードの記号は1つ、開くと全画面。CACHE_VERSION を v38 に上げた。
// ・変更: お席案内は ×長押しでのみ閉じる／Esc長押しで全画面解除。タッチパネル操作中は更新通知・リロードをしない。v39。
// ・追加: touch-panel-fullscreen-guard-system.js（タッチパネル・お席案内を0.1秒ごとに全画面確認）。v40。
// ・変更: manifest.json の display を fullscreen に変更（ホーム画面から開くと最初から全画面）。v41。
// ・不具合修正: タッチパネル以外の画面でも全画面ガードが反応する点を、実際に一番上に見えている要素で判定する方式に変更。v42。
// ・変更: お席案内。呼び出しは店員が行い（いらっしゃいますか？→いらっしゃらなければ次のお客様）、パスワードは廃止。v43。
// ・変更: お席案内。パスワード（記号1つ）を復活（伏字にせず表示）。「1番」が「いっぱん」と読まれる点を「いちばん」に修正。v44。
// ・変更: #touch-panel を開いている間も全画面。お席案内の受付は×のみ。レジ番号バッジ廃止。v45。
// ・変更: 「領収書を発行しますか？」を廃止。レジ画面に「領収書発行」ボタン（取引番号→宛名／空欄可）。顧客情報は開くたびに店長ロック→認証。v46。
// ・変更: 顧客情報の画面は、戻る/ハッシュ/他ファイルからの直接呼び出しでも、店長認証なしには開かない。v47。
// ・変更: 常時の全画面強制を廃止（#touch-panel を開いた時に1回だけ）。お席案内は右上の×のみ。レジ番号バッジを強制非表示。v48。
// ・変更: 全画面ガードを復活（#touch-panel とお席案内の間だけ、解除しても全画面へ戻す。他の画面では何もしない）。v49。
// ・変更: 領収書発行では「再発行」の枠を出さない。宛名が空欄の時は、書き込めるように線を引く。v50。
// ・変更: 領収書の発行元を「haruレジ」に変更。v51。
const CACHE_VERSION = 'v105';
// v99: 商品ボタンの配置・写真を、Google Driveのバックアップ／ファイル保存・復元にも入れる（product-button-layout-system.js）
// v98: データ管理=画面を開くたびに全部閉じる・つぶれ修正・検索バー廃止／商品ボタン=初期横3列・おまかせ配置・配置は割合で保存（スマホ対応）・保存状態の表示
// v97: データ管理の見やすさ調整（ふだんは全部ひらく・幅やボタンはもとのまま。migration-screen-readability-system.js）
// v96: データ管理画面が開けなくなる不具合の対策（即時反映をsetTimeout化・取り合い検知。ui-compact / manual-pdf / migration-screen-readability）
// v95: データ管理画面の並べ替え・追加ブロックを、開いた瞬間に反映（ui-compact-fixes / manual-pdf / migration-screen-readability）
// v94: データ管理画面を見やすく（折りたたみ・検索・幅そろえ。migration-screen-readability-system.js 新規）
// v93: 精算画面をEnterキーだけで最後まで進める（settlement-enter-flow-system.js 新規）／レジ画面の商品ボタンの大きさ・配置・写真を自由に設定（product-button-layout-system.js 新規）
// v92: 使い方説明書PDFのダウンロード（manual-pdf-download-system.js 新規）／データ管理に説明書ブロックを追加（並び順は ui-compact-fixes-system.js）
// v91: データ管理で入力・ボタン操作中に画面が一番上へ戻る不具合の対策（並べ替えを操作中は止め、スクロール位置を保持）
// v90: 客用画面のお知らせ（上の縁）・左下の会員情報（customer-display-extras-system.js 新規）／gzip・Driveバックアップを最上部へ
// v89: データ管理：税込み設定・税率まとめて変更・利用規約も上へ
// v88: バックアップに同期用パスワード・同期用データコードを含める
// v87: データ管理の並び替え（会員ランク・分類・バックアップを最上部）／設定変更時にバックアップ実行
// v86: データ管理：バックアップ・店長認証を上に／客用ディスプレイ設定を非表示
// v85: データ管理の並び順（よく使う設定を上・すぐやらない設定を下）
// v84: 商品選びが空になる不具合を修正／セルフレジの様子を見る画面を全画面に
// v83: お客様について画面はENTERで次へ／レシートはダーク・ライトモードの色変更の対象外に
// v82: 年齢確認・詐欺注意はENTERキーで同意して進める
// v81: 精算レシート画像はモード切替の色上書きを元に戻して撮影
// v80: 精算レシート画像はダークモードでも同じ色（白背景）にそろえる
// v79: 会員ランク割引のON/OFFをデータ管理に追加
// v78: セルフレジの商品選びは、上に分類ボタン（最初はすべて）・押すと商品が切り替わる形に変更
// v77: セルフレジの「バーコードがない商品」を分類ボタンから選ぶ形に変更（検索欄を廃止）
// v76: バーコードが無い商品の調べをセルフレジ管理へ移動・レシートは白背景黒文字・売上管理の画像は通常モードの色
// v75: 分類を自分で一から作る設定・セルフレジの商品一覧を分類で絞り込み（genre-tools-system.js 新規）
// v91: データ管理で入力・ボタン操作中に画面が一番上へ戻る不具合の対策（並べ替えを操作中は止め、スクロール位置を保持）
// v90: 客用画面のお知らせ（上の縁）・左下の会員情報（customer-display-extras-system.js 新規）／gzip・Driveバックアップを最上部へ
// v89: データ管理：税込み設定・税率まとめて変更・利用規約も上へ
// v88: バックアップに同期用パスワード・同期用データコードを含める
// v87: データ管理の並び替え（会員ランク・分類・バックアップを最上部）／設定変更時にバックアップ実行
// v86: データ管理：バックアップ・店長認証を上に／客用ディスプレイ設定を非表示
// v85: データ管理の並び順（よく使う設定を上・すぐやらない設定を下）
// v84: 商品選びが空になる不具合を修正／セルフレジの様子を見る画面を全画面に
// v83: お客様について画面はENTERで次へ／レシートはダーク・ライトモードの色変更の対象外に
// v82: 年齢確認・詐欺注意はENTERキーで同意して進める
// v81: 精算レシート画像はモード切替の色上書きを元に戻して撮影
// v80: 精算レシート画像はダークモードでも同じ色（白背景）にそろえる
// v79: 会員ランク割引のON/OFFをデータ管理に追加
// v78: セルフレジの商品選びは、上に分類ボタン（最初はすべて）・押すと商品が切り替わる形に変更
// v77: セルフレジの「バーコードがない商品」を分類ボタンから選ぶ形に変更（検索欄を廃止）
// v76: バーコードが無い商品の調べをセルフレジ管理へ移動・レシートは白背景黒文字・売上管理の画像は通常モードの色
// v75: 分類を一から作る設定・バーコードが無い商品を調べる（product-genre-tools-system.js 新規）
// v74: 診断画面にエラー記録・環境チェック・コピー（sync-diagnostic-system.js。index.htmlの先頭で読み込む）
// v73: 診断16秒・年齢確認1画面・バージョン表示を客用/タッチパネル/呼び出し/セルフで非表示・注文カードから割引を除外・通知の誤報修正
// v72: タッチパネルのバリエーション画面がスマホでつぶれる点を修正（touch-panel-variation-ui-fix-system.js 新規）
// v91: データ管理で入力・ボタン操作中に画面が一番上へ戻る不具合の対策（並べ替えを操作中は止め、スクロール位置を保持）
// v90: 客用画面のお知らせ（上の縁）・左下の会員情報（customer-display-extras-system.js 新規）／gzip・Driveバックアップを最上部へ
// v89: データ管理：税込み設定・税率まとめて変更・利用規約も上へ
// v88: バックアップに同期用パスワード・同期用データコードを含める
// v87: データ管理の並び替え（会員ランク・分類・バックアップを最上部）／設定変更時にバックアップ実行
// v86: データ管理：バックアップ・店長認証を上に／客用ディスプレイ設定を非表示
// v85: データ管理の並び順（よく使う設定を上・すぐやらない設定を下）
// v84: 商品選びが空になる不具合を修正／セルフレジの様子を見る画面を全画面に
// v83: お客様について画面はENTERで次へ／レシートはダーク・ライトモードの色変更の対象外に
// v82: 年齢確認・詐欺注意はENTERキーで同意して進める
// v81: 精算レシート画像はモード切替の色上書きを元に戻して撮影
// v80: 精算レシート画像はダークモードでも同じ色（白背景）にそろえる
// v79: 会員ランク割引のON/OFFをデータ管理に追加
// v78: セルフレジの商品選びは、上に分類ボタン（最初はすべて）・押すと商品が切り替わる形に変更
// v77: セルフレジの「バーコードがない商品」を分類ボタンから選ぶ形に変更（検索欄を廃止）
// v76: バーコードが無い商品の調べをセルフレジ管理へ移動・レシートは白背景黒文字・売上管理の画像は通常モードの色
// v75: 分類を自分で一から作る設定・セルフレジの商品一覧を分類で絞り込み（genre-tools-system.js 新規）
// v91: データ管理で入力・ボタン操作中に画面が一番上へ戻る不具合の対策（並べ替えを操作中は止め、スクロール位置を保持）
// v90: 客用画面のお知らせ（上の縁）・左下の会員情報（customer-display-extras-system.js 新規）／gzip・Driveバックアップを最上部へ
// v89: データ管理：税込み設定・税率まとめて変更・利用規約も上へ
// v88: バックアップに同期用パスワード・同期用データコードを含める
// v87: データ管理の並び替え（会員ランク・分類・バックアップを最上部）／設定変更時にバックアップ実行
// v86: データ管理：バックアップ・店長認証を上に／客用ディスプレイ設定を非表示
// v85: データ管理の並び順（よく使う設定を上・すぐやらない設定を下）
// v84: 商品選びが空になる不具合を修正／セルフレジの様子を見る画面を全画面に
// v83: お客様について画面はENTERで次へ／レシートはダーク・ライトモードの色変更の対象外に
// v82: 年齢確認・詐欺注意はENTERキーで同意して進める
// v81: 精算レシート画像はモード切替の色上書きを元に戻して撮影
// v80: 精算レシート画像はダークモードでも同じ色（白背景）にそろえる
// v79: 会員ランク割引のON/OFFをデータ管理に追加
// v78: セルフレジの商品選びは、上に分類ボタン（最初はすべて）・押すと商品が切り替わる形に変更
// v77: セルフレジの「バーコードがない商品」を分類ボタンから選ぶ形に変更（検索欄を廃止）
// v76: バーコードが無い商品の調べをセルフレジ管理へ移動・レシートは白背景黒文字・売上管理の画像は通常モードの色
// v75: 分類を一から作る設定・バーコードが無い商品を調べる（product-genre-tools-system.js 新規）
// v74: 診断画面にエラー記録・環境チェック・コピー（sync-diagnostic-system.js。index.htmlの先頭で読み込む）
// v73: 診断16秒・年齢確認1画面・バージョン表示を客用/タッチパネル/呼び出し/セルフで非表示・注文カードから割引を除外・通知の誤報修正
// v72: バリエーション画面のスマホ表示を補強（touch-panel-variation-ui-fix-system.js）
// v71: 更新の自動反映・診断画面を分析画面24秒長押しで開く・注文チャイム表示のバージョン削除
// v69: 同期の診断画面 #diag（sync-diagnostic-system.js 新規）
// v68: チェック更新（チェック済み商品がある更新）では注文チャイムを鳴らさない（order-checkout-display.js）
// v67: 注文チャイムが鳴った理由を画面に表示（調査用。order-checkout-display.js）
// v66: 注文カードの同期を安定化（消した注文の復活・ご注文が入りましたの誤報を修正。order-checkout-display.js・extra-settings-sync.js）
// v65: タッチパネルの注文バーコードを必ずホーム一覧に出す（discount-system.js）
// v64: データ管理画面の左メニューから非表示ブロックの項目を除外（migration-anchor-nav-system.js）
// v63: 注文チェックで「ご注文が入りました」が鳴る不具合を修正（order-checkout-display.js）・自動化バーコード一覧のlocalStorage取り込み（discount-home-live-reload-system.js 新規）
// v62: 詐欺注意画面を1画面化・客用ディスプレイ設定項目を非表示（ui-compact-fixes-system.js 新規）
// v61: データ用コードをGoogle Driveのバックアップに保存（gdrive-sync-code-backup.js 新規）
// v60: 精算レシートPNGは画面と同じ色で撮影し、金額は背景に合わせた色にする（sales-mgmt.js）
// v59: 精算レシートPNGをダークモードでも白地に黒文字で保存（sales-mgmt.js）
// v58: 業務再開画面を1画面に収める・精算レシートの金額表示（sales-mgmt.js）
// v57: 精算レシートPNGで数字が枠に隠れる不具合の修正（sales-mgmt.js）
// v56: 受付画面の呼び出し表示・自動ご案内（seat-guide-call-system.js）／売上管理のスマホ対応と不具合修正（sales-mgmt.js）
// v55: 店員確認の暗証番号を変更可能に（touch-panel-order-system.js / seat-guide-call-system.js）
// v54: 自動化バーコード一覧をFirebaseの状態としても同期（discount-system.js）
// v53: 商品名検索欄でキーボード表示を許可（keyboarddown.js）
// v52: 自動化バーコードの同期修正（sync-system.js / discount-system.js）
const CACHE_NAME = `register-cache-${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// ブラウザ標準のHTTPキャッシュ（GitHub Pagesは最大10分）を使わず、必ず
// サーバーから最新を取得するためのリクエストを作る（プリキャッシュ用）
function freshRequest(url) {
  return new Request(url, { cache: 'reload' });
}

// アプリの殻（ナビゲーション本体）とみなすリクエストかどうか
function isAppShellRequest(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

// インストール時にファイルをキャッシュする
self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS.map(freshRequest));

      // 【今回追加：追加機能スクリプトのプリキャッシュ】
      // これまで ASSETS には index.html／manifest.json しか入っておらず、
      // register.js・ui.js・各種 ○○-system.js 等（80個近く）は一切
      // キャッシュされていなかった。そのため「オフラインでも今まで通り
      // アプリを開けるという両立ができる」と書いていたが、実際には
      // オフライン時に開けるのは index.html の殻だけで、中身のスクリプトが
      // 1つも読み込めず、実質的に機能しない状態だった。
      //
      // 対応：index.html を取得して <script src="..."> を動的に読み取り、
      // 同一オリジンのものを全てこのキャッシュにも追加する。ファイルを
      // 1件ずつ手で列挙する方式にしなかったのは、extra-settings-ably-sync.js
      // 等と同じ理由（新しいスクリプトを追加するたびにこのsw.jsを更新し
      // 忘れる、という抜け漏れを防ぐため）。
      // 1件のプリキャッシュが失敗しても（一時的な通信不良など）install
      // 全体は失敗させず、その1件だけ諦めて続行する。
      try {
        const htmlRes = await fetch('./index.html', { cache: 'no-store' });
        const html = await htmlRes.text();
        const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
          .map((m) => m[1])
          .filter((src) => !/^https?:\/\//i.test(src)); // 外部CDN等（同一オリジン以外）は対象外

        await Promise.all(
          scriptSrcs.map((src) =>
            cache.add(freshRequest(src)).catch((err) => {
              console.warn(`[sw] プリキャッシュに失敗しました（このファイルだけスキップ）: ${src}`, err);
            })
          )
        );
      } catch (err) {
        // index.html自体の取得に失敗した場合（インストール時点で既に
        // オフライン等）。ASSETS分（殻）は既にキャッシュできているので、
        // ここは諦めて続行する。
        console.warn('[sw] スクリプト一覧の動的プリキャッシュに失敗しました:', err);
      }
    })()
  );
  // 【今回追加】新しいService Workerを、古いものの終了を待たずすぐに
  // 有効化する。update-notification-system.js側の「リロード」操作と
  // 組み合わせることで、通知を見た利用者がリロードした瞬間に確実に
  // 新しいService Workerへ切り替わるようにするため。
  self.skipWaiting();
});

// 【今回追加】起動時に、今のバージョン以外の古いキャッシュを削除する
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // GET以外（POST等）はService Workerを介さず、そのままネットワークへ
  if (req.method !== 'GET') return;

  if (isAppShellRequest(req)) {
    // ① アプリの殻：ネットワーク優先。取得できたらキャッシュも更新する。
    e.respondWith(
      // cache:'no-cache' ＝ HTTPキャッシュにコピーがあっても、必ずサーバーに
      // 「更新されていないか」を確認してから使う（max-age=600の間の古い殻を防ぐ）
      fetch(req, { cache: 'no-cache' }).then((networkRes) => {
        if (networkRes.ok) {
          const clone = networkRes.clone();
          e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)));
        }
        return networkRes;
      }).catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
    );
    return;
  }

  // ② それ以外：キャッシュ優先（無ければネットワーク）
  // 上記のinstall時プリキャッシュにより、追加機能スクリプト等も
  // ここでキャッシュヒットするようになった。バージョン更新時は
  // CACHE_VERSIONを上げることで、activateで古いキャッシュごと
  // 一掃され、次のinstallで新しい内容が入り直す。
  e.respondWith(
    caches.match(req).then((response) => {
      return response || fetch(req);
    })
  );
});

// ==========================================
// 【プッシュ通知（FCM）の受け取り】（push-notification-system.js / functions/index.js と対）
// ------------------------------------------
// スマホがバックグラウンドでも、Cloud Functions から届いたプッシュを通知として表示する。
// Service Worker は1つのスコープに1つしか置けないため、別ファイル（firebase-messaging-sw.js）
// は作らず、この sw.js に直接 push / notificationclick の処理を足している。
// ・Functions は notification ではなく data（title / body / icon / tag）だけを送る。
//   表示はここで行う。
// ・iPhone(Safari) は「プッシュを受け取ったら必ず通知を表示する」ことが条件なので、
//   タブを開いていても表示を省略しない（省略を繰り返すと購読が取り消されることがある）。
// ==========================================
const PUSH_DEFAULT_ICON = 'https://raw.githubusercontent.com/ishiinopasokon8610-afk/image-list/main/images/register-sabicon.png';

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { data: { title: 'haruレジ', body: event.data ? event.data.text() : '' } };
  }
  const d = payload.data || payload.notification || payload || {};
  const title = d.title || 'haruレジ';
  const options = {
    body: d.body || '',
    icon: d.icon || PUSH_DEFAULT_ICON,
    data: { url: d.url || self.registration.scope }
  };
  // 同じ tag の通知は上書きされる（同じ通知が二重に並ばない）
  if (d.tag) options.tag = d.tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) return c.focus();
    }
    return self.clients.openWindow(self.registration.scope);
  })());
});
