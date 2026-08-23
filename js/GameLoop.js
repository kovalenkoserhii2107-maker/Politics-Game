// =====================================================================
// ИГРОВОЙ ЦИКЛ И ЭКОНОМИКА
// =====================================================================
class GameLoop {
    constructor(gameData, uiManager, mapEngine) {
        this.data = gameData;
        this.ui = uiManager;
        this.map = mapEngine;

        this.monthNames = ['Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня',
                           'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря'];
        this.INDUSTRY_VALUE = 400;

        this.endTurnBtn = document.getElementById('end-turn-btn');
        this.endTurnBtn.addEventListener('click', () => this.processTurn());
        this.updateTopBarUI();
        this.ui.updateZoomMode(this.map.isRegionalZoom);
    }

    // Доход и содержание армии в областях одной страны.
    countryBalance(countryId) {
        const country = this.data.getCountry(countryId);
        let income = 0, expense = 0;
        if (!country) return { income, expense };

        for (const region of Object.values(this.data.regions)) {
            if (region.owner !== countryId) continue;
            income += region.population * country.taxRate * region.loyalty;
            income += region.resources.industry * this.INDUSTRY_VALUE;
            for (const unitId of Object.keys(UnitsDB)) {
                expense += (region.army[unitId] || 0) * UnitsDB[unitId].maintenanceCost;
            }
        }
        for (const unitId of Object.keys(UnitsDB)) {
            expense += (country.army[unitId] || 0) * UnitsDB[unitId].maintenanceCost;
        }
        return { income, expense };
    }

    getProjectedNetIncome(countryId) {
        const { income, expense } = this.countryBalance(countryId);
        return income - expense;
    }

    processTurn() {
        this.endTurnBtn.disabled = true;
        this.data.currentDate.setDate(this.data.currentDate.getDate() + 7);

        const combatLogs = this.data.processOrders();

        const balances = {};
        for (const id of Object.keys(this.data.countries)) {
            const balance = this.countryBalance(id);
            balances[id] = balance;
            const country = this.data.countries[id];
            country.lastNetIncome = balance.income - balance.expense;
            country.money += country.lastNetIncome;
            // Лояльность захваченных областей постепенно восстанавливается.
        }
        for (const region of Object.values(this.data.regions)) {
            if (region.loyalty < 1) region.loyalty = Math.min(1, region.loyalty + 0.05);
        }

        this.updateTopBarUI();
        this.map.refreshColors();
        this.map.createCountryLabels();

        const player = balances[this.data.playerCountry] || { income: 0, expense: 0 };
        const turnData = {
            date: document.getElementById('glob-date').textContent,
            financial: { income: player.income, expense: player.expense, net: player.income - player.expense },
            logs: combatLogs,
        };

        this.data.saveTurnHistory(turnData);
        this.ui.showTurnSummary(turnData);
        this.ui.updateOrdersPanel(this.data.orders);
        this.endTurnBtn.disabled = false;
    }

    updateTopBarUI() {
        const player = this.data.getCountry(this.data.playerCountry);
        if (!player) return;
        const date = this.data.currentDate;

        document.getElementById('glob-money').textContent = this.ui.formatNumber(player.money);

        const net = document.getElementById('glob-net');
        const value = player.lastNetIncome;
        net.textContent = value === 0 ? '(0)'
            : (value > 0 ? '(+' : '(−') + this.ui.formatNumber(Math.abs(value)) + ')';
        net.style.color = value > 0 ? '#4ade80' : value < 0 ? '#f87171' : '#94a3b8';

        document.getElementById('glob-influence').textContent = player.influence;
        document.getElementById('glob-date').textContent =
            `${date.getDate()} ${this.monthNames[date.getMonth()]} ${date.getFullYear()}`;
    }
}
