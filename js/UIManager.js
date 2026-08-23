// =====================================================================
// ИНТЕРФЕЙС: боковая панель, модальные окна, журнал приказов
// =====================================================================
class UIManager {
    constructor() {
        this.panel = document.getElementById('side-panel');
        this.badge = document.getElementById('panel-badge');
        this.zoomIndicator = document.getElementById('zoom-mode');
        this.toastEl = document.getElementById('toast');
        this.suppressPanelEvent = false;

        const bind = (id, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', handler);
        };
        bind('close-panel-btn', () => this.closePanel());
        bind('gov-btn', () => this.openGovPanel());
        bind('close-gov-btn', () => this.closeGovPanel());
        bind('close-summary-btn', () => this.hideModal('summary-modal'));
        bind('close-history-btn', () => this.hideModal('history-modal'));

        for (const id of ['summary-modal', 'history-modal', 'gov-modal']) {
            const modal = document.getElementById(id);
            if (modal) modal.addEventListener('click', e => { if (e.target === modal) this.hideModal(id); });
        }
    }

    formatNumber(num) {
        const sign = num < 0 ? '−' : '';
        const abs = Math.abs(num);
        if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B';
        if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
        return sign + Math.floor(abs);
    }

    toast(message) {
        if (!this.toastEl) return;
        this.toastEl.textContent = message;
        this.toastEl.classList.add('visible');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.toastEl.classList.remove('visible'), 2600);
    }

    hideToast() {
        if (this.toastEl) this.toastEl.classList.remove('visible');
    }

    flashZoomIndicator() {
        const el = document.getElementById('zoom-indicator');
        if (!el) return;
        el.classList.add('visible');
        clearTimeout(this.zoomTimer);
        this.zoomTimer = setTimeout(() => el.classList.remove('visible'), 1800);
    }

    updateZoomMode(isRegional) {
        if (!this.zoomIndicator) return;
        this.zoomIndicator.textContent = isRegional ? 'Региональное (области)' : 'Глобальное (страны)';
        this.zoomIndicator.style.color = isRegional ? 'var(--ui-accent)' : 'var(--ui-accent-country)';
    }

    hideModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    }

    showModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    // --- карточка страны ------------------------------------------------
    showCountryInfo(country, stats, gameData) {
        if (!country) return;
        this.badge.className = 'badge country';
        this.badge.textContent = 'Статистика страны';

        document.getElementById('panel-title').textContent = country.name;
        document.getElementById('panel-owner-wrap').style.display = 'none';
        this.fillEconomy(stats);

        const power = gameData.calculateMilitaryPower(country.id);
        const container = document.getElementById('region-army-container');
        container.innerHTML = this.powerBlock('Глобальная военная мощь', power)
            + this.armyList(stats.army, 'Вооружённые силы (всего)', false);

        document.getElementById('action-buttons-container').style.display = 'none';
        document.getElementById('army-action-panel').style.display = 'none';
        this.panel.classList.add('active');
    }

    // --- карточка области -----------------------------------------------
    showRegionInfo(region, country, gameData, playerCountryId, core) {
        if (!region || !country) return;
        this.badge.className = 'badge region';
        this.badge.textContent = 'Данные области';

        document.getElementById('panel-title').textContent = region.name;
        document.getElementById('panel-owner-wrap').style.display = 'block';
        document.getElementById('panel-owner').textContent = country.name;
        document.getElementById('panel-color').style.background = country.color;
        this.fillEconomy({ population: region.population, ...region.resources });

        const isOwner = region.owner === playerCountryId;
        const isNeighbor = gameData.isNeighborToPlayer(region.id);
        const reconActive = region.reconActiveUntil && region.reconActiveUntil >= gameData.currentDate;
        const canSeePower = isOwner || isNeighbor || reconActive;
        const canSeeGarrison = isOwner || reconActive;

        const container = document.getElementById('region-army-container');
        let html = canSeePower
            ? this.powerBlock('Военная мощь области', gameData.calculateRegionMilitaryPower(region.id))
            : '';

        if (canSeeGarrison) {
            html += this.armyList(region.army, 'Гарнизон', isOwner);
        } else {
            const power = gameData.calculateRegionMilitaryPower(region.id);
            const chance = Math.max(15, 95 - Math.floor(power * 0.15));
            const queued = gameData.orders.recon.some(o => o.target === region.id);
            html += `
                <h3 class="section-title">Гарнизон</h3>
                <div class="fog-box">
                    <div class="fog-icon">${canSeePower ? '🕵️' : '🌫️'}</div>
                    <div class="fog-text">${canSeePower ? 'Точный состав гарнизона неизвестен.' : 'Данные скрыты туманом войны.'}</div>
                    <div class="fog-chance">Вероятность успеха: ~${chance}%</div>
                    <button id="spy-btn" data-chance="${chance}" ${queued ? 'disabled' : ''}>
                        ${queued ? 'Разведка в плане' : 'Отправить шпионов ($50k)'}
                    </button>
                </div>`;
        }
        container.innerHTML = html;

        document.getElementById('action-buttons-container').style.display = 'block';
        document.getElementById('army-action-panel').style.display = 'none';

        this.bindRecruit(region, gameData, playerCountryId, core);
        this.bindSpy(region, gameData, playerCountryId);
        this.panel.classList.add('active');
    }

    fillEconomy(stats) {
        document.getElementById('panel-pop').textContent = this.formatNumber(stats.population);
        document.getElementById('panel-oil').textContent = stats.oil;
        document.getElementById('panel-agro').textContent = stats.agro;
        document.getElementById('panel-ind').textContent = stats.industry;
    }

    powerBlock(label, value) {
        return `
        <div class="info-grid power-grid">
            <div class="info-box power-box">
                <div class="label">⚔️ ${label}</div>
                <div class="val">${this.formatNumber(value)}</div>
            </div>
        </div>`;
    }

    armyList(army, title, showZeros) {
        let rows = '';
        for (const unitId of Object.keys(UnitsDB)) {
            const count = (army && army[unitId]) || 0;
            if (!count && !showZeros) continue;
            const unit = UnitsDB[unitId];
            rows += `
                <div class="army-list-item">
                    <span class="unit-name"><span class="unit-icon">${unit.icon}</span>${unit.name}</span>
                    <span class="unit-count">${this.formatNumber(count)}</span>
                </div>`;
        }
        if (!rows) rows = '<div class="muted">Войск не обнаружено</div>';
        return `<h3 class="section-title">${title}</h3><div class="army-list">${rows}</div>`;
    }

    bindRecruit(region, gameData, playerCountryId, core) {
        const btn = document.getElementById('recruit-btn');
        if (!btn) return;
        const fresh = btn.cloneNode(true);
        btn.parentNode.replaceChild(fresh, btn);

        if (region.owner !== playerCountryId) { fresh.style.display = 'none'; return; }
        fresh.style.display = 'block';
        fresh.addEventListener('click', () => {
            const amount = gameData.getRecruitPotential(region.id);
            gameData.queueRecruitment(region.id, amount);
            this.updateOrdersPanel(gameData.orders);
            this.toast(`Запланирован набор: +${amount} батальонов`);
            if (core) core.updateActionButtons(region.id);
        });
    }

    bindSpy(region, gameData, playerCountryId) {
        const btn = document.getElementById('spy-btn');
        if (!btn || btn.disabled) return;
        btn.addEventListener('click', () => {
            if (!gameData.queueRecon(region.id, 50000, parseInt(btn.dataset.chance, 10), region.name)) {
                this.toast('Недостаточно средств для разведки ($50k)');
                return;
            }
            document.getElementById('glob-money').textContent =
                this.formatNumber(gameData.getCountry(playerCountryId).money);
            this.updateOrdersPanel(gameData.orders);
            this.markSpyQueued();
        });
    }

    markSpyQueued() {
        const btn = document.getElementById('spy-btn');
        if (!btn) return;
        btn.textContent = 'Разведка в плане';
        btn.disabled = true;
    }

    resetSpyButton() {
        const btn = document.getElementById('spy-btn');
        if (!btn) return;
        btn.textContent = 'Отправить шпионов ($50k)';
        btn.disabled = false;
    }

    // --- журнал приказов --------------------------------------------------
    updateOrdersPanel(orders) {
        const panel = document.getElementById('orders-panel');
        const list = document.getElementById('orders-list');
        if (!panel || !list) return;

        const groups = [
            ['recruitment', '🛡️', 'recruit', o => o.text],
            ['recon', '🕵️', 'recon', o => `Разведка: ${o.regionName}`],
            ['movements', '🚚', 'move', o => o.text],
            ['attacks', '⚔️', 'attack', o => o.text],
        ];
        const total = groups.reduce((sum, [key]) => sum + orders[key].length, 0);
        if (!total) { panel.style.display = 'none'; list.innerHTML = ''; return; }

        const items = [];
        for (const [key, icon, cls, label] of groups) {
            orders[key].forEach((order, index) => {
                items.push(`<li class="order order-${cls}">
                    <span>${icon} ${label(order)}</span>
                    <button class="cancel-order-btn" data-type="${key}" data-order-index="${index}"
                            title="Отменить приказ">×</button></li>`);
            });
        }
        list.innerHTML = items.join('');
        panel.style.display = 'block';
    }

    closePanel() {
        if (this.panel) this.panel.classList.remove('active');
        document.dispatchEvent(new Event('panelClosed'));
    }

    // Панель закрывается, но режим выбора цели на карте остаётся активным.
    closePanelKeepTargeting() {
        if (this.panel) this.panel.classList.remove('active');
    }

    openGovPanel() { this.showModal('gov-modal'); }
    closeGovPanel() { this.hideModal('gov-modal'); }

    // --- итоги хода ----------------------------------------------------------
    showTurnSummary(turnData) {
        this.closePanel();
        this.closeGovPanel();

        document.getElementById('summary-title').textContent = `Итоги на ${turnData.date}`;
        const net = turnData.financial.net;
        document.getElementById('summary-financial').innerHTML = `
            <div>Доходы: <span class="pos">+$${this.formatNumber(turnData.financial.income)}</span></div>
            <div>Расходы: <span class="neg">−$${this.formatNumber(turnData.financial.expense)}</span></div>
            <div class="summary-total">Сальдо:
                <span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}$${this.formatNumber(Math.abs(net))}</span>
            </div>`;

        document.getElementById('summary-content').innerHTML = turnData.logs.length
            ? turnData.logs.map(log => this.logBlock(log)).join('')
            : '<div class="muted center">Войска остались на позициях. Боестолкновений нет.</div>';
        this.showModal('summary-modal');
    }

    logBlock(log) {
        let html = `<div class="log-entry ${log.success ? 'ok' : 'fail'}">
            <div class="log-message">${log.message}</div>`;
        if (log.losses) {
            const describe = (obj, prefix) => Object.keys(obj)
                .filter(id => obj[id] > 0)
                .map(id => `${prefix}${obj[id]} ${UnitsDB[id].name}`)
                .join(', ');
            html += `<div class="log-losses">
                <div><b>Наши силы:</b> ${describe(log.losses.initialAttacker, '') || '—'}<br>
                     <span class="neg"><b>Потери:</b> ${describe(log.losses.attacker, '−') || 'без потерь'}</span></div>
                <div><span class="neg"><b>Потери врага:</b><br>${describe(log.losses.defender, '−') || 'без потерь'}</span></div>
            </div>`;
        }
        return html + '</div>';
    }

    showHistory(history) {
        this.closePanel();
        this.closeGovPanel();
        const container = document.getElementById('history-content');

        container.innerHTML = history.length
            ? history.map(turn => {
                const net = turn.financial.net;
                const logs = turn.logs.length
                    ? turn.logs.map(l => `<div class="${l.success ? 'pos' : 'neg'} history-line">• ${l.message}</div>`).join('')
                    : '<div class="muted">Событий не зафиксировано.</div>';
                return `<div class="history-block">
                    <div class="history-head">
                        <strong>${turn.date}</strong>
                        <span class="${net >= 0 ? 'pos' : 'neg'}">Сальдо: ${net >= 0 ? '+' : '−'}$${this.formatNumber(Math.abs(net))}</span>
                    </div>${logs}</div>`;
            }).join('')
            : '<div class="muted center">Журнал пуст.</div>';
        this.showModal('history-modal');
    }
}
