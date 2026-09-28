// =====================================================================
// ФИНАНСЫ: окно по нажатию на казну
//
// Прогноз на следующий ход, прошлый ход «прогноз и факт», графики
// доходов-расходов и казны по ходам, госдолг. Данные — из countryBalance
// (прогноз) и из истории ходов: там GameLoop.resolveTurn сохраняет статьи
// факта, прогноз, который видел игрок, и «прочее» — деньги мимо бюджета
// (помощь партнёров, события, репарации, возвраты).
//
// Графики — по правилам: доходы над нулевой линией, расходы под ней (не
// только цветом), итог — точкой; касание показывает подробности хода.
// =====================================================================
const FINANCE_LINES = [
    { key: 'tax', name: 'Налоги', sign: 1 },
    { key: 'sales', name: 'Продажа ресурсов', sign: 1 },
    { key: 'purchases', name: 'Закупка ресурсов', sign: -1 },
    { key: 'social', name: 'Социальная программа', sign: -1 },
    { key: 'upkeep', name: 'Содержание армии', sign: -1 },
    { key: 'interest', name: 'Проценты банкам', sign: -1, optional: true },
    { key: 'bonds', name: 'Выплаты по облигациям', sign: -1, optional: true },
    { key: 'imf', name: 'Выплаты МВФ', sign: -1, optional: true },
];

const FINANCE_CHART = { HEIGHT: 170, PAD: { top: 12, right: 12, bottom: 22, left: 44 }, BAR_MAX: 24 };

class Finance {
    // Статьи бюджета — числа, округлённые до доллара.
    static lines(balance) {
        const out = {};
        for (const l of FINANCE_LINES) out[l.key] = Math.round((balance && balance[l.key]) || 0);
        return out;
    }

    static net(lines) {
        return FINANCE_LINES.reduce((s, l) => s + l.sign * (lines[l.key] || 0), 0);
    }

    static money(v, sign = false) {
        const s = Charts.short(Math.abs(v));
        return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + s;
    }

    static esc(s) {
        return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    }

    // Ходы из истории — от старых к новым; у старых партий статей может не быть.
    static turns(data) {
        return (data.history || []).slice().reverse()
            .map((t, i, all) => ({ turn: t.turn ?? (data.turn - (all.length - 1 - i)), date: t.date, f: t.financial }))
            .filter(t => t.f && Number.isFinite(t.f.income) && Number.isFinite(t.f.expense));
    }

    // --- окно ----------------------------------------------------------
    static render(container, data, ui) {
        const player = data.countries[data.playerCountry];
        const balance = data.countryBalance(player.id);
        const forecast = Finance.lines(balance);
        const net = balance.income - balance.expense;
        const turns = Finance.turns(data);
        const last = turns.length ? turns[turns.length - 1] : null;
        const bonds = Credit.bondsOwed(data, player.id), imf = Credit.peek(data, player.id)?.imf;
        const debt = (player.debt || 0) + bonds + (imf ? imf.left : 0);
        const parts = [['банк', player.debt || 0], ['облигации', bonds], ['МВФ', imf ? imf.left : 0]].filter(([, v]) => v);
        const signed = v => `<span class="${v >= 0 ? 'pos' : 'neg'}">${Finance.money(v, true)}</span>`;

        const tiles = `<div class="fin-tiles">
            <div class="fin-tile hero"><span>Казна</span><b>${Finance.money(player.money)}</b></div>
            <div class="fin-tile"><span>Прогноз на ход</span><b>${signed(net)}</b></div>
            <div class="fin-tile"><span>Прошлый ход, факт</span><b>${last ? signed(last.f.net) : '—'}</b>${last && last.f.forecast ? `<small>прогноз был ${Finance.money(Finance.net(last.f.forecast), true)}</small>` : ''}</div>
            <div class="fin-tile"><span>Госдолг</span><b>${Finance.money(debt)}</b><small>${parts.length ? parts.map(([k, v]) => `${k} ${Finance.money(v)}`).join(' · ') : 'долгов нет'}</small></div>
        </div>`;

        // прогноз: статьи с полосками, шкала общая для доходов и расходов
        const top = Math.max(1, ...FINANCE_LINES.map(l => forecast[l.key]));
        const rows = FINANCE_LINES.filter(l => !l.optional || forecast[l.key]).map(l => {
            const v = forecast[l.key];
            return `<div class="fin-row"><span class="fin-name">${l.name}</span>
                <span class="fin-bar"><i class="${l.sign > 0 ? 'in' : 'out'}" style="width:${Math.max(v ? 2 : 0, v / top * 100).toFixed(1)}%"></i></span>
                <span class="fin-val">${!v ? '' : l.sign > 0 ? '+' : '−'}${Finance.money(v)}</span></div>`;
        }).join('');
        const war = data.enemiesOf(player.id).length;
        const plan = `<h3 class="section-title">Бюджет на следующий ход · прогноз</h3>
            <div class="fin-block">${rows}
                <div class="fin-row total"><span class="fin-name">Итого за ход</span><span></span><span class="fin-val">${signed(net)}</span></div>
                <p class="hint">По ценам и спросу прошлого хода${war ? `, с учётом блокады (на войне торговля — ${Math.round(ECONOMY.WAR_TRADE * 100)}%)` : ''}. Цены, спрос и бои немного сдвинут факт. Помощь партнёров, транши МВФ, события и репарации — мимо бюджета, в строке «прочее» отчёта.</p>
            </div>`;

        // прошлый ход: прогноз и факт по статьям
        let compare = '';
        if (last) {
            const fc = last.f.forecast;
            const cell = (v, sign) => (v === undefined ? '<td class="muted">—</td>' : `<td>${!v ? '' : sign > 0 ? '+' : sign < 0 ? '−' : ''}${Finance.money(Math.abs(v))}</td>`);
            const lines = FINANCE_LINES.filter(l => (last.f[l.key] || 0) || (fc && fc[l.key]));
            const body = lines.map(l => `<tr><th>${l.name}</th>${fc ? cell(fc[l.key], l.sign) : ''}${cell(last.f[l.key], l.sign)}</tr>`).join('');
            const total = `<tr class="total"><th>Итого по бюджету</th>${fc ? `<td>${Finance.money(Finance.net(fc), true)}</td>` : ''}<td>${signed(last.f.net)}</td></tr>`;
            const other = Number.isFinite(last.f.other) && last.f.other ? `<tr><th>Прочее: помощь, транши, события</th>${fc ? '<td class="muted">—</td>' : ''}<td>${Finance.money(last.f.other, true)}</td></tr>
                <tr class="total"><th>Казна изменилась</th>${fc ? '<td class="muted">—</td>' : ''}<td>${signed(last.f.net + last.f.other)}</td></tr>` : '';
            compare = `<h3 class="section-title">Прошлый ход${last.date ? ` · ${Finance.esc(last.date)}` : ''}</h3>
                <div class="fin-block"><table class="fin-table"><thead><tr><th></th>${fc ? '<th>Прогноз</th>' : ''}<th>Факт</th></tr></thead><tbody>${body}${total}${other}</tbody></table>
                ${Number.isFinite(last.f.money) ? `<p class="hint">Казна после хода: ${Finance.money(last.f.money)}.${fc ? '' : ' Прогноз по статьям появится со следующего хода.'}</p>` : ''}</div>`;
        }

        const flow = turns.length >= 2 ? `<h3 class="section-title">Доходы и расходы по ходам</h3>
            <div class="fin-chart ch-card" id="fin-flow"><div class="ch-legend">
                <span class="ch-legend-item"><i class="fin-key in"></i>Доходы</span>
                <span class="ch-legend-item"><i class="fin-key out"></i>Расходы</span>
                <span class="ch-legend-item"><i class="fin-key net"></i>Итог хода</span></div>
                <div class="ch-plot"></div><div class="ch-tip" hidden></div></div>` : '';
        const money = Finance.treasury(data);
        const cash = money.length >= 2 ? `<h3 class="section-title">Казна по ходам</h3>
            <div class="fin-chart ch-card" id="fin-cash"><div class="ch-plot"></div><div class="ch-tip" hidden></div></div>` : '';
        const empty = !flow && !cash ? '<p class="hint">Графики появятся через пару ходов: игра записывает итоги в конце каждого хода.</p>' : '';

        container.innerHTML = `${tiles}${plan}${compare}${flow}${cash}${empty}
            <h3 class="section-title">Займы</h3><div id="gov-finance"></div>
            <button class="mini-btn fin-gov" type="button" data-action="open-gov">⚖️ Налоги и политический курс — в «Правительстве»</button>`;
        ui.renderFinance(data);

        const flowCard = container.querySelector('#fin-flow');
        if (flowCard) Finance.flowChart(flowCard, turns);
        const cashCard = container.querySelector('#fin-cash');
        if (cashCard) Finance.cashChart(cashCard, money);
    }

    // Казна игрока по хронике (в $M).
    static treasury(data) {
        const c = data.chronicle;
        if (!c) return [];
        const i = c.countries.indexOf(data.playerCountry);
        return i < 0 ? [] : c.turns.map(t => ({ turn: t[0], v: t[1][i][1] }));
    }

    // Подсказка у графика: рядом с касанием, не вылезая за край.
    static tip(card, svg, x, html) {
        const tip = card.querySelector('.ch-tip');
        tip.innerHTML = html;
        tip.hidden = false;
        const box = svg.getBoundingClientRect(), cardBox = card.getBoundingClientRect();
        const left = x + 12 + tip.offsetWidth > box.width ? Math.max(0, x - 12 - tip.offsetWidth) : x + 12;
        tip.style.left = `${left + (box.left - cardBox.left)}px`;
        tip.style.top = `${box.top - cardBox.top + 4}px`;
    }

    static hide(card, e) {
        if (e && e.pointerType === 'touch') return;   // на телефоне — до следующего касания
        card.querySelector('.ch-tip').hidden = true;
        for (const el of card.querySelectorAll('.fin-hl')) el.classList.remove('fin-hl');
    }

    // Столбики: доходы вверх, расходы вниз от нуля, итог — точкой на линии.
    static flowChart(card, turns) {
        const plot = card.querySelector('.ch-plot');
        const P = FINANCE_CHART.PAD, H = FINANCE_CHART.HEIGHT;
        const W = Math.max(240, Math.round(plot.clientWidth || 320));
        const plotW = W - P.left - P.right, plotH = H - P.top - P.bottom;
        const hi = Math.max(1, ...turns.map(t => t.f.income)), lo = -Math.max(1, ...turns.map(t => t.f.expense));
        const scale = Charts.ticks(Math.min(lo, ...turns.map(t => t.f.net)), Math.max(hi, ...turns.map(t => t.f.net)), 4);
        const y = v => P.top + plotH - (v - scale.lo) / (scale.hi - scale.lo) * plotH;
        const band = plotW / turns.length, bw = Math.min(FINANCE_CHART.BAR_MAX, band * 0.62);
        const cx = i => P.left + band * (i + 0.5);
        const r = n => Math.round(n * 10) / 10;
        // столбик со скруглённым концом данных и прямым краем у нуля
        const bar = (x, from, to, cls) => {
            const top = Math.min(from, to), h = Math.abs(to - from);
            if (h < 0.5) return '';
            const rad = Math.min(4, h, bw / 2), x0 = r(x - bw / 2), x1 = r(x + bw / 2);
            const d = to < from
                ? `M${x0},${r(from)}V${r(top + rad)}Q${x0},${r(top)} ${r(x0 + rad)},${r(top)}H${r(x1 - rad)}Q${x1},${r(top)} ${x1},${r(top + rad)}V${r(from)}Z`
                : `M${x0},${r(from)}V${r(top + h - rad)}Q${x0},${r(top + h)} ${r(x0 + rad)},${r(top + h)}H${r(x1 - rad)}Q${x1},${r(top + h)} ${x1},${r(top + h - rad)}V${r(from)}Z`;
            return `<path class="${cls}" d="${d}"/>`;
        };
        const grid = scale.list.map(v => `<line class="ch-grid${v === 0 ? ' zero' : ''}" x1="${P.left}" x2="${P.left + plotW}" y1="${r(y(v))}" y2="${r(y(v))}"/>
            <text class="ch-axis" x="${P.left - 6}" y="${r(y(v)) + 3}" text-anchor="end">${v ? Charts.short(v) : '0'}</text>`).join('');
        const cols = turns.map((t, i) => `<g class="fin-col" data-i="${i}">${bar(cx(i), y(0), y(t.f.income), 'fin-in')}${bar(cx(i), y(0), y(-t.f.expense), 'fin-out')}</g>`).join('');
        const netLine = turns.map((t, i) => `${i ? 'L' : 'M'}${r(cx(i))},${r(y(t.f.net))}`).join('');
        const dots = turns.map((t, i) => `<circle class="fin-net" cx="${r(cx(i))}" cy="${r(y(t.f.net))}" r="4"/>`).join('');
        const step = Math.max(1, Math.ceil(turns.length / 6));
        const xs = turns.map((t, i) => (i % step && i !== turns.length - 1 ? '' : `<text class="ch-axis" x="${r(cx(i))}" y="${H - 6}" text-anchor="middle">${t.turn}</text>`)).join('');
        const hits = turns.map((t, i) => `<rect class="fin-hit" data-i="${i}" x="${r(P.left + band * i)}" y="0" width="${r(band)}" height="${H}" fill="transparent"/>`).join('');
        plot.innerHTML = `<svg class="ch-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Доходы и расходы по ходам">
            ${grid}${cols}<path class="fin-net-line" d="${netLine}"/>${dots}${xs}${hits}</svg>`;
        const svg = plot.querySelector('svg');
        const show = e => {
            const i = Number(e.target.dataset.i);
            const t = turns[i];
            if (!t) return;
            for (const el of card.querySelectorAll('.fin-hl')) el.classList.remove('fin-hl');
            card.querySelector(`.fin-col[data-i="${i}"]`).classList.add('fin-hl');
            const parts = FINANCE_LINES.filter(l => t.f[l.key]).map(l => `<div class="ch-tip-row"><span class="ch-tip-name">${l.name}</span><span class="ch-tip-val">${l.sign > 0 ? '+' : '−'}${Finance.money(t.f[l.key])}</span></div>`).join('');
            const other = t.f.other ? `<div class="ch-tip-row"><span class="ch-tip-name">Прочее</span><span class="ch-tip-val">${Finance.money(t.f.other, true)}</span></div>` : '';
            Finance.tip(card, svg, cx(i), `<b>Ход ${t.turn}${t.date ? ` · ${Finance.esc(t.date)}` : ''}</b>
                <div class="ch-tip-row"><span class="ch-key fin-key in"></span><span class="ch-tip-name">Доходы</span><span class="ch-tip-val">+${Finance.money(t.f.income)}</span></div>
                <div class="ch-tip-row"><span class="ch-key fin-key out"></span><span class="ch-tip-name">Расходы</span><span class="ch-tip-val">−${Finance.money(t.f.expense)}</span></div>
                <div class="ch-tip-row"><span class="ch-key fin-key net"></span><span class="ch-tip-name">Итог</span><span class="ch-tip-val">${Finance.money(t.f.net, true)}</span></div>
                ${parts || other ? `<div class="fin-tip-parts">${parts}${other}</div>` : ''}`);
        };
        for (const hit of svg.querySelectorAll('.fin-hit')) {
            hit.addEventListener('pointerdown', show);
            hit.addEventListener('pointermove', show);
            hit.addEventListener('pointerleave', e => Finance.hide(card, e));
        }
    }

    // Казна: линия с лёгкой заливкой, значение в конце, касание — ход и сумма.
    static cashChart(card, points) {
        const plot = card.querySelector('.ch-plot');
        const P = { ...FINANCE_CHART.PAD, right: 52 }, H = 150;
        const W = Math.max(240, Math.round(plot.clientWidth || 320));
        const plotW = W - P.left - P.right, plotH = H - P.top - P.bottom;
        const vals = points.map(p => p.v);
        const scale = Charts.ticks(Math.min(0, ...vals), Math.max(...vals), 3);
        const t0 = points[0].turn, t1 = points[points.length - 1].turn;
        const x = t => P.left + (t1 === t0 ? plotW : (t - t0) / (t1 - t0) * plotW);
        const y = v => P.top + plotH - (v - scale.lo) / (scale.hi - scale.lo) * plotH;
        const r = n => Math.round(n * 10) / 10;
        const fmt = v => Finance.money(v * 1e6);
        const line = points.map((p, i) => `${i ? 'L' : 'M'}${r(x(p.turn))},${r(y(p.v))}`).join('');
        const area = `${line}L${r(x(t1))},${r(y(Math.max(0, scale.lo)))}L${r(x(t0))},${r(y(Math.max(0, scale.lo)))}Z`;
        const grid = scale.list.map(v => `<line class="ch-grid${v === 0 ? ' zero' : ''}" x1="${P.left}" x2="${P.left + plotW}" y1="${r(y(v))}" y2="${r(y(v))}"/>
            <text class="ch-axis" x="${P.left - 6}" y="${r(y(v)) + 3}" text-anchor="end">${v ? Charts.short(v * 1e6) : '0'}</text>`).join('');
        const end = points[points.length - 1];
        const mid = Math.round((t0 + t1) / 2);
        const xs = [...new Set([t0, mid, t1])].map((t, i, a) => `<text class="ch-axis" x="${r(x(t))}" y="${H - 6}" text-anchor="${a.length > 1 && i === 0 ? 'start' : i === a.length - 1 && a.length > 1 ? 'end' : 'middle'}">${i === 0 ? 'ход ' : ''}${t}</text>`).join('');
        plot.innerHTML = `<svg class="ch-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Казна по ходам">
            ${grid}<path class="fin-cash-area" d="${area}"/><path class="fin-cash-line" d="${line}"/>
            <circle class="fin-cash-end" cx="${r(x(end.turn))}" cy="${r(y(end.v))}" r="4"/>
            <text class="ch-label" x="${r(x(end.turn)) + 8}" y="${r(y(end.v)) + 4}">${fmt(end.v)}</text>
            ${xs}<line class="ch-cross" y1="${P.top}" y2="${P.top + plotH}" x1="-10" x2="-10" visibility="hidden"/>
            <circle class="fin-cash-dot" r="4" cx="-10" cy="-10"/>
            <rect class="ch-hit" x="${P.left}" y="0" width="${plotW}" height="${H}" fill="transparent"/></svg>`;
        const svg = plot.querySelector('svg'), cross = svg.querySelector('.ch-cross'), dot = svg.querySelector('.fin-cash-dot');
        const show = e => {
            const box = svg.getBoundingClientRect();
            const i = Math.max(0, Math.min(points.length - 1, Math.round((e.clientX - box.left - P.left) / plotW * (points.length - 1))));
            const p = points[i], px = x(p.turn);
            cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
            dot.setAttribute('cx', px); dot.setAttribute('cy', y(p.v));
            const prev = points[i - 1];
            Finance.tip(card, svg, px, `<b>Ход ${p.turn}</b><div class="ch-tip-row"><span class="ch-tip-name">Казна</span><span class="ch-tip-val">${fmt(p.v)}</span></div>
                ${prev ? `<div class="ch-tip-row"><span class="ch-tip-name">За ход</span><span class="ch-tip-val">${Finance.money((p.v - prev.v) * 1e6, true)}</span></div>` : ''}`);
        };
        const hit = svg.querySelector('.ch-hit');
        hit.addEventListener('pointerdown', show);
        hit.addEventListener('pointermove', show);
        hit.addEventListener('pointerleave', e => {
            if (e.pointerType === 'touch') return;
            cross.setAttribute('visibility', 'hidden'); dot.setAttribute('cx', -10); card.querySelector('.ch-tip').hidden = true;
        });
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Finance, FINANCE_LINES };
