// =====================================================================
// МОДУЛЬ 5: ИГРОВОЙ ЦИКЛ И ЭКОНОМИКА (Game Loop)
// =====================================================================
class GameLoop {
    // Добавили mapEngine в аргументы
    constructor(gameData, uiManager, mapEngine) {
        this.data = gameData;
        this.ui = uiManager;
        this.map = mapEngine; // Сохраняем ссылку на карту!
        
        this.monthNames = ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"];
        
        // Стоимость содержания армии (в игровой валюте за ход)
        this.MAINTENANCE_COST = {
            infantry: 25000, 
            tanks: 80000     
        };
        
        // Базовая доходность единицы промышленности
        this.INDUSTRY_VALUE = 400;

        document.getElementById('end-turn-btn').addEventListener('click', () => this.processTurn());
        this.updateTopBarUI();
    }

    processTurn() {
        this.data.currentDate.setDate(this.data.currentDate.getDate() + 7);

        // Запускаем исполнение приказов (рекрутинг и атаки)
        const combatLogs = this.data.processOrders();
        
        let incomes = {};
        let expenses = {};
        
        Object.keys(this.data.countries).forEach(id => { 
            incomes[id] = 0; 
            expenses[id] = 0; 
        });

// 1. РАСЧЕТ ДОХОДОВ И РАСХОДОВ НА АРМИЮ В РЕГИОНАХ
        Object.values(this.data.regions).forEach(region => {
            const owner = region.owner;
            if (owner && incomes[owner] !== undefined) {
                const country = this.data.countries[owner];
                const popTax = region.population * country.taxRate * region.loyalty;
                const indIncome = region.resources.industry * this.INDUSTRY_VALUE;
                incomes[owner] += (popTax + indIncome);

                // === НОВОЕ: Списываем деньги за солдат, стоящих в этом регионе ===
                if (region.army) {
                    Object.keys(UnitsDB).forEach(unitId => {
                        expenses[owner] += (region.army[unitId] || 0) * UnitsDB[unitId].maintenanceCost;
                    });
                }
            }
        });

        // 2. РАСЧЕТ РАСХОДОВ (Резерв в правительстве)
        Object.keys(this.data.countries).forEach(countryId => {
            const country = this.data.countries[countryId];
            if (country.army) {
                Object.keys(UnitsDB).forEach(unitId => {
                    const unitCount = country.army[unitId] || 0;
                    expenses[countryId] += unitCount * UnitsDB[unitId].maintenanceCost;
                });
            }
            
            const netIncome = incomes[countryId] - expenses[countryId];
            country.money += netIncome;
            country.lastNetIncome = netIncome;
        });

        this.updateTopBarUI();
        
        // 3. ОБНОВЛЕНИЕ КАРТЫ ПОСЛЕ БОЕВ
        if (this.map) {
            this.map.refreshColors();
            this.map.createCountryLabels();
        }

        // --- ФОРМИРУЕМ ОТЧЕТ О КОНЦЕ ХОДА ---
        const playerFin = { 
            income: incomes[this.data.playerCountry], 
            expense: expenses[this.data.playerCountry], 
            net: incomes[this.data.playerCountry] - expenses[this.data.playerCountry] 
        };

        const turnData = {
            date: document.getElementById('glob-date').innerText,
            financial: playerFin,
            logs: combatLogs
        };

        // Сохраняем в память (до 10 дней)
        this.data.saveTurnHistory(turnData);
        
        // Выводим всплывающее окно
        this.ui.showTurnSummary(turnData);
        
        // Очищаем визуальную панель приказов
        this.ui.updateOrdersPanel(this.data.orders);
    }

    updateTopBarUI() {
        const player = this.data.getCountry(this.data.playerCountry);
        const d = this.data.currentDate;
        
        document.getElementById('glob-money').innerText = this.ui.formatNumber(player.money);
        
        const netElement = document.getElementById('glob-net');
        if (player.lastNetIncome > 0) {
            netElement.innerHTML = `<span style="color: #4ade80;">(+${this.ui.formatNumber(player.lastNetIncome)})</span>`;
        } else if (player.lastNetIncome < 0) {
            netElement.innerHTML = `<span style="color: #f87171;">(${this.ui.formatNumber(player.lastNetIncome)})</span>`;
        } else {
            netElement.innerHTML = `<span style="color: #94a3b8;">(0)</span>`;
        }
        
        document.getElementById('glob-influence').innerText = player.influence;
        document.getElementById('glob-date').innerText = `${d.getDate()} ${this.monthNames[d.getMonth()]} ${d.getFullYear()}`;
    }

	getProjectedNetIncome(countryId) {
        let income = 0;
        let expense = 0;
        const country = this.data.countries[countryId];

        Object.values(this.data.regions).forEach(region => {
            if (region.owner === countryId) {
                const popTax = region.population * country.taxRate * region.loyalty;
                const indIncome = region.resources.industry * this.INDUSTRY_VALUE;
                income += (popTax + indIncome);

                // === НОВОЕ: Прогноз расходов на армию в регионе ===
                if (region.army) {
                    Object.keys(UnitsDB).forEach(unitId => {
                        expense += (region.army[unitId] || 0) * UnitsDB[unitId].maintenanceCost;
                    });
                }
            }
        });

        // Считаем потенциальные расходы резерва
        if (country.army) {
            Object.keys(UnitsDB).forEach(unitId => {
                const unitCount = country.army[unitId] || 0;
                expense += unitCount * UnitsDB[unitId].maintenanceCost;
            });
        }

        return income - expense;
    }
}
