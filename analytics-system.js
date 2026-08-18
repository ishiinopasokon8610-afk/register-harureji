// ==========================================
// ハイテク音声レジスター - 売上分析機能
// お会計履歴（pos_history）を集計し、
//   ① 一番売れた商品
//   ② 一番多い年齢層（ポイントカード会員の年齢から）
//   ③ 一番売れた日
// を「本日 / 週間（直近7日）/ 月間（今月）」の3つの期間で確認できる。
// ==========================================

let currentAnalyticsPeriod = 'day';

function openAnalyticsScreen() {
    if (typeof playSound === 'function') playSound('click');
    if (typeof showScreen === 'function') showScreen('analytics-screen');
}

function switchAnalyticsPeriod(period) {
    if (typeof playSound === 'function') playSound('click');
    currentAnalyticsPeriod = period;
    renderAnalytics();
}

// 期間の開始・終了時刻（タイムスタンプ）を計算
function getAnalyticsDateRange(period) {
    const now = new Date();
    let start;
    if (period === 'week') {
        // 今日を含む直近7日間
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0);
    } else if (period === 'month') {
        // 今月の1日から
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    } else {
        // 本日の0時から
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    }
    return { start: start.getTime(), end: now.getTime() };
}

function getFilteredHistoryForAnalytics(period) {
    const historyData = JSON.parse(localStorage.getItem('pos_history') || '[]');
    const { start, end } = getAnalyticsDateRange(period);
    return historyData.filter(item => {
        const t = item.dateISO ? new Date(item.dateISO).getTime() : (item.date ? new Date(item.date).getTime() : NaN);
        if (isNaN(t)) return false;
        return t >= start && t <= end;
    });
}

/* =========================================================
   集計ロジック
   ========================================================= */

// ① 一番売れた商品（値引き行は集計対象外）
function calcBestSellingProduct(historyList) {
    const qtyMap = {};
    historyList.forEach(item => {
        if (!Array.isArray(item.cartSnapshot)) return; // 分析対応前の古いデータはスキップ
        item.cartSnapshot.forEach(line => {
            if (!line || !line.name) return;
            if (line.price < 0 || line.genre === '値引き/その他') return;
            qtyMap[line.name] = (qtyMap[line.name] || 0) + (line.qty || 1);
        });
    });
    let best = null;
    Object.entries(qtyMap).forEach(([name, qty]) => {
        if (!best || qty > best.qty) best = { name, qty };
    });
    return best;
}

// ② 一番多い年齢層（ポイントカード会員の購入時点の年齢から集計）
const ANALYTICS_AGE_BRACKETS = [
    { label: '10代以下', min: 0, max: 19 },
    { label: '20代', min: 20, max: 29 },
    { label: '30代', min: 30, max: 39 },
    { label: '40代', min: 40, max: 49 },
    { label: '50代', min: 50, max: 59 },
    { label: '60代以上', min: 60, max: 999 }
];

function calcBestAgeBracket(historyList) {
    const countMap = {};
    historyList.forEach(item => {
        if (item.customerAge === null || item.customerAge === undefined) return;
        const bracket = ANALYTICS_AGE_BRACKETS.find(b => item.customerAge >= b.min && item.customerAge <= b.max);
        if (!bracket) return;
        countMap[bracket.label] = (countMap[bracket.label] || 0) + 1;
    });
    let best = null;
    let totalWithAge = 0;
    Object.values(countMap).forEach(c => { totalWithAge += c; });
    Object.entries(countMap).forEach(([label, count]) => {
        if (!best || count > best.count) best = { label, count };
    });
    if (best) best.total = totalWithAge;
    return best;
}

// ③ 一番売れた日（合計金額が一番高い日）
function calcBestSellingDay(historyList) {
    const dayMap = {};
    historyList.forEach(item => {
        const t = item.dateISO ? new Date(item.dateISO) : (item.date ? new Date(item.date) : null);
        if (!t || isNaN(t.getTime())) return;
        const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        if (!dayMap[key]) dayMap[key] = { total: 0, count: 0, dateObj: t };
        dayMap[key].total += (item.total || 0);
        dayMap[key].count += 1;
    });
    let best = null;
    Object.entries(dayMap).forEach(([key, data]) => {
        if (!best || data.total > best.total) best = data;
    });
    if (!best) return null;
    const d = best.dateObj;
    const youbi = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return { dateLabel: `${d.getMonth() + 1}月${d.getDate()}日（${youbi}）`, total: best.total, count: best.count };
}

/* =========================================================
   描画
   ========================================================= */
function renderAnalytics() {
    // タブの見た目を切り替え
    ['day', 'week', 'month'].forEach(p => {
        const btn = document.getElementById(`analytics-tab-${p}`);
        if (btn) btn.style.background = (p === currentAnalyticsPeriod) ? '#00695c' : '#78909c';
    });

    const container = document.getElementById('analytics-content');
    if (!container) return;

    const filtered = getFilteredHistoryForAnalytics(currentAnalyticsPeriod);

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#999; padding:40px;">この期間の会計データがありません</div>';
        return;
    }

    const bestProduct = calcBestSellingProduct(filtered);
    const bestAgeBracket = calcBestAgeBracket(filtered);
    const bestDay = calcBestSellingDay(filtered);

    const safeName = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : s;

    container.innerHTML = `
        <div class="analytics-card">
            <div class="analytics-card-title">🏆 一番売れた商品</div>
            <div class="analytics-card-main">${bestProduct ? safeName(bestProduct.name) : 'データがありません'}</div>
            ${bestProduct ? `<div class="analytics-card-sub">${bestProduct.qty.toLocaleString()}個 販売</div>` : '<div class="analytics-card-sub">まだ商品明細のあるデータがありません</div>'}
        </div>
        <div class="analytics-card">
            <div class="analytics-card-title">👥 一番多い年齢層（ポイントカード会員）</div>
            <div class="analytics-card-main">${bestAgeBracket ? bestAgeBracket.label : 'データがありません'}</div>
            ${bestAgeBracket ? `<div class="analytics-card-sub">${bestAgeBracket.count.toLocaleString()}件 来店（会員全体 ${bestAgeBracket.total}件中）</div>` : '<div class="analytics-card-sub">ポイントカード会員のお会計データがありません</div>'}
        </div>
        <div class="analytics-card">
            <div class="analytics-card-title">📅 一番売れた日</div>
            <div class="analytics-card-main">${bestDay ? bestDay.dateLabel : 'データがありません'}</div>
            ${bestDay ? `<div class="analytics-card-sub">¥${bestDay.total.toLocaleString()}（${bestDay.count.toLocaleString()}件のお会計）</div>` : ''}
        </div>
    `;
}
