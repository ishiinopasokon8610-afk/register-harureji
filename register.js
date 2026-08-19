// 二重プッシュ防止用のフラグ
let isSubmitting = false;
let selectedGenreFilter = 'すべて'; // 現在選択中のジャンルフィルター

// 確実にフォーカスを当てるためのヘルパー関数
function focusJanInput() {
    setTimeout(() => {
        const input = getJanInput();
        const isModalOpen = Array.from(document.querySelectorAll('.modal, .modal-overlay, #checkout-modal, #invoice-modal, #receipt-print-modal')).some(m => {
            const style = window.getComputedStyle(m);
            return style.display === 'flex' || style.display === 'block';
        });

        if (input && !isRegisterPaused && !isModalOpen) {
            input.focus();
        }
    }, 100);
}

// 画面クリック時の自動フォーカス
document.addEventListener('click', (e) => {
    const regScreen = document.getElementById('register-screen');
    if (regScreen && regScreen.classList.contains('active')) {
        const target = e.target;
        if (!['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'A'].includes(target.tagName)) {
            focusJanInput();
        }
    }
});

function openRegister() {
    initAbly();
    requestFullscreen();
    window.location.hash = '#register';
    showScreen('register-screen');
    const clerkDisplay = document.getElementById('active-clerk-display');
    if (clerkDisplay) clerkDisplay.innerText = `担当: ${activeClerkName}`;
    
    renderGenreFilterButtons(); // ジャンルタブの描画
    generateCustomButtons();   // 商品ボタンの描画
    focusJanInput();
    updatePauseUI();
    speak("いらっしゃいませ");
}

/* =========================================================
   ジャンル（種類）フィルター機能
   ========================================================= */
const BASE_GENRE_LIST = [
    '食品', '飲料/お酒', 'お惣菜/お弁当', 
    'スイーツ/菓子', '日用品', '衣料品', '雑貨', 'サービス', 'その他商品', '値引き/その他'
];

// 基本の種類一覧 ＋ ユーザーが追加した種類（customGenres）をまとめて返す
function getAllGenres() {
    const customs = (typeof customGenres !== 'undefined' && Array.isArray(customGenres)) ? customGenres : [];
    const merged = BASE_GENRE_LIST.slice();
    customs.forEach(g => { if (g && !merged.includes(g)) merged.push(g); });
    return merged;
}

function getGenreFilterList() {
    return ['すべて'].concat(getAllGenres());
}

function renderGenreFilterButtons() {
    const container = document.getElementById('genre-filter-container');
    if (!container) return;

    container.innerHTML = '';
    getGenreFilterList().forEach(genre => {
        const btn = document.createElement('button');
        btn.className = 'genre-tab-btn' + (selectedGenreFilter === genre ? ' active' : '');
        btn.innerText = genre;
        btn.onclick = () => {
            selectedGenreFilter = genre;
            renderGenreFilterButtons();
            generateCustomButtons();
            focusJanInput();
        };
        container.appendChild(btn);
    });
}

function generateCustomButtons() {
    const area = document.getElementById('custom-buttons-area');
    if (!area) return;
    area.innerHTML = '';

    // 選択されたジャンルで商品を絞り込み
    let filteredProducts = products;
    if (selectedGenreFilter !== 'すべて') {
        filteredProducts = products.filter(p => (p.genre || 'その他商品') === selectedGenreFilter);
    }

    // 追加：商品名での検索絞り込み
    const searchInput = document.getElementById('product-name-search');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (searchTerm) {
        filteredProducts = filteredProducts.filter(p => (p.name || '').toLowerCase().includes(searchTerm));
    }

    if (filteredProducts.length === 0) {
        const msg = searchTerm ? `「${searchTerm}」に該当する商品はありません` : `「${selectedGenreFilter}」に該当する商品はありません`;
        area.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 20px;">${msg}</div>`;
        return;
    }

    // 追加：よく使う（利用回数が多い）商品ほど上の方に表示する
    filteredProducts = filteredProducts.slice().sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));

    filteredProducts.forEach(prod => {
        const btn = document.createElement('button');
        btn.className = 'action-btn blue';
        btn.style.position = 'relative';
        
        const genreTag = prod.genre ? `<span class="prod-genre-badge">${prod.genre}</span>` : '';
        const frequentTag = (prod.usageCount || 0) >= 3 ? '<span class="prod-frequent-badge">⭐よく使う</span>' : '';
        const safeName = (typeof escapeHtml === 'function') ? escapeHtml(prod.name) : prod.name;
        btn.innerHTML = `${genreTag}${frequentTag}<b>${safeName}</b><small>¥${prod.price.toLocaleString()}</small>`;
        
        btn.onclick = () => {
            playSound('click');
            checkAndAddToCart(prod);
            focusJanInput();
        };
        area.appendChild(btn);
    });
}

// 客用画面に表示する会員情報（名前・ポイント・ランク）をまとめる
function buildMemberSummary(cust, displayName, rankInfo) {
    if (!cust) return null;
    const name = displayName || cust.name || `${cust.lastName || ''} ${cust.firstName || ''}`.trim();
    const info = rankInfo || ((typeof getCustomerRankInfo === 'function') ? getCustomerRankInfo(cust) : null);
    return {
        name: name,
        points: cust.points,
        rankName: info ? info.name : '',
        rankColor: info ? info.color : '',
        navText: (typeof buildRankNavText === 'function') ? buildRankNavText(cust) : ''
    };
}

function openCustomerScreen() {
    initAbly();
    requestFullscreen();
    window.location.hash = '#customer';
    showScreen('customer-screen');
    updateCustomerDisplay();
    updatePauseUI();
    speak("いらっしゃいませ");
}

function updateCustomerDisplay() {
    const listEl = document.getElementById('customer-cart-list');
    const totalEl = document.getElementById('customer-total');
    const depositEl = document.getElementById('customer-deposit');
    const changeEl = document.getElementById('customer-change');
    const lastCodeEl = document.getElementById('customer-last-barcode');

    const titleEl = document.getElementById('customer-title') || 
                    document.getElementById('customer-header') || 
                    (listEl ? listEl.previousElementSibling : null);

    const actualBilling = (billingAmount !== undefined) ? billingAmount : currentTotal;

    if (totalEl) totalEl.innerText = `¥${actualBilling.toLocaleString()}`;
    if (depositEl) depositEl.innerText = `¥${currentDeposit.toLocaleString()}`;
    if (changeEl) changeEl.innerText = `¥${currentChange.toLocaleString()}`;
    
    if (lastCodeEl) {
        lastCodeEl.innerText = lastScannedBarcode ? `コード: ${lastScannedBarcode}` : 'コード: -';
    }

    // 追加：お会計確定前でも、お支払方法を選んだだけで「いらっしゃいませ」の文言を変える
    const headerMsgEl = document.getElementById('customer-header-msg');
    if (headerMsgEl) {
        const payingByPoints = (usedPoints > 0 && billingAmount === 0);
        if (cart.length === 0) {
            headerMsgEl.innerText = 'いらっしゃいませ！';
        } else if (payingByPoints) {
            headerMsgEl.innerText = 'ポイントでのお支払いですね';
        } else if (selectedPayment === 'クレジット') {
            headerMsgEl.innerText = 'クレジットカードでのお支払いですね';
        } else if (selectedPayment === 'QR決済') {
            headerMsgEl.innerText = 'QR決済でのお支払いですね';
        } else if (selectedPayment === '現金' && currentDeposit > 0) {
            headerMsgEl.innerText = '現金でのお支払いですね';
        } else {
            headerMsgEl.innerText = 'ご来店ありがとうございます';
        }
    }

    // 追加：お支払方法を選んだ時、客画面右側にバッジで表示する
    const paymentBadgeEl = document.getElementById('customer-payment-badge');
    if (paymentBadgeEl) {
        const inPayStep = (
            selectedPayment === 'クレジット' ||
            selectedPayment === 'QR決済' ||
            (selectedPayment === '現金' && currentDeposit > 0)
        );
        if (inPayStep && cart.length > 0) {
            const payIcon = selectedPayment === '現金' ? '💴' : (selectedPayment === 'クレジット' ? '💳' : '📱');
            paymentBadgeEl.innerText = `${payIcon} ${selectedPayment}`;
            paymentBadgeEl.style.display = 'block';
        } else {
            paymentBadgeEl.style.display = 'none';
        }
    }

    // 追加：会員バーコードスキャン時、客画面右側に現在のポイント数・ランクを表示する
    const memberCardEl = document.getElementById('customer-member-card');
    if (memberCardEl) {
        const info = (typeof customerDisplayMemberInfo !== 'undefined') ? customerDisplayMemberInfo : null;
        if (info) {
            const nameEl = document.getElementById('cm-name');
            const rankEl = document.getElementById('cm-rank');
            const ptsEl = document.getElementById('cm-points');
            const navEl = document.getElementById('cm-nav');
            if (nameEl) nameEl.innerText = `👤 ${info.name || ''} 様`;
            if (rankEl) {
                rankEl.innerText = info.rankName || '';
                rankEl.style.background = info.rankColor || 'rgba(0,0,0,0.25)';
            }
            if (ptsEl) ptsEl.innerText = (info.points !== undefined && info.points !== null) ? info.points : 0;
            if (navEl) navEl.innerText = info.navText || '';
            memberCardEl.style.display = 'block';
        } else {
            memberCardEl.style.display = 'none';
        }
    }

    if (!listEl) return;

    if (typeof selectedPayment !== 'undefined' && (selectedPayment === 'クレジット' || selectedPayment === 'QR決済')) {
        if (titleEl && titleEl !== listEl) titleEl.style.display = 'none';
        listEl.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 160px; text-align: center; color: #80d8ff; font-size: 22px; font-weight: bold; padding: 20px; line-height: 1.6;">
                店員の指示に従ってお支払いください。
            </div>
        `;
        return;
    }

    if (titleEl && titleEl !== listEl) titleEl.style.display = '';

    if (cart.length === 0) {
        listEl.innerHTML = '<div style="color: #ccc; text-align: center;">商品がスキャンされるとここに表示されます</div>';
        return;
    }
    
    listEl.innerHTML = '';
    cart.forEach(item => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.marginBottom = '6px';
        div.style.fontSize = '16px';
        const safeName = (typeof escapeHtml === 'function') ? escapeHtml(item.name) : item.name;
        div.innerHTML = `<span>${safeName} ${item.qty > 1 ? 'x'+item.qty : ''}</span> <span>¥${(item.price * item.qty).toLocaleString()}</span>`;
        listEl.appendChild(div);
    });
    
    if (usedPoints && usedPoints > 0) {
        const pDiv = document.createElement('div');
        pDiv.style.display = 'flex';
        pDiv.style.justifyContent = 'space-between';
        pDiv.style.marginBottom = '6px';
        pDiv.style.fontSize = '16px';
        pDiv.style.color = '#ff80ab';
        pDiv.innerHTML = `<span>ポイント利用</span> <span>- ¥${usedPoints.toLocaleString()}</span>`;
        listEl.appendChild(pDiv);
    }

    listEl.scrollTop = listEl.scrollHeight;
}

function typeNum(n) {
    playSound('click');
    const input = getJanInput();
    if (input) { input.value += n; focusJanInput(); }
}

// 追加：「万」ボタン。入力中の数字を1万円単位に一括変換する（例: 3 → 30000）
function typeMan() {
    playSound('click');
    const input = getJanInput();
    if (!input) return;
    const cur = parseInt(input.value, 10);
    if (isNaN(cur) || cur === 0) {
        input.value = '10000';
    } else {
        input.value = String(cur * 10000);
    }
    focusJanInput();
}

function clearNum() {
    playSound('click');
    const input = getJanInput();
    if (input) { input.value = ""; focusJanInput(); }
    // 単価更新モードの途中でクリアした場合はモードごとキャンセルする
    if (typeof priceUpdateMode !== 'undefined' && priceUpdateMode) {
        cancelPriceUpdateMode();
    }
}

// 追加：単価更新モード（選択中の商品の価格を、今回のお会計だけ一時的に変更する。商品マスタは変更しない）
function startPriceUpdateMode() {
    if (selectedCartIndex === -1 || !cart[selectedCartIndex]) {
        playSound('error');
        showCustomConfirm("先にレシートから価格を変更したい商品をタップして選択してください。", "さきに かかくを へんこう し たい しょうひんを タップ し て せんたく し て ください。", () => { focusJanInput(); }, true);
        return;
    }
    playSound('click');
    priceUpdateMode = true;
    const input = getJanInput();
    if (input) {
        input.value = '';
        input.placeholder = '新しい価格を入力して「確定」を押してください';
        input.classList.add('price-update-active');
        input.focus();
    }
    speak('あたらしい たんかを にゅうりょく し て ください');
}

function cancelPriceUpdateMode() {
    priceUpdateMode = false;
    const input = getJanInput();
    if (input) {
        input.placeholder = 'JAN・会員・店員バーコードをスキャン';
        input.classList.remove('price-update-active');
    }
}

function applyPriceUpdate(code) {
    const newPrice = parseInt(code, 10);
    cancelPriceUpdateMode();

    if (isNaN(newPrice) || newPrice < 0 || selectedCartIndex === -1 || !cart[selectedCartIndex]) {
        playSound('error');
        showCustomConfirm("価格の変更に失敗しました。数字のみを入力してください。", "かかく の へんこう に しっぱい し まし た。", () => { focusJanInput(); }, true);
        return;
    }

    recordCartState();
    const item = cart[selectedCartIndex];
    item.price = newPrice;
    item.priceOverridden = true; // 今回限りの単価変更（商品マスタには反映されない）
    selectedCartIndex = -1;
    updateReceipt();
    playSound('success');
    speak(`たんかを ${newPrice}えんに へんこう し まし た`);
    focusJanInput();
}

// 税込価格から、指定の税率分を差し引いた「免税後の価格」を計算する
// （例：110円・税率10% → 100円）
function computeTaxExemptPrice(price, originalTaxRate) {
    if (!originalTaxRate || originalTaxRate <= 0) return price;
    return Math.floor(price * 100 / (100 + originalTaxRate));
}

// 免税対象ボタン。
// 押した時点でこの会計（取引）全体を免税に切り替える。
// 元々の価格は税込で登録されているため、税率分を差し引いた金額に変更する。
// 会計が完了する（レシート発行後）までは、後から追加した商品にも自動的に免税が適用され続ける。
function applyTaxExempt() {
    if (cart.length === 0) {
        playSound('error');
        showCustomConfirm("先に商品をカートに入れてください。", "さき に しょうひん を かーと に いれ て ください。", () => { focusJanInput(); }, true);
        return;
    }
    recordCartState();
    playSound('click');

    taxExemptTransaction = true; // この会計はずっと免税

    cart.forEach(item => {
        if (item.taxExempt) return; // すでに免税適用済みならスキップ（二重に差し引かない）
        const originalRate = item.taxRate;
        if (originalRate > 0) {
            item.price = computeTaxExemptPrice(item.price, originalRate);
        }
        item.originalTaxRate = originalRate;
        item.taxRate = 0;
        item.taxExempt = true;
    });

    selectedCartIndex = -1;
    updateReceipt();
    speak("この おかいけい は、 これいこう ずっと めんぜい に なり まし た");
    focusJanInput();
}

async function submitInput() {
    const input = getJanInput();
    if (!input) return;

    if (isSubmitting) {
        input.value = "";
        focusJanInput();
        return;
    }

    const code = input.value.trim();
    if (!code) {
        focusJanInput();
        return;
    }

    // 単価更新モード中は、入力された数字を新しい価格として適用する（バーコード処理は行わない）
    if (typeof priceUpdateMode !== 'undefined' && priceUpdateMode) {
        input.value = "";
        applyPriceUpdate(code);
        return;
    }

    const nowTime = Date.now();
    if (code === lastScannedBarcode && (nowTime - lastScannedTime) < 1000) {
        input.value = "";
        focusJanInput();
        return;
    }

    isSubmitting = true;
    input.value = "";
    lastScannedBarcode = code;
    lastScannedTime = nowTime;
    
    playSound('beep');

    try {
        await fetchAndAddItem(code);
    } finally {
        isSubmitting = false;
        focusJanInput();
    }
}

async function fetchAndAddItem(code) {
    const foundClerk = clerks.find(c => c.barcode && c.barcode === code);
    if (foundClerk) {
        selectClerk(foundClerk.name);
        return;
    }

    const foundCustomer = customers.find(c => c.barcode === code);
    if (foundCustomer) {
        activeCustomer = foundCustomer;
        if (typeof ensureCustomerRankFields === 'function') ensureCustomerRankFields(activeCustomer);
        const currentAge = calculateAge(foundCustomer);
        const displayName = foundCustomer.name || `${foundCustomer.lastName || ''} ${foundCustomer.firstName || ''}`;
        
        const acNameEl = document.getElementById('ac-name');
        const acAgeEl = document.getElementById('ac-age');
        const acPtsEl = document.getElementById('ac-points');
        if (acNameEl) acNameEl.innerText = displayName;
        if (acAgeEl) acAgeEl.innerText = currentAge;
        if (acPtsEl) acPtsEl.innerText = foundCustomer.points;

        // 会員ランクの即時判別表示（レジ画面に大きくカラー表示）
        const rankBadgeEl = document.getElementById('ac-rank-badge');
        const rankNavEl = document.getElementById('ac-rank-nav');
        let rankInfo = null;
        if (typeof getCustomerRankInfo === 'function') {
            rankInfo = getCustomerRankInfo(activeCustomer);
            if (rankBadgeEl) {
                rankBadgeEl.innerText = rankInfo.name;
                rankBadgeEl.style.background = rankInfo.color;
            }
            if (rankNavEl && typeof buildRankNavText === 'function') {
                rankNavEl.innerText = buildRankNavText(activeCustomer);
            }
        }

        // 追加：客用画面（別端末の場合も含む）にポイント・ランクを表示するための情報を作成
        customerDisplayMemberInfo = buildMemberSummary(activeCustomer, displayName, rankInfo);
        
        const exp = checkPointExpiry(foundCustomer);
        const expInfoEl = document.getElementById('ac-exp-info');
        if (expInfoEl) expInfoEl.innerText = "";

        if (exp.expired) {
            activeCustomer.points = 0;
            if (expInfoEl) expInfoEl.innerText = "⚠️ 保有ポイントが1年経過により失効しました。";
            speak(`かいいんカードをスキャンしました。ポイントは1年経過したため失効しました。`);
        } else if (exp.expiringSoon) {
            if (expInfoEl) expInfoEl.innerText = `⚠️ まもなく ${foundCustomer.points} ポイントが失効します！(あと${exp.daysLeft}日)`;
            speak(`かいいんカードをスキャンしました。まもなく、${foundCustomer.points} ポイントが失効します。`);
        } else if (rankInfo && (rankInfo.key === 'gold' || rankInfo.key === 'diamond')) {
            // 上位ランク会員には一言添える
            speak(`いつもご利用ありがとうございます。${rankInfo.name}かいいんさまです。げんざいのポイントは、${foundCustomer.points} ポイントです。`);
        } else {
            speak(`かいいんカードをスキャンしました。げんざいのポイントは、${foundCustomer.points} ポイントです。`);
        }

        const acDisplay = document.getElementById('active-customer-display');
        if (acDisplay) acDisplay.style.display = 'block';
        playSound('success');
        broadcastState();
        return;
    }

    let foundProd = products.find(p => p.jan === code || p.name === code);
    if (foundProd) {
        checkAndAddToCart(foundProd);
        return;
    }

    if (code.startsWith('978')) {
        try {
            const response = await fetch(`https://api.openbd.jp/v1/get?isbn=${code}`);
            const data = await response.json();
            if (data && data[0] && data[0].summary) {
                let itemName = data[0].summary.title;
                let itemPrice = 0;
                try {
                    const priceNode = data[0].onix.ProductSupply.SupplyDetail.Price[0];
                    if (priceNode && priceNode.PriceAmount) itemPrice = parseInt(priceNode.PriceAmount);
                } catch(e) {}
                checkAndAddToCart({ name: itemName, price: itemPrice, ageCheck: false, taxRate: 10, genre: '書籍' });
                return;
            }
        } catch (error) { console.log(error); }
    }

    openUnknownProdModal(code);
}

/* =========================================================
   未登録商品の保存（種類ジャンルの保存修正）
   ========================================================= */
function openUnknownProdModal(code) {
    const modal = document.getElementById('unknown-prod-modal');
    const janDisplay = document.getElementById('unknown-jan-display');
    if (janDisplay) janDisplay.innerText = `JAN: ${code}`;
    
    document.getElementById('unknown-prod-name-input').value = "";
    document.getElementById('unknown-prod-price-input').value = "";
    document.getElementById('unknown-prod-tax-input').value = "10";
    document.getElementById('unknown-prod-genre-input').value = "その他商品";
    document.getElementById('unknown-prod-age-check').checked = false;
    
    if (modal) {
        modal.dataset.code = code;
        modal.style.display = 'flex';
    }
}

function closeUnknownProdModal() {
    const modal = document.getElementById('unknown-prod-modal');
    if (modal) modal.style.display = 'none';
    focusJanInput();
}

function saveUnknownProd() {
    const modal = document.getElementById('unknown-prod-modal');
    const code = modal ? modal.dataset.code : '';
    const nameInput = document.getElementById('unknown-prod-name-input').value.trim() || '名無しの商品';
    const genreInput = document.getElementById('unknown-prod-genre-input').value || 'その他商品';
    const priceInput = parseInt(document.getElementById('unknown-prod-price-input').value);
    const taxInput = parseInt(document.getElementById('unknown-prod-tax-input').value) || 10;
    const ageCheckInput = document.getElementById('unknown-prod-age-check').checked;

    if (isNaN(priceInput) || priceInput < 0) {
        document.getElementById('unknown-prod-error').style.display = 'block';
        return;
    }
    document.getElementById('unknown-prod-error').style.display = 'none';

    // 商品リストに追加して保存（ジャンルを確実に保存）
    const newProd = {
        jan: code,
        name: nameInput,
        genre: genreInput,
        price: priceInput,
        taxRate: taxInput,
        ageCheck: ageCheckInput
    };

    products.push(newProd);
    localStorage.setItem('pos_products', JSON.stringify(products));

    closeUnknownProdModal();
    generateCustomButtons(); // ボタン更新
    checkAndAddToCart(newProd);
}

// 年齢確認モーダル関連
let ageCheckInterval = null;
function showAgeCheckModals() {
    const custScreen = document.getElementById('customer-screen');
    const isCustomer = custScreen && custScreen.classList.contains('active');
    
    const custModal = document.getElementById('customer-age-modal');
    const clerkModal = document.getElementById('clerk-age-modal');

    if (isCustomer) {
        if (custModal) custModal.style.display = 'flex';
        if (clerkModal) clerkModal.style.display = 'none';
    } else {
        if (clerkModal) clerkModal.style.display = 'flex';
        if (custModal) custModal.style.display = 'none';
    }

    if (!ageCheckInterval) {
        speak("年齢確認をお願いします。身分証明書の提示をお願いする場合がございます。");
        ageCheckInterval = setInterval(() => {
            speak("年齢確認をお願いします。身分証明書の提示をお願いする場合がございます。");
        }, 10000);
    }
}

// 「よく使う商品」をレジ画面の上の方に表示するための利用回数カウント
let productUsageSaveTimer = null;
function incrementProductUsageCount(prod) {
    if (!prod || !prod.jan || typeof products === 'undefined') return;
    const idx = products.findIndex(p => p.jan === prod.jan);
    if (idx === -1) return;
    products[idx].usageCount = (products[idx].usageCount || 0) + 1;

    // 連続スキャン時に何度も保存しないよう、少し待ってからまとめて保存する
    clearTimeout(productUsageSaveTimer);
    productUsageSaveTimer = setTimeout(() => {
        localStorage.setItem('pos_products', JSON.stringify(products));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }, 1500);
}

// 追加：商品名検索ボックスが入力されるたびに商品ボタン一覧を再描画する
function filterProductButtonsByName() {
    generateCustomButtons();
}

function checkAndAddToCart(prod) {
    incrementProductUsageCount(prod);
    if (prod.ageCheck && !ageVerifiedCurrentTransaction) {
        pendingAgeCheckItem = prod;
        showAgeCheckModals();
        if (channel) channel.publish('age-check-event', { action: 'start', item: prod, senderId: POS_DEVICE_ID });
    } else {
        addToCart(prod.name, prod.price, prod.taxRate, prod.genre);
    }
}

function handleAgeCheckResult(agreed) {
    if (agreed) {
        if (channel) channel.publish('age-check-event', { action: 'success', senderId: POS_DEVICE_ID });
        else onAgeCheckSuccess();
    } else {
        if (channel) channel.publish('age-check-event', { action: 'cancel', senderId: POS_DEVICE_ID });
        else onAgeCheckCancel();
    }
}

function onAgeCheckSuccess() {
    if (ageCheckInterval) { clearInterval(ageCheckInterval); ageCheckInterval = null; }
    document.getElementById('clerk-age-modal').style.display = 'none';
    document.getElementById('customer-age-modal').style.display = 'none';
    ageVerifiedCurrentTransaction = true;

    if (pendingAgeCheckItem) {
        addToCart(pendingAgeCheckItem.name, pendingAgeCheckItem.price, pendingAgeCheckItem.taxRate, pendingAgeCheckItem.genre);
        pendingAgeCheckItem = null;
    }
    showToastAnimation("成功しました");
    speak("確認できました。購入できます。");
    focusJanInput();
}

function onAgeCheckCancel() {
    if (ageCheckInterval) { clearInterval(ageCheckInterval); ageCheckInterval = null; }
    document.getElementById('clerk-age-modal').style.display = 'none';
    document.getElementById('customer-age-modal').style.display = 'none';
    pendingAgeCheckItem = null;
    playSound('error');
    speak("購入できません");
    showCustomConfirm("購入できません", "こうにゅう できません", () => { focusJanInput(); }, false);
}

function showToastAnimation(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-success';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2500);
}

function recordCartState() {
    cartHistory.push(JSON.parse(JSON.stringify(cart)));
    redoStack = []; 
}

function addToCart(name, price, taxRate = 10, genre = 'その他商品') {
    recordCartState();
    if (cart.length === 1 && cartHistory.length === 0 && !activeCustomer) { speak("いらっしゃいませ"); }

    // この会計がすでに免税になっている場合、新しく追加する商品にも自動的に免税を適用する
    let finalPrice = price;
    let finalTaxRate = taxRate;
    let originalTaxRate = undefined;
    let isTaxExemptItem = false;
    if (typeof taxExemptTransaction !== 'undefined' && taxExemptTransaction && taxRate > 0) {
        finalPrice = computeTaxExemptPrice(price, taxRate);
        originalTaxRate = taxRate;
        finalTaxRate = 0;
        isTaxExemptItem = true;
    }

    const existingItem = cart.find(item => item.name === name && item.price === finalPrice && item.taxRate === finalTaxRate);
    
    const speakName = (name === '名無しの商品') ? 'ななしのしょうひん' : name;

    if (existingItem) {
        existingItem.qty += 1;
        speak("どういつ しょうひん です");
    } else {
        const newItem = { name: name, price: finalPrice, qty: 1, taxRate: finalTaxRate, genre: genre };
        if (isTaxExemptItem) {
            newItem.taxExempt = true;
            newItem.originalTaxRate = originalTaxRate;
        }
        cart.push(newItem);
        speak(`${speakName}、 ${finalPrice} えん です`);
    }
    updateReceipt();
}

function applyMultiplyQuantity() {
    if (cart.length === 0) {
        playSound('error');
        showCustomConfirm("先に商品をカートに入れてください。", "さき に しょうひん を かーと に いれ て ください。", () => { focusJanInput(); }, true);
        return;
    }
    const input = getJanInput();
    const inputValue = input ? parseInt(input.value) : NaN;
    if (isNaN(inputValue) || inputValue <= 0) {
        playSound('error');
        showCustomConfirm("掛けたい個数を先に入力してください。", "かけたい こすう を さき に にゅうりょく し て ください。", () => { focusJanInput(); }, true);
        return;
    }

    recordCartState();
    playSound('click');
    const lastItem = cart[cart.length - 1];
    lastItem.qty = inputValue;
    if (input) input.value = "";
    updateReceipt();
    speak(`すうりょう、 ${inputValue} こ に へんこう し まし た`);
    focusJanInput();
}

function applyHalfPrice() {
    if (cart.length === 0) {
        playSound('error');
        showCustomConfirm("先に商品をカートに入れてください。", "さき に しょうひん を かーと に いれ て ください。", () => { focusJanInput(); }, true);
        return;
    }
    
    recordCartState();
    playSound('click');
    
    const lastItem = cart[cart.length - 1];
    const discountAmount = Math.floor((lastItem.price * lastItem.qty) / 2);
    
    if (discountAmount <= 0) {
        focusJanInput();
        return;
    }

    cart.push({ name: `半額 (${lastItem.name})`, price: -discountAmount, qty: 1, taxRate: lastItem.taxRate, genre: '値引き/その他' });
    speak("はんがく が てきよう さ れ まし た");
    updateReceipt();
    focusJanInput();
}

let selectedCartIndex = -1;

function updateReceipt() {
    const receiptBody = getReceiptBody();
    const displayTotal = getDisplayTotal();
    if (!receiptBody) return;
    receiptBody.innerHTML = '';
    
    currentTotal = 0;
    let total8 = 0; 
    let total10 = 0; 
    let total0 = 0;
    let totalQty = 0;

    cart.forEach((item, idx) => {
        const subTotal = item.price * item.qty;
        currentTotal += subTotal;
        totalQty += item.qty;

        if (item.taxRate === 8) {
            total8 += subTotal;
        } else if (item.taxRate === 0) {
            total0 += subTotal;
        } else {
            total10 += subTotal;
        }

        const div = document.createElement('div');
        div.className = 'receipt-item' + (selectedCartIndex === idx ? ' selected' : '');
        div.style.cursor = 'pointer';
        
        div.onclick = () => {
            selectedCartIndex = (selectedCartIndex === idx) ? -1 : idx;
            updateReceipt();
        };

        const taxMark = item.taxRate === 8 ? ' ※' : (item.taxRate === 0 ? ' 免' : '');
        const safeItemName = (typeof escapeHtml === 'function') ? escapeHtml(item.name) : item.name;
        div.innerHTML = `<span>${safeItemName}${item.qty > 1 ? ' x'+item.qty : ''}</span> <span>¥${subTotal.toLocaleString()}${taxMark}</span>`;
        receiptBody.appendChild(div);
    });

    const tax8 = Math.floor(total8 * 8 / 108);
    const excl8 = total8 - tax8;
    const tax10 = Math.floor(total10 * 10 / 110);
    const excl10 = total10 - tax10;

    if (cart.length > 0) {
        const summaryDiv = document.createElement('div');
        summaryDiv.style.marginTop = '10px';
        summaryDiv.style.borderTop = '1px dashed #ccc';
        summaryDiv.style.paddingTop = '10px';
        summaryDiv.style.fontSize = '12px';
        summaryDiv.style.color = '#555';
        
        let summaryHTML = '';
        if (total8 !== 0) {
            summaryHTML += `<div style="display:flex; justify-content:space-between;"><span>小計(税抜8%)</span><span>¥${excl8.toLocaleString()}</span></div>`;
            summaryHTML += `<div style="display:flex; justify-content:space-between;"><span>消費税等(8%)</span><span>¥${tax8.toLocaleString()}</span></div>`;
        }
        if (total10 !== 0) {
            summaryHTML += `<div style="display:flex; justify-content:space-between; margin-top:2px;"><span>消費税等(税抜10%)</span><span>¥${excl10.toLocaleString()}</span></div>`;
        }
        if (total0 !== 0) {
            summaryHTML += `<div style="display:flex; justify-content:space-between; margin-top:2px; color:#00838f;"><span>免税対象</span><span>¥${total0.toLocaleString()}</span></div>`;
        }
        if (total8 !== 0) {
            summaryHTML += `<div style="text-align:right; font-size:10px; margin-top:4px;">(※は軽減税率8%対象 / 免は免税対象)</div>`;
        }
        
        summaryHTML += `<div style="display:flex; justify-content:space-between; margin-top:8px; font-weight:bold; font-size:14px; color:#333;"><span>スキャン点数:</span><span>${totalQty} 点</span></div>`;
        
        summaryDiv.innerHTML = summaryHTML;
        receiptBody.appendChild(summaryDiv);
    }

    receiptBody.scrollTop = receiptBody.scrollHeight;
    if (displayTotal) displayTotal.innerText = `¥${currentTotal.toLocaleString()}`;
    billingAmount = currentTotal;
    updateCustomerDisplay();
    broadcastState();
}

function removeSelectedOrInputItem() {
    const input = getJanInput();
    const code = input ? input.value.trim() : "";

    if (cart.length === 0) {
        playSound('error');
        speak("とりけす しょうひん が あり ませ ん");
        showCustomConfirm("取り消す商品がありません。", "とりけす しょうひん が あり ませ ん。", () => { focusJanInput(); }, true);
        return;
    }

    if (code) {
        const foundProd = products.find(p => p.jan === code || p.name === code);
        const targetName = foundProd ? foundProd.name : code;
        const index = cart.findLastIndex(item => item.name === targetName || item.name.includes(targetName));

        if (index !== -1) {
            recordCartState();
            playSound('click');
            const targetItem = cart[index];
            if (targetItem.qty > 1) {
                targetItem.qty -= 1;
            } else {
                cart.splice(index, 1);
            }
            if (input) input.value = "";
            selectedCartIndex = -1;
            updateReceipt();
            speak(`${targetItem.name} を とりけし まし た`);
            focusJanInput();
            return;
        } else {
            playSound('error');
            showCustomConfirm("カート内に該当する商品が見つかりません。", "かーと ない に がいとう する しょうひん が みつかり ませ ん。", () => { focusJanInput(); }, true);
            if (input) input.value = "";
            focusJanInput();
            return;
        }
    }

    if (selectedCartIndex !== -1 && cart[selectedCartIndex]) {
        recordCartState();
        playSound('click');
        const targetItem = cart[selectedCartIndex];
        if (targetItem.qty > 1) {
            targetItem.qty -= 1;
        } else {
            cart.splice(selectedCartIndex, 1);
            selectedCartIndex = -1;
        }
        updateReceipt();
        speak(`${targetItem.name} を とりけし まし た`);
        focusJanInput();
        return;
    }

    playSound('error');
    speak("ばーこーど を すきゃん する か しょうひん を せんたく して ください");
    showCustomConfirm("バーコードをスキャンするか、レシートの商品を選択してください。", "ばーこーど を すきゃん する か しょうひん を せんたく して ください。", () => { focusJanInput(); }, true);
    focusJanInput();
}

function removeLastItem() {
    if (cart.length === 0) {
        playSound('error');
        speak("とりけす しょうひん が あり ませ ん");
        showCustomConfirm("取り消す商品がありません。", "とりけす しょうひん が あり ませ ん。", () => { focusJanInput(); }, true);
        return;
    }

    recordCartState();
    playSound('click');
    const lastItem = cart[cart.length - 1];
    if (lastItem.qty > 1) {
        lastItem.qty -= 1;
    } else {
        cart.pop();
    }

    selectedCartIndex = -1;
    updateReceipt();
    const speakLastName = (lastItem.name === '名無しの商品') ? 'ななしのしょうひん' : lastItem.name;
    speak(`${speakLastName} を とりけし まし た`);
    focusJanInput();
}

function applyDynamicDiscount(type) {
    const input = getJanInput();
    if (cart.length === 0) { 
        playSound('error'); 
        showCustomConfirm("先に商品をカートに入れてください。", "さき に しょうひん を かーと に 入れ て ください。", () => { focusJanInput(); }, true); 
        return; 
    }
    const inputValue = input ? parseInt(input.value) : NaN;
    if (isNaN(inputValue) || inputValue <= 0) {
        playSound('error'); 
        showCustomConfirm("値引きする数値を先に入力してください。", "ねびき する すうち を さき に にゅうりょく し て ください。", () => { focusJanInput(); }, true); 
        return;
    }

    recordCartState();
    playSound('click');
    let discountName = "";
    let discountNameHira = "";
    let discountAmount = 0;

    if (type === 'percent') {
        discountAmount = Math.floor(currentTotal * (inputValue / 100));
        discountName = `${inputValue}% 値引`;
        discountNameHira = `${inputValue}ぱーせんと ねびき`;
    } else if (type === 'yen') {
        discountAmount = inputValue;
        discountName = `${inputValue}円 値引`;
        discountNameHira = `${inputValue}えん ねびき`;
    }

    if (currentTotal - discountAmount < 0) {
        playSound('error');
        showCustomConfirm("値引き額が合計金額を超えているため適用できません。", "ねびきがく が ごうけいきんがく を こえ て いる ため てきよう でき ませ ん。", () => { focusJanInput(); }, true);
        if (input) { input.value = ""; }
        focusJanInput();
        return;
    }

    cart.push({ name: discountName, price: -discountAmount, qty: 1, taxRate: 10, genre: '値引き/その他' });
    speak(`${discountNameHira} が てきよう さ れ まし た`); 
    if (input) { input.value = ""; }
    focusJanInput();
    updateReceipt();
}

function clearCart() {
    if (cart.length === 0 && !activeCustomer) return;
    playSound('error');
    showCustomConfirm("カートと会員情報をクリアにしますか？", "かーと と かいいん じょうほう を クリア に し ます か？", (res) => {
        if (!res) {
            focusJanInput();
            return;
        }
        recordCartState();
        cart = []; currentDeposit = 0; currentChange = 0; usedPoints = 0; billingAmount = 0; lastScannedBarcode = "";
        selectedPayment = '現金';
        taxExemptTransaction = false;
        clearCustomer(false);
        updateReceipt(); 
        speak("クリア に し まし た"); 
        focusJanInput();
    }, true);
}

function clearCustomer(playSnd = true) {
    if(playSnd) playSound('click');
    activeCustomer = null;
    customerDisplayMemberInfo = null;
    usedPoints = 0;
    const acDisplay = document.getElementById('active-customer-display');
    if (acDisplay) acDisplay.style.display = 'none';
    const rankBadgeEl = document.getElementById('ac-rank-badge');
    const rankNavEl = document.getElementById('ac-rank-nav');
    if (rankBadgeEl) { rankBadgeEl.innerText = ''; rankBadgeEl.style.background = ''; }
    if (rankNavEl) rankNavEl.innerText = '';
    if (typeof updateCustomerDisplay === 'function') updateCustomerDisplay();
    if (typeof broadcastState === 'function') broadcastState();
    focusJanInput();
}

// お会計・決済関連
function openCheckout() {
    if (cart.length === 0 || currentTotal <= 0) { 
        playSound('error'); 
        showCustomConfirm("商品が選択されていないか、金額が0円以下です。", "しょうひん が せんたく さ れ て い ない か、 きんがく が ぜろえん いか です。", () => { focusJanInput(); }, true);
        return; 
    }
    playSound('click');
    
    usedPoints = 0;
    billingAmount = currentTotal;
    earnedPointsThisTime = 0;

    const modal = document.getElementById('checkout-modal');
    if (modal) modal.style.display = 'flex';

    const somePointsInput = document.getElementById('some-points-input');
    if (somePointsInput) somePointsInput.value = "";

    const stepPoints = document.getElementById('checkout-step-points');
    const stepPay = document.getElementById('checkout-step-pay');
    const somePointsArea = document.getElementById('some-points-input-area');

    if (activeCustomer && activeCustomer.points > 0) {
        const exp = checkPointExpiry(activeCustomer);
        if (exp.expiringSoon) {
            speak(`まもなく、${activeCustomer.points} ポイントが失効します。ポイント を ごりよう に なり ます か？`);
        } else {
            speak("ポイント を ごりよう に なり ます か？");
        }
        const availPtsEl = document.getElementById('modal-avail-points');
        if (availPtsEl) availPtsEl.innerText = activeCustomer.points;

        if (stepPoints) stepPoints.style.display = 'block';
        if (stepPay) stepPay.style.display = 'none';
        if (somePointsArea) somePointsArea.style.display = 'none';
    } else {
        proceedToPayment();
    }
}

function useAllPoints() {
    playSound('click');
    usedPoints = Math.min(activeCustomer.points, currentTotal);
    billingAmount = currentTotal - usedPoints;
    
    if (billingAmount === 0) {
        const modal = document.getElementById('checkout-modal');
        if (modal) modal.style.display = 'none';
        selectedPayment = '全額ポイント';
        currentDeposit = 0;
        currentChange = 0;
        completeTransaction();
    } else {
        proceedToPayment();
    }
}

function showSomePointsInput() {
    playSound('click');
    const area = document.getElementById('some-points-input-area');
    if (area) area.style.display = 'block';
    const input = document.getElementById('some-points-input');
    if (input) input.focus();
}

function useSomePoints() {
    const input = document.getElementById('some-points-input');
    let p = input ? parseInt(input.value) : NaN;
    if (isNaN(p) || p <= 0) {
        playSound('error');
        return;
    }
    playSound('click');
    
    if (p > activeCustomer.points) p = activeCustomer.points;
    if (p > currentTotal) p = currentTotal;
    
    usedPoints = p;
    proceedToPayment();
}

function proceedToPayment() {
    billingAmount = currentTotal - usedPoints;
    
    const stepPoints = document.getElementById('checkout-step-points');
    const stepPay = document.getElementById('checkout-step-pay');
    if (stepPoints) stepPoints.style.display = 'none';
    if (stepPay) stepPay.style.display = 'block';
    
    let displayHtml = `ご請求: ¥${billingAmount.toLocaleString()}`;
    if (usedPoints > 0) {
        displayHtml = `<div style="font-size:16px; color:#999; text-decoration:line-through; margin-bottom:5px;">¥${currentTotal.toLocaleString()}</div>` +
                      `<div style="font-size:18px; color:#e91e63; margin-bottom:5px;">- ${usedPoints} pt 利用</div>` +
                      `<div>ご請求: ¥${billingAmount.toLocaleString()}</div>`;
    }
    const modalTotal = document.getElementById('modal-total');
    if (modalTotal) modalTotal.innerHTML = displayHtml;
    
    selectPayMethod('現金');
    const depositInput = document.getElementById('deposit-input');
    if (depositInput) {
        depositInput.value = "";
        depositInput.focus();
    }
    calculateChange();
    
    if (billingAmount === 0) {
        speak("ポイント で の おしはらい です ね。");
    } else {
        speak(`ごせいきゅう、 ${billingAmount} えん です`); 
    }
}

function closeCheckout() { 
    playSound('click'); 
    const modal = document.getElementById('checkout-modal');
    if (modal) modal.style.display = 'none'; 
    selectedPayment = '現金';
    currentDeposit = 0;
    currentChange = 0;
    updateCustomerDisplay();
    focusJanInput(); 
}

function selectPayMethod(method) {
    playSound('click'); 
    selectedPayment = method;
    document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('selected'));
    
    const cashInputArea = document.getElementById('cash-input-area');
    const btnCash = document.getElementById('btn-cash');
    const btnCredit = document.getElementById('btn-credit');
    const btnQr = document.getElementById('btn-qr');

    if (method === '現金') {
        if (btnCash) btnCash.classList.add('selected');
        if (cashInputArea) cashInputArea.style.display = 'block';
        const depositInput = document.getElementById('deposit-input');
        if (depositInput) {
            depositInput.value = "";
            depositInput.focus();
        }
        calculateChange();
        if (billingAmount > 0) speak("げんきん");
    } else {
        if (method === 'クレジット') { 
            if (btnCredit) btnCredit.classList.add('selected'); 
            if (billingAmount > 0) speak("くれじっと"); 
        }
        if (method === 'QR決済') { 
            if (btnQr) btnQr.classList.add('selected'); 
            if (billingAmount > 0) speak("きゅーあーる けっさい"); 
        }
        if (cashInputArea) cashInputArea.style.display = 'none';
        currentDeposit = billingAmount;
        currentChange = 0;
        calculateChange();
    }
    updateCustomerDisplay();
    broadcastState();
}

function addDepositPreset(amount) {
    playSound('click');
    const input = document.getElementById('deposit-input');
    if (!input) return;
    let currentVal = parseInt(input.value) || 0;
    input.value = currentVal + amount;
    calculateChange();
}

function setExactDeposit() {
    playSound('click');
    const input = document.getElementById('deposit-input');
    if (input) input.value = billingAmount;
    calculateChange();
}

function clearDeposit() {
    playSound('click');
    const input = document.getElementById('deposit-input');
    if (input) input.value = "";
    calculateChange();
}

function calculateChange() {
    const input = document.getElementById('deposit-input');
    const depositVal = input ? parseInt(input.value) : NaN;
    currentDeposit = isNaN(depositVal) ? 0 : depositVal;
    
    if (selectedPayment === '現金') {
        currentChange = currentDeposit - billingAmount;
        if (currentChange < 0) currentChange = 0;
    } else {
        currentDeposit = billingAmount;
        currentChange = 0;
    }

    const changeBox = document.getElementById('change-display-box');
    if (changeBox) changeBox.innerText = `お釣り: ¥${currentChange.toLocaleString()}`;
    broadcastState();
}

async function completeTransaction() {
    if (isSubmitting) return;

    isSubmitting = true;

    try {
        if (billingAmount > 0 && selectedPayment === '現金' && currentDeposit < billingAmount) {
            playSound('error');
            showCustomConfirm("お預かり金額がご請求金額よりも不足しています。", "おあずかり きんがく が ごせいきゅうきんがく よりも ふそく し て い ます。", () => {}, true);
            return; 
        }

        playSound('success'); 

        if (activeCustomer) {
            const rewardRate = (typeof addPurchaseAndGetRewardRate === 'function')
                ? addPurchaseAndGetRewardRate(activeCustomer, billingAmount)
                : 1.0;
            earnedPointsThisTime = Math.floor(billingAmount * rewardRate / 100);
            activeCustomer.points -= usedPoints;
            activeCustomer.points += earnedPointsThisTime;
            activeCustomer.pointsUpdatedAt = new Date().toISOString();
            
            const idx = customers.findIndex(c => c.barcode === activeCustomer.barcode);
            if (idx !== -1) {
                customers[idx] = activeCustomer;
                localStorage.setItem('pos_customers', JSON.stringify(customers));
            }
        }

        if (billingAmount === 0 && usedPoints > 0) {
            speak(`ポイント にて、 ぜんがく おしはらい いただき まし た。 ありがとう ござい まし た`);
        } else {
            let msg = `おかいけい ごうけい、 ${billingAmount} えん です。 おつり、 ${currentChange} えん です。`;
            if (earnedPointsThisTime > 0) {
                msg += `${earnedPointsThisTime} ポイントふよ さ れ まし た。`;
            }
            msg += `ありがとう ござい まし た`;
            speak(msg);
        }

        let histItems = cart.map(i => `${i.name}(${i.qty})`).join(",");
        let ptInfo = [];
        if (usedPoints > 0) ptInfo.push(`-${usedPoints}pt`);
        if (earnedPointsThisTime > 0) ptInfo.push(`+${earnedPointsThisTime}pt`);
        if (ptInfo.length > 0) histItems += ` [${ptInfo.join(", ")}]`;
        
        if (activeCustomer) {
            const custDisplayName = activeCustomer.name || `${activeCustomer.lastName || ''} ${activeCustomer.firstName || ''}`;
            histItems += ` (${custDisplayName}様)`;
        }

        const record = {
            id: Date.now(), 
            date: new Date().toLocaleString(), 
            dateISO: new Date().toISOString(), // 分析機能（日別/週別/月別集計）向けの正確な日時
            clerk: activeClerkName,
            total: billingAmount,
            deposit: currentDeposit, 
            change: currentChange, 
            payment: usedPoints > 0 && billingAmount === 0 ? '全額ポイント' : selectedPayment, 
            items: histItems,
            // 分析機能向け：商品ごとの売上集計に使う構造化データ
            cartSnapshot: JSON.parse(JSON.stringify(cart)),
            // 分析機能向け：会員（ポイントカード）の年齢層集計に使う
            customerBarcode: activeCustomer ? activeCustomer.barcode : null,
            customerAge: (activeCustomer && typeof calculateAge === 'function') ? calculateAge(activeCustomer) : null
        };
        let historyList = JSON.parse(localStorage.getItem('pos_history')) || [];
        historyList.unshift(record); 
        // 分析機能（週別・月別集計）が実用的に使えるよう、保存件数の上限を拡大
        if (historyList.length > 3000) { historyList = historyList.slice(0, 3000); }
        localStorage.setItem('pos_history', JSON.stringify(historyList));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

        // 使い切りバーコード（自動化バーコード）を、会計成立と同時に自動削除する
        if (typeof cleanupOneTimeDiscountBarcodes === 'function') cleanupOneTimeDiscountBarcodes();

        closeCheckout();
        promptReceiptAndInvoice();
    } finally {
        isSubmitting = false; 
    }
}

function promptReceiptAndInvoice() {
    showCustomConfirm(
        "領収書を発行しますか？",
        " りょうしゅうしょを はっこう し ます か？ありがとうございました。",
        (res) => {
            if (res) {
                const nameInput = document.getElementById('invoice-client-name-input');
                if (nameInput) {
                    nameInput.value = activeCustomer ? (activeCustomer.name || "") : "";
                    nameInput.focus();
                }
                const modal = document.getElementById('invoice-modal');
                if (modal) modal.style.display = 'flex';
                speak("あてな を にゅうりょく し て ください");
            } else {
                generateReceiptHTML(false);
            }
        },
        true
    );
}

function closeInvoiceModal() {
    playSound('click');
    const modal = document.getElementById('invoice-modal');
    if (modal) modal.style.display = 'none';
    generateReceiptHTML(false);
}

function generateReceiptAndInvoice() {
    playSound('click');
    const nameInput = document.getElementById('invoice-client-name-input');
    const clientName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : "上様";
    const modal = document.getElementById('invoice-modal');
    if (modal) modal.style.display = 'none';
    generateReceiptHTML(true, clientName);
}

function generateReceiptHTML(includeInvoice = false, clientName = "上様") {
    const content = document.getElementById('print-receipt-content');
    if (!content) return;

    let total8 = 0; 
    let total10 = 0; 
    let total0 = 0;
    let totalQty = 0;

    let html = `
        <div style="text-align: center; font-weight: bold; margin-bottom: 8px;">【 お会計レシート 】</div>
        <div>日時: ${new Date().toLocaleString()}</div>
        <div>担当: ${escapeHtml(activeClerkName)}</div>
        <div>支払: ${usedPoints > 0 && billingAmount === 0 ? 'ポイント' : escapeHtml(selectedPayment)}</div>
    `;
    
    if (activeCustomer) {
        const custDisplayName = activeCustomer.name || `${activeCustomer.lastName || ''} ${activeCustomer.firstName || ''}`;
        html += `<div style="margin-top:4px;">会員: ${escapeHtml(custDisplayName)} 様</div>`;
    }

    html += `<div style="border-bottom: 1px dashed #333; margin: 6px 0;"></div>`;

    cart.forEach(item => {
        const subTotal = item.price * item.qty;
        totalQty += item.qty;
        if (item.taxRate === 8) {
            total8 += subTotal;
        } else if (item.taxRate === 0) {
            total0 += subTotal;
        } else {
            total10 += subTotal;
        }
        
        const taxMark = item.taxRate === 8 ? ' ※' : (item.taxRate === 0 ? ' 免' : '');
        html += `<div style="display: flex; justify-content: space-between;"><span>${escapeHtml(item.name)} x${item.qty}</span><span>¥${subTotal.toLocaleString()}${taxMark}</span></div>`;
    });

    const tax8 = Math.floor(total8 * 8 / 108);
    const excl8 = total8 - tax8;
    const tax10 = Math.floor(total10 * 10 / 110);
    const excl10 = total10 - tax10;

    html += `<div style="border-bottom: 1px dashed #333; margin: 6px 0;"></div>`;

    if (total8 !== 0) {
        html += `<div style="display: flex; justify-content: space-between;"><span>小計(税抜8%)</span><span>¥${excl8.toLocaleString()}</span></div>`;
        html += `<div style="display: flex; justify-content: space-between;"><span>消費税等(8%)</span><span>¥${tax8.toLocaleString()}</span></div>`;
    }
    if (total10 !== 0) {
        html += `<div style="display: flex; justify-content: space-between;"><span>小計(税抜10%)</span><span>¥${excl10.toLocaleString()}</span></div>`;
        html += `<div style="display: flex; justify-content: space-between;"><span>消費税等(10%)</span><span>¥${tax10.toLocaleString()}</span></div>`;
    }
    if (total0 !== 0) {
        html += `<div style="display: flex; justify-content: space-between; color:#00838f;"><span>免税対象</span><span>¥${total0.toLocaleString()}</span></div>`;
    }

    if (usedPoints > 0) {
        html += `<div style="display: flex; justify-content: space-between; color: #d81b60; margin-top: 4px;"><span>ポイント利用:</span><span>-¥${usedPoints.toLocaleString()}</span></div>`;
    }

    html += `
        <div style="border-bottom: 1px dashed #333; margin: 6px 0;"></div>
        <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 20px; margin: 8px 0;"><span>合 計:</span><span>¥${billingAmount.toLocaleString()}</span></div>
        <div style="display: flex; justify-content: space-between;"><span>お預かり:</span><span>¥${currentDeposit.toLocaleString()}</span></div>
        <div style="display: flex; justify-content: space-between;"><span>お釣り:</span><span>¥${currentChange.toLocaleString()}</span></div>
    `;

    html += `<div style="border-bottom: 1px dashed #333; margin: 6px 0;"></div>`;
    
    if (total8 !== 0) {
        html += `<div style="display: flex; justify-content: space-between; font-size:12px;"><span>8%対象</span><span>¥${total8.toLocaleString()}</span></div>`;
        html += `<div style="display: flex; justify-content: space-between; font-size:12px; color:#555;"><span>(内消費税等</span><span>¥${tax8.toLocaleString()})</span></div>`;
    }
    if (total10 !== 0) {
        html += `<div style="display: flex; justify-content: space-between; font-size:12px; margin-top:2px;"><span>10%対象</span><span>¥${total10.toLocaleString()}</span></div>`;
        html += `<div style="display: flex; justify-content: space-between; font-size:12px; color:#555;"><span>(内消費税等</span><span>¥${tax10.toLocaleString()})</span></div>`;
    }
    if (total0 !== 0) {
        html += `<div style="display: flex; justify-content: space-between; font-size:12px; margin-top:2px; color:#00838f;"><span>免税対象</span><span>¥${total0.toLocaleString()}</span></div>`;
    }
    
    if (total8 !== 0 || total0 !== 0) {
        html += `<div style="text-align:right; font-size:10px; margin-top:4px;">(※は軽減税率8%対象 / 免は免税対象)</div>`;
    }

    html += `<div style="display: flex; justify-content: space-between; font-weight: bold; margin-top: 6px; font-size: 14px;"><span>スキャン点数:</span><span>${totalQty} 点</span></div>`;

    if (activeCustomer) {
        if (earnedPointsThisTime > 0) {
            html += `
            <div style="border-bottom: 1px dashed #333; margin: 6px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-size:12px; color:#2e7d32; font-weight:bold;"><span>今回獲得ポイント:</span><span>+${earnedPointsThisTime} pt</span></div>
            `;
        }
        html += `
        <div style="border-bottom: 1px dashed #333; margin: 6px 0;"></div>
        <div style="display: flex; justify-content: space-between; font-size:12px;"><span>累計ポイント残高:</span><span>${activeCustomer.points} pt</span></div>
        `;

        if (typeof getCustomerRankInfo === 'function') {
            const rankInfo = getCustomerRankInfo(activeCustomer);
            html += `<div style="display: flex; justify-content: space-between; font-size:12px; font-weight:bold; color:${rankInfo.color};"><span>会員ランク:</span><span>${rankInfo.name}</span></div>`;
            if (typeof buildRankNavText === 'function') {
                html += `<div style="font-size:11px; color:#555; margin-top:2px;">${buildRankNavText(activeCustomer)}</div>`;
            }
        }
    }

    html += `<div style="text-align: center; margin-top: 15px; font-weight: bold;">ありがとうございました！</div>`;
html += `<div style="text-align: center; margin-top: 15px; font-weight: bold;">返品は7日以内にお願いします。</div>`;

    if (includeInvoice) {
        html += `
            <div style="border-top: 2px dashed #666; margin: 25px 0 15px 0; padding-top: 15px;"></div>
            <div style="text-align: center; font-weight: bold; font-size: 16px; margin-bottom: 8px;">【 領 収 書 】</div>
            <div style="font-size: 14px; font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #333; padding-bottom: 4px;">${escapeHtml(clientName)} 様</div>
            <div style="font-size: 18px; font-weight: bold; margin: 10px 0; text-align: center;">金額: ¥${billingAmount.toLocaleString()} -</div>
            <div style="font-size: 12px; margin-bottom: 8px;">但し: お品代として</div>
            <div style="font-size: 11px; color: #555; margin-bottom: 10px;">
                <div>発行日: ${new Date().toLocaleDateString()}</div>
                <div>発行元: ハイテク音声レジスター</div>
            </div>
            <div style="border-bottom: 1px dashed #333; margin: 6px 0;"></div>
            <div style="font-size: 11px; color: #444;">
                内訳:<br>
        `;
        cart.forEach(item => {
            html += `・${escapeHtml(item.name)} x${item.qty} (¥${(item.price * item.qty).toLocaleString()})<br>`;
        });
        html += `</div>`;
    }

    content.innerHTML = html;
    const printModal = document.getElementById('receipt-print-modal');
    if (printModal) printModal.style.display = 'flex';

    // レシートが発行されたタイミングで、客用画面に設定された画像をアニメーション表示する
    if (typeof triggerCheckoutCompleteImage === 'function') triggerCheckoutCompleteImage();
}

function closeReceiptPrintModal() {
    playSound('click');
    const printModal = document.getElementById('receipt-print-modal');
    if (printModal) printModal.style.display = 'none';
    
    cart = []; currentDeposit = 0; currentChange = 0;
    usedPoints = 0; billingAmount = 0; earnedPointsThisTime = 0; lastScannedBarcode = "";
    cartHistory = []; redoStack = [];
    selectedPayment = '現金';
    
    ageVerifiedCurrentTransaction = false;
    taxExemptTransaction = false;

    clearCustomer(false);
    updateReceipt();
    updateCustomerDisplay();
    focusJanInput();
}

/* =========================================================
   指定フォルダへの画像（PNG）レシート直接保存修正
   ========================================================= */
async function saveReceiptAsImage() {
    const target = document.getElementById('receipt-capture-area') || document.getElementById('print-receipt-content');
    
    try {
        const canvas = await html2canvas(target, { scale: 2, useCORS: true });
        const now = new Date();
        const timeStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const fileName = `レシート_${timeStr}_${now.getTime()}.png`;

        // フォルダハンドルがあり権限がある場合はフォルダ内に直接保存
        let dirHandle = typeof receiptDirectoryHandle !== 'undefined' ? receiptDirectoryHandle : null;
        if (!dirHandle && typeof savedDirectoryHandle !== 'undefined') dirHandle = savedDirectoryHandle;

        if (dirHandle) {
            try {
                const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
                if (perm === 'granted') {
                    // canvasをBlob化して直接ファイル生成
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();

                    if (typeof playSound === 'function') playSound('success');
                    if (typeof speak === 'function') speak("レシート フォルダ に ほぞんし まし た");
                    closeReceiptPrintModal();
                    return;
                }
            } catch (err) {
                console.log("フォルダへの直接書き込みに失敗しました。通常のダウンロードを行います", err);
            }
        }

        // フォルダが未選択、または書き込み失敗時は標準ダウンロード
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/png');
        link.click();

        if (typeof playSound === 'function') playSound('success');
        if (typeof speak === 'function') speak("画像 を ほぞangし まし た");
        closeReceiptPrintModal();

    } catch (err) {
        console.error("PNG保存エラー:", err);
        if (typeof playSound === 'function') playSound('error');
    }
}

async function saveReceiptAsText() {
    playSound('click');

    let dirHandle = typeof receiptDirectoryHandle !== 'undefined' ? receiptDirectoryHandle : null;
    if (!dirHandle && typeof savedDirectoryHandle !== 'undefined') {
        try {
            const perm = await savedDirectoryHandle.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') dirHandle = savedDirectoryHandle;
        } catch (err) { console.log(err); }
    }

    const content = document.getElementById('print-receipt-content');
    let rawText = content ? (content.innerText || content.textContent) : "";
    
    receiptText += "================================\n";
    receiptText += "      ハイテク音声レジスター     \n";
    receiptText += "================================\n";
    receiptText += rawText + "\n";
    receiptText += "================================\n";
    receiptText += "   返品は7日以内にお願いします。  \n";  // ← この行を追加
    receiptText += "================================\n";

    const fileName = `receipt_${Date.now()}.txt`;
    const blob = new Blob([receiptText], { type: 'text/plain;charset=utf-8' });

    try {
        if (dirHandle) {
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            playSound('success');
            closeReceiptPrintModal();
            return;
        }

        const link = document.createElement('a');
        link.download = fileName;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);

        playSound('success');
    } catch (err) {
        console.error(err);
        playSound('error');
    } finally {
        closeReceiptPrintModal();
    }
}

function skipPoints() {
    playSound('click');
    usedPoints = 0;
    proceedToPayment();
}

// キーボードショートカット
document.addEventListener('keydown', (e) => {
    const regScreen = document.getElementById('register-screen');
    if (!regScreen || !regScreen.classList.contains('active')) return;

    const isModalOpen = Array.from(document.querySelectorAll('.modal, .modal-overlay')).some(m => {
        return window.getComputedStyle(m).display !== 'none';
    });
    if (isModalOpen) return;

    if (e.key === '+' || (e.key === 'Enter' && getJanInput() && getJanInput().value === '')) {
        e.preventDefault();
        if (typeof openCheckout === 'function') openCheckout();
    }

    if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof clearCart === 'function') clearCart();
    }
});