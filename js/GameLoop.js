// =====================================================================
// ИГРОВОЙ ЦИКЛ И СОХРАНЕНИЕ
// =====================================================================

// Сохранение в localStorage. На телефоне браузер выгружает вкладку в фоне,
// поэтому игра пишется после каждого хода и при сворачивании.
const SaveGame = {
    KEY: 'politics-game-save',
    BACKUP_KEY: 'politics-game-save-backup',
    migrated: false,
    suspended: false,
    disabled: false,
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
        if (this.disabled) return true;   // гость сетевой игры: мир хранит сервер
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
        this.migrated = false;
        let raw = null;
        try { raw = localStorage.getItem(this.KEY); } catch (e) { return null; }
        if (!raw) return null;
        try {
            const payload = this.parse(raw);
            // Перед тем как новая версия перезапишет партию, кладём исходник рядом.
            if (this.migrated) {
                try { localStorage.setItem(this.BACKUP_KEY, raw); } catch (e) { /* место кончилось — не критично */ }
            }
            return payload;
        } catch (e) {
            this.error = 'Старое сохранение не подходит к новой версии игры. Начните новую партию.';
            return null;
        }
    },

    // Разбор партии из хранилища или файла. Партия текущей версии проходит
    // как есть, партия прошлой версии переносится (this.migrated = true).
    parse(text) {
        this.migrated = false;
        const payload = typeof text === 'string' ? JSON.parse(text) : text;
        if (!payload || typeof payload !== 'object' || !payload.game) throw new Error('В файле нет партии');
        if (payload.map === this.mapId()) {
            try {
                GameData.validateSave(payload.game);
                return payload;
            } catch (e) { /* пробуем перенести */ }
        }
        const game = GameData.migrateSave(payload.game);
        this.migrated = true;
        return { map: this.mapId(), savedAt: payload.savedAt || Date.now(), game };
    },

    // Файл для переноса партии на другое устройство или про запас.
    exportFile(data) {
        const payload = { app: 'politics-game', map: this.mapId(), savedAt: Date.now(), game: data.serialize() };
        const name = `politics-${data.playerCountry.toLowerCase()}-turn${data.turn}.json`;
        return { name, text: JSON.stringify(payload) };
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
        // в сетевой игре ход считается, когда готовы все — это решает Net
        if (this.net) { this.net.toggleReady(); return; }
        this.runTurn();
    }

    // Посчитать ход и показать свой отчёт. before — что сделать до расчёта
    // (в сетевой игре — повторить команды гостей). Возвращает отчёты всех людей.
    runTurn(before) {
        const d = this.data;
        this.busy = true;
        this.endTurnBtn.disabled = true;
        try {
            if (before) before();
            const reports = this.resolveTurn();
            this.showReport(reports[d.playerCountry]);
            return reports;
        } catch (error) {
            console.error(error);
            this.ui.toast('Не удалось завершить ход. Перезагрузите последнее сохранение.');
            this.failed = true;
            SaveGame.suspended = true; // Preserve the last complete save after a failed turn.
            return null;
        } finally {
            this.busy = false;
            this.syncTurnButton();
        }
    }

    // Расчёт хода — один на всех. Каждому человеку — свой отчёт: его бои,
    // его события, его доходы, его захваченные и потерянные области.
    resolveTurn() {
        const d = this.data;
        const before = {};
        for (const region of Object.values(d.regions)) before[region.id] = region.owner;

        this.ai.planTurn();
        const { logs, worldBattles } = d.processOrders();
        const { balances, events } = d.applyEndOfTurn();
        d.turn++;
        d.currentDate.setDate(d.currentDate.getDate() + 7);
        const diplomacy = d.gameOver ? [] : this.ai.diplomacy();
        const shared = [...events, ...diplomacy, ...d.takeDiploEvents()];

        const reports = {};
        for (const cc of d.humans) {
            const gained = [], lost = [];
            for (const region of Object.values(d.regions)) {
                if (before[region.id] === region.owner) continue;
                if (region.owner === cc) gained.push(region.id);
                else if (before[region.id] === cc) lost.push(region.id);
            }
            const missions = d.withPlayer(cc, () => Missions.update(d));
            const balance = balances[cc] || { income: 0, expense: 0 };
            const turnData = {
                date: this.formatDate(d.currentDate),
                financial: { income: balance.income, expense: balance.expense, net: balance.income - balance.expense },
                logs: logs.filter(l => l.for === cc),
                events: [...shared.filter(e => !e.for || e.for === cc), ...missions].map(e => e.message),
                worldBattles,
            };
            d.withPlayer(cc, () => d.saveTurnHistory(turnData));
            reports[cc] = { turnData, gained, lost };
        }
        return reports;
    }

    showReport(report) {
        const d = this.data;
        const { turnData, gained, lost } = report;
        this.lastChanges = { gained, lost };
        this.map.refreshColors();
        this.map.markChanges(gained, lost);
        this.map.createCountryLabels();
        this.map.drawArmyMarkers();
        this.updateTopBarUI();
        if (!SaveGame.save(d)) this.ui.toast(SaveGame.error);
        this.ui.updateOrdersPanel(d);
        this.awaitingSummary = true;
        this.ui.showTurnSummary(turnData, () => { this.awaitingSummary = false; this.afterSummary(); });
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
        if (!next) { this.revealChanges(); return; }
        const from = d.countries[next.from];
        const finish = accept => {
            const result = d.act('answerDecision', accept);
            if (accept && result.ok && !result.stale) {
                const what = { peace: 'мир', deal: 'торговый договор', pact: 'пакт о ненападении', alliance: 'оборонительный союз' }[next.type];
                this.ui.toast(`${from.name}: ${next.type === 'peace' ? 'мир заключён' : `подписан ${what}`}`);
            }
            if (this.map) this.map.refreshColors();
            this.updateTopBarUI();
            SaveGame.save(d);
            this.afterSummary();
        };
        const valid = from?.alive && (next.type === 'peace' ? d.isAtWar(next.from, d.playerCountry) : !d.isAtWar(next.from, d.playerCountry));
        if (!valid) { d.act('answerDecision', false); this.afterSummary(); return; }
        const human = d.isHuman(next.from) ? ' (игрок)' : '';
        if (next.type === 'peace') {
            const info = d.warInfo(d.playerCountry, next.from);
            this.ui.showDecision({
                title: `${from.name}${human} предлагает мир`,
                text: `Война идёт ${info.turns} ход. Вы заняли областей: ${info.taken}, потеряли: ${info.lost}. Мир сохранит текущие границы. Перемирие: ${RULES.TRUCE_TURNS} ходов.`,
                accept: 'Заключить мир', decline: 'Продолжить войну',
                onAccept: () => finish(true),
                onDecline: () => finish(false),
            });
            return;
        }
        const texts = {
            deal: ['торговый договор', `Ваши продажи на рынке станут на ${Math.round(DIPLOMACY.DEAL_BONUS * 100)}% дороже, закупки — дешевле (до ${DIPLOMACY.DEAL_MAX} договоров). Отношения улучшатся.`],
            pact: ['пакт о ненападении', `${DIPLOMACY.PACT_TURNS} ходов ни вы, ни они не сможете объявить войну друг другу.`],
            alliance: ['оборонительный союз', 'Если на одного из вас нападут, второй вступит в войну против нападающего. Напасть на союзника нельзя.'],
        }[next.type];
        this.ui.showDecision({
            title: `${from.name}${human} предлагает ${texts[0]}`,
            text: `${texts[1]} Отношения сейчас: ${Diplomacy.relation(d, d.playerCountry, next.from)}.`,
            accept: 'Согласиться', decline: 'Отказаться',
            onAccept: () => finish(true),
            onDecline: () => finish(false),
        });
    }

    // После отчёта и решений показываем, где на карте что изменилось.
    revealChanges() {
        const changes = this.lastChanges;
        this.lastChanges = null;
        if (!changes || (!changes.gained.length && !changes.lost.length)) return;
        this.map.showRegion(changes.lost[0] || changes.gained[0]);
        const parts = [];
        if (changes.gained.length) parts.push(`захвачено областей: ${changes.gained.length}`);
        if (changes.lost.length) parts.push(`потеряно: ${changes.lost.length}`);
        const text = parts.join(', ');
        this.ui.toast(text[0].toUpperCase() + text.slice(1) + ' — отмечено на карте');
    }

    updateTopBarUI() {
        const player = this.data.getCountry(this.data.playerCountry);
        if (!player) return;

        document.getElementById('glob-money').textContent = this.ui.formatNumber(player.money);
        const net = document.getElementById('glob-net');
        const value = this.getProjectedNetIncome(player.id);
        net.textContent = value === 0 ? '(0)'
            : (value > 0 ? '(+' : '(−') + this.ui.formatNumber(Math.abs(value)) + ')';
        net.style.color = value > 0 ? 'var(--good)' : value < 0 ? 'var(--accent-2)' : 'var(--text-3)';

        document.getElementById('glob-influence').textContent = player.influence;
        this.ui.updateResourceStatus(this.data);
        this.ui.updateScienceBadge(this.data);
        document.getElementById('glob-date').textContent = this.formatDate(this.data.currentDate);

        const ready = Missions.readyCount(this.data);
        const missionBadge = document.getElementById('campaign-count');
        if (missionBadge) {
            missionBadge.textContent = ready;
            missionBadge.classList.toggle('visible', ready > 0);
        }
        const wars = this.data.enemiesOf(this.data.playerCountry).length;
        const badge = document.getElementById('war-badge');
        if (badge) {
            badge.textContent = wars;
            badge.style.display = wars ? 'inline-flex' : 'none';
        }
    }
}
