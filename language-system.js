// ==========================================
// ハイテク音声レジスター - 言語切り替え（自動翻訳）システム
// Googleのウェブサイト自動翻訳機能（Google Website Translator）を使い、
// 画面全体を 日本語 / English / 中文（簡体） / 한국어 に切り替える。
// APIキー等の設定は不要（Googleの公開ウィジェットを利用）。
// ==========================================

let googleTranslateScriptLoaded = false;
let googleTranslateReady = false;

// Googleの翻訳スクリプトを読み込む（初回のみ）
function ensureGoogleTranslateLoaded() {
    if (googleTranslateScriptLoaded) return;
    googleTranslateScriptLoaded = true;

    window.googleTranslateElementInit = function () {
        try {
            new google.translate.TranslateElement(
                {
                    pageLanguage: 'ja',
                    includedLanguages: 'ja,en,zh-CN,ko',
                    autoDisplay: false
                },
                'google_translate_element'
            );
            googleTranslateReady = true;
        } catch (err) {
            console.warn('Google翻訳ウィジェットの初期化に失敗しました:', err);
        }
    };

    const script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    document.body.appendChild(script);
}

function openLanguageMenu() {
    if (typeof playSound === 'function') playSound('click');
    ensureGoogleTranslateLoaded();
    const modal = document.getElementById('language-menu-modal');
    if (modal) modal.style.display = 'flex';
}

function closeLanguageMenu() {
    if (typeof playSound === 'function') playSound('click');
    const modal = document.getElementById('language-menu-modal');
    if (modal) modal.style.display = 'none';
}

// 実際に言語を切り替える処理。
// Google翻訳ウィジェットが裏側で自動生成するプルダウン（select.goog-te-combo）の値を
// 直接変更することで、ページをリロードせずに翻訳を切り替える。
function setAppLanguage(langCode) {
    if (typeof playSound === 'function') playSound('click');

    const applyToCombo = (retriesLeft) => {
        const combo = document.querySelector('select.goog-te-combo');
        if (combo) {
            combo.value = langCode;
            combo.dispatchEvent(new Event('change'));
            closeLanguageMenu();
            try { localStorage.setItem('pos_ui_language', langCode); } catch (e) {}
            return;
        }
        if (retriesLeft > 0) {
            // ウィジェットの読み込み・初期化を少し待ってから再試行する
            setTimeout(() => applyToCombo(retriesLeft - 1), 400);
        } else {
            closeLanguageMenu();
        }
    };

    ensureGoogleTranslateLoaded();
    applyToCombo(15); // 最大 15 x 400ms ≒ 6秒待つ
}

// 前回選んでいた言語があれば、次回起動時にも自動的に反映する
document.addEventListener('DOMContentLoaded', () => {
    let savedLang = null;
    try { savedLang = localStorage.getItem('pos_ui_language'); } catch (e) {}
    if (savedLang && savedLang !== 'ja') {
        ensureGoogleTranslateLoaded();
        setTimeout(() => setAppLanguage(savedLang), 1500);
    }
});
