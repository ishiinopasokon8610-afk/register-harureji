// ==========================================
// ハイテク音声レジスター - 顧客・担当者・商品マスタ管理用JavaScript
// ==========================================

// ------------------------------------------
// 商品の種類（カテゴリ）をユーザーが自由に追加・削除する機能
// ------------------------------------------
function addCustomGenre() {
    const input = document.getElementById('new-genre-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        playSound('error');
        return;
    }
    if (getAllGenres().includes(name)) {
        showCustomConfirm('その種類はすでに存在します。', 'その しゅるい は すでに そんざい し ます。', () => {}, false);
        return;
    }
    customGenres.push(name);
    localStorage.setItem('pos_custom_genres', JSON.stringify(customGenres));
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

    input.value = '';
    playSound('success');
    populateGenreSelects();
    if (typeof renderGenreFilterButtons === 'function') renderGenreFilterButtons();
    renderCustomGenreList();
    speak('あたらしい しゅるいを ついか し まし た');
}

function deleteCustomGenre(name) {
    showCustomConfirm(`「${name}」を削除しますか？（この種類が設定済みの商品はそのまま残ります）`, `さくじょ し ます か？`, (res) => {
        if (!res) return;
        customGenres = customGenres.filter(g => g !== name);
        localStorage.setItem('pos_custom_genres', JSON.stringify(customGenres));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

        populateGenreSelects();
        if (typeof renderGenreFilterButtons === 'function') renderGenreFilterButtons();
        renderCustomGenreList();
        playSound('click');
    }, true);
}

function renderCustomGenreList() {
    const container = document.getElementById('custom-genre-list');
    if (!container) return;
    if (!customGenres || customGenres.length === 0) {
        container.innerHTML = '<span style="color:#999; font-size:13px;">まだ追加した種類はありません</span>';
        return;
    }
    container.innerHTML = customGenres.map(g =>
        `<span class="custom-genre-chip">${escapeHtml(g)} <button type="button" onclick="deleteCustomGenre('${g.replace(/'/g, "\\'")}')" aria-label="削除">×</button></span>`
    ).join('');
}

// 商品追加・編集画面などにある「種類」プルダウンをすべて最新の一覧で再描画する
function populateGenreSelects() {
    const genres = (typeof getAllGenres === 'function') ? getAllGenres() : [];
    document.querySelectorAll('select.genre-select-dynamic').forEach(sel => {
        const currentVal = sel.value;
        sel.innerHTML = genres.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
        sel.value = genres.includes(currentVal) ? currentVal : 'その他商品';
    });
}

// ------------------------------------------
// 顧客管理系
// ------------------------------------------
function renderCustomers() {
    const tbody = document.getElementById('customer-tbody');
    if (!tbody || typeof customers === 'undefined') return;
    tbody.innerHTML = '';
    customers.forEach((cust, index) => {
        const currentAge = typeof calculateAge === 'function' ? calculateAge(cust) : '-';
        const bdayText = cust.birthday ? `<br><small style="color:#666;">生年月日: ${cust.birthday}</small>` : '';
        
        let displayName = cust.name || `${cust.lastName || ''} ${cust.firstName || ''}`;
        let displayKana = '';
        if (cust.lastKana || cust.firstKana) {
            displayKana = `<br><small style="color:#666;">フリガナ: ${cust.lastKana || ''} ${cust.firstKana || ''}</small>`;
        } else if (cust.kana) {
            displayKana = `<br><small style="color:#666;">フリガナ: ${cust.kana}</small>`;
        }

        const exp = typeof checkPointExpiry === 'function' ? checkPointExpiry(cust) : { expired: false, expiringSoon: false };
        let expText = "";
        if (cust.points > 0) {
            if (exp.expired) expText = `<br><small style="color:red; font-weight:bold;">(ポイント失効済み)</small>`;
            else if (exp.expiringSoon) expText = `<br><small style="color:#d32f2f; font-weight:bold;">(あと${exp.daysLeft}日で失効)</small>`;
        }

        let rankCellHtml = '-';
        if (typeof ensureCustomerRankFields === 'function' && typeof getCustomerRankInfo === 'function') {
            ensureCustomerRankFields(cust);
            const rankInfo = getCustomerRankInfo(cust);
            const navText = typeof buildRankNavText === 'function' ? buildRankNavText(cust) : '';
            rankCellHtml = `
                <span style="display:inline-block; background:${rankInfo.color}; color:#fff; font-weight:bold; padding:2px 10px; border-radius:12px; font-size:12px;">${rankInfo.name}</span>
                <br><small style="color:#666;">年間購入額: ¥${cust.annualPurchase.toLocaleString()}</small>
                <br><small style="color:#00796b;">${navText}</small>
            `;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family:monospace; font-weight:bold; color:#0066cc;">${cust.barcode}</td>
            <td><b>${displayName}</b> (${currentAge}歳)${displayKana}${bdayText}</td>
            <td style="text-align:center;">${rankCellHtml}</td>
            <td style="color:#d81b60; font-weight:bold;">${cust.points} pt ${expText}</td>
            <td style="font-size:12px;">📞 ${cust.phone || '-'}<br>🏠 ${cust.address || '-'}</td>
            <td>
                <button class="select-btn" style="background:#ff9800; margin-right:4px;" onclick="editCustomer(${index})">変更</button>
                <button class="del-btn" onclick="withdrawCustomer(${index})">退会</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addCustomer() {
    const barcode = document.getElementById('new-cust-barcode').value.trim();
    const lastName = document.getElementById('new-cust-last-name').value.trim();
    const firstName = document.getElementById('new-cust-first-name').value.trim();
    const lastKana = document.getElementById('new-cust-last-kana').value.trim();
    const firstKana = document.getElementById('new-cust-first-kana').value.trim();
    const birthday = document.getElementById('new-cust-birthday').value;
    const points = parseInt(document.getElementById('new-cust-points').value) || 0;
    const phone = document.getElementById('new-cust-phone').value.trim();
    const address = document.getElementById('new-cust-address').value.trim();

    if (!barcode || !lastName || !firstName || !lastKana || !firstKana) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("バーコード・お名前(姓・名)・フリガナ(セイ・メイ)は必須です。", "ばーこーど と おなまえ と ふりがな は ひっす です", () => {}, true);
        }
        return;
    }

    const name = `${lastName} ${firstName}`;
    const kana = `${lastKana} ${firstKana}`;
    const age = typeof calculateAge === 'function' ? calculateAge({ birthday: birthday }) : 0;
    const pointsUpdatedAt = new Date().toISOString();

    if (typeof customers !== 'undefined') {
        // 同じバーコードがあるか確認し、あれば上書き保存
        const existingIndex = customers.findIndex(c => c.barcode === barcode);
        const custData = { barcode, lastName, firstName, lastKana, firstKana, name, kana, birthday, age, points, phone, address, pointsUpdatedAt };
        if (existingIndex !== -1) {
            // 既存会員の場合、ランク進捗（年間購入額・現在ランク等）は上書きせず引き継ぐ
            const old = customers[existingIndex];
            custData.annualPurchase = old.annualPurchase;
            custData.rank = old.rank;
            custData.rankEvalMonth = old.rankEvalMonth;
            custData.rankGrace = old.rankGrace;
            custData.rankResetYear = old.rankResetYear;
        }
        if (typeof ensureCustomerRankFields === 'function') ensureCustomerRankFields(custData);

        if (existingIndex !== -1) {
            customers[existingIndex] = custData;
            if (typeof speak === 'function') speak("こきゃく じょうほう を うわがき ほぞん し まし た");
        } else {
            customers.push(custData);
            if (typeof speak === 'function') speak("こきゃく を とうろく し まし た");
        }
        localStorage.setItem('pos_customers', JSON.stringify(customers)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }
    
    document.getElementById('new-cust-barcode').value = '';
    document.getElementById('new-cust-last-name').value = '';
    document.getElementById('new-cust-first-name').value = '';
    document.getElementById('new-cust-last-kana').value = '';
    document.getElementById('new-cust-first-kana').value = '';
    document.getElementById('new-cust-birthday').value = '';
    document.getElementById('new-cust-points').value = '';
    document.getElementById('new-cust-phone').value = '';
    document.getElementById('new-cust-address').value = '';

    if (typeof playSound === 'function') playSound('success');
    renderCustomers();
}

function editCustomer(index) {
    if (typeof playSound === 'function') playSound('click');
    if (typeof editingCustIndex !== 'undefined') editingCustIndex = index;
    const cust = customers[index];
    document.getElementById('edit-cust-barcode-input').value = cust.barcode || '';
    document.getElementById('edit-cust-last-name-input').value = cust.lastName || '';
    document.getElementById('edit-cust-first-name-input').value = cust.firstName || '';
    document.getElementById('edit-cust-last-kana-input').value = cust.lastKana || '';
    document.getElementById('edit-cust-first-kana-input').value = cust.firstKana || '';
    document.getElementById('edit-cust-birthday-input').value = cust.birthday || '';
    document.getElementById('edit-cust-points-input').value = cust.points !== undefined ? cust.points : 0;
    document.getElementById('edit-cust-phone-input').value = cust.phone || '';
    document.getElementById('edit-cust-address-input').value = cust.address || '';
    document.getElementById('edit-cust-error').style.display = 'none';
    document.getElementById('edit-cust-modal').style.display = 'flex';
    if (typeof speak === 'function') speak("かいいん じょうほう の へんこう");
}

function closeEditCustModal() {
    if (typeof playSound === 'function') playSound('click');
    document.getElementById('edit-cust-modal').style.display = 'none';
    if (typeof editingCustIndex !== 'undefined') editingCustIndex = -1;
}

function saveEditCust() {
    if (typeof editingCustIndex === 'undefined' || editingCustIndex === -1) return;
    const lastName = document.getElementById('edit-cust-last-name-input').value.trim();
    const firstName = document.getElementById('edit-cust-first-name-input').value.trim();
    const lastKana = document.getElementById('edit-cust-last-kana-input').value.trim();
    const firstKana = document.getElementById('edit-cust-first-kana-input').value.trim();
    const birthday = document.getElementById('edit-cust-birthday-input').value;
    const points = parseInt(document.getElementById('edit-cust-points-input').value) || 0;
    const phone = document.getElementById('edit-cust-phone-input').value.trim();
    const address = document.getElementById('edit-cust-address-input').value.trim();

    if (!lastName || !firstName || !lastKana || !firstKana) {
        if (typeof playSound === 'function') playSound('error');
        document.getElementById('edit-cust-error').style.display = 'block';
        return;
    }

    document.getElementById('edit-cust-error').style.display = 'none';
    const name = `${lastName} ${firstName}`;
    const kana = `${lastKana} ${firstKana}`;
    const age = typeof calculateAge === 'function' ? calculateAge({ birthday: birthday }) : 0;

    const oldCust = customers[editingCustIndex];
    const pointsUpdatedAt = (oldCust.points !== points) ? new Date().toISOString() : (oldCust.pointsUpdatedAt || new Date().toISOString());

    customers[editingCustIndex] = {
        ...oldCust,
        lastName, firstName, lastKana, firstKana, name, kana, birthday, age, points, phone, address, pointsUpdatedAt
    };

    if (typeof activeCustomer !== 'undefined' && activeCustomer && activeCustomer.barcode === customers[editingCustIndex].barcode) {
        activeCustomer = customers[editingCustIndex];
        const displayName = activeCustomer.name;
        const currentAge = typeof calculateAge === 'function' ? calculateAge(activeCustomer) : 0;
        document.getElementById('ac-name').innerText = displayName;
        document.getElementById('ac-age').innerText = currentAge;
        document.getElementById('ac-points').innerText = activeCustomer.points;
    }

    localStorage.setItem('pos_customers', JSON.stringify(customers)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('success');
    renderCustomers();
    closeEditCustModal();
    if (typeof speak === 'function') speak("ほぞん し まし た");
}

function withdrawCustomer(index) {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            "この顧客を退会させますか？（データは削除されます）",
            "この こきゃく を たいかい させ ます か？",
            (res) => {
                if (!res) return;
                customers.splice(index, 1);
                localStorage.setItem('pos_customers', JSON.stringify(customers)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                if (typeof playSound === 'function') playSound('click');
                renderCustomers();
                if (typeof speak === 'function') speak("たいかい させ まし た");
            },
            true
        );
    }
}

// ------------------------------------------
// 担当者管理系
// ------------------------------------------
function renderClerks() {
    const tbody = document.getElementById('clerk-tbody');
    if (!tbody || typeof clerks === 'undefined') return;
    tbody.innerHTML = '';
    clerks.forEach((clerk, index) => {
        const isSelected = typeof activeClerkName !== 'undefined' && clerk.name === activeClerkName;
        const voiceStatus = (clerk.voiceEnabled !== false) ? '✅ 音声あり' : '❌ 音声なし';
        const ageText = (clerk.age !== undefined && clerk.age !== null && clerk.age !== "") ? `${clerk.age}歳` : '年齢未設定';
        const kanaText = clerk.kana ? `<br><small style="color:#666;">フリガナ: ${clerk.kana}</small>` : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color:${isSelected ? 'green':'#999'}; font-weight:bold;">${isSelected ? '★' : '-'}</td>
            <td style="font-family:monospace; color:#0066cc;">${clerk.barcode || '未登録'}</td>
            <td><b>${clerk.name}</b> (${ageText})${kanaText} <span style="font-size:11px; color:#666; margin-left:6px;">(${voiceStatus})</span></td>
            <td>
                <button class="select-btn" onclick="selectClerk('${clerk.name}')">選択</button> 
                <button class="select-btn" style="background:#9c27b0;" onclick="changeToManager(${index})">店長にする</button>
                <button class="select-btn" style="background:#ff9800;" onclick="editClerk(${index})">変更</button>
                <button class="del-btn" onclick="deleteClerk(${index})">削除</button>
            </td>`;
        tbody.appendChild(tr);
    });
}

function addClerk() {
    const name = document.getElementById('new-clerk-name').value.trim();
    const kana = document.getElementById('new-clerk-kana').value.trim();
    const barcode = document.getElementById('new-clerk-barcode').value.trim();
    const age = parseInt(document.getElementById('new-clerk-age').value) || 0;
    const voiceEnabled = document.getElementById('new-clerk-voice-check').checked;

    if (!name) { if (typeof playSound === 'function') playSound('error'); return; }
    if (name === '店長' || name.includes('店長')) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("店長の指定は「変更」または「店長にする」ボタンから行ってください。", "てんちょう の してい は へんこう から おこなっ て ください。", () => {}, true);
        }
        return;
    }
    if (typeof clerks !== 'undefined') {
        // バーコードが指定されていて既に存在すれば上書き保存
        const existingIndex = barcode ? clerks.findIndex(c => c.barcode === barcode) : -1;
        const clerkData = { id: (existingIndex !== -1 ? clerks[existingIndex].id : Date.now()), name, kana, barcode, age, voiceEnabled };
        
        if (existingIndex !== -1) {
            clerks[existingIndex] = clerkData;
            if (typeof speak === 'function') speak("たんとうしゃ を うわがき ほぞん し まし た");
        } else {
            clerks.push(clerkData);
            if (typeof speak === 'function') speak("たんとうしゃ を ついか し まし た");
        }
        localStorage.setItem('pos_clerks', JSON.stringify(clerks)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }
    document.getElementById('new-clerk-name').value = '';
    document.getElementById('new-clerk-kana').value = '';
    document.getElementById('new-clerk-barcode').value = '';
    document.getElementById('new-clerk-age').value = '';
    document.getElementById('new-clerk-voice-check').checked = true;
    if (typeof playSound === 'function') playSound('beep');
    renderClerks();
}

function changeToManager(index) {
    const clerk = clerks[index];
    if (!clerk.barcode || clerk.barcode.trim() === '') {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("バーコードが登録されていないため、店長にできません。バーコードを登録してください。", "ばーこーど が とうろく さ れ て い ない ため、 てんちょう に でき ませ ん。", () => {}, true);
        }
        return;
    }

    if (typeof playSound === 'function') playSound('click');
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            `${clerk.name} さんを「店長」に変更しますか？（他の店長は解除されます）`,
            "てんちょう に へんこう し ます か？",
            (res) => {
                if (!res) return;
                clerks.forEach(c => {
                    if (c.name === '店長') {
                        c.name = '店員';
                    }
                });
                clerks[index].name = '店長';
                localStorage.setItem('pos_clerks', JSON.stringify(clerks)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                if (typeof activeClerkName !== 'undefined') {
                    activeClerkName = '店長';
                    localStorage.setItem('pos_active_clerk', activeClerkName);
                }
                renderClerks();
                if (typeof playSound === 'function') playSound('success');
                if (typeof speak === 'function') speak("てんちょう に へんこう し まし た");
            },
            true
        );
    }
}

function selectClerk(name) {
    if (typeof activeClerkName !== 'undefined') {
        activeClerkName = name;
        localStorage.setItem('pos_active_clerk', activeClerkName);
    }
    const activeDisplay = document.getElementById('active-clerk-display');
    if (activeDisplay) activeDisplay.innerText = `担当: ${name}`;
    if (typeof playSound === 'function') playSound('success');
    renderClerks();
    if (typeof speak === 'function') speak(`${name} に こうたい し まし た`);
}

function deleteClerk(index) {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            "この担当者を削除しますか？",
            "この たんとうしゃ を さくじょ し ます か？",
            (res) => {
                if (!res) return;
                clerks.splice(index, 1);
                localStorage.setItem('pos_clerks', JSON.stringify(clerks)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                if (typeof playSound === 'function') playSound('click');
                renderClerks();
                if (typeof speak === 'function') speak("たんとうしゃ を さくじょ し まし た");
            },
            true
        );
    }
}

function editClerk(index) {
    if (typeof playSound === 'function') playSound('click');
    if (typeof editingClerkIndex !== 'undefined') editingClerkIndex = index;
    const clerk = clerks[index];
    document.getElementById('edit-clerk-name-input').value = clerk.name;
    document.getElementById('edit-clerk-kana-input').value = clerk.kana || '';
    document.getElementById('edit-clerk-barcode-input').value = clerk.barcode || '';
    document.getElementById('edit-clerk-age-input').value = clerk.age || '';
    document.getElementById('edit-clerk-voice-check').checked = (clerk.voiceEnabled !== false);
    document.getElementById('edit-clerk-error').style.display = 'none';
    document.getElementById('edit-clerk-modal').style.display = 'flex';
    if (typeof speak === 'function') speak("たんとうしゃ じょうほう の へんこう");
}

function closeEditClerkModal() {
    if (typeof playSound === 'function') playSound('click');
    document.getElementById('edit-clerk-modal').style.display = 'none';
    if (typeof editingClerkIndex !== 'undefined') editingClerkIndex = -1;
}

function saveEditClerk() {
    if (typeof editingClerkIndex === 'undefined' || editingClerkIndex === -1) return;
    const newName = document.getElementById('edit-clerk-name-input').value.trim();
    const newKana = document.getElementById('edit-clerk-kana-input').value.trim();
    const newBarcode = document.getElementById('edit-clerk-barcode-input').value.trim();
    const newAge = parseInt(document.getElementById('edit-clerk-age-input').value) || 0;
    const newVoiceEnabled = document.getElementById('edit-clerk-voice-check').checked;

    if (!newName) {
        if (typeof playSound === 'function') playSound('error');
        document.getElementById('edit-clerk-error').style.display = 'block';
        return;
    }
    document.getElementById('edit-clerk-error').style.display = 'none';
    if (typeof activeClerkName !== 'undefined' && clerks[editingClerkIndex].name === activeClerkName) {
        activeClerkName = newName;
        localStorage.setItem('pos_active_clerk', activeClerkName);
        const activeDisplay = document.getElementById('active-clerk-display');
        if (activeDisplay) activeDisplay.innerText = `担当: ${activeClerkName}`;
    }
    clerks[editingClerkIndex].name = newName;
    clerks[editingClerkIndex].kana = newKana;
    clerks[editingClerkIndex].barcode = newBarcode;
    clerks[editingClerkIndex].age = newAge;
    clerks[editingClerkIndex].voiceEnabled = newVoiceEnabled;
    localStorage.setItem('pos_clerks', JSON.stringify(clerks)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('success');
    renderClerks();
    closeEditClerkModal();
    if (typeof speak === 'function') speak("ほぞん し まし た");
}

// ------------------------------------------
// 商品管理系
// ------------------------------------------
function renderProductTable() {
    renderProducts();
}

function renderProducts() {
    const tbody = document.getElementById('product-tbody');
    if (!tbody || typeof products === 'undefined') return;
    tbody.innerHTML = '';
    products.forEach((prod, index) => {
        const tax = prod.taxRate !== undefined ? prod.taxRate : 10;
        const genreName = prod.genre || 'その他商品';
        const ageText = prod.ageCheck ? '<span style="color:red; font-weight:bold;">🔞 対象</span>' : '<span style="color:#888;">なし</span>';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="prod-check" value="${index}" onchange="checkBulkStatus()"></td>
            <td style="font-family:monospace; font-weight:bold; color:#0066cc;">${prod.jan}</td>
            <td><b>${prod.name}</b> <small style="color:#666;">(${genreName})</small></td>
            <td>
                <button class="select-btn" onclick="editSingleProduct(${index})" style="padding:4px 8px; font-size:12px; margin-right:8px; background:#ff9800; border-radius:4px;">変更</button>
                ¥${prod.price.toLocaleString()} (税${tax}%)
            </td>
            <td>${ageText}</td>
            <td><button class="del-btn" onclick="deleteProduct(${index})">削除</button></td>
        `;
        tbody.appendChild(tr);
    });
    checkBulkStatus();
}

function checkBulkStatus() {
    const checks = document.querySelectorAll('.prod-check');
    const checkedCount = document.querySelectorAll('.prod-check:checked').length;
    const bulkBar = document.getElementById('bulk-edit-bar');
    const allCheck = document.getElementById('check-all-prods');

    if (!bulkBar || !allCheck) return;

    if (checkedCount > 0) { bulkBar.style.display = 'flex'; }
    else { bulkBar.style.display = 'none'; }

    if (checks.length > 0 && checkedCount === checks.length) { allCheck.checked = true; }
    else { allCheck.checked = false; }
}

function toggleAllProds() {
    const allCheck = document.getElementById('check-all-prods');
    if (!allCheck) return;
    const isChecked = allCheck.checked;
    document.querySelectorAll('.prod-check').forEach(cb => { cb.checked = isChecked; });
    checkBulkStatus();
}

function applyBulkEdit() {
    const newPriceStr = document.getElementById('bulk-price-input').value;
    const newTaxStr = document.getElementById('bulk-tax-input').value;

    if (newPriceStr === "" && newTaxStr === "") {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("新しい価格か税率のどちらかを入力してください。", "あたらしい かかく か ぜいりつ の どちらか を にゅうりょく し て ください。", () => {}, true);
        }
        return;
    }

    const checks = document.querySelectorAll('.prod-check:checked');
    checks.forEach(cb => {
        const idx = parseInt(cb.value);
        if (newPriceStr !== "") products[idx].price = parseInt(newPriceStr);
        if (newTaxStr !== "") products[idx].taxRate = parseInt(newTaxStr);
    });

    localStorage.setItem('pos_products', JSON.stringify(products)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('success');
    renderProducts();
    if (typeof generateCustomButtons === 'function') generateCustomButtons(); 
    
    document.getElementById('bulk-price-input').value = "";
    document.getElementById('bulk-tax-input').value = "";
    document.getElementById('check-all-prods').checked = false;
    document.getElementById('bulk-edit-bar').style.display = 'none';
    if (typeof speak === 'function') speak("いっかつ てきよう し まし た");
}

function confirmBulkDelete() {
    const checks = document.querySelectorAll('.prod-check:checked');
    const count = checks.length;
    if (count === 0) return;

    let msg = count <= 5 ? "選択した商品を削除しますか？" : "本当に削除しますか？";
    let hiraMsg = count <= 5 ? "せんたく し た しょうひん を さくじょ し ます か？" : "ほんとう に さくじょ し まし た？";
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(msg, hiraMsg, (res) => {
            if (!res) return;
            const indices = Array.from(checks).map(cb => parseInt(cb.value)).sort((a,b) => b - a);
            indices.forEach(idx => products.splice(idx, 1));
            localStorage.setItem('pos_products', JSON.stringify(products)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
            if (typeof playSound === 'function') playSound('success');
            renderProducts();
            if (typeof generateCustomButtons === 'function') generateCustomButtons();
            const bulkBar = document.getElementById('bulk-edit-bar');
            if (bulkBar) bulkBar.style.display = 'none';
            if (typeof speak === 'function') speak("さくじょ し まし た");
        }, true);
    }
}

function editSingleProduct(index) {
    if (typeof playSound === 'function') playSound('click');
    if (typeof editingProdIndex !== 'undefined') editingProdIndex = index;
    const prod = products[index];
    const currentTax = prod.taxRate !== undefined ? prod.taxRate : 10;
    
    const modal = document.getElementById('edit-prod-modal');
    if (modal) {
        modal.dataset.index = index;
        modal.style.display = 'flex';
    }

    const nameDisp = document.getElementById('edit-prod-name-display');
    if (nameDisp) nameDisp.innerText = prod.name + ' の編集';

    const genreInp = document.getElementById('edit-prod-genre-input');
    if (genreInp) {
        if (typeof populateGenreSelects === 'function') populateGenreSelects();
        genreInp.value = prod.genre || 'その他商品';
    }

    const priceInp = document.getElementById('edit-prod-price-input');
    if (priceInp) priceInp.value = prod.price;

    const taxInp = document.getElementById('edit-prod-tax-input');
    if (taxInp) taxInp.value = currentTax;

    const ageInp = document.getElementById('edit-prod-age-check');
    if (ageInp) ageInp.checked = !!prod.ageCheck;

    const err = document.getElementById('edit-prod-error');
    if (err) err.style.display = 'none';

    if (typeof speak === 'function') speak("しょうひん の へんこう");
}

function closeEditProdModal() {
    if (typeof playSound === 'function') playSound('click');
    const modal = document.getElementById('edit-prod-modal');
    if (modal) modal.style.display = 'none';
    if (typeof editingProdIndex !== 'undefined') editingProdIndex = -1;
}

function addProduct() {
    const janInput = document.getElementById('new-prod-jan');
    const nameInput = document.getElementById('new-prod-name');
    const genreInput = document.getElementById('new-prod-genre');
    const priceInput = document.getElementById('new-prod-price');
    const taxInput = document.getElementById('new-prod-tax');
    const ageCheckInput = document.getElementById('new-prod-age-check');

    const jan = (janInput && janInput.value.trim()) ? janInput.value.trim() : Date.now().toString();
    const name = nameInput ? nameInput.value.trim() : '';
    const genre = genreInput ? genreInput.value : 'その他商品';
    const price = priceInput ? parseInt(priceInput.value) : NaN;
    const taxRate = taxInput ? (parseInt(taxInput.value) || 10) : 10;
    const ageCheck = ageCheckInput ? ageCheckInput.checked : false;

    if (!name || isNaN(price) || price < 0) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("商品名と正しい価格を入力してください。", "しょうひんめい と かかく を にゅうりょく し て ください", () => {}, true);
        } else {
            alert("商品名と正しい価格を入力してください。");
        }
        return;
    }

    const existingIndex = products.findIndex(p => p.jan === jan);
    const prodData = { jan, name, genre, price, taxRate, ageCheck };

    if (existingIndex !== -1) {
        products[existingIndex] = prodData;
        if (typeof speak === 'function') speak("しょうひん を うわがき ほぞん し まし た");
    } else {
        products.push(prodData);
        if (typeof speak === 'function') speak("しょうひん を ついか し まし た");
    }

    localStorage.setItem('pos_products', JSON.stringify(products)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    
    if (janInput) janInput.value = '';
    if (nameInput) nameInput.value = '';
    if (priceInput) priceInput.value = '';
    if (ageCheckInput) ageCheckInput.checked = false;

    renderProductTable();
    if (typeof generateCustomButtons === 'function') generateCustomButtons();
    if (typeof playSound === 'function') playSound('success');
}

function saveEditProd() {
    const modal = document.getElementById('edit-prod-modal');
    const index = modal ? parseInt(modal.dataset.index) : (typeof editingProdIndex !== 'undefined' ? editingProdIndex : -1);

    if (index < 0 || !products[index]) return;

    const genreInput = document.getElementById('edit-prod-genre-input');
    const priceInput = parseInt(document.getElementById('edit-prod-price-input').value);
    const taxInput = parseInt(document.getElementById('edit-prod-tax-input').value) || 10;
    const ageCheckInput = document.getElementById('edit-prod-age-check').checked;

    if (isNaN(priceInput) || priceInput < 0) {
        const err = document.getElementById('edit-prod-error');
        if (err) err.style.display = 'block';
        if (typeof playSound === 'function') playSound('error');
        return;
    }

    products[index].genre = genreInput ? genreInput.value : 'その他商品';
    products[index].price = priceInput;
    products[index].taxRate = taxInput;
    products[index].ageCheck = ageCheckInput;

    localStorage.setItem('pos_products', JSON.stringify(products)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

    closeEditProdModal();
    renderProductTable();
    if (typeof generateCustomButtons === 'function') generateCustomButtons();
    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak("ほぞん し まし た");
}

function deleteProduct(index) {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            "この商品を削除しますか？",
            "この しょうひん を さくじょ し ます か？",
            (res) => {
                if (!res) return;
                products.splice(index, 1);
                localStorage.setItem('pos_products', JSON.stringify(products)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                if (typeof playSound === 'function') playSound('click');
                renderProducts();
                if (typeof generateCustomButtons === 'function') generateCustomButtons();
                if (typeof speak === 'function') speak("さくじょ し まし た");
            },
            true
        );
    }
}

function generateCustomButtons() {
    const area = document.getElementById('custom-buttons-area');
    if (!area || typeof products === 'undefined') return;
    area.innerHTML = ''; 
    products.forEach(prod => {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        const ageBadge = prod.ageCheck ? ' <span style="color:red; font-weight:bold;">[🔞]</span>' : '';
        btn.innerHTML = `<b>${prod.name}${ageBadge}</b><small>¥${prod.price.toLocaleString()} [${prod.jan}]</small>`;
        btn.onclick = function() { 
            if (typeof playSound === 'function') playSound('beep'); 
            if (typeof lastScannedBarcode !== 'undefined') lastScannedBarcode = prod.jan;
            if (typeof checkAndAddToCart === 'function') checkAndAddToCart(prod); 
            if (typeof getJanInput === 'function') {
                const input = getJanInput();
                if (input) input.focus(); 
            }
        };
        area.appendChild(btn);
    });
}

function openUnknownProdModal(jan) {
    if (typeof pendingUnknownJan !== 'undefined') pendingUnknownJan = jan;
    const disp = document.getElementById('unknown-jan-display');
    if (disp) disp.innerText = `JAN: ${jan}`;
    document.getElementById('unknown-prod-name-input').value = "";
    document.getElementById('unknown-prod-price-input').value = "";
    document.getElementById('unknown-prod-tax-input').value = "10";
    document.getElementById('unknown-prod-age-check').checked = false;
    document.getElementById('unknown-prod-error').style.display = 'none';
    document.getElementById('unknown-prod-modal').style.display = 'flex';
    if (typeof speak === 'function') speak("かかく と ぜいりつ、 なまえ を にゅうりょく し て ください");
}

function closeUnknownProdModal() {
    if (typeof playSound === 'function') playSound('click');
    document.getElementById('unknown-prod-modal').style.display = 'none';
    if (typeof pendingUnknownJan !== 'undefined') pendingUnknownJan = "";
    if (typeof getJanInput === 'function') {
        const input = getJanInput();
        if (input) input.focus();
    }
}

function saveUnknownProd() {
    let name = document.getElementById('unknown-prod-name-input').value.trim();
    let priceInput = document.getElementById('unknown-prod-price-input').value.trim();
    const tax = parseInt(document.getElementById('unknown-prod-tax-input').value) || 10;
    const ageCheck = document.getElementById('unknown-prod-age-check').checked;

    if (priceInput === "" || isNaN(parseInt(priceInput))) {
        if (typeof playSound === 'function') playSound('error');
        const err = document.getElementById('unknown-prod-error');
        if (err) {
            err.innerText = "価格を正しく入力してください";
            err.style.display = 'block';
        }
        if (typeof speak === 'function') speak("かかく を ただしく にゅうりょく し て ください");
        return;
    }

    if (!name) name = "名無しの商品";
    const price = parseInt(priceInput);

    if (typeof playSound === 'function') playSound('success');
    const targetJan = typeof pendingUnknownJan !== 'undefined' ? pendingUnknownJan : Date.now().toString();
    const newProd = { id: Date.now(), jan: targetJan, name: name, genre: 'その他商品', price: price, taxRate: tax, ageCheck: ageCheck };
    
    if (typeof products !== 'undefined') {
        products.push(newProd);
        localStorage.setItem('pos_products', JSON.stringify(products)); if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }
    if (typeof generateCustomButtons === 'function') generateCustomButtons();

    document.getElementById('unknown-prod-modal').style.display = 'none';
    if (typeof checkAndAddToCart === 'function') checkAndAddToCart(newProd);
    if (typeof pendingUnknownJan !== 'undefined') pendingUnknownJan = "";
    if (typeof getJanInput === 'function') {
        const input = getJanInput();
        if (input) input.focus();
    }
}