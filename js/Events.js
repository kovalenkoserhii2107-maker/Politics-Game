// =====================================================================
// СОБЫТИЯ С ВЫБОРОМ
//
// Раз в несколько ходов стране игрока выпадает событие: забастовка,
// урожай, беженцы, наёмники… У каждого два варианта с разной ценой.
// Приходит после отчёта хода, как предложение от другой страны, и так же
// проходит в сетевой игре (ответ — команда answerDecision).
//
// Суммы — в неделях налогового дохода страны: ощутимо и для Молдовы, и
// для Китая. ctx — подробности события, выбранные при выпадении.
// =====================================================================
const EVENT_RULES = { FIRST_TURN: 2, GAP: 3, CHANCE: 0.35 };

const Ev = {
    week: (d, cc) => Math.max(200000, d.countryBalance(cc).tax),
    money: n => `$${(Math.abs(n) / 1e6).toFixed(1)}M`,
    round: n => Math.round(n / 1e5) * 1e5,
    loyalty(d, cc, delta, regions) {
        for (const r of regions || d.getCountryRegions(cc)) r.loyalty = Math.max(0.2, Math.min(1, r.loyalty + delta));
    },
    capital(d, cc) {
        const id = d.countries[cc].capital;
        return id && d.regions[id] && d.regions[id].owner === cc ? d.regions[id] : d.getCountryRegions(cc)[0];
    },
};

const EVENTS = {
    strike: {
        icon: '🏭', title: 'Забастовка на заводах',
        when: (d, cc) => ({ cost: Ev.round(Ev.week(d, cc) * 1.5) }),
        text: (d, cc, x) => `Рабочие требуют прибавки. Если уступить — это ${Ev.money(x.cost)}, но люди запомнят заботу. Если нет — недовольство разойдётся по стране.`,
        options: [
            { label: x => `Поднять зарплаты · −${Ev.money(x.cost)}`, apply: (d, cc, x) => { d.countries[cc].money -= x.cost; Ev.loyalty(d, cc, 0.05); return 'Забастовка окончена, лояльность +5%'; } },
            { label: () => 'Не уступать', apply: (d, cc) => { Ev.loyalty(d, cc, -0.08); return 'Лояльность −8% во всех областях'; } },
        ],
    },
    harvest: {
        icon: '🌾', title: 'Богатый урожай',
        when: (d, cc) => ({ money: Ev.round(Ev.week(d, cc)), food: Math.max(5, Math.round(Economy.flows(d, cc).food.need * 2)) }),
        text: (d, cc, x) => `Амбары ломятся. Излишки можно продать сразу или заложить в запасы на трудные времена.`,
        options: [
            { label: x => `Продать · +${Ev.money(x.money)}`, apply: (d, cc, x) => { d.countries[cc].money += x.money; return `Казна +${Ev.money(x.money)}`; } },
            { label: x => `В запасы · +${x.food} 🌾`, apply: (d, cc, x) => { Economy.initCountry(d.countries[cc]); d.countries[cc].stock.food = Math.round((d.countries[cc].stock.food + x.food) * 10) / 10; return `Склад еды +${x.food}`; } },
        ],
    },
    refugees: {
        icon: '🧳', title: 'Беженцы у границы',
        when: (d, cc) => {
            const from = d.neighbourCountries(cc).find(x => d.countries[x].playable && d.enemiesOf(x).length && !d.isAtWar(x, cc));
            return from ? { from, cost: Ev.round(Ev.week(d, cc) * 0.5) } : null;
        },
        text: (d, cc, x) => `Из воюющей страны ${d.countries[x.from].name} бегут люди. Принять — значит потратиться, зато население вырастет и там это запомнят.`,
        options: [
            { label: x => `Принять · −${Ev.money(x.cost)}`, apply: (d, cc, x) => {
                d.countries[cc].money -= x.cost;
                const r = Ev.capital(d, cc);
                r.population = Math.round(r.population * 1.02);
                Diplomacy.changeRelation(d, cc, x.from, 10);
                return `Население столицы +2%, отношения с ${d.countries[x.from].name} +10`;
            } },
            { label: () => 'Закрыть границу', apply: (d, cc, x) => { Diplomacy.changeRelation(d, cc, x.from, -5); return 'Граница закрыта, отношения −5'; } },
        ],
    },
    mercenaries: {
        icon: '🎖️', title: 'Наёмники предлагают услуги',
        when: (d, cc) => (d.enemiesOf(cc).length ? { cost: Ev.round(Ev.week(d, cc) * 2), tanks: 4, infantry: 8 } : null),
        text: (d, cc, x) => `Отряд ветеранов готов воевать за вас: ${x.infantry} пехоты и ${x.tanks} танков сразу в столице.`,
        options: [
            { label: x => `Нанять · −${Ev.money(x.cost)}`, apply: (d, cc, x) => {
                const r = Ev.capital(d, cc);
                d.countries[cc].money -= x.cost;
                r.army.infantry += x.infantry;
                r.army.tanks += x.tanks;
                return `В ${r.name}: +${x.infantry} пехоты, +${x.tanks} танков`;
            } },
            { label: () => 'Отказать', apply: () => 'Наёмники ушли к другим' },
        ],
    },
    inventor: {
        icon: '💡', title: 'Учёный с идеей',
        when: (d, cc) => {
            const r = d.countries[cc].research;
            return r && r.remaining > 1 ? { cost: Ev.round(Ev.week(d, cc)) } : null;
        },
        text: (d, cc) => `Молодой учёный знает, как ускорить исследование «${TECH_TREE[d.countries[cc].research.id].name}». Нужен грант.`,
        options: [
            { label: x => `Дать грант · −${Ev.money(x.cost)}`, apply: (d, cc, x) => {
                const r = d.countries[cc].research;
                d.countries[cc].money -= x.cost;
                if (r && r.remaining > 1) r.remaining--;
                return 'Исследование закончится на ход раньше';
            } },
            { label: () => 'Не сейчас', apply: () => 'Учёный уехал за границу' },
        ],
    },
    scandal: {
        icon: '📰', title: 'Коррупционный скандал',
        when: (d, cc) => ({ cost: Ev.round(Ev.week(d, cc)) }),
        text: () => 'Журналисты нашли, куда уходят деньги из бюджета. Громкое расследование стоит влияния, но вернёт доверие. Можно тихо замять.',
        options: [
            { label: () => 'Расследовать · −5 влияния', apply: (d, cc) => { d.countries[cc].influence = Math.max(0, d.countries[cc].influence - 5); Ev.loyalty(d, cc, 0.05); return 'Лояльность +5%'; } },
            { label: x => `Замять · −${Ev.money(x.cost)}`, apply: (d, cc, x) => { d.countries[cc].money -= x.cost; Ev.loyalty(d, cc, -0.04); return 'Скандал замят, но осадок остался: лояльность −4%'; } },
        ],
    },
    unrest: {
        icon: '🔥', title: 'Волнения в занятой области',
        when: (d, cc) => {
            const r = d.getCountryRegions(cc).find(x => x.originalOwner !== cc && x.loyalty < 0.55);
            return r ? { region: r.id, cost: Ev.round(Ev.week(d, cc) * 0.7) } : null;
        },
        text: (d, cc, x) => `В области ${d.regions[x.region].name} люди выходят на улицы. Можно навести порядок силой или вложиться в дороги и школы.`,
        options: [
            { label: () => 'Ввести войска', apply: (d, cc, x) => {
                const r = d.regions[x.region];
                if (!r || r.owner !== cc) return 'Область уже не ваша';
                r.loyalty = Math.min(1, r.loyalty + 0.15);
                r.army.infantry = Math.floor(r.army.infantry * 0.85);
                return `${r.name}: лояльность +15%, гарнизон потерял часть пехоты`;
            } },
            { label: x => `Вложиться · −${Ev.money(x.cost)}`, apply: (d, cc, x) => {
                const r = d.regions[x.region];
                if (!r || r.owner !== cc) return 'Область уже не ваша';
                d.countries[cc].money -= x.cost;
                r.loyalty = Math.min(1, r.loyalty + 0.25);
                return `${r.name}: лояльность +25%`;
            } },
        ],
    },
    volunteers: {
        icon: '🙋', title: 'Добровольцы',
        when: (d, cc) => {
            const pop = d.getCountryRegions(cc).reduce((a, r) => a + r.population, 0);
            return { infantry: Math.max(3, Math.min(30, Math.round(Math.sqrt(pop / 1e6) * 2))) };
        },
        text: (d, cc, x) => `Тысячи людей хотят помочь стране. Их можно взять в армию (${x.infantry} пехоты) или отправить на стройки — проекты ускорятся.`,
        options: [
            { label: x => `В армию · +${x.infantry} пехоты`, apply: (d, cc, x) => { const r = Ev.capital(d, cc); r.army.infantry += x.infantry; return `${r.name}: +${x.infantry} пехоты`; } },
            { label: () => 'На стройки', apply: (d, cc) => {
                let n = 0;
                for (const p of d.projects) if (p.country === cc && p.remaining > 1) { p.remaining--; n++; }
                return n ? `Ускорено строек: ${n}` : 'Строек нет — добровольцы разъехались';
            } },
        ],
    },
    deposit: {
        icon: '🛢️', title: 'Найдено месторождение',
        when: (d, cc) => {
            const r = d.getCountryRegions(cc).find(x => x.development.oil < 5);
            return r ? { region: r.id, cost: Ev.round(DEVELOPMENT.oil.cost * 0.6), sale: Ev.round(Ev.week(d, cc) * 1.5) } : null;
        },
        text: (d, cc, x) => `Геологи нашли нефть и газ в области ${d.regions[x.region].name}. Своя госкомпания даст энергию, концессия — деньги сразу.`,
        options: [
            { label: x => `Госкомпания · −${Ev.money(x.cost)}`, apply: (d, cc, x) => {
                const r = d.regions[x.region];
                if (!r || r.owner !== cc || r.development.oil >= 5) return 'Не вышло: область уже другая';
                d.countries[cc].money -= x.cost;
                r.development.oil++;
                r.resources.oil += DEVELOPMENT.oil.gain;
                return `${r.name}: энергокомплекс +1 уровень`;
            } },
            { label: x => `Концессия · +${Ev.money(x.sale)}`, apply: (d, cc, x) => { d.countries[cc].money += x.sale; return `Казна +${Ev.money(x.sale)}`; } },
        ],
    },
    // --- ООН и мир вокруг -------------------------------------------------
    un_peacekeepers: {
        icon: '🪖', title: 'ООН просит миротворцев',
        when: (d, cc) => {
            const mission = Object.entries(d.un.peacekeepers).find(([x, p]) => x !== cc && p.against !== cc && d.countries[x].alive && !d.isAtWar(cc, p.against));
            const home = Ev.capital(d, cc);
            return mission && home && home.army.infantry >= 8 ? { from: mission[0], infantry: 5 } : null;
        },
        text: (d, cc, x) => `Миссии ООН в стране ${d.countries[x.from].name} не хватает людей. Отправить ${x.infantry} пехоты из столицы — это уважение в мире и благодарность защищаемой страны, но и недовольство той, от кого её защищают.`,
        options: [
            { label: x => `Отправить ${x.infantry} пехоты · +8 влияния`, apply: (d, cc, x) => {
                const r = Ev.capital(d, cc);
                if (!r || r.army.infantry < x.infantry) return 'В столице не хватило пехоты';
                r.army.infantry -= x.infantry;
                d.countries[cc].influence = Math.min(RULES.INFLUENCE_MAX, d.countries[cc].influence + 8);
                Diplomacy.changeRelation(d, cc, x.from, 10);
                const p = d.un.peacekeepers[x.from];
                if (p) Diplomacy.changeRelation(d, cc, p.against, -5);
                return `Миротворцы отправлены: влияние +8, отношения со страной ${d.countries[x.from].name} +10`;
            } },
            { label: () => 'Отказать', apply: (d, cc, x) => { Diplomacy.changeRelation(d, cc, x.from, -3); return `Отношения со страной ${d.countries[x.from].name} −3`; } },
        ],
    },
    iaea: {
        icon: '🔬', title: 'Инспекторы МАГАТЭ',
        when: (d, cc) => (Tech.has(d.countries[cc], 'nuclear') && !d.nuclear.founders.includes(cc) ? { cost: 0 } : null),
        text: () => 'Международное агентство по атомной энергии просит пустить инспекторов на ядерные объекты. Согласие успокоит ядерные державы, но сборка боеголовок задержится на ход. Отказ насторожит их и привлечёт внимание ООН.',
        options: [
            { label: () => 'Пустить инспекторов', apply: (d, cc) => {
                for (const x of d.nuclear.founders) if (d.countries[x].alive) Diplomacy.changeRelation(d, cc, x, 5);
                const b = d.nuclear.building[cc];
                if (b) b.left++;
                return `Отношения с ядерными державами +5${b ? ', сборка — на ход дольше' : ''}`;
            } },
            { label: () => 'Отказать', apply: (d, cc) => {
                for (const x of d.nuclear.founders) if (d.countries[x].alive) Diplomacy.changeRelation(d, cc, x, -8);
                if (Nuclear.isPower(d, cc) && !d.nuclear.council.includes(cc)) d.nuclear.council.push(cc);
                return 'Отношения с ядерными державами −8, ООН следит за вами';
            } },
        ],
    },
    border_incident: {
        icon: '🚧', title: 'Инцидент на границе',
        when: (d, cc) => {
            const around = d.neighbourCountries(cc).filter(x => d.countries[x].playable && d.countries[x].alive && !d.isAtWar(cc, x) && !Diplomacy.isAllied(d, cc, x));
            return around.length ? { from: around[Math.floor(Math.random() * around.length)] } : null;
        },
        text: (d, cc, x) => `На границе со страной ${d.countries[x.from].name} перестрелка, есть раненые. Кто начал — неясно. Можно передать дело в ООН (разберутся, но не обязательно в вашу пользу) или ответить демонстрацией силы.`,
        options: [
            { label: () => 'В ООН · −5 влияния', apply: (d, cc, x) => {
                d.countries[cc].influence = Math.max(0, d.countries[cc].influence - 5);
                if (Math.random() < 0.55) {
                    for (const n of d.neighbourCountries(x.from)) if (n !== cc) Diplomacy.changeRelation(d, n, x.from, -3);
                    d.countries[cc].influence = Math.min(RULES.INFLUENCE_MAX, d.countries[cc].influence + 12);
                    Diplomacy.changeRelation(d, cc, x.from, -5);
                    return `Комиссия ООН признала виновной ${d.countries[x.from].name}: ваше влияние +12, её репутация у соседей хуже`;
                }
                return 'Комиссия ООН не нашла виновных. Дело закрыто';
            } },
            { label: () => 'Показать силу', apply: (d, cc, x) => {
                Diplomacy.changeRelation(d, cc, x.from, -10);
                Ev.loyalty(d, cc, 0.03);
                return `Отношения со страной ${d.countries[x.from].name} −10, лояльность дома +3%`;
            } },
        ],
    },
    tribunal: {
        icon: '⚖️', title: 'Международный суд ООН',
        when: (d, cc) => {
            const r = Council.illegal(d, cc).find(x => !d.isAtWar(cc, x.originalOwner) && d.countries[x.originalOwner].alive && x.id !== d.countries[cc].capital);
            return r ? { region: r.id, from: r.originalOwner } : null;
        },
        text: (d, cc, x) => `Суд ООН постановил: область ${d.regions[x.region].name} незаконно захвачена у страны ${d.countries[x.from].name} и должна быть возвращена. Подчиниться — потерять землю, но вернуть доверие. Отказ ударит по репутации, и Генассамблея может вас осудить.`,
        options: [
            { label: () => 'Вернуть область', apply: (d, cc, x) => {
                const r = d.regions[x.region];
                if (!r || r.owner !== cc) return 'Область уже не ваша';
                d.handoverRegion(r.id, cc, x.from);
                Diplomacy.changeRelation(d, cc, x.from, 15);
                d.countries[cc].influence = Math.min(RULES.INFLUENCE_MAX, d.countries[cc].influence + 10);
                return `${r.name} возвращена: отношения со страной ${d.countries[x.from].name} +15, влияние +10`;
            } },
            { label: () => 'Не подчиняться', apply: (d, cc, x) => {
                for (const n of [...d.neighbourCountries(x.from), ...Diplomacy.allies(d, x.from)]) if (n !== cc) Diplomacy.changeRelation(d, cc, n, -5);
                d.countries[cc].influence = Math.max(0, d.countries[cc].influence - 5);
                d.un.vetoed.push({ target: cc, victim: x.from, turn: d.turn, by: cc });
                return 'Отношения с соседями пострадавшей −5, влияние −5, дело передано в Генассамблею';
            } },
        ],
    },
    un_fund: {
        icon: '🇺🇳', title: 'Взнос в фонд ООН',
        when: (d, cc) => (d.countries[cc].money > Ev.week(d, cc) * 6 && d.wars.size ? { cost: Ev.round(Ev.week(d, cc) * 0.8) } : null),
        text: (d, cc, x) => `ООН собирает деньги на помощь жертвам войн. Взнос ${Ev.money(x.cost)} улучшит отношения со всеми, кто сейчас воюет не по своей воле.`,
        options: [
            { label: x => `Внести · −${Ev.money(x.cost)} · +5 влияния`, apply: (d, cc, x) => {
                d.countries[cc].money -= x.cost;
                d.countries[cc].influence = Math.min(RULES.INFLUENCE_MAX, d.countries[cc].influence + 5);
                let n = 0;
                for (const [key, w] of Object.entries(d.un.wars)) {
                    if (w.end !== null) continue;
                    const victim = key.split('|').find(v => v !== w.aggressor);
                    if (victim && victim !== cc && d.countries[victim].alive) { Diplomacy.changeRelation(d, cc, victim, 6); n++; }
                }
                return `Влияние +5${n ? `, отношения с жертвами войн (${n}) +6` : ''}`;
            } },
            { label: () => 'Не сейчас', apply: () => 'Взнос не внесён' },
        ],
    },
};

class Events {
    // Ход сменился: кому-то из людей выпадает событие.
    static roll(d, events) {
        if (d.gameOver || d.turn < EVENT_RULES.FIRST_TURN) return;
        for (const cc of d.humans) {
            const seat = d.seatOf(cc);
            if (!seat || !d.countries[cc].alive || !d.regionsByCountry[cc].length) continue;
            seat.stats = seat.stats || {};
            if (d.turn - (seat.stats.lastEvent || 0) < EVENT_RULES.GAP || Math.random() > EVENT_RULES.CHANCE) continue;
            const options = Object.keys(EVENTS).sort(() => Math.random() - 0.5);
            for (const key of options) {
                const ctx = EVENTS[key].when(d, cc);
                if (!ctx) continue;
                seat.decisions.push({ type: 'event', from: cc, event: key, ctx });
                seat.stats.lastEvent = d.turn;
                events.push({ type: 'event', for: cc, message: `${EVENTS[key].icon} Событие: ${EVENTS[key].title}. Решите после отчёта.` });
                break;
            }
        }
    }

    static describe(d, decision) {
        const ev = EVENTS[decision.event];
        return {
            title: `${ev.icon} ${ev.title}`,
            text: ev.text(d, decision.from, decision.ctx),
            accept: ev.options[0].label(decision.ctx),
            decline: ev.options[1].label(decision.ctx),
        };
    }

    static apply(d, decision, choice) {
        const ev = EVENTS[decision.event];
        return ev.options[choice ? 0 : 1].apply(d, decision.from, decision.ctx);
    }

    static validDecision(x) {
        if (!EVENTS[x.event] || !x.ctx || typeof x.ctx !== 'object') return false;
        return Object.entries(x.ctx).every(([k, v]) => (k === 'region' ? !!RegionsDB[v] : k === 'from' ? !!CountriesDB[v] : Number.isFinite(v) && v >= 0));
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Events, EVENTS, EVENT_RULES };
