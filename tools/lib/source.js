'use strict';
// =====================================================================
// Источник данных: Natural Earth 1:50m (world-atlas) + справочники.
// Отдаёт список стран с геометрией в координатах карты (Web Mercator, px).
// =====================================================================
const topojson = require('topojson-client');
const worldCountries = require('world-countries');
const pc = require('polygon-clipping');
const G = require('./geo');

// Границы viewBox карты: 1200x800. Их задаёт та же проекция.
const VIEW = { x1: 0, y1: 0, x2: 1200, y2: 800 };
const LAT_MAX = G.yToLat(VIEW.y1);   //  83.63 — верх карты
const LAT_MIN = G.yToLat(VIEW.y2);   // -85.08 — низ карты

// Natural Earth содержит территории без кода ISO. Привязываем вручную.
const NAME_TO_CC = {
    'Kosovo': 'XK',
    'Somaliland': 'SO',
    'N. Cyprus': 'CY',
    'Indian Ocean Ter.': 'AU',
    'Siachen Glacier': 'IN',
};

// Территории без постоянного населения: всегда одна область, вне игры.
const UNINHABITED = new Set(['AQ', 'BV', 'HM', 'GS', 'TF', 'UM', 'IO']);

function project(lonlat) {
    const lat = Math.max(LAT_MIN, Math.min(LAT_MAX, lonlat[1]));
    return [G.lonToX(lonlat[0]), G.latToY(lat)];
}

function projectRing(ring) {
    const out = ring.map(project);
    // после клампа широты подряд идущие точки могут совпасть
    const dedup = [out[0]];
    for (let i = 1; i < out.length; i++) {
        const p = out[i], q = dedup[dedup.length - 1];
        if (Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9) dedup.push(p);
    }
    if (dedup.length < 4) return null;
    const f = dedup[0], l = dedup[dedup.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) dedup.push([f[0], f[1]]);
    return dedup.length >= 4 ? dedup : null;
}

// Кольцо, пересекающее 180-й меридиан, в проекции растянулось бы на всю
// карту. Разворачиваем долготу в непрерывную и режем по меридиану.
function unwrapRing(ring) {
    const out = [[ring[0][0], ring[0][1]]];
    let shift = 0;
    for (let i = 1; i < ring.length; i++) {
        const d = ring[i][0] - ring[i - 1][0];
        if (d > 180) shift -= 360;
        else if (d < -180) shift += 360;
        out.push([ring[i][0] + shift, ring[i][1]]);
    }
    return out;
}

function meanLon(ring) {
    let s = 0;
    for (const p of ring) s += p[0];
    return s / ring.length;
}

function splitAtAntimeridian(poly) {
    const crosses = poly.some(ring => {
        for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) return true;
        return false;
    });
    if (!crosses) return [poly];

    const rings = poly.map(unwrapRing);
    const base = meanLon(rings[0]);
    // дыры переносим в ту же 360-градусную «полосу», что и внешний контур
    for (let i = 1; i < rings.length; i++) {
        const k = Math.round((base - meanLon(rings[i])) / 360);
        if (k) rings[i] = rings[i].map(([x, y]) => [x + k * 360, y]);
    }

    let lo = Infinity, hi = -Infinity;
    for (const r of rings) for (const [x] of r) { if (x < lo) lo = x; if (x > hi) hi = x; }

    const out = [];
    const first = Math.floor((lo + 180) / 360) * 360;
    for (let shift = first; shift < hi + 180; shift += 360) {
        const box = [[
            [-180 + shift, -90], [180 + shift, -90],
            [180 + shift, 90], [-180 + shift, 90], [-180 + shift, -90],
        ]];
        let part;
        try { part = pc.intersection([rings], box); } catch (e) { continue; }
        for (const p of part) out.push(p.map(r => r.map(([x, y]) => [x - shift, y])));
    }
    return out.length ? out : [poly];
}

function geometryToMulti(geom) {
    const raw = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const polys = [];
    for (const poly of raw) polys.push(...splitAtAntimeridian(poly));
    const out = [];
    for (const poly of polys) {
        const rings = [];
        for (const ring of poly) {
            const r = projectRing(ring);
            if (r && Math.abs(G.ringArea(r)) > 1e-7) rings.push(r);
        }
        if (rings.length) out.push(rings);
    }
    return out;
}

function load() {
    const world = require('world-atlas/countries-50m.json');
    const fc = topojson.feature(world, world.objects.countries);

    const byNum = new Map();
    for (const c of worldCountries) if (c.ccn3) byNum.set(c.ccn3, c);

    const parts = new Map();   // cc -> [MultiPolygon, ...]
    for (const f of fc.features) {
        let cc = NAME_TO_CC[f.properties.name];
        if (!cc) {
            const rec = byNum.get(String(f.id).padStart(3, '0'));
            cc = rec && rec.cca2;
        }
        if (!cc) continue;
        const mp = geometryToMulti(f.geometry);
        if (!mp.length) continue;
        if (!parts.has(cc)) parts.set(cc, []);
        parts.get(cc).push(mp);
    }

    const pops = countryPopulations();
    const out = [];
    for (const [cc, list] of parts) {
        let mp = list.length === 1 ? list[0] : pc.union(...list);
        mp = clipToView(mp);
        if (!mp.length) continue;
        const meta = worldCountries.find(c => c.cca2 === cc);
        out.push({
            cc,
            name: russianName(cc, meta),
            mp,
            areaKm2: meta && meta.area > 0 ? meta.area : G.areaKm2(mp),
            drawnAreaKm2: G.areaKm2(mp),
            population: pops.get(cc) || 0,
            uninhabited: UNINHABITED.has(cc),
            sovereign: !!(meta && meta.independent),
        });
    }
    out.sort((a, b) => a.cc.localeCompare(b.cc));
    return out;
}

function clipToView(mp) {
    const rect = [[[VIEW.x1, VIEW.y1], [VIEW.x2, VIEW.y1], [VIEW.x2, VIEW.y2], [VIEW.x1, VIEW.y2], [VIEW.x1, VIEW.y1]]];
    try { return pc.intersection(mp, [rect]); } catch (e) { return mp; }
}

function russianName(cc, meta) {
    if (cc === 'XK') return 'Косово';
    if (meta && meta.translations && meta.translations.rus) return meta.translations.rus.common;
    return (meta && meta.name.common) || cc;
}

// Основной источник — оценки ООН на 2024 год (tools/data/population_2024.json).
// Данные Всемирного банка из country-json (2018) остаются запасным вариантом
// для стран, которых нет в таблице.
function countryPopulations() {
    const m = new Map();
    try {
        const pop = require('country-json/src/country-by-population.json');
        const abbr = require('country-json/src/country-by-abbreviation.json');
        const byName = new Map(abbr.map(a => [a.country, a.abbreviation]));
        for (const rec of pop) {
            const cc = byName.get(rec.country);
            if (cc && rec.population) m.set(cc, rec.population);
        }
    } catch (e) { /* запасного источника нет */ }
    try {
        const table = require('../data/population_2024.json').population;
        for (const cc of Object.keys(table)) m.set(cc, table[cc]);
    } catch (e) { /* таблицы нет — остаёмся на запасном источнике */ }
    return m;
}

module.exports = { load, VIEW, LAT_MIN, LAT_MAX, UNINHABITED };
