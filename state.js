let clerks = JSON.parse(localStorage.getItem('pos_clerks')) || [{id:1, name:'店長', kana: 'テンチョウ', barcode: '', age: 30, voiceEnabled: true}];
let products = JSON.parse(localStorage.getItem('pos_products')) || [];
let customers = JSON.parse(localStorage.getItem('pos_customers')) || [];
let activeClerkName = localStorage.getItem('pos_active_clerk') || '店長';

let cart = [];
let currentTotal = 0;
let currentDeposit = 0;
let currentChange = 0;
let selectedPayment = '現金';

let activeCustomer = null;
let usedPoints = 0;
let billingAmount = 0;
let earnedPointsThisTime = 0;
let isRegisterPaused = false;
let lastScannedBarcode = "";
let lastScannedTime = 0;

let pendingAgeCheckItem = null;
let ageVerifiedCurrentTransaction = false;

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