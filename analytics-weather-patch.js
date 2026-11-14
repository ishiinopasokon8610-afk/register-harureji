// ==========================================
// analytics-weather-patch.js
// 分析画面（analytics-system.js）への追加パッチ
// ------------------------------------------
// ①「本日」タブでは「一番売れた日」＝今日の日付であり無意味なため非表示にする
// ② 売れた日の天気が分かるよう、天気アイコンを表示する（Visual Crossing
//    Weather の Timeline API を使用。APIキー不要・営利利用OK。
//    ※以前使っていた Open-Meteo の無料APIは「非営利利用のみ」のため置き換えた）
//    ★利用条件：天気を表示する画面の近くに「Weather data provided by
//      Visual Crossing Weather」というクレジット表示（リンク付き）が必須
//      （このファイルが自動で表示する。削除しないこと）
// ③「週間」タブの日別内訳は、売上が無い日も含めて必ず直近7日分を表示する
//
// analytics-system.js は直接編集せず、
//   ・calcDailyBreakdown() / calcBestSellingDay() を上書き（dateKeyを付与）
//   ・renderAnalytics() / showAnalyticsBreakdown() をフックして
//     天気アイコンの表示・日付カードの非表示を後付けする
// という「フック方式」で実現する（他の追加機能ファイルと同じ考え方）。
//
// ※ 天気取得の位置情報は、ブラウザのGeolocation API（現在地）から自動取得する。
//    一度取得した位置はlocalStorageにキャッシュし、次回以降は再取得しない
//    （位置は基本的に変わらない店舗設置端末のため）。取得できない・拒否された
//    場合は、フォールバック座標（熊谷市）を使用する。
// ==========================================

const ANALYTICS_FALLBACK_LAT = 36.1472;
const ANALYTICS_FALLBACK_LON = 139.3891;
const ANALYTICS_LOCATION_CACHE_KEY = 'pos_analytics_location';

// 現在地の取得を試みて、成功したらlocalStorageにキャッシュする（非同期・裏側で実行）。
// 取得中や失敗時にも他の処理が止まらないよう、呼び出し側は
// getAnalyticsLocation() が返すキャッシュ値（無ければフォールバック）を使い続ける。
function requestAnalyticsLocationUpdate() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude, obtainedAt: Date.now() };
            localStorage.setItem(ANALYTICS_LOCATION_CACHE_KEY, JSON.stringify(loc));
        },
        (err) => {
            console.warn('現在地の取得に失敗しました（天気表示はフォールバック座標を使用します）:', err);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 24 * 60 * 60 * 1000 }
    );
}

function getAnalyticsLocation() {
    try {
        const cached = JSON.parse(localStorage.getItem(ANALYTICS_LOCATION_CACHE_KEY) || 'null');
        if (cached && typeof cached.lat === 'number' && typeof cached.lon === 'number') {
            return { lat: cached.lat, lon: cached.lon };
        }
    } catch (e) { /* 無視してフォールバックへ */ }
    return { lat: ANALYTICS_FALLBACK_LAT, lon: ANALYTICS_FALLBACK_LON };
}

// キャッシュが無ければ起動時に一度、現在地の取得を試みる
(function initAnalyticsLocation() {
    const cached = localStorage.getItem(ANALYTICS_LOCATION_CACHE_KEY);
    if (!cached) requestAnalyticsLocationUpdate();
})();

// Visual Crossing の icon ID → 絵文字（Open-Meteo時代と同じ絵文字セット）
function weatherIconFromVcIcon(icon) {
    const id = String(icon || '').toLowerCase();
    if (!id) return '';
    if (id.includes('thunder')) return '⛈️';
    if (id.includes('snow')) return '🌨️';
    if (id.includes('showers')) return '🌦️';
    if (id.includes('rain')) return '🌧️';
    if (id.includes('fog')) return '🌫️';
    if (id.includes('partly-cloudy')) return '⛅';
    if (id.includes('cloudy')) return '☁️';
    if (id.includes('clear')) return '☀️';
    if (id.includes('wind')) return '💨';
    return '';
}

/* =========================================================
   Visual Crossing Timeline API（APIキー不要・営利利用OK）
   ------------------------------------------
   ・無料のキー無しアクセスは「端末のIPアドレス」ごとに利用量が管理される
     （フェアユース）。月間表示などで何十件も同時に取りに行かないよう、
     同時に走らせる通信は2件までに絞り、同じ日付は1回だけ取りに行く。
   ・429（混み合い）が返ったら、その時は何もキャッシュせず空表示にして
     次回また取り直す（エラー結果を「その日の天気」として保存しない）。
   ========================================================= */
const VC_TIMELINE_BASE = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/';
const VC_MAX_CONCURRENT = 2;
let vcActiveCount = 0;
const vcWaitQueue = [];
const vcInflight = {}; // 同じURLの同時リクエストを1つにまとめる

function vcAcquireSlot() {
    if (vcActiveCount < VC_MAX_CONCURRENT) {
        vcActiveCount++;
        return Promise.resolve();
    }
    return new Promise(resolve => vcWaitQueue.push(resolve));
}
function vcReleaseSlot() {
    const next = vcWaitQueue.shift();
    if (next) next(); // 枠をそのまま次の待ち行列へ渡す
    else vcActiveCount--;
}

// dateSegment: 'YYYY-MM-DD' または 'today'。戻り値：{ icon, tempMax, tempMin } か、失敗時は null
async function fetchVcDailyWeather(dateSegment) {
    const { lat, lon } = getAnalyticsLocation();
    const url = `${VC_TIMELINE_BASE}${lat},${lon}/${dateSegment}?unitGroup=metric&include=days&elements=datetime,tempmax,tempmin,icon&lang=en&contentType=json`;

    if (vcInflight[url]) return vcInflight[url];

    const task = (async () => {
        await vcAcquireSlot();
        try {
            const res = await fetch(url);
            if (!res.ok) {
                console.warn(`天気情報の取得に失敗しました（HTTP ${res.status}）`);
                return null;
            }
            const data = await res.json();
            const day = data && Array.isArray(data.days) ? data.days[0] : null;
            if (!day) return null;
            const tMax = day.tempmax;
            const tMin = day.tempmin;
            return {
                icon: weatherIconFromVcIcon(day.icon),
                tempMax: (typeof tMax === 'number' && !isNaN(tMax)) ? Math.round(tMax) : null,
                tempMin: (typeof tMin === 'number' && !isNaN(tMin)) ? Math.round(tMin) : null
            };
        } catch (e) {
            console.warn('天気情報の取得に失敗しました:', e);
            return null;
        } finally {
            vcReleaseSlot();
            delete vcInflight[url];
        }
    })();
    vcInflight[url] = task;
    return task;
}

// 「Weather data provided by Visual Crossing Weather」クレジット（利用条件で必須）
const VC_ATTRIBUTION_HTML = 'Weather data provided by <a href="https://www.visualcrossing.com/" target="_blank" rel="noopener noreferrer" style="color:inherit; text-decoration:underline;">Visual Crossing Weather</a>';
const VC_ATTRIBUTION_STYLE = 'font-size:10px; color:#9e9e9e; margin-top:4px;';

function ensureWeatherAttribution(parentEl) {
    if (!parentEl || parentEl.querySelector(':scope > .analytics-weather-attribution')) return;
    const el = document.createElement('div');
    el.className = 'analytics-weather-attribution';
    el.style.cssText = VC_ATTRIBUTION_STYLE;
    el.innerHTML = VC_ATTRIBUTION_HTML;
    parentEl.appendChild(el);
}

function getAnalyticsWeatherCache() {
    try { return JSON.parse(localStorage.getItem('pos_analytics_weather_cache') || '{}'); }
    catch (e) { return {}; }
}
function saveAnalyticsWeatherCache(cache) {
    localStorage.setItem('pos_analytics_weather_cache', JSON.stringify(cache));
}

// dateKey: 'YYYY-MM-DD'。天気アイコンに加え、その日の最高・最低気温（℃・四捨五入）も取得する。
// 未来日・取得失敗時は空値（icon: '', tempMax/tempMin: null）を返す。
async function fetchWeatherInfoForDate(dateKey) {
    if (!dateKey) return { icon: '', tempMax: null, tempMin: null };
    const cache = getAnalyticsWeatherCache();
    const cached = cache[dateKey];
    if (cached !== undefined) {
        // 後方互換：気温追加前のキャッシュはアイコン文字列のみを保存していた
        if (typeof cached === 'string') return { icon: cached, tempMax: null, tempMin: null };
        return cached;
    }

    const info = await fetchVcDailyWeather(dateKey);
    // 取得失敗（null）や、中身が空の結果は保存しない（次回また取り直せるように）
    if (!info || (!info.icon && info.tempMax === null && info.tempMin === null)) {
        return { icon: '', tempMax: null, tempMin: null };
    }
    // 複数日を同時に取得すると、取得前に読んだキャッシュで上書きして他の日の分を
    // 消してしまうため、保存の直前に読み直してから書き足す
    const latestCache = getAnalyticsWeatherCache();
    latestCache[dateKey] = info;
    saveAnalyticsWeatherCache(latestCache);
    return info;
}

// 天気アイコン＋最高/最低気温を、表示用の1つの文字列にまとめる（例: "☀️ 30℃/22℃"）
function formatWeatherBadgeText(info) {
    if (!info) return '';
    let text = info.icon || '';
    if (info.tempMax !== null && info.tempMax !== undefined && info.tempMin !== null && info.tempMin !== undefined) {
        const tempText = `${info.tempMax}℃/${info.tempMin}℃`;
        text = text ? `${text} ${tempText}` : tempText;
    }
    return text;
}

/* =========================================================
   ① 日別集計に dateKey（天気取得用）を付与 ／ 週間は7日分を必ず表示
   ========================================================= */
(function patchCalcDailyBreakdown() {
    function tryPatch() {
        if (typeof window.calcDailyBreakdown !== 'function' || typeof window.getAnalyticsDateRange !== 'function') {
            setTimeout(tryPatch, 300);
            return;
        }
        const original = window.calcDailyBreakdown;
        window.calcDailyBreakdown = function (historyList) {
            if (typeof currentAnalyticsPeriod !== 'undefined' && currentAnalyticsPeriod === 'week') {
                const { start } = getAnalyticsDateRange('week');
                const dayMap = {};
                historyList.forEach(item => {
                    const t = item.dateISO ? new Date(item.dateISO) : (item.date ? new Date(item.date) : null);
                    if (!t || isNaN(t.getTime())) return;
                    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
                    if (!dayMap[key]) dayMap[key] = { total: 0, count: 0 };
                    dayMap[key].total += (item.total || 0);
                    dayMap[key].count += 1;
                });

                const labels = [];
                const counts = {};
                const txCounts = {};
                const dateKeys = {};
                for (let i = 0; i < 7; i++) {
                    const d = new Date(start);
                    d.setDate(d.getDate() + i);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    const youbi = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
                    const label = `${d.getMonth() + 1}/${d.getDate()}(${youbi})`;
                    labels.push(label);
                    counts[label] = dayMap[key] ? dayMap[key].total : 0;
                    txCounts[label] = dayMap[key] ? dayMap[key].count : 0;
                    dateKeys[label] = key;
                }

                const total = labels.reduce((sum, l) => sum + counts[l], 0);
                let best = null;
                labels.forEach(label => { if (!best || counts[label] > best.count) best = { label, count: counts[label] }; });

                return { counts, labels, total, best, txCounts, dateKeys };
            }

            const result = original(historyList);
            // 日付キーを別途付与する（週間以外＝月間・本日）
            result.dateKeys = {};
            historyList.forEach(item => {
                const t = item.dateISO ? new Date(item.dateISO) : (item.date ? new Date(item.date) : null);
                if (!t || isNaN(t.getTime())) return;
                const youbi = ['日', '月', '火', '水', '木', '金', '土'][t.getDay()];
                const label = `${t.getMonth() + 1}/${t.getDate()}(${youbi})`;
                const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
                result.dateKeys[label] = key;
            });
            return result;
        };
    }
    tryPatch();
})();

(function patchCalcBestSellingDay() {
    function tryPatch() {
        if (typeof window.calcBestSellingDay !== 'function') {
            setTimeout(tryPatch, 300);
            return;
        }
        window.calcBestSellingDay = function (historyList) {
            const dayMap = {};
            historyList.forEach(item => {
                const t = item.dateISO ? new Date(item.dateISO) : (item.date ? new Date(item.date) : null);
                if (!t || isNaN(t.getTime())) return;
                const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
                if (!dayMap[key]) dayMap[key] = { total: 0, count: 0, dateObj: t };
                dayMap[key].total += (item.total || 0);
                dayMap[key].count += 1;
            });
            let bestKey = null, best = null;
            Object.entries(dayMap).forEach(([key, data]) => {
                if (!best || data.total > best.total) { best = data; bestKey = key; }
            });
            if (!best) return null;
            const d = best.dateObj;
            const youbi = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
            return {
                dateLabel: `${d.getMonth() + 1}月${d.getDate()}日（${youbi}）`,
                total: best.total,
                count: best.count,
                dateKey: bestKey
            };
        };
    }
    tryPatch();
})();

/* =========================================================
   ② 「本日」タブでは日付カードを非表示 ／ それ以外は天気を表示
   ========================================================= */
(function patchRenderAnalytics() {
    function tryPatch() {
        if (typeof window.renderAnalytics !== 'function') {
            setTimeout(tryPatch, 300);
            return;
        }
        const original = window.renderAnalytics;
        window.renderAnalytics = function (...args) {
            const result = original.apply(this, args);
            postProcessAnalyticsDayCard();
            return result;
        };
    }
    tryPatch();
})();

function postProcessAnalyticsDayCard() {
    const container = document.getElementById('analytics-content');
    if (!container) return;

    const isToday = (typeof currentAnalyticsPeriod !== 'undefined' && currentAnalyticsPeriod === 'day');

    // 「本日」タブでは、時間帯別（何時にどのくらい売れたか）の棒グラフを表示する。
    // それ以外のタブでは（表示されていれば）取り除く。
    if (isToday) {
        renderHourlySalesChart(container);
    } else {
        removeHourlySalesChart();
    }

    const dayCard = container.querySelector('.analytics-card[onclick*="showAnalyticsBreakdown(\'day\')"]');
    if (!dayCard) return;

    if (isToday) {
        // 本日分は「一番売れた日」＝今日であり無意味なため非表示にする
        dayCard.style.display = 'none';
        return;
    }
    dayCard.style.display = '';

    const filtered = (typeof getFilteredHistoryForAnalytics === 'function' && typeof currentAnalyticsPeriod !== 'undefined')
        ? getFilteredHistoryForAnalytics(currentAnalyticsPeriod) : [];
    const bestDay = (typeof calcBestSellingDay === 'function') ? calcBestSellingDay(filtered) : null;
    if (!bestDay || !bestDay.dateKey) return;

    const mainEl = dayCard.querySelector('.analytics-card-main');
    if (!mainEl) return;
    let badge = mainEl.querySelector('.analytics-weather-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'analytics-weather-badge';
        badge.style.cssText = 'margin-left:8px; font-size:16px;';
        mainEl.appendChild(badge);
    }
    badge.innerText = '…';
    ensureWeatherAttribution(dayCard);
    fetchWeatherInfoForDate(bestDay.dateKey).then(info => { badge.innerText = formatWeatherBadgeText(info); });
}

/* =========================================================
   ④「本日」タブ：時間帯別（0時〜23時）の売上を棒グラフで表示する
   （あわせて、本日タブでは非表示になる「一番売れた日」カードの代わりに
   　このカードのタイトル横に本日の天気・最高/最低気温を表示する）
   ========================================================= */
const ANALYTICS_HOURLY_CHART_ID = 'analytics-hourly-sales-card';

function getTodayDateKeyForAnalytics() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 本日分は、確定前の天気（予報込み）として Visual Crossing の 'today' から取得する。
// 天気は当日中に変わることがあるため、キャッシュは3時間だけ再利用し、それ以降は取り直す。
async function fetchTodayWeatherInfo() {
    const dateKey = getTodayDateKeyForAnalytics();
    const cache = getAnalyticsWeatherCache();
    const cached = cache[dateKey];
    if (cached && typeof cached === 'object' && cached.fetchedAt && (Date.now() - cached.fetchedAt) < 3 * 60 * 60 * 1000) {
        return cached;
    }

    const got = await fetchVcDailyWeather('today');
    if (!got || (!got.icon && got.tempMax === null && got.tempMin === null)) {
        // 失敗時は、古い（3時間より前の）キャッシュがあればそれを使い、無ければ空表示
        if (cached && typeof cached === 'object') return cached;
        return { icon: '', tempMax: null, tempMin: null };
    }
    const info = Object.assign({}, got, { fetchedAt: Date.now() });
    const latestCache = getAnalyticsWeatherCache();
    latestCache[dateKey] = info;
    saveAnalyticsWeatherCache(latestCache);
    return info;
}

// dateISO（無ければdate）から「時」を取り出し、時間帯ごとの売上合計・件数を集計する
function computeHourlySalesBreakdown(historyList) {
    const totals = new Array(24).fill(0);
    const counts = new Array(24).fill(0);
    (historyList || []).forEach(rec => {
        const t = rec.dateISO ? new Date(rec.dateISO) : (rec.date ? new Date(rec.date) : null);
        if (!t || isNaN(t.getTime())) return;
        const h = t.getHours();
        totals[h] += (rec.total || 0);
        counts[h] += 1;
    });
    return { totals, counts };
}

function renderHourlySalesChart(container) {
    if (typeof getFilteredHistoryForAnalytics !== 'function') return;
    const filtered = getFilteredHistoryForAnalytics('day');
    const { totals, counts } = computeHourlySalesBreakdown(filtered);
    const maxTotal = Math.max(1, ...totals);
    const totalCount = counts.reduce((a, b) => a + b, 0);

    const barsHtml = totals.map((val, h) => {
        const heightPct = Math.round((val / maxTotal) * 100);
        const hasSales = val > 0;
        return `
            <div style="display:flex; flex-direction:column; align-items:center; flex:1; min-width:26px;">
                <div style="font-size:10px; color:#555; margin-bottom:2px; height:14px; white-space:nowrap;">${hasSales ? '¥' + val.toLocaleString() : ''}</div>
                <div style="width:100%; max-width:18px; height:110px; display:flex; align-items:flex-end; background:#f0f0f0; border-radius:3px 3px 0 0;">
                    <div style="width:100%; height:${heightPct}%; background:${hasSales ? '#00897b' : 'transparent'}; border-radius:3px 3px 0 0; transition:height 0.3s;"></div>
                </div>
                <div style="font-size:10px; color:#888; margin-top:4px;">${h}</div>
            </div>
        `;
    }).join('');

    let card = document.getElementById(ANALYTICS_HOURLY_CHART_ID);
    const isNewCard = !card;
    if (!card) {
        card = document.createElement('div');
        card.id = ANALYTICS_HOURLY_CHART_ID;
        card.className = 'analytics-card';
        container.appendChild(card);
    }

    // 天気バッジは毎回作り直すと取得のたびにチラつくため、既存のバッジがあれば内容を保持する
    const existingBadgeText = (!isNewCard && card.querySelector('.analytics-hourly-weather-badge'))
        ? card.querySelector('.analytics-hourly-weather-badge').innerText : '…';

    card.innerHTML = `
        <div class="analytics-card-title">🕐 本日の時間帯別売上　<span class="analytics-hourly-weather-badge" style="font-size:14px; font-weight:normal;">${existingBadgeText}</span></div>
        <div style="display:flex; align-items:flex-end; gap:4px; overflow-x:auto; padding-top:6px;">
            ${barsHtml}
        </div>
        <div class="analytics-card-sub">合計 ${totalCount}件（下の数字は時刻・24時間表記）</div>
        <div class="analytics-weather-attribution" style="${VC_ATTRIBUTION_STYLE}">${VC_ATTRIBUTION_HTML}</div>
    `;

    if (isNewCard) {
        fetchTodayWeatherInfo().then(info => {
            const badge = card.querySelector('.analytics-hourly-weather-badge');
            if (badge) badge.innerText = formatWeatherBadgeText(info);
        });
    }
}

function removeHourlySalesChart() {
    const card = document.getElementById(ANALYTICS_HOURLY_CHART_ID);
    if (card) card.remove();
}

/* =========================================================
   ③ 日別内訳モーダル（週間タブ含む）に天気アイコンを追加
   ========================================================= */
(function patchShowAnalyticsBreakdown() {
    function tryPatch() {
        if (typeof window.showAnalyticsBreakdown !== 'function') {
            setTimeout(tryPatch, 300);
            return;
        }
        const original = window.showAnalyticsBreakdown;
        window.showAnalyticsBreakdown = function (kind) {
            const result = original(kind);
            if (kind === 'day') addWeatherToDailyBreakdownModal();
            return result;
        };
    }
    tryPatch();
})();

function addWeatherToDailyBreakdownModal() {
    const breakdown = (typeof lastDailyBreakdown !== 'undefined') ? lastDailyBreakdown : null;
    if (!breakdown || !breakdown.dateKeys) return;
    const body = document.getElementById('analytics-barchart-body');
    if (!body) return;

    ensureWeatherAttribution(body);
    const spans = body.querySelectorAll('span');
    breakdown.labels.forEach(label => {
        const key = breakdown.dateKeys[label];
        if (!key) return;
        spans.forEach(span => {
            if (span.dataset.weatherAdded) return;
            const text = span.textContent.trim();
            if (text.endsWith(label)) {
                span.dataset.weatherAdded = '1';
                const badge = document.createElement('span');
                badge.innerText = ' …';
                span.appendChild(badge);
                fetchWeatherInfoForDate(key).then(info => {
                    const text = formatWeatherBadgeText(info);
                    badge.innerText = text ? ' ' + text : '';
                });
            }
        });
    });
}
