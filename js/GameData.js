class GameData {
    constructor(playerCountryId = 'UA', cheatMode = false) {
        this.currentDate = new Date(2024, 0, 1);
        this.playerCountry = playerCountryId; 
        this.cheatMode = cheatMode; // Активация чит-кода

        this.generateEmptyArmy = () => {
            let army = {};
            Object.keys(UnitsDB).forEach(unitId => { army[unitId] = 0; });
            return army;
        };

        this.generateBaseTech = () => {
            let tech = { marchSpeed: 1 };
            Object.keys(UnitsDB).forEach(unitId => { tech[unitId] = 1; });
            return tech;
        };

        this.countries = {
            'UA': { id: 'UA', name: 'Украина', color: '#eab308', money: 5000000, influence: 100, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'PL': { id: 'PL', name: 'Польша', color: '#ef4444', money: 7000000, influence: 120, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'BY': { id: 'BY', name: 'Беларусь', color: '#22c55e', money: 3000000, influence: 50, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'RO': { id: 'RO', name: 'Румыния', color: '#3b82f6', money: 4500000, influence: 80, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'MD': { id: 'MD', name: 'Молдова', color: '#9333ea', money: 1000000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'SK': { id: 'SK', name: 'Словакия', color: '#f97316', money: 2000000, influence: 45, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'HU': { id: 'HU', name: 'Венгрия', color: '#14b8a6', money: 3500000, influence: 60, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'RU': { id: 'RU', name: 'Россия', color: '#b91c1c', money: 15000000, influence: 200, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'TR': { id: 'TR', name: 'Турция', color: '#06b6d4', money: 8000000, influence: 110, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'BG': { id: 'BG', name: 'Болгария', color: '#84cc16', money: 2500000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'GE': { id: 'GE', name: 'Грузия', color: '#ec4899', money: 1200000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'DE': { id: 'DE', name: 'Германия', color: '#64748b', money: 12000000, influence: 180, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'FR': { id: 'FR', name: 'Франция', color: '#2563eb', money: 11000000, influence: 170, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'IT': { id: 'IT', name: 'Италия', color: '#059669', money: 9000000, influence: 140, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'ES': { id: 'ES', name: 'Испания', color: '#d97706', money: 8000000, influence: 130, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'CN': { id: 'CN', name: 'Китай', color: '#dc2626', money: 20000000, influence: 250, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'GB': { id: 'GB', name: 'Великобритания', color: '#1e3a8a', money: 9500000, influence: 150, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'IN': { id: 'IN', name: 'Индия', color: '#ea580c', money: 10000000, influence: 160, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'JP': { id: 'JP', name: 'Япония', color: '#be123c', money: 13000000, influence: 160, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'KZ': { id: 'KZ', name: 'Казахстан', color: '#047857', money: 4000000, influence: 70, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'IQ': { id: 'IQ', name: 'Ирак', color: '#ca8a04', money: 3000000, influence: 50, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'IR': { id: 'IR', name: 'Иран', color: '#4338ca', money: 6000000, influence: 90, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'SA': { id: 'SA', name: 'Саудовская Аравия', color: '#15803d', money: 12000000, influence: 110, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'AT': { id: 'AT', name: 'Австрия', color: '#6b7280', money: 4000000, influence: 65, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'CZ': { id: 'CZ', name: 'Чехия', color: '#475569', money: 3500000, influence: 60, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'FI': { id: 'FI', name: 'Финляндия', color: '#0284c7', money: 3500000, influence: 55, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'SE': { id: 'SE', name: 'Швеция', color: '#0369a1', money: 5500000, influence: 85, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'NO': { id: 'NO', name: 'Норвегия', color: '#0c4a6e', money: 6000000, influence: 80, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'CH': { id: 'CH', name: 'Швейцария', color: '#991b1b', money: 7000000, influence: 90, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'PT': { id: 'PT', name: 'Португалия', color: '#b45309', money: 3000000, influence: 50, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'GR': { id: 'GR', name: 'Греция', color: '#1d4ed8', money: 2500000, influence: 50, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'RS': { id: 'RS', name: 'Сербия', color: '#7f1d1d', money: 2000000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'HR': { id: 'HR', name: 'Хорватия', color: '#1e40af', money: 2200000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'BA': { id: 'BA', name: 'Босния и Герцеговина', color: '#047857', money: 1000000, influence: 25, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'ME': { id: 'ME', name: 'Черногория', color: '#b91c1c', money: 800000, influence: 20, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'MK': { id: 'MK', name: 'Северная Македония', color: '#c2410c', money: 900000, influence: 20, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'AL': { id: 'AL', name: 'Албания', color: '#991b1b', money: 1000000, influence: 25, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'SI': { id: 'SI', name: 'Словения', color: '#0f766e', money: 2000000, influence: 35, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'EE': { id: 'EE', name: 'Эстония', color: '#0369a1', money: 1500000, influence: 35, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'LV': { id: 'LV', name: 'Латвия', color: '#881337', money: 1500000, influence: 35, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'LT': { id: 'LT', name: 'Литва', color: '#f59e0b', money: 1800000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'DK': { id: 'DK', name: 'Дания', color: '#dc2626', money: 4500000, influence: 65, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'NL': { id: 'NL', name: 'Нидерланды', color: '#ea580c', money: 7500000, influence: 95, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'BE': { id: 'BE', name: 'Бельгия', color: '#4338ca', money: 6500000, influence: 85, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'IE': { id: 'IE', name: 'Ирландия', color: '#15803d', money: 5500000, influence: 60, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'CY': { id: 'CY', name: 'Кипр', color: '#d97706', money: 1200000, influence: 25, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'IS': { id: 'IS', name: 'Исландия', color: '#0284c7', money: 1500000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'LU': { id: 'LU', name: 'Люксембург', color: '#1e3a8a', money: 3000000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'AM': { id: 'AM', name: 'Армения', color: '#0284c7', money: 1000000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'AZ': { id: 'AZ', name: 'Азербайджан', color: '#047857', money: 3500000, influence: 60, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'TJ': { id: 'TJ', name: 'Таджикистан', color: '#15803d', money: 1000000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'UZ': { id: 'UZ', name: 'Узбекистан', color: '#2563eb', money: 2500000, influence: 50, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'TM': { id: 'TM', name: 'Туркменистан', color: '#059669', money: 2000000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'KG': { id: 'KG', name: 'Кыргызстан', color: '#dc2626', money: 900000, influence: 25, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'AF': { id: 'AF', name: 'Афганистан', color: '#166534', money: 800000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'PK': { id: 'PK', name: 'Пакистан', color: '#047857', money: 5000000, influence: 95, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'NP': { id: 'NP', name: 'Непал', color: '#dc2626', money: 900000, influence: 25, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'BT': { id: 'BT', name: 'Бутан', color: '#ea580c', money: 500000, influence: 15, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'BD': { id: 'BD', name: 'Бангладеш', color: '#15803d', money: 3500000, influence: 55, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'MM': { id: 'MM', name: 'Мьянма', color: '#b91c1c', money: 2000000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'TH': { id: 'TH', name: 'Таиланд', color: '#4338ca', money: 6000000, influence: 85, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'LA': { id: 'LA', name: 'Лаос', color: '#b91c1c', money: 800000, influence: 20, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'KH': { id: 'KH', name: 'Камбоджа', color: '#047857', money: 1000000, influence: 25, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'VN': { id: 'VN', name: 'Вьетнам', color: '#dc2626', money: 4500000, influence: 75, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'MY': { id: 'MY', name: 'Малайзия', color: '#b45309', money: 6500000, influence: 80, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'SG': { id: 'SG', name: 'Сингапур', color: '#ef4444', money: 8000000, influence: 70, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'ID': { id: 'ID', name: 'Индонезия', color: '#dc2626', money: 8500000, influence: 110, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'PH': { id: 'PH', name: 'Филиппины', color: '#2563eb', money: 5000000, influence: 70, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'TW': { id: 'TW', name: 'Тайвань', color: '#0284c7', money: 7500000, influence: 85, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'KP': { id: 'KP', name: 'Северная Корея', color: '#b91c1c', money: 1500000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'KR': { id: 'KR', name: 'Южная Корея', color: '#1d4ed8', money: 11000000, influence: 130, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'MN': { id: 'MN', name: 'Монголия', color: '#d97706', money: 1200000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'LK': { id: 'LK', name: 'Шри-Ланка', color: '#15803d', money: 2000000, influence: 40, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'KW': { id: 'KW', name: 'Кувейт', color: '#047857', money: 5000000, influence: 45, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'QA': { id: 'QA', name: 'Катар', color: '#7f1d1d', money: 7000000, influence: 50, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'BH': { id: 'BH', name: 'Бахрейн', color: '#b91c1c', money: 2500000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'OM': { id: 'OM', name: 'Оман', color: '#ca8a04', money: 4000000, influence: 45, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'YE': { id: 'YE', name: 'Йемен', color: '#1e3a8a', money: 1000000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'JO': { id: 'JO', name: 'Иордания', color: '#0f766e', money: 2000000, influence: 35, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'SY': { id: 'SY', name: 'Сирия', color: '#b91c1c', money: 1000000, influence: 35, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'LB': { id: 'LB', name: 'Ливан', color: '#15803d', money: 1500000, influence: 30, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() },
            'IL': { id: 'IL', name: 'Израиль', color: '#2563eb', money: 8000000, influence: 100, taxRate: 0.05, lastNetIncome: 0, army: this.generateEmptyArmy(), tech: this.generateBaseTech() }
        };

        this.regions = {};
        this.history = [];
        this.orders = { recruitment: [], attacks: [], movements: [], recon: [] };
    }

    buildDatabaseFromSVG() {
        const paths = document.querySelectorAll('#world-map path');
        paths.forEach(path => {
            const regionId = path.id; 
            if (!regionId) return;

            path.classList.add('region');
            const countryCode = regionId.split('-')[0]; 

            if (this.countries[countryCode]) {
                
                // --- УМНЫЙ БАЛАНСИР ДЛЯ РЕГИОНОВ БЕЗ ЯВНОЙ БАЗЫ ---
                let defaultPop = 500000;
                let defaultInd = 20;
                let defaultAgro = 40;
                
                if (countryCode === 'MD' || countryCode === 'GE') {
                    defaultPop = 75000; 
                    defaultInd = 10;
                    defaultAgro = 50;
                } else if (countryCode === 'RU' || countryCode === 'TR' || countryCode === 'IT') {
                    defaultPop = 1200000; 
                    defaultInd = 45;
                } else if (countryCode === 'RO' || countryCode === 'BG' || countryCode === 'SK' || countryCode === 'HU') {
                    defaultPop = 350000; 
                }

                const dbInfo = RegionsDB[regionId] || { 
                    name: `Провинция ${regionId}`, 
                    population: defaultPop, 
                    oil: 0, 
                    agro: defaultAgro, 
                    industry: defaultInd 
                };

                this.regions[regionId] = {
                    id: regionId,
                    name: dbInfo.name,
                    owner: countryCode,
                    population: dbInfo.population,
                    loyalty: 1.0, 
                    army: this.generateEmptyArmy(),
                    resources: { oil: dbInfo.oil, agro: dbInfo.agro, industry: dbInfo.industry }
                };
            } else {
                path.style.display = 'none';
            }
        });
        
        this.distributeArmiesToBorders();
    }

    getCountry(id) { return this.countries[id]; }
    getRegion(id) { return this.regions[id]; }

    getCountryStats(countryId) {
        let stats = { population: 0, oil: 0, agro: 0, industry: 0, army: this.generateEmptyArmy() };
        const country = this.getCountry(countryId);
        
        if (country && country.army) {
            Object.keys(UnitsDB).forEach(unitId => {
                stats.army[unitId] += (country.army[unitId] || 0);
            });
        }

        Object.values(this.regions).forEach(region => {
            if (region.owner === countryId) {
                stats.population += region.population;
                stats.oil += region.resources.oil;
                stats.agro += region.resources.agro;
                stats.industry += region.resources.industry;
                
                Object.keys(UnitsDB).forEach(unitId => {
                    stats.army[unitId] += (region.army[unitId] || 0);
                });
            }
        });
        return stats;
    }

    calculateRegionMilitaryPower(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return 0;
        const country = this.getCountry(region.owner);
        if (!country) return 0;

        let power = 0;
        Object.keys(UnitsDB).forEach(unitId => {
            const count = region.army[unitId] || 0;
            if (count > 0) {
                const unit = UnitsDB[unitId];
                const techLevel = country.tech[unitId] || 1;
                const techMultiplier = 1 + (techLevel - 1) * 0.2; 
                power += count * (unit.baseAttack + unit.baseDefense) * techMultiplier;
            }
        });
        return Math.floor(power);
    }

    calculateMilitaryPower(countryId) {
        const country = this.getCountry(countryId);
        if (!country) return 0;
        
        let totalPower = 0;
        Object.keys(UnitsDB).forEach(unitId => {
            const count = country.army[unitId] || 0;
            if (count > 0) {
                const unit = UnitsDB[unitId];
                const techLevel = country.tech[unitId] || 1;
                const techMultiplier = 1 + (techLevel - 1) * 0.2;
                totalPower += count * (unit.baseAttack + unit.baseDefense) * techMultiplier;
            }
        });

        Object.values(this.regions).forEach(region => {
            if (region.owner === countryId) {
                totalPower += this.calculateRegionMilitaryPower(region.id);
            }
        });
        
        return Math.floor(totalPower);
    }

    getRecruitPotential(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return 0;
        
        let potential = Math.floor(region.population / 150000);
        const logisticsCap = Math.max(1, Math.floor(region.resources.industry / 5));
        let finalPotential = Math.min(potential, logisticsCap);

        return Math.max(1, finalPotential); 
    }

    saveTurnHistory(turnData) {
        this.history.unshift(turnData); 
        if (this.history.length > 10) { this.history.pop(); }
    }

    areNeighbors(regionId1, regionId2) {
        if (GeneratedNeighbors[regionId1]) {
            return GeneratedNeighbors[regionId1].includes(regionId2);
        }
        return false;
    }

    // Проверяет, граничит ли указанный регион с территорией игрока
    isNeighborToPlayer(regionId) {
        let isNeighbor = false;
        const neighbors = GeneratedNeighbors[regionId] || [];
        
        for (let i = 0; i < neighbors.length; i++) {
            const nReg = this.getRegion(neighbors[i]);
            // Если хотя бы один сосед принадлежит игроку — возвращаем true
            if (nReg && nReg.owner === this.playerCountry) {
                return true;
            }
        }
        return false;
    }

    getFriendlyDistance(startRegionId, targetRegionId, ownerId) {
        if (startRegionId === targetRegionId) return 0;
        let queue = [{ id: startRegionId, dist: 0 }];
        let visited = new Set([startRegionId]);

        while (queue.length > 0) {
            let current = queue.shift();
            if (current.id === targetRegionId) return current.dist;

            let neighbors = GeneratedNeighbors[current.id] || [];
            for (let nextId of neighbors) {
                let nextRegion = this.getRegion(nextId);
                if (!nextRegion || visited.has(nextId) || nextRegion.owner !== ownerId) continue;
                
                visited.add(nextId);
                queue.push({ id: nextId, dist: current.dist + 1 });
            }
        }
        return -1; 
    }

    getValidMoveTargets(startRegionId) {
        const region = this.getRegion(startRegionId);
        if (!region) return [];
        const country = this.getCountry(region.owner);
        if (!country) return [];
        
        const maxDist = country.tech.marchSpeed || 1;
        let validIds = [];
        Object.values(this.regions).forEach(r => {
            if (r.owner === country.id && r.id !== startRegionId) {
                let dist = this.getFriendlyDistance(startRegionId, r.id, country.id);
                if (dist !== -1 && dist <= maxDist) validIds.push(r.id);
            }
        });
        return validIds;
    }

    getValidAttackTargets(startRegionId) {
        const region = this.getRegion(startRegionId);
        if (!region) return [];
        const countryId = region.owner;
        let validIds = [];
        
        let neighbors = GeneratedNeighbors[startRegionId] || [];
        for (let nextId of neighbors) {
            let nextRegion = this.getRegion(nextId);
            if (nextRegion && nextRegion.owner !== countryId) {
                validIds.push(nextId);
            }
        }
        return validIds;
    }

    queueMovement(fromId, toId, forces) {
        const fromRegion = this.getRegion(fromId);
        const toRegion = this.getRegion(toId);
        if (!fromRegion || !toRegion) return;
        
        let forcesText = Object.keys(forces).filter(id => forces[id] > 0).map(id => `${forces[id]} ${UnitsDB[id].name}`).join(', ');
        this.orders.movements.push({ from: fromId, to: toId, forces: forces, text: `[Марш] ${fromRegion.name} ➔ ${toRegion.name} (${forcesText})` });
    }

    queueAttack(fromId, toId, forces) {
        const fromRegion = this.getRegion(fromId);
        const toRegion = this.getRegion(toId);
        if (!fromRegion || !toRegion) return;
        
        let forcesText = Object.keys(forces).filter(id => forces[id] > 0).map(id => `${forces[id]} ${UnitsDB[id].name}`).join(', ');
        this.orders.attacks.push({ from: fromId, to: toId, forces: forces, text: `[Атака] ${fromRegion.name} ➔ ${toRegion.name} (${forcesText})` });
    }

    queueRecon(targetId, cost, prob, regionName) {
        if (!this.orders.recon) this.orders.recon = [];
        
        // Блокируем двойную отправку шпионов в один и тот же регион за ход
        if (this.orders.recon.some(o => o.target === targetId)) return false;
        
        // ПРАВИЛЬНОЕ ОБРАЩЕНИЕ К КАЗНЕ ИГРОКА
        const player = this.getCountry(this.playerCountry);
        
        if (player.money >= cost) {
            player.money -= cost;
            this.orders.recon.push({ 
                target: targetId, 
                cost: cost, 
                prob: prob, 
                regionName: regionName 
            });
            return true;
        }
        return false;
    }

    processOrders() {
        let resultsLogs = [];

        // === 1. РАЗВЕДКА (Выполняется первой в начале хода) ===
        if (this.orders.recon && this.orders.recon.length > 0) {
            this.orders.recon.forEach(order => {
                const region = this.getRegion(order.target);
                if (region) {
                    const roll = Math.random() * 100;
                    if (roll <= order.prob) {
                        // УСПЕХ
                        let activeDate = new Date(this.currentDate);
                        activeDate.setMonth(activeDate.getMonth() + 1); 
                        region.reconActiveUntil = activeDate;
                        
                        resultsLogs.push({ 
                            success: true, 
                            message: `🕵️ Разведка: Шпионы успешно внедрились в ${region.name}. Данные о гарнизоне получены.` 
                        });
                    } else {
                        // ПРОВАЛ
                        resultsLogs.push({ 
                            success: false, 
                            message: `💥 Провал операции в ${region.name}. Шпионы были перехвачены контрразведкой.` 
                        });
                    }
                }
            });
            this.orders.recon = []; // Очищаем очередь разведки
        }

        // === 2. РЕКРУТИНГ ===
        this.orders.recruitment.forEach(order => {
            const region = this.getRegion(order.regionId);
            if (region) {
                region.army.infantry += order.amount; 
                resultsLogs.push({ success: true, message: `В ${region.name} набрано +${order.amount} пехоты.` });
            }
        });

        // === 3. ПЕРЕМЕЩЕНИЕ ВОЙСК ===
        this.orders.movements.forEach(order => {
            const fromRegion = this.getRegion(order.from);
            const toRegion = this.getRegion(order.to);

            if (fromRegion && toRegion && fromRegion.owner === toRegion.owner) {
                Object.keys(order.forces).forEach(unitId => {
                    const amountToMove = order.forces[unitId];
                    const actualAmount = Math.min(fromRegion.army[unitId] || 0, amountToMove);
                    fromRegion.army[unitId] -= actualAmount;
                    toRegion.army[unitId] += actualAmount;
                });
                resultsLogs.push({ success: true, message: order.text + " — Выполнено." });
            }
        });

        // === 4. АТАКИ ===
        this.orders.attacks.forEach(order => {
            const fromRegion = this.getRegion(order.from);
            const targetRegion = this.getRegion(order.to);
            if (!fromRegion || !targetRegion || targetRegion.owner === this.playerCountry) return;

            let actualForces = {};
            let hasTroops = false;
            let powerAtt = 0;

            Object.keys(UnitsDB).forEach(unitId => {
                const amount = Math.min(fromRegion.army[unitId] || 0, order.forces[unitId] || 0);
                actualForces[unitId] = amount;
                if (amount > 0) hasTroops = true;
                fromRegion.army[unitId] -= amount; 
                powerAtt += amount * UnitsDB[unitId].baseAttack;
            });

            if (!hasTroops) return;

            let powerDef = 1; 
            Object.keys(UnitsDB).forEach(unitId => {
                powerDef += (targetRegion.army[unitId] || 0) * UnitsDB[unitId].baseDefense;
            });

            const requiredAdvantage = 1.2; 
            let success = powerAtt >= powerDef * requiredAdvantage;
            let defLossPct = powerAtt > 0 ? Math.min(1, (powerAtt * 0.2) / powerDef) : 0;
            let attLossPct = powerDef > 1 ? Math.min(1, (powerDef * 0.1) / powerAtt) : 0;

            if (this.cheatMode && fromRegion.owner === this.playerCountry) {
                success = true;      
                attLossPct = 0;      
                defLossPct = 1;      
            }

            let attLosses = {};
            let defLosses = {};
            let survivingAtt = {};

            Object.keys(UnitsDB).forEach(unitId => {
                let defAmount = targetRegion.army[unitId] || 0;
                let defLoss = Math.min(defAmount, Math.ceil(defAmount * defLossPct));
                defLosses[unitId] = defLoss;
                targetRegion.army[unitId] -= defLoss;

                let attAmount = actualForces[unitId] || 0;
                let attLoss = Math.min(attAmount, Math.floor(attAmount * attLossPct));
                attLosses[unitId] = attLoss;
                survivingAtt[unitId] = attAmount - attLoss;
            });

            let msg = "";

            if (success) {
                targetRegion.owner = this.playerCountry;
                Object.keys(UnitsDB).forEach(unitId => targetRegion.army[unitId] = survivingAtt[unitId]);
                msg = `Наступление: ${fromRegion.name} ➔ ${targetRegion.name} успешно! Регион захвачен.`;
            } else {
                Object.keys(UnitsDB).forEach(unitId => fromRegion.army[unitId] += survivingAtt[unitId]);
                msg = `Наступление: ${fromRegion.name} ➔ ${targetRegion.name} захлебнулось.`;
            }

            resultsLogs.push({
                success: success, message: msg,
                losses: { attacker: { ...attLosses }, defender: { ...defLosses }, initialAttacker: { ...actualForces } }
            });
        });

        // Очищаем очереди приказов
        this.orders.recruitment = [];
        this.orders.movements = [];
        this.orders.attacks = [];

        return resultsLogs;
    }

    distributeArmiesToBorders() {
        const RealWorldForces = {
            'RU': { infantry: 132, tanks: 35, artillery: 60, aviation: 120, antiair: 40 },
            'UA': { infantry: 90,  tanks: 18, artillery: 30, aviation: 10,  antiair: 15 },
            'TR': { infantry: 42,  tanks: 22, artillery: 20, aviation: 60,  antiair: 15 },
            'PL': { infantry: 20,  tanks: 6,  artillery: 6,  aviation: 10,  antiair: 5 },
            'RO': { infantry: 7,   tanks: 3,  artillery: 4,  aviation: 6,   antiair: 3 },
            'BY': { infantry: 6,   tanks: 5,  artillery: 6,  aviation: 7,   antiair: 4 },
            'HU': { infantry: 4,   tanks: 1,  artillery: 1,  aviation: 1,   antiair: 1 },
            'BG': { infantry: 3,   tanks: 1,  artillery: 1,  aviation: 1,   antiair: 1 },
            'GE': { infantry: 3,   tanks: 1,  artillery: 1,  aviation: 1,   antiair: 1 },
            'SK': { infantry: 2,   tanks: 1,  artillery: 1,  aviation: 1,   antiair: 1 },
            'MD': { infantry: 1,   tanks: 0,  artillery: 1,  aviation: 0,   antiair: 0 },
            'IT': { infantry: 10,   tanks: 5,  artillery: 1,  aviation: 0,   antiair: 0 }
        };

        Object.keys(this.countries).forEach(countryId => {
            const forces = RealWorldForces[countryId] || { infantry: 1, tanks: 0, artillery: 0, aviation: 0, antiair: 0 };
            const myRegions = Object.values(this.regions).filter(r => r.owner === countryId);
            
            if (myRegions.length === 0) return;

            const borderRegions = myRegions.filter(region => {
                const neighbors = GeneratedNeighbors[region.id] || [];
                return neighbors.some(nId => {
                    const nReg = this.getRegion(nId);
                    return nReg && nReg.owner !== countryId;
                });
            });

            const targetRegions = borderRegions.length > 0 ? borderRegions : myRegions;
            const borderTotalPop = targetRegions.reduce((sum, r) => sum + r.population, 0);

            if (borderTotalPop === 0) return;

            Object.keys(forces).forEach(unitId => {
                const totalUnits = forces[unitId];
                if (totalUnits === 0) return;

                let unallocated = totalUnits;
                let remainders = [];
                
                targetRegions.forEach(region => {
                    const exactShare = totalUnits * (region.population / borderTotalPop);
                    const integerPart = Math.floor(exactShare);
                    const fractionalPart = exactShare - integerPart;
                    
                    region.army[unitId] = (region.army[unitId] || 0) + integerPart;
                    unallocated -= integerPart;
                    
                    remainders.push({ region: region, fraction: fractionalPart });
                });

                remainders.sort((a, b) => b.fraction - a.fraction);

                for (let i = 0; i < unallocated; i++) {
                    remainders[i].region.army[unitId] += 1;
                }
            });
        });
    }
}
