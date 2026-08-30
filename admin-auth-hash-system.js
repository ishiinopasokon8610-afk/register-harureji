// ==========================================
// admin-auth-hash-system.js
// 特定のモーダル（店長認証・お会計履歴の認証・給与管理まわり 等）が
// 開いている間だけ、URLハッシュとページタイトルをそのモーダル専用の値に切り替える
// ------------------------------------------
// screen-hash-navigation.js / screen-title-system.js が showScreen() の
// 切り替えに合わせてハッシュ・タイトルを設定しているのと同じ考え方だが、
// ここで扱うモーダルは showScreen() ではなく色々な場所（商品管理を開く時・
// お会計履歴を見る時・給与管理を開く時 等）から開かれるため、
// showScreen()をフックする方式では対応しきれない。
//
// そのため、モーダル自体のstyle（display）の変化をMutationObserverで監視し、
//   ・非表示 → 表示 になった瞬間：そのモーダル専用のハッシュ・タイトルにする
//   ・表示 → 非表示 になった瞬間：モーダルを開く前のハッシュ・タイトルに戻す
// という方式にする。verifyManagerAuth() 等の呼び出し元・呼び出し方を問わず、
// またWeb Speech APIの音声のように「表示言語（language-system.js）」が
// 何であっても、モーダルの表示状態だけを見て動くため、言語設定に関わらず
// 常に同じように動作する（既存のui.js等を直接編集する必要もない）。
//
// タイトルは screen-title-system.js と同じ形式「OO-haruレジ」にする。
//
// 対象モーダルとハッシュ／タイトルの対応：
//   manager-auth-modal      → #admincertification    店長認証-haruレジ
//   history-auth-modal      → #Staff Authentication  スタッフ認証-haruレジ
//   payroll-settings-modal  → #payrollsettings        給与管理-haruレジ
//   payroll-calc-modal      → #payrollcalculation     給与計算-haruレジ
// ==========================================

const HASH_TITLE_BASE = (typeof BASE_PAGE_TITLE !== 'undefined') ? BASE_PAGE_TITLE : 'haruレジ';

const HASH_WATCHED_MODALS = [
    { id: 'manager-auth-modal', hash: '#admincertification', title: '店長認証' },
    { id: 'history-auth-modal', hash: '#Staff Authentication', title: 'スタッフ認証' },
    { id: 'payroll-settings-modal', hash: '#payrollsettings', title: '給与管理' },
    { id: 'payroll-calc-modal', hash: '#payrollcalculation', title: '給与計算' },
    { id: 'paid-leave-modal', hash: '#paidleave', title: '有給登録' }
];

function watchModalForHash(modalId, hashValue, titleLabel) {
    let previouslyOpen = false;
    let hashBeforeOpen = null;
    let titleBeforeOpen = null;

    function isModalOpen(modal) {
        return window.getComputedStyle(modal).display !== 'none';
    }

    function handleChange(modal) {
        const open = isModalOpen(modal);

        if (open && !previouslyOpen) {
            previouslyOpen = true;
            // 開く直前のハッシュ・タイトルを覚えておき、閉じたときに戻せるようにする
            hashBeforeOpen = window.location.hash;
            titleBeforeOpen = document.title;

            if (window.location.hash !== hashValue) {
                window.location.hash = hashValue;
            }
            if (titleLabel) {
                document.title = `${titleLabel}-${HASH_TITLE_BASE}`;
            }
        } else if (!open && previouslyOpen) {
            previouslyOpen = false;

            if (window.location.hash === hashValue) {
                if (hashBeforeOpen) {
                    window.location.hash = hashBeforeOpen;
                } else {
                    // 開く前のハッシュが無かった場合は、履歴を1つ戻して消す
                    history.back();
                }
            }
            if (titleBeforeOpen !== null) {
                document.title = titleBeforeOpen;
            }

            hashBeforeOpen = null;
            titleBeforeOpen = null;
        }
    }

    function init() {
        const modal = document.getElementById(modalId);
        if (!modal) {
            // 給与管理・給与計算のモーダルはJSで後から動的に生成されるため、
            // まだ存在しない場合は見つかるまで待つ
            setTimeout(init, 300);
            return;
        }

        const observer = new MutationObserver(() => handleChange(modal));
        observer.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });

        // 初期状態も一応確認しておく（起動直後にすでに開いている、という通常想定しないケースの保険）
        handleChange(modal);
    }

    init();
}

HASH_WATCHED_MODALS.forEach(m => watchModalForHash(m.id, m.hash, m.title));
