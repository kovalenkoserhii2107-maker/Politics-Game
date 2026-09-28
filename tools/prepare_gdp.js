'use strict';
// =====================================================================
// ВВП на душу населения — основа богатства стран в игре.
//
// Источник — Всемирный банк (NY.GDP.MKTP.CD, ВВП в текущих долларах),
// выгрузка datasets/gdp. Берётся последний известный год, делится на
// население 2024 года из tools/data/population_2024.json. Скачать и
// запустить один раз, результат — tools/data/gdp_per_capita.json:
//
//   curl -o /tmp/gdp.csv https://raw.githubusercontent.com/datasets/gdp/main/data/gdp.csv
//   node prepare_gdp.js /tmp/gdp.csv
//
// Для стран, которых нет у Всемирного банка (Тайвань, КНДР, Сомалиленд и
// т.п.), — оценки из MANUAL.
// =====================================================================
const fs = require('fs');
const path = require('path');
const worldCountries = require('world-countries');

const [, , csvFile] = process.argv;
if (!csvFile) { console.error('Использование: node prepare_gdp.js <gdp.csv>'); process.exit(1); }

// оценки ВВП на душу, $ (МВФ/ЦРУ, 2023)
const MANUAL = {
    TW: 32400, KP: 1300, XK: 5900, EH: 2500, CU: 9500, VE: 3700, ER: 650, SS: 400, YE: 530, SY: 1100,
    AF: 400, LB: 3900, PS: 3400, TM: 7600, MM: 1250, LY: 6400, SO: 600, GF: 16000, NC: 36000, PF: 22000,
    FK: 70000, GL: 58000, PR: 36000, SJ: 60000, AQ: 0, BV: 0, HM: 0, GS: 0, TF: 0, UM: 0, IO: 0,
    AI: 20000, AX: 50000, BL: 40000, CK: 20000, GG: 55000, JE: 60000, MS: 15000, NF: 20000, NU: 15000,
    PM: 40000, PN: 10000, SH: 8000, VA: 30000, VG: 40000, WF: 12000,
};

const byIso3 = new Map(worldCountries.map(c => [c.cca3, c.cca2]));
const latest = new Map();   // cc -> { year, value }
for (const line of fs.readFileSync(csvFile, 'utf8').split('\n').slice(1)) {
    const m = line.match(/^(?:"[^"]*"|[^,]*),([A-Z]{3}),(\d{4}),([\d.eE+]+)/);
    if (!m) continue;
    const cc = byIso3.get(m[1]) || (m[1] === 'XKX' ? 'XK' : null);
    if (!cc) continue;
    const year = +m[2], value = +m[3];
    const cur = latest.get(cc);
    if (!cur || year > cur.year) latest.set(cc, { year, value });
}

const population = require('./data/population_2024.json').population;
const CountriesDB = require('../js/data/CountriesDB.js').CountriesDB;
const out = {}, missing = [];
for (const cc of Object.keys(CountriesDB)) {
    const pop = population[cc] || CountriesDB[cc].population;
    const g = latest.get(cc);
    if (cc in MANUAL) out[cc] = MANUAL[cc];
    else if (g && pop > 0 && g.year >= 2015) out[cc] = Math.round(g.value / pop);
    else missing.push(cc);
}
if (missing.length) { console.error('Нет данных — допишите в MANUAL:', missing.join(' ')); process.exit(1); }
const file = path.join(__dirname, 'data', 'gdp_per_capita.json');
fs.writeFileSync(file, JSON.stringify({ source: 'World Bank NY.GDP.MKTP.CD / UN population 2024', gdp: out }, null, 0));
console.log('Стран:', Object.keys(out).length, '→', path.relative(process.cwd(), file));
for (const cc of ['US', 'CN', 'IN', 'RU', 'UA', 'DE', 'JP', 'NG', 'LU', 'QA', 'BR', 'PL', 'FR', 'GB']) console.log(' ', cc, out[cc]);
