// =====================================================================
// МОДЕЛЬ МИРА: страны, области, отношения, приказы, разрешение хода
// =====================================================================

// Все настройки механик в одном месте — чтобы баланс правился без поиска
// чисел по коду.
const RULES = {
    ATTACK_ADVANTAGE: 1.2,      // во сколько раз атака должна превзойти оборону
    COUNTER_BONUS: 0.4,         // бонус рода войск против тех, кого он контрит
    CAPITAL_DEFENSE: 0.25,      // бонус обороны столицы
    DEFENSE_BONUS: 1.5,         // окопы и знание местности: обороняться легче, чем наступать
    TECH_STEP: 0.2,             // +20% силы за уровень техники
    TECH_MAX: 5,
    TECH_COSTS: [0, 1000000, 3000000, 6000000, 10000000],   // цена перехода на уровень 2..5
    MARCH_COSTS: [0, 4000000, 12000000],                    // скорость марша 2 и 3
    INFLUENCE_PER_TURN: 2,
    INFLUENCE_MAX: 100,
    WAR_COST: 20,               // влияние на объявление войны
    PEACE_COST: 10,             // влияние на мирное предложение
    TRUCE_TURNS: 10,            // после мира нельзя снова объявить войну
    SPY_COST: 50000,
    MILITIA_DIVISOR: 250,       // ополчение: sqrt(население) / это число
    DESERTION: 0.1,             // доля войск, уходящих при пустой казне
};

// Проекты увеличивают ресурс области; что это даёт в еде, энергии и
// товарах, считает Economy. Цены подобраны под окупаемость ~8 ходов.
const DEVELOPMENT = {
    industry: { name: 'Промышленный район', cost: 600000, turns: 2, resource: 'industry', gain: 20, yields: 'goods' },
    agro: { name: 'Агрокомплекс', cost: 360000, turns: 2, resource: 'agro', gain: 15, yields: 'food' },
    oil: { name: 'Энергетический комплекс', cost: 750000, turns: 3, resource: 'oil', gain: 2, yields: 'energy' },
};
const POLICIES = {
    balanced: { name: 'Сбалансированный курс', description: 'Без дополнительных расходов и штрафов.', industry: 1, loyalty: 0, socialCost: 0 },
    social: { name: 'Социальный курс', description: '+10 п.п. к целевой лояльности. Расход: $0,005 на жителя за ход.', industry: 1, loyalty: 0.1, socialCost: 0.005 },
    production: { name: 'Промышленный курс', description: '+20% дохода промышленности. −5 п.п. к целевой лояльности.', industry: 1.2, loyalty: -0.05, socialCost: 0 },
};

// Уровни игры: сколько денег у игрока на старте и насколько смел ИИ.
// Ключи ai перекрывают одноимённые AI_RULES.
const DIFFICULTY = {
    easy: {
        name: 'Лёгкий', note: 'Казна в полтора раза больше, соседи осторожны и долго не нападают.',
        playerMoney: 1.5,
        ai: { ATTACK_MARGIN: 1.6, WAR_ON_PLAYER_RATIO: 2.2, WAR_ON_PLAYER_CHANCE: 0.006, PEACEFUL_START_TURNS: 20, FIRST_ATTACK_TURN: 4 },
    },
    normal: { name: 'Обычный', note: 'Как задумано: соседи нападают, если заметно сильнее вас.', playerMoney: 1, ai: {} },
    hard: {
        name: 'Тяжёлый', note: 'Казна меньше, соседи смелее и начинают войны раньше.',
        playerMoney: 0.8,
        ai: { ATTACK_MARGIN: 1.2, WAR_ON_PLAYER_RATIO: 1.3, WAR_ON_PLAYER_CHANCE: 0.03, PEACEFUL_START_TURNS: 5, FIRST_ATTACK_TURN: 1 },
    },
};

class GameData {
    constructor(playerCountryId, options = {}) {
        this.playerCountry = playerCountryId;
        this.cheatMode = !!options.cheat;
        this.scenario = options.scenario || 'peace';
        this.difficulty = DIFFICULTY[options.difficulty] ? options.difficulty : 'normal';

        this.currentDate = new Date(2024, 0, 1);
        this.turn = 0;
        this.countries = {};
        this.regions = {};
        this.regionsByCountry = {};
        this.history = [];
        this.orders = this.emptyOrders();
        this.wars = new Map();      // 'AA|BB' -> { start, attacker }
        this.truces = new Map();    // 'AA|BB' -> ход, до которого действует перемирие
        this.decisions = [];        // предложения, ждущие ответа игрока
        this.gameOver = false;
        this.outcome = null;
        this.projects = [];
        this.market = Economy.initMarket();   // текущие цены мирового рынка
        this.campaign = { budget: false, investment: false, recruited: false, diplomacy: false, conquest: false };

        this.build();
        if (!options.restoring) {
            this.setupScenario();
            const player = this.countries[playerCountryId];
            if (player) player.money = Math.round(player.money * DIFFICULTY[this.difficulty].playerMoney);
        }
    }

    emptyOrders() {
        return { recruitment: [], attacks: [], movements: [], recon: [] };
    }

    emptyArmy() {
        const army = {};
        for (const unitId of Object.keys(UnitsDB)) army[unitId] = 0;
        return army;
    }

    baseTech() {
        const tech = { marchSpeed: 1 };
        for (const unitId of Object.keys(UnitsDB)) tech[unitId] = 1;
        return tech;
    }

    // --- построение мира -----------------------------------------------
    build() {
        for (const id of Object.keys(CountriesDB)) {
            const c = CountriesDB[id];
            this.countries[id] = {
                id,
                name: c.name,
                color: c.color,
                money: c.money,
                influence: c.influence,
                taxRate: c.taxRate,
                playable: c.playable,
                alive: c.regions > 0,
                capital: null,
                policy: 'balanced',
                policyChangedAt: -3,
                lastNetIncome: 0,
                tech: this.baseTech(),
            };
            this.regionsByCountry[id] = [];
        }

        for (const id of Object.keys(RegionsDB)) {
            const info = RegionsDB[id];
            if (!this.countries[info.cc]) continue;
            this.regions[id] = {
                id,
                name: info.name,
                owner: info.cc,
                originalOwner: info.cc,
                population: info.population,
                area: info.area,
                cx: info.cx,
                cy: info.cy,
                // визуальный центр — сюда ставятся значок войск и подпись
                lx: info.lx ?? info.cx,
                ly: info.ly ?? info.cy,
                loyalty: 1.0,
                development: { industry: 0, agro: 0, oil: 0 },
                army: this.emptyArmy(),
                resources: { oil: info.oil, agro: info.agro, industry: info.industry },
            };
            this.regionsByCountry[info.cc].push(id);
        }

        this.assignCapitals();
        this.distributeArmiesToBorders();
        this.fillStartingStocks();
        this.setStartingBudgets();
    }

    // Столица — область, где стоит столичный город; если такого нет — самая
    // населённая область страны.
    assignCapitals() {
        for (const city of CitiesDB) {
            if (!city.isCapital) continue;
            const country = this.countries[city.cc];
            if (country && !country.capital && this.regions[city.regionId]) country.capital = city.regionId;
        }
        for (const country of Object.values(this.countries)) {
            if (!country.capital) country.capital = this.mostPopulousRegion(country.id);
        }
    }

    mostPopulousRegion(countryId) {
        let best = null;
        for (const region of this.getCountryRegions(countryId)) {
            if (!best || region.population > best.population) best = region;
        }
        return best ? best.id : null;
    }

    setupScenario() {
        if (this.scenario === 'war2024' && this.countries.RU && this.countries.UA) {
            this.startWar('RU', 'UA', true);
        }
    }

    // Склады на старте — запас на несколько недель потребления.
    fillStartingStocks() {
        for (const country of Object.values(this.countries)) {
            Economy.initCountry(country);
            if (!this.regionsByCountry[country.id].length) continue;
            const f = Economy.flows(this, country.id);
            for (const key of Object.keys(RESOURCES)) country.stock[key] = Math.round(f[key].need * ECONOMY.STOCK_TARGET);
        }
    }

    // Стартовые налог и казна подбираются под армию и торговлю (импорт
    // тоже надо оплачивать), чтобы страна не оказывалась банкротом сразу.
    setStartingBudgets() {
        for (const country of Object.values(this.countries)) {
            const regions = this.getCountryRegions(country.id);
            if (!regions.length) continue;

            let population = 0, upkeep = 0;
            for (const region of regions) {
                population += region.population;
                upkeep += this.armyUpkeep(region.army);
            }
            if (population <= 0) continue;

            const trade = Economy.projectTrade(this, country.id);
            const tradeNet = trade.sales - trade.purchases;
            // Налог выше 10% со временем снижает лояльность, а с ней сбор —
            // поэтому ищем ставку, которая окупит армию и при сниженной лояльности.
            country.taxRate = 0.20;
            for (let pct = 5; pct <= 20; pct++) {
                const rate = pct / 100;
                if (population * rate * GameData.loyaltyAtTax(rate) + tradeNet >= upkeep * 1.02) { country.taxRate = rate; break; }
            }
            const income = population * country.taxRate + Math.max(0, tradeNet);
            country.money = Math.max(2000000, Math.round(income * 3));
        }
    }

    // Лояльность, к которой со временем придёт своя область при таком налоге.
    static loyaltyAtTax(rate, policy = 'balanced') {
        return Math.min(1, Math.max(0.2, 1 + POLICIES[policy].loyalty - Math.max(0, rate - 0.1) * 2));
    }

    // Бюджет через несколько ходов, когда лояльность придёт к своей цели:
    // честный прогноз для стартового экрана.
    steadyBalance(countryId) {
        const country = this.countries[countryId];
        const b = this.countryBalance(countryId);
        const loyalty = GameData.loyaltyAtTax(country.taxRate, country.policy);
        let now = 0, n = 0;
        for (const region of this.getCountryRegions(countryId)) { now += region.loyalty; n++; }
        now = n ? now / n : 1;
        const tax = b.tax * (loyalty / Math.max(now, 0.01));
        const sales = b.sales * ((0.5 + 0.5 * loyalty) / (0.5 + 0.5 * now));
        return { ...b, tax, sales, income: tax + sales, expense: b.expense };
    }

    // --- доступ ----------------------------------------------------------
    getCountry(id) { return this.countries[id]; }
    getRegion(id) { return this.regions[id]; }
    getNeighbors(id) { return NeighborsDB[id] || []; }

    getCountryRegions(countryId) {
        return (this.regionsByCountry[countryId] || []).map(id => this.regions[id]);
    }

    isCapital(regionId) {
        const region = this.regions[regionId];
        return !!region && this.countries[region.owner].capital === regionId;
    }

    // Области одной страны держим в индексе, поэтому при смене владельца
    // его нужно поправить — иначе все выборки «области страны» разъедутся.
    setOwner(regionId, newOwner) {
        const region = this.regions[regionId];
        const old = region.owner;
        if (old === newOwner) return;
        const list = this.regionsByCountry[old];
        const index = list.indexOf(regionId);
        if (index >= 0) list.splice(index, 1);
        this.regionsByCountry[newOwner].push(regionId);
        region.owner = newOwner;
        if (newOwner === this.playerCountry && region.originalOwner !== newOwner) this.campaign.conquest = true;
    }

    // --- армия и сила ----------------------------------------------------
    armyUpkeep(army) {
        let sum = 0;
        for (const unitId of Object.keys(UnitsDB)) sum += (army[unitId] || 0) * UnitsDB[unitId].maintenanceCost;
        return sum;
    }

    techMultiplier(countryId, unitId) {
        const country = this.countries[countryId];
        const level = country ? country.tech[unitId] || 1 : 1;
        return 1 + (level - 1) * RULES.TECH_STEP;
    }

    calculateRegionMilitaryPower(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return 0;
        let power = 0;
        for (const unitId of Object.keys(UnitsDB)) {
            const count = region.army[unitId] || 0;
            if (!count) continue;
            const unit = UnitsDB[unitId];
            power += count * (unit.baseAttack + unit.baseDefense) * this.techMultiplier(region.owner, unitId);
        }
        return Math.floor(power);
    }

    calculateMilitaryPower(countryId) {
        let total = 0;
        for (const region of this.getCountryRegions(countryId)) total += this.calculateRegionMilitaryPower(region.id);
        return total;
    }

    getCountryStats(countryId) {
        const stats = { population: 0, oil: 0, agro: 0, industry: 0, regions: 0, army: this.emptyArmy() };
        for (const region of this.getCountryRegions(countryId)) {
            stats.regions++;
            stats.population += region.population;
            stats.oil += region.resources.oil;
            stats.agro += region.resources.agro;
            stats.industry += region.resources.industry;
            for (const unitId of Object.keys(UnitsDB)) stats.army[unitId] += region.army[unitId] || 0;
        }
        return stats;
    }

    militia(region) {
        return Math.sqrt(region.population) / RULES.MILITIA_DIVISOR;
    }

    // --- отношения ---------------------------------------------------------
    pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

    isAtWar(a, b) { return a !== b && this.wars.has(this.pairKey(a, b)); }

    enemiesOf(countryId) {
        const result = [];
        for (const key of this.wars.keys()) {
            const [a, b] = key.split('|');
            if (a === countryId) result.push(b);
            else if (b === countryId) result.push(a);
        }
        return result;
    }

    truceLeft(a, b) {
        const until = this.truces.get(this.pairKey(a, b));
        return until && until > this.turn ? until - this.turn : 0;
    }

    // Страны, с которыми у страны есть общая граница (по областям).
    neighbourCountries(countryId) {
        const result = new Set();
        for (const region of this.getCountryRegions(countryId)) {
            for (const id of this.getNeighbors(region.id)) {
                const other = this.regions[id];
                if (other && other.owner !== countryId) result.add(other.owner);
            }
        }
        return [...result];
    }

    canDeclareWar(attacker, target) {
        const a = this.countries[attacker], t = this.countries[target];
        if (!a || !t || attacker === target) return { ok: false, reason: 'Нельзя' };
        if (!t.alive) return { ok: false, reason: 'Страна уже не существует' };
        if (!t.playable) return { ok: false, reason: 'Территория без собственного правительства' };
        if (this.isAtWar(attacker, target)) return { ok: false, reason: 'Война уже идёт' };
        const truce = this.truceLeft(attacker, target);
        if (truce) return { ok: false, reason: `Перемирие: ещё ${truce} ход.` };
        if (a.influence < RULES.WAR_COST) return { ok: false, reason: `Нужно ${RULES.WAR_COST} влияния` };
        return { ok: true };
    }

    declareWar(attacker, target) {
        const check = this.canDeclareWar(attacker, target);
        if (!check.ok) return check;
        this.countries[attacker].influence -= RULES.WAR_COST;
        this.startWar(attacker, target, false);
        return { ok: true };
    }

    startWar(attacker, target) {
        this.wars.set(this.pairKey(attacker, target), { start: this.turn, attacker });
        this.truces.delete(this.pairKey(attacker, target));
    }

    makePeace(a, b) {
        const key = this.pairKey(a, b);
        this.wars.delete(key);
        this.truces.set(key, this.turn + RULES.TRUCE_TURNS);
        // приказы на атаку между бывшими врагами теряют смысл
        for (let i = this.orders.attacks.length - 1; i >= 0; i--) {
            const o = this.orders.attacks[i], target = this.regions[o.to];
            if (target && ((o.country === a && target.owner === b) || (o.country === b && target.owner === a))) this.cancelOrder('attacks', i);
        }
    }

    warInfo(a, b) {
        const war = this.wars.get(this.pairKey(a, b));
        if (!war) return null;
        let taken = 0, lost = 0;
        for (const region of this.getCountryRegions(a)) if (region.originalOwner === b) taken++;
        for (const region of this.getCountryRegions(b)) if (region.originalOwner === a) lost++;
        return { ...war, turns: this.turn - war.start, taken, lost };
    }

    // --- возможные ходы -----------------------------------------------------
    isNeighborToPlayer(regionId) {
        for (const id of this.getNeighbors(regionId)) {
            const region = this.regions[id];
            if (region && region.owner === this.playerCountry) return true;
        }
        return false;
    }

    // Обход в ширину на глубину скорости марша — без перебора всего мира.
    getLandMoveTargets(startRegionId) {
        const start = this.getRegion(startRegionId);
        if (!start) return [];
        const country = this.getCountry(start.owner);
        const maxDist = country.tech.marchSpeed || 1;
        const visited = new Set([startRegionId]);
        const targets = [];
        let frontier = [startRegionId];

        for (let depth = 0; depth < maxDist && frontier.length; depth++) {
            const next = [];
            for (const id of frontier) {
                for (const nextId of this.getNeighbors(id)) {
                    if (visited.has(nextId)) continue;
                    const region = this.regions[nextId];
                    if (!region || region.owner !== country.id) continue;
                    visited.add(nextId);
                    targets.push(nextId);
                    next.push(nextId);
                }
            }
            frontier = next;
        }
        return targets;
    }

    getValidMoveTargets(startRegionId) {
        const region = this.regions[startRegionId];
        if (!region) return [];
        if (this.countries[region.owner].tech.marchSpeed >= 3) return this.getCountryRegions(region.owner).filter(r => r.id !== startRegionId).map(r => r.id);
        return this.getLandMoveTargets(startRegionId);
    }

    expeditionQuote(type, fromId, toId, forces) {
        const land = type === 'attacks' ? this.getNeighbors(fromId) : this.getLandMoveTargets(fromId);
        if (land.includes(toId)) return { cost: 0, influence: 0 };
        const total = Object.values(forces).reduce((sum, n) => sum + n, 0);
        return { cost: 500000 + total * 25000, influence: 5 };
    }

    // Атаковать можно только соседние области стран, с которыми идёт война.
    getValidAttackTargets(startRegionId) {
        const region = this.getRegion(startRegionId);
        if (!region) return [];
        const targets = [];
        const candidates = this.countries[region.owner].tech.marchSpeed >= 3 ? Object.keys(this.regions) : this.getNeighbors(startRegionId);
        for (const id of candidates) {
            const other = this.regions[id];
            if (other && other.owner !== region.owner && this.isAtWar(region.owner, other.owner)) targets.push(id);
        }
        return targets;
    }

    // Соседние области стран, с которыми войны нет — чтобы подсказать игроку.
    peacefulNeighbours(startRegionId) {
        const region = this.getRegion(startRegionId);
        if (!region) return [];
        const owners = new Set();
        for (const id of this.getNeighbors(startRegionId)) {
            const other = this.regions[id];
            if (other && other.owner !== region.owner && !this.isAtWar(region.owner, other.owner)) owners.add(other.owner);
        }
        return [...owners];
    }

    // Сколько войск в области ещё не расписано по приказам этого хода.
    getAvailableArmy(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return {};
        const available = { ...region.army };
        for (const type of ['movements', 'attacks']) {
            for (const order of this.orders[type]) {
                if (order.from !== regionId) continue;
                for (const unitId of Object.keys(order.forces)) {
                    if (available[unitId] !== undefined) available[unitId] -= order.forces[unitId];
                }
            }
        }
        return available;
    }

    // --- набор войск ----------------------------------------------------------
    // За ход область производит столько «очков индустрии», сколько у неё
    // индустрии с поправкой на лояльность; каждый род войск стоит свою долю.
    recruitCapacity(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return 0;
        return Math.max(2, Math.floor(region.resources.industry * region.loyalty));
    }

    recruitCapacityLeft(regionId) {
        let used = 0;
        for (const order of this.orders.recruitment) {
            if (order.regionId === regionId) used += UnitsDB[order.unitId].industryCost * order.amount;
        }
        return Math.max(0, this.recruitCapacity(regionId) - used);
    }

    queueRecruitment(regionId, unitId, amount, countryId = this.playerCountry) {
        const region = this.getRegion(regionId);
        const unit = UnitsDB[unitId];
        const country = this.countries[countryId];
        if (this.gameOver || !region || !unit || !country || region.owner !== countryId || !Number.isSafeInteger(amount) || amount <= 0) {
            return { ok: false, reason: 'Нельзя набрать здесь' };
        }
        if (unit.industryCost * amount > this.recruitCapacityLeft(regionId)) {
            return { ok: false, reason: 'Не хватает мощности индустрии области' };
        }
        const cost = unit.buildCost * amount;
        if (country.money < cost) return { ok: false, reason: 'Недостаточно средств' };

        country.money -= cost;
        if (countryId === this.playerCountry) this.campaign.recruited = true;
        this.orders.recruitment.push({
            country: countryId, regionId, unitId, amount, cost,
            text: `[Набор] ${region.name}: +${amount} ${unit.name}`,
        });
        return { ok: true };
    }

    // Роспуск: войска уходят сразу, содержание за них больше не платится.
    disband(regionId, forces, countryId = this.playerCountry) {
        const region = this.getRegion(regionId);
        if (this.gameOver || !this.validateForces(regionId, forces, countryId)) return 0;
        const available = this.getAvailableArmy(regionId);
        let removed = 0;
        for (const unitId of Object.keys(UnitsDB)) {
            const amount = Math.max(0, Math.min(forces[unitId] || 0, available[unitId] || 0));
            region.army[unitId] -= amount;
            removed += amount;
        }
        return removed;
    }

    // --- исследования -----------------------------------------------------------
    techCost(countryId, key) {
        const country = this.countries[countryId];
        const level = country.tech[key] || 1;
        if (key === 'marchSpeed') return level < 3 ? RULES.MARCH_COSTS[level] : null;
        return level < RULES.TECH_MAX ? RULES.TECH_COSTS[level] : null;
    }

    research(countryId, key) {
        if (this.gameOver) return { ok: false, reason: 'Кампания завершена' };
        const country = this.countries[countryId];
        if (!country || (key !== 'marchSpeed' && !Object.hasOwn(UnitsDB, key))) return { ok: false, reason: 'Неизвестное исследование' };
        const cost = this.techCost(countryId, key);
        if (cost === null) return { ok: false, reason: 'Максимальный уровень' };
        if (country.money < cost) return { ok: false, reason: 'Недостаточно средств' };
        country.money -= cost;
        country.tech[key] = (country.tech[key] || 1) + 1;
        return { ok: true };
    }

    // --- приказы ----------------------------------------------------------------
    describeForces(forces) {
        return Object.keys(forces)
            .filter(id => forces[id] > 0)
            .map(id => `${forces[id]} ${UnitsDB[id].name}`)
            .join(', ');
    }

    validateForces(regionId, forces, countryId) {
        const region = this.regions[regionId];
        if (!region || region.owner !== countryId || !forces || typeof forces !== 'object') return false;
        const available = this.getAvailableArmy(regionId);
        let total = 0;
        for (const [unit, count] of Object.entries(forces)) {
            if (!Object.hasOwn(UnitsDB, unit) || !Number.isSafeInteger(count) || count < 0 || count > available[unit]) return false;
            total += count;
        }
        return total > 0;
    }

    queueMovement(fromId, toId, forces, countryId = this.playerCountry) {
        return this.queueMilitaryOrder('movements', fromId, toId, forces, countryId);
    }

    queueAttack(fromId, toId, forces, countryId = this.playerCountry) {
        return this.queueMilitaryOrder('attacks', fromId, toId, forces, countryId);
    }

    queueMilitaryOrder(type, fromId, toId, forces, countryId) {
        if (this.gameOver || !this.validateForces(fromId, forces, countryId)) return { ok: false, reason: 'Недоступный состав войск' };
        const targets = type === 'attacks' ? this.getValidAttackTargets(fromId) : this.getValidMoveTargets(fromId);
        if (!targets.includes(toId)) return { ok: false, reason: 'Недоступная цель' };
        const from = this.regions[fromId], to = this.regions[toId], country = this.countries[countryId];
        const transport = this.expeditionQuote(type, fromId, toId, forces);
        if (country.money < transport.cost || country.influence < transport.influence) return { ok: false, reason: 'Не хватает денег или влияния на экспедицию' };
        country.money -= transport.cost;
        country.influence -= transport.influence;
        this.orders[type].push({
            transportCost: transport.cost, transportInfluence: transport.influence,
            country: countryId, from: fromId, to: toId, forces: { ...forces },
            text: `[${type === 'attacks' ? 'Атака' : 'Марш'}] ${from.name} ➔ ${to.name} (${this.describeForces(forces)})`,
        });
        return { ok: true };
    }

    queueRecon(targetId, cost, prob, regionName) {
        const target = this.regions[targetId];
        if (!target || target.owner === this.playerCountry || this.gameOver || cost !== RULES.SPY_COST || !Number.isFinite(prob) || prob < 0 || prob > 100) return false;
        if (this.orders.recon.some(o => o.target === targetId)) return false;
        const player = this.getCountry(this.playerCountry);
        if (!player || player.money < cost) return false;
        player.money -= cost;
        this.orders.recon.push({ country: this.playerCountry, target: targetId, cost, prob, regionName });
        return true;
    }

    cancelOrder(type, index) {
        const list = this.orders[type];
        if (!list || !Number.isInteger(index) || index < 0 || index >= list.length) return null;
        const [order] = list.splice(index, 1);
        const refund = (type === 'recon' || type === 'recruitment') ? order.cost : (order.transportCost || 0);
        if (order.transportInfluence) this.countries[order.country].influence = Math.min(RULES.INFLUENCE_MAX, this.countries[order.country].influence + order.transportInfluence);
        if (refund) this.countries[order.country].money += refund;
        return order;
    }

    // Приказы игрока — для панели плана хода. ИИ кладёт свои в те же очереди.
    playerOrders() {
        const own = o => o.country === this.playerCountry;
        const result = {};
        for (const type of Object.keys(this.orders)) {
            result[type] = this.orders[type]
                .map((order, index) => ({ order, index }))
                .filter(item => own(item.order));
        }
        return result;
    }

    // --- разрешение хода ------------------------------------------------------------
    processOrders() {
        const logs = [];
        const player = this.playerCountry;
        const mine = order => order.country === player;

        // 1. Разведка
        for (const order of this.orders.recon) {
            const region = this.getRegion(order.target);
            if (!region) continue;
            if (Math.random() * 100 <= order.prob) {
                const until = new Date(this.currentDate);
                until.setMonth(until.getMonth() + 1);
                region.reconActiveUntil = until;
                if (mine(order)) logs.push({ success: true, message: `🕵️ Разведка: шпионы внедрились в ${region.name}. Данные о гарнизоне получены.` });
            } else if (mine(order)) {
                logs.push({ success: false, message: `💥 Провал операции в ${region.name}. Шпионы перехвачены контрразведкой.` });
            }
        }

        // 2. Набор: деньги списаны при заказе, войска приходят сейчас
        for (const order of this.orders.recruitment) {
            const region = this.getRegion(order.regionId);
            if (!region) continue;
            if (region.owner !== order.country) {
                this.countries[order.country].money += order.cost;   // область потеряна — деньги возвращаются
                if (mine(order)) logs.push({ success: false, message: `Набор в ${region.name} сорван: область потеряна. Деньги возвращены.` });
                continue;
            }
            region.army[order.unitId] += order.amount;
            if (mine(order)) logs.push({ success: true, message: `В ${region.name} набрано: +${order.amount} ${UnitsDB[order.unitId].name}.` });
        }

        // 3. Перемещения
        for (const order of this.orders.movements) {
            const from = this.getRegion(order.from), to = this.getRegion(order.to);
            if (!from || !to || from.owner !== order.country || to.owner !== order.country) continue;
            for (const unitId of Object.keys(order.forces)) {
                const moved = Math.min(from.army[unitId] || 0, order.forces[unitId]);
                from.army[unitId] -= moved;
                to.army[unitId] += moved;
            }
            if (mine(order)) logs.push({ success: true, message: order.text + ' — выполнено.' });
        }

        // 4. Сражения: все атаки одной страны на одну область — одна битва
        const battles = new Map();
        for (const order of this.orders.attacks) {
            const key = `${order.country}>${order.to}`;
            if (!battles.has(key)) battles.set(key, []);
            battles.get(key).push(order);
        }
        const worldEvents = [];
        for (const orders of battles.values()) {
            const result = this.resolveBattle(orders);
            if (!result) continue;
            if (result.attacker === player || result.defender === player) logs.push(result);
            else worldEvents.push(result);
        }

        this.orders = this.emptyOrders();
        return { logs, worldBattles: worldEvents.length };
    }

    // Сила стороны в бою: база × техника × бонус против родов войск противника.
    sidePower(forces, countryId, role, enemyForces) {
        let enemyTotal = 0;
        for (const unitId of Object.keys(enemyForces)) enemyTotal += enemyForces[unitId] || 0;

        let power = 0;
        for (const unitId of Object.keys(UnitsDB)) {
            const count = forces[unitId] || 0;
            if (!count) continue;
            const unit = UnitsDB[unitId];
            let countered = 0;
            for (const other of unit.counters || []) countered += enemyForces[other] || 0;
            const share = enemyTotal > 0 ? countered / enemyTotal : 0;
            power += count * unit[role] * this.techMultiplier(countryId, unitId) * (1 + RULES.COUNTER_BONUS * share);
        }
        return power;
    }

    resolveBattle(orders) {
        const attacker = orders[0].country;
        const target = this.getRegion(orders[0].to);
        if (!target || target.owner === attacker) return null;
        const defender = target.owner;
        if (!this.isAtWar(attacker, defender)) return null;

        // собираем войска со всех участвующих областей
        const sources = [];
        const forces = this.emptyArmy();
        for (const order of orders) {
            const from = this.getRegion(order.from);
            if (!from || from.owner !== attacker) continue;
            const sent = {};
            for (const unitId of Object.keys(UnitsDB)) {
                const amount = Math.min(from.army[unitId] || 0, order.forces[unitId] || 0);
                sent[unitId] = amount;
                forces[unitId] += amount;
                from.army[unitId] -= amount;
            }
            sources.push({ region: from, sent });
        }
        if (!Object.values(forces).some(n => n > 0)) return null;

        const defForces = { ...target.army };
        const powerAtt = this.sidePower(forces, attacker, 'baseAttack', defForces);
        const isCapital = this.countries[defender].capital === target.id;
        const powerDef = this.defensePower(target, forces);

        // Потери зависят от соотношения сил: при равных силах наступающий
        // теряет больше обороняющегося, при подавляющем перевесе — наоборот.
        const ratio = powerAtt / powerDef;
        let success = ratio >= RULES.ATTACK_ADVANTAGE;
        let defLossPct = Math.min(0.6, Math.max(0.05, 0.15 * ratio));
        let attLossPct = Math.min(0.6, Math.max(0.05, 0.2 / ratio));
        if (this.cheatMode && attacker === this.playerCountry) {
            success = true; attLossPct = 0; defLossPct = 1;
        }

        const attLosses = this.emptyArmy(), defLosses = this.emptyArmy();
        for (const unitId of Object.keys(UnitsDB)) {
            const defAmount = target.army[unitId] || 0;
            defLosses[unitId] = Math.min(defAmount, Math.ceil(defAmount * defLossPct));
            target.army[unitId] -= defLosses[unitId];
        }
        // потери атакующего раскладываем по областям-источникам
        const survivorsBySource = sources.map(src => ({ region: src.region, left: { ...src.sent } }));
        for (const unitId of Object.keys(UnitsDB)) {
            const total = forces[unitId];
            if (!total) continue;
            // Round once per army, then distribute integer casualties. Splitting
            // a force into many orders must never change its total losses.
            const losses = Math.min(total, Math.ceil(total * attLossPct));
            attLosses[unitId] = losses;
            const shares = sources.map((src, i) => {
                const exact = losses * src.sent[unitId] / total;
                const whole = Math.floor(exact);
                survivorsBySource[i].left[unitId] -= whole;
                return { i, fraction: exact - whole, whole };
            }).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
            const remainder = losses - shares.reduce((sum, share) => sum + share.whole, 0);
            for (let i = 0; i < remainder; i++) survivorsBySource[shares[i].i].left[unitId]--;
        }

        const attackerName = this.countries[attacker].name;
        const defenderName = this.countries[defender].name;
        const extra = [];
        let message;

        if (success) {
            // уцелевшие защитники отходят в соседнюю свою область, если она есть
            const retreat = this.getNeighbors(target.id).map(id => this.regions[id]).find(r => r && r.owner === defender);
            const leftDefenders = Object.values(target.army).reduce((a, b) => a + b, 0);
            if (leftDefenders > 0) {
                if (retreat) {
                    for (const unitId of Object.keys(UnitsDB)) retreat.army[unitId] += target.army[unitId];
                    extra.push(`Уцелевшие защитники отошли в ${retreat.name}.`);
                } else {
                    for (const unitId of Object.keys(UnitsDB)) defLosses[unitId] += target.army[unitId];
                    extra.push('Защитники окружены и уничтожены.');
                }
            }
            target.army = this.emptyArmy();
            for (const s of survivorsBySource) {
                for (const unitId of Object.keys(UnitsDB)) target.army[unitId] += s.left[unitId];
            }
            this.setOwner(target.id, attacker);
            target.loyalty = 0.5;
            if (isCapital) extra.push(this.onCapitalLost(defender));
            message = `${attackerName}: ${target.name} захвачена!`;
        } else {
            for (const s of survivorsBySource) {
                for (const unitId of Object.keys(UnitsDB)) s.region.army[unitId] += s.left[unitId];
            }
            message = `${attackerName}: наступление на ${target.name} (${defenderName}) отбито.`;
        }

        return {
            success: attacker === this.playerCountry ? success : !success,
            message,
            detail: extra.filter(Boolean).join(' '),
            attacker, defender,
            playerIsAttacker: attacker === this.playerCountry,
            power: { attack: Math.round(powerAtt), defense: Math.round(powerDef), capital: isCapital },
            losses: { attacker: attLosses, defender: defLosses, initialAttacker: forces },
        };
    }

    // Оборона области против конкретного состава атакующих — та же формула
    // используется ИИ для оценки целей.
    defensePower(target, attackers) {
        let power = this.sidePower(target.army, target.owner, 'baseDefense', attackers) + this.militia(target) + 1;
        power *= RULES.DEFENSE_BONUS;
        if (this.countries[target.owner].capital === target.id) power *= 1 + RULES.CAPITAL_DEFENSE;
        power *= 0.7 + 0.3 * target.loyalty;
        return power;
    }

    onCapitalLost(countryId) {
        const country = this.countries[countryId];
        const next = this.mostPopulousRegion(countryId);
        country.capital = next;
        for (const region of this.getCountryRegions(countryId)) region.loyalty = Math.max(0.3, region.loyalty - 0.1);
        return next
            ? `Столица перенесена в ${this.regions[next].name}.`
            : '';
    }

    developmentCost(regionId, kind) {
        const region = this.regions[regionId], plan = DEVELOPMENT[kind];
        return region && plan ? Math.round(plan.cost * (1 + (region.development[kind] || 0) * 0.5)) : null;
    }

    invest(regionId, kind, countryId = this.playerCountry) {
        const region = this.regions[regionId], plan = DEVELOPMENT[kind], country = this.countries[countryId];
        if (this.gameOver || !region || !plan || region.owner !== countryId) return { ok: false, reason: 'Проект недоступен' };
        if (region.development[kind] >= 5) return { ok: false, reason: 'Достигнут 5-й уровень развития' };
        if (this.projects.some(p => p.regionId === regionId)) return { ok: false, reason: 'В области уже идёт строительство' };
        const cost = this.developmentCost(regionId, kind);
        if (country.money < cost) return { ok: false, reason: 'Недостаточно средств' };
        country.money -= cost;
        this.projects.push({ regionId, kind, country: countryId, cost, remaining: plan.turns });
        if (countryId === this.playerCountry) this.campaign.investment = true;
        return { ok: true };
    }

    cancelProject(regionId, countryId = this.playerCountry) {
        const index = this.projects.findIndex(p => p.regionId === regionId && p.country === countryId);
        if (index < 0) return false;
        const [project] = this.projects.splice(index, 1);
        // Construction spending is reserved until completion, like recruitment.
        this.countries[countryId].money += project.cost;
        return true;
    }

    processProjects() {
        const events = [], pending = [];
        for (const project of this.projects) {
            const region = this.regions[project.regionId];
            if (!region || region.owner !== project.country) {
                this.countries[project.country].money += project.cost;
                if (project.country === this.playerCountry) events.push({ message: 'Строительство сорвано потерей области. Средства возвращены.' });
                continue;
            }
            project.remaining--;
            if (project.remaining > 0) { pending.push(project); continue; }
            const plan = DEVELOPMENT[project.kind];
            region.resources[plan.resource] += plan.gain;
            region.development[project.kind]++;
            if (project.country === this.playerCountry) events.push({ message: `${region.name}: завершён проект «${plan.name}».` });
        }
        this.projects = pending;
        return events;
    }

    setPolicy(countryId, policy) {
        const c = this.countries[countryId];
        if (this.gameOver || !c || !Object.hasOwn(POLICIES, policy) || c.policy === policy) return { ok: false, reason: 'Курс уже выбран или недоступен' };
        if (this.turn - c.policyChangedAt < 3) return { ok: false, reason: 'Смена курса доступна раз в 3 хода' };
        if (c.influence < 5) return { ok: false, reason: 'Нужно 5 влияния' };
        c.influence -= 5;
        c.policy = policy;
        c.policyChangedAt = this.turn;
        return { ok: true };
    }

    integrateTerritory(regionId) {
        const region = this.regions[regionId], player = this.countries[this.playerCountry];
        if (this.gameOver || !region || region.owner === player.id || this.countries[region.owner].playable || !this.isNeighborToPlayer(regionId)) return { ok: false, reason: 'Нужна общая граница с территорией без правительства' };
        if (player.influence < 10 || player.money < 500000) return { ok: false, reason: 'Нужно $500K и 10 влияния' };
        const previous = region.owner;
        player.influence -= 10;
        player.money -= 500000;
        this.setOwner(regionId, player.id);
        region.loyalty = 0.5;
        if (this.countries[previous].capital === regionId) this.onCapitalLost(previous);
        return { ok: true };
    }

    campaignProgress() {
        const territories = Object.values(this.regions).filter(r => CountriesDB[r.originalOwner].playable);
        const controlled = territories.filter(r => r.owner === this.playerCountry).length;
        const share = territories.length ? controlled / territories.length : 0;
        const rank = share >= 1 ? 'Мировое господство' : share >= 0.5 ? 'Сверхдержава' : share >= 0.25 ? 'Мировая держава' : share >= 0.1 ? 'Региональный лидер' : 'Становление державы';
        return { controlled, total: territories.length, share, rank };
    }

    // --- экономика -------------------------------------------------------------------
    // Прогноз бюджета на ход: налоги, торговля по текущим ценам, армия,
    // социальные расходы. Фактическая торговля считается на рынке в конце хода.
    countryBalance(countryId) {
        const country = this.getCountry(countryId);
        let tax = 0, upkeep = 0, social = 0;
        if (!country || !this.regionsByCountry[countryId]?.length) {
            return { income: 0, expense: 0, tax, sales: 0, purchases: 0, upkeep, social, trade: { lines: {} } };
        }
        const policy = POLICIES[country.policy] || POLICIES.balanced;
        for (const region of this.getCountryRegions(countryId)) {
            tax += region.population * country.taxRate * region.loyalty;
            social += region.population * policy.socialCost;
            upkeep += this.armyUpkeep(region.army);
        }
        tax *= Economy.taxFactor(country);
        const trade = Economy.projectTrade(this, countryId);
        return {
            income: tax + trade.sales, expense: upkeep + social + trade.purchases,
            tax, sales: trade.sales, purchases: trade.purchases, upkeep, social, trade,
        };
    }

    setTrade(countryId, key, mode) {
        const c = this.countries[countryId];
        if (!c || !RESOURCES[key] || !TRADE_MODES[mode]) return false;
        Economy.initCountry(c);
        c.trade[key] = mode;
        return true;
    }

    // Итоги хода после боёв: деньги, лояльность, влияние, банкротство,
    // гибель стран. Возвращает события для отчёта игроку.
    applyEndOfTurn() {
        const events = this.processProjects();
        const balances = {};
        const markets = Economy.runMarkets(this);

        for (const country of Object.values(this.countries)) {
            if (!country.alive) continue;
            const economy = markets[country.id];
            if (economy) country.economy = economy;
            const balance = this.countryBalance(country.id);
            // вместо прогноза торговли — то, что реально продано и куплено
            const tradeMoney = economy ? economy.money : 0;
            balance.sales = Math.max(0, tradeMoney);
            balance.purchases = Math.max(0, -tradeMoney);
            balance.income = balance.tax + balance.sales;
            balance.expense = balance.upkeep + balance.social + balance.purchases;
            balances[country.id] = balance;
            country.lastNetIncome = Math.round(balance.income - balance.expense);
            country.money += country.lastNetIncome;
            if (economy) this.applyShortages(country, economy, events);
            country.influence = Math.min(RULES.INFLUENCE_MAX, country.influence + RULES.INFLUENCE_PER_TURN);

            if (country.money < 0) {
                this.applyDesertion(country.id);
                if (country.id === this.playerCountry) {
                    events.push({ type: 'bankrupt', message: '💸 Казна пуста: часть войск дезертировала, лояльность падает.' });
                }
            }
        }

        // Лояльность тянется к цели: захваченные земли, высокие налоги, голод
        // и нехватка товаров её снижают. Население растёт в сытости.
        for (const region of Object.values(this.regions)) {
            const country = this.countries[region.owner];
            const occupied = region.owner !== region.originalOwner;
            const target = Math.min(1, Math.max(0.2, (occupied ? 0.8 : 1) + POLICIES[country.policy].loyalty
                - Math.max(0, country.taxRate - 0.1) * 2 - Economy.loyaltyPenalty(country)));
            if (region.loyalty < target) region.loyalty = Math.min(target, region.loyalty + 0.05);
            else if (region.loyalty > target) region.loyalty = Math.max(target, region.loyalty - 0.03);
            const change = Economy.populationChange(country);
            if (change && region.population > 0) region.population = Math.max(1000, Math.round(region.population * (1 + change)));
        }

        // Гибель стран
        for (const country of Object.values(this.countries)) {
            if (!country.alive || this.regionsByCountry[country.id].length > 0) continue;
            country.alive = false;
            for (const enemy of this.enemiesOf(country.id)) this.wars.delete(this.pairKey(country.id, enemy));
            if (country.id === this.playerCountry) { this.gameOver = true; this.outcome = 'defeat'; }
            events.push({ type: 'eliminated', country: country.id, message: `🏳️ ${country.name} прекратила существование.` });
        }

        if (!this.gameOver && this.campaignProgress().share === 1) {
            this.gameOver = true;
            this.outcome = 'victory';
            events.push({ message: 'Все области суверенных стран под вашим управлением. Мировое господство достигнуто!' });
        }
        return { balances, events };
    }

    // Голод: армия разбегается, игроку — предупреждения о нехватке.
    applyShortages(country, economy, events) {
        const hunger = 1 - economy.sat.food;
        if (hunger > 0.1) {
            for (const region of this.getCountryRegions(country.id)) {
                for (const unitId of Object.keys(UnitsDB)) {
                    const n = region.army[unitId];
                    if (n > 0) region.army[unitId] -= Math.min(n, Math.ceil(n * hunger * ECONOMY.HUNGER_DESERTION));
                }
            }
        }
        if (country.id !== this.playerCountry) return;
        const pct = key => Math.round((1 - economy.sat[key]) * 100);
        if (pct('food') >= 5) events.push({ type: 'shortage', message: `🌾 Не хватает еды (${pct('food')}%): люди голодают, армия разбегается, население убывает.` });
        if (pct('energy') >= 5) events.push({ type: 'shortage', message: `⚡ Не хватает энергии (${pct('energy')}%): заводы выпускают меньше товаров.` });
        if (pct('goods') >= 5) events.push({ type: 'shortage', message: `📦 Не хватает товаров (${pct('goods')}%): налоги собираются хуже, растёт недовольство.` });
    }

    applyDesertion(countryId) {
        for (const region of this.getCountryRegions(countryId)) {
            for (const unitId of Object.keys(UnitsDB)) {
                const count = region.army[unitId];
                if (count > 0) region.army[unitId] -= Math.max(1, Math.floor(count * RULES.DESERTION));
            }
            region.loyalty = Math.max(0.3, region.loyalty - 0.05);
        }
    }

    saveTurnHistory(turnData) {
        this.history.unshift(turnData);
        if (this.history.length > 12) this.history.pop();
    }

    // --- стартовые армии ---------------------------------------------------------------
    distributeArmiesToBorders() {
        const RealWorldForces = {
            RU: { infantry: 132, tanks: 35, artillery: 60, aviation: 120, antiair: 40 },
            UA: { infantry: 90, tanks: 18, artillery: 30, aviation: 10, antiair: 15 },
            TR: { infantry: 42, tanks: 22, artillery: 20, aviation: 60, antiair: 15 },
            PL: { infantry: 20, tanks: 6, artillery: 6, aviation: 10, antiair: 5 },
            RO: { infantry: 7, tanks: 3, artillery: 4, aviation: 6, antiair: 3 },
            BY: { infantry: 6, tanks: 5, artillery: 6, aviation: 7, antiair: 4 },
            HU: { infantry: 4, tanks: 1, artillery: 1, aviation: 1, antiair: 1 },
            BG: { infantry: 3, tanks: 1, artillery: 1, aviation: 1, antiair: 1 },
            GE: { infantry: 3, tanks: 1, artillery: 1, aviation: 1, antiair: 1 },
            SK: { infantry: 2, tanks: 1, artillery: 1, aviation: 1, antiair: 1 },
            MD: { infantry: 1, tanks: 0, artillery: 1, aviation: 0, antiair: 0 },
            IT: { infantry: 10, tanks: 5, artillery: 1, aviation: 0, antiair: 0 },
            DE: { infantry: 18, tanks: 6, artillery: 5, aviation: 12, antiair: 6 },
            FR: { infantry: 20, tanks: 6, artillery: 5, aviation: 14, antiair: 6 },
            NO: { infantry: 5, tanks: 1, artillery: 1, aviation: 3, antiair: 2 },
            KZ: { infantry: 8, tanks: 3, artillery: 3, aviation: 3, antiair: 3 },
        };

        // Остальным странам — армия по населению: примерно полк на миллион
        // жителей плюс техника. Иначе Бразилия со 212 млн начинала бы
        // с одной пехотной частью.
        const byPopulation = countryId => {
            const millions = this.getCountryRegions(countryId).reduce((s, r) => s + r.population, 0) / 1e6;
            return {
                infantry: Math.max(1, Math.round(millions * 0.6)),
                tanks: Math.round(millions * 0.08),
                artillery: Math.round(millions * 0.08),
                aviation: Math.round(millions * 0.04),
                antiair: Math.round(millions * 0.05),
            };
        };

        for (const countryId of Object.keys(this.countries)) {
            if (!this.countries[countryId].playable) continue;   // Антарктида и т.п. без армии
            const forces = RealWorldForces[countryId] || byPopulation(countryId);
            const myRegions = this.getCountryRegions(countryId);
            if (!myRegions.length) continue;

            const borderRegions = myRegions.filter(region =>
                this.getNeighbors(region.id).some(id => {
                    const other = this.regions[id];
                    return other && other.owner !== countryId;
                }));

            const targets = borderRegions.length ? borderRegions : myRegions;
            const totalPop = targets.reduce((sum, r) => sum + r.population, 0);
            if (!totalPop) continue;

            for (const unitId of Object.keys(forces)) {
                const total = forces[unitId];
                if (!total) continue;
                let allocated = 0;
                const remainders = [];
                for (const region of targets) {
                    const exact = total * (region.population / totalPop);
                    const whole = Math.floor(exact);
                    region.army[unitId] += whole;
                    allocated += whole;
                    remainders.push({ region, fraction: exact - whole });
                }
                remainders.sort((a, b) => b.fraction - a.fraction);
                for (let i = 0; i < total - allocated && i < remainders.length; i++) {
                    remainders[i].region.army[unitId] += 1;
                }
            }
        }
    }

    // --- сохранение -----------------------------------------------------------------------
    // Армии храним массивом в порядке UnitsDB — компактнее и не зависит от
    // порядка ключей.
    serialize() {
        const units = Object.keys(UnitsDB);
        const regions = {};
        for (const region of Object.values(this.regions)) {
            regions[region.id] = [
                region.owner,
                units.map(u => region.army[u]),
                Math.round(region.loyalty * 100) / 100,
                region.reconActiveUntil ? +new Date(region.reconActiveUntil) : 0,
                { ...region.resources }, { ...region.development },
                region.population,
            ];
        }
        const countries = {};
        for (const c of Object.values(this.countries)) {
            const stock = {}, sat = {};
            for (const key of Object.keys(RESOURCES)) {
                stock[key] = Math.round(((c.stock && c.stock[key]) || 0) * 10) / 10;
                sat[key] = c.economy ? Math.round(c.economy.sat[key] * 1000) / 1000 : 1;
            }
            countries[c.id] = [Math.round(c.money), c.taxRate, c.influence, c.tech, c.lastNetIncome, c.alive, c.capital, c.policy, c.policyChangedAt,
                stock, { ...(c.trade || { food: 'sell', energy: 'sell', goods: 'sell' }) }, sat];
        }
        return {
            v: 3,
            units,
            projects: this.projects,
            campaign: this.campaign,
            outcome: this.outcome,
            player: this.playerCountry,
            cheat: this.cheatMode,
            scenario: this.scenario,
            difficulty: this.difficulty,
            market: { ...this.market },
            date: +this.currentDate,
            turn: this.turn,
            regions, countries,
            wars: [...this.wars],
            truces: [...this.truces],
            orders: this.orders,
            decisions: this.decisions,
            history: this.history,
            gameOver: this.gameOver,
        };
    }

    static validateSave(save) {
        const fail = () => { throw new Error('Сохранение несовместимо или повреждено'); };
        const finite = n => typeof n === 'number' && Number.isFinite(n);
        const count = n => Number.isSafeInteger(n) && n >= 0;
        if (!save || save.v !== 3 || !CountriesDB[save.player]?.playable || !count(save.turn) || !finite(save.date) || !Number.isFinite(+new Date(save.date))) fail();
        if (JSON.stringify(save.units) !== JSON.stringify(Object.keys(UnitsDB))) fail();
        if (save.difficulty !== undefined && !DIFFICULTY[save.difficulty]) fail();
        if (save.market !== undefined && !GameData.validMarket(save.market)) fail();
        if (!save.regions || !save.countries || !save.campaign || !Array.isArray(save.projects)) fail();
        if (Object.keys(save.regions).length !== Object.keys(RegionsDB).length || Object.keys(save.countries).length !== Object.keys(CountriesDB).length) fail();
        for (const id of Object.keys(RegionsDB)) {
            const r = save.regions[id];
            if (!Array.isArray(r) || !CountriesDB[r[0]] || !Array.isArray(r[1]) || r[1].length !== save.units.length || !r[1].every(count) || !finite(r[2]) || r[2] < 0 || r[2] > 1 || !finite(r[3])) fail();
            for (const key of ['industry', 'agro', 'oil']) if (!count(r[4]?.[key]) || !count(r[5]?.[key]) || r[5][key] > 5) fail();
            if (r[6] !== undefined && !count(r[6])) fail();
        }
        for (const id of Object.keys(CountriesDB)) {
            const c = save.countries[id];
            if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1]) || c[1] < 0.01 || c[1] > 0.3 || !finite(c[2]) || c[2] < 0 || c[2] > 100 || !finite(c[4]) || typeof c[5] !== 'boolean' || (c[6] !== null && (!RegionsDB[c[6]] || save.regions[c[6]][0] !== id)) || !POLICIES[c[7]] || !Number.isInteger(c[8])) fail();
            for (const key of [...save.units, 'marchSpeed']) if (!count(c[3]?.[key]) || c[3][key] < 1 || c[3][key] > (key === 'marchSpeed' ? 3 : RULES.TECH_MAX)) fail();
            if (c[9] !== undefined && !GameData.validEconomy(c[9], c[10], c[11])) fail();
        }
        const pair = key => typeof key === 'string' && key.split('|').length === 2 && key.split('|').every(cc => CountriesDB[cc]);
        if (!Array.isArray(save.wars) || save.wars.some(x => !Array.isArray(x) || !pair(x[0]) || !count(x[1]?.start) || !CountriesDB[x[1]?.attacker])) fail();
        if (!Array.isArray(save.truces) || save.truces.some(x => !Array.isArray(x) || !pair(x[0]) || !count(x[1]))) fail();
        if (!Array.isArray(save.decisions) || save.decisions.some(x => x.type !== 'peace' || !CountriesDB[x.from])) fail();
        if (!Array.isArray(save.history) || save.history.some(t => typeof t.date !== 'string' || !Array.isArray(t.logs) || !t.financial || !['income','expense','net'].every(k => finite(t.financial[k])))) fail();
        if (save.projects.some(p => !RegionsDB[p.regionId] || !CountriesDB[p.country] || !DEVELOPMENT[p.kind] || !count(p.remaining) || p.remaining < 1 || !count(p.cost))) fail();
        if (!save.orders || !['recruitment','recon','movements','attacks'].every(k => Array.isArray(save.orders[k]))) fail();
        for (const [type, list] of Object.entries(save.orders)) {
            if (!['recruitment','recon','movements','attacks'].includes(type)) fail();
            for (const o of list) {
                if (!CountriesDB[o.country]) fail();
                if (type === 'recruitment' && (!RegionsDB[o.regionId] || !UnitsDB[o.unitId] || !count(o.amount) || o.amount < 1 || o.cost !== o.amount * UnitsDB[o.unitId].buildCost)) fail();
                if (type === 'recon' && (!RegionsDB[o.target] || o.cost !== RULES.SPY_COST || !finite(o.prob) || o.prob < 0 || o.prob > 100)) fail();
                if (type === 'movements' || type === 'attacks') {
                    if (!count(o.transportCost || 0) || !count(o.transportInfluence || 0) || !RegionsDB[o.from] || !RegionsDB[o.to] || !o.forces || Object.entries(o.forces).some(([u, n]) => !UnitsDB[u] || !count(n))) fail();
                }
            }
        }
    }

    // Склад, торговые настройки и обеспеченность страны (поля появились с экономикой).
    static validEconomy(stock, trade, sat) {
        const keys = Object.keys(RESOURCES);
        const finite = n => typeof n === 'number' && Number.isFinite(n);
        return !!stock && !!trade && !!sat
            && keys.every(k => finite(stock[k]) && stock[k] >= 0 && Object.hasOwn(TRADE_MODES, trade[k]) && finite(sat[k]) && sat[k] >= 0 && sat[k] <= 1);
    }

    static validMarket(market) {
        return !!market && Object.keys(RESOURCES).every(k => typeof market[k] === 'number' && Number.isFinite(market[k]) && market[k] > 0);
    }

    static restore(save) {
        GameData.validateSave(save);
        const data = new GameData(save.player, { cheat: save.cheat, scenario: save.scenario, difficulty: save.difficulty, restoring: true });
        const units = Object.keys(UnitsDB);

        // сначала вернём всех владельцев, потом пересоберём индекс областей
        for (const id of Object.keys(data.regionsByCountry)) data.regionsByCountry[id] = [];
        for (const region of Object.values(data.regions)) {
            const saved = save.regions[region.id];
            if (saved) {
                region.owner = saved[0];
                units.forEach((u, i) => { region.army[u] = saved[1][i] || 0; });
                region.loyalty = saved[2];
                region.resources = { ...saved[4] };
                region.development = { ...saved[5] };
                region.reconActiveUntil = saved[3] ? new Date(saved[3]) : undefined;
                if (saved[6] !== undefined) region.population = saved[6];
            }
            data.regionsByCountry[region.owner].push(region.id);
        }
        for (const c of Object.values(data.countries)) {
            const saved = save.countries[c.id];
            if (!saved) continue;
            [c.money, c.taxRate, c.influence, c.tech, c.lastNetIncome, c.alive, c.capital, c.policy, c.policyChangedAt] = saved;
            if (saved[9]) {
                c.stock = { ...saved[9] };
                c.trade = { ...saved[10] };
                c.economy = { money: 0, sat: { ...saved[11] }, res: {} };
            }
        }
        data.currentDate = new Date(save.date);
        data.turn = save.turn;
        data.wars = new Map(save.wars);
        data.truces = new Map(save.truces);
        data.orders = save.orders || data.emptyOrders();
        data.decisions = save.decisions || [];
        data.history = save.history || [];
        data.gameOver = !!save.gameOver;
        data.outcome = save.outcome;
        data.projects = structuredClone(save.projects);
        data.campaign = { ...save.campaign };
        if (save.market) data.market = { ...save.market };
        return data;
    }

    // Перенос партии из прошлой версии игры или со слегка другой нарезкой
    // карты. Берём свежий мир как основу и переносим поверх него всё, что
    // в старой партии выглядит правдоподобно; сомнительное — отбрасываем.
    // Если совпало меньше 90% областей, партия относится к другой карте.
    static migrateSave(old) {
        const fail = why => { throw new Error(why); };
        if (!old || typeof old !== 'object') fail('Пустое сохранение');
        if (!CountriesDB[old.player]?.playable) fail('Неизвестная страна игрока');
        const finite = n => typeof n === 'number' && Number.isFinite(n);
        const count = n => Number.isSafeInteger(n) && n >= 0;
        const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
        const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);

        const fresh = new GameData(old.player, {
            cheat: !!old.cheat,
            scenario: old.scenario === 'war2024' ? 'war2024' : 'peace',
            difficulty: old.difficulty,
            restoring: true,
        });
        const save = fresh.serialize();
        const units = save.units;
        const oldUnits = Array.isArray(old.units) ? old.units : units;

        const oldRegions = isObj(old.regions) ? old.regions : {};
        const ids = Object.keys(save.regions);
        const matched = ids.filter(id => Array.isArray(oldRegions[id])).length;
        if (matched < ids.length * 0.9) fail('Карта слишком сильно изменилась');

        for (const id of ids) {
            const o = oldRegions[id], r = save.regions[id];
            if (!Array.isArray(o)) continue;
            if (CountriesDB[o[0]]) r[0] = o[0];
            if (Array.isArray(o[1])) r[1] = units.map(u => { const i = oldUnits.indexOf(u); return i >= 0 && count(o[1][i]) ? o[1][i] : 0; });
            if (finite(o[2])) r[2] = clamp(o[2], 0, 1);
            if (finite(o[3])) r[3] = o[3];
            for (const key of ['industry', 'agro', 'oil']) {
                if (isObj(o[4]) && count(o[4][key])) r[4][key] = o[4][key];
                if (isObj(o[5]) && count(o[5][key])) r[5][key] = Math.min(5, o[5][key]);
            }
            if (count(o[6]) && o[6] > 0) r[6] = o[6];
        }

        const owned = {};
        for (const [id, r] of Object.entries(save.regions)) (owned[r[0]] = owned[r[0]] || []).push(id);
        const oldCountries = isObj(old.countries) ? old.countries : {};
        for (const [id, c] of Object.entries(save.countries)) {
            const o = oldCountries[id];
            if (Array.isArray(o)) {
                if (finite(o[0])) c[0] = Math.round(o[0]);
                if (finite(o[1])) c[1] = clamp(o[1], 0.01, 0.3);
                if (finite(o[2])) c[2] = clamp(Math.round(o[2]), 0, RULES.INFLUENCE_MAX);
                if (isObj(o[3])) for (const key of [...units, 'marchSpeed']) {
                    if (count(o[3][key])) c[3][key] = clamp(o[3][key], 1, key === 'marchSpeed' ? 3 : RULES.TECH_MAX);
                }
                if (finite(o[4])) c[4] = Math.round(o[4]);
                if (RegionsDB[o[6]]) c[6] = o[6];
                if (POLICIES[o[7]]) c[7] = o[7];
                if (Number.isInteger(o[8])) c[8] = o[8];
                if (GameData.validEconomy(o[9], o[10], o[11])) { c[9] = { ...o[9] }; c[10] = { ...o[10] }; c[11] = { ...o[11] }; }
            }
            // столица — только своя область, иначе самая населённая из своих
            const mine = owned[id] || [];
            if (!c[6] || save.regions[c[6]][0] !== id) {
                c[6] = mine.length ? mine.reduce((a, b) => (RegionsDB[b].population > RegionsDB[a].population ? b : a)) : null;
            }
            c[5] = mine.length > 0;
        }

        const pair = key => typeof key === 'string' && key.split('|').length === 2 && key.split('|').every(cc => CountriesDB[cc]);
        if (count(old.turn)) save.turn = old.turn;
        if (finite(old.date) && Number.isFinite(+new Date(old.date))) save.date = old.date;
        if (Array.isArray(old.wars)) save.wars = old.wars.filter(x => Array.isArray(x) && pair(x[0]) && count(x[1]?.start) && CountriesDB[x[1]?.attacker]);
        if (Array.isArray(old.truces)) save.truces = old.truces.filter(x => Array.isArray(x) && pair(x[0]) && count(x[1]));
        if (Array.isArray(old.decisions)) save.decisions = old.decisions.filter(x => x && x.type === 'peace' && CountriesDB[x.from]);
        if (Array.isArray(old.history)) save.history = old.history.filter(t => t && typeof t.date === 'string' && Array.isArray(t.logs) && t.financial && ['income', 'expense', 'net'].every(k => finite(t.financial[k])));
        if (Array.isArray(old.projects)) save.projects = old.projects.filter(p => p && RegionsDB[p.regionId] && CountriesDB[p.country] && DEVELOPMENT[p.kind] && count(p.remaining) && p.remaining >= 1 && count(p.cost));
        if (isObj(old.campaign)) for (const key of Object.keys(save.campaign)) save.campaign[key] = !!old.campaign[key];
        save.gameOver = !!old.gameOver;
        save.outcome = ['victory', 'defeat'].includes(old.outcome) ? old.outcome : null;
        if (isObj(old.orders)) save.orders = old.orders;
        if (GameData.validMarket(old.market)) save.market = { ...old.market };

        try {
            GameData.validateSave(save);
        } catch (e) {
            // Приказы — самая хрупкая часть: при сомнении начинаем ход с чистого листа.
            save.orders = fresh.emptyOrders();
            GameData.validateSave(save);
        }
        return save;
    }
}
