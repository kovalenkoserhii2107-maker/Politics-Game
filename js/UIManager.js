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
        bind('close-campaign-btn', () => this.hideModal('campaign-modal'));
        bind('close-gov-btn', () => this.hideModal('gov-modal'));
        bind('close-history-btn', () => this.hideModal('history-modal'));
        bind('close-diplo-btn', () => this.hideModal('diplo-modal'));
        bind('close-science-btn', () => this.hideModal('science-modal'));
        bind('close-summary-btn', () => this.closeSummary());

        for (const id of ['history-modal', 'gov-modal', 'diplo-modal', 'campaign-modal']) {
            const modal = document.getElementById(id);
            if (modal) modal.addEventListener('click', e => { if (e.target === modal) this.hideModal(id); });
        }
        const summary = document.getElementById('summary-modal');
        summary.addEventListener('click', e => { if (e.target === summary) this.closeSummary(); });

        document.addEventListener('keydown', e => {
            const modal = document.querySelector('.modal.active');
            if (!modal) return;
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                if (modal.id === 'summary-modal') this.closeSummary();
                else if (!['decision-modal', 'gameover-modal'].includes(modal.id)) this.hideModal(modal.id);
            }
            if (e.key === 'Tab') {
                const targets = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary')].filter(el => el.getClientRects().length);
                const first = targets[0], last = targets[targets.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
        });
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

    syncModalAccess() {
        const active = !!document.querySelector('.modal.active');
        for (const id of ['top-bar', 'map-controls', 'side-panel', 'target-banner']) document.getElementById(id).inert = active;
    }

    showModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        this.modalFocus = document.activeElement;
        el.classList.add('active');
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        this.syncModalAccess();
        el.querySelector('button:not(:disabled), select:not(:disabled), input')?.focus({ preventScroll: true });
    }

    hideModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
        this.syncModalAccess();
        if (!document.querySelector('.modal.active') && this.modalFocus?.isConnected) this.modalFocus.focus({ preventScroll: true });
    }

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
    // Население и производство за ход. У страны — ещё и сколько нужно:
    // сразу видно, чем она торгует, а что докупает.
    fillEconomy(data, target) {
        const set = (id, value, sub, cls = '') => {
            const el = document.getElementById(id);
            el.innerHTML = `${value}${sub ? `<small class="${cls}">${sub}</small>` : ''}`;
        };
        const n = v => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('ru-RU');
        if (target.countryId) {
            const f = Economy.flows(data, target.countryId);
            set('panel-pop', this.formatNumber(f.popM * 1e6));
            for (const [key, id] of [['food', 'panel-food'], ['energy', 'panel-energy'], ['goods', 'panel-goods']]) {
                const net = f[key].prod - f[key].need;
                set(id, n(f[key].prod), `${net >= 0 ? 'излишек +' : 'нехватка −'}${n(Math.abs(net))}`, net >= 0 ? 'pos' : 'neg');
            }
        } else {
            const out = Economy.regionOutput(data, target.region);
            set('panel-pop', this.formatNumber(target.region.population));
            set('panel-food', n(out.food), 'в ход');
            set('panel-energy', n(out.energy), 'в ход');
            set('panel-goods', n(out.goods), 'в ход');
        }
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
            // нули — только у базовых родов войск, новые показываем, когда они есть
            if (!count && (!showZeros || UnitsDB[unitId].requires)) continue;
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

    // Шкала отношений −100…+100 и действующие договоры.
    relationMeter(data, countryId) {
        const player = data.playerCountry;
        const rel = Diplomacy.relation(data, player, countryId);
        const [, label, cls] = Diplomacy.level(rel);
        const pact = Diplomacy.pactLeft(data, player, countryId);
        const treaties = [
            Diplomacy.isAllied(data, player, countryId) ? this.tag('🛡️ Союз', 'peace') : '',
            Diplomacy.hasDeal(data, player, countryId) ? this.tag('🤝 Торговля', 'peace') : '',
            pact ? this.tag(`📜 Пакт ${pact} ход.`, 'truce') : '',
        ].join('');
        return `<div class="relation">
            <div class="relation-head"><span class="label">Отношения</span><b class="${cls}">${rel > 0 ? '+' : ''}${rel} · ${label}</b></div>
            <div class="relation-bar"><span style="left:${(rel + 100) / 2}%"></span></div>
            ${treaties ? `<div class="treaties">${treaties}</div>` : ''}
        </div>`;
    }

    // Все дипломатические действия со страной. Недоступное — с причиной;
    // для предложений заранее видно, согласятся ли.
    diplomacyButtons(data, countryId) {
        const player = data.playerCountry;
        if (countryId === player) return '';
        const target = data.countries[countryId];
        if (!target.playable) return '<div class="hint">Территория без собственного правительства.</div>';
        const me = data.countries[player];
        const meter = this.relationMeter(data, countryId);

        if (data.isAtWar(player, countryId)) {
            const info = data.warInfo(player, countryId);
            const can = me.influence >= RULES.PEACE_COST;
            return `${meter}
                <div class="war-summary">Война идёт ${info.turns} ход. · заняли ${info.taken} · потеряли ${info.lost}</div>
                <button class="action-btn peace" data-action="peace" data-country="${countryId}" ${can ? '' : 'disabled'}>
                    🕊️ Предложить мир <small>−${RULES.PEACE_COST} влияния</small>
                </button>
                ${can ? '' : `<div class="hint">Нужно ${RULES.PEACE_COST} влияния.</div>`}`;
        }

        const row = (action, icon, name, cost, note, ok, cls = '') => `
            <button class="diplo-act ${cls}" data-action="${action}" data-country="${countryId}" ${ok ? '' : 'disabled'}>
                <span class="da-icon">${icon}</span>
                <span class="da-text"><b>${name}</b><small class="${ok ? '' : 'neg'}">${note}</small></span>
                <span class="da-cost">${cost}</span>
            </button>`;
        const infl = n => `${n} 🔷`;
        const offer = (kind, icon, name, cost, benefit) => {
            const answer = Diplomacy.willAccept(data, countryId, player, kind);
            if (me.influence < cost) return row(kind, icon, name, infl(cost), `Нужно ${cost} влияния`, false);
            return row(kind, icon, name, infl(cost), answer.likely ? `${benefit} · согласятся` : answer.reason, answer.likely);
        };
        const cancel = (kind, icon, name) => row(`cancel-${kind}`, icon, name, '', `Отношения ${DIPLOMACY.BREAK_RELATION}`, true, 'ghost');

        const giftCost = Diplomacy.giftCost(data, countryId);
        let html = row('gift', '🎁', 'Подарок', this.money(giftCost), 'Улучшает отношения', me.money >= giftCost);

        if (Diplomacy.hasDeal(data, player, countryId)) html += cancel('deal', '🤝', 'Расторгнуть торговый договор');
        else if (Diplomacy.dealCount(data, player) >= DIPLOMACY.DEAL_MAX) html += row('deal', '🤝', 'Торговый договор', infl(DIPLOMACY.DEAL_COST), `Уже ${DIPLOMACY.DEAL_MAX} договора — это максимум`, false);
        else html += offer('deal', '🤝', 'Торговый договор', DIPLOMACY.DEAL_COST, `+${Math.round(DIPLOMACY.DEAL_BONUS * 100)}% к торговле`);

        if (Diplomacy.pactLeft(data, player, countryId)) html += cancel('pact', '📜', 'Разорвать пакт');
        else html += offer('pact', '📜', 'Пакт о ненападении', DIPLOMACY.PACT_COST, `${DIPLOMACY.PACT_TURNS} ходов без войны`);

        if (Diplomacy.isAllied(data, player, countryId)) html += cancel('alliance', '🛡️', 'Выйти из союза');
        else html += offer('alliance', '🛡️', 'Оборонительный союз', DIPLOMACY.ALLIANCE_COST, 'Защищаете друг друга');

        const tribute = Diplomacy.willAccept(data, countryId, player, 'tribute');
        const tributeNote = me.influence < DIPLOMACY.TRIBUTE_COST ? `Нужно ${DIPLOMACY.TRIBUTE_COST} влияния`
            : tribute.likely ? `Заплатят ${this.money(Diplomacy.tributeAmount(data, countryId))} · отношения ${DIPLOMACY.TRIBUTE_RELATION}` : tribute.reason;
        html += row('tribute', '💰', 'Потребовать дань', infl(DIPLOMACY.TRIBUTE_COST), tributeNote,
            tribute.likely && me.influence >= DIPLOMACY.TRIBUTE_COST && !Diplomacy.isAllied(data, player, countryId));

        const check = data.canDeclareWar(player, countryId);
        return `${meter}<div class="diplo-acts">${html}</div>
            <button class="action-btn war" data-action="war" data-country="${countryId}" ${check.ok ? '' : 'disabled'}>
                ⚔️ Объявить войну <small>−${RULES.WAR_COST} влияния</small>
            </button>
            ${check.ok ? '' : `<div class="hint">${this.escape(check.reason)}</div>`}`;
    }

    // В карточке страны дипломатия — главное, она сразу под заголовком;
    // в карточке области — под гарнизоном.
    placeDiplomacy(top) {
        const block = document.getElementById('diplo-actions');
        const anchor = document.getElementById(top ? 'panel-tags' : 'region-army-container');
        if (anchor.nextElementSibling !== block) anchor.after(block);
        block.classList.toggle('top', top);
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
        this.fillEconomy(data, { countryId: country.id });

        const container = document.getElementById('region-army-container');
        const seeArmy = isPlayer || data.isAtWar(data.playerCountry, country.id);
        container.innerHTML = this.powerBlock('Военная мощь', data.calculateMilitaryPower(country.id))
            + (seeArmy ? this.armyList(stats.army, 'Вооружённые силы', false)
                : '<div class="hint">Точный состав армии известен только своих войск и противников.</div>');

        this.placeDiplomacy(true);
        document.getElementById('diplo-actions').innerHTML = this.diplomacyButtons(data, country.id);
        document.getElementById('development-panel').innerHTML = '';
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
        this.fillEconomy(data, { region });
        this.renderDevelopment(region, data);

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
        this.placeDiplomacy(false);
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
        document.dispatchEvent(new CustomEvent('ordersChanged'));
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
        this.hideModal('campaign-modal');
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
        this.hideModal('campaign-modal');
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
        const victory = data.outcome === 'victory';
        document.getElementById('gameover-title').textContent = victory ? 'Мировое господство' : 'Кампания завершена';
        document.getElementById('gameover-text').textContent = victory
            ? `${data.countries[data.playerCountry].name}: все ${data.campaignProgress().total} областей суверенных стран под вашим управлением. Победа на ${data.turn}-м ходу${data.cheatMode ? ' в режиме бога' : ''}.`
            : `${data.countries[data.playerCountry].name} потеряла все области на ${data.turn}-м ходу. Попробуйте другой экономический курс или другую страну.`;
        this.showModal('gameover-modal');
    }

    renderDevelopment(region, data) {
        const container = document.getElementById('development-panel');
        if (region.owner !== data.playerCountry) {
            container.innerHTML = !data.countries[region.owner].playable && data.isNeighborToPlayer(region.id)
                ? `<summary>Интеграция территории</summary><div class="development-card"><strong>Интеграция территории</strong><p>Территория без суверенного правительства. Установите управление за $500K и 10 влияния. Лояльность начнётся с 50%.</p><button class="mini-btn" data-action="integrate" data-region="${region.id}">Установить управление</button></div>` : '';
            return;
        }
        const project = data.projects.find(p => p.regionId === region.id);
        container.open = false;
        let html = `<summary>Развитие области${project ? ` · ${project.remaining} ход.` : ' · 3 проекта'}</summary>`;
        if (project) {
            html += `<div class="development-card"><strong>${DEVELOPMENT[project.kind].name}</strong><p>До завершения: ${project.remaining} ход. Средства зарезервированы.</p><button class="mini-btn" data-action="cancel-project" data-region="${region.id}">Отменить · вернуть ${this.money(project.cost)}</button></div>`;
        } else {
            for (const [kind, plan] of Object.entries(DEVELOPMENT)) {
                const level = region.development[kind], cost = data.developmentCost(region.id, kind);
                const value = Economy.projectValue(data, region.id, kind);
                const res = RESOURCES[plan.yields];
                const payback = value > 0 ? Math.ceil(cost / value) : null;
                const disabled = level >= 5 || data.countries[data.playerCountry].money < cost || data.gameOver;
                html += `<div class="development-card"><strong>${plan.name} · ${level}/5</strong><p>${plan.turns} ход. стройки · больше ресурса «${res.icon} ${res.name}» · по нынешним ценам около +${this.money(value)}/ход${payback ? `, окупится за ~${payback} ход.` : ''}${kind === 'industry' ? ' Заводам нужна энергия. Также растёт мощность набора войск.' : ''}</p><button class="mini-btn" data-action="invest" data-region="${region.id}" data-kind="${kind}" ${disabled ? 'disabled' : ''}>${level >= 5 ? 'Максимальный уровень' : `Построить · ${this.money(cost)}`}</button></div>`;
            }
        }
        container.innerHTML = html;
    }

    // Задания: три цели с наградой. Выполнил — забрал деньги и влияние,
    // на место приходит новое. Сверху — путь к победе.
    showCampaign(data) {
        this.closePanel();
        Missions.refill(data);
        const p = data.campaignProgress();
        const me = data.countries[data.playerCountry];
        const cats = { army: 'Армия', economy: 'Экономика', science: 'Наука', people: 'Население', diplomacy: 'Дипломатия' };
        const shown = (m, value, target) => {
            if (m.value === 'money') return `${this.money(value)} / ${this.money(target)}`;
            if (m.value === 'population') return `${this.formatNumber(value)} / ${this.formatNumber(target)}`;
            if (m.value === 'surplus') return value ? 'хватает' : 'докупаете';
            if (m.value === 'relation') return `${value > 0 ? '+' : ''}${value} / +${target}`;
            return `${Math.max(0, value)} / ${target}`;
        };
        const cards = data.missions.map((m, i) => {
            const kind = MISSION_KINDS[m.kind];
            const pr = Missions.progress(data, m);
            const reward = `+${this.money(m.reward.money)} · +${m.reward.influence} 🔷`;
            const buttons = pr.done
                ? `<button class="mini-btn peace claim" data-action="mission-claim" data-index="${i}">Забрать награду</button>`
                : `<button class="mini-btn" data-action="mission-go" data-index="${i}">Перейти</button>
                   <button class="mini-btn ghost" data-action="mission-skip" data-index="${i}" ${me.influence >= MISSION_RULES.SKIP_COST ? '' : 'disabled'}>Сменить · ${MISSION_RULES.SKIP_COST} 🔷</button>`;
            return `<div class="mission ${pr.done ? 'done' : ''}">
                <div class="mission-head"><span class="mission-icon">${kind.icon}</span>
                    <div><span class="label">${cats[kind.cat]}</span><b>${this.escape(m.text)}</b></div></div>
                <div class="mission-bar"><span style="width:${Math.round(pr.share * 100)}%"></span></div>
                <div class="mission-meta"><span>${pr.done ? '✓ Выполнено' : shown(m, pr.value, pr.target)}</span><span class="mission-reward">${reward}</span></div>
                <div class="mission-actions">${buttons}</div>
            </div>`;
        }).join('');
        document.getElementById('campaign-content').innerHTML = `
            <p class="hint">Выполняйте задания — за каждое платят деньгами и влиянием. Влияние нужно для договоров, войны и мира. Забранное задание сразу сменяется новым.</p>
            <div class="missions">${cards || '<div class="muted">Новых заданий пока нет.</div>'}</div>
            <p class="hint">Выполнено заданий: ${data.stats.missions || 0}. Неподходящее задание можно сменить; ставшее невыполнимым (например, война закончилась) сменится само в конце хода.</p>
            <div class="campaign-hero"><h3>${p.rank}</h3><strong>${p.controlled} / ${p.total}</strong><p>областей суверенных стран под вашим управлением · ${(p.share * 100).toFixed(1)}%</p><progress value="${p.controlled}" max="${p.total}" aria-label="Мировое господство"></progress><p>Победа — контроль всех этих областей.</p></div>`;
        this.showModal('campaign-modal');
    }

    // --- дипломатия ----------------------------------------------------------------------------
    // Сводка: войны, союзники и договоры, соседи и крупные державы. Строка
    // страны открывает её карточку — там все действия.
    showDiplomacy(data) {
        const player = data.playerCountry;
        const me = data.countries[player];
        const name = cc => this.escape(data.countries[cc].name);
        const myPower = Math.max(1, data.calculateMilitaryPower(player));
        const rel = cc => {
            const v = Diplomacy.relation(data, player, cc);
            const [, label, cls] = Diplomacy.level(v);
            return `<span class="rel-chip ${cls}">${v > 0 ? '+' : ''}${v} · ${label}</span>`;
        };
        const marks = cc => [
            Diplomacy.isAllied(data, player, cc) ? '🛡️ союз' : '',
            Diplomacy.hasDeal(data, player, cc) ? '🤝 торговля' : '',
            Diplomacy.pactLeft(data, player, cc) ? `📜 пакт ${Diplomacy.pactLeft(data, player, cc)} ход.` : '',
            data.truceLeft(player, cc) ? `🕊️ перемирие ${data.truceLeft(player, cc)} ход.` : '',
        ].filter(Boolean).join(' · ');
        const strength = cc => {
            const ratio = data.calculateMilitaryPower(cc) / myPower;
            const verdict = ratio > 1.5 ? ['сильнее вас', 'neg'] : ratio < 0.67 ? ['слабее вас', 'pos'] : ['на равных', ''];
            return `армия <span class="${verdict[1]}">${verdict[0]}</span> (×${ratio.toFixed(1)})`;
        };
        const countryRow = (cc, sub) => `<button class="diplo-row country-row" data-action="open-country" data-country="${cc}">
                <span class="swatch" style="background:${data.countries[cc].color}"></span>
                <span class="cr-text"><b>${name(cc)}</b><small>${sub}</small></span>${rel(cc)}</button>`;

        let html = `<div class="diplo-influence">Влияние: <b>${me.influence}</b> / ${RULES.INFLUENCE_MAX}
            <span class="muted">· +${RULES.INFLUENCE_PER_TURN} за ход и награды за задания</span></div>
            <p class="hint">Отношения улучшают подарки и договоры. Торговый договор: +${Math.round(DIPLOMACY.DEAL_BONUS * 100)}% к выручке и −${Math.round(DIPLOMACY.DEAL_BONUS * 100)}% к закупкам на рынке (до ${DIPLOMACY.DEAL_MAX}). Союзник вступит в войну, если на вас нападут. Нажмите страну, чтобы договориться.</p>`;

        const enemies = data.enemiesOf(player);
        html += '<h3 class="section-title">Ваши войны</h3>';
        html += enemies.length ? enemies.map(cc => {
            const info = data.warInfo(player, cc);
            return `<div class="diplo-row">
                <div><b>${name(cc)}</b><div class="muted">${info.turns} ход. · заняли ${info.taken} · потеряли ${info.lost}</div></div>
                <button class="mini-btn peace" data-action="peace" data-country="${cc}" ${me.influence >= RULES.PEACE_COST ? '' : 'disabled'}>Мир · ${RULES.PEACE_COST} 🔷</button>
            </div>`;
        }).join('') : '<div class="muted">Вы ни с кем не воюете.</div>';

        const alive = cc => data.countries[cc] && data.countries[cc].alive && data.countries[cc].playable;
        const partners = [...new Set([
            ...Diplomacy.partners(data, player, data.alliances), ...Diplomacy.partners(data, player, data.deals),
            ...Diplomacy.partners(data, player, data.pacts).filter(cc => Diplomacy.pactLeft(data, player, cc)),
            ...[...data.truces.keys()].map(k => k.split('|')).filter(p => p.includes(player)).map(p => (p[0] === player ? p[1] : p[0])).filter(cc => data.truceLeft(player, cc)),
        ])].filter(alive);
        html += `<h3 class="section-title">Союзники и договоры · торговых ${Diplomacy.dealCount(data, player)}/${DIPLOMACY.DEAL_MAX}</h3>`;
        html += partners.length ? partners.map(cc => countryRow(cc, marks(cc))).join('')
            : '<div class="muted">Договоров пока нет. Начните с торгового — он выгоден обеим сторонам.</div>';

        const neighbours = data.neighbourCountries(player).filter(cc => alive(cc) && !data.isAtWar(player, cc) && !partners.includes(cc))
            .sort((a, b) => Diplomacy.relation(data, player, b) - Diplomacy.relation(data, player, a));
        html += '<h3 class="section-title">Соседи</h3>';
        html += neighbours.length ? neighbours.map(cc => countryRow(cc, strength(cc))).join('') : '<div class="muted">Остальных сухопутных соседей нет.</div>';

        const shown = new Set([player, ...enemies, ...partners, ...neighbours]);
        const powers = Object.keys(data.countries).filter(cc => alive(cc) && !shown.has(cc))
            .sort((a, b) => data.calculateMilitaryPower(b) - data.calculateMilitaryPower(a)).slice(0, 6);
        if (powers.length) html += '<h3 class="section-title">Крупные державы</h3>' + powers.map(cc => countryRow(cc, strength(cc))).join('');

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

        const select = document.getElementById('gov-policy');
        select.innerHTML = Object.entries(POLICIES).map(([key, policy]) => `<option value="${key}">${policy.name}</option>`).join('');
        select.value = player.policy;
        const cooldown = Math.max(0, 3 - (data.turn - player.policyChangedAt));
        select.disabled = cooldown > 0 || player.influence < 5 || data.gameOver;
        document.getElementById('gov-policy-note').textContent = `${POLICIES[player.policy].description} Смена: 5 влияния.${cooldown ? ` Доступна через ${cooldown} ход.` : ''}`;
        document.getElementById('gov-tax-val').textContent = Math.round(player.taxRate * 100) + '%';
        document.getElementById('gov-tax-slider').value = player.taxRate;
        const penalty = Math.max(0, player.taxRate - 0.1) * 2;
        document.getElementById('gov-tax-note').textContent = penalty > 0
            ? `Высокий налог: лояльность будет снижаться до ${Math.round(Math.min(1, 1 + POLICIES[player.policy].loyalty - penalty) * 100)}% — а с ней и сбор.`
            : 'Налог до 10% не снижает лояльность.';

        this.renderEconomy(data);
        document.getElementById('gov-budget').innerHTML = `
            <div class="budget-row"><span>Налоги</span><span class="pos">+${this.money(balance.tax)}</span></div>
            <div class="budget-row"><span>Продажа ресурсов</span><span class="pos">+${this.money(balance.sales)}</span></div>
            <div class="budget-row"><span>Закупка ресурсов</span><span class="neg">−${this.money(balance.purchases)}</span></div>
            <div class="budget-row"><span>Социальная программа</span><span class="neg">−${this.money(balance.social)}</span></div>
            <div class="budget-row"><span>Содержание армии</span><span class="neg">−${this.money(balance.upkeep)}</span></div>
            <div class="budget-row total"><span>Итого за ход</span><span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${this.money(net)}</span></div>`;

    }

    // Ресурсы страны: сколько производим и тратим, запас на складе, цена
    // на мировом рынке и что делать с излишком.
    renderEconomy(data) {
        const player = data.countries[data.playerCountry];
        Economy.initCountry(player);
        const f = Economy.flows(data, player.id);
        const n = v => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('ru-RU');
        const html = Object.entries(RESOURCES).map(([key, res]) => {
            const { prod, need } = f[key];
            const net = prod - need;
            const price = data.market[key];
            const change = Math.round((price / res.price - 1) * 100);
            const stock = player.stock[key];
            const weeks = need > 0 ? stock / need : 0;
            const fill = Math.min(100, Math.round((weeks / ECONOMY.STOCK_CAP) * 100));
            const sat = player.economy ? player.economy.sat[key] : 1;
            const selling = player.trade[key] === 'sell';
            let note;
            if (sat < 0.95) note = `<span class="neg">В прошлый ход не хватило ${Math.round((1 - sat) * 100)}%.</span> `;
            else note = '';
            if (net >= 0) note += selling
                ? `Излишек ${n(net)} продаётся: около <span class="pos">+${this.money(net * price)}</span> в ход.`
                : `Излишек ${n(net)} копится на складе (до ${ECONOMY.STOCK_CAP} недель запаса).`;
            else note += `Нехватка ${n(-net)} докупается: около <span class="neg">−${this.money(-net * price)}</span> в ход.`;
            return `<div class="res-card ${sat < 0.95 ? 'short' : net < 0 ? 'import' : 'ok'}">
                <div class="res-head"><b>${res.icon} ${res.name}</b>
                    <span class="res-price">${this.money(price)} <small class="${change > 0 ? 'neg' : change < 0 ? 'pos' : 'muted'}">${change > 0 ? '+' : ''}${change}%</small></span></div>
                <div class="res-flow"><span>Производство <b>${n(prod)}</b></span><span>Потребление <b>${n(need)}</b></span>
                    <b class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${n(Math.abs(net))}</b></div>
                <div class="res-stock"><div class="res-bar"><i style="width:${fill}%"></i></div><small>Склад ${n(stock)} · ${weeks.toFixed(1)} нед.</small></div>
                <p class="hint">${note}</p>
                <label class="switch switch-sm" ${net < 0 ? 'hidden' : ''}><input type="checkbox" data-action="trade" data-key="${key}" ${selling ? 'checked' : ''}>
                    <span class="switch-track" aria-hidden="true"></span><span>Продавать излишки</span></label>
            </div>`;
        }).join('');
        document.getElementById('gov-economy').innerHTML = html
            + `<p class="hint">Цены мирового рынка растут, когда товара не хватает, и падают при избытке. Воюющая страна под блокадой торгует только на ${Math.round(ECONOMY.WAR_TRADE * 100)}%.</p>`;
    }

    // Три значка в верхней панели: зелёный — хватает, жёлтый — докупаем,
    // красный — не хватило в прошлый ход.
    updateResourceStatus(data) {
        const player = data.countries[data.playerCountry];
        if (!player || !data.regionsByCountry[player.id]?.length) return;
        const f = Economy.flows(data, player.id);
        for (const el of document.querySelectorAll('#res-status [data-k]')) {
            const key = el.dataset.k;
            const sat = player.economy ? player.economy.sat[key] : 1;
            const state = sat < 0.95 ? 'short' : f[key].prod < f[key].need ? 'import' : 'ok';
            el.className = state;
            el.title = `${RESOURCES[key].name}: ${state === 'short' ? 'не хватает' : state === 'import' ? 'докупаем на рынке' : 'хватает'}`;
        }
    }

    // --- наука ----------------------------------------------------------------------------------
    // Дерево по веткам: изучено / идёт / можно начать / закрыто. Ниже —
    // модернизация открытых родов войск.
    showScience(data) {
        this.closePanel();
        const player = data.countries[data.playerCountry];
        Tech.init(player);
        const money = player.money;
        const active = player.research;
        let html = '';

        if (active) {
            const tech = TECH_TREE[active.id];
            const refund = active.started === data.turn ? tech.cost : Math.round(tech.cost / 2);
            const done = Math.round((1 - active.remaining / tech.turns) * 100);
            html += `<div class="sci-active"><div><span class="label">Идёт исследование</span>
                <b>${tech.icon} ${tech.name}</b><small>Осталось ходов: ${active.remaining}</small>
                <div class="res-bar"><i style="width:${done}%"></i></div></div>
                <button class="mini-btn" data-action="tech-cancel">Отменить · вернуть ${this.money(refund)}</button></div>`;
        } else {
            html += `<p class="hint sci-idle">Лаборатории свободны. Выберите исследование: деньги списываются сразу, результат — через несколько ходов. Одновременно идёт одно.</p>`;
        }

        for (const [branchId, branch] of Object.entries(TECH_BRANCHES)) {
            html += `<h3 class="section-title">${branch.icon} ${branch.name}</h3><div class="sci-branch">`;
            for (const [id, tech] of Object.entries(TECH_TREE)) {
                if (tech.branch !== branchId) continue;
                const done = Tech.has(player, id);
                const running = active && active.id === id;
                const missing = tech.requires.filter(r => !Tech.has(player, r));
                const unit = tech.unlocks ? UnitsDB[tech.unlocks] : null;
                const state = done ? 'done' : running ? 'running' : missing.length ? 'locked' : 'open';
                let action;
                if (done) action = '<span class="sci-state pos">✓ Изучено</span>';
                else if (running) action = `<span class="sci-state">Идёт · ${active.remaining} ход.</span>`;
                else if (missing.length) action = `<span class="sci-state muted">🔒 Нужно: ${missing.map(r => TECH_TREE[r].name).join(', ')}</span>`;
                else action = `<button class="mini-btn" data-action="tech" data-key="${id}" ${active || money < tech.cost ? 'disabled' : ''}>${this.money(tech.cost)} · ${tech.turns} ход.</button>`;
                html += `<div class="sci-card ${state}"><div class="sci-head"><b>${tech.icon} ${tech.name}</b>${action}</div>
                    <p>${tech.text}</p>
                    ${unit ? `<div class="sci-unit">Новый род войск: ${unit.icon} ${unit.name} · атака ${unit.baseAttack} · оборона ${unit.baseDefense} · ${this.money(unit.buildCost)}</div>` : ''}
                </div>`;
            }
            html += '</div>';
        }

        html += `<h3 class="section-title">⚙️ Модернизация войск</h3>
            <p class="hint">Каждая ступень — +${Math.round(MODERNIZATION.STEP * 100)}% к силе рода войск, до ${MODERNIZATION.MAX}-й. Сразу, но каждая следующая дороже.</p>`;
        html += Object.keys(UnitsDB).filter(id => Tech.unitUnlocked(player, id)).map(unitId => {
            const unit = UnitsDB[unitId];
            const level = player.tech[unitId] || 1;
            return this.researchRow(unitId, `${unit.icon} ${unit.name}`,
                `ступень ${level}/${MODERNIZATION.MAX} · сила +${Math.round((level - 1) * MODERNIZATION.STEP * 100)}%`, data.techCost(player.id, unitId), money);
        }).join('');
        document.getElementById('science-content').innerHTML = html;
        this.showModal('science-modal');
    }

    // Точка на кнопке «Наука»: лаборатории простаивают, а деньги есть.
    updateScienceBadge(data) {
        const player = data.countries[data.playerCountry];
        const badge = document.getElementById('sci-badge');
        if (!player || !badge) return;
        Tech.init(player);
        const idle = !player.research && Object.entries(TECH_TREE).some(([id, t]) =>
            !Tech.has(player, id) && t.requires.every(r => Tech.has(player, r)) && player.money >= t.cost);
        badge.classList.toggle('visible', idle);
    }

    researchRow(key, label, sub, cost, money) {
        const button = cost === null
            ? '<span class="muted">максимум</span>'
            : `<button class="mini-btn" data-action="research" data-key="${key}" ${money >= cost ? '' : 'disabled'}>${this.money(cost)}</button>`;
        return `<div class="research-row"><div><b>${label}</b><div class="muted">${sub}</div></div>${button}</div>`;
    }
}
