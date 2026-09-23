'use strict';
// =====================================================================
// Геометрия и проекция карты world-map.svg
//
// Карта нарисована в проекции Web Mercator. Константы получены методом
// наименьших квадратов по 35 странам с известными границами по широте
// и 12 — по долготе; медианная невязка 0.16 px (см. tools/fit_projection.js).
// =====================================================================

const K = 132.5104;          // px на радиан (общий масштаб конформной проекции)
const X0 = 600.077;          // px, соответствует долготе 0
const Y0 = 382.764;          // px, соответствует широте 0
const R_EARTH = 6371.0088;   // км, средний радиус Земли

const DEG = Math.PI / 180;

function xToLon(x) { return (x - X0) / K / DEG; }
function yToLat(y) { return (2 * Math.atan(Math.exp((Y0 - y) / K)) - Math.PI / 2) / DEG; }
function lonToX(lon) { return X0 + lon * DEG * K; }
function latToY(lat) {
    const phi = Math.max(-85.05, Math.min(85.05, lat)) * DEG;
    return Y0 - K * Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

// --- разбор атрибута d (карта использует только M/L/Z) ---
function parsePath(d) {
    const rings = [];
    let ring = null;
    const re = /([MLZmlz])([^MLZmlz]*)/g;
    let m;
    while ((m = re.exec(d))) {
        const cmd = m[1].toUpperCase();
        if (cmd === 'Z') {
            if (ring && ring.length >= 3) rings.push(closeRing(ring));
            ring = null;
            continue;
        }
        const nums = (m[2].match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) || []).map(Number);
        for (let i = 0; i + 1 < nums.length; i += 2) {
            const pt = [nums[i], nums[i + 1]];
            if (cmd === 'M' && i === 0) {
                if (ring && ring.length >= 3) rings.push(closeRing(ring));
                ring = [pt];
            } else {
                if (!ring) ring = [];
                ring.push(pt);
            }
        }
    }
    if (ring && ring.length >= 3) rings.push(closeRing(ring));
    return rings;
}

function closeRing(r) {
    const a = r[0], b = r[r.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
    return r;
}

// --- планарные метрики (в px карты) ---
function ringArea(ring) {           // знаковая площадь, >0 = против часовой в системе SVG
    let s = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++) {
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return s / 2;
}

function polyAreaPx(mp) {          // MultiPolygon -> модуль площади с вычетом дыр
    let a = 0;
    for (const poly of mp) {
        for (let i = 0; i < poly.length; i++) {
            a += (i === 0 ? 1 : -1) * Math.abs(ringArea(poly[i]));
        }
    }
    return a;
}

function bboxOf(mp) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const poly of mp) for (const [x, y] of poly[0]) {
        if (x < x1) x1 = x; if (y < y1) y1 = y;
        if (x > x2) x2 = x; if (y > y2) y2 = y;
    }
    return [x1, y1, x2, y2];
}

// Реальная площадь в км². В Web Mercator dA_real = (R/K)² · cos²φ · dA_px,
// поэтому интегрируем cos²φ(y) по горизонтальным полосам постоянной высоты.
function areaKm2(mp, strips = 400) {
    const [, y1, , y2] = bboxOf(mp);
    if (!(y2 > y1)) return 0;
    const h = (y2 - y1) / strips;
    const scale = (R_EARTH / K) ** 2;
    let total = 0;
    for (let i = 0; i < strips; i++) {
        const yMid = y1 + (i + 0.5) * h;
        const w = crossSectionWidth(mp, yMid);
        if (w > 0) {
            const c = Math.cos(yToLat(yMid) * DEG);
            total += w * h * c * c;
        }
    }
    return total * scale;
}

// Суммарная длина пересечения горизонтали y с многоугольником.
function crossSectionWidth(mp, y) {
    const xs = [];
    for (const poly of mp) for (const ring of poly) {
        for (let i = 0, n = ring.length - 1; i < n; i++) {
            const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
            if ((ay <= y && by > y) || (by <= y && ay > y)) {
                xs.push({ x: ax + ((y - ay) / (by - ay)) * (bx - ax), dir: by > ay ? 1 : -1 });
            }
        }
    }
    if (xs.length < 2) return 0;
    xs.sort((a, b) => a.x - b.x);
    let w = 0, wind = 0, start = 0;
    for (const p of xs) {
        if (wind === 0) start = p.x;
        wind += p.dir;
        if (wind === 0) w += p.x - start;
    }
    return w;
}

function centroidOf(mp) {
    let cx = 0, cy = 0, a = 0;
    for (const poly of mp) {
        const ring = poly[0];
        for (let i = 0, n = ring.length - 1; i < n; i++) {
            const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
            a += cross;
            cx += (ring[i][0] + ring[i + 1][0]) * cross;
            cy += (ring[i][1] + ring[i + 1][1]) * cross;
        }
    }
    if (Math.abs(a) < 1e-12) {
        const [x1, y1, x2, y2] = bboxOf(mp);
        return [(x1 + x2) / 2, (y1 + y2) / 2];
    }
    return [cx / (3 * a), cy / (3 * a)];
}

function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, n = ring.length - 1; i < n; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
        if ((ay > pt[1]) !== (by > pt[1]) &&
            pt[0] < ((bx - ax) * (pt[1] - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
}

function pointInMulti(pt, mp) {
    for (const poly of mp) {
        if (!pointInRing(pt, poly[0])) continue;
        let inHole = false;
        for (let i = 1; i < poly.length; i++) if (pointInRing(pt, poly[i])) { inHole = true; break; }
        if (!inHole) return true;
    }
    return false;
}

// Точка гарантированно внутри многоугольника (для подписей и якорей).
// Берём самую широкую горизонтальную полосу и середину её длиннейшего отрезка.
function pointOnSurface(mp) {
    const [, y1, , y2] = bboxOf(mp);
    let best = null;
    for (let i = 1; i < 64; i++) {
        const y = y1 + ((y2 - y1) * i) / 64;
        const seg = longestSegment(mp, y);
        if (seg && (!best || seg.len > best.len)) best = seg;
    }
    return best ? [best.x, best.y] : centroidOf(mp);
}

function longestSegment(mp, y) {
    const xs = [];
    for (const poly of mp) for (const ring of poly) {
        for (let i = 0, n = ring.length - 1; i < n; i++) {
            const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
            if ((ay <= y && by > y) || (by <= y && ay > y)) {
                xs.push({ x: ax + ((y - ay) / (by - ay)) * (bx - ax), dir: by > ay ? 1 : -1 });
            }
        }
    }
    if (xs.length < 2) return null;
    xs.sort((a, b) => a.x - b.x);
    let wind = 0, start = 0, best = null;
    for (const p of xs) {
        if (wind === 0) start = p.x;
        wind += p.dir;
        if (wind === 0 && p.x - start > (best ? best.len : 0)) {
            best = { len: p.x - start, x: (start + p.x) / 2, y };
        }
    }
    return best;
}

// --- визуальный центр: полюс недоступности --------------------------
// Точка внутри многоугольника, наиболее удалённая от его границ (алгоритм
// polylabel: перебор клеток с отсечением по верхней оценке). В отличие от
// центроида и середины самой широкой хорды она не липнет к краю вогнутой
// или вытянутой области — сюда ставятся значки войск и подписи.
function poleOfInaccessibility(mp, precision = 0.02) {
    // берём самый крупный кусок: подпись нужна на основной суше, не на острове
    let poly = mp[0];
    for (const p of mp) if (Math.abs(ringArea(p[0])) > Math.abs(ringArea(poly[0]))) poly = p;
    const [x1, y1, x2, y2] = bboxOf([poly]);
    const w = x2 - x1, h = y2 - y1;
    const size = Math.min(w, h);
    if (size <= 0) return [x1, y1];

    const dist = (x, y) => {       // >0 внутри, <0 снаружи
        let inside = false, best = Infinity;
        for (const ring of poly) {
            for (let i = 0, n = ring.length - 1; i < n; i++) {
                const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
                if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
                best = Math.min(best, segDist2(x, y, ax, ay, bx, by));
            }
        }
        return (inside ? 1 : -1) * Math.sqrt(best);
    };
    const cell = (x, y, half) => {
        const d = dist(x, y);
        return { x, y, half, d, max: d + half * Math.SQRT2 };
    };

    const queue = [];
    const push = c => {             // очередь по убыванию max, двоичная вставка
        let lo = 0, hi = queue.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (queue[mid].max < c.max) hi = mid; else lo = mid + 1; }
        queue.splice(lo, 0, c);
    };
    const half0 = size / 2;
    for (let x = x1; x < x2; x += size) for (let y = y1; y < y2; y += size) push(cell(x + half0, y + half0, half0));

    const c = centroidOf([poly]);
    let best = cell(c[0], c[1], 0);
    const box = cell(x1 + w / 2, y1 + h / 2, 0);
    if (box.d > best.d) best = box;

    while (queue.length) {
        const cur = queue.shift();
        if (cur.d > best.d) best = cur;
        if (cur.max - best.d <= precision) continue;
        const q = cur.half / 2;
        push(cell(cur.x - q, cur.y - q, q));
        push(cell(cur.x + q, cur.y - q, q));
        push(cell(cur.x - q, cur.y + q, q));
        push(cell(cur.x + q, cur.y + q, q));
    }
    return [best.x, best.y, Math.max(0, best.d)];
}

function segDist2(px, py, ax, ay, bx, by) {
    let dx = bx - ax, dy = by - ay;
    if (dx !== 0 || dy !== 0) {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        ax += dx * t; ay += dy * t;
    }
    dx = px - ax; dy = py - ay;
    return dx * dx + dy * dy;
}

module.exports = {
    K, X0, Y0, R_EARTH,
    xToLon, yToLat, lonToX, latToY,
    parsePath, ringArea, polyAreaPx, bboxOf, areaKm2, centroidOf,
    pointInRing, pointInMulti, pointOnSurface, poleOfInaccessibility,
};
