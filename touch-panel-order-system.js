// ==========================================
// touch-panel-order-system.js
// ------------------------------------------
// 【今回の改訂内容】
// ・ブラウザ／タブレットの「戻る」操作（戻るボタン等）でタッチパネルの
//   外へ実際にナビゲーションされてしまい、テーブルの「使用中」フラグが
//   解除されないまま残ってしまう不具合を修正。タッチパネルを開いている
//   間はpopstateイベントを監視し、「戻る」操作があった場合はその場で
//   #touch-panelへ履歴を積み直して打ち消すようにした。これにより、正規の
//   手順（お会計完了後のリセット・暗証番号での「削除」）以外では外へ
//   出られなくなり、「使っていないのに使用中と出る」不具合の主な原因が
//   無くなる。
// ・「写真のURLを指定して保存したのに、メニュー画面に表示されない」
//   不具合を修正。原因は、URL指定（🔗 URLで設定）が入力された文字列を
//   検証なしにそのまま保存していたため、リンク切れ・ホットリンク拒否・
//   混在コンテンツ等で実際には読み込めない画像でも「保存成功」に
//   見えてしまっていたこと。保存前に一度実際に読み込みを試し
//   （tpVerifyImageUrlLoads）、読み込めた場合のみ保存・反映し、
//   読み込めない場合はその場で「このURLは読み込めませんでした」と
//   知らせて保存自体を行わないようにした（applyTouchPanelBgUrl() /
//   applyTouchPanelProductImgUrl()）。すでに保存済みで壊れている
//   写真がある場合は、一度「削除」してから同じURLで設定し直すと
//   この検証が働く。
// ・「💰 お会計」ボタンを押した直後に自動化バーコードを登録していたのを
//   やめ、先に「お会計をしますか？（合計金額つき）／この後は前の画面には
//   戻れなくなります」という確認ダイアログを挟むように変更した
//   （openTouchPanelCheckoutConfirm()）。「はい、お会計する」を選んだ
//   場合のみ、これまで通りの送信処理（executeTouchPanelCheckoutRequest()、
//   旧requestCheckoutFromTouchPanel()の中身）を実行する。合計金額は、
//   このテーブルで送信済みの注文とまだ送信していないカートの中身を
//   合算して表示する（touchPanelGrandTotalSoFar()）。
// ・注文送信後の「ご注文ありがとうございます！」画面でも、テーブルが
//   使用中の場合は「テーブル使用中です」バッジを併せて表示するように
//   した（showTouchPanelOrderCompleteOverlay()）。会計後（店員が
//   お会計後の画面をリセットした後）はこの画面自体を経由しないため、
//   自然にバッジも表示されなくなる。
// ・「🔔 店員を呼ぶ」「💰 お会計」を押すと、既存の自動化バーコード登録
//   フォーム（#discount-screen）側の「商品追加または割引のどちらか
//   一方以上を設定してください」というバリデーションに引っかかり、
//   本来お客様には見せるつもりのないその確認ダイアログが客用画面に
//   表示されてしまう不具合を修正（registerAutomationBarcodeViaForm()）。
//   商品を1つも紐付けない「通知だけ」のバーコード（呼び出し／お会計）を
//   登録する場合は、実際には何も割り引かない「0円引き」を割引欄へ
//   仮設定し、バリデーションだけを満たすようにした。
// ・「🖼️ 背景設定」ボタン、「🧑‍💼 店員用」ボタンをお客様の目に入る画面
//   から廃止。背景設定・店員用モードは、目立たない場所に置いた小さな
//   バッジを長押し→暗証番号を入力することでのみ入れるようにした
//   （店員用の隠しコマンドとして実装。暗証番号は客用画面の脱出防止と
//   同じ TOUCH_PANEL_KIOSK_PIN を使い回している）。
// ・タッチパネルを開いたときに全画面表示（Fullscreen API）を要求し、
//   閉じたときに解除するようにした（対応していない環境では何もしない）。
// ------------------------------------------
// 【前回までのリニューアル内容】
// ガストなどのファミリーレストランにある本格的なタッチパネル注文
// システムに近づけるため、UI/UXを全面的に作り直しました。
//
// ・メニュー画面を「ジャンル別の左サイドバー ＋ 写真中心のグリッド」
//   構成に変更。ジャンルは商品管理画面で設定している p.genre から
//   自動生成します（未設定の商品は「その他」に分類）。
// ・商品をタップすると、写真・説明文・サイズ等のバリエーション・数量
//   を確認できる「商品詳細ポップアップ」を表示するように変更しました
//   （タップで即カート追加ではなく、詳細確認 → カート追加の2段階に）。
// ・画面下部に常時表示される「注文かごバー」（件数・合計金額）を追加。
//   タップすると、注文内容の一覧・数量変更・送信ができる引き出し
//   （カートドロワー）がせり上がって表示されます。
// ・「⭐ おすすめ」機能を追加。店員用モードで商品ごとに
//   おすすめ設定・写真設定・説明文設定ができ、設定した商品は
//   「おすすめ」カテゴリにまとまり、通常表示にも⭐バッジが付きます。
// ・「🔔 店員を呼ぶ」をタップすると、お冷/おしぼり・灰皿・その他など
//   用件を選べるポップアップを表示するように変更しました（実際の
//   ファミレス用タッチパネルにある「呼び出し用件の選択」を再現）。
//   「💰 お会計」はこれまで通り独立したボタンとして常時表示されます。
// ・注文を送信すると「ご注文ありがとうございます」というアニメーション
//   付きの完了画面を数秒表示したのち、自動的に同じテーブルの
//   メニュー画面へ戻ります（続けて追加注文できるよう、送信のたびに
//   タッチパネルを閉じない仕様に変更しました）。
// ・配色・フォント・ボタンデザインを、柿色×抹茶色×深紺の専用テーマに
//   変更し、飲食店の注文画面らしい世界観にしています。
// ・客用モードの画面（テーブル選択・メニュー画面）から、通常の
//   「キャンセル」ボタンを廃止し、お客様がタッチパネル以外の画面
//   （レジ本体の画面など）へ絶対に行けないようにしました。
//   画面左下に小さく表示される（普段はただの表示に見える）バッジを
//   長押しすると暗証番号（5678）の入力画面が出て、正しく入力すると
//   「本当に注文を削除しますか？　※店員以外は絶対に押さないでください」
//   という確認ダイアログが表示されます。ここで「はい」を押した場合の
//   み、注文内容を削除してタッチパネルを終了し、元の画面（レジホーム
//   画面）へ戻ります。このコマンドを実行しない限り、お客様がタッチ
//   パネルから抜け出す手段は一切ありません（店員用モードでは、これ
//   までどおり通常の「キャンセル」ボタンで即座に閉じられます）。
//
// 【これまでの要望（継続・維持）】
// ・同じテーブルから複数回送信/呼び出しがあっても、既存の自動化
//   バーコードを上書きしない（毎回、独立した新しいバーコードとして
//   登録する）。
// ・タッチパネルを開いたら、最初に「人数」を選ぶ画面を挟む。
// ・背景画像・メニュー（商品）ごとの写真を指定できる。
// ・ホーム画面の「会員・顧客管理」ボタンを半分幅にし、右に
//   タッチパネル起動ボタンを新設。
// ・タッチパネル内の「キャンセル」は確認ダイアログを挟まず即座に閉じる。
// ・「送信」時は使い切りバーコードとして自動化バーコード一覧に登録する。
//
// 【実装方針・前提（変更なし）】
// register.js / ui.js / index.html / master-mgmt.js / discount-system.js は
// 直接編集せず、既存の「自動化バーコード作成」画面（#discount-screen）が
// 持っている本物の登録ロジック（addDiscountBarcode() / addStagedProductRow() /
// renderDiscounts()）をフォーム欄に値を入れて呼び出す形で再利用しています。
//
// 画像（背景・商品写真）はアップロード機能を持たせず「画像のURLを
// 指定する」方式のままです（説明文・おすすめ設定も同じく
// テキスト/フラグ指定 → localStorage保存という仕組みで実装しています）。
// ==========================================

/* =========================================================
   ① 設定（店舗に合わせて調整してください）
   ========================================================= */

// マス目（テーブル番号）の数
const TOUCH_PANEL_TABLE_COUNT = 50;

// 人数選択の選択肢（最後は「9+」として扱われる）
const TOUCH_PANEL_PARTY_SIZE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// 商品ごとのバリエーション設定（任意）
// 例）'4901234567890': ['ホット', 'アイス']
const TOUCH_PANEL_PRODUCT_VARIATIONS = {
    // 'JANコードをここに': ['バリエーション1', 'バリエーション2']
};

// 【今回追加】バリエーション（サイズ・種類など）は、以前はこのファイルの
// TOUCH_PANEL_PRODUCT_VARIATIONS を直接書き換えないと設定できなかった。
// 写真・説明文・おすすめ設定と同じように、店員用メニューからその場で
// 追加・変更できるようにするための保存先（pos_で始まるキーなので、
// backup-extra-settings-sync.js により自動的にバックアップ対象にもなる）。
const TOUCH_PANEL_VARIATIONS_STORAGE_PREFIX = 'pos_touch_panel_variations_';
const TOUCH_PANEL_BG_STORAGE_KEY = 'pos_touch_panel_bg_url';
const TOUCH_PANEL_IMG_STORAGE_PREFIX = 'pos_touch_panel_img_';
const TOUCH_PANEL_DESC_STORAGE_PREFIX = 'pos_touch_panel_desc_';
const TOUCH_PANEL_RECO_STORAGE_KEY = 'pos_touch_panel_reco_jans';
// 【今回追加】使用中テーブルの管理（店舗全体で共有する必要があるため、
// 他端末とAblyでリアルタイム同期する。詳しくは⑳を参照）
const TOUCH_PANEL_OCCUPIED_TABLES_KEY = 'pos_touch_panel_occupied_tables';
// 【今回追加】メニュー上部の横スクロールバナーに出す、お知らせ・キャンペーン文言
const TOUCH_PANEL_PROMO_TEXT_KEY = 'pos_touch_panel_promo_text';

// 客用モードの「脱出防止（キオスクロック）」で使う暗証番号。
// 左下のバッジを長押し→この番号を入力→確認ダイアログで「はい」を
// 押した場合のみ、タッチパネルを終了できる（店員用の隠しコマンド）。
const TOUCH_PANEL_KIOSK_PIN = '5678';
const TOUCH_PANEL_KIOSK_LONGPRESS_MS = 1100;

// 商品管理画面の「ジャンル」に対応するアイコン（未登録のジャンルは
// 🍽️ が使われます。店舗で独自のジャンルを追加した場合はここに
// 追記すると、タッチパネル上にもアイコンが表示されます）
const TOUCH_PANEL_GENRE_ICONS = {
    '食品': '🍱',
    '飲料/お酒': '🍹',
    'お惣菜/お弁当': '🍙',
    'スイーツ/菓子': '🍰',
    '日用品': '🧻',
    '衣料品': '👕',
    '雑貨': '🛍️',
    'サービス': '🛎️',
    'その他商品': '📦',
    '値引き/その他': '💴',
    'その他': '📦'
};

// 「🔔 店員を呼ぶ」を押したときに選べる用件（ガストなどの本格的な
// タッチパネルにある呼び出し種別選択を再現）
const TOUCH_PANEL_CALL_REASONS = [
    { key: 'staff',   label: '店員を呼ぶ',      icon: '🔔', voice: 'てんいん を よびだし まし た',       notifyTitle: '🔔 呼び出しがあります',   notifyBodySuffix: 'から呼び出しです' },
    { key: 'water',   label: 'お冷・おしぼり',  icon: '🧊', voice: 'おひや と おしぼり を おねがいします', notifyTitle: '🧊 お冷・おしぼりの依頼', notifyBodySuffix: 'からお冷・おしぼりの依頼です' },
    { key: 'ashtray', label: '灰皿がほしい',    icon: '🚬', voice: 'はいざら を おねがいします',         notifyTitle: '🚬 灰皿の依頼',          notifyBodySuffix: 'から灰皿の依頼です' },
    { key: 'other',   label: 'その他のご用件',  icon: '✋', voice: 'ようけん が あります',               notifyTitle: '✋ ご用件があります',     notifyBodySuffix: 'からご用件があります' }
];

/* =========================================================
   ② 内部状態
   ========================================================= */
let touchPanelState = {
    mode: null,          // 'customer' | 'staff'
    partySize: null,     // 人数
    table: null,         // テーブル番号
    order: [],           // [{ jan, name, price, variation, qty }]
    sentOrders: [],       // 【今回追加】このテーブルでこれまでに送信した注文の履歴 [{ time, items, total }]
    activeCategory: 'all', // メニュー画面で選択中のジャンル（'all' | '__reco__' | 実際のジャンル名）
    searchQuery: '',      // メニュー検索ボックスの入力内容
    modalDraft: null,     // 商品詳細ポップアップの入力中の状態 { jan, variation, qty }
    screen: null          // 【今回追加】今表示中の画面（'menu' | 'checkoutThanks'）。電源断からの復旧用
};

function resetTouchPanelState() {
    touchPanelState = {
        mode: null, partySize: null, table: null, order: [], sentOrders: [],
        activeCategory: 'all', searchQuery: '', modalDraft: null, screen: null
    };
    // 「最初からやり直す」タイミング（タッチパネルを開き直す／お会計後の
    // リセット／店員によるキャンセル）なので、電源断復旧用に残していた
    // セッションも一緒に消しておく（残っていると、次に電源を入れた時に
    // 古い注文内容が復活してしまうため）。
    clearTouchPanelSessionState();
}

/* =========================================================
   ②-2【今回追加】電源断・予期せぬ再読み込みからの画面復旧
   ------------------------------------------
   タッチパネル端末（テーブルに固定したタブレット等）は、Wi-Fiルーターと
   同じタップに繋いでいたり、営業終了後に電源タップごと切っていたりして、
   会計の途中で電源が落ちる／勝手に再読み込みされることがある。
   これまではtouchPanelStateがただの変数（let）だったため、再読み込み
   すると人数選択の最初の画面に戻ってしまい、お客様の注文中の内容や
   「ありがとうございました」画面の途中経過が消えてしまっていた。
   そこで、テーブルが確定した以降（＝実際に注文が始まった以降）は、
   変更のたびにこの端末のlocalStorageへスナップショットを保存し、
   ページの読み込み時にそれがあれば同じ画面・同じ注文内容へ自動的に
   復帰できるようにする。
   ------------------------------------------
   【あえてAblyでは連携しない】
   この保存内容は「今この端末が担当しているテーブルの注文の途中経過」
   であり、他のタッチパネル端末やレジ本体にリアルタイムで送る意味が
   無い（テーブルの使用中／空席という状態自体は、これまで通り
   ⑩-2のAbly連携で他端末と共有される。ここで追加するのはあくまで
   「この端末自身が電源断から復旧するための控え」）。
   その代わり、pos_ から始まるキーとしてlocalStorageに保存することで、
   backup-extra-settings-sync.js の仕組みに乗り、Google Driveへの
   バックアップ（＝googleapi経由の保存）にも自動的に含まれるようにする。
   ========================================================= */
const TOUCH_PANEL_SESSION_STATE_KEY = 'pos_touch_panel_session_state';

function persistTouchPanelSessionState() {
    // 人数選択・テーブル未確定の段階は「まだ何も始まっていない」状態の
    // ため保存しない（保存しても電源断から復旧する価値が無いため）。
    if (!touchPanelState.mode || touchPanelState.table == null) {
        clearTouchPanelSessionState();
        return;
    }
    try {
        localStorage.setItem(TOUCH_PANEL_SESSION_STATE_KEY, JSON.stringify({
            screen: touchPanelState.screen || 'menu',
            mode: touchPanelState.mode,
            partySize: touchPanelState.partySize,
            table: touchPanelState.table,
            order: touchPanelState.order,
            sentOrders: touchPanelState.sentOrders,
            activeCategory: touchPanelState.activeCategory,
            searchQuery: touchPanelState.searchQuery,
            savedAt: Date.now()
        }));
    } catch (e) {
        console.warn('タッチパネルのセッション保存に失敗しました:', e);
    }
}

function clearTouchPanelSessionState() {
    localStorage.removeItem(TOUCH_PANEL_SESSION_STATE_KEY);
}

function loadTouchPanelSessionState() {
    try {
        const raw = localStorage.getItem(TOUCH_PANEL_SESSION_STATE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return (data && data.table != null) ? data : null;
    } catch (e) {
        return null;
    }
}

// ページ読み込み時、保存されたセッションがあれば同じ画面へ自動復帰する
function resumeTouchPanelSessionIfAny() {
    if (document.getElementById('touch-panel-overlay')) return; // 既に開いている場合は何もしない
    const saved = loadTouchPanelSessionState();
    if (!saved) return;

    touchPanelState.mode = saved.mode || 'customer';
    touchPanelState.partySize = saved.partySize || null;
    touchPanelState.table = saved.table;
    touchPanelState.order = Array.isArray(saved.order) ? saved.order : [];
    touchPanelState.sentOrders = Array.isArray(saved.sentOrders) ? saved.sentOrders : [];
    touchPanelState.activeCategory = saved.activeCategory || 'all';
    touchPanelState.searchQuery = saved.searchQuery || '';
    touchPanelState.modalDraft = null;

    tpEnterFullscreen();
    applyTouchPanelTitleAndHash();

    if (saved.screen === 'checkoutThanks') {
        showTouchPanelCheckoutThanksScreen();
    } else {
        renderTouchPanelMenuScreen();
    }
}

/* =========================================================
   ③ 文字列エスケープ用の小さなヘルパー
   ------------------------------------------
   商品名・説明文・バリエーション名などは店舗が自由に入力できる
   ため、HTMLタグやクォート文字が含まれていても崩れないように
   共通のエスケープ処理を通す。
   ========================================================= */
// テキストとして表示する部分（タグ挿入を防ぐ）
function tpEsc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// onclick="...('...')" のように、HTML属性内のJS文字列として
// 埋め込む部分（バックスラッシュ・シングルクォート・ダブルクォート・
// 改行をエスケープする）
function tpAttr(str) {
    return String(str == null ? '' : str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\r?\n/g, ' ');
}

// background-image:url('...') のように、CSS文字列として
// 埋め込む部分
function tpCssStr(str) {
    return String(str == null ? '' : str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}

/* =========================================================
   ④ 共通ヘルパー
   ========================================================= */
function getProductListForTouchPanel() {
    if (typeof getProductListSafe === 'function') {
        const list = getProductListSafe();
        if (Array.isArray(list)) return list;
    }
    if (typeof products !== 'undefined' && Array.isArray(products)) return products;
    return [];
}

function tpPlaySound(name) {
    if (typeof playSound === 'function') playSound(name);
}

function tpSpeak(text) {
    if (typeof speak === 'function') speak(text);
}

function tableLabelForTouchPanel() {
    return touchPanelState.table ? `（テーブル${touchPanelState.table}）` : '';
}

function partySizeLabelForTouchPanel() {
    if (!touchPanelState.partySize) return '';
    const isMax = touchPanelState.partySize === TOUCH_PANEL_PARTY_SIZE_OPTIONS[TOUCH_PANEL_PARTY_SIZE_OPTIONS.length - 1];
    return `${touchPanelState.partySize}${isMax ? '+' : ''}名`;
}

// 既にその文字列のバーコードが自動化バーコード一覧に存在するか確認する。
// 「同じテーブルから来ても既存のバーコードを上書きしない」ことを保証するため、
// 生成したバーコードが万一衝突していたら作り直す。
function isBarcodeAlreadyRegistered(code) {
    return (typeof discountBarcodes !== 'undefined' && Array.isArray(discountBarcodes))
        ? discountBarcodes.some(d => d && d.barcode === code)
        : false;
}

function generateTouchPanelBarcode(prefix) {
    let code;
    let guard = 0;
    do {
        const rand = Math.floor(10 + Math.random() * 89); // 10〜98
        code = `${prefix}${Date.now()}${rand}`;
        guard++;
    } while (isBarcodeAlreadyRegistered(code) && guard < 5);
    return code;
}

/* =========================================================
   ⑤ 既存の「自動化バーコード作成」フォームを裏で使って登録する
   ------------------------------------------
   実際の入力手順をコードから再現することで、保存形式・他端末への同期
   （discount-sync）を既存ロジックにそのまま任せる。バーコードは毎回
   generateTouchPanelBarcode() で新規採番するため、同じテーブルから
   何度送信/呼び出しがあっても、既存の登録内容を上書きすることはない
   （常に別々の新しい行として追加登録される）。
   ========================================================= */
function registerAutomationBarcodeViaForm({ barcode, name, items, oneTime }) {
    if (typeof addDiscountBarcode !== 'function') {
        console.warn('[touch-panel] addDiscountBarcode() が見つからないため、自動化バーコードの登録をスキップしました。');
        return false;
    }

    if (typeof renderDiscounts === 'function') {
        try { renderDiscounts(); } catch (e) { /* 描画関数が無くても致命的ではない */ }
    }

    const barcodeInput = document.getElementById('new-disc-barcode');
    const nameInput = document.getElementById('new-disc-name');
    const productSelect = document.getElementById('new-disc-product-select');
    const qtyInput = document.getElementById('new-disc-product-qty');
    const oneTimeCheckbox = document.getElementById('new-disc-one-time');

    if (!barcodeInput || !nameInput) {
        console.warn('[touch-panel] 自動化バーコード登録フォームが見つかりませんでした。');
        return false;
    }

    barcodeInput.value = barcode;
    nameInput.value = name;

    (items || []).forEach(item => {
        if (!productSelect || !qtyInput || typeof addStagedProductRow !== 'function') return;
        let matched = Array.from(productSelect.options).find(opt => opt.value === String(item.jan));
        if (!matched) {
            matched = Array.from(productSelect.options).find(opt => opt.textContent.includes(item.name));
        }
        if (!matched) return;
        productSelect.value = matched.value;
        qtyInput.value = item.qty || 1;
        addStagedProductRow('new');
    });

    if (oneTimeCheckbox) oneTimeCheckbox.checked = !!oneTime;

    // 【今回追加】「🔔 店員を呼ぶ」「💰 お会計」のように商品を1つも
    // 紐付けない「通知だけ」のバーコードは、このままだと登録フォーム側の
    // 「商品追加または割引のどちらか一方以上を設定してください」という
    // バリデーションに引っかかり、その確認ダイアログが客用画面に表示
    // されてしまう。実際に割引を適用したいわけではないため、画面にも
    // レシートにもほぼ影響が出ない金額を割引欄に仮設定して、
    // バリデーションだけを満たすようにする。
    // 【不具合修正】ここを「0円引き」にしていたが、discount-system.js側の
    // チェックは value <= 0 を弾く（＝0円は「正しい値引き値」として
    // 認められない）ため、結局この確認ダイアログが表示され続けていた。
    // バリデーションを通す必要最小限の「1円引き」に変更する。
    const discUseCheckbox = document.getElementById('new-disc-use-discount');
    const discType = document.getElementById('new-disc-type');
    const discValue = document.getElementById('new-disc-value');
    const needsDummyDiscount = (!items || items.length === 0);

    if (discUseCheckbox) {
        discUseCheckbox.checked = needsDummyDiscount;
        if (typeof toggleDiscValueRow === 'function') toggleDiscValueRow('new');
    }
    if (needsDummyDiscount && discType) discType.value = 'yen';
    if (needsDummyDiscount && discValue) discValue.value = '1';

    addDiscountBarcode();
    return true;
}

/* =========================================================
   ⑥ 店員呼び出し（用件選択ポップアップ）／お会計
   ------------------------------------------
   どちらも商品を紐付けない「通知だけ」の自動化バーコードとして登録する。
   毎回新しいバーコードとして追加されるため、同じテーブルから何度押しても
   前の呼び出し／お会計の登録が上書きされることはない。
   ========================================================= */
function openTouchPanelCallMenu() {
    tpPlaySound('click');
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-call-menu-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-call-menu-root';
        overlay.appendChild(root);
    }
    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelCallMenu()"></div>
        <div class="tp-call-menu-box tp-pop">
            <div class="tp-call-menu-title">ご用件をお選びください</div>
            <div class="tp-call-menu-grid">
                ${TOUCH_PANEL_CALL_REASONS.map(r => `
                    <button onclick="sendTouchPanelCallRequest('${tpAttr(r.key)}')">
                        <span class="tp-call-icon">${r.icon}</span>
                        <span>${tpEsc(r.label)}</span>
                    </button>
                `).join('')}
            </div>
            <button class="tp-btn tp-cancel" style="width:100%;" onclick="closeTouchPanelCallMenu()">閉じる</button>
        </div>
    `;
}

function closeTouchPanelCallMenu() {
    const root = document.getElementById('tp-call-menu-root');
    if (root) root.remove();
}

function sendTouchPanelCallRequest(reasonKey) {
    const reason = TOUCH_PANEL_CALL_REASONS.find(r => r.key === reasonKey) || TOUCH_PANEL_CALL_REASONS[0];
    tpPlaySound('click');
    closeTouchPanelCallMenu();

    const barcode = generateTouchPanelBarcode('CALL');
    const ok = registerAutomationBarcodeViaForm({
        barcode,
        name: `${reason.icon} ${reason.label}です${tableLabelForTouchPanel()}`,
        items: [],
        oneTime: false
    });

    if (ok) {
        tpSpeak(reason.voice);
        if (typeof fireDesktopNotification === 'function') {
            fireDesktopNotification(reason.notifyTitle, `タッチパネル${tableLabelForTouchPanel()}${reason.notifyBodySuffix}`);
        }
        showTouchPanelToast(`${reason.icon} ${reason.label}を送信しました`);
    } else {
        showTouchPanelToast('⚠️ 送信に失敗しました');
    }
}

// 【今回追加】このテーブルでこれまでに送信した注文＋まだ送信していない
// カートの中身を合算した、現時点での合計金額。お会計確認ダイアログに
// 表示するために使う。
function touchPanelGrandTotalSoFar() {
    const sentTotal = (touchPanelState.sentOrders || []).reduce((s, o) => s + o.total, 0);
    const cartTotal = (touchPanelState.order || []).reduce((s, i) => s + i.price * i.qty, 0);
    return sentTotal + cartTotal;
}

// 【今回追加】「💰 お会計」は押した瞬間に注文操作ができない画面へ
// 切り替わり、後から前の画面（メニュー等）へは戻れなくなる（＝店員が
// 長押しでリセットするまで通常操作を受け付けない）重要な操作のため、
// 誤タップ対策として実行前に確認ダイアログを挟む。あわせて、お客様が
// 納得したうえで進められるよう、現時点の合計金額も表示する。
function requestCheckoutFromTouchPanel() {
    tpPlaySound('click');
    openTouchPanelCheckoutConfirm();
}

function openTouchPanelCheckoutConfirm() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-checkout-confirm-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-checkout-confirm-root';
        overlay.appendChild(root);
    }
    const total = touchPanelGrandTotalSoFar();
    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelCheckoutConfirm()"></div>
        <div class="tp-pin-modal tp-pop">
            <div class="tp-pin-title">💰 お会計をしますか？</div>
            <div class="tp-checkout-confirm-total">合計金額　¥${total.toLocaleString()}</div>
            <div class="tp-kiosk-warning">※この後は前の画面には戻れなくなります</div>
            <div style="display:flex; gap:10px; margin-top:16px;">
                <button class="tp-btn tp-cancel" style="flex:1;" onclick="closeTouchPanelCheckoutConfirm()">いいえ</button>
                <button class="tp-btn tp-confirm" style="flex:1; background:var(--tp-accent-2);" onclick="confirmTouchPanelCheckout()">はい、お会計する</button>
            </div>
        </div>
    `;
}

function closeTouchPanelCheckoutConfirm() {
    const root = document.getElementById('tp-checkout-confirm-root');
    if (root) root.remove();
}

function confirmTouchPanelCheckout() {
    tpPlaySound('click');
    closeTouchPanelCheckoutConfirm();
    executeTouchPanelCheckoutRequest();
}

// 確認ダイアログで「はい」を選んだ後に実行される、実際のお会計希望送信処理
// （これまでrequestCheckoutFromTouchPanel()が直接行っていた内容そのもの）
function executeTouchPanelCheckoutRequest() {
    const barcode = generateTouchPanelBarcode('BILL');
    const ok = registerAutomationBarcodeViaForm({
        barcode,
        name: `💰 お会計希望です${tableLabelForTouchPanel()}`,
        items: [],
        oneTime: false
    });

    if (ok) {
        tpSpeak('おかいけい きぼう です');
        if (typeof fireDesktopNotification === 'function') {
            fireDesktopNotification('💰 お会計希望', `タッチパネル${tableLabelForTouchPanel()}からお会計の希望です`);
        }
        showTouchPanelCheckoutThanksScreen();
    } else {
        showTouchPanelToast('⚠️ 送信に失敗しました');
    }
}

/* =========================================================
   【今回追加】お会計後の「ありがとうございました」画面
   ------------------------------------------
   お会計希望を送信した後、お客様がレジへ向かう間にお子様や次のお客様が
   誤ってメニューを操作してしまわないよう、注文操作を封じた案内画面に
   切り替える。画面のどこでもよいので5秒間長押しすると（会計後に
   店員がテーブルを片付ける際の操作）、このテーブルの注文内容を
   すべて消して最初の「何名様ですか？」画面に戻る。
   ========================================================= */
const TOUCH_PANEL_CHECKOUT_RESET_LONGPRESS_MS = 5000;

function showTouchPanelCheckoutThanksScreen() {
    touchPanelState.screen = 'checkoutThanks';
    const overlay = getOrCreateTouchPanelOverlay();
    overlay.classList.remove('tp-theme-menu');
    overlay.innerHTML = `
        <div class="tp-topbar">
            <span class="tp-topbar-title">🍽️ ${tableLabelForTouchPanel()}</span>
        </div>
        <div class="tp-body tp-fade-in tp-checkout-thanks-area" id="tp-checkout-thanks-area" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; text-align:center;">
            <div class="tp-complete-check">✅</div>
            <div class="tp-complete-text">ありがとうございました</div>
            <div class="tp-complete-sub">レジにお進みください</div>
            <div class="tp-table-occupied-badge">テーブル使用中です</div>
        </div>
    `;
    applyTouchPanelBackground();
    attachTouchPanelLongPress(
        document.getElementById('tp-checkout-thanks-area'),
        TOUCH_PANEL_CHECKOUT_RESET_LONGPRESS_MS,
        resetTouchPanelAfterCheckout
    );
    persistTouchPanelSessionState();
}

// 【今回改訂】このタッチパネル端末は物理的に特定のテーブルに固定されて
// いるため、お会計が終わって次のお客様を迎える際に、わざわざ同じ
// テーブル番号をもう一度選び直させる必要が無い（＝そのテーブルの
// 端末は次も必ず同じテーブルの注文にしかならない）。
// これまでは resetTouchPanelState() でテーブル番号ごと空にしたうえで
// 最初の「テーブルを選んでください」画面（今は人数選択の前段）に
// 戻していたが、これだと毎回テーブル選択からやり直しになってしまう
// うえ、テーブル番号が一瞬 null になる間だけ画面表示が
// 「テーブルnull」になってしまう不具合もあった。
// 今回は、テーブル番号だけは引き継いだうえで、人数選択画面へ
// 直接進むようにする（＝一旦「空席」に戻してから、同じ番号で
// 即座に「使用中」に戻す）。
function resetTouchPanelAfterCheckout() {
    tpPlaySound('click');
    const table = touchPanelState.table;
    const mode = touchPanelState.mode;

    if (mode !== 'staff') {
        releaseTouchPanelTable(table);
    }
    resetTouchPanelState();

    touchPanelState.mode = mode === 'staff' ? 'staff' : 'customer';
    touchPanelState.table = table;

    if (touchPanelState.mode !== 'staff' && table != null) {
        markTouchPanelTableOccupied(table);
    }

    renderTouchPanelPartySizeScreen();
}

/* =========================================================
   ⑥-2【今回の不具合修正】「写真を設定したのに、別のタッチパネル端末
   （テーブルごとのタブレット等）では表示されない」問題への対応
   ------------------------------------------
   【原因】
   背景・商品ごとの写真／説明文／おすすめ設定は、すべて設定した
   その端末のlocalStorageにしか保存されておらず、他端末へは
   Google Driveへの手動／定期バックアップ（backup-extra-settings-sync.js）
   を経由してでしか伝わらない。つまり、店員がある1台の端末（レジ本体や
   特定のテーブルの端末）で写真を登録しても、他のタッチパネル端末には
   バックアップ→復元が行われるまで一切反映されず、「せっかく設定した
   のに他の端末では写真が出ない（プレースホルダーの🍽️のまま）」という
   状態になっていた。複数端末をAblyでリアルタイム同期している構成
   （faq-help-system.jsで案内している構成）でも、この設定項目だけは
   同期対象に入っていなかったための不具合。
   【対応】
   order-checkout-display.js 等と同じ方式で、utils.jsのinitAbly()が
   作るグローバル変数 channel を使い、設定を変更するたびに他端末へ
   publishし、他端末側はsubscribeして即座にlocalStorageへ反映＋
   表示中の画面があればその場で再描画する。Ablyが未設定・未接続の
   環境では何も起きず、これまで通りその端末単独で動作する
   （＝この修正によって単一端末構成が壊れることはない）。
   ========================================================= */
function broadcastTouchPanelMenuSettingEvent(payload) {
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('touch-panel-menu-setting-event', Object.assign({
                senderId: (typeof POS_DEVICE_ID !== 'undefined') ? POS_DEVICE_ID : null
            }, payload));
        } catch (e) { /* Ably未接続時等は無視して良い（localStorageへの保存自体は完了しているため） */ }
    }
}

function tpBackupNowSafe() {
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
}

// 他端末から届いた変更を、この端末のlocalStorageへも反映し、
// 表示中の画面があればその場で再描画する
(function hookAblyForTouchPanelMenuSettings() {
    function tryHook() {
        if (typeof channel === 'undefined' || !channel) {
            setTimeout(tryHook, 500);
            return;
        }
        channel.subscribe('touch-panel-menu-setting-event', (message) => {
            const data = message.data || {};
            try {
                switch (data.action) {
                    case 'set-img':
                        if (data.jan != null) localStorage.setItem(TOUCH_PANEL_IMG_STORAGE_PREFIX + tpNormalizeJan(data.jan), data.value || '');
                        break;
                    case 'clear-img':
                        if (data.jan != null) localStorage.removeItem(TOUCH_PANEL_IMG_STORAGE_PREFIX + tpNormalizeJan(data.jan));
                        break;
                    case 'set-desc':
                        if (data.jan != null) localStorage.setItem(TOUCH_PANEL_DESC_STORAGE_PREFIX + data.jan, data.value || '');
                        break;
                    case 'clear-desc':
                        if (data.jan != null) localStorage.removeItem(TOUCH_PANEL_DESC_STORAGE_PREFIX + data.jan);
                        break;
                    case 'set-bg':
                        localStorage.setItem(TOUCH_PANEL_BG_STORAGE_KEY, data.value || '');
                        break;
                    case 'clear-bg':
                        localStorage.removeItem(TOUCH_PANEL_BG_STORAGE_KEY);
                        break;
                    case 'set-reco':
                        localStorage.setItem(TOUCH_PANEL_RECO_STORAGE_KEY, JSON.stringify(Array.isArray(data.recoJans) ? data.recoJans : []));
                        break;
                    case 'set-variations':
                        if (data.jan != null) localStorage.setItem(TOUCH_PANEL_VARIATIONS_STORAGE_PREFIX + data.jan, JSON.stringify(Array.isArray(data.list) ? data.list : []));
                        break;
                    case 'clear-variations':
                        if (data.jan != null) localStorage.removeItem(TOUCH_PANEL_VARIATIONS_STORAGE_PREFIX + data.jan);
                        break;
                    case 'set-promo':
                        if (data.value) {
                            localStorage.setItem(TOUCH_PANEL_PROMO_TEXT_KEY, data.value);
                        } else {
                            localStorage.removeItem(TOUCH_PANEL_PROMO_TEXT_KEY);
                        }
                        break;
                    default:
                        return;
                }
            } catch (e) {
                console.warn('タッチパネル設定の同期反映に失敗しました:', e);
                return;
            }

            // 今まさに表示している画面があれば、その場で反映する
            applyTouchPanelBackground();
            refreshTouchPanelMenuGridAndRail();
            refreshTouchPanelItemModal();
            refreshTouchPanelPromoBannerIfVisible();
            if (document.getElementById('tp-bg-setting-root')) {
                renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue());
            }
        });
    }
    tryHook();
})();

/* =========================================================
   ⑦ 画像・説明文・おすすめ設定（背景／商品ごと）
   ------------------------------------------
   アップロード保存の仕組みが無いため、画像はURL指定方式。
   説明文・おすすめフラグも同様に、店員用モードから設定した内容を
   localStorageに保存し、次回以降も引き継ぐ。
   ========================================================= */
function getTouchPanelBgUrl() {
    return localStorage.getItem(TOUCH_PANEL_BG_STORAGE_KEY) || '';
}

// 【今回変更】画像URLの手入力(prompt)ではなく、端末内の画像ファイルを
// アップロードして設定できるようにする。選んだ画像はキャンバスで縮小
// 圧縮してからBase64(data URL)としてlocalStorageに保存する
// （元のURL指定方式と保存先・使い方は変わらないため、背景・写真を
// 表示している既存コードは変更不要）。
function tpReadImageFileAsDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) {
            reject(new Error('画像ファイルを選んでください'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('読み込みに失敗しました'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
            img.onload = () => {
                let width = img.naturalWidth || img.width;
                let height = img.naturalHeight || img.height;
                if (width > maxDim || height > maxDim) {
                    const scale = maxDim / Math.max(width, height);
                    width = Math.max(1, Math.round(width * scale));
                    height = Math.max(1, Math.round(height * scale));
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function tpNotifyImageUploadError() {
    tpPlaySound('error');
    const msg = '画像の読み込みに失敗しました。別の画像でお試しください。';
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(msg, 'がぞう の よみこみ に しっぱい し まし た。', () => {}, false);
    } else {
        // 【不具合対策】showCustomConfirmが未定義の場合でも、失敗が
        // サイレントに握りつぶされないよう必ずalertでも知らせる
        alert(msg);
    }
}

/* =========================================================
   【今回の不具合修正】「写真のURLを指定して保存したのに、実際の
   メニュー画面には写真が表示されない」問題への対応
   ------------------------------------------
   【原因】
   これまで、画像URL指定（🔗 URLで設定）は入力された文字列を
   トリムするだけでそのままlocalStorageに保存しており、その
   URLが実際にブラウザで画像として読み込めるかどうかは一切
   確認していなかった。そのため、
   　・URLの入力ミス／リンク切れ（404等）
   　・他サイトの画像を直接リンクした際のホットリンク拒否（403等）
   　・httpsのページからhttpの画像を読み込もうとして
   　  ブラウザにブロックされる（混在コンテンツ）
   といったケースでも「保存」自体は成功したように見えてしまい、
   後からメニュー画面を見て初めて「写真が出ていない」と気づく
   　　→ しかも見た目は単なる空欄になるだけで、エラーは一切
   　　　表示されないため原因が分かりにくい、という不具合だった。
   【対応】
   保存する前に一度、実際にその場でImageオブジェクトを使って
   読み込みを試す。読み込めた場合のみ保存・反映し、読み込めな
   かった場合はその場で「このURLは読み込めませんでした」という
   エラーを表示して保存自体を行わない（＝ミスにすぐ気づける）
   ようにする。data:URL（端末アップロード分）等、判定に時間が
   かかりすぎるケースに備えて、一定時間で応答が無ければ保存を
   通すタイムアウトも設けている。
   ========================================================= */
function tpVerifyImageUrlLoads(url, callback) {
    let done = false;
    const finish = (ok) => {
        if (done) return;
        done = true;
        callback(ok);
    };
    try {
        const testImg = new Image();
        testImg.onload = () => finish(true);
        testImg.onerror = () => finish(false);
        testImg.src = url;
    } catch (e) {
        finish(false);
        return;
    }
    // 判定が長時間返ってこない場合は、確認自体を諦めて保存は通す
    // （誤ってブロックしてしまう方が影響が大きいため）
    setTimeout(() => finish(true), 4000);
}

// 【不具合対策】保存時と表示時でJANコードの型・前後の空白が万一ずれていても
// 同じキーで読み書きされるよう、必ず文字列化＋trimしてから使う
function tpNormalizeJan(jan) {
    return String(jan == null ? '' : jan).trim();
}

// 背景画像を直接アップロードして設定する（人数選択画面の店員用メニュー・
// メニュー画面の「🖼️ 背景設定」ボタンから呼ばれる）
function openTouchPanelBgSettingPrompt() {
    tpPlaySound('click');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            const dataUrl = await tpReadImageFileAsDataUrl(file, 1600, 0.82);
            localStorage.setItem(TOUCH_PANEL_BG_STORAGE_KEY, dataUrl);
            applyTouchPanelBackground();
            broadcastTouchPanelMenuSettingEvent({ action: 'set-bg', value: dataUrl });
            tpBackupNowSafe();
            tpPlaySound('success');
        } catch (e) {
            tpNotifyImageUploadError();
        }
    };
    input.click();
}

/* =========================================================
   ⑦-2【今回追加】店員用モード・背景設定への入口（暗証番号）
   ------------------------------------------
   以前は「🖼️ 背景設定」「🧑‍💼 店員用」がお客様にも見えるボタンとして
   置かれていたため、廃止した。代わりに、人数選択画面のごく目立たない
   場所（ラベルも無い小さなバッジ）を長押しすると暗証番号の入力画面が
   出て、正しく入力した場合のみ「背景設定」「店員用として進む」を選べる
   小さなメニューが表示される。暗証番号は客用画面の脱出防止（キオスク
   ロック）と同じ TOUCH_PANEL_KIOSK_PIN を使い回している（どちらも
   「店員であることの確認」という同じ意味合いのため）。
   ========================================================= */
function setupTouchPanelStaffEntryBadge() {
    const badge = document.getElementById('tp-staff-entry-badge');
    attachTouchPanelLongPress(badge, TOUCH_PANEL_KIOSK_LONGPRESS_MS, openTouchPanelStaffEntryPinModal);
}

let touchPanelStaffPinInput = '';

function openTouchPanelStaffEntryPinModal() {
    tpPlaySound('click');
    touchPanelStaffPinInput = '';
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-staff-pin-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-staff-pin-root';
        overlay.appendChild(root);
    }
    renderTouchPanelStaffEntryPinModal(false);
}

function closeTouchPanelStaffEntryPinModal() {
    const root = document.getElementById('tp-staff-pin-root');
    if (root) root.remove();
    touchPanelStaffPinInput = '';
}

function renderTouchPanelStaffEntryPinModal(shake) {
    const root = document.getElementById('tp-staff-pin-root');
    if (!root) return;

    const dotsHtml = [0, 1, 2, 3].map(i => `<span class="tp-pin-dot ${i < touchPanelStaffPinInput.length ? 'filled' : ''}"></span>`).join('');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    const keysHtml = keys.map(k => {
        if (k === '') return '<span></span>';
        if (k === '⌫') return `<button onclick="pressTouchPanelStaffPinBackspace()" aria-label="1文字削除">⌫</button>`;
        return `<button onclick="pressTouchPanelStaffPinDigit('${k}')">${k}</button>`;
    }).join('');

    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelStaffEntryPinModal()"></div>
        <div class="tp-pin-modal tp-pop ${shake ? 'tp-shake' : ''}">
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeTouchPanelStaffEntryPinModal()">×</button>
            <div class="tp-pin-title">🔒 店員確認</div>
            <div class="tp-pin-sub">暗証番号を入力してください</div>
            <div class="tp-pin-dots">${dotsHtml}</div>
            <div class="tp-pin-keypad">${keysHtml}</div>
        </div>
    `;
}

function pressTouchPanelStaffPinDigit(d) {
    if (touchPanelStaffPinInput.length >= 4) return;
    tpPlaySound('click');
    touchPanelStaffPinInput += d;
    renderTouchPanelStaffEntryPinModal(false);
    if (touchPanelStaffPinInput.length === 4) {
        setTimeout(checkTouchPanelStaffPin, 150);
    }
}

function pressTouchPanelStaffPinBackspace() {
    tpPlaySound('click');
    touchPanelStaffPinInput = touchPanelStaffPinInput.slice(0, -1);
    renderTouchPanelStaffEntryPinModal(false);
}

function checkTouchPanelStaffPin() {
    if (!document.getElementById('tp-staff-pin-root')) return;
    if (touchPanelStaffPinInput === TOUCH_PANEL_KIOSK_PIN) {
        closeTouchPanelStaffEntryPinModal();
        openTouchPanelStaffActionSheet();
    } else {
        tpPlaySound('error');
        renderTouchPanelStaffEntryPinModal(true);
        setTimeout(() => {
            touchPanelStaffPinInput = '';
            renderTouchPanelStaffEntryPinModal(false);
        }, 500);
    }
}

// 暗証番号が正しかった後に出す、店員向けの小さな選択メニュー。
function openTouchPanelStaffActionSheet() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-staff-action-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-staff-action-root';
        overlay.appendChild(root);
    }
    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelStaffActionSheet()"></div>
        <div class="tp-pin-modal tp-pop">
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeTouchPanelStaffActionSheet()">×</button>
            <div class="tp-pin-title">🧑‍💼 店員用メニュー</div>
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:6px;">
                <button class="tp-btn tp-primary" style="width:100%;" onclick="closeTouchPanelStaffActionSheet(); openTouchPanelBgSettingPrompt();">🖼️ 背景設定（画像を選択）</button>
                <button class="tp-btn tp-primary" style="width:100%;" onclick="closeTouchPanelStaffActionSheet(); promptTouchPanelBgUrlQuick();">🔗 背景設定（URLで指定）</button>
                <button class="tp-btn tp-confirm" style="width:100%;" onclick="closeTouchPanelStaffActionSheet(); selectTouchPanelMode('staff');">🧑‍💼 店員用として進む</button>
            </div>
        </div>
    `;
}

function closeTouchPanelStaffActionSheet() {
    const root = document.getElementById('tp-staff-action-root');
    if (root) root.remove();
}

// 背景画像は「人数選択・客用/店員用・テーブル選択」のスタンバイ画面
// にのみ適用する（メニュー画面は写真中心のグリッドを見やすくするため、
// 明るい専用テーマで表示するので背景画像は敷かない）。
function applyTouchPanelBackground() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    const url = getTouchPanelBgUrl();
    if (url && !overlay.classList.contains('tp-theme-menu')) {
        overlay.style.backgroundImage = `linear-gradient(rgba(10,22,38,0.6), rgba(10,22,38,0.6)), url('${tpCssStr(url)}')`;
        overlay.style.backgroundSize = 'cover';
        overlay.style.backgroundPosition = 'center';
    } else {
        overlay.style.backgroundImage = '';
    }
}

function getTouchPanelProductImg(jan) {
    return localStorage.getItem(TOUCH_PANEL_IMG_STORAGE_PREFIX + tpNormalizeJan(jan)) || '';
}

/* =========================================================
   【今回追加】「🖼️ メニュー変更」画面
   ------------------------------------------
   客用モード中の脱出防止バッジ→暗証番号→「メニュー変更」を選んだ場合に
   出す画面。背景画像と、商品ごとの写真をまとめてアップロード設定できる。
   ========================================================= */
function openTouchPanelBgSettingModal() {
    tpPlaySound('click');
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-bg-setting-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-bg-setting-root';
        overlay.appendChild(root);
    }
    renderTouchPanelBgSettingModal('');
}

function closeTouchPanelBgSettingModal() {
    const root = document.getElementById('tp-bg-setting-root');
    if (root) root.remove();

    // 【不具合修正】背景・商品写真をアップロードしても、モーダルの裏側にある
    // お客様用メニュー画面は再描画されず古いまま表示され続けていたため、
    // 「メニュー変更」画面を閉じたタイミングでメニュー画面が表示中であれば
    // 再描画して、変更した写真をすぐに反映させる。
    const overlay = document.getElementById('touch-panel-overlay');
    if (overlay && overlay.classList.contains('tp-theme-menu')) {
        renderTouchPanelMenuScreen();
    }
}

function renderTouchPanelBgSettingModal(productFilter) {
    const root = document.getElementById('tp-bg-setting-root');
    if (!root) return;

    const bgUrl = getTouchPanelBgUrl();
    const q = (productFilter || '').trim();
    const list = getProductListForTouchPanel();
    const filtered = q
        ? list.filter(p => (p.name || '').indexOf(q) !== -1 || String(p.jan || '').indexOf(q) !== -1)
        : list;
    const shown = filtered.slice(0, 30);

    const rowsHtml = shown.map(p => {
        const img = getTouchPanelProductImg(p.jan);
        return `
            <div style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #eee;">
                <div style="width:40px; height:40px; border-radius:6px; overflow:hidden; background:#f0f0f0; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:18px;">
                    ${img ? `<img src="${tpAttr(img)}" style="width:100%; height:100%; object-fit:cover;">` : '🍽️'}
                </div>
                <div style="flex:1; min-width:0; font-size:13px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${tpAttr(p.name || '')}</div>
                <label class="tp-btn tp-primary" style="padding:6px 10px; font-size:11px; cursor:pointer; white-space:nowrap;">
                    📷 選択
                    <input type="file" accept="image/*" style="display:none;" onchange="handleTouchPanelProductImgFile(this, '${tpAttr(p.jan)}')">
                </label>
                <button class="tp-btn tp-confirm" style="padding:6px 10px; font-size:11px; white-space:nowrap;" onclick="promptTouchPanelProductImgUrlFromModal('${tpAttr(p.jan)}', '${tpAttr(p.name || '')}')">🔗 URL</button>
                ${img ? `<button class="tp-btn tp-cancel" style="padding:6px 10px; font-size:11px; white-space:nowrap;" onclick="clearTouchPanelProductImg('${tpAttr(p.jan)}')">削除</button>` : ''}
            </div>`;
    }).join('') || '<p style="text-align:center; color:#999; font-size:13px; padding:16px 0;">該当する商品がありません。</p>';

    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelBgSettingModal()"></div>
        <div class="tp-pin-modal tp-pop" style="width:min(480px, 92vw); max-height:82vh; overflow-y:auto; text-align:left;">
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeTouchPanelBgSettingModal()">×</button>
            <div class="tp-pin-title">🖼️ メニュー変更</div>
            <div class="tp-pin-sub" style="margin-bottom:12px;">背景・商品写真を画像アップロードで設定できます</div>

            <div style="margin-bottom:18px;">
                <div style="font-weight:bold; font-size:13px; margin-bottom:6px;">📣 お知らせ・キャンペーン文言（メニュー上部に表示）</div>
                <div style="display:flex; gap:8px;">
                    <input type="text" id="tp-promo-text-input" value="${tpAttr(getTouchPanelPromoText())}" placeholder="例）ドリンクバー100円引き実施中！"
                        style="flex:1; min-width:0; box-sizing:border-box; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:13px;">
                    <button class="tp-btn tp-primary" style="padding:8px 14px; font-size:12px; white-space:nowrap;" onclick="saveTouchPanelPromoTextFromModal()">保存</button>
                    ${getTouchPanelPromoText() ? `<button class="tp-btn tp-cancel" style="padding:8px 14px; font-size:12px; white-space:nowrap;" onclick="clearTouchPanelPromoText()">解除</button>` : ''}
                </div>
            </div>

            <div style="margin-bottom:18px;">
                <div style="font-weight:bold; font-size:13px; margin-bottom:6px;">タッチパネルの背景</div>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <div style="width:64px; height:44px; border-radius:6px; overflow:hidden; background:#f0f0f0; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:11px; color:#999;">
                        ${bgUrl ? `<img src="${tpAttr(bgUrl)}" style="width:100%; height:100%; object-fit:cover;">` : 'なし'}
                    </div>
                    <label class="tp-btn tp-primary" style="padding:6px 12px; font-size:12px; cursor:pointer;">
                        📷 画像を選択
                        <input type="file" accept="image/*" style="display:none;" onchange="handleTouchPanelBgFile(this)">
                    </label>
                    ${bgUrl ? `<button class="tp-btn tp-cancel" style="padding:6px 12px; font-size:12px;" onclick="clearTouchPanelBg()">解除</button>` : ''}
                </div>
                <div style="display:flex; gap:8px;">
                    <input type="text" id="tp-bg-url-input" placeholder="または画像のURLを入力（https://...）"
                        style="flex:1; min-width:0; box-sizing:border-box; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:13px;">
                    <button class="tp-btn tp-confirm" style="padding:8px 14px; font-size:12px; white-space:nowrap;" onclick="handleTouchPanelBgUrlSubmit()">🔗 URLで設定</button>
                </div>
            </div>

            <div>
                <div style="font-weight:bold; font-size:13px; margin-bottom:6px;">商品ごとの写真</div>
                <input type="text" placeholder="商品名で絞り込み" value="${tpAttr(q)}"
                    oninput="renderTouchPanelBgSettingModal(this.value)"
                    style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:14px; margin-bottom:4px;">
                <div>${rowsHtml}</div>
            </div>
        </div>
    `;
}

function tpCurrentBgSettingFilterValue() {
    const input = document.querySelector('#tp-bg-setting-root input[type="text"]');
    return input ? input.value : '';
}

async function handleTouchPanelBgFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
        const dataUrl = await tpReadImageFileAsDataUrl(file, 1600, 0.82);
        localStorage.setItem(TOUCH_PANEL_BG_STORAGE_KEY, dataUrl);
        applyTouchPanelBackground();
        broadcastTouchPanelMenuSettingEvent({ action: 'set-bg', value: dataUrl });
        tpBackupNowSafe();
        renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue());
        tpPlaySound('success');
    } catch (e) {
        tpNotifyImageUploadError();
    }
}

function clearTouchPanelBg() {
    localStorage.removeItem(TOUCH_PANEL_BG_STORAGE_KEY);
    applyTouchPanelBackground();
    broadcastTouchPanelMenuSettingEvent({ action: 'clear-bg' });
    tpBackupNowSafe();
    renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue());
    tpPlaySound('click');
}

/* =========================================================
   【今回追加】背景・商品写真を、画像アップロードだけでなく
   「画像のURL（アドレス）」を直接指定して設定できるようにする。
   ネット上にすでに公開されている画像や、他サービスの画像URLを
   そのまま使いたい場合に、いちいち端末にダウンロードしてから
   アップロードし直さなくて済むようにするための機能。
   保存後の扱い（表示・他端末へのAbly連携・Google Driveバックアップ等）は、
   画像アップロード時とまったく同じ処理を共有する（TOUCH_PANEL_BG_STORAGE_KEY /
   TOUCH_PANEL_IMG_STORAGE_PREFIX に、data:URLの代わりに通常のURL文字列が
   入るだけで、以降の表示側（<img src>やbackground-image）はどちらでも
   同じように扱えるため、表示部分の変更は不要）。
   ========================================================= */
function applyTouchPanelBgUrl(url, onDone) {
    const trimmed = (url || '').trim();
    if (!trimmed) {
        tpPlaySound('error');
        showTouchPanelToast('⚠️ 画像のURLを入力してください');
        if (typeof onDone === 'function') onDone(false);
        return;
    }
    tpVerifyImageUrlLoads(trimmed, (ok) => {
        if (!ok) {
            tpPlaySound('error');
            showTouchPanelToast('⚠️ この画像URLは読み込めませんでした。URLをご確認ください');
            if (typeof onDone === 'function') onDone(false);
            return;
        }
        localStorage.setItem(TOUCH_PANEL_BG_STORAGE_KEY, trimmed);
        applyTouchPanelBackground();
        broadcastTouchPanelMenuSettingEvent({ action: 'set-bg', value: trimmed });
        tpBackupNowSafe();
        tpPlaySound('success');
        if (typeof onDone === 'function') onDone(true);
    });
}

// 「メニュー変更」画面のURL入力欄から設定する
function handleTouchPanelBgUrlSubmit() {
    const input = document.getElementById('tp-bg-url-input');
    const url = input ? input.value : '';
    applyTouchPanelBgUrl(url, () => renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue()));
}

// 人数選択画面の「店員用メニュー」（メニュー変更画面を開かない簡易入口）から、
// URLで背景を設定したい場合に呼ばれる
function promptTouchPanelBgUrlQuick() {
    tpPlaySound('click');
    const url = window.prompt('背景に設定する画像のURLを入力してください', getTouchPanelBgUrl() || 'https://');
    if (url === null) return; // キャンセル
    applyTouchPanelBgUrl(url);
}

async function handleTouchPanelProductImgFile(input, jan) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
        const dataUrl = await tpReadImageFileAsDataUrl(file, 900, 0.8);
        const normalizedJan = tpNormalizeJan(jan);
        localStorage.setItem(TOUCH_PANEL_IMG_STORAGE_PREFIX + normalizedJan, dataUrl);
        broadcastTouchPanelMenuSettingEvent({ action: 'set-img', jan: normalizedJan, value: dataUrl });
        tpBackupNowSafe();
        refreshTouchPanelItemModal();
        refreshTouchPanelMenuGridAndRail();
        renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue());
        tpPlaySound('success');
    } catch (e) {
        tpNotifyImageUploadError();
    }
}

function clearTouchPanelProductImg(jan) {
    const normalizedJan = tpNormalizeJan(jan);
    localStorage.removeItem(TOUCH_PANEL_IMG_STORAGE_PREFIX + normalizedJan);
    broadcastTouchPanelMenuSettingEvent({ action: 'clear-img', jan: normalizedJan });
    tpBackupNowSafe();
    refreshTouchPanelItemModal();
    refreshTouchPanelMenuGridAndRail();
    renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue());
    tpPlaySound('click');
}

function setTouchPanelProductImgPrompt(jan, name) {
    tpPlaySound('click');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            const dataUrl = await tpReadImageFileAsDataUrl(file, 900, 0.8);
            const normalizedJan = tpNormalizeJan(jan);
            localStorage.setItem(TOUCH_PANEL_IMG_STORAGE_PREFIX + normalizedJan, dataUrl);
            broadcastTouchPanelMenuSettingEvent({ action: 'set-img', jan: normalizedJan, value: dataUrl });
            tpBackupNowSafe();
            refreshTouchPanelItemModal();
            refreshTouchPanelMenuGridAndRail();
            tpPlaySound('success');
        } catch (e) {
            tpNotifyImageUploadError();
        }
    };
    input.click();
}

// 商品写真も、背景と同じくURL指定で設定できるようにする共通処理
function applyTouchPanelProductImgUrl(jan, url, onDone) {
    const trimmed = (url || '').trim();
    if (!trimmed) {
        tpPlaySound('error');
        showTouchPanelToast('⚠️ 画像のURLを入力してください');
        if (typeof onDone === 'function') onDone(false);
        return;
    }
    tpVerifyImageUrlLoads(trimmed, (ok) => {
        if (!ok) {
            tpPlaySound('error');
            showTouchPanelToast('⚠️ この画像URLは読み込めませんでした。URLをご確認ください');
            if (typeof onDone === 'function') onDone(false);
            return;
        }
        const normalizedJan = tpNormalizeJan(jan);
        localStorage.setItem(TOUCH_PANEL_IMG_STORAGE_PREFIX + normalizedJan, trimmed);
        broadcastTouchPanelMenuSettingEvent({ action: 'set-img', jan: normalizedJan, value: trimmed });
        tpBackupNowSafe();
        refreshTouchPanelItemModal();
        refreshTouchPanelMenuGridAndRail();
        tpPlaySound('success');
        if (typeof onDone === 'function') onDone(true);
    });
}

// 「メニュー変更」画面の商品一覧、各行の「🔗 URL」ボタンから呼ばれる
function promptTouchPanelProductImgUrlFromModal(jan, name) {
    const current = getTouchPanelProductImg(jan);
    const url = window.prompt(`「${name}」の写真に設定する画像のURLを入力してください`, current && !current.startsWith('data:') ? current : 'https://');
    if (url === null) return; // キャンセル
    applyTouchPanelProductImgUrl(jan, url, () => renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue()));
}

// 商品詳細ポップアップ（店員用モード）の「🖼️ 写真を設定」の横から、
// URLで設定したい場合に呼ばれる
function setTouchPanelProductImgUrlPrompt(jan, name) {
    tpPlaySound('click');
    const current = getTouchPanelProductImg(jan);
    const url = window.prompt(`「${name}」の写真に設定する画像のURLを入力してください`, current && !current.startsWith('data:') ? current : 'https://');
    if (url === null) return; // キャンセル
    applyTouchPanelProductImgUrl(jan, url);
}

// 【今回追加】バリエーション（サイズ・種類など）の取得。
// 店員が設定した内容（localStorage）があればそれを優先し、無ければ
// このファイル冒頭の固定リスト（TOUCH_PANEL_PRODUCT_VARIATIONS）を
// フォールバックとして使う。どちらにも無ければ undefined（＝
// バリエーション選択ポップアップ自体を出さない）。
function getTouchPanelVariations(jan) {
    const raw = localStorage.getItem(TOUCH_PANEL_VARIATIONS_STORAGE_PREFIX + jan);
    if (raw !== null) {
        try {
            const arr = JSON.parse(raw);
            return (Array.isArray(arr) && arr.length > 0) ? arr : undefined;
        } catch (e) {
            return undefined;
        }
    }
    return TOUCH_PANEL_PRODUCT_VARIATIONS[jan];
}

function setTouchPanelVariationsPrompt(jan, name) {
    const current = getTouchPanelVariations(jan) || [];
    const text = window.prompt(`「${name}」のバリエーション（サイズ・種類など）を、カンマ区切りで入力してください（例：ホット,アイス）。空欄で解除します。`, current.join(','));
    if (text === null) return;
    const list = text.split(',').map(s => s.trim()).filter(s => s);
    if (list.length > 0) {
        localStorage.setItem(TOUCH_PANEL_VARIATIONS_STORAGE_PREFIX + jan, JSON.stringify(list));
        broadcastTouchPanelMenuSettingEvent({ action: 'set-variations', jan, list });
    } else {
        localStorage.removeItem(TOUCH_PANEL_VARIATIONS_STORAGE_PREFIX + jan);
        broadcastTouchPanelMenuSettingEvent({ action: 'clear-variations', jan });
    }
    tpBackupNowSafe();
    refreshTouchPanelItemModal();
}

function getTouchPanelDesc(jan) {
    return localStorage.getItem(TOUCH_PANEL_DESC_STORAGE_PREFIX + jan) || '';
}

function setTouchPanelDescPrompt(jan, name) {
    const current = getTouchPanelDesc(jan);
    const text = window.prompt(`「${name}」の説明文を入力してください（空欄で解除・30〜40文字程度推奨）`, current);
    if (text === null) return;
    if (text.trim()) {
        localStorage.setItem(TOUCH_PANEL_DESC_STORAGE_PREFIX + jan, text.trim());
        broadcastTouchPanelMenuSettingEvent({ action: 'set-desc', jan, value: text.trim() });
    } else {
        localStorage.removeItem(TOUCH_PANEL_DESC_STORAGE_PREFIX + jan);
        broadcastTouchPanelMenuSettingEvent({ action: 'clear-desc', jan });
    }
    tpBackupNowSafe();
    refreshTouchPanelItemModal();
}

function getRecommendedJanSet() {
    try {
        const raw = localStorage.getItem(TOUCH_PANEL_RECO_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch (e) {
        return new Set();
    }
}

function isRecommendedJan(jan) {
    return getRecommendedJanSet().has(String(jan));
}

/* =========================================================
   ⑦-3【今回追加】メニュー画面上部の「おすすめ・キャンペーン」横スクロールバナー
   ------------------------------------------
   ・お知らせ／キャンペーン文言（自由入力・任意）を帯状に表示。
   ・「⭐ おすすめ」に設定済みの商品を、写真付きの横スクロールカードで
     まとめて表示（既存のおすすめ設定をそのまま流用するため、店員側の
     追加の設定作業は不要）。
   どちらも設定が無い場合は何も表示しない。
   ========================================================= */
function getTouchPanelPromoText() {
    return localStorage.getItem(TOUCH_PANEL_PROMO_TEXT_KEY) || '';
}

function renderTouchPanelBannerHtml() {
    const promo = getTouchPanelPromoText();
    const recoItems = getProductListForTouchPanel().filter(p => isRecommendedJan(p.jan));
    if (!promo && recoItems.length === 0) return '';

    const promoHtml = promo ? `
        <div class="tp-promo-strip">
            <span class="tp-promo-strip-icon">📣</span>
            <span class="tp-promo-strip-text">${tpEsc(promo)}</span>
        </div>
    ` : '';

    const recoHtml = recoItems.length > 0 ? `
        <div class="tp-banner-rail-label">⭐ 本日のおすすめ</div>
        <div class="tp-banner-rail">${recoItems.map(p => renderTouchPanelBannerCard(p)).join('')}</div>
    ` : '';

    return promoHtml + recoHtml;
}

function renderTouchPanelBannerCard(p) {
    const imgUrl = getTouchPanelProductImg(p.jan);
    const bgStyle = imgUrl ? `background-image:url('${tpCssStr(imgUrl)}');` : '';
    return `
        <button class="tp-banner-card ${imgUrl ? 'has-photo' : ''}" style="${bgStyle}" onclick="openTouchPanelItemModal('${tpAttr(p.jan)}')">
            ${!imgUrl ? '<span class="tp-banner-card-placeholder">🍽️</span>' : ''}
            <span class="tp-banner-card-info">
                <span class="tp-banner-card-name">${tpEsc(p.name || '(名称未設定)')}</span>
                ${typeof p.price === 'number' ? `<span class="tp-banner-card-price">¥${p.price.toLocaleString()}</span>` : ''}
            </span>
        </button>
    `;
}

function refreshTouchPanelPromoBannerIfVisible() {
    const area = document.getElementById('tp-banner-area');
    if (!area) return;
    area.innerHTML = renderTouchPanelBannerHtml();
}

function saveTouchPanelPromoTextFromModal() {
    const input = document.getElementById('tp-promo-text-input');
    if (!input) return;
    const text = input.value.trim();
    if (text) {
        localStorage.setItem(TOUCH_PANEL_PROMO_TEXT_KEY, text);
    } else {
        localStorage.removeItem(TOUCH_PANEL_PROMO_TEXT_KEY);
    }
    broadcastTouchPanelMenuSettingEvent({ action: 'set-promo', value: text });
    tpBackupNowSafe();
    tpPlaySound('success');
    renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue());
    refreshTouchPanelPromoBannerIfVisible();
}

function clearTouchPanelPromoText() {
    localStorage.removeItem(TOUCH_PANEL_PROMO_TEXT_KEY);
    broadcastTouchPanelMenuSettingEvent({ action: 'set-promo', value: '' });
    tpBackupNowSafe();
    tpPlaySound('click');
    renderTouchPanelBgSettingModal(tpCurrentBgSettingFilterValue());
    refreshTouchPanelPromoBannerIfVisible();
}

function toggleRecommendedJan(jan) {
    const set = getRecommendedJanSet();
    const key = String(jan);
    if (set.has(key)) {
        set.delete(key);
    } else {
        set.add(key);
    }
    const recoJans = Array.from(set);
    localStorage.setItem(TOUCH_PANEL_RECO_STORAGE_KEY, JSON.stringify(recoJans));
    broadcastTouchPanelMenuSettingEvent({ action: 'set-reco', recoJans });
    tpBackupNowSafe();
    tpPlaySound('click');
    refreshTouchPanelItemModal();
    refreshTouchPanelMenuGridAndRail();
}

/* =========================================================
   ⑧ 画面（オーバーレイ）の土台・専用テーマ
   ========================================================= */
function ensureTouchPanelStyle() {
    if (document.getElementById('touch-panel-style')) return;
    const style = document.createElement('style');
    style.id = 'touch-panel-style';
    style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;900&display=swap');

        /* 【今回追加】操作性向上：ダブルタップでのブラウザ拡大・
           長押しでのテキスト選択やコールアウト表示を防ぎ、誤操作を減らす */
        #touch-panel-overlay, #touch-panel-overlay * {
            touch-action: manipulation;
            -webkit-user-select: none; user-select: none;
            -webkit-touch-callout: none;
        }
        #touch-panel-overlay button, #touch-panel-overlay .tp-menu-card,
        #touch-panel-overlay .tp-table-cell, #touch-panel-overlay .tp-chip {
            -webkit-tap-highlight-color: transparent;
            min-height: 44px; /* タップしやすい最小サイズ */
        }
        #touch-panel-overlay button:active, #touch-panel-overlay .tp-menu-card:active,
        #touch-panel-overlay .tp-table-cell:active {
            transform: scale(0.97); /* 押した手応えが分かるように */
        }

        #touch-panel-overlay {
            --tp-font: 'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', 'Yu Gothic', sans-serif;
            --tp-chrome: #12203a;
            --tp-ivory: #fbf3e4;
            --tp-ivory-2: #f3e7d3;
            --tp-ink: #2a2118;
            --tp-ink-soft: #8a7a68;
            --tp-accent: #d64526;
            --tp-accent-dark: #b23217;
            --tp-accent-2: #5b7b4f;
            --tp-call: #e8a33d;
            --tp-card-bg: #ffffff;
            --tp-card-border: #eee1cc;
            --tp-shadow: 0 6px 16px rgba(42,33,24,0.16);
            position: fixed; inset: 0; z-index: 500000;
            background-color: var(--tp-chrome);
            display: flex; flex-direction: column;
            color: #fff; font-family: var(--tp-font);
        }

        @keyframes tpFadeIn { from { opacity:0; transform:translateY(6px);} to { opacity:1; transform:translateY(0);} }
        @keyframes tpPopIn { from { opacity:0; transform:scale(0.92);} to { opacity:1; transform:scale(1);} }
        @keyframes tpSlideUp { from { transform:translateY(100%);} to { transform:translateY(0);} }
        @keyframes tpBump { 0% { transform:scale(1);} 35% { transform:scale(1.06);} 100% { transform:scale(1);} }
        @keyframes tpCheckPop { 0% { transform:scale(0.4); opacity:0;} 65% { transform:scale(1.15); opacity:1;} 100% { transform:scale(1); opacity:1;} }
        .tp-fade-in { animation: tpFadeIn 220ms ease-out; }
        .tp-pop { animation: tpPopIn 200ms ease-out; }
        .tp-slide-up { animation: tpSlideUp 240ms ease-out; }

        @media (prefers-reduced-motion: reduce) {
            #touch-panel-overlay * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
        }

        #touch-panel-overlay button, #touch-panel-overlay input { font-family: var(--tp-font); }
        #touch-panel-overlay button:focus-visible, #touch-panel-overlay input:focus-visible {
            outline: 3px solid #fff; outline-offset: 2px;
        }
        #touch-panel-overlay.tp-theme-menu button:focus-visible, #touch-panel-overlay.tp-theme-menu input:focus-visible {
            outline-color: var(--tp-accent-dark);
        }

        #touch-panel-overlay .tp-topbar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 18px; background: var(--tp-chrome); border-bottom: 3px solid var(--tp-accent);
            gap: 10px; flex-wrap: wrap;
        }
        #touch-panel-overlay .tp-topbar-title { font-size: 16px; font-weight: 900; letter-spacing: 0.02em; }
        #touch-panel-overlay .tp-topbar-actions { display:flex; gap:8px; flex-wrap:wrap; }
        #touch-panel-overlay .tp-btn {
            border: none; border-radius: 12px; cursor: pointer; font-weight: 700;
            color: #fff; padding: 11px 16px; font-size: 13px;
            box-shadow: 0 4px 0 rgba(0,0,0,0.3);
            transition: transform 60ms ease;
        }
        #touch-panel-overlay .tp-btn:active { transform: translateY(3px); box-shadow: 0 1px 0 rgba(0,0,0,0.3); }
        #touch-panel-overlay .tp-btn.tp-cancel { background: #5b6b7a; }
        #touch-panel-overlay .tp-btn.tp-primary { background: #2f6f8f; }
        #touch-panel-overlay .tp-btn.tp-call { background: var(--tp-call); }
        #touch-panel-overlay .tp-btn.tp-bill { background: var(--tp-accent-2); }
        #touch-panel-overlay .tp-btn.tp-confirm { background: var(--tp-accent); }
        #touch-panel-overlay .tp-btn.tp-reco-on { background: var(--tp-accent-2) !important; }

        #touch-panel-overlay .tp-body { flex: 1; overflow-y: auto; padding: 20px; position: relative; }
        #touch-panel-overlay .tp-body.tp-menu-body { padding: 0; display: flex; overflow: hidden; }

        #touch-panel-overlay .tp-intro-heading { text-align:center; font-size:20px; font-weight:900; margin-bottom:6px; }
        #touch-panel-overlay .tp-intro-sub { text-align:center; font-size:13px; color:#9fb3c8; margin-bottom:24px; }

        #touch-panel-overlay .tp-mode-select { display:flex; gap:24px; height:100%; align-items:center; justify-content:center; flex-wrap: wrap; }
        #touch-panel-overlay .tp-mode-btn {
            width: 220px; height: 220px; border-radius: 24px; border: none; cursor: pointer;
            font-size: 24px; font-weight: 900; color: #fff;
            box-shadow: 0 8px 0 rgba(0,0,0,0.35);
        }
        #touch-panel-overlay .tp-mode-btn:active { transform: translateY(5px); box-shadow: 0 3px 0 rgba(0,0,0,0.35); }
        #touch-panel-overlay .tp-mode-btn.customer { background: linear-gradient(160deg, #e8a33d, #d64526); }
        #touch-panel-overlay .tp-mode-btn.staff { background: linear-gradient(160deg, #4c8fa0, #1c4b57); }

        #touch-panel-overlay .tp-table-grid {
            display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
            max-width: 720px; margin: 0 auto;
        }
        /* 【今回追加】テーブル番号選択（最大50卓）は人数選択グリッドより
           マス目が多くなるため、列数を増やし・1マスを少し小さくして
           画面に収まりやすくする（収まりきらない分は.tp-bodyの
           overflow-y:autoでスクロールできる） */
        #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers {
            grid-template-columns: repeat(5, 1fr);
            max-width: 820px;
            gap: 10px;
        }
        #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers .tp-table-cell-num {
            font-size: 20px;
        }
        @media screen and (max-width: 640px) {
            #touch-panel-overlay .tp-table-grid.tp-table-grid-numbers {
                grid-template-columns: repeat(4, 1fr);
            }
        }
        #touch-panel-overlay .tp-table-cell {
            aspect-ratio: 1 / 1; border-radius: 18px; border: 3px solid #33475f;
            background: rgba(255,255,255,0.06); color: #fff; font-size: 26px; font-weight: 900;
            cursor: pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px;
        }
        #touch-panel-overlay .tp-table-cell-num { font-size: 26px; font-weight: 900; line-height: 1; }
        #touch-panel-overlay .tp-table-cell.selected { background: var(--tp-accent); border-color: #ffb199; transform: scale(1.05); }
        #touch-panel-overlay .tp-table-cell.occupied {
            background: rgba(255,255,255,0.03); border-color: #45566b; color: rgba(255,255,255,0.4); cursor: not-allowed;
        }
        #touch-panel-overlay .tp-table-cell-tag {
            font-size: 10px; font-weight: 700; background: rgba(230,74,25,0.85); color: #fff;
            padding: 2px 9px; border-radius: 999px; letter-spacing: 0.02em;
        }
        #touch-panel-overlay .tp-table-cell.occupied .tp-table-cell-tag { background: rgba(255,255,255,0.18); }

        /* ------- メニュー画面：専用の明るいテーマ ------- */
        #touch-panel-overlay.tp-theme-menu .tp-body { background: var(--tp-ivory); color: var(--tp-ink); }

        #touch-panel-overlay .tp-category-rail {
            width: 92px; flex-shrink: 0; background: var(--tp-ivory-2);
            border-right: 1px solid var(--tp-card-border);
            overflow-y: auto; display: flex; flex-direction: column; padding: 8px 0;
        }
        #touch-panel-overlay .tp-rail-item {
            border: none; background: transparent; cursor: pointer; padding: 13px 4px;
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            color: var(--tp-ink-soft); font-size: 11px; font-weight: 700;
            border-left: 4px solid transparent;
        }
        #touch-panel-overlay .tp-rail-item .tp-rail-icon { font-size: 22px; }
        #touch-panel-overlay .tp-rail-item.active { background: #fff; color: var(--tp-accent); border-left-color: var(--tp-accent); }

        #touch-panel-overlay .tp-menu-main { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 14px 16px 100px; overflow-y: auto; }
        #touch-panel-overlay .tp-search-row { margin-bottom: 10px; }
        #touch-panel-overlay .tp-search-input {
            width: 100%; box-sizing: border-box; padding: 12px 16px; border-radius: 24px;
            border: 2px solid var(--tp-card-border); font-size: 15px; background: #fff; color: var(--tp-ink);
        }
        #touch-panel-overlay .tp-staff-hint {
            background: #fff3dc; border: 1px solid var(--tp-call); color: #7a5310;
            padding: 8px 12px; border-radius: 10px; font-size: 12px; margin-bottom: 10px;
        }
        #touch-panel-overlay .tp-menu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; }
        #touch-panel-overlay .tp-empty-msg { color: var(--tp-ink-soft); grid-column: 1 / -1; text-align: center; padding: 30px 0; }

        #touch-panel-overlay .tp-menu-card {
            position: relative; border: none; border-radius: 16px; background-color: var(--tp-card-bg);
            background-position: center; background-size: cover; background-repeat: no-repeat;
            box-shadow: var(--tp-shadow); cursor: pointer; padding: 0; overflow: hidden;
            aspect-ratio: 1 / 1.05; display: flex; align-items: flex-end; text-align: left;
        }
        #touch-panel-overlay .tp-menu-card-placeholder {
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            font-size: 34px; background: var(--tp-ivory-2);
        }
        #touch-panel-overlay .tp-menu-card-badge {
            position: absolute; top: 6px; left: 6px; background: var(--tp-accent-2); color: #fff;
            font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; z-index: 1;
        }
        #touch-panel-overlay .tp-menu-card-info { position: relative; width: 100%; padding: 8px; }
        #touch-panel-overlay .tp-menu-card.has-photo .tp-menu-card-info {
            background: linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0)); padding-top: 24px; color: #fff;
        }
        #touch-panel-overlay .tp-menu-card:not(.has-photo) .tp-menu-card-info { color: var(--tp-ink); margin-top: auto; }
        #touch-panel-overlay .tp-menu-card-name { display: block; font-size: 13px; font-weight: 700; line-height: 1.3; }
        #touch-panel-overlay .tp-menu-card-price { display: block; font-size: 13px; font-weight: 900; color: #ffd8a8; margin-top: 2px; }
        #touch-panel-overlay .tp-menu-card:not(.has-photo) .tp-menu-card-price { color: var(--tp-accent); }

        /* ------- 【今回追加】「すべて」表示時：ジャンルごとの横スクロール帯 ------- */
        #touch-panel-overlay .tp-genre-rail-block { margin-bottom: 22px; }
        #touch-panel-overlay .tp-genre-rail-label { font-size: 15px; font-weight: 900; margin-bottom: 10px; color: var(--tp-ink); }
        #touch-panel-overlay .tp-genre-rail {
            display: flex; gap: 12px; overflow-x: auto; padding: 2px 2px 10px;
            -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity;
        }
        #touch-panel-overlay .tp-menu-card.tp-rail-card {
            flex: 0 0 auto; width: 152px; aspect-ratio: 3 / 4; scroll-snap-align: start;
        }

        /* ------- 【今回追加】メニュー上部：おすすめ・キャンペーンの横スクロールバナー ------- */
        #touch-panel-overlay .tp-promo-strip {
            display: flex; align-items: center; gap: 8px;
            background: linear-gradient(90deg, var(--tp-accent), var(--tp-call)); color: #fff;
            padding: 11px 14px; border-radius: 12px; font-weight: 700; font-size: 13px; margin-bottom: 14px;
        }
        #touch-panel-overlay .tp-promo-strip-icon { font-size: 16px; flex-shrink: 0; }
        #touch-panel-overlay .tp-promo-strip-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #touch-panel-overlay .tp-banner-rail-label { font-size: 14px; font-weight: 900; margin-bottom: 8px; color: var(--tp-accent-dark); }
        #touch-panel-overlay .tp-banner-rail {
            display: flex; gap: 12px; overflow-x: auto; padding: 2px 2px 14px; margin-bottom: 4px;
            -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity;
        }
        #touch-panel-overlay .tp-banner-card {
            flex: 0 0 auto; width: 220px; height: 120px; border: none; border-radius: 16px; position: relative;
            background-color: var(--tp-card-bg); background-position: center; background-size: cover; background-repeat: no-repeat;
            box-shadow: var(--tp-shadow); cursor: pointer; overflow: hidden; scroll-snap-align: start;
            display: flex; align-items: flex-end; text-align: left; padding: 0;
        }
        #touch-panel-overlay .tp-banner-card-placeholder {
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            font-size: 30px; background: var(--tp-ivory-2);
        }
        #touch-panel-overlay .tp-banner-card-info { position: relative; width: 100%; padding: 8px 10px; }
        #touch-panel-overlay .tp-banner-card.has-photo .tp-banner-card-info {
            background: linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0)); color: #fff; padding-top: 26px;
        }
        #touch-panel-overlay .tp-banner-card:not(.has-photo) .tp-banner-card-info { color: var(--tp-ink); }
        #touch-panel-overlay .tp-banner-card-name { display: block; font-size: 13px; font-weight: 800; }
        #touch-panel-overlay .tp-banner-card-price { display: block; font-size: 13px; font-weight: 900; color: #ffd8a8; }
        #touch-panel-overlay .tp-banner-card:not(.has-photo) .tp-banner-card-price { color: var(--tp-accent); }

        /* ------- 商品詳細ポップアップ 【今回改訂】下からせり上がるボトムシート風に ------- */
        #tp-item-modal-root { position: absolute; inset: 0; z-index: 30; display: flex; align-items: flex-end; justify-content: center; padding: 0; }
        #touch-panel-overlay .tp-modal-backdrop { position: absolute; inset: 0; background: rgba(20,15,10,0.55); }
        #touch-panel-overlay .tp-modal-close {
            position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%;
            border: none; background: rgba(0,0,0,0.5); color: #fff; font-size: 18px; cursor: pointer; z-index: 2;
        }
        #touch-panel-overlay .tp-item-modal {
            position: relative; z-index: 1; background: var(--tp-card-bg); color: var(--tp-ink);
            width: 100%; max-width: 480px; max-height: 88vh; overflow-y: auto; border-radius: 24px 24px 0 0;
            box-shadow: 0 -14px 40px rgba(0,0,0,0.35);
        }
        #touch-panel-overlay .tp-item-modal-drag-handle {
            width: 40px; height: 5px; border-radius: 999px; background: rgba(0,0,0,0.15); margin: 10px auto 0;
        }
        #touch-panel-overlay .tp-item-modal-photo {
            position: relative; height: 180px; background-color: var(--tp-ivory-2);
            background-position: center; background-size: cover; background-repeat: no-repeat;
            display: flex; align-items: center; justify-content: center; margin-top: 4px;
        }
        #touch-panel-overlay .tp-item-modal-photo-placeholder { font-size: 48px; }
        #touch-panel-overlay .tp-badge-reco {
            position: absolute; top: 10px; left: 10px; background: var(--tp-accent-2); color: #fff;
            font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
        }
        #touch-panel-overlay .tp-item-modal-body { padding: 16px 18px 20px; }
        #touch-panel-overlay .tp-item-modal-name { font-size: 19px; font-weight: 900; margin-bottom: 4px; }
        #touch-panel-overlay .tp-item-modal-desc { font-size: 13px; color: var(--tp-ink-soft); line-height: 1.6; margin-bottom: 8px; }
        #touch-panel-overlay .tp-item-modal-price { font-size: 20px; font-weight: 900; color: var(--tp-accent); margin-bottom: 8px; }
        #touch-panel-overlay .tp-modal-section-label { font-size: 12px; font-weight: 700; color: var(--tp-ink-soft); margin: 12px 0 6px; }
        #touch-panel-overlay .tp-modal-variations { display: flex; flex-wrap: wrap; gap: 8px; }
        #touch-panel-overlay .tp-chip {
            border: 2px solid var(--tp-card-border); background: #fff; color: var(--tp-ink);
            border-radius: 999px; padding: 8px 16px; font-weight: 700; cursor: pointer; font-size: 13px;
        }
        #touch-panel-overlay .tp-chip.active { border-color: var(--tp-accent); background: var(--tp-accent); color: #fff; }
        #touch-panel-overlay .tp-qty-stepper { display: flex; align-items: center; gap: 16px; }
        #touch-panel-overlay .tp-qty-stepper button {
            width: 40px; height: 40px; border-radius: 50%; border: 2px solid var(--tp-card-border);
            background: #fff; font-size: 18px; font-weight: 900; cursor: pointer; color: var(--tp-ink);
        }
        #touch-panel-overlay .tp-qty-stepper span { font-size: 20px; font-weight: 900; min-width: 28px; text-align: center; }
        #touch-panel-overlay .tp-modal-staff-box { margin-top: 16px; padding: 12px; background: var(--tp-ivory-2); border-radius: 12px; }
        #touch-panel-overlay .tp-modal-staff-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
        #touch-panel-overlay .tp-modal-add-btn { width: 100%; margin-top: 18px; padding: 16px; font-size: 16px; border-radius: 14px; }

        /* ------- 注文かごバー・カートドロワー 【今回改訂】より目立つ・追加時のアニメーション付きに ------- */
        #touch-panel-overlay .tp-cart-bar {
            position: absolute; left: 16px; right: 16px; bottom: 16px; z-index: 20;
            background: linear-gradient(135deg, var(--tp-accent), var(--tp-accent-dark)); color: #fff; border: none; border-radius: 999px;
            padding: 17px 22px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
            box-shadow: 0 10px 28px rgba(214,69,38,0.55), 0 0 0 3px rgba(255,255,255,0.15) inset;
            cursor: pointer; font-weight: 900; font-size: 15px; transition: transform 120ms ease;
        }
        #touch-panel-overlay .tp-cart-bar:active { transform: scale(0.98); }
        #touch-panel-overlay .tp-cart-bar.tp-bump { animation: tpBump 380ms cubic-bezier(.34,1.56,.64,1); }
        #touch-panel-overlay .tp-cart-bar-icon { position: relative; font-size: 24px; }
        #touch-panel-overlay .tp-cart-bar-badge {
            position: absolute; top: -10px; right: -14px; background: #fff; color: var(--tp-accent);
            font-size: 12px; font-weight: 900; border-radius: 999px; padding: 2px 7px; min-width: 18px; text-align: center;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        #touch-panel-overlay .tp-cart-bar.tp-bump .tp-cart-bar-badge { animation: tpCheckPop 380ms ease; }
        #touch-panel-overlay .tp-cart-bar-total { font-size: 16px; font-weight: 900; }
        #touch-panel-overlay .tp-cart-bar-label { font-size: 13px; opacity: 0.95; }

        @keyframes tpFlyPlusOne {
            0% { opacity: 0; transform: translateY(0) scale(0.8); }
            18% { opacity: 1; transform: translateY(-8px) scale(1.15); }
            100% { opacity: 0; transform: translateY(-62px) scale(1); }
        }
        #touch-panel-overlay .tp-fly-plus-one {
            position: absolute; z-index: 25; pointer-events: none; font-weight: 900; font-size: 22px;
            color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.35);
            animation: tpFlyPlusOne 700ms ease-out forwards;
        }

        #tp-cart-drawer-root { position: absolute; inset: 0; z-index: 30; display: flex; align-items: flex-end; }
        #touch-panel-overlay .tp-cart-drawer {
            position: relative; z-index: 1; width: 100%; max-height: 80vh; background: var(--tp-card-bg);
            color: var(--tp-ink); border-radius: 22px 22px 0 0; display: flex; flex-direction: column;
            box-shadow: 0 -12px 30px rgba(0,0,0,0.3);
        }
        #touch-panel-overlay .tp-cart-drawer-header {
            display: flex; justify-content: space-between; align-items: center; padding: 16px 18px;
            font-weight: 900; font-size: 16px; border-bottom: 1px solid var(--tp-card-border); position: relative;
        }
        #touch-panel-overlay .tp-cart-drawer-list { flex: 1; overflow-y: auto; padding: 6px 18px; }
        #touch-panel-overlay .tp-cart-row {
            display: flex; justify-content: space-between; align-items: center; padding: 10px 0;
            border-bottom: 1px dashed var(--tp-card-border); gap: 10px;
        }
        #touch-panel-overlay .tp-cart-row-name { font-weight: 700; font-size: 14px; }
        #touch-panel-overlay .tp-cart-row-variation { color: var(--tp-ink-soft); font-weight: 400; font-size: 12px; }
        #touch-panel-overlay .tp-cart-row-price { color: var(--tp-ink-soft); font-size: 13px; margin-top: 2px; }
        #touch-panel-overlay .tp-cart-row-qty { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        #touch-panel-overlay .tp-cart-row-qty button {
            width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--tp-card-border);
            background: #fff; cursor: pointer; font-weight: 900; color: var(--tp-ink);
        }
        #touch-panel-overlay .tp-cart-empty { text-align: center; color: var(--tp-ink-soft); padding: 30px 10px; }
        #touch-panel-overlay .tp-cart-drawer-footer { padding: 14px 18px 20px; border-top: 1px solid var(--tp-card-border); }
        #touch-panel-overlay .tp-cart-drawer-total { text-align: right; font-size: 20px; font-weight: 900; margin-bottom: 10px; }
        #touch-panel-overlay .tp-cart-submit-btn { width: 100%; padding: 16px; font-size: 16px; border-radius: 14px; }

        /* ------- 【今回追加】注文履歴 ------- */
        #tp-order-history-root { position: absolute; inset: 0; z-index: 30; display: flex; align-items: flex-end; }
        #touch-panel-overlay .tp-order-history-block { padding: 10px 0; border-bottom: 2px solid var(--tp-card-border); }
        #touch-panel-overlay .tp-order-history-time { font-size: 12px; font-weight: 700; color: var(--tp-ink-soft); margin-bottom: 4px; }
        #touch-panel-overlay .tp-order-history-qty { font-weight: 900; color: var(--tp-ink-soft); flex-shrink: 0; }
        #touch-panel-overlay .tp-order-history-subtotal { text-align: right; font-size: 13px; font-weight: 800; color: var(--tp-accent); margin-top: 4px; }

        /* ------- 呼び出し用件ポップアップ ------- */
        #tp-call-menu-root { position: absolute; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 20px; }
        #touch-panel-overlay .tp-call-menu-box {
            position: relative; z-index: 1; background: #fff; color: var(--tp-ink); border-radius: 20px;
            padding: 22px; width: min(360px, 90vw); text-align: center;
        }
        #touch-panel-overlay .tp-call-menu-title { font-weight: 900; font-size: 16px; margin-bottom: 16px; }
        #touch-panel-overlay .tp-call-menu-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
        #touch-panel-overlay .tp-call-menu-grid button {
            border: 2px solid var(--tp-card-border); background: var(--tp-ivory); border-radius: 14px;
            padding: 16px 8px; font-weight: 700; font-size: 13px; cursor: pointer;
            display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--tp-ink);
        }
        #touch-panel-overlay .tp-call-menu-grid button .tp-call-icon { font-size: 26px; }

        /* ------- 客用モードの脱出防止（キオスクロック） ------- */
        #touch-panel-overlay .tp-kiosk-lock-badge {
            position: absolute; left: 16px; bottom: 16px; z-index: 21;
            background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.75);
            font-size: 11px; font-weight: 700; padding: 8px 12px; border-radius: 10px;
            max-width: 90px; text-align: center; line-height: 1.3;
            user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; cursor: default;
        }
        #touch-panel-overlay .tp-kiosk-lock-badge:active { background: rgba(255,255,255,0.25); }
        #touch-panel-overlay.tp-theme-menu .tp-kiosk-lock-badge { background: rgba(42,33,24,0.14); color: rgba(42,33,24,0.65); }
        #touch-panel-overlay.tp-theme-menu .tp-kiosk-lock-badge:active { background: rgba(42,33,24,0.3); }
        #touch-panel-overlay .tp-cart-bar-shifted { left: 100px; }

        /* 【不具合修正・再修正】メニュー画面の左下に出していた「テーブルN」
           バッジが、幅92pxのジャンルのサイドバー（.tp-category-rail）の
           一番下のボタンと重なる問題があり、一時的に完全に透明（opacity:0）
           にして隠していた。しかしこれにより「卓番の表示が消えた」ように
           見えてしまっていたため、今回は「隠す」のではなく「重ならない
           位置に置き直す」方式に変更する。
           ・サイドバー幅（92px）より内側に入らないよう left を広げる。
           ・客用モードでは画面下部いっぱいに「注文かごバー」(.tp-cart-bar)
             が表示されるため、その上に重ねて表示する（bottomを引き上げる）。
           これで見た目にも表示され、長押しでの店員用PIN入力機能（隠し
           場所）としても引き続き機能する。 */
        #touch-panel-overlay .tp-kiosk-lock-badge.tp-table-num-hidden {
            opacity: 0.82; left: 108px; bottom: 84px;
        }

        /* ------- 店員用モード・背景設定への入口（お客様には見えない想定のバッジ） -------
           ラベルも枠線も付けず、ほぼ透明な小さな丸を置くだけにして、
           知らない人には単なる背景の一部にしか見えないようにしている。 */
        #touch-panel-overlay .tp-staff-entry-badge {
            position: absolute; right: 10px; bottom: 10px; z-index: 21;
            width: 34px; height: 34px; border-radius: 50%;
            background: transparent;
            user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; cursor: default;
        }

        #tp-kiosk-pin-root, #tp-kiosk-exit-root, #tp-checkout-confirm-root { position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; }
        #touch-panel-overlay .tp-pin-modal {
            position: relative; z-index: 1; background: #fff; color: var(--tp-ink); border-radius: 20px;
            padding: 22px; width: min(320px, 88vw); text-align: center;
        }
        #touch-panel-overlay .tp-pin-title { font-weight: 900; font-size: 16px; margin-bottom: 6px; }
        #touch-panel-overlay .tp-pin-sub { font-size: 12px; color: var(--tp-ink-soft); margin-bottom: 16px; }
        #touch-panel-overlay .tp-pin-dots { display: flex; justify-content: center; gap: 12px; margin-bottom: 18px; }
        #touch-panel-overlay .tp-pin-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--tp-card-border); background: #fff; }
        #touch-panel-overlay .tp-pin-dot.filled { background: var(--tp-accent); border-color: var(--tp-accent); }
        #touch-panel-overlay .tp-pin-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        #touch-panel-overlay .tp-pin-keypad button, #touch-panel-overlay .tp-pin-keypad span {
            height: 52px; border-radius: 14px; border: 2px solid var(--tp-card-border); background: var(--tp-ivory);
            font-size: 20px; font-weight: 900; color: var(--tp-ink); cursor: pointer;
        }
        /* 【今回追加】お会計確認ダイアログの合計金額表示 */
        #touch-panel-overlay .tp-checkout-confirm-total {
            font-size: 26px; font-weight: 900; color: var(--tp-accent-dark);
            margin: 4px 0 14px; letter-spacing: 0.02em;
        }
        #touch-panel-overlay .tp-kiosk-warning {
            background: #fdecea; color: #c62828; border: 1px solid #f5c6c0; border-radius: 10px;
            padding: 10px 12px; font-size: 13px; font-weight: 700; margin-top: 4px; line-height: 1.5;
        }
        @keyframes tpShake {
            10%, 90% { transform: translateX(-2px); }
            20%, 80% { transform: translateX(4px); }
            30%, 50%, 70% { transform: translateX(-8px); }
            40%, 60% { transform: translateX(8px); }
        }
        .tp-shake { animation: tpShake 400ms; }

        /* ------- 注文完了画面 ------- */
        #tp-complete-root {
            position: absolute; inset: 0; z-index: 50; display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 14px; background: rgba(251,243,228,0.97);
            color: var(--tp-ink); text-align: center; padding: 20px;
        }
        #touch-panel-overlay .tp-complete-check { font-size: 64px; animation: tpCheckPop 480ms ease-out; }
        #touch-panel-overlay .tp-complete-text { font-size: 20px; font-weight: 900; }
        #touch-panel-overlay .tp-complete-sub { font-size: 13px; color: var(--tp-ink-soft); }

        /* 【今回追加】お会計後の「ありがとうございました」画面は、テーブルが
           まだ使用中（お客様がレジへ向かっている途中）であることが一目で
           わかるよう、背景を朱色・文字を白にする */
        #touch-panel-overlay .tp-checkout-thanks-area {
            background: #e8491d !important;
        }
        #touch-panel-overlay .tp-checkout-thanks-area .tp-complete-text,
        #touch-panel-overlay .tp-checkout-thanks-area .tp-complete-sub {
            color: #fff;
        }
        #touch-panel-overlay .tp-table-occupied-badge {
            margin-top: 10px; padding: 6px 18px; border-radius: 999px;
            background: rgba(255,255,255,0.18); color: #fff;
            font-size: 15px; font-weight: 900; letter-spacing: 0.05em;
        }
        /* 【今回追加】注文完了オーバーレイ（明るいクリーム色の背景）用の配色。
           お会計後の「ありがとうございました」画面（朱色の背景）用の
           半透明白バッジのままだと、背景色が明るくて文字が読めなくなる
           ため、こちらは不透明の抹茶色背景に変更する。 */
        #touch-panel-overlay .tp-table-occupied-badge-light {
            background: var(--tp-accent-2);
        }

        #touch-panel-toast {
            position: fixed; left: 50%; bottom: 100px; transform: translateX(-50%);
            background: #2a2118; color: #fff; padding: 12px 22px; border-radius: 12px;
            z-index: 600000; font-weight: 700; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
    `;
    document.head.appendChild(style);
}

function showTouchPanelToast(text) {
    const existing = document.getElementById('touch-panel-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'touch-panel-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2200);
}

function getOrCreateTouchPanelOverlay() {
    ensureTouchPanelStyle();
    let overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'touch-panel-overlay';
        document.body.appendChild(overlay);
    }
    return overlay;
}

// タッチパネルの「キャンセル」は、確認ダイアログを挟まずその場で即座に
// 画面を閉じる（＝キャンセル操作をそのまま確定として扱う）。
function closeTouchPanel() {
    tpPlaySound('click');
    if (touchPanelState.mode !== 'staff' && touchPanelState.table != null) {
        releaseTouchPanelTable(touchPanelState.table);
    }
    const overlay = document.getElementById('touch-panel-overlay');
    if (overlay) overlay.remove();
    resetTouchPanelState();
    tpExitFullscreen();
    restoreTouchPanelTitleAndHash();
}

/* =========================================================
   【今回追加】タッチパネルを開いている間だけ、URLのハッシュを
   #touch-panel に、ページタイトルを「タッチパネル - haruレジ」に
   変更する。閉じたら元のタイトル・ハッシュに戻す。
   ========================================================= */
let tpOriginalTitle = null;
let tpOriginalHash = null;

function applyTouchPanelTitleAndHash() {
    if (tpOriginalTitle === null) tpOriginalTitle = document.title;
    if (tpOriginalHash === null) tpOriginalHash = window.location.hash;
    document.title = 'タッチパネル - haruレジ';
    if (window.location.hash !== '#touch-panel') {
        history.pushState(null, '', '#touch-panel');
    }
}

function restoreTouchPanelTitleAndHash() {
    if (tpOriginalTitle !== null) {
        document.title = tpOriginalTitle;
        tpOriginalTitle = null;
    }
    if (window.location.hash === '#touch-panel') {
        const restoreHash = tpOriginalHash || '';
        history.pushState(null, '', window.location.pathname + window.location.search + restoreHash);
    }
    tpOriginalHash = null;
}

/* =========================================================
   【今回の不具合修正】ブラウザ／タブレットの「戻る」操作で、正規の
   手順（お会計完了後のリセット・暗証番号での「削除」）を経ずに
   タッチパネルの外へ出てしまい、テーブルの「使用中」フラグが
   解除されないまま残ってしまう不具合への対応
   ------------------------------------------
   【原因】
   タッチパネルを開く際、applyTouchPanelTitleAndHash()で
   history.pushState()を使ってURLのハッシュに#touch-panelという
   印を積んでいたが、その状態から「戻る」操作（ブラウザの戻る
   ボタン、タブレットの物理／ジェスチャー戻るボタン等）が行われた
   ときに発生するpopstateイベントを、これまで一切監視していなかった。
   そのため「戻る」を押すと、ハッシュだけが変わってタッチパネルの
   JS側の状態（テーブルの使用中フラグ・注文内容など）は何も
   片付けられないまま宙に浮いてしまい、
   　・テーブルが「使用中」のまま解除されず残り続けてしまう
   　　（→ 実際には誰も使っていないのに使用中と表示される不具合）
   　・本来は店員が暗証番号を入力しないと出られないはずの客用モードの
   　　脱出防止（キオスクロック）を、「戻る」操作だけは素通りできて
   　　しまう
   という2つの問題を引き起こしていた。
   【対応】
   タッチパネルを開いている間はpopstateを監視し、「戻る」操作が
   あった場合はその場ですぐ#touch-panelへ履歴を積み直して戻る操作を
   打ち消す。これにより、タッチパネルを開いている間は、これまで通り
   「キャンセル」ボタンや暗証番号を使った正規の手順以外では外へ出られ
   なくなり、テーブルの使用中フラグが宙に浮くことも無くなる。
   （正規の終了処理 restoreTouchPanelTitleAndHash() はhistory.back()等の
   ブラウザナビゲーションではなくpushState()のみで完結しているため、
   popstateは発生せず、この監視と衝突することはない。）
   ========================================================= */
window.addEventListener('popstate', () => {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return; // タッチパネルを開いていない間は何もしない
    if (window.location.hash !== '#touch-panel') {
        history.pushState(null, '', '#touch-panel');
    }
});

/* =========================================================
   ⑨ 画面①：人数選択（タッチパネルを開いて最初に出す画面）
   ========================================================= */
// 【今回改訂】「人数を選ぶ前にテーブル番号を選びたい」という要望に対応し、
// 最初の画面を「人数選択」から「テーブル選択」に入れ替えた。
// 客用モードでは常にここから始まるため、あらかじめ 'customer' を
// セットしておく（店員がテーブル選択画面の隠しバッジ経由でPINを
// 入力した場合のみ、後から selectTouchPanelMode('staff') に切り替わる）。
function openTouchPanelSelectModal() {
    tpPlaySound('click');
    resetTouchPanelState();
    touchPanelState.mode = 'customer';
    tpEnterFullscreen();
    applyTouchPanelTitleAndHash();
    renderTouchPanelTableGrid();
}

// 【今回追加】タッチパネルを開いている間は全画面表示にする。
// 対応していない環境（一部のブラウザ・iPhoneのSafari等）や、ユーザー
// 操作起点でない呼び出しでは失敗することがあるが、失敗しても通常表示の
// まま使えるので握りつぶして問題ない。
function tpEnterFullscreen() {
    try {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (!req) return;
        const result = req.call(el);
        if (result && typeof result.catch === 'function') result.catch(() => { /* 非対応環境等は無視 */ });
    } catch (e) { /* 非対応環境等は無視 */ }
}

function tpExitFullscreen() {
    try {
        const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
        if (!isFs) return;
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (!exit) return;
        const result = exit.call(document);
        if (result && typeof result.catch === 'function') result.catch(() => { /* 無視 */ });
    } catch (e) { /* 無視 */ }
}

function renderTouchPanelPartySizeScreen() {
    const overlay = getOrCreateTouchPanelOverlay();
    overlay.classList.remove('tp-theme-menu');
    const isCustomerMode = touchPanelState.mode !== 'staff';

    const cellsHtml = TOUCH_PANEL_PARTY_SIZE_OPTIONS.map(n => {
        const isMax = n === TOUCH_PANEL_PARTY_SIZE_OPTIONS[TOUCH_PANEL_PARTY_SIZE_OPTIONS.length - 1];
        const label = isMax ? `${n}+` : `${n}`;
        return `<button class="tp-table-cell" data-size="${n}" onclick="selectTouchPanelPartySize(${n})">${label}</button>`;
    }).join('');

    overlay.innerHTML = `
        <div class="tp-topbar">
            <span class="tp-topbar-title">🍽️ テーブル${touchPanelState.table} － 何名様でご来店ですか？</span>
            <div class="tp-topbar-actions">
                ${isCustomerMode ? '' : '<button class="tp-btn tp-cancel" onclick="closeTouchPanel()">キャンセル</button>'}
            </div>
        </div>
        <div class="tp-body tp-fade-in">
            <div class="tp-intro-heading">何名様でご来店ですか？</div>
            <div class="tp-intro-sub">人数をお選びのうえ「次へ」を押してください</div>
            <div class="tp-table-grid" id="tp-party-grid">${cellsHtml}</div>
            <div style="text-align:center; margin-top:24px;">
                <button class="tp-btn tp-confirm" style="font-size:16px; padding:16px 40px;" onclick="confirmTouchPanelPartySize()">次へ</button>
            </div>
        </div>
        ${isCustomerMode ? '<div class="tp-kiosk-lock-badge" id="tp-kiosk-lock-badge">🔒</div>' : ''}
    `;
    applyTouchPanelBackground();
    if (isCustomerMode) setupTouchPanelKioskLock();
}

function selectTouchPanelPartySize(n) {
    tpPlaySound('click');
    touchPanelState.partySize = n;
    document.querySelectorAll('#tp-party-grid .tp-table-cell').forEach(cell => {
        cell.classList.toggle('selected', parseInt(cell.dataset.size, 10) === n);
    });
}

// 【今回改訂】テーブル選択画面が最初の画面になったため、ここが最後の
// 入力ステップになる。人数の確定後はそのままメニュー画面へ進む
// （以前ここにあった「客用／店員用モードの決定」は、今はテーブル選択
// 画面の隠しバッジ（暗証番号）側で先に済んでいる）。
function confirmTouchPanelPartySize() {
    if (!touchPanelState.partySize) {
        tpPlaySound('error');
        showTouchPanelToast('⚠️ 人数を選んでください');
        return;
    }
    tpPlaySound('click');
    touchPanelState.order = [];
    touchPanelState.sentOrders = [];
    touchPanelState.activeCategory = 'all';
    touchPanelState.searchQuery = '';
    renderTouchPanelMenuScreen();
}

function selectTouchPanelMode(mode) {
    tpPlaySound('click');
    touchPanelState.mode = mode;
    renderTouchPanelTableGrid();
}

/* =========================================================
   ⑩-2【今回追加】使用中テーブルの管理
   ------------------------------------------
   「今使用済みのテーブルは選択できないように」という要望に対応する。
   テーブルの使用状況は特定の端末だけが知っていても意味が無く、
   お店全体（レジ本体・他のタッチパネル端末すべて）で同じ内容が
   見えている必要があるため、localStorageへの保存に加えて、
   order-checkout-display.js 等と同じ方式（utils.jsのinitAbly()が
   作るグローバル変数 channel を使ったpublish/subscribe）で、
   他端末にもリアルタイムで反映する。
   ・客用モードでテーブルを確定した時点で「使用中」にする。
   ・お会計後の「ありがとうございました」画面を店員が長押しで
     リセットした時点、または店員用の「削除（注文取消・退出）」を
     実行した時点で「空席」に戻す。
   ・店員用モードは、テーブルの使用状況に関わらずどのテーブル番号でも
     選べるようにする（写真・説明文の設定などはテーブルと無関係のため）。
     ただし、もし使用中のテーブルを店員が選んだ場合は「空席に戻すか」を
     一度確認する（お客様が離席した後、使用中のまま固まってしまった
     テーブルを店員が手動で復旧できるようにするため）。
   ========================================================= */
function getOccupiedTouchPanelTables() {
    try {
        const raw = localStorage.getItem(TOUCH_PANEL_OCCUPIED_TABLES_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr.map(n => parseInt(n, 10)).filter(n => !isNaN(n)) : []);
    } catch (e) {
        return new Set();
    }
}

function saveOccupiedTouchPanelTables(set) {
    localStorage.setItem(TOUCH_PANEL_OCCUPIED_TABLES_KEY, JSON.stringify(Array.from(set)));
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
}

function isTouchPanelTableOccupied(num) {
    return getOccupiedTouchPanelTables().has(num);
}

function broadcastTouchPanelTableEvent(payload) {
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('touch-panel-table-event', Object.assign({
                senderId: (typeof POS_DEVICE_ID !== 'undefined') ? POS_DEVICE_ID : null
            }, payload));
        } catch (e) { /* Ably未接続時等は無視して良い（localStorageへの保存自体は完了しているため） */ }
    }
}

function markTouchPanelTableOccupied(num) {
    if (num == null) return;
    const set = getOccupiedTouchPanelTables();
    if (set.has(num)) return;
    set.add(num);
    saveOccupiedTouchPanelTables(set);
    broadcastTouchPanelTableEvent({ action: 'occupy', table: num });
}

function releaseTouchPanelTable(num) {
    if (num == null) return;
    const set = getOccupiedTouchPanelTables();
    if (!set.has(num)) return;
    set.delete(num);
    saveOccupiedTouchPanelTables(set);
    broadcastTouchPanelTableEvent({ action: 'release', table: num });
}

function refreshTouchPanelTableGridIfVisible() {
    if (document.getElementById('tp-table-grid')) {
        renderTouchPanelTableGrid();
    }
}

(function hookAblyForTouchPanelTables() {
    function tryHook() {
        if (typeof channel === 'undefined' || !channel) {
            setTimeout(tryHook, 500);
            return;
        }
        channel.subscribe('touch-panel-table-event', (message) => {
            const data = message.data || {};
            if (data.table == null) return;
            const set = getOccupiedTouchPanelTables();
            if (data.action === 'occupy') {
                set.add(data.table);
            } else if (data.action === 'release') {
                set.delete(data.table);
            } else {
                return;
            }
            localStorage.setItem(TOUCH_PANEL_OCCUPIED_TABLES_KEY, JSON.stringify(Array.from(set)));
            refreshTouchPanelTableGridIfVisible();
        });
    }
    tryHook();
})();

function tpNotifyTableOccupied(num) {
    tpPlaySound('error');
    showTouchPanelToast(`⚠️ テーブル${num}は現在使用中です`);
}

// 店員用モードで、使用中のテーブルをあえて選んだ場合の確認
function tpStaffPickOccupiedTable(num) {
    tpPlaySound('click');
    const proceed = () => selectTouchPanelTable(num, true);
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            `テーブル${num}は現在「使用中」になっています。空席（未使用）に戻しますか？\n「いいえ」を選ぶと、使用中のままこのテーブルに店員用として入ります。`,
            `てーぶる${num} を くうせき に もどし ます か？`,
            (ok) => {
                if (ok) {
                    releaseTouchPanelTable(num);
                    tpPlaySound('success');
                    refreshTouchPanelTableGridIfVisible();
                } else {
                    proceed();
                }
            },
            true
        );
    } else {
        proceed();
    }
}

/* =========================================================
   ⑪ 画面③：マス目（テーブル番号）選択
   ========================================================= */
function renderTouchPanelTableGrid() {
    const overlay = getOrCreateTouchPanelOverlay();
    overlay.classList.remove('tp-theme-menu');
    const isCustomerMode = touchPanelState.mode !== 'staff';
    const modeLabel = touchPanelState.mode === 'staff' ? '店員用' : '客用';

    const occupiedTables = getOccupiedTouchPanelTables();
    let cellsHtml = '';
    for (let i = 1; i <= TOUCH_PANEL_TABLE_COUNT; i++) {
        const occupied = occupiedTables.has(i);
        let onclickAttr;
        if (occupied && isCustomerMode) {
            onclickAttr = `tpNotifyTableOccupied(${i})`;
        } else if (occupied) {
            onclickAttr = `tpStaffPickOccupiedTable(${i})`;
        } else {
            onclickAttr = `selectTouchPanelTable(${i})`;
        }
        cellsHtml += `
            <button class="tp-table-cell ${occupied ? 'occupied' : ''}" data-table="${i}" onclick="${onclickAttr}">
                <span class="tp-table-cell-num">${i}</span>
                ${occupied ? '<span class="tp-table-cell-tag">使用中</span>' : ''}
            </button>`;
    }

    // 【今回改訂】テーブル選択がタッチパネルの最初の画面になったため、
    // まだ人数（partySize）は未確定。タイトルから人数表示を外す。
    // 「🔔 店員を呼ぶ」「💰 お会計」も、まだ何も注文していないこの時点では
    // 意味を持たないため外し、代わりに来店直後の見出しらしい文言にする。
    overlay.innerHTML = `
        <div class="tp-topbar">
            <span class="tp-topbar-title">🍽️ いらっしゃいませ － テーブルを選んでください</span>
            <div class="tp-topbar-actions">
                ${isCustomerMode ? '' : '<button class="tp-btn tp-cancel" onclick="closeTouchPanel()">キャンセル</button>'}
            </div>
        </div>
        <div class="tp-body tp-fade-in">
            <div class="tp-intro-heading">テーブルを選んでください</div>
            <div class="tp-table-grid tp-table-grid-numbers" id="tp-table-grid">${cellsHtml}</div>
            <div style="text-align:center; margin-top:24px;">
                <button class="tp-btn tp-confirm" style="font-size:16px; padding:16px 40px;" onclick="confirmTouchPanelTable()">次へ</button>
            </div>
        </div>
        ${isCustomerMode ? `
            <div class="tp-kiosk-lock-badge" id="tp-kiosk-lock-badge">🔒</div>
            <div class="tp-staff-entry-badge" id="tp-staff-entry-badge"></div>
        ` : ''}
    `;
    applyTouchPanelBackground();
    if (isCustomerMode) {
        setupTouchPanelKioskLock();
        setupTouchPanelStaffEntryBadge();
    }
}

function selectTouchPanelTable(num, skipOccupiedCheck) {
    // 客用モードでは、他画面からの遷移中に使用状況が変わっている可能性も
    // 考慮し、念のためここでも再チェックする（ボタン自体は基本的に
    // renderTouchPanelTableGrid()側で既に選べないようにしてある）。
    if (!skipOccupiedCheck && touchPanelState.mode !== 'staff' && isTouchPanelTableOccupied(num)) {
        tpNotifyTableOccupied(num);
        return;
    }
    tpPlaySound('click');
    touchPanelState.table = num;
    document.querySelectorAll('#tp-table-grid .tp-table-cell').forEach(cell => {
        cell.classList.toggle('selected', parseInt(cell.dataset.table, 10) === num);
    });
}

function confirmTouchPanelTable() {
    if (!touchPanelState.table) {
        tpPlaySound('error');
        showTouchPanelToast('⚠️ テーブルを選んでください');
        return;
    }
    if (touchPanelState.mode !== 'staff' && isTouchPanelTableOccupied(touchPanelState.table)) {
        tpNotifyTableOccupied(touchPanelState.table);
        renderTouchPanelTableGrid();
        return;
    }
    tpPlaySound('click');
    if (touchPanelState.mode !== 'staff') {
        markTouchPanelTableOccupied(touchPanelState.table);
    }
    // 【今回改訂】テーブル確定の次は、人数を選ぶ画面へ進む
    // （以前はここから直接メニュー画面だったが、人数選択を後段に
    // 移したため、注文内容のリセットは人数確定後の
    // confirmTouchPanelPartySize() 側で行うようにした）。
    renderTouchPanelPartySizeScreen();
}

/* =========================================================
   ⑫ 画面④：メニュー（ジャンル別サイドバー＋写真グリッド）
   ========================================================= */
function touchPanelGenreIcon(genre) {
    return TOUCH_PANEL_GENRE_ICONS[genre] || '🍽️';
}

function buildTouchPanelCategoryList(productList) {
    const seen = [];
    const seenSet = new Set();
    productList.forEach(p => {
        const g = (p && p.genre && String(p.genre).trim()) ? String(p.genre).trim() : 'その他';
        if (!seenSet.has(g)) {
            seenSet.add(g);
            seen.push(g);
        }
    });

    const hasReco = productList.some(p => isRecommendedJan(p.jan));
    const list = [];
    if (hasReco) list.push({ key: '__reco__', label: 'おすすめ', icon: '⭐' });
    list.push({ key: 'all', label: 'すべて', icon: '🍽️' });
    seen.forEach(g => list.push({ key: g, label: g, icon: touchPanelGenreIcon(g) }));
    return list;
}

function filterTouchPanelProducts() {
    const all = getProductListForTouchPanel();
    const q = (touchPanelState.searchQuery || '').trim();
    if (q) {
        return all.filter(p => (p.name || '').includes(q));
    }
    const cat = touchPanelState.activeCategory || 'all';
    if (cat === 'all') return all;
    if (cat === '__reco__') return all.filter(p => isRecommendedJan(p.jan));
    return all.filter(p => ((p.genre && String(p.genre).trim()) || 'その他') === cat);
}

// railMode: 「すべて」表示時のジャンル別横スクロール帯に出すカードかどうか。
// 横スクロール帯では、固定幅×縦長の写真でより「写真中心」に見せる。
function renderTouchPanelMenuCard(p, railMode) {
    const imgUrl = getTouchPanelProductImg(p.jan);
    const bgStyle = imgUrl ? `background-image:url('${tpCssStr(imgUrl)}');` : '';
    const reco = isRecommendedJan(p.jan);
    return `
        <button class="tp-menu-card ${railMode ? 'tp-rail-card' : ''} ${imgUrl ? 'has-photo' : ''}" style="${bgStyle}" onclick="openTouchPanelItemModal('${tpAttr(p.jan)}')">
            ${!imgUrl ? '<span class="tp-menu-card-placeholder">🍽️</span>' : ''}
            ${reco ? '<span class="tp-menu-card-badge">⭐ おすすめ</span>' : ''}
            <span class="tp-menu-card-info">
                <span class="tp-menu-card-name">${tpEsc(p.name || '(名称未設定)')}</span>
                ${typeof p.price === 'number' ? `<span class="tp-menu-card-price">¥${p.price.toLocaleString()}</span>` : ''}
            </span>
        </button>
    `;
}

function renderTouchPanelCategoryRailHtml(categories) {
    return categories.map(c => `
        <button class="tp-rail-item ${touchPanelState.activeCategory === c.key ? 'active' : ''}" onclick="selectTouchPanelCategory('${tpAttr(c.key)}')">
            <span class="tp-rail-icon">${c.icon}</span>
            <span class="tp-rail-label">${tpEsc(c.label)}</span>
        </button>
    `).join('');
}

// 【今回改訂】メニュー本体の描画を差し替え：
// ・検索中／特定ジャンル選択中 … これまで通り、写真中心の通常グリッド。
// ・「すべて」選択中（検索なし） … ジャンルごとに見出し＋横スクロール帯を
//   縦に並べる、ガストなどの本格的なタッチパネルに近い見せ方にする。
function renderTouchPanelMenuAreaHtml(productList) {
    const q = (touchPanelState.searchQuery || '').trim();
    if (q || touchPanelState.activeCategory !== 'all') {
        const filtered = filterTouchPanelProducts();
        const html = filtered.map(p => renderTouchPanelMenuCard(p, false)).join('') ||
            '<p class="tp-empty-msg">該当する商品がありません。</p>';
        return `<div class="tp-menu-grid">${html}</div>`;
    }

    // 「すべて」：ジャンルごとの横スクロール帯
    const seen = [];
    const seenSet = new Set();
    productList.forEach(p => {
        const g = (p && p.genre && String(p.genre).trim()) ? String(p.genre).trim() : 'その他';
        if (!seenSet.has(g)) { seenSet.add(g); seen.push(g); }
    });
    if (seen.length === 0) return '<p class="tp-empty-msg">商品が登録されていません。</p>';

    return seen.map(g => {
        const items = productList.filter(p => ((p.genre && String(p.genre).trim()) || 'その他') === g);
        if (items.length === 0) return '';
        return `
            <div class="tp-genre-rail-block">
                <div class="tp-genre-rail-label">${touchPanelGenreIcon(g)} ${tpEsc(g)}</div>
                <div class="tp-genre-rail">${items.map(p => renderTouchPanelMenuCard(p, true)).join('')}</div>
            </div>
        `;
    }).join('');
}

function renderTouchPanelMenuScreen() {
    touchPanelState.screen = 'menu';
    const overlay = getOrCreateTouchPanelOverlay();
    overlay.classList.add('tp-theme-menu');
    const modeLabel = touchPanelState.mode === 'staff' ? '店員用' : '客用';
    const productList = getProductListForTouchPanel();
    const isStaff = touchPanelState.mode === 'staff';

    const categories = buildTouchPanelCategoryList(productList);
    if (!categories.some(c => c.key === touchPanelState.activeCategory)) {
        touchPanelState.activeCategory = 'all';
    }

    const menuAreaHtml = renderTouchPanelMenuAreaHtml(productList);
    const bannerHtml = renderTouchPanelBannerHtml();

    overlay.innerHTML = `
        <div class="tp-topbar">
            <span class="tp-topbar-title">🍽️ ${modeLabel} － テーブル${touchPanelState.table}（${partySizeLabelForTouchPanel()}）</span>
            <div class="tp-topbar-actions">
                <button class="tp-btn tp-primary" onclick="openTouchPanelOrderHistoryModal()">📋 注文履歴</button>
                ${isStaff ? `<button class="tp-btn tp-cancel" onclick="openTouchPanelBgSettingPrompt()">🖼️ 背景設定</button>` : ''}
                <button class="tp-btn tp-call" onclick="openTouchPanelCallMenu()">🔔 店員を呼ぶ</button>
                <button class="tp-btn tp-bill" onclick="requestCheckoutFromTouchPanel()">💰 お会計</button>
                ${isStaff ? '<button class="tp-btn tp-cancel" onclick="closeTouchPanel()">キャンセル</button>' : ''}
            </div>
        </div>
        <div class="tp-body tp-menu-body tp-fade-in">
            <div class="tp-category-rail">${renderTouchPanelCategoryRailHtml(categories)}</div>
            <div class="tp-menu-main">
                <div id="tp-banner-area">${bannerHtml}</div>
                <div class="tp-search-row">
                    <input type="text" id="tp-search-input" class="tp-search-input" placeholder="🔍 メニューを検索" value="${tpAttr(touchPanelState.searchQuery || '')}" oninput="handleTouchPanelSearchInput(this.value)">
                </div>
                ${isStaff ? '<div class="tp-staff-hint">🧑‍💼 店員用モード：メニューをタップすると写真・説明文・おすすめの設定ができます</div>' : ''}
                <div id="tp-menu-area">${menuAreaHtml}</div>
            </div>
        </div>
        ${isStaff ? '' : `<div class="tp-kiosk-lock-badge tp-table-num-hidden" id="tp-kiosk-lock-badge">卓番${touchPanelState.table}</div>`}
    `;
    ensureTouchPanelCartBar();
    if (!isStaff) setupTouchPanelKioskLock();
    persistTouchPanelSessionState();
}

function selectTouchPanelCategory(key) {
    tpPlaySound('click');
    touchPanelState.activeCategory = key;
    touchPanelState.searchQuery = '';
    renderTouchPanelMenuScreen();
}

let touchPanelSearchDebounceTimer = null;
function handleTouchPanelSearchInput(value) {
    touchPanelState.searchQuery = value;
    clearTimeout(touchPanelSearchDebounceTimer);
    // 入力中の検索ボックスからフォーカスが外れないよう、メニュー部分だけを再描画する
    touchPanelSearchDebounceTimer = setTimeout(() => {
        const area = document.getElementById('tp-menu-area');
        if (!area) return;
        area.innerHTML = renderTouchPanelMenuAreaHtml(getProductListForTouchPanel());
    }, 150);
}

// 店員用モードで写真・説明文・おすすめ設定を変更した際に、ポップアップの
// 裏にあるメニュー表示／サイドバーの表示だけを更新する
// （オーバーレイ全体を再描画すると、開いているポップアップごと消えて
// しまうため、ポップアップを閉じたタイミングでこちらを呼び出す）
function refreshTouchPanelMenuGridAndRail() {
    if (!document.getElementById('tp-menu-area')) return;
    const productList = getProductListForTouchPanel();

    const categories = buildTouchPanelCategoryList(productList);
    if (!categories.some(c => c.key === touchPanelState.activeCategory)) {
        touchPanelState.activeCategory = 'all';
    }
    const rail = document.querySelector('#touch-panel-overlay .tp-category-rail');
    if (rail) rail.innerHTML = renderTouchPanelCategoryRailHtml(categories);

    const area = document.getElementById('tp-menu-area');
    if (area) area.innerHTML = renderTouchPanelMenuAreaHtml(productList);

    refreshTouchPanelPromoBannerIfVisible();
}

/* =========================================================
   ⑬ 商品詳細ポップアップ（写真・説明文・バリエーション・数量）
   ========================================================= */
function ensureTouchPanelItemModalRoot() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return null;
    let modalRoot = document.getElementById('tp-item-modal-root');
    if (!modalRoot) {
        modalRoot = document.createElement('div');
        modalRoot.id = 'tp-item-modal-root';
        overlay.appendChild(modalRoot);
    }
    return modalRoot;
}

function openTouchPanelItemModal(jan) {
    const productList = getProductListForTouchPanel();
    const product = productList.find(p => String(p.jan) === String(jan));
    if (!product) return;
    tpPlaySound('click');

    const variations = getTouchPanelVariations(jan);
    touchPanelState.modalDraft = {
        jan: product.jan,
        variation: (Array.isArray(variations) && variations.length > 0) ? variations[0] : null,
        qty: 1
    };
    renderTouchPanelItemModal(product, variations);
}

function renderTouchPanelItemModal(product, variations) {
    const modalRoot = ensureTouchPanelItemModalRoot();
    const draft = touchPanelState.modalDraft;
    if (!modalRoot || !draft) return;

    const imgUrl = getTouchPanelProductImg(product.jan);
    const desc = getTouchPanelDesc(product.jan);
    const isStaff = touchPanelState.mode === 'staff';
    const priceEach = typeof product.price === 'number' ? product.price : 0;
    const total = priceEach * draft.qty;
    const reco = isRecommendedJan(product.jan);

    const variationHtml = (Array.isArray(variations) && variations.length > 0) ? `
        <div class="tp-modal-section-label">サイズ・種類を選んでください</div>
        <div class="tp-modal-variations">
            ${variations.map(v => `<button class="tp-chip ${draft.variation === v ? 'active' : ''}" onclick="selectTouchPanelModalVariation('${tpAttr(v)}')">${tpEsc(v)}</button>`).join('')}
        </div>
    ` : '';

    const staffHtml = isStaff ? `
        <div class="tp-modal-staff-box">
            <div class="tp-modal-section-label" style="margin-top:0;">🧑‍💼 店員用設定</div>
            <div class="tp-modal-staff-actions">
                <button class="tp-btn tp-cancel" onclick="setTouchPanelProductImgPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🖼️ 写真を設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelProductImgUrlPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🔗 URLで設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelDescPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">📝 説明文を設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelVariationsPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🔀 バリエーション設定</button>
                <button class="tp-btn ${reco ? 'tp-reco-on' : 'tp-cancel'}" onclick="toggleRecommendedJan('${tpAttr(product.jan)}')">⭐ ${reco ? 'おすすめ解除' : 'おすすめに追加'}</button>
            </div>
        </div>
    ` : '';

    modalRoot.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelItemModal()"></div>
        <div class="tp-item-modal tp-slide-up">
            <div class="tp-item-modal-drag-handle"></div>
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeTouchPanelItemModal()">×</button>
            <div class="tp-item-modal-photo" style="${imgUrl ? `background-image:url('${tpCssStr(imgUrl)}');` : ''}">
                ${imgUrl ? '' : '<span class="tp-item-modal-photo-placeholder">🍽️</span>'}
                ${reco ? '<span class="tp-badge-reco">⭐ おすすめ</span>' : ''}
            </div>
            <div class="tp-item-modal-body">
                <div class="tp-item-modal-name">${tpEsc(product.name || '(名称未設定)')}</div>
                ${desc ? `<div class="tp-item-modal-desc">${tpEsc(desc)}</div>` : ''}
                <div class="tp-item-modal-price">¥${priceEach.toLocaleString()}</div>
                ${variationHtml}
                <div class="tp-modal-section-label">数量</div>
                <div class="tp-qty-stepper">
                    <button onclick="changeTouchPanelModalQty(-1)" aria-label="数量を減らす">－</button>
                    <span id="tp-modal-qty">${draft.qty}</span>
                    <button onclick="changeTouchPanelModalQty(1)" aria-label="数量を増やす">＋</button>
                </div>
                ${staffHtml}
                <button class="tp-btn tp-confirm tp-modal-add-btn" onclick="confirmAddTouchPanelModalItem()">🛒 カートに追加（¥${total.toLocaleString()}）</button>
            </div>
        </div>
    `;
}

function refreshTouchPanelItemModal() {
    const draft = touchPanelState.modalDraft;
    if (!draft) return;
    const productList = getProductListForTouchPanel();
    const product = productList.find(p => String(p.jan) === String(draft.jan));
    if (!product) {
        closeTouchPanelItemModal();
        return;
    }
    renderTouchPanelItemModal(product, getTouchPanelVariations(draft.jan));
}

function changeTouchPanelModalQty(delta) {
    const draft = touchPanelState.modalDraft;
    if (!draft) return;
    draft.qty = Math.max(1, draft.qty + delta);
    tpPlaySound('click');
    refreshTouchPanelItemModal();
}

function selectTouchPanelModalVariation(v) {
    const draft = touchPanelState.modalDraft;
    if (!draft) return;
    draft.variation = v;
    tpPlaySound('click');
    refreshTouchPanelItemModal();
}

function confirmAddTouchPanelModalItem() {
    const draft = touchPanelState.modalDraft;
    if (!draft) return;
    const productList = getProductListForTouchPanel();
    const product = productList.find(p => String(p.jan) === String(draft.jan));
    if (!product) return;

    addItemToTouchPanelOrder(product, draft.variation, draft.qty);
    tpPlaySound('success');
    showTouchPanelToast(`🛒 ${product.name}をカートに追加しました`);
    closeTouchPanelItemModal();
    bumpTouchPanelCartBar();
    showTouchPanelCartFlyEffect();
}

function closeTouchPanelItemModal() {
    const modalRoot = document.getElementById('tp-item-modal-root');
    if (modalRoot) modalRoot.remove();
    touchPanelState.modalDraft = null;
    refreshTouchPanelMenuGridAndRail();
}

/* =========================================================
   ⑭ カート（注文かごバー・カートドロワー）
   ========================================================= */
function addItemToTouchPanelOrder(product, variation, qty) {
    qty = qty || 1;
    const existing = touchPanelState.order.find(i => i.jan === product.jan && i.variation === variation);
    if (existing) {
        existing.qty += qty;
    } else {
        touchPanelState.order.push({
            jan: product.jan,
            name: product.name,
            price: typeof product.price === 'number' ? product.price : 0,
            variation: variation || null,
            qty: qty
        });
    }
    renderTouchPanelOrderList();
}

function changeTouchPanelOrderQty(index, delta) {
    const item = touchPanelState.order[index];
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) touchPanelState.order.splice(index, 1);
    tpPlaySound('click');
    renderTouchPanelOrderList();
}

// 注文内容に変更があるたびに呼び出す。かごバーの件数・金額を更新し、
// カートドロワーが開いていればその中身も一緒に更新する。
function renderTouchPanelOrderList() {
    updateTouchPanelCartBar();
    if (document.getElementById('tp-cart-drawer-root')) {
        renderTouchPanelCartDrawer();
    }
    persistTouchPanelSessionState();
}

function ensureTouchPanelCartBar() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let bar = document.getElementById('tp-cart-bar');
    if (!bar) {
        bar = document.createElement('button');
        bar.id = 'tp-cart-bar';
        bar.type = 'button';
        bar.onclick = openTouchPanelCartDrawer;
        overlay.appendChild(bar);
    }
    // 客用モードでは左下に脱出防止バッジを表示するため、かごバーを
    // その分だけ右にずらして重ならないようにする
    bar.className = 'tp-cart-bar' + (touchPanelState.mode === 'staff' ? '' : ' tp-cart-bar-shifted');
    updateTouchPanelCartBar();
}

function updateTouchPanelCartBar() {
    const bar = document.getElementById('tp-cart-bar');
    if (!bar) return;
    const count = touchPanelState.order.reduce((s, i) => s + i.qty, 0);
    const total = touchPanelState.order.reduce((s, i) => s + i.price * i.qty, 0);
    bar.style.display = count > 0 ? 'flex' : 'none';
    bar.innerHTML = `
        <span class="tp-cart-bar-icon">🛒<span class="tp-cart-bar-badge">${count}</span></span>
        <span class="tp-cart-bar-total">合計 ¥${total.toLocaleString()}</span>
        <span class="tp-cart-bar-label">注文かごを見る</span>
    `;
}

function bumpTouchPanelCartBar() {
    const bar = document.getElementById('tp-cart-bar');
    if (!bar) return;
    bar.classList.remove('tp-bump');
    void bar.offsetWidth; // アニメーションを再生し直すための強制リフロー
    bar.classList.add('tp-bump');
}

// 【今回追加】カートに追加した瞬間、かごバーの上に「+1」が浮き上がって
// 消えるアニメーションを表示する（追加したことを直感的に分かりやすくする）
function showTouchPanelCartFlyEffect() {
    const bar = document.getElementById('tp-cart-bar');
    const overlay = document.getElementById('touch-panel-overlay');
    if (!bar || !overlay) return;
    const barRect = bar.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'tp-fly-plus-one';
    el.textContent = '+1';
    el.style.left = (barRect.left - overlayRect.left + 26) + 'px';
    el.style.top = (barRect.top - overlayRect.top) + 'px';
    overlay.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 750);
}

function ensureTouchPanelCartDrawerRoot() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return null;
    let drawer = document.getElementById('tp-cart-drawer-root');
    if (!drawer) {
        drawer = document.createElement('div');
        drawer.id = 'tp-cart-drawer-root';
        overlay.appendChild(drawer);
    }
    return drawer;
}

function openTouchPanelCartDrawer() {
    tpPlaySound('click');
    ensureTouchPanelCartDrawerRoot();
    renderTouchPanelCartDrawer();
}

function closeTouchPanelCartDrawer() {
    const drawer = document.getElementById('tp-cart-drawer-root');
    if (drawer) drawer.remove();
}

function renderTouchPanelCartDrawer() {
    const drawer = ensureTouchPanelCartDrawerRoot();
    if (!drawer) return;

    const total = touchPanelState.order.reduce((s, i) => s + i.price * i.qty, 0);
    const rowsHtml = touchPanelState.order.length === 0
        ? '<p class="tp-cart-empty">まだ注文がありません。メニューをタップして追加してください。</p>'
        : touchPanelState.order.map((item, idx) => `
            <div class="tp-cart-row">
                <div>
                    <div class="tp-cart-row-name">${tpEsc(item.name)}${item.variation ? `<span class="tp-cart-row-variation">（${tpEsc(item.variation)}）</span>` : ''}</div>
                    <div class="tp-cart-row-price">¥${(item.price * item.qty).toLocaleString()}</div>
                </div>
                <div class="tp-cart-row-qty">
                    <button onclick="changeTouchPanelOrderQty(${idx}, -1)" aria-label="数量を減らす">－</button>
                    <span>${item.qty}</span>
                    <button onclick="changeTouchPanelOrderQty(${idx}, 1)" aria-label="数量を増やす">＋</button>
                </div>
            </div>
        `).join('');

    drawer.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelCartDrawer()"></div>
        <div class="tp-cart-drawer tp-slide-up">
            <div class="tp-cart-drawer-header">
                <span>📋 ご注文内容${tableLabelForTouchPanel()}</span>
                <button class="tp-modal-close" aria-label="閉じる" style="position:static;" onclick="closeTouchPanelCartDrawer()">×</button>
            </div>
            <div class="tp-cart-drawer-list">${rowsHtml}</div>
            <div class="tp-cart-drawer-footer">
                <div class="tp-cart-drawer-total">合計 ¥${total.toLocaleString()}</div>
                <button class="tp-btn tp-confirm tp-cart-submit-btn" onclick="submitTouchPanelOrder()">📨 この内容で注文する</button>
            </div>
        </div>
    `;
}

/* =========================================================
   ⑭-2【今回追加】注文履歴（このテーブルでこれまでに送信した注文の一覧）
   ------------------------------------------
   「注文履歴見れるように」という要望に対応する。カートドロワーと
   同じボトムシートの見た目で、このテーブルのセッション中（テーブルを
   選んでから、お会計後に店員がリセットするまでの間）に送信した
   注文をすべて新しい順に一覧表示する。まだ送信していない
   （カートに入っているだけの）内容はここには出ない
   （そちらは従来通り「注文かごを見る」で確認する）。
   ========================================================= */
function formatTouchPanelOrderTime(iso) {
    try {
        const d = new Date(iso);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (e) {
        return '';
    }
}

function ensureTouchPanelOrderHistoryRoot() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return null;
    let root = document.getElementById('tp-order-history-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-order-history-root';
        overlay.appendChild(root);
    }
    return root;
}

function openTouchPanelOrderHistoryModal() {
    tpPlaySound('click');
    if (!ensureTouchPanelOrderHistoryRoot()) return;
    renderTouchPanelOrderHistoryModal();
}

function closeTouchPanelOrderHistoryModal() {
    const root = document.getElementById('tp-order-history-root');
    if (root) root.remove();
}

function renderTouchPanelOrderHistoryModal() {
    const root = document.getElementById('tp-order-history-root');
    if (!root) return;

    const orders = touchPanelState.sentOrders || [];
    const grandTotal = orders.reduce((s, o) => s + o.total, 0);

    const listHtml = orders.length === 0
        ? '<p class="tp-cart-empty">まだご注文の送信履歴がありません。</p>'
        : orders.slice().reverse().map(o => `
            <div class="tp-order-history-block">
                <div class="tp-order-history-time">⏱️ ${formatTouchPanelOrderTime(o.time)} に送信</div>
                ${o.items.map(item => `
                    <div class="tp-cart-row">
                        <div>
                            <div class="tp-cart-row-name">${tpEsc(item.name)}${item.variation ? `<span class="tp-cart-row-variation">（${tpEsc(item.variation)}）</span>` : ''}</div>
                            <div class="tp-cart-row-price">¥${(item.price * item.qty).toLocaleString()}</div>
                        </div>
                        <div class="tp-order-history-qty">× ${item.qty}</div>
                    </div>
                `).join('')}
                <div class="tp-order-history-subtotal">小計 ¥${o.total.toLocaleString()}</div>
            </div>
        `).join('');

    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelOrderHistoryModal()"></div>
        <div class="tp-cart-drawer tp-slide-up">
            <div class="tp-cart-drawer-header">
                <span>📋 ご注文履歴${tableLabelForTouchPanel()}</span>
                <button class="tp-modal-close" aria-label="閉じる" style="position:static;" onclick="closeTouchPanelOrderHistoryModal()">×</button>
            </div>
            <div class="tp-cart-drawer-list">${listHtml}</div>
            <div class="tp-cart-drawer-footer">
                <div class="tp-cart-drawer-total">これまでのご注文合計 ¥${grandTotal.toLocaleString()}</div>
            </div>
        </div>
    `;
}

/* =========================================================
   ⑮ 送信 → 自動化バーコード一覧へ（使い切りバーコードとして登録）
   ------------------------------------------
   毎回 generateTouchPanelBarcode() で新規のバーコードを採番して登録する
   ため、同じテーブルから重ねて送信しても、既存の登録が上書きされることは
   なく、別々の注文として一覧に積み重なっていく。送信後はアニメーション
   付きの完了画面を表示したのち、同じテーブルのメニュー画面へ自動的に
   戻る（続けて追加注文できるよう、タッチパネル自体は閉じない）。
   ========================================================= */
function submitTouchPanelOrder() {
    if (touchPanelState.order.length === 0) {
        tpPlaySound('error');
        showTouchPanelToast('⚠️ 注文内容がありません');
        return;
    }

    tpPlaySound('success');
    const barcode = generateTouchPanelBarcode('TBL');
    const summary = touchPanelState.order
        .map(i => `${i.name}${i.variation ? `(${i.variation})` : ''}x${i.qty}`)
        .join('、');
    const name = `🍽️ テーブル${touchPanelState.table}（${partySizeLabelForTouchPanel()}）注文：${summary}`;

    const ok = registerAutomationBarcodeViaForm({
        barcode,
        name,
        items: touchPanelState.order,
        oneTime: true
    });

    if (ok) {
        tpSpeak('ちゅうもん を そうしん し まし た');
        // 【今回追加】「注文履歴」画面で振り返れるよう、送信した内容を記録しておく
        touchPanelState.sentOrders.push({
            time: new Date().toISOString(),
            items: JSON.parse(JSON.stringify(touchPanelState.order)),
            total: touchPanelState.order.reduce((s, i) => s + i.price * i.qty, 0)
        });
        closeTouchPanelCartDrawer();
        touchPanelState.order = [];
        persistTouchPanelSessionState();
        showTouchPanelOrderCompleteOverlay();
    } else {
        showTouchPanelToast('⚠️ 送信に失敗しました');
    }
}

// 【今回追加】注文完了オーバーレイでも「テーブル使用中」を明示する
// ------------------------------------------
// これまでは、テーブルが使用中（占有済み）であっても、注文送信後の
// 「ご注文ありがとうございます！」画面にはそのことが一切表示されず、
// お客様や周囲から見て今このテーブルが使用中なのかどうかが分かり
// づらかった。テーブルが使用中の場合にかぎり、お会計希望後の
// 「ありがとうございました」画面と同じ文言のバッジを併せて表示する
// （店員用モードなどでテーブルが使用中扱いになっていない場合は
// 表示しない）。実際の「会計後」（店員がお会計後の画面を長押しで
// リセットした後）は、この注文完了オーバーレイ自体をもう表示しない
// （人数選択画面に切り替わる）ため、このバッジも自然に出なくなる。
function showTouchPanelOrderCompleteOverlay() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-complete-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-complete-root';
        overlay.appendChild(root);
    }
    const occupiedBadgeHtml = isTouchPanelTableOccupied(touchPanelState.table)
        ? '<div class="tp-table-occupied-badge tp-table-occupied-badge-light">🍽️ テーブル使用中です</div>'
        : '';
    root.innerHTML = `
        <div class="tp-complete-check">✅</div>
        <div class="tp-complete-text">ご注文ありがとうございます！</div>
        <div class="tp-complete-sub">引き続きメニューからご注文いただけます</div>
        ${occupiedBadgeHtml}
    `;
    setTimeout(() => {
        const r = document.getElementById('tp-complete-root');
        if (r) r.remove();
        if (document.getElementById('touch-panel-overlay')) {
            renderTouchPanelMenuScreen();
        }
    }, 2200);
}

/* =========================================================
   ⑯ 客用モードの脱出防止（キオスクロック）
   ------------------------------------------
   客用モード（テーブル選択画面・メニュー画面）では、通常の
   「キャンセル」ボタンを表示しない。かわりに画面左下へ、一見ただの
   表示に見える小さなバッジを置き、これを長押し（約1.1秒）した場合
   のみ暗証番号の入力画面を表示する。正しい暗証番号
   （TOUCH_PANEL_KIOSK_PIN）を入力すると「本当に注文を削除しますか？」
   の確認ダイアログが出て、「はい」を押した場合にかぎり、注文内容を
   削除したうえでタッチパネルを終了し、元の画面（レジホーム画面）へ
   戻る。これ以外の操作でお客様がタッチパネルから抜け出す手段は無い。
   ========================================================= */
function attachTouchPanelLongPress(el, durationMs, onLongPress) {
    if (!el) return;
    let timer = null;
    const start = (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { onLongPress(); }, durationMs);
    };
    const cancel = () => { clearTimeout(timer); };
    el.addEventListener('mousedown', start);
    el.addEventListener('touchstart', start, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(evt => el.addEventListener(evt, cancel));
    // 通常のタップ（クリック）では何も起きないようにする
    el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    // 長押し時にブラウザ標準のコンテキストメニューが出ないようにする
    el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setupTouchPanelKioskLock() {
    const badge = document.getElementById('tp-kiosk-lock-badge');
    attachTouchPanelLongPress(badge, TOUCH_PANEL_KIOSK_LONGPRESS_MS, openTouchPanelKioskPinModal);
}

let touchPanelKioskPinInput = '';

function openTouchPanelKioskPinModal() {
    tpPlaySound('click');
    touchPanelKioskPinInput = '';
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-kiosk-pin-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-kiosk-pin-root';
        overlay.appendChild(root);
    }
    renderTouchPanelKioskPinModal(false);
}

function closeTouchPanelKioskPinModal() {
    const root = document.getElementById('tp-kiosk-pin-root');
    if (root) root.remove();
    touchPanelKioskPinInput = '';
}

function renderTouchPanelKioskPinModal(shake) {
    const root = document.getElementById('tp-kiosk-pin-root');
    if (!root) return;

    const dotsHtml = [0, 1, 2, 3].map(i => `<span class="tp-pin-dot ${i < touchPanelKioskPinInput.length ? 'filled' : ''}"></span>`).join('');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    const keysHtml = keys.map(k => {
        if (k === '') return '<span></span>';
        if (k === '⌫') return `<button onclick="pressTouchPanelPinBackspace()" aria-label="1文字削除">⌫</button>`;
        return `<button onclick="pressTouchPanelPinDigit('${k}')">${k}</button>`;
    }).join('');

    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelKioskPinModal()"></div>
        <div class="tp-pin-modal tp-pop ${shake ? 'tp-shake' : ''}">
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeTouchPanelKioskPinModal()">×</button>
            <div class="tp-pin-title">🔒 店員確認</div>
            <div class="tp-pin-sub">暗証番号を入力してください</div>
            <div class="tp-pin-dots">${dotsHtml}</div>
            <div class="tp-pin-keypad">${keysHtml}</div>
        </div>
    `;
}

function pressTouchPanelPinDigit(d) {
    if (touchPanelKioskPinInput.length >= 4) return;
    tpPlaySound('click');
    touchPanelKioskPinInput += d;
    renderTouchPanelKioskPinModal(false);
    if (touchPanelKioskPinInput.length === 4) {
        setTimeout(checkTouchPanelKioskPin, 150);
    }
}

function pressTouchPanelPinBackspace() {
    tpPlaySound('click');
    touchPanelKioskPinInput = touchPanelKioskPinInput.slice(0, -1);
    renderTouchPanelKioskPinModal(false);
}

function checkTouchPanelKioskPin() {
    if (!document.getElementById('tp-kiosk-pin-root')) return;
    if (touchPanelKioskPinInput === TOUCH_PANEL_KIOSK_PIN) {
        closeTouchPanelKioskPinModal();
        openTouchPanelKioskActionChoice();
    } else {
        tpPlaySound('error');
        renderTouchPanelKioskPinModal(true);
        setTimeout(() => {
            touchPanelKioskPinInput = '';
            renderTouchPanelKioskPinModal(false);
        }, 500);
    }
}

// 【今回追加】暗証番号が正しかった後、いきなり削除確認へは進まず、
// 「メニュー変更（背景・商品写真の設定）」か「削除（注文取消・退出）」
// のどちらをしたいかをまず選べるようにする。
function openTouchPanelKioskActionChoice() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-kiosk-action-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-kiosk-action-root';
        overlay.appendChild(root);
    }
    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelKioskActionChoice()"></div>
        <div class="tp-pin-modal tp-pop">
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeTouchPanelKioskActionChoice()">×</button>
            <div class="tp-pin-title">🔒 店員確認OK</div>
            <div class="tp-pin-sub">どちらの操作をしますか？</div>
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:14px;">
                <button class="tp-btn tp-primary" style="width:100%;" onclick="closeTouchPanelKioskActionChoice(); openTouchPanelBgSettingModal();">🖼️ メニュー変更（背景・商品写真）</button>
                <button class="tp-btn tp-confirm" style="width:100%; background:#c62828;" onclick="closeTouchPanelKioskActionChoice(); openTouchPanelKioskExitConfirm();">🗑️ 削除（注文取消・退出）</button>
            </div>
        </div>
    `;
}

function closeTouchPanelKioskActionChoice() {
    const root = document.getElementById('tp-kiosk-action-root');
    if (root) root.remove();
}

function openTouchPanelKioskExitConfirm() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    let root = document.getElementById('tp-kiosk-exit-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'tp-kiosk-exit-root';
        overlay.appendChild(root);
    }
    root.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelKioskExitConfirm()"></div>
        <div class="tp-pin-modal tp-pop">
            <div class="tp-pin-title">本当に注文を削除しますか？</div>
            <div class="tp-kiosk-warning">※店員以外は絶対に押さないでください</div>
            <div style="display:flex; gap:10px; margin-top:16px;">
                <button class="tp-btn tp-cancel" style="flex:1;" onclick="closeTouchPanelKioskExitConfirm()">いいえ</button>
                <button class="tp-btn tp-confirm" style="flex:1; background:#c62828;" onclick="confirmTouchPanelKioskExit()">はい、削除する</button>
            </div>
        </div>
    `;
}

function closeTouchPanelKioskExitConfirm() {
    const root = document.getElementById('tp-kiosk-exit-root');
    if (root) root.remove();
}

function confirmTouchPanelKioskExit() {
    tpPlaySound('click');
    closeTouchPanelKioskExitConfirm();
    // 注文内容を削除したうえでタッチパネルごと終了し、元の画面へ戻る
    closeTouchPanel();
}

/* =========================================================
   ⑰ ホーム画面：「会員・顧客管理」ボタンを半分幅にして
      右に「🍽️ タッチパネル注文」ボタンを追加する
   ========================================================= */
function ensureTouchPanelHomeButton() {
    const memberBtn = document.querySelector('.home-btn-customer-mgmt');
    if (!memberBtn) return;
    memberBtn.classList.remove('full');

    if (document.getElementById('touch-panel-home-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'touch-panel-home-btn';
    btn.className = 'home-btn';
    btn.style.cssText = 'background: linear-gradient(to bottom, #ff8a50, #d64526); border-color: #b23217;';
    btn.innerHTML = '🍽️ タッチパネル注文';
    btn.onclick = openTouchPanelSelectModal;
    memberBtn.insertAdjacentElement('afterend', btn);
}

document.addEventListener('DOMContentLoaded', ensureTouchPanelHomeButton);

/* =========================================================
   【今回追加】ページ読み込み時、電源断などで中断していた
   タッチパネルのセッションがあれば自動的に復帰する。
   商品データなど他の初期化処理が終わっているタイミングで判定したいため、
   少し待ってから実行する。
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(resumeTouchPanelSessionIfAny, 800);
});

(function hookShowScreenForTouchPanelHomeButton() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            ensureTouchPanelHomeButton();
            return result;
        };
    }
    tryHook();
})();
