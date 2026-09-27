'use strict';
// =====================================================================
// Настоящие границы регионов для США, Канады, России и Украины.
//
// Источник — Natural Earth admin-1 (штаты, провинции, субъекты, области):
// 1:50m для США, Канады и России, 1:10m для Украины (в 1:50m её нет).
// Скачать и запустить один раз, результат — tools/data/admin1.json:
//
//   curl -o /tmp/ne50.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson
//   curl -o /tmp/ne10.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
//   node prepare_admin1.js /tmp/ne50.geojson /tmp/ne10.geojson
//
// Объединения — чтобы не было областей размером с точку:
//   округ Колумбия → Мэриленд; Москва → Московская область;
//   Санкт-Петербург → Ленинградская; Киев → Киевская область.
// Крым с Севастополем — к Украине, как во всём игровом мире.
// =====================================================================
const fs = require('fs');
const path = require('path');
const pc = require('polygon-clipping');

const [, , file50, file10] = process.argv;
if (!file50 || !file10) {
    console.error('Использование: node prepare_admin1.js <ne_50m_admin_1.geojson> <ne_10m_admin_1.geojson>');
    process.exit(1);
}

const SOURCES = { US: 50, CA: 50, RU: 50, UA: 10 };
// в 1:50m эти регионы испорчены (у Карелии там — только островок) — из 1:10m
const FROM_10M = { RU: new Set(['Karelia']) };
// какой регион к какому присоединить (по полю name источника)
const MERGE = {
    US: { 'District of Columbia': 'Maryland' },
    RU: { 'Moskva': 'Moskovskaya', 'City of St. Petersburg': 'Leningrad' },
    UA: { 'Kiev City': 'Kiev' },
};
// из России в Украину
const TO_UA = new Set(['Crimea', 'Sevastopol']);
// названия берём готовые только для США и Канады; Россия и Украина
// называются по административному центру, как остальные области игры
// («восстание в области Чернигов»), — прописаны вручную, без транслитерации
const KEEP_NAME = new Set(['US', 'CA']);
const CAPITALS = {
    RU: {
        'Tomsk': 'Томск', 'Adygey': 'Майкоп', 'Karachay-Cherkess': 'Черкесск', 'Ingush': 'Магас', 'Kabardin-Balkar': 'Нальчик',
        'North Ossetia': 'Владикавказ', "Stavropol'": 'Ставрополь', 'Chukchi Autonomous Okrug': 'Анадырь', 'Kaliningrad': 'Калининград',
        'Murmansk': 'Мурманск', 'Novgorod': 'Великий Новгород', 'Pskov': 'Псков', 'Leningrad': 'Санкт-Петербург', 'Bryansk': 'Брянск',
        'Smolensk': 'Смоленск', 'Karelia': 'Петрозаводск', "Arkhangel'sk": 'Архангельск', 'Ivanovo': 'Иваново', 'Vologda': 'Вологда',
        'Kostroma': 'Кострома', 'Nizhegorod': 'Нижний Новгород', "Tver'": 'Тверь', "Yaroslavl'": 'Ярославль', 'Kaluga': 'Калуга',
        'Kursk': 'Курск', 'Lipetsk': 'Липецк', 'Moskovskaya': 'Москва', 'Orel': 'Орёл', 'Rostov': 'Ростов-на-Дону', 'Tula': 'Тула',
        'Volgograd': 'Волгоград', 'Belgorod': 'Белгород', 'Krasnodar': 'Краснодар', 'Mordovia': 'Саранск', 'Penza': 'Пенза',
        "Ryazan'": 'Рязань', 'Tambov': 'Тамбов', 'Vladimir': 'Владимир', 'Voronezh': 'Воронеж', 'Bashkortostan': 'Уфа',
        'Chelyabinsk': 'Челябинск', 'Kurgan': 'Курган', 'Nenets': 'Нарьян-Мар', 'Yamal-Nenets': 'Салехард', 'Komi': 'Сыктывкар',
        'Kirov': 'Киров', 'Mariy-El': 'Йошкар-Ола', 'Sverdlovsk': 'Екатеринбург', 'Udmurt': 'Ижевск', "Astrakhan'": 'Астрахань',
        'Chuvash': 'Чебоксары', 'Kalmyk': 'Элиста', 'Samara': 'Самара', 'Orenburg': 'Оренбург', 'Saratov': 'Саратов',
        'Tatarstan': 'Казань', "Ul'yanovsk": 'Ульяновск', 'Khanty-Mansiy': 'Ханты-Мансийск', 'Omsk': 'Омск', "Tyumen'": 'Тюмень',
        'Altay': 'Барнаул', 'Gorno-Altay': 'Горно-Алтайск', 'Kemerovo': 'Кемерово', 'Khakass': 'Абакан', 'Novosibirsk': 'Новосибирск',
        'Chechnya': 'Грозный', 'Dagestan': 'Махачкала', 'Irkutsk': 'Иркутск', 'Krasnoyarsk': 'Красноярск', 'Tuva': 'Кызыл',
        'Buryat': 'Улан-Удэ', 'Amur': 'Благовещенск', 'Chita': 'Чита', "Primor'ye": 'Владивосток', 'Sakha (Yakutia)': 'Якутск',
        'Yevrey': 'Биробиджан', 'Khabarovsk': 'Хабаровск', 'Maga Buryatdan': 'Магадан', 'Sakhalin': 'Южно-Сахалинск',
        "Perm'": 'Пермь', 'Kamchatka': 'Петропавловск-Камчатский',
    },
    UA: {
        'Crimea': 'Симферополь', 'Chernihiv': 'Чернигов', 'Volyn': 'Луцк', 'Rivne': 'Ровно', 'Zhytomyr': 'Житомир', 'Kiev': 'Киев',
        'Transcarpathia': 'Ужгород', 'Chernivtsi': 'Черновцы', "Ivano-Frankivs'k": 'Ивано-Франковск', 'Odessa': 'Одесса',
        'Vinnytsya': 'Винница', "L'viv": 'Львов', 'Sumy': 'Сумы', 'Kharkiv': 'Харьков', "Luhans'k": 'Луганск', "Donets'k": 'Донецк',
        'Kherson': 'Херсон', 'Zaporizhzhya': 'Запорожье', 'Mykolayiv': 'Николаев', 'Poltava': 'Полтава',
        "Khmel'nyts'kyy": 'Хмельницкий', "Ternopil'": 'Тернополь', "Dnipropetrovs'k": 'Днепр', 'Cherkasy': 'Черкассы',
        'Kirovohrad': 'Кропивницкий',
    },
};
const TOLERANCE = 0.01;   // градусы: упрощение контура, ~1 км

// Дуглас — Пекер для кольца (первая и последняя точки совпадают)
function simplifyRing(ring, tol) {
    if (ring.length <= 5) return ring;
    const keep = new Uint8Array(ring.length);
    keep[0] = keep[ring.length - 1] = 1;
    // кольцо замкнуто: сначала делим его в самой дальней от начала точке
    let far = 1, farD = -1;
    for (let i = 1; i < ring.length - 1; i++) {
        const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
        if (d > farD) { farD = d; far = i; }
    }
    keep[far] = 1;
    const stack = [[0, far], [far, ring.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        let best = -1, bestD = tol;
        const [ax, ay] = ring[a], [bx, by] = ring[b];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
        for (let i = a + 1; i < b; i++) {
            const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len;
            if (d > bestD) { bestD = d; best = i; }
        }
        if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    const out = ring.filter((_, i) => keep[i]);
    return out.length >= 4 ? out.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) : null;
}

function toMulti(geom) {
    return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

function simplifyMulti(mp) {
    const out = [];
    for (const poly of mp) {
        const rings = poly.map(r => simplifyRing(r, TOLERANCE)).filter(Boolean);
        if (rings.length) out.push(rings);
    }
    return out;
}

const read = f => JSON.parse(fs.readFileSync(f, 'utf8')).features;
const by = { 50: read(file50), 10: read(file10) };

const units = new Map();   // cc|key -> {cc, key, name, mp}
const add = (cc, key, name, mp) => {
    const id = `${cc}|${key}`;
    const cur = units.get(id);
    if (!cur) { units.set(id, { cc, key, name, mp }); return; }
    cur.mp = pc.union(cur.mp, mp);
};

for (const [cc, scale] of Object.entries(SOURCES)) {
    for (const f0 of by[scale].filter(x => x.properties.iso_a2 === cc)) {
        const fix = FROM_10M[cc] && FROM_10M[cc].has(f0.properties.name)
            && by[10].find(x => x.properties.iso_a2 === cc && x.properties.name === f0.properties.name);
        const f = fix || f0;
        const p = f.properties;
        const mp = toMulti(f.geometry);
        if (cc === 'RU' && TO_UA.has(p.name)) { add('UA', 'Crimea', null, mp); continue; }
        const target = (MERGE[cc] || {})[p.name] || p.name;
        const src = by[scale].find(x => x.properties.iso_a2 === cc && x.properties.name === target) || f;
        add(cc, target, KEEP_NAME.has(cc) ? src.properties.name_ru : null, mp);
    }
}

const out = [...units.values()].map(u => ({ cc: u.cc, key: u.key, name: u.name || (CAPITALS[u.cc] || {})[u.key] || null, mp: simplifyMulti(u.mp) }));
const unnamed = out.filter(u => !u.name).map(u => `${u.cc}:${u.key}`);
if (unnamed.length) { console.error('Нет названия:', unnamed.join(', ')); process.exit(1); }
const counts = {};
for (const u of out) counts[u.cc] = (counts[u.cc] || 0) + 1;
const file = path.join(__dirname, 'data', 'admin1.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log('Регионов:', counts, '→', path.relative(process.cwd(), file), `${(fs.statSync(file).size / 1024).toFixed(0)} КБ`);
