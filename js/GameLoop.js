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
        // сетевая кампания живёт в своей ячейке и не трогает одиночную партию
        if (data.multiplayer && data.net) return this.saveCampaign(data);
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

    // --- сетевые кампании ---------------------------------------------------
    // Каждая кампания — в своей ячейке. Хранят и сервер, и гости: гость
    // может потом снова подключиться или сам открыть игру как сервер.
    CAMPAIGN_PREFIX: 'politics-campaign-',
    CAMPAIGN_MAX: 6,
    campaignRole: 'host',

    campaignId() {
        return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    },

    saveCampaign(data) {
        const net = data.net;
        if (!net.id) net.id = this.campaignId();
        const game = data.serialize();
        const meta = {
            id: net.id, code: net.code || '', role: this.campaignRole, you: data.playerCountry,
            names: { ...(net.names || {}) }, humans: [...game.humans], turn: data.turn, date: +data.currentDate,
            goal: data.goal, gameOver: !!data.gameOver,
        };
        const text = JSON.stringify({ map: this.mapId(), savedAt: Date.now(), meta, game });
        const key = this.CAMPAIGN_PREFIX + net.id;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                localStorage.setItem(key, text);
                this.error = '';
                this.pruneCampaigns(net.id);
                return true;
            } catch (e) {
                // места мало — выбрасываем самые старые кампании и пробуем ещё раз
                this.pruneCampaigns(net.id, 1);
            }
        }
        this.error = 'Хранилище переполнено. Сетевая кампания не сохранена.';
        return false;
    },

    campaignKeys() {
        const keys = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.CAMPAIGN_PREFIX)) keys.push(key);
            }
        } catch (e) { /* хранилище недоступно */ }
        return keys;
    },

    // Список кампаний для стартового экрана: самые свежие сверху.
    campaigns() {
        const list = [];
        for (const key of this.campaignKeys()) {
            try {
                const payload = JSON.parse(localStorage.getItem(key));
                if (payload && payload.meta && payload.game) list.push({ key, savedAt: payload.savedAt || 0, meta: payload.meta });
            } catch (e) { /* битая запись — пропускаем */ }
        }
        return list.sort((a, b) => b.savedAt - a.savedAt);
    },

    loadCampaign(id) {
        const raw = localStorage.getItem(this.CAMPAIGN_PREFIX + id);
        if (!raw) throw new Error('Кампания не найдена');
        const payload = JSON.parse(raw);
        const parsed = this.parse(payload);
        return { ...parsed, meta: payload.meta };
    },

    removeCampaign(id) {
        try { localStorage.removeItem(this.CAMPAIGN_PREFIX + id); } catch (e) { /* уже нет */ }
    },

    pruneCampaigns(keepId, extra = 0) {
        const list = this.campaigns().filter(c => c.meta.id !== keepId);
        const allowed = Math.max(0, this.CAMPAIGN_MAX - 1 - extra);
        for (const c of list.slice(allowed)) { try { localStorage.removeItem(c.key); } catch (e) { /* нет */ } }
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
        // на одном устройстве — передать ход следующему; считает последний
        if (d.hotseat && this.onHotseat) { this.onHotseat(); return; }
        this.runTurn();
    }

    // Посчитать ход и показать свой отчёт. before — что сделать до расчёта
    // (в сетевой игре — повторить команды гостей). Возвращает отчёты всех людей.
    runTurn(before, show = true) {
        const d = this.data;
        this.busy = true;
        this.endTurnBtn.disabled = true;
        try {
            if (before) before();
            const reports = this.resolveTurn();
            if (show) this.showReport(reports[d.playerCountry]);
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
        Score.checkEnd(d, events);
        Score.record(d);
        Council.resolve(d, events);
        Council.convene(d, events);
        const diplomacy = d.gameOver ? [] : this.ai.diplomacy();
        Events.roll(d, diplomacy);
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
            if (result.summary) this.ui.toast(result.summary);
            else if (accept && result.ok && !result.stale) {
                const what = { peace: 'мир', deal: 'торговый договор', pact: 'пакт о ненападении', alliance: 'оборонительный союз' }[next.type];
                this.ui.toast(`${from.name}: ${next.type === 'peace' ? 'мир заключён' : `подписан ${what}`}`);
            }
            if (this.map) this.map.refreshColors();
            this.updateTopBarUI();
            SaveGame.save(d);
            this.afterSummary();
        };
        const valid = from?.alive && (next.type === 'peace' ? d.isAtWar(next.from, d.playerCountry) : !d.isAtWar(next.from, d.playerCountry));
        if (!valid && GameData.DIPLO_OFFERS.includes(next.type)) { d.act('answerDecision', false); this.afterSummary(); return; }
        if (next.type === 'council') {
            const c = Council.describe(d, next);
            if (!c.open) { d.act('answerDecision', false); this.afterSummary(); return; }
            this.ui.showDecision({
                title: c.title, text: c.text, accept: c.accept, decline: c.decline,
                onAccept: () => { d.act('answerDecision', true); this.ui.toast('🏛️ Ваш голос: за'); this.afterDecision(); },
                onDecline: () => { d.act('answerDecision', false); this.ui.toast('🏛️ Ваш голос: против'); this.afterDecision(); },
            });
            return;
        }
        if (next.type === 'trade') {
            const t = Trade.describe(d, next.from, d.playerCountry, Trade.normalize(next.offer));
            const lines = [`Даёт вам: ${t.give}`, `Просит у вас: ${t.get}`];
            if (t.treaties) lines.push(`Договоры: ${t.treaties}`);
            this.ui.showDecision({
                title: `📦 ${from.name} (игрок) предлагает сделку`,
                text: lines.join('\n'),
                accept: 'Принять', decline: 'Отказать', alt: '✏️ Встречное предложение',
                onAccept: () => {
                    const r = d.act('answerDecision', true);
                    this.ui.toast(r.accepted ? 'Сделка заключена' : `Сделка сорвалась: ${r.failed}`);
                    this.afterDecision();
                },
                onDecline: () => finish(false),
                onAlt: () => this.ui.showTradeEditor(d, next.from, Trade.reverse(Trade.normalize(next.offer)), offer => {
                    const check = Trade.problem(d, d.playerCountry, next.from, Trade.normalize(offer));
                    if (check) return { ok: false, reason: check[0].toUpperCase() + check.slice(1) };
                    d.act('answerDecision', false);
                    const r = d.act('proposeTrade', next.from, offer);
                    this.ui.toast(r.ok ? 'Встречная сделка отправлена' : r.reason);
                    this.afterDecision();
                    return { ok: true };
                }, () => this.afterSummary()),
            });
            return;
        }
        if (next.type === 'rebels') {
            const region = d.regions[next.region];
            if (!region || !d.revolts[next.region]) { d.act('answerDecision', false); this.afterSummary(); return; }
            this.ui.showDecision({
                title: `🔥 Мятежная область ${region.name} просится к вам`,
                text: `В области ${region.name} (${from.name}) восстание. Если через ${d.revolts[next.region].left} ход. мятежники победят, область перейдёт к вам. Отношения со страной ${from.name} ухудшатся на ${-REVOLT.SECEDE_RELATION}.`,
                accept: 'Принять область', decline: 'Отказаться',
                onAccept: () => finish(true), onDecline: () => finish(false),
            });
            return;
        }
        if (next.type === 'event') {
            const ev = Events.describe(d, next);
            this.ui.showDecision({ ...ev, onAccept: () => finish(true), onDecline: () => finish(false) });
            return;
        }
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

    afterDecision() {
        const d = this.data;
        if (this.map) { this.map.refreshColors(); this.map.createCountryLabels(); this.map.drawArmyMarkers(); }
        this.updateTopBarUI();
        SaveGame.save(d);
        this.afterSummary();
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
