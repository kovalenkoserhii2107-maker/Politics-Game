// =====================================================================
// ИГРОВОЙ ЦИКЛ И СОХРАНЕНИЕ
// =====================================================================

// Сохранение в localStorage. На телефоне браузер выгружает вкладку в фоне,
// поэтому игра пишется после каждого хода и при сворачивании.
const SaveGame = {
    KEY: 'politics-game-save',

    // Сохранение привязано к конкретной нарезке карты: после перегенерации
    // областей старые id уже ничего не значат.
    mapId() {
        const ids = Object.keys(RegionsDB);
        return `${ids.length}:${ids[0]}:${ids[ids.length - 1]}`;
    },

    save(data) {
        try {
            const payload = { map: this.mapId(), savedAt: Date.now(), game: data.serialize() };
            localStorage.setItem(this.KEY, JSON.stringify(payload));
            return true;
        } catch (e) {
            return false;
        }
    },

    load() {
        try {
            const raw = localStorage.getItem(this.KEY);
            if (!raw) return null;
            const payload = JSON.parse(raw);
            if (payload.map !== this.mapId() || !payload.game || payload.game.v !== 2) return null;
            return payload;
        } catch (e) {
            return null;
        }
    },

    clear() {
        try { localStorage.removeItem(this.KEY); } catch (e) { /* хранилище недоступно */ }
    },
};

class GameLoop {
    constructor(gameData, uiManager, mapEngine, ai) {
        this.data = gameData;
        this.ui = uiManager;
        this.map = mapEngine;
        this.ai = ai;
        this.busy = false;

        this.monthNames = ['Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня',
                           'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря'];

        this.endTurnBtn = document.getElementById('end-turn-btn');
        this.endTurnBtn.addEventListener('click', () => this.processTurn());
        this.updateTopBarUI();
        this.ui.updateZoomMode(this.map.isRegionalZoom);
    }

    getProjectedNetIncome(countryId) {
        const balance = this.data.countryBalance(countryId);
        return balance.income - balance.expense;
    }

    formatDate(date) {
        return `${date.getDate()} ${this.monthNames[date.getMonth()]} ${date.getFullYear()}`;
    }

    processTurn() {
        const d = this.data;
        if (this.busy || d.gameOver) return;
        this.busy = true;
        this.endTurnBtn.disabled = true;

        this.ai.planTurn();
        const { logs, worldBattles } = d.processOrders();
        const { balances, events } = d.applyEndOfTurn();
        d.turn++;
        d.currentDate.setDate(d.currentDate.getDate() + 7);
        const diplomacy = d.gameOver ? [] : this.ai.diplomacy();

        this.map.refreshColors();
        this.map.createCountryLabels();
        this.updateTopBarUI();

        const player = balances[d.playerCountry] || { income: 0, expense: 0 };
        const turnData = {
            date: this.formatDate(d.currentDate),
            financial: { income: player.income, expense: player.expense, net: player.income - player.expense },
            logs,
            events: [...events, ...diplomacy].map(e => e.message),
            worldBattles,
        };
        d.saveTurnHistory(turnData);
        SaveGame.save(d);

        this.ui.updateOrdersPanel(d);
        this.ui.showTurnSummary(turnData, () => this.afterSummary());

        this.busy = false;
        this.endTurnBtn.disabled = false;
    }

    // После отчёта: сначала решения, которых ждёт ИИ, потом — конец игры.
    afterSummary() {
        const d = this.data;
        if (d.gameOver) { this.ui.showGameOver(d); return; }
        const next = d.decisions.shift();
        if (!next) return;
        if (next.type === 'peace') {
            const from = d.countries[next.from];
            if (!from || !from.alive || !d.isAtWar(next.from, d.playerCountry)) { this.afterSummary(); return; }
            const info = d.warInfo(d.playerCountry, next.from);
            this.ui.showDecision({
                title: `🕊️ ${from.name} предлагает мир`,
                text: `Война идёт ${info.turns} ход. Вы заняли областей: ${info.taken}, потеряли: ${info.lost}. `
                    + `Мир закрепит текущую линию фронта и даст перемирие на ${RULES.TRUCE_TURNS} ходов.`,
                accept: 'Заключить мир',
                decline: 'Продолжить войну',
                onAccept: () => {
                    d.makePeace(d.playerCountry, next.from);
                    this.map.refreshColors();
                    this.ui.toast(`Мир с ${from.name} заключён`);
                    SaveGame.save(d);
                    this.afterSummary();
                },
                onDecline: () => this.afterSummary(),
            });
        }
    }

    updateTopBarUI() {
        const player = this.data.getCountry(this.data.playerCountry);
        if (!player) return;

        document.getElementById('glob-money').textContent = this.ui.formatNumber(player.money);
        const net = document.getElementById('glob-net');
        const value = player.lastNetIncome;
        net.textContent = value === 0 ? '(0)'
            : (value > 0 ? '(+' : '(−') + this.ui.formatNumber(Math.abs(value)) + ')';
        net.style.color = value > 0 ? '#4ade80' : value < 0 ? '#f87171' : '#94a3b8';

        document.getElementById('glob-influence').textContent = player.influence;
        document.getElementById('glob-date').textContent = this.formatDate(this.data.currentDate);

        const wars = this.data.enemiesOf(this.data.playerCountry).length;
        const badge = document.getElementById('war-badge');
        if (badge) {
            badge.textContent = wars;
            badge.style.display = wars ? 'inline-flex' : 'none';
        }
    }
}
