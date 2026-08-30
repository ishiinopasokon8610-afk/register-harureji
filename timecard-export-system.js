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
// 【フィールド名について（sync-system.jsの同期ロジックより確認済み）】
//   date: 日付, clerkName: 担当者名, clockIn/breakStart/breakEnd/clockOut: 各打刻時刻
// 「実働時間」の算出は、date + 各時刻を組み合わせて計算している。
// もし実際の打刻データの時刻フォーマットが "HH:MM" 以外の形式（例: タイムスタンプ数値）
// だった場合は、calcTimecardWorkedLabel() 内の解析部分を実データに合わせて調整してください。
// ==========================================

function getTimecardListSafe() {
    try {
        return JSON.parse(localStorage.getItem('pos_timecard') || '[]');
    } catch (e) {
        return [];
    }
}

// 出勤〜退勤（休憩を除く）の実働時間を「◯時間◯分」の文字列で返す。
// 情報が足りない、または計算がおかしい場合は空文字を返す（無理に埋めない）。
function calcTimecardWorkedLabel(rec) {
    if (!rec || !rec.date || !rec.clockIn || !rec.clockOut) return '';
    try {
        const inTime = new Date(`${rec.date}T${rec.clockIn}`);
        const outTime = new Date(`${rec.date}T${rec.clockOut}`);
        if (isNaN(inTime.getTime()) || isNaN(outTime.getTime())) return '';

        let minutes = (outTime - inTime) / 60000;

        if (rec.breakStart && rec.breakEnd) {
            const breakStart = new Date(`${rec.date}T${rec.breakStart}`);
            const breakEnd = new Date(`${rec.date}T${rec.breakEnd}`);
            if (!isNaN(breakStart.getTime()) && !isNaN(breakEnd.getTime())) {
                minutes -= (breakEnd - breakStart) / 60000;
            }
        }

        if (isNaN(minutes) || minutes < 0) return '';

        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${h}時間${m}分`;
    } catch (e) {
        return '';
    }
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
    const sorted = [...timecardList].sort((a, b) => {
        const ad = a.date || '';
        const bd = b.date || '';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.clockIn || '').localeCompare(b.clockIn || '');
    });

    const rows = sorted.map(rec => ({
        '日付': rec.date || '',
        '担当者': rec.clerkName || '',
        '出勤': rec.clockIn || '',
        '休憩開始': rec.breakStart || '',
        '休憩終了': rec.breakEnd || '',
        '退勤': rec.clockOut || '',
        '実働時間': calcTimecardWorkedLabel(rec)
    }));

    try {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet['!cols'] = [
            { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }
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
