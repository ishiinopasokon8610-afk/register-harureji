// ==========================================
// 会員ランク制度（レギュラー / シルバー / ゴールド / ダイヤモンド）
// ------------------------------------------
// ・年間購入金額に応じて4段階のランクを自動判定
// ・ランクごとにポイント還元率が変わる
// ・ランク判定は「毎月1回」行い「翌月から反映」される
// ・ランクダウン該当時は「あと1回の来店でランクキープ」の猶予を1回だけ付与
// ==========================================

const MEMBER_RANKS = [
    { key: 'regular', name: 'レギュラー',   color: '#78909c', threshold: 0,      rate: 0.5, discountRate: 0, benefit: '特典なし' },
    { key: 'silver',  name: 'シルバー',     color: '#90a4ae', threshold: 30000,  rate: 1.0, discountRate: 0, benefit: 'バースデークーポン' },
    { key: 'gold',    name: 'ゴールド',     color: '#ffb300', threshold: 100000, rate: 2.0, discountRate: 3, benefit: '会員限定セール招待・会計時3%自動割引' },
    { key: 'diamond', name: 'ダイヤモンド', color: '#26c6da', threshold: 300000, rate: 3.0, discountRate: 5, benefit: '送料無料・先行予約権・会計時5%自動割引' }
];

function getMemberRankIndex(rankKey) {
    const idx = MEMBER_RANKS.findIndex(r => r.key === rankKey);
    return idx === -1 ? 0 : idx;
}

// 金額から「本来あるべきランク」を計算（毎月の判定に使用）
function calcRankByAmount(amount) {
    let rank = MEMBER_RANKS[0];
    for (const r of MEMBER_RANKS) {
        if (amount >= r.threshold) rank = r;
    }
    return rank;
}

// 会員データにランク関連フィールドが無ければ初期化する
function ensureCustomerRankFields(cust) {
    if (!cust) return cust;
    if (typeof cust.annualPurchase !== 'number') cust.annualPurchase = 0;
    if (!cust.rank) cust.rank = 'regular';
    if (!cust.rankEvalMonth) cust.rankEvalMonth = null; // 最後にランク判定した "YYYY-MM"
    if (typeof cust.rankGrace !== 'number') cust.rankGrace = 0; // ランクダウン猶予の残り回数
    if (typeof cust.rankResetYear !== 'number') cust.rankResetYear = new Date().getFullYear();
    return cust;
}

// 現在「確定している」ランク情報を取得
// ------------------------------------------
// 【不具合修正】以前はここで maybeEvaluateMonthlyRank() を呼んでいなかったため、
// 「会計する」まで月次判定が走らず、月が変わってもレジ画面のバッジや
// 会員管理画面の一覧が古いランクのまま表示され続けていた（＝購入があるまで
// 昇格しないように見えてしまっていた）。
// ランク情報を「見る」タイミングであれば必ず最新の判定を先に行うようにする。
function getCustomerRankInfo(cust) {
    ensureCustomerRankFields(cust);
    maybeEvaluateMonthlyRank(cust);
    return MEMBER_RANKS[getMemberRankIndex(cust.rank)];
}

// 次のランク情報（最上位なら null）
function getNextRankInfo(cust) {
    ensureCustomerRankFields(cust);
    const idx = getMemberRankIndex(cust.rank);
    return MEMBER_RANKS[idx + 1] || null;
}

// 毎月1回のランク判定（翌月反映）＋ ランクダウン猶予処理
function maybeEvaluateMonthlyRank(cust) {
    ensureCustomerRankFields(cust);
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (cust.rankEvalMonth === ym) return; // 今月はすでに判定済み

    // 1月になったら年間購入金額をリセット（新しい年度の集計を開始）
    if (now.getMonth() === 0 && cust.rankResetYear !== now.getFullYear()) {
        cust.annualPurchase = 0;
        cust.rankResetYear = now.getFullYear();
    }

    const calculatedRank = calcRankByAmount(cust.annualPurchase);
    const currentIdx = getMemberRankIndex(cust.rank);
    const calcIdx = getMemberRankIndex(calculatedRank.key);
    const rankBefore = cust.rank;

    if (calcIdx >= currentIdx) {
        // 現状維持 または ランクアップ → そのまま反映し、猶予をリセット
        cust.rank = calculatedRank.key;
        cust.rankGrace = 0;
    } else {
        // 本来はランクダウンだが、猶予（あと1回の来店でランクキープ）を先に使う
        if (cust.rankGrace < 1) {
            cust.rankGrace += 1; // 今回は猶予でランクキープ
        } else {
            cust.rank = calculatedRank.key; // 猶予を使い切ったのでランクダウン確定
            cust.rankGrace = 0;
        }
    }
    cust.rankEvalMonth = ym;

    // 【不具合修正】この判定は会計（addPurchaseAndGetRewardRate）だけでなく
    // getCustomerRankInfo() 経由（＝ただ画面に表示しただけ）でも走るようになったため、
    // ランクが変わった場合はその場でlocalStorageにも保存しておく。
    // そうしないと、会計せずに閲覧しただけではメモリ上のcustomersは更新されても
    // pos_customersは古いままになり、ページ再読み込みや他端末との同期で
    // 判定結果が失われてしまう（＝購入するまで昇格が「なかったこと」になる）。
    if (cust.rank !== rankBefore) {
        persistCustomerRankChange(cust);
    }
}

// ランク判定の結果をlocalStorage（および他端末）へ反映する
function persistCustomerRankChange(cust) {
    if (typeof customers === 'undefined' || !Array.isArray(customers) || !cust) return;
    const idx = customers.findIndex(c => c === cust || (cust.barcode && c.barcode === cust.barcode));
    if (idx === -1) return;
    customers[idx] = cust;
    try {
        localStorage.setItem('pos_customers', JSON.stringify(customers));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    } catch (e) {
        console.warn('会員ランク判定結果の保存に失敗しました:', e);
    }
}

// 購入時に呼び出す：年間購入額に加算し、その場でのポイント付与率（％）を返す
// ※ 付与率は「現在確定しているランク」の値を使用（毎月判定・翌月反映のルールのため）
function addPurchaseAndGetRewardRate(cust, amount) {
    ensureCustomerRankFields(cust);
    maybeEvaluateMonthlyRank(cust); // 来店時に判定タイミングが来ていれば先に判定
    const rate = getCustomerRankInfo(cust).rate;
    if (amount > 0) cust.annualPurchase += amount;
    return rate;
}

// レジ画面：会員バーコードをスキャンした際の「ランクアップまであと〇円」ナビゲーション文言
function buildRankNavText(cust) {
    ensureCustomerRankFields(cust);
    const next = getNextRankInfo(cust);
    if (!next) return '最上位ランクです。いつもご利用ありがとうございます！';
    const remain = next.threshold - cust.annualPurchase;
    if (remain > 0) {
        return `あと¥${remain.toLocaleString()}で${next.name}ランクアップです`;
    }
    return `${next.name}ランクの条件を満たしています（来月から反映）`;
}
