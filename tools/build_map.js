#!/usr/bin/env node
'use strict';
// =====================================================================
// ГЕНЕРАТОР КАРТЫ
//
//   node tools/build_map.js
//
// США, Канада, Россия и Украина делятся по настоящим границам регионов
// (tools/data/admin1.json). Остальные страны — сеткой с волнистыми
// сторонами, обрезанной по границе государства; число областей зависит от
// площади страны (Молдова — 2, совсем малые — 1). Куски мельче 30% средней
// площади области присоединяются к соседу с самой длинной общей границей.
// Острова меньше 2500 км² убираются (lib/source.js).
// На выходе — js/data/*.js, которые игра грузит напрямую, и таблица
// переноса сохранений с прежней карты (RegionsRemap).
// =====================================================================

const fs = require('fs');
const path = require('path');
const pc = require('polygon-clipping');
const G = require('./lib/geo');
const source = require('./lib/source');
const T = require('./lib/translit');
const { buildSeas } = require('./lib/seas');
const allCities = require('all-the-cities');

const OUT_DIR = path.join(__dirname, '..', 'js', 'data');

// ВВП на душу населения, $ (tools/data/gdp_per_capita.json, его готовит
// prepare_gdp.js) — от него зависит богатство страны в игре.
const GDP = (() => {
    const file = path.join(__dirname, 'data', 'gdp_per_capita.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).gdp : {};
})();

// Страны с настоящими границами регионов (tools/data/admin1.json, его
// готовит prepare_admin1.js): штаты, провинции, субъекты, области.
const ADMIN1 = (() => {
    const file = path.join(__dirname, 'data', 'admin1.json');
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const u of JSON.parse(fs.readFileSync(file, 'utf8'))) (out[u.cc] = out[u.cc] || []).push(u);
    return out;
})();

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
// Меркатор растягивает высокие широты, поэтому клетка постоянного размера в
// пикселях на севере покрывает в разы меньше земли. Чтобы области выходили
// равными по настоящей площади, высота полосы подбирается под широту:
// h_px = сторона_км * K / (R * cos(широта)). Меркатор конформен, значит
// клетка, квадратная в пикселях, остаётся квадратной и на местности.
function bandHeightPx(y, sideKm) {
    const heightAt = at => {
        const phi = Math.abs(G.yToLat(at)) * Math.PI / 180;
        return (sideKm * G.K) / (G.R_EARTH * Math.max(Math.cos(phi), 0.08));
    };
    const first = heightAt(y);
    return heightAt(y + first / 2);   // уточняем по середине полосы
}

// Волнистая сетка: линии разреза изгибаются псевдослучайно (детерминированно
// — от их положения), поэтому внутренние границы областей не выглядят
// линейкой. Клетки по-прежнему плотно укладываются: общая граница соседних
// клеток строится по одному и тому же набору точек с обеих сторон.
const WAVE = 0.16;                 // размах изгиба — доля размера клетки

// Плавный шум в [-1, 1]: сумма синусоид с фазами от «зерна».
// Крупный изгиб плюс мелкая рябь — как у границ по рекам и хребтам.
function wave(u, seed) {
    const p1 = hash01('a' + seed), p2 = hash01('b' + seed), p3 = hash01('c' + seed);
    return 0.5 * Math.sin(2 * Math.PI * (u * (0.9 + 0.3 * p3) + p1))
        + 0.25 * Math.sin(2 * Math.PI * (u * 2.1 + p2))
        + 0.14 * Math.sin(2 * Math.PI * (u * 4.3 + p1 + p2))
        + 0.07 * Math.sin(2 * Math.PI * (u * 9.7 + p3))
        + 0.04 * Math.sin(2 * Math.PI * (u * 17.3 + p2 + p3));
}

function gridPieces(mp, sideKm, straight = false) {
    const [x1, y1, x2, y2] = G.bboxOf(mp);
    const out = [];
    const maxBand = Math.max(y2 - y1, 1) * 1.5;

    // полосы по широте
    const bands = [];
    let y = y1;
    for (let guard = 0; y < y2 && guard < 5000; guard++) {
        const h = Math.min(bandHeightPx(y, sideKm), maxBand);
        bands.push({ y0: y, y1: y + h, h });
        y += h;
    }
    const amp = straight ? 0 : WAVE;
    // граница полос k (между bands[k-1] и bands[k]) — кривая y(x); крайние прямые
    const boundaryY = (k, x) => {
        const base = k < bands.length ? bands[k].y0 : bands[k - 1].y1;
        if (k === 0 || k === bands.length || !amp) return base;
        const h = Math.min(bands[k - 1].h, bands[k].h);
        return base + amp * h * wave(x / (2.2 * h), `h${k}:${base.toFixed(3)}`);
    };
    // точки кривой границы k между xa и xb: общие для клеток сверху и снизу
    const breaks = k => {
        if (breaks.cache[k]) return breaks.cache[k];
        const set = new Set();
        const step = Math.min(...[bands[k - 1], bands[k]].filter(Boolean).map(b => b.h)) / 14;
        for (let v = Math.floor(x1 / step) * step; v <= x2 + step; v += step) set.add(+v.toFixed(6));
        for (const b of [bands[k - 1], bands[k]]) {
            if (!b) continue;
            for (let i = Math.floor(x1 / b.h); i <= Math.ceil(x2 / b.h); i++) set.add(+(i * b.h).toFixed(6));
        }
        return (breaks.cache[k] = [...set].sort((a, b) => a - b));
    };
    breaks.cache = {};
    const along = (k, xa, xb) => {
        const pts = [[xa, boundaryY(k, xa)]];
        for (const v of breaks(k)) if (v > xa + 1e-9 && v < xb - 1e-9) pts.push([v, boundaryY(k, v)]);
        pts.push([xb, boundaryY(k, xb)]);
        return pts;
    };
    // вертикальный разрез i в полосе k: концы — на границах полос
    const side = (k, i) => {
        const b = bands[k], x = +(i * b.h).toFixed(6);
        const ya = boundaryY(k, x), yb = boundaryY(k + 1, x);
        const pts = [];
        const m = 14;
        for (let j = 0; j <= m; j++) {
            const t = j / m;
            const dx = amp ? amp * b.h * Math.sin(Math.PI * t) * wave(t * 1.3, `v${k}:${i}:${b.y0.toFixed(3)}`) : 0;
            pts.push([x + dx, ya + (yb - ya) * t]);
        }
        return pts;
    };

    bands.forEach((b, k) => {
        const i1 = Math.floor(x1 / b.h), i2 = Math.ceil(x2 / b.h);
        for (let i = i1; i < i2; i++) {
            const xa = +(i * b.h).toFixed(6), xb = +((i + 1) * b.h).toFixed(6);
            const top = along(k, xa, xb);
            const right = side(k, i + 1);
            const bottom = along(k + 1, xa, xb).reverse();
            const left = side(k, i).reverse();
            const ring = [...top, ...right.slice(1), ...bottom.slice(1), ...left.slice(1)];
            ring.push(ring[0]);
            let res;
            try { res = pc.intersection(mp, [[ring]]); } catch (e) { continue; }
            for (const poly of res) {
                const piece = [poly];
                if (G.polyAreaPx(piece) > 1e-7) out.push(piece);
            }
        }
    });
    return out;
}

function partition(mp, n, areaKm2) {
    if (n <= 1) return [mp];
    const whole = G.polyAreaPx(mp);
    const cut = side => {
        const pieces = gridPieces(mp, side);
        // волнистая нарезка потеряла кусок страны (сбой отсечения) — прямая
        const got = pieces.reduce((a, p) => a + G.polyAreaPx(p), 0);
        return Math.abs(got - whole) > whole * 0.002 ? gridPieces(mp, side, true) : pieces;
    };
    let side = Math.sqrt(areaKm2 / n);
    let pieces = cut(side);
    for (let guard = 0; pieces.length < n && guard < 16; guard++) {
        side *= 0.85;
        pieces = cut(side);
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

// Карта склеена по линии перемены дат: кусок Чукотки у левого края
// (долгота −170…−180) соседствует с Камчаткой у правого, а не с Петербургом.
const WORLD_W = G.lonToX(180) - G.lonToX(-180);
function wrapDist(a, b) {
    const dx = Math.abs(a[0] - b[0]);
    return Math.hypot(Math.min(dx, WORLD_W - dx), a[1] - b[1]);
}

// --- регионы по настоящим границам -----------------------------------
// Регион — пересечение страны с его контуром. Кусочки страны, не
// попавшие ни в один регион (у побережий данные разного масштаба
// расходятся), достаются соседу с самой длинной общей границей.
function adminItems(country) {
    const units = [];
    for (const u of ADMIN1[country.cc]) {
        let shape = source.clipToView(source.geometryToMulti({ type: 'MultiPolygon', coordinates: u.mp }));
        let mp;
        try { mp = pc.intersection(country.mp, shape); } catch (e) { continue; }
        mp = mp.filter(poly => G.polyAreaPx([poly]) > 1e-6);
        if (!mp.length) continue;
        units.push({ mp, fixedName: u.name, key: u.key });
    }
    let rest;
    try { rest = pc.difference(country.mp, ...units.map(u => u.mp)); } catch (e) { rest = []; }
    const items = units.map(u => ({ ...u, cells: boundaryCells(u.mp), parts: partCentroids(u.mp) }));
    for (const poly of rest) {
        if (G.polyAreaPx([poly]) < 1e-7) continue;
        const piece = [poly], cells = boundaryCells(piece), parts = partCentroids(piece);
        let best = null, bestShared = 0;
        for (const it of items) { const sh = sharedCells(cells, it.cells); if (sh > bestShared) { bestShared = sh; best = it; } }
        if (!best) {
            let bestDist = Infinity;
            for (const it of items) { const d = nearDist(parts, it.parts); if (d < bestDist) { bestDist = d; best = it; } }
        }
        if (!best) continue;
        try { best.mp = pc.union(best.mp, piece); } catch (e) { best.mp = best.mp.concat(piece); }
        for (const k of cells) best.cells.add(k);
        best.parts = best.parts.concat(parts);
    }
    return items.map(it => ({ mp: it.mp, area: G.areaKm2(it.mp, 48), cells: it.cells, fixedName: it.fixedName }));
}

// --- слияние мелких кусков -------------------------------------------
// Расстояние между кусками — по ближайшим частям: у куска из частей по
// обе стороны линии перемены дат общий центр оказался бы посреди карты.
const partCentroids = mp => mp.map(poly => G.centroidOf([poly]));
function nearDist(a, b) {
    let best = Infinity;
    for (const p of a) for (const q of b) best = Math.min(best, wrapDist(p, q));
    return best;
}

function mergePieces(pieces, targetN, avgAreaPx) {
    // страна по обе стороны линии перемены дат (Россия, Фиджи…): только
    // для неё расстояние с учётом склейки — остальные карты не меняются
    const xs = pieces.flatMap(mp => { const b = G.bboxOf(mp); return [b[0], b[2]]; });
    const wraps = Math.max(...xs) - Math.min(...xs) > WORLD_W / 2;
    const items = pieces.map(mp => ({
        mp,
        area: G.areaKm2(mp, 48),
        cells: boundaryCells(mp),
        centroid: G.centroidOf(mp),
        parts: wraps ? partCentroids(mp) : null,
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
                const d = wraps ? nearDist(src.parts, items[i].parts)
                    : Math.hypot(src.centroid[0] - items[i].centroid[0], src.centroid[1] - items[i].centroid[1]);
                if (d < bestDist) { bestDist = d; best = i; }
            }
        }
        if (best < 0) break;

        const dst = items[best];
        let merged;
        try { merged = pc.union(dst.mp, src.mp); } catch (e) { merged = dst.mp.concat(src.mp); }
        dst.mp = merged;
        dst.area = G.areaKm2(merged, 48);
        for (const k of src.cells) dst.cells.add(k);
        dst.centroid = G.centroidOf(merged);
        if (wraps) dst.parts = partCentroids(merged);
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
                // при равном сходстве — более крупный город: одноимённых много
                if (s > bs || (s === bs && best >= 0 && pool[i].population > pool[best].population)) { bs = s; best = i; }
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
            // одноимённых городов в стране много — берём самый крупный
            for (const c of [...pool].sort((a, b) => b.population - a.population)) {
                const ru = byFlat.get(flat(c.name));
                if (!ru) continue;
                if (known.has(ru)) {
                    // Выверенное соответствие сильнее догадки по написанию:
                    // если догадка попала в городок, переносим на настоящий город.
                    const guess = list.find(v => v.name === ru);
                    if (guess && c.population > guess.population * 2) {
                        guess.x = G.lonToX(c.loc.coordinates[0]);
                        guess.y = G.latToY(c.loc.coordinates[1]);
                        guess.population = c.population;
                    }
                    continue;
                }
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
        const excluded = new Set((curated._exclude || {})[cc] || []);
        for (let i = list.length - 1; i >= 0; i--) if (excluded.has(list[i].name)) list.splice(i, 1);
        fixCapital(list, pool);
        list.sort((a, b) => b.population - a.population);
        out[cc] = list;
    }
    return out;
}

// Столица — по отметке PPLC в all-the-cities. Сопоставление по написанию
// иногда уводило столицу в одноимённую деревню: Москва стояла на месте
// посёлка на 9,6 тыс. жителей, Рим — на месте хутора на 33 человека.
function fixCapital(list, pool) {
    const pplc = pool.filter(c => c.featureCode === 'PPLC').sort((a, b) => b.population - a.population)[0];
    if (!pplc) return;
    const px = G.lonToX(pplc.loc.coordinates[0]), py = G.latToY(pplc.loc.coordinates[1]);
    const psk = T.skeleton(pplc.name);
    const sim = city => T.similarity(T.ruSkeleton(city.name), psk);
    const caps = list.filter(c => c.isCapital).sort((a, b) => sim(b) - sim(a));
    const cap = caps[0];
    if (!cap) return;
    // У страны одна столица (Ватикан в списке Италии столицей быть не должен).
    for (const other of caps.slice(1)) other.isCapital = false;
    const far = Math.hypot(cap.x - px, cap.y - py) > 0.3;
    // Далёкую столицу переносим, только если она похожа на деревню или
    // называется так же — иначе это осознанный выбор (Сукре, а не Ла-Пас).
    if (far && (cap.population < 20000 || sim(cap) >= 0.4)) {
        cap.x = px;
        cap.y = py;
        cap.population = Math.max(cap.population, pplc.population);
    }
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

// Прежняя нарезка (текущий js/data/RegionsDB.js): cc → [{id, x, y}].
function loadPreviousRegions() {
    const file = path.join(__dirname, '..', 'js', 'data', 'RegionsDB.js');
    if (!fs.existsSync(file)) return {};
    const ctx = {};
    require('vm').createContext(ctx);
    require('vm').runInContext(fs.readFileSync(file, 'utf8') + ';globalThis.R=RegionsDB;', ctx);
    const out = {};
    for (const [id, r] of Object.entries(ctx.R)) (out[r.cc] = out[r.cc] || []).push({ id, x: r.lx, y: r.ly });
    return out;
}

// Карта из js/: области с контурами, отпечаток (как SaveGame.mapId в игре)
// и таблица переноса, если она уже есть.
function loadMap() {
    const vm = require('vm');
    const files = ['data/RegionsDB', 'data/NeighborsDB', 'data/CitiesDB', 'UnitsDB'].map(f => path.join(__dirname, '..', 'js', f + '.js'));
    if (!files.every(f => fs.existsSync(f))) return null;
    const ctx = {};
    vm.createContext(ctx);
    for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
    // длина берега (coast) — справка, а не форма карты: в подпись не входит,
    // иначе сохранения сочли бы карту новой (так же в SaveGame.mapId)
    const input = vm.runInContext('JSON.stringify([RegionsDB, NeighborsDB, CitiesDB, Object.keys(UnitsDB)], (k, v) => (k === "coast" ? undefined : v))', ctx);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        a = Math.imul(a ^ code, 16777619);
        b = Math.imul(b, 33) ^ code;
    }
    const regions = Object.entries(vm.runInContext('RegionsDB', ctx)).map(([id, r]) => ({ id, cc: r.cc, lx: r.lx, ly: r.ly, rings: G.parsePath(r.path) }));
    return {
        id: `map3:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`,
        regions,
        remap: vm.runInContext('typeof RegionsRemap === "undefined" ? null : RegionsRemap', ctx),
    };
}

// Перенос сохранений на новую карту. Для каждой новой области — прежняя,
// в которой лежит её центр (sources: от неё владелец и лояльность); для
// каждой прежней — новая, в которой лежит её центр (heirs: к ней уходят
// армия и постройки). Записываются только несовпадающие номера. Если карта
// не изменилась, таблица остаётся прежней — иначе повторный запуск
// генератора стёр бы перенос с позапрошлой карты.
function writeRemap(previousMap, regions) {
    const current = loadMap();
    let remap = null;
    if (previousMap && current.id === previousMap.id) remap = previousMap.remap;
    else if (previousMap) {
        const inRings = (pt, rings) => rings.reduce((inside, ring) => inside !== G.pointInRing(pt, ring), false);
        const locate = (pt, list, shape) => list.find(c => shape(c, pt))
            || list.reduce((best, c) => (Math.hypot(c.lx - pt[0], c.ly - pt[1]) < Math.hypot(best.lx - pt[0], best.ly - pt[1]) ? c : best));
        const group = list => list.reduce((m, r) => ((m[r.cc] = m[r.cc] || []).push(r), m), {});
        const oldBy = group(previousMap.regions), newBy = group(regions);
        const sources = {}, heirs = {};
        for (const r of regions) {
            const list = oldBy[r.cc];
            if (!list) continue;
            const o = locate([r.lx, r.ly], list, (c, pt) => inRings(pt, c.rings));
            if (o.id !== r.id) sources[r.id] = o.id;
        }
        for (const o of previousMap.regions) {
            const list = newBy[o.cc];
            if (!list) continue;
            const r = locate([o.lx, o.ly], list, (c, pt) => G.pointInMulti(pt, c.mp));
            if (r.id !== o.id) heirs[o.id] = r.id;
        }
        remap = { from: previousMap.id, sources, heirs };
        console.log(`  перенос сохранений: ${Object.keys(sources).length} новых областей берут данные прежних, ${Object.keys(heirs).length} прежних отдают армии`);
    }
    const file = path.join(OUT_DIR, 'RegionsDB.js');
    const text = fs.readFileSync(file, 'utf8').replace('module.exports = { RegionsDB };', 'module.exports = { RegionsDB, RegionsRemap };');
    const at = text.lastIndexOf('\nif (typeof module');
    fs.writeFileSync(file, text.slice(0, at) + `// перенос сохранений с прежней карты (tools/build_map.js, writeRemap)\nconst RegionsRemap = ${JSON.stringify(remap)};\n` + text.slice(at));
}

// Номера областей: новой области — номер ближайшей прежней (по точке
// подписи). Число областей изменилось — нумеруем заново по площади.
function stableIds(cc, items, previous) {
    const fresh = items.map((_, i) => `${cc}-${i + 1}`);
    const old = previous[cc];
    if (!old || old.length !== items.length) return fresh;
    const poles = items.map(it => G.poleOfInaccessibility(it.mp));
    const pairs = [];
    poles.forEach((p, i) => old.forEach((o, j) => pairs.push([wrapDist(p, [o.x, o.y]), i, j])));
    pairs.sort((a, b) => a[0] - b[0]);
    const ids = new Array(items.length), usedOld = new Set();
    for (const [, i, j] of pairs) {
        if (ids[i] || usedOld.has(j)) continue;
        ids[i] = old[j].id;
        usedOld.add(j);
    }
    return ids;
}

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
    const previous = loadPreviousRegions();
    const previousMap = loadMap();

    console.log('Делим страны на области…');
    for (const country of countries) {
        let n = targetRegionCount(country);
        const area = country.drawnAreaKm2 || country.areaKm2;
        let items;
        if (ADMIN1[country.cc]) {
            items = adminItems(country);
            n = items.length;
        } else {
            const pieces = partition(country.mp, n, area);
            items = mergePieces(pieces, n, area / n);
        }

        // крупные области первыми — осмысленная нумерация для новой карты;
        // если страна уже была поделена так же, номера остаются прежними:
        // по ним в сохранениях записаны владельцы и армии областей
        items.sort((a, b) => b.area - a.area);
        const ids = stableIds(country.cc, items, previous);

        const list = [];
        items.forEach((it, idx) => {
            const anchor = G.pointOnSurface(it.mp);
            // Визуальный центр для значков и подписей; anchor остаётся для
            // расчётов генератора (морские переправы, раскраска), чтобы они
            // не менялись от смены способа подписи.
            const pole = G.poleOfInaccessibility(it.mp);
            list.push({
                id: ids[idx],
                cc: country.cc,
                mp: it.mp,
                areaPx: it.area,
                areaKm2: it.area,
                cx: anchor[0],
                cy: anchor[1],
                lx: pole[0],
                ly: pole[1],
                lr: pole[2],
                cells: it.cells,
                fixedName: it.fixedName || null,
                bbox: G.bboxOf(it.mp),
                labelRadius: Math.sqrt(G.polyAreaPx(it.mp) / Math.PI),
            });
        });
        list.sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
        perCountry[country.cc] = list;
        regions.push(...list);
        process.stdout.write(`\r  ${country.cc}: ${list.length}/${n} обл.        `);
    }
    console.log(`\r  готово: ${regions.length} областей в ${countries.length} странах        `);

    console.log('Раскладываем города по областям…');
    const placement = collectCityPopulation(perCountry);
    console.log(`  ${placement.placed} городов внутри областей, ${placement.nearest} отнесены к ближайшей`);

    console.log('Присваиваем названия по городам…');
    const naming = nameRegions(countries, perCountry, cityIndex);
    console.log(`  по справочнику: ${naming.indexed}, по крупнейшему городу внутри: ${naming.local}, по сторонам света: ${naming.directional}`);

    console.log('Считаем население и ресурсы…');
    distributeStats(countries, perCountry);

    console.log('Ищем соседей…');
    const neighbors = buildNeighbors(regions, perCountry);

    console.log('Записываем js/data/…');
    writeOutput(countries, regions, perCountry, neighbors, cityIndex);
    writeBorders(buildBorders(regions));
    writeSeas(regions);
    writeRemap(previousMap, regions);

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
    const stats = { indexed: 0, local: 0, directional: 0 };
    for (const country of countries) {
        const list = perCountry[country.cc] || [];
        const cities = (cityIndex[country.cc] || []).slice();
        const bbox = mainlandBox(country.mp);
        const taken = new Set();

        // 0. у штатов и провинций — их собственные названия; столица области
        //    для значка — крупнейший город внутри
        // 1. каждой области — крупнейший город внутри неё
        for (const region of list) {
            let best = null;
            for (const c of cities) {
                if (taken.has(c.name)) continue;
                if (c.x < region.bbox[0] || c.x > region.bbox[2] || c.y < region.bbox[1] || c.y > region.bbox[3]) continue;
                if (!G.pointInMulti([c.x, c.y], region.mp)) continue;
                if (!best || c.population > best.population) best = c;
            }
            if (region.fixedName) { region.name = region.fixedName; if (best) { region.capitalCity = best; taken.add(best.name); } stats.indexed++; continue; }
            if (best) { region.name = best.name; region.capitalCity = best; taken.add(best.name); stats.indexed++; }
        }
        // 2. остальным — крупнейший реальный город ВНУТРИ области (без
        // русского названия — в транскрипции). Раньше брался любой свободный
        // город страны, и области назывались городами, которые лежат в другой
        // части страны. 3. Городов нет — сторона света.
        const leftover = [];
        for (const region of list) {
            if (region.name) continue;
            const local = (region.localCities || []).find(c => !taken.has(T.latToRu(c.name)));
            if (local) {
                const name = T.latToRu(local.name);
                region.name = name;
                region.capitalCity = { name, x: local.x, y: local.y, population: local.population, isCapital: false };
                taken.add(name);
                stats.local++;
                // NAMES_REPORT=1 — список транскрибированных имён, чтобы дополнить data/cities_ru.json
                if (process.env.NAMES_REPORT) console.log(`\n  ${country.cc}\t${local.name}\t${name}`);
            } else leftover.push(region);
        }
        stats.directional += leftover.length;
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
    return stats;
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

// Раскладываем ВСЕ города страны (all-the-cities, от 1000 жителей) по областям.
// Раньше в расчёт шли только города с известным русским названием — около
// тысячи на весь мир, поэтому плотность населения выходила случайной.
function collectCityPopulation(perCountry) {
    const byCc = {};
    for (const city of allCities) (byCc[city.country] = byCc[city.country] || []).push(city);

    let placed = 0, nearest = 0;
    for (const cc of Object.keys(perCountry)) {
        const regions = perCountry[cc];
        for (const region of regions) { region.cityPop = 0; region.cityCount = 0; }
        if (!regions.length) continue;

        for (const city of (byCc[cc] || [])) {
            const x = G.lonToX(city.loc.coordinates[0]);
            const y = G.latToY(city.loc.coordinates[1]);

            let target = null;
            for (const region of regions) {
                if (x < region.bbox[0] || x > region.bbox[2] || y < region.bbox[1] || y > region.bbox[3]) continue;
                if (G.pointInMulti([x, y], region.mp)) { target = region; break; }
            }
            if (target) {
                placed++;
                // крупные города внутри области — кандидаты в её название
                if (city.population >= 10000) {
                    (target.localCities = target.localCities || []).push({ name: city.name, x, y, population: city.population });
                }
            }
            else {
                // приморские города иногда выпадают из полигона на пиксель —
                // отдаём такой город ближайшей области страны
                let bestDist = Infinity;
                for (const region of regions) {
                    const d = Math.hypot(x - region.cx, y - region.cy);
                    if (d < bestDist) { bestDist = d; target = region; }
                }
                nearest++;
            }
            target.cityPop += city.population;
            target.cityCount++;
        }
    }
    for (const regions of Object.values(perCountry)) {
        for (const region of regions) if (region.localCities) region.localCities.sort((a, b) => b.population - a.population);
    }
    return { placed, nearest };
}

function distributeStats(countries, perCountry) {
    for (const country of countries) {
        const regions = perCountry[country.cc] || [];
        if (!regions.length) continue;

        const totalArea = regions.reduce((sum, r) => sum + r.areaKm2, 0) || 1;
        const cityTotal = regions.reduce((sum, r) => sum + r.cityPop, 0);
        const countryPop = country.population || Math.round(cityTotal * 1.5) || regions.length * 20000;

        // Городское население стоит там, где стоят города; остальное
        // размазываем по площади с постоянной сельской плотностью.
        const ruralDensity = Math.max(0, countryPop - cityTotal) / totalArea;
        const weights = regions.map(r => r.cityPop + ruralDensity * r.areaKm2);
        const weightSum = weights.reduce((a, b) => a + b, 0);

        regions.forEach((region, i) => {
            const share = weightSum > 0 ? weights[i] / weightSum : region.areaKm2 / totalArea;
            region.population = Math.max(200, Math.round(countryPop * share));

            const density = region.population / Math.max(1, region.areaKm2);
            const noise = hash01(region.id);
            const indBase = INDUSTRIAL.has(country.cc) ? 18 : 8;
            region.industry = Math.max(1, Math.round(indBase * (0.5 + noise) * Math.min(3, 0.4 + Math.sqrt(density) / 6)));
            region.agro = Math.max(1, Math.round((12 + 55 * hash01(region.id + 'a')) * Math.min(1.6, 0.5 + region.areaKm2 / 200000)));
            region.oil = OIL[country.cc] ? Math.round(OIL[country.cc] * (0.4 + 1.2 * hash01(region.id + 'o'))) : 0;
        });

        // округление не должно менять итог по стране
        const diff = countryPop - regions.reduce((s, r) => s + r.population, 0);
        if (diff !== 0) {
            const biggest = regions.reduce((a, b) => (a.population >= b.population ? a : b));
            biggest.population = Math.max(200, biggest.population + diff);
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

// Общие участки границы соседних областей: по ним игра рисует линию между
// государствами — там, где у соседних областей разные владельцы. Иначе на
// общем плане страны разделяет только разница цветов, и граница сливается.
const BORDER_EPS = 0.15;    // px: вершина ближе к контуру соседа — на общей границе
const BORDER_CELL = 0.5;

function buildBorders(regions) {
    const grid = new Map();
    const cellKey = (x, y) => `${Math.floor(x / BORDER_CELL)},${Math.floor(y / BORDER_CELL)}`;
    regions.forEach((r, i) => {
        for (const poly of r.mp) for (const ring of poly) {
            for (let k = 0; k < ring.length - 1; k++) {
                const [ax, ay] = ring[k], [bx, by] = ring[k + 1];
                const x1 = Math.floor((Math.min(ax, bx) - BORDER_EPS) / BORDER_CELL), x2 = Math.floor((Math.max(ax, bx) + BORDER_EPS) / BORDER_CELL);
                const y1 = Math.floor((Math.min(ay, by) - BORDER_EPS) / BORDER_CELL), y2 = Math.floor((Math.max(ay, by) + BORDER_EPS) / BORDER_CELL);
                for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) {
                    const key = `${x},${y}`;
                    let bucket = grid.get(key);
                    if (!bucket) grid.set(key, bucket = []);
                    bucket.push([ax, ay, bx, by, i]);
                }
            }
        }
    });
    const eps2 = BORDER_EPS * BORDER_EPS;
    const near = (i, [x, y]) => {
        const out = new Set();
        for (const [ax, ay, bx, by, j] of grid.get(cellKey(x, y)) || []) {
            if (j > i && !out.has(j) && G.segDist2(x, y, ax, ay, bx, by) < eps2) out.add(j);
        }
        return out;
    };

    const borders = [];
    regions.forEach((r, i) => {
        for (const poly of r.mp) for (const ring of poly) {
            const n = ring.length - 1;
            const sets = [];
            const all = new Set();
            for (let k = 0; k < n; k++) { sets.push(near(i, ring[k])); for (const j of sets[k]) all.add(j); }
            for (const j of all) {
                // участки подряд идущих вершин рядом с соседом j; кольцо замкнуто
                const on = sets.map(s => s.has(j));
                if (on.every(Boolean)) { borders.push([r.id, regions[j].id, ring.slice()]); continue; }
                const start = on.findIndex(v => !v);
                let run = [];
                for (let s = 1; s <= n; s++) {
                    const k = (start + s) % n;
                    if (on[k]) run.push(ring[k]);
                    if (!on[k] || s === n) {
                        if (run.length >= 2) borders.push([r.id, regions[j].id, run]);
                        run = [];
                    }
                }
            }
        }
    });
    return borders;
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
                    // третье число — длина берега, которую представляет точка
                    pts.push([a[0] + ((b[0] - a[0]) * s) / k, a[1] + ((b[1] - a[1]) * s) / k, len / k]);
                }
            }
        }
    }
    return pts;
}

function pxPerKm(y) { return 1 / ((G.R_EARTH / G.K) * Math.cos(G.yToLat(y) * Math.PI / 180)); }

// Переправа — только от берега до берега и только через воду. Иначе мелкие
// области (субъекты России, области Украины) «перепрыгивали» бы через
// соседа по суше: Полтава граничила бы с Курском.
const COAST_EPS = 0.2;   // px: точка ближе к чужой границе — не берег, а суша

function addSeaLinks(regions, links) {
    const CELL = 2.0;
    const cellKey = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    const grid = new Map();
    const pts = regions.map(r => seaPoints(r));
    pts.forEach((list, i) => {
        for (const p of list) {
            const key = cellKey(p[0], p[1]);
            let bucket = grid.get(key);
            if (!bucket) grid.set(key, bucket = []);
            bucket.push([p[0], p[1], i]);
        }
    });

    // берег: рядом нет точек границы другой области
    const coastal = pts.map((list, i) => list.filter(p => {
        const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (const [qx, qy, j] of grid.get(`${gx + dx},${gy + dy}`) || []) {
                    if (j !== i && Math.hypot(p[0] - qx, p[1] - qy) < COAST_EPS) return false;
                }
            }
        }
        return true;
    }));
    // длина береговой линии области, км: по ней игра решает, где строить порт
    coastal.forEach((list, i) => {
        regions[i].coastKm = Math.round(list.reduce((sum, p) => sum + p[2] / pxPerKm(p[1]), 0));
        regions[i].coastPts = list;     // для морских зон (writeSeas)
    });
    const coastGrid = new Map();
    coastal.forEach((list, i) => {
        for (const p of list) {
            const key = cellKey(p[0], p[1]);
            let bucket = coastGrid.get(key);
            if (!bucket) coastGrid.set(key, bucket = []);
            bucket.push([p[0], p[1], i]);
        }
    });

    // суша: области по ячейкам их рамок
    const LAND_CELL = 4.0;
    const landGrid = new Map();
    const boxes = regions.map(r => { const [minX, minY, maxX, maxY] = G.bboxOf(r.mp); return { minX, minY, maxX, maxY }; });
    boxes.forEach((b, i) => {
        for (let x = Math.floor(b.minX / LAND_CELL); x <= Math.floor(b.maxX / LAND_CELL); x++) {
            for (let y = Math.floor(b.minY / LAND_CELL); y <= Math.floor(b.maxY / LAND_CELL); y++) {
                const key = `${x},${y}`;
                let bucket = landGrid.get(key);
                if (!bucket) landGrid.set(key, bucket = []);
                bucket.push(i);
            }
        }
    });
    const onLand = (x, y) => (landGrid.get(`${Math.floor(x / LAND_CELL)},${Math.floor(y / LAND_CELL)}`) || [])
        .some(i => { const b = boxes[i]; return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && G.pointInMulti([x, y], regions[i].mp); });
    // вода: середина и четверти отрезка не на суше
    const overWater = (p, q) => [0.25, 0.5, 0.75].every(t => !onLand(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t));

    regions.forEach((r, i) => {
        const reach = SEA_LINK_KM * pxPerKm(r.cy);
        const span = Math.ceil(reach / CELL);
        const found = new Map();
        for (const p of coastal[i]) {
            const gx = Math.floor(p[0] / CELL), gy = Math.floor(p[1] / CELL);
            for (let dx = -span; dx <= span; dx++) {
                for (let dy = -span; dy <= span; dy++) {
                    const bucket = coastGrid.get(`${gx + dx},${gy + dy}`);
                    if (!bucket) continue;
                    for (const q of bucket) {
                        const j = q[2];
                        if (j === i || links[i].has(j) || found.has(j)) continue;
                        if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= reach && overWater(p, q)) found.set(j, true);
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
           + ` playable: ${!c.uninhabited && !!c.sovereign && n > 0}, gdp: ${GDP[c.cc] || 0},`
           + ` money: 2000000, influence: 50, taxRate: 0.05 },\n`;
    }
    s += '};\n\nif (typeof module !== \'undefined\' && module.exports) module.exports = { CountriesDB };\n';
    fs.writeFileSync(path.join(OUT_DIR, 'CountriesDB.js'), s);

    // --- RegionsDB ---
    s = HEADER + 'const RegionsDB = {\n';
    for (const r of regions) {
        s += `  '${r.id}': { name: ${q(r.name)}, cc: '${r.cc}', cx: ${r.cx.toFixed(2)}, cy: ${r.cy.toFixed(2)},`
           + ` lx: ${r.lx.toFixed(2)}, ly: ${r.ly.toFixed(2)}, lr: ${r.lr.toFixed(2)},`
           + ` area: ${Math.round(r.areaKm2)}, r: ${r.labelRadius.toFixed(2)},`
           + ` bx: ${r.bbox[0].toFixed(1)}, by: ${r.bbox[1].toFixed(1)},`
           + ` bw: ${(r.bbox[2] - r.bbox[0]).toFixed(1)}, bh: ${(r.bbox[3] - r.bbox[1]).toFixed(1)},`
           + ` population: ${r.population},`
           + ` agro: ${r.agro}, industry: ${r.industry}, oil: ${r.oil}, coast: ${r.coastKm || 0},`
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
        // город, давший имя области, на карте должен быть всегда
        for (const region of list) {
            const named = region.capitalCity;
            if (named && !cities.some(x => x.name === named.name)) cities.push(named);
        }
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

// Морские зоны (tools/lib/seas.js) и порты на старте (tools/data/ports.json)
// → js/data/SeasDB.js. Порт — в области, где город (или в ближайшей
// прибрежной области той же страны); уровень — по месту в рейтинге.
function writeSeas(regions) {
    const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'seas.json'), 'utf8'));
    const seas = buildSeas(regions, spec);
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ports.json'), 'utf8'));
    const ports = [];
    const misses = [];
    const place = ([name, cc, lon, lat], level) => {
        const pt = [G.lonToX(lon), G.latToY(lat)];
        let region = regions.find(r => seas.coast[r.id] && pt[0] >= r.bbox[0] && pt[0] <= r.bbox[2] && pt[1] >= r.bbox[1] && pt[1] <= r.bbox[3] && G.pointInMulti(pt, r.mp));
        if (!region) {
            // город у самой воды мог попасть в море — берём ближайшую прибрежную область страны
            let bd = Infinity;
            for (const r of regions) {
                if (r.cc !== cc || !seas.coast[r.id]) continue;
                const a = seas.coast[r.id], d = Math.hypot(a.x - pt[0], a.y - pt[1]);
                if (d < bd) { bd = d; region = r; }
            }
        }
        if (!region) { misses.push(name); return; }
        ports.push({ name, region: region.id, x: +pt[0].toFixed(2), y: +pt[1].toFixed(2), level });
    };
    list.top.forEach((p, i) => place(p, i < 3 ? 4 : i < 20 ? 2 : 1));
    list.extra.forEach(p => place(p, 1));
    fs.writeFileSync(path.join(OUT_DIR, 'SeasDB.js'),
        HEADER + `const SeasDB = ${JSON.stringify({ zones: seas.zones, borders: seas.borders, straits: seas.straits, marks: seas.marks, coast: seas.coast, ports })};\n\n`
        + 'if (typeof module !== \'undefined\' && module.exports) module.exports = { SeasDB };\n');
    const lonely = Object.entries(seas.zones).filter(([, z]) => !z.adj.length).map(([id, z]) => `${id} ${z.name}`);
    console.log(`  морских зон: ${seas.stats.zones} (своих ${seas.stats.auto}), прибрежных областей: ${Object.keys(seas.coast).length}, портов: ${ports.length}`
        + `${misses.length ? `, не нашлось: ${misses.join(', ')}` : ''}${lonely.length ? `, зоны без соседей: ${lonely.join('; ')}` : ''}`);
}

// Линии границ: [область, соседняя, путь] — путь в относительных
// координатах (короче абсолютных почти вдвое).
function writeBorders(borders) {
    const rel = pts => {
        let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}l`;
        let px = Math.round(pts[0][0] * 100), py = Math.round(pts[0][1] * 100);
        const steps = [];
        for (let k = 1; k < pts.length; k++) {
            const x = Math.round(pts[k][0] * 100), y = Math.round(pts[k][1] * 100);
            if (x === px && y === py) continue;
            steps.push(`${((x - px) / 100)},${((y - py) / 100)}`.replace(/(^|,)(-?)0\./g, '$1$2.'));
            px = x; py = y;
        }
        return steps.length ? d + steps.join(' ').replace(/ -/g, '-') : null;
    };
    // участок короче сотой доли пикселя (все точки совпали) рисовать нечем
    const rows = borders.map(([a, b, pts]) => [a, b, rel(pts)]).filter(r => r[2]).map(([a, b, d]) => `['${a}','${b}','${d}']`);
    fs.writeFileSync(path.join(OUT_DIR, 'BordersDB.js'),
        HEADER + 'const BordersDB = [\n' + rows.join(',\n') + '\n];\n\n'
        + 'if (typeof module !== \'undefined\' && module.exports) module.exports = { BordersDB };\n');
    console.log(`  линий границ: ${rows.length}`);
}

function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

// Соседние страны не должны сливаться по цвету, поэтому раскрашиваем
// граф соседства жадно: каждой стране — оттенок, максимально далёкий
// от уже занятых её соседями.
function buildPalette(countries, adjacency) {
    const swatches = [];
    for (let hue = 0; hue < 360; hue += 18) {
        swatches.push({ h: hue, s: 62, l: 52 });
        swatches.push({ h: hue + 9, s: 44, l: 38 });
        swatches.push({ h: hue + 4, s: 72, l: 66 });
    }

    // Крупные страны выбирают цвет первыми: у них больше ограничений и они
    // заметнее на карте, мелким островам достаточно остатков.
    const degree = cc => (adjacency[cc] ? adjacency[cc].size : 0);
    const order = countries.slice().sort((a, b) =>
        degree(b.cc) - degree(a.cc) || (b.population || 0) - (a.population || 0));

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

// Граф «не давать одинаковый цвет» строим из соседства областей и из
// визуальной близости: страны по разные стороны узкого моря соседями не
// считаются, но на экране лежат рядом и сливаться не должны.
const COLOR_PROXIMITY_PX = 16;   // ~500 км у экватора

function countryAdjacency(regions, neighbors) {
    const ccOf = new Map(regions.map(r => [r.id, r.cc]));
    const adjacency = {};
    const link = (a, b) => {
        if (!a || !b || a === b) return;
        (adjacency[a] = adjacency[a] || new Set()).add(b);
        (adjacency[b] = adjacency[b] || new Set()).add(a);
    };

    for (const [id, list] of Object.entries(neighbors)) {
        for (const other of list) link(ccOf.get(id), ccOf.get(other));
    }

    for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
            const a = regions[i], b = regions[j];
            if (a.cc === b.cc) continue;
            if (Math.abs(a.cx - b.cx) > COLOR_PROXIMITY_PX) continue;
            if (Math.abs(a.cy - b.cy) > COLOR_PROXIMITY_PX) continue;
            if (Math.hypot(a.cx - b.cx, a.cy - b.cy) <= COLOR_PROXIMITY_PX) link(a.cc, b.cc);
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
