// =====================================================================
// ЗАИМСТВОВАНИЯ: внутренние облигации и программа МВФ
//
// Банковский кредит (Economy / GameData.borrow) — быстрые деньги под
// проценты каждый ход. Здесь — два других пути, когда казна пустеет:
//
// Облигации внутреннего займа — сумма скромная (до BOND.WEEKS недельных
// налогов), зато платить начинаем только через BOND.GRACE ходов: весь
// накопленный процент и основной долг гасятся ровными долями за BOND.TERM
// ходов. Хороший способ пережить войну и расплатиться после.
//
// МВФ — крупная сумма, но выплаты начинаются со следующего хода и есть
// условия: не начинать новых войн, держать налог не ниже порога, без
// социального курса. Деньги приходят двумя траншами: второй — через
// IMF.TRANCHE_TURNS ходов, если условия соблюдены. Жертве агрессии МВФ
// даёт больше и мягче (только «не начинать войн»), а если ООН уже
// признала агрессора — ещё больше. Самому агрессору МВФ не даёт ничего.
// Нарушил условия — второй транш отменяется, выплаты ускоряются,
// репутация падает, и к МВФ не подступиться IMF.BAN ходов.
// =====================================================================
const BOND = {
    WEEKS: 6,           // в обращении — не больше стольких недельных налогов
    GRACE: 15,          // ходов до начала выплат
    RATE: 0.006,        // процент за ход, копится за отсрочку
    TERM: 10,           // ходов гашения после отсрочки
    MIN: 5e5,
};

const IMF = {
    WEEKS: 20, VICTIM_WEEKS: 30, BRANDED_WEEKS: 40,   // размер программы в недельных налогах
    MIN: 5e6,
    FIRST: 0.6,         // доля первого транша
    TRANCHE_TURNS: 6,
    TERM: 30,           // ходов гашения основного долга
    RATE: 0.003,        // процент за ход на остаток
    TAX_FLOOR: 0.12,
    BROKEN_SPEED: 2,    // во сколько раз ускоряется гашение при нарушении
    BAN: 20,
    INFLUENCE: 10,
    BRANDED_TURNS: 16,  // сколько ходов после резолюции ООН агрессор считается признанным
};

const IMF_CONDITIONS = {
    noWar: { name: 'Не начинать новых войн', short: 'без новых войн' },
    tax: { name: `Налог не ниже ${Math.round(IMF.TAX_FLOOR * 100)}%`, short: `налог ≥ ${Math.round(IMF.TAX_FLOOR * 100)}%` },
    austerity: { name: 'Без социального курса', short: 'без соцкурса' },
};

class Credit {
    static init(d) { d.credit = {}; }

    static of(d, cc) {
        if (!d.credit) d.credit = {};
        return d.credit[cc] || (d.credit[cc] = { bonds: [], imf: null, imfBan: 0, broke: 0 });
    }

    static peek(d, cc) { return (d.credit && d.credit[cc]) || null; }

    // --- агрессор и жертва -------------------------------------------------
    // Кто сейчас напал на cc и война ещё идёт.
    static aggressorAgainst(d, cc) {
        if (!d.un) return null;
        for (const [key, w] of Object.entries(d.un.wars)) {
            if (w.end !== null || w.aggressor === cc || !d.wars.has(key)) continue;
            const [a, b] = key.split('|');
            if (a === cc || b === cc) return w.aggressor;
        }
        return null;
    }

    // Ведёт ли cc начатую им войну.
    static isAggressor(d, cc) {
        if (!d.un) return false;
        for (const [key, w] of Object.entries(d.un.wars)) if (w.end === null && w.aggressor === cc && d.wars.has(key)) return true;
        return false;
    }

    // ООН признала агрессором: санкции, эмбарго, принуждение или осуждение
    // Генассамблеей за последние ходы.
    static branded(d, cc) {
        if (!cc || !d.un) return false;
        if (Council.sanctioned(d, cc) || Council.embargoed(d, cc)) return true;
        return d.un.record.some(r => r.passed && r.target === cc && d.turn - r.turn <= IMF.BRANDED_TURNS
            && ['sanctions', 'embargo', 'enforce', 'condemn'].includes(r.kind));
    }

    static weekTax(d, cc) { return Math.max(0, d.countryBalance(cc).tax); }

    // --- облигации ---------------------------------------------------------
    static bondsOwed(d, cc) {
        const c = Credit.peek(d, cc);
        return c ? c.bonds.reduce((s, b) => s + b.owed, 0) : 0;
    }

    static bondLimit(d, cc) {
        return Math.round(Credit.weekTax(d, cc) * BOND.WEEKS / 1e5) * 1e5;
    }

    static bondRoom(d, cc) { return Math.max(0, Credit.bondLimit(d, cc) - Credit.bondsOwed(d, cc)); }

    static issueBonds(d, cc, amount) {
        const c = d.countries[cc];
        if (d.gameOver || !c || !c.alive || !Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Нельзя' };
        amount = Math.round(Math.min(amount, Credit.bondRoom(d, cc) / (1 + BOND.RATE * BOND.GRACE)) / 1e5) * 1e5;
        if (amount < BOND.MIN) return { ok: false, reason: 'Облигации больше не раскупают: достигнут предел выпуска' };
        const owed = Math.round(amount * (1 + BOND.RATE * BOND.GRACE));
        Credit.of(d, cc).bonds.push({ owed, start: d.turn + BOND.GRACE, pay: Math.ceil(owed / BOND.TERM) });
        c.money += amount;
        return { ok: true, amount, owed, start: d.turn + BOND.GRACE };
    }

    // --- МВФ ------------------------------------------------------------------
    // Что МВФ предложит стране cc сейчас: сумма, условия — или причина отказа.
    static imfOffer(d, cc) {
        const c = d.countries[cc];
        const credit = Credit.peek(d, cc);
        if (!c || !c.alive) return { ok: false, reason: 'Нельзя' };
        if (credit && credit.imf) return { ok: false, reason: 'Программа МВФ уже идёт' };
        if (credit && credit.imfBan > d.turn) return { ok: false, reason: `МВФ не доверяет после нарушения условий: ещё ${credit.imfBan - d.turn} ход.` };
        if (Credit.isAggressor(d, cc) || Council.sanctioned(d, cc)) return { ok: false, reason: 'МВФ не кредитует страну, которая ведёт захватническую войну или под санкциями' };
        const aggressor = Credit.aggressorAgainst(d, cc);
        const branded = Credit.branded(d, aggressor);
        const weeks = aggressor ? (branded ? IMF.BRANDED_WEEKS : IMF.VICTIM_WEEKS) : IMF.WEEKS;
        const total = Math.round(Math.max(IMF.MIN, Credit.weekTax(d, cc) * weeks) / 1e5) * 1e5;
        const conditions = aggressor ? ['noWar'] : ['noWar', 'tax', 'austerity'];
        return { ok: true, total, first: Math.round(total * IMF.FIRST / 1e5) * 1e5, conditions, aggressor, branded, weeks };
    }

    static takeImf(d, cc) {
        if (d.gameOver) return { ok: false, reason: 'Нельзя' };
        const offer = Credit.imfOffer(d, cc);
        if (!offer.ok) return offer;
        const c = d.countries[cc];
        Credit.of(d, cc).imf = {
            total: offer.total, left: offer.first, paid: offer.first,
            second: offer.total - offer.first, trancheAt: d.turn + IMF.TRANCHE_TURNS,
            conditions: offer.conditions, start: d.turn, broken: false,
        };
        c.money += offer.first;
        return { ok: true, amount: offer.first, second: offer.total - offer.first };
    }

    // Нарушения, если бы ход закончился сейчас.
    static imfViolations(d, cc) {
        const credit = Credit.peek(d, cc);
        const p = credit && credit.imf;
        if (!p || p.broken) return [];
        const c = d.countries[cc];
        const out = [];
        if (p.conditions.includes('tax') && c.taxRate < IMF.TAX_FLOOR - 1e-9) out.push('tax');
        if (p.conditions.includes('austerity') && c.policy === 'social') out.push('austerity');
        return out;
    }

    // Объявление войны при программе «без новых войн».
    static onDeclareWar(d, cc, events) {
        const credit = Credit.peek(d, cc);
        const p = credit && credit.imf;
        if (p && !p.broken && p.conditions.includes('noWar')) Credit.breakImf(d, cc, ['noWar'], events);
    }

    static breakImf(d, cc, why, events) {
        const credit = Credit.of(d, cc), p = credit.imf;
        p.broken = true;
        p.second = 0;
        credit.imfBan = d.turn + IMF.BAN;
        const c = d.countries[cc];
        c.influence = Math.max(0, c.influence - IMF.INFLUENCE);
        const target = events || d.diploEvents;
        if (d.isHuman(cc) && target) target.push({ type: 'imf', for: cc, message: `🏦 МВФ заморозил программу: нарушено условие «${why.map(k => IMF_CONDITIONS[k].name.toLowerCase()).join('», «')}». Второй транш отменён, долг гасится вдвое быстрее, влияние −${IMF.INFLUENCE}.` });
    }

    // --- выплаты ----------------------------------------------------------------
    // Сколько уйдёт в этот ход: по облигациям и МВФ.
    static due(d, cc) {
        const credit = Credit.peek(d, cc);
        if (!credit) return { bonds: 0, imf: 0 };
        let bonds = 0;
        for (const b of credit.bonds) if (d.turn >= b.start) bonds += Math.min(b.owed, b.pay);
        let imf = 0;
        const p = credit.imf;
        if (p && p.left > 0) imf = Math.round(Credit.imfPrincipal(p) + p.left * IMF.RATE);
        return { bonds, imf };
    }

    static imfPrincipal(p) {
        return Math.min(p.left, Math.ceil(p.total / IMF.TERM) * (p.broken ? IMF.BROKEN_SPEED : 1));
    }

    // Конец хода: деньги за выплаты уже списаны бюджетом — уменьшаем долги,
    // даём второй транш, проверяем условия.
    static settle(d, cc, events) {
        const credit = Credit.peek(d, cc);
        if (!credit) return;
        for (const b of credit.bonds) if (d.turn >= b.start) b.owed -= Math.min(b.owed, b.pay);
        credit.bonds = credit.bonds.filter(b => b.owed > 0);
        const p = credit.imf;
        if (!p) return;
        if (p.left > 0) p.left -= Credit.imfPrincipal(p);
        const broken = Credit.imfViolations(d, cc);
        if (broken.length) Credit.breakImf(d, cc, broken, events);
        if (!p.broken && p.second > 0 && d.turn >= p.trancheAt) {
            d.countries[cc].money += p.second;
            p.left += p.second;
            p.paid += p.second;
            if (d.isHuman(cc)) events.push({ type: 'imf', for: cc, message: `🏦 МВФ перевёл второй транш: +$${(p.second / 1e6).toFixed(1)}M — условия программы соблюдены.` });
            p.second = 0;
        }
        if (p.left <= 0 && p.second <= 0) {
            credit.imf = null;
            if (d.isHuman(cc)) events.push({ type: 'imf', for: cc, message: '🏦 Программа МВФ закрыта: долг погашен.' });
        }
    }

    // --- сохранение ---------------------------------------------------------
    static serialize(d) { return structuredClone(d.credit || {}); }

    static valid(x) {
        const obj = o => !!o && typeof o === 'object' && !Array.isArray(o);
        const money = n => Number.isFinite(n) && n >= 0;
        const int = n => Number.isInteger(n);
        if (!obj(x)) return false;
        return Object.entries(x).every(([cc, c]) => CountriesDB[cc] && obj(c) && Array.isArray(c.bonds) && int(c.imfBan) && (c.broke === undefined || (int(c.broke) && c.broke >= 0))
            && c.bonds.every(b => obj(b) && money(b.owed) && int(b.start) && money(b.pay))
            && (c.imf === null || (obj(c.imf) && money(c.imf.total) && money(c.imf.left) && money(c.imf.paid) && money(c.imf.second)
                && int(c.imf.trancheAt) && int(c.imf.start) && typeof c.imf.broken === 'boolean'
                && Array.isArray(c.imf.conditions) && c.imf.conditions.every(k => IMF_CONDITIONS[k]))));
    }

    static restore(d, x) { d.credit = structuredClone(x); }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Credit, BOND, IMF, IMF_CONDITIONS };
