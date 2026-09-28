// =====================================================================
// МИРОВАЯ ПОЛИТИКА: стартовые отношения, характеры стран, помощь жертвам
//
// Стартовые отношения — как в 2024 году: Запад дружит между собой и с
// Украиной, у России свой круг, давние соперничества (Индия — Пакистан,
// Азербайджан — Армения, Израиль — Иран…) тлеют с первого хода.
//
// Характер страны задаёт, как ведёт себя ИИ: экспансионист ищет войну,
// оппортунист бьёт ослабленных, оборонец и торговец строят и копят,
// изоляционист сидит тихо. В каждой партии характеры выпадают заново —
// с оглядкой на реальность (Россия не станет изоляционистом, Швейцария —
// экспансионистом), поэтому мир каждый раз складывается по-своему.
//
// Помощь жертве агрессии: пока страна отбивается от агрессора, друзья,
// союзники и иногда соседи переводят ей часть своих налогов — как западная
// помощь Украине. Когда ООН признаёт агрессора, помощь растёт и к ней
// добавляются поставки оружия.
// =====================================================================
const WORLD = {
    AID_SHARE: 0.03,        // доля недельных налогов донора
    AID_CAP: 0.6,           // не больше этой доли содержания армии жертвы
    AID_MIN_RELATION: 25,
    AID_POWER_RATIO: 0.9,   // помогают, если агрессор не намного слабее жертвы
    ALLY_AID: 1.5,          // союзник жертвы даёт больше друга
    NEIGHBOUR_CHANCE: 0.45, // сосед без особой дружбы помогает не каждый ход
    COALITION_MAX_RELATION: 10,
    BRANDED_AID: 2,         // ООН признала агрессора — помощь вдвое больше
    BRANDED_CAP: 1,         // и может покрыть всё содержание армии
    ARMS_EVERY: 3,          // поставки оружия — раз в столько ходов
    ARMS_WEEKS: 0.5,        // каждый из трёх главных доноров — на полнедели налогов
    ARMS_CAP_UPKEEP: 2,     // но не больше двух ходов содержания армии жертвы
};

const TRAITS = {
    expansionist: { name: 'Экспансионист', icon: '⚔️', text: 'ищет повод для войны и берёт много земли', war: 2.5, ratio: 1.1, goal: 0.35, peace: 0.5, invest: 1, arms: 1.3, trade: 0.8 },
    opportunist:  { name: 'Оппортунист', icon: '🦅', text: 'нападает на ослабленных и воюющих', war: 1.4, ratio: 1.4, goal: 0.2, peace: 1, invest: 1, arms: 1.1, trade: 1, vulture: true },
    defensive:    { name: 'Оборонец', icon: '🛡️', text: 'держит сильную армию, но сам не нападает', war: 0.35, ratio: 2, goal: 0.15, peace: 1.4, invest: 1.2, arms: 1.2, trade: 1 },
    trader:       { name: 'Торговец', icon: '💰', text: 'торгует, строит и неохотно воюет', war: 0.25, ratio: 2, goal: 0.1, peace: 2, invest: 1.6, arms: 0.8, trade: 2 },
    isolationist: { name: 'Изоляционист', icon: '🏔️', text: 'ни с кем не связывается', war: 0.1, ratio: 3, goal: 0.1, peace: 2, invest: 1.3, arms: 0.9, trade: 0.5 },
};

// Чем может оказаться страна: первый — самый вероятный. Страны без
// подсказок — случайно по весам ниже.
const TRAIT_HINTS = {
    RU: ['expansionist', 'opportunist'], CN: ['opportunist', 'expansionist', 'defensive'], TR: ['opportunist', 'expansionist'],
    IR: ['expansionist', 'opportunist'], KP: ['expansionist', 'defensive'], US: ['opportunist', 'defensive', 'trader'],
    IL: ['defensive', 'opportunist'], SA: ['opportunist', 'trader'], AZ: ['opportunist', 'expansionist'], PK: ['defensive', 'opportunist'],
    IN: ['defensive', 'opportunist'], VE: ['expansionist', 'opportunist'], ET: ['opportunist', 'expansionist'], RW: ['opportunist'],
    CH: ['isolationist', 'trader'], SG: ['trader'], NZ: ['isolationist', 'trader'], IS: ['isolationist'], LU: ['trader'],
    AE: ['trader', 'opportunist'], QA: ['trader'], JP: ['defensive', 'trader'], DE: ['trader', 'defensive'], KR: ['defensive', 'trader'],
    UA: ['defensive'], PL: ['defensive'], FI: ['defensive'], SE: ['defensive', 'trader'], NO: ['trader', 'defensive'], BY: ['defensive', 'opportunist'],
};
const TRAIT_WEIGHTS = { defensive: 34, trader: 26, opportunist: 20, isolationist: 12, expansionist: 8 };

// Стартовые отношения 2024 года. Блоки — дружба внутри, списки пар —
// значения поверх (последнее побеждает).
const WEST = ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'DK', 'NO', 'IS', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR',
    'EE', 'LV', 'LT', 'SI', 'HR', 'AL', 'ME', 'MK', 'FI', 'SE', 'JP', 'KR', 'AU', 'NZ'];
const EAST = ['RU', 'BY', 'KZ', 'KG', 'TJ', 'AM'];
const RELATIONS_2024 = [
    // кто с кем против кого
    ...WEST.map(cc => [cc, 'UA', 30]), ...WEST.map(cc => [cc, 'RU', -30]), ...WEST.map(cc => [cc, 'BY', -20]), ...WEST.map(cc => [cc, 'IR', -20]),
    ...['MD', 'GE'].flatMap(cc => [[cc, 'UA', 25], [cc, 'RU', -25]]), ...WEST.flatMap(cc => [[cc, 'MD', 20], [cc, 'GE', 15]]),
    ['RU', 'BY', 60], ['BY', 'UA', -20], ['RU', 'CN', 35], ['RU', 'IR', 30], ['RU', 'KP', 35], ['RU', 'SY', 30], ['RU', 'VE', 25], ['RU', 'CU', 25], ['RU', 'NI', 20], ['RU', 'IN', 20],
    ['CN', 'KP', 30], ['CN', 'PK', 45], ['CN', 'IR', 20], ['US', 'CN', -25], ['JP', 'CN', -15], ['CN', 'IN', -25], ['CN', 'VN', -10], ['CN', 'PH', -20],
    ['US', 'KP', -50], ['JP', 'KP', -40], ['KR', 'KP', -60], ['US', 'IR', -40], ['US', 'VE', -30], ['US', 'CU', -30],
    ['US', 'IL', 50], ['US', 'GB', 50], ['FR', 'DE', 45], ['US', 'JP', 45], ['US', 'KR', 45], ['US', 'SA', 25], ['US', 'TW', 30],
    ['IN', 'PK', -55], ['AZ', 'AM', -60], ['TR', 'AZ', 50], ['TR', 'AM', -30], ['GR', 'TR', -15], ['CY', 'TR', -30],
    ['SA', 'IR', -45], ['IL', 'IR', -70], ['IL', 'SY', -45], ['IL', 'LB', -40], ['IL', 'EG', 10], ['SA', 'AE', 45], ['SA', 'BH', 40], ['SA', 'EG', 30],
    ['SA', 'YE', -40], ['IR', 'IQ', 25], ['IR', 'SY', 35], ['MA', 'DZ', -35], ['ET', 'ER', -35], ['EG', 'ET', -25], ['SD', 'SS', -30],
    ['VE', 'GY', -35], ['CO', 'VE', -25], ['RU', 'GE', -35], ['AF', 'PK', -20], ['RS', 'HR', -15], ['RW', 'CD', -35], ['CD', 'UG', -15],
    ['SO', 'ET', -15], ['TH', 'KH', -15], ['VN', 'KH', 10], ['BR', 'AR', 20], ['CL', 'BO', -15], ['PE', 'CL', -10],
];

class World {
    // Новая партия: геополитика 2024 года и характеры стран.
    static seed(d) {
        const alive = cc => d.countries[cc] && d.countries[cc].playable;
        const set = (a, b, v) => { if (alive(a) && alive(b) && a !== b) d.relations[d.pairKey(a, b)] = v; };
        for (const bloc of [WEST, EAST]) for (const a of bloc) for (const b of bloc) if (a < b) set(a, b, bloc === WEST ? 35 : 30);
        for (const [a, b, v] of RELATIONS_2024) set(a, b, v);
        World.rollTraits(d);
    }

    static rollTraits(d) {
        d.traits = {};
        const total = Object.values(TRAIT_WEIGHTS).reduce((a, b) => a + b, 0);
        for (const c of Object.values(d.countries)) {
            if (!c.playable) continue;
            const hints = TRAIT_HINTS[c.id];
            let trait;
            if (hints) {
                // только из подсказок: первый — чаще, остальные — реже
                trait = Math.random() < 0.6 ? hints[0] : hints[Math.floor(Math.random() * hints.length)];
            } else {
                let roll = Math.random() * total;
                trait = Object.keys(TRAIT_WEIGHTS).find(t => (roll -= TRAIT_WEIGHTS[t]) <= 0) || 'defensive';
            }
            d.traits[c.id] = trait;
        }
    }

    static trait(d, cc) { return TRAITS[(d.traits && d.traits[cc]) || 'defensive']; }
    static traitId(d, cc) { return (d.traits && d.traits[cc]) || 'defensive'; }

    // --- помощь жертве агрессии -------------------------------------------------
    // Деньги каждый ход: друзья жертвы (отношения от +25, с агрессором —
    // не лучше нуля), союзники — щедрее, соседи без особой дружбы — время от
    // времени, если с агрессором у них плохо. Когда ООН признала агрессора
    // (санкции, эмбарго, принуждение, осуждение), к помощи присоединяется
    // широкая коалиция, денег вдвое больше, и раз в несколько ходов приходят
    // поставки оружия — войска в приграничную область жертвы.
    static endTurn(d, events) {
        if (!d.un) return;
        for (const [key, w] of Object.entries(d.un.wars)) {
            if (w.end !== null || !d.wars.has(key)) continue;
            const victim = key.split('|').find(cc => cc !== w.aggressor);
            const v = d.countries[victim], a = d.countries[w.aggressor];
            if (!v || !a || !v.alive || !a.alive || !d.regionsByCountry[victim].length) continue;
            const branded = Credit.branded(d, w.aggressor);
            if (!branded && d.calculateMilitaryPower(w.aggressor) < WORLD.AID_POWER_RATIO * d.calculateMilitaryPower(victim)) continue;
            const around = new Set(d.neighbourCountries(victim));
            const donors = [];
            let total = 0;
            for (const c of Object.values(d.countries)) {
                if (!c.alive || !c.playable || d.isHuman(c.id) || c.id === victim || c.id === w.aggressor) continue;
                if (d.isAtWar(c.id, victim) || !d.regionsByCountry[c.id].length) continue;
                const relV = Diplomacy.relation(d, c.id, victim), relA = Diplomacy.relation(d, c.id, w.aggressor);
                const ally = Diplomacy.isAllied(d, c.id, victim);
                const friend = relV >= WORLD.AID_MIN_RELATION && relA <= 0;
                const neighbour = around.has(c.id) && relV >= 0 && relA < 0 && Math.random() < WORLD.NEIGHBOUR_CHANCE;
                const coalition = branded && relV >= 0 && relA < WORLD.COALITION_MAX_RELATION;
                if (!ally && !friend && !neighbour && !coalition) continue;
                const share = WORLD.AID_SHARE * (branded ? WORLD.BRANDED_AID : 1) * (ally ? WORLD.ALLY_AID : friend ? 1 : 0.5);
                const gift = Math.round(d.countryBalance(c.id).tax * share);
                if (gift <= 0 || c.money < gift * 10) continue;
                donors.push({ c, gift, why: ally ? 'ally' : friend ? 'friend' : neighbour ? 'neighbour' : 'coalition' });
                total += gift;
            }
            if (!total) continue;
            const upkeep = d.countryBalance(victim).upkeep;
            const scale = Math.min(1, (upkeep * (branded ? WORLD.BRANDED_CAP : WORLD.AID_CAP)) / total);
            let paid = 0;
            for (const x of donors) {
                x.paid = Math.round(x.gift * scale);
                x.c.money -= x.paid;
                paid += x.paid;
            }
            v.money += paid;
            donors.sort((x, y) => y.paid - x.paid);
            if (d.isHuman(victim) && paid > 0) {
                const top = donors.slice(0, 3).map(x => x.c.name).join(', ');
                const near = donors.filter(x => x.why === 'neighbour').map(x => x.c.name);
                events.push({ type: 'aid', for: victim, message: `🤝 ${branded ? 'Коалиция против агрессора' : 'Помощь партнёров против агрессии'}: +$${(paid / 1e6).toFixed(1)}M (${donors.length} стран, больше всех — ${top}).${near.length ? ` Соседи тоже помогли: ${near.slice(0, 3).join(', ')}.` : ''}` });
            }
            if (branded && (d.turn - w.start) % WORLD.ARMS_EVERY === 0) World.sendArms(d, victim, w.aggressor, donors, events);
        }
    }

    // Поставки оружия: крупнейшие доноры отдают технику на сумму
    // ARMS_WEEKS своих недельных налогов — в самую слабую приграничную
    // область жертвы. Техника становится армией жертвы.
    static sendArms(d, victim, aggressor, donors, events) {
        const top = donors.slice(0, 3);
        if (!top.length) return;
        let value = top.reduce((s, x) => s + d.countryBalance(x.c.id).tax * WORLD.ARMS_WEEKS, 0);
        value = Math.min(value, d.countryBalance(victim).upkeep * WORLD.ARMS_CAP_UPKEEP + 2e6);
        const front = d.getCountryRegions(victim).filter(r => d.getNeighbors(r.id).some(id => d.regions[id] && d.regions[id].owner === aggressor));
        const capital = d.regions[d.countries[victim].capital];
        const pool = front.length ? front : capital && capital.owner === victim ? [capital] : d.getCountryRegions(victim);
        if (!pool.length) return;
        const target = pool.reduce((a, b) => (d.armyPower(b.army, victim) < d.armyPower(a.army, victim) ? b : a));
        const kinds = ['artillery', 'antiair', 'tanks'];
        if (Tech.unitUnlocked(top[0].c, 'drones')) kinds.push('drones');
        const got = {};
        for (const unitId of kinds) {
            const n = Math.floor(value / kinds.length / UnitsDB[unitId].buildCost);
            if (n > 0) { target.army[unitId] += n; got[unitId] = n; }
        }
        if (!Object.keys(got).length) return;
        if (d.isHuman(victim)) {
            events.push({ type: 'aid', for: victim, message: `📦 Поставки оружия от ${top.map(x => x.c.name).join(', ')}: ${d.describeForces(got)} — прибыли в ${target.name}.` });
        }
    }

    // --- сохранение -----------------------------------------------------------
    static valid(traits) {
        return !!traits && typeof traits === 'object' && Object.entries(traits).every(([cc, t]) => CountriesDB[cc] && TRAITS[t]);
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { World, WORLD, TRAITS };
