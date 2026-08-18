// ==========================================
// ハイテク音声レジスター - 管理・履歴・認証用JavaScript（完全統合版）
// ==========================================

// 現在履歴を見ている人（'manager' または 担当者名）
let currentHistoryViewer = null;

// ボタンの表示と動作を現在の認証状態に合わせて切り替える関数
function updateManagerButtonState() {
    const lockBtn = document.getElementById('manager-lock-btn');
    if (!lockBtn) return;

    if (managerAuthDone) {
        lockBtn.innerText = '店長ロック';
    } else {
        lockBtn.innerText = '店長認証';
    }
}

// 右上のボタンが押されたときの共通分岐
function handleManagerBtnClick() {
    if (managerAuthDone) {
        lockManagerAuth();
    } else {
        requestManagerAuth('home');
    }
}

function requestManagerAuth(target = 'customer') {
    managerAuthTarget = target;
    playSound('click');

    if (managerAuthDone) {
        const modal = document.getElementById('manager-auth-modal');
        modal.style.display = 'flex';
        setTimeout(() => {
            modal.style.display = 'none';
            openManagerAuthTarget(target);
        }, 100);
        return;
    }

    document.getElementById('manager-auth-input').value = '';
    document.getElementById('manager-auth-error').style.display = 'none';
    document.getElementById('manager-auth-modal').style.display = 'flex';
    document.getElementById('manager-auth-input').focus();
    speak("てんちょう にんしょう");
}

function closeManagerAuth() {
    playSound('click');
    document.getElementById('manager-auth-modal').style.display = 'none';
}

function verifyManagerAuth() {
    const val = document.getElementById('manager-auth-input').value.trim();
    const managerClerk = clerks.find(c => c.name === '店長');
    const isMatch = (managerClerk && managerClerk.barcode && managerClerk.barcode === val) || 
                    clerks.some(c => c.barcode === val && (c.name === '店長' || c.name.includes('店長')));

    if (isMatch && val !== "") {
        playSound('success');
        closeManagerAuth();
        managerAuthDone = true;
        sessionStorage.setItem('pos_manager_auth', 'true');
        
        // 認証成功時にボタンの文字を「店長ロック」に変更し、API設定の枠を表示
        updateManagerButtonState();
        const apiSettings = document.getElementById('api-settings-container');
        if (apiSettings) apiSettings.style.display = 'block';

        openManagerAuthTarget(managerAuthTarget);
        speak("てんちょう にんしょう せいこう し まし た");
    } else {
        playSound('error');
        document.getElementById('manager-auth-error').style.display = 'block';
        speak("にんしょう しっぱい し まし た");
        document.getElementById('manager-auth-input').focus();
    }
}

// 店長ロックボタンを押したときに認証を解除し、ボタンを「店長認証」に戻す関数
function lockManagerAuth() {
    playSound('click');
    managerAuthDone = false;
    sessionStorage.removeItem('pos_manager_auth');

    // ボタンの文字を「店長認証」に戻し、API設定の枠を非表示にする
    updateManagerButtonState();
    const apiSettings = document.getElementById('api-settings-container');
    if (apiSettings) apiSettings.style.display = 'none';

    if (typeof goHome === 'function') {
        goHome();
    }
    playSound('success');
    speak("てんちょう ロック を かけ まし た");
}

function openManagerAuthTarget(target) {
    if (target === 'product') {
        showScreen('product-screen');
    } else if (target === 'migration') {
        showScreen('migration-screen');
    } else if (target === 'customer') {
        showScreen('customer-mgmt-screen');
    }
}

// ==========================================
// 履歴閲覧のバーコード認証モーダル関連
// ==========================================
function requestHistoryAuth() {
    if (typeof playSound === 'function') playSound('click');
    const input = document.getElementById('history-auth-input');
    if (input) {
        input.value = '';
        input.removeEventListener('keydown', historyAuthKeydownHandler);
        input.addEventListener('keydown', historyAuthKeydownHandler);
    }
    const errorMsg = document.getElementById('history-auth-error');
    if (errorMsg) errorMsg.style.display = 'none';
    
    const modal = document.getElementById('history-auth-modal');
    if (modal) modal.style.display = 'flex';
    
    if (input) input.focus();
    if (typeof speak === 'function') speak("ばーこーど を にゅうりょく し て ください");
}

function historyAuthKeydownHandler(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        verifyHistoryAuth();
    }
}

function closeHistoryAuth() {
    if (typeof playSound === 'function') playSound('click');
    const modal = document.getElementById('history-auth-modal');
    if (modal) modal.style.display = 'none';
}

function verifyHistoryAuth() {
    const inputEl = document.getElementById('history-auth-input');
    if (!inputEl) return;
    const val = inputEl.value.trim();
    
    if (!val) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }

    const matchedClerk = clerks.find(c => c.barcode === val);

    if (matchedClerk) {
        if (typeof playSound === 'function') playSound('success');
        closeHistoryAuth();

        if (matchedClerk.name === '店長' || matchedClerk.name.includes('店長')) {
            currentHistoryViewer = 'manager';
        } else {
            currentHistoryViewer = matchedClerk.name;
        }

        // ★一度認証に成功したことをブラウザに記憶させる
        sessionStorage.setItem('pos_history_auth', 'true');

        if (typeof showScreen === 'function') showScreen('history-screen');
        renderHistory();
        if (typeof speak === 'function') speak("りれき を ひょうじ し ます");
    } else {
        if (typeof playSound === 'function') playSound('error');
        const errorMsg = document.getElementById('history-auth-error');
        if (errorMsg) errorMsg.style.display = 'block';
        if (typeof speak === 'function') speak("にんしょう しっぱい");
        inputEl.focus();
    }
}

// ==========================================
// タイムカード機能
// ==========================================
function openTimecardScreen() {
    playSound('click');
    showScreen('timecard-screen');
    renderTimecardTable();
    const input = document.getElementById('tc-barcode-input');
    if (input) {
        input.value = '';
        input.focus();
    }
    speak("たいむかーど かんり");
}

function getTimecardData() {
    return JSON.parse(localStorage.getItem('pos_timecard')) || [];
}

function saveTimecardData(data) {
    localStorage.setItem('pos_timecard', JSON.stringify(data));
}

function handleTimecardStamp(type = null) {
    const input = document.getElementById('tc-barcode-input');
    if (!input) return;
    const barcode = input.value.trim();
    const msgEl = document.getElementById('tc-status-msg');

    if (!barcode) {
        playSound('error');
        if (msgEl) {
            msgEl.style.color = 'red';
            msgEl.innerText = "バーコードを入力してください。";
        }
        return;
    }

    const matchedClerk = clerks.find(c => c.barcode === barcode);
    if (!matchedClerk) {
        playSound('error');
        if (msgEl) {
            msgEl.style.color = 'red';
            msgEl.innerText = "該当する担当者が見つかりません。";
        }
        speak("たんとうしゃ が みつかり ませ ん");
        return;
    }

    const now = new Date();
    const todayStr = now.toLocaleDateString('ja-JP');
    const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

    let records = getTimecardData();
    let record = records.find(r => r.date === todayStr && r.clerkName === matchedClerk.name);

    if (!record) {
        record = {
            id: Date.now(),
            date: todayStr,
            clerkName: matchedClerk.name,
            clockIn: null,
            breakStart: null,
            breakEnd: null,
            clockOut: null
        };
        records.unshift(record);
    }

    // 打刻種別の自動判定（指定なしの場合）
    if (!type) {
        if (!record.clockIn) type = 'clockIn';
        else if (record.clockIn && !record.breakStart && !record.clockOut) type = 'breakStart';
        else if (record.breakStart && !record.breakEnd) type = 'breakEnd';
        else type = 'clockOut';
    }

    let actionLabel = "";
    if (type === 'clockIn') {
        record.clockIn = timeStr;
        actionLabel = "出勤";
    } else if (type === 'breakStart') {
        record.breakStart = timeStr;
        actionLabel = "休憩開始";
    } else if (type === 'breakEnd') {
        record.breakEnd = timeStr;
        actionLabel = "休憩終了";
    } else if (type === 'clockOut') {
        record.clockOut = timeStr;
        actionLabel = "退勤";
    }

    saveTimecardData(records);
    playSound('success');

    if (msgEl) {
        msgEl.style.color = 'green';
        msgEl.innerText = `${matchedClerk.name} 様: ${actionLabel} (${timeStr}) を記録しました。`;
    }

    // カナがあればカナで読み上げ、なければ漢字（名前）のまま読み上げる
    const speakName = matchedClerk.kana ? matchedClerk.kana : matchedClerk.name;
    speak(`${speakName} さん ${actionLabel} を きろく し まし た`);
    
    input.value = '';
    input.focus();
    renderTimecardTable();
}

function calculateWorkDuration(rec) {
    if (!rec.clockIn || !rec.clockOut) return '-';
    try {
        const parseTime = (timeStr) => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };
        let start = parseTime(rec.clockIn);
        let end = parseTime(rec.clockOut);
        if (end < start) end += 24 * 60; // 日を跨いだ場合対応

        let breakDiff = 0;
        if (rec.breakStart && rec.breakEnd) {
            let bStart = parseTime(rec.breakStart);
            let bEnd = parseTime(rec.breakEnd);
            if (bEnd < bStart) bEnd += 24 * 60;
            breakDiff = bEnd - bStart;
        }

        let totalMinutes = (end - start) - breakDiff;
        if (totalMinutes < 0) totalMinutes = 0;

        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return `${hours}時間${mins}分`;
    } catch (e) {
        return '-';
    }
}

function renderTimecardTable() {
    const tbody = document.getElementById('timecard-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const records = getTimecardData();
    const isManager = managerAuthDone || sessionStorage.getItem('pos_manager_auth') === 'true';

    const clearBtn = document.getElementById('timecard-clear-btn');
    if (clearBtn) clearBtn.style.display = isManager ? 'inline-block' : 'none';

    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">タイムカードの記録がありません</td></tr>';
        return;
    }

    records.forEach((rec, index) => {
        const tr = document.createElement('tr');
        const duration = calculateWorkDuration(rec);
        // 削除ボタンを消して、見やすく修正しました。
        tr.innerHTML = `
            <td>${rec.date}</td>
            <td><b>${rec.clerkName}</b></td>
            <td>${rec.clockIn || '-'}</td>
            <td>${rec.breakStart || '-'}</td>
            <td>${rec.breakEnd || '-'}</td>
            <td>${rec.clockOut || '-'}</td>
            <td style="font-weight:bold; color:#0066cc;">${duration}</td>
        `;
        tbody.appendChild(tr);
    });
}

function clearAllTimecards() {
    if (!managerAuthDone && sessionStorage.getItem('pos_manager_auth') !== 'true') {
        playSound('error');
        showCustomConfirm("全タイムカードの削除は店長のみ可能です。", "てんちょう のみ かのう です。", () => {}, true);
        return;
    }

    showCustomConfirm("すべてのタイムカード記録を完全に削除しますか？", "すべての きろく を さくじょ し ます か？", (res) => {
        if (!res) return;
        localStorage.removeItem('pos_timecard');
        playSound('click');
        renderTimecardTable();
        speak("すべての きろく を さくじょ し まし た");
    }, true);
}

function exportTimecardXlsx() {
    try {
        playSound('click');
        const records = getTimecardData();
        if (records.length === 0) {
            showCustomConfirm("出力するタイムカードデータがありません。", "しゅつりょく する データ が あり ませ ん。", () => {}, true);
            return;
        }

        const excelData = [
            ["日付", "担当者名", "出勤時間", "休憩開始", "休憩終了", "退勤時間", "実働時間"]
        ];

        records.forEach(rec => {
            excelData.push([
                rec.date,
                rec.clerkName,
                rec.clockIn || '-',
                rec.breakStart || '-',
                rec.breakEnd || '-',
                rec.clockOut || '-',
                calculateWorkDuration(rec)
            ]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(excelData);
        worksheet['!cols'] = [
            { wch: 15 },
            { wch: 15 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 15 }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "タイムカード");

        const fileName = `タイムカード_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        playSound('success');
        speak("たいむかーど を しゅつりょく し まし た");
    } catch (err) {
        console.error(err);
        playSound('error');
        showCustomConfirm("タイムカードの出力に失敗しました。", "しゅつりょく に しっぱい し まし た。", () => {}, true);
    }
}

// ==========================================
// 顧客管理系
// ==========================================
function renderCustomers() {
    const tbody = document.getElementById('customer-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    customers.forEach((cust, index) => {
        const currentAge = calculateAge(cust);
        const bdayText = cust.birthday ? `<br><small style="color:#666;">生年月日: ${cust.birthday}</small>` : '';
        
        let displayName = cust.name || `${cust.lastName || ''} ${cust.firstName || ''}`;
        let displayKana = '';
        if (cust.lastKana || cust.firstKana) {
            displayKana = `<br><small style="color:#666;">フリガナ: ${cust.lastKana || ''} ${cust.firstKana || ''}</small>`;
        } else if (cust.kana) {
            displayKana = `<br><small style="color:#666;">フリガナ: ${cust.kana}</small>`;
        }

        const exp = checkPointExpiry(cust);
        let expText = "";
        if (cust.points > 0) {
            if (exp.expired) expText = `<br><small style="color:red; font-weight:bold;">(ポイント失効済み)</small>`;
            else if (exp.expiringSoon) expText = `<br><small style="color:#d32f2f; font-weight:bold;">(あと${exp.daysLeft}日で失効)</small>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family:monospace; font-weight:bold; color:#0066cc;">${cust.barcode}</td>
            <td><b>${displayName}</b> (${currentAge}歳)${displayKana}${bdayText}</td>
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
        playSound('error');
        showCustomConfirm("バーコード・お名前(姓・名)・フリガナ(セイ・メイ)は必須です。", "ばーこーど と おなまえ と ふりがな は ひっす です", () => {}, true);
        return;
    }

    if (customers.some(c => c.barcode === barcode)) {
        playSound('error');
        showCustomConfirm("このバーコードは既に登録されています", "すでに とうろく さ れ て い ます", () => {}, true);
        return;
    }

    const name = `${lastName} ${firstName}`;
    const kana = `${lastKana} ${firstKana}`;
    const age = calculateAge({ birthday: birthday });
    const pointsUpdatedAt = new Date().toISOString();

    customers.push({ barcode, lastName, firstName, lastKana, firstKana, name, kana, birthday, age, points, phone, address, pointsUpdatedAt });
    localStorage.setItem('pos_customers', JSON.stringify(customers));
    
    document.getElementById('new-cust-barcode').value = '';
    document.getElementById('new-cust-last-name').value = '';
    document.getElementById('new-cust-first-name').value = '';
    document.getElementById('new-cust-last-kana').value = '';
    document.getElementById('new-cust-first-kana').value = '';
    document.getElementById('new-cust-birthday').value = '';
    document.getElementById('new-cust-points').value = '';
    document.getElementById('new-cust-phone').value = '';
    document.getElementById('new-cust-address').value = '';

    playSound('success');
    renderCustomers();
    speak("こきゃく を とうろく し まし た");
}

function editCustomer(index) {
    playSound('click');
    editingCustIndex = index;
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
    speak("かいいん じょうほう の へんこう");
}

function closeEditCustModal() {
    playSound('click');
    document.getElementById('edit-cust-modal').style.display = 'none';
    editingCustIndex = -1;
}

function saveEditCust() {
    if (editingCustIndex === -1) return;
    const lastName = document.getElementById('edit-cust-last-name-input').value.trim();
    const firstName = document.getElementById('edit-cust-first-name-input').value.trim();
    const lastKana = document.getElementById('edit-cust-last-kana-input').value.trim();
    const firstKana = document.getElementById('edit-cust-first-kana-input').value.trim();
    const birthday = document.getElementById('edit-cust-birthday-input').value;
    const points = parseInt(document.getElementById('edit-cust-points-input').value) || 0;
    const phone = document.getElementById('edit-cust-phone-input').value.trim();
    const address = document.getElementById('edit-cust-address-input').value.trim();

    if (!lastName || !firstName || !lastKana || !firstKana) {
        playSound('error');
        document.getElementById('edit-cust-error').style.display = 'block';
        return;
    }

    document.getElementById('edit-cust-error').style.display = 'none';
    const name = `${lastName} ${firstName}`;
    const kana = `${lastKana} ${firstKana}`;
    const age = calculateAge({ birthday: birthday });

    const oldCust = customers[editingCustIndex];
    const pointsUpdatedAt = (oldCust.points !== points) ? new Date().toISOString() : (oldCust.pointsUpdatedAt || new Date().toISOString());

    customers[editingCustIndex] = {
        ...oldCust,
        lastName, firstName, lastKana, firstKana, name, kana, birthday, age, points, phone, address, pointsUpdatedAt
    };

    if (activeCustomer && activeCustomer.barcode === customers[editingCustIndex].barcode) {
        activeCustomer = customers[editingCustIndex];
        const displayName = activeCustomer.name;
        const currentAge = calculateAge(activeCustomer);
        document.getElementById('ac-name').innerText = displayName;
        document.getElementById('ac-age').innerText = currentAge;
        document.getElementById('ac-points').innerText = activeCustomer.points;
    }

    localStorage.setItem('pos_customers', JSON.stringify(customers));
    playSound('success');
    renderCustomers();
    closeEditCustModal();
    speak("ほぞん し まし た");
}

function withdrawCustomer(index) {
    showCustomConfirm(
        "この顧客を退会させますか？（データは削除されます）",
        "この こきゃく を たいかい させ ます か？",
        (res) => {
            if (!res) return;
            customers.splice(index, 1);
            localStorage.setItem('pos_customers', JSON.stringify(customers));
            playSound('click');
            renderCustomers();
            speak("たいかい させ まし た");
        },
        true
    );
}

// ==========================================
// 担当者管理系
// ==========================================
function renderClerks() {
    const tbody = document.getElementById('clerk-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    clerks.forEach((clerk, index) => {
        const isSelected = clerk.name === activeClerkName;
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

    if(!name) { playSound('error'); return; }
    if(name === '店長' || name.includes('店長')) {
        playSound('error');
        showCustomConfirm("店長の指定は「変更」または「店長にする」ボタンから行ってください。", "てんちょう の してい は へんこう から おこなっ て ください。", () => {}, true);
        return;
    }
    clerks.push({ id: Date.now(), name: name, kana: kana, barcode: barcode, age: age, voiceEnabled: voiceEnabled });
    localStorage.setItem('pos_clerks', JSON.stringify(clerks));
    document.getElementById('new-clerk-name').value = '';
    document.getElementById('new-clerk-kana').value = '';
    document.getElementById('new-clerk-barcode').value = '';
    document.getElementById('new-clerk-age').value = '';
    document.getElementById('new-clerk-voice-check').checked = true;
    playSound('beep'); renderClerks();
    speak("たんとうしゃ を ついか し まし た");
}

function changeToManager(index) {
    const clerk = clerks[index];
    if (!clerk.barcode || clerk.barcode.trim() === '') {
        playSound('error');
        showCustomConfirm("バーコードが登録されていないため、店長にできません。バーコードを登録してください。", "ばーこーど が とうろく さ れ て い ない ため、 てんちょう に でき ませ ん。", () => {}, true);
        return;
    }

    playSound('click');
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
            localStorage.setItem('pos_clerks', JSON.stringify(clerks));
            activeClerkName = '店長';
            localStorage.setItem('pos_active_clerk', activeClerkName);
            renderClerks();
            playSound('success');
            speak("てんちょう に へんこう し まし た");
        },
        true
    );
}

function selectClerk(name) {
    activeClerkName = name; localStorage.setItem('pos_active_clerk', activeClerkName);
    const activeDisplay = document.getElementById('active-clerk-display');
    if (activeDisplay) activeDisplay.innerText = `担当: ${activeClerkName}`;
    playSound('success'); renderClerks();
    speak(`${name} に こうたい し まし た`);
}

function deleteClerk(index) {
    showCustomConfirm(
        "この担当者を削除しますか？",
        "この たんとうしゃ を さくじょ し ます か？",
        (res) => {
            if (!res) return;
            clerks.splice(index, 1);
            localStorage.setItem('pos_clerks', JSON.stringify(clerks));
            playSound('click');
            renderClerks();
            speak("たんとうしゃ を さくじょ し まし た");
        },
        true
    );
}

function editClerk(index) {
    playSound('click');
    editingClerkIndex = index;
    const clerk = clerks[index];
    document.getElementById('edit-clerk-name-input').value = clerk.name;
    document.getElementById('edit-clerk-kana-input').value = clerk.kana || '';
    document.getElementById('edit-clerk-barcode-input').value = clerk.barcode || '';
    document.getElementById('edit-clerk-age-input').value = clerk.age || '';
    document.getElementById('edit-clerk-voice-check').checked = (clerk.voiceEnabled !== false);
    document.getElementById('edit-clerk-error').style.display = 'none';
    document.getElementById('edit-clerk-modal').style.display = 'flex';
    speak("たんとうしゃ じょうほう の へんこう");
}

function closeEditClerkModal() {
    playSound('click');
    document.getElementById('edit-clerk-modal').style.display = 'none';
    editingClerkIndex = -1;
}

function saveEditClerk() {
    if (editingClerkIndex === -1) return;
    const newName = document.getElementById('edit-clerk-name-input').value.trim();
    const newKana = document.getElementById('edit-clerk-kana-input').value.trim();
    const newBarcode = document.getElementById('edit-clerk-barcode-input').value.trim();
    const newAge = parseInt(document.getElementById('edit-clerk-age-input').value) || 0;
    const newVoiceEnabled = document.getElementById('edit-clerk-voice-check').checked;

    if (!newName) {
        playSound('error');
        document.getElementById('edit-clerk-error').style.display = 'block';
        return;
    }
    document.getElementById('edit-clerk-error').style.display = 'none';
    if (clerks[editingClerkIndex].name === activeClerkName) {
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
    localStorage.setItem('pos_clerks', JSON.stringify(clerks));
    playSound('success');
    renderClerks();
    closeEditClerkModal();
    speak("ほぞん し まし た");
}

// ==========================================
// 商品管理系
// ==========================================
function renderProducts() {
    const tbody = document.getElementById('product-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    products.forEach((prod, index) => {
        const tax = prod.taxRate !== undefined ? prod.taxRate : 10;
        const ageText = prod.ageCheck ? '<span style="color:red; font-weight:bold;">🔞 対象</span>' : '<span style="color:#888;">なし</span>';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="prod-check" value="${index}" onchange="checkBulkStatus()"></td>
            <td style="font-family:monospace; font-weight:bold; color:#0066cc;">${prod.jan}</td>
            <td>${prod.name}</td>
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
        playSound('error');
        showCustomConfirm("新しい価格か税率のどちらかを入力してください。", "あたらしい かかく か ぜいりつ の どちらか を にゅうりょく し て ください。", () => {}, true);
        return;
    }

    const checks = document.querySelectorAll('.prod-check:checked');
    checks.forEach(cb => {
        const idx = parseInt(cb.value);
        if (newPriceStr !== "") products[idx].price = parseInt(newPriceStr);
        if (newTaxStr !== "") products[idx].taxRate = parseInt(newTaxStr);
    });

    localStorage.setItem('pos_products', JSON.stringify(products));
    playSound('success');
    renderProducts();
    generateCustomButtons(); 
    
    document.getElementById('bulk-price-input').value = "";
    document.getElementById('bulk-tax-input').value = "";
    document.getElementById('check-all-prods').checked = false;
    document.getElementById('bulk-edit-bar').style.display = 'none';
    speak("いっかつ てきよう し まし た");
}

function confirmBulkDelete() {
    const checks = document.querySelectorAll('.prod-check:checked');
    const count = checks.length;
    if (count === 0) return;

    let msg = count <= 5 ? "選択した商品を削除しますか？" : "本当に削除しますか？";
    let hiraMsg = count <= 5 ? "せんたく し た しょうひん を さくじょ し ます か？" : "ほんとう に さくじょ し ます か？";
    showCustomConfirm(msg, hiraMsg, (res) => {
        if (!res) return;
        const indices = Array.from(checks).map(cb => parseInt(cb.value)).sort((a,b) => b - a);
        indices.forEach(idx => products.splice(idx, 1));
        localStorage.setItem('pos_products', JSON.stringify(products));
        playSound('success');
        renderProducts();
        generateCustomButtons();
        const bulkBar = document.getElementById('bulk-edit-bar');
        if (bulkBar) bulkBar.style.display = 'none';
        speak("さくじょ し まし た");
    }, true);
}

function editSingleProduct(index) {
    playSound('click');
    editingProdIndex = index;
    const prod = products[index];
    const currentTax = prod.taxRate !== undefined ? prod.taxRate : 10;
    
    document.getElementById('edit-prod-name-display').innerText = prod.name + ' の編集';
    document.getElementById('edit-prod-price-input').value = prod.price;
    document.getElementById('edit-prod-tax-input').value = currentTax;
    document.getElementById('edit-prod-age-check').checked = !!prod.ageCheck;
    document.getElementById('edit-prod-error').style.display = 'none';
    document.getElementById('edit-prod-modal').style.display = 'flex';
    speak("しょうひん の へんこう");
}

function closeEditProdModal() {
    playSound('click');
    document.getElementById('edit-prod-modal').style.display = 'none';
    editingProdIndex = -1;
}

function saveEditProd() {
    if (editingProdIndex === -1) return;
    const newPrice = parseInt(document.getElementById('edit-prod-price-input').value);
    const newTax = parseInt(document.getElementById('edit-prod-tax-input').value);
    const newAgeCheck = document.getElementById('edit-prod-age-check').checked;
    
    if (isNaN(newPrice) || isNaN(newTax)) {
        playSound('error');
        document.getElementById('edit-prod-error').style.display = 'block';
        return;
    }
    
    document.getElementById('edit-prod-error').style.display = 'none';
    products[editingProdIndex].price = newPrice;
    products[editingProdIndex].taxRate = newTax;
    products[editingProdIndex].ageCheck = newAgeCheck;
    
    localStorage.setItem('pos_products', JSON.stringify(products));
    playSound('success');
    renderProducts();
    generateCustomButtons();
    closeEditProdModal();
    speak("ほぞん し まし た");
}

function addProduct() {
    let jan = document.getElementById('new-prod-jan').value.trim();
    const name = document.getElementById('new-prod-name').value.trim();
    const price = parseInt(document.getElementById('new-prod-price').value);
    let tax = parseInt(document.getElementById('new-prod-tax').value);
    const ageCheck = document.getElementById('new-prod-age-check').checked;
    
    if (isNaN(tax)) tax = 10;
    if(!name || isNaN(price)) { 
        playSound('error'); 
        showCustomConfirm("商品名と価格を正しく入力してください", "しょうひんめい と かかく を ただしく にゅうりょく し て ください", () => {}, true); 
        return; 
    }
    
    if (!jan) {
        let randomNum = Math.floor(Math.random() * 9000000 + 1000000);
        jan = "49" + randomNum;
    }

    if(products.some(p => p.jan === jan)) {
        playSound('error'); 
        showCustomConfirm("このJANコードは既に登録されています", "この じゃん こーど は すでに とうろく さ れ て い ます", () => {}, true); 
        return;
    }

    products.push({ id: Date.now(), jan: jan, name: name, price: price, taxRate: tax, ageCheck: ageCheck });
    localStorage.setItem('pos_products', JSON.stringify(products));
    
    document.getElementById('new-prod-jan').value = '';
    document.getElementById('new-prod-name').value = ''; 
    document.getElementById('new-prod-price').value = '';
    document.getElementById('new-prod-tax').value = '';
    document.getElementById('new-prod-age-check').checked = false;
    playSound('beep'); renderProducts();
    speak("しょうひん を ついか し まし た");
}

function deleteProduct(index) {
    showCustomConfirm(
        "この商品を削除しますか？",
        "この しょうひん を さくじょ し ます か？",
        (res) => {
            if (!res) return;
            products.splice(index, 1);
            localStorage.setItem('pos_products', JSON.stringify(products));
            playSound('click');
            renderProducts();
            generateCustomButtons();
            speak("さくじょ し まし た");
        },
        true
    );
}

function generateCustomButtons() {
    const area = document.getElementById('custom-buttons-area');
    if (!area) return;
    area.innerHTML = ''; 
    products.forEach(prod => {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        const ageBadge = prod.ageCheck ? ' <span style="color:red; font-weight:bold;">[🔞]</span>' : '';
        btn.innerHTML = `<b>${prod.name}${ageBadge}</b><small>¥${prod.price.toLocaleString()} [${prod.jan}]</small>`;
        btn.onclick = function() { 
            playSound('beep'); 
            lastScannedBarcode = prod.jan;
            checkAndAddToCart(prod); 
            const input = getJanInput();
            if (input) input.focus(); 
        };
        area.appendChild(btn);
    });
}

// 不明な商品の登録モーダル
function openUnknownProdModal(jan) {
    pendingUnknownJan = jan;
    document.getElementById('unknown-jan-display').innerText = `JAN: ${jan}`;
    document.getElementById('unknown-prod-name-input').value = "";
    document.getElementById('unknown-prod-price-input').value = "";
    document.getElementById('unknown-prod-tax-input').value = "10";
    document.getElementById('unknown-prod-age-check').checked = false;
    document.getElementById('unknown-prod-error').style.display = 'none';
    document.getElementById('unknown-prod-modal').style.display = 'flex';
    speak("かかく と ぜいりつ、 なまえ を にゅうりょく し て ください");
}

function closeUnknownProdModal() {
    playSound('click');
    document.getElementById('unknown-prod-modal').style.display = 'none';
    pendingUnknownJan = "";
    const input = getJanInput();
    if (input) input.focus();
}

function saveUnknownProd() {
    let name = document.getElementById('unknown-prod-name-input').value.trim();
    let priceInput = document.getElementById('unknown-prod-price-input').value.trim();
    const tax = parseInt(document.getElementById('unknown-prod-tax-input').value) || 10;
    const ageCheck = document.getElementById('unknown-prod-age-check').checked;

    if (priceInput === "" || isNaN(parseInt(priceInput))) {
        playSound('error');
        document.getElementById('unknown-prod-error').innerText = "価格を正しく入力してください";
        document.getElementById('unknown-prod-error').style.display = 'block';
        speak("かかく を ただしく にゅうりょく し て ください");
        return;
    }

    if (!name) {
        name = "名無しの商品";
    }
    const price = parseInt(priceInput);

    playSound('success');
    const newProd = { id: Date.now(), jan: pendingUnknownJan, name: name, price: price, taxRate: tax, ageCheck: ageCheck };
    products.push(newProd);
    localStorage.setItem('pos_products', JSON.stringify(products));
    generateCustomButtons();

    document.getElementById('unknown-prod-modal').style.display = 'none';
    checkAndAddToCart(newProd);
    pendingUnknownJan = "";
    const input = getJanInput();
    if (input) input.focus();
}

// ==========================================
// 機種移行・データ管理・ロゴ設定関連
// ==========================================
function confirmResetAllData() {
    resetStep = 1;
    showCustomConfirm(
        "【注意 1/2】商品データと履歴を初期化します（会員・店員データは保護されます）。本当によろしいですか？",
        "【ちゅうい いち の ニ】しょうひん と りれき を 初期化 し ます。",
        handleResetStep,
        true
    );
}

function handleResetStep(res) {
    if (!res) { resetStep = 0; return; }
    if (resetStep === 1) {
        resetStep = 2;
        setTimeout(() => {
            showCustomConfirm(
                "【最終確認 2/2】商品と履歴のデータが削除されます。最終確認です。",
                "【さいしゅう かくにん に の ニ】しょうひん と りれき の データ が さくじょ さ れ ます。",
                handleResetStep,
                true
            );
        }, 100);
    } else if (resetStep === 2) {
        resetStep = 0;
        products = [];
        localStorage.removeItem('pos_products');
        localStorage.removeItem('pos_history');
        
        playSound('success');
        showCustomConfirm("商品と履歴データを初期化しました。（会員データと店員データは保持されています）", "しょうひん と りれき データ を 初期化 し まし た。", () => {
            goHome();
        }, false);
    }
}

function exportAllData() {
    playSound('click');
    const dataObj = {
        clerks: clerks,
        products: products,
        customers: customers, 
        activeClerkName: activeClerkName,
        history: JSON.parse(localStorage.getItem('pos_history')) || [],
        timecards: getTimecardData(),
        apiKey: localStorage.getItem('pos_api_key') || '',
        shopLogo: localStorage.getItem('pos_shop_logo') || '' // ロゴも出力に含める
    };
    const jsonStr = JSON.stringify(dataObj);
    const importInput = document.getElementById('import-data-input');
    if (importInput) importInput.value = jsonStr;

    navigator.clipboard.writeText(jsonStr).then(() => {
        showCustomConfirm("すべてのデータを出力・コピーしました！", "すべての でーた を しゅつりょく し まし た！", () => {}, false);
    }).catch(err => {
        showCustomConfirm("コピーに失敗しました。", "こぴー に しっぱい し まし た。", () => {}, false);
    });
}

function importAllData() {
    playSound('click');
    const importInput = document.getElementById('import-data-input');
    if (!importInput) return;
    const text = importInput.value.trim();
    if (!text) { 
        showCustomConfirm("データが入力されていません。", "でーた が にゅうりょく さ れ て い ませ ん。", () => {}, false); 
        return; 
    }
    showCustomConfirm("既存のデータが上書きされます。よろしいですか？", "きそん の データ が うわがき さ れ ます。 よろしい です か？", (res) => {
        if (!res) return;
        try {
            const dataObj = JSON.parse(text);
            if (dataObj.clerks) clerks = dataObj.clerks;
            if (dataObj.products) products = dataObj.products;
            if (dataObj.customers) customers = dataObj.customers; 
            if (dataObj.activeClerkName) activeClerkName = dataObj.activeClerkName;
            if (dataObj.history) localStorage.setItem('pos_history', JSON.stringify(dataObj.history));
            if (dataObj.timecards) saveTimecardData(dataObj.timecards);
            
            if (dataObj.apiKey !== undefined) {
                localStorage.setItem('pos_api_key', dataObj.apiKey);
            }
            if (dataObj.shopLogo !== undefined) {
                localStorage.setItem('pos_shop_logo', dataObj.shopLogo);
            }

            localStorage.setItem('pos_clerks', JSON.stringify(clerks));
            localStorage.setItem('pos_products', JSON.stringify(products));
            localStorage.setItem('pos_customers', JSON.stringify(customers)); 
            localStorage.setItem('pos_active_clerk', activeClerkName);

            playSound('success');
            showCustomConfirm("データの取り込みが完了しました！", "でーた の とりこみ が かんりょう し まし た！", () => { 
                location.reload(); 
            }, false);
        } catch(e) {
            playSound('error');
            showCustomConfirm("データの形式が正しくありません。", "でーた の けいしき が ただしく あり ませ ん。", () => {}, true);
        }
    }, true);
}

// 📸 ロゴ画像アップロード関連関数
function uploadShopLogo(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Image = e.target.result;
        // 写真のデータをブラウザに保存
        localStorage.setItem('pos_shop_logo', base64Image);
        applyShopLogo();
        if(typeof playSound === 'function') playSound('success');
        showCustomConfirm("お店のロゴ画像を保存しました！", "ろご がぞう を ほぞん し まし た", () => {}, false);
    };
    reader.readAsDataURL(file);
}

function clearShopLogo() {
    localStorage.removeItem('pos_shop_logo');
    applyShopLogo();
    if(typeof playSound === 'function') playSound('click');
    showCustomConfirm("ロゴ画像を初期化しました。", "ろご がぞう を しょきか し まし た", () => {}, false);
}

function applyShopLogo() {
    const logoData = localStorage.getItem('pos_shop_logo');
    // デフォルトはヤオコーのロゴを設定
    const defaultLogo = "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Yaoko_logo.svg/512px-Yaoko_logo.svg.png";
    const logoSrc = logoData ? logoData : defaultLogo;

    // ホーム画面のロゴを更新
    const homeLogo = document.getElementById('home-shop-logo');
    if (homeLogo) {
        homeLogo.src = logoSrc;
    }

    // レシート画面のロゴを更新
    const receiptLogo = document.getElementById('receipt-preview-logo');
    if (receiptLogo) {
        receiptLogo.src = logoSrc;
    }
}

// ==========================================
// 履歴管理（閲覧制限・権限フィルター対応）
// ==========================================
function renderHistory() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let historyList = JSON.parse(localStorage.getItem('pos_history')) || [];
    
    // 一般ユーザーの場合は自分の名前の履歴のみに絞り込む
    if (currentHistoryViewer && currentHistoryViewer !== 'manager') {
        historyList = historyList.filter(rec => rec.clerk === currentHistoryViewer);
    }

    // 店長権限かどうかに応じて、XLSX出力ボタンと削除ボタンの表示を切り替える
    const exportBtn = document.querySelector('.csv-export-btn');
    const historyBtnContainer = document.querySelector('.history-btn-container');
    const isManager = (currentHistoryViewer === 'manager') || managerAuthDone || (sessionStorage.getItem('pos_manager_auth') === 'true');

    if (exportBtn) {
        exportBtn.style.display = isManager ? 'inline-block' : 'none';
    }
    if (historyBtnContainer) {
        historyBtnContainer.style.display = isManager ? 'flex' : 'none';
    }

    if (historyList.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">表示できる履歴がありません</td></tr>'; 
        return; 
    }

    historyList.forEach(rec => {
        const tr = document.createElement('tr');
        let changeInfo = rec.change !== undefined ? ` (預:¥${rec.deposit.toLocaleString()} / 釣:¥${rec.change.toLocaleString()})` : '';
        tr.innerHTML = `<td style="text-align:center;"><input type="checkbox" class="hist-check" value="${rec.id}"></td><td>${rec.date}</td><td>${rec.clerk}</td><td style="font-weight:bold; color:#d35400;">¥${rec.total.toLocaleString()}${changeInfo}</td><td>${rec.payment}</td><td style="font-size:12px;">${rec.items}</td>`;
        tbody.appendChild(tr);
    });
}

function deleteSelectedHistory() {
    // 店長権限チェック
    if (currentHistoryViewer !== 'manager' && !managerAuthDone && sessionStorage.getItem('pos_manager_auth') !== 'true') {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("履歴の削除は店長のみ可能です。", "りれき の さくじょ は てんちょう のみ かのう です。", () => {}, true);
        } else {
            alert("履歴の削除は店長のみ可能です。");
        }
        return;
    }

    const checks = document.querySelectorAll('.hist-check:checked');
    if (checks.length === 0) { 
        if (typeof playSound === 'function') playSound('error'); 
        return; 
    }
    showCustomConfirm("選択した履歴を削除しますか？", "せんたく し た りれき を さくじょ し ます か？", (res) => {
        if (!res) return;
        let historyList = JSON.parse(localStorage.getItem('pos_history')) || [];
        const ids = Array.from(checks).map(cb => parseInt(cb.value));
        historyList = historyList.filter(rec => !ids.includes(rec.id));
        localStorage.setItem('pos_history', JSON.stringify(historyList));
        if (typeof playSound === 'function') playSound('click'); 
        renderHistory();
        speak("りれき を さくじょ し まし た");
    }, true);
}

function clearAllHistory() {
    // 店長権限チェック
    if (currentHistoryViewer !== 'manager' && !managerAuthDone && sessionStorage.getItem('pos_manager_auth') !== 'true') {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("すべての履歴の削除は店長のみ可能です。", "すべての りれき の さくじょ は てんちょう のみ かのう です。", () => {}, true);
        } else {
            alert("すべての履歴の削除は店長のみ可能です。");
        }
        return;
    }

    showCustomConfirm("すべての履歴を本当に削除しますか？", "すべての りれき を ほんとう に さくじょ し ます か？", (res) => {
        if (!res) return;
        localStorage.removeItem('pos_history');
        if (typeof playSound === 'function') playSound('click'); 
        renderHistory();
        speak("すべての りれき を さくじょ し まし た");
    }, true);
}

// ==========================================
// 起動時の初期化処理・イベントリスナー
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 起動時に保存されているロゴ画像を適用する処理を追加
    applyShopLogo();

    if (sessionStorage.getItem('pos_manager_auth') === 'true') {
        managerAuthDone = true;
    }
    if (typeof updateManagerButtonState === 'function') {
        updateManagerButtonState();
    }

    const janInput = document.getElementById('jan-input');
    if (janInput) {
        let isNavigatingToCheckout = false; 

        janInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation(); 
                if (janInput.value.trim() === '') {
                    e.preventDefault();
                    if (isNavigatingToCheckout) return;
                    isNavigatingToCheckout = true;

                    if (typeof openCheckout === 'function') {
                        openCheckout();
                    }

                    setTimeout(() => {
                        isNavigatingToCheckout = false;
                    }, 500);
                } else {
                    e.preventDefault();
                    if (typeof submitInput === 'function') {
                        submitInput();
                    }
                }
            }
        });
    }
});

// ==========================================
// お会計履歴のエクセル(.xlsx)出力機能（店長限定）
// ==========================================
function exportHistorycsv() {
    try {
        if (typeof playSound === 'function') playSound('click');
        
        // 店長認証がされていない場合は処理をストップする
        if (!managerAuthDone && sessionStorage.getItem('pos_manager_auth') !== 'true') {
            if (typeof playSound === 'function') playSound('error');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("エクセル(.xlsx)の保存は店長のみ可能です。", "えくせる の ほぞん は てんちょう のみ かのう です。", () => {}, true);
            } else {
                alert("エクセル(.xlsx)の保存は店長のみ可能です。");
            }
            return;
        }
        
        const historyData = JSON.parse(localStorage.getItem('pos_history')) || [];
        if (historyData.length === 0) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("出力する履歴がありません。", "しゅつりょく する りれき が あり ませ ん。", () => {}, true);
            } else {
                alert("出力する履歴がありません。");
            }
            return;
        }

        const excelData = [];
        excelData.push(["日時", "担当者", "合計金額", "支払方法", "購入内容"]);

        historyData.forEach(item => {
            const date = item.date || '-';
            const clerk = item.clerk || '-';
            const total = item.total !== undefined ? Number(item.total) : 0;
            const payMethod = item.payment || item.payMethod || '-';
            
            let itemsText = '-';
            const rawItems = item.items || item.cart || item.product || item.goods || item.details;
            
            if (rawItems) {
                let parsedItems = rawItems;
                if (typeof rawItems === 'string') {
                    try {
                        parsedItems = JSON.parse(rawItems);
                    } catch (e) {
                        itemsText = rawItems.replace(/<[^>]*>/g, '').trim();
                    }
                }

                if (Array.isArray(parsedItems)) {
                    itemsText = parsedItems.map(i => {
                        if (typeof i === 'object' && i !== null) {
                            const name = i.name || i.title || i.productName || '商品';
                            const price = i.price !== undefined ? i.price : 0;
                            const qty = i.quantity !== undefined ? i.quantity : (i.qty || 1);
                            return `${name} (${price}円×${qty})`;
                        } else {
                            return String(i);
                        }
                    }).join(' / ');
                } else if (typeof parsedItems === 'object' && parsedItems !== null && itemsText === '-') {
                    const name = parsedItems.name || parsedItems.title || '商品';
                    const price = parsedItems.price || 0;
                    const qty = parsedItems.quantity || parsedItems.qty || 1;
                    itemsText = `${name} (${price}円×${qty})`;
                }
            }

            excelData.push([date, clerk, total, payMethod, itemsText]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(excelData);
        worksheet['!cols'] = [
            { wch: 20 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 50 }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "お会計履歴");

        const fileName = `お会計履歴_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        if (typeof playSound === 'function') playSound('success');
        if (typeof speak === 'function') speak("りれき を しゅつりょく し まし た");

    } catch (err) {
        console.error(err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("履歴の出力に失敗しました。", "りれき の しゅつりょく に しっぱい し まし た。", () => {}, true);
        }
    }
}