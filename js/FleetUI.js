// =====================================================================
// ОКНО «ФЛОТ»: верфи в портах, эскадры в морях, блокады
//
// Верфи — порты страны: что строится или что можно заказать (класс — по
// уровню порта и технологиям, объём — по уровню). Эскадры — корабли в
// каждом море: состав, сила, кто ещё рядом, куда можно пойти за ход.
// Действия — data-action, их обрабатывает main.js.
// =====================================================================
class FleetUI {
    static render(container, data, ui, focus = null) {
        const cc = data.playerCountry;
        const zones = Navy.zones();
        const money = v => ui.money(v);
        const name = x => ui.escape(data.countries[x].name);
        const zname = z => ui.escape(zones[z]?.name || z);
        const ships = s => Object.entries(s).filter(([, n]) => n).map(([k, n]) => `<span class="fl-ship" title="${SHIPS[k].name}">${SHIPS[k].icon}${n}</span>`).join('') || '—';
        const fleets = Navy.fleets(data, cc);
        const power = Navy.totalPower(data, cc);
        const block = Navy.blockadeShare(data, cc);

        const head = `<div class="fin-tiles">
            <div class="fin-tile hero"><span>Сила флота</span><b>${power}</b><small>${fleets.reduce((s, f) => s + Navy.count(f.ships), 0)} кораблей</small></div>
            <div class="fin-tile"><span>Содержание</span><b class="neg">−${money(Navy.upkeep(data, cc))}</b><small>за ход</small></div>
        </div>${block ? `<div class="fin-alert">⚓ Враг блокирует ${Math.round(block * 100)}% нашего берега: порты стоят, морская торговля падает. Нужен флот сильнее в этих морях.</div>` : ''}`;

        // верфи
        const ports = data.getCountryRegions(cc).filter(r => (r.development.port || 0) > 0 && Navy.seasOf(r.id).length);
        let yards;
        if (!ports.length) {
            const coastal = data.getCountryRegions(cc).some(r => Shipping.coastal(r));
            yards = `<p class="hint">${coastal ? 'Верфей нет: постройте порт в прибрежной области («Развитие области» в её карточке). Класс кораблей растёт с уровнем порта.' : 'У страны нет выхода к морю — флот не построить.'}</p>`;
        } else {
            yards = ports.map(r => {
                const job = Navy.yardOf(data, r.id);
                const seas = Navy.seasOf(r.id);
                let body;
                if (job) {
                    body = `<div class="budget-row"><span>Строится</span><b>${job.n} × ${SHIPS[job.type].icon} ${SHIPS[job.type].name}</b></div>
                        <div class="budget-row"><span>Готово через</span><b>${job.left} ход. · ${zname(job.zone)}</b></div>
                        <div class="help-chips"><button class="chip help-chip" type="button" data-action="fleet-cancel" data-region="${r.id}">✕ Отменить · вернуть ${money(job.cost)}</button></div>`;
                } else {
                    const pick = seas.length > 1 ? `<label class="fl-sea">Спустить в <select data-fleet-zone="${r.id}">${seas.map(z => `<option value="${z}">${zname(z)}</option>`).join('')}</select></label>` : `<div class="hint">Корабли выйдут в ${zname(seas[0])}.</div>`;
                    // по строке на класс: что это, цена и срок, заказ «+1» и «+сколько влезет»
                    const rows = Object.entries(SHIPS).map(([type, s]) => {
                        const can = Navy.buildable(data, r.id, type);
                        const label = `<span class="fl-type-name">${s.icon} ${s.name}<small>${can.ok ? `${money(s.cost)} · ${s.turns} ход. · удар ${s.attack}, защита ${s.defense}${s.asw >= 5 ? ', ПЛО' : ''}` : ui.escape(can.reason)}</small></span>`;
                        if (!can.ok) return `<div class="fl-type off">${label}</div>`;
                        const cash = data.countries[cc].money;
                        const n = Math.max(1, Math.min(can.max, Math.floor(cash / s.cost)));
                        const btn = k => `<button class="chip help-chip" type="button" data-action="fleet-build" data-region="${r.id}" data-type="${type}" data-n="${k}" ${cash < s.cost * k ? 'disabled' : ''} title="${money(s.cost * k)}">+${k}</button>`;
                        return `<div class="fl-type">${label}${btn(1)}${n > 1 ? btn(n) : ''}</div>`;
                    }).join('');
                    body = `${pick}<div class="fl-types">${rows}</div>`;
                }
                return `<div class="fin-block loan" id="yard-${r.id}"><div class="loan-head"><b>⚓ ${ui.escape(r.name)}</b><small>порт ${r.development.port}/5 · ${seas.map(zname).join(', ')}</small></div>${body}</div>`;
            }).join('');
        }

        // эскадры
        const orders = data.navalOrders.filter(o => o.cc === cc);
        const squad = f => {
            const zone = zones[f.zone];
            const others = Object.entries(data.navy[f.zone] || {}).filter(([x]) => x !== cc);
            const near = others.map(([x, s]) => `<span class="${data.isAtWar(x, cc) ? 'neg' : Diplomacy.isAllied(data, x, cc) ? 'pos' : 'muted'}">${name(x)} ${Navy.power(s)}</span>`).join(', ');
            const going = orders.filter(o => o.from === f.zone);
            const left = { ...f.ships };
            for (const o of going) for (const [k, n] of Object.entries(o.ships)) left[k] -= n;
            const free = Navy.count(left) > 0;
            const moves = (zone?.adj || []).map(z => {
                const ok = Navy.canPass(data, cc, f.zone, z);
                const strait = Navy.strait(f.zone, z);
                const foe = Navy.enemyPower(data, z, cc);
                return `<button class="chip help-chip" type="button" data-action="fleet-move" data-from="${f.zone}" data-to="${z}" ${ok && free && !data.gameOver ? '' : 'disabled'}
                    title="${ok ? '' : 'Пролив закрыт'}">${strait ? (ok ? '⇄ ' : '⛔ ') : ''}${zname(z)}${foe ? ` <span class="neg">⚔${foe}</span>` : ''}</button>`;
            }).join('');
            const pick = `<button class="mini-btn fl-pick" type="button" data-action="fleet-pick" data-from="${f.zone}" ${free && !data.gameOver ? '' : 'disabled'}>🗺️ Выбрать море на карте · до ${NAVY.SPEED} морей за ход</button>`;
            const queued = going.map(o => `<div class="budget-row"><span>→ ${zname(o.to)}: ${ships(o.ships)}</span><b><button class="mini-btn" type="button" data-action="fleet-unmove" data-from="${o.from}" data-to="${o.to}">✕</button></b></div>`).join('');
            const control = Navy.controller(data, f.zone) === cc ? '<span class="pos">море за нами</span>' : '<span class="neg">здесь сильнее чужой флот</span>';
            return `<div class="fin-block loan fl-squad ${focus === f.zone ? 'focus' : ''}" id="squad-${f.zone}"><div class="loan-head"><b>${zname(f.zone)}</b><small>сила ${Navy.power(f.ships)} · ${control}</small></div>
                <div class="fl-ships">${ships(f.ships)}</div>
                ${near ? `<p class="hint">Рядом: ${near}</p>` : ''}${queued}
                ${free ? `${pick}<div class="fl-go">Или в соседнее море:</div><div class="help-chips">${moves}</div>` : '<p class="hint">Вся эскадра уже в походе.</p>'}</div>`;
        };
        const squads = fleets.length ? fleets.map(squad).join('')
            : '<p class="hint">Кораблей пока нет. Постройте их на верфи — они выйдут в море у порта.</p>';

        // чужие флоты у наших берегов
        const coast = new Set(data.getCountryRegions(cc).flatMap(r => Navy.seasOf(r.id)));
        const threats = [...coast].flatMap(z => Object.entries(data.navy[z] || {}).filter(([x]) => x !== cc && data.isAtWar(x, cc)).map(([x, s]) => `${zname(z)}: ${name(x)} — ${Navy.power(s)}`));

        // фокус из карты: море без нашей эскадры — показать, кто там
        let focused = '';
        if (focus && !fleets.some(f => f.zone === focus) && zones[focus]) {
            const here = Object.entries(data.navy[focus] || {});
            focused = `<div class="fin-block loan fl-squad focus" id="squad-${focus}"><div class="loan-head"><b>${zname(focus)}</b><small>${here.length ? 'чужие флоты' : 'флотов нет'}</small></div>
                ${here.map(([x, s]) => `<div class="budget-row"><span>${name(x)}</span><b>${ships(s)} · ${Navy.power(s)}</b></div>`).join('')}
                <p class="hint">Соседние моря: ${zones[focus].adj.map(zname).join(', ')}.</p></div>`;
        }

        container.innerHTML = `${head}${focused}
            <h3 class="section-title">Эскадры</h3>${squads}
            ${threats.length ? `<h3 class="section-title">Враг у наших берегов</h3><div class="fin-block"><p class="hint neg">${threats.join('<br>')}</p></div>` : ''}
            <h3 class="section-title">Верфи</h3>${yards}
            <p class="hint">Бой — если в одном море встретились воюющие флоты. Подлодки бьют крупные корабли, корветы и фрегаты — подлодки. Флот сильнее вражеского у чужого берега блокирует его порты и поддерживает наступление с моря (до +${Math.round(NAVY.SHORE_MAX * 100)}% к удару).</p>
            <button class="mini-btn fin-gov" type="button" data-action="open-straits">⚓ Судоходство и проливы</button>`;
    }
}
