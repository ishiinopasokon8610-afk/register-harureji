// ==========================================
// ハイテク音声レジスター - シンプル認証・認可システム
// ==========================================
// 複雑さなし。必要最小限で実用的なセキュリティ
// ==========================================

const AUTH_ROLE_KEY = 'pos_auth_role'; // 'manager' | 'staff' | 'customer'
const AUTH_USER_KEY = 'pos_auth_user';
const AUTH_SESSION_KEY = 'pos_auth_session_id';
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8時間

/**
 * 認証ロール定義
 */
const AUTH_ROLES = {
    MANAGER: {
        id: 'manager',
        name: '店長',
        icon: '👨‍💼',
        permissions: ['all'],
        sessionTimeout: 24 * 60 * 60 * 1000 // 24時間
    },
    STAFF: {
        id: 'staff',
        name: '店員',
        icon: '👔',
        permissions: [
            'register-use',        // レジ使用
            'view-history',        // 履歴閲覧
            'customer-scan',       // 会員スキャン
            'view-own-sales',      // 自分の売上確認
            'timecard-use',        // 自分のタイムカード打刻
            'discount-manage'      // 自動化バーコード（割引/自動追加）の登録・編集
        ],
        sessionTimeout: SESSION_TIMEOUT_MS
    },
    CUSTOMER: {
        id: 'customer',
        name: '顧客',
        icon: '👤',
        permissions: [
            'view-own-points',     // 自分のポイント確認
            'view-own-rank'        // 自分のランク確認
        ],
        sessionTimeout: 30 * 60 * 1000 // 30分
    }
};

/**
 * 現在のセッション情報を取得
 */
function getCurrentSession() {
    return {
        role: localStorage.getItem(AUTH_ROLE_KEY),
        user: JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null'),
        sessionId: localStorage.getItem(AUTH_SESSION_KEY),
        loginTime: localStorage.getItem(`pos_login_time_${localStorage.getItem(AUTH_SESSION_KEY)}`)
    };
}

/**
 * ログイン（店長 or 店員認証）
 * @param {string} name - 店員名
 * @param {string} barcode - バーコード（認証用）
 * @param {string} roleId - 'manager' or 'staff'
 */
function login(name, barcode, roleId = 'staff') {
    const role = AUTH_ROLES[roleId.toUpperCase()] || AUTH_ROLES.STAFF;
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const userData = {
        name: name,
        barcode: barcode,
        loginAt: new Date().toISOString(),
        deviceId: POS_DEVICE_ID
    };

    localStorage.setItem(AUTH_ROLE_KEY, role.id);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(userData));
    localStorage.setItem(AUTH_SESSION_KEY, sessionId);
    localStorage.setItem(`pos_login_time_${sessionId}`, Date.now().toString());

    // アプリ全体で使われている「現在の担当者」も、ログインした本人に合わせておく
    // （レジのレシート表示・音声案内・年齢確認の記録者名などに使われる）
    if (roleId.toUpperCase() !== 'CUSTOMER') {
        try {
            if (typeof window !== 'undefined') window.activeClerkName = name;
            localStorage.setItem('pos_active_clerk', name);
        } catch (e) {}
    }

    // セッションタイムアウト設定
    setupSessionTimeout(role.sessionTimeout);

    console.log(`✅ ログイン成功: ${userData.name} (${role.name})`);
    return sessionId;
}

/**
 * ログアウト
 */
function logout() {
    const sessionId = localStorage.getItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_ROLE_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_SESSION_KEY);
    if (sessionId) {
        localStorage.removeItem(`pos_login_time_${sessionId}`);
    }
    
    console.log('✅ ログアウト');
}

/**
 * 特定の権限があるかチェック
 * @param {string} permission - チェック対象の権限
 * @returns {boolean}
 */
function hasPermission(permission) {
    const session = getCurrentSession();
    if (!session.role) return false;

    const role = AUTH_ROLES[session.role.toUpperCase()];
    if (!role) return false;

    // 'all' 権限がある場合は全て許可
    if (role.permissions.includes('all')) return true;

    // 店員としてログインしていても、その場でFirebaseの店長認証（バーコード）に
    // 成功していれば、一時的に'all'相当の操作を許可する。
    // （firebase-manager-auth.js による、既存の「店長認証」フローとの整合性）
    if (permission === 'all' && typeof isManagerAuthorized === 'function' && isManagerAuthorized()) {
        return true;
    }

    return role.permissions.includes(permission);
}

/**
 * 店長かチェック
 */
function isManager() {
    return getCurrentSession().role === AUTH_ROLES.MANAGER.id;
}

/**
 * ログイン状態かチェック
 */
function isLoggedIn() {
    return !!getCurrentSession().role;
}

/**
 * セッションタイムアウト設定
 */
let timeoutTimer = null;
function setupSessionTimeout(timeoutMs) {
    if (timeoutTimer) clearTimeout(timeoutTimer);

    timeoutTimer = setTimeout(() => {
        logout();
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                'セッションがタイムアウトしました。再度ログインしてください。',
                'せっしょん が たいむあうと しました',
                () => { window.location.hash = '#home'; },
                true
            );
        }
    }, timeoutMs);
}

/**
 * セッションの有効期限切れを確認する（アプリ再起動・タブ再読み込み時にも必ず効くようにする）。
 * ------------------------------------------
 * setupSessionTimeout() の setTimeout はページを閉じる/再読み込みすると消えてしまうため、
 * それだけではブラウザを再起動した場合にログイン状態が無期限に残ってしまう。
 * ここでは実際のログイン時刻(pos_login_time_*)と現在時刻を比較し、
 * ロールごとの制限時間を超えていれば強制的にログアウトする。
 */
function checkStaffSessionExpiry() {
    const session = getCurrentSession();
    if (!session.role || !session.sessionId) return;

    const role = AUTH_ROLES[session.role.toUpperCase()];
    if (!role) return;

    const loginTime = parseInt(session.loginTime || '0', 10);
    if (!loginTime || (Date.now() - loginTime) > role.sessionTimeout) {
        logout();
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                'セッションがタイムアウトしました。再度ログインしてください。',
                'せっしょん が たいむあうと しました',
                () => { window.location.hash = '#home'; },
                true
            );
        }
    }
}

/**
 * セッションを更新（操作があった時に呼ぶ）
 */
function refreshSession() {
    const session = getCurrentSession();
    if (session.role && session.sessionId) {
        const role = AUTH_ROLES[session.role.toUpperCase()];
        if (role) {
            setupSessionTimeout(role.sessionTimeout);
        }
    }
}

/**
 * 操作前の権限チェック（共通）
 * @param {string} permission - 必要な権限
 * @returns {boolean}
 */
function checkPermissionBeforeAction(permission) {
    if (!isLoggedIn()) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                'ログインしてください。',
                'ろぐいん し て ください',
                () => {},
                true
            );
        }
        return false;
    }

    if (!hasPermission(permission)) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            const session = getCurrentSession();
            const role = AUTH_ROLES[session.role.toUpperCase()];
            showCustomConfirm(
                `この操作は ${role.name} には許可されていません。`,
                'この そう さ は きょか さ れ て い ません',
                () => {},
                true
            );
        }
        return false;
    }

    refreshSession();
    return true;
}

/**
 * ナビゲーション制御（画面遷移前）
 * @param {string} screenId - 画面ID
 * @returns {boolean}
 */
function canAccessScreen(screenId) {
    if (!isLoggedIn()) return false;

    const screenPermissions = {
        'register-screen': 'register-use',
        'customer-mgmt-screen': 'all',
        'product-screen': 'all',
        'clerk-screen': 'all',
        'migration-screen': 'all',
        'sales-mgmt-screen': 'all',
        'history-screen': 'view-history',
        'analytics-screen': 'all',
        'discount-screen': 'discount-manage',
        'timecard-screen': 'timecard-use' // 店員が自分で出退勤を打刻できるようにする
    };

    const requiredPermission = screenPermissions[screenId];
    if (!requiredPermission) return true; // 制限なし

    return hasPermission(requiredPermission);
}

/**
 * UI・表示の制御（ロール表示）
 */
function renderAuthUI() {
    const session = getCurrentSession();
    
    if (!session.role) {
        // ログイン前：何も表示しない
        return;
    }

    const role = AUTH_ROLES[session.role.toUpperCase()];
    const statusDiv = document.getElementById('auth-status-display');
    
    if (statusDiv) {
        statusDiv.innerHTML = `
            <div style="font-size: 12px; color: #666;">
                ${role.icon} ${role.name}: <b>${session.user?.name || 'unknown'}</b>
                <button onclick="logout(); if (typeof showStaffLoginGate === 'function') { showStaffLoginGate('home-screen'); } else { window.location.hash='#home'; }" style="margin-left: 8px; padding: 2px 8px; font-size: 10px; background: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer;">ログアウト</button>
            </div>
        `;
    }
}

/**
 * 顧客データアクセス制御
 * @param {string} customerBarcode - アクセス対象の顧客バーコード
 * @returns {boolean}
 */
function canAccessCustomerData(customerBarcode) {
    if (!isLoggedIn()) return false;

    const session = getCurrentSession();
    
    // 店長は全顧客にアクセス可
    if (isManager()) return true;

    // 店員は自分がスキャンした顧客のみアクセス可
    if (hasPermission('customer-scan')) {
        return true; // シンプル: スキャンした顧客なら見れる
    }

    // 顧客は自分のデータのみ
    if (session.role === AUTH_ROLES.CUSTOMER.id) {
        return session.user?.barcode === customerBarcode;
    }

    return false;
}

/**
 * 顧客データ編集制御
 * @param {string} customerBarcode - 編集対象の顧客バーコード
 * @returns {boolean}
 */
function canEditCustomerData(customerBarcode) {
    // 編集は店長のみ
    return isManager();
}

/**
 * 売上データの表示制限
 * @param {string} saleCreatedBy - 売上を作成した店員名
 * @returns {boolean}
 */
function canViewSaleData(saleCreatedBy) {
    if (!isLoggedIn()) return false;

    const session = getCurrentSession();

    // 店長は全売上を見られる
    if (isManager()) return true;

    // 店員は自分の売上のみ
    if (hasPermission('view-own-sales')) {
        return session.user?.name === saleCreatedBy;
    }

    return false;
}

/**
 * 初期化：DOMContentLoaded時に呼ぶ
 */
function initAuthSystem() {
    // 再起動・再読み込みをまたいだ期限切れを最初に確認する
    checkStaffSessionExpiry();

    // タイムアウト設定
    const session = getCurrentSession();
    if (session.role) {
        const role = AUTH_ROLES[session.role.toUpperCase()];
        if (role) {
            setupSessionTimeout(role.sessionTimeout);
        }
    }

    // 定期的にセッションをリフレッシュ
    document.addEventListener('click', refreshSession);
    document.addEventListener('keydown', refreshSession);

    // UI表示
    renderAuthUI();

    console.log('🔐 認証システム初期化完了');
}

// DOMContentLoaded時に初期化
document.addEventListener('DOMContentLoaded', initAuthSystem);

// 定期的に認証UIを更新・セッション期限を確認
setInterval(renderAuthUI, 30000); // 30秒ごと
setInterval(checkStaffSessionExpiry, 30000); // 30秒ごと
