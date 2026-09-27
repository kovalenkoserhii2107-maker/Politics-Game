// =====================================================================
// СДЕЛКИ МЕЖДУ ИГРОКАМИ
//
// Пакет «я даю — ты даёшь»: деньги, запасы со склада, приграничные
// области, а сверху — мир и договоры. Второй игрок видит сделку целиком
// после хода и принимает её, отклоняет или отвечает встречной. При
// согласии всё исполняется разом — если к этому моменту кто-то уже не
// может выполнить свою часть, сделка срывается целиком.
// =====================================================================
const TRADE = {
    KEYS: ['money', 'food', 'energy', 'goods'],
    TREATIES: ['peace', 'deal', 'pact', 'alliance'],
    MAX_REGIONS: 5,
};

const TREATY_NAMES = { peace: 'мир', deal: 'торговый договор', pact: 'пакт о ненападении', alliance: 'оборонительный союз' };

class Trade {
    static emptySide() {
        return { money: 0, food: 0, energy: 0, goods: 0, regions: [] };
    }

    // Приводим к ровному виду: лишнее и отрицательное — прочь.
    static normalize(offer) {
        const side = s => {
            const out = Trade.emptySide();
            if (!s || typeof s !== 'object') return out;
            for (const key of TRADE.KEYS) {
                const n = Number(s[key]);
                out[key] = Number.isFinite(n) && n > 0 ? (key === 'money' ? Math.round(n) : Math.round(n * 10) / 10) : 0;
            }
            out.regions = Array.isArray(s.regions) ? [...new Set(s.regions.filter(id => typeof id === 'string' && RegionsDB[id]))].slice(0, TRADE.MAX_REGIONS) : [];
            return out;
        };
        const o = offer && typeof offer === 'object' ? offer : {};
        return {
            give: side(o.give), get: side(o.get),
            treaties: Array.isArray(o.treaties) ? [...new Set(o.treaties.filter(t => TRADE.TREATIES.includes(t)))] : [],
        };
    }

    static isEmpty(offer) {
        const blank = s => TRADE.KEYS.every(k => !s[k]) && !s.regions.length;
        return blank(offer.give) && blank(offer.get) && !offer.treaties.length;
    }

    // Какие области можно отдать: свои, не столица, на границе с партнёром.
    static tradableRegions(d, owner, partner) {
        return d.getCountryRegions(owner).filter(r => r.id !== d.countries[owner].capital
            && !d.revolts[r.id]
            && d.getNeighbors(r.id).some(id => d.regions[id] && d.regions[id].owner === partner));
    }

    // Может ли сторона выполнить свою часть; null — всё в порядке.
    static sideProblem(d, owner, partner, side) {
        const c = d.countries[owner];
        if (!c || !c.alive) return `${c ? c.name : owner} выбыла из игры`;
        if (side.money > Math.max(0, c.money)) return `у ${c.name} не хватает денег`;
        Economy.initCountry(c);
        for (const key of Object.keys(RESOURCES)) {
            if (side[key] > (c.stock[key] || 0) + 1e-9) return `у ${c.name} на складе мало: ${RESOURCES[key].name.toLowerCase()}`;
        }
        const allowed = new Set(Trade.tradableRegions(d, owner, partner).map(r => r.id));
        for (const id of side.regions) if (!allowed.has(id)) return `область ${d.regions[id].name} уже нельзя передать`;
        return null;
    }

    static problem(d, from, to, offer) {
        if (!d.isHuman(to) || from === to) return 'Сделки — только между игроками';
        if (Trade.isEmpty(offer)) return 'Сделка пустая';
        const atWar = d.isAtWar(from, to);
        for (const t of offer.treaties) {
            if (t === 'peace' && !atWar) return 'Мир не нужен — вы не воюете';
            if (t !== 'peace' && atWar && !offer.treaties.includes('peace')) return 'Договоры — только вместе с миром';
            if (t === 'deal' && Diplomacy.hasDeal(d, from, to)) return 'Торговый договор уже есть';
            if (t === 'pact' && Diplomacy.pactLeft(d, from, to)) return 'Пакт уже действует';
            if (t === 'alliance' && Diplomacy.isAllied(d, from, to)) return 'Уже союзники';
        }
        if (atWar && !offer.treaties.includes('peace') && (offer.give.regions.length || offer.get.regions.length)) return 'Области меняют только вместе с миром';
        return Trade.sideProblem(d, from, to, offer.give) || Trade.sideProblem(d, to, from, offer.get);
    }

    // Всё разом: сначала мир, потом ценности, области и договоры.
    static execute(d, from, to, offer) {
        if (offer.treaties.includes('peace') && d.isAtWar(from, to)) d.makePeace(from, to);
        const move = (a, b, side) => {
            const ca = d.countries[a], cb = d.countries[b];
            ca.money -= side.money; cb.money += side.money;
            Economy.initCountry(ca); Economy.initCountry(cb);
            for (const key of Object.keys(RESOURCES)) {
                ca.stock[key] = Math.round((ca.stock[key] - side[key]) * 10) / 10;
                cb.stock[key] = Math.round((cb.stock[key] + side[key]) * 10) / 10;
            }
            for (const id of side.regions) d.handoverRegion(id, a, b);
        };
        move(from, to, offer.give);
        move(to, from, offer.get);
        for (const t of offer.treaties) if (t !== 'peace') Diplomacy.sign(d, from, to, t);
        Diplomacy.changeRelation(d, from, to, 10);
    }

    // Строки для окна решения и отчёта.
    static describeSide(d, side) {
        const parts = [];
        if (side.money) parts.push(`💰 $${(side.money / 1e6).toFixed(1)}M`);
        for (const key of Object.keys(RESOURCES)) if (side[key]) parts.push(`${RESOURCES[key].icon} ${side[key]}`);
        for (const id of side.regions) parts.push(`🗺️ ${d.regions[id].name}`);
        return parts.length ? parts.join(', ') : 'ничего';
    }

    static describe(d, from, to, offer) {
        const treaties = offer.treaties.map(t => TREATY_NAMES[t]).join(', ');
        return {
            give: Trade.describeSide(d, offer.give),
            get: Trade.describeSide(d, offer.get),
            treaties,
        };
    }

    // Встречная: стороны меняются местами, договоры те же.
    static reverse(offer) {
        return { give: { ...offer.get, regions: [...offer.get.regions] }, get: { ...offer.give, regions: [...offer.give.regions] }, treaties: [...offer.treaties] };
    }

    static validDecision(x) {
        const o = Trade.normalize(x.offer);
        return !!x.offer && JSON.stringify(o) === JSON.stringify(x.offer);
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Trade, TRADE, TREATY_NAMES };
