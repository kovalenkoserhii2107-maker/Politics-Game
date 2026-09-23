// =====================================================================
// ИГРОВОЙ ЦИКЛ И СОХРАНЕНИЕ
// =====================================================================

// Сохранение в localStorage. На телефоне браузер выгружает вкладку в фоне,
// поэтому игра пишется после каждого хода и при сворачивании.
const SaveGame = {
    KEY: 'politics-game-save',
    suspended: false,
    error: '',
    signature: null,

    mapId() {
        if (this.signature) return this.signature;
        // Include geometry, owners, links and cities, not merely endpoint IDs.
        const input = JSON.stringify([RegionsDB, NeighborsDB, CitiesDB, Object.keys(UnitsDB)]);
        let a = 2166136261, b = 5381;
        for (let i = 0; i < input.length; i++) {
            const code = input.charCodeAt(i);
            a = Math.imul(a ^ code, 16777619);
            b = Math.imul(b, 33) ^ code;
        }
        this.signature = `map3:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
        return this.signature;
    },

    save(data) {
        if (this.suspended) return false;
        try {
            const payload = { map: this.mapId(), savedAt: Date.now(), game: data.serialize() };
            localStorage.setItem(this.KEY, JSON.stringify(payload));
            this.error = '';
            return true;
        } catch (e) {
            this.error = 'Хранилище недоступно. Прогресс не сохранён.';
            return false;
        }
    },

    load() {
        this.error = '';
        try {
            const raw = localStorage.getItem(this.KEY);
            if (!raw) return null;
            const payload = JSON.parse(raw);
            if (payload.map !== this.mapId()) throw new Error('Другая версия карты');
            GameData.validateSave(payload.game);
            return payload;
        } catch (e) {
            this.error = 'Сохранение несовместимо с этой версией или повреждено. Оно сохранено в хранилище; новая кампания заменит его после подтверждения.';
            return null;
        }
    },

    clear() {
        try { localStorage.removeItem(this.KEY); return true; }
        catch (e) { return false; }
    },

    discard() {
        // pagehide/visibilitychange must not bring the discarded game back.
        this.suspended = true;
        return this.clear();
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
        if (this.failed || this.busy || d.gameOver || this.awaitingSummary || d.decisions.length) return;
        this.busy = true;
        this.endTurnBtn.disabled = true;

        try {
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
        if (!SaveGame.save(d)) this.ui.toast(SaveGame.error);

        this.ui.updateOrdersPanel(d);
        this.awaitingSummary = true;
        this.ui.showTurnSummary(turnData, () => { this.awaitingSummary = false; this.afterSummary(); });
        } catch (error) {
            console.error(error);
            this.ui.toast('Не удалось завершить ход. Перезагрузите последнее сохранение.');
            this.failed = true;
            SaveGame.suspended = true; // Preserve the last complete save after a failed turn.
        } finally {
            this.busy = false;
            this.syncTurnButton();
        }
    }

    // После отчёта: сначала решения, которых ждёт ИИ, потом — конец игры.
    syncTurnButton() {
        this.endTurnBtn.disabled = !!(this.busy || this.failed || this.awaitingSummary || this.data.gameOver || this.data.decisions.length);
    }

    afterSummary() {
        const d = this.data;
        this.syncTurnButton();
        if (d.gameOver) { this.ui.showGameOver(d); return; }
        // Keep pending decisions in state until the answer is committed.
        const next = d.decisions[0];
        if (!next) return;
        const from = d.countries[next.from];
        if (next.type !== 'peace' || !from?.alive || !d.isAtWar(next.from, d.playerCountry)) {
            d.decisions.shift();
            SaveGame.save(d);
            this.afterSummary();
            return;
        }
        const info = d.warInfo(d.playerCountry, next.from);
        const finish = accepted => {
            if (accepted) {
                d.makePeace(d.playerCountry, next.from);
                this.map.refreshColors();
                this.ui.toast(`Мир с ${from.name} заключён`);
            }
            d.decisions.shift();
            this.updateTopBarUI();
            SaveGame.save(d);
            this.afterSummary();
        };
        this.ui.showDecision({
            title: `${from.name} предлагает мир`,
            text: `Война идёт ${info.turns} ход. Вы заняли областей: ${info.taken}, потеряли: ${info.lost}. Мир сохранит текущие границы. Перемирие: ${RULES.TRUCE_TURNS} ходов.`,
            accept: 'Заключить мир', decline: 'Продолжить войну',
            onAccept: () => finish(true), onDecline: () => finish(false),
        });
    }

    updateTopBarUI() {
        const player = this.data.getCountry(this.data.playerCountry);
        if (!player) return;

        document.getElementById('glob-money').textContent = this.ui.formatNumber(player.money);
        const net = document.getElementById('glob-net');
        const value = this.getProjectedNetIncome(player.id);
        net.textContent = value === 0 ? '(0)'
            : (value > 0 ? '(+' : '(−') + this.ui.formatNumber(Math.abs(value)) + ')';
        net.style.color = value > 0 ? '#4ade80' : value < 0 ? '#f87171' : '#94a3b8';

        document.getElementById('glob-influence').textContent = player.influence;
        document.getElementById('glob-date').textContent = this.formatDate(this.data.currentDate);

        const progress = this.data.campaignProgress();
        const campaignLabel = document.getElementById('campaign-count');
        if (campaignLabel) campaignLabel.textContent = `${progress.controlled}/${progress.total}`;
        const wars = this.data.enemiesOf(this.data.playerCountry).length;
        const badge = document.getElementById('war-badge');
        if (badge) {
            badge.textContent = wars;
            badge.style.display = wars ? 'inline-flex' : 'none';
        }
    }
}
