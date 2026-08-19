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

    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('img-slide-up');
    }, 7000);
}

function hideCheckoutCompleteImage() {
    const overlay = document.getElementById('customer-checkout-image-overlay');
    if (!overlay) return;
    clearTimeout(overlay._hideTimer);
    overlay.style.display = 'none';
    overlay.classList.remove('img-slide-up');
}

// レジ側：お会計完了時に呼び出す（同一端末・別端末どちらの客用画面にも対応）
function triggerCheckoutCompleteImage() {
    const dataUrl = getCheckoutCompleteImage();
    if (!dataUrl) return;

    // 同じ端末内に客用画面のDOMがあり、かつ「今まさに客用画面を表示中」の場合だけ、
    // その場で直接表示する（店員側のレジ画面には出さない）
    const customerScreen = document.getElementById('customer-screen');
    if (customerScreen && customerScreen.classList.contains('active')) {
        displayCheckoutCompleteImage(dataUrl);
    }

    // 他端末（別デバイスの客用画面）へ、Ably経由で画像データを送信
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('checkout-image-event', { image: dataUrl, senderId: CHECKOUT_IMAGE_DEVICE_ID });
        } catch (err) {
            console.warn('客用画面への画像送信に失敗しました:', err);
        }
    }
}

// 別端末の客用画面からAblyメッセージを受信するための購読登録。
// channel（Ably）の初期化はレジ/客画面を開いたタイミングで行われるため、
// 準備ができるまで少し待ってから一度だけ登録する。
(function waitForChannelAndSubscribeCheckoutImage() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('checkout-image-event', (msg) => {
            if (msg && msg.data && msg.data.image) {
                // 自分自身が送信したイベントのエコー（Ablyはデフォルトで送信者にも配信される）は、
                // すでにローカルで表示処理済みなので無視する
                if (msg.data.senderId === CHECKOUT_IMAGE_DEVICE_ID) return;
                // 他端末からの受信は、その端末が客用画面かどうかに関わらず常に表示する
                displayCheckoutCompleteImage(msg.data.image);
            }
        });
    } else {
        setTimeout(waitForChannelAndSubscribeCheckoutImage, 500);
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    renderCheckoutImagePreview();
});
