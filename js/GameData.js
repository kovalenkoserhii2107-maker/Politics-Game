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
    INFLUENCE_PER_TURN: 2,
    INFLUENCE_MAX: 100,
    WAR_COST: 20,               // влияние на объявление войны
    PEACE_COST: 10,             // влияние на мирное предложение
    TRUCE_TURNS: 10,            // после мира нельзя снова объявить войну
    SPY_COST: 50000,
    MILITIA_DIVISOR: 250,       // ополчение: sqrt(население) / это число
    DESERTION: 0.1,             // доля войск, уходящих при пустой казне
    JOINT_ATTACK_BONUS: 0.15,   // союзники, ударившие по одной области в один ход
    OPERATION_BONUS: 0.1,       // удар по цели заранее объявленной совместной операции
    FLANK_BONUS: 0.1,           // за каждое направление удара сверх первого
    FLANK_MAX: 0.2,             // потолок: с трёх направлений и больше
};

// Проекты увеличивают ресурс области; что это даёт в еде, энергии и
// товарах, считает Economy. Цены подобраны под окупаемость ~8 ходов.
const DEVELOPMENT = {
    industry: { name: 'Промышленный район', cost: 600000, turns: 2, resource: 'industry', gain: 20, yields: 'goods' },
    agro: { name: 'Агрокомплекс', cost: 360000, turns: 2, resource: 'agro', gain: 15, yields: 'food' },
    oil: { name: 'Энергетический комплекс', cost: 750000, turns: 3, resource: 'oil', gain: 2, yields: 'energy' },
    infra: { name: 'Инфраструктура', cost: 500000, turns: 2, resource: null, gain: 0, yields: null },
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

        Diplomacy.init(this);
        Missions.init(this);
        Unrest.init(this);
        this.operations = [];       // совместные операции союзников: { by, target, turn }
        this.garrisons = {};        // войска в помощь союзнику: область → страна → войска
        Council.init(this);
        this.diploEvents = [];      // что случилось в дипломатии между отчётами хода
        // Страны под управлением людей. В одиночной игре — только игрок; в
        // сетевой — все участники. Задания, решения и журнал каждого, кроме
        // того, чьими глазами сейчас смотрит модель, лежат в seats.
        this.humans = [playerCountryId, ...(options.humans || []).filter(cc => cc !== playerCountryId)];
        // цель партии: совместная — только когда людей больше одного
        const goal = GOALS[options.goal] ? options.goal : 'domination';
        this.goal = GOALS[goal].multiplayer && this.humans.length < 2 ? 'domination' : goal;
        // «горячий стул»: люди ходят по очереди на одном устройстве; done —
        // кто уже закончил этот ход
        this.hotseat = options.hotseat && this.humans.length > 1 ? { done: [] } : null;
        this.seats = {};
        for (const cc of this.humans.slice(1)) this.seats[cc] = GameData.emptySeat();
        this.build();
        if (!options.restoring) {
            this.setupScenario();
            for (const cc of this.humans) {
                const human = this.countries[cc];
                if (human) human.money = Math.round(human.money * DIFFICULTY[this.difficulty].playerMoney);
                if (human && human.playable) this.withPlayer(cc, () => Missions.refill(this));
            }
            Score.init(this);
            Score.initChronicle(this);
        }
    }

    // --- люди за столом ---------------------------------------------------
    static emptySeat() {
        return { missions: [], stats: {}, decisions: [], history: [],
            campaign: { budget: false, investment: false, recruited: false, diplomacy: false, conquest: false } };
    }

    isHuman(cc) { return this.humans.includes(cc); }
    get multiplayer() { return this.humans.length > 1; }

    // Личное состояние игрока cc: его задания, счётчики, решения, журнал.
    seatOf(cc) {
        if (cc === this.playerCountry) return this;
        return this.seats[cc] || null;
    }

    // Смотреть на мир глазами другого игрока: его задания, решения и журнал
    // становятся «текущими», а свои откладываются в seats.
    becomePlayer(cc) {
        if (cc === this.playerCountry || !this.seats[cc]) return;
        const mine = {};
        for (const key of GameData.SEAT_FIELDS) mine[key] = this[key];
        this.seats[this.playerCountry] = mine;
        const seat = this.seats[cc];
        delete this.seats[cc];
        for (const key of GameData.SEAT_FIELDS) this[key] = seat[key];
        this.playerCountry = cc;
    }

    withPlayer(cc, fn) {
        const previous = this.playerCountry;
        if (cc === previous) return fn();
        this.becomePlayer(cc);
        try { return fn(); } finally { this.becomePlayer(previous); }
    }

    // Всё, что игрок меняет в мире, идёт через act: в сетевой игре гость
    // записывает свои команды, а сервер повторяет их у себя от его имени.
    act(name, ...args) {
        if (!Object.hasOwn(GameData.COMMANDS, name)) throw new Error(`Неизвестная команда ${name}`);
        const result = this[name](...args);
        if (this.recorder) this.recorder.push({ name, args: structuredClone(args) });
        return result;
    }

    // Повтор чужих команд на сервере. Команду, где указана чужая страна,
    // пропускаем: гость распоряжается только своей.
    replay(cc, commands) {
        let failed = 0;
        this.withPlayer(cc, () => {
            for (const command of Array.isArray(commands) ? commands : []) {
                const slot = GameData.COMMANDS[command && command.name];
                const args = Array.isArray(command && command.args) ? command.args : null;
                if (slot === undefined || !args) { failed++; continue; }
                if (slot >= 0 && args[slot] !== undefined && args[slot] !== cc) { failed++; continue; }
                try {
                    const result = this[command.name](...args);
                    if (result === false || result === null || (result && result.ok === false)) failed++;
                } catch (e) { failed++; }
            }
        });
        return failed;
    }

    // k-й по счёту свой приказ данного вида — номер не зависит от чужих приказов.
    cancelOwnOrder(type, k) {
        const list = this.orders[type];
        if (!list || !Number.isInteger(k)) return null;
        let seen = -1;
        const index = list.findIndex(o => o.country === this.playerCountry && ++seen === k);
        return index < 0 ? null : this.cancelOrder(type, index);
    }

    claimMission(kind) {
        const index = this.missions.findIndex(m => m.kind === kind);
        return index < 0 ? null : Missions.claim(this, index);
    }

    skipMission(kind) {
        const index = this.missions.findIndex(m => m.kind === kind);
        return index < 0 ? false : Missions.skip(this, index);
    }

    bumpStat(cc, stat, amount = 1) {
        const seat = this.seatOf(cc);
        if (!seat) return;
        seat.stats = seat.stats || {};
        seat.stats[stat] = Math.max(0, (seat.stats[stat] || 0) + amount);
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
                tech: this.baseTech(),      // ступени модернизации родов войск и скорость марша
                techs: [],                  // изученные технологии дерева (js/Tech.js)
                research: null,             // идущее исследование: { id, remaining }
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
                loyalty: 1.0, unrest: 0,
                development: { industry: 0, agro: 0, oil: 0, infra: 0 },
                army: this.emptyArmy(),
                resources: { oil: info.oil, agro: info.agro, industry: info.industry },
            };
            this.regionsByCountry[info.cc].push(id);
        }

        this.assignCapitals();
        Nuclear.init(this);         // арсеналы — до расчёта стартовых бюджетов
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
    // Сколько лояльности отнимает налог: до 10% — ничего, дальше — всё сильнее;
    // выше 20% народ терпит плохо, при 30% дело идёт к восстаниям.
    static taxPenalty(rate) {
        return Math.max(0, rate - 0.1) * 2 + Math.max(0, rate - 0.2) * 3;
    }

    static loyaltyAtTax(rate, policy = 'balanced') {
        return Math.min(1, Math.max(0.2, 1 + POLICIES[policy].loyalty - GameData.taxPenalty(rate)));
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
        if (this.isHuman(newOwner) && region.originalOwner !== newOwner) this.seatOf(newOwner).campaign.conquest = true;
        if (this.countries[old] && this.isAtWar(newOwner, old)) {
            Diplomacy.onConquest(this, newOwner, old);
            if (this.isHuman(newOwner)) this.bumpStat(newOwner, 'conquered');
        }
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
        return 1 + (level - 1) * MODERNIZATION.STEP;
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
        for (const g of this.garrisonsOf(countryId)) total += this.armyPower(g.army, countryId);
        return total;
    }

    armyPower(army, countryId) {
        let power = 0;
        for (const unitId of Object.keys(UnitsDB)) {
            const count = army[unitId] || 0;
            if (count) power += count * (UnitsDB[unitId].baseAttack + UnitsDB[unitId].baseDefense) * this.techMultiplier(countryId, unitId);
        }
        return Math.floor(power);
    }

    // --- войска в помощь союзнику ---------------------------------------------
    // Остаются войсками своей страны: она за них платит, они в её силе,
    // вернуть их можно в любой момент. В области союзника обороняются
    // вместе с хозяином.
    garrisonsIn(regionId) {
        return Object.entries((this.garrisons || {})[regionId] || {}).map(([cc, army]) => ({ cc, army, region: regionId }));
    }

    garrisonsOf(countryId) {
        const out = [];
        for (const [regionId, byCountry] of Object.entries(this.garrisons || {})) {
            if (byCountry[countryId]) out.push({ cc: countryId, army: byCountry[countryId], region: regionId });
        }
        return out;
    }

    sendGarrison(fromId, toId, forces, countryId = this.playerCountry) {
        if (this.gameOver || !this.validateForces(fromId, forces, countryId)) return { ok: false, reason: 'Недоступный состав войск' };
        if (!this.allyTargets(fromId, countryId).includes(toId)) return { ok: false, reason: 'Отправить можно только в соседнюю область союзника' };
        const from = this.regions[fromId], to = this.regions[toId];
        const byCountry = this.garrisons[toId] || (this.garrisons[toId] = {});
        const army = byCountry[countryId] || (byCountry[countryId] = this.emptyArmy());
        for (const [unitId, n] of Object.entries(forces)) { from.army[unitId] -= n; army[unitId] += n; }
        if (this.isHuman(to.owner)) this.diploEvents.push({ type: 'troops', for: to.owner, message: `🛡️ ${this.countries[countryId].name} прислала войска вам в помощь в ${to.name}: ${this.describeForces(forces)}. Они обороняют область вместе с вашими.` });
        return { ok: true, text: this.describeForces(forces) };
    }

    // Куда вернуть контингент: соседняя своя область, иначе столица, иначе любая своя.
    garrisonHome(regionId, countryId) {
        const near = this.getNeighbors(regionId).map(id => this.regions[id]).find(r => r && r.owner === countryId);
        if (near) return near;
        const capital = this.regions[this.countries[countryId].capital];
        if (capital && capital.owner === countryId) return capital;
        return this.getCountryRegions(countryId)[0] || null;
    }

    recallGarrison(regionId, countryId = this.playerCountry) {
        const army = (this.garrisons[regionId] || {})[countryId];
        if (this.gameOver || !army) return { ok: false, reason: 'Здесь нет ваших войск' };
        const home = this.garrisonHome(regionId, countryId);
        delete this.garrisons[regionId][countryId];
        if (!Object.keys(this.garrisons[regionId]).length) delete this.garrisons[regionId];
        if (!home) return { ok: true, to: null };
        for (const unitId of Object.keys(UnitsDB)) home.army[unitId] += army[unitId] || 0;
        return { ok: true, to: home.id };
    }

    // Конец хода: союз распался, область отошла не союзнику, страна пала —
    // войска возвращаются домой.
    checkGarrisons(events) {
        for (const [regionId, byCountry] of Object.entries(this.garrisons || {})) {
            const region = this.regions[regionId];
            for (const cc of Object.keys(byCountry)) {
                const c = this.countries[cc];
                if (!c || !c.alive || !this.regionsByCountry[cc].length) { delete byCountry[cc]; continue; }
                if (region.owner !== cc && Diplomacy.isAllied(this, cc, region.owner)) continue;
                if (region.owner === cc) {
                    // область теперь наша — контингент становится её гарнизоном
                    for (const unitId of Object.keys(UnitsDB)) region.army[unitId] += byCountry[cc][unitId] || 0;
                    delete byCountry[cc];
                    continue;
                }
                const result = this.recallGarrison(regionId, cc);
                if (this.isHuman(cc)) events.push({ type: 'troops', for: cc, message: `🛡️ Ваши войска из ${region.name} вернулись домой${result.to ? ` в ${this.regions[result.to].name}` : ''}: союза с хозяином области больше нет.` });
            }
            if (this.garrisons[regionId] && !Object.keys(this.garrisons[regionId]).length) delete this.garrisons[regionId];
        }
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
        const pact = Diplomacy.pactLeft(this, attacker, target);
        if (pact) return { ok: false, reason: `Пакт о ненападении: ещё ${pact} ход. Сначала разорвите пакт` };
        if (Diplomacy.isAllied(this, attacker, target)) return { ok: false, reason: 'Это ваш союзник — сначала разорвите союз' };
        if (a.influence < RULES.WAR_COST) return { ok: false, reason: `Нужно ${RULES.WAR_COST} влияния` };
        return { ok: true };
    }

    declareWar(attacker, target) {
        const check = this.canDeclareWar(attacker, target);
        if (!check.ok) return check;
        this.countries[attacker].influence -= RULES.WAR_COST;
        const joined = this.startWar(attacker, target, false);
        return { ok: true, joined };
    }

    startWar(attacker, target) {
        this.wars.set(this.pairKey(attacker, target), { start: this.turn, attacker });
        this.truces.delete(this.pairKey(attacker, target));
        const joined = Diplomacy.onWar(this, attacker, target);
        const name = cc => this.countries[cc].name;
        for (const ally of joined) {
            if (this.isHuman(ally)) this.diploEvents.push({ type: 'alliance', for: ally, message: `🛡️ ${name(attacker)} напала на вашего союзника ${name(target)} — по договору вы вступили в войну.` });
            if (this.isHuman(target)) this.diploEvents.push({ type: 'alliance', for: target, message: `🛡️ Союзник ${name(ally)} вступил в войну на вашей стороне против ${name(attacker)}.` });
            if (this.isHuman(attacker)) this.diploEvents.push({ type: 'alliance', for: attacker, message: `🛡️ ${name(ally)}, союзник ${name(target)}, объявил вам войну.` });
        }
        if (this.isHuman(target) && this.isHuman(attacker)) this.diploEvents.push({ type: 'war', for: target, message: `⚔️ ${name(attacker)} объявила вам войну!` });
        return joined;
    }

    // Дипломатия игрока из карточки страны и окна «Дипломатия».
    diplomacyAction(target, action) {
        const p = this.playerCountry;
        if (this.gameOver || !this.countries[target] || target === p) return { ok: false, reason: 'Нельзя' };
        // другому человеку — не решение ИИ, а предложение, на которое он ответит сам
        if (this.isHuman(target) && ['deal', 'pact', 'alliance', 'tribute'].includes(action)) return this.proposeToHuman(target, action);
        let result;
        if (action === 'gift') result = Diplomacy.gift(this, p, target);
        else if (action === 'tribute') result = Diplomacy.demandTribute(this, p, target);
        else if (['deal', 'pact', 'alliance'].includes(action)) result = Diplomacy.propose(this, p, target, action);
        else if (action.startsWith('cancel-')) result = { ok: Diplomacy.cancel(this, p, target, action.slice(7)), reason: 'Договора нет' };
        else return { ok: false, reason: 'Неизвестное действие' };
        if (result.ok && action === 'deal' && result.accepted) this.bumpStat(p, 'deals');
        return result;
    }

    // Предложение живому игроку: решает он сам, после хода. Условия ИИ
    // (отношения, сила) и цена во влиянии здесь не нужны — договариваются люди.
    proposeToHuman(target, kind) {
        const p = this.playerCountry;
        if (kind === 'tribute') return { ok: false, reason: 'Дань с живого игрока не требуют — договоритесь с ним' };
        if (kind !== 'peace' && this.isAtWar(p, target)) return { ok: false, reason: 'Вы воюете — сначала мир' };
        if (kind === 'deal' && Diplomacy.hasDeal(this, p, target)) return { ok: false, reason: 'Договор уже есть' };
        if (kind === 'deal' && Diplomacy.dealCount(this, p) >= DIPLOMACY.DEAL_MAX) return { ok: false, reason: `Не больше ${DIPLOMACY.DEAL_MAX} торговых договоров` };
        if (kind === 'pact' && Diplomacy.pactLeft(this, p, target)) return { ok: false, reason: 'Пакт уже действует' };
        if (kind === 'alliance' && Diplomacy.isAllied(this, p, target)) return { ok: false, reason: 'Уже союзники' };
        const seat = this.seatOf(target);
        if (!seat) return { ok: false, reason: 'Нельзя' };
        if (this.proposalPending(target, kind)) return { ok: false, reason: 'Предложение уже отправлено — ждём ответа' };
        seat.decisions.push({ type: kind, from: p });
        return { ok: true, pending: true };
    }

    // Сделка «я даю — ты даёшь» другому игроку: ответ — после хода.
    proposeTrade(target, raw) {
        const p = this.playerCountry;
        if (this.gameOver) return { ok: false, reason: 'Партия окончена' };
        const offer = Trade.normalize(raw);
        const problem = Trade.problem(this, p, target, offer);
        if (problem) return { ok: false, reason: problem[0].toUpperCase() + problem.slice(1) };
        if (this.proposalPending(target, 'trade')) return { ok: false, reason: 'Сделка уже отправлена — ждём ответа' };
        this.seatOf(target).decisions.push({ type: 'trade', from: p, offer });
        return { ok: true, pending: true };
    }

    // Уже ждёт ли игрок target ответа на такое предложение от нас.
    proposalPending(target, kind) {
        const seat = this.seatOf(target);
        return !!seat && seat.decisions.some(x => x.type === kind && x.from === this.playerCountry);
    }

    // Предложение мира: ИИ решает сразу, человек — после хода.
    proposePeace(target) {
        const p = this.playerCountry, me = this.countries[p];
        if (this.gameOver || !this.countries[target] || !this.isAtWar(p, target)) return { ok: false, reason: 'Войны нет' };
        if (this.isHuman(target)) return this.proposeToHuman(target, 'peace');
        if (me.influence < RULES.PEACE_COST) return { ok: false, reason: `Нужно ${RULES.PEACE_COST} влияния` };
        me.influence -= RULES.PEACE_COST;
        if (!new AI(this).acceptsPeace(target, p)) return { ok: true, accepted: false };
        this.makePeace(p, target);
        return { ok: true, accepted: true };
    }

    // Ответ игрока на первое предложение в очереди.
    answerDecision(accept) {
        const next = this.decisions[0];
        if (!next) return { ok: false };
        this.decisions.shift();
        const p = this.playerCountry, from = next.from;
        if (next.type === 'trade') {
            const offer = Trade.normalize(next.offer);
            let problem = accept ? Trade.problem(this, from, p, offer) : null;
            if (accept && !problem) Trade.execute(this, from, p, offer);
            if (this.isHuman(from)) {
                const me = this.countries[p].name;
                this.diploEvents.push({ type: 'trade', for: from, message: !accept ? `❌ ${me} отклоняет вашу сделку.`
                    : problem ? `⚠️ Сделка с ${me} сорвалась: ${problem}.` : `🤝 ${me} принимает сделку: вы отдали ${Trade.describeSide(this, offer.give)}, получили ${Trade.describeSide(this, offer.get)}.` });
            }
            return { ok: true, accepted: !!accept && !problem, failed: problem, ...next };
        }
        if (next.type === 'council') {
            if (!this.council || this.council.kind !== next.kind) return { ok: true, stale: true, ...next };
            // санкции против нас самих: голос — «против», без вопроса
            if (this.council.target === p) { this.council.votes[p] = false; return { ok: true, stale: true, ...next }; }
            Council.vote(this, p, accept);
            return { ok: true, accepted: !!accept, ...next };
        }
        if (next.type === 'rebels') {
            const revolt = this.revolts[next.region];
            if (!revolt || revolt.sponsor !== p) return { ok: true, stale: true, ...next };
            if (accept) revolt.accepted = true;
            else revolt.sponsor = null;
            return { ok: true, accepted: !!accept, ...next };
        }
        if (next.type === 'event') {
            if (!EVENTS[next.event] || !this.countries[from] || !this.countries[from].alive) return { ok: true, stale: true, ...next };
            return { ok: true, accepted: !!accept, summary: Events.apply(this, next, accept), ...next };
        }
        const alive = this.countries[from]?.alive && this.countries[p]?.alive;
        const valid = alive && (next.type === 'peace' ? this.isAtWar(from, p) : !this.isAtWar(from, p))
            && !(next.type === 'deal' && (Diplomacy.hasDeal(this, p, from) || Diplomacy.dealCount(this, p) >= DIPLOMACY.DEAL_MAX || Diplomacy.dealCount(this, from) >= DIPLOMACY.DEAL_MAX));
        if (!valid) return { ok: true, stale: true, ...next };
        if (accept) {
            if (next.type === 'peace') this.makePeace(p, from);
            else Diplomacy.sign(this, p, from, next.type);
            if (next.type === 'deal') { this.bumpStat(p, 'deals'); if (this.isHuman(from)) this.bumpStat(from, 'deals'); }
        } else if (next.type !== 'peace') {
            Diplomacy.changeRelation(this, p, from, DIPLOMACY.DECLINE_RELATION);
        }
        if (this.isHuman(from)) {
            const what = { peace: 'мир', deal: 'торговый договор', pact: 'пакт о ненападении', alliance: 'союз' }[next.type];
            this.diploEvents.push({ type: 'answer', for: from, message: `${accept ? '✅' : '❌'} ${this.countries[p].name} ${accept ? 'принимает' : 'отклоняет'} ваше предложение: ${what}.` });
        }
        return { ok: true, accepted: !!accept, ...next };
    }

    // --- помощь другим странам ---------------------------------------------
    // Деньги и запасы — любой стране, с которой нет войны. Игроку-получателю
    // приходит весть в отчёте, у ИИ теплеют отношения.
    transfer(target, kind, amount) {
        const p = this.playerCountry, me = this.countries[p], to = this.countries[target];
        if (this.gameOver || !to || target === p || !to.alive || !to.playable) return { ok: false, reason: 'Нельзя' };
        if (this.isAtWar(p, target)) return { ok: false, reason: 'С врагом не делятся' };
        if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Неверное количество' };
        let value, text;
        if (kind === 'money') {
            amount = Math.round(amount);
            if (me.money < amount) return { ok: false, reason: 'Не хватает денег' };
            me.money -= amount;
            to.money += amount;
            value = amount;
            text = `$${(amount / 1e6).toFixed(1)}M`;
        } else if (RESOURCES[kind]) {
            Economy.initCountry(me);
            Economy.initCountry(to);
            amount = Math.round(amount * 10) / 10;
            if ((me.stock[kind] || 0) < amount) return { ok: false, reason: 'На складе меньше' };
            me.stock[kind] = Math.round((me.stock[kind] - amount) * 10) / 10;
            to.stock[kind] = Math.round(((to.stock[kind] || 0) + amount) * 10) / 10;
            value = amount * (this.market[kind] || RESOURCES[kind].price);
            text = `${RESOURCES[kind].icon} ${amount} ед. (${RESOURCES[kind].name.toLowerCase()})`;
        } else {
            return { ok: false, reason: 'Нельзя' };
        }
        const gain = Math.min(DIPLOMACY.GIFT_RELATION, Math.max(1, Math.round(10 * value / Diplomacy.giftCost(this, target))));
        Diplomacy.changeRelation(this, p, target, gain);
        if (this.isHuman(target)) this.diploEvents.push({ type: 'gift', for: target, message: `🎁 ${me.name} передаёт вам ${text}.` });
        return { ok: true, text, gain };
    }

    // Уступить соседу свою область: для мирного договора, помощи союзнику
    // или обмена. Войска уходят в соседнюю свою область.
    cedeRegion(regionId, target) {
        const p = this.playerCountry, region = this.regions[regionId], to = this.countries[target];
        if (this.gameOver || !region || region.owner !== p || !to || target === p || !to.alive || !to.playable) return { ok: false, reason: 'Нельзя' };
        if (this.isAtWar(p, target)) return { ok: false, reason: 'Сначала заключите мир' };
        if (this.countries[p].capital === regionId) return { ok: false, reason: 'Столицу не отдают' };
        if (!this.getNeighbors(regionId).some(id => this.regions[id] && this.regions[id].owner === target)) return { ok: false, reason: `Область должна граничить с ${to.name}` };
        const home = this.handoverRegion(regionId, p, target);
        Diplomacy.changeRelation(this, p, target, 15);
        if (this.isHuman(target)) this.diploEvents.push({ type: 'gift', for: target, message: `🗺️ ${this.countries[p].name} уступает вам область ${region.name}.` });
        return { ok: true, withdrawn: home };
    }

    // --- союзники -----------------------------------------------------------
    // Соседние области союзников, куда можно передать войска.
    allyTargets(fromId, countryId = this.playerCountry) {
        const from = this.regions[fromId];
        if (!from || from.owner !== countryId) return [];
        return this.getNeighbors(fromId).filter(id => this.regions[id] && this.regions[id].owner !== countryId
            && Diplomacy.isAllied(this, countryId, this.regions[id].owner));
    }

    // Войска переходят союзнику сразу и становятся его войсками.
    giveTroops(fromId, toId, forces, countryId = this.playerCountry) {
        if (this.gameOver || !this.validateForces(fromId, forces, countryId)) return { ok: false, reason: 'Недоступный состав войск' };
        if (!this.allyTargets(fromId, countryId).includes(toId)) return { ok: false, reason: 'Передать можно только в соседнюю область союзника' };
        const from = this.regions[fromId], to = this.regions[toId];
        for (const [unitId, n] of Object.entries(forces)) { from.army[unitId] -= n; to.army[unitId] += n; }
        if (this.isHuman(to.owner)) this.diploEvents.push({ type: 'troops', for: to.owner, message: `🪖 ${this.countries[countryId].name} передаёт вам войска в ${to.name}: ${this.describeForces(forces)}.` });
        return { ok: true, text: this.describeForces(forces) };
    }

    // Совместная операция: цель на следующий ход, видна союзникам. Удар по
    // ней в этот ход сильнее — если бьёт автор операции или его союзник.
    planOperation(targetId) {
        const p = this.playerCountry, target = this.regions[targetId];
        if (this.gameOver || !target || !this.isAtWar(p, target.owner)) return { ok: false, reason: 'Цель — область страны, с которой вы воюете' };
        const allies = Diplomacy.allies(this, p);
        if (!allies.length) return { ok: false, reason: 'Нужен союзник' };
        this.operations = this.operations.filter(o => o.by !== p);
        this.operations.push({ by: p, target: targetId, turn: this.turn + 1 });
        for (const ally of allies) {
            if (this.isHuman(ally)) this.diploEvents.push({ type: 'operation', for: ally, message: `🎯 ${this.countries[p].name} объявляет совместную операцию: цель — ${target.name}, удар на следующем ходу (+${Math.round(RULES.OPERATION_BONUS * 100)}% к удару). Присоединяйтесь!` });
        }
        return { ok: true, turn: this.turn + 1 };
    }

    // Операции, которые видит игрок cc: свои и союзников.
    visibleOperations(cc = this.playerCountry) {
        return (this.operations || []).filter(o => o.turn >= this.turn && (o.by === cc || Diplomacy.isAllied(this, cc, o.by)));
    }

    // Мирная передача области: связанные приказы отменяются с возвратом,
    // войска отходят в соседнюю свою область (если её нет — распускаются).
    handoverRegion(regionId, from, to) {
        const region = this.regions[regionId];
        for (const type of Object.keys(this.orders)) {
            for (let i = this.orders[type].length - 1; i >= 0; i--) {
                const o = this.orders[type][i];
                if (o.country === from && (o.regionId === regionId || o.from === regionId || o.to === regionId)) this.cancelOrder(type, i);
            }
        }
        const home = this.getNeighbors(regionId).map(id => this.regions[id]).find(r => r && r.owner === from);
        if (home) for (const unitId of Object.keys(UnitsDB)) home.army[unitId] += region.army[unitId];
        region.army = this.emptyArmy();
        this.setOwner(regionId, to);
        region.loyalty = Math.min(region.loyalty, 0.7);
        return !!home;
    }

    setTaxRate(countryId, rate) {
        const c = this.countries[countryId];
        if (!c || !Number.isFinite(rate)) return { ok: false };
        c.taxRate = Math.min(0.3, Math.max(0.01, Math.round(rate * 100) / 100));
        return { ok: true };
    }

    makePeace(a, b) {
        const key = this.pairKey(a, b);
        this.wars.delete(key);
        this.truces.set(key, this.turn + RULES.TRUCE_TURNS);
        Diplomacy.onPeace(this, a, b);
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
        if (!Tech.unitUnlocked(country, unitId)) {
            return { ok: false, reason: `Сначала исследуйте: ${TECH_TREE[unit.requires].name}` };
        }
        if (unit.industryCost * amount > this.recruitCapacityLeft(regionId)) {
            return { ok: false, reason: 'Не хватает мощности индустрии области' };
        }
        const cost = unit.buildCost * amount;
        if (country.money < cost) return { ok: false, reason: 'Недостаточно средств' };

        country.money -= cost;
        if (this.isHuman(countryId)) {
            this.seatOf(countryId).campaign.recruited = true;
            this.bumpStat(countryId, 'recruited', amount);
        }
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
    // Цена следующей ступени модернизации рода войск (null — нельзя).
    techCost(countryId, unitId) {
        const country = this.countries[countryId], unit = UnitsDB[unitId];
        if (!country || !unit || !Tech.unitUnlocked(country, unitId)) return null;
        const level = country.tech[unitId] || 1;
        if (level >= MODERNIZATION.MAX) return null;
        return Math.round(unit.buildCost * MODERNIZATION.BASE * Math.pow(MODERNIZATION.GROWTH, level - 1));
    }

    // Модернизация — сразу; технологии дерева — через startResearch.
    research(countryId, unitId) {
        if (this.gameOver) return { ok: false, reason: 'Кампания завершена' };
        const country = this.countries[countryId];
        if (!country || !Object.hasOwn(UnitsDB, unitId)) return { ok: false, reason: 'Неизвестный род войск' };
        const cost = this.techCost(countryId, unitId);
        if (cost === null) return { ok: false, reason: Tech.unitUnlocked(country, unitId) ? 'Максимальная ступень' : 'Род войск ещё не открыт' };
        if (country.money < cost) return { ok: false, reason: 'Недостаточно средств' };
        country.money -= cost;
        country.tech[unitId] = (country.tech[unitId] || 1) + 1;
        if (this.isHuman(countryId)) this.bumpStat(countryId, 'modernized');
        return { ok: true };
    }

    startResearch(countryId, techId) {
        if (this.gameOver) return { ok: false, reason: 'Кампания завершена' };
        const country = this.countries[countryId];
        if (!country) return { ok: false, reason: 'Неизвестная страна' };
        Tech.init(country);
        const check = Tech.canStart(country, techId);
        if (!check.ok) return check;
        const tech = TECH_TREE[techId];
        country.money -= tech.cost;
        country.research = { id: techId, remaining: tech.turns, started: this.turn };
        return { ok: true };
    }

    // В тот же ход — полный возврат (передумали), позже — половина.
    // --- ядерное оружие (js/Nuclear.js) ------------------------------------
    nuclearBuild(kind, countryId = this.playerCountry) { return Nuclear.build(this, countryId, kind); }
    nuclearCancel(countryId = this.playerCountry) { return Nuclear.cancel(this, countryId); }
    nuclearStrike(regionId, kind, countryId = this.playerCountry) { return Nuclear.strike(this, countryId, regionId, kind); }

    cancelResearch(countryId) {
        const country = this.countries[countryId];
        if (!country || !country.research) return 0;
        const tech = TECH_TREE[country.research.id];
        const refund = country.research.started === this.turn ? tech.cost : Math.round(tech.cost / 2);
        country.money += refund;
        country.research = null;
        return refund;
    }

    processResearch(events) {
        for (const country of Object.values(this.countries)) {
            if (!country.alive || !country.research) continue;
            country.research.remaining--;
            if (country.research.remaining > 0) continue;
            const tech = TECH_TREE[country.research.id];
            Tech.grant(country, country.research.id);
            country.research = null;
            if (!this.isHuman(country.id)) continue;
            this.bumpStat(country.id, 'techs');
            const unit = tech.unlocks ? UnitsDB[tech.unlocks] : null;
            events.push({ type: 'tech', for: country.id, message: `🔬 Исследование завершено: ${tech.icon} ${tech.name}.`
                + (unit ? ` Открыт новый род войск — ${unit.icon} ${unit.name}: набирайте в своих областях.` : ` ${tech.text}`) });
        }
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
        // отменённый набор не засчитывается в задание «наберите войска»
        if (type === 'recruitment' && this.isHuman(order.country)) this.bumpStat(order.country, 'recruited', -order.amount);
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
        // Отчёты адресованы людям: у каждого записи с for === его страна.
        const logs = [];
        const mine = order => this.isHuman(order.country);

        // 1. Разведка
        for (const order of this.orders.recon) {
            const region = this.getRegion(order.target);
            if (!region) continue;
            if (Math.random() * 100 <= order.prob) {
                const until = new Date(this.currentDate);
                until.setMonth(until.getMonth() + 1);
                region.reconActiveUntil = until;
                if (mine(order)) logs.push({ for: order.country, success: true, message: `🕵️ Разведка: шпионы внедрились в ${region.name}. Данные о гарнизоне получены.` });
            } else if (mine(order)) {
                logs.push({ for: order.country, success: false, message: `💥 Провал операции в ${region.name}. Шпионы перехвачены контрразведкой.` });
            }
        }

        // 2. Набор: деньги списаны при заказе, войска приходят сейчас
        for (const order of this.orders.recruitment) {
            const region = this.getRegion(order.regionId);
            if (!region) continue;
            if (region.owner !== order.country) {
                this.countries[order.country].money += order.cost;   // область потеряна — деньги возвращаются
                if (mine(order)) logs.push({ for: order.country, success: false, message: `Набор в ${region.name} сорван: область потеряна. Деньги возвращены.` });
                continue;
            }
            region.army[order.unitId] += order.amount;
            if (mine(order)) logs.push({ for: order.country, success: true, message: `В ${region.name} набрано: +${order.amount} ${UnitsDB[order.unitId].name}.` });
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
            if (mine(order)) logs.push({ for: order.country, success: true, message: order.text + ' — выполнено.' });
        }

        // 4. Сражения: все атаки одной страны и её союзников на одну область
        //    в этот ход — одна битва (совместное наступление)
        const byTarget = new Map();
        for (const order of this.orders.attacks) {
            if (!byTarget.has(order.to)) byTarget.set(order.to, []);
            byTarget.get(order.to).push(order);
        }
        const battles = [];
        for (const list of byTarget.values()) {
            const groups = [];
            for (const order of list) {
                const group = groups.find(g => g.countries.has(order.country) || [...g.countries].some(cc => Diplomacy.isAllied(this, cc, order.country)));
                if (group) { group.orders.push(order); group.countries.add(order.country); }
                else groups.push({ countries: new Set([order.country]), orders: [order] });
            }
            for (const group of groups) battles.push(group.orders);
        }
        const worldEvents = [];
        for (const orders of battles) {
            const result = this.resolveBattle(orders);
            if (!result) continue;
            const viewers = [...result.coalition, result.defender, ...(result.helpers || [])].filter((cc, i, all) => this.isHuman(cc) && all.indexOf(cc) === i);
            // каждому участнику — своя запись: победа с его стороны
            for (const cc of viewers) {
                const attacking = result.coalition.includes(cc);
                logs.push({ ...result, for: cc, success: attacking ? result.won : !result.won, playerIsAttacker: attacking });
            }
            if (!viewers.length) worldEvents.push(result);
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

    // Удар с нескольких областей сразу: защитникам приходится растягивать
    // оборону. directions — сколько разных областей бьют по цели.
    static flankBonus(directions) {
        return Math.min(RULES.FLANK_MAX, RULES.FLANK_BONUS * Math.max(0, directions - 1));
    }

    // Оценка удара по области: уже назначенные атаки страны cc на эту цель
    // плюс новая (extra из области fromId) — так, как посчитает бой.
    strikeEstimate(targetId, extra, fromId, cc = this.playerCountry) {
        const target = this.getRegion(targetId);
        const forces = this.emptyArmy();
        const directions = new Set();
        const add = (from, f) => {
            let any = false;
            for (const unitId of Object.keys(UnitsDB)) { const n = f[unitId] || 0; forces[unitId] += n; if (n) any = true; }
            if (any) directions.add(from);
        };
        for (const o of this.orders.attacks) if (o.country === cc && o.to === targetId) add(o.from, o.forces);
        if (extra) add(fromId, extra);
        const flank = GameData.flankBonus(directions.size);
        const attack = this.sidePower(forces, cc, 'baseAttack', target.army) * (1 + flank);
        const needed = this.defensePower(target, forces) * RULES.ATTACK_ADVANTAGE;
        return { attack, needed, ratio: attack / Math.max(1, needed), directions: directions.size, flank };
    }

    resolveBattle(allOrders) {
        const target = this.getRegion(allOrders[0].to);
        if (!target) return null;
        const defender = target.owner;
        // бьются только те, кто воюет с хозяином области
        const orders = allOrders.filter(o => o.country !== defender && this.isAtWar(o.country, defender));
        if (!orders.length) return null;

        // собираем войска со всех участвующих областей
        const sources = [];
        const forces = this.emptyArmy();
        const byCountry = {};
        for (const order of orders) {
            const from = this.getRegion(order.from);
            if (!from || from.owner !== order.country) continue;
            const own = byCountry[order.country] || (byCountry[order.country] = this.emptyArmy());
            const sent = {};
            for (const unitId of Object.keys(UnitsDB)) {
                const amount = Math.min(from.army[unitId] || 0, order.forces[unitId] || 0);
                sent[unitId] = amount;
                forces[unitId] += amount;
                own[unitId] += amount;
                from.army[unitId] -= amount;
            }
            sources.push({ region: from, sent, country: order.country });
        }
        const coalition = Object.keys(byCountry).filter(cc => Object.values(byCountry[cc]).some(n => n > 0));
        if (!coalition.length) return null;

        const defForces = { ...target.army };
        const powerOf = {};
        let powerAtt = 0;
        for (const cc of coalition) {
            powerOf[cc] = this.sidePower(byCountry[cc], cc, 'baseAttack', defForces);
            powerAtt += powerOf[cc];
        }
        const joint = coalition.length > 1;
        if (joint) powerAtt *= 1 + RULES.JOINT_ATTACK_BONUS;
        const directions = new Set(sources.filter(s => Object.values(s.sent).some(n => n > 0)).map(s => s.region.id)).size;
        const flank = GameData.flankBonus(directions);
        powerAtt *= 1 + flank;
        const operation = (this.operations || []).find(o => o.target === target.id && o.turn === this.turn
            && coalition.some(cc => cc === o.by || Diplomacy.isAllied(this, cc, o.by)));
        if (operation) powerAtt *= 1 + RULES.OPERATION_BONUS;
        // область достаётся тому, кто вложил в удар больше сил
        const attacker = coalition.reduce((a, b) => (powerOf[b] > powerOf[a] ? b : a));
        const isCapital = this.countries[defender].capital === target.id;
        const powerDef = this.defensePower(target, forces);

        // Потери зависят от соотношения сил: при равных силах наступающий
        // теряет больше обороняющегося, при подавляющем перевесе — наоборот.
        const ratio = powerAtt / powerDef;
        let success = ratio >= RULES.ATTACK_ADVANTAGE;
        let defLossPct = Math.min(0.6, Math.max(0.05, 0.15 * ratio)) * Tech.factor(this.countries[defender], 'losses');
        let attLossBase = Math.min(0.6, Math.max(0.05, 0.2 / ratio));
        if (this.cheatMode && coalition.includes(this.playerCountry)) {
            success = true; attLossBase = 0; defLossPct = 1;
        }

        const attLosses = this.emptyArmy(), defLosses = this.emptyArmy();
        for (const unitId of Object.keys(UnitsDB)) {
            const defAmount = target.army[unitId] || 0;
            defLosses[unitId] = Math.min(defAmount, Math.ceil(defAmount * defLossPct));
            target.army[unitId] -= defLosses[unitId];
        }
        // войска союзников в области теряют ту же долю
        const helpers = this.garrisonsIn(target.id);
        for (const g of helpers) {
            for (const unitId of Object.keys(UnitsDB)) {
                const n = g.army[unitId] || 0;
                const lost = Math.min(n, Math.ceil(n * defLossPct));
                g.army[unitId] -= lost;
                defLosses[unitId] += lost;
            }
        }
        // потери каждой страны раскладываем по её областям-источникам
        const survivorsBySource = sources.map(src => ({ region: src.region, country: src.country, left: { ...src.sent } }));
        for (const cc of coalition) {
            const attLossPct = attLossBase * Tech.factor(this.countries[cc], 'losses');
            const mine = sources.map((src, i) => ({ src, i })).filter(x => x.src.country === cc);
            for (const unitId of Object.keys(UnitsDB)) {
                const total = byCountry[cc][unitId];
                if (!total) continue;
                // Round once per army, then distribute integer casualties. Splitting
                // a force into many orders must never change its total losses.
                const losses = Math.min(total, Math.ceil(total * attLossPct));
                attLosses[unitId] += losses;
                const shares = mine.map(({ src, i }) => {
                    const exact = losses * src.sent[unitId] / total;
                    const whole = Math.floor(exact);
                    survivorsBySource[i].left[unitId] -= whole;
                    return { i, fraction: exact - whole, whole };
                }).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
                const remainder = losses - shares.reduce((sum, share) => sum + share.whole, 0);
                for (let k = 0; k < remainder; k++) survivorsBySource[shares[k].i].left[unitId]--;
            }
        }

        const names = coalition.map(cc => this.countries[cc].name).join(' и ');
        const defenderName = this.countries[defender].name;
        const extra = [];
        if (joint) extra.push(`Совместное наступление: +${Math.round(RULES.JOINT_ATTACK_BONUS * 100)}% к удару.`);
        if (flank) extra.push(`Удар с ${directions} направлений: +${Math.round(flank * 100)}%.`);
        if (helpers.length) extra.push(`В обороне помогали войска: ${helpers.map(g => this.countries[g.cc].name).join(', ')}.`);
        if (operation) extra.push(`По плану операции: +${Math.round(RULES.OPERATION_BONUS * 100)}%.`);
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
            // войска союзников отходят к себе домой
            for (const g of helpers) this.recallGarrison(target.id, g.cc);
            // в область входят войска нового хозяина, союзники возвращаются домой
            for (const s of survivorsBySource) {
                const into = s.country === attacker ? target : s.region;
                for (const unitId of Object.keys(UnitsDB)) into.army[unitId] += s.left[unitId];
            }
            this.setOwner(target.id, attacker);
            target.loyalty = 0.5;
            if (isCapital) extra.push(this.onCapitalLost(defender));
            if (joint) extra.push(`Область отошла к ${this.countries[attacker].name} — у неё самый сильный удар.`);
            message = `${names}: ${target.name} захвачена!`;
        } else {
            for (const s of survivorsBySource) {
                for (const unitId of Object.keys(UnitsDB)) s.region.army[unitId] += s.left[unitId];
            }
            message = `${names}: наступление на ${target.name} (${defenderName}) отбито.`;
        }

        if (success) for (const cc of coalition) if (this.isHuman(cc)) this.bumpStat(cc, 'battlesWon');
        if (!success && this.isHuman(defender)) this.bumpStat(defender, 'battlesWon');
        return {
            won: success,
            success: coalition.includes(this.playerCountry) ? success : !success,
            message,
            detail: extra.filter(Boolean).join(' '),
            attacker, defender, coalition, joint, helpers: helpers.map(g => g.cc),
            playerIsAttacker: coalition.includes(this.playerCountry),
            power: { attack: Math.round(powerAtt), defense: Math.round(powerDef), capital: isCapital },
            losses: { attacker: attLosses, defender: defLosses, initialAttacker: forces },
        };
    }

    // Оборона области против конкретного состава атакующих — та же формула
    // используется ИИ для оценки целей.
    defensePower(target, attackers) {
        let power = this.sidePower(target.army, target.owner, 'baseDefense', attackers) + this.militia(target) + 1;
        for (const g of this.garrisonsIn(target.id)) power += this.sidePower(g.army, g.cc, 'baseDefense', attackers);
        power *= RULES.DEFENSE_BONUS * Tech.factor(this.countries[target.owner], 'defense');
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
        if (this.isHuman(countryId)) this.seatOf(countryId).campaign.investment = true;
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
                if (this.isHuman(project.country)) events.push({ for: project.country, message: 'Строительство сорвано потерей области. Средства возвращены.' });
                continue;
            }
            project.remaining--;
            if (project.remaining > 0) { pending.push(project); continue; }
            const plan = DEVELOPMENT[project.kind];
            if (plan.resource) region.resources[plan.resource] += plan.gain;
            region.development[project.kind]++;
            if (this.isHuman(project.country)) {
                events.push({ for: project.country, message: `${region.name}: завершён проект «${plan.name}».` });
                this.bumpStat(project.country, 'projects');
            }
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

    campaignProgress(cc = this.playerCountry) {
        const territories = Object.values(this.regions).filter(r => CountriesDB[r.originalOwner].playable);
        const controlled = territories.filter(r => r.owner === cc).length;
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
            // interest обязателен: без него расходы страны с долгами — NaN
            return { income: 0, expense: 0, tax, sales: 0, purchases: 0, upkeep, social, interest: 0, trade: { lines: {} } };
        }
        const policy = POLICIES[country.policy] || POLICIES.balanced;
        for (const region of this.getCountryRegions(countryId)) {
            // восставшая область налогов не платит;
            // заражённая после ядерного удара — тоже
            if (!this.revolts[region.id] && !Nuclear.fallout(this, region.id)) tax += region.population * country.taxRate * region.loyalty * (1 + INFRA.TAX * (region.development.infra || 0));
            social += region.population * policy.socialCost;
            upkeep += this.armyUpkeep(region.army);
        }
        for (const g of this.garrisonsOf(countryId)) upkeep += this.armyUpkeep(g.army);
        upkeep += Nuclear.upkeep(this, countryId);
        const cycle = Economy.cycle(this);
        tax *= Economy.taxFactor(country) * Tech.factor(country, 'tax') * cycle.tax
            * (Unrest.civilWar(this, countryId) ? REVOLT.CIVIL_TAX : 1);
        const trade = Economy.projectTrade(this, countryId);
        // торговые договоры: продаём дороже, покупаем дешевле
        const bonus = Diplomacy.tradeBonus(this, countryId);
        const sales = trade.sales * (1 + bonus) * cycle.trade, purchases = trade.purchases * (1 - bonus);
        const debt = country.debt || 0;
        const interest = debt ? Math.round(debt * Economy.rateFor(debt, tax)) : 0;
        return {
            income: tax + sales, expense: upkeep + social + purchases + interest,
            tax, sales, purchases, upkeep, social, interest, trade, tradeBonus: bonus,
        };
    }

    // --- восстания --------------------------------------------------------------
    suppressRevolt(regionId) { return this.gameOver ? { ok: false } : Unrest.suppress(this, regionId, this.playerCountry); }
    appeaseRevolt(regionId) { return this.gameOver ? { ok: false } : Unrest.appease(this, regionId, this.playerCountry); }

    // --- госдолг ------------------------------------------------------------
    borrow(amount, countryId = this.playerCountry) {
        const c = this.countries[countryId];
        if (this.gameOver || !c || !c.alive || !Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Нельзя' };
        const room = Economy.debtLimit(this, countryId) - (c.debt || 0);
        amount = Math.round(Math.min(amount, room) / 1e5) * 1e5;
        if (amount <= 0) return { ok: false, reason: 'Банки больше не дают: достигнут предел долга' };
        c.debt = (c.debt || 0) + amount;
        c.money += amount;
        return { ok: true, amount };
    }

    repay(amount, countryId = this.playerCountry) {
        const c = this.countries[countryId];
        if (this.gameOver || !c || !Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Нельзя' };
        amount = Math.round(Math.min(amount, c.debt || 0, Math.max(0, c.money)));
        if (amount <= 0) return { ok: false, reason: c.debt ? 'Нет свободных денег' : 'Долга нет' };
        c.debt -= amount;
        c.money -= amount;
        return { ok: true, amount };
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
        this.operations = (this.operations || []).filter(o => o.turn > this.turn);
        const cycleEvent = Economy.advanceCycle(this);
        if (cycleEvent) events.push(cycleEvent);
        this.processResearch(events);
        Nuclear.endTurn(this, events);
        Diplomacy.endTurn(this, events);
        this.checkGarrisons(events);
        const balances = {};
        const markets = Economy.runMarkets(this);

        for (const country of Object.values(this.countries)) {
            if (!country.alive) continue;
            const economy = markets[country.id];
            if (economy) country.economy = economy;
            const balance = this.countryBalance(country.id);
            // вместо прогноза торговли — то, что реально продано и куплено
            let sales = 0, purchases = 0;
            if (economy) for (const r of Object.values(economy.res)) { sales += r.sold * r.price; purchases += r.bought * r.price; }
            const bonus = Diplomacy.tradeBonus(this, country.id);
            balance.sales = Math.round(sales * (1 + bonus) * Economy.cycle(this).trade);
            balance.purchases = Math.round(purchases * (1 - bonus));
            balance.income = balance.tax + balance.sales;
            balance.expense = balance.upkeep + balance.social + balance.purchases + balance.interest;
            balances[country.id] = balance;
            const net = Math.round(balance.income - balance.expense);
            country.lastNetIncome = Number.isFinite(net) ? net : 0;
            country.money += country.lastNetIncome;
            if (!Number.isFinite(country.money)) country.money = 0;   // мир, испорченный прежней ошибкой
            if (economy) this.applyShortages(country, economy, events);
            country.influence = Math.min(RULES.INFLUENCE_MAX, country.influence + RULES.INFLUENCE_PER_TURN);

            if (country.money < 0) {
                this.applyDesertion(country.id);
                if (this.isHuman(country.id)) {
                    events.push({ type: 'bankrupt', for: country.id, message: '💸 Казна пуста: часть войск дезертировала, лояльность падает.' });
                }
            }
        }

        // Лояльность тянется к цели: захваченные земли, высокие налоги, голод
        // и нехватка товаров её снижают. Население растёт в сытости.
        for (const region of Object.values(this.regions)) {
            const country = this.countries[region.owner];
            const occupied = region.owner !== region.originalOwner;
            const target = Math.min(1, Math.max(0.2, (occupied ? 0.8 : 1) + POLICIES[country.policy].loyalty + INFRA.LOYALTY * (region.development.infra || 0)
                - GameData.taxPenalty(country.taxRate) - Economy.loyaltyPenalty(country)));
            if (region.loyalty < target) region.loyalty = Math.min(target, region.loyalty + 0.05);
            else if (region.loyalty > target) region.loyalty = Math.max(target, region.loyalty - 0.03);
            const change = Economy.populationChange(country);
            if (change && region.population > 0) region.population = Math.max(1000, Math.round(region.population * (1 + change)));
        }

        Unrest.update(this, events);

        // Гибель стран
        for (const country of Object.values(this.countries)) {
            if (!country.alive || this.regionsByCountry[country.id].length > 0) continue;
            country.alive = false;
            for (const enemy of this.enemiesOf(country.id)) this.wars.delete(this.pairKey(country.id, enemy));
            if (this.isHuman(country.id)) {
                events.push({ type: 'defeat', for: country.id, message: '🏳️ Ваша страна потеряла все области.' });
                // игра кончается, когда не осталось ни одного живого человека
                if (this.humans.every(cc => !this.countries[cc].alive)) { this.gameOver = true; this.outcome = 'defeat'; }
            }
            events.push({ type: 'eliminated', country: country.id, message: `🏳️ ${country.name} прекратила существование.` });
        }

        const winner = this.humans.find(cc => this.campaignProgress(cc).share === 1);
        if (!this.gameOver && winner) {
            this.gameOver = true;
            this.outcome = 'victory';
            this.winner = winner;
            events.push({ message: `${this.countries[winner].name}: все области суверенных стран под одним управлением. Мировое господство достигнуто!` });
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
        if (!this.isHuman(country.id)) return;
        const pct = key => Math.round((1 - economy.sat[key]) * 100);
        const to = country.id;
        if (pct('food') >= 5) events.push({ type: 'shortage', for: to, message: `🌾 Не хватает еды (${pct('food')}%): люди голодают, армия разбегается, население убывает.` });
        if (pct('energy') >= 5) events.push({ type: 'shortage', for: to, message: `⚡ Не хватает энергии (${pct('energy')}%): заводы выпускают меньше товаров.` });
        if (pct('goods') >= 5) events.push({ type: 'shortage', for: to, message: `📦 Не хватает товаров (${pct('goods')}%): налоги собираются хуже, растёт недовольство.` });
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
                Math.round((region.unrest || 0) * 100) / 100,
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
                stock, { ...(c.trade || { food: 'sell', energy: 'sell', goods: 'sell' }) }, sat,
                [...(c.techs || [])], c.research ? { ...c.research } : null, Math.round(c.debt || 0)];
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
            cycle: this.cycle ? { ...this.cycle } : undefined,
            revolts: Unrest.serialize(this),
            operations: (this.operations || []).map(o => ({ ...o })),
            garrisons: Object.fromEntries(Object.entries(this.garrisons || {}).map(([id, byCountry]) =>
                [id, Object.fromEntries(Object.entries(byCountry).map(([cc, army]) => [cc, units.map(u => army[u] || 0)]))])),
            council: Council.serialize(this),
            nuclear: Nuclear.serialize(this),
            chronicle: this.chronicle ? structuredClone(this.chronicle) : undefined,
            diplomacy: Diplomacy.serialize(this),
            missions: this.missions.map(m => ({ ...m, reward: { ...m.reward } })),
            stats: { ...this.stats },
            // первым всегда тот, чьими глазами сохранена партия
            humans: [this.playerCountry, ...this.humans.filter(cc => cc !== this.playerCountry)],
            seats: structuredClone(this.seats),
            winner: this.winner || null,
            goal: this.goal,
            hotseat: this.hotseat ? { done: [...this.hotseat.done] } : undefined,
            scoreStart: { ...(this.scoreStart || {}) },
            net: this.net ? structuredClone(this.net) : undefined,
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

    // Поломки, которые чинятся без потерь: казна «не число» (была ошибка в
    // расчёте для страны с долгами без областей) — в сохранении это null.
    static repairSave(save) {
        if (!save || typeof save !== 'object' || !save.countries || typeof save.countries !== 'object') return save;
        for (const c of Object.values(save.countries)) {
            if (!Array.isArray(c)) continue;
            if (c[0] === null) c[0] = 0;
            if (c[4] === null) c[4] = 0;
            if (c[14] === null) c[14] = 0;
        }
        return save;
    }

    static validateSave(save) {
        // what — какая проверка не прошла: пишем в сообщение, чтобы по снимку
        // экрана было видно причину
        const fail = what => { throw new Error(`Сохранение несовместимо или повреждено${what ? ` (${what})` : ''}`); };
        const finite = n => typeof n === 'number' && Number.isFinite(n);
        const count = n => Number.isSafeInteger(n) && n >= 0;
        if (!save || save.v !== 3 || !CountriesDB[save.player]?.playable || !count(save.turn) || !finite(save.date) || !Number.isFinite(+new Date(save.date))) fail();
        if (JSON.stringify(save.units) !== JSON.stringify(Object.keys(UnitsDB))) fail();
        if (save.difficulty !== undefined && !DIFFICULTY[save.difficulty]) fail();
        if (save.market !== undefined && !GameData.validMarket(save.market)) fail();
        if (save.diplomacy !== undefined && !Diplomacy.valid(save.diplomacy)) fail();
        if (save.missions !== undefined && !Missions.valid(save.missions, save.stats)) fail();
        if (!save.regions || !save.countries || !save.campaign || !Array.isArray(save.projects)) fail();
        if (Object.keys(save.regions).length !== Object.keys(RegionsDB).length || Object.keys(save.countries).length !== Object.keys(CountriesDB).length) fail();
        for (const id of Object.keys(RegionsDB)) {
            const r = save.regions[id];
            if (!Array.isArray(r) || !CountriesDB[r[0]] || !Array.isArray(r[1]) || r[1].length !== save.units.length || !r[1].every(count) || !finite(r[2]) || r[2] < 0 || r[2] > 1 || !finite(r[3])) fail(`область ${id}`);
            for (const key of ['industry', 'agro', 'oil']) if (!count(r[4]?.[key]) || !count(r[5]?.[key]) || r[5][key] > 5) fail();
            if (r[5].infra !== undefined && (!count(r[5].infra) || r[5].infra > 5)) fail();
            if (r[6] !== undefined && !count(r[6])) fail();
            if (r[7] !== undefined && (!finite(r[7]) || r[7] < 0 || r[7] > 1)) fail();
        }
        for (const id of Object.keys(CountriesDB)) {
            const c = save.countries[id];
            if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1]) || c[1] < 0.01 || c[1] > 0.3 || !finite(c[2]) || c[2] < 0 || c[2] > 100 || !finite(c[4]) || typeof c[5] !== 'boolean' || (c[6] !== null && (!RegionsDB[c[6]] || save.regions[c[6]][0] !== id)) || !POLICIES[c[7]] || !Number.isInteger(c[8])) fail(`страна ${id}`);
            for (const key of [...save.units, 'marchSpeed']) if (!count(c[3]?.[key]) || c[3][key] < 1 || c[3][key] > (key === 'marchSpeed' ? 3 : MODERNIZATION.MAX)) fail();
            if (c[12] !== undefined && !GameData.validTechs(c[12], c[13])) fail();
            if (c[14] !== undefined && (!finite(c[14]) || c[14] < 0)) fail();
            if (c[9] !== undefined && !GameData.validEconomy(c[9], c[10], c[11])) fail();
        }
        const pair = key => typeof key === 'string' && key.split('|').length === 2 && key.split('|').every(cc => CountriesDB[cc]);
        if (!Array.isArray(save.wars) || save.wars.some(x => !Array.isArray(x) || !pair(x[0]) || !count(x[1]?.start) || !CountriesDB[x[1]?.attacker])) fail();
        if (!Array.isArray(save.truces) || save.truces.some(x => !Array.isArray(x) || !pair(x[0]) || !count(x[1]))) fail();
        const decisionsOk = list => Array.isArray(list) && list.every(x => x && GameData.DECISIONS.includes(x.type) && CountriesDB[x.from] && (x.type !== 'event' || Events.validDecision(x)) && (x.type !== 'rebels' || !!RegionsDB[x.region]) && (x.type !== 'trade' || Trade.validDecision(x)) && (x.type !== 'council' || !!COUNCIL_KINDS[x.kind]));
        if (!decisionsOk(save.decisions)) fail('предложения');
        if (save.goal !== undefined && !GOALS[save.goal]) fail();
        if (save.hotseat !== undefined && (!save.hotseat || !Array.isArray(save.hotseat.done) || !Array.isArray(save.humans) || save.humans.length < 2
            || !save.hotseat.done.every(cc => save.humans.includes(cc)))) fail();
        if (save.revolts !== undefined && !Unrest.valid(save.revolts)) fail();
        if (save.chronicle !== undefined && !Score.validChronicle(save.chronicle)) fail('хроника');
        if (save.council !== undefined && !Council.valid(save.council)) fail('совет');
        if (save.nuclear !== undefined && !Nuclear.valid(save.nuclear)) fail('ядерное оружие');
        if (save.garrisons !== undefined && (!save.garrisons || typeof save.garrisons !== 'object' || !Object.entries(save.garrisons).every(([id, byCountry]) =>
            RegionsDB[id] && byCountry && typeof byCountry === 'object' && Object.entries(byCountry).every(([cc, army]) =>
                CountriesDB[cc] && Array.isArray(army) && army.length === save.units.length && army.every(count))))) fail('войска союзников');
        if (save.operations !== undefined && (!Array.isArray(save.operations) || save.operations.some(o => !o || !CountriesDB[o.by] || !RegionsDB[o.target] || !Number.isInteger(o.turn)))) fail();
        if (save.cycle !== undefined && (!save.cycle || !CYCLES[save.cycle.phase] || !Number.isInteger(save.cycle.until))) fail();
        if (save.scoreStart !== undefined && !Score.valid(save.scoreStart)) fail();
        if (save.humans !== undefined) {
            if (!Array.isArray(save.humans) || save.humans[0] !== save.player || new Set(save.humans).size !== save.humans.length
                || save.humans.some(cc => !CountriesDB[cc]?.playable)) fail();
            const seats = save.seats;
            if (!seats || typeof seats !== 'object' || Object.keys(seats).sort().join() !== save.humans.slice(1).sort().join()) fail();
            for (const seat of Object.values(seats)) {
                if (!seat || !Missions.valid(seat.missions, seat.stats) || !decisionsOk(seat.decisions) || !Array.isArray(seat.history) || !seat.campaign) fail('места игроков');
            }
        }
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

    takeDiploEvents() {
        const events = this.diploEvents;
        this.diploEvents = [];
        return events;
    }

    // Склад, торговые настройки и обеспеченность страны (поля появились с экономикой).
    static validEconomy(stock, trade, sat) {
        const keys = Object.keys(RESOURCES);
        const finite = n => typeof n === 'number' && Number.isFinite(n);
        return !!stock && !!trade && !!sat
            && keys.every(k => finite(stock[k]) && stock[k] >= 0 && Object.hasOwn(TRADE_MODES, trade[k]) && finite(sat[k]) && sat[k] >= 0 && sat[k] <= 1);
    }

    static validTechs(techs, research) {
        if (!Array.isArray(techs) || techs.some(id => !Object.hasOwn(TECH_TREE, id)) || new Set(techs).size !== techs.length) return false;
        if (research === null || research === undefined) return true;
        return typeof research === 'object' && Object.hasOwn(TECH_TREE, research.id) && !techs.includes(research.id)
            && Number.isInteger(research.remaining) && research.remaining >= 1 && research.remaining <= TECH_TREE[research.id].turns;
    }

    static validMarket(market) {
        return !!market && Object.keys(RESOURCES).every(k => typeof market[k] === 'number' && Number.isFinite(market[k]) && market[k] > 0);
    }

    static restore(save) {
        GameData.repairSave(save);
        GameData.validateSave(save);
        const data = new GameData(save.player, { cheat: save.cheat, scenario: save.scenario, difficulty: save.difficulty, humans: save.humans, goal: save.goal, restoring: true });
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
                region.development = { ...saved[5], infra: saved[5].infra || 0 };
                region.reconActiveUntil = saved[3] ? new Date(saved[3]) : undefined;
                if (saved[6] !== undefined) region.population = saved[6];
                region.unrest = saved[7] || 0;
            }
            data.regionsByCountry[region.owner].push(region.id);
        }
        for (const c of Object.values(data.countries)) {
            const saved = save.countries[c.id];
            if (!saved) continue;
            [c.money, c.taxRate, c.influence, c.tech, c.lastNetIncome, c.alive, c.capital, c.policy, c.policyChangedAt] = saved;
            c.techs = [];
            c.research = null;
            if (saved[12]) {
                c.techs = [...saved[12]];
                c.research = saved[13] ? { ...saved[13] } : null;
            }
            c.debt = saved[14] || 0;
            // логистика раньше была уровнем, а не технологией
            if (c.tech.marchSpeed >= 2) Tech.grant(c, 'logistics1');
            if (c.tech.marchSpeed >= 3) Tech.grant(c, 'logistics2');
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
        if (save.cycle) data.cycle = { ...save.cycle };
        if (save.revolts) data.revolts = structuredClone(save.revolts);
        if (save.operations) data.operations = save.operations.map(o => ({ ...o }));
        data.garrisons = {};
        for (const [id, byCountry] of Object.entries(save.garrisons || {})) {
            for (const [cc, army] of Object.entries(byCountry)) {
                const out = data.emptyArmy();
                save.units.forEach((u, i) => { if (UnitsDB[u]) out[u] = army[i]; });
                (data.garrisons[id] = data.garrisons[id] || {})[cc] = out;
            }
        }
        Council.restore(data, save.council);
        // партии до ядерного оружия: стартовые арсеналы, как в новой игре
        if (save.nuclear) Nuclear.restore(data, save.nuclear); else Nuclear.init(data);
        // хроника: у старых партий графики начинаются с момента загрузки
        if (save.chronicle) data.chronicle = structuredClone(save.chronicle);
        else Score.initChronicle(data);
        if (save.diplomacy) Object.assign(data, structuredClone(save.diplomacy));
        if (save.missions) { data.missions = structuredClone(save.missions); data.stats = { ...save.stats }; }
        else Missions.refill(data);
        if (save.seats) data.seats = structuredClone(save.seats);
        data.winner = save.winner || null;
        // партии до появления счёта: рост считаем с момента загрузки
        if (save.scoreStart) data.scoreStart = { ...save.scoreStart };
        else Score.init(data);
        if (save.net) data.net = structuredClone(save.net);
        data.hotseat = save.hotseat ? { done: [...save.hotseat.done] } : null;
        return data;
    }

    // Карту перерезали (настоящие границы, другое число областей) — партию
    // прежней карты перекладываем на новую, ничего больше не трогая: игроки
    // сетевой кампании, дипломатия, наука остаются как были. Новая область
    // берёт владельца, лояльность и волнения той прежней, где лежит её центр;
    // армия, постройки, стройки и союзные войска прежней области переходят
    // к новой, где лежит центр прежней (RegionsRemap из генератора карты).
    static remapSave(game, remap) {
        const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
        if (!isObj(game) || !isObj(game.regions) || !Array.isArray(game.units)) return game;
        const heir = id => remap.heirs[id] || id;
        const source = id => remap.sources[id] || id;
        const old = game.regions;
        const units = game.units.length;
        const plus = (a, b) => a.map((n, i) => n + (Number.isSafeInteger(b[i]) ? b[i] : 0));

        // что уходит к наследнице: армия и постройки
        const armies = {}, builds = {}, heirsOf = {};
        for (const [id, r] of Object.entries(old)) {
            const to = heir(id);
            if (!Array.isArray(r) || !RegionsDB[to]) continue;
            (heirsOf[to] = heirsOf[to] || []).push(id);
            if (Array.isArray(r[1])) armies[to] = plus(armies[to] || new Array(units).fill(0), r[1]);
            if (isObj(r[5])) {
                const b = builds[to] = builds[to] || {};
                for (const key of Object.keys(DEVELOPMENT)) b[key] = Math.min(5, (b[key] || 0) + (Number.isSafeInteger(r[5][key]) ? r[5][key] : 0));
            }
        }
        const regions = {};
        for (const [id, base] of Object.entries(RegionsDB)) {
            const from = old[source(id)];
            if (!Array.isArray(from)) continue;
            // область осталась собой — переносим как есть
            if (source(id) === id && heir(id) === id && (heirsOf[id] || []).length === 1) { regions[id] = from; continue; }
            const dev = { industry: 0, agro: 0, oil: 0, infra: 0, ...(builds[id] || {}) };
            const res = { oil: base.oil, agro: base.agro, industry: base.industry };
            for (const [key, plan] of Object.entries(DEVELOPMENT)) if (plan.resource) res[plan.resource] += dev[key] * plan.gain;
            regions[id] = [from[0], armies[id] || new Array(units).fill(0), from[2], from[3], res, dev, base.population, from[7] || 0];
        }
        game.regions = regions;

        // столица — область со столичным городом, если она вышла из прежней
        // столичной; иначе наследница прежней; иначе самая населённая своя
        for (const [cc, c] of Object.entries(isObj(game.countries) ? game.countries : {})) {
            if (!Array.isArray(c) || !c[6]) continue;
            const city = CitiesDB.find(x => x.cc === cc && x.isCapital);
            const to = city && regions[city.regionId] && regions[city.regionId][0] === cc && source(city.regionId) === c[6] ? city.regionId : heir(c[6]);
            if (regions[to] && regions[to][0] === cc) { c[6] = to; continue; }
            const mine = Object.keys(regions).filter(id => regions[id][0] === cc);
            c[6] = mine.length ? mine.reduce((a, b) => (RegionsDB[b].population > RegionsDB[a].population ? b : a)) : null;
        }
        const moveKeys = (obj, merge) => {
            const out = {};
            for (const [id, v] of Object.entries(obj)) {
                const to = heir(id);
                if (!RegionsDB[to]) continue;
                out[to] = to in out ? merge(out[to], v) : v;
            }
            return out;
        };
        if (isObj(game.garrisons)) game.garrisons = moveKeys(game.garrisons, (a, b) => {
            const out = { ...a };
            for (const [cc, army] of Object.entries(b)) out[cc] = out[cc] && Array.isArray(army) ? plus(out[cc], army) : army;
            return out;
        });
        if (isObj(game.revolts)) game.revolts = moveKeys(game.revolts, a => a);
        // деньги, отданные за сорванную стройку и приказы хода, — назад
        const refund = (cc, money, influence = 0) => {
            const c = isObj(game.countries) && game.countries[cc];
            if (!Array.isArray(c)) return;
            if (Number.isFinite(money) && money > 0) c[0] += money;
            if (Number.isFinite(influence) && influence > 0) c[2] = Math.min(RULES.INFLUENCE_MAX, c[2] + influence);
        };
        if (Array.isArray(game.projects)) game.projects = game.projects.map(p => ({ ...p, regionId: heir(p.regionId) })).filter(p => {
            if (regions[p.regionId] && regions[p.regionId][0] === p.country) return true;
            refund(p.country, p.cost);
            return false;
        });
        if (isObj(game.orders)) for (const [type, list] of Object.entries(game.orders)) {
            if (!Array.isArray(list)) continue;
            for (const o of list) if (o) refund(o.country, type === 'recon' || type === 'recruitment' ? o.cost : o.transportCost, o.transportInfluence);
        }
        if (Array.isArray(game.operations)) game.operations = game.operations.map(o => ({ ...o, target: heir(o.target) }));
        // решения со ссылками на области; сделки с областями — отбрасываем
        const decisions = list => (Array.isArray(list) ? list : []).filter(x => !(x && x.type === 'trade')).map(x => {
            if (x && x.type === 'rebels') return { ...x, region: heir(x.region) };
            if (x && x.type === 'event' && x.ctx && x.ctx.region) return { ...x, ctx: { ...x.ctx, region: heir(x.ctx.region) } };
            return x;
        });
        game.decisions = decisions(game.decisions);
        if (isObj(game.seats)) for (const seat of Object.values(game.seats)) if (isObj(seat)) seat.decisions = decisions(seat.decisions);
        // приказы хода отдавались по прежним областям
        game.orders = { recruitment: [], recon: [], movements: [], attacks: [] };
        return game;
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
                    if (count(o[3][key])) c[3][key] = clamp(o[3][key], 1, key === 'marchSpeed' ? 3 : MODERNIZATION.MAX);
                }
                if (finite(o[4])) c[4] = Math.round(o[4]);
                if (RegionsDB[o[6]]) c[6] = o[6];
                if (POLICIES[o[7]]) c[7] = o[7];
                if (Number.isInteger(o[8])) c[8] = o[8];
                if (GameData.validEconomy(o[9], o[10], o[11])) { c[9] = { ...o[9] }; c[10] = { ...o[10] }; c[11] = { ...o[11] }; }
                if (GameData.validTechs(o[12], o[13])) { c[12] = [...o[12]]; c[13] = o[13] ? { ...o[13] } : null; }
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
        if (Array.isArray(old.decisions)) save.decisions = old.decisions.filter(x => x && GameData.DECISIONS.includes(x.type) && CountriesDB[x.from]);
        if (Diplomacy.valid(old.diplomacy)) save.diplomacy = structuredClone(old.diplomacy);
        if (Missions.valid(old.missions, old.stats)) { save.missions = structuredClone(old.missions); save.stats = { ...old.stats }; }
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

// Предложения, которые ждут ответа игрока.
GameData.DIPLO_OFFERS = ['peace', 'deal', 'pact', 'alliance'];
GameData.DECISIONS = ['peace', 'deal', 'pact', 'alliance', 'event', 'rebels', 'trade', 'council'];
GameData.SEAT_FIELDS = ['missions', 'stats', 'decisions', 'history', 'campaign'];
// Команды игрока → номер аргумента со страной (−1 — страна не указывается).
GameData.COMMANDS = {
    queueRecruitment: 3, queueMovement: 3, queueAttack: 3, queueRecon: -1, cancelOwnOrder: -1,
    disband: 2, invest: 2, cancelProject: 1, integrateTerritory: -1, sendGarrison: 3, recallGarrison: 1,
    setTrade: 0, research: 0, startResearch: 0, cancelResearch: 0, setPolicy: 0, setTaxRate: 0,
    declareWar: 0, proposePeace: -1, diplomacyAction: -1, answerDecision: -1,
    nuclearBuild: 1, nuclearCancel: 0, nuclearStrike: 2,
    claimMission: -1, skipMission: -1, transfer: -1, cedeRegion: -1, borrow: 1, repay: 1, suppressRevolt: -1, appeaseRevolt: -1, proposeTrade: -1, giveTroops: 3, planOperation: -1,
};
