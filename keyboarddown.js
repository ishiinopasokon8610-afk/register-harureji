// ==========================================
// keyboarddown.js - 入力欄フォーカス時のソフトウェアキーボード起動防止
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // 入力欄にソフトウェアキーボードを出さないための設定（inputmode="none"を強制付与）
    const preventSoftKeyboard = () => {
        const inputs = document.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            if (input.getAttribute('inputmode') !== 'none') {
                input.setAttribute('inputmode', 'none');
            }
        });
    };

    // 読み込み時にすぐ適用
    preventSoftKeyboard();

    // 新しく表示される入力欄やモーダル内にも対応するため、フォーカス時にも適用
    document.addEventListener('focusin', (e) => {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
            if (target.getAttribute('inputmode') !== 'none') {
                target.setAttribute('inputmode', 'none');
            }
        }
    });

    // モーダルなどで後から追加される入力欄対策として定期的に監視
    setInterval(preventSoftKeyboard, 1000);
});