let clerks = JSON.parse(localStorage.getItem('pos_clerks')) || [{id:1, name:'店長', kana: 'テンチョウ', barcode: '1', age: 30, voiceEnabled: true}];
let products = JSON.parse(localStorage.getItem('pos_products')) || [];
let customers = JSON.parse(localStorage.getItem('pos_customers')) || [];
let activeClerkName = localStorage.getItem('pos_active_clerk') || '店長';
let customGenres = JSON.parse(localStorage.getItem('pos_custom_genres')) || []; // ユーザーが追加した商品の種類（カテゴリ）
let priceUpdateMode = false; // 単価更新モード（テンキーで入力した金額を選択中の商品に一時的に適用する）

let cart = [];
let currentTotal = 0;
let currentDeposit = 0;
let currentChange = 0;
let selectedPayment = '現金';

let activeCustomer = null;
let customerDisplayMemberInfo = null; // 客用画面に表示する会員情報（名前・ポイント・ランク）
let usedPoints = 0;
let billingAmount = 0;
let earnedPointsThisTime = 0;
let isRegisterPaused = false;
let lastScannedBarcode = "";
let lastScannedTime = 0;

let pendingAgeCheckItem = null;
let ageVerifiedCurrentTransaction = false;
let taxExemptTransaction = false; // 免税ボタンが押された会計は、完了するまでずっと免税扱いになる

let cartHistory = [];
let redoStack = [];

let ably = null;
let channel = null;

let editingProdIndex = -1;
let editingClerkIndex = -1;
let editingCustIndex = -1;
let confirmCallback = null;
let resetStep = 0;
let pendingUnknownJan = "";
let managerAuthTarget = 'customer';

let receiptDirectoryHandle = null;
let savedDirectoryHandle = null;

// この端末を一意に識別するID（Ably経由のブロードキャストで「自分自身が送った
// イベントかどうか」を判定するために使う。年齢確認モーダルの表示などで使用）
const POS_DEVICE_ID = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);

// 追加：この端末を「客用ディスプレイ」として使うかどうかの設定。
// 複数端末を使っている場合、年齢確認モーダルやお会計完了画像は
// 本来お客様が見る1台の端末だけに表示したいため、この設定で限定する。
function isCustomerDisplayDevice() {
    return localStorage.getItem('pos_is_customer_display_device') === 'true';
}

function toggleCustomerDisplayDevice() {
    const checkbox = document.getElementById('customer-display-device-check');
    const enabled = checkbox ? checkbox.checked : false;
    localStorage.setItem('pos_is_customer_display_device', enabled ? 'true' : 'false');
    if (typeof playSound === 'function') playSound('click');
}

let managerAuthDone = sessionStorage.getItem('pos_manager_auth') === 'true';

// DOM要素取得用（安全なアクセス）
function getJanInput() { return document.getElementById('jan-input'); }
function getReceiptBody() { return document.getElementById('receipt-body'); }
function getDisplayTotal() { return document.getElementById('display-total'); }

function saveHandleToIndexedDB(handle) {
    const request = indexedDB.open('POS_Folder_DB', 1);
    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('handles')) {
            db.createObjectStore('handles');
        }
    };
    request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        store.put(handle, 'receiptDir');
    };
}

function loadHandleFromIndexedDB() {
    const request = indexedDB.open('POS_Folder_DB', 1);
    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('handles')) {
            db.createObjectStore('handles');
        }
    };
    request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        const req = store.get('receiptDir');
        req.onsuccess = () => {
            if (req.result) {
                savedDirectoryHandle = req.result;
            }
        };
    };
}