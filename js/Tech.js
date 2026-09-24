// =====================================================================
// ДЕРЕВО ТЕХНОЛОГИЙ
//
// Четыре ветки. Технологию можно начать, когда изучены все из requires.
// Одновременно идёт одно исследование: деньги списываются сразу, результат —
// через turns ходов. unlocks открывает род войск, effect даёт постоянный
// бонус. Кроме дерева есть бесконечная модернизация родов войск
// (GameData.techCost): каждая ступень дороже предыдущей — туда уходят
// излишки денег у богатых стран.
// =====================================================================
const TECH_BRANCHES = {
    land:    { name: 'Сухопутные войска', icon: '🪖' },
    air:     { name: 'Авиация и ПВО', icon: '✈️' },
    support: { name: 'Оборона и снабжение', icon: '🧱' },
    economy: { name: 'Экономика', icon: '🏭' },
};

const TECH_TREE = {
    motorized: {
        branch: 'land', name: 'Мотопехота', icon: '🚙', cost: 5e6, turns: 2, requires: [],
        unlocks: 'mech', text: 'Пехота на бронемашинах: вдвое крепче обычной.',
    },
    specops: {
        branch: 'land', name: 'Силы спецопераций', icon: '🎖️', cost: 15e6, turns: 3, requires: ['motorized'],
        unlocks: 'specops', text: 'Спецназ выбивает у врага артиллерию, ПВО и ракеты.',
    },
    missiles: {
        branch: 'land', name: 'Ракетные комплексы', icon: '🚀', cost: 45e6, turns: 4, requires: ['specops', 'drones'],
        unlocks: 'missiles', text: 'Самый мощный удар на суше.',
    },
    drones: {
        branch: 'air', name: 'Ударные дроны', icon: '🛸', cost: 8e6, turns: 2, requires: [],
        unlocks: 'drones', text: 'Дешёвые дроны против танков и артиллерии.',
    },
    ewar: {
        branch: 'air', name: 'Радиоэлектронная борьба', icon: '🛰️', cost: 20e6, turns: 3, requires: ['drones'],
        unlocks: 'ewar', text: 'Комплексы РЭБ глушат дроны, ракеты и стелс.',
    },
    stealth: {
        branch: 'air', name: 'Стелс-авиация', icon: '🛩️', cost: 60e6, turns: 5, requires: ['ewar'],
        unlocks: 'stealth', text: 'Самолёты, невидимые для ПВО.',
    },
    medicine: {
        branch: 'support', name: 'Военная медицина', icon: '🩺', cost: 6e6, turns: 2, requires: [],
        effect: { losses: 0.8 }, text: 'Потери в боях на 20% меньше.',
    },
    fortify: {
        branch: 'support', name: 'Укрепрайоны', icon: '🧱', cost: 18e6, turns: 3, requires: ['medicine'],
        effect: { defense: 1.15 }, text: 'Оборона всех областей на 15% сильнее.',
    },
    logistics1: {
        branch: 'support', name: 'Логистика', icon: '🚚', cost: 4e6, turns: 2, requires: [],
        effect: { march: 2 }, text: 'Марш на 2 области за ход.',
    },
    logistics2: {
        branch: 'support', name: 'Глобальная логистика', icon: '🌍', cost: 12e6, turns: 3, requires: ['logistics1'],
        effect: { march: 3 }, text: 'Марш на 3 области и морские экспедиции в любую точку мира.',
    },
    agrotech: {
        branch: 'economy', name: 'Агротехнологии', icon: '🌾', cost: 6e6, turns: 2, requires: [],
        effect: { food: 1.15 }, text: 'Еды производится на 15% больше.',
    },
    powergrid: {
        branch: 'economy', name: 'Энергосети', icon: '⚡', cost: 8e6, turns: 2, requires: [],
        effect: { energy: 1.15 }, text: 'Энергии производится на 15% больше.',
    },
    automation: {
        branch: 'economy', name: 'Автоматизация', icon: '🤖', cost: 25e6, turns: 3, requires: ['powergrid'],
        effect: { goods: 1.2 }, text: 'Заводы выпускают на 20% больше товаров.',
    },
    digital: {
        branch: 'economy', name: 'Цифровое государство', icon: '💻', cost: 50e6, turns: 5, requires: ['automation'],
        effect: { tax: 1.1 }, text: 'Налоги собираются на 10% лучше.',
    },
    fusion: {
        branch: 'economy', name: 'Термоядерная энергетика', icon: '☢️', cost: 80e6, turns: 6, requires: ['digital'],
        effect: { energy: 1.35 }, text: 'Энергии производится ещё на 35% больше.',
    },
};

// Модернизация рода войск: +15% силы за ступень, до 10-й. Цена растёт в
// полтора раза за ступень и зависит от стоимости самого рода войск.
const MODERNIZATION = { STEP: 0.15, MAX: 10, BASE: 8, GROWTH: 1.5 };

class Tech {
    static init(country) {
        country.techs = country.techs || [];
        if (country.research === undefined) country.research = null;
    }

    static has(country, techId) {
        return !!country && Array.isArray(country.techs) && country.techs.includes(techId);
    }

    static canStart(country, techId) {
        const tech = TECH_TREE[techId];
        if (!tech) return { ok: false, reason: 'Неизвестная технология' };
        if (Tech.has(country, techId)) return { ok: false, reason: 'Уже изучено' };
        if (country.research) return { ok: false, reason: 'Уже идёт исследование — дождитесь его окончания' };
        const missing = tech.requires.filter(id => !Tech.has(country, id));
        if (missing.length) return { ok: false, reason: `Сначала изучите: ${missing.map(id => TECH_TREE[id].name).join(', ')}` };
        if (country.money < tech.cost) return { ok: false, reason: 'Недостаточно средств' };
        return { ok: true };
    }

    // Совокупный множитель эффекта (например, 'food') от изученных технологий.
    static factor(country, key) {
        let k = 1;
        if (!country || !country.techs) return k;
        for (const id of country.techs) {
            const effect = TECH_TREE[id] && TECH_TREE[id].effect;
            if (effect && typeof effect[key] === 'number' && key !== 'march') k *= effect[key];
        }
        return k;
    }

    static unitUnlocked(country, unitId) {
        const unit = UnitsDB[unitId];
        return !!unit && (!unit.requires || Tech.has(country, unit.requires));
    }

    // Изучить мгновенно — при восстановлении и для совместимости со старыми
    // сохранениями (логистика раньше была уровнем, а не технологией).
    static grant(country, techId) {
        Tech.init(country);
        if (!Tech.has(country, techId)) country.techs.push(techId);
        const march = TECH_TREE[techId].effect && TECH_TREE[techId].effect.march;
        if (march) country.tech.marchSpeed = Math.max(country.tech.marchSpeed || 1, march);
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Tech, TECH_TREE, TECH_BRANCHES, MODERNIZATION };
