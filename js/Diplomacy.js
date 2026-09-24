// =====================================================================
// ДИПЛОМАТИЯ: отношения, договоры, союзы, дань
//
// Отношения между странами — число от −100 до +100. Их двигают подарки,
// договоры, войны и захваты. От отношений зависит, примет ли страна
// предложение игрока, нападёт ли на него и предложит ли что-то сама.
//
// Договоры (ключ — пара стран, как у войн; значение — ход подписания,
// может быть 0, поэтому наличие проверяем через `in`):
//   deals     — торговый договор: продажи на рынке дороже, закупки дешевле;
//   pacts     — пакт о ненападении до указанного хода: воевать нельзя;
//   alliances — оборонительный союз: на союзника напали — союзники вступают
//               в войну против нападающего.
// =====================================================================
const DIPLOMACY = {
    GIFT_MIN: 1e6, GIFT_MAX: 20e6, GIFT_RELATION: 20,
    DEAL_COST: 10, DEAL_BONUS: 0.1, DEAL_MAX: 3, DEAL_MIN_RELATION: 0,
    PACT_COST: 15, PACT_TURNS: 20, PACT_MIN_RELATION: -20,
    ALLIANCE_COST: 25, ALLIANCE_MIN_RELATION: 40,
    TRIBUTE_COST: 10, TRIBUTE_RATIO: 3, TRIBUTE_TURNS: 3, TRIBUTE_RELATION: -30,
    BREAK_RELATION: -25, WAR_RELATION: -80, PEACE_RELATION: -40, CONQUEST_RELATION: -15,
    DECLINE_RELATION: -5,
};

const DIPLO_LEVELS = [
    [60, 'Союзнические', 'pos'], [25, 'Дружелюбные', 'pos'], [-25, 'Нейтральные', ''],
    [-60, 'Прохладные', 'neg'], [-101, 'Враждебные', 'neg'],
];

class Diplomacy {
    static init(d) {
        d.relations = d.relations || {};
        d.deals = d.deals || {};
        d.pacts = d.pacts || {};
        d.alliances = d.alliances || {};
    }

    static relation(d, a, b) { return (d.relations && d.relations[d.pairKey(a, b)]) || 0; }

    static changeRelation(d, a, b, delta) {
        if (a === b) return;
        const key = d.pairKey(a, b);
        d.relations[key] = Math.max(-100, Math.min(100, Math.round((d.relations[key] || 0) + delta)));
        if (d.relations[key] === 0) delete d.relations[key];
    }

    static level(value) { return DIPLO_LEVELS.find(([min]) => value >= min); }

    static hasDeal(d, a, b) { return d.pairKey(a, b) in d.deals; }
    static isAllied(d, a, b) { return d.pairKey(a, b) in d.alliances; }
    static pactLeft(d, a, b) {
        const until = d.pacts[d.pairKey(a, b)];
        return until && until > d.turn ? until - d.turn : 0;
    }

    static partners(d, cc, table) {
        return Object.keys(table).map(k => k.split('|')).filter(p => p.includes(cc)).map(p => (p[0] === cc ? p[1] : p[0]));
    }
    static allies(d, cc) { return Diplomacy.partners(d, cc, d.alliances).filter(x => d.countries[x] && d.countries[x].alive); }
    static dealCount(d, cc) { return Diplomacy.partners(d, cc, d.deals).length; }
    static tradeBonus(d, cc) { return Math.min(DIPLOMACY.DEAL_MAX, Diplomacy.dealCount(d, cc)) * DIPLOMACY.DEAL_BONUS; }

    // Подарок — неделя дохода получателя, но не меньше $1M и не больше $20M.
    static giftCost(d, target) {
        const income = d.countryBalance(target).tax;
        return Math.round(Math.min(DIPLOMACY.GIFT_MAX, Math.max(DIPLOMACY.GIFT_MIN, income)) / 1e5) * 1e5;
    }

    static tributeAmount(d, target) {
        const t = d.countries[target];
        const want = Math.max(1e6, d.countryBalance(target).tax * DIPLOMACY.TRIBUTE_TURNS);
        return Math.round(Math.max(0, Math.min(want, t.money)) / 1e5) * 1e5;
    }

    // Что думает страна ai о предложении kind от other. reason — объяснение
    // для игрока, likely — согласится ли (показываем заранее: без обмана).
    static willAccept(d, ai, other, kind) {
        const rel = Diplomacy.relation(d, ai, other);
        const power = cc => Math.max(1, d.calculateMilitaryPower(cc));
        const ratio = power(other) / power(ai);   // во сколько раз предлагающий сильнее
        if (d.isAtWar(ai, other)) return { likely: false, reason: 'Вы воюете' };
        if (kind === 'deal') {
            if (rel < DIPLOMACY.DEAL_MIN_RELATION) return { likely: false, reason: 'Нужны отношения от 0' };
            return { likely: true, reason: 'Выгодно обеим сторонам' };
        }
        if (kind === 'pact') {
            if (rel < DIPLOMACY.PACT_MIN_RELATION) return { likely: false, reason: 'Слишком плохие отношения' };
            if (ratio < 1 / 2 && rel < 20) return { likely: false, reason: 'Они сильнее и не хотят связывать себе руки' };
            return { likely: true, reason: 'Мир на границе выгоден' };
        }
        if (kind === 'alliance') {
            if (rel < DIPLOMACY.ALLIANCE_MIN_RELATION) return { likely: false, reason: `Нужны отношения от +${DIPLOMACY.ALLIANCE_MIN_RELATION}` };
            if (!Diplomacy.hasDeal(d, ai, other) && !Diplomacy.pactLeft(d, ai, other)) return { likely: false, reason: 'Сначала торговый договор или пакт' };
            const common = d.enemiesOf(ai).some(e => d.enemiesOf(other).includes(e));
            if (!common && ratio < 0.5) return { likely: false, reason: 'Вы для них слишком слабый союзник' };
            return { likely: true, reason: common ? 'Общий враг' : 'Надёжный партнёр' };
        }
        if (kind === 'tribute') {
            if (ratio < DIPLOMACY.TRIBUTE_RATIO) return { likely: false, reason: `Заплатят, только если вы сильнее в ${DIPLOMACY.TRIBUTE_RATIO} раза` };
            return { likely: true, reason: 'Боятся вашей армии' };
        }
        return { likely: true, reason: '' };
    }

    // --- действия игрока (или ИИ) ------------------------------------------
    static gift(d, from, to) {
        const cost = Diplomacy.giftCost(d, to);
        const giver = d.countries[from];
        if (giver.money < cost) return { ok: false, reason: `Нужно ${Math.round(cost / 1e5) / 10}M` };
        giver.money -= cost;
        d.countries[to].money += cost;
        const rel = Diplomacy.relation(d, from, to);
        // чем лучше отношения, тем меньше даёт очередной подарок
        const gain = Math.max(3, Math.round(DIPLOMACY.GIFT_RELATION * (1 - Math.max(0, rel) / 100)));
        Diplomacy.changeRelation(d, from, to, gain);
        return { ok: true, cost, gain };
    }

    static propose(d, from, to, kind) {
        const cost = { deal: DIPLOMACY.DEAL_COST, pact: DIPLOMACY.PACT_COST, alliance: DIPLOMACY.ALLIANCE_COST }[kind];
        const c = d.countries[from];
        if (!d.countries[to] || !d.countries[to].playable || !d.countries[to].alive) return { ok: false, reason: 'Нельзя' };
        if (kind === 'deal' && Diplomacy.hasDeal(d, from, to)) return { ok: false, reason: 'Договор уже есть' };
        if (kind === 'deal' && Diplomacy.dealCount(d, from) >= DIPLOMACY.DEAL_MAX) return { ok: false, reason: `Не больше ${DIPLOMACY.DEAL_MAX} торговых договоров` };
        if (kind === 'pact' && Diplomacy.pactLeft(d, from, to)) return { ok: false, reason: 'Пакт уже действует' };
        if (kind === 'alliance' && Diplomacy.isAllied(d, from, to)) return { ok: false, reason: 'Уже союзники' };
        if (c.influence < cost) return { ok: false, reason: `Нужно ${cost} влияния` };
        const answer = Diplomacy.willAccept(d, to, from, kind);
        c.influence -= cost;
        if (!answer.likely) {
            Diplomacy.changeRelation(d, from, to, DIPLOMACY.DECLINE_RELATION);
            return { ok: true, accepted: false, reason: answer.reason };
        }
        Diplomacy.sign(d, from, to, kind);
        return { ok: true, accepted: true };
    }

    static sign(d, a, b, kind) {
        const key = d.pairKey(a, b);
        if (kind === 'deal') { d.deals[key] = d.turn; Diplomacy.changeRelation(d, a, b, 10); }
        if (kind === 'pact') { d.pacts[key] = d.turn + DIPLOMACY.PACT_TURNS; Diplomacy.changeRelation(d, a, b, 10); }
        if (kind === 'alliance') { d.alliances[key] = d.turn; Diplomacy.changeRelation(d, a, b, 20); }
    }

    static cancel(d, a, b, kind) {
        const key = d.pairKey(a, b);
        const table = { deal: d.deals, pact: d.pacts, alliance: d.alliances }[kind];
        if (!table || !(key in table)) return false;
        delete table[key];
        Diplomacy.changeRelation(d, a, b, DIPLOMACY.BREAK_RELATION);
        // разорвавший пакт не может напасть сразу: пара ходов на подготовку
        if (kind === 'pact') d.truces.set(key, Math.max(d.truces.get(key) || 0, d.turn + 2));
        return true;
    }

    static demandTribute(d, from, to) {
        const c = d.countries[from];
        if (c.influence < DIPLOMACY.TRIBUTE_COST) return { ok: false, reason: `Нужно ${DIPLOMACY.TRIBUTE_COST} влияния` };
        if (d.isAtWar(from, to)) return { ok: false, reason: 'Вы воюете' };
        c.influence -= DIPLOMACY.TRIBUTE_COST;
        const answer = Diplomacy.willAccept(d, to, from, 'tribute');
        Diplomacy.changeRelation(d, from, to, DIPLOMACY.TRIBUTE_RELATION);
        if (!answer.likely) return { ok: true, paid: 0, reason: answer.reason };
        const amount = Diplomacy.tributeAmount(d, to);
        d.countries[to].money -= amount;
        c.money += amount;
        return { ok: true, paid: amount };
    }

    // --- реакции на события ----------------------------------------------------
    // Война объявлена: отношения рушатся, союзники обороняющегося вступают в войну.
    static onWar(d, attacker, target) {
        Diplomacy.changeRelation(d, attacker, target, DIPLOMACY.WAR_RELATION);
        // договоры с врагом теряют силу
        const key = d.pairKey(attacker, target);
        delete d.deals[key]; delete d.pacts[key]; delete d.alliances[key];
        const joined = [];
        for (const ally of Diplomacy.allies(d, target)) {
            if (ally === attacker || d.isAtWar(ally, attacker)) continue;
            d.wars.set(d.pairKey(ally, attacker), { start: d.turn, attacker: ally });
            d.truces.delete(d.pairKey(ally, attacker));
            Diplomacy.changeRelation(d, ally, attacker, DIPLOMACY.WAR_RELATION / 2);
            joined.push(ally);
        }
        return joined;
    }

    static onPeace(d, a, b) {
        const key = d.pairKey(a, b);
        d.relations[key] = Math.max(d.relations[key] || 0, DIPLOMACY.PEACE_RELATION);
    }

    static onConquest(d, winner, loser) {
        if (d.countries[loser] && d.countries[loser].playable) Diplomacy.changeRelation(d, winner, loser, DIPLOMACY.CONQUEST_RELATION);
    }

    // Конец хода: отношения понемногу возвращаются к нулю, договоры их
    // укрепляют, истёкшие пакты снимаются.
    static endTurn(d, events) {
        for (const [key, until] of Object.entries(d.pacts)) {
            if (until > d.turn) continue;
            delete d.pacts[key];
            const [a, b] = key.split('|');
            if (a === d.playerCountry || b === d.playerCountry) {
                const other = a === d.playerCountry ? b : a;
                events.push({ type: 'diplomacy', message: `📜 Пакт о ненападении с ${d.countries[other].name} истёк.` });
            }
        }
        for (const key of Object.keys(d.relations)) {
            const [a, b] = key.split('|');
            const rel = d.relations[key];
            let target = 0;
            if (key in d.alliances) target = 100;
            else if (key in d.deals) target = 50;
            if (d.isAtWar(a, b)) target = -100;
            if (rel < target) Diplomacy.changeRelation(d, a, b, 1);
            else if (rel > target) Diplomacy.changeRelation(d, a, b, -1);
        }
        for (const key of [...Object.keys(d.deals), ...Object.keys(d.alliances)]) {
            if (!(key in d.relations)) d.relations[key] = 1;
        }
    }

    static serialize(d) {
        return { relations: { ...d.relations }, deals: { ...d.deals }, pacts: { ...d.pacts }, alliances: { ...d.alliances } };
    }

    static valid(save) {
        if (!save || typeof save !== 'object') return false;
        const pair = key => typeof key === 'string' && key.split('|').length === 2 && key.split('|').every(cc => CountriesDB[cc]);
        const table = (t, check) => t && typeof t === 'object' && Object.entries(t).every(([k, v]) => pair(k) && check(v));
        const int = v => Number.isInteger(v);
        return table(save.relations, v => int(v) && v >= -100 && v <= 100)
            && table(save.deals, int) && table(save.pacts, int) && table(save.alliances, int);
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Diplomacy, DIPLOMACY };
