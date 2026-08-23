'use strict';
// Загрузка world-map.svg -> {cc: MultiPolygon} в координатах карты (px).
const fs = require('fs');
const G = require('./geo');

function insidePoint(ring) {
    const ys = ring.map(p => p[1]);
    const y1 = Math.min(...ys), y2 = Math.max(...ys);
    let best = null;
    for (let i = 1; i < 16; i++) {
        const y = y1 + ((y2 - y1) * i) / 16;
        const xs = [];
        for (let j = 0, n = ring.length - 1; j < n; j++) {
            const [ax, ay] = ring[j], [bx, by] = ring[j + 1];
            if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const len = xs[k + 1] - xs[k];
            if (!best || len > best.len) best = { len, pt: [(xs[k] + xs[k + 1]) / 2, y] };
        }
    }
    return best ? best.pt : ring[0];
}

function load(svgFile) {
    const src = fs.readFileSync(svgFile, 'utf8');
    const out = {};
    const re = /<path\s+d="([^"]+)"\s+id="([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) {
        const cc = m[2].split('-')[0];
        const rings = G.parsePath(m[1]).filter(r => Math.abs(G.ringArea(r)) > 1e-9);
        (out[cc] = out[cc] || []).push(...rings);
    }
    const result = {};
    for (const cc of Object.keys(out)) result[cc] = nest(out[cc]);
    return result;
}

// Разбор вложенности: кольцо на чётной глубине — контур, на нечётной — дыра.
function nest(rings) {
    const items = rings.map(r => ({
        ring: r,
        area: Math.abs(G.ringArea(r)),
        pt: insidePoint(r),
        bbox: bbox(r),
    }));
    items.sort((a, b) => b.area - a.area);

    for (const it of items) {
        it.parent = null;
        for (const cand of items) {
            if (cand === it || cand.area <= it.area) continue;
            if (!bboxContains(cand.bbox, it.bbox)) continue;
            if (!G.pointInRing(it.pt, cand.ring)) continue;
            // ближайший (наименьший) из объемлющих
            if (!it.parent || cand.area < it.parent.area) it.parent = cand;
        }
    }
    for (const it of items) {
        let d = 0;
        for (let p = it.parent; p; p = p.parent) d++;
        it.depth = d;
    }
    const polys = [];
    for (const it of items) {
        if (it.depth % 2 === 0) { it.poly = [it.ring]; polys.push(it.poly); }
    }
    for (const it of items) {
        if (it.depth % 2 === 1 && it.parent && it.parent.poly) it.parent.poly.push(it.ring);
    }
    return polys;
}

function bbox(r) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of r) {
        if (x < x1) x1 = x; if (y < y1) y1 = y;
        if (x > x2) x2 = x; if (y > y2) y2 = y;
    }
    return [x1, y1, x2, y2];
}
function bboxContains(a, b) { return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3]; }

module.exports = { load };
