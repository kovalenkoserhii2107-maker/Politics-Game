#!/usr/bin/env node
'use strict';
// =====================================================================
// ГЕНЕРАТОР КАРТЫ
//
//   node tools/build_map.js
//
// Делит каждую страну на области сеткой квадратов, обрезанной по границе
// государства; число областей зависит от площади страны (Россия — 20,
// Украина — 5, Молдова — 2, совсем малые — 1). Куски мельче 30% средней
// площади области присоединяются к соседу с самой длинной общей границей.
// На выходе — js/data/*.js, которые игра грузит напрямую.
// =====================================================================

const fs = require('fs');
const path = require('path');
const pc = require('polygon-clipping');
const G = require('./lib/geo');
const source = require('./lib/source');
const T = require('./lib/translit');
const allCities = require('all-the-cities');

const OUT_DIR = path.join(__dirname, '..', 'js', 'data');

// --- правило деления -------------------------------------------------
const AREA_RU = 17098242;          // км², опорная точка: Россия -> 20 областей
const N_MAX = 20;
const EXPONENT = Math.log(4) / Math.log(AREA_RU / 603500);   // Украина -> 5
const SMALL_PIECE = 0.30;          // порог «мелкого куска» от средней площади

// --- параметры геометрии ---------------------------------------------
const SAMPLE_STEP = 0.04;          // px, шаг обхода границы
const CELL_HASH = 0.12;            // px, ячейка хеша для поиска общих границ
const SEA_LINK_KM = 120;           // максимальная длина морской переправы

function targetRegionCount(country) {
    if (country.uninhabited) return 1;
    const area = country.areaKm2 > 0 ? country.areaKm2 : country.drawnAreaKm2;
    const n = Math.round(N_MAX * Math.pow(area / AREA_RU, EXPONENT));
    return Math.max(1, Math.min(N_MAX, n));
}

// --- нарезка страны сеткой -------------------------------------------
function gridPieces(mp, cell) {
    const [x1, y1, x2, y2] = G.bboxOf(mp);
    const out = [];
    const i1 = Math.floor(x1 / cell), i2 = Math.ceil(x2 / cell);
    const j1 = Math.floor(y1 / cell), j2 = Math.ceil(y2 / cell);
    for (let i = i1; i < i2; i++) {
        for (let j = j1; j < j2; j++) {
            const rect = [[
                [i * cell, j * cell], [(i + 1) * cell, j * cell],
                [(i + 1) * cell, (j + 1) * cell], [i * cell, (j + 1) * cell],
                [i * cell, j * cell],
            ]];
            let res;
            try { res = pc.intersection(mp, [rect]); } catch (e) { continue; }
            for (const poly of res) {
                const piece = [poly];
                if (G.polyAreaPx(piece) > 1e-7) out.push(piece);
            }
        }
    }
    return out;
}

function partition(mp, n) {
    const areaPx = G.polyAreaPx(mp);
    if (n <= 1) return [mp];
    let cell = Math.sqrt(areaPx / n);
    let pieces = gridPieces(mp, cell);
    for (let guard = 0; pieces.length < n && guard < 16; guard++) {
        cell *= 0.85;
        pieces = gridPieces(mp, cell);
    }
    return pieces;
}

// --- обход границы: точки и хеш-ячейки -------------------------------
function boundaryCells(mp, step = SAMPLE_STEP, cell = CELL_HASH) {
    const cells = new Set();
    for (const poly of mp) {
        for (const ring of poly) {
            for (let i = 0, n = ring.length - 1; i < n; i++) {
                const a = ring[i], b = ring[i + 1];
                const dx = b[0] - a[0], dy = b[1] - a[1];
                const len = Math.hypot(dx, dy);
                const k = Math.max(1, Math.ceil(len / step));
                for (let s = 0; s < k; s++) {
                    const x = a[0] + (dx * s) / k, y = a[1] + (dy * s) / k;
                    cells.add(`${Math.round(x / cell)},${Math.round(y / cell)}`);
                }
            }
        }
    }
    return cells;
}

function sharedCells(a, b) {
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    let n = 0;
    for (const k of small) if (big.has(k)) n++;
    return n;
}

// --- слияние мелких кусков -------------------------------------------
function mergePieces(pieces, targetN, avgAreaPx) {
    const items = pieces.map(mp => ({
        mp,
        area: G.polyAreaPx(mp),
        cells: boundaryCells(mp),
        centroid: G.centroidOf(mp),
    }));

    while (items.length > 1) {
        let smallest = 0;
        for (let i = 1; i < items.length; i++) if (items[i].area < items[smallest].area) smallest = i;

        const tooMany = items.length > targetN;
        const tooSmall = items[smallest].area < SMALL_PIECE * avgAreaPx;
        if (!tooMany && !tooSmall) break;

        const src = items[smallest];
        // сосед с самой длинной общей границей; если соседей нет — ближайший по центру
        let best = -1, bestShared = 0;
        for (let i = 0; i < items.length; i++) {
            if (i === smallest) continue;
            const sh = sharedCells(src.cells, items[i].cells);
            if (sh > bestShared) { bestShared = sh; best = i; }
        }
        if (best < 0) {
            let bestDist = Infinity;
            for (let i = 0; i < items.length; i++) {
                if (i === smallest) continue;
                const d = Math.hypot(src.centroid[0] - items[i].centroid[0], src.centroid[1] - items[i].centroid[1]);
                if (d < bestDist) { bestDist = d; best = i; }
            }
        }
        if (best < 0) break;

        const dst = items[best];
        let merged;
        try { merged = pc.union(dst.mp, src.mp); } catch (e) { merged = dst.mp.concat(src.mp); }
        dst.mp = merged;
        dst.area = G.polyAreaPx(merged);
        for (const k of src.cells) dst.cells.add(k);
        dst.centroid = G.centroidOf(merged);
        items.splice(smallest, 1);
    }
    return items;
}

// --- города ----------------------------------------------------------
function buildCityIndex() {
    const ctx = {};
    require('vm').createContext(ctx);
    require('vm').runInContext(
        fs.readFileSync(path.join(__dirname, 'data', 'cities_legacy.js'), 'utf8') + ';globalThis.C=CitiesDB;',
        ctx
    );
    const ruByCc = {};
    for (const c of ctx.C) {
        const cc = c.regionId.split('-')[0];
        (ruByCc[cc] = ruByCc[cc] || []).push(c);
    }

    const latByCc = {};
    for (const c of allCities) (latByCc[c.country] = latByCc[c.country] || []).push(c);

    // Выверенный справочник для стран, которых нет в исходной CitiesDB.
    const curated = require('./data/cities_ru.json');
    const flat = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
    const capitals = new Map();
    for (const c of require('world-countries')) {
        if (c.capital && c.capital[0]) capitals.set(c.cca2, flat(c.capital[0]));
    }

    const out = {};   // cc -> [{name, x, y, population, isCapital}]
    for (const cc of Object.keys(latByCc)) {
        const pool = latByCc[cc];
        const skeletons = pool.map(c => T.skeleton(c.name));
        const used = new Set();
        const list = [];
        for (const ru of (ruByCc[cc] || [])) {
            const sk = T.ruSkeleton(ru.name);
            let best = -1, bs = 0;
            for (let i = 0; i < pool.length; i++) {
                if (used.has(i)) continue;
                const s = T.similarity(sk, skeletons[i]);
                if (s > bs) { bs = s; best = i; }
            }
            if (best >= 0 && bs >= 0.62) {
                used.add(best);
                const c = pool[best];
                list.push({
                    name: ru.name,
                    x: G.lonToX(c.loc.coordinates[0]),
                    y: G.latToY(c.loc.coordinates[1]),
                    population: c.population,
                    isCapital: !!ru.isCapital,
                });
            }
        }
        const table = curated[cc];
        if (table) {
            const byFlat = new Map(Object.keys(table).map(k => [flat(k), table[k]]));
            const known = new Set(list.map(c => c.name));
            for (const c of pool) {
                const ru = byFlat.get(flat(c.name));
                if (!ru || known.has(ru)) continue;
                known.add(ru);
                list.push({
                    name: ru,
                    x: G.lonToX(c.loc.coordinates[0]),
                    y: G.latToY(c.loc.coordinates[1]),
                    population: c.population,
                    isCapital: false,
                });
            }
        }
        const capFlat = capitals.get(cc);
        if (capFlat) {
            for (const c of pool) {
                if (flat(c.name) !== capFlat) continue;
                const x = G.lonToX(c.loc.coordinates[0]);
                const near = list.find(v => Math.hypot(v.x - x, v.y - G.latToY(c.loc.coordinates[1])) < 0.2);
                if (near) near.isCapital = true;
                break;
            }
        }
        list.sort((a, b) => b.population - a.population);
        out[cc] = list;
    }
    return out;
}

// --- запасные названия областей --------------------------------------
const DIRS = [
    ['Северо-Западн', 'Северн', 'Северо-Восточн'],
    ['Западн', 'Центральн', 'Восточн'],
    ['Юго-Западн', 'Южн', 'Юго-Восточн'],
];

function adjEnding(countryName) {
    const n = countryName.trim();
    if (/(ы|и)$/.test(n)) return 'ые';
    if (/(ия|я|а|ь)$/.test(n)) return 'ая';
    if (/(о|е)$/.test(n)) return 'ое';
    return 'ый';
}

function mainlandBox(mp) {
    let best = null, bestArea = 0;
    for (const poly of mp) {
        const a = Math.abs(G.ringArea(poly[0]));
        if (a > bestArea) { bestArea = a; best = poly; }
    }
    return best ? G.bboxOf([best]) : G.bboxOf(mp);
}

// --- ресурсы (детерминированно от id) --------------------------------
const OIL = { RU: 4, KZ: 3, IQ: 5, IR: 5, SA: 6, KW: 5, QA: 5, AZ: 4, NO: 4, OM: 3, LY: 4, DZ: 3, TM: 3, VE: 5, NG: 4, US: 3, CA: 3, AE: 5, BR: 2, MX: 2, AO: 3, EC: 2, CO: 2 };
const INDUSTRIAL = new Set(['DE', 'GB', 'RU', 'CN', 'JP', 'KR', 'IT', 'PL', 'CZ', 'SE', 'NL', 'BE', 'AT', 'US', 'FR', 'CH', 'TW', 'SG', 'UA', 'IN', 'TR', 'ES', 'CA', 'MX', 'BR', 'TH', 'MY', 'ID', 'VN']);

function hash01(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
}

function main() {
    const started = Date.now();
    console.log('Загружаем Natural Earth 1:50m…');
    const countries = source.load();
    reassignCrimea(countries);

    console.log('Индексируем города…');
    const cityIndex = buildCityIndex();

    const regions = [];      // {id, cc, name, mp, areaKm2, cx, cy, cells}
    const perCountry = {};

    console.log('Делим страны на области…');
    for (const country of countries) {
        const n = targetRegionCount(country);
        const areaPx = G.polyAreaPx(country.mp);
        const pieces = partition(country.mp, n);
        const items = mergePieces(pieces, n, areaPx / n);

        // крупные области первыми — стабильная и осмысленная нумерация
        items.sort((a, b) => b.area - a.area);

        const list = [];
        items.forEach((it, idx) => {
            const anchor = G.pointOnSurface(it.mp);
            list.push({
                id: `${country.cc}-${idx + 1}`,
                cc: country.cc,
                mp: it.mp,
                areaPx: it.area,
                areaKm2: G.areaKm2(it.mp, 120),
                cx: anchor[0],
                cy: anchor[1],
                cells: it.cells,
                bbox: G.bboxOf(it.mp),
                labelRadius: Math.sqrt(it.area / Math.PI),
            });
        });
        perCountry[country.cc] = list;
        regions.push(...list);
        process.stdout.write(`\r  ${country.cc}: ${list.length}/${n} обл.        `);
    }
    console.log(`\r  готово: ${regions.length} областей в ${countries.length} странах        `);

    console.log('Присваиваем названия по городам…');
    nameRegions(countries, perCountry, cityIndex);

    console.log('Считаем население и ресурсы…');
    distributeStats(countries, perCountry, cityIndex);

    console.log('Ищем соседей…');
    const neighbors = buildNeighbors(regions, perCountry);

    console.log('Записываем js/data/…');
    writeOutput(countries, regions, perCountry, neighbors, cityIndex);

    console.log(`Готово за ${((Date.now() - started) / 1000).toFixed(1)} с.`);
}

// Natural Earth относит Крым к России; исходная карта игры — к Украине.
// Сохраняем прежнее состояние игрового мира.
function reassignCrimea(countries) {
    const ru = countries.find(c => c.cc === 'RU');
    const ua = countries.find(c => c.cc === 'UA');
    if (!ru || !ua) return;
    const box = [[
        [G.lonToX(32.0), G.latToY(46.25)], [G.lonToX(36.60), G.latToY(46.25)],
        [G.lonToX(36.60), G.latToY(44.30)], [G.lonToX(32.0), G.latToY(44.30)],
        [G.lonToX(32.0), G.latToY(46.25)],
    ]];
    let crimea;
    try { crimea = pc.intersection(ru.mp, [box]); } catch (e) { return; }
    if (!crimea.length) return;
    const moved = G.areaKm2(crimea);
    ru.mp = pc.difference(ru.mp, [box]);
    ua.mp = pc.union(ua.mp, crimea);
    ru.drawnAreaKm2 = G.areaKm2(ru.mp);
    ua.drawnAreaKm2 = G.areaKm2(ua.mp);
    console.log(`  Крым (${Math.round(moved)} км²) отнесён к Украине, как на исходной карте.`);
}

function nameRegions(countries, perCountry, cityIndex) {
    for (const country of countries) {
        const list = perCountry[country.cc] || [];
        const cities = (cityIndex[country.cc] || []).slice();
        const bbox = mainlandBox(country.mp);
        const taken = new Set();

        // 1. каждой области — крупнейший город внутри неё
        for (const region of list) {
            let best = null;
            for (const c of cities) {
                if (taken.has(c.name)) continue;
                if (c.x < region.bbox[0] || c.x > region.bbox[2] || c.y < region.bbox[1] || c.y > region.bbox[3]) continue;
                if (!G.pointInMulti([c.x, c.y], region.mp)) continue;
                if (!best || c.population > best.population) best = c;
            }
            if (best) { region.name = best.name; region.capitalCity = best; taken.add(best.name); }
        }
        // 2. остальным — свободный крупный город страны, иначе сторона света
        const leftover = [];
        for (const region of list) {
            if (region.name) continue;
            const free = cities.find(c => !taken.has(c.name));
            if (free) { region.name = free.name; taken.add(free.name); }
            else leftover.push(region);
        }
        if (leftover.length === 1 && list.length === 1) leftover[0].name = country.name;
        else assignDirectional(leftover, country.name, bbox);

        // страховка от совпадений внутри страны
        const seen = new Set();
        for (const region of list) {
            let name = region.name;
            let k = 2;
            while (seen.has(name)) name = `${region.name} ${k++}`;
            region.name = name;
            seen.add(name);
        }
    }
}

// Раздаём сторонам света непересекающиеся ячейки 3x3: каждой безымянной
// области — свой сектор страны, поэтому названия не повторяются.
function assignDirectional(regions, countryName, bbox) {
    if (!regions.length) return;
    const [x1, y1, x2, y2] = bbox;
    const clamp = v => Math.max(0, Math.min(1, v));
    const items = regions.map(r => ({
        region: r,
        fx: clamp(x2 > x1 ? (r.cx - x1) / (x2 - x1) : 0.5),
        fy: clamp(y2 > y1 ? (r.cy - y1) / (y2 - y1) : 0.5),
    }));
    const slots = [];
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) slots.push({ row, col, fx: (col + 0.5) / 3, fy: (row + 0.5) / 3 });
    }
    const pairs = [];
    items.forEach((it, i) => slots.forEach((sl, j) => {
        pairs.push([Math.hypot(it.fx - sl.fx, it.fy - sl.fy), i, j]);
    }));
    pairs.sort((a, b) => a[0] - b[0]);

    const usedItem = new Set(), usedSlot = new Set();
    for (const [, i, j] of pairs) {
        if (usedItem.has(i) || usedSlot.has(j)) continue;
        usedItem.add(i); usedSlot.add(j);
        items[i].region.name = sectorName(countryName, slots[j]);
    }
    // если областей больше девяти — ближайший сектор, уникальность добавит вызывающий
    for (let i = 0; i < items.length; i++) {
        if (usedItem.has(i)) continue;
        let best = slots[0], bestD = Infinity;
        for (const sl of slots) {
            const d = Math.hypot(items[i].fx - sl.fx, items[i].fy - sl.fy);
            if (d < bestD) { bestD = d; best = sl; }
        }
        items[i].region.name = sectorName(countryName, best);
    }
}

function sectorName(countryName, slot) {
    const stem = DIRS[slot.row][slot.col];
    return `${stem}${adjEnding(countryName)} ${countryName}`;
}

function distributeStats(countries, perCountry, cityIndex) {
    for (const country of countries) {
        const list = perCountry[country.cc] || [];
        if (!list.length) continue;
        const cities = cityIndex[country.cc] || [];

        for (const region of list) {
            region.cityPop = 0;
            for (const c of cities) {
                if (c.x < region.bbox[0] || c.x > region.bbox[2] || c.y < region.bbox[1] || c.y > region.bbox[3]) continue;
                if (G.pointInMulti([c.x, c.y], region.mp)) region.cityPop += c.population;
            }
        }
        const totalCity = list.reduce((s, r) => s + r.cityPop, 0);
        const totalArea = list.reduce((s, r) => s + r.areaKm2, 0) || 1;
        const countryPop = country.population || Math.round(totalCity * 1.6) || list.length * 50000;

        for (const region of list) {
            const urban = totalCity > 0 ? region.cityPop / totalCity : 0;
            const rural = region.areaKm2 / totalArea;
            const share = totalCity > 0 ? 0.72 * urban + 0.28 * rural : rural;
            region.population = Math.max(1000, Math.round(countryPop * share));

            const density = region.population / Math.max(1, region.areaKm2);
            const noise = hash01(region.id);
            const indBase = INDUSTRIAL.has(country.cc) ? 18 : 8;
            region.industry = Math.max(1, Math.round(indBase * (0.5 + noise) * Math.min(3, 0.4 + Math.sqrt(density) / 6)));
            region.agro = Math.max(1, Math.round((12 + 55 * hash01(region.id + 'a')) * Math.min(1.6, 0.5 + region.areaKm2 / 200000)));
            region.oil = OIL[country.cc] ? Math.round(OIL[country.cc] * (0.4 + 1.2 * hash01(region.id + 'o'))) : 0;
        }
    }
}

function buildNeighbors(regions, perCountry) {
    const index = new Map();          // ячейка -> [индексы областей]
    regions.forEach((r, i) => {
        for (const key of r.cells) {
            let bucket = index.get(key);
            if (!bucket) index.set(key, bucket = []);
            bucket.push(i);
        }
    });

    const links = regions.map(() => new Set());
    const link = (a, b) => { if (a !== b) { links[a].add(b); links[b].add(a); } };

    // 1. сухопутное соседство: общие или смежные ячейки границы
    regions.forEach((r, i) => {
        for (const key of r.cells) {
            const [kx, ky] = key.split(',').map(Number);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const bucket = index.get(`${kx + dx},${ky + dy}`);
                    if (bucket) for (const j of bucket) link(i, j);
                }
            }
        }
    });

    // 2. морские переправы: короткие промежутки через воду
    addSeaLinks(regions, links);

    // 3. страховка: у каждой области есть хотя бы один сосед,
    //    и области одной страны образуют связный граф
    ensureConnectivity(regions, perCountry, links);

    const out = {};
    regions.forEach((r, i) => {
        out[r.id] = [...links[i]].map(j => regions[j].id).sort();
    });
    return out;
}

function seaPoints(region, step = 0.25) {
    const pts = [];
    for (const poly of region.mp) {
        for (const ring of poly) {
            for (let i = 0, n = ring.length - 1; i < n; i++) {
                const a = ring[i], b = ring[i + 1];
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                const k = Math.max(1, Math.ceil(len / step));
                for (let s = 0; s < k; s++) {
                    pts.push([a[0] + ((b[0] - a[0]) * s) / k, a[1] + ((b[1] - a[1]) * s) / k]);
                }
            }
        }
    }
    return pts;
}

function pxPerKm(y) { return 1 / ((G.R_EARTH / G.K) * Math.cos(G.yToLat(y) * Math.PI / 180)); }

function addSeaLinks(regions, links) {
    const CELL = 2.0;
    const grid = new Map();
    const pts = regions.map(r => seaPoints(r));
    pts.forEach((list, i) => {
        for (const p of list) {
            const key = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
            let bucket = grid.get(key);
            if (!bucket) grid.set(key, bucket = []);
            bucket.push([p[0], p[1], i]);
        }
    });

    regions.forEach((r, i) => {
        const reach = SEA_LINK_KM * pxPerKm(r.cy);
        const span = Math.ceil(reach / CELL);
        const found = new Map();
        for (const p of pts[i]) {
            const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
            for (let dx = -span; dx <= span; dx++) {
                for (let dy = -span; dy <= span; dy++) {
                    const bucket = grid.get(`${gx + dx},${gy + dy}`);
                    if (!bucket) continue;
                    for (const [qx, qy, j] of bucket) {
                        if (j === i || links[i].has(j)) continue;
                        const d = Math.hypot(p[0] - qx, p[1] - qy);
                        if (d <= reach && d < (found.get(j) ?? Infinity)) found.set(j, d);
                    }
                }
            }
        }
        for (const j of found.keys()) { links[i].add(j); links[j].add(i); }
    });
}

function ensureConnectivity(regions, perCountry, links) {
    const nearestLink = (aIdx, candidates) => {
        let best = -1, bestD = Infinity;
        for (const j of candidates) {
            if (j === aIdx) continue;
            const d = Math.hypot(regions[aIdx].cx - regions[j].cx, regions[aIdx].cy - regions[j].cy);
            if (d < bestD) { bestD = d; best = j; }
        }
        if (best >= 0) { links[aIdx].add(best); links[best].add(aIdx); }
    };

    const indexOf = new Map();
    regions.forEach((r, i) => indexOf.set(r.id, i));

    // связность внутри страны
    for (const cc of Object.keys(perCountry)) {
        const idx = perCountry[cc].map(r => indexOf.get(r.id));
        if (idx.length < 2) continue;
        const inCountry = new Set(idx);
        let remaining = new Set(idx);
        const components = [];
        while (remaining.size) {
            const start = remaining.values().next().value;
            const comp = new Set([start]);
            const queue = [start];
            while (queue.length) {
                const cur = queue.pop();
                for (const nb of links[cur]) {
                    if (inCountry.has(nb) && !comp.has(nb)) { comp.add(nb); queue.push(nb); }
                }
            }
            for (const c of comp) remaining.delete(c);
            components.push([...comp]);
        }
        // приклеиваем каждую отдельную часть к ближайшей области главной части
        if (components.length > 1) {
            components.sort((a, b) => b.length - a.length);
            const main = new Set(components[0]);
            for (let c = 1; c < components.length; c++) {
                let bestA = -1, bestB = -1, bestD = Infinity;
                for (const a of components[c]) {
                    for (const b of main) {
                        const d = Math.hypot(regions[a].cx - regions[b].cx, regions[a].cy - regions[b].cy);
                        if (d < bestD) { bestD = d; bestA = a; bestB = b; }
                    }
                }
                if (bestA >= 0) {
                    links[bestA].add(bestB); links[bestB].add(bestA);
                    for (const x of components[c]) main.add(x);
                }
            }
        }
    }

    // одиночки без соседей
    const all = regions.map((_, i) => i);
    regions.forEach((_, i) => { if (links[i].size === 0) nearestLink(i, all); });
}

// --- вывод -----------------------------------------------------------
function pathData(mp, digits = 2) {
    const parts = [];
    for (const poly of mp) {
        for (const ring of poly) {
            let d = '';
            for (let i = 0; i < ring.length - 1; i++) {
                d += (i === 0 ? 'M' : 'L') + ring[i][0].toFixed(digits) + ',' + ring[i][1].toFixed(digits);
            }
            if (d) parts.push(d + 'Z');
        }
    }
    return parts.join('');
}

const HEADER = '// СГЕНЕРИРОВАНО tools/build_map.js — не редактировать вручную.\n';

function writeOutput(countries, regions, perCountry, neighbors, cityIndex) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const palette = buildPalette(countries, countryAdjacency(regions, neighbors));

    // --- CountriesDB ---
    let s = HEADER + 'const CountriesDB = {\n';
    for (const c of countries) {
        const n = (perCountry[c.cc] || []).length;
        s += `  '${c.cc}': { name: ${q(c.name)}, color: '${palette[c.cc]}', regions: ${n},`
           + ` area: ${Math.round(c.areaKm2)}, population: ${c.population || 0},`
           + ` playable: ${!c.uninhabited && !!c.sovereign && n > 0},`
           + ` money: 2000000, influence: 50, taxRate: 0.05 },\n`;
    }
    s += '};\n\nif (typeof module !== \'undefined\' && module.exports) module.exports = { CountriesDB };\n';
    fs.writeFileSync(path.join(OUT_DIR, 'CountriesDB.js'), s);

    // --- RegionsDB ---
    s = HEADER + 'const RegionsDB = {\n';
    for (const r of regions) {
        s += `  '${r.id}': { name: ${q(r.name)}, cc: '${r.cc}', cx: ${r.cx.toFixed(2)}, cy: ${r.cy.toFixed(2)},`
           + ` area: ${Math.round(r.areaKm2)}, r: ${r.labelRadius.toFixed(2)}, population: ${r.population},`
           + ` agro: ${r.agro}, industry: ${r.industry}, oil: ${r.oil},`
           + ` path: '${pathData(r.mp)}' },\n`;
    }
    s += '};\n\nif (typeof module !== \'undefined\' && module.exports) module.exports = { RegionsDB };\n';
    fs.writeFileSync(path.join(OUT_DIR, 'RegionsDB.js'), s);

    // --- NeighborsDB ---
    s = HEADER + 'const NeighborsDB = {\n';
    for (const r of regions) {
        const list = neighbors[r.id] || [];
        s += `  '${r.id}': [${list.map(x => `'${x}'`).join(',')}],\n`;
    }
    s += '};\n\nif (typeof module !== \'undefined\' && module.exports) module.exports = { NeighborsDB };\n';
    fs.writeFileSync(path.join(OUT_DIR, 'NeighborsDB.js'), s);

    // --- CitiesDB ---
    const cityRows = [];
    for (const c of countries) {
        const list = perCountry[c.cc] || [];
        const cities = (cityIndex[c.cc] || []).slice(0, Math.max(6, list.length * 2));
        for (const city of cities) {
            const region = list.find(r =>
                city.x >= r.bbox[0] && city.x <= r.bbox[2] && city.y >= r.bbox[1] && city.y <= r.bbox[3] &&
                G.pointInMulti([city.x, city.y], r.mp));
            if (!region) continue;
            cityRows.push(`  { name: ${q(city.name)}, regionId: '${region.id}', cc: '${c.cc}',`
                + ` x: ${city.x.toFixed(2)}, y: ${city.y.toFixed(2)},`
                + ` population: ${city.population}, isCapital: ${city.isCapital} },`);
        }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'CitiesDB.js'),
        HEADER + 'const CitiesDB = [\n' + cityRows.join('\n') + '\n];\n\n'
        + 'if (typeof module !== \'undefined\' && module.exports) module.exports = { CitiesDB };\n');

    report(countries, regions, perCountry, neighbors, cityRows.length);
}

function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

// Соседние страны не должны сливаться по цвету, поэтому раскрашиваем
// граф соседства жадно: каждой стране — оттенок, максимально далёкий
// от уже занятых её соседями.
function buildPalette(countries, adjacency) {
    const swatches = [];
    for (let hue = 0; hue < 360; hue += 24) {
        swatches.push({ h: hue, s: 62, l: 52 });
        swatches.push({ h: hue + 12, s: 44, l: 38 });
        swatches.push({ h: hue + 6, s: 72, l: 66 });
    }

    const order = countries.slice().sort((a, b) =>
        (adjacency[b.cc] ? adjacency[b.cc].size : 0) - (adjacency[a.cc] ? adjacency[a.cc].size : 0));

    const chosen = {};
    for (const country of order) {
        const neighbours = [...(adjacency[country.cc] || [])].map(cc => chosen[cc]).filter(Boolean);
        let best = swatches[0], bestScore = -1;
        swatches.forEach((sw, i) => {
            let score = Infinity;
            for (const nb of neighbours) score = Math.min(score, swatchDistance(sw, nb));
            if (!neighbours.length) score = 1000 - i;          // без соседей — просто по порядку
            score += (hash01(country.cc + i) * 4);             // мягкое разнообразие
            if (score > bestScore) { bestScore = score; best = sw; }
        });
        chosen[country.cc] = best;
    }

    const out = {};
    for (const country of countries) {
        const sw = chosen[country.cc] || swatches[0];
        out[country.cc] = hslToHex(sw.h % 360, sw.s, sw.l);
    }
    return out;
}

function swatchDistance(a, b) {
    const dh = Math.abs(a.h - b.h) % 360;
    return Math.min(dh, 360 - dh) + Math.abs(a.l - b.l) * 1.5;
}

// Граф соседства стран выводим из соседства областей.
function countryAdjacency(regions, neighbors) {
    const ccOf = new Map(regions.map(r => [r.id, r.cc]));
    const adjacency = {};
    for (const [id, list] of Object.entries(neighbors)) {
        const a = ccOf.get(id);
        if (!a) continue;
        adjacency[a] = adjacency[a] || new Set();
        for (const other of list) {
            const b = ccOf.get(other);
            if (b && b !== a) adjacency[a].add(b);
        }
    }
    return adjacency;
}

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function report(countries, regions, perCountry, neighbors, cityCount) {
    const sizes = countries.map(c => [c.cc, (perCountry[c.cc] || []).length]).sort((a, b) => b[1] - a[1]);
    let edges = 0, asym = 0;
    const set = new Map(Object.entries(neighbors).map(([k, v]) => [k, new Set(v)]));
    for (const [id, list] of Object.entries(neighbors)) {
        edges += list.length;
        for (const n of list) if (!set.get(n) || !set.get(n).has(id)) asym++;
    }
    const noNb = Object.values(neighbors).filter(v => v.length === 0).length;
    console.log('\n— Итог —');
    console.log(`  областей: ${regions.length}, стран: ${countries.length}, городов: ${cityCount}`);
    console.log(`  связей: ${edges / 2} (асимметричных: ${asym}, без соседей: ${noNb})`);
    console.log(`  крупнейшие: ${sizes.slice(0, 6).map(s => s[0] + '=' + s[1]).join(' ')}`);
    for (const cc of ['RU', 'UA', 'MD', 'DE', 'KZ', 'NO', 'FR']) {
        const list = perCountry[cc] || [];
        if (list.length) console.log(`  ${cc}: ${list.length} обл. — ${list.slice(0, 6).map(r => r.name).join(', ')}${list.length > 6 ? '…' : ''}`);
    }
}

main();
