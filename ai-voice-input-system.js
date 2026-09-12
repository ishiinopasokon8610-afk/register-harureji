// ==========================================
// ai-voice-input-system.js
// ------------------------------------------
// 【この機能】
// AIによる店舗分析（ai-store-analysis-system.js）の「自由に質問できる」
// 入力欄の隣に「🎤 音声入力」ボタンを追加する。
// ボタンを押して話しかけると、ブラウザ標準の音声認識機能（Web Speech API）
// が音声をテキストに変換し、そのまま質問入力欄に反映される。
// もう一度ボタンを押すと聞き取りを停止する。
//
// 【対応状況】
// Web Speech API（webkitSpeechRecognition）に対応していないブラウザでは
// ボタン自体を表示しない（押しても使えない状態を見せないため）。
// この認識機能はブラウザ側の仕組みを利用するもので、ブラウザによっては
// 音声認識のためにブラウザの提供元サーバーへ音声データが送られる場合が
// ある点は、通常の（スマホ等の）音声入力機能と同様。
//
// index.html / ai-store-analysis-system.js は直接編集せず、
// ensureAiAnalysisCard() をラップするフック方式で実現する
// （他の追加機能ファイルと同じ方針）。
// ==========================================

(function hookAiAnalysisCardForVoiceInput() {
    function tryHook() {
        if (typeof window.ensureAiAnalysisCard !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.ensureAiAnalysisCard;
        window.ensureAiAnalysisCard = function (...args) {
            const result = original.apply(this, args);
            injectAiVoiceInputButton();
            return result;
        };
    }
    tryHook();
})();

function getSpeechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/* =========================================================
   マイクの聞き取りが始まったことを知らせる開始音
   ------------------------------------------
   アプリ内に既にある共通のplaySound()（ボタン操作音などで使われている
   もの）があればそれを使う（＝アプリの音量設定・ミュート設定などが
   あればそれにも自然に従う）。playSound()が無い環境向けの保険として、
   Web Audio APIで短いビープ音を自前で鳴らすフォールバックも用意する。
   ========================================================= */
function playMicStartSound() {
    if (typeof playSound === 'function') {
        try {
            playSound('click');
            return;
        } catch (e) {
            // 失敗した場合は下のフォールバック音に進む
        }
    }
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const playTone = () => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
            osc.addEventListener('ended', () => ctx.close());
        };
        // 一部のブラウザではAudioContextが作成直後「suspended」状態のままで、
        // resume()を挟まないと無音になることがあるため、念のため対応する。
        if (ctx.state === 'suspended') {
            ctx.resume().then(playTone).catch(() => playTone());
        } else {
            playTone();
        }
    } catch (e) {
        console.warn('[ai-voice-input] 開始音の再生に失敗しました:', e);
    }
}

/* =========================================================
   質問欄の隣に🎤ボタンを差し込み、クリックで聞き取りの開始／停止を
   切り替えられるようにする
   ========================================================= */
function injectAiVoiceInputButton() {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) return; // 非対応ブラウザでは何もしない

    const askBtn = document.getElementById('ai-analysis-ask-btn');
    const textarea = document.getElementById('ai-analysis-custom-input');
    if (!askBtn || !textarea || document.getElementById('ai-analysis-voice-btn')) return;

    const micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.id = 'ai-analysis-voice-btn';
    micBtn.className = 'discount-submit-btn';
    micBtn.style.cssText = 'white-space:nowrap; width:auto; padding:0 16px; background:#5c6bc0;';
    micBtn.textContent = '🎤 音声入力';
    askBtn.parentNode.insertBefore(micBtn, askBtn);

    let recognition = null;
    let isListening = false;
    // 聞き取り開始時点で入力欄に入っていた文字を保持し、認識結果はその
    // 続きとして追記する（すでに書きかけていた質問文を消さないため）
    let baseTextBeforeListening = '';

    function setListeningUi(listening) {
        isListening = listening;
        if (listening) {
            micBtn.textContent = '⏹ 聞き取り中（停止）';
            micBtn.style.background = '#d32f2f';
        } else {
            micBtn.textContent = '🎤 音声入力';
            micBtn.style.background = '#5c6bc0';
        }
    }

    function startListening() {
        // 【不具合修正】以前はrecognitionの'start'イベント（非同期）で
        // 開始音を鳴らしていたが、これだとクリック操作から時間差が空く
        // ため、ブラウザの自動再生ポリシーにより「ユーザー操作起因の
        // 再生」とみなされず、音が鳴らない（無音のまま）ことがあった。
        // ボタンを押した直後・同期的なタイミングで鳴らすことで確実に
        // 再生されるようにする。
        playMicStartSound();

        recognition = new SpeechRecognitionCtor();
        recognition.lang = 'ja-JP';
        recognition.interimResults = true;
        recognition.continuous = true;

        baseTextBeforeListening = textarea.value;
        setListeningUi(true);

        recognition.addEventListener('result', (e) => {
            let finalText = '';
            let interimText = '';
            for (let i = 0; i < e.results.length; i++) {
                const transcript = e.results[i][0].transcript;
                if (e.results[i].isFinal) {
                    finalText += transcript;
                } else {
                    interimText += transcript;
                }
            }
            const needsSpacer = baseTextBeforeListening &&
                !baseTextBeforeListening.endsWith(' ') &&
                !baseTextBeforeListening.endsWith('\n');
            const base = needsSpacer ? baseTextBeforeListening + ' ' : baseTextBeforeListening;
            textarea.value = base + finalText + interimText;
        });

        recognition.addEventListener('end', () => {
            // 確定した認識結果をベースとして残しておく
            baseTextBeforeListening = textarea.value;
            // 無音が続く等で環境側が自動的に終了しても、まだ利用者が
            // 「停止」を押していなければ聞き取りを継続する
            if (isListening) {
                try { recognition.start(); } catch (e) { /* 開始直後の重複呼び出し等は無視 */ }
            }
        });

        recognition.addEventListener('error', (e) => {
            console.warn('[ai-voice-input] 音声認識エラー:', e.error);
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                stopListening();
                alert('マイクの使用が許可されていません。ブラウザの設定でマイクへのアクセスを許可してください。');
            }
        });

        try {
            recognition.start();
        } catch (e) {
            console.warn('[ai-voice-input] 音声認識の開始に失敗しました:', e);
            setListeningUi(false);
        }
    }

    function stopListening() {
        setListeningUi(false);
        if (recognition) {
            try { recognition.stop(); } catch (e) { /* 無視 */ }
        }
    }

    micBtn.addEventListener('click', () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    });

    // 【追加】「質問する」ボタンを押したら、聞き取り中であれば自動的に
    // 録音を停止する（質問を送信したのにマイクが鳴りっぱなし、という
    // 状態を防ぐ）。ai-store-analysis-system.js側の元々のクリック処理
    // （質問送信）はこのリスナーとは別に登録されているため、ここでは
    // 録音停止だけを担当し、質問の送信処理には手を加えない。
    askBtn.addEventListener('click', () => {
        if (isListening) stopListening();
    });
}
