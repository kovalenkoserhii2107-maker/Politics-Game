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
    AI_WARS_MAX: 3,             // сколько войн между ИИ может идти одновременно
    AI_WAR_CHANCE: 0.1,         // шанс новой войны ИИ за ход (дальше решают характеры)
    AI_TREATY_TRIES: 3,         // сколько пар соседей за ход пробуют договориться
    AI_WAR_MAX_RATIO: 4,        // совсем слабых не трогают — это уже не война, а избиение
    PEACEFUL_START_TURNS: 10,   // первые ходы никто не объявляет новых войн
    FIRST_ATTACK_TURN: 2,       // в уже идущей войне первые ходы ИИ только мобилизуется
    INVEST_PAYBACK: 10,         // строить, только если проект окупится быстрее, чем за столько ходов
    RESERVE_TURNS: 3,           // запас казны в ходах содержания армии, который ИИ не тратит на науку
    MODERNIZE_RESERVE: 1.5,     // модернизирует, когда денег больше этого числа запасов
    ARMS_SHARE: 0.3,            // в мирное время на армию — до такой доли дохода (× характер)
    ALLY_HELP_EVERY: 2,         // союзнику, на которого напали, войска — раз в столько ходов
    ALLY_HELP_SHARE: 0.35,      // доля войск приграничной области, уходящая союзнику
    ALLY_HELP_CAP: 0.3,         // за границей — не больше такой доли своей силы
    EXPEDITION_WEEKS: 1,        // дальний союзник тратит на экспедицию до недели налогов
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
        // соседи людей готовятся к обороне; страны людей ИИ не трогает
        const playerNeighbours = new Set(d.humans.flatMap(cc => d.neighbourCountries(cc)));
        for (const country of Object.values(d.countries)) {
            if (!country.alive || d.isHuman(country.id)) continue;
            if (!d.regionsByCountry[country.id].length) continue;
            this.balanceTaxes(country);
            this.handleRevolts(country);
            this.manageDebt(country);
            this.planScience(country);
            this.planNuclear(country);
            const enemies = d.enemiesOf(country.id);
            this.disbandIfBroke(country, enemies);
            this.helpAllies(country, enemies);
            if (enemies.length) this.planWar(country, enemies);
            else {
                if (playerNeighbours.has(country.id)) this.planPeace(country);
                else this.arm(country);
                // страны строят в разные ходы — иначе все разом переполняют рынок;
                // богатые строят чаще и больше: деньгам должно быть куда идти
                const slot = (country.id.charCodeAt(0) * 31 + country.id.charCodeAt(1)) % 8;
                const rich = this.richness(country);
                const every = rich >= 4 ? 2 : rich >= 2 ? 4 : 8;
                if ((d.turn + slot) % every === 0 && country.money > 3000000) {
                    const projects = Math.min(4, Math.max(1, Math.floor(rich * World.trait(d, country.id).invest)));
                    for (let i = 0; i < projects; i++) if (!this.invest(country, rich)) break;
                }
            }
        }
    }

    // Строим то, что по текущим ценам окупается быстрее: дешёвые товары —
    // значит, выгоднее еда или энергия. Так рынок сам себя выравнивает.
    // Во сколько раз казна больше запаса на чёрный день.
    richness(country) {
        const reserve = this.data.countryBalance(country.id).upkeep * AI_RULES.RESERVE_TURNS + 3e6;
        return country.money / reserve;
    }

    invest(country, rich = 1) {
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
        // у богатых окупаемость может быть дольше: лучше строить, чем копить
        const payback = AI_RULES.INVEST_PAYBACK * Math.min(3, Math.max(1, rich / 2));
        return !!(best && best.score >= 1 / payback && d.invest(best.region.id, best.kind, country.id).ok);
    }

    // Мирное вооружение по характеру: подтягиваемся к самому сильному соседу.
    // Изоляционисты и торговцы довольствуются меньшим, экспансионисты — больше.
    // Кроме соседей, армия соразмерна экономике: на неё идёт доля дохода
    // (ARMS_SHARE × характер) — так богатство становится силой, а не копится.
    arm(country) {
        const d = this.data;
        if ((d.turn + country.id.charCodeAt(0)) % 3 !== 0) return;
        const trait = World.trait(d, country.id);
        const around = d.neighbourCountries(country.id).filter(cc => d.countries[cc] && d.countries[cc].alive && d.countries[cc].playable);
        if (this.richness(country) < 1.5) return;
        const rival = around.length ? around.reduce((a, b) => (d.calculateMilitaryPower(b) > d.calculateMilitaryPower(a) ? b : a)) : null;
        const balance = d.countryBalance(country.id);
        const underFunded = balance.upkeep < balance.income * AI_RULES.ARMS_SHARE * trait.arms;
        const outgunned = rival && d.calculateMilitaryPower(country.id) < d.calculateMilitaryPower(rival) * 0.8 * trait.arms;
        if (!underFunded && !outgunned) return;
        const border = rival ? d.getCountryRegions(country.id).filter(r => d.getNeighbors(r.id).some(id => d.regions[id] && d.regions[id].owner === rival)) : [];
        const capital = d.regions[country.capital];
        const where = border.length ? border : capital && capital.owner === country.id ? [capital] : [];
        if (where.length) this.recruit(country, where, new Set(rival ? [rival] : []), AI_RULES.PEACE_SPEND_SHARE);
    }

    // Оборонительный союз — не только деньги: союзнику, на которого напали,
    // сосед по границе отправляет контингент в его приграничную область,
    // а дальний союзник за свой счёт собирает экспедиционный отряд прямо
    // там. Контингент обороняет область вместе с хозяином, содержит его
    // страна-отправитель. Когда у союзника войны больше нет — отзываем.
    helpAllies(country, enemies) {
        const d = this.data;
        for (const g of d.garrisonsOf(country.id)) {
            const owner = d.regions[g.region].owner;
            if (!d.enemiesOf(owner).length) d.recallGarrison(g.region, country.id);
        }
        if ((d.turn + country.id.charCodeAt(1)) % AI_RULES.ALLY_HELP_EVERY !== 0) return;
        const myEnemies = new Set(enemies);
        const own = d.calculateMilitaryPower(country.id);
        // своего фронта нет (или воюем с тем, до кого не дотянуться) — можно слать экспедицию
        const hasFront = enemies.length > 0 && d.getCountryRegions(country.id).some(r => d.getNeighbors(r.id).some(id => d.regions[id] && myEnemies.has(d.regions[id].owner)));
        for (const ally of Diplomacy.allies(d, country.id)) {
            // союз оборонительный: помогаем тому, на кого напали
            const aggressor = Credit.aggressorAgainst(d, ally);
            if (!aggressor) continue;
            const foes = new Set(d.enemiesOf(ally));
            const front = d.getCountryRegions(ally).filter(r => d.getNeighbors(r.id).some(id => d.regions[id] && foes.has(d.regions[id].owner)));
            if (!front.length) continue;
            const abroad = d.garrisonsOf(country.id).reduce((s, g) => s + d.armyPower(g.army, country.id), 0);
            if (abroad >= own * AI_RULES.ALLY_HELP_CAP) continue;
            const frontIds = new Set(front.map(r => r.id));
            if (!this.sendToAlly(country, ally, front, myEnemies) && !hasFront) this.expedition(country, ally, front);
        }
    }

    // Сосед союзника: часть войск из своей приграничной с ним области,
    // которой самой ничего не грозит, — по его территории в самую слабую
    // фронтовую область.
    sendToAlly(country, ally, front, myEnemies) {
        const d = this.data;
        const to = front.reduce((a, b) => (d.armyPower(b.army, ally) < d.armyPower(a.army, ally) ? b : a));
        for (const region of d.getCountryRegions(country.id)) {
            if (d.getNeighbors(region.id).some(id => d.regions[id] && myEnemies.has(d.regions[id].owner))) continue;
            if (!d.getNeighbors(region.id).some(id => d.regions[id] && d.regions[id].owner === ally)) continue;
            const available = d.getAvailableArmy(region.id);
            const forces = {};
            let any = false;
            for (const unitId of Object.keys(UnitsDB)) {
                const keep = unitId === 'infantry' ? 1 : 0;
                forces[unitId] = Math.max(0, Math.min((available[unitId] || 0) - keep, Math.floor((available[unitId] || 0) * AI_RULES.ALLY_HELP_SHARE)));
                if (forces[unitId] > 0) any = true;
            }
            if (!any) continue;
            if (d.deployToAlly(region.id, to.id, forces, country.id).ok) return true;
        }
        return false;
    }

    // Дальний союзник: экспедиционный отряд на неделю налогов, если казна позволяет.
    expedition(country, ally, front) {
        const d = this.data;
        if (this.richness(country) < 1.2) return false;
        const budget = Math.min(d.countryBalance(country.id).tax * AI_RULES.EXPEDITION_WEEKS, country.money * 0.1);
        const kinds = ['infantry', 'artillery', 'antiair'];
        const forces = {};
        let cost = 0;
        for (const unitId of kinds) {
            const n = Math.floor(budget / kinds.length / UnitsDB[unitId].buildCost);
            if (n > 0) { forces[unitId] = n; cost += n * UnitsDB[unitId].buildCost; }
        }
        if (!cost) return false;
        const to = front.reduce((a, b) => (d.armyPower(b.army, ally) < d.armyPower(a.army, ally) ? b : a));
        return d.stationExpedition(country.id, to.id, forces, cost).ok;
    }

    // Восстание: если есть деньги — уступки, иначе подавляем, когда гарнизон сильнее.
    handleRevolts(country) {
        const d = this.data;
        for (const id of Unrest.revoltsOf(d, country.id)) {
            if (country.money > Unrest.appeaseCost(d, id) * 2) Unrest.appease(d, id, country.id);
            else if (Unrest.garrisonStrength(d, id) >= Unrest.rebelStrength(d, id)) Unrest.suppress(d, id, country.id);
        }
    }

    // Долг — инструмент игроков: ИИ, получив кредит, тут же тратил бы его
    // на армию и увязал в процентах. Но если долг есть — отдаёт излишками.
    manageDebt(country) {
        if (!country.debt) return;
        const d = this.data;
        const reserve = d.countryBalance(country.id).upkeep * AI_RULES.RESERVE_TURNS + 3e6;
        if (country.money > reserve) d.repay(country.money - reserve, country.id);
    }

    // Наука: свободные деньги сверх запаса уходят в исследования, а у
    // богатых — ещё и в модернизацию. Воюющие сначала берут военные ветки.
    planScience(country) {
        const d = this.data;
        Tech.init(country);
        const upkeep = d.countryBalance(country.id).upkeep;
        const reserve = upkeep * AI_RULES.RESERVE_TURNS + 3e6;
        if (!country.research) {
            const atWar = d.enemiesOf(country.id).length > 0;
            const order = atWar ? AI.WAR_SCIENCE : AI.PEACE_SCIENCE;
            // ядерную программу заводят не все — только крупные страны рядом с ядерной угрозой
            const next = order.find(id => !Tech.has(country, id) && TECH_TREE[id].requires.every(r => Tech.has(country, r))
                && (TECH_TREE[id].branch !== 'nuclear' || Nuclear.aiWantsBomb(d, country.id)));
            if (next && country.money - TECH_TREE[next].cost >= reserve) d.startResearch(country.id, next);
        }
        for (let i = 0; i < 3 && country.money > reserve * AI_RULES.MODERNIZE_RESERVE; i++) {
            // модернизируем тот род войск, которого больше всего — так польза выше;
            // когда свои дошли до потолка, очередь доходит и до новых
            const army = d.getCountryStats(country.id).army;
            const options = Object.keys(UnitsDB)
                .map(id => ({ id, cost: d.techCost(country.id, id), weight: ((army[id] || 0) + 1) * UnitsDB[id].buildCost }))
                .filter(o => o.cost !== null && country.money - o.cost >= reserve * AI_RULES.MODERNIZE_RESERVE)
                .sort((a, b) => b.weight / b.cost - a.weight / a.cost);
            if (!options.length || !d.research(country.id, options[0].id).ok) break;
        }
    }

    // Ядерный арсенал: ответ на удар, удар в отчаянии, сборка боеголовок.
    planNuclear(country) {
        const reserve = this.data.countryBalance(country.id).upkeep * AI_RULES.RESERVE_TURNS + 3e6;
        Nuclear.aiPlan(this.data, country.id, reserve);
    }

    // Налог подстраивается под расходы: ИИ не должен банкротиться.
    balanceTaxes(country) {
        const balance = this.data.countryBalance(country.id);
        const population = this.data.getCountryRegions(country.id).reduce((s, r) => s + this.data.taxBase(r) * r.loyalty, 0);
        if (population <= 0) return;
        const need = (balance.expense - (balance.income - balance.tax)) / population + 0.01;
        // богатым незачем копить миллиарды: налог может опуститься до 2%
        const floor = this.richness(country) > 3 ? 0.02 : 0.05;
        country.taxRate = Math.min(0.2, Math.max(floor, Math.round(need * 100) / 100));
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
        // равняемся на самого сильного соседа-человека
        const humans = d.neighbourCountries(country.id).filter(cc => d.isHuman(cc));
        if (!humans.length) return;
        const rival = humans.reduce((a, b) => (d.calculateMilitaryPower(b) > d.calculateMilitaryPower(a) ? b : a));
        if (own >= d.calculateMilitaryPower(rival) * 0.8) return;
        const capital = d.regions[country.capital];
        if (!capital || capital.owner !== country.id) return;
        const border = d.getCountryRegions(country.id)
            .filter(r => d.getNeighbors(r.id).some(id => d.regions[id] && d.isHuman(d.regions[id].owner)));
        this.recruit(country, border.length ? border : [capital], new Set(humans), AI_RULES.PEACE_SPEND_SHARE);
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
        const choice = this.bestUnits(enemyArmy, country);

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
    bestUnits(enemyArmy, country) {
        let total = 0;
        for (const n of Object.values(enemyArmy)) total += n;
        const score = unitId => {
            const unit = UnitsDB[unitId];
            let countered = 0;
            for (const other of unit.counters || []) countered += enemyArmy[other] || 0;
            const share = total > 0 ? countered / total : 0;
            return ((unit.baseAttack + unit.baseDefense) * (1 + RULES.COUNTER_BONUS * share)) / unit.buildCost;
        };
        const ranked = Object.keys(UnitsDB).filter(id => !country || Tech.unitUnlocked(country, id)).sort((a, b) => score(b) - score(a));
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
        // первые ходы новых войн не начинают — но мир заключать можно всегда
        const mayStartWars = d.turn >= this.rule('PEACEFUL_START_TURNS');

        // 1. Сильный сосед может напасть на игрока — но только если тот ни с кем
        //    не воюет: второй фронт открывают не ИИ, а сам игрок. В сетевой
        //    игре так смотрят на каждого из людей.
        for (const player of mayStartWars ? d.humans : []) {
            if (!d.countries[player].alive || d.enemiesOf(player).length) continue;
            // на игрока смотрят вместе с его союзниками
            const playerPower = Math.max(1, d.calculateMilitaryPower(player)
                + Diplomacy.allies(d, player).reduce((sum, cc) => sum + d.calculateMilitaryPower(cc), 0));
            for (const cc of d.neighbourCountries(player)) {
                const country = d.countries[cc];
                if (!country || !country.alive || !country.playable || d.isHuman(cc)) continue;
                if (d.isAtWar(cc, player) || d.truceLeft(cc, player) || d.enemiesOf(cc).length) continue;
                if (Diplomacy.pactLeft(d, cc, player) || Diplomacy.isAllied(d, cc, player)) continue;
                const ratio = d.calculateMilitaryPower(cc) / playerPower;
                const trait = World.trait(d, cc);
                if (ratio < this.rule('WAR_ON_PLAYER_RATIO') * Math.max(1, trait.ratio / 1.4)) continue;
                // на ядерную державу без своей бомбы не нападают, с бомбой — редко
                const fear = Nuclear.deterrence(d, cc, player);
                if (!fear) continue;
                // хорошие отношения удерживают от войны, плохие — подталкивают
                const mood = Math.max(0, 1 - Diplomacy.relation(d, cc, player) / 100);
                if (Math.random() > this.rule('WAR_ON_PLAYER_CHANCE') * ratio * mood * fear * trait.war) continue;
                if (!d.declareWar(cc, player).ok) continue;
                events.push({ type: 'war', for: player, by: cc, target: player, message: `⚔️ ${country.name} объявила вам войну!` });
                break;
            }
        }

        // 2. Войны между ИИ — по характерам стран, несколько одновременно
        const aiWars = [...d.wars.keys()].filter(k => !k.split('|').some(cc => d.isHuman(cc))).length;
        if (mayStartWars && aiWars < AI_RULES.AI_WARS_MAX && Math.random() < AI_RULES.AI_WAR_CHANCE) {
            const war = this.pickAiWar();
            if (war && d.declareWar(war.attacker, war.target).ok) {
                const why = war.vulture ? ' — пользуется её слабостью' : war.grudge ? ' — давняя вражда' : '';
                events.push({ type: 'world-war', message: `🌍 ${d.countries[war.attacker].name} объявила войну: ${d.countries[war.target].name}${why}.` });
            }
        }

        // 3. Предложения игрокам: торговля, пакт, союз — от тех, кто расположен
        for (const player of d.humans) {
            const seat = d.seatOf(player);
            if (!d.countries[player].alive || seat.decisions.some(x => x.type !== 'peace')) continue;
            const offer = d.withPlayer(player, () => this.pickOffer());
            if (!offer) continue;
            seat.decisions.push(offer);
            const what = { deal: 'торговый договор', pact: 'пакт о ненападении', alliance: 'союз' }[offer.type];
            events.push({ type: 'offer', for: player, message: `📨 ${d.countries[offer.from].name} предлагает ${what}.` });
        }

        // 4. Договоры между ИИ: соседи торгуют, друзья вступают в союзы.
        //    Об этом сообщаем, только если это касается соседей игрока.
        const signed = this.aiTreaties();
        for (const player of d.humans) {
            const near = new Set(d.neighbourCountries(player));
            for (const t of signed) {
                if (!near.has(t.a) && !near.has(t.b)) continue;
                const what = t.kind === 'alliance' ? 'заключили оборонительный союз' : 'подписали торговый договор';
                events.push({ type: 'world-treaty', for: player, message: `${t.kind === 'alliance' ? '🛡️' : '🤝'} ${d.countries[t.a].name} и ${d.countries[t.b].name} ${what}.` });
            }
        }

        // 5. Мир: ИИ сам предлагает его игроку или договаривается с другим ИИ.
        //    Войну двух людей заканчивают сами люди.
        for (const key of [...d.wars.keys()]) {
            const [a, b] = key.split('|');
            if (d.isHuman(a) && d.isHuman(b)) continue;
            if (d.isHuman(a) || d.isHuman(b)) {
                const player = d.isHuman(a) ? a : b, ai = player === a ? b : a;
                const seat = d.seatOf(player);
                if (seat.decisions.some(x => x.type === 'peace' && x.from === ai)) continue;
                if (this.wantsPeace(ai, player) && Math.random() < 0.15) {
                    seat.decisions.push({ type: 'peace', from: ai });
                    events.push({ type: 'peace-offer', for: player, message: `🕊️ ${d.countries[ai].name} предлагает мир.` });
                }
            } else if (this.aiWarGoalReached(a, b) || this.aiPeaceChance(a, b) > Math.random()) {
                d.makePeace(a, b);
                events.push({ type: 'world-peace', message: `🕊️ ${d.countries[a].name} и ${d.countries[b].name} заключили мир.` });
            }
        }
        return events;
    }

    // Несколько случайных пар соседей за ход: хватает, чтобы за пару десятков
    // ходов сложились торговые связи и первые союзы, но мир не окаменел.
    aiTreaties() {
        const d = this.data;
        const signed = [];
        const ids = Object.keys(d.countries).filter(cc => !d.isHuman(cc) && d.countries[cc].alive && d.countries[cc].playable);
        // торговцы договариваются чаще
        const pool = ids.flatMap(cc => (World.trait(d, cc).trade >= 2 ? [cc, cc] : World.trait(d, cc).trade < 1 && Math.random() < 0.5 ? [] : [cc]));
        for (let i = 0; i < AI_RULES.AI_TREATY_TRIES && pool.length; i++) {
            const a = pool[Math.floor(Math.random() * pool.length)];
            const around = d.neighbourCountries(a).filter(cc => !d.isHuman(cc) && ids.includes(cc));
            const b = around[Math.floor(Math.random() * around.length)];
            if (!b || d.isAtWar(a, b)) continue;
            const rel = Diplomacy.relation(d, a, b);
            let kind = null;
            if (!Diplomacy.hasDeal(d, a, b)) {
                if (rel >= 0 && Diplomacy.dealCount(d, a) < DIPLOMACY.DEAL_MAX && Diplomacy.dealCount(d, b) < DIPLOMACY.DEAL_MAX) kind = 'deal';
            } else if (!Diplomacy.isAllied(d, a, b) && rel >= DIPLOMACY.ALLIANCE_MIN_RELATION + 5 && Math.random() < 0.25
                && Diplomacy.allies(d, a).length < 2 && Diplomacy.allies(d, b).length < 2
                && Diplomacy.willAccept(d, a, b, 'alliance').likely && Diplomacy.willAccept(d, b, a, 'alliance').likely) kind = 'alliance';
            if (!kind) continue;
            Diplomacy.sign(d, a, b, kind);
            signed.push({ a, b, kind });
        }
        return signed;
    }

    pickOffer() {
        const d = this.data;
        const p = d.playerCountry;
        const candidates = new Set([...d.neighbourCountries(p), ...Diplomacy.partners(d, p, d.deals)]);
        for (const cc of candidates) {
            const c = d.countries[cc];
            if (!c || !c.alive || !c.playable || d.isHuman(cc) || d.isAtWar(cc, p)) continue;
            const rel = Diplomacy.relation(d, cc, p);
            if (rel >= 0 && !Diplomacy.hasDeal(d, cc, p) && Diplomacy.dealCount(d, p) < DIPLOMACY.DEAL_MAX
                && Diplomacy.dealCount(d, cc) < DIPLOMACY.DEAL_MAX && Math.random() < 0.012) return { type: 'deal', from: cc };
            if (rel >= 10 && !Diplomacy.pactLeft(d, cc, p) && d.calculateMilitaryPower(cc) < d.calculateMilitaryPower(p)
                && Math.random() < 0.03) return { type: 'pact', from: cc };
            if (rel >= 60 && !Diplomacy.isAllied(d, cc, p) && Diplomacy.willAccept(d, cc, p, 'alliance').likely
                && Math.random() < 0.02) return { type: 'alliance', from: cc };
        }
        return null;
    }

    // Кто на кого нападёт: вес — характер нападающего, вражда и слабость
    // цели. Экспансионист довольствуется небольшим перевесом, оборонец
    // решится только при подавляющем. Оппортунист ищет того, кто уже
    // воюет, охвачен гражданской войной или потерял столицу.
    pickAiWar() {
        const d = this.data;
        const candidates = [];
        let total = 0;
        for (const country of Object.values(d.countries)) {
            if (!country.alive || !country.playable || d.isHuman(country.id)) continue;
            if (d.enemiesOf(country.id).length || country.influence < RULES.WAR_COST) continue;
            const power = d.calculateMilitaryPower(country.id);
            if (power < 200 || d.regionsByCountry[country.id].length < 2) continue;
            const trait = World.trait(d, country.id);
            if (Council.sanctioned(d, country.id)) continue;   // под санкциями новых войн не начинают
            for (const cc of d.neighbourCountries(country.id)) {
                if (d.isHuman(cc)) continue;
                const other = d.countries[cc];
                if (!other.alive || !other.playable || d.truceLeft(country.id, cc)) continue;
                if (Diplomacy.isAllied(d, country.id, cc) || Diplomacy.pactLeft(d, country.id, cc)) continue;
                if (d.regionsByCountry[cc].length < 2) continue;
                if (Nuclear.deterrence(d, country.id, cc) < 1) continue;   // ядерные державы ИИ не трогает
                const ratio = power / Math.max(1, d.calculateMilitaryPower(cc));
                if (ratio < trait.ratio || ratio > AI_RULES.AI_WAR_MAX_RATIO) continue;
                const rel = Diplomacy.relation(d, country.id, cc);
                if (rel >= 30) continue;                                  // друзей не трогают
                const grudge = rel <= -30;
                const weak = d.enemiesOf(cc).length > 0 || Unrest.civilWar(d, cc)
                    || (other.capital && d.regions[other.capital] && d.regions[other.capital].owner !== cc);
                const vulture = !!trait.vulture && weak;
                if (trait.vulture && !weak && !grudge) continue;           // оппортунист ждёт случая
                const w = trait.war * Math.min(3, Math.max(0.3, 1 - rel / 40)) * (vulture ? 3 : weak ? 1.5 : 1);
                candidates.push({ attacker: country.id, target: cc, w, vulture, grudge });
                total += w;
            }
        }
        if (!candidates.length) return null;
        let roll = Math.random() * total;
        return candidates.find(c => (roll -= c.w) <= 0) || candidates[candidates.length - 1];
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
        // воевать с ядерной державой без своей бомбы — страшно
        if (Nuclear.isPower(d, other) && !Nuclear.isPower(d, ai) && info.turns >= 3) return true;
        return (score < 0 && ratio < 1) || (info.turns >= 20 && score <= 0);
    }

    // Принимает ли ИИ мир, предложенный игроком.
    acceptsPeace(ai, other) {
        const d = this.data;
        const info = d.warInfo(ai, other);
        if (!info) return true;
        const ratio = d.calculateMilitaryPower(ai) / Math.max(1, d.calculateMilitaryPower(other));
        const score = info.taken - info.lost;
        if (Nuclear.isPower(d, other) && !Nuclear.isPower(d, ai)) return true;
        // под санкциями или эмбарго ООН воевать дорого
        if ((Council.sanctioned(d, ai) || Council.embargoed(d, ai)) && score <= 2) return true;
        return score < 0 || ratio < 0.9 || (info.turns >= 12 && score <= 0) || (info.turns >= 6 && Diplomacy.relation(d, ai, other) > -30);
    }

    // Нападающий в войне ИИ против ИИ берёт свою долю земель и останавливается.
    aiWarGoalReached(a, b) {
        const d = this.data;
        const war = d.wars.get(d.pairKey(a, b));
        if (!war) return false;
        const attacker = war.attacker, defender = attacker === a ? b : a;
        const original = Object.values(d.regions).filter(r => r.originalOwner === defender).length;
        // экспансионист хочет больше, торговец — меньше
        const goal = Math.max(1, Math.ceil(original * World.trait(d, attacker).goal));
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
        // миролюбивые стороны договариваются охотнее
        const mood = (World.trait(d, a).peace + World.trait(d, b).peace) / 2;
        if (Math.max(lostShare(a), lostShare(b)) >= 0.25) return Math.min(0.9, 0.35 * mood);
        return info.turns >= 10 ? Math.min(0.5, 0.12 * mood) : 0;
    }
}

// Порядок исследований ИИ: в мире сначала экономика, на войне — оружие.
AI.PEACE_SCIENCE = ['agrotech', 'powergrid', 'medicine', 'logistics1', 'drones', 'motorized', 'automation', 'fortify',
    'ewar', 'specops', 'digital', 'missiles', 'stealth', 'fusion', 'logistics2', 'nuclear', 'hydrogen'];
AI.WAR_SCIENCE = ['drones', 'medicine', 'motorized', 'fortify', 'ewar', 'specops', 'missiles', 'nuclear', 'stealth', 'hydrogen',
    'agrotech', 'powergrid', 'logistics1', 'automation', 'digital', 'fusion', 'logistics2'];
