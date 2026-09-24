// =====================================================================
// ЗАДАНИЯ
//
// У игрока всегда три задания, подобранных под его положение: воюет —
// будут боевые, торгует в минус — экономические. У каждого видно, сколько
// сделано, и награда (деньги и влияние). Выполнил — забираешь награду,
// и на место задания приходит новое. Неподходящее можно сменить за влияние.
//
// Прогресс считается от «отметки» в момент выдачи: счётчики действий
// игрока (d.stats) растут всю игру, задание смотрит на прибавку.
// =====================================================================
const MISSION_RULES = { ACTIVE: 3, SKIP_COST: 5, MIN_REWARD: 500000 };

// kind → { cat, icon, make(d) → { target, text, stat?|value?, param?, reward: [ходов дохода, влияние] } | null }
const MISSION_KINDS = {
    recruit: {
        cat: 'army', icon: '🪖',
        make: d => {
            const n = 5 + d.regionsByCountry[d.playerCountry].length * 2;
            return { target: n, stat: 'recruited', text: `Наберите ${n} подразделений`, reward: [3, 5] };
        },
    },
    battles: {
        cat: 'army', icon: '⚔️',
        make: d => (d.enemiesOf(d.playerCountry).length ? { target: 2, stat: 'battlesWon', text: 'Выиграйте 2 сражения', reward: [4, 10] } : null),
    },
    conquer: {
        cat: 'army', icon: '🚩',
        make: d => (d.enemiesOf(d.playerCountry).length ? { target: 1, stat: 'conquered', text: 'Захватите вражескую область', reward: [6, 10] } : null),
    },
    build: {
        cat: 'economy', icon: '🏗️',
        make: d => ({ target: 2, stat: 'projects', text: 'Достройте 2 проекта развития в своих областях', reward: [4, 5] }),
    },
    treasury: {
        cat: 'economy', icon: '💰',
        make: d => {
            const c = d.countries[d.playerCountry];
            const net = Math.max(200000, d.countryBalance(c.id).income - d.countryBalance(c.id).expense);
            const target = Math.round(Math.max(c.money * 1.3, c.money + net * 6) / 1e5) * 1e5;
            return { target, value: 'money', text: `Накопите в казне $${(target / 1e6).toFixed(1)}M`, reward: [2, 10] };
        },
    },
    surplus: {
        cat: 'economy', icon: '📦',
        make: d => {
            const f = Economy.flows(d, d.playerCountry);
            const key = Object.keys(RESOURCES).find(k => f[k].prod < f[k].need);
            if (!key) return null;
            return { target: 1, value: 'surplus', param: key, text: `Перестаньте докупать: ${RESOURCES[key].icon} ${RESOURCES[key].name.toLowerCase()} — производите не меньше, чем тратите`, reward: [6, 10] };
        },
    },
    research: {
        cat: 'science', icon: '🔬',
        make: d => ({ target: 1, stat: 'techs', text: 'Завершите любое исследование в «Науке»', reward: [4, 5] }),
    },
    modernize: {
        cat: 'science', icon: '⚙️',
        make: d => ({ target: 2, stat: 'modernized', text: 'Проведите 2 модернизации войск в «Науке»', reward: [3, 5] }),
    },
    loyalty: {
        cat: 'people', icon: '❤️',
        make: d => {
            const regions = d.getCountryRegions(d.playerCountry);
            if (regions.every(r => r.loyalty >= 0.8)) return null;
            return { target: regions.length, value: 'loyal', text: 'Поднимите лояльность всех своих областей до 80%', reward: [3, 10] };
        },
    },
    growth: {
        cat: 'people', icon: '👥',
        make: d => {
            const pop = d.getCountryRegions(d.playerCountry).reduce((a, r) => a + r.population, 0);
            return { target: Math.round(pop * 1.005), value: 'population', text: 'Население страны +0,5% (сытость и товары)', reward: [4, 5] };
        },
    },
    deal: {
        cat: 'diplomacy', icon: '🤝',
        make: d => (Diplomacy.dealCount(d, d.playerCountry) < DIPLOMACY.DEAL_MAX
            ? { target: 1, stat: 'deals', text: 'Заключите торговый договор (карточка страны или «Дипломатия»)', reward: [3, 10] } : null),
    },
    friend: {
        cat: 'diplomacy', icon: '🕊️',
        make: d => {
            const p = d.playerCountry;
            const cc = d.neighbourCountries(p).find(x => d.countries[x].playable && !d.isAtWar(p, x) && Diplomacy.relation(d, p, x) < 30);
            if (!cc) return null;
            return { target: 30, value: 'relation', param: cc, text: `Отношения со страной ${d.countries[cc].name} — до +30 (подарки, договоры)`, reward: [2, 15] };
        },
    },
};

class Missions {
    static init(d) {
        d.stats = d.stats || {};
        d.missions = d.missions || [];
    }

    static bump(d, stat, amount = 1) {
        Missions.init(d);
        d.stats[stat] = (d.stats[stat] || 0) + amount;
    }

    // Текущее значение показателя задания.
    static current(d, m) {
        const p = d.playerCountry;
        if (m.stat) return (d.stats[m.stat] || 0) - m.base;
        if (m.value === 'money') return d.countries[p].money;
        if (m.value === 'surplus') {
            const f = Economy.flows(d, p)[m.param];
            return f.prod >= f.need ? 1 : 0;
        }
        if (m.value === 'loyal') return d.getCountryRegions(p).filter(r => r.loyalty >= 0.8).length;
        if (m.value === 'population') return d.getCountryRegions(p).reduce((a, r) => a + r.population, 0);
        if (m.value === 'relation') return Diplomacy.relation(d, p, m.param);
        return 0;
    }

    static progress(d, m) {
        const value = Missions.current(d, m);
        const target = m.value === 'loyal' ? d.getCountryRegions(d.playerCountry).length : m.target;
        const from = m.stat ? 0 : Math.min(m.start ?? 0, target);
        const share = value >= target ? 1 : target > from ? Math.max(0, Math.min(1, (value - from) / (target - from))) : 0;
        return { value, target, share, done: value >= target };
    }

    // Задание, которое уже нельзя выполнить: война кончилась, страна исчезла.
    static stale(d, m) {
        const p = d.playerCountry;
        if (m.kind === 'battles' || m.kind === 'conquer') return !d.enemiesOf(p).length;
        if (m.kind === 'friend') return !d.countries[m.param] || !d.countries[m.param].alive || d.isAtWar(p, m.param);
        if (m.kind === 'deal') return Diplomacy.dealCount(d, p) >= DIPLOMACY.DEAL_MAX;
        return false;
    }

    // Конец хода: о выполненном сообщаем один раз, невыполнимое меняем даром.
    static update(d) {
        Missions.init(d);
        const events = [];
        for (let i = d.missions.length - 1; i >= 0; i--) {
            const m = d.missions[i];
            if (Missions.progress(d, m).done) {
                if (!m.notified) {
                    m.notified = true;
                    events.push({ type: 'mission', message: `🎯 Задание выполнено: ${m.text}. Заберите награду в «Заданиях».` });
                }
            } else if (Missions.stale(d, m)) {
                d.missions.splice(i, 1);
            }
        }
        Missions.refill(d);
        return events;
    }

    // Награда — несколько недель налогового дохода (чтобы была ощутимой
    // и для маленькой страны, и для большой) плюс влияние.
    static reward(d, turns, influence) {
        const tax = d.countryBalance(d.playerCountry).tax;
        const money = Math.round(Math.max(MISSION_RULES.MIN_REWARD, tax * turns * 0.25) / 1e5) * 1e5;
        return { money, influence };
    }

    static create(d, exclude) {
        const active = new Set(d.missions.map(m => m.kind));
        const cats = new Set(d.missions.map(m => MISSION_KINDS[m.kind].cat));
        const shuffle = list => list.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
        const options = Object.entries(MISSION_KINDS).filter(([kind]) => !active.has(kind) && kind !== exclude);
        // сначала разделы, которых сейчас нет среди заданий — так они разнообразнее
        const ordered = [...shuffle(options.filter(([, k]) => !cats.has(k.cat))), ...shuffle(options.filter(([, k]) => cats.has(k.cat)))];
        for (const [kind, def] of ordered) {
            const made = def.make(d);
            if (!made) continue;
            const mission = {
                kind, target: made.target, text: made.text, issued: d.turn,
                reward: Missions.reward(d, made.reward[0], made.reward[1]),
            };
            if (made.stat) { mission.stat = made.stat; mission.base = d.stats[made.stat] || 0; }
            if (made.value) mission.value = made.value;
            if (made.param) mission.param = made.param;
            // с чего начинали — чтобы шкала показывала сделанное, а не абсолют
            if (made.value) mission.start = Missions.current(d, mission);
            return mission;
        }
        return null;
    }

    static refill(d, exclude) {
        Missions.init(d);
        while (d.missions.length < MISSION_RULES.ACTIVE) {
            const m = Missions.create(d, exclude);
            if (!m) break;
            d.missions.push(m);
        }
    }

    static claim(d, index) {
        const m = d.missions[index];
        if (!m || !Missions.progress(d, m).done) return null;
        const c = d.countries[d.playerCountry];
        c.money += m.reward.money;
        c.influence = Math.min(RULES.INFLUENCE_MAX, c.influence + m.reward.influence);
        d.missions.splice(index, 1);
        Missions.bump(d, 'missions');
        Missions.refill(d, m.kind);
        return m.reward;
    }

    static skip(d, index) {
        const c = d.countries[d.playerCountry];
        const m = d.missions[index];
        if (!m || c.influence < MISSION_RULES.SKIP_COST) return false;
        c.influence -= MISSION_RULES.SKIP_COST;
        d.missions.splice(index, 1);
        Missions.refill(d, m.kind);
        return true;
    }

    static readyCount(d) {
        Missions.init(d);
        return d.missions.filter(m => Missions.progress(d, m).done).length;
    }

    static valid(missions, stats) {
        if (!Array.isArray(missions) || missions.length > MISSION_RULES.ACTIVE) return false;
        if (!stats || typeof stats !== 'object' || Object.values(stats).some(v => !Number.isSafeInteger(v) || v < 0)) return false;
        const finite = n => typeof n === 'number' && Number.isFinite(n);
        return missions.every(m => m && MISSION_KINDS[m.kind] && finite(m.target) && typeof m.text === 'string'
            && m.reward && finite(m.reward.money) && finite(m.reward.influence) && (!m.stat || finite(m.base))
            && (m.start === undefined || finite(m.start)));
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Missions, MISSION_KINDS, MISSION_RULES };
