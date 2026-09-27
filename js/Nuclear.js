// =====================================================================
// ЯДЕРНОЕ ОРУЖИЕ
//
// Путь: исследование «Ядерная бомба» (потом «Термоядерная бомба») →
// производство боеголовок (одна за раз, несколько ходов) → удар по области
// противника. Удар почти стирает армию области, убивает часть жителей,
// рушит постройки и оставляет заражение: несколько ходов область не
// платит налогов. Водородная бомба бьёт сильнее и задевает соседние области.
//
// Мир реагирует на само обладание: первое испытание портит отношения со
// всеми (сильнее — с соседями и прежними ядерными державами), а Мировой
// совет ставит на голосование санкции за ядерную программу. Удар — это
// санкции сразу, без голосования, и отношения хуже, чем после войны.
// ИИ ядерную державу боится: не нападает на неё без своей бомбы, охотнее
// идёт на мир, а на удар отвечает ударом. Первым ИИ бьёт только в
// отчаянии — потеряв столицу или большую часть земель.
//
// Девять стран начинают 2024 год со своим арсеналом, как в жизни.
// =====================================================================
const NUCLEAR = {
    KINDS: {
        atom: {
            name: 'Атомная бомба', short: 'атомная', icon: '☢️', tech: 'nuclear',
            cost: 20e6, turns: 3, upkeep: 150000, influence: 20,
            kill: 0.75, people: 0.25, ruin: 1, fallout: 4, splash: null,
            relation: -25,
        },
        hydrogen: {
            name: 'Термоядерная бомба', short: 'термоядерная', icon: '💥', tech: 'hydrogen',
            cost: 50e6, turns: 4, upkeep: 300000, influence: 30,
            kill: 0.95, people: 0.5, ruin: 2, fallout: 6, splash: { kill: 0.3, people: 0.1 },
            relation: -40,
        },
    },
    SANCTION_TURNS: 8,          // санкции за удар — сразу и без голосования
    ALLY_RELATION: -30,         // союзники пострадавшего — ещё хуже
    VICTIM_RELATION: -60,
    TEST_RELATION: -8,          // первое испытание: всем
    TEST_NEAR_RELATION: -12,    // соседям — дополнительно
    TEST_RIVAL_RELATION: -10,   // прежним ядерным державам — дополнительно
    STRIKES_KEPT: 30,
    // ИИ
    AI_STOCK: { atom: 2, hydrogen: 3 },         // до скольких боеголовок строит
    AI_LAST_RESORT: 0.35,       // шанс удара в отчаянии за ход
    AI_LOST_SHARE: 0.4,         // «отчаяние» — потеряно столько своих земель
    AI_MIN_POPULATION: 20e6,    // кто вообще заводит ядерную программу
    // арсеналы на 1 января 2024 года (в боеголовках игры, а не в реальных)
    START: {
        US: { hydrogen: 10 }, RU: { hydrogen: 10 }, CN: { hydrogen: 4 }, FR: { hydrogen: 2 }, GB: { hydrogen: 2 },
        IN: { atom: 2 }, PK: { atom: 2 }, IL: { atom: 1 }, KP: { atom: 1 },
    },
};

class Nuclear {
    static init(d) {
        d.nuclear = { arsenal: {}, building: {}, powers: [], founders: [], fallout: {}, strikes: [], council: [] };
        for (const [cc, stock] of Object.entries(NUCLEAR.START)) {
            const c = d.countries[cc];
            if (!c) continue;
            Tech.grant(c, 'nuclear');
            if (stock.hydrogen) Tech.grant(c, 'hydrogen');
            d.nuclear.arsenal[cc] = { atom: stock.atom || 0, hydrogen: stock.hydrogen || 0 };
            d.nuclear.powers.push(cc);
            d.nuclear.founders.push(cc);
        }
    }

    static stock(d, cc) {
        const a = d.nuclear && d.nuclear.arsenal[cc];
        return { atom: (a && a.atom) || 0, hydrogen: (a && a.hydrogen) || 0 };
    }

    static total(d, cc) { const s = Nuclear.stock(d, cc); return s.atom + s.hydrogen; }
    static isPower(d, cc) { return Nuclear.total(d, cc) > 0; }
    static fallout(d, regionId) { return !!(d.nuclear && d.nuclear.fallout[regionId] > d.turn); }

    // Содержание арсенала за ход — в расходах на армию.
    static upkeep(d, cc) {
        const s = Nuclear.stock(d, cc);
        return s.atom * NUCLEAR.KINDS.atom.upkeep + s.hydrogen * NUCLEAR.KINDS.hydrogen.upkeep;
    }

    // --- производство ----------------------------------------------------
    static canBuild(d, cc, kind) {
        const k = NUCLEAR.KINDS[kind];
        const c = d.countries[cc];
        if (!k || !c || !c.alive || d.gameOver) return { ok: false, reason: 'Нельзя' };
        if (!Tech.has(c, k.tech)) return { ok: false, reason: `Сначала исследуйте: ${TECH_TREE[k.tech].name}` };
        if (d.nuclear.building[cc]) return { ok: false, reason: 'Уже идёт сборка боеголовки' };
        if (c.money < k.cost) return { ok: false, reason: 'Недостаточно средств' };
        return { ok: true };
    }

    static build(d, cc, kind) {
        const check = Nuclear.canBuild(d, cc, kind);
        if (!check.ok) return check;
        const k = NUCLEAR.KINDS[kind];
        d.countries[cc].money -= k.cost;
        d.nuclear.building[cc] = { kind, left: k.turns, started: d.turn };
        return { ok: true, turns: k.turns };
    }

    // Отмена: в ход заказа — вся сумма, потом — половина.
    static cancel(d, cc) {
        const b = d.nuclear.building[cc];
        if (!b) return { ok: false, reason: 'Сборки нет' };
        const cost = NUCLEAR.KINDS[b.kind].cost;
        const refund = b.started === d.turn ? cost : Math.round(cost / 2);
        d.countries[cc].money += refund;
        delete d.nuclear.building[cc];
        return { ok: true, refund };
    }

    // --- удар ------------------------------------------------------------
    static canStrike(d, cc, regionId, kind, retaliation = false) {
        const k = NUCLEAR.KINDS[kind];
        const region = d.regions[regionId];
        const c = d.countries[cc];
        if (!k || !region || !c || !c.alive || d.gameOver) return { ok: false, reason: 'Нельзя' };
        if (!d.isAtWar(cc, region.owner)) return { ok: false, reason: 'Удар возможен только по стране, с которой идёт война' };
        if (!Nuclear.stock(d, cc)[kind]) return { ok: false, reason: `Нет готовых боеголовок: ${k.short}` };
        if (!retaliation && c.influence < k.influence) return { ok: false, reason: `Нужно ${k.influence} влияния` };
        return { ok: true };
    }

    // Что станет с областью — для окна подтверждения.
    static preview(d, regionId, kind) {
        const k = NUCLEAR.KINDS[kind];
        const region = d.regions[regionId];
        const army = d.armyPower(region.army, region.owner) + d.garrisonsIn(regionId).reduce((sum, g) => sum + d.armyPower(g.army, g.cc), 0);
        return {
            army: Math.round(army * k.kill),
            people: Math.round(region.population * k.people),
            neighbours: k.splash ? d.getNeighbors(regionId).filter(id => d.regions[id]).length : 0,
        };
    }

    static strike(d, cc, regionId, kind, { retaliation = false } = {}) {
        const check = Nuclear.canStrike(d, cc, regionId, kind, retaliation);
        if (!check.ok) return check;
        const k = NUCLEAR.KINDS[kind];
        const region = d.regions[regionId];
        const victim = region.owner;
        const c = d.countries[cc];
        d.nuclear.arsenal[cc][kind]--;
        if (!retaliation) c.influence -= k.influence;

        const dead = Nuclear.hit(d, region, k.kill, k.people, k.ruin);
        d.nuclear.fallout[regionId] = Math.max(d.nuclear.fallout[regionId] || 0, d.turn + k.fallout);
        let splashDead = 0;
        if (k.splash) {
            for (const id of d.getNeighbors(regionId)) {
                const other = d.regions[id];
                if (other) splashDead += Nuclear.hit(d, other, k.splash.kill, k.splash.people, 0);
            }
        }

        // мир отвечает: отношения, санкции без голосования
        const scale = retaliation ? 0.5 : 1;
        for (const other of Object.values(d.countries)) {
            if (!other.alive || other.id === cc) continue;
            let delta = k.relation * scale;
            if (other.id === victim) delta = NUCLEAR.VICTIM_RELATION;
            else if (Diplomacy.isAllied(d, other.id, victim)) delta += NUCLEAR.ALLY_RELATION * scale;
            Diplomacy.changeRelation(d, cc, other.id, delta);
        }
        if (!retaliation) d.sanctions[cc] = Math.max(d.sanctions[cc] || 0, d.turn + NUCLEAR.SANCTION_TURNS);

        d.nuclear.strikes.push({ by: cc, target: victim, region: regionId, kind, turn: d.turn, retaliation, answered: false });
        if (d.nuclear.strikes.length > NUCLEAR.STRIKES_KEPT) d.nuclear.strikes.shift();

        const who = d.countries[cc].name, place = `${region.name} (${d.countries[victim].name})`;
        const toll = `Погибло около ${Nuclear.people(dead + splashDead)} человек, армия в области почти уничтожена, заражение на ${Nuclear.turns(k.fallout)}.`;
        for (const h of d.humans) {
            let message;
            if (h === cc) message = `${k.icon} Ваш ${retaliation ? 'ответный ' : ''}ядерный удар по области ${place}. ${toll}${retaliation ? '' : ` Совбез ООН ввёл против вас санкции на ${Nuclear.turns(NUCLEAR.SANCTION_TURNS)}.`}`;
            else if (h === victim) message = `${k.icon} ${who} нанесла ядерный удар по вашей области ${region.name}! ${toll}`;
            else message = `${k.icon} ${who} нанесла ${retaliation ? 'ответный ' : ''}ядерный удар: ${place}. ${toll}`;
            d.diploEvents.push({ type: 'nuclear', for: h, message });
        }
        return { ok: true, dead: dead + splashDead, victim };
    }

    // Урон одной области: войска (свои и союзные), жители, постройки.
    static hit(d, region, kill, people, ruin) {
        for (const unitId of Object.keys(region.army)) region.army[unitId] = Math.floor(region.army[unitId] * (1 - kill));
        for (const g of d.garrisonsIn(region.id)) {
            for (const unitId of Object.keys(g.army)) g.army[unitId] = Math.floor(g.army[unitId] * (1 - kill));
        }
        const dead = Math.round(region.population * people);
        region.population = Math.max(1000, region.population - dead);
        if (ruin) {
            for (const [key, plan] of Object.entries(DEVELOPMENT)) {
                const lost = Math.min(region.development[key] || 0, ruin);
                if (!lost) continue;
                region.development[key] -= lost;
                if (plan.resource) region.resources[plan.resource] = Math.max(0, region.resources[plan.resource] - lost * plan.gain);
            }
            region.loyalty = Math.max(0.2, region.loyalty - 0.3);
        }
        return dead;
    }

    static turns(n) {
        const m10 = n % 10, m100 = n % 100;
        return `${n} ${m10 === 1 && m100 !== 11 ? 'ход' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'хода' : 'ходов'}`;
    }

    static people(n) {
        if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} млн`;
        if (n >= 1e3) return `${Math.round(n / 1e3)} тыс.`;
        return String(n);
    }

    // --- конец хода --------------------------------------------------------
    static endTurn(d, events) {
        for (const [id, until] of Object.entries(d.nuclear.fallout)) if (until <= d.turn) delete d.nuclear.fallout[id];
        for (const [cc, b] of Object.entries(d.nuclear.building)) {
            const c = d.countries[cc];
            if (!c || !c.alive) { delete d.nuclear.building[cc]; continue; }
            if (--b.left > 0) continue;
            delete d.nuclear.building[cc];
            const a = d.nuclear.arsenal[cc] = d.nuclear.arsenal[cc] || { atom: 0, hydrogen: 0 };
            a[b.kind]++;
            if (d.isHuman(cc)) events.push({ type: 'nuclear', for: cc, message: `${NUCLEAR.KINDS[b.kind].icon} Готова боеголовка: ${NUCLEAR.KINDS[b.kind].name.toLowerCase()}. В арсенале: ${Nuclear.describe(d, cc)}.` });
            if (!d.nuclear.powers.includes(cc)) Nuclear.firstTest(d, cc, events);
        }
    }

    // Новая ядерная держава: мир настораживается, Совбез ООН обсудит санкции.
    static firstTest(d, cc, events) {
        const n = d.nuclear;
        const near = new Set(d.neighbourCountries(cc));
        for (const other of Object.values(d.countries)) {
            if (!other.alive || other.id === cc) continue;
            let delta = NUCLEAR.TEST_RELATION;
            if (near.has(other.id)) delta += NUCLEAR.TEST_NEAR_RELATION;
            if (n.powers.includes(other.id)) delta += NUCLEAR.TEST_RIVAL_RELATION;
            if (Diplomacy.isAllied(d, cc, other.id)) delta = 0;
            if (delta) Diplomacy.changeRelation(d, cc, other.id, delta);
        }
        n.powers.push(cc);
        if (!n.council.includes(cc)) n.council.push(cc);
        const name = d.countries[cc].name;
        events.push({ type: 'nuclear', ...(d.isHuman(cc) ? { exceptFor: cc } : {}), message: `☢️ ${name} провела ядерное испытание и стала ядерной державой. Соседи встревожены, Совбез ООН обсудит санкции.` });
        if (d.isHuman(cc)) events.push({ type: 'nuclear', for: cc, message: `☢️ Испытание прошло успешно: вы — ядерная держава. Отношения со всеми ухудшились (с соседями и ядерными державами — сильнее), в Совбезе ООН обсудят санкции. Зато напасть на вас теперь решится не всякий.` });
    }

    static describe(d, cc) {
        const s = Nuclear.stock(d, cc);
        const parts = [];
        if (s.hydrogen) parts.push(`${NUCLEAR.KINDS.hydrogen.icon} ${s.hydrogen} термоядерных`);
        if (s.atom) parts.push(`${NUCLEAR.KINDS.atom.icon} ${s.atom} атомных`);
        return parts.join(', ') || 'пусто';
    }

    // --- ИИ ------------------------------------------------------------------
    // Ядерную программу заводят крупные страны, у которых ядерный сосед
    // или враг.
    static aiWantsBomb(d, cc) {
        let pop = 0;
        for (const r of d.getCountryRegions(cc)) pop += r.population;
        if (pop < NUCLEAR.AI_MIN_POPULATION) return false;
        return [...d.neighbourCountries(cc), ...d.enemiesOf(cc)].some(x => x !== cc && Nuclear.isPower(d, x));
    }

    static aiPlan(d, cc, reserve) {
        const c = d.countries[cc];
        // 1. ответный удар — по самой населённой области обидчика
        for (const s of d.nuclear.strikes) {
            if (s.answered || s.target !== cc || s.turn < d.turn - 1) continue;
            s.answered = true;
            if (!d.isAtWar(cc, s.by)) continue;
            const kind = Nuclear.stock(d, cc).hydrogen ? 'hydrogen' : 'atom';
            const targets = d.getCountryRegions(s.by);
            if (!targets.length || !Nuclear.stock(d, cc)[kind]) continue;
            const target = targets.reduce((a, b) => (b.population > a.population ? b : a));
            Nuclear.strike(d, cc, target.id, kind, { retaliation: true });
        }
        // 2. удар в отчаянии: столица потеряна или отнята большая часть земель
        const enemies = d.enemiesOf(cc);
        if (enemies.length && Nuclear.isPower(d, cc) && Nuclear.desperate(d, cc) && Math.random() < NUCLEAR.AI_LAST_RESORT) {
            const target = Nuclear.frontTarget(d, cc, new Set(enemies));
            const kind = Nuclear.stock(d, cc).atom ? 'atom' : 'hydrogen';
            if (target) Nuclear.strike(d, cc, target, kind);
        }
        // 3. производство — до своего запаса, из свободных денег
        if (d.nuclear.building[cc]) return;
        const kind = Tech.has(c, 'hydrogen') ? 'hydrogen' : Tech.has(c, 'nuclear') ? 'atom' : null;
        if (!kind || Nuclear.total(d, cc) >= NUCLEAR.AI_STOCK[kind]) return;
        if (c.money - NUCLEAR.KINDS[kind].cost >= reserve * 1.5) Nuclear.build(d, cc, kind);
    }

    static desperate(d, cc) {
        const c = d.countries[cc];
        const capitalLost = c.capital && d.regions[c.capital] && d.regions[c.capital].owner !== cc;
        const original = Object.values(d.regions).filter(r => r.originalOwner === cc);
        const lost = original.filter(r => r.owner !== cc).length;
        return capitalLost || (original.length > 1 && lost / original.length >= NUCLEAR.AI_LOST_SHARE);
    }

    // Вражеская область у своей границы, где стоит самая сильная армия.
    static frontTarget(d, cc, enemySet) {
        let best = null, bestPower = 0;
        for (const r of d.getCountryRegions(cc)) {
            for (const id of d.getNeighbors(r.id)) {
                const other = d.regions[id];
                if (!other || !enemySet.has(other.owner)) continue;
                const power = d.calculateRegionMilitaryPower(id);
                if (power > bestPower) { bestPower = power; best = id; }
            }
        }
        return best;
    }

    // Сдерживание: во сколько раз реже ИИ решится на войну с этой страной.
    static deterrence(d, attacker, target) {
        if (!Nuclear.isPower(d, target)) return 1;
        return Nuclear.isPower(d, attacker) ? 0.3 : 0;
    }

    // --- сохранение ----------------------------------------------------------
    static serialize(d) {
        return structuredClone(d.nuclear);
    }

    static valid(x) {
        const obj = o => !!o && typeof o === 'object' && !Array.isArray(o);
        const count = n => Number.isSafeInteger(n) && n >= 0;
        const ccList = l => Array.isArray(l) && l.every(cc => CountriesDB[cc]);
        if (!obj(x) || !obj(x.arsenal) || !obj(x.building) || !obj(x.fallout) || !Array.isArray(x.strikes)) return false;
        if (!ccList(x.powers) || !ccList(x.founders) || !ccList(x.council)) return false;
        if (!Object.entries(x.arsenal).every(([cc, a]) => CountriesDB[cc] && obj(a) && count(a.atom) && count(a.hydrogen))) return false;
        if (!Object.entries(x.building).every(([cc, b]) => CountriesDB[cc] && obj(b) && NUCLEAR.KINDS[b.kind] && count(b.left) && Number.isInteger(b.started))) return false;
        if (!Object.entries(x.fallout).every(([id, t]) => RegionsDB[id] && Number.isInteger(t))) return false;
        return x.strikes.every(s => obj(s) && CountriesDB[s.by] && CountriesDB[s.target] && RegionsDB[s.region] && NUCLEAR.KINDS[s.kind] && Number.isInteger(s.turn));
    }

    static restore(d, x) {
        d.nuclear = structuredClone(x);
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Nuclear, NUCLEAR };
