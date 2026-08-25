// ==========================================
// ハイテク音声レジスター - 売上分析機能
// お会計履歴（pos_history）を集計し、
//   ① 一番売れた商品
//   ② 一番多い年齢層・性別（checkout-demographics.jsで会計時に選んだ内容。
//      それが無ければ、ポイントカード会員の年齢・登録性別から推定）
//   ③ 一番売れた日
// を「本日 / 週間（直近7日）/ 月間（今月）」の3つの期間で確認できる。
//
// 【2026-08 追加】
// 年齢層カードをタップすると、内訳を棒グラフで表示するようにした。
// 同じ仕組みで性別の内訳カードも追加した（checkout-demographics.jsが
// 会計ごとに記録する checkoutGender / checkoutAgeBracket を集計に使う）。
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

// ② 一番多い年齢層／性別
const ANALYTICS_AGE_BRACKETS = [
    { label: '10代以下', min: 0, max: 19 },
    { label: '20代', min: 20, max: 29 },
    { label: '30代', min: 30, max: 39 },
    { label: '40代', min: 40, max: 49 },
    { label: '50代', min: 50, max: 59 },
    { label: '60代以上', min: 60, max: 999 }
];
const ANALYTICS_AGE_BRACKET_LABELS = ANALYTICS_AGE_BRACKETS.map(b => b.label);
const ANALYTICS_GENDER_LABELS = ['男性', '女性', 'その他/回答しない'];

// そのお会計の「年齢層ラベル」を1件分だけ求める。
// 優先順位: ①会計時に選んだ checkoutAgeBracket → ②ポイントカード会員の年齢(customerAge)から推定
function getAgeBracketLabelForItem(item) {
    if (item.checkoutAgeBracket && ANALYTICS_AGE_BRACKET_LABELS.includes(item.checkoutAgeBracket)) {
        return item.checkoutAgeBracket;
    }
    if (item.customerAge === null || item.customerAge === undefined) return null;
    const bracket = ANALYTICS_AGE_BRACKETS.find(b => item.customerAge >= b.min && item.customerAge <= b.max);
    return bracket ? bracket.label : null;
}

// 年齢層の内訳（各区分の件数・合計・最多）をまとめて返す
function calcAgeBracketBreakdown(historyList) {
    const countMap = {};
    ANALYTICS_AGE_BRACKET_LABELS.forEach(label => { countMap[label] = 0; });

    let total = 0;
    historyList.forEach(item => {
        const label = getAgeBracketLabelForItem(item);
        if (!label) return;
        countMap[label] = (countMap[label] || 0) + 1;
        total += 1;
    });

    let best = null;
    ANALYTICS_AGE_BRACKET_LABELS.forEach(label => {
        const count = countMap[label];
        if (!best || count > best.count) best = { label, count };
    });
    if (best && best.count === 0) best = null;

    return { counts: countMap, labels: ANALYTICS_AGE_BRACKET_LABELS, total, best };
}

// 性別の内訳
// 優先順位: ①会計時に選んだ checkoutGender → ②ポイントカード会員に登録された性別(customerGender)から推定
// （年齢層の getAgeBracketLabelForItem と同じ考え方）
function getGenderLabelForItem(item) {
    if (item.checkoutGender && ANALYTICS_GENDER_LABELS.includes(item.checkoutGender)) {
        return item.checkoutGender;
    }
    if (item.customerGender && ANALYTICS_GENDER_LABELS.includes(item.customerGender)) {
        return item.customerGender;
    }
    return null;
}

function calcGenderBreakdown(historyList) {
    const countMap = {};
    ANALYTICS_GENDER_LABELS.forEach(label => { countMap[label] = 0; });

    let total = 0;
    historyList.forEach(item => {
        const label = getGenderLabelForItem(item);
        if (!label) return;
        countMap[label] = (countMap[label] || 0) + 1;
        total += 1;
    });

    let best = null;
    ANALYTICS_GENDER_LABELS.forEach(label => {
        const count = countMap[label];
        if (!best || count > best.count) best = { label, count };
    });
    if (best && best.count === 0) best = null;

    return { counts: countMap, labels: ANALYTICS_GENDER_LABELS, total, best };
}

// 商品別の販売数の内訳（上位10商品。値引き行は集計対象外）
// age/gender の内訳と同じ { counts, labels, total, best } の形にそろえて、
// 同じ棒グラフ描画（showAnalyticsBreakdown）をそのまま使えるようにする
function calcProductBreakdown(historyList) {
    const qtyMap = {};
    historyList.forEach(item => {
        if (!Array.isArray(item.cartSnapshot)) return;
        item.cartSnapshot.forEach(line => {
            if (!line || !line.name) return;
            if (line.price < 0 || line.genre === '値引き/その他') return;
            qtyMap[line.name] = (qtyMap[line.name] || 0) + (line.qty || 1);
        });
    });

    const entries = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 10);
    const labels = top.map(([name]) => name);
    const counts = {};
    top.forEach(([name, qty]) => { counts[name] = qty; });
    const total = entries.reduce((sum, [, qty]) => sum + qty, 0);

    let best = null;
    top.forEach(([name, qty]) => { if (!best || qty > best.count) best = { label: name, count: qty }; });

    return { counts, labels, total, best };
}

// 日別の売上（合計金額）の内訳。期間内の日付を古い順に並べる
function calcDailyBreakdown(historyList) {
    const dayMap = {};
    historyList.forEach(item => {
        const t = item.dateISO ? new Date(item.dateISO) : (item.date ? new Date(item.date) : null);
        if (!t || isNaN(t.getTime())) return;
        const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        if (!dayMap[key]) dayMap[key] = { total: 0, count: 0, dateObj: t };
        dayMap[key].total += (item.total || 0);
        dayMap[key].count += 1;
    });

    const keys = Object.keys(dayMap).sort(); // YYYY-MM-DD文字列なので昇順ソートでそのまま日付順になる
    const labels = [];
    const counts = {};
    const txCounts = {};
    keys.forEach(key => {
        const d = dayMap[key].dateObj;
        const youbi = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
        const label = `${d.getMonth() + 1}/${d.getDate()}(${youbi})`;
        labels.push(label);
        counts[label] = dayMap[key].total;
        txCounts[label] = dayMap[key].count;
    });

    const total = keys.reduce((sum, key) => sum + dayMap[key].total, 0);
    let best = null;
    labels.forEach(label => { if (!best || counts[label] > best.count) best = { label, count: counts[label] }; });

    return { counts, labels, total, best, txCounts };
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

// 直近に描画した内訳データを、棒グラフモーダルを開く時に参照できるよう覚えておく
let lastAgeBracketBreakdown = null;
let lastGenderBreakdown = null;
let lastProductBreakdown = null;
let lastDailyBreakdown = null;

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
        lastAgeBracketBreakdown = null;
        lastGenderBreakdown = null;
        lastProductBreakdown = null;
        lastDailyBreakdown = null;
        return;
    }

    const bestProduct = calcBestSellingProduct(filtered);
    const ageBreakdown = calcAgeBracketBreakdown(filtered);
    const genderBreakdown = calcGenderBreakdown(filtered);
    const bestDay = calcBestSellingDay(filtered);
    const productBreakdown = calcProductBreakdown(filtered);
    const dailyBreakdown = calcDailyBreakdown(filtered);

    lastAgeBracketBreakdown = ageBreakdown;
    lastGenderBreakdown = genderBreakdown;
    lastProductBreakdown = productBreakdown;
    lastDailyBreakdown = dailyBreakdown;

    const safeName = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : s;

    const bestAgeBracket = ageBreakdown.best;
    const bestGender = genderBreakdown.best;

    container.innerHTML = `
        <div class="analytics-card" onclick="showAnalyticsBreakdown('product')" style="cursor:pointer;">
            <div class="analytics-card-title">🏆 一番売れた商品 <span style="font-size:11px; color:#999; font-weight:normal;">（タップで内訳）</span></div>
            <div class="analytics-card-main">${bestProduct ? safeName(bestProduct.name) : 'データがありません'}</div>
            ${bestProduct ? `<div class="analytics-card-sub">${bestProduct.qty.toLocaleString()}個 販売</div>` : '<div class="analytics-card-sub">まだ商品明細のあるデータがありません</div>'}
        </div>

        <div class="analytics-card" onclick="showAnalyticsBreakdown('age')" style="cursor:pointer;">
            <div class="analytics-card-title">👥 一番多い年齢層 <span style="font-size:11px; color:#999; font-weight:normal;">（タップで内訳）</span></div>
            <div class="analytics-card-main">${bestAgeBracket ? bestAgeBracket.label : 'データがありません'}</div>
            ${bestAgeBracket
                ? `<div class="analytics-card-sub">${bestAgeBracket.count.toLocaleString()}件（この期間の${ageBreakdown.total.toLocaleString()}件中、${Math.round(bestAgeBracket.count / ageBreakdown.total * 100)}%）</div>`
                : '<div class="analytics-card-sub">年齢層が分かるお会計データがありません</div>'}
        </div>

        <div class="analytics-card" onclick="showAnalyticsBreakdown('gender')" style="cursor:pointer;">
            <div class="analytics-card-title">🚻 一番多い性別 <span style="font-size:11px; color:#999; font-weight:normal;">（タップで内訳）</span></div>
            <div class="analytics-card-main">${bestGender ? bestGender.label : 'データがありません'}</div>
            ${bestGender
                ? `<div class="analytics-card-sub">${bestGender.count.toLocaleString()}件（この期間の${genderBreakdown.total.toLocaleString()}件中、${Math.round(bestGender.count / genderBreakdown.total * 100)}%）</div>`
                : '<div class="analytics-card-sub">性別が分かるお会計データがありません</div>'}
        </div>

        <div class="analytics-card" onclick="showAnalyticsBreakdown('day')" style="cursor:pointer;">
            <div class="analytics-card-title">📅 一番売れた日 <span style="font-size:11px; color:#999; font-weight:normal;">（タップで内訳）</span></div>
            <div class="analytics-card-main">${bestDay ? bestDay.dateLabel : 'データがありません'}</div>
            ${bestDay ? `<div class="analytics-card-sub">¥${bestDay.total.toLocaleString()}（${bestDay.count.toLocaleString()}件のお会計）</div>` : ''}
        </div>
    `;
}

/* =========================================================
   年齢層／性別カードをタップした時の棒グラフモーダル
   ========================================================= */
function ensureAnalyticsBarChartModal() {
    if (document.getElementById('analytics-barchart-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'analytics-barchart-modal';
    overlay.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:9999; align-items:center; justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#fff; border-radius:12px; padding:22px; width:90%; max-width:440px; max-height:85vh; overflow-y:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <h3 id="analytics-barchart-title" style="margin:0; color:#1a237e;"></h3>
                <button onclick="closeAnalyticsBarChart()" style="border:none; background:#eee; border-radius:6px; padding:6px 12px; cursor:pointer; font-weight:bold;">閉じる</button>
            </div>
            <div id="analytics-barchart-body"></div>
        </div>
    `;
    document.body.appendChild(overlay);
}

// kind: 'age' | 'gender' | 'product' | 'day'
// いずれも { counts, labels, total, best } という共通の形をしているため、
// 同じ棒グラフ描画ロジックを使い回せる（表示の単位・色・タイトルだけ切り替える）
function showAnalyticsBreakdown(kind) {
    if (typeof playSound === 'function') playSound('click');

    const breakdownMap = {
        age: lastAgeBracketBreakdown,
        gender: lastGenderBreakdown,
        product: lastProductBreakdown,
        day: lastDailyBreakdown
    };
    const breakdown = breakdownMap[kind];
    if (!breakdown || breakdown.total === 0 || breakdown.labels.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('この期間はまだ内訳を表示できるデータがありません。', 'でーた が あり ませ ん。', () => {}, false);
        }
        return;
    }

    ensureAnalyticsBarChartModal();

    const titleMap = {
        age: '👥 年齢層の内訳',
        gender: '🚻 性別の内訳',
        product: '🏆 商品別 販売数（上位10件）',
        day: '📅 日別 売上'
    };
    const titleEl = document.getElementById('analytics-barchart-title');
    if (titleEl) titleEl.innerText = titleMap[kind];

    const colorMap = { age: '#3f51b5', gender: '#00897b', product: '#8e24aa', day: '#ef6c00' };
    const barColor = colorMap[kind];
    const safeName = (typeof escapeHtml === 'function') ? escapeHtml : (s) => s;

    const maxCount = Math.max(...breakdown.labels.map(l => breakdown.counts[l]), 1);

    const rowsHtml = breakdown.labels.map(label => {
        const count = breakdown.counts[label];
        const pct = breakdown.total > 0 ? Math.round(count / breakdown.total * 100) : 0;
        const barWidthPct = Math.round(count / maxCount * 100);
        const isBest = breakdown.best && breakdown.best.label === label && count > 0;

        let valueText;
        if (kind === 'day') {
            const txCount = (breakdown.txCounts && breakdown.txCounts[label]) || 0;
            valueText = `¥${count.toLocaleString()}（${txCount.toLocaleString()}件）`;
        } else if (kind === 'product') {
            valueText = `${count.toLocaleString()}個（${pct}%）`;
        } else {
            valueText = `${count.toLocaleString()}件（${pct}%）`;
        }

        return `
            <div style="margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
                    <span style="font-weight:${isBest ? 'bold' : 'normal'}; color:${isBest ? '#1a237e' : '#333'};">${isBest ? '🥇 ' : ''}${safeName(label)}</span>
                    <span style="color:#555;">${valueText}</span>
                </div>
                <div style="background:#eee; border-radius:6px; height:16px; overflow:hidden;">
                    <div style="background:${isBest ? '#ff9800' : barColor}; width:${barWidthPct}%; height:100%; border-radius:6px;"></div>
                </div>
            </div>
        `;
    }).join('');

    const summaryMap = {
        age: `この期間の合計 ${breakdown.total.toLocaleString()}件が対象`,
        gender: `この期間の合計 ${breakdown.total.toLocaleString()}件が対象`,
        product: `この期間の販売数量 合計 ${breakdown.total.toLocaleString()}個が対象（上位10商品を表示）`,
        day: `この期間の合計 ¥${breakdown.total.toLocaleString()}`
    };

    const bodyEl = document.getElementById('analytics-barchart-body');
    if (bodyEl) {
        bodyEl.innerHTML = `
            <div style="font-size:12px; color:#777; margin-bottom:14px;">${summaryMap[kind]}</div>
            ${rowsHtml}
        `;
    }

    const modal = document.getElementById('analytics-barchart-modal');
    if (modal) modal.style.display = 'flex';
}

function closeAnalyticsBarChart() {
    if (typeof playSound === 'function') playSound('click');
    const modal = document.getElementById('analytics-barchart-modal');
    if (modal) modal.style.display = 'none';
}
