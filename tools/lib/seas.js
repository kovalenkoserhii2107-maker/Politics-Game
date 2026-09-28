// =====================================================================
// МОРСКИЕ ЗОНЫ: деление воды на области, как суша
//
// Карта растрируется сеткой RES px. Клетка — суша (номер области), вода
// или «пустота» (за линией перемены дат и у Антарктиды). Зоны растут от
// опорных точек только по воде (поиск в ширину, с переходом через линию
// перемены дат) — поэтому граница зоны у берега и есть берег, а море за
// перешейком — другая зона.
//
// Проливы: поперёк воды ставится барьер — через него зоны не растут.
// Стороны пролива — зоны его опорных точек, связь между ними — отдельное
// ребро с пометкой пролива: закроют пролив — пройти нельзя. Узкие проливы,
// которых сетка не видит (Босфор, Суэцкий канал), работают так же.
//
// Опорные точки: заданные (seas.json — у каждого моря свои, с именем) и
// автоматические — у берега гуще, в открытом океане реже.
//
// Результат: зоны (имя, точка подписи, соседи, контур для рисования),
// линии границ между зонами по воде, рёбра-проливы, моря прибрежных
// областей и место значка порта у берега.
// =====================================================================
const G = require('./geo');

const RES = 0.5;                    // px карты на клетку сетки
const LAT_SOUTH = -62;              // южнее — не море игры
const SPACING = { near: 12, far: 46, grow: 1.0, grid: 5 };  // px: шаг опорных точек у берега и в океане
const UNDER_LAND = 3;               // клеток: контур зоны заходит под сушу — ступеньки сетки прячутся
const SIMPLIFY = 1.2;               // клеток: прореживание контуров (под сушей точность не нужна)

function buildSeas(regions, spec) {
    const W = Math.round(1200 / RES), H = Math.round(800 / RES);
    const X_MIN = G.lonToX(-180), X_MAX = G.lonToX(180);
    const c0 = Math.ceil(X_MIN / RES), c1 = Math.floor(X_MAX / RES) - 1;   // колонки мира
    const rowSouth = Math.floor(G.latToY(LAT_SOUTH) / RES);
    const N = W * H;
    const VOID = -2, WATER = -1, BARRIER = -3;

    // --- 1. суша по областям (развёртка строк) ---------------------------------
    const cell = new Int32Array(N).fill(WATER);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (c < c0 || c > c1 || r >= rowSouth) cell[r * W + c] = VOID;
    regions.forEach((reg, i) => {
        const rows = new Map();
        for (const poly of reg.mp) for (const ring of poly) {
            for (let k = 0; k < ring.length - 1; k++) {
                let [x1, y1] = ring[k], [x2, y2] = ring[k + 1];
                if (y1 === y2) continue;
                if (y1 > y2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
                const rA = Math.max(0, Math.ceil(y1 / RES - 0.5)), rB = Math.min(H - 1, Math.ceil(y2 / RES - 0.5) - 1);
                for (let r = rA; r <= rB; r++) {
                    const yc = (r + 0.5) * RES;
                    const x = x1 + (x2 - x1) * (yc - y1) / (y2 - y1);
                    let list = rows.get(r);
                    if (!list) rows.set(r, list = []);
                    list.push(x);
                }
            }
        }
        for (const [r, xs] of rows) {
            xs.sort((a, b) => a - b);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const cA = Math.max(0, Math.ceil(xs[k] / RES - 0.5)), cB = Math.min(W - 1, Math.ceil(xs[k + 1] / RES - 0.5) - 1);
                for (let c = cA; c <= cB; c++) if (cell[r * W + c] !== VOID) cell[r * W + c] = i;
            }
        }
    });

    const toCell = (lon, lat) => {
        const c = Math.floor(G.lonToX(lon) / RES), r = Math.floor(G.latToY(lat) / RES);
        return c >= 0 && c < W && r >= 0 && r < H ? r * W + c : -1;
    };
    // соседи клетки: 4 стороны, через линию перемены дат — на другой край
    const around = (idx, fn) => {
        const r = (idx / W) | 0, c = idx - r * W;
        if (r > 0) fn(idx - W);
        if (r < H - 1) fn(idx + W);
        fn(c === c0 ? idx + (c1 - c0) : idx - 1);
        fn(c === c1 ? idx - (c1 - c0) : idx + 1);
    };

    // --- 2. барьеры проливов -------------------------------------------------------
    const straitDefs = Object.entries(spec.straits || {});
    for (const [, s] of straitDefs) {
        for (const raw of s.barriers || []) {
        const line = raw.map(([lon, lat]) => [G.lonToX(lon) / RES, G.latToY(lat) / RES]);
        for (let k = 0; k + 1 < line.length; k++) {
            const [ax, ay] = line[k], [bx, by] = line[k + 1];
            const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 3) + 1;
            for (let t = 0; t <= steps; t++) {
                const x = ax + (bx - ax) * t / steps, y = ay + (by - ay) * t / steps;
                // толщина 2 клетки: по диагонали вода не просочится
                for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
                    const c = Math.floor(x) + dx, r = Math.floor(y) + dy;
                    if (c >= 0 && c < W && r >= 0 && r < H && cell[r * W + c] === WATER) cell[r * W + c] = BARRIER;
                }
            }
        }
        }
    }

    // --- 3. расстояние до берега (для шага опорных точек) ----------------------------
    const dist = new Float32Array(N).fill(Infinity);
    let queue = new Int32Array(N), qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (cell[i] !== WATER) { dist[i] = 0; queue[qt++] = i; }
    while (qh < qt) {
        const i = queue[qh++];
        around(i, j => { if (cell[j] === WATER && dist[j] === Infinity) { dist[j] = dist[i] + 1; queue[qt++] = j; } });
    }

    // --- 4. опорные точки ----------------------------------------------------------------
    const snap = idx => {
        if (idx < 0) return -1;
        if (cell[idx] === WATER) return idx;
        // ближайшая вода в радиусе 8 клеток
        const r0 = (idx / W) | 0, c0_ = idx - r0 * W;
        let best = -1, bd = Infinity;
        for (let dr = -8; dr <= 8; dr++) for (let dc = -8; dc <= 8; dc++) {
            const r = r0 + dr, c = c0_ + dc;
            if (r < 0 || r >= H || c < 0 || c >= W || cell[r * W + c] !== WATER) continue;
            const d = dr * dr + dc * dc;
            if (d < bd) { bd = d; best = r * W + c; }
        }
        return best;
    };
    const seeds = [];               // { idx, basin, forced, strait }
    const basins = Object.entries(spec.zones);
    basins.forEach(([id, z], b) => {
        z.seeds.forEach(([lon, lat], k) => {
            const idx = snap(toCell(lon, lat));
            // первая точка моря — его «главная» зона: там подпись моря
            if (idx >= 0 && !seeds.some(s => s.idx === idx)) seeds.push({ idx, basin: b, forced: true, head: k === 0 });
        });
    });
    for (const [sid, s] of straitDefs) {
        for (const side of ['a', 'b']) {
            const idx = snap(toCell(...s[side]));
            if (idx < 0) throw new Error(`seas.json: у пролива ${sid} сторона ${side} не на воде`);
            let seed = seeds.find(x => x.idx === idx);
            if (!seed) seeds.push(seed = { idx, basin: -1, forced: true });
            seed.strait = seed.strait || [];
            seed.strait.push(sid + ':' + side);
        }
    }
    // автоматические: сетка кандидатов, у берега чаще
    const radius = d => Math.min(SPACING.far, SPACING.near + SPACING.grow * d * RES) / RES;
    const cand = [];
    const step = Math.round(SPACING.grid / RES);
    for (let r = step >> 1; r < H; r += step) for (let c = c0 + (step >> 1); c <= c1; c += step) {
        const idx = r * W + c;
        if (cell[idx] === WATER && dist[idx] >= 2) cand.push(idx);
    }
    cand.sort((a, b) => dist[a] - dist[b] || a - b);
    const near = (idx, rad) => {
        const r = (idx / W) | 0, c = idx - r * W;
        return seeds.some(s => {
            const sr = (s.idx / W) | 0, sc = s.idx - sr * W;
            let dc = Math.abs(sc - c);
            dc = Math.min(dc, (c1 - c0 + 1) - dc);
            return (sr - r) ** 2 + dc ** 2 < rad * rad;
        });
    };
    for (const idx of cand) if (!near(idx, radius(dist[idx]))) seeds.push({ idx, basin: -1, forced: false });

    // --- 5. зоны растут по воде ----------------------------------------------------------
    const zoneOf = new Int32Array(N).fill(-1);
    qh = 0; qt = 0;
    seeds.forEach((s, z) => { zoneOf[s.idx] = z; queue[qt++] = s.idx; });
    while (qh < qt) {
        const i = queue[qh++];
        around(i, j => { if (cell[j] === WATER && zoneOf[j] < 0) { zoneOf[j] = zoneOf[i]; queue[qt++] = j; } });
    }
    const seaWater = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (zoneOf[i] >= 0) seaWater[i] = 1;

    // моря опорных точек без имени — по ближайшему именованному (тоже по воде)
    const basinOf = new Int32Array(N).fill(-1);
    qh = 0; qt = 0;
    for (const s of seeds) if (s.basin >= 0) { basinOf[s.idx] = s.basin; queue[qt++] = s.idx; }
    while (qh < qt) {
        const i = queue[qh++];
        around(i, j => { if (seaWater[j] && basinOf[j] < 0) { basinOf[j] = basinOf[i]; queue[qt++] = j; } });
    }

    // --- 6. соседство зон по воде + рёбра-проливы ---------------------------------------
    const adj = seeds.map(() => new Set());
    for (let i = 0; i < N; i++) {
        if (!seaWater[i]) continue;
        around(i, j => { if (seaWater[j] && zoneOf[j] !== zoneOf[i]) { adj[zoneOf[i]].add(zoneOf[j]); } });
    }
    const straitEdges = {};
    const straitMarks = {};
    for (const [sid, s] of straitDefs) {
        const za = zoneOf[snap(toCell(...s.a))], zb = zoneOf[snap(toCell(...s.b))];
        if (za === zb) throw new Error(`seas.json: у пролива ${sid} обе стороны в одной зоне — барьер не перекрыл воду`);
        adj[za].add(zb); adj[zb].add(za);
        straitEdges[[za, zb].sort((x, y) => x - y).join('|')] = sid;
        // значок — на середине первого барьера, без барьера — между сторонами
        const [p, q] = s.barriers && s.barriers.length ? [s.barriers[0][0], s.barriers[0][s.barriers[0].length - 1]] : [s.a, s.b];
        straitMarks[sid] = [+G.lonToX((p[0] + q[0]) / 2).toFixed(1), +G.latToY((p[1] + q[1]) / 2).toFixed(1)];
    }

    // явные связи там, где сетка «закрыла» узкий проход (Тиранский пролив)
    for (const [a, b] of spec.links || []) {
        const za = zoneOf[snap(toCell(...a))], zb = zoneOf[snap(toCell(...b))];
        if (za >= 0 && zb >= 0 && za !== zb) { adj[za].add(zb); adj[zb].add(za); }
    }

    // --- 7. контуры: вода зоны и кромка в UNDER_LAND клеток под сушей ----------------
    const tile = new Int32Array(zoneOf);
    const depth = new Uint8Array(N);
    qh = 0; qt = 0;
    for (let i = 0; i < N; i++) if (tile[i] >= 0) queue[qt++] = i;
    while (qh < qt) {
        const i = queue[qh++];
        if (depth[i] >= UNDER_LAND) continue;
        const r = (i / W) | 0, c = i - r * W;
        const push = j => { if (tile[j] < 0) { tile[j] = tile[i]; depth[j] = depth[i] + 1; queue[qt++] = j; } };
        if (r > 0) push(i - W); if (r < H - 1) push(i + W); if (c > 0) push(i - 1); if (c < W - 1) push(i + 1);
    }

    // --- 8. точка подписи: клетка зоны дальше всего от её края -----------------------
    const inner = new Float32Array(N).fill(-1);
    qh = 0; qt = 0;
    for (let i = 0; i < N; i++) {
        if (!seaWater[i]) continue;
        let edge = false;
        around(i, j => { if (!seaWater[j] || zoneOf[j] !== zoneOf[i]) edge = true; });
        if (edge) { inner[i] = 0; queue[qt++] = i; }
    }
    while (qh < qt) {
        const i = queue[qh++];
        around(i, j => { if (seaWater[j] && inner[j] < 0 && zoneOf[j] === zoneOf[i]) { inner[j] = inner[i] + 1; queue[qt++] = j; } });
    }
    const label = seeds.map(s => s.idx), area = new Int32Array(seeds.length), sumX = new Float64Array(seeds.length), sumY = new Float64Array(seeds.length);
    for (let i = 0; i < N; i++) {
        const z = zoneOf[i];
        if (z < 0) continue;
        area[z]++;
        const r = (i / W) | 0, c = i - r * W;
        sumX[z] += c; sumY[z] += r;
        if (inner[i] > inner[label[z]]) label[z] = i;
    }

    // --- 9. имена: имя моря + сторона света, если зон в нём несколько ---------------
    const zoneBasin = seeds.map((s, z) => (s.basin >= 0 ? s.basin : basinOf[s.idx]));
    const byBasin = new Map();
    zoneBasin.forEach((b, z) => { if (!byBasin.has(b)) byBasin.set(b, []); byBasin.get(b).push(z); });
    const DIRS = ['восток', 'северо-восток', 'север', 'северо-запад', 'запад', 'юго-запад', 'юг', 'юго-восток'];
    const names = [];
    for (const [b, list] of byBasin) {
        const base = b >= 0 ? basins[b][1].name : 'Открытое море';
        if (list.length === 1) { names[list[0]] = base; continue; }
        let tx = 0, ty = 0, ta = 0;
        for (const z of list) { tx += sumX[z]; ty += sumY[z]; ta += area[z]; }
        const cx = tx / ta, cy = ty / ta;
        const used = {};
        const labelled = list.map(z => {
            const dx = sumX[z] / area[z] - cx, dy = cy - sumY[z] / area[z];
            const near0 = Math.hypot(dx, dy) < 6;
            const dir = near0 ? 'центр' : DIRS[Math.round(((Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
            used[dir] = (used[dir] || 0) + 1;
            return [z, dir];
        });
        const seen = {};
        for (const [z, dir] of labelled) {
            seen[dir] = (seen[dir] || 0) + 1;
            names[z] = `${base} · ${dir}${used[dir] > 1 ? ' ' + seen[dir] : ''}`;
        }
    }

    // --- 10. контуры зон и линии границ по воде ------------------------------------------
    const paths = seeds.map((s, z) => tracePaths(tile, W, H, z, RES));
    const borders = traceBorders(zoneOf, seaWater, W, H, RES);

    // --- 11. моря прибрежных областей и место значка порта --------------------------
    const contact = regions.map(() => new Map());
    const anchor = regions.map(() => null);
    for (let i = 0; i < N; i++) {
        const reg = cell[i];
        if (reg < 0) continue;
        around(i, j => {
            if (!seaWater[j]) return;
            const m = contact[reg];
            m.set(zoneOf[j], (m.get(zoneOf[j]) || 0) + 1);
            const r = (i / W) | 0, c = i - r * W, rj = (j / W) | 0, cj = j - rj * W;
            const x = (c + cj + 1) / 2 * RES, y = (r + rj + 1) / 2 * RES;
            const d = Math.hypot(x - regions[reg].lx, y - regions[reg].ly);
            if (!anchor[reg] || d < anchor[reg].d) anchor[reg] = { x, y, d };
        });
    }

    const zoneId = z => 's' + z;
    const zones = {};
    seeds.forEach((s, z) => {
        const i = label[z], r = (i / W) | 0, c = i - r * W;
        const b = zoneBasin[z];
        zones[zoneId(z)] = {
            name: names[z], sea: b >= 0 ? basins[b][1].name : 'Открытое море', head: !!s.head,
            x: +((c + 0.5) * RES).toFixed(1), y: +((r + 0.5) * RES).toFixed(1),
            adj: [...adj[z]].sort((a, b2) => a - b2).map(zoneId), path: paths[z],
        };
    });
    const coast = {};
    regions.forEach((reg, i) => {
        const m = contact[i];
        if (!m.size) return;
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const seas = [...m.entries()].sort((a, b) => b[1] - a[1]).filter(([, n], k) => k === 0 || n / total >= 0.1).slice(0, 4).map(([z]) => zoneId(z));
        coast[reg.id] = { seas, x: +anchor[i].x.toFixed(2), y: +anchor[i].y.toFixed(2) };
    });
    const straits = {};
    for (const [k, sid] of Object.entries(straitEdges)) straits[k.split('|').map(Number).map(zoneId).sort().join('|')] = sid;
    const zoneAt = (lon, lat) => { const idx = snap(toCell(lon, lat)); return idx >= 0 && zoneOf[idx] >= 0 ? zoneId(zoneOf[idx]) : null; };
    return { zones, borders, straits, marks: straitMarks, coast, zoneAt, stats: { zones: seeds.length, auto: seeds.filter(s => !s.forced).length } };
}

// Контур зоны по клеткам: рёбра между клетками зоны и прочими, сцепленные в
// кольца, прорежены (Рамер — Дуглас — Пекер).
function tracePaths(tile, W, H, z, RES) {
    const next = new Map();         // вершина → следующие вершины (обход против часовой)
    const key = (x, y) => y * (W + 1) + x;
    const add = (ax, ay, bx, by) => {
        const k = key(ax, ay);
        if (!next.has(k)) next.set(k, []);
        next.get(k).push(key(bx, by));
    };
    let r0 = H, r1 = -1;
    for (let i = 0; i < W * H; i++) if (tile[i] === z) { const r = (i / W) | 0; if (r < r0) r0 = r; if (r > r1) r1 = r; }
    if (r1 < 0) return '';
    for (let r = r0; r <= r1; r++) for (let c = 0; c < W; c++) {
        if (tile[r * W + c] !== z) continue;
        if (r === 0 || tile[(r - 1) * W + c] !== z) add(c, r, c + 1, r);
        if (c === W - 1 || tile[r * W + c + 1] !== z) add(c + 1, r, c + 1, r + 1);
        if (r === H - 1 || tile[(r + 1) * W + c] !== z) add(c + 1, r + 1, c, r + 1);
        if (c === 0 || tile[r * W + c - 1] !== z) add(c, r + 1, c, r);
    }
    const rings = [];
    for (const [start, list] of next) {
        while (list.length) {
            const ring = [start];
            let cur = list.pop();
            while (cur !== start) {
                ring.push(cur);
                const out = next.get(cur);
                if (!out || !out.length) break;
                cur = out.pop();
            }
            if (ring.length >= 4) rings.push(ring.map(k => [(k % (W + 1)) * RES, Math.floor(k / (W + 1)) * RES]));
        }
    }
    return rings.map(ring => {
        const pts = simplify([...ring, ring[0]], SIMPLIFY * RES);
        return pts.length < 4 ? '' : 'M' + pts.slice(0, -1).map(p => `${+p[0].toFixed(1)},${+p[1].toFixed(1)}`).join('L') + 'Z';
    }).join('');
}

// Линии между соседними зонами там, где по обе стороны вода.
function traceBorders(zoneOf, seaWater, W, H, RES) {
    const segs = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const i = r * W + c;
        if (!seaWater[i]) continue;
        if (c + 1 < W && seaWater[i + 1] && zoneOf[i + 1] !== zoneOf[i]) segs.push([c + 1, r, c + 1, r + 1]);
        if (r + 1 < H && seaWater[i + W] && zoneOf[i + W] !== zoneOf[i]) segs.push([c, r + 1, c + 1, r + 1]);
    }
    // сцепить отрезки в ломаные
    const byPoint = new Map();
    const k = (x, y) => y * (W + 1) + x;
    segs.forEach((s, n) => {
        for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) {
            const key = k(x, y);
            if (!byPoint.has(key)) byPoint.set(key, []);
            byPoint.get(key).push(n);
        }
    });
    const used = new Uint8Array(segs.length);
    const lines = [];
    for (let n = 0; n < segs.length; n++) {
        if (used[n]) continue;
        used[n] = 1;
        let pts = [[segs[n][0], segs[n][1]], [segs[n][2], segs[n][3]]];
        for (const dir of [1, 0]) {
            for (;;) {
                const end = dir ? pts[pts.length - 1] : pts[0];
                const cand = (byPoint.get(k(end[0], end[1])) || []).find(m => !used[m]);
                if (cand === undefined) break;
                used[cand] = 1;
                const s = segs[cand];
                const other = s[0] === end[0] && s[1] === end[1] ? [s[2], s[3]] : [s[0], s[1]];
                if (dir) pts.push(other); else pts.unshift(other);
            }
        }
        pts = simplify(pts.map(([x, y]) => [x * RES, y * RES]), 0.5 * RES);
        lines.push('M' + pts.map(p => `${+p[0].toFixed(1)},${+p[1].toFixed(1)}`).join('L'));
    }
    return lines.join('');
}

function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        let best = -1, bd = 0;
        for (let i = a + 1; i < b; i++) {
            const d = G.segDist2(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
            if (d > bd) { bd = d; best = i; }
        }
        if (best >= 0 && bd > eps * eps) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
}

module.exports = { buildSeas };
