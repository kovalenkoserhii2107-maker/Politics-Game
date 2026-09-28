// =====================================================================
// ОКНО «ФЛОТ»: верфи в портах, эскадры в морях, блокады
//
// Верфи — порты страны: что строится или что можно заказать (класс — по
// уровню порта и технологиям, объём — по уровню). Эскадры — корабли в
// каждом море: состав, сила, кто ещё рядом; поход — из карточки моря.
//
// Карточка моря (seaCard) — как карточка области: берега, проливы, наша
// эскадра с походом «как марш», чужие флоты (если видны) и разведка.
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
            const others = Object.entries(data.navy[f.zone] || {}).filter(([x]) => x !== cc);
            const near = others.map(([x, s]) => `<span class="${data.isAtWar(x, cc) ? 'neg' : Diplomacy.isAllied(data, x, cc) ? 'pos' : 'muted'}">${name(x)} ${Navy.power(s)}</span>`).join(', ');
            const going = orders.filter(o => o.from === f.zone);
            const left = { ...f.ships };
            for (const o of going) for (const [k, n] of Object.entries(o.ships)) left[k] -= n;
            const free = Navy.count(left) > 0;
            const show = `<button class="mini-btn fl-pick" type="button" data-action="sea-show" data-zone="${f.zone}">🗺️ Открыть на карте${free && !data.gameOver ? ' · поход' : ''}</button>`;
            const queued = going.map(o => `<div class="budget-row"><span>→ ${zname(o.to)}: ${ships(o.ships)}</span><b><button class="mini-btn" type="button" data-action="fleet-unmove" data-from="${o.from}" data-to="${o.to}">✕</button></b></div>`).join('');
            const control = Navy.controller(data, f.zone) === cc ? '<span class="pos">море за нами</span>' : '<span class="neg">здесь сильнее чужой флот</span>';
            return `<div class="fin-block loan fl-squad ${focus === f.zone ? 'focus' : ''}" id="squad-${f.zone}"><div class="loan-head"><b>${zname(f.zone)}</b><small>сила ${Navy.power(f.ships)} · ${control}</small></div>
                <div class="fl-ships">${ships(f.ships)}</div>
                ${near ? `<p class="hint">Рядом: ${near}</p>` : ''}${queued}
                ${free ? '' : '<p class="hint">Вся эскадра уже в походе.</p>'}${show}</div>`;
        };
        const squads = fleets.length ? fleets.map(squad).join('')
            : '<p class="hint">Кораблей пока нет. Постройте их на верфи — они выйдут в море у порта.</p>';

        // чужие флоты у наших берегов
        const coast = new Set(data.getCountryRegions(cc).flatMap(r => Navy.seasOf(r.id)));
        const threats = [...coast].flatMap(z => Object.entries(data.navy[z] || {}).filter(([x]) => x !== cc && data.isAtWar(x, cc)).map(([x, s]) => `${zname(z)}: ${name(x)} — ${Navy.power(s)}`));

        container.innerHTML = `${head}
            <h3 class="section-title">Эскадры</h3>${squads}
            ${threats.length ? `<h3 class="section-title">Враг у наших берегов</h3><div class="fin-block"><p class="hint neg">${threats.join('<br>')}</p></div>` : ''}
            <h3 class="section-title">Верфи</h3>${yards}
            <p class="hint">Бой — если в одном море встретились воюющие флоты. Подлодки бьют крупные корабли, корветы и фрегаты — подлодки. Флот сильнее вражеского у чужого берега блокирует его порты и поддерживает наступление с моря (до +${Math.round(NAVY.SHORE_MAX * 100)}% к удару).</p>
            <button class="mini-btn fin-gov" type="button" data-action="open-straits">⚓ Судоходство и проливы</button>`;
    }

    // Прибрежные области каждого моря (один раз на игру).
    static shore(zone) {
        if (!FleetUI.shoreMap) {
            FleetUI.shoreMap = {};
            for (const [id, c] of Object.entries((typeof SeasDB !== 'undefined' && SeasDB.coast) || {})) {
                for (const z of c.seas) (FleetUI.shoreMap[z] || (FleetUI.shoreMap[z] = [])).push(id);
            }
        }
        return FleetUI.shoreMap[zone] || [];
    }

    static seaCard(data, zone, ui) {
        const cc = data.playerCountry;
        const zones = Navy.zones(), z = zones[zone];
        const zname = x => ui.escape(zones[x]?.name || x);
        const name = x => ui.escape(data.countries[x].name);
        const ships = s => Object.entries(s).filter(([, n]) => n).map(([k, n]) => `<span class="fl-ship" title="${SHIPS[k].name}">${SHIPS[k].icon}${n}</span>`).join('') || '—';
        const sight = Navy.sight(data, cc);
        const seen = sight.has(zone);
        const shore = FleetUI.shore(zone).map(id => data.regions[id]).filter(Boolean);
        const owners = [...new Set(shore.map(r => r.owner))];

        // --- метки: море, берега, кто держит, разведка, проливы
        const tags = [ui.tag(`🌊 ${ui.escape(z.sea)}`)];
        tags.push(owners.length ? ui.tag(`Берега: ${owners.slice(0, 4).map(name).join(', ')}${owners.length > 4 ? ` и ещё ${owners.length - 4}` : ''}`) : ui.tag('Открытое море'));
        const holder = seen ? Navy.controller(data, zone) : null;
        if (holder) tags.push(ui.tag(holder === cc ? '⚓ Море за нами' : `⚓ Море держит: ${name(holder)}`, holder === cc ? 'own' : data.isAtWar(holder, cc) ? 'war' : ''));
        const until = Navy.intelUntil(data, cc, zone);
        if (until !== null) tags.push(ui.tag(`🔭 Разведданные: ещё ${until - data.turn + 1} ход.`));
        for (const n of z.adj) {
            const s = Navy.strait(zone, n);
            if (!s) continue;
            const ok = Navy.canPass(data, cc, zone, n);
            tags.push(`<button class="mini-btn sea-strait" type="button" data-action="open-strait" data-strait="${s}">${ok ? '⇄' : '⛔'} ${ui.escape(STRAITS[s].name)} → ${zname(n)}</button>`);
        }

        // --- наша эскадра: состав, походы, «Поход» как марш войск
        let html = '';
        const own = Navy.fleet(data, zone, cc);
        if (own) {
            const busy = Navy.ordered(data, cc, zone);
            const rows = Object.entries(own).filter(([, n]) => n).map(([k, n]) => `
                <div class="army-list-item"><span class="unit-name"><span class="unit-icon">${SHIPS[k].icon}</span>${SHIPS[k].name}</span>
                <span class="unit-count">${n}${busy[k] ? ` <small class="muted">· в походе ${busy[k]}</small>` : ''}</span></div>`).join('');
            html += `<h3 class="section-title">Ваша эскадра · сила ${Navy.power(own)}</h3><div class="army-list">${rows}</div>`;
            const going = data.navalOrders.filter(o => o.cc === cc && o.from === zone);
            html += going.map(o => `<div class="budget-row sea-order"><span>⛴ → ${zname(o.to)}: ${ships(o.ships)}</span><b><button class="mini-btn" type="button" data-action="fleet-unmove" data-from="${o.from}" data-to="${o.to}" aria-label="Отменить поход">✕</button></b></div>`).join('');
            const free = Object.entries(own).map(([k, n]) => [k, n - (busy[k] || 0)]).filter(([, n]) => n > 0);
            if (!free.length) html += '<p class="hint">Вся эскадра уже в походе.</p>';
            else if (!data.gameOver) {
                const steppers = free.map(([k, n]) => ui.stepperRow({ key: k, icon: SHIPS[k].icon, label: SHIPS[k].name, sub: `есть ${n}`, max: n, value: n })).join('');
                html += `<button class="action-btn sea-move-btn" type="button" data-action="sea-move">⛴ Поход эскадры</button>
                    <div id="sea-move-box" class="sea-move-box" hidden>
                        <h3 class="section-title">Корабли в поход</h3>
                        <div id="sea-move-inputs">${steppers}</div>
                        <button class="action-btn sea-go-btn" type="button" data-action="sea-go" data-zone="${zone}">Выбрать море</button>
                        <button class="action-btn sea-cancel-btn" type="button" data-action="sea-move-cancel">Отмена</button>
                        <p class="hint">За ход — в соседнее море; через пролив — если он для вас открыт.</p>
                    </div>`;
            }
        }

        // --- чужие флоты: видны у наших берегов и эскадр, у союзников, по разведке
        const others = Navy.visible(data, cc, zone, sight).filter(([x]) => x !== cc);
        html += '<h3 class="section-title">Другие флоты</h3>';
        html += others.map(([x, s]) => {
            const cls = data.isAtWar(x, cc) ? 'neg' : Diplomacy.isAllied(data, x, cc) ? 'pos' : '';
            return `<div class="budget-row sea-foreign"><span><span class="swatch" style="background:${data.countries[x].color}"></span><span class="${cls}">${name(x)}</span></span><b>${ships(s)} · ${Navy.power(s)}</b></div>`;
        }).join('');
        if (!seen) {
            const queued = data.navalRecon.some(o => o.cc === cc && o.zone === zone);
            html += `<div class="fog-box">
                <div class="fog-icon">🌫️</div>
                <div class="fog-text">Чужие флоты здесь не видны: море далеко от ваших берегов и эскадр.</div>
                <div class="fog-chance">Вероятность успеха: ~${Navy.reconChance(data, cc, zone)}%</div>
                <button class="spy-btn" type="button" data-action="sea-spy" data-zone="${zone}" ${queued || data.gameOver ? 'disabled' : ''}>${queued ? 'Разведка в плане' : `🔭 Морская разведка (${ui.money(NAVY.RECON_COST)})`}</button>
            </div>`;
        } else if (!others.length) html += '<p class="muted">Чужих флотов нет.</p>';

        // --- порты на берегу и корабли, которые сюда спустят
        const ports = shore.filter(r => (r.development.port || 0) > 0);
        if (ports.length) {
            html += '<h3 class="section-title">Порты на берегу</h3>' + ports.map(r => `<div class="budget-row"><span>⚓ ${ui.escape(r.name)} <small class="muted">${name(r.owner)} · порт ${r.development.port}</small></span>${r.owner === cc ? `<b><button class="mini-btn" type="button" data-action="open-fleet" data-region="${r.id}">Верфь</button></b>` : ''}</div>`).join('');
        }
        const yards = data.shipyard.filter(o => o.cc === cc && o.zone === zone);
        html += yards.map(o => `<p class="hint">🏗️ ${ui.escape(data.regions[o.region].name)}: ${o.n} × ${SHIPS[o.type].icon} ${SHIPS[o.type].name} выйдут сюда через ${o.left} ход.</p>`).join('');
        html += `<p class="hint">Соседние моря: ${z.adj.map(zname).join(', ')}.</p>`;
        return { tags: tags.join(''), html };
    }
}
