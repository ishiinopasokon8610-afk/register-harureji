// ==========================================
// wage-payroll-system.js
// タイムカードの記録から「給与計算」を行う機能
// ------------------------------------------
// 【できること】
//   ① データ管理画面に「💰 給与管理」ボタンを追加。
//      押すと、雇用区分（アルバイト／パート／従業員）ごとに
//        ・平日 1時間あたりいくらか（時給）
//        ・休日 1時間あたりいくらか（休日時給）
//        ・平日 1日あたりいくらか（日給・固定給にしたい場合）
//        ・休日 1日あたりいくらか（休日日給）
//        ・計算方法（時給で計算する／日給で計算する）
//      を設定し、「設定を保存」ボタンで保存できる。
//   ② 担当者管理画面に、担当者ごとの雇用区分（アルバイト／パート／従業員）を
//      選ぶだけの簡単な一覧を追加（誰にいくら、ではなく「その人がどの区分か」だけ選ぶ）。
//   ③ タイムカード管理画面に「給与計算」ボタンを追加。
//      押すと、担当者を選んで（または全員まとめて）、その人のタイムカード記録から
//      実働時間 × 設定した単価で給与を自動計算し、金額をすぐに表示する。
//      出勤記録（出勤〜退勤）が無い日は、その日の分の給与は付与されない。
//   ④ タイムカード管理画面に「有給登録」ボタンを追加。
//      出勤していなくても給与を支払いたい日（有給休暇など）を、担当者・日付を
//      指定して登録できる。登録された日は、給与管理で設定した「日給」欄の金額
//      （平日/休日）がそのままその日の給与として合算される。
//      （同じ日にすでに出勤記録がある場合は、二重支給を避けるため無視される）
//
// 【土日＝休日という前提について】
//   本システムのタイムカードには「休日かどうか」のフラグが無いため、
//   便宜上「土曜・日曜」を休日、それ以外を平日として計算する。
//   祝日等を休日扱いにしたい場合は、この方式では対応できない点に注意。
//
// register.js / ui.js / timecard-export-system.js は直接編集せず、
// 他の追加機能ファイルと同じ「フック方式・後付けブロック方式」で実現する。
// ==========================================

const WAGE_RATES_KEY = 'pos_wage_rates';
const CLERK_EMPLOYMENT_TYPE_KEY = 'pos_clerk_employment_types';
const PAID_LEAVE_KEY = 'pos_paid_leave'; // 有給登録: [{ clerkName, date }, ...]

// 雇用区分の定義（表示名とデフォルト単価）
const EMPLOYMENT_TYPES = [
    { id: 'baito', label: 'アルバイト' },
    { id: 'part', label: 'パート' },
    { id: 'staff', label: '従業員' }
];
const DEFAULT_EMPLOYMENT_TYPE = 'staff';

function getDefaultWageRates() {
    const rates = {};
    EMPLOYMENT_TYPES.forEach(t => {
        rates[t.id] = {
            mode: 'hourly',        // 'hourly'（時給で計算） or 'daily'（日給固定で計算）
            weekdayHourly: 1000,   // 平日 1時間あたり(円)
            holidayHourly: 1000,   // 休日 1時間あたり(円)
            weekdayDaily: 8000,    // 平日 1日あたり(円)
            holidayDaily: 8000     // 休日 1日あたり(円)
        };
    });
    return rates;
}

function getWageRates() {
    try {
        const saved = JSON.parse(localStorage.getItem(WAGE_RATES_KEY) || 'null');
        if (!saved) return getDefaultWageRates();
        // 将来的に雇用区分が増減しても壊れないよう、デフォルト値とマージしておく
        const defaults = getDefaultWageRates();
        EMPLOYMENT_TYPES.forEach(t => {
            defaults[t.id] = Object.assign({}, defaults[t.id], saved[t.id] || {});
        });
        return defaults;
    } catch (e) {
        return getDefaultWageRates();
    }
}

function saveWageRates(rates) {
    localStorage.setItem(WAGE_RATES_KEY, JSON.stringify(rates));
}

function getClerkEmploymentTypes() {
    try {
        return JSON.parse(localStorage.getItem(CLERK_EMPLOYMENT_TYPE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function saveClerkEmploymentTypes(map) {
    localStorage.setItem(CLERK_EMPLOYMENT_TYPE_KEY, JSON.stringify(map));
}

function getEmploymentTypeForClerk(clerkName) {
    const map = getClerkEmploymentTypes();
    return map[clerkName] || DEFAULT_EMPLOYMENT_TYPE;
}

function getEmploymentTypeLabel(typeId) {
    const found = EMPLOYMENT_TYPES.find(t => t.id === typeId);
    return found ? found.label : typeId;
}

/* =========================================================
   有給登録（出勤していなくても給与を支払う日）
   ========================================================= */

function getPaidLeaveList() {
    try {
        return JSON.parse(localStorage.getItem(PAID_LEAVE_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function savePaidLeaveList(list) {
    localStorage.setItem(PAID_LEAVE_KEY, JSON.stringify(list));
}

// 有給を登録する。同じ担当者・同じ日の重複登録は防ぐ。
function registerPaidLeaveEntry(clerkName, dateStr) {
    if (!clerkName || !dateStr) return false;
    const list = getPaidLeaveList();
    const exists = list.some(r => r.clerkName === clerkName && r.date === dateStr);
    if (exists) return false;
    list.push({ clerkName, date: dateStr });
    savePaidLeaveList(list);
    return true;
}

function deletePaidLeaveEntry(clerkName, dateStr) {
    const list = getPaidLeaveList().filter(r => !(r.clerkName === clerkName && r.date === dateStr));
    savePaidLeaveList(list);
}

/* =========================================================
   共通ユーティリティ
   ========================================================= */

function getTimecardListForPayroll() {
    try {
        return JSON.parse(localStorage.getItem('pos_timecard') || '[]');
    } catch (e) {
        return [];
    }
}

// 土曜(6)・日曜(0)を休日とみなす
function isHolidayDateForPayroll(dateStr) {
    const d = parseDateOnlyRobust(dateStr);
    if (!d) return false;
    const day = d.getDay();
    return day === 0 || day === 6;
}

// 日付文字列（"2024-01-05" "2024/1/5" など区切り文字や0埋めの有無を問わない）を
// year/month/dayの数値に分解してからDateを組み立てる。
// 「日付＋時刻」を文字列連結して new Date() に渡す方式は、区切り文字や
// 桁数（0埋めの有無）によってブラウザ・端末ごとに解析結果が変わり、
// 実働時間が正しく算出できないことがあるため、ここで自前パースする。
function parseDateOnlyRobust(dateStr) {
    if (!dateStr) return null;
    const parts = String(dateStr).trim().split(/[\/\-年月]/).map(s => s.trim()).filter(s => s !== '').map(s => parseInt(s, 10));
    if (parts.length < 3 || parts.some(isNaN)) return null;
    const [y, mo, da] = parts;
    const d = new Date(y, mo - 1, da);
    if (isNaN(d.getTime())) return null;
    return d;
}

// 時刻文字列（"9:5" "09:05" "09:05:32" など）を [時, 分, 秒] に分解する
function parseTimeOnlyRobust(timeStr) {
    if (!timeStr) return null;
    const parts = String(timeStr).trim().split(/[:：時分]/).map(s => s.trim()).filter(s => s !== '').map(s => parseInt(s, 10));
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return { h: parts[0], m: parts[1], s: parts[2] || 0 };
}

// 日付＋時刻を組み合わせて実際のDateオブジェクトを作る（上の2つの自前パーサーを利用）
function combineDateAndTimeRobust(dateStr, timeStr) {
    const datePart = parseDateOnlyRobust(dateStr);
    const timePart = parseTimeOnlyRobust(timeStr);
    if (!datePart || !timePart) return null;
    const d = new Date(datePart.getFullYear(), datePart.getMonth(), datePart.getDate(), timePart.h, timePart.m, timePart.s);
    if (isNaN(d.getTime())) return null;
    return d;
}

// 出勤〜退勤（休憩を除く）の実働「分数」を返す。算出できない場合はnull。
function calcWorkedMinutesForPayroll(rec) {
    if (!rec || !rec.date || !rec.clockIn || !rec.clockOut) return null;
    try {
        const inTime = combineDateAndTimeRobust(rec.date, rec.clockIn);
        const outTime = combineDateAndTimeRobust(rec.date, rec.clockOut);
        if (!inTime || !outTime) return null;

        let minutes = (outTime - inTime) / 60000;

        if (rec.breakStart && rec.breakEnd) {
            const breakStart = combineDateAndTimeRobust(rec.date, rec.breakStart);
            const breakEnd = combineDateAndTimeRobust(rec.date, rec.breakEnd);
            if (breakStart && breakEnd) {
                minutes -= (breakEnd - breakStart) / 60000;
            }
        }

        if (isNaN(minutes) || minutes < 0) return null;
        return minutes;
    } catch (e) {
        return null;
    }
}

// 1件のタイムカード記録の給与（円）を計算する
function calcPayForRecord(rec, wageRates) {
    const minutes = calcWorkedMinutesForPayroll(rec);
    if (minutes === null) return 0;

    const typeId = getEmploymentTypeForClerk(rec.clerkName);
    const config = wageRates[typeId] || getDefaultWageRates()[DEFAULT_EMPLOYMENT_TYPE];
    const holiday = isHolidayDateForPayroll(rec.date);

    if (config.mode === 'daily') {
        return holiday ? (Number(config.holidayDaily) || 0) : (Number(config.weekdayDaily) || 0);
    }

    const hourlyRate = holiday ? (Number(config.holidayHourly) || 0) : (Number(config.weekdayHourly) || 0);
    return Math.round((minutes / 60) * hourlyRate);
}

// 指定した担当者（clerkName未指定なら全員）の給与を集計する
// 出勤記録（実働）と、有給登録の両方を合算する
function calculatePayroll(clerkName) {
    const list = getTimecardListForPayroll();
    const leaveList = getPaidLeaveList();
    const wageRates = getWageRates();

    const target = clerkName ? list.filter(r => r.clerkName === clerkName) : list;
    const targetLeave = clerkName ? leaveList.filter(r => r.clerkName === clerkName) : leaveList;

    const byClerk = {};

    function ensureClerkRow(name) {
        if (!byClerk[name]) {
            byClerk[name] = {
                clerkName: name, totalPay: 0, totalMinutes: 0,
                dayCount: 0, leaveDayCount: 0,
                employmentType: getEmploymentTypeForClerk(name)
            };
        }
        return byClerk[name];
    }

    // ① 出勤記録（出勤〜退勤）が無い日はそもそも実働0分・給与0円になるため、
    //    「出勤記録が無ければ支給なし」は自動的に守られる。
    target.forEach(rec => {
        const name = rec.clerkName || '(不明)';
        const pay = calcPayForRecord(rec, wageRates);
        const minutes = calcWorkedMinutesForPayroll(rec) || 0;

        const row = ensureClerkRow(name);
        row.totalPay += pay;
        row.totalMinutes += minutes;
        if (minutes > 0 || pay > 0) row.dayCount += 1;
    });

    // ② 有給登録：出勤記録が無い日にのみ、設定済みの「日給」欄の金額を加算する
    //    （同じ日にすでに出勤記録がある場合は、二重支給を避けるため無視する）
    targetLeave.forEach(rec => {
        const name = rec.clerkName || '(不明)';

        const alreadyWorked = target.some(r =>
            r.clerkName === name && r.date === rec.date && calcWorkedMinutesForPayroll(r) !== null
        );
        if (alreadyWorked) return;

        const typeId = getEmploymentTypeForClerk(name);
        const config = wageRates[typeId] || getDefaultWageRates()[DEFAULT_EMPLOYMENT_TYPE];
        const holiday = isHolidayDateForPayroll(rec.date);
        const leavePay = holiday ? (Number(config.holidayDaily) || 0) : (Number(config.weekdayDaily) || 0);

        const row = ensureClerkRow(name);
        row.totalPay += leavePay;
        row.leaveDayCount += 1;
    });

    const rows = Object.values(byClerk).sort((a, b) => a.clerkName.localeCompare(b.clerkName, 'ja'));
    const grandTotal = rows.reduce((sum, r) => sum + r.totalPay, 0);

    return { rows, grandTotal };
}

function formatYen(n) {
    return `¥${Math.round(n || 0).toLocaleString()}`;
}

function formatMinutesAsHM(totalMinutes) {
    const m = Math.round(totalMinutes || 0);
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${h}時間${rem}分`;
}

/* =========================================================
   ① データ管理画面：「給与管理」ボタン＋設定モーダル
   ========================================================= */

function ensurePayrollSettingsButtonBlock() {
    if (document.getElementById('payroll-settings-entry-block')) return;
    const container = document.getElementById('migration-screen');
    if (!container) return;

    const block = document.createElement('div');
    block.id = 'payroll-settings-entry-block';
    block.className = 'migration-block';
    block.style.cssText = 'background:#e8f5e9; border:2px solid #66bb6a; padding:15px; border-radius:6px; margin-top:15px;';
    block.innerHTML = `
        <h3 class="migration-title" style="color:#2e7d32;">💰 給与管理</h3>
        <p style="font-size:13px; color:#555; margin:0 0 10px;">雇用区分（アルバイト／パート／従業員）ごとに、平日・休日の時給や日給を設定できます。</p>
        <button onclick="openPayrollSettingsModal()" style="background:#43a047; color:white; border:none; padding:10px 16px; border-radius:4px; font-weight:bold; cursor:pointer;">給与管理を開く</button>
    `;
    container.appendChild(block);
}

function ensurePayrollSettingsModal() {
    if (document.getElementById('payroll-settings-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'payroll-settings-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '2500';

    let sectionsHtml = '';
    EMPLOYMENT_TYPES.forEach(t => {
        sectionsHtml += `
        <div style="border:1px solid #ddd; border-radius:6px; padding:12px; margin-bottom:12px; text-align:left;">
            <h4 style="margin:0 0 8px; color:#2e7d32;">${escapeHtml(t.label)}</h4>
            <label style="display:block; font-size:13px; font-weight:bold; margin-bottom:6px;">
                計算方法：
                <select id="wage-mode-${t.id}" class="modal-input small" style="width:auto; display:inline-block; margin-left:6px;" onchange="updateWageModeFieldsVisibility('${t.id}')">
                    <option value="hourly">時給で計算</option>
                    <option value="daily">日給（固定）で計算</option>
                </select>
            </label>
            <div id="wage-hourly-fields-${t.id}" style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <label style="font-size:12px;">平日 時給(円/時間)
                    <input type="number" id="wage-weekday-hourly-${t.id}" class="modal-input small" min="0" step="1">
                </label>
                <label style="font-size:12px;">休日 時給(円/時間)
                    <input type="number" id="wage-holiday-hourly-${t.id}" class="modal-input small" min="0" step="1">
                </label>
            </div>
            <div id="wage-daily-fields-${t.id}" style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <label style="font-size:12px;">平日 日給(円/日)
                    <input type="number" id="wage-weekday-daily-${t.id}" class="modal-input small" min="0" step="1">
                </label>
                <label style="font-size:12px;">休日 日給(円/日)
                    <input type="number" id="wage-holiday-daily-${t.id}" class="modal-input small" min="0" step="1">
                </label>
            </div>
        </div>`;
    });

    modal.innerHTML = `
        <div class="modal-box large" style="width:380px;">
            <h3 class="modal-title" style="color:#2e7d32;">💰 給与設定</h3>
            <p class="modal-desc" style="font-size:12px; color:#777;">土曜・日曜を「休日」として計算します。</p>
            ${sectionsHtml}
            <div class="modal-btn-group">
                <button onclick="closePayrollSettingsModal()" class="modal-btn cancel">キャンセル</button>
                <button onclick="savePayrollSettingsFromModal()" class="modal-btn primary">設定を保存</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function openPayrollSettingsModal() {
    if (typeof playSound === 'function') playSound('click');
    ensurePayrollSettingsModal();

    const rates = getWageRates();
    EMPLOYMENT_TYPES.forEach(t => {
        const config = rates[t.id];
        const modeEl = document.getElementById(`wage-mode-${t.id}`);
        if (modeEl) modeEl.value = config.mode || 'hourly';
        setInputValue(`wage-weekday-hourly-${t.id}`, config.weekdayHourly);
        setInputValue(`wage-holiday-hourly-${t.id}`, config.holidayHourly);
        setInputValue(`wage-weekday-daily-${t.id}`, config.weekdayDaily);
        setInputValue(`wage-holiday-daily-${t.id}`, config.holidayDaily);
        updateWageModeFieldsVisibility(t.id);
    });

    document.getElementById('payroll-settings-modal').style.display = 'flex';
}

// 「計算方法」の選択に応じて、時給欄／日給欄のどちらか一方だけを表示する
function updateWageModeFieldsVisibility(typeId) {
    const modeEl = document.getElementById(`wage-mode-${typeId}`);
    const mode = modeEl ? modeEl.value : 'hourly';
    const hourlyBlock = document.getElementById(`wage-hourly-fields-${typeId}`);
    const dailyBlock = document.getElementById(`wage-daily-fields-${typeId}`);
    if (hourlyBlock) hourlyBlock.style.display = (mode === 'hourly') ? 'grid' : 'none';
    if (dailyBlock) dailyBlock.style.display = (mode === 'daily') ? 'grid' : 'none';
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = (value === undefined || value === null) ? '' : value;
}

function closePayrollSettingsModal() {
    const modal = document.getElementById('payroll-settings-modal');
    if (modal) modal.style.display = 'none';
}

function savePayrollSettingsFromModal() {
    const rates = getWageRates();

    // 選択中の計算方法に応じて必要な欄が空欄でないかを確認する
    // （使わない方の欄は未入力でもエラーにしない）
    const missingLabels = [];
    EMPLOYMENT_TYPES.forEach(t => {
        const modeEl = document.getElementById(`wage-mode-${t.id}`);
        const mode = modeEl ? modeEl.value : 'hourly';

        if (mode === 'hourly') {
            if (!isFilledNumberInput(`wage-weekday-hourly-${t.id}`)) missingLabels.push(`${t.label}：平日 時給`);
            if (!isFilledNumberInput(`wage-holiday-hourly-${t.id}`)) missingLabels.push(`${t.label}：休日 時給`);
        } else {
            if (!isFilledNumberInput(`wage-weekday-daily-${t.id}`)) missingLabels.push(`${t.label}：平日 日給`);
            if (!isFilledNumberInput(`wage-holiday-daily-${t.id}`)) missingLabels.push(`${t.label}：休日 日給`);
        }
    });

    if (missingLabels.length > 0) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                `入力してください（未入力の項目）：\n${missingLabels.join('\n')}`,
                'にゅうりょく し て ください',
                () => {},
                true
            );
        }
        return;
    }

    EMPLOYMENT_TYPES.forEach(t => {
        const modeEl = document.getElementById(`wage-mode-${t.id}`);
        rates[t.id] = {
            mode: modeEl ? modeEl.value : 'hourly',
            weekdayHourly: Number(document.getElementById(`wage-weekday-hourly-${t.id}`).value) || 0,
            holidayHourly: Number(document.getElementById(`wage-holiday-hourly-${t.id}`).value) || 0,
            weekdayDaily: Number(document.getElementById(`wage-weekday-daily-${t.id}`).value) || 0,
            holidayDaily: Number(document.getElementById(`wage-holiday-daily-${t.id}`).value) || 0
        };
    });

    saveWageRates(rates);
    closePayrollSettingsModal();

    if (typeof playSound === 'function') playSound('success');
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm('給与設定を保存しました。', 'きゅうよ せってい を ほぞん し まし た。', () => {}, false);
    }
}

// 入力欄が空欄でないか（数値として入力済みか）を確認する
function isFilledNumberInput(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    return el.value !== '' && el.value !== null && !isNaN(Number(el.value));
}

/* =========================================================
   ② 担当者管理画面：担当者ごとの雇用区分を選ぶだけの一覧
   ========================================================= */

function ensureClerkEmploymentTypeBlock() {
    const container = document.getElementById('clerk-screen');
    if (!container) return;

    let block = document.getElementById('clerk-employment-type-block');
    if (!block) {
        block = document.createElement('div');
        block.id = 'clerk-employment-type-block';
        block.className = 'migration-block';
        block.style.cssText = 'background:#f1f8e9; border:2px solid #9ccc65; padding:15px; border-radius:6px; margin-top:20px;';
        block.innerHTML = `
            <h3 class="migration-title" style="color:#33691e;">💰 雇用区分（給与計算用）</h3>
            <p style="font-size:12px; color:#555; margin:0 0 10px;">各担当者を「アルバイト・パート・従業員」のどれにするか選んでください。単価そのものは「データ管理」内の給与管理で設定します。</p>
            <table class="data-table">
                <thead><tr><th>担当者名</th><th>雇用区分</th></tr></thead>
                <tbody id="clerk-employment-type-tbody"></tbody>
            </table>
        `;
        container.appendChild(block);
    }

    renderClerkEmploymentTypeList();
}

function renderClerkEmploymentTypeList() {
    const tbody = document.getElementById('clerk-employment-type-tbody');
    if (!tbody) return;
    const clerkList = (typeof clerks !== 'undefined' && Array.isArray(clerks)) ? clerks : [];
    const typeMap = getClerkEmploymentTypes();

    if (clerkList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#999;">担当者が登録されていません</td></tr>';
        return;
    }

    tbody.innerHTML = clerkList.map(c => {
        const current = typeMap[c.name] || DEFAULT_EMPLOYMENT_TYPE;
        const options = EMPLOYMENT_TYPES.map(t =>
            `<option value="${t.id}" ${t.id === current ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
        ).join('');
        return `
            <tr>
                <td>${escapeHtml(c.name)}</td>
                <td><select class="modal-input small" style="width:auto;" onchange="setClerkEmploymentType('${escapeHtml(c.name).replace(/'/g, "\\'")}', this.value)">${options}</select></td>
            </tr>
        `;
    }).join('');
}

function setClerkEmploymentType(clerkName, typeId) {
    const map = getClerkEmploymentTypes();
    map[clerkName] = typeId;
    saveClerkEmploymentTypes(map);
    if (typeof playSound === 'function') playSound('click');
}

/* =========================================================
   ③ タイムカード画面：「給与計算」ボタン＋結果モーダル
   ========================================================= */

function ensurePayrollCalcButton() {
    if (document.getElementById('payroll-calc-btn')) return;
    const exportBtn = document.getElementById('timecard-export-btn');
    if (!exportBtn || !exportBtn.parentNode) return;

    const btn = document.createElement('button');
    btn.id = 'payroll-calc-btn';
    btn.className = 'csv-export-btn';
    btn.style.background = '#2e7d32';
    btn.style.marginLeft = '8px'; // csv-export-btnのmargin-left:autoを打ち消し、XLSX出力ボタンのすぐ右に並べる
    btn.innerText = '💰 給与計算';
    btn.onclick = openPayrollCalcModal;
    exportBtn.parentNode.insertBefore(btn, exportBtn.nextSibling);
}

/* =========================================================
   ④ タイムカード画面：「有給登録」ボタン＋登録モーダル
   ========================================================= */

function ensurePaidLeaveButton() {
    if (document.getElementById('paid-leave-btn')) return;
    // 給与計算ボタンの右隣に置く（無ければXLSX出力ボタンの右隣に置く）
    const anchorBtn = document.getElementById('payroll-calc-btn') || document.getElementById('timecard-export-btn');
    if (!anchorBtn || !anchorBtn.parentNode) return;

    const btn = document.createElement('button');
    btn.id = 'paid-leave-btn';
    btn.className = 'csv-export-btn';
    btn.style.background = '#0288d1';
    btn.style.marginLeft = '8px';
    btn.innerText = '🏖️ 有給登録';
    btn.onclick = openPaidLeaveModal;
    anchorBtn.parentNode.insertBefore(btn, anchorBtn.nextSibling);
}

function ensurePaidLeaveModal() {
    if (document.getElementById('paid-leave-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'paid-leave-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '2500';
    modal.innerHTML = `
        <div class="modal-box large" style="width:360px;">
            <h3 class="modal-title" style="color:#0277bd;">🏖️ 有給登録</h3>
            <p style="font-size:12px; color:#777; margin-top:0;">出勤していない日でも、この日は給与を支払いたい（有給休暇など）という日を登録します。金額は「給与管理」の日給欄が使われます。</p>
            <label style="font-size:13px; font-weight:bold; display:block; margin-bottom:8px;">
                担当者：
                <select id="paid-leave-clerk-select" class="modal-input" style="margin-top:6px;"></select>
            </label>
            <label style="font-size:13px; font-weight:bold; display:block; margin-bottom:8px;">
                日付：
                <input type="date" id="paid-leave-date-input" class="modal-input" style="margin-top:6px;">
            </label>
            <div class="modal-btn-group" style="margin-bottom:12px;">
                <button onclick="closePaidLeaveModal()" class="modal-btn cancel">閉じる</button>
                <button onclick="submitPaidLeaveEntry()" class="modal-btn primary">登録する</button>
            </div>
            <h4 style="margin:10px 0 6px; font-size:13px;">登録済みの有給</h4>
            <div id="paid-leave-list" style="max-height:180px; overflow-y:auto;"></div>
        </div>
    `;
    document.body.appendChild(modal);
}

function openPaidLeaveModal() {
    if (typeof playSound === 'function') playSound('click');
    ensurePaidLeaveModal();

    const select = document.getElementById('paid-leave-clerk-select');
    const clerkList = (typeof clerks !== 'undefined' && Array.isArray(clerks)) ? clerks : [];
    select.innerHTML = clerkList.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');

    const dateInput = document.getElementById('paid-leave-date-input');
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

    renderPaidLeaveList();
    document.getElementById('paid-leave-modal').style.display = 'flex';
}

function closePaidLeaveModal() {
    const modal = document.getElementById('paid-leave-modal');
    if (modal) modal.style.display = 'none';
}

function submitPaidLeaveEntry() {
    const select = document.getElementById('paid-leave-clerk-select');
    const dateInput = document.getElementById('paid-leave-date-input');
    const clerkName = select ? select.value : '';
    const dateStr = dateInput ? dateInput.value : '';

    if (!clerkName || !dateStr) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('担当者と日付を入力してください。', 'たんとうしゃ と ひづけ を にゅうりょく し て ください。', () => {}, true);
        }
        return;
    }

    const added = registerPaidLeaveEntry(clerkName, dateStr);
    if (!added) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('その担当者・日付はすでに登録されています。', 'すでに とうろく さ れ て い ます。', () => {}, true);
        }
        return;
    }

    if (typeof playSound === 'function') playSound('success');
    renderPaidLeaveList();
}

function renderPaidLeaveList() {
    const listEl = document.getElementById('paid-leave-list');
    if (!listEl) return;

    const list = getPaidLeaveList().slice().sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1; // 新しい日付順
        return a.clerkName.localeCompare(b.clerkName, 'ja');
    });

    if (list.length === 0) {
        listEl.innerHTML = '<p style="color:#999; font-size:12px;">登録済みの有給はありません。</p>';
        return;
    }

    listEl.innerHTML = list.map(r => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 4px; border-bottom:1px solid #eee; font-size:13px;">
            <span>${escapeHtml(r.date)}　${escapeHtml(r.clerkName)}</span>
            <button onclick="removePaidLeaveEntry('${escapeHtml(r.clerkName).replace(/'/g, "\\'")}', '${r.date}')" style="background:#e53935; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:12px; cursor:pointer;">削除</button>
        </div>
    `).join('');
}

function removePaidLeaveEntry(clerkName, dateStr) {
    deletePaidLeaveEntry(clerkName, dateStr);
    if (typeof playSound === 'function') playSound('click');
    renderPaidLeaveList();
}

function ensurePayrollCalcModal() {
    if (document.getElementById('payroll-calc-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'payroll-calc-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '2500';
    modal.innerHTML = `
        <div class="modal-box large" style="width:360px;">
            <h3 class="modal-title" style="color:#2e7d32;">💰 給与計算</h3>
            <label style="font-size:13px; font-weight:bold; display:block; margin-bottom:10px;">
                対象の担当者：
                <select id="payroll-calc-clerk-select" class="modal-input" style="margin-top:6px;" onchange="runPayrollCalc()"></select>
            </label>
            <div id="payroll-calc-result" style="text-align:left; font-size:14px; margin-top:10px;"></div>
            <div class="modal-btn-group" style="margin-top:15px;">
                <button onclick="closePayrollCalcModal()" class="modal-btn cancel">閉じる</button>
                <button onclick="runPayrollCalc()" class="modal-btn primary">計算する</button>
            </div>
            <div class="modal-btn-group" style="margin-top:8px;">
                <button onclick="exportPayrollCalcXlsx()" style="width:100%; background:#ff9800; color:white; border:none; padding:10px; border-radius:4px; font-weight:bold; cursor:pointer;">📄 この結果をXLSXで保存</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function openPayrollCalcModal() {
    if (typeof playSound === 'function') playSound('click');
    ensurePayrollCalcModal();

    const select = document.getElementById('payroll-calc-clerk-select');
    const clerkList = (typeof clerks !== 'undefined' && Array.isArray(clerks)) ? clerks : [];
    select.innerHTML = '<option value="">全員まとめて</option>' +
        clerkList.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');

    document.getElementById('payroll-calc-result').innerHTML = '';
    document.getElementById('payroll-calc-modal').style.display = 'flex';
    runPayrollCalc();
}

function closePayrollCalcModal() {
    const modal = document.getElementById('payroll-calc-modal');
    if (modal) modal.style.display = 'none';
}

// 直近に計算した結果を保持しておく（XLSX出力時に、画面表示と同じ内容を書き出すため）
let lastPayrollCalcResult = null;
let lastPayrollCalcClerkName = '';

function runPayrollCalc() {
    const select = document.getElementById('payroll-calc-clerk-select');
    const clerkName = select ? select.value : '';
    const resultEl = document.getElementById('payroll-calc-result');
    if (!resultEl) return;

    const { rows, grandTotal } = calculatePayroll(clerkName || null);
    lastPayrollCalcResult = { rows, grandTotal };
    lastPayrollCalcClerkName = clerkName || '';

    if (rows.length === 0) {
        resultEl.innerHTML = '<p style="color:#999;">対象のタイムカード記録がありません。</p>';
        return;
    }

    let html = '';
    if (!clerkName) {
        html += '<table class="data-table" style="font-size:12px;"><thead><tr><th>担当者</th><th>区分</th><th>実働</th><th>有給</th><th>給与</th></tr></thead><tbody>';
        rows.forEach(r => {
            html += `<tr><td>${escapeHtml(r.clerkName)}</td><td>${escapeHtml(getEmploymentTypeLabel(r.employmentType))}</td><td>${formatMinutesAsHM(r.totalMinutes)}</td><td>${r.leaveDayCount}日</td><td>${formatYen(r.totalPay)}</td></tr>`;
        });
        html += '</tbody></table>';
        html += `<p style="font-weight:bold; font-size:16px; margin-top:10px; text-align:right;">合計：${formatYen(grandTotal)}</p>`;
    } else {
        const r = rows[0];
        html += `
            <p>雇用区分：<b>${escapeHtml(getEmploymentTypeLabel(r.employmentType))}</b></p>
            <p>実働時間の合計：<b>${formatMinutesAsHM(r.totalMinutes)}</b></p>
            <p>有給：<b>${r.leaveDayCount}日</b></p>
            <p style="font-weight:bold; font-size:20px; color:#2e7d32; text-align:center; margin-top:10px;">${formatYen(r.totalPay)}</p>
        `;
    }

    resultEl.innerHTML = html;
    if (typeof playSound === 'function') playSound('success');
}

// 直近の給与計算結果をXLSXファイルとして書き出す（すでに読み込まれているSheetJSを利用）
function exportPayrollCalcXlsx() {
    if (typeof playSound === 'function') playSound('click');

    if (typeof XLSX === 'undefined') {
        console.warn('SheetJS(XLSX)が読み込まれていないため、給与計算結果を書き出せません。');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出し機能の読み込みに失敗しました。ページを再読み込みしてからもう一度お試しください。', 'しょだし きのう の よみこみ に しっぱい し まし た。', () => {}, false);
        }
        return;
    }

    // まだ一度も「計算する」を押していない場合は、現在の選択内容で計算してから書き出す
    if (!lastPayrollCalcResult) runPayrollCalc();
    if (!lastPayrollCalcResult || lastPayrollCalcResult.rows.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('対象のタイムカード記録がありません。', 'たいしょう の きろく が あり ませ ん。', () => {}, false);
        }
        return;
    }

    const { rows, grandTotal } = lastPayrollCalcResult;

    const dataRows = rows.map(r => ({
        '担当者': r.clerkName,
        '雇用区分': getEmploymentTypeLabel(r.employmentType),
        '実働時間': formatMinutesAsHM(r.totalMinutes),
        '出勤日数': r.dayCount,
        '有給日数': r.leaveDayCount,
        '給与': r.totalPay
    }));
    // 合計行を末尾に追加する
    dataRows.push({
        '担当者': '合計', '雇用区分': '', '実働時間': '', '出勤日数': '', '有給日数': '', '給与': grandTotal
    });

    try {
        const worksheet = XLSX.utils.json_to_sheet(dataRows);
        worksheet['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 12 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '給与計算');

        const today = new Date().toISOString().slice(0, 10);
        const namePart = lastPayrollCalcClerkName ? `_${lastPayrollCalcClerkName}` : '_全員';
        XLSX.writeFile(workbook, `給与計算${namePart}_${today}.xlsx`);

        if (typeof speak === 'function') speak('きゅうよ けいさん の けっか を しょだし し まし た');
        if (typeof playSound === 'function') playSound('success');
    } catch (err) {
        console.warn('給与計算結果のXLSX書き出しに失敗しました:', err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出しに失敗しました。', 'しょだし に しっぱい し まし た。', () => {}, false);
        }
    }
}

/* =========================================================
   初期化・画面表示フック
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
    function tryInit() {
        if (typeof document.getElementById('timecard-export-btn') === 'undefined') {
            setTimeout(tryInit, 300);
            return;
        }
        ensurePayrollCalcButton();
        ensurePaidLeaveButton();
        ensurePayrollSettingsButtonBlock();
    }
    setTimeout(tryInit, 200);
});

(function hookShowScreenForPayroll() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') ensurePayrollSettingsButtonBlock();
            if (screenId === 'clerk-screen') ensureClerkEmploymentTypeBlock();
            if (screenId === 'timecard-screen') { ensurePayrollCalcButton(); ensurePaidLeaveButton(); }
            return result;
        };
    }
    tryHook();
})();
