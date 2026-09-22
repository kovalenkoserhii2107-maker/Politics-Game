// =====================================================================
// ИНТЕРФЕЙС: панели, модальные окна, план хода
//
// UIManager только рисует. Что делать по нажатию, решает GameCore — кнопки
// действий несут data-action, клики ловит один делегированный слушатель.
// =====================================================================
class UIManager {
    constructor() {
        this.panel = document.getElementById('side-panel');
        this.badge = document.getElementById('panel-badge');
        this.zoomIndicator = document.getElementById('zoom-mode');
        this.toastEl = document.getElementById('toast');

        const bind = (id, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', handler);
        };
        bind('close-panel-btn', () => this.closePanel());
        bind('close-gov-btn', () => this.hideModal('gov-modal'));
        bind('close-history-btn', () => this.hideModal('history-modal'));
        bind('close-diplo-btn', () => this.hideModal('diplo-modal'));
        bind('close-summary-btn', () => this.closeSummary());

        for (const id of ['history-modal', 'gov-modal', 'diplo-modal']) {
            const modal = document.getElementById(id);
            if (modal) modal.addEventListener('click', e => { if (e.target === modal) this.hideModal(id); });
        }
        const summary = document.getElementById('summary-modal');
        summary.addEventListener('click', e => { if (e.target === summary) this.closeSummary(); });

        this.initSheetSwipe();
        this.initOrdersToggle();
    }

    // --- мелочи ----------------------------------------------------------
    formatNumber(num) {
        const sign = num < 0 ? '−' : '';
        const abs = Math.abs(num);
        if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B';
        if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
        return sign + Math.floor(abs);
    }

    money(num) { return (num < 0 ? '−$' : '$') + this.formatNumber(Math.abs(num)); }

    escape(text) {
        return String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    }

    toast(message) {
        if (!this.toastEl) return;
        this.toastEl.textContent = message;
        this.toastEl.classList.add('visible');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.toastEl.classList.remove('visible'), 2600);
    }

    hideToast() { if (this.toastEl) this.toastEl.classList.remove('visible'); }

    // Короткая вибрация на Android — чтобы нажатие ощущалось.
    haptic(ms = 12) {
        try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* нет — и не надо */ }
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

    showModal(id) { const el = document.getElementById(id); if (el) el.classList.add('active'); }
    hideModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('active'); }

    showTargetBanner(text) {
        document.getElementById('target-text').textContent = text;
        document.getElementById('target-banner').classList.add('visible');
    }

    hideTargetBanner() { document.getElementById('target-banner').classList.remove('visible'); }

    // --- шторка на телефоне: смахнуть вниз, чтобы закрыть ------------------
    initSheetSwipe() {
        const handle = document.getElementById('sheet-handle');
        if (!handle) return;
        let startY = null;
        const start = y => { startY = y; this.panel.style.transition = 'none'; };
        const move = y => {
            if (startY === null) return;
            const dy = Math.max(0, y - startY);
            this.panel.style.transform = `translateY(${dy}px)`;
        };
        const end = y => {
            if (startY === null) return;
            const dy = y - startY;
            startY = null;
            this.panel.style.transition = '';
            this.panel.style.transform = '';
            if (dy > 80) this.closePanel();
        };
        handle.addEventListener('touchstart', e => start(e.touches[0].clientY), { passive: true });
        handle.addEventListener('touchmove', e => move(e.touches[0].clientY), { passive: true });
        handle.addEventListener('touchend', e => end(e.changedTouches[0].clientY));
        handle.addEventListener('click', () => this.closePanel());
    }

    initOrdersToggle() {
        const toggle = document.getElementById('orders-toggle');
        if (!toggle) return;
        toggle.addEventListener('click', () => document.getElementById('orders-panel').classList.toggle('collapsed'));
    }

    // --- общие куски карточек ------------------------------------------------
    fillEconomy(stats) {
        document.getElementById('panel-pop').textContent = this.formatNumber(stats.population);
        document.getElementById('panel-oil').textContent = stats.oil;
        document.getElementById('panel-agro').textContent = stats.agro;
        document.getElementById('panel-ind').textContent = stats.industry;
    }

    tag(text, kind = '') { return `<span class="tag ${kind}">${text}</span>`; }

    relationTag(data, countryId) {
        const player = data.playerCountry;
        if (countryId === player) return this.tag('Ваша страна', 'own');
        if (data.isAtWar(player, countryId)) return this.tag('⚔️ Война', 'war');
        const truce = data.truceLeft(player, countryId);
        if (truce) return this.tag(`🕊️ Перемирие ${truce} ход.`, 'truce');
        return this.tag('Мир', 'peace');
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
        if (!rows) rows = '<div class="muted">Войск нет</div>';
        return `<h3 class="section-title">${title}</h3><div class="army-list">${rows}</div>`;
    }

    // Кнопки войны и мира. Если действие недоступно — показываем почему.
    diplomacyButtons(data, countryId) {
        const player = data.playerCountry;
        if (countryId === player) return '';
        const target = data.countries[countryId];
        if (!target.playable) return '<div class="hint">Территория без собственного правительства.</div>';

        if (data.isAtWar(player, countryId)) {
            const info = data.warInfo(player, countryId);
            const can = data.countries[player].influence >= RULES.PEACE_COST;
            return `
                <div class="war-summary">Война идёт ${info.turns} ход. · заняли ${info.taken} · потеряли ${info.lost}</div>
                <button class="action-btn peace" data-action="peace" data-country="${countryId}" ${can ? '' : 'disabled'}>
                    🕊️ Предложить мир <small>−${RULES.PEACE_COST} влияния</small>
                </button>
                ${can ? '' : `<div class="hint">Нужно ${RULES.PEACE_COST} влияния.</div>`}`;
        }
        const check = data.canDeclareWar(player, countryId);
        return `
            <button class="action-btn war" data-action="war" data-country="${countryId}" ${check.ok ? '' : 'disabled'}>
                ⚔️ Объявить войну <small>−${RULES.WAR_COST} влияния</small>
            </button>
            ${check.ok ? '' : `<div class="hint">${this.escape(check.reason)}</div>`}`;
    }

    resetPanelSections() {
        document.getElementById('recruit-panel').style.display = 'none';
        document.getElementById('army-action-panel').style.display = 'none';
    }

    // --- карточка страны ---------------------------------------------------------
    showCountryInfo(country, stats, data) {
        if (!country) return;
        const isPlayer = country.id === data.playerCountry;
        this.badge.className = 'badge country';
        this.badge.textContent = isPlayer ? 'Ваша страна' : 'Страна';

        document.getElementById('panel-title').textContent = country.name;
        document.getElementById('panel-owner-wrap').style.display = 'none';
        const capital = data.regions[country.capital];
        document.getElementById('panel-tags').innerHTML = [
            this.relationTag(data, country.id),
            capital ? this.tag(`🏛️ ${this.escape(capital.name)}`) : '',
            this.tag(`${stats.regions} обл.`),
        ].join('');
        this.fillEconomy(stats);

        const container = document.getElementById('region-army-container');
        const seeArmy = isPlayer || data.isAtWar(data.playerCountry, country.id);
        container.innerHTML = this.powerBlock('Военная мощь', data.calculateMilitaryPower(country.id))
            + (seeArmy ? this.armyList(stats.army, 'Вооружённые силы', false)
                : '<div class="hint">Точный состав армии известен только своих войск и противников.</div>');

        document.getElementById('diplo-actions').innerHTML = this.diplomacyButtons(data, country.id);
        document.getElementById('action-buttons-container').style.display = 'none';
        this.resetPanelSections();
        this.openPanel();
    }

    // --- карточка области ------------------------------------------------------------
    showRegionInfo(region, country, data) {
        if (!region || !country) return;
        const player = data.playerCountry;
        const isOwner = region.owner === player;

        this.badge.className = 'badge region';
        this.badge.textContent = isOwner ? 'Ваша область' : 'Область';
        document.getElementById('panel-title').textContent = region.name;
        document.getElementById('panel-owner-wrap').style.display = 'block';
        document.getElementById('panel-owner').textContent = country.name;
        document.getElementById('panel-color').style.background = country.color;

        const tags = [this.relationTag(data, region.owner)];
        if (data.isCapital(region.id)) tags.push(this.tag('🏛️ Столица', 'capital'));
        if (region.owner !== region.originalOwner) tags.push(this.tag(`Оккупирована (${data.countries[region.originalOwner].name})`, 'war'));
        tags.push(this.tag(`Лояльность ${Math.round(region.loyalty * 100)}%`, region.loyalty < 0.6 ? 'war' : ''));
        document.getElementById('panel-tags').innerHTML = tags.join('');
        this.fillEconomy({ population: region.population, ...region.resources });

        const isNeighbor = data.isNeighborToPlayer(region.id);
        const reconActive = region.reconActiveUntil && region.reconActiveUntil >= data.currentDate;
        const atWar = data.isAtWar(player, region.owner);
        const canSeePower = isOwner || isNeighbor || reconActive || atWar;
        const canSeeGarrison = isOwner || reconActive;

        let html = canSeePower ? this.powerBlock('Военная мощь области', data.calculateRegionMilitaryPower(region.id)) : '';
        if (canSeeGarrison) {
            html += this.armyList(region.army, 'Гарнизон', isOwner);
        } else {
            const power = data.calculateRegionMilitaryPower(region.id);
            const chance = Math.max(15, 95 - Math.floor(power * 0.05));
            const queued = data.orders.recon.some(o => o.target === region.id);
            html += `
                <h3 class="section-title">Гарнизон</h3>
                <div class="fog-box">
                    <div class="fog-icon">${canSeePower ? '🕵️' : '🌫️'}</div>
                    <div class="fog-text">${canSeePower ? 'Точный состав гарнизона неизвестен.' : 'Данные скрыты туманом войны.'}</div>
                    <div class="fog-chance">Вероятность успеха: ~${chance}%</div>
                    <button class="spy-btn" data-action="spy" data-region="${region.id}" data-chance="${chance}" ${queued ? 'disabled' : ''}>
                        ${queued ? 'Разведка в плане' : `Отправить шпионов (${this.money(RULES.SPY_COST)})`}
                    </button>
                </div>`;
        }
        document.getElementById('region-army-container').innerHTML = html;
        document.getElementById('diplo-actions').innerHTML = isOwner ? '' : this.diplomacyButtons(data, region.owner);
        document.getElementById('action-buttons-container').style.display = isOwner ? 'block' : 'none';
        this.resetPanelSections();
        this.openPanel();
    }

    openPanel() { this.panel.classList.add('active'); document.body.classList.add('sheet-open'); }

    closePanel() {
        this.panel.classList.remove('active');
        document.body.classList.remove('sheet-open');
        document.dispatchEvent(new Event('panelClosed'));
    }

    // Панель закрывается, но режим выбора цели на карте остаётся.
    closePanelKeepTargeting() {
        this.panel.classList.remove('active');
        document.body.classList.remove('sheet-open');
    }

    // --- выбор количества: кнопки вместо клавиатуры ------------------------------------
    // Строка с «−  N  +» и быстрыми долями. Значение живёт в data-value строки.
    stepperRow({ key, icon, label, sub, max, value = 0 }) {
        return `
            <div class="stepper-row" data-key="${key}" data-max="${max}" data-value="${value}">
                <div class="stepper-head">
                    <span class="stepper-label">${icon} ${label}</span>
                    <span class="stepper-sub">${sub}</span>
                </div>
                <div class="stepper-controls">
                    <button class="step-btn" data-step="-1" aria-label="Меньше">−</button>
                    <span class="step-value">${value}</span>
                    <button class="step-btn" data-step="1" aria-label="Больше">+</button>
                    <span class="step-chips">
                        <button class="chip" data-frac="0">0</button>
                        <button class="chip" data-frac="0.5">½</button>
                        <button class="chip" data-frac="1">Все</button>
                    </span>
                </div>
            </div>`;
    }

    bindSteppers(container, onChange) {
        if (container.dataset.bound) return;
        container.dataset.bound = '1';
        container.addEventListener('click', e => {
            const row = e.target.closest('.stepper-row');
            if (!row) return;
            const max = parseInt(row.dataset.max, 10);
            let value = parseInt(row.dataset.value, 10);
            const step = e.target.closest('[data-step]');
            const chip = e.target.closest('[data-frac]');
            if (step) value += parseInt(step.dataset.step, 10);
            else if (chip) value = Math.floor(max * parseFloat(chip.dataset.frac));
            else return;
            this.setStepper(row, value);
            this.haptic(8);
            if (onChange) onChange(row);
        });
    }

    setStepper(row, value) {
        const max = parseInt(row.dataset.max, 10);
        const clamped = Math.max(0, Math.min(max, value));
        row.dataset.value = clamped;
        row.querySelector('.step-value').textContent = clamped;
    }

    readSteppers(container) {
        const values = {};
        for (const row of container.querySelectorAll('.stepper-row')) values[row.dataset.key] = parseInt(row.dataset.value, 10) || 0;
        return values;
    }

    // --- план хода -------------------------------------------------------------------------
    updateOrdersPanel(data) {
        const panel = document.getElementById('orders-panel');
        const list = document.getElementById('orders-list');
        const count = document.getElementById('orders-count');
        const mine = data.playerOrders();

        const groups = [
            ['recruitment', '🏭', 'recruit', o => o.text],
            ['recon', '🕵️', 'recon', o => `Разведка: ${o.regionName}`],
            ['movements', '🚚', 'move', o => o.text],
            ['attacks', '⚔️', 'attack', o => o.text],
        ];
        const items = [];
        for (const [key, icon, cls, label] of groups) {
            for (const { order, index } of mine[key]) {
                items.push(`<li class="order order-${cls}">
                    <span>${icon} ${this.escape(label(order))}</span>
                    <button class="cancel-order-btn" data-type="${key}" data-order-index="${index}" title="Отменить приказ">×</button></li>`);
            }
        }
        if (!items.length) { panel.style.display = 'none'; list.innerHTML = ''; return; }
        list.innerHTML = items.join('');
        count.textContent = items.length;
        panel.style.display = 'block';
    }

    // --- итоги хода ----------------------------------------------------------------------------
    showTurnSummary(turnData, onClose) {
        this.closePanel();
        this.hideModal('gov-modal');
        this.hideModal('diplo-modal');
        this.onSummaryClose = onClose;

        document.getElementById('summary-title').textContent = `Итоги на ${turnData.date}`;
        const net = turnData.financial.net;
        document.getElementById('summary-financial').innerHTML = `
            <div>Доходы: <span class="pos">+${this.money(turnData.financial.income)}</span></div>
            <div>Расходы: <span class="neg">−${this.money(turnData.financial.expense)}</span></div>
            <div class="summary-total">Сальдо: <span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${this.money(net)}</span></div>`;

        let html = '';
        if (turnData.events && turnData.events.length) {
            html += `<div class="event-list">${turnData.events.map(e => `<div class="event">${this.escape(e)}</div>`).join('')}</div>`;
        }
        html += turnData.logs.length
            ? turnData.logs.map(log => this.logBlock(log)).join('')
            : '<div class="muted center">Войска остались на позициях. Боёв с вашим участием не было.</div>';
        if (turnData.worldBattles) html += `<div class="muted center">В мире прошло сражений: ${turnData.worldBattles}.</div>`;
        document.getElementById('summary-content').innerHTML = html;
        this.showModal('summary-modal');
    }

    closeSummary() {
        this.hideModal('summary-modal');
        const next = this.onSummaryClose;
        this.onSummaryClose = null;
        if (next) next();
    }

    logBlock(log) {
        let html = `<div class="log-entry ${log.success ? 'ok' : 'fail'}"><div class="log-message">${this.escape(log.message)}</div>`;
        if (log.detail) html += `<div class="log-detail">${this.escape(log.detail)}</div>`;
        if (log.losses) {
            const describe = (obj, prefix) => Object.keys(obj)
                .filter(id => obj[id] > 0)
                .map(id => `${prefix}${obj[id]} ${UnitsDB[id].name}`)
                .join(', ');
            const ours = log.playerIsAttacker ? 'attacker' : 'defender';
            const theirs = log.playerIsAttacker ? 'defender' : 'attacker';
            html += `<div class="log-power">Атака ${log.power.attack} против обороны ${log.power.defense}${log.power.capital ? ' (столица)' : ''}</div>
                <div class="log-losses">
                    <div><b>Наши потери:</b><br><span class="neg">${describe(log.losses[ours], '−') || 'без потерь'}</span></div>
                    <div><b>Потери врага:</b><br><span class="pos">${describe(log.losses[theirs], '−') || 'без потерь'}</span></div>
                </div>`;
        }
        return html + '</div>';
    }

    showHistory(history) {
        this.closePanel();
        const container = document.getElementById('history-content');
        container.innerHTML = history.length
            ? history.map(turn => {
                const net = turn.financial.net;
                const lines = [...(turn.events || []).map(e => `<div class="history-line">• ${this.escape(e)}</div>`),
                    ...turn.logs.map(l => `<div class="${l.success ? 'pos' : 'neg'} history-line">• ${this.escape(l.message)}</div>`)];
                return `<div class="history-block">
                    <div class="history-head"><strong>${turn.date}</strong>
                        <span class="${net >= 0 ? 'pos' : 'neg'}">Сальдо: ${net >= 0 ? '+' : ''}${this.money(net)}</span></div>
                    ${lines.join('') || '<div class="muted">Событий не зафиксировано.</div>'}</div>`;
            }).join('')
            : '<div class="muted center">Журнал пуст.</div>';
        this.showModal('history-modal');
    }

    // --- решения и конец игры ------------------------------------------------------------------
    showDecision({ title, text, accept, decline, onAccept, onDecline }) {
        document.getElementById('decision-title').textContent = title;
        document.getElementById('decision-text').textContent = text;
        const yes = document.getElementById('decision-accept');
        const no = document.getElementById('decision-decline');
        yes.textContent = accept;
        no.textContent = decline;
        const close = then => { this.hideModal('decision-modal'); yes.onclick = no.onclick = null; then(); };
        yes.onclick = () => close(onAccept);
        no.onclick = () => close(onDecline);
        this.showModal('decision-modal');
        this.haptic(30);
    }

    showGameOver(data) {
        const country = data.countries[data.playerCountry];
        document.getElementById('gameover-text').textContent =
            `${country.name} прекратила существование на ${data.turn}-м ходу. `
            + 'Можно начать заново той же или другой страной.';
        this.showModal('gameover-modal');
    }

    // --- дипломатия ----------------------------------------------------------------------------
    showDiplomacy(data) {
        const player = data.playerCountry;
        const me = data.countries[player];
        const name = cc => this.escape(data.countries[cc].name);
        let html = `<div class="diplo-influence">Влияние: <b>${me.influence}</b> / ${RULES.INFLUENCE_MAX}
            <span class="muted">· +${RULES.INFLUENCE_PER_TURN} за ход · война −${RULES.WAR_COST}, мир −${RULES.PEACE_COST}</span></div>`;

        const enemies = data.enemiesOf(player);
        html += '<h3 class="section-title">Ваши войны</h3>';
        html += enemies.length ? enemies.map(cc => {
            const info = data.warInfo(player, cc);
            return `<div class="diplo-row">
                <div><b>${name(cc)}</b><div class="muted">${info.turns} ход. · заняли ${info.taken} · потеряли ${info.lost}</div></div>
                <button class="mini-btn peace" data-action="peace" data-country="${cc}" ${me.influence >= RULES.PEACE_COST ? '' : 'disabled'}>Мир</button>
            </div>`;
        }).join('') : '<div class="muted">Вы ни с кем не воюете.</div>';

        const truces = [...data.truces.keys()].map(k => k.split('|')).filter(p => p.includes(player))
            .map(p => (p[0] === player ? p[1] : p[0])).filter(cc => data.truceLeft(player, cc));
        if (truces.length) {
            html += '<h3 class="section-title">Перемирия</h3>'
                + truces.map(cc => `<div class="diplo-row"><b>${name(cc)}</b><span class="muted">ещё ${data.truceLeft(player, cc)} ход.</span></div>`).join('');
        }

        const myPower = Math.max(1, data.calculateMilitaryPower(player));
        const neighbours = data.neighbourCountries(player).filter(cc => !data.isAtWar(player, cc))
            .sort((a, b) => data.countries[a].name.localeCompare(data.countries[b].name, 'ru'));
        html += '<h3 class="section-title">Соседи</h3>';
        html += neighbours.length ? neighbours.map(cc => {
            const ratio = data.calculateMilitaryPower(cc) / myPower;
            const verdict = ratio > 1.5 ? ['сильнее вас', 'neg'] : ratio < 0.67 ? ['слабее вас', 'pos'] : ['на равных', ''];
            const check = data.canDeclareWar(player, cc);
            return `<div class="diplo-row">
                <div><b>${name(cc)}</b><div class="muted">армия <span class="${verdict[1]}">${verdict[0]}</span> (×${ratio.toFixed(1)})</div></div>
                <button class="mini-btn war" data-action="war" data-country="${cc}" ${check.ok ? '' : 'disabled'} title="${this.escape(check.reason || '')}">Война</button>
            </div>`;
        }).join('') : '<div class="muted">Сухопутных соседей нет.</div>';

        const worldWars = [...data.wars.keys()].map(k => k.split('|')).filter(p => !p.includes(player));
        if (worldWars.length) {
            html += '<h3 class="section-title">Войны в мире</h3>'
                + worldWars.map(([a, b]) => `<div class="diplo-row"><span>${name(a)} ⚔️ ${name(b)}</span></div>`).join('');
        }
        document.getElementById('diplo-content').innerHTML = html;
        this.showModal('diplo-modal');
    }

    // --- правительство -----------------------------------------------------------------------------
    renderGovernment(data) {
        const player = data.countries[data.playerCountry];
        const balance = data.countryBalance(player.id);
        const net = balance.income - balance.expense;

        document.getElementById('gov-tax-val').textContent = Math.round(player.taxRate * 100) + '%';
        document.getElementById('gov-tax-slider').value = player.taxRate;
        const penalty = Math.max(0, player.taxRate - 0.1) * 2;
        document.getElementById('gov-tax-note').textContent = penalty > 0
            ? `Высокий налог: лояльность будет снижаться до ${Math.round((1 - penalty) * 100)}% — а с ней и сбор.`
            : 'Налог до 10% не снижает лояльность.';

        document.getElementById('gov-budget').innerHTML = `
            <div class="budget-row"><span>Налоги</span><span class="pos">+${this.money(balance.tax)}</span></div>
            <div class="budget-row"><span>Индустрия</span><span class="pos">+${this.money(balance.industry)}</span></div>
            <div class="budget-row"><span>Содержание армии</span><span class="neg">−${this.money(balance.upkeep)}</span></div>
            <div class="budget-row total"><span>Итого за ход</span><span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${this.money(net)}</span></div>`;

        const rows = Object.keys(UnitsDB).map(unitId => {
            const unit = UnitsDB[unitId];
            const level = player.tech[unitId] || 1;
            const cost = data.techCost(player.id, unitId);
            return this.researchRow(unitId, `${unit.icon} ${unit.name}`, `ур. ${level}/${RULES.TECH_MAX} · сила +${Math.round((level - 1) * RULES.TECH_STEP * 100)}%`, cost, player.money);
        });
        const march = player.tech.marchSpeed || 1;
        rows.push(this.researchRow('marchSpeed', '🚚 Логистика', `марш на ${march} обл. за ход`, data.techCost(player.id, 'marchSpeed'), player.money));
        document.getElementById('gov-research').innerHTML = rows.join('');
    }

    researchRow(key, label, sub, cost, money) {
        const button = cost === null
            ? '<span class="muted">максимум</span>'
            : `<button class="mini-btn" data-action="research" data-key="${key}" ${money >= cost ? '' : 'disabled'}>${this.money(cost)}</button>`;
        return `<div class="research-row"><div><b>${label}</b><div class="muted">${sub}</div></div>${button}</div>`;
    }
}
