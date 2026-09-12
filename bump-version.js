#!/usr/bin/env node
// ==========================================
// bump-version.js
// ------------------------------------------
// 【使い方】
// GitHubへpushする直前に、リポジトリのルート（index.htmlがある場所）で
// 実行してください。
//
//     node bump-version.js
//
// 実行すると、以下の2箇所のバージョン番号の「末尾の数字」を
// 自動で1つ繰り上げます（例: 'v3.0.3' → 'v3.0.4'、'v3.0.9' → 'v3.0.10'）。
//
//   ・update-notification-system.js の APP_VERSION
//   ・sw.js の CACHE_VERSION
//     ※ こちらも一緒に上げることで、sw.js の activate処理が
//       古いキャッシュを確実に消してくれるようになります
//       （sw.js冒頭のコメント参照）。
//
// これで書き換わるのは「あなたのパソコン上にあるこの2ファイル」だけです。
// このあと、いつも通り git add / git commit / git push を行って
// GitHub Pagesへデプロイしてください。
//
// 【注意】
// このスクリプトはNode.js専用です（ブラウザでは動きません）。
// ターミナル／コマンドプロンプトで `node -v` を実行してバージョン番号が
// 表示されれば、追加のインストール作業なしでそのまま使えます。
// ==========================================

const fs = require('fs');
const path = require('path');

const NOTIFICATION_FILE = path.join(__dirname, 'update-notification-system.js');
const SW_FILE = path.join(__dirname, 'sw.js');

// 'v3.0.3' のような文字列の「末尾の数字部分」だけを1つ繰り上げる
// （末尾が数字でない特殊な値の場合は null を返す）
function bumpLastNumberSegment(versionStr) {
    const match = versionStr.match(/^(.*?)(\d+)$/);
    if (!match) return null;
    const prefix = match[1];
    const lastNumber = parseInt(match[2], 10);
    return `${prefix}${lastNumber + 1}`;
}

function bumpVersionInFile(filePath, constName) {
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠ ${path.basename(filePath)} が見つかりませんでした（このスクリプトと同じフォルダに置いてありますか？）`);
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const re = new RegExp(`(const\\s+${constName}\\s*=\\s*')([^']+)(')`);
    const match = content.match(re);
    if (!match) {
        console.warn(`⚠ ${path.basename(filePath)} 内に ${constName} が見つかりませんでした。`);
        return null;
    }

    const oldVersion = match[2];
    const newVersion = bumpLastNumberSegment(oldVersion);
    if (!newVersion) {
        console.warn(`⚠ ${constName}="${oldVersion}" の末尾が数字ではないため、自動では繰り上げられませんでした。手動で書き換えてください。`);
        return null;
    }

    const newContent = content.replace(re, `$1${newVersion}$3`);
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`✅ ${path.basename(filePath)}: ${constName} を ${oldVersion} → ${newVersion} に更新しました。`);
    return newVersion;
}

function main() {
    console.log('バージョン番号を自動で繰り上げます…\n');

    const newAppVersion = bumpVersionInFile(NOTIFICATION_FILE, 'APP_VERSION');
    const newCacheVersion = bumpVersionInFile(SW_FILE, 'CACHE_VERSION');

    if (newAppVersion || newCacheVersion) {
        console.log('\nこの後、いつも通り git add / git commit / git push を行ってください。');
        console.log('push後しばらくすると、開いたままの他端末にも更新通知が表示されます。');
    } else {
        console.log('\n何も更新されませんでした。ファイルの場所や中身をご確認ください。');
        process.exitCode = 1;
    }
}

main();
