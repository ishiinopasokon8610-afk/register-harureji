// ==========================================
// お会計完了時に客用画面へ大きく表示する画像
// ------------------------------------------
// ・データ管理・ロゴ設定画面から画像を1枚登録できる
// ・お会計完了（completeTransaction）のタイミングで、
//   客用画面いっぱいに、下からアニメーションでせり上がって表示される
// ・別端末（客用画面が別デバイスの場合）にはAbly経由で画像データを送信する
// ==========================================

const CHECKOUT_IMAGE_KEY = 'pos_checkout_complete_image';

// この端末を識別するID（同じ端末が自分で送信したAblyイベントを、
// 受信時に二重表示しないようにするために使う）
const CHECKOUT_IMAGE_DEVICE_ID = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);

function getCheckoutCompleteImage() {
    return localStorage.getItem(CHECKOUT_IMAGE_KEY) || '';
}

// 管理画面：画像アップロード（大きすぎる画像は自動で縮小してから保存）
// ------------------------------------------
// 注意：localStorageは他のデータ（商品・会員・お会計履歴など）と容量を
// 共有しており、上限は端末やブラウザによって数MB程度しかない。
// 以前は常に「幅1920px・画質0.95」の高画質で保存しようとしていたため、
// 他のデータと合わせて容量オーバー（QuotaExceededError）になり、
// 画像が保存されないまま（＝お会計完了時に何も表示されない）ことがあった。
// このため、まず控えめなサイズで保存を試み、それでも入らない場合は
// 段階的にサイズ・画質を落として再試行し、最終手段まで失敗した場合のみ
// はっきりとユーザーに知らせるようにする。
function uploadCheckoutCompleteImage(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            // 画質を落としながら段階的に保存を試みる設定
            // （幅px, JPEG画質）の順に、入るサイズが見つかるまで試す
            const attempts = [
                { maxW: 1280, quality: 0.8 },
                { maxW: 1280, quality: 0.6 },
                { maxW: 960, quality: 0.6 },
                { maxW: 960, quality: 0.45 },
                { maxW: 640, quality: 0.5 },
                { maxW: 480, quality: 0.5 }
            ];

            let saved = false;
            let lastErr = null;

            for (const attempt of attempts) {
                const scale = Math.min(1, attempt.maxW / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                const dataUrl = canvas.toDataURL('image/jpeg', attempt.quality);

                try {
                    localStorage.setItem(CHECKOUT_IMAGE_KEY, dataUrl);
                    // 実際に読み出せるかまで確認する（一部ブラウザではsetItemが
                    // 例外を投げずに保存に失敗するケースがあるため）
                    if (localStorage.getItem(CHECKOUT_IMAGE_KEY) === dataUrl) {
                        saved = true;
                        break;
                    }
                } catch (err) {
                    lastErr = err;
                    // 容量オーバーの場合は次の（より小さい）設定で再試行する
                }
            }

            if (saved) {
                if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                if (typeof playSound === 'function') playSound('success');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm("お会計完了時の表示画像を保存しました。", "がぞう を ほぞん し まし た。", () => {}, false);
                }
            } else {
                console.warn('画像の保存に失敗しました（容量オーバーの可能性）:', lastErr);
                if (typeof playSound === 'function') playSound('error');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm(
                        "画像を保存できませんでした。保存容量が不足している可能性があります。お会計履歴を整理する（データ管理画面から古いデータを初期化する）か、もっと小さい画像でお試しください。",
                        "がぞう を ほぞん でき ませ ん でし た。",
                        () => {}, false
                    );
                } else {
                    alert('画像を保存できませんでした（容量不足の可能性があります）。');
                }
            }

            renderCheckoutImagePreview();
            // 選択済みのファイルをクリアし、同じファイルを選び直しても
            // onchangeが再度発火するようにする
            event.target.value = '';
        };
        img.onerror = function () {
            if (typeof playSound === 'function') playSound('error');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("画像の読み込みに失敗しました。別の画像でお試しください。", "がぞう の よみこみ に しっぱい し まし た。", () => {}, false);
            }
            event.target.value = '';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function clearCheckoutCompleteImage() {
    localStorage.removeItem(CHECKOUT_IMAGE_KEY);
    renderCheckoutImagePreview();
    if (typeof playSound === 'function') playSound('click');
}

function renderCheckoutImagePreview() {
    const preview = document.getElementById('checkout-image-preview');
    if (!preview) return;
    const dataUrl = getCheckoutCompleteImage();
    if (dataUrl) {
        preview.src = dataUrl;
        preview.style.display = 'inline-block';
    } else {
        preview.src = '';
        preview.style.display = 'none';
    }
}

// 客用画面側：画面いっぱいにアニメーションで表示する
// ※ この関数自体は「今どの画面がアクティブか」を判定しない（常に表示する）。
//   同一端末で店員側の画面にも出さないための判定は、呼び出し側（triggerCheckoutCompleteImage /
//   Ablyの受信ハンドラ）で行う。
function displayCheckoutCompleteImage(dataUrl) {
    if (!dataUrl) return;

    const overlay = document.getElementById('customer-checkout-image-overlay');
    const imgEl = document.getElementById('customer-checkout-image');
    if (!overlay || !imgEl) return;

    imgEl.src = dataUrl;
    overlay.style.display = 'flex';
    overlay.classList.remove('img-slide-up');
    void overlay.offsetWidth; // 強制リフローでアニメーションを毎回再生させる
    overlay.classList.add('img-slide-up');

    // 以前はここで7秒後に自動的に非表示にしていたが、
    // 「次のお会計が始まるまで画像を消さない」仕様に変更したため、
    // タイマーによる自動非表示は行わない。
    // 非表示にするのは hideCheckoutCompleteImage()（＝次のお会計の最初の
    // 商品がスキャンされたタイミング。下の hideCheckoutImageOnNewTransaction 参照）のみ。
    clearTimeout(overlay._hideTimer);
}

function hideCheckoutCompleteImage() {
    const overlay = document.getElementById('customer-checkout-image-overlay');
    if (!overlay) return;
    clearTimeout(overlay._hideTimer);
    overlay.style.display = 'none';
    overlay.classList.remove('img-slide-up');
}

// レジ側：お会計完了時に呼び出す（客用ディスプレイに設定されている端末にのみ表示する）
function triggerCheckoutCompleteImage() {
    const dataUrl = getCheckoutCompleteImage();
    if (!dataUrl) return;

    // この端末自身が「客用ディスプレイ」に設定されている場合は、その場で直接表示する
    if (typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice()) {
        displayCheckoutCompleteImage(dataUrl);
    }

    // 他端末へ、Ably経由で画像データを送信する（受信側で客用ディスプレイ設定を確認する）
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('checkout-image-event', { image: dataUrl, senderId: CHECKOUT_IMAGE_DEVICE_ID });
        } catch (err) {
            console.warn('客用画面への画像送信に失敗しました:', err);
        }
    }
}

// レジ側／客用画面側どちらでも呼べる：表示中の画像を消し、他端末（客用ディスプレイ）にも
// Ably経由で「消してください」を伝える。次のお会計が始まったタイミングで呼ばれる。
function hideCheckoutCompleteImageAndBroadcast() {
    hideCheckoutCompleteImage();
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('checkout-image-hide-event', { senderId: CHECKOUT_IMAGE_DEVICE_ID });
        } catch (err) {
            console.warn('客用画面への非表示通知の送信に失敗しました:', err);
        }
    }
}

// 別端末からAblyメッセージを受信するための購読登録。
// channel（Ably）の初期化はレジ/客画面を開いたタイミングで行われるため、
// 準備ができるまで少し待ってから一度だけ登録する。
(function waitForChannelAndSubscribeCheckoutImage() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('checkout-image-event', (msg) => {
            if (msg && msg.data && msg.data.image) {
                // 自分自身が送信したイベントのエコー（Ablyはデフォルトで送信者にも配信される）は、
                // すでにローカルで表示処理済みなので無視する
                if (msg.data.senderId === CHECKOUT_IMAGE_DEVICE_ID) return;
                // 「客用ディスプレイ」に設定されている端末以外では表示しない
                // （そうしないと複数端末を使っている場合、全端末に表示されてしまうため）
                if (typeof isCustomerDisplayDevice === 'function' && !isCustomerDisplayDevice()) return;
                displayCheckoutCompleteImage(msg.data.image);
            }
        });

        // 別端末（レジ端末）で次のお会計が始まった時に届く「画像を消してください」通知
        channel.subscribe('checkout-image-hide-event', (msg) => {
            if (!msg || !msg.data) return;
            if (msg.data.senderId === CHECKOUT_IMAGE_DEVICE_ID) return;
            if (typeof isCustomerDisplayDevice === 'function' && !isCustomerDisplayDevice()) return;
            hideCheckoutCompleteImage();
        });
    } else {
        setTimeout(waitForChannelAndSubscribeCheckoutImage, 500);
    }
})();

// レジ側：次のお会計が始まった瞬間（＝カートが空の状態から最初の商品が
// スキャンされた瞬間）に、前回のお会計完了画像を消す。
// register.js は直接編集せず、addToCart を安全にラップして実現する
// （他のファイルと同じフック方式。詳細は register-info-system.js 等を参照）。
(function hideCheckoutImageOnNewTransaction() {
    function tryHook() {
        if (typeof addToCart !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalAddToCart = addToCart;
        window.addToCart = function (...args) {
            // フック時点でカートが空 ＝ これから追加される商品が新しい会計の1品目
            const isNewTransaction = (typeof cart !== 'undefined') && cart.length === 0;
            const result = originalAddToCart.apply(this, args);
            if (isNewTransaction) {
                hideCheckoutCompleteImageAndBroadcast();
            }
            return result;
        };
    }
    tryHook();
})();

document.addEventListener('DOMContentLoaded', () => {
    renderCheckoutImagePreview();
});
