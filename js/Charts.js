// =====================================================================
// ГРАФИКИ ПАРТИИ
//
// Хроника (Score.record) хранит по ходам четыре показателя для людей и
// трёх сильнейших компьютерных стран. Здесь — четыре маленьких графика
// рядом, по одному на показатель, с общей легендой: одна ось на график,
// цвет линии — цвет страны на карте, люди — сплошной линией, компьютер —
// пунктиром. Касание или наведение показывает все значения на этом ходу.
// =====================================================================
const CHART_MEASURES = [
    { name: 'Области', zero: true, fmt: v => String(Math.round(v)) },
    { name: 'Казна, $M', zero: true, fmt: v => (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)).toString().replace('-', '−') },
    { name: 'Сила армии', zero: true, fmt: v => Math.round(v).toLocaleString('ru-RU') },
    { name: 'Очки', zero: false, fmt: v => String(Math.round(v)) },
];

const CHART = {
    HEIGHT: 150,
    PAD: { top: 10, right: 54, bottom: 22, left: 42 },
    DASHES: ['5 3', '2 3', '8 3 2 3'],
};

class Charts {

    // Линии: цвет страны; одинаковые цвета разводим светлее.
    static series(data) {
        const names = (data.net && data.net.names) || {};
        const used = [];
        let ai = 0;
        return data.chronicle.countries.map((cc, index) => {
            const c = data.countries[cc];
            const human = data.isHuman(cc);
            let color = c.color;
            for (let step = 0; step < 3 && used.some(u => Charts.distance(u, color) < 60); step++) color = Charts.lighten(color, 0.35);
            used.push(color);
            return {
                cc, index, color, human,
                me: cc === data.playerCountry,
                name: c.name,
                who: cc === data.playerCountry ? 'вы' : human ? (names[cc] || 'игрок') : '',
                dash: human ? '' : CHART.DASHES[ai++ % CHART.DASHES.length],
            };
        });
    }

    static rgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        const n = m ? parseInt(m[1], 16) : 0x888888;
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    static distance(a, b) {
        const x = Charts.rgb(a), y = Charts.rgb(b);
        return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    }

    static lighten(hex, share) {
        return '#' + Charts.rgb(hex).map(v => Math.round(v + (255 - v) * share).toString(16).padStart(2, '0')).join('');
    }

    // Круглые деления: 1, 2, 5 × 10^n.
    static ticks(min, max, count = 3) {
        if (max <= min) max = min + 1;
        const raw = (max - min) / count;
        const pow = Math.pow(10, Math.floor(Math.log10(raw)));
        const step = [1, 2, 5, 10].map(k => k * pow).find(s => s >= raw) || 10 * pow;
        const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
        const list = [];
        for (let v = lo; v <= hi + step / 2; v += step) list.push(Math.round(v * 1e6) / 1e6);
        return { lo, hi, list };
    }

    static short(v) {
        const a = Math.abs(v), sign = v < 0 ? '−' : '';
        if (a >= 1e6) return sign + +(a / 1e6).toFixed(1) + 'M';
        if (a >= 1e3) return sign + +(a / 1e3).toFixed(1) + 'K';
        return sign + +a.toFixed(1);
    }

    // Один график: оси, линии, подписи в конце линий людей.
    static chart(chronicle, series, measure, width) {
        const turns = chronicle.turns;
        const P = CHART.PAD, H = CHART.HEIGHT;
        const W = Math.max(220, Math.round(width));
        const plotW = W - P.left - P.right, plotH = H - P.top - P.bottom;
        const m = CHART_MEASURES[measure];
        const values = turns.flatMap(t => t[1].map(row => row[measure]));
        let min = Math.min(...values), max = Math.max(...values);
        if (m.zero) min = Math.min(0, min);
        const scale = Charts.ticks(min, max);
        const t0 = turns[0][0], t1 = turns[turns.length - 1][0];
        const x = turn => P.left + (t1 === t0 ? plotW : (turn - t0) / (t1 - t0) * plotW);
        const y = v => P.top + plotH - (v - scale.lo) / (scale.hi - scale.lo) * plotH;
        const r = n => Math.round(n * 10) / 10;

        const grid = scale.list.map(v => `<line class="ch-grid" x1="${P.left}" x2="${P.left + plotW}" y1="${r(y(v))}" y2="${r(y(v))}"/>
            <text class="ch-axis" x="${P.left - 6}" y="${r(y(v)) + 3}" text-anchor="end">${Charts.short(v)}</text>`).join('');
        const mid = Math.round((t0 + t1) / 2);
        const xs = [...new Set([t0, mid, t1])].map((t, i, a) => `<text class="ch-axis" x="${r(x(t))}" y="${H - 6}" text-anchor="${a.length > 1 && i === 0 ? 'start' : i === a.length - 1 && a.length > 1 ? 'end' : 'middle'}">${i === 0 ? 'ход ' : ''}${t}</text>`).join('');
        // сначала компьютер, сверху люди, сверху всех — вы
        const order = [...series].sort((a, b) => (a.human - b.human) || (a.me - b.me));
        const lines = order.map(s => {
            const d = turns.map((t, i) => `${i ? 'L' : 'M'}${r(x(t[0]))},${r(y(t[1][s.index][measure]))}`).join('');
            return `<path class="ch-line ${s.human ? 'human' : 'ai'}" data-i="${s.index}" d="${d}" stroke="${s.color}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
        }).join('');
        // подписи — только людям, раздвигаем, чтобы не наезжали
        const last = turns[turns.length - 1];
        const labels = series.filter(s => s.human).map(s => ({ s, v: last[1][s.index][measure], y: y(last[1][s.index][measure]) }))
            .sort((a, b) => a.y - b.y);
        for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
        // у подписи — свой кружок цвета страны: линии могут совпасть
        const ends = labels.map(l => `<circle cx="${r(x(t1))}" cy="${r(y(l.v))}" r="3" fill="${l.s.color}" class="ch-end"/>
            <circle cx="${r(x(t1)) + 9}" cy="${r(l.y)}" r="3" fill="${l.s.color}"/>
            <text class="ch-label" x="${r(x(t1)) + 15}" y="${r(l.y) + 3}">${Charts.short(l.v)}</text>`).join('');
        return `<svg class="ch-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.name} по ходам">
            ${grid}${xs}${lines}${ends}
            <line class="ch-cross" y1="${P.top}" y2="${P.top + plotH}" x1="-10" x2="-10" visibility="hidden"/>
            <g class="ch-dots"></g>
            <rect class="ch-hit" x="${P.left}" y="0" width="${plotW}" height="${H}" fill="transparent"/>
        </svg>`;
    }

    // Наведение и касание: вертикальная линия, точки и подсказка со всеми
    // значениями на этом ходу.
    static bind(card, chronicle, series, measure, width) {
        const svg = card.querySelector('svg'), tip = card.querySelector('.ch-tip');
        const cross = svg.querySelector('.ch-cross'), dots = svg.querySelector('.ch-dots'), hit = svg.querySelector('.ch-hit');
        const turns = chronicle.turns, P = CHART.PAD;
        const plotW = svg.width.baseVal.value - P.left - P.right;
        const m = CHART_MEASURES[measure];
        const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        const show = e => {
            const box = svg.getBoundingClientRect();
            const px = e.clientX - box.left;
            const i = Math.max(0, Math.min(turns.length - 1, Math.round((px - P.left) / plotW * (turns.length - 1))));
            const t = turns[i];
            const cx = turns.length > 1 ? P.left + i / (turns.length - 1) * plotW : P.left + plotW;
            cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
            // точки ставим по тем же координатам, что и линии
            dots.innerHTML = series.map(s => {
                const path = svg.querySelector(`.ch-line[data-i="${s.index}"]`);
                const seg = path ? path.getAttribute('d').split(/[ML]/).filter(Boolean)[i] : null;
                if (!seg) return '';
                const [dx, dy] = seg.split(',');
                return `<circle cx="${dx}" cy="${dy}" r="4" fill="${s.color}" class="ch-dot"/>`;
            }).join('');
            const rows = series.map(s => ({ s, v: t[1][s.index][measure] })).sort((a, b) => b.v - a.v);
            tip.innerHTML = `<b>Ход ${t[0]}</b>${rows.map(({ s, v }) => `<div class="ch-tip-row"><span class="ch-key" style="background:${s.color}"></span><span class="ch-tip-name">${esc(s.name)}${s.who ? ` <small>${esc(s.who)}</small>` : ''}</span><span class="ch-tip-val">${m.fmt(v)}</span></div>`).join('')}`;
            tip.hidden = false;
            const left = cx + 12 + tip.offsetWidth > box.width ? Math.max(0, cx - 12 - tip.offsetWidth) : cx + 12;
            tip.style.left = `${left}px`;
        };
        const hide = e => {
            if (e && e.pointerType === 'touch') return;   // на телефоне подсказка остаётся до следующего касания
            cross.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; tip.hidden = true;
        };
        hit.addEventListener('pointermove', show);
        hit.addEventListener('pointerdown', show);
        hit.addEventListener('pointerleave', hide);
    }

    // Окно целиком: легенда, четыре графика, таблица последнего хода.
    // only — «только игроки»: соседи-гиганты не сжимают линии людей.
    static render(container, data, only = Charts.only) {
        const chronicle = data.chronicle;
        if (!chronicle || chronicle.turns.length < 2) {
            container.innerHTML = '<p class="hint">Графики появятся после первого хода: игра записывает показатели в конце каждого хода.</p>';
            return;
        }
        Charts.only = !!only;
        // цвета — по полному списку, чтобы фильтр не перекрашивал линии
        const series = Charts.series(data).filter(s => !only || s.human);
        const humans = data.humans.length > 1 ? 'Только игроки' : 'Только вы';
        const filter = `<div class="ch-filter" role="group" aria-label="Кого показать">
            <button class="chip ${only ? '' : 'on'}" type="button" data-only="0" aria-pressed="${!only}">Игроки и соседи</button>
            <button class="chip ${only ? 'on' : ''}" type="button" data-only="1" aria-pressed="${!!only}">${humans}</button></div>`;
        const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        const key = s => `<svg width="22" height="10" aria-hidden="true"><line x1="1" x2="21" y1="5" y2="5" stroke="${s.color}" stroke-width="${s.human ? 2.5 : 2}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/></svg>`;
        const legend = `<div class="ch-legend">${series.map(s => `<span class="ch-legend-item ${s.me ? 'me' : ''}">${key(s)}${esc(s.name)}${s.who ? ` <small>${s.human && !s.me ? '🎮 ' : ''}${esc(s.who)}</small>` : ''}</span>`).join('')}</div>`;
        const first = chronicle.turns[0], last = chronicle.turns[chronicle.turns.length - 1];
        const table = `<details class="ch-table"><summary>Таблица: ход ${last[0]}</summary><div class="ch-table-wrap"><table>
            <thead><tr><th>Страна</th>${CHART_MEASURES.map(m => `<th>${m.name}</th>`).join('')}<th>Рост очков</th></tr></thead>
            <tbody>${series.map(s => `<tr><td>${esc(s.name)}</td>${CHART_MEASURES.map((m, i) => `<td>${m.fmt(last[1][s.index][i])}</td>`).join('')}<td>${(g => (g >= 0 ? '+' : '−') + Math.abs(g))(last[1][s.index][3] - first[1][s.index][3])}</td></tr>`).join('')}</tbody>
        </table></div></details>`;
        container.innerHTML = `${filter}${legend}<div class="ch-grid-wrap">${CHART_MEASURES.map((m, i) => `<div class="ch-card" data-measure="${i}"><h4>${m.name}</h4><div class="ch-plot"></div><div class="ch-tip" hidden></div></div>`).join('')}</div>${table}
            <p class="hint">Люди — сплошные линии, компьютер — пунктир: три сильнейших соседа. Нажмите на график, чтобы увидеть значения на любом ходу.</p>`;
        for (const card of container.querySelectorAll('.ch-card')) {
            const measure = Number(card.dataset.measure);
            const width = card.querySelector('.ch-plot').clientWidth || 300;
            card.querySelector('.ch-plot').innerHTML = Charts.chart(chronicle, series, measure, width);
            Charts.bind(card, chronicle, series, measure, width);
        }
        for (const btn of container.querySelectorAll('[data-only]')) btn.onclick = () => Charts.render(container, data, btn.dataset.only === '1');
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Charts, CHART_MEASURES };
