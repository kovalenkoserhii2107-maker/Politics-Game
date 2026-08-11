// База данных всех родов войск в игре
const UnitsDB = {
    infantry: {
        id: 'infantry', name: 'Пехота', icon: '⚔️', 
        type: 'soft', 
        baseAttack: 2, baseDefense: 4, 
        maintenanceCost: 25000, buildCost: 50000,
        industryCost: 1, // Требует 1 единицу индустрии региона для постройки
        requiredTech: 'basic_infantry', // Ключ из дерева технологий
        counters: ['antiair', 'artillery']
    },
    tanks: {
        id: 'tanks', name: 'Танковые войска', icon: '🛡️', 
        type: 'hard', 
        baseAttack: 8, baseDefense: 6, 
        maintenanceCost: 80000, buildCost: 200000,
        industryCost: 5,
        requiredTech: 'early_tanks',
        counters: ['infantry']
    },
    artillery: {
        id: 'artillery', name: 'Артиллерия', icon: '🎯', 
        type: 'soft', 
        baseAttack: 10, baseDefense: 2, 
        maintenanceCost: 60000, buildCost: 150000,
        industryCost: 4,
        requiredTech: 'basic_artillery',
        counters: ['infantry', 'tanks']
    },
    aviation: {
        id: 'aviation', name: 'Авиация', icon: '✈️', 
        type: 'air', 
        baseAttack: 15, baseDefense: 3, 
        maintenanceCost: 150000, buildCost: 500000,
        industryCost: 8,
        requiredTech: 'early_fighters',
        counters: ['tanks', 'artillery']
    },
    antiair: {
        id: 'antiair', name: 'Системы ПВО', icon: '📡', 
        type: 'hard', 
        baseAttack: 1, baseDefense: 10, 
        maintenanceCost: 50000, buildCost: 120000,
        industryCost: 3,
        requiredTech: 'basic_antiair',
        counters: ['aviation']
    }
};