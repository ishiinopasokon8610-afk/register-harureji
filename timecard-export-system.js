// ==========================================
// timecard-export-system.js
// タイムカード履歴の「法的なバックアップ・書き出し」機能
// ------------------------------------------
// タイムカード管理画面の「XLSX出力」ボタン（index.html側にすでに配置されていた
// exportTimecardXlsx()）の実体を実装する。
// 労働基準法の記録保存義務（3〜5年）に対応するため、pos_timecard（localStorage）
// の中身を、PCの買い替え・税務署や労働基準監督署のチェック時にも使える
// 「実ファイル（.xlsx）」として書き出せるようにする。
//
// すでに読み込まれているSheetJS（XLSX.utils / XLSX.writeFile）を利用する。
// register.js / ui.js 側の打刻ロジック本体（handleTimecardStamp など）には
// 一切手を加えず、pos_timecard を読み取るだけの独立機能として実装する。
//
// 【修正】実働時間が空欄になる不具合について
// ------------------------------------------
// 旧実装は `new Date(`${rec.date}T${rec.clockIn}`)` のように日付＋時刻を
// 組み立てて Date として解析していたが、auth-system.js が保存する
// rec.date は toLocaleDateString('ja-JP') による "2026/9/1"
// （ゼロ埋め無し・スラッシュ区切り）、rec.clockIn 等は "14:05" 形式であり、
// これらを単純に連結しても正しい日時文字列にならず、常に解析失敗（NaN）
// となって実働時間が空欄になっていた。
// 代わりに auth-system.js の calculateWorkDuration() と同じ「時刻文字列を
// 分数に変換して引き算する」方式に統一し、日付フォーマットに依存しない
// ようにした（日またぎ勤務にも対応）。
//
// 【追加】給料列
// ------------------------------------------
// clerk-wage-system.js が導入されている場合、担当者ごとに登録された時給
// (pos_clerk_wages) を使って「給料」列を追加する。時給が未登録の担当者は
// 空欄（"-"）のままにする（0円と誤解されないようにするため）。
// ==========================================

function getTimecardListSafe() {
    try {
        return JSON.parse(localStorage.getItem('pos_timecard') || '[]');
    } catch (e) {
        return [];
    }
}

// "14:05" のような "H:MM" / "HH:MM" 文字列を分数(0時からの経過分)に変換する
function parseTimecardTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':').map(Number);
    if (parts.length < 2 || parts.some(isNaN)) return null;
    return parts[0] * 60 + parts[1];
}

// 出勤〜退勤（休憩を除く）の実働時間を分単位で返す。日またぎ勤務にも対応。
// 情報が足りない、または計算がおかしい場合は null を返す（無理に埋めない）。
function calcTimecardWorkedMinutes(rec) {
    if (!rec) return null;
    const start = parseTimecardTimeToMinutes(rec.clockIn);
    let end = parseTimecardTimeToMinutes(rec.clockOut);
    if (start === null || end === null) return null;
    if (end < start) end += 24 * 60; // 日をまたいだ勤務

    let minutes = end - start;

    const bStart = parseTimecardTimeToMinutes(rec.breakStart);
    let bEnd = parseTimecardTimeToMinutes(rec.breakEnd);
    if (bStart !== null && bEnd !== null) {
        if (bEnd < bStart) bEnd += 24 * 60;
        minutes -= (bEnd - bStart);
    }

    if (isNaN(minutes) || minutes < 0) return null;
    return minutes;
}

function formatMinutesAsWorkedLabel(minutes) {
    if (minutes === null || minutes === undefined) return '';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}時間${m}分`;
}

// 後方互換のため関数名は残す（他ファイルから参照されている可能性を考慮）
function calcTimecardWorkedLabel(rec) {
    return formatMinutesAsWorkedLabel(calcTimecardWorkedMinutes(rec));
}

// 担当者名から時給を取得する。clerk-wage-system.js が無い環境では常に0扱い。
function getClerkWageSafe(clerkName) {
    if (typeof getClerkWage === 'function') {
        return getClerkWage(clerkName) || 0;
    }
    return 0;
}

// 実働分と時給から給料を算出する（円未満四捨五入）。時給未登録なら null。
function calcTimecardSalary(minutes, clerkName) {
    if (minutes === null || minutes === undefined) return null;
    const wage = getClerkWageSafe(clerkName);
    if (!wage) return null;
    return Math.round((minutes / 60) * wage);
}

function exportTimecardXlsx() {
    if (typeof playSound === 'function') playSound('click');

    if (typeof XLSX === 'undefined') {
        console.warn('SheetJS(XLSX)が読み込まれていないため、タイムカードを書き出せません。');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出し機能の読み込みに失敗しました。ページを再読み込みしてからもう一度お試しください。', 'しょだし きのう の よみこみ に しっぱい し まし た。', () => {}, false);
        }
        return;
    }

    const timecardList = getTimecardListSafe();
    if (timecardList.length === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('タイムカードの記録がまだありません。', 'たいむかーど の きろく が あり ませ ん。', () => {}, false);
        }
        return;
    }

    // 日付順（古い→新しい）に並べ替えてから書き出す（監査・提出時に見やすくするため）
    // ※ rec.date は "2026/9/1" 形式でゼロ埋めされていないため、文字列比較ではなく
    //   Date化して比較する（旧実装は文字列比較のため月・日が1桁の日付で順序が崩れる不具合もあった）。
    const toSortableDate = (dateStr) => {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? 0 : d.getTime();
    };
    const sorted = [...timecardList].sort((a, b) => {
        const ad = toSortableDate(a.date);
        const bd = toSortableDate(b.date);
        if (ad !== bd) return ad - bd;
        const at = parseTimecardTimeToMinutes(a.clockIn) || 0;
        const bt = parseTimecardTimeToMinutes(b.clockIn) || 0;
        return at - bt;
    });

    let grandTotalMinutes = 0;
    let grandTotalSalary = 0;
    let hasAnySalary = false;

    const rows = sorted.map(rec => {
        const minutes = calcTimecardWorkedMinutes(rec);
        const salary = calcTimecardSalary(minutes, rec.clerkName);
        if (minutes !== null) grandTotalMinutes += minutes;
        if (salary !== null) { grandTotalSalary += salary; hasAnySalary = true; }

        return {
            '日付': rec.date || '',
            '担当者': rec.clerkName || '',
            '出勤': rec.clockIn || '',
            '休憩開始': rec.breakStart || '',
            '休憩終了': rec.breakEnd || '',
            '退勤': rec.clockOut || '',
            '実働時間': formatMinutesAsWorkedLabel(minutes),
            '時給': getClerkWageSafe(rec.clerkName) ? `¥${getClerkWageSafe(rec.clerkName).toLocaleString()}` : '',
            '給料': salary !== null ? `¥${salary.toLocaleString()}` : ''
        };
    });

    // 合計行を末尾に追加（監査時に集計しやすいように）
    rows.push({
        '日付': '', '担当者': '合計', '出勤': '', '休憩開始': '', '休憩終了': '', '退勤': '',
        '実働時間': formatMinutesAsWorkedLabel(grandTotalMinutes),
        '時給': '',
        '給料': hasAnySalary ? `¥${grandTotalSalary.toLocaleString()}` : ''
    });

    try {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet['!cols'] = [
            { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'タイムカード');

        const today = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(workbook, `タイムカード履歴_${today}.xlsx`);

        if (typeof speak === 'function') speak('たいむかーど の りれき を しょだし し まし た');
        if (typeof playSound === 'function') playSound('success');
    } catch (err) {
        console.warn('タイムカードのXLSX書き出しに失敗しました:', err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出しに失敗しました。', 'しょだし に しっぱい し まし た。', () => {}, false);
        }
    }
}
