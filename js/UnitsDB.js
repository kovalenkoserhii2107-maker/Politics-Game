// =====================================================================
// РОДА ВОЙСК
//
// Первые пять доступны сразу, остальные открывает дерево технологий
// (поле requires — id технологии из js/Tech.js). counters — кого этот род
// войск бьёт особенно хорошо: чем больше таких у противника, тем сильнее.
// Порядок ключей важен: в таком порядке армии хранятся в сохранениях.
// =====================================================================
const UnitsDB = {
    infantry: {
        id: 'infantry', name: 'Пехота', icon: '⚔️', type: 'soft',
        baseAttack: 2, baseDefense: 4, maintenanceCost: 25000, buildCost: 50000, industryCost: 1,
        requires: null, counters: ['antiair', 'artillery'],
        note: 'Дешёвая основа армии, держит оборону',
    },
    tanks: {
        id: 'tanks', name: 'Танковые войска', icon: '🛡️', type: 'hard',
        baseAttack: 8, baseDefense: 6, maintenanceCost: 80000, buildCost: 200000, industryCost: 5,
        requires: null, counters: ['infantry'],
        note: 'Прорыв обороны, сильны против пехоты',
    },
    artillery: {
        id: 'artillery', name: 'Артиллерия', icon: '🎯', type: 'soft',
        baseAttack: 10, baseDefense: 2, maintenanceCost: 60000, buildCost: 150000, industryCost: 4,
        requires: null, counters: ['infantry', 'tanks'],
        note: 'Мощный удар, слабая защита',
    },
    aviation: {
        id: 'aviation', name: 'Авиация', icon: '✈️', type: 'air',
        baseAttack: 15, baseDefense: 3, maintenanceCost: 150000, buildCost: 500000, industryCost: 8,
        requires: null, counters: ['tanks', 'artillery'],
        note: 'Удар с воздуха по технике',
    },
    antiair: {
        id: 'antiair', name: 'Системы ПВО', icon: '📡', type: 'hard',
        baseAttack: 1, baseDefense: 10, maintenanceCost: 50000, buildCost: 120000, industryCost: 3,
        requires: null, counters: ['aviation', 'drones'],
        note: 'Щит от авиации и дронов',
    },
    mech: {
        id: 'mech', name: 'Мотопехота', icon: '🚙', type: 'soft',
        baseAttack: 5, baseDefense: 6, maintenanceCost: 45000, buildCost: 110000, industryCost: 2,
        requires: 'motorized', counters: ['infantry', 'antiair'],
        note: 'Пехота на бронемашинах: вдвое крепче обычной',
    },
    specops: {
        id: 'specops', name: 'Спецназ', icon: '🎖️', type: 'soft',
        baseAttack: 12, baseDefense: 5, maintenanceCost: 100000, buildCost: 300000, industryCost: 3,
        requires: 'specops', counters: ['artillery', 'antiair', 'missiles', 'ewar'],
        note: 'Выбивает артиллерию, ПВО и ракеты',
    },
    drones: {
        id: 'drones', name: 'Ударные дроны', icon: '🛸', type: 'air',
        baseAttack: 9, baseDefense: 1, maintenanceCost: 25000, buildCost: 90000, industryCost: 2,
        requires: 'drones', counters: ['tanks', 'artillery', 'mech'],
        note: 'Дёшево и больно для техники, беззащитны перед ПВО и РЭБ',
    },
    ewar: {
        id: 'ewar', name: 'Комплексы РЭБ', icon: '🛰️', type: 'hard',
        baseAttack: 2, baseDefense: 12, maintenanceCost: 70000, buildCost: 280000, industryCost: 4,
        requires: 'ewar', counters: ['drones', 'missiles', 'stealth', 'aviation'],
        note: 'Глушат дроны, ракеты и даже стелс',
    },
    missiles: {
        id: 'missiles', name: 'Ракетные комплексы', icon: '🚀', type: 'hard',
        baseAttack: 30, baseDefense: 2, maintenanceCost: 220000, buildCost: 900000, industryCost: 10,
        requires: 'missiles', counters: ['antiair', 'tanks', 'artillery', 'ewar'],
        note: 'Сильнейший удар на суше, в обороне почти бесполезны',
    },
    stealth: {
        id: 'stealth', name: 'Стелс-авиация', icon: '🛩️', type: 'air',
        baseAttack: 28, baseDefense: 8, maintenanceCost: 350000, buildCost: 1400000, industryCost: 14,
        requires: 'stealth', counters: ['aviation', 'antiair', 'drones', 'tanks'],
        note: 'Невидима для ПВО, господство в воздухе',
    },
};
