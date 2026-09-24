// =====================================================================
// ИИ СТРАН
//
// Перед разрешением хода ИИ кладёт свои приказы в те же очереди, что и
// игрок, — поэтому бой, марш и набор для всех считаются одним кодом.
// Думают только страны, которым это нужно: воюющие и соседи игрока.
// =====================================================================
const AI_RULES = {
    ATTACK_MARGIN: 1.35,        // ИИ атакует только с запасом над порогом боя
    SPEND_SHARE: 0.4,           // доля казны, которую воюющая страна тратит на набор за ход
    PEACE_SPEND_SHARE: 0.1,
    FRONT_GARRISON: 0.3,        // доля войск, остающаяся в прифронтовой области
    WAR_ON_PLAYER_RATIO: 1.6,   // во сколько раз сильнее должен быть сосед, чтобы напасть
    WAR_ON_PLAYER_CHANCE: 0.015,
    AI_WARS_MAX: 1,             // сколько войн между ИИ может идти одновременно
    AI_WAR_CHANCE: 0.05,
    AI_WAR_RATIO: [1.2, 2.5],   // ИИ воюет с ИИ только при сопоставимых силах — без избиения слабых
    AI_WAR_GOAL: 0.2,           // войны между ИИ ограниченные: взял пятую часть земель — мир
    PEACEFUL_START_TURNS: 10,   // первые ходы никто не объявляет новых войн
    FIRST_ATTACK_TURN: 2,       // в уже идущей войне первые ходы ИИ только мобилизуется
    INVEST_PAYBACK: 10,         // строить, только если проект окупится быстрее, чем за столько ходов
};

class AI {
    constructor(data) {
        this.data = data;
    }

    // Правило с поправкой на уровень игры.
    rule(key) {
        const override = DIFFICULTY[this.data.difficulty]?.ai;
        return override && key in override ? override[key] : AI_RULES[key];
    }

    // --- планирование хода -------------------------------------------
    planTurn() {
        const d = this.data;
        const playerNeighbours = new Set(d.neighbourCountries(d.playerCountry));
        for (const country of Object.values(d.countries)) {
            if (!country.alive || country.id === d.playerCountry) continue;
            if (!d.regionsByCountry[country.id].length) continue;
            this.balanceTaxes(country);
            const enemies = d.enemiesOf(country.id);
            this.disbandIfBroke(country, enemies);
            if (enemies.length) this.planWar(country, enemies);
            else {
                if (playerNeighbours.has(country.id)) this.planPeace(country);
                // страны строят в разные ходы — иначе все разом переполняют рынок
                const slot = (country.id.charCodeAt(0) * 31 + country.id.charCodeAt(1)) % 8;
                if ((d.turn + slot) % 8 === 0 && country.money > 3000000) this.invest(country);
            }
        }
    }

    // Строим то, что по текущим ценам окупается быстрее: дешёвые товары —
    // значит, выгоднее еда или энергия. Так рынок сам себя выравнивает.
    invest(country) {
        const d = this.data;
        let best = null;
        for (const region of d.getCountryRegions(country.id)) {
            if (d.projects.some(p => p.regionId === region.id)) continue;
            for (const kind of Object.keys(DEVELOPMENT)) {
                if (region.development[kind] >= 5) continue;
                const cost = d.developmentCost(region.id, kind);
                const score = Economy.projectValue(d, region.id, kind) / cost;
                if (!best || score > best.score) best = { region, kind, score };
            }
        }
        if (best && best.score >= 1 / AI_RULES.INVEST_PAYBACK) d.invest(best.region.id, best.kind, country.id);
    }

    // Налог подстраивается под расходы: ИИ не должен банкротиться.
    balanceTaxes(country) {
        const balance = this.data.countryBalance(country.id);
        const population = this.data.getCountryRegions(country.id).reduce((s, r) => s + r.population * r.loyalty, 0);
        if (population <= 0) return;
        const need = (balance.expense - (balance.income - balance.tax)) / population + 0.01;
        country.taxRate = Math.min(0.2, Math.max(0.05, Math.round(need * 100) / 100));
    }

    planWar(country, enemies) {
        const d = this.data;
        const enemySet = new Set(enemies);
        const own = d.getCountryRegions(country.id);
        const front = own.filter(r => d.getNeighbors(r.id).some(id => d.regions[id] && enemySet.has(d.regions[id].owner)));
        if (!front.length) return;

        this.recruit(country, front, enemySet, AI_RULES.SPEND_SHARE);
        this.reinforce(country, own, front);
        if (d.turn >= this.rule('FIRST_ATTACK_TURN')) this.attack(country, front, enemySet);
    }

    // В мирное время сосед игрока вооружается только до паритета: это
    // оборона, а не подготовка к нападению.
    planPeace(country) {
        const d = this.data;
        if (d.turn % 3 !== 0) return;       // мирная подготовка — раз в несколько ходов
        const own = d.calculateMilitaryPower(country.id);
        if (own >= d.calculateMilitaryPower(d.playerCountry) * 0.8) return;
        const capital = d.regions[country.capital];
        if (!capital || capital.owner !== country.id) return;
        const border = d.getCountryRegions(country.id)
            .filter(r => d.getNeighbors(r.id).some(id => d.regions[id] && d.regions[id].owner === d.playerCountry));
        this.recruit(country, border.length ? border : [capital], new Set([d.playerCountry]), AI_RULES.PEACE_SPEND_SHARE);
    }

    // Хронический дефицит: распускаем самые дорогие войска в тылу, пока
    // бюджет не сойдётся. Иначе армия всё равно разбежится от безденежья.
    disbandIfBroke(country, enemies) {
        const d = this.data;
        const net = country.lastNetIncome;
        if (net >= 0 || country.money > -net * 15) return false;

        const enemySet = new Set(enemies);
        const rear = d.getCountryRegions(country.id).filter(r =>
            !d.getNeighbors(r.id).some(id => d.regions[id] && enemySet.has(d.regions[id].owner)));
        const byCost = Object.keys(UnitsDB).sort((a, b) => UnitsDB[b].maintenanceCost - UnitsDB[a].maintenanceCost);
        let toCut = -net;
        for (const unitId of byCost) {
            for (const region of rear) {
                while (toCut > 0 && region.army[unitId] > (unitId === 'infantry' ? 1 : 0)) {
                    region.army[unitId]--;
                    toCut -= UnitsDB[unitId].maintenanceCost;
                }
            }
        }
        return true;
    }

    // --- набор ---------------------------------------------------------
    // Сколько можно добавить содержания в ход. В мирное время — только из
    // профицита; на войне страна готова тратить и казну.
    upkeepRoom(country, atWar) {
        const fromSurplus = Math.max(0, country.lastNetIncome * 0.6);
        return fromSurplus + Math.max(0, country.money) / (atWar ? 40 : 200);
    }

    recruit(country, regions, enemySet, share) {
        const d = this.data;
        let budget = Math.max(0, country.money) * share;
        let upkeepRoom = this.upkeepRoom(country, d.enemiesOf(country.id).length > 0);
        if (budget < UnitsDB.infantry.buildCost) return;

        // против кого воюем — такие рода войск и берём
        const enemyArmy = d.emptyArmy();
        for (const region of regions) {
            for (const id of d.getNeighbors(region.id)) {
                const other = d.regions[id];
                if (!other || !enemySet.has(other.owner)) continue;
                for (const unitId of Object.keys(UnitsDB)) enemyArmy[unitId] += other.army[unitId] || 0;
            }
        }
        const choice = this.bestUnits(enemyArmy);

        // сначала самые угрожаемые области
        const threat = r => d.getNeighbors(r.id).reduce((sum, id) => {
            const other = d.regions[id];
            return other && enemySet.has(other.owner) ? sum + d.calculateRegionMilitaryPower(id) : sum;
        }, 0);
        const ordered = regions.slice().sort((a, b) => threat(b) - threat(a));

        for (const region of ordered) {
            for (const unitId of choice) {
                const unit = UnitsDB[unitId];
                const byCapacity = Math.floor(d.recruitCapacityLeft(region.id) / unit.industryCost);
                const byMoney = Math.floor(budget / unit.buildCost);
                const byUpkeep = Math.floor(upkeepRoom / unit.maintenanceCost);
                const amount = Math.min(byCapacity, byMoney, byUpkeep);
                if (amount <= 0) continue;
                const result = d.queueRecruitment(region.id, unitId, amount, country.id);
                if (!result.ok) continue;
                budget -= unit.buildCost * amount;
                upkeepRoom -= unit.maintenanceCost * amount;
            }
            if (budget < UnitsDB.infantry.buildCost || upkeepRoom < UnitsDB.infantry.maintenanceCost) break;
        }
    }

    // Лучшие рода войск против такой армии противника: сила за доллар
    // с учётом того, кого этот род войск контрит. Пехота — всегда запасной вариант.
    bestUnits(enemyArmy) {
        let total = 0;
        for (const n of Object.values(enemyArmy)) total += n;
        const score = unitId => {
            const unit = UnitsDB[unitId];
            let countered = 0;
            for (const other of unit.counters || []) countered += enemyArmy[other] || 0;
            const share = total > 0 ? countered / total : 0;
            return ((unit.baseAttack + unit.baseDefense) * (1 + RULES.COUNTER_BONUS * share)) / unit.buildCost;
        };
        const ranked = Object.keys(UnitsDB).sort((a, b) => score(b) - score(a));
        const picks = ranked.slice(0, 2);
        if (!picks.includes('infantry')) picks.push('infantry');
        return picks;
    }

    // --- переброска к фронту ---------------------------------------------
    reinforce(country, own, front) {
        const d = this.data;
        const frontSet = new Set(front.map(r => r.id));

        // расстояние до фронта внутри своей территории
        const dist = new Map(front.map(r => [r.id, 0]));
        let frontier = front.map(r => r.id);
        while (frontier.length) {
            const next = [];
            for (const id of frontier) {
                for (const nb of d.getNeighbors(id)) {
                    const region = d.regions[nb];
                    if (!region || region.owner !== country.id || dist.has(nb)) continue;
                    dist.set(nb, dist.get(id) + 1);
                    next.push(nb);
                }
            }
            frontier = next;
        }

        for (const region of own) {
            if (frontSet.has(region.id)) continue;
            const available = d.getAvailableArmy(region.id);
            const forces = {};
            let any = false;
            for (const unitId of Object.keys(UnitsDB)) {
                // во внутренней области оставляем одну пехоту — для порядка
                const keep = unitId === 'infantry' ? 1 : 0;
                forces[unitId] = Math.max(0, (available[unitId] || 0) - keep);
                if (forces[unitId] > 0) any = true;
            }
            if (!any) continue;

            const here = dist.has(region.id) ? dist.get(region.id) : Infinity;
            let best = null, bestDist = here;
            for (const id of d.getValidMoveTargets(region.id)) {
                const to = dist.has(id) ? dist.get(id) : Infinity;
                if (to < bestDist) { bestDist = to; best = id; }
            }
            if (best) d.queueMovement(region.id, best, forces, country.id);
        }
    }

    // --- атака ---------------------------------------------------------------
    attack(country, front, enemySet) {
        const d = this.data;

        // все вражеские области на линии фронта и откуда их можно ударить
        const targets = new Map();
        for (const region of front) {
            for (const id of d.getNeighbors(region.id)) {
                const other = d.regions[id];
                if (!other || !enemySet.has(other.owner)) continue;
                if (!targets.has(id)) targets.set(id, []);
                targets.get(id).push(region);
            }
        }

        // оцениваем каждую цель и бьём сначала по самым выгодным
        const plans = [];
        for (const [targetId, sources] of targets) {
            const target = d.regions[targetId];
            const pool = d.emptyArmy();
            const offers = sources.map(src => {
                const available = d.getAvailableArmy(src.id);
                const offer = {};
                for (const unitId of Object.keys(UnitsDB)) {
                    offer[unitId] = Math.floor(Math.max(0, available[unitId] || 0) * (1 - AI_RULES.FRONT_GARRISON));
                    pool[unitId] += offer[unitId];
                }
                return { region: src, offer };
            });
            const attack = d.sidePower(pool, country.id, 'baseAttack', target.army);
            const defense = this.estimateDefense(target, pool);
            plans.push({ targetId, offers, ratio: defense > 0 ? attack / defense : Infinity });
        }
        plans.sort((a, b) => b.ratio - a.ratio);

        for (const plan of plans) {
            if (plan.ratio < this.rule('ATTACK_MARGIN')) break;
            // пересчёт с учётом войск, уже отданных под другие атаки
            const target = d.regions[plan.targetId];
            const pool = d.emptyArmy();
            const offers = plan.offers.map(({ region }) => {
                const available = d.getAvailableArmy(region.id);
                const offer = {};
                for (const unitId of Object.keys(UnitsDB)) {
                    offer[unitId] = Math.floor(Math.max(0, available[unitId] || 0) * (1 - AI_RULES.FRONT_GARRISON));
                    pool[unitId] += offer[unitId];
                }
                return { region, offer };
            });
            const attack = d.sidePower(pool, country.id, 'baseAttack', target.army);
            if (attack < this.estimateDefense(target, pool) * this.rule('ATTACK_MARGIN')) continue;
            for (const { region, offer } of offers) {
                if (Object.values(offer).some(n => n > 0)) d.queueAttack(region.id, plan.targetId, offer, country.id);
            }
        }
    }

    // Та же формула обороны, что и в бою, плюс порог успеха атаки.
    estimateDefense(target, attackers) {
        return this.data.defensePower(target, attackers) * RULES.ATTACK_ADVANTAGE;
    }

    // --- дипломатия после хода -------------------------------------------------
    diplomacy() {
        const d = this.data;
        const events = [];
        const player = d.playerCountry;
        const playerPower = Math.max(1, d.calculateMilitaryPower(player));
        // первые ходы новых войн не начинают — но мир заключать можно всегда
        const mayStartWars = d.turn >= this.rule('PEACEFUL_START_TURNS');

        // 1. Сильный сосед может напасть на игрока — но только если тот ни с кем
        //    не воюет: второй фронт открывают не ИИ, а сам игрок
        const playerBusy = d.enemiesOf(player).length > 0;
        for (const cc of mayStartWars && !playerBusy ? d.neighbourCountries(player) : []) {
            const country = d.countries[cc];
            if (!country || !country.alive || !country.playable) continue;
            if (d.isAtWar(cc, player) || d.truceLeft(cc, player) || d.enemiesOf(cc).length) continue;
            const ratio = d.calculateMilitaryPower(cc) / playerPower;
            if (ratio < this.rule('WAR_ON_PLAYER_RATIO')) continue;
            if (Math.random() > this.rule('WAR_ON_PLAYER_CHANCE') * ratio) continue;
            if (!d.declareWar(cc, player).ok) continue;
            events.push({ type: 'war', by: cc, target: player, message: `⚔️ ${country.name} объявила вам войну!` });
            break;
        }

        // 2. Войны между ИИ — редко и не больше нескольких одновременно
        const aiWars = [...d.wars.keys()].filter(k => !k.split('|').includes(player)).length;
        if (mayStartWars && aiWars < AI_RULES.AI_WARS_MAX && Math.random() < AI_RULES.AI_WAR_CHANCE) {
            const war = this.pickAiWar();
            if (war && d.declareWar(war.attacker, war.target).ok) {
                events.push({ type: 'world-war', message: `🌍 ${d.countries[war.attacker].name} объявила войну: ${d.countries[war.target].name}.` });
            }
        }

        // 3. Мир: ИИ сам предлагает его игроку или договаривается с другим ИИ
        for (const key of [...d.wars.keys()]) {
            const [a, b] = key.split('|');
            if (a === player || b === player) {
                const ai = a === player ? b : a;
                if (d.decisions.some(x => x.type === 'peace' && x.from === ai)) continue;
                if (this.wantsPeace(ai, player) && Math.random() < 0.15) {
                    d.decisions.push({ type: 'peace', from: ai });
                    events.push({ type: 'peace-offer', message: `🕊️ ${d.countries[ai].name} предлагает мир.` });
                }
            } else if (this.aiWarGoalReached(a, b) || this.aiPeaceChance(a, b) > Math.random()) {
                d.makePeace(a, b);
                events.push({ type: 'world-peace', message: `🕊️ ${d.countries[a].name} и ${d.countries[b].name} заключили мир.` });
            }
        }
        return events;
    }

    pickAiWar() {
        const d = this.data;
        const candidates = [];
        for (const country of Object.values(d.countries)) {
            if (!country.alive || !country.playable || country.id === d.playerCountry) continue;
            if (d.enemiesOf(country.id).length || country.influence < RULES.WAR_COST) continue;
            const power = d.calculateMilitaryPower(country.id);
            if (power < 200) continue;
            if (d.regionsByCountry[country.id].length < 3) continue;
            for (const cc of d.neighbourCountries(country.id)) {
                if (cc === d.playerCountry) continue;
                const other = d.countries[cc];
                if (!other.alive || !other.playable || d.enemiesOf(cc).length || d.truceLeft(country.id, cc)) continue;
                if (d.regionsByCountry[cc].length < 3) continue;
                const ratio = power / Math.max(1, d.calculateMilitaryPower(cc));
                const [lo, hi] = AI_RULES.AI_WAR_RATIO;
                if (ratio >= lo && ratio <= hi) candidates.push({ attacker: country.id, target: cc });
            }
        }
        return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    }

    // Итог войны с точки зрения ИИ: сколько областей взял минус сколько потерял.
    warScore(ai, other) {
        const info = this.data.warInfo(ai, other);
        return info ? info.taken - info.lost : 0;
    }

    wantsPeace(ai, other) {
        const d = this.data;
        const info = d.warInfo(ai, other);
        if (!info) return false;
        const ratio = d.calculateMilitaryPower(ai) / Math.max(1, d.calculateMilitaryPower(other));
        const score = info.taken - info.lost;
        return (score < 0 && ratio < 1) || (info.turns >= 20 && score <= 0);
    }

    // Принимает ли ИИ мир, предложенный игроком.
    acceptsPeace(ai, other) {
        const d = this.data;
        const info = d.warInfo(ai, other);
        if (!info) return true;
        const ratio = d.calculateMilitaryPower(ai) / Math.max(1, d.calculateMilitaryPower(other));
        const score = info.taken - info.lost;
        return score < 0 || ratio < 0.9 || (info.turns >= 12 && score <= 0);
    }

    // Нападающий в войне ИИ против ИИ берёт свою долю земель и останавливается.
    aiWarGoalReached(a, b) {
        const d = this.data;
        const war = d.wars.get(d.pairKey(a, b));
        if (!war) return false;
        const attacker = war.attacker, defender = attacker === a ? b : a;
        const original = Object.values(d.regions).filter(r => r.originalOwner === defender).length;
        const goal = Math.max(1, Math.ceil(original * AI_RULES.AI_WAR_GOAL));
        return d.warInfo(attacker, defender).taken >= goal;
    }

    aiPeaceChance(a, b) {
        const d = this.data;
        const info = d.warInfo(a, b);
        if (!info) return 0;
        const lostShare = cc => {
            const original = Object.values(d.regions).filter(r => r.originalOwner === cc).length || 1;
            const kept = d.getCountryRegions(cc).filter(r => r.originalOwner === cc).length;
            return 1 - kept / original;
        };
        if (Math.max(lostShare(a), lostShare(b)) >= 0.25) return 0.35;
        return info.turns >= 10 ? 0.12 : 0;
    }
}
