// ==========================================
// ai-store-analysis-system.js（改訂版 v4 - AIエンジンを
// 「@huggingface/transformers」から「WebLLM」へ全面移行した版）
// 売上分析画面(analytics-screen)に「AIによる店舗分析」を追加する機能
// ------------------------------------------
// 【v4での変更点：@huggingface/transformers → WebLLM への移行】
// v3ではTransformers.js（ONNX Runtime Web）を使い、WebGPU非対応の
// 端末でもCPU(WASM)モードで動作できるようにしていた。しかしCPUモードは
// 応答がかなり遅く、「重くて実用的でない」という声があった。
//
// そこで、WebGPUに特化した推論エンジン「WebLLM」
// (https://github.com/mlc-ai/web-llm)に切り替えた。WebGPUという
// GPUをブラウザから直接使う技術に対応した端末専用になる代わりに、
// 応答速度が大きく向上する（体感の「軽さ」を優先した構成）。
//
// モデルは「軽量・高速でありながら日本語もある程度自然に扱えて、
// そこそこ賢いモデル」として、Qwen2.5シリーズ（Alibaba製・多言語対応）の
// WebLLM向けビルド済み版の中から、次の2つに絞って選べるようにした。
//   ・Qwen2.5-1.5B-Instruct … ⭐おすすめ（賢さと速さのバランスが良い）
//   ・Qwen2.5-0.5B-Instruct … 最も軽量・高速（非力な端末向け）
// どちらも4bit量子化（軽量化）した状態でダウンロード・実行する。
//
//   ・良い点
//     - APIキーが一切不要（Firebaseへの保存も不要）
//     - 集計データが外部のサーバーに送信されない
//       （インターネット回線を切っても、モデルさえダウンロード済みなら動く）
//     - 利用料金がかからない
//     - WebGPUのGPUアクセラレーションにより、応答がかなり速い
//   ・注意点
//     - 「WebGPU」という比較的新しい技術に対応したブラウザ・端末でしか
//       AI機能を使えない（型落ちのパソコンやタブレットの一部では
//       利用できない場合がある。非対応の場合はその旨を案内する）
//     - 初回だけ、AIモデル本体（数百MB〜1GB程度）をダウンロードする必要がある
//       （一度ダウンロードすればブラウザに保存され、次回以降は高速に起動する）
//     - クラウドの大規模なAIと比べると、回答の精度・日本語の自然さは
//       やや劣る場合がある（軽量なモデルほどその傾向が強い）
//
// 【使い方】
// 分析画面右上の「⚙️ AIモデル設定」から、動かすモデルを選ぶ
// （初回選択時はダウンロードが走るため少し時間がかかる）。
// あとはこれまでと同じように、テンプレートボタンか自由記述で質問できる。
//
// discount-system.js / index.html / register.js / ui.js は直接編集せず、
// 他の追加機能ファイルと同じ「フック/DOM注入方式」で実現する。
// ------------------------------------------
// 【v5で追加：GPUエラー・重すぎる場合の自動フォールバック】
// WebGPU環境はまだ不安定で、端末やタイミングによって「GPUメモリ不足」
// 「デバイスがロストした（device lost）」といったエラーで、AI応答が
// 全く得られなくなることがある、という報告があった。
// そこで、AI呼び出しが失敗した場合に以下の順で自動的にリカバリーし、
// 最終的には必ず何らかの回答（レポート）を画面に表示するようにした。
//   ① 選択中モデルで実行 → 失敗
//   ② GPU/メモリ系のエラーで、かつより軽量なモデルがあれば、
//     　自動でそちらに切り替えて1回だけ再試行（設定自体は変更しない）
//   ③ それでも失敗、またはAIがそもそも使えない場合は、AIを使わず
//     　集計データ（buildStoreAnalysisSummary）だけから簡易レポートを
//     　その場で自動生成して表示する（＝AIが完全にダメでも「無回答」には
//     　絶対にしない）
// あわせて、GPUエラーを検知した際は壊れている可能性のあるエンジンの
// 参照を破棄し、次回の質問はまっさらな状態からやり直せるようにする。
// ==========================================

/* =========================================================
   テンプレート（ワンタップで聞ける質問）
   ========================================================= */
// 【v2で追加】各テンプレートに「実際に分析へ必要な期間」を持たせておき、
// buildStoreAnalysisSummary() で不要な期間の集計を作らない・送らない
// ようにする（送信データ量を減らして毎回の処理の重さを軽減するため）。
// 何も指定しない（未指定）場合は、自由記述の質問と同じく安全側に
// 3期間すべてを渡す。
const AI_ANALYSIS_TEMPLATES = [
    { label: '📅 本日/週間/月間 比較', prompt: '本日・直近7日間・直近30日間のデータを、それぞれ見出しを分けて分析してください。各期間ごとに「取引件数」「売上合計」「人気商品」「曜日の傾向」の変化がわかるように箇条書きでまとめ、最後に期間をまたいだ傾向・気づきを一言でまとめてください。', periods: ['today', 'week', 'month'] },
    { label: '📈 売れ筋・不振品', prompt: '直近のデータから、売れ筋商品と売上が伸び悩んでいる商品をそれぞれ挙げて、理由の推測と改善案を提案してください。', periods: ['month'] },
    { label: '🗓️ 曜日の傾向', prompt: '曜日ごとの取引件数の傾向を分析し、特に混雑・閑散している曜日と、その対策案を提案してください。', periods: ['month'] },
    { label: '🏷️ 自動化バーコードの効果', prompt: '登録されている自動化バーコード（割引・商品自動追加）の件数や内容を踏まえて、活用状況の評価と改善案を提案してください。', periods: [] },
    { label: '👥 会員ランクの傾向', prompt: '会員ランクの分布から、会員施策（キャンペーンや特典）の改善アイデアを提案してください。', periods: [] },
    { label: '💡 売上アップの提案', prompt: 'これまでのデータ全体を踏まえて、売上を伸ばすための具体的な改善アイデアを3つ、優先度付きで提案してください。', periods: ['month'] },
    { label: '📦 品揃えの見直し', prompt: '販売数が少ない商品を挙げて、品揃え・仕入れの見直し案を提案してください。', periods: ['month'] },
    { label: '⏰ 時間帯別の傾向', prompt: '本日の時間帯別の売上・取引件数から、混雑・閑散している時間帯を挙げて、人員配置やタイムセールなどの対策案を提案してください。', periods: ['today'] },
    { label: '💳 客単価の分析', prompt: '直近30日間のデータから平均客単価の傾向を分析し、セット販売やついで買いの提案など、客単価を上げるための具体的な施策を提案してください。', periods: ['month'] },
    { label: '🔁 リピーター・常連客', prompt: '会員ランクの分布や取引の傾向から、リピーター・常連客を増やすための具体的な施策を提案してください。', periods: ['month'] },
    { label: '🎉 季節・イベント施策', prompt: '直近の売れ筋商品や曜日の傾向を踏まえて、季節やイベントに合わせたキャンペーン・販促のアイデアを提案してください。', periods: ['month'] },
    { label: '📉 売上減少の要因分析', prompt: '直近7日間と直近30日間のデータを比較し、売上や取引件数が落ち込んでいる場合はその要因を推測し、改善のための対策案を提案してください。', periods: ['week', 'month'] }
];

/* =========================================================
   集計データの組み立て（個人情報は含めない）
   ========================================================= */
function getHistoryListSafe() {
    try {
        if (typeof historyList !== 'undefined' && Array.isArray(historyList)) return historyList;
    } catch (e) { /* 無視 */ }
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

function summarizeHistoryPeriod(list) {
    let revenue = 0;
    const productCount = {};
    const dowCount = [0, 0, 0, 0, 0, 0, 0];
    list.forEach(rec => {
        revenue += Number(rec.total || rec.amount || 0) || 0;
        const items = Array.isArray(rec.cartSnapshot) ? rec.cartSnapshot : [];
        items.forEach(i => {
            const name = (i && i.name) || '(不明な商品)';
            productCount[name] = (productCount[name] || 0) + (Number(i && i.qty) || 1);
        });
        const t = parseRecordDateSafe(rec);
        if (t !== null) dowCount[new Date(t).getDay()]++;
    });
    const topProducts = Object.entries(productCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, qty]) => `${name}: ${qty}点`);
    const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];
    const dowSummary = dowLabels.map((l, i) => `${l}:${dowCount[i]}件`).join(' ');
    return {
        取引件数: list.length,
        売上合計: Math.round(revenue),
        人気商品トップ10: topProducts,
        曜日別取引件数: dowSummary
    };
}

// discount-system.js / customer-export-system.js / product-export-system.js
// などがすでに用意している安全な取得関数があればそれを使い回す
//
// 【v2で改訂】引数 periods で「本日／直近7日間／直近30日間」のうち
// 実際に必要な期間だけを指定できるようにした。未指定（undefined）の
// ときは従来どおり3期間すべてを含める（自由記述の質問向けの安全な
// デフォルト）。テンプレート側で使わない期間を最初から除くことで、
// AIに渡すJSONを軽くし、処理の重さを減らす。
// 【不具合修正】以前は「本日」を「直近24時間以内」（now - 24時間）で
// 判定していたが、これだと例えば現在15時なら「昨日15時〜今日15時」が
// 対象になってしまい、本来の「今日の0時から」という意味の「本日」と
// ズレる。しかもこのズレが、下の時間帯別グラフ（buildHourlyRevenueSeries）
// で深刻な見え方の誤りを生んでいた：グラフは時刻を「時（0〜23時）」だけで
// 集計するため、直近24時間フィルタのままだと「昨日の夕方〜夜」のデータと
// 「今日のまだ来ていないはずの同じ時間帯」が同じバーに混ざって積み上がり、
// 実際には発生していない時間帯に売上があるように見えてしまっていた
// （＝「AIのグラフ出力がおかしい」という不具合の原因）。
// 「本日」はカレンダー上の当日0:00〜現在に統一する。
function isSameLocalDay(t, now) {
    const d = new Date(t);
    const n = new Date(now);
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function buildStoreAnalysisSummary(periods) {
    const needed = Array.isArray(periods) ? periods : ['today', 'week', 'month'];
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

    const result = {
        全期間取引件数: history.length,
        登録商品数: products.length,
        会員数: customers.length,
        会員ランク内訳: rankCount,
        有効な自動化バーコード数: discounts.filter(d => !d.archived).length
    };
    if (needed.includes('today')) result.本日 = summarizeHistoryPeriod(buckets.today);
    if (needed.includes('week')) result.直近7日間 = summarizeHistoryPeriod(buckets.week);
    if (needed.includes('month')) result.直近30日間 = summarizeHistoryPeriod(buckets.month);
    return result;
}

/* =========================================================
   ①-2【今回追加】折れ線グラフ用の時系列データ作成
   ------------------------------------------
   「AI分析結果を折れ線グラフでも見たい」という要望に対応する。
   AIへ渡すテキストの集計（buildStoreAnalysisSummary）とは別に、
   グラフ描画用の時系列（本日=時間帯別、週間/月間=日別）の売上を作る。
   実際にその回の質問で使われた期間（periods）の分だけ作成し、
   periodsが空（自動化バーコードの効果、など数値の推移に意味が
   無いテンプレート）の場合は何も作らない。
   ========================================================= */
// 呼び出し側（buildAiAnalysisChartSeries）で「本日（＝当日0時から）」の
// レコードだけに絞り込んだ配列を渡す前提の関数。ここで改めて絞り込みは
// 行わない（絞り込み条件を二重に持つと今回のような食い違いの再発リスクに
// なるため、判定は isSameLocalDay() の1箇所に集約している）。
function buildHourlyRevenueSeries(list) {
    const hours = new Array(24).fill(0);
    list.forEach(rec => {
        const t = parseRecordDateSafe(rec);
        if (t === null) return;
        hours[new Date(t).getHours()] += Number(rec.total || rec.amount || 0) || 0;
    });
    return { labels: hours.map((_, h) => `${h}時`), values: hours.map(v => Math.round(v)) };
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
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        order.push(key);
        buckets.set(key, { date: d, revenue: 0 });
    }

    list.forEach(rec => {
        const t = parseRecordDateSafe(rec);
        if (t === null) return;
        const d = new Date(t);
        d.setHours(0, 0, 0, 0);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (buckets.has(key)) buckets.get(key).revenue += Number(rec.total || rec.amount || 0) || 0;
    });

    const labels = order.map(key => {
        const { date } = buckets.get(key);
        return `${date.getMonth() + 1}/${date.getDate()}(${dowLabels[date.getDay()]})`;
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
        // 【不具合修正】withinDays(rec, 1)＝直近24時間ではなく、本文の集計と
        // 揃えて「当日0時から現在まで」のレコードだけを対象にする。
        const { labels, values } = buildHourlyRevenueSeries(history.filter(rec => {
            const t = parseRecordDateSafe(rec);
            return t !== null && isSameLocalDay(t, now);
        }));
        charts.push({ periodKey: 'today', title: '📅 本日の売上推移（時間帯別）', labels, values });
    }
    if (needed.includes('week')) {
        const { labels, values } = buildDailyRevenueSeries(history.filter(rec => withinDays(rec, 7)), 7);
        charts.push({ periodKey: 'week', title: '📈 直近7日間の売上推移', labels, values });
    }
    if (needed.includes('month')) {
        const { labels, values } = buildDailyRevenueSeries(history.filter(rec => withinDays(rec, 30)), 30);
        charts.push({ periodKey: 'month', title: '📈 直近30日間の売上推移', labels, values });
    }
    return charts;
}

/* =========================================================
   WebLLM本体の読み込み・モデル管理・推論エンジン管理
   ------------------------------------------
   ・WebLLMはCDN（esm.run）からES Modulesとして読み込む（index.html側
   　では何も追加設定しなくてよいよう、このファイル内で動的import()する。
   　初めてAI機能を使うタイミングまで読み込まれないため、通常時の
   　ページ表示速度には影響しない）。
   ・WebLLMはWebGPUという比較的新しいブラウザ機能が必須。非対応の
   　端末では（CPUへの自動切り替えは行わず）AI機能が使えない旨を案内する。
   ・一度読み込んだモデル（エンジン本体）はこのファイル内に保持し、
   　同じモデルであれば毎回作り直さない（2回目以降の質問を高速化）。
   ========================================================= */
const WEBLLM_CDN_URL = 'https://esm.run/@mlc-ai/web-llm';
// 【v4で変更】Transformers.js時代のモデルID（例: "onnx-community/Qwen2.5-1.5B-Instruct"）
// とは形式がまったく異なる（例: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"）ため、
// 古い保存値をそのまま使うと不具合の原因になる。誤って引き継がないよう、
// あえて別のキー名にしている。
const AI_MODEL_STORAGE_KEY = 'pos_ai_webllm_model_id';

// 【v4で変更】WebLLMはビルド済みモデル一覧（prebuiltAppConfig.model_list）を
// 持っているが、その中から「POSレジでの日本語店舗分析用途に向く、軽量・高速で
// ある程度賢いモデル」を、あらかじめ2つだけ選び、固定の一覧として持たせている
// （どちらもAlibaba製Qwen2.5系のWebLLMビルド済み版、4bit量子化）。
const AI_MODEL_LIST = [
    {
        model_id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
        sweetSpot: true,
        sizeLabel: '約1.1GB',
        note: '賢さと速さのバランスが良く、日本語の受け答えも比較的自然'
    },
    {
        model_id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
        sweetSpot: false,
        sizeLabel: '約0.4GB',
        note: '最も軽量・高速。非力な端末やお試しにおすすめ（日本語の言い回しがやや不自然になりやすいので、気になる場合はQwen2.5-1.5Bをお試しください）'
    }
];

let webllmModulePromise = null;
let webllmModule = null; // 読み込み後、WebLLMの名前空間（CreateMLCEngine等）を保持しておく
function loadWebllmModule() {
    if (!webllmModulePromise) {
        webllmModulePromise = import(/* webpackIgnore: true */ WEBLLM_CDN_URL).then(mod => {
            webllmModule = mod;
            return mod;
        }).catch(e => {
            webllmModulePromise = null; // 失敗時は次回また読み込み直せるようにする
            throw e;
        });
    }
    return webllmModulePromise;
}

// WebLLMはWebGPU専用（CPUへの自動切り替えは無い）ため、この判定結果が
// そのまま「AI機能自体が使えるかどうか」になる。
function isWebGpuAvailableSafe() {
    return !!(navigator && 'gpu' in navigator);
}

function getSavedAiModelId() {
    try {
        return localStorage.getItem(AI_MODEL_STORAGE_KEY) || '';
    } catch (e) {
        return '';
    }
}

function saveAiModelId(modelId) {
    try {
        localStorage.setItem(AI_MODEL_STORAGE_KEY, modelId);
    } catch (e) { /* 無視 */ }
}

// 現在読み込み済みのWebLLMエンジンを保持する。
let aiEngineState = {
    modelId: null,
    engine: null,        // WebLLMのMLCEngineインスタンス
    loadingPromise: null
};

// モデルを読み込み済みのエンジンを取得する（未読み込み・別モデルなら読み込み直す）。
// WebLLMはWebGPU専用のため、事前にisWebGpuAvailableSafe()での確認が必要。
async function getAiEngine(modelId, onProgress) {
    if (aiEngineState.engine && aiEngineState.modelId === modelId) {
        return aiEngineState;
    }
    if (aiEngineState.loadingPromise) {
        return aiEngineState.loadingPromise;
    }

    aiEngineState.loadingPromise = (async () => {
        const webllm = await loadWebllmModule();

        // 別のモデルに切り替える場合は、古いモデルのメモリを解放しておく
        if (aiEngineState.engine && aiEngineState.modelId !== modelId) {
            try {
                await aiEngineState.engine.unload();
            } catch (e) { /* 無視 */ }
        }

        // WebLLMはビルド済みモデル（4bit量子化済み）をそのままダウンロードして使う
        const engine = await webllm.CreateMLCEngine(modelId, {
            initProgressCallback: onProgress
        });

        aiEngineState.engine = engine;
        aiEngineState.modelId = modelId;
        return aiEngineState;
    })();

    try {
        return await aiEngineState.loadingPromise;
    } finally {
        aiEngineState.loadingPromise = null;
    }
}

/* =========================================================
   AI呼び出し本体（@huggingface/transformers／ブラウザ内で完結）
   ========================================================= */
// ユーザーが「⏹ 停止」を押したかどうかのフラグ。
// WebLLMのengine.interruptGenerate()で実際の生成も止めつつ、
// こちらのフラグでも早期終了の判定に使う。
let aiAnalysisStopRequested = false;

// 【新機能】質問のたびに回答を消さず、「💾 保存」を押すまでは
// 前の回答の下にどんどん積み重ねて表示するための蓄積テキスト。
// 保存されたら空に戻す（resetAiAnalysisResultDisplay参照）。
let aiAnalysisAccumulatedText = '';

function requestStopAiAnalysis() {
    aiAnalysisStopRequested = true;
    if (aiEngineState.engine) {
        try { aiEngineState.engine.interruptGenerate(); } catch (e) { /* 無視 */ }
    }
    if (typeof playSound === 'function') playSound('click');
}

// 1回の応答で生成する最大トークン数（あまり厳密な文字数とは一致しないが、
// 目安として900字程度に収まるよう少し余裕を持たせている）
const AI_MAX_NEW_TOKENS = 1200;

// 【v5で追加】overrideModelIdを渡した場合は、保存済みの設定を変更せずに
// そのモデルIDで実行する（GPUエラー時の「軽量モデルへの自動切り替え」用）。
async function callAiForStoreAnalysis(promptText, periods, onProgress, onToken, overrideModelId) {
    const modelId = overrideModelId || getSavedAiModelId();
    if (!modelId) {
        const err = new Error('NO_MODEL_SELECTED');
        err.code = 'NO_MODEL_SELECTED';
        throw err;
    }
    if (!isWebGpuAvailableSafe()) {
        const err = new Error('WEBGPU_NOT_SUPPORTED');
        err.code = 'WEBGPU_NOT_SUPPORTED';
        throw err;
    }

    // 【v2で改訂】periodsが指定されていれば、そのテンプレートに実際に
    // 必要な期間の集計だけをAIに渡す（不要なデータを渡さないことで
    // 処理の重さを減らす）。未指定（自由記述の質問）の場合は従来どおり
    // 3期間すべてを渡す。
    const summary = buildStoreAnalysisSummary(periods);
    // 【不具合報告への対応】小さいAIモデルほど、渡したデータに無い数字や
    // 商品名を「それっぽく」作って答えてしまう（ハルシネーション）ことがある、
    // 質問と関係のない内容を答えてしまうことがある、という報告があった。
    // 完全になくすことはできないが、次の2点で発生しにくくする。
    //   ① システムプロンプトに「データに無いことは書かない・分からなければ
    //      正直にそう書く」ことを明記する
    //   ② temperatureを下げ、答え方のブレ（＝それっぽい創作）を抑える
    // 【今回追加】軽量モデル（特にQwen2.5-0.5B）は、助詞の抜け・語尾の不統一・
    // 同じ言い回しの繰り返しなど、日本語として不自然な文章になりやすい、
    // という声があった。システムプロンプトに日本語の書き方そのものへの
    // 指示を追加し、あわせて生成パラメータのfrequency_penaltyで
    // 同じ表現の繰り返しを抑えることで、少しでも読みやすい日本語に近づける
    // （完全に解消することは難しいが、緩和は期待できる）。
    const systemText = 'あなたは小売店の売上データ分析アドバイザーです。渡された集計データ（JSON、個人情報は含まれません）には、分析に必要な期間の売上データが含まれています（「本日」「直近7日間」「直近30日間」のいずれか、または複数）。質問内容に応じて、含まれている期間のデータだけをもとに分析してください。日本語で分かりやすく、具体的な数字を交えながら分析・提案をしてください。回答は簡潔に、要点を箇条書き中心で、長くても900字程度にまとめてください。文章は必ず最後まで書き切り、途中で終わらせないでください。前置きは不要です。\n\n【日本語の書き方について】\n・文末は「です・ます」調に統一し、体言止めと混在させない。\n・助詞（が・を・に・は等）を省略・誤用しない、主語と述語がねじれない、一文を長くしすぎない（読点で適度に区切る）など、日本語として自然で正しい文章にする。\n・同じ語尾（「〜です。」「〜ます。」等）や同じ言い回しを何度も連続で使わず、表現に変化をつける。\n・英単語や記号を不必要に混ぜない（「本日」を"today"と書く、絵文字を多用する等はしない）。\n\n【厳守事項】\n・渡されたJSONデータに書かれていない商品名・数字・日付を、絶対に作り出さない（推測や一般論を、あたかもこの店のデータであるかのように書かない）。\n・数字を挙げるときは、必ずJSONデータに実際にある値をそのまま使う（丸めや概算で書く場合は「約」を付ける）。\n・質問に答えるための情報がJSONデータに含まれていない場合は、正直に「渡されたデータからは分かりません」と書き、それ以上は創作しない。\n・質問の意図から外れた話題（渡された質問と関係のない一般的な商売のアドバイスなど）を書かない。質問に直接関係することだけに答える。\n・あなたはharuレジ（POSレジアプリ）の店舗データ分析にのみ対応するAIです。POSレジ・店舗運営・売上データ分析に関係のない話題（雑談、他サービスの話、無関係な一般知識の質問など）を聞かれた場合は、他の内容を一切書かず「このAIはharuレジの会話のみ対応しています。haruレジのことならなんでもお聞きください！分析も致します！」とだけ回答してください。';
    const userText = `【店舗データ（集計値のみ）】\n${JSON.stringify(summary, null, 2)}\n\n【質問】\n${promptText}`;

    const engineState = await getAiEngine(modelId, onProgress);

    // モデルの読み込み待ちの間に停止が押されていた場合は、生成そのものを始めない
    if (aiAnalysisStopRequested) {
        return '(モデルの読み込み中に停止しました)';
    }

    const messages = [
        { role: 'system', content: systemText },
        { role: 'user', content: userText }
    ];

    // ストリーミング（少しずつ文章が表示される方式）にすることで、
    // 「待たされている感」を減らし、体感速度を大きく向上させる。
    // temperatureは0.2の低めに設定し、事実と違うことを言う頻度を抑える
    // （下げすぎると単調な文章になるため、0にはしていない）。
    // 【今回追加】frequency_penaltyを設定し、同じ語尾・同じ言い回しを
    // 繰り返しがちな傾向を抑え、日本語として少し読みやすくする。
    let fullText = '';
    let numTokens = 0;
    let finishReason = null;
    const chunks = await engineState.engine.chat.completions.create({
        messages,
        max_tokens: AI_MAX_NEW_TOKENS,
        temperature: 0.2,
        top_p: 0.9,
        frequency_penalty: 0.3,
        stream: true
    });

    for await (const chunk of chunks) {
        if (aiAnalysisStopRequested) break;
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (delta) {
            fullText += delta;
            numTokens++;
            if (typeof onToken === 'function') onToken(fullText);
        }
        if (chunk.choices && chunk.choices[0] && chunk.choices[0].finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
        }
    }

    if (aiAnalysisStopRequested) {
        fullText += '\n\n※ここで停止しました。';
    } else if (finishReason === 'length' || numTokens >= AI_MAX_NEW_TOKENS) {
        // 文字数上限に達して途中で切れてしまった場合は、その旨がわかるようにしておく
        fullText += '\n\n※文字数の上限に達したため、途中で終了しています。';
    }
    return fullText || '(応答を取得できませんでした)';
}

/* =========================================================
   【v5で追加】GPUエラー時の自動フォールバック
   ------------------------------------------
   ・isLikelyGpuOrResourceError() … エラーが「GPU・メモリ・端末性能」
   　絡みらしいかどうかを、エラーメッセージの文言から推測する。
   ・resetAiEngineStateSafe() … 壊れている可能性のあるエンジンの参照を
   　破棄する（そのままだと同じ壊れたエンジンを使い続けて何度も
   　失敗し続けてしまうため）。
   ・getLighterModelId() … 現在のモデルより軽量（サイズが小さい）な
   　候補モデルがAI_MODEL_LISTにあれば、そのモデルIDを返す。
   ・buildFallbackSimpleReport() / buildFallbackNoticeAndReport()
   　… AIが使えなかった場合に、AIを使わず集計データだけから
   　その場で作る簡易レポート。「AIが全滅しても無回答にはしない」
   　ための最終手段。
   ・getAiAnalysisAnswerRobust() … 上記を組み合わせた、呼び出し窓口。
   　基本的にこの関数は例外を投げず、必ず { text, usedFallback,
   　usedModelId } を返す。
   ========================================================= */
const AI_GPU_ERROR_KEYWORDS = [
    'webgpu', 'gpu', 'device was lost', 'device lost', 'lost the device',
    'requestadapter', 'requestdevice', 'createcomputepipeline',
    'out of memory', 'failed to allocate', 'memory access out of bounds',
    'unreachable', 'aborted(', 'context lost', 'gpuvalidationerror',
    'gpupipelineerror'
];

// エラーメッセージの文言から、GPU・メモリ・端末性能が原因らしい失敗かどうかを推測する。
// （WebLLM/WebGPU系のエラーは種類が多く、正式なエラーコードで判別しきれないため、
// 　キーワードでの推測に留めている。多少広めに拾っても、フォールバックに
// 　進むだけなので実害はない）
function isLikelyGpuOrResourceError(e) {
    const msg = String((e && (e.message || e)) || '').toLowerCase();
    return AI_GPU_ERROR_KEYWORDS.some(k => msg.includes(k));
}

// 壊れている可能性のあるエンジンの参照を破棄し、次回は必ず新しく
// 作り直すようにする（GPUエラー後にそのまま使い続けると、毎回
// 同じエラーで失敗し続けることがあるため）。
async function resetAiEngineStateSafe() {
    try {
        if (aiEngineState.engine) await aiEngineState.engine.unload();
    } catch (e) { /* 無視 */ }
    aiEngineState.engine = null;
    aiEngineState.modelId = null;
    aiEngineState.loadingPromise = null;
}

// 「約1.1GB」のような表記からGB数だけを取り出す。取り出せない場合はnull。
function parseModelSizeGb(sizeLabel) {
    if (!sizeLabel) return null;
    const m = String(sizeLabel).match(/([\d.]+)\s*GB/i);
    return m ? parseFloat(m[1]) : null;
}

// AI_MODEL_LISTの中から、現在のモデルより明確にサイズが小さい（＝より軽量な）
// モデルを探して返す（複数あれば最小のもの）。見つからなければnull。
function getLighterModelId(currentModelId) {
    const current = AI_MODEL_LIST.find(m => m.model_id === currentModelId);
    const currentSize = current ? parseModelSizeGb(current.sizeLabel) : null;
    const candidates = AI_MODEL_LIST
        .filter(m => m.model_id !== currentModelId)
        .map(m => ({ model_id: m.model_id, size: parseModelSizeGb(m.sizeLabel) }))
        .filter(c => c.size !== null && (currentSize === null || c.size < currentSize));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.size - b.size);
    return candidates[0].model_id;
}

// エラー内容を、画面に表示してよい短い日本語の理由文に変換する。
function describeAiError(e) {
    if (e && e.code === 'NO_MODEL_SELECTED') return 'AIモデルが設定されていません。';
    if (e && e.code === 'WEBGPU_NOT_SUPPORTED') return 'この端末（ブラウザ）はWebGPUに対応していません。';
    if (isLikelyGpuOrResourceError(e)) return 'GPU（画面表示用の処理装置）への負荷が高すぎたか、この端末では扱いきれなかった可能性があります。';
    return 'AIモデルの読み込み、または応答の生成中にエラーが発生しました。';
}

// AIを一切使わず、集計データ（buildStoreAnalysisSummary）だけから
// その場で作る簡易レポート。AIが全滅した場合の最終手段。
function buildFallbackSimpleReport(periods) {
    const needed = Array.isArray(periods) && periods.length > 0 ? periods : ['today', 'week', 'month'];
    const summary = buildStoreAnalysisSummary(needed);
    const lines = [];
    lines.push(`・全期間の取引件数: ${summary.全期間取引件数}件`);
    lines.push(`・登録商品数: ${summary.登録商品数}点`);
    lines.push(`・会員数: ${summary.会員数}人`);
    const rankEntries = Object.entries(summary.会員ランク内訳 || {});
    if (rankEntries.length > 0) {
        lines.push(`・会員ランク内訳: ${rankEntries.map(([k, v]) => `${k} ${v}人`).join('、')}`);
    }
    lines.push(`・有効な自動化バーコード数: ${summary.有効な自動化バーコード数}件`);

    const periodLabels = { today: '本日', week: '直近7日間', month: '直近30日間' };
    needed.forEach(key => {
        const label = periodLabels[key];
        const p = summary[label];
        if (!p) return;
        lines.push('');
        lines.push(`【${label}】`);
        lines.push(`・取引件数: ${p.取引件数}件`);
        lines.push(`・売上合計: ¥${Number(p.売上合計 || 0).toLocaleString()}`);
        lines.push(`・人気商品: ${(p.人気商品トップ10 && p.人気商品トップ10.length > 0) ? p.人気商品トップ10.slice(0, 5).join('、') : 'データなし'}`);
        lines.push(`・曜日別取引件数: ${p.曜日別取引件数}`);
    });

    return lines.join('\n');
}

// フォールバック時に表示する、理由・解決案・簡易レポートをまとめたテキストを作る。
// buildStoreAnalysisSummary自体が万一失敗しても、最低限のメッセージだけは返す。
function buildFallbackNoticeAndReport(reasonText, periods) {
    let report;
    try {
        report = buildFallbackSimpleReport(periods);
    } catch (e) {
        console.warn('簡易レポートの作成にも失敗しました:', e);
        report = '（集計データの読み込みにも失敗したため、簡易レポートも作成できませんでした）';
    }
    return [
        `⚠️ AIでの分析ができませんでした（${reasonText}）`,
        'そのため、AIを使わず集計データから自動的に作成した簡易レポートを代わりに表示しています。',
        '',
        '【解決のためにお試しください】',
        '・⚙️AIモデル設定で、より軽量なモデル（Qwen2.5-0.5B-Instruct）に切り替える',
        '・「🗑️ AIキャッシュ削除」でキャッシュを削除し、もう一度質問してモデルを読み込み直す',
        '・他のアプリ・タブを閉じてメモリに余裕を作る、または端末を再起動してから試す',
        '・最新版のChrome・Edgeなど、WebGPU対応ブラウザを使う',
        '--------------------------------',
        '📊 自動集計レポート（AIによる考察は含みません）',
        '--------------------------------',
        report
    ].join('\n');
}

// runAiAnalysis()からの唯一の呼び出し窓口。
// 「①選択中モデルで実行 → ②ダメならGPU系エラー時のみ軽量モデルで
// 　自動的に1回だけ再試行 → ③それでもダメ／そもそも使えないなら
// 　簡易レポートにフォールバック」という流れを、例外を外に投げずに
// 最後まで面倒を見る（呼び出し側は必ずtext入りの結果を受け取れる）。
async function getAiAnalysisAnswerRobust(promptText, periods, onProgress, onToken) {
    const modelId = getSavedAiModelId();
    if (!modelId) {
        return { text: buildFallbackNoticeAndReport('AIモデルが設定されていません。右上の「⚙️ AIモデル設定」から選んでください。', periods), usedFallback: true, usedModelId: null };
    }
    if (!isWebGpuAvailableSafe()) {
        return { text: buildFallbackNoticeAndReport('この端末（ブラウザ）はWebGPUに対応していないため、AI機能を利用できません。', periods), usedFallback: true, usedModelId: null };
    }

    try {
        const text = await callAiForStoreAnalysis(promptText, periods, onProgress, onToken, modelId);
        return { text, usedFallback: false, usedModelId: modelId };
    } catch (e1) {
        console.warn('AI分析（選択中モデル）に失敗しました:', e1);

        const gpuLike = isLikelyGpuOrResourceError(e1);
        if (gpuLike) await resetAiEngineStateSafe();

        const lighterModelId = gpuLike ? getLighterModelId(modelId) : null;
        if (lighterModelId) {
            if (typeof onProgress === 'function') {
                onProgress({ retrying: true, message: `負荷の軽いモデル（${lighterModelId}）で自動的に再試行しています…` });
            }
            try {
                const text = await callAiForStoreAnalysis(promptText, periods, onProgress, onToken, lighterModelId);
                return {
                    text: `（※GPUへの負荷が高かったため、軽量モデル「${lighterModelId}」に自動的に切り替えて回答しました）\n\n${text}`,
                    usedFallback: false,
                    usedModelId: lighterModelId
                };
            } catch (e2) {
                console.warn('AI分析（軽量モデルへの自動再試行）にも失敗しました:', e2);
                await resetAiEngineStateSafe();
                return { text: buildFallbackNoticeAndReport(describeAiError(e2), periods), usedFallback: true, usedModelId: null };
            }
        }

        return { text: buildFallbackNoticeAndReport(describeAiError(e1), periods), usedFallback: true, usedModelId: null };
    }
}

/* =========================================================
   ①AIモデル設定モーダル
   ========================================================= */
function ensureAiAnalysisSettingsModal() {
    if (document.getElementById('ai-analysis-settings-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'ai-analysis-settings-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-box medium">
            <h3 class="modal-title">⚙️ AIモデル設定（ブラウザ内AI／WebLLM）</h3>
            <p class="modal-desc">このAI機能はAPIキー不要で、AIモデルをこの端末のブラウザ内にダウンロードして動かします。集計データが外部に送信されることはありません。初めて選ぶモデルはダウンロードに時間がかかります（Wi-Fi推奨）。WebGPUという技術を使ってGPUで高速に動作するため、対応端末では回答がすばやく返ってきます。</p>
            <div id="ai-analysis-webgpu-warning" style="display:none; background:#fdecea; color:#c62828; border-radius:6px; padding:8px 10px; font-size:12.5px; margin-bottom:10px;">
                ⚠️ この端末（ブラウザ）はWebGPUに対応していないため、このAI機能はご利用いただけません。最新版のChrome・Edgeなど、WebGPU対応ブラウザでお試しください。
            </div>
            <label style="display:block; margin:10px 0 4px; font-size:13px; font-weight:bold;">使用するAIモデル</label>
            <select id="ai-analysis-model-select" class="modal-input">
                <option value="">読み込み中...</option>
            </select>
            <p id="ai-analysis-model-desc" style="color:#666; font-size:12px; margin:6px 0 0;"></p>
            <div id="ai-analysis-cache-status" style="margin-top:10px; padding:8px 10px; background:#f3f3f3; border-radius:6px; font-size:12.5px; color:#555; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                <span id="ai-analysis-cache-status-text">確認中...</span>
                <button id="ai-analysis-cache-delete-btn" onclick="deleteAiAnalysisModelCache()" class="modal-btn cancel" style="padding:4px 10px; font-size:12px; white-space:nowrap;" disabled>🗑️ キャッシュを削除</button>
            </div>
            <div class="modal-btn-group" style="margin-top:14px;">
                <button onclick="closeAiAnalysisSettingsModal()" class="modal-btn cancel">キャンセル</button>
                <button onclick="submitAiAnalysisSettings()" class="modal-btn purple">このモデルを使う</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#ai-analysis-model-select').addEventListener('change', () => {
        updateAiAnalysisModelDescText();
        updateAiAnalysisModelCacheStatus();
    });
}

function formatModelDescText(modelInfo) {
    if (!modelInfo) return '';
    const sweetSpot = modelInfo.sweetSpot ? '⭐賢さと軽さのバランスが良く、まず試すのにおすすめです' : '';
    const sizeText = modelInfo.sizeLabel ? `目安サイズ: ${modelInfo.sizeLabel}` : '';
    return [sweetSpot, modelInfo.note, sizeText].filter(Boolean).join(' ／ ');
}

function updateAiAnalysisModelDescText() {
    const select = document.getElementById('ai-analysis-model-select');
    const descEl = document.getElementById('ai-analysis-model-desc');
    if (!select || !descEl) return;
    const info = AI_MODEL_LIST.find(m => m.model_id === select.value);
    descEl.textContent = formatModelDescText(info);
}

// 【v4で簡略化】WebLLMは固定の候補（AI_MODEL_LIST）から選ぶだけなので、
// 非同期の取得処理は不要（asyncのままにしてあるのは、他の場所からの
// 呼び出し方を変えずに済むようにするため）。WebGPU非対応の端末では
// モデル選択・ダウンロード自体ができないよう、select/ボタンを無効化する。
async function openAiAnalysisSettingsModal() {
    ensureAiAnalysisSettingsModal();
    const modal = document.getElementById('ai-analysis-settings-modal');
    modal.style.display = 'flex';

    const webGpuOk = isWebGpuAvailableSafe();
    const infoEl = document.getElementById('ai-analysis-webgpu-warning');
    if (infoEl) infoEl.style.display = webGpuOk ? 'none' : 'block';

    const select = document.getElementById('ai-analysis-model-select');
    select.disabled = !webGpuOk;
    const submitBtn = document.querySelector('#ai-analysis-settings-modal .modal-btn.purple');
    if (submitBtn) submitBtn.disabled = !webGpuOk;

    const savedModelId = getSavedAiModelId();
    select.innerHTML = AI_MODEL_LIST.map(m =>
        `<option value="${m.model_id}">${m.sweetSpot ? '⭐ ' : ''}${m.model_id}</option>`
    ).join('');

    if (savedModelId && AI_MODEL_LIST.some(m => m.model_id === savedModelId)) {
        select.value = savedModelId;
    } else {
        const defaultModel = AI_MODEL_LIST.find(m => m.sweetSpot) || AI_MODEL_LIST[0];
        if (defaultModel) select.value = defaultModel.model_id;
    }
    updateAiAnalysisModelDescText();
    if (webGpuOk) updateAiAnalysisModelCacheStatus();
}

// 【v4で変更】WebLLMは「hasModelInCache」「deleteModelAllInfoInCache」という
// キャッシュ確認・削除専用のユーティリティ関数を公式に用意しているため、
// ブラウザのCache Storageを直接操作する必要がなくなった。
async function isAiModelCached(modelId) {
    try {
        const webllm = await loadWebllmModule();
        return await webllm.hasModelInCache(modelId);
    } catch (e) {
        return false;
    }
}

async function deleteAiModelCacheFiles(modelId) {
    const webllm = await loadWebllmModule();
    await webllm.deleteModelAllInfoInCache(modelId);
}

// 【キャッシュ削除機能で追加】選択中のモデルが、この端末に
// すでにダウンロード済み（Cache Storageに保存済み）かどうかを確認し、
// 「キャッシュを削除」ボタンの有効・無効と説明文を更新する。
async function updateAiAnalysisModelCacheStatus() {
    const select = document.getElementById('ai-analysis-model-select');
    const statusText = document.getElementById('ai-analysis-cache-status-text');
    const deleteBtn = document.getElementById('ai-analysis-cache-delete-btn');
    if (!select || !statusText || !deleteBtn || !select.value) return;

    const modelId = select.value;
    statusText.textContent = 'キャッシュを確認中...';
    deleteBtn.disabled = true;

    try {
        const cached = await isAiModelCached(modelId);
        // 確認している間にセレクトが別のモデルに切り替わっていたら結果を反映しない
        if (select.value !== modelId) return;
        if (cached) {
            statusText.textContent = '📦 このモデルは端末にダウンロード済みです';
            deleteBtn.disabled = false;
        } else {
            statusText.textContent = 'このモデルはまだダウンロードされていません';
            deleteBtn.disabled = true;
        }
    } catch (e) {
        console.warn('キャッシュ状況の確認に失敗しました:', e);
        statusText.textContent = 'キャッシュ状況を確認できませんでした';
        deleteBtn.disabled = true;
    }
}

// 【キャッシュ削除機能で追加】選択中のモデルの、おおよそのダウンロードサイズを
// 「○○GB」の文字列にして返す（AI_MODEL_LISTに持たせた目安値）。
function getEstimatedModelSizeGbText(modelId) {
    const info = AI_MODEL_LIST.find(m => m.model_id === modelId);
    return (info && info.sizeLabel) || '';
}

// 選択中のAIモデルについて、ダウンロード済みのデータ（Cache Storageに
// 保存されたモデル本体・設定ファイルなど）をまとめて削除する。
// 端末の空き容量を増やしたい場合や、モデルの読み込みで不具合が起きた際に
// やり直すために使う。削除後は次回質問時に再ダウンロードが必要。
function deleteAiAnalysisModelCache() {
    const select = document.getElementById('ai-analysis-model-select');
    const modelId = select ? select.value : '';
    if (!modelId) return;

    const doDelete = async () => {
        const statusText = document.getElementById('ai-analysis-cache-status-text');
        const deleteBtn = document.getElementById('ai-analysis-cache-delete-btn');
        if (deleteBtn) deleteBtn.disabled = true;
        if (statusText) statusText.textContent = 'キャッシュを削除しています...';

        try {
            // 削除するモデルが、現在メモリ上に読み込み済みのエンジンと同じ場合は
            // 参照を破棄しておく（そのままだと古いモデルを使い続けてしまうため）
            if (aiEngineState.modelId === modelId) {
                try { if (aiEngineState.engine) await aiEngineState.engine.unload(); } catch (e2) { /* 無視 */ }
                aiEngineState.modelId = null;
                aiEngineState.engine = null;
            }
            await deleteAiModelCacheFiles(modelId);
            if (typeof playSound === 'function') playSound('success');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm('このモデルのキャッシュを削除しました。次に質問した時、もう一度ダウンロードが必要になります。', 'きゃっしゅ を さくじょ し まし た。', () => {}, false);
            }
        } catch (e) {
            console.warn('キャッシュの削除に失敗しました:', e);
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm('キャッシュの削除に失敗しました。もう一度お試しください。', 'きゃっしゅ の さくじょ に しっぱい し まし た。', () => {}, false);
            }
        } finally {
            updateAiAnalysisModelCacheStatus();
        }
    };

    const sizeText = getEstimatedModelSizeGbText(modelId);
    const confirmMessage = sizeText
        ? `キャッシュを削除しますか？（想定${sizeText}）`
        : 'キャッシュを削除しますか？';

    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(confirmMessage, 'きゃっしゅ を さくじょ し ます か？', (ok) => {
            if (ok) doDelete();
        }, true);
    } else {
        doDelete();
    }
}

/* =========================================================
   ①-b AIキャッシュ一括削除（カード見出しの「🗑️ AIキャッシュ削除」ボタン）
   ------------------------------------------
   モデル設定モーダルを開かずに、この端末にダウンロード済みの
   AIモデルのキャッシュをまとめて確認・削除できるようにする。
   ========================================================= */

// この端末にダウンロード済み（Cache Storageに保存済み）の
// モデル（AI_MODEL_LISTに載っているもの）だけを一覧にして返す
// （未ダウンロードのものは含まない）。
async function getCachedAiAnalysisModelList() {
    const cachedList = [];
    for (const m of AI_MODEL_LIST) {
        try {
            if (await isAiModelCached(m.model_id)) cachedList.push(m);
        } catch (e) {
            // 1つのモデルの確認に失敗しても、他のモデルの確認は続ける
            console.warn(`モデル ${m.model_id} のキャッシュ確認に失敗しました:`, e);
        }
    }
    return cachedList;
}

async function deleteAllAiAnalysisModelCaches() {
    const btn = document.getElementById('ai-analysis-cache-clear-all-btn');
    if (btn) btn.disabled = true;

    let cachedList = [];
    try {
        cachedList = await getCachedAiAnalysisModelList();
    } catch (e) {
        console.warn('キャッシュの一覧取得に失敗しました:', e);
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('キャッシュの確認に失敗しました。もう一度お試しください。', 'きゃっしゅ の かくにん に しっぱい し まし た。', () => {}, false);
        }
        if (btn) btn.disabled = false;
        return;
    }

    if (cachedList.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('ダウンロード済みのAIモデルはありませんでした。', 'だうんろーど ずみ の えーあい もでる は あり ませ ん でし た。', () => {}, false);
        }
        if (btn) btn.disabled = false;
        return;
    }

    const sizeTexts = cachedList.map(m => m.sizeLabel).filter(Boolean);
    const sizeText = sizeTexts.length > 0 ? `（想定 ${sizeTexts.join(' + ')}）` : '';
    const confirmMessage = `ダウンロード済みのAIモデルのキャッシュを、まとめて削除しますか？${sizeText}`;

    if (typeof showCustomConfirm !== 'function') {
        if (btn) btn.disabled = false;
        return;
    }

    showCustomConfirm(confirmMessage, 'きゃっしゅ を まとめ て さくじょ し ます か？', async (ok) => {
        if (!ok) {
            if (btn) btn.disabled = false;
            return;
        }
        const originalBtnText = btn ? btn.innerText : '';
        if (btn) btn.innerText = '🗑️ 削除しています...';

        for (const m of cachedList) {
            // 削除するモデルが、現在メモリ上に読み込み済みのエンジンと同じ場合は
            // 参照を破棄しておく（そのままだと古いモデルを使い続けてしまうため）
            if (aiEngineState.modelId === m.model_id) {
                try { if (aiEngineState.engine) await aiEngineState.engine.unload(); } catch (e2) { /* 無視 */ }
                aiEngineState.modelId = null;
                aiEngineState.engine = null;
            }
            try {
                await deleteAiModelCacheFiles(m.model_id);
            } catch (e) {
                console.warn(`モデル ${m.model_id} のキャッシュ削除に失敗しました:`, e);
            }
        }

        if (typeof playSound === 'function') playSound('success');
        showCustomConfirm('AIモデルのキャッシュを削除しました。次に質問した時、もう一度ダウンロードが必要になります。', 'きゃっしゅ を さくじょ し まし た。', () => {}, false);

        // 設定モーダルが開いている場合は、表示中のキャッシュ状態も更新しておく
        updateAiAnalysisModelCacheStatus();

        if (btn) { btn.disabled = false; btn.innerText = originalBtnText || '🗑️ AIキャッシュ削除'; }
    }, true);
}

function closeAiAnalysisSettingsModal() {
    const modal = document.getElementById('ai-analysis-settings-modal');
    if (modal) modal.style.display = 'none';
}

function submitAiAnalysisSettings() {
    const select = document.getElementById('ai-analysis-model-select');
    const modelId = select ? select.value : '';
    if (!modelId) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('モデルを選択してください。', 'もでる を せんたく し て くだ さい。', () => {}, false);
        }
        return;
    }
    saveAiModelId(modelId);
    closeAiAnalysisSettingsModal();
    if (typeof playSound === 'function') playSound('success');
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm('使用するモデルを設定しました。次に質問した時に読み込み（初回はダウンロード）が始まります。', 'つかう もでる を せってい し まし た。', () => {}, false);
    }
}

/* =========================================================
   ②分析カード本体（テンプレート・自由入力・結果表示）
   ========================================================= */
function ensureAiAnalysisHistoryDetailsStyle() {
    if (document.getElementById('ai-analysis-history-details-style')) return;
    const style = document.createElement('style');
    style.id = 'ai-analysis-history-details-style';
    style.textContent = `
        .ai-analysis-history-item summary::-webkit-details-marker { display:none; }
        .ai-analysis-history-item summary::marker { content: ''; }
        .ai-analysis-history-item summary::before {
            content: '▶';
            display:inline-block;
            margin-right:6px;
            font-size:11px;
            color:#999;
            transition: transform 0.15s ease;
        }
        .ai-analysis-history-item[open] summary::before {
            transform: rotate(90deg);
        }
    `;
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
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
            <h3 style="margin:0;">🤖 AIによる店舗分析（この端末内で完結・APIキー不要）</h3>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button id="ai-analysis-cache-clear-all-btn" class="csv-export-btn" style="margin-left:0;">🗑️ AIキャッシュ削除</button>
                <button id="ai-analysis-settings-btn" class="csv-export-btn" style="margin-left:0;">⚙️ AIモデル設定</button>
            </div>
        </div>
        <p style="color:#666; font-size:13px; margin:0 0 12px;">売上・商品・会員などの集計データ（個人情報は含みません）をもとに、この端末内で動くAI（WebLLM）が分析やアドバイスをします。外部サーバーには送信されません。</p>
        <div id="ai-analysis-templates" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;"></div>
        <div style="display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
            <textarea id="ai-analysis-custom-input" placeholder="自由に質問できます（例：先週と比べて傾向はどう変わった？）" rows="2"
                style="flex:1; min-width:200px; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:16px; box-sizing:border-box; resize:vertical;"></textarea>
            <button id="ai-analysis-ask-btn" class="discount-submit-btn" style="white-space:nowrap; width:auto; padding:0 20px;">💬 質問する</button>
            <button id="ai-analysis-stop-btn" class="discount-submit-btn" style="display:none; white-space:nowrap; width:auto; padding:0 20px;">⏹ 停止</button>
        </div>
        <div id="ai-analysis-result" style="white-space:pre-wrap; line-height:1.7; background:#e8f5e9; border-radius:8px; padding:12px; min-height:40px; font-size:14px; color:#333;">テンプレートを選ぶか、質問を入力して「質問する」を押してください。（初回は⚙️AIモデル設定から使うモデルを選んでください）</div>
        <div id="ai-analysis-charts" style="display:none;"></div>
        <p style="color:#8a5a00; background:#fff3e0; border-radius:6px; padding:8px 10px; font-size:12px; margin:8px 0 0;">⚠️ この端末内で動く軽量AIのため、まれに事実と異なる数字・内容や、質問と関係のない回答をすることがあります。金額や数値は必ず元のデータと照らし合わせてご確認ください。</p>
        <div style="margin-top:10px; display:flex; justify-content:flex-end; gap:8px;">
            <button id="ai-analysis-save-btn" class="csv-export-btn" style="display:none;">💾 保存</button>
            <button id="ai-analysis-docx-btn" class="csv-export-btn" style="display:none;">📄 Wordでダウンロード</button>
        </div>
        <div id="ai-analysis-saved-history-section" style="margin-top:22px; border-top:2px solid #e0e0e0; padding-top:14px;">
            <h4 style="margin:0 0 10px; color:#555;">🗂️ 保存した分析の履歴（あとから見返せます）</h4>
            <div id="ai-analysis-saved-history-list"></div>
        </div>
    `;
    screen.appendChild(card);

    let lastAiQuestionLabel = '';

    const templatesWrap = card.querySelector('#ai-analysis-templates');
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

    card.querySelector('#ai-analysis-docx-btn').addEventListener('click', () => {
        downloadAiAnalysisAsDocx(lastAiQuestionLabel || 'AI店舗分析');
    });

    card.querySelector('#ai-analysis-save-btn').addEventListener('click', () => {
        saveCurrentAiAnalysisToHistory(lastAiQuestionLabel || 'AI店舗分析');
    });

    renderAiAnalysisSavedHistory();

    card.querySelector('#ai-analysis-ask-btn').addEventListener('click', () => {
        const input = card.querySelector('#ai-analysis-custom-input');
        const val = input.value.trim();
        if (!val) return;
        lastAiQuestionLabel = val;
        // 【新機能】質問を送信したら、回答が出るのを待たずにすぐ入力欄を空にする
        // （次の質問をすぐ打ち始められるように）
        input.value = '';
        runAiAnalysis(val, undefined, val);
    });

    card.querySelector('#ai-analysis-stop-btn').addEventListener('click', requestStopAiAnalysis);

    // 【追加】質問欄でEnterキーを押すと「質問する」を押したのと同じ扱いにする。
    // Shift+Enterは改行として使いたい場合もあるため、その場合は通常どおり改行する。
    card.querySelector('#ai-analysis-custom-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            card.querySelector('#ai-analysis-ask-btn').click();
        }
    });

    card.querySelector('#ai-analysis-settings-btn').addEventListener('click', openAiAnalysisSettingsModal);
    card.querySelector('#ai-analysis-cache-clear-all-btn').addEventListener('click', deleteAllAiAnalysisModelCaches);
}

/* =========================================================
   分析中インジケーター（波のように動くドット）
   ------------------------------------------
   以前は「・」の数を0〜3個で切り替えるだけのテキストアニメーションで、
   コード上のコメントには「波のようなアニメーション」と書かれていながら
   実際は波らしい動きになっていなかった。ここでは3つの丸を少しずつ
   タイミングをずらして上下に揺らすCSSアニメーションにし、見た目にも
   実際に波打つように動くインジケーターにする。
   ========================================================= */
function ensureAiAnalysisWaveStyle() {
    if (document.getElementById('ai-analysis-wave-style')) return;
    const style = document.createElement('style');
    style.id = 'ai-analysis-wave-style';
    style.textContent = `
    .ai-analysis-wave-dots {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        vertical-align: middle;
        margin-left: 2px;
    }
    .ai-analysis-wave-dots span {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #5c6bc0;
        animation: ai-analysis-wave-bounce 1.1s ease-in-out infinite;
    }
    .ai-analysis-wave-dots span:nth-child(2) { animation-delay: 0.15s; }
    .ai-analysis-wave-dots span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes ai-analysis-wave-bounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
        30% { transform: translateY(-6px); opacity: 1; }
    }
    `;
    document.head.appendChild(style);
}

function buildAiAnalysisWaveHtml(label, trailingInline, detail) {
    const dotsHtml = '<span class="ai-analysis-wave-dots"><span></span><span></span><span></span></span>';
    let html = `🤖 ${label}${dotsHtml}`;
    if (trailingInline) html += ` ${trailingInline}`;
    if (detail) html += `\n${detail}`;
    return html;
}

/* =========================================================
   【新機能】回答を「保存」を押すまで積み重ねて表示する
   ------------------------------------------
   ・質問するたびに前の回答を消さず、区切り線を挟んで下に追加していく。
   ・生成中（読み込み中・ストリーミング中）の表示も、それまでに
   　確定済みの回答（aiAnalysisAccumulatedText）の下に続けて出すことで、
   　「前の回答が消えないまま、次の回答がその続きに出てくる」ようにする。
   ・「💾 保存」を押すと、蓄積された内容ごと履歴に保存され、
   　画面はまっさらな状態（プレースホルダー文言）に戻る。
   ========================================================= */
const AI_ANALYSIS_BLOCK_DIVIDER_TEXT = '\n\n────────────────────\n\n';

// 各回答ブロックの先頭に付ける見出し（どの質問への回答かが後から見てもわかるように）
function buildAiAnalysisBlockHeaderText(label) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return `🔹 ${label || 'AI店舗分析'}（${timeStr}）`;
}

// 確定済みの蓄積テキスト（aiAnalysisAccumulatedText）の下に、
// 生成中/完了した現在のブロック（HTML）をつなげて表示する。
function renderAiAnalysisResultHtml(currentHtml) {
    const resultEl = document.getElementById('ai-analysis-result');
    if (!resultEl) return;
    resultEl.innerHTML = aiAnalysisAccumulatedText
        ? `${escapeAiAnalysisHtmlSafe(aiAnalysisAccumulatedText)}${AI_ANALYSIS_BLOCK_DIVIDER_TEXT}${currentHtml}`
        : currentHtml;
}

// 今回の質問への回答が確定した時点で呼ぶ。画面に表示しつつ、
// 次の質問のために蓄積テキストへも追記しておく。
function finalizeAiAnalysisBlock(label, answerText) {
    const blockText = `${buildAiAnalysisBlockHeaderText(label)}\n${answerText}`;
    renderAiAnalysisResultHtml(escapeAiAnalysisHtmlSafe(blockText));
    aiAnalysisAccumulatedText = aiAnalysisAccumulatedText
        ? `${aiAnalysisAccumulatedText}${AI_ANALYSIS_BLOCK_DIVIDER_TEXT}${blockText}`
        : blockText;
}

// 「💾 保存」が押された時に呼ぶ。蓄積内容をリセットし、画面を
// 最初のプレースホルダー表示に戻す（＝保存したら回答が消える）。
function resetAiAnalysisResultDisplay() {
    aiAnalysisAccumulatedText = '';
    const resultEl = document.getElementById('ai-analysis-result');
    if (resultEl) {
        resultEl.innerText = 'テンプレートを選ぶか、質問を入力して「質問する」を押してください。（初回は⚙️AIモデル設定から使うモデルを選んでください）';
    }
    aiAnalysisLastCharts = [];
    renderAiAnalysisCharts([]);
    const docxBtn = document.getElementById('ai-analysis-docx-btn');
    const saveBtn = document.getElementById('ai-analysis-save-btn');
    if (docxBtn) docxBtn.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';
}

/* =========================================================
   ②-1-1【今回追加】分析結果の折れ線グラフ表示
   ------------------------------------------
   「AI分析結果を折れ線グラフでも見たい・それも保存したい」という
   要望に対応する。<canvas>に固定の論理サイズ（描画用の座標系）で
   描くことで、要素がまだ画面に表示されていない（例：保存履歴の
   <details>が閉じている）状態でも正しく描画できるようにしてある
   （clientWidth等、実際の表示サイズに一切依存しない）。
   ========================================================= */
let aiAnalysisLastCharts = []; // 直近の回答に紐づくグラフ（保存・Word出力で使う）
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

    // 軸線
    ctx.strokeStyle = '#c8e6c9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + h);
    ctx.lineTo(padding.left + w, padding.top + h);
    ctx.stroke();

    // y軸ラベル（0と最大値のみ、シンプルに）
    ctx.fillStyle = '#558b2f';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`¥${maxVal.toLocaleString()}`, padding.left - 6, padding.top + 4);
    ctx.fillText('¥0', padding.left - 6, padding.top + h);

    if (values.length === 0) {
        ctx.fillStyle = '#999';
        ctx.textAlign = 'center';
        ctx.fillText('データがありません', padding.left + w / 2, padding.top + h / 2);
        return;
    }

    const stepX = values.length > 1 ? w / (values.length - 1) : 0;
    const pointAt = (i) => [padding.left + stepX * i, padding.top + h - (values[i] / maxVal) * h];

    // 面塗り
    ctx.beginPath();
    values.forEach((v, i) => {
        const [x, y] = pointAt(i);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(padding.left + w, padding.top + h);
    ctx.lineTo(padding.left, padding.top + h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(102,187,106,0.18)';
    ctx.fill();

    // 折れ線
    ctx.beginPath();
    values.forEach((v, i) => {
        const [x, y] = pointAt(i);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#43a047';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 各点
    ctx.fillStyle = '#2e7d32';
    values.forEach((v, i) => {
        const [x, y] = pointAt(i);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    });

    // x軸ラベル（点が多い場合は間引いて表示）
    ctx.fillStyle = '#666';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const maxLabels = 8;
    const labelStep = Math.max(1, Math.ceil(labels.length / maxLabels));
    labels.forEach((label, i) => {
        if (i % labelStep !== 0 && i !== labels.length - 1) return;
        const [x] = pointAt(i);
        ctx.fillText(label, x, padding.top + h + 14);
    });
}

// 分析結果の下に、グラフのカード（1つ以上）を差し込んで描画する
function renderAiAnalysisCharts(charts) {
    const wrap = document.getElementById('ai-analysis-charts');
    if (!wrap) return;
    if (!charts || charts.length === 0) {
        wrap.innerHTML = '';
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'block';
    wrap.innerHTML = charts.map((c, i) => `
        <div style="margin-top:12px; background:#fff; border:1px solid #c8e6c9; border-radius:8px; padding:10px 12px 6px;">
            <div style="font-size:12.5px; font-weight:bold; color:#2e7d32; margin-bottom:6px;">${escapeAiAnalysisHtmlSafe(c.title)}</div>
            <canvas id="ai-analysis-chart-canvas-${i}" style="width:100%; height:150px; display:block;"></canvas>
        </div>
    `).join('');
    charts.forEach((c, i) => {
        const canvas = document.getElementById(`ai-analysis-chart-canvas-${i}`);
        if (canvas) drawAiAnalysisLineChart(canvas, c);
    });
}

/* =========================================================
   ②-1-2【今回追加】AIの回答が出た時にデスクトップ通知でお知らせする
   ------------------------------------------
   画面を開いたまま他の作業をしていても回答完了に気づけるよう、
   notifications-system.js の fireDesktopNotification() を呼び出す
   （通知が無効・非対応環境では何も起きない＝呼び出し元は無条件に
   呼んでよい）。本文には回答内容も入れる（長い場合は末尾を省略）。
   ========================================================= */
const AI_ANALYSIS_NOTIFICATION_ICON_URL = 'https://raw.githubusercontent.com/ishiinopasokon8610-afk/image-list/main/images/%E3%83%AD%E3%82%B4%E3%82%92%E8%A8%AD%E5%AE%9A%E3%81%99%E3%82%8B%E3%81%A8%E3%81%93%E3%81%93%E3%81%AB%E8%A1%A8%E7%A4%BA%E3%81%95%E3%82%8C%E3%81%BE%E3%81%99%E3%80%82.png';
const AI_ANALYSIS_NOTIFICATION_BODY_MAX_LEN = 120;

function buildAiAnalysisNotificationBody(answerText) {
    const plain = String(answerText || '').replace(/\s+/g, ' ').trim();
    if (!plain) return '回答が届きました。画面をご確認ください。';
    return plain.length > AI_ANALYSIS_NOTIFICATION_BODY_MAX_LEN
        ? `${plain.slice(0, AI_ANALYSIS_NOTIFICATION_BODY_MAX_LEN)}…`
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

    // 【v5で変更】モデル未設定／WebGPU非対応の場合も、以前は「使えません」の
    // 一文だけで終わっていた。ここも他の失敗パターンと同じ経路
    // （getAiAnalysisAnswerRobust）に統一し、集計データからの簡易レポートを
    // 添えて必ず何らかの答えが返るようにする。

    ensureAiAnalysisWaveStyle();
    renderAiAnalysisResultHtml(buildAiAnalysisWaveHtml('準備中です', '', '（モデルが初回の場合はダウンロードが始まります。しばらくお待ちください）'));
    if (typeof playSound === 'function') playSound('click');

    // 生成中は「質問する」を隠して「⏹ 停止」を出す
    aiAnalysisStopRequested = false;
    if (askBtn) askBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-block';

    try {
        // getAiAnalysisAnswerRobust()は例外を投げず、必ず
        // { text, usedFallback, usedModelId } を返す
        // （AI成功時はusedFallback:false、AIが使えず簡易レポートに
        // 　切り替わった場合はusedFallback:trueになる）。
        const result = await getAiAnalysisAnswerRobust(
            promptText,
            periods,
            (progressOrStatus) => {
                if (progressOrStatus && typeof progressOrStatus.progress === 'number') {
                    // WebLLMのinitProgressCallback：{ progress: 0〜1, text, ... }
                    // モデルのダウンロード・読み込み中に随時呼び出される
                    const pct = Math.round(progressOrStatus.progress * 100);
                    renderAiAnalysisResultHtml(buildAiAnalysisWaveHtml('AIモデルを読み込み中です', `${pct}%`, '（初回のみ、モデルのダウンロードに時間がかかります）'));
                } else if (progressOrStatus && progressOrStatus.retrying) {
                    // GPUエラー等により、軽量モデルへ自動的に切り替えて再試行中
                    renderAiAnalysisResultHtml(buildAiAnalysisWaveHtml('自動で再試行しています', '', `（${progressOrStatus.message || ''}）`));
                }
            },
            (partialText) => {
                // ストリーミングで回答が届き始めたらそのまま上書き
                renderAiAnalysisResultHtml(escapeAiAnalysisHtmlSafe(partialText));
            }
        );

        finalizeAiAnalysisBlock(label, result.text);
        aiAnalysisLastCharts = buildAiAnalysisChartSeries(periods);
        renderAiAnalysisCharts(aiAnalysisLastCharts);
        if (docxBtn) docxBtn.style.display = 'inline-block';
        if (saveBtn) saveBtn.style.display = 'inline-block';
        // 簡易レポートへのフォールバックが発生した場合は、成功音ではなく
        // 注意を促すエラー音を鳴らして気づいてもらう
        if (typeof playSound === 'function') playSound(result.usedFallback ? 'error' : 'success');
        notifyAiAnalysisComplete(result.text, result.usedFallback);
    } catch (fatalError) {
        // 本来ここには到達しない想定（getAiAnalysisAnswerRobust側で
        // すべての失敗パターンを吸収しているため）。それでも「必ず
        // 何らかの答えを返す」という方針を徹底するため、最後の砦として
        // ここでも簡易レポートを試みる。
        console.warn('AI分析処理全体で予期しないエラーが発生しました:', fatalError);
        let text;
        try {
            text = buildFallbackNoticeAndReport('予期しないエラーが発生しました。', periods);
        } catch (e2) {
            text = '⚠️ 分析結果を表示できませんでした。画面を再読み込みしてから、もう一度お試しください。';
        }
        finalizeAiAnalysisBlock(label, text);
        aiAnalysisLastCharts = buildAiAnalysisChartSeries(periods);
        renderAiAnalysisCharts(aiAnalysisLastCharts);
        if (docxBtn) docxBtn.style.display = 'inline-block';
        if (saveBtn) saveBtn.style.display = 'inline-block';
        if (typeof playSound === 'function') playSound('error');
        notifyAiAnalysisComplete(text, true);
    } finally {
        // 生成が終わった（成功・停止・エラーいずれも）ら、ボタン表示を元に戻す
        if (askBtn) askBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';
        aiAnalysisStopRequested = false;
    }
}

/* =========================================================
   ②-2 分析結果を「保存」して、あとから見返せる履歴として残す
   ------------------------------------------
   ・「💾 保存」ボタンは「📄 Wordでダウンロード」の左に配置。
   ・保存するたびにlocalStorageの配列へ追記（push）し、一覧を
     まるごと描画し直す。新しく保存したものほど一覧の下に
     積み上がっていき、前に保存したものが消えることはない。
   ・localStorageに保存するため、画面を閉じたり別の画面に移動した
     あとでもこのカードを開けば履歴として見返せる。
   ========================================================= */
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
    // 他の追加機能ファイルと同様、保存内容がバックアップ（ローカル/Googleドライブ）にも
    // 含まれるようにしておく（無ければ何もしない）
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
}

function formatAiAnalysisSavedAt(iso) {
    try {
        const d = new Date(iso);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (e) {
        return '';
    }
}

// テンプレート名・回答本文をそのままinnerHTMLに入れるとHTML崩れの原因になるため、
// 一旦テキストとしてエスケープしてから描画する
function escapeAiAnalysisHtmlSafe(text) {
    const div = document.createElement('div');
    div.innerText = (text === null || text === undefined) ? '' : text;
    return div.innerHTML;
}

function renderAiAnalysisSavedHistory() {
    const listEl = document.getElementById('ai-analysis-saved-history-list');
    if (!listEl) return;
    const history = getAiAnalysisSavedHistory();

    if (history.length === 0) {
        listEl.innerHTML = '<p style="color:#999; font-size:13px; text-align:center; padding:10px 0;">まだ保存された分析はありません。分析結果の下にある「💾 保存」を押すと、ここに残ります。</p>';
        return;
    }

    // 保存した順（古いもの→新しいもの）に、新しいものほど下にくるように並べる
    // 【新機能】本文はdetails/summaryで折りたたみ、タイトル行をクリック（タップ）すると
    // 開閉できるようにする（履歴が増えても一覧がコンパクトに収まるように）。
    // デフォルトは閉じた状態にし、必要な項目だけ開いて読めるようにする。
    // 【今回追加】保存時点のグラフがあれば、本文の下に一緒に表示する。
    // <canvas>は固定の論理サイズで描画するため、<details>が閉じたままでも
    // 正しく描ける（表示サイズに依存しないため）。
    listEl.innerHTML = history.map(item => {
        const charts = Array.isArray(item.charts) ? item.charts : [];
        const chartsHtml = charts.map((c, i) => `
            <div style="margin-top:10px; background:#fff; border:1px solid #c8e6c9; border-radius:8px; padding:10px 12px 6px;">
                <div style="font-size:12px; font-weight:bold; color:#2e7d32; margin-bottom:6px;">${escapeAiAnalysisHtmlSafe(c.title)}</div>
                <canvas id="ai-analysis-history-chart-${item.id}-${i}" style="width:100%; height:150px; display:block;"></canvas>
            </div>
        `).join('');
        // 【新機能】保存前に複数回「質問する」を押して回答が積み重なっていた場合、
        // 1つの履歴に何件分の質問が含まれているかをタイトル横に表示する。
        // ブロック同士は AI_ANALYSIS_BLOCK_DIVIDER_TEXT（区切り線）で連結されているため、
        // 区切り線の数から件数を数える。以前に保存された履歴（区切り線の情報しか
        // 持たない古いデータ）にもそのまま使えるよう、保存済みのanswer本文から
        // 都度数え直す方式にしてある。
        const questionCount = (item.answer || '')
            .split(AI_ANALYSIS_BLOCK_DIVIDER_TEXT)
            .filter(block => block.trim() !== '').length;
        const questionCountLabel = questionCount > 1 ? `（質問${questionCount}件分）` : '';
        return `
        <details class="ai-analysis-history-item" style="border:1px solid #ddd; border-radius:8px; padding:0; margin-bottom:10px; background:#fff; overflow:hidden;">
            <summary style="list-style:none; cursor:pointer; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <span style="font-weight:bold; color:#5c6bc0; font-size:13px;">🤖 ${escapeAiAnalysisHtmlSafe(item.label)}${questionCountLabel ? `<span style="color:#8a5a00; font-weight:normal;">${questionCountLabel}</span>` : ''}</span>
                <span style="display:flex; align-items:center; gap:8px;">
                    <span style="color:#999; font-size:11px; white-space:nowrap;">${formatAiAnalysisSavedAt(item.savedAt)}</span>
                    <button class="csv-export-btn" style="margin-left:0; padding:2px 10px; font-size:11px;" onclick="event.preventDefault(); event.stopPropagation(); downloadAiAnalysisHistoryItemAsDocx('${item.id}', this)">📄 Word</button>
                    <button class="modal-btn cancel" style="padding:2px 10px; font-size:11px;" onclick="event.preventDefault(); event.stopPropagation(); deleteAiAnalysisSavedHistoryItem('${item.id}')">削除</button>
                </span>
            </summary>
            <div style="padding:0 12px 12px;">
                <div style="white-space:pre-wrap; line-height:1.6; font-size:13.5px; color:#333;">${escapeAiAnalysisHtmlSafe(item.answer)}</div>
                ${chartsHtml}
            </div>
        </details>
    `;
    }).join('');

    // グラフはHTML注入後にJSから描画する（canvasはinnerHTML文字列だけでは描けないため）
    history.forEach(item => {
        (Array.isArray(item.charts) ? item.charts : []).forEach((c, i) => {
            const canvas = document.getElementById(`ai-analysis-history-chart-${item.id}-${i}`);
            if (canvas) drawAiAnalysisLineChart(canvas, c);
        });
    });
}

function saveCurrentAiAnalysisToHistory(label) {
    const resultEl = document.getElementById('ai-analysis-result');
    const answer = resultEl ? resultEl.innerText : '';
    if (!answer || answer.trim() === '') return;

    const history = getAiAnalysisSavedHistory();
    history.push({
        id: `ai_hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        label: label || 'AI店舗分析',
        answer: answer,
        charts: Array.isArray(aiAnalysisLastCharts) ? aiAnalysisLastCharts : [],
        savedAt: new Date().toISOString()
    });
    persistAiAnalysisSavedHistory(history);
    renderAiAnalysisSavedHistory();

    // 【新機能】保存したら、積み重ねてきた回答表示をクリアして
    // 次の質問に備える（＝保存を押すと回答が消える）
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

/* =========================================================
   ③ Wordファイル(.docx)としてダウンロード
   ------------------------------------------
   「docx」ライブラリ(https://github.com/dolanmiu/docx)をCDNから
   動的に読み込み、現在の分析結果をWord文書として書き出す。
   WebLLM同様、AI機能を使わない通常時のページ表示速度には影響しない。
   ========================================= */
const DOCX_LIB_CDN_URL = 'https://esm.run/docx';
let docxModulePromise = null;
function loadDocxModule() {
    if (!docxModulePromise) {
        docxModulePromise = import(/* webpackIgnore: true */ DOCX_LIB_CDN_URL).catch(e => {
            docxModulePromise = null;
            throw e;
        });
    }
    return docxModulePromise;
}

// Wordファイルへ埋め込むため、グラフを（画面に表示せず）その場でcanvasに
// 描画してPNGのバイト列に変換する
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

// 【今回改訂】本文・グラフからdocxのBlobを組み立てる部分を単独の関数に切り出した。
// これにより「今表示中の回答」だけでなく「あとから履歴を見返したときの
// 保存済みの回答」からも、同じロジックでWordファイルを作れるようにする。
async function buildAiAnalysisDocxBlob(titleLabel, bodyText, charts) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = await loadDocxModule();

    const now = new Date();
    const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 本文を行ごとにパラグラフへ分割（箇条書き記号「・」「-」で始まる行は少し見やすく）
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

    // グラフがあれば、本文の後ろに画像として埋め込む
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
                    children: [new TextRun({ text: `テーマ: ${titleLabel || 'AI店舗分析'}`, italics: true })],
                    spacing: { after: 60 }
                }),
                new Paragraph({
                    children: [new TextRun({ text: `作成日時: ${dateStr}`, italics: true, color: '888888' })],
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
    const fileDateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    return `AI店舗分析_${fileDateStr}.docx`;
}

// ボタンの表示切り替え・エラー処理を共通化した、Word書き出しの実行部分。
// 「今の回答」用のボタンからも「保存した履歴」の各項目のボタンからも呼び出す。
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

// 【新機能】保存済みの履歴からも、あとからいつでもWordファイルとして
// ダウンロードできるようにする（保存時点の回答・グラフをそのまま書き出す）。
async function downloadAiAnalysisHistoryItemAsDocx(id, buttonEl) {
    const history = getAiAnalysisSavedHistory();
    const item = history.find(h => h.id === id);
    if (!item) return;
    await runAiAnalysisDocxDownload(buttonEl, item.label, item.answer, item.charts);
}

/* =========================================================
   ④ 売上分析画面(analytics-screen)を開いた時、カードが無ければ追加する
   ========================================================= */
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