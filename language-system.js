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
// 翻訳を完全に解除して元の日本語に戻す。
// 【不具合修正】Google翻訳のプルダウンを 'ja' にしても、原文（日本語）に戻らず
// 翻訳されたままになることがあった。「原文を表示」ボタンを押す／翻訳の記憶（googtrans cookie）
// を消してリロードする、の順で確実に解除する。
function restoreOriginalLanguage() {
    try { localStorage.setItem('pos_ui_language', 'ja'); } catch (e) {}
    closeLanguageMenu();

    const isTranslated = document.documentElement.classList.contains('translated-ltr') ||
        document.documentElement.classList.contains('translated-rtl') ||
        /(^|;\s*)googtrans=\/[^;]+/.test(document.cookie);
    if (!isTranslated) return; // もともと日本語のまま

    // ① Googleのバーにある「原文を表示」ボタンを押す（見えなくても押せる）
    try {
        const frames = document.querySelectorAll('iframe.goog-te-banner-frame, iframe[id^="goog-te-banner"], iframe[class*="goog-te-banner"]');
        for (const f of frames) {
            const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
            const btn = doc && doc.querySelector('button[id$="restore"], a[id$="restore"], [id*="restore"]');
            if (btn) {
                btn.click();
                setTimeout(() => {
                    if (document.documentElement.classList.contains('translated-ltr') ||
                        document.documentElement.classList.contains('translated-rtl')) {
                        clearGoogleTranslateCookieAndReload();
                    }
                }, 800);
                return;
            }
        }
    } catch (e) {}

    // ② ボタンが見つからなければ、翻訳の記憶を消してリロード
    clearGoogleTranslateCookieAndReload();
}

function clearGoogleTranslateCookieAndReload() {
    const host = location.hostname;
    const parts = host.split('.');
    const domains = ['', host, '.' + host];
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    domains.forEach((d) => {
        const dom = d ? '; domain=' + d : '';
        document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + dom;
    });
    location.reload();
}

function setAppLanguage(langCode) {
    if (typeof playSound === 'function') playSound('click');

    // 日本語を選んだら、翻訳を解除して元の画面に戻す
    if (langCode === 'ja') {
        restoreOriginalLanguage();
        return;
    }

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
