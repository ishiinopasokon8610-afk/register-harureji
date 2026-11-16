// ==========================================
// register-ui-fixes-system.js
// ------------------------------------------
// index.html / register.js / ui.js は直接編集せず、他の追加機能ファイルと同じ
// 「フック／DOM監視方式」で、次の4つをまとめて行う。
//
// ① 「客用ディスプレイ」かどうかを、チェック欄ではなく「客用画面を開いているか」で決める
//    これまでは、データ管理画面の「この端末を客用ディスプレイとして使う」にチェックを
//    入れた端末だけが、年齢確認の画面・お会計完了時の画像などを表示していた。
//    → チェックは廃止（画面から非表示にした）。いま【客用画面を開いている端末】が、
//      自動的に客用ディスプレイとして動く。
//    （isCustomerDisplayDevice() の答えを、客用画面（#customer-screen）が表示中かどうかに
//      置き換える。この関数を使っている他のファイルは、そのまま新しい判定で動く）
//
// ② スキャンした時、客用画面の端末からも音が出る
//    客用画面のカート一覧（#customer-cart-list）に商品が増えた（または同じ商品の数量が
//    増えた）時に、短い「ピッ」という音を出す。商品を取り消した時・会計後にカートが
//    空になった時は鳴らさない。
//    ※ ブラウザの決まりで、音を出すには、その端末で一度でも画面を触っている必要がある
//      （「客用画面を開く」ボタンを押していれば、その時点で条件を満たす）。
//
// ③ 「いらっしゃいませ」「ありがとうございました」ボタンは、レジ画面の時だけ表示する
//    （画面の隅に常に出ていたボタン #clerk-quick-voices を、レジ画面以外では隠す）
//
// ④ スマホでレジ操作をすると、勝手に画面が一番上にスクロールしてしまう不具合の対策
//    原因の候補：商品を追加するたびに、バーコード入力欄へフォーカスを戻す処理があり、
//    スマホではフォーカスが移ると「その入力欄が見える位置まで」画面が動いてしまう。
//    → レジ画面の中での focus() は、画面を動かさない設定（preventScroll）にする。
// ==========================================

(function registerUiFixes() {
    'use strict';

    /* =========================================================
       ① 客用ディスプレイ ＝ 客用画面を開いている端末
       ========================================================= */
    function isCustomerScreenOpen() {
        const el = document.getElementById('customer-screen');
        return !!(el && el.classList.contains('active'));
    }

    function installCustomerDisplayJudge() {
        // 他のファイルが後から元の関数で上書きしても、新しい判定に戻す
        if (window.isCustomerDisplayDevice !== isCustomerScreenOpen) {
            window.isCustomerDisplayDevice = isCustomerScreenOpen;
        }
    }
    installCustomerDisplayJudge();
    window.addEventListener('load', installCustomerDisplayJudge);
    setInterval(installCustomerDisplayJudge, 3000);

    // 古い設定画面の「チェック欄」は使わないので、チェックも外しておく（見えないが、念のため）
    document.addEventListener('DOMContentLoaded', () => {
        const cb = document.getElementById('customer-display-device-check');
        if (cb) cb.checked = false;
    });

    /* =========================================================
       ② 客用画面でもスキャン音を出す
       ========================================================= */
    let audioCtx = null;

    function getAudioCtx() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!audioCtx) {
            try { audioCtx = new AC(); } catch (e) { return null; }
        }
        return audioCtx;
    }

    // 最初に画面を触った時に、音を出せる状態にしておく（ブラウザの自動再生の制限への対応）
    function unlockAudio() {
        const ctx = getAudioCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach((type) => {
        window.addEventListener(type, unlockAudio, { passive: true, capture: true });
    });

    function playCustomerScanBeep() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        try {
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = 1500;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
        } catch (e) { /* 音が出なくても、画面の動作には影響させない */ }
    }

    function watchCustomerCartForBeep() {
        const list = document.getElementById('customer-cart-list');
        if (!list) { setTimeout(watchCustomerCartForBeep, 500); return; }

        let prevCount = list.children.length;
        let prevSignature = list.textContent;
        let timer = null;

        function evaluate() {
            timer = null;
            const count = list.children.length;
            const sig = list.textContent;
            let increased = false;

            if (count > prevCount) {
                increased = true; // 新しい商品の行が増えた
            } else if (count === prevCount && count > 0 && sig !== prevSignature) {
                // 行の数は同じで、中身が変わった：数量が増えた時だけ鳴らす
                // （数字を全部たし算して、前より大きくなったかで判断する）
                const sum = (t) => (t.match(/\d+/g) || []).reduce((a, b) => a + Number(b), 0);
                if (sum(sig) > sum(prevSignature)) increased = true;
            }

            prevCount = count;
            prevSignature = sig;
            if (increased && isCustomerScreenOpen()) playCustomerScanBeep();
        }

        // 1回の更新で何度も変化が起きても、まとめて1回だけ判定する
        new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(evaluate, 60);
        }).observe(list, { childList: true, subtree: true, characterData: true });
    }
    watchCustomerCartForBeep();

    /* =========================================================
       ③ 「いらっしゃいませ」「ありがとうございました」はレジ画面だけ
       ========================================================= */
    function updateQuickVoicesVisibility() {
        const box = document.getElementById('clerk-quick-voices');
        if (!box) return;
        const reg = document.getElementById('register-screen');
        const onRegister = !!(reg && reg.classList.contains('active'));
        box.style.display = onRegister ? '' : 'none';
    }

    function watchScreensForQuickVoices() {
        updateQuickVoicesVisibility();
        const obs = new MutationObserver(updateQuickVoicesVisibility);
        document.querySelectorAll('.screen').forEach((el) => {
            obs.observe(el, { attributes: true, attributeFilter: ['class'] });
        });
        // 後から画面が追加された場合に備えて、定期的にも確認する
        setInterval(updateQuickVoicesVisibility, 1000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchScreensForQuickVoices);
    } else {
        watchScreensForQuickVoices();
    }

    /* =========================================================
       ④ レジ画面での focus() で、画面が勝手にスクロールしないようにする
       ========================================================= */
    (function preventScrollJumpOnRegisterFocus() {
        if (HTMLElement.prototype.focus.__registerNoScroll) return;
        const originalFocus = HTMLElement.prototype.focus;
        const patched = function (options) {
            // 呼び出し側がオプションを指定していない時だけ、スクロールしない設定にする
            if (options === undefined && this.closest && this.closest('#register-screen')) {
                return originalFocus.call(this, { preventScroll: true });
            }
            return originalFocus.call(this, options);
        };
        patched.__registerNoScroll = true;
        HTMLElement.prototype.focus = patched;
    })();
})();
