// ==========================================
// お会計完了時に客用画面へ大きく表示する画像
// ------------------------------------------
// ・データ管理・ロゴ設定画面から画像を1枚登録できる
// ・お会計完了（completeTransaction）のタイミングで、
//   客用画面いっぱいに、下からアニメーションでせり上がって表示される
// ・別端末（客用画面が別デバイスの場合）にはAbly経由で画像データを送信する
// ==========================================

const CHECKOUT_IMAGE_KEY = 'pos_checkout_complete_image';

function getCheckoutCompleteImage() {
    return localStorage.getItem(CHECKOUT_IMAGE_KEY) || '';
}

// 管理画面：画像アップロード（大きすぎる画像は自動で縮小してから保存）
function uploadCheckoutCompleteImage(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            // 客用画面いっぱいに表示するため、高解像度・高画質で保存する
            const maxW = 1920;
            const scale = Math.min(1, maxW / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            try {
                localStorage.setItem(CHECKOUT_IMAGE_KEY, dataUrl);
                if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                if (typeof playSound === 'function') playSound('success');
            } catch (err) {
                console.warn('画像の保存に失敗しました（サイズが大きすぎる可能性があります）:', err);
                if (typeof playSound === 'function') playSound('error');
            }

            renderCheckoutImagePreview();
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
// ※ 同一端末でレジ画面と客用画面を切り替えて使っている場合、
//   このタイミングで客用画面が表示されていなければ（＝店員側のレジ画面を見ている場合）、
//   店員側の画面には表示しない。客用画面が実際に表示されているときだけ表示する。
function displayCheckoutCompleteImage(dataUrl) {
    if (!dataUrl) return;

    const customerScreen = document.getElementById('customer-screen');
    if (customerScreen && !customerScreen.classList.contains('active')) {
        return; // 今この端末で客用画面が表示されていない → 表示しない
    }

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

    // 同じブラウザ内に客用画面のDOMがある場合（同一端末構成）は直接表示
    displayCheckoutCompleteImage(dataUrl);

    // 別端末の客用画面へ、Ably経由で画像データを送信
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('checkout-image-event', { image: dataUrl });
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
