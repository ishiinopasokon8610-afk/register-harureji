// ==========================================
// keyboarddown.js - レジ画面の入力欄だけ、ソフトウェアキーボードの起動を防止する
// ------------------------------------------
// バーコードスキャナーやテンキーでの入力が中心のレジ画面（#register-screen）では
// ソフトウェアキーボードが出ると邪魔になるため inputmode="none" を付与する。
// それ以外の画面（顧客管理・商品管理・設定など、名前などを手入力する場面）では
// 通常どおりソフトウェアキーボードが出るようにする。
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    const applyKeyboardMode = () => {
        const registerScreen = document.getElementById('register-screen');
        if (!registerScreen) return;

        // レジ画面内の入力欄：ソフトウェアキーボードを出さない
        registerScreen.querySelectorAll('input, textarea').forEach(input => {
            if (input.getAttribute('inputmode') !== 'none') {
                input.setAttribute('inputmode', 'none');
            }
        });

        // レジ画面以外の入力欄：もし以前の設定が残っていたら解除し、通常どおり表示させる
        document.querySelectorAll('input, textarea').forEach(input => {
            if (!registerScreen.contains(input) && input.getAttribute('inputmode') === 'none') {
                input.removeAttribute('inputmode');
            }
        });
    };

    // 読み込み時にすぐ適用
    applyKeyboardMode();

    // 新しく表示される入力欄やモーダル内にも対応するため、フォーカス時にも適用
    document.addEventListener('focusin', (e) => {
        const target = e.target;
        if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) return;

        const registerScreen = document.getElementById('register-screen');
        if (!registerScreen) return;

        if (registerScreen.contains(target)) {
            if (target.getAttribute('inputmode') !== 'none') {
                target.setAttribute('inputmode', 'none');
            }
        } else if (target.getAttribute('inputmode') === 'none') {
            target.removeAttribute('inputmode');
        }
    });

    // モーダルなどで後から追加される入力欄対策として定期的に監視
    setInterval(applyKeyboardMode, 1000);
});
