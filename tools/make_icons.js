// Иконка приложения: изометрический куб 3×3×3 из серых кубиков, часть
// снята — в сердцевине виден красный кубик.
//
//   node tools/make_icons.js            — пишет icons/*.svg
//   NODE_PATH=<где лежит playwright> node tools/make_icons.js --png
//                                       — ещё и PNG 180/192/512 (Chromium)
//
// Рисуем сами (а не картинкой), чтобы иконка была чёткой на любом экране.
// Три варианта: icon.svg — со скруглённой плашкой (вкладка браузера),
// icon-full.svg — квадрат во весь холст (iOS и Android скругляют сами),
// icon-maskable.svg — с полями, чтобы маска Android не срезала кубы.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'icons');

// Какие кубики есть: [x, y, z], x — вправо-вниз, y — влево-вниз, z — вверх.
// Зритель смотрит с угла (+x, +y, +z). Снизу — полный слой, выше сняты те,
// что закрывают центр (1,1,1), и передний угол — он становится «колодцем».
function cubes() {
    const out = [];
    const removed = new Set([
        '1,1,2', '2,1,2', '1,2,2', '2,2,2',     // верх над центром и перед ним
        '2,1,1', '1,2,1', '2,2,1',              // средний слой перед центром
    ]);
    for (let z = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        if (!removed.has(`${x},${y},${z}`)) out.push([x, y, z]);
    }
    out.push([0, 0, 3]);        // дальний угол приподнят — как на образце
    return out;
}

const RED = '1,1,1';

// Изометрия: ребро куба a, зазор между кубиками — доля gap.
function draw({ size = 512, pad = 0.16, round = 0.22, bg = true }) {
    const span = size * (1 - pad * 2);
    // вписываем по габаритам: считаем проекцию с ребром 1, потом масштабируем
    const c30 = Math.cos(Math.PI / 6);
    const raw = (x, y, z) => [(x - y) * c30, (x + y) * 0.5 - z];
    const all = cubes().flatMap(([x, y, z]) => [0, 1].flatMap(dx => [0, 1].flatMap(dy => [0, 1].map(dz => raw(x + dx, y + dy, z + dz)))));
    const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
    const minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
    const a = span / Math.max(maxX - minX, maxY - minY);
    const ox = (size - (maxX - minX) * a) / 2 - minX * a, oy = (size - (maxY - minY) * a) / 2 - minY * a;
    const P = (x, y, z) => { const [X, Y] = raw(x, y, z); return [ox + X * a, oy + Y * a]; };
    const k = 0.9;      // кубик меньше ячейки — между ними тонкие щели
    const pts = list => list.map(([X, Y]) => `${X.toFixed(1)},${Y.toFixed(1)}`).join(' ');

    const faces = [];
    const list = cubes().sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]) || p[2] - q[2]);
    for (const [x, y, z] of list) {
        const o = (1 - k) / 2;
        const x0 = x + o, y0 = y + o, z0 = z + o, x1 = x0 + k, y1 = y0 + k, z1 = z0 + k;
        const red = `${x},${y},${z}` === RED;
        const f = red ? 'r' : 'g';
        // верх (+z), правая передняя (+x), левая передняя (+y)
        faces.push(`<polygon points="${pts([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)])}" fill="url(#${f}t)"/>`);
        faces.push(`<polygon points="${pts([P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0)])}" fill="url(#${f}r)"/>`);
        faces.push(`<polygon points="${pts([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)])}" fill="url(#${f}l)"/>`);
        // светлые рёбра сверху — как фаска на образце
        faces.push(`<polyline points="${pts([P(x0, y1, z1), P(x0, y0, z1), P(x1, y0, z1)])}" fill="none" stroke="${red ? '#f06a7e' : '#b9bbc0'}" stroke-opacity="0.55" stroke-width="${(a * 0.025).toFixed(2)}" stroke-linejoin="round"/>`);
        faces.push(`<polyline points="${pts([P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1)])}" fill="none" stroke="#ffffff" stroke-opacity="${red ? 0.22 : 0.16}" stroke-width="${(a * 0.02).toFixed(2)}" stroke-linejoin="round"/>`);
        faces.push(`<line x1="${P(x1, y1, z1)[0].toFixed(1)}" y1="${P(x1, y1, z1)[1].toFixed(1)}" x2="${P(x1, y1, z0)[0].toFixed(1)}" y2="${P(x1, y1, z0)[1].toFixed(1)}" stroke="#ffffff" stroke-opacity="0.1" stroke-width="${(a * 0.02).toFixed(2)}"/>`);
    }

    const r = size * round;
    const back = !bg ? '' : `<rect width="${size}" height="${size}" rx="${r.toFixed(1)}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" rx="${r.toFixed(1)}" fill="url(#vig)"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34373c"/><stop offset="1" stop-color="#1f2125"/></linearGradient>
    <radialGradient id="vig" cx="50%" cy="45%" r="65%"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>
    <linearGradient id="gt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3a5aa"/><stop offset="1" stop-color="#8a8c91"/></linearGradient>
    <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#76787d"/><stop offset="1" stop-color="#606267"/></linearGradient>
    <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d5f64"/><stop offset="1" stop-color="#47494e"/></linearGradient>
    <linearGradient id="rt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0405a"/><stop offset="1" stop-color="#c52a44"/></linearGradient>
    <linearGradient id="rl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b52038"/><stop offset="1" stop-color="#94172c"/></linearGradient>
    <linearGradient id="rr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c1428"/><stop offset="1" stop-color="#6e0f1f"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${(size * 0.012).toFixed(1)}" stdDeviation="${(size * 0.014).toFixed(1)}" flood-color="#000" flood-opacity="0.45"/></filter>
  </defs>
  ${back}
  <g filter="url(#sh)">
    ${faces.join('\n    ')}
  </g>
</svg>
`;
}

const variants = {
    'icon.svg': { round: 0.22, pad: 0.1 },
    'icon-full.svg': { round: 0, pad: 0.12 },
    'icon-maskable.svg': { round: 0, pad: 0.2 },
};
for (const [name, opts] of Object.entries(variants)) fs.writeFileSync(path.join(OUT, name), draw(opts));
console.log('SVG:', Object.keys(variants).join(', '));

if (process.argv.includes('--png')) {
    const { chromium } = require('playwright');
    (async () => {
        const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
        const page = await browser.newPage();
        const shots = [['icon-full.svg', 180, 'icon-180.png'], ['icon-full.svg', 192, 'icon-192.png'], ['icon-full.svg', 512, 'icon-512.png'],
            ['icon-maskable.svg', 512, 'icon-maskable-512.png'], ['icon.svg', 32, 'favicon-32.png']];
        for (const [src, px, out] of shots) {
            const svg = fs.readFileSync(path.join(OUT, src), 'utf8').replace(/width="\d+" height="\d+"/, `width="${px}" height="${px}"`);
            await page.setViewportSize({ width: px, height: px });
            await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
            await page.screenshot({ path: path.join(OUT, out), omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
        }
        await browser.close();
        console.log('PNG:', shots.map(s => s[2]).join(', '));
    })();
}
