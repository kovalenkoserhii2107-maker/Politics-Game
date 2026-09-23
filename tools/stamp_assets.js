'use strict';
// =====================================================================
// Метки версий для стилей и скриптов в index.html
//
// GitHub Pages отдаёт файлы с кэшем на 10 минут, и браузер телефона после
// обновления может взять новый index.html и стили, но старые скрипты —
// получается смесь двух версий (старые значки войск под новыми стилями).
// Поэтому каждая ссылка на css/ и js/ получает ?v=<хэш содержимого>:
// изменился файл — изменилась ссылка — браузер обязан скачать его заново.
//
//   node tools/stamp_assets.js          — проставить метки
//   node tools/stamp_assets.js --check  — только проверить (для тестов)
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const ASSET = /((?:src|href)=")((?:css|js)\/[^"?]+)(?:\?v=[^"]*)?(")/g;

function hashOf(file) {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 10);
}

function stamp(html) {
    return html.replace(ASSET, (_, before, file, after) => `${before}${file}?v=${hashOf(file)}${after}`);
}

if (require.main === module) {
    const html = fs.readFileSync(INDEX, 'utf8');
    const next = stamp(html);
    if (process.argv.includes('--check')) {
        if (next !== html) {
            console.error('Метки версий в index.html устарели: запустите node tools/stamp_assets.js');
            process.exit(1);
        }
        console.log('Метки версий актуальны');
    } else {
        fs.writeFileSync(INDEX, next);
        const count = (next.match(ASSET) || []).length;
        console.log(next === html ? `Метки уже актуальны (${count} файлов)` : `Метки обновлены (${count} файлов)`);
    }
}

module.exports = { stamp };
