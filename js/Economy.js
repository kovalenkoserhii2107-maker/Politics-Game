// =====================================================================
// ЭКОНОМИКА: еда, энергия, товары, склады и мировой рынок
//
// Каждая страна за ход производит и потребляет три ресурса. Излишек
// сначала пополняет склад (запас на несколько недель), остальное
// продаётся на мировом рынке. Нехватка покрывается складом, затем
// покупкой. Чего не хватило — дефицит: голод, простой заводов, недовольство.
//
// Рынок общий для всех стран и сводится честно: продано ровно столько,
// сколько куплено, и деньги переходят от покупателей к продавцам. Цена
// следующего хода растёт, когда спрос выше предложения, и падает при
// избытке — поэтому бесконечно богатеть на одном товаре не выйдет.
// =====================================================================

const RESOURCES = {
    food:   { name: 'Еда',     icon: '🌾', price: 6000, unit: 'ед.' },
    energy: { name: 'Энергия', icon: '⚡', price: 4000, unit: 'ед.' },
    goods:  { name: 'Товары',  icon: '📦', price: 8000, unit: 'ед.' },
};

const ECONOMY = {
    // еда: агрокомплекс + натуральное хозяйство населения; едят жители и армия
    FOOD_PER_AGRO: 0.5,
    FOOD_PER_MPOP: 2,
    FOOD_NEED_PER_MPOP: 4,
    FOOD_PER_UNIT: 0.05,
    // энергия: нефть и энергокомплексы + местные электростанции при заводах
    ENERGY_PER_OIL: 12,
    ENERGY_PER_INDUSTRY: 0.25,
    ENERGY_NEED_PER_INDUSTRY: 0.5,
    ENERGY_NEED_PER_MPOP: 0.3,
    ENERGY_PER_UNIT: { infantry: 0.01, tanks: 0.2, artillery: 0.05, aviation: 0.5, antiair: 0.05 },
    // товары: заводы (нужна энергия) + ремесло населения; покупают жители
    GOODS_PER_INDUSTRY: 0.6,
    GOODS_PER_MPOP: 0.6,
    GOODS_NEED_PER_MPOP: 1.5,
    // склад: сколько недель потребления держать и сколько влезает
    STOCK_TARGET: 4,
    STOCK_CAP: 12,
    RESTOCK: 0.25,              // какую часть недостачи склада докупать за ход
    // цены: коридор вокруг базовой и скорость, с которой они догоняют рынок
    PRICE_MIN: 0.5,
    PRICE_MAX: 2.5,
    PRICE_SMOOTH: 0.35,
    // последствия
    GROWTH: 0.0004,             // рост населения за ход в сытости и достатке (~2% в год)
    HUNGER_DECLINE: 0.006,      // убыль населения за ход при полном голоде
    WAR_TRADE: 0.6,             // воюющая страна торгует только этой долей объёма (блокада)
    HUNGER_LOYALTY: 0.4,        // падение целевой лояльности при полном голоде
    HUNGER_DESERTION: 0.1,      // доля армии, уходящей за ход при полном голоде
    GOODS_LOYALTY: 0.15,        // недовольство без товаров
    GOODS_TAX: 0.25,            // без товаров люди меньше покупают — и платят меньше налогов
};

const TRADE_MODES = {
    sell: 'Продавать излишки',
    keep: 'Копить на складе',
};

class Economy {
    static initCountry(country) {
        country.stock = country.stock || { food: 0, energy: 0, goods: 0 };
        country.trade = country.trade || { food: 'sell', energy: 'sell', goods: 'sell' };
    }

    static initMarket() {
        const market = {};
        for (const [key, res] of Object.entries(RESOURCES)) market[key] = res.price;
        return market;
    }

    // Производство и потребление страны за ход, без рынка.
    // energySat — доля обеспеченности энергией: без неё заводы простаивают.
    static flows(data, countryId, energySat = 1) {
        const country = data.countries[countryId];
        const policy = POLICIES[country.policy] || POLICIES.balanced;
        // Нелояльная область работает вполсилы: захваченные земли и
        // недовольство бьют по производству.
        let popM = 0, agro = 0, oil = 0, industry = 0;
        for (const region of data.getCountryRegions(countryId)) {
            const work = 0.5 + 0.5 * region.loyalty;
            popM += region.population / 1e6;
            agro += region.resources.agro * work;
            oil += region.resources.oil * work;
            industry += region.resources.industry * work;
        }
        let armyFood = 0, armyEnergy = 0;
        for (const region of data.getCountryRegions(countryId)) {
            for (const [unitId, count] of Object.entries(region.army)) {
                armyFood += count * ECONOMY.FOOD_PER_UNIT;
                armyEnergy += count * (ECONOMY.ENERGY_PER_UNIT[unitId] || 0);
            }
        }
        const factories = industry * ECONOMY.GOODS_PER_INDUSTRY * policy.industry;
        return {
            popM,
            food: {
                prod: agro * ECONOMY.FOOD_PER_AGRO + popM * ECONOMY.FOOD_PER_MPOP,
                need: popM * ECONOMY.FOOD_NEED_PER_MPOP + armyFood,
            },
            energy: {
                prod: oil * ECONOMY.ENERGY_PER_OIL + industry * ECONOMY.ENERGY_PER_INDUSTRY,
                need: industry * ECONOMY.ENERGY_NEED_PER_INDUSTRY + popM * ECONOMY.ENERGY_NEED_PER_MPOP + armyEnergy,
            },
            goods: {
                prod: factories * Math.min(1, Math.max(0, energySat)) + popM * ECONOMY.GOODS_PER_MPOP,
                need: popM * ECONOMY.GOODS_NEED_PER_MPOP,
            },
        };
    }

    // Прогноз торговли по текущим ценам — для бюджета и стартового экрана:
    // склад считается полным, излишек продаётся, нехватка докупается.
    static projectTrade(data, countryId) {
        const country = data.countries[countryId];
        Economy.initCountry(country);
        const f = Economy.flows(data, countryId);
        let sales = 0, purchases = 0;
        const lines = {};
        for (const key of Object.keys(RESOURCES)) {
            const net = f[key].prod - f[key].need;
            const price = data.market[key];
            let value = 0;
            if (net > 0 && country.trade[key] === 'sell') value = net * price;
            else if (net < 0) value = net * price;
            if (value > 0) sales += value; else purchases -= value;
            lines[key] = { prod: f[key].prod, need: f[key].need, net, value };
        }
        return { sales, purchases, lines };
    }

    // Один ход рынка для всех стран. Меняет склады и цены; возвращает по
    // каждой стране деньги от торговли и обеспеченность ресурсами.
    static runMarkets(data) {
        const countries = Object.values(data.countries)
            .filter(c => c.alive && data.regionsByCountry[c.id].length);
        const out = {};
        const base = {};
        for (const c of countries) {
            Economy.initCountry(c);
            out[c.id] = { money: 0, sat: {}, res: {} };
            base[c.id] = Economy.flows(data, c.id);
        }

        const clear = (key, flowOf) => {
            const price = data.market[key];
            const book = [];
            let offers = 0, bids = 0;
            for (const c of countries) {
                const f = flowOf(c);
                const reach = data.enemiesOf(c.id).length ? ECONOMY.WAR_TRADE : 1;
                const cap = f.need * ECONOMY.STOCK_CAP;
                const target = f.need * ECONOMY.STOCK_TARGET;
                const entry = { c, f, cap, offer: 0, bid: 0, deficit: 0 };
                let net = f.prod - f.need;
                if (net >= 0) {
                    const toStock = Math.min(net, Math.max(0, target - c.stock[key]));
                    c.stock[key] += toStock;
                    net -= toStock;
                    if (c.trade[key] === 'sell') {
                        entry.offer = net * reach;
                        c.stock[key] = Math.min(cap, c.stock[key] + net - entry.offer);
                    } else c.stock[key] = Math.min(cap, c.stock[key] + net);
                } else {
                    // Нехватку покупаем каждый ход (и понемногу пополняем склад),
                    // а склад — страховка на случай, если купить не вышло.
                    entry.deficit = -net;
                    const restock = Math.max(0, target - c.stock[key]) * ECONOMY.RESTOCK;
                    const afford = Math.max(0, c.money + out[c.id].money) / price;
                    entry.bid = Math.min((entry.deficit + restock) * reach, afford);
                }
                offers += entry.offer;
                bids += entry.bid;
                book.push(entry);
            }
            const sellFill = offers > 0 ? Math.min(1, bids / offers) : 0;
            const buyFill = bids > 0 ? Math.min(1, offers / bids) : 0;
            for (const e of book) {
                const r = out[e.c.id];
                const sold = e.offer * sellFill, bought = e.bid * buyFill;
                r.money += (sold - bought) * price;
                // непроданное — на склад, сколько влезет
                e.c.stock[key] = Math.min(Math.max(e.cap, e.c.stock[key]), e.c.stock[key] + e.offer - sold);
                let shortage = 0;
                if (e.deficit) {
                    const extra = bought - e.deficit;
                    if (extra >= 0) e.c.stock[key] = Math.min(e.cap, e.c.stock[key] + extra);
                    else {
                        const take = Math.min(e.c.stock[key], -extra);
                        e.c.stock[key] -= take;
                        shortage = -extra - take;
                    }
                }
                r.sat[key] = e.f.need > 0 ? Math.max(0, Math.min(1, 1 - shortage / e.f.need)) : 1;
                r.res[key] = { prod: e.f.prod, need: e.f.need, sold, bought, shortage, stock: e.c.stock[key] };
            }
            data.marketStats = data.marketStats || {};
            data.marketStats[key] = { offers, bids, traded: Math.min(offers, bids), price };
            // Цена следующего хода: спрос выше предложения — дорожает.
            const pressure = offers > 0 ? bids / offers : (bids > 0 ? ECONOMY.PRICE_MAX ** 2 : 1);
            const factor = Math.min(ECONOMY.PRICE_MAX, Math.max(ECONOMY.PRICE_MIN, Math.sqrt(pressure)));
            const next = price + (RESOURCES[key].price * factor - price) * ECONOMY.PRICE_SMOOTH;
            data.market[key] = Math.max(1, Math.round(next));
        };

        // Энергия первой: от неё зависит, сколько товаров дадут заводы.
        clear('energy', c => base[c.id].energy);
        clear('goods', c => Economy.flows(data, c.id, out[c.id].sat.energy).goods);
        clear('food', c => base[c.id].food);
        for (const r of Object.values(out)) r.money = Math.round(r.money);
        return out;
    }

    // Сколько область производит за ход (заводы — при полной энергии).
    static regionOutput(data, region) {
        const country = data.countries[region.owner];
        const policy = POLICIES[country.policy] || POLICIES.balanced;
        const work = 0.5 + 0.5 * region.loyalty;
        const popM = region.population / 1e6;
        return {
            food: region.resources.agro * work * ECONOMY.FOOD_PER_AGRO + popM * ECONOMY.FOOD_PER_MPOP,
            energy: region.resources.oil * work * ECONOMY.ENERGY_PER_OIL + region.resources.industry * work * ECONOMY.ENERGY_PER_INDUSTRY,
            goods: region.resources.industry * work * ECONOMY.GOODS_PER_INDUSTRY * policy.industry + popM * ECONOMY.GOODS_PER_MPOP,
        };
    }

    // Сколько денег в ход принесёт проект по текущим ценам (для ИИ и подсказки).
    static projectValue(data, regionId, kind) {
        const region = data.regions[regionId], plan = DEVELOPMENT[kind];
        if (!region || !plan) return 0;
        const country = data.countries[region.owner];
        const policy = POLICIES[country.policy] || POLICIES.balanced;
        const work = 0.5 + 0.5 * region.loyalty;
        const p = data.market;
        if (kind === 'agro') return plan.gain * work * ECONOMY.FOOD_PER_AGRO * p.food;
        if (kind === 'oil') return plan.gain * work * ECONOMY.ENERGY_PER_OIL * p.energy;
        return plan.gain * work * (ECONOMY.GOODS_PER_INDUSTRY * policy.industry * p.goods
            + (ECONOMY.ENERGY_PER_INDUSTRY - ECONOMY.ENERGY_NEED_PER_INDUSTRY) * p.energy);
    }

    // Доля налогов, которую платят при нехватке товаров.
    static taxFactor(country) {
        const sat = country.economy ? country.economy.sat.goods : 1;
        return 1 - ECONOMY.GOODS_TAX * (1 - sat);
    }

    // Насколько голод и нехватка товаров опускают целевую лояльность.
    static loyaltyPenalty(country) {
        if (!country.economy) return 0;
        const { food, goods } = country.economy.sat;
        return (1 - food) * ECONOMY.HUNGER_LOYALTY + (1 - goods) * ECONOMY.GOODS_LOYALTY;
    }

    // Население растёт в сытости и достатке и убывает при голоде.
    static populationChange(country) {
        if (!country.economy) return 0;
        const { food, goods } = country.economy.sat;
        if (food >= 0.999) return ECONOMY.GROWTH * (0.5 + 0.5 * goods);
        return -(1 - food) * ECONOMY.HUNGER_DECLINE;
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Economy, RESOURCES, ECONOMY, TRADE_MODES };
