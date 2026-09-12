// ==========================================
// night-mode-system.js（改訂版 v15 - スキャン中のanimation停止をやめ、
// 客用タッチパネルの色を保護）
// 画面全体の配色を切り替える「通常／ライトモード／ナイトモード／
// デバイスに合わせる」ボタン
// ------------------------------------------
// 【v14での追加改訂】
// 「ホーム画面・客用画面の長押し進捗バーが、最後まで押しきる前に
// 一瞬で満タンになってしまう（先走る）」という報告があった。
// 原因はこのファイル自身が持つチカチカ防止の仕組み（v8）だった。
// 強制表示（ライト/ナイト）が有効な間、1.2秒ごとの再走査や画面の
// DOM変化のたびに `pos-nm-scanning` クラスを付けて
// `html.pos-nm-scanning * { transition: none !important; }` を
// 全要素に当てているが、これは進捗バー自身が持つ
// `transition: width 4000ms linear` のような時間指定つきの
// アニメーションも巻き込んで無効化してしまう。widthの指定値自体は
// 変えていないため、transitionを一瞬でも切ると「まだ途中のはずの
// 見た目」がその瞬間の指定値（100%）へ即座にスナップしてしまい、
// 実際の経過時間より早くバーが伸びきって見える、という仕組みだった。
// 長押し系のバーは1.2秒より短い間隔（4秒/5秒/2秒）で頻繁に更新される
// 上、押している間に他のDOM変化（時計表示の更新等）が起きるたびに
// スキャンが走るため、ほぼ確実にこの巻き込みが発生する。
// 対策として、`pos-nm-scanning` の一括無効化ルールから、長押し系の
// 進捗バー要素だけを `:not()` で明示的に除外し、スキャン中もバー自身の
// アニメーションはそのまま動き続けるようにした（他の要素への
// チカチカ防止効果はそのまま維持される）。
// あわせて、ホーム画面の長押しバー（#home-longpress-progress-bar /
// #home-longpress-progress-track）は、客用画面の長押しバーと全く同じ
// 「色そのものに意味がある」要素であるにもかかわらず
// NM_ALWAYS_IGNORE_SELECTORS に含まれておらず、ライト/ナイトモードで
// 背景色が上書きされて周囲の色になじんでしまう（v13と同種の）不具合が
// あったため、あわせてこちらもリストに追加した。
// ------------------------------------------
// 【v15での追加改訂】
// 「（ダーク／ライトモードを固定している間）ページのアニメーションが
// ずっと繰り返されているように見える」という報告があった。
// タッチパネル注文システム（touch-panel-order-system.js）などが画面
// 表示時に一度だけ再生するつもりで付けている
// 「.tp-fade-in / .tp-pop / .tp-slide-up」等のCSSアニメーション（要素の
// フェードイン等）が、1.2秒ごとの強制表示の再走査のたびに毎回最初から
// 再生し直されてしまい、「アニメーションが繰り返し続いている」ように
// 見えていた。
// 原因はv8で追加した「スキャン中はtransitionだけでなくanimationも
// まとめて none にする」処理だった。scanForNightMode()が要素を一旦
// 元の色に戻して読み直す際、対象要素に付いていたCSSアニメーションも
// 巻き込んで一瞬 `animation: none` にしてしまい、その直後にクラスを
// 外すとブラウザ側ではそのアニメーションを「新しく始まったもの」として
// 扱うため、進行中だった一度きりの演出が先頭から再生し直されてしまう
// （長押しバーの件（v14）と原理は同じだが、あちらは `transition` で
// 実装された時間経過バー、今回は `animation`（@keyframes）で実装された
// 一度きりの演出、という違いがある）。
// このスキャン処理が本来防ぎたかった「チカチカ点滅」は、v8のコメントに
// あるとおりCSSの `transition`（背景色・文字色のフェード演出）だけが
// 原因であり、`animation` を止める必要があるという記録・理由はどこにも
// 残っていなかった。よって `animation: none !important` の一括停止は
// 過剰な対策であり、かつ今後も新しい一度きりの演出アニメーションが
// 追加されるたびに同じ不具合を繰り返しかねないため、スキャン中に
// 止めるプロパティを `transition` だけに絞った（`animation` は止めない）。
// これにより、長押しバー用の除外リスト（NM_ALWAYS_IGNORE_SELECTORS等）を
// 増やし続けなくても、今後追加されるアニメーション演出は自然に保護
// される。
// ------------------------------------------
// 【v13での追加改訂】
// 客用画面の「5秒長押しでホームに戻る」バー（左から右に伸びるアンバー色の
// 進捗バー）が、ライトモード中に色が変わってしまい、進捗が分かりづらく
// なるという報告があった。v11でライトモードの背景強制の閾値を大きく
// 引き上げた（明度0.94未満はほぼ全部白にする）副作用で、このバーの
// アンバー色（明度0.578ほど）も「白以外の背景」として白く上書き
// されてしまっていた。
// 値引きボタンのように明度がそもそも低い色は元から対象外になるが、この
// バーのような中間的な明るさの意味のある色は、ライトモードの「白以外は
// 白にする」という設計とどうしても両立しない。そこで、閾値の調整では
// なく、色そのものに意味がある要素をセレクタで名指しして自動判定から
// 完全に除外する仕組み（NM_ALWAYS_IGNORE_SELECTORS）を追加した。
// ------------------------------------------
// 【v12での追加改訂】
// 「ライトモードにしていても、客用画面（customer-screen）を開いている
// 間は適用しないでほしい」という要望があった。客用画面はお客様に見せる
// 画面のため、店員側の設定（ライトモード）に関わらず本来の色付きデザイン
// のまま見せたい、という趣旨だと理解している。
// resolveForceMode() が返す「ユーザーが選んだモードから見て本来どちら向き
// に強制すべきか」はそのままに、その結果へ「客用画面が表示されていて、
// かつライトモードのときだけ強制しない」という例外を重ねる
// computeEffectiveForceMode() を追加した。ナイトモードは今回の要望の対象
// 外のため、客用画面でも従来通り適用され続ける。
// 画面が切り替わるたびにこの判定をやり直す必要があるため、index.html /
// ui.js は直接編集せず、他の追加機能ファイルと同じ「window.showScreen を
// 上書きしてフックする」方式で、画面遷移のたびに再評価するようにした。
// ------------------------------------------
// 【v11での追加改訂】
// ホーム画面の「会計スタート」「客用画面を開く」「担当者管理」
// 「売上管理・精算」「分析」など、色分けされたグラデーションボタンが
// ライトモードでも白背景にならず、元の色（グラデーション込み）のまま
// 残ってしまうという報告があった。
// 原因は、ライトモードの背景強制判定 isPlainDarkBackground /
// isPlainDarkBackgroundImage が、ナイトモード側の「明度0.72超の白系だけ
// 対象にする」判定と対称になるよう「明度0.28未満のかなり黒に近い背景
// だけ」を対象にしていたこと。これだと明度0.3〜0.7あたりの中間的な
// 明るさの色（緑・青・オレンジ・紫・青緑のボタン等）がどちらの閾値にも
// 当てはまらず、判定対象から漏れて元の色のまま残っていた。
// ライトモードは元々「背景が白以外の要素があれば白に強制する」という
// 設計（このファイル冒頭の説明を参照）だったため、ナイトモードのような
// 「意味のある色は守る」非対称の閾値ではなく、「すでに白に近い
// （明度0.94超）もの以外はすべて白にする」という、設計どおりの
// 閾値に引き上げた。これにより背景色だけでなくグラデーション
// （background-image）も同時に白背景へ置き換わる。
// ------------------------------------------
// 【v10での追加改訂】
// v9で作った「通常＝端末に自動追従」という設計を見直し、次の4モードに
// 整理し直した。
//   ・通常               … 配色に一切手を加えない（このアプリ本来の見た目のまま）
//   ・ライトモード         … 背景が白以外の要素があれば白に、明るい文字は
//                          黒に強制する（＝常に白背景・黒文字に固定）
//   ・ナイトモード         … 従来通り、常に暗い配色に固定する
//   ・デバイスに合わせる … 端末（OS）の配色設定を見て、ダーク設定なら
//                          ナイトモードと全く同じ強制を行い、ライト設定
//                          なら「通常」と同じく何もしない
// 「デバイスに合わせる」は matchMedia('(prefers-color-scheme: dark)') を
// 使い、端末側の設定が後から変わった場合もリアルタイムで追従する。
//
// ライトモードの強制処理は、ナイトモードが v2〜v8で作り込んだ「実際に
// 描画されている色を getComputedStyle で調べて判定する」「1.2秒ごとに
// 再走査して状態変化に追従する」「transitionを止めてチカチカを防ぐ」と
// いった仕組みをすべてそのまま流用し、判定条件と当てはめる色だけを
// 白背景・黒文字向けに反転させた「対になる強制」として実装している
// （classifyElementForNightMode を強制方向〈dark/light〉を受け取れる
// ように一般化した）。値引きボタンの赤／青／緑など彩度の高い“意味のある
// 色”を壊さないよう、背景の強制対象は「かなり暗い（明度0.28未満）プレーン
// な背景」だけに絞り、ナイトモード側の「かなり明るい（明度0.72超）背景を
// 対象にする」判定と対称になるようにしてある。文字色はナイトモード側と
// 同じ考え方で彩度を問わず明度だけで判定する。
//
// 保存キーは旧来のON/OFFのみの `pos_night_mode_enabled` および前回版の
// 3値キーから、4値を持てる `pos_color_mode` に切り替えたが、どちらの
// 旧キーしか無い端末のためのマイグレーション処理を入れてあるほか、
// 旧キーへの書き込みも継続し、旧関数名（isNightModeEnabled /
// toggleNightMode）も後方互換用に残してある。
// ------------------------------------------
// 【v9での追加改訂】
// v8までは「ナイトモードON/OFF」のトグルボタン1つだけだったが、
//   ・ライトモード … 常に背景白・文字黒に固定する
//   ・通常モード   … 端末（OS）の配色設定〈ライト/ダーク〉に自動追従する
// の2つを追加し、3つのモードボタンから選べるようにした。
// →この「通常＝端末に自動追従」という割り当てはv10で「デバイスに合わせる」
// という独立した4つ目のモードに切り出し、「通常」は文字通り何もしない
// モードに整理し直した。
// ------------------------------------------
// 【v8での追加改訂・チカチカ点滅の真因と対策】
// v7で「元のインラインスタイルをバックアップして復元する」方式にしても、
// 実機では商品カード一帯がずっとチカチカし続ける不具合が続いていた。
// 原因はJSの中身ではなく、CSS側の transition（カードのホバー演出や
// 押下演出などで背景色・文字色に付いている transition: background-color
// ...  のようなルール）だった。
// classifyElementForNightMode は1.2秒ごとの再走査のたびに、判定済みの
// 要素へ一旦 clearNightModeOverride() を掛けて「本来の（明るい）色」に
// 戻してから getComputedStyle() で読み直し、暗い色を再度当てはめている。
// このJSの処理自体は同期的で画面には一切描画されない一瞬の出来事だが、
// getComputedStyle() は強制的にスタイル再計算を発生させるため、
// 「一旦明るい色に戻った」という状態がブラウザの transition の
// 「変化前の値」として記録されてしまうケースがある。その直後に暗い色を
// 再度当てはめると、transition が付いた要素ではそこを起点に「明→暗」の
// フェードアニメーションが毎回律儀に発火し、1.2秒おきに大量の要素が
// 一斉にフェードし直す＝チカチカ点滅して見える、という仕組みだった。
// 対策として、判定済み要素を一旦元に戻して読み直す・上書きし直す一連の
// バッチ処理を行っている間だけ、html に `pos-nm-scanning` クラスを付けて
// `transition: none !important; animation: none !important;` を全要素に
// 強制し、transition・animation が絶対に発火しないようにした
// （runNightModeBatch関数）。バッチ処理が終わったあとも、直後に
// クラスを外すとその瞬間にまた古い値からの transition が発火しかねない
// ため、2回の requestAnimationFrame（実際に「transitionなしの最終状態」が
// 描画された後）を待ってからクラスを外している。
// v5〜v7で実現した「判定のやり直し・状態変化への追従」機能はそのまま
// 維持しつつ、その裏側で発生していたtransitionの発火だけをブロックする
// 形なので、動作の互換性を崩さずにチカチカだけを止められる。
// ------------------------------------------
// 【v7での追加改訂】
// v6までの「判定時に一旦上書きを外す」方式だと、1.2秒ごとの再走査のたびに
// 一瞬だけ元の明るい色が画面に描画されてしまい、チカチカ点滅する問題があった。
// そこで、各要素がもともと持っていたインラインスタイルを初回時に
// `data-nm-orig-*` 属性へバックアップ保存する仕組みに変更。
// 一度暗くした要素はスタイルを剥がさずに維持し、OFFにする時だけバックアップから
// 完璧に復元することで、画面の点滅（チラつき）を完全に防止した。
// ------------------------------------------
// 【v6での追加改訂】
// v5までは「html.pos-night-mode .pos-nm-bg { ... !important }」という
// “目印クラスを付けて外部<style>のルールに任せる”方式だったが、
// 一部の商品カード（ジャンルごとに色分けされたボタン等）が、元のCSS側の
// セレクタの詳細度がこちらより高いために上書きが効かず、ナイトモード中も
// ずっと元の薄い色のまま変わらない不具合が実機の録画で確認された。
// そこで、判定した要素に対して直接
// `element.style.setProperty('background-color', ..., 'important')` の
// ようにインラインスタイルとして最優先で上書きする方式に変更した
// （インラインスタイルの !important は詳細度の勝負が起きず、外部
// スタイルシート側がどれだけ強いセレクタ・!important を使っていても
// 常に上回る）。
// 判定のたびに「自分が前回付けた上書き」を一旦外してから computedStyle を
// 読み直すことで、自分の上書き色を“元の色”と誤読して光と闇を交互に
// 点滅させてしまう自己参照ループも防いでいる。
// ナイトモードをOFFにした際は、付けたインラインスタイルをすべて
// 明示的に取り消す（clearAllNightModeOverrides）。
// ------------------------------------------
// 【v5での追加改訂】
// v4までの判定は要素の `background-color` しか見ていなかったが、
// 「半額」ボタンの無効化時の見た目やテンキー（num-btn）のように、
// CSSグラデーション（background-image: linear-gradient(...)）で
// 白っぽい色を作っているボタンは対象外のままになり、ナイトモードでも
// 白いまま・文字が読めないまま残る不具合が報告された。
// そこで
//   ① background-image がグラデーションの場合、そこに含まれる色を
//      拾って明るさを判定し、白っぽいグラデーションも暗くする対象に
//      含めるようにした（.pos-nm-bg 側では background-image を
//      !important で打ち消し、単色の暗い背景に置き換える）。
//   ② 従来は要素ごとに「一度判定したら二度と見直さない」仕組み
//      だったため、ボタンが後から無効化される等で見た目（実際の色）が
//      変わっても追従できなかった。判定を都度やり直せる作りに変え、
//      ナイトモード中は定期的に（1.2秒ごと）再走査して、状態変化にも
//      追従するようにした。
// ------------------------------------------
// 【v4での追加改訂】
// v3までは「背景を暗くする」判定にだけ彩度(S)の条件を残しており、
// 白・薄いグレーなど彩度の低い“素の背景”しか対象にしていなかった。
// しかしこれだと、薄い水色バッジ（#e3f2fd 等）のように明るさは
// 白に近いが彩度も残っている背景が対象外のままになり、ナイトモードで
// 他の要素は暗くなったのにそこだけ白っぽく浮いて見える
// （「背景の色がおかしく見える」）不具合が起きていた。
// そこで文字色のとき（v3）と同じ考え方で、背景色の判定からも彩度の
// 条件を外し、「明るさ（明度）だけ」で判定するように変更した。
// 値引きボタンの赤／青／緑、ホーム画面の色付きボタンなど、彩度の高い
// “意味のある色”はもともと明度自体が低め（0.72未満）なので、この変更後も
// 彩度に関わらず対象外のまま保たれる。一方で白に近い薄いパステル系の
// 背景（バッジ等）は、意味づけの強さより「白背景に見えて浮く」ほうの
// 弊害が大きいため、今回からまとめて暗くする対象に含める。
// ------------------------------------------
// v2では文字色も「彩度が低い黒系・濃いグレー系」だけを明るくする対象に
// していたが、これだと紫の見出し文字（.modal-title.purple の #6a1b9a 等）
// のように彩度は高いが暗い色が対象外のまま残り、ナイトモードで背景だけ
// 暗くなった結果、暗い紫文字がほぼ判読できず「色がおかしく見える」
// 状態になっていた。
// そこで文字色の判定からは彩度の条件を外し、「明るさ（明度）だけ」で
// 判定するように変更した。背景色の判定（ボタン等の意味のある色を
// 守りたい）は従来どおり彩度も見て除外するが、文字色は白か黒かに
// 関わらず暗ければ白文字に切り替える（＝白は黒背景に、黒や紫などの
// 暗い文字は白文字になる、というシンプルな挙動）。
// ------------------------------------------
// 【v2での改訂の理由】
// 直前の版（v1）は、「暗くする背景」のCSSセレクタ一覧と「明るくする文字」の
// CSSセレクタ一覧を別々に手作業で書き並べる方式だった。
// このアプリには数十本の追加機能ファイル（xxx-system.js）が随時追加されており、
// 商品カード・分析画面のカード・データ管理画面の設定ブロックなど、
// 「白背景に黒文字」の箱があちこちに存在する。v1方式ではその一つひとつを
// セレクタとして登録し忘れると、背景だけ暗くなって文字が黒のまま残ったり、
// 逆に文字だけ明るくなって背景が白いままだったりして、文字が読めなくなる
// （＝今回報告された「文字の色・UIの色がおかしくなる」不具合）。
//
// そこで今回は、要素ごとに実際に画面へ描画されている色
// （getComputedStyle で取れる計算後スタイル）を調べ、
//   ・背景色が「白・薄いグレーなど、意味を持たない“素の背景”」なら
//     → pos-nm-bg という目印クラスを付けて暗くする対象にする
//   ・文字色が「黒・濃いグレーなど、意味を持たない“素の文字”」なら
//     → pos-nm-text という目印クラスを付けて明るくする対象にする
// という判定を自動で行うようにした。背景と文字を「同じ1回の判定」で
// 決めるため、片方だけ更新し忘れる、というズレが原理的に起きない。
//
// 値引きボタンの赤／青／緑、ホーム画面の色付きボタン、見出しナビの
// 水色バッジなど「背景で意味を持たせた色」は、HSLでいう彩度（S）が高いため
// 自動的に対象外と判定され、元の色のまま表示される
// （彩度の低い薄いグレー系だけを暗くするので、薄い水色や薄い緑などの
// 「意味のある淡色」は彩度が残っていれば区別できる）。
// 一方で文字色は「暗ければ彩度を問わず白文字にする」（v3で変更）。
//
// 目印クラスは「html.pos-night-mode .pos-nm-bg { ... !important }」という
// 形でCSS側にまとめて定義しているため、後から他の追加機能ファイルが
// その要素に対して style.background = '...' のようにインラインスタイルを
// 直接書き換えても（例：カードのマウスホバー処理など）、!important の
// ほうが優先されるので、ナイトモード中は暗い配色のまま保たれる。
//
// 判定はページ内の要素を1回ずつ調べるだけで、要素数が多くても
// 都度「透明かどうか」「明るさ・彩度」を見るだけの軽い計算なので、
// レジ端末でも実用上問題ない範囲のはず。
//
// index.html / style.css は直接編集せず、<style>タグの動的挿入と
// クラスの付け外しだけで実現する（他の追加機能ファイルと同じ方式）。
// ==========================================

const NIGHT_MODE_KEY = 'pos_night_mode_enabled'; // 旧仕様のキー（ON/OFFのみ）。新キーへの移行・後方互換のためだけに使う。

function ensureNightModeStyle() {
    if (document.getElementById('night-mode-style')) return;
    const style = document.createElement('style');
    style.id = 'night-mode-style';
    style.textContent = `
        /* ページの土台（隙間から見える部分）を暗くする */
        html.pos-night-mode,
        html.pos-night-mode body {
            background: #121212 !important;
        }

        /* 【v10で追加】ライトモード版。ページの土台を確実に白にする */
        html.pos-light-mode,
        html.pos-light-mode body {
            background: #ffffff !important;
        }

        /* 【v6で補足】現在の主な上書きはJS側でインラインstyleに
           !importantを直接セットする方式（詳細度の勝負を避けるため）。
           このクラスベースのルールは、何らかの理由でインライン上書きが
           まだ付いていない一瞬の間の保険として残してある */
        /* 【今回修正】background-image: none はここでは強制しない。
           このクラスは「背景色が白い」だけの理由でも付くため、ここで
           一律に消してしまうと、白い背景色の上に本物の写真を重ねて
           いる要素（商品カード・タッチパネル背景など）の写真も、
           保険ルールの効いている一瞬の間だけとはいえ隠れてしまう。
           装飾グラデーションを消す処理はJS側
           （classifyElementForNightMode内、bgImageIsPlainがtrueの
           時だけ）で個別にインラインstyleとして適用する。 */
        html.pos-night-mode .pos-nm-bg {
            background-color: #1e1e1e !important;
            border-color: #444 !important;
        }

        /* 自動判定で「意味を持たない、黒系・濃いグレー系の文字」と
           判定された要素をまとめて明るくする */
        html.pos-night-mode .pos-nm-text {
            color: #eee !important;
        }

        /* 【v10で追加】ライトモード版の保険ルール。上のナイトモード版と
           同じ理屈で、白背景・黒文字への上書きをクラスベースでも
           一応定義しておく（メインの上書きはJS側のインラインstyle）。
           pos-nm-bg / pos-nm-text という同じ目印クラスを使い回している
           理由は、html側についている pos-night-mode / pos-light-mode の
           どちらか一方（常に排他）に応じて解釈が変わる、という設計に
           しているため。 */
        /* 【今回修正】理由は上のナイトモード版と同じ。background-image
           の強制消去はJS側の個別判定（bgImageIsPlain）に任せる。 */
        html.pos-light-mode .pos-nm-bg {
            background-color: #ffffff !important;
            border-color: #ccc !important;
        }
        html.pos-light-mode .pos-nm-text {
            color: #111111 !important;
        }

        /* 【v8で追加】判定のやり直し（一旦元の色に戻す→読み直す→
           暗い色を当て直す）をしている間だけ、全要素の transition / animation
           を強制的に無効化する。これが無いと、カードのホバー演出などに
           付いている transition が「一瞬戻った明るい色」を起点にして
           律儀にフェードし直し、それが1.2秒ごとのチカチカ点滅として
           見えてしまう。あくまで判定処理をしているごく短い間だけ付ける
           一時的なクラスなので、通常の操作感（ボタンのホバー演出等）には
           影響しない。ライトモードの強制中も同じ仕組みを使うため、
           ここは方向を問わず共通のルールにしてある。 */
        /* 【v15で改訂】チカチカ防止に本当に必要なのは transition の停止だけ
           だったため、animation の一括停止はやめた（一度きりの演出
           アニメーションが再走査のたびに先頭から再生し直されてしまう
           不具合の原因だったため）。除外リストは transition 側の対象
           （長押しバー等）としてそのまま維持する。 */
        html.pos-nm-scanning,
        html.pos-nm-scanning *:not(#home-longpress-progress-bar):not(.customer-longpress-bar):not(.customer-longpress-indicator):not(.home-automation-block-archive-bar):not(#customer-home-back-progress):not(.slide-up-modal) {
            transition: none !important;
        }
    `;
    document.head.appendChild(style);
}

/* ---------- チカチカ防止用：バッチ処理中はtransitionを止める ---------- */
// 【v8で追加】
// classifyElementForNightMode の「一旦元に戻す→読み直す→暗くし直す」処理は
// 同期的なので画面には本来映らないはずだが、CSSのtransitionが変化前の値を
// 一瞬でも記録してしまうと、そこから律儀にフェードが発火してしまう。
// この一連の処理をしている間はhtmlに `pos-nm-scanning` クラスを付けて
// transition/animationを丸ごと止め、フェードそのものを起こさせない。
// MutationObserverのコールバックとsetIntervalの両方から同時に走ることも
// あり得るため、単純なON/OFFではなく参照カウント方式にしている。
let nightModeBatchDepth = 0;

function beginNightModeBatch() {
    ensureNightModeStyle();
    nightModeBatchDepth++;
    document.documentElement.classList.add('pos-nm-scanning');
}

function endNightModeBatch() {
    // クラスを外すタイミングが早すぎると、「transitionなしで確定させた
    // 最終状態」がまだ画面に描画される前にtransitionが復活してしまい、
    // 結局そこでフェードが起きかねない。実際に描画が済むのを待つため、
    // requestAnimationFrameを2回挟んでから外す。
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            nightModeBatchDepth = Math.max(0, nightModeBatchDepth - 1);
            if (nightModeBatchDepth === 0) {
                document.documentElement.classList.remove('pos-nm-scanning');
            }
        });
    });
}

// 判定・上書きのバッチ処理をtransition無効の状態で実行するためのラッパー
function runNightModeBatch(fn) {
    beginNightModeBatch();
    try {
        fn();
    } finally {
        // transitionが無効な間に強制的にスタイルを確定（フラッシュ）させる
        void document.documentElement.offsetHeight;
        endNightModeBatch();
    }
}

/* ---------- 色の自動判定まわり ---------- */

// 【v4での追加改訂】
// v3までは「背景を暗くする」判定にだけ彩度(S)の条件を残しており、
// 白・薄いグレーなど彩度の低い“素の背景”しか対象にしていなかった。
// しかしこれだと、薄い水色バッジ（#e3f2fd 等）のように明るさは
// 白に近いが彩度も残っている背景が対象外のままになり、ナイトモードで
// 他の要素は暗くなったのにそこだけ白っぽく浮いて見える
// （「背景の色がおかしく見える」）不具合が起きていた。
// そこで文字色のとき（v3）と同じ考え方で、背景色の判定からも彩度の
// 条件を外し、「明るさ（明度）だけ」で判定するように変更した。
// 値引きボタンの赤／青／緑、ホーム画面の色付きボタンなど、彩度の高い
// “意味のある色”はもともと明度自体が低め（0.72未満）なので、この変更後も
// 彩度に関わらず対象外のまま保たれる。一方で白に近い薄いパステル系の
// 背景（バッジ等）は、意味づけの強さより「白背景に見えて浮く」ほうの
// 弊害が大きいため、今回からまとめて暗くする対象に含める。
// ------------------------------------------
// "rgb(r, g, b)" / "rgba(r, g, b, a)" 形式の文字列を分解する
function parseNightModeColor(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return {
        r: parseFloat(m[1]),
        g: parseFloat(m[2]),
        b: parseFloat(m[3]),
        a: m[4] !== undefined ? parseFloat(m[4]) : 1
    };
}

// RGB(0-255) を HSL の彩度(S)・明度(L)（どちらも0〜1）に変換する
function rgbToSaturationLightness(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    }
    return { s, l };
}

// 「明るい（＝白系に見える）背景」かどうか。
// 【v4で改訂】以前は彩度も見て「彩度の低い、白・薄いグレーだけ」を
// 対象にしていたが、薄い水色バッジのような彩度のある白っぽい背景が
// 対象外のまま浮いて見える不具合があったため、彩度は見ずに
// 「明るさ（明度）だけ」で判定するように変更した。
// 値引きボタンの赤・青・緑や紫のグラデーションなど「意味のある濃い色」は
// 明度自体が0.72未満のことがほとんどなので、彩度条件を外しても
// 引き続き対象外のまま保たれる。
function isPlainLightBackground(rgbStr) {
    const c = parseNightModeColor(rgbStr);
    if (!c || c.a < 0.4) return false; // 透明に近い背景は親要素の色に任せる
    const { l } = rgbToSaturationLightness(c.r, c.g, c.b);
    return l > 0.72;
}

// 【v5で追加】background-image がグラデーション（linear-gradient等）の
// 場合に、その中の色から明るさを判定する。
// getComputedStyle().backgroundImage は "linear-gradient(180deg, rgb(255, 255, 255) 0%, rgb(224, 224, 224) 100%)"
// のように色をrgb()/rgba()形式で含んだ文字列を返すため、そこから色を
// すべて拾い出し、（ほぼ透明な色を除いて）明度の平均を見る。
// 紫やピンクなど「意味のあるグラデーションボタン」は平均明度が低いため、
// この判定でも対象外のまま保たれる。
function isPlainLightBackgroundImage(bgImageStr) {
    if (!bgImageStr || bgImageStr === 'none' || !/gradient/i.test(bgImageStr)) return false;
    const matches = bgImageStr.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+)?\)/g);
    if (!matches || matches.length === 0) return false;

    let total = 0;
    let count = 0;
    matches.forEach(str => {
        const c = parseNightModeColor(str);
        if (!c || c.a < 0.4) return; // ほぼ透明な色は平均から除外する
        const { l } = rgbToSaturationLightness(c.r, c.g, c.b);
        total += l;
        count++;
    });
    if (count === 0) return false;
    return (total / count) > 0.72;
}

// 暗い文字色（＝白背景を前提に選ばれていた文字色）かどうか。
// 【改訂】以前は彩度も見て「黒・濃いグレーだけ」を対象にしていたが、
// 紫の見出し文字（例: #6a1b9a）のように彩度は高いが暗い色は対象外の
// ままになり、ナイトモードで背景だけ黒くなった結果、暗い紫文字が
// ほぼ判読できない状態になっていた（「変な色に見える」不具合）。
// 文字色は背景ボタンのような「色による意味づけ」がほとんどないため、
// ここでは彩度を問わず「暗いかどうか（明度）」だけで判定し、
// 白か黒かに関わらず暗い文字は白文字に切り替える。
function isPlainDarkText(rgbStr) {
    const c = parseNightModeColor(rgbStr);
    if (!c || c.a < 0.4) return false;
    const { l } = rgbToSaturationLightness(c.r, c.g, c.b);
    return l < 0.5;
}

// ------------------------------------------
// 【v10で追加】ライトモード（常に背景白・文字黒に強制する）向けの判定。
// 上の isPlainLightBackground / isPlainDarkText と対になる考え方で、
// 「暗い（＝黒系に見える）背景」「明るい（＝白系に見える）文字」を
// 拾って白背景・黒文字に強制する。
// ------------------------------------------

// 「白ではない背景」かどうか。
// 【v11で改訂】以前は明度0.28未満の「かなり黒に近い」背景だけを対象に
// していたが、ライトモードの本来の設計（コメント冒頭参照）は
// 「背景が白以外の要素があれば白に強制する」という、ナイトモード側の
// 判定（意味のある色は明度で除外する）とは非対称な仕様だった。
// そのため、ホーム画面の緑・青・オレンジ・紫・青緑などの中間的な明るさの
// ボタン（明度がだいたい0.3〜0.7程度で、0.28未満にも0.72超にも
// 当てはまらない）が、ライトモードでも一切判定対象にならず、元の色の
// ままになってしまう不具合が報告された。
// ライトモードは「意味のある色を守る」ナイトモードとは違い、白以外は
// 問答無用で白にする、という利用者の要望どおりの仕様にするため、
// 閾値を大きく引き上げ、「すでにほぼ白（明度0.94超）」なものだけを
// 対象外とし、それ以外の背景色はすべて白に強制する対象に含めるように
// 変更した。
function isPlainDarkBackground(rgbStr) {
    const c = parseNightModeColor(rgbStr);
    if (!c || c.a < 0.4) return false; // 透明に近い背景は親要素の色に任せる
    const { l } = rgbToSaturationLightness(c.r, c.g, c.b);
    return l < 0.94;
}

// isPlainLightBackgroundImage と対になる、グラデーション背景版。
// 【v11で改訂】上の isPlainDarkBackground と同じ理由で、平均明度が
// 0.94未満（＝すでに白に近い場合を除くほぼすべて）のグラデーションを
// 対象にするよう引き上げた。これにより、ホーム画面のボタンのような
// 色付きグラデーションも、ライトモードでは背景色に置き換えられ
// グラデーション自体が消えて白背景になる。
function isPlainDarkBackgroundImage(bgImageStr) {
    if (!bgImageStr || bgImageStr === 'none' || !/gradient/i.test(bgImageStr)) return false;
    const matches = bgImageStr.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+)?\)/g);
    if (!matches || matches.length === 0) return false;

    let total = 0;
    let count = 0;
    matches.forEach(str => {
        const c = parseNightModeColor(str);
        if (!c || c.a < 0.4) return;
        const { l } = rgbToSaturationLightness(c.r, c.g, c.b);
        total += l;
        count++;
    });
    if (count === 0) return false;
    return (total / count) < 0.94;
}

// 明るい（＝白系の）文字色かどうか。
// isPlainDarkText と対になる考え方で、彩度を問わず「明るいかどうか
// （明度）」だけで判定し、明度0.5超の文字は黒文字に強制する。
function isPlainLightText(rgbStr) {
    const c = parseNightModeColor(rgbStr);
    if (!c || c.a < 0.4) return false;
    const { l } = rgbToSaturationLightness(c.r, c.g, c.b);
    return l > 0.5;
}

// 暗くした上書きを取り消し、要素がもともと持っていた色（インラインスタイル）を復元する【v7追加】
function clearNightModeOverride(el) {
    const props = ['background', 'background-color', 'background-image', 'border-color', 'color'];
    props.forEach(prop => {
        const origVal = el.getAttribute('data-nm-orig-' + prop);
        if (origVal !== null) {
            if (origVal === '') {
                el.style.removeProperty(prop);
            } else {
                el.style.setProperty(prop, origVal);
            }
        }
    });
    el.classList.remove('pos-nm-bg', 'pos-nm-text');
}

// 【v10で追加】現在アクティブな強制方向。
//   'dark'  … ナイトモード（プレーンな明るい背景／暗い文字を暗く強制）
//   'light' … ライトモード（プレーンな暗い背景／明るい文字を白く強制）
//   null    … 何も強制しない（＝通常。または「デバイスに合わせる」で
//             端末がライト設定のとき）
// classifyElementForNightMode 以下の判定・上書き処理は、この変数を見て
// どちら向きに色を強制するかを切り替える。dark/light どちらの強制も、
// 同じ判定済み目印クラス（pos-nm-bg / pos-nm-text）とバックアップの
// 仕組み（data-nm-orig-*）を共用している（実際にどちらの色になるかは
// html要素についている pos-night-mode / pos-light-mode クラスと、
// JS側でその都度セットするインラインstyleの値で決まる）。
let currentForceMode = null;

// 強制方向ごとに実際に当てはめる色
const NM_FORCE_PALETTE = {
    dark: { bg: '#1e1e1e', border: '#444', text: '#eee' },
    light: { bg: '#ffffff', border: '#ccc', text: '#111111' }
};

// 【v13で追加】色そのものに意味がある要素（例：客用画面の「5秒長押しで
// ホームに戻る」バーのように、色や見た目の変化そのものが情報になっている
// もの）は、明るさだけを見る自動判定の対象から完全に除外し、常に元の色の
// まま表示する。値引きボタン等はもともと彩度・明度が高すぎず対象外に
// なっていたが、この長押しバーはアンバー色（明度0.578ほど）で、v11で
// ライトモードの閾値を「明度0.94未満は白に強制」まで引き上げた影響を
// 受けて白く上書きされてしまい、進捗バーの色が変わって分かりづらくなる
// 不具合につながっていた。個別の閾値調整では他の意図（白以外は白にする）
// と両立しづらいため、セレクタで名指しして除外する方式にした。
// 【v14で追加】ホーム画面の4秒長押しバー（home-automation-blocks.js）も
// 全く同じ「色そのものに意味がある」要素なので、同様に除外対象へ追加した。
const NM_ALWAYS_IGNORE_SELECTORS = ['.customer-longpress-bar', '.customer-longpress-indicator', '#home-longpress-progress-bar', '#home-longpress-progress-track', '#customer-home-back-progress', '.modal-overlay'];

function isNightModeIgnoredElement(el) {
    return NM_ALWAYS_IGNORE_SELECTORS.some(sel => {
        try { return el.matches(sel); } catch (e) { return false; }
    });
}

// 要素1つを判定し、必要なら色を上書きする・戻す。
// 【v7での改訂】点滅を防ぐため、初回判定時に「元の色」を記録する。
// 【v10での改訂】ナイトモード専用だった判定を、currentForceMode に応じて
// 「明るい背景／暗い文字を暗くする」（dark）と「暗い背景／明るい文字を
// 白くする」（light）のどちらでも行えるように一般化した。
function classifyElementForNightMode(el) {
    if (!el || el.nodeType !== 1) return;
    if (!currentForceMode) return; // 何も強制しないモードでは判定自体を行わない

    // 【v13で追加】常に除外する要素は、上書き済みなら元に戻したうえで
    // 判定自体をスキップする（＝常に元の色のまま）
    if (isNightModeIgnoredElement(el)) {
        if (el.classList.contains('pos-nm-bg') || el.classList.contains('pos-nm-text')) {
            clearNightModeOverride(el);
        }
        return;
    }

    // 初回スキャン時：元々のインラインスタイルをバックアップして記録
    if (!el.hasAttribute('data-nm-scanned')) {
        el.setAttribute('data-nm-orig-background', el.style.background || '');
        el.setAttribute('data-nm-orig-background-color', el.style.backgroundColor || '');
        el.setAttribute('data-nm-orig-background-image', el.style.backgroundImage || '');
        el.setAttribute('data-nm-orig-border-color', el.style.borderColor || '');
        el.setAttribute('data-nm-orig-color', el.style.color || '');
        el.setAttribute('data-nm-scanned', 'true');
    }

    const hadBg = el.classList.contains('pos-nm-bg');
    const hadText = el.classList.contains('pos-nm-text');

    // 既に判定済みなら、画面描画を挟まないように裏で一時的に元に戻して再計算
    if (hadBg || hadText) {
        clearNightModeOverride(el);
    }

    let cs;
    try {
        cs = window.getComputedStyle(el);
    } catch (e) {
        return;
    }

    const palette = NM_FORCE_PALETTE[currentForceMode];
    // 【今回修正】背景色（background-color）が「素の白/黒」だから、という
    // 理由だけでは background-image を消さないようにする。
    // これまでは「背景色が白っぽい」か「背景画像（グラデーション）が
    // 白っぽい」かのどちらかが真なら、無条件で background-image を
    // 'none' に上書きしていた。しかし商品カード・タッチパネル背景など、
    // CSS上は白いbackground-colorのまま、その上に本物の写真を
    // background-imageとして重ねている要素がこのアプリには多数あり、
    // 背景色が白いというだけの理由で写真そのものが消えてしまう不具合が
    // あった（写真の代わりに黒一色になり、商品写真・背景写真が
    // 一切表示されなくなる）。
    // 「装飾のためのグラデーション」と「意味のある写真」を区別するため、
    // background-image 自体を消すかどうかは
    // isPlainLightBackgroundImage / isPlainDarkBackgroundImage
    // （＝グラデーションであり、かつ明るさが対象条件を満たす場合のみ真）
    // の結果だけで判断し、背景色側の判定はbackground-colorの上書きにのみ
    // 使う。
    const bgColorIsPlain = currentForceMode === 'dark'
        ? isPlainLightBackground(cs.backgroundColor)
        : isPlainDarkBackground(cs.backgroundColor);
    const bgImageIsPlain = currentForceMode === 'dark'
        ? isPlainLightBackgroundImage(cs.backgroundImage)
        : isPlainDarkBackgroundImage(cs.backgroundImage);
    const needsBgOverride = bgColorIsPlain || bgImageIsPlain;
    const needsTextOverride = currentForceMode === 'dark'
        ? isPlainDarkText(cs.color)
        : isPlainLightText(cs.color);

    if (needsBgOverride) {
        el.style.setProperty('background-color', palette.bg, 'important');
        // 写真ではなく「装飾グラデーションそのものが明るい/暗い」と
        // 判定された場合だけ、background-imageを消す。
        if (bgImageIsPlain) {
            el.style.setProperty('background-image', 'none', 'important');
        }
        el.style.setProperty('border-color', palette.border, 'important');
        el.classList.add('pos-nm-bg');
    } else {
        el.classList.remove('pos-nm-bg');
    }

    if (needsTextOverride) {
        el.style.setProperty('color', palette.text, 'important');
        el.classList.add('pos-nm-text');
    } else {
        el.classList.remove('pos-nm-text');
    }
}

// ナイトモードOFF時に、これまで上書きしてきた要素をすべて元に戻す
function clearAllNightModeOverrides() {
    document.querySelectorAll('[data-nm-scanned]').forEach(el => {
        clearNightModeOverride(el);
        el.removeAttribute('data-nm-scanned');
    });
}

function scanForNightMode(root) {
    if (!root || root.nodeType !== 1) return;
    classifyElementForNightMode(root);
    if (root.querySelectorAll) {
        root.querySelectorAll('*').forEach(classifyElementForNightMode);
    }
}

let nightModeMutationObserver = null;
let nightModeRescanTimer = null;

// 強制表示（ナイトモード or ライトモード）が有効な間だけ、後から追加される
// 要素（商品カード・分析カードなど）も自動で判定して目印クラスを付ける。
// 【v5で追加】新規追加要素の検知（MutationObserver）だけでなく、
// 既存要素の見た目が後から変わるケース（例：ボタンが無効化されて
// グレー表示に変わる等）にも追従できるよう、強制表示中は
// 1.2秒おきに軽く全体を再走査する。
// 【v10での改訂】ナイトモード専用だったこの仕組みを、強制する方向
// （'dark' or 'light'）を引数で受け取れるように一般化した。すでに
// observer/タイマーが動いている状態で方向だけ切り替える（例：ナイト→
// ライトへ直接切り替える）場合も、currentForceMode を更新したうえで
// 即座に1回再走査するので、次の1.2秒待たずに反映される。
function startNightModeAutoScan(mode) {
    currentForceMode = mode;
    runNightModeBatch(() => scanForNightMode(document.body));
    if (!nightModeMutationObserver) {
        nightModeMutationObserver = new MutationObserver(mutations => {
            // 追加されたノードすべてを1回のバッチにまとめてtransitionを
            // 止めた状態で判定する（ノードごとにON/OFFを繰り返さない）
            runNightModeBatch(() => {
                mutations.forEach(m => {
                    m.addedNodes.forEach(node => scanForNightMode(node));
                });
            });
        });
        nightModeMutationObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (!nightModeRescanTimer) {
        nightModeRescanTimer = setInterval(() => {
            runNightModeBatch(() => scanForNightMode(document.body));
        }, 1200);
    }
}

function stopNightModeAutoScan() {
    if (nightModeMutationObserver) {
        nightModeMutationObserver.disconnect();
        nightModeMutationObserver = null;
    }
    if (nightModeRescanTimer) {
        clearInterval(nightModeRescanTimer);
        nightModeRescanTimer = null;
    }
    // v6でインラインスタイル直接上書き方式に変えたため、
    // 強制表示OFF時は明示的に上書きを取り消す必要がある
    // （html.pos-night-mode / pos-light-mode クラスを外すだけでは、
    // インラインの !important までは自動的には消えないため）
    // 【v8】ここも大量の要素を一斉に元へ戻すバッチ処理なので、
    // transitionを止めた状態で行い、戻す瞬間のチカチカを防ぐ。
    runNightModeBatch(() => clearAllNightModeOverrides());
    currentForceMode = null;
}

/* ---------- 共通ドロワー（右端の矢印タブを押すとパネルが出てくるUI） ---------- */
// clerk-font-size-system.js と共通の仕組み。既にあれば作り直さない。

function ensurePosUtilityToolbarStyle() {
    if (document.getElementById('pos-utility-toolbar-style')) return;
    const style = document.createElement('style');
    style.id = 'pos-utility-toolbar-style';
    style.textContent = `
        #pos-utility-drawer { position: fixed; top: 70px; right: 0; z-index: 8000; display: flex; align-items: flex-start; }
        #pos-utility-panel { max-width: 0; overflow: hidden; transition: max-width 0.25s ease; background: #fff; border-radius: 10px 0 0 10px; box-shadow: -2px 2px 8px rgba(0,0,0,0.25); }
        #pos-utility-drawer.open #pos-utility-panel { max-width: 220px; }
        #pos-utility-panel-inner { display: flex; flex-direction: column; gap: 6px; padding: 8px; white-space: nowrap; }
        #pos-utility-tab { border: none; background: #37474f; color: #fff; font-size: 16px; font-weight: bold; padding: 14px 8px; border-radius: 10px 0 0 10px; cursor: pointer; box-shadow: -2px 2px 8px rgba(0,0,0,0.25); }
    `;
    document.head.appendChild(style);
}

function ensurePosUtilityToolbar() {
    ensurePosUtilityToolbarStyle();
    let inner = document.getElementById('pos-utility-panel-inner');
    if (inner) return inner;

    const drawer = document.createElement('div');
    drawer.id = 'pos-utility-drawer';

    const panel = document.createElement('div');
    panel.id = 'pos-utility-panel';

    inner = document.createElement('div');
    inner.id = 'pos-utility-panel-inner';
    panel.appendChild(inner);

    const tab = document.createElement('button');
    tab.id = 'pos-utility-tab';
    tab.type = 'button';
    tab.innerText = '◀';
    tab.setAttribute('aria-label', '設定パネルを開く・閉じる');
    tab.addEventListener('click', () => {
        const isOpen = drawer.classList.toggle('open');
        tab.innerText = isOpen ? '▶' : '◀';
    });

    drawer.appendChild(panel);
    drawer.appendChild(tab);
    document.body.appendChild(drawer);
    return inner;
}

/* ---------- 通常／ライト／ナイト／デバイスに合わせる モード切り替え ---------- */
// 4つのモード：
//   'normal' … 通常。配色に一切手を加えない
//   'light'  … ライトモード。背景が白以外の要素は白に、明るい文字は
//              黒に強制する
//   'dark'   … ナイトモード。従来通り、常に暗い配色に固定する
//   'device' … デバイスに合わせる。端末（OS）の配色設定を見て、
//              ダーク設定なら 'dark' と全く同じ強制を行い、
//              ライト設定なら 'normal' と同じく何もしない

const POS_COLOR_MODE_KEY = 'pos_color_mode'; // 'normal' | 'light' | 'dark' | 'device'

function getPosColorMode() {
    const saved = localStorage.getItem(POS_COLOR_MODE_KEY);
    if (saved === 'normal' || saved === 'light' || saved === 'dark' || saved === 'device') {
        return saved;
    }

    // 前バージョン（3モード版）で保存された 'auto' は、今回追加した
    // 'device'（デバイスに合わせる）に読み替える
    if (saved === 'auto') {
        localStorage.setItem(POS_COLOR_MODE_KEY, 'device');
        return 'device';
    }

    // 新キーがまだ無い場合は、さらに古い旧キー（ON/OFFのみのナイトモード
    // 設定）から移行する。
    //   旧ON  → dark へ
    //   旧OFF・旧キーが一度も存在しない（初回起動） → normal へ
    //   （このアプリは元々、配色に何も手を加えない状態が既定だったため、
    //   移行後の既定値も同じ「何もしない」に揃える）
    const legacy = localStorage.getItem(NIGHT_MODE_KEY);
    const migrated = legacy === 'true' ? 'dark' : 'normal';
    localStorage.setItem(POS_COLOR_MODE_KEY, migrated);
    return migrated;
}

function setPosColorMode(mode) {
    localStorage.setItem(POS_COLOR_MODE_KEY, mode);
    // 旧キーだけを見ている他ファイルが万一あっても矛盾が出ないよう、
    // 旧キーもナイトモード相当のON/OFFとして同期しておく
    localStorage.setItem(NIGHT_MODE_KEY, mode === 'dark' ? 'true' : 'false');
}

function prefersDeviceDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

// 指定モードのとき、実際にどちら向きの強制表示を行うべきかを返す。
// 'dark' | 'light' | null（何も強制しない）
function resolveForceMode(mode) {
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    if (mode === 'device') return prefersDeviceDark() ? 'dark' : null;
    return null; // 'normal'
}

// 【v11で追加】客用画面（customer-screen）が表示されているかどうか。
// 客用画面は店員の設定に関わらず、お客様に見せるための本来のデザイン
// （色付きの見た目）のまま表示したいという要望があったため、この画面が
// 表示されている間だけライトモードの強制を止めるために使う。
// 【v15で追加】タッチパネル注文システム（touch-panel-order-system.js）の
// 客用モードも全く同じ理由（お客様に見せる専用デザインを、店員側の
// ライトモード設定で白背景に上書きされたくない）に当てはまるため、
// タッチパネルが表示されていて、かつ店員用モードではない間もここに
// 含めるようにした。
function isCustomerScreenActive() {
    const el = document.getElementById('customer-screen');
    if (el && el.classList.contains('active')) return true;

    const tpOverlay = document.getElementById('touch-panel-overlay');
    if (tpOverlay && typeof touchPanelState !== 'undefined' && touchPanelState && touchPanelState.mode !== 'staff') {
        return true;
    }
    return false;
}

// 【v11で追加】resolveForceMode() の結果に「客用画面が開いている間は
// ライトモードを強制しない」という例外だけを重ねて、実際に適用すべき
// 強制方向を返す。ナイトモード（dark）はこれまで通り客用画面にも適用
// されるが、ライトモード（light）だけは客用画面表示中は無効になる。
function computeEffectiveForceMode(mode) {
    const resolved = resolveForceMode(mode);
    if (resolved === 'light' && isCustomerScreenActive()) return null;
    return resolved;
}

/* ---------- 「デバイスに合わせる」中、端末の配色設定が変わったら追従する ---------- */
let deviceColorSchemeQuery = null;
let deviceColorSchemeListener = null;

function startWatchingDeviceColorScheme() {
    if (!window.matchMedia) return;
    if (!deviceColorSchemeQuery) {
        deviceColorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }
    if (deviceColorSchemeListener) return;
    deviceColorSchemeListener = () => {
        // 「デバイスに合わせる」のときだけ、端末側の変化に合わせて
        // 実際の見た目を切り替える
        if (getPosColorMode() === 'device') {
            applyPosColorMode('device', { silent: true });
        }
    };
    if (deviceColorSchemeQuery.addEventListener) {
        deviceColorSchemeQuery.addEventListener('change', deviceColorSchemeListener);
    } else if (deviceColorSchemeQuery.addListener) {
        // addEventListener未対応の古いブラウザ向けの互換
        deviceColorSchemeQuery.addListener(deviceColorSchemeListener);
    }
}

function stopWatchingDeviceColorScheme() {
    if (!deviceColorSchemeQuery || !deviceColorSchemeListener) return;
    if (deviceColorSchemeQuery.removeEventListener) {
        deviceColorSchemeQuery.removeEventListener('change', deviceColorSchemeListener);
    } else if (deviceColorSchemeQuery.removeListener) {
        deviceColorSchemeQuery.removeListener(deviceColorSchemeListener);
    }
    deviceColorSchemeListener = null;
}

/* ---------- モード切り替えボタン（4つ）の見た目 ---------- */
function ensureColorModeButtonsStyle() {
    if (document.getElementById('pos-color-mode-style')) return;
    const style = document.createElement('style');
    style.id = 'pos-color-mode-style';
    style.textContent = `
        #pos-color-mode-buttons { display: flex; flex-direction: column; gap: 4px; }
        #pos-color-mode-buttons button {
            padding: 8px 10px;
            font-size: 12px;
            font-weight: bold;
            background: #263238;
            color: #cfd8dc;
            border: 1px solid #37474f;
            border-radius: 16px;
            cursor: pointer;
            white-space: nowrap;
            text-align: left;
        }
        #pos-color-mode-buttons button.pos-color-mode-active {
            background: #0288d1;
            color: #fff;
            border-color: #0288d1;
        }
    `;
    document.head.appendChild(style);
}

function updateColorModeButtons(mode) {
    const container = document.getElementById('pos-color-mode-buttons');
    if (!container) return;
    container.querySelectorAll('button[data-color-mode]').forEach(btn => {
        btn.classList.toggle('pos-color-mode-active', btn.getAttribute('data-color-mode') === mode);
    });
}

function ensureColorModeButtons() {
    const panel = ensurePosUtilityToolbar();
    ensureColorModeButtonsStyle();
    if (document.getElementById('pos-color-mode-buttons')) return;

    const container = document.createElement('div');
    container.id = 'pos-color-mode-buttons';

    const modeDefs = [
        { mode: 'normal', label: '⚪ 通常', aria: '通常（配色を変更しない）' },
        { mode: 'light', label: '☀️ ライトモード', aria: 'ライトモード（背景白・文字黒に固定）' },
        { mode: 'dark', label: '🌙 ダークモード', aria: 'ダークモード（背景黒に固定）' },
        { mode: 'device', label: '🖥️ デバイスに合わせる', aria: 'デバイスに合わせる（端末の設定がダークのときだけダークモードにする）' }
    ];

    modeDefs.forEach(def => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-color-mode', def.mode);
        btn.setAttribute('aria-label', def.aria);
        btn.innerText = def.label;
        btn.addEventListener('click', () => applyPosColorMode(def.mode));
        container.appendChild(btn);
    });

    panel.appendChild(container);
    updateColorModeButtons(getPosColorMode());
}

// モードを実際に適用する（画面への反映・保存・ボタンのハイライト・音声案内）
function applyPosColorMode(mode, opts) {
    const silent = !!(opts && opts.silent);
    ensureNightModeStyle();

    // 【v11で改訂】resolveForceMode() ではなく、客用画面表示中の
    // ライトモード除外を加味した computeEffectiveForceMode() を使う
    const forceMode = computeEffectiveForceMode(mode); // 'dark' | 'light' | null
    document.documentElement.classList.toggle('pos-night-mode', forceMode === 'dark');
    document.documentElement.classList.toggle('pos-light-mode', forceMode === 'light');
    setPosColorMode(mode);
    updateColorModeButtons(mode);

    if (forceMode) {
        startNightModeAutoScan(forceMode);
    } else {
        stopNightModeAutoScan();
    }

    if (mode === 'device') {
        startWatchingDeviceColorScheme();
    } else {
        stopWatchingDeviceColorScheme();
    }

    if (!silent) {
        if (typeof playSound === 'function') playSound('click');
        if (typeof speak === 'function') {
            const messages = {
                normal: 'つうじょう もーど に しました',
                light: 'らいと もーど に しました',
                dark: 'だーく もーど に しました',
                device: 'たんまつ の せってい に あわせる もーど に しました'
            };
            speak(messages[mode] || '');
        }
    }
}

// 【v11で追加】画面が切り替わるたびに、現在保存されているモードのまま
// computeEffectiveForceMode() を再評価して反映し直す（客用画面に
// 入った・出たタイミングでライトモードの適用/解除を切り替えるため）。
// ユーザーが選んだモード自体（保存値・ボタンのハイライト）は変えない
// ので、音声案内やクリック音は鳴らさない（silent固定）。
function reapplyColorModeForScreenChange() {
    applyPosColorMode(getPosColorMode(), { silent: true });
}

// 【v11で追加】ui.js の showScreen() を直接編集せず、他の追加機能
// ファイルと同じフック方式で「画面が切り替わったら再評価する」処理を
// 差し込む。客用画面はこの showScreen() 経由で表示/非表示が切り替わる
// ため、これで通常の画面遷移はすべて拾える。
(function hookShowScreenForColorMode() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            reapplyColorModeForScreenChange();
            return result;
        };
    }
    tryHook();
})();

/* ---------- 後方互換 ---------- */
// 他の追加機能ファイル（xxx-system.js）が旧関数名を直接呼んでいる場合に
// 備えて残しておく。新システムでは「実際に画面を暗くしているか」を返す。
function isNightModeEnabled() {
    return resolveForceMode(getPosColorMode()) === 'dark';
}
function toggleNightMode() {
    applyPosColorMode(isNightModeEnabled() ? 'normal' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
    ensureColorModeButtons();
    // 端末に保存されている状態（前回選んだモード）をそのまま復元する
    applyPosColorMode(getPosColorMode(), { silent: true });
});