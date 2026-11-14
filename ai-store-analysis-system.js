// ==========================================
// ai-store-analysis-system.js（安全な GAS 中継 ＋ Gemini API 高速・高精度版）
// ==========================================
const GAS_SCRIPT_ID = "AKfycbyF6Y57_rNIgsRb4GWMh-NH5h8lr69GCsKN6D0HT60fuR1K2-PQa8Xorf6O9zJup-ts";const GAS_WEB_APP_URL = "https:" + "//script" + ".google" + ".com" + "/macros/s/" + GAS_SCRIPT_ID + "/exec";
const APP_SECRET_TOKEN = "haru-pos-2026";

const AI_ANALYSIS_TEMPLATES = [
  {
    label: '📅 本日/週間/月間 比較',
    prompt: '本日・直近7日間・直近30日間の「取引件数」「売上合計」「人気商品」「曜日の傾向」を比較し、期間ごとの変化と気づきを箇条書きで簡潔にまとめてください。',
    periods: ['today', 'week', 'month']
  },
  {
    label: '📈 売れ筋・不振品',
    prompt: '直近30日間のデータから、売れ筋商品と販売数が少ない（または売れていない）商品を挙げ、理由の推測と改善案を簡潔に提案してください。',
    periods: ['month']
  },
  {
    label: '🗓️ 曜日の傾向',
    prompt: '直近30日間の曜日別取引件数をもとに、忙しい曜日と空いている曜日の傾向、および集客・オペレーションの対策を簡潔に提案してください。',
    periods: ['month']
  },
  {
    label: '🏷️ 自動化バーコードの効果',
    prompt: '登録されている自動化バーコードの件数や内容をもとに、現在の活用状況の評価と効果的な使い方の改善案を簡潔に提案してください。',
    periods: ['month']
  },
  {
    label: '👥 会員ランクの傾向',
    prompt: '会員数と会員ランクの内訳から、会員施策（キャンペーンや特典）の改善アイデアを簡潔に提案してください。',
    periods: []
  },
  {
    label: '💡 売上アップの提案',
    prompt: '直近30日間のデータ全体を踏まえて、売上を伸ばすための具体的な改善アイデアを3つ、優先度付きで簡潔に提案してください。',
    periods: ['month']
  },
  {
    label: '📦 品揃えの見直し',
    prompt: '直近30日間の販売数が少ない商品や未販売商品をもとに、品揃え・仕入れ・陳列の見直し案を簡潔に提案してください。',
    periods: ['month']
  },
  {
    label: '⏰ 時間帯別の傾向',
    prompt: '本日の時間帯別の売上・取引件数から、混雑・閑散している時間帯を挙げて、人員配置やタイムセールなどの対策案を簡潔に提案してください。',
    periods: ['today']
  },
  {
    label: '💳 客単価の分析',
    prompt: '直近30日間の取引件数と売上合計から平均客単価を算出し、セット販売やついで買いなど客単価を上げる具体的な施策を簡潔に提案してください。',
    periods: ['month']
  },
  {
    label: '🔁 リピーター・常連客',
    prompt: '会員ランクの分布や取引の傾向から、リピーター・常連客を増やすための具体的な施策を簡潔に提案してください。',
    periods: ['month']
  },
  {
    label: '🎉 季節・イベント施策',
    prompt: '直近の売れ筋商品や曜日の傾向を踏まえて、季節やイベントに合わせたキャンペーン・販促のアイデアを簡潔に提案してください。',
    periods: ['month']
  },
  {
    label: '📉 売上減少の要因分析',
    prompt: '直近7日間と直近30日間のデータを比較し、売上や取引件数が落ち込んでいる場合はその要因を推測し、改善のための対策案を簡潔に提案してください。',
    periods: ['week', 'month']
  }
];

function getHistoryListSafe() {
  try {
    if (typeof historyList !== 'undefined' && Array.isArray(historyList)) return historyList;
  } catch (e) {}
  try {
    return JSON.parse(localStorage.getItem('pos_history') || '[]');
  } catch (e) {
    return [];
  }
}

function parseRecordDateSafe(rec) {
  const candidates = ['date', 'createdAt', 'timestamp', 'time', 'completedAt'];
  for (const key of candidates) {
    if (rec[key]) {
      const t = new Date(rec[key]).getTime();
      if (!isNaN(t)) return t;
    }
  }
  return null;
}

function inferPeriodsFromQuestion(text) {
  const q = String(text || '');
  const periods = [];
  if (/今日|本日|時間帯|さっき|いま|現在|午前|午後|夕方|夜/.test(q)) periods.push('today');
  if (/今週|週間|7日|先週|比較/.test(q)) periods.push('week');
  if (/今月|月間|30日|先月|全体|傾向|売れ筋|不振|客単価|リピーター|曜日|品揃え|売上/.test(q)) periods.push('month');
  if (/会員|ランク/.test(q) && periods.length === 0) return [];
  return periods.length > 0 ? periods : ['month'];
}

function summarizeHistoryPeriod(list, allProducts) {
  let revenue = 0;
  const productCount = {};
  const dowCount = new Array(7).fill(0);
  const hourlyCount = new Array(24).fill(0);

  if (Array.isArray(allProducts)) {
    allProducts.forEach(p => {
      if (p && p.name && !p.archived) {
        productCount[p.name] = 0;
      }
    });
  }

  list.forEach(rec => {
    revenue += Number(rec.total || rec.amount || 0) || 0;
    const items = Array.isArray(rec.cartSnapshot) ? rec.cartSnapshot : [];
    items.forEach(i => {
      const name = (i && i.name) || '(不明な商品)';
      productCount[name] = (productCount[name] || 0) + (Number(i && i.qty) || 1);
    });
    const t = parseRecordDateSafe(rec);
    if (t !== null) {
      const d = new Date(t);
      const dIdx = d.getDay();
      const hIdx = d.getHours();
      dowCount[dIdx] = (dowCount[dIdx] || 0) + 1;
      hourlyCount[hIdx] = (hourlyCount[hIdx] || 0) + 1;
    }
  });

  const sortedEntries = Object.entries(productCount).sort((a, b) => b[1] - a[1]);
  const topProducts = sortedEntries
    .filter(([, qty]) => qty > 0)
    .slice(0, 10)
    .map(([name, qty]) => name + ':' + qty + '点');

  const slowProducts = sortedEntries
    .slice()
    .reverse()
    .slice(0, 8)
    .map(([name, qty]) => name + ':' + qty + '点');

  const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const dowSummary = dowLabels.map((l, i) => l + ':' + dowCount[i] + '件').join(' ');

  const activeHours = hourlyCount
    .map((cnt, h) => (cnt > 0 ? h + '時:' + cnt + '件' : null))
    .filter(Boolean)
    .join(' ');

  const avgSpend = list.length > 0 ? Math.round(revenue / list.length) : 0;

  return {
    取引件数: list.length,
    売上合計: Math.round(revenue),
    平均客単価: avgSpend,
    人気商品トップ10: topProducts,
    販売数が少ない商品: slowProducts,
    曜日別取引件数: dowSummary,
    時間帯別取引件数: activeHours || '取引なし'
  };
}

function isSameLocalDay(t, now) {
  const d = new Date(t);
  const n = new Date(now);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function buildStoreAnalysisSummary(periods) {
  const needed = Array.isArray(periods) ? periods : ['month'];
  const history = getHistoryListSafe();
  const products = (typeof getProductListSafe === 'function') ? getProductListSafe() : [];
  const customers = (typeof getCustomerListSafe === 'function') ? getCustomerListSafe() : [];
  const discounts = (typeof discountBarcodes !== 'undefined' && Array.isArray(discountBarcodes)) ? discountBarcodes : [];
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const buckets = { today: [], week: [], month: [] };

  if (needed.length > 0) {
    history.forEach(rec => {
      const t = parseRecordDateSafe(rec);
      if (t === null) return;
      const diff = now - t;
      if (needed.includes('today') && isSameLocalDay(t, now)) buckets.today.push(rec);
      if (needed.includes('week') && diff <= 7 * DAY) buckets.week.push(rec);
      if (needed.includes('month') && diff <= 30 * DAY) buckets.month.push(rec);
    });
  }

  const rankCount = {};
  customers.forEach(c => {
    const r = (c && c.rank) || 'regular';
    rankCount[r] = (rankCount[r] || 0) + 1;
  });

  const activeDiscounts = discounts
    .filter(d => !d.archived)
    .slice(0, 15)
    .map(d => {
      const name = d.name || d.label || d.code || '名称未設定';
      const detail = d.discountType === 'percent'
        ? (d.discountValue || 0) + '%割引'
        : (d.discountValue ? d.discountValue + '円引き' : (d.type || '自動処理'));
      return name + '(' + detail + ')';
    });

  const result = {
    全期間取引件数: history.length,
    登録商品数: products.length,
    会員数: customers.length,
    会員ランク内訳: rankCount,
    有効な自動化バーコード数: discounts.filter(d => !d.archived).length,
    有効な自動化バーコード一覧: activeDiscounts
  };

  if (needed.includes('today')) result.本日 = summarizeHistoryPeriod(buckets.today, products);
  if (needed.includes('week')) result.直近7日間 = summarizeHistoryPeriod(buckets.week, products);
  if (needed.includes('month')) result.直近30日間 = summarizeHistoryPeriod(buckets.month, products);

  return result;
}

function buildHourlyRevenueSeries(list) {
  const hours = new Array(24).fill(0);
  list.forEach(rec => {
    const t = parseRecordDateSafe(rec);
    if (t === null) return;
    const h = new Date(t).getHours();
    hours[h] = (hours[h] || 0) + (Number(rec.total || rec.amount || 0) || 0);
  });
  return { labels: hours.map((_, h) => h + '時'), values: hours.map(v => Math.round(v)) };
}

function buildDailyRevenueSeries(list, days) {
  const DAY = 24 * 60 * 60 * 1000;
  const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const order = [];
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today0.getTime() - i * DAY);
    const key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    order.push(key);
    buckets.set(key, { date: d, revenue: 0 });
  }
  list.forEach(rec => {
    const t = parseRecordDateSafe(rec);
    if (t === null) return;
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    const key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    if (buckets.has(key)) buckets.get(key).revenue += Number(rec.total || rec.amount || 0) || 0;
  });
  const labels = order.map(key => {
    const date = buckets.get(key).date;
    return (date.getMonth() + 1) + '/' + date.getDate() + '(' + dowLabels[date.getDay()] + ')';
  });
  const values = order.map(key => Math.round(buckets.get(key).revenue));
  return { labels, values };
}

function buildAiAnalysisChartSeries(periods) {
  const needed = Array.isArray(periods) ? periods : [];
  if (needed.length === 0) return [];
  const history = getHistoryListSafe();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const withinDays = (rec, days) => {
    const t = parseRecordDateSafe(rec);
    return t !== null && (now - t) <= days * DAY;
  };
  const charts = [];
  if (needed.includes('today')) {
    const series = buildHourlyRevenueSeries(history.filter(rec => {
      const t = parseRecordDateSafe(rec);
      return t !== null && isSameLocalDay(t, now);
    }));
    charts.push({ periodKey: 'today', title: '📅 本日の売上推移（時間帯別）', labels: series.labels, values: series.values });
  }
  if (needed.includes('week')) {
    const series = buildDailyRevenueSeries(history.filter(rec => withinDays(rec, 7)), 7);
    charts.push({ periodKey: 'week', title: '📈 直近7日間の売上推移', labels: series.labels, values: series.values });
  }
  if (needed.includes('month')) {
    const series = buildDailyRevenueSeries(history.filter(rec => withinDays(rec, 30)), 30);
    charts.push({ periodKey: 'month', title: '📈 直近30日間の売上推移', labels: series.labels, values: series.values });
  }
  return charts;
}

let aiAnalysisStopRequested = false;
let currentAiAbortController = null;
let aiAnalysisAccumulatedText = '';

function requestStopAiAnalysis() {
aiAnalysisStopRequested = true;
if (currentAiAbortController) {
try { currentAiAbortController.abort(); } catch (e) {}
currentAiAbortController = null;
}
if (typeof playSound === 'function') playSound('click');
}
const AI_SYSTEM_INSTRUCTION = [
'あなたはharuレジ（POSレジアプリ）の店舗データ分析専用AIです。',
'【最優先ルール】天気、ゲーム、アニメ、雑談など、店舗運営・売上・商品・会員・レジデータに全く関係のない話題を聞かれた場合のみ、「レジに関係があることのみの回答ができます‼」の1文だけを出力してください。店舗の売上や商品、データに関する質問であれば、積極的に回答してください。',
'【回答ルール】',
'1. 最初の1文で、質問に対する直接の結論を簡潔に答える。',
'2. 続けて、渡されたJSONデータの具体的な数値（件数・金額・商品名・曜日・時間帯）を根拠として箇条書き3〜5点で説明する。',
'3. 文字数は450字〜600字以内に収め、最後まで書き切る。前置きや挨拶は書かない。',
'4. 文末は「です・ます」調に統一し、同じ語尾の連続を避ける。',
'【厳守事項】',
'・JSONデータにない商品名・数字・日付を絶対に創作しない。',
'・質問に答えるための情報がJSONにない場合や件数が0件の場合は「渡されたデータからは分かりません」と記載し、推測で埋めない。',
'・質問された内容にだけ直接答え、関係のない一般論や別の話題に逸れない。'
].join('\n');
async function callAiForStoreAnalysis(promptText, periods) {
const summary = buildStoreAnalysisSummary(periods);
const userText = '【店舗データ】\n' + JSON.stringify(summary) + '\n\n【質問】\n' + promptText;
currentAiAbortController = new AbortController();
try {
const response = await fetch(GAS_WEB_APP_URL, {
method: 'POST',
headers: {
'Content-Type': 'text/plain;charset=utf-8'
},
signal: currentAiAbortController.signal,
body: JSON.stringify({
token: APP_SECRET_TOKEN,
systemText: AI_SYSTEM_INSTRUCTION,
userText: userText
})
});
    const rawText = await response.text();
if (!response.ok) {
throw new Error('HTTPエラー: ' + response.status);
}
    if (rawText.trim().startsWith('<!DOCTYPE') || rawText.trim().startsWith('<html')) {
      throw new Error('GASがHTMLページを返しました（GASのデプロイ設定でアクセスできるユーザーを「全員」にしているか確認してください）');
    }
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      throw new Error('GAS応答がJSONではありません: ' + rawText.slice(0, 150));
    }

if (data.error) {
throw new Error(data.error);
}
return data.reply || '(応答を取得できませんでした)';
} catch (e) {
if (e.name === 'AbortError' || aiAnalysisStopRequested) {
return '※ここで停止しました。';
}
throw e;
} finally {
currentAiAbortController = null;
}
}
function describeAiError(e) {
if (!navigator.onLine) return 'インターネットに接続されていません。';
if (e && e.message) return e.message;
return 'AIサーバーとの通信中にエラーが発生しました。';
}
function buildFallbackSimpleReport(periods) {
const needed = Array.isArray(periods) && periods.length > 0 ? periods : ['today', 'week', 'month'];
const summary = buildStoreAnalysisSummary(needed);
const lines = [];
lines.push('・全期間の取引件数: ' + summary.全期間取引件数 + '件');
lines.push('・登録商品数: ' + summary.登録商品数 + '点');
lines.push('・会員数: ' + summary.会員数 + '人');
const rankEntries = Object.entries(summary.会員ランク内訳 || {});
if (rankEntries.length > 0) {
lines.push('・会員ランク内訳: ' + rankEntries.map(([k, v]) => k + ' ' + v + '人').join('、'));
}
lines.push('・有効な自動化バーコード数: ' + summary.有効な自動化バーコード数 + '件');
const periodLabels = { today: '本日', week: '直近7日間', month: '直近30日間' };
needed.forEach(key => {
const label = periodLabels[key];
const p = summary[label];
if (!p) return;
lines.push('');
lines.push('【' + label + '】');
lines.push('・取引件数: ' + p.取引件数 + '件');
lines.push('・売上合計: ¥' + Number(p.売上合計 || 0).toLocaleString());
lines.push('・平均客単価: ¥' + Number(p.平均客単価 || 0).toLocaleString());
const topStr = (p.人気商品トップ10 && p.人気商品トップ10.length > 0)
? p.人気商品トップ10.slice(0, 5).join('、')
: 'データなし';
lines.push('・人気商品: ' + topStr);
lines.push('・曜日別取引件数: ' + p.曜日別取引件数);
});
return lines.join('\n');
}
function buildFallbackNoticeAndReport(reasonText, periods) {
let report;
try {
report = buildFallbackSimpleReport(periods);
} catch (e) {
console.warn('簡易レポートの作成にも失敗しました:', e);
report = '（集計データの読み込みにも失敗したため、簡易レポートも作成できませんでした）';
}
return [
'⚠️ AIでの分析ができませんでした（' + reasonText + '）',
'そのため、集計データから自動的に作成した簡易レポートを代わりに表示しています。',
'',
'【解決のためにお試しください】',
'・インターネット接続が正常か確認する',
'・少し時間をおいてからもう一度「質問する」を押す',
'--------------------------------',
'📊 自動集計レポート（AIによる考察は含みません）',
'--------------------------------',
report
].join('\n');
}
async function getAiAnalysisAnswerRobust(promptText, periods) {
try {
const text = await callAiForStoreAnalysis(promptText, periods);
return { text, usedFallback: false };
} catch (e) {
console.warn('AI分析に失敗しました:', e);
return { text: buildFallbackNoticeAndReport(describeAiError(e), periods), usedFallback: true };
}
}
function ensureAiAnalysisHistoryDetailsStyle() {
if (document.getElementById('ai-analysis-history-details-style')) return;
const style = document.createElement('style');
style.id = 'ai-analysis-history-details-style';
style.textContent =
'.ai-analysis-history-item summary::-webkit-details-marker { display:none; }\n' +
'.ai-analysis-history-item summary::marker { content: ""; }\n' +
'.ai-analysis-history-item summary::before {\n' +
'    content: "▶";\n' +
'    display:inline-block;\n' +
'    margin-right:6px;\n' +
'    font-size:11px;\n' +
'    color:#999;\n' +
'    transition: transform 0.15s ease;\n' +
'}\n' +
'.ai-analysis-history-item[open] summary::before {\n' +
'    transform: rotate(90deg);\n' +
'}';
document.head.appendChild(style);
}
function ensureAiAnalysisCard() {
if (document.getElementById('ai-store-analysis-card')) return;
const screen = document.getElementById('analytics-screen');
if (!screen) return;
ensureAiAnalysisHistoryDetailsStyle();
const card = document.createElement('div');
card.id = 'ai-store-analysis-card';
card.className = 'discount-form-card';
card.style.marginTop = '20px';
const headerWrap = document.createElement('div');
headerWrap.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;';
const titleH3 = document.createElement('h3');
titleH3.style.margin = '0';
titleH3.innerText = '🤖 AIによる店舗分析';
headerWrap.appendChild(titleH3);
card.appendChild(headerWrap);
const descP = document.createElement('p');
descP.style.cssText = 'color:#666; font-size:13px; margin:0 0 12px;';
descP.innerText = '売上・商品・会員などの集計データ（個人情報は含みません）をもとに、AIが分析やアドバイスをします。';
card.appendChild(descP);
const templatesWrap = document.createElement('div');
templatesWrap.id = 'ai-analysis-templates';
templatesWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;';
card.appendChild(templatesWrap);
const inputRow = document.createElement('div');
inputRow.style.cssText = 'display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap;';
const customInput = document.createElement('textarea');
customInput.id = 'ai-analysis-custom-input';
customInput.placeholder = '自由に質問できます（例：先週と比べて傾向はどう変わった？）';
customInput.rows = 2;
customInput.style.cssText = 'flex:1; min-width:200px; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:16px; box-sizing:border-box; resize:vertical;';
inputRow.appendChild(customInput);
const askBtn = document.createElement('button');
askBtn.id = 'ai-analysis-ask-btn';
askBtn.className = 'discount-submit-btn';
askBtn.style.cssText = 'white-space:nowrap; width:auto; padding:0 20px;';
askBtn.innerText = '💬 質問する';
inputRow.appendChild(askBtn);
const stopBtn = document.createElement('button');
stopBtn.id = 'ai-analysis-stop-btn';
stopBtn.className = 'discount-submit-btn';
stopBtn.style.cssText = 'display:none; white-space:nowrap; width:auto; padding:0 20px;';
stopBtn.innerText = '⏹ 停止';
inputRow.appendChild(stopBtn);
card.appendChild(inputRow);
const resultDiv = document.createElement('div');
resultDiv.id = 'ai-analysis-result';
resultDiv.style.cssText = 'white-space:pre-wrap; line-height:1.7; background:#e8f5e9; border-radius:8px; padding:12px; min-height:40px; font-size:14px; color:#333;';
resultDiv.innerText = 'テンプレートを選ぶか、質問を入力して「質問する」を押してください。';
card.appendChild(resultDiv);
const chartsDiv = document.createElement('div');
chartsDiv.id = 'ai-analysis-charts';
chartsDiv.style.display = 'none';
card.appendChild(chartsDiv);
const warnP = document.createElement('p');
warnP.style.cssText = 'color:#8a5a00; background:#fff3e0; border-radius:6px; padding:8px 10px; font-size:12px; margin:8px 0 0;';
warnP.innerText = '⚠️ AIの回答はまれに解釈のズレが生じる場合があります。重要な金額や数値は元のデータと照らし合わせてご確認ください。';
card.appendChild(warnP);
const actionRow = document.createElement('div');
actionRow.style.cssText = 'margin-top:10px; display:flex; justify-content:flex-end; gap:8px;';
const saveBtn = document.createElement('button');
saveBtn.id = 'ai-analysis-save-btn';
saveBtn.className = 'csv-export-btn';
saveBtn.style.display = 'none';
saveBtn.innerText = '💾 保存';
actionRow.appendChild(saveBtn);
const docxBtn = document.createElement('button');
docxBtn.id = 'ai-analysis-docx-btn';
docxBtn.className = 'csv-export-btn';
docxBtn.style.display = 'none';
docxBtn.innerText = '📄 Wordでダウンロード';
actionRow.appendChild(docxBtn);
card.appendChild(actionRow);
const historySection = document.createElement('div');
historySection.id = 'ai-analysis-saved-history-section';
historySection.style.cssText = 'margin-top:22px; border-top:2px solid #e0e0e0; padding-top:14px;';
const historyH4 = document.createElement('h4');
historyH4.style.cssText = 'margin:0 0 10px; color:#555;';
historyH4.innerText = '🗂️ 保存した分析の履歴（あとから見返せます）';
historySection.appendChild(historyH4);
const historyListDiv = document.createElement('div');
historyListDiv.id = 'ai-analysis-saved-history-list';
historySection.appendChild(historyListDiv);
card.appendChild(historySection);
screen.appendChild(card);
let lastAiQuestionLabel = '';
AI_ANALYSIS_TEMPLATES.forEach(t => {
const btn = document.createElement('button');
btn.type = 'button';
btn.className = 'select-btn';
btn.innerText = t.label;
btn.style.cssText = 'background:#5c6bc0; min-height:38px;';
btn.addEventListener('click', () => {
lastAiQuestionLabel = t.label;
runAiAnalysis(t.prompt, t.periods, t.label);
});
templatesWrap.appendChild(btn);
});
docxBtn.addEventListener('click', () => {
downloadAiAnalysisAsDocx(lastAiQuestionLabel || 'AI店舗分析');
});
saveBtn.addEventListener('click', () => {
saveCurrentAiAnalysisToHistory(lastAiQuestionLabel || 'AI店舗分析');
});
renderAiAnalysisSavedHistory();
askBtn.addEventListener('click', () => {
const val = customInput.value.trim();
if (!val) return;
lastAiQuestionLabel = val;
customInput.value = '';
const inferredPeriods = inferPeriodsFromQuestion(val);
runAiAnalysis(val, inferredPeriods, val);
});
stopBtn.addEventListener('click', requestStopAiAnalysis);
customInput.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
e.preventDefault();
askBtn.click();
}
});
}
function ensureAiAnalysisWaveStyle() {
if (document.getElementById('ai-analysis-wave-style')) return;
const style = document.createElement('style');
style.id = 'ai-analysis-wave-style';
style.textContent =
'.ai-analysis-wave-dots {\n' +
'    display: inline-flex;\n' +
'    align-items: center;\n' +
'    gap: 4px;\n' +
'    vertical-align: middle;\n' +
'    margin-left: 2px;\n' +
'}\n' +
'.ai-analysis-wave-dots span {\n' +
'    display: inline-block;\n' +
'    width: 6px;\n' +
'    height: 6px;\n' +
'    border-radius: 50%;\n' +
'    background: #5c6bc0;\n' +
'    animation: ai-analysis-wave-bounce 1.1s ease-in-out infinite;\n' +
'}\n' +
'.ai-analysis-wave-dots span:nth-child(2) { animation-delay: 0.15s; }\n' +
'.ai-analysis-wave-dots span:nth-child(3) { animation-delay: 0.3s; }\n' +
'@keyframes ai-analysis-wave-bounce {\n' +
'    0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }\n' +
'    30% { transform: translateY(-6px); opacity: 1; }\n' +
'}';
document.head.appendChild(style);
}
function buildAiAnalysisWaveNode(label) {
const wrap = document.createElement('span');
wrap.appendChild(document.createTextNode('🤖 ' + label));
const dots = document.createElement('span');
dots.className = 'ai-analysis-wave-dots';
for (let i = 0; i < 3; i++) {
dots.appendChild(document.createElement('span'));
}
wrap.appendChild(dots);
return wrap;
}
const AI_ANALYSIS_BLOCK_DIVIDER_TEXT = '\n\n────────────────────\n\n';
function buildAiAnalysisBlockHeaderText(label) {
const now = new Date();
const h = String(now.getHours()).padStart(2, '0');
const m = String(now.getMinutes()).padStart(2, '0');
return '🔹 ' + (label || 'AI店舗分析') + '（' + h + ':' + m + '）';
}
function renderAiAnalysisResultNode(nodeOrText) {
const resultEl = document.getElementById('ai-analysis-result');
if (!resultEl) return;
resultEl.innerHTML = '';
if (aiAnalysisAccumulatedText) {
resultEl.appendChild(document.createTextNode(aiAnalysisAccumulatedText + AI_ANALYSIS_BLOCK_DIVIDER_TEXT));
}
if (typeof nodeOrText === 'string') {
resultEl.appendChild(document.createTextNode(nodeOrText));
} else if (nodeOrText) {
resultEl.appendChild(nodeOrText);
}
}
function finalizeAiAnalysisBlock(label, answerText) {
const blockText = buildAiAnalysisBlockHeaderText(label) + '\n' + answerText;
renderAiAnalysisResultNode(blockText);
aiAnalysisAccumulatedText = aiAnalysisAccumulatedText
? aiAnalysisAccumulatedText + AI_ANALYSIS_BLOCK_DIVIDER_TEXT + blockText
: blockText;
}
function resetAiAnalysisResultDisplay() {
aiAnalysisAccumulatedText = '';
const resultEl = document.getElementById('ai-analysis-result');
if (resultEl) {
resultEl.innerText = 'テンプレートを選ぶか、質問を入力して「質問する」を押してください。';
}
aiAnalysisLastCharts = [];
renderAiAnalysisCharts([]);
const docxBtn = document.getElementById('ai-analysis-docx-btn');
const saveBtn = document.getElementById('ai-analysis-save-btn');
if (docxBtn) docxBtn.style.display = 'none';
if (saveBtn) saveBtn.style.display = 'none';
}
let aiAnalysisLastCharts = [];
const AI_CHART_LOGICAL_W = 600;
const AI_CHART_LOGICAL_H = 160;
function drawAiAnalysisLineChart(canvas, chart) {
if (!canvas || !chart) return;
const dpr = window.devicePixelRatio || 1;
canvas.width = AI_CHART_LOGICAL_W * dpr;
canvas.height = AI_CHART_LOGICAL_H * dpr;
canvas.style.width = '100%';
canvas.style.height = 'auto';
const ctx = canvas.getContext('2d');
ctx.setTransform(1, 0, 0, 1, 0, 0);
ctx.scale(dpr, dpr);
ctx.clearRect(0, 0, AI_CHART_LOGICAL_W, AI_CHART_LOGICAL_H);
const values = Array.isArray(chart.values) ? chart.values : [];
const labels = Array.isArray(chart.labels) ? chart.labels : [];
const padding = { top: 14, right: 14, bottom: 26, left: 54 };
const w = AI_CHART_LOGICAL_W - padding.left - padding.right;
const h = AI_CHART_LOGICAL_H - padding.top - padding.bottom;
const maxVal = Math.max(1, ...values, 0);
ctx.strokeStyle = '#c8e6c9';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(padding.left, padding.top);
ctx.lineTo(padding.left, padding.top + h);
ctx.lineTo(padding.left + w, padding.top + h);
ctx.stroke();
ctx.fillStyle = '#558b2f';
ctx.font = '10px sans-serif';
ctx.textAlign = 'right';
ctx.fillText('¥' + maxVal.toLocaleString(), padding.left - 6, padding.top + 4);
ctx.fillText('¥0', padding.left - 6, padding.top + h);
if (values.length === 0) {
ctx.fillStyle = '#999';
ctx.textAlign = 'center';
ctx.fillText('データがありません', padding.left + w / 2, padding.top + h / 2);
return;
}
const stepX = values.length > 1 ? w / (values.length - 1) : 0;
const pointAt = (i) => [padding.left + stepX * i, padding.top + h - (values[i] / maxVal) * h];
ctx.beginPath();
values.forEach((v, i) => {
const pt = pointAt(i);
if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]);
});
ctx.lineTo(padding.left + w, padding.top + h);
ctx.lineTo(padding.left, padding.top + h);
ctx.closePath();
ctx.fillStyle = 'rgba(102,187,106,0.18)';
ctx.fill();
ctx.beginPath();
values.forEach((v, i) => {
const pt = pointAt(i);
if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]);
});
ctx.strokeStyle = '#43a047';
ctx.lineWidth = 2;
ctx.stroke();
ctx.fillStyle = '#2e7d32';
values.forEach((v, i) => {
const pt = pointAt(i);
ctx.beginPath();
ctx.arc(pt[0], pt[1], 2.5, 0, Math.PI * 2);
ctx.fill();
});
ctx.fillStyle = '#666';
ctx.font = '9px sans-serif';
ctx.textAlign = 'center';
const maxLabels = 8;
const labelStep = Math.max(1, Math.ceil(labels.length / maxLabels));
labels.forEach((label, i) => {
if (i % labelStep !== 0 && i !== labels.length - 1) return;
const pt = pointAt(i);
ctx.fillText(label, pt[0], padding.top + h + 14);
});
}
function renderAiAnalysisCharts(charts) {
const wrap = document.getElementById('ai-analysis-charts');
if (!wrap) return;
wrap.innerHTML = '';
if (!charts || charts.length === 0) {
wrap.style.display = 'none';
return;
}
wrap.style.display = 'block';
charts.forEach((c, i) => {
const box = document.createElement('div');
box.style.cssText = 'margin-top:12px; background:#fff; border:1px solid #c8e6c9; border-radius:8px; padding:10px 12px 6px;';
const titleDiv = document.createElement('div');
titleDiv.style.cssText = 'font-size:12.5px; font-weight:bold; color:#2e7d32; margin-bottom:6px;';
titleDiv.innerText = c.title || '';
box.appendChild(titleDiv);
const canvas = document.createElement('canvas');
canvas.id = 'ai-analysis-chart-canvas-' + i;
canvas.style.cssText = 'width:100%; height:150px; display:block;';
box.appendChild(canvas);
wrap.appendChild(box);
drawAiAnalysisLineChart(canvas, c);
});
}
const AI_ANALYSIS_NOTIFICATION_ICON_URL = 'https:' + '//raw.githubusercontent' + '.com/ishiinopasokon8610-afk/image-list/main/images/%E3%83%AD%E3%82%B4%E3%82%92%E8%A8%AD%E5%AE%9A%E3%81%99%E3%82%8B%E3%81%A8%E3%81%93%E3%81%93%E3%81%AB%E8%A1%A8%E7%A4%BA%E3%81%95%E3%82%8C%E3%81%BE%E3%81%99%E3%80%82.png';
const AI_ANALYSIS_NOTIFICATION_BODY_MAX_LEN = 120;
function buildAiAnalysisNotificationBody(answerText) {
const plain = String(answerText || '').replace(/\s+/g, ' ').trim();
if (!plain) return '回答が届きました。画面をご確認ください。';
return plain.length > AI_ANALYSIS_NOTIFICATION_BODY_MAX_LEN
? plain.slice(0, AI_ANALYSIS_NOTIFICATION_BODY_MAX_LEN) + '…'
: plain;
}
function notifyAiAnalysisComplete(answerText, usedFallback) {
if (typeof fireDesktopNotification !== 'function') return;
const title = usedFallback ? '🤖 AI店舗分析（簡易レポート）が完了しました' : '🤖 AI店舗分析の回答が届きました';
fireDesktopNotification(title, buildAiAnalysisNotificationBody(answerText), AI_ANALYSIS_NOTIFICATION_ICON_URL);
}
async function runAiAnalysis(promptText, periods, label) {
const resultEl = document.getElementById('ai-analysis-result');
const docxBtn = document.getElementById('ai-analysis-docx-btn');
const saveBtn = document.getElementById('ai-analysis-save-btn');
const askBtn = document.getElementById('ai-analysis-ask-btn');
const stopBtn = document.getElementById('ai-analysis-stop-btn');
if (!resultEl) return;
if (docxBtn) docxBtn.style.display = 'none';
if (saveBtn) saveBtn.style.display = 'none';
ensureAiAnalysisWaveStyle();
renderAiAnalysisResultNode(buildAiAnalysisWaveNode('AIが売上データを分析中です'));
if (typeof playSound === 'function') playSound('click');
aiAnalysisStopRequested = false;
if (askBtn) askBtn.style.display = 'none';
if (stopBtn) stopBtn.style.display = 'inline-block';
aiAnalysisLastCharts = buildAiAnalysisChartSeries(periods);
renderAiAnalysisCharts(aiAnalysisLastCharts);
try {
const result = await getAiAnalysisAnswerRobust(promptText, periods);
finalizeAiAnalysisBlock(label, result.text);
if (docxBtn) docxBtn.style.display = 'inline-block';
if (saveBtn) saveBtn.style.display = 'inline-block';
if (typeof playSound === 'function') playSound(result.usedFallback ? 'error' : 'success');
notifyAiAnalysisComplete(result.text, result.usedFallback);
} catch (fatalError) {
console.warn('AI分析処理全体で予期しないエラーが発生しました:', fatalError);
let text;
try {
text = buildFallbackNoticeAndReport('予期しないエラーが発生しました。', periods);
} catch (e2) {
text = '⚠️ 分析結果を表示できませんでした。画面を再読み込みしてから、もう一度お試しください。';
}
finalizeAiAnalysisBlock(label, text);
if (docxBtn) docxBtn.style.display = 'inline-block';
if (saveBtn) saveBtn.style.display = 'inline-block';
if (typeof playSound === 'function') playSound('error');
notifyAiAnalysisComplete(text, true);
} finally {
if (askBtn) askBtn.style.display = 'inline-block';
if (stopBtn) stopBtn.style.display = 'none';
aiAnalysisStopRequested = false;
}
}
const AI_ANALYSIS_SAVED_HISTORY_KEY = 'pos_ai_analysis_saved_history';
function getAiAnalysisSavedHistory() {
try {
const list = JSON.parse(localStorage.getItem(AI_ANALYSIS_SAVED_HISTORY_KEY) || '[]');
return Array.isArray(list) ? list : [];
} catch (e) {
return [];
}
}
function persistAiAnalysisSavedHistory(list) {
localStorage.setItem(AI_ANALYSIS_SAVED_HISTORY_KEY, JSON.stringify(list));
if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
}
function formatAiAnalysisSavedAt(iso) {
try {
const d = new Date(iso);
const y = d.getFullYear();
const mo = d.getMonth() + 1;
const da = d.getDate();
const h = String(d.getHours()).padStart(2, '0');
const mi = String(d.getMinutes()).padStart(2, '0');
return y + '/' + mo + '/' + da + ' ' + h + ':' + mi;
} catch (e) {
return '';
}
}
function renderAiAnalysisSavedHistory() {
const listEl = document.getElementById('ai-analysis-saved-history-list');
if (!listEl) return;
listEl.innerHTML = '';
const history = getAiAnalysisSavedHistory();
if (history.length === 0) {
const emptyP = document.createElement('p');
emptyP.style.cssText = 'color:#999; font-size:13px; text-align:center; padding:10px 0;';
emptyP.innerText = 'まだ保存された分析はありません。分析結果の下にある「💾 保存」を押すと、ここに残ります。';
listEl.appendChild(emptyP);
return;
}
history.forEach(item => {
const details = document.createElement('details');
details.className = 'ai-analysis-history-item';
details.style.cssText = 'border:1px solid #ddd; border-radius:8px; padding:0; margin-bottom:10px; background:#fff; overflow:hidden;';
const summary = document.createElement('summary');
summary.style.cssText = 'list-style:none; cursor:pointer; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;';
const leftSpan = document.createElement('span');
leftSpan.style.cssText = 'font-weight:bold; color:#5c6bc0; font-size:13px;';
leftSpan.appendChild(document.createTextNode('🤖 ' + (item.label || '')));
const questionCount = (item.answer || '')
.split(AI_ANALYSIS_BLOCK_DIVIDER_TEXT)
.filter(block => block.trim() !== '').length;
if (questionCount > 1) {
const countSpan = document.createElement('span');
countSpan.style.cssText = 'color:#8a5a00; font-weight:normal;';
countSpan.innerText = '（質問' + questionCount + '件分）';
leftSpan.appendChild(countSpan);
}
summary.appendChild(leftSpan);
const rightSpan = document.createElement('span');
rightSpan.style.cssText = 'display:flex; align-items:center; gap:8px;';
const dateSpan = document.createElement('span');
dateSpan.style.cssText = 'color:#999; font-size:11px; white-space:nowrap;';
dateSpan.innerText = formatAiAnalysisSavedAt(item.savedAt);
rightSpan.appendChild(dateSpan);
const wordBtn = document.createElement('button');
wordBtn.className = 'csv-export-btn';
wordBtn.style.cssText = 'margin-left:0; padding:2px 10px; font-size:11px;';
wordBtn.innerText = '📄 Word';
wordBtn.addEventListener('click', (e) => {
e.preventDefault();
e.stopPropagation();
downloadAiAnalysisHistoryItemAsDocx(item.id, wordBtn);
});
rightSpan.appendChild(wordBtn);
const delBtn = document.createElement('button');
delBtn.className = 'modal-btn cancel';
delBtn.style.cssText = 'padding:2px 10px; font-size:11px;';
delBtn.innerText = '削除';
delBtn.addEventListener('click', (e) => {
e.preventDefault();
e.stopPropagation();
deleteAiAnalysisSavedHistoryItem(item.id);
});
rightSpan.appendChild(delBtn);
summary.appendChild(rightSpan);
details.appendChild(summary);
const bodyWrap = document.createElement('div');
bodyWrap.style.cssText = 'padding:0 12px 12px;';
const answerDiv = document.createElement('div');
answerDiv.style.cssText = 'white-space:pre-wrap; line-height:1.6; font-size:13.5px; color:#333;';
answerDiv.innerText = item.answer || '';
bodyWrap.appendChild(answerDiv);
const charts = Array.isArray(item.charts) ? item.charts : [];
charts.forEach((c, i) => {
const cBox = document.createElement('div');
cBox.style.cssText = 'margin-top:10px; background:#fff; border:1px solid #c8e6c9; border-radius:8px; padding:10px 12px 6px;';
const cTitle = document.createElement('div');
cTitle.style.cssText = 'font-size:12px; font-weight:bold; color:#2e7d32; margin-bottom:6px;';
cTitle.innerText = c.title || '';
cBox.appendChild(cTitle);
const cCanvas = document.createElement('canvas');
cCanvas.id = 'ai-analysis-history-chart-' + item.id + '-' + i;
cCanvas.style.cssText = 'width:100%; height:150px; display:block;';
cBox.appendChild(cCanvas);
bodyWrap.appendChild(cBox);
drawAiAnalysisLineChart(cCanvas, c);
});
details.appendChild(bodyWrap);
listEl.appendChild(details);
});
}
function saveCurrentAiAnalysisToHistory(label) {
const resultEl = document.getElementById('ai-analysis-result');
const answer = resultEl ? resultEl.innerText : '';
if (!answer || answer.trim() === '') return;
const history = getAiAnalysisSavedHistory();
history.push({
id: 'ai_hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
label: label || 'AI店舗分析',
answer: answer,
charts: Array.isArray(aiAnalysisLastCharts) ? aiAnalysisLastCharts : [],
savedAt: new Date().toISOString()
});
persistAiAnalysisSavedHistory(history);
renderAiAnalysisSavedHistory();
resetAiAnalysisResultDisplay();
if (typeof playSound === 'function') playSound('success');
if (typeof speak === 'function') speak('りれき に ほぞん し まし た');
}
function deleteAiAnalysisSavedHistoryItem(id) {
const doDelete = () => {
const history = getAiAnalysisSavedHistory().filter(h => h.id !== id);
persistAiAnalysisSavedHistory(history);
renderAiAnalysisSavedHistory();
};
if (typeof showCustomConfirm === 'function') {
showCustomConfirm('この保存済み分析を削除しますか？（元に戻せません）', 'この りれき を さくじょ し ます か？', (ok) => {
if (ok) doDelete();
}, true);
} else {
doDelete();
}
}
const DOCX_LIB_CDN_URL = 'https:' + '//esm.run/docx';
let docxModulePromise = null;
function loadDocxModule() {
if (!docxModulePromise) {
docxModulePromise = import(DOCX_LIB_CDN_URL).catch(e => {
docxModulePromise = null;
throw e;
});
}
return docxModulePromise;
}
function chartCanvasToPngBytes(chart) {
const canvas = document.createElement('canvas');
drawAiAnalysisLineChart(canvas, chart);
const dataUrl = canvas.toDataURL('image/png');
const base64 = dataUrl.split(',')[1];
const binary = atob(base64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
return bytes;
}
async function buildAiAnalysisDocxBlob(titleLabel, bodyText, charts) {
const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = await loadDocxModule();
const now = new Date();
const dateStr = now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate() + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
const bodyParagraphs = bodyText.split('\n').map(line => {
const trimmed = line.trim();
if (trimmed === '') {
return new Paragraph({ text: '' });
}
return new Paragraph({
children: [new TextRun({ text: line })],
spacing: { after: 120 }
});
});
const chartList = Array.isArray(charts) ? charts : [];
const chartParagraphs = [];
if (chartList.length > 0) {
chartParagraphs.push(new Paragraph({
text: '📊 グラフ',
heading: HeadingLevel.HEADING_2,
spacing: { before: 300, after: 120 }
}));
chartList.forEach(chart => {
chartParagraphs.push(new Paragraph({
children: [new TextRun({ text: chart.title || '', bold: true })],
spacing: { after: 80 }
}));
try {
const bytes = chartCanvasToPngBytes(chart);
chartParagraphs.push(new Paragraph({
children: [new ImageRun({
type: 'png',
data: bytes,
transformation: { width: 500, height: 133 }
})],
spacing: { after: 200 }
}));
} catch (imgErr) {
console.warn('グラフ画像の埋め込みに失敗しました（グラフを省いて続行します）:', imgErr);
}
});
}
const doc = new Document({
sections: [{
properties: {},
children: [
new Paragraph({
text: 'AI店舗分析レポート',
heading: HeadingLevel.HEADING_1
}),
new Paragraph({
children: [new TextRun({ text: 'テーマ: ' + (titleLabel || 'AI店舗分析'), italics: true })],
spacing: { after: 60 }
}),
new Paragraph({
children: [new TextRun({ text: '作成日時: ' + dateStr, italics: true, color: '888888' })],
spacing: { after: 300 }
}),
...bodyParagraphs,
...chartParagraphs
]
}]
});
return Packer.toBlob(doc);
}
function downloadBlobAsFile(blob, filename) {
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function buildAiAnalysisDocxFilename() {
const now = new Date();
const y = now.getFullYear();
const mo = String(now.getMonth() + 1).padStart(2, '0');
const da = String(now.getDate()).padStart(2, '0');
const h = String(now.getHours()).padStart(2, '0');
const mi = String(now.getMinutes()).padStart(2, '0');
return 'AI店舗分析_' + y + mo + da + '_' + h + mi + '.docx';
}
async function runAiAnalysisDocxDownload(button, titleLabel, bodyText, charts) {
if (!bodyText || bodyText.trim() === '') return;
const originalBtnText = button ? button.innerText : '';
if (button) {
button.disabled = true;
button.innerText = '📄 作成中…';
}
try {
const blob = await buildAiAnalysisDocxBlob(titleLabel, bodyText, charts);
downloadBlobAsFile(blob, buildAiAnalysisDocxFilename());
if (typeof playSound === 'function') playSound('success');
} catch (e) {
console.warn('Wordファイルの作成に失敗しました:', e);
if (typeof showCustomConfirm === 'function') {
showCustomConfirm('Wordファイルの作成に失敗しました。インターネット接続をご確認のうえ、もう一度お試しください。', 'わーど ふぁいる の さくせい に しっぱい し まし た。', () => {}, false);
}
if (typeof playSound === 'function') playSound('error');
} finally {
if (button) {
button.disabled = false;
button.innerText = originalBtnText || '📄 Wordでダウンロード';
}
}
}
async function downloadAiAnalysisAsDocx(titleLabel) {
const resultEl = document.getElementById('ai-analysis-result');
const docxBtn = document.getElementById('ai-analysis-docx-btn');
const bodyText = resultEl ? resultEl.innerText : '';
const charts = Array.isArray(aiAnalysisLastCharts) ? aiAnalysisLastCharts : [];
await runAiAnalysisDocxDownload(docxBtn, titleLabel, bodyText, charts);
}
async function downloadAiAnalysisHistoryItemAsDocx(id, buttonEl) {
const history = getAiAnalysisSavedHistory();
const item = history.find(h => h.id === id);
if (!item) return;
await runAiAnalysisDocxDownload(buttonEl, item.label, item.answer, item.charts);
}
(function hookShowScreenForAiAnalysisCard() {
function tryHook() {
if (typeof window.showScreen !== 'function') {
setTimeout(tryHook, 300);
return;
}
const original = window.showScreen;
window.showScreen = function (screenId, ...rest) {
const result = original.apply(this, [screenId, ...rest]);
if (screenId === 'analytics-screen') ensureAiAnalysisCard();
return result;
};
}
tryHook();
})();