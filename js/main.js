// =====================================================================
// ГЛАВНЫЙ КОНТРОЛЛЕР
// =====================================================================
class GameCore {
    constructor(playerCountryId, cheatMode) {
        this.data = new GameData(playerCountryId, cheatMode);
        this.ui = new UIManager();
        this.map = new MapEngine(this.data, regionId => this.handleMapClick(regionId));
        this.loop = new GameLoop(this.data, this.ui, this.map);

        this.armyAction = { active: false, type: null, fromId: null, forces: {} };

        document.addEventListener('panelClosed', () => {
            this.map.clearSelection();
            this.cancelTargeting();
        });

        document.addEventListener('zoomLevelChanged', e => {
            this.ui.updateZoomMode(e.detail.isRegional);
            this.ui.flashZoomIndicator();
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') { this.cancelTargeting(); this.ui.closePanel(); }
        });

        document.addEventListener('click', e => {
            const cancelBtn = e.target.closest('.cancel-order-btn');
            if (cancelBtn) { e.stopPropagation(); this.cancelOrder(cancelBtn); return; }
            if (e.target.classList.contains('close-btn')) this.map.clearSelection();
        });

        this.initGovPanel();
        this.initArmyPanel();

        document.getElementById('log-btn').addEventListener('click', () => this.ui.showHistory(this.data.history));
    }

    cancelOrder(btn) {
        const index = parseInt(btn.dataset.orderIndex, 10);
        const type = btn.dataset.type;
        if (Number.isNaN(index) || !this.data.orders[type]) return;

        const order = this.data.cancelOrder(type, index);
        if (!order) return;

        if (type === 'recon') {
            this.loop.updateTopBarUI();
            const panel = document.getElementById('army-action-panel');
            if (panel && panel.dataset.regionId === order.target) this.ui.resetSpyButton();
        }
        this.ui.updateOrdersPanel(this.data.orders);
        this.refreshOpenRegionPanel();
    }

    // Возвращает войска отменённого приказа в доступный резерв открытой карточки.
    refreshOpenRegionPanel() {
        const panel = document.getElementById('army-action-panel');
        const regionId = panel && panel.dataset.regionId;
        if (!regionId) return;
        this.updateActionButtons(regionId);
        if (panel.style.display === 'block') this.renderForceInputs(regionId);
    }

    // --- выбор войск -------------------------------------------------
    renderForceInputs(regionId) {
        const available = this.data.getAvailableArmy(regionId);
        const container = document.getElementById('action-army-inputs');
        container.innerHTML = '';

        for (const unitId of Object.keys(UnitsDB)) {
            const count = available[unitId] || 0;
            if (count <= 0) continue;
            const unit = UnitsDB[unitId];
            const row = document.createElement('div');
            row.className = 'army-row force-row';
            row.innerHTML = `
                <div class="force-head">
                    <span>${unit.icon} ${unit.name} <span class="force-avail">(Дост: ${count})</span></span>
                    <div class="force-controls">
                        <button class="top-btn force-max" data-unit="${unitId}">MAX</button>
                        <input type="number" id="action-${unitId}-input" value="0" min="0" max="${count}">
                    </div>
                </div>
                <input type="range" id="action-${unitId}-slider" value="0" min="0" max="${count}">`;
            container.appendChild(row);

            const input = row.querySelector(`#action-${unitId}-input`);
            const slider = row.querySelector(`#action-${unitId}-slider`);
            const clampTo = value => Math.max(0, Math.min(count, parseInt(value, 10) || 0));

            input.addEventListener('input', () => { input.value = clampTo(input.value); slider.value = input.value; });
            slider.addEventListener('input', () => { input.value = slider.value; });
            row.querySelector('.force-max').addEventListener('click', () => { input.value = count; slider.value = count; });
        }
        return container.children.length > 0;
    }

    collectForces() {
        const forces = {};
        let any = false;
        for (const unitId of Object.keys(UnitsDB)) {
            const input = document.getElementById(`action-${unitId}-input`);
            const value = input ? Math.max(0, parseInt(input.value, 10) || 0) : 0;
            forces[unitId] = value;
            if (value > 0) any = true;
        }
        return any ? forces : null;
    }

    initArmyPanel() {
        const panel = document.getElementById('army-action-panel');
        const moveBtn = document.getElementById('init-move-btn');
        const attackBtn = document.getElementById('init-attack-btn');
        const confirmBtn = document.getElementById('confirm-action-btn');
        const cancelBtn = document.getElementById('cancel-action-btn');

        const openPanel = type => {
            const regionId = panel.dataset.regionId;
            if (!regionId) return;
            moveBtn.style.display = 'none';
            attackBtn.style.display = 'none';
            document.getElementById('recruit-btn').style.display = 'none';
            panel.style.display = 'block';
            this.renderForceInputs(regionId);
            this.armyAction.type = type;
            confirmBtn.textContent = type === 'attack' ? 'ВЫБРАТЬ ЦЕЛЬ ДЛЯ АТАКИ' : 'ВЫБРАТЬ ЦЕЛЬ ДЛЯ МАРША';
            confirmBtn.classList.toggle('danger', type === 'attack');
        };

        moveBtn.addEventListener('click', () => openPanel('move'));
        attackBtn.addEventListener('click', () => openPanel('attack'));

        cancelBtn.addEventListener('click', () => {
            panel.style.display = 'none';
            this.updateActionButtons(panel.dataset.regionId);
            this.cancelTargeting();
        });

        confirmBtn.addEventListener('click', () => {
            const forces = this.collectForces();
            if (!forces) { this.ui.toast('Выберите хотя бы одно подразделение'); return; }

            const regionId = panel.dataset.regionId;
            const targets = this.armyAction.type === 'move'
                ? this.data.getValidMoveTargets(regionId)
                : this.data.getValidAttackTargets(regionId);

            if (!targets.length) { this.ui.toast('Нет доступных целей'); return; }

            this.armyAction.active = true;
            this.armyAction.fromId = regionId;
            this.armyAction.forces = forces;
            this.map.enableTargetSelection(targets, this.armyAction.type === 'move' ? 'move-target' : 'attack-target');
            this.ui.closePanelKeepTargeting();
            this.ui.toast(this.armyAction.type === 'move' ? 'Выберите область для марша' : 'Выберите цель атаки');
        });
    }

    cancelTargeting() {
        if (!this.armyAction.active) return;
        this.armyAction.active = false;
        this.map.disableTargetSelection();
        this.ui.hideToast();
    }

    updateActionButtons(regionId) {
        const region = this.data.getRegion(regionId);
        const recruitBtn = document.getElementById('recruit-btn');
        const moveBtn = document.getElementById('init-move-btn');
        const attackBtn = document.getElementById('init-attack-btn');
        const show = (btn, on) => { if (btn) btn.style.display = on ? 'block' : 'none'; };

        if (!region || region.owner !== this.data.playerCountry) {
            show(recruitBtn, false); show(moveBtn, false); show(attackBtn, false);
            return;
        }
        show(recruitBtn, true);

        const available = this.data.getAvailableArmy(regionId);
        const hasTroops = Object.values(available).some(n => n > 0);
        show(moveBtn, hasTroops && this.data.getValidMoveTargets(regionId).length > 0);
        show(attackBtn, hasTroops && this.data.getValidAttackTargets(regionId).length > 0);
    }

    initGovPanel() {
        const player = this.data.getCountry(this.data.playerCountry);
        const taxSlider = document.getElementById('gov-tax-slider');
        const taxValue = document.getElementById('gov-tax-val');
        const projection = document.getElementById('gov-proj-net');
        const container = document.getElementById('gov-army-container');

        container.innerHTML = '';
        for (const unitId of Object.keys(UnitsDB)) {
            const unit = UnitsDB[unitId];
            const row = document.createElement('div');
            row.className = 'army-row';
            row.innerHTML = `
                <span class="gov-unit">${unit.icon} ${unit.name}
                    <small>−$${unit.maintenanceCost / 1000}k/ход · $${unit.buildCost / 1000}k</small></span>
                <div class="army-controls">
                    <button class="army-btn" data-unit="${unitId}" data-delta="-1">−</button>
                    <span id="gov-${unitId}-val">0</span>
                    <button class="army-btn" data-unit="${unitId}" data-delta="1">+</button>
                </div>`;
            container.appendChild(row);
        }

        const update = () => {
            taxValue.textContent = Math.round(player.taxRate * 100) + '%';
            for (const unitId of Object.keys(UnitsDB)) {
                document.getElementById(`gov-${unitId}-val`).textContent = player.army[unitId] || 0;
            }
            const net = this.loop.getProjectedNetIncome(player.id);
            projection.textContent = (net >= 0 ? '+$' : '−$') + this.ui.formatNumber(Math.abs(net));
            projection.style.color = net >= 0 ? '#4ade80' : '#f87171';
        };

        container.addEventListener('click', e => {
            const btn = e.target.closest('.army-btn');
            if (!btn) return;
            const unitId = btn.dataset.unit;
            const unit = UnitsDB[unitId];
            if (btn.dataset.delta === '1') {
                if (player.money < unit.buildCost) { this.ui.toast('Недостаточно средств'); return; }
                player.money -= unit.buildCost;
                player.army[unitId] += 1;
            } else {
                if ((player.army[unitId] || 0) <= 0) return;
                player.army[unitId] -= 1;
                player.money += unit.buildCost;   // роспуск возвращает стоимость постройки
            }
            update();
            this.loop.updateTopBarUI();
        });

        taxSlider.addEventListener('input', e => { player.taxRate = parseFloat(e.target.value); update(); });
        document.getElementById('gov-btn').addEventListener('click', () => { taxSlider.value = player.taxRate; update(); });
        update();
    }

    handleMapClick(regionId) {
        if (this.armyAction.active) {
            const state = this.armyAction;
            const targets = state.type === 'move'
                ? this.data.getValidMoveTargets(state.fromId)
                : this.data.getValidAttackTargets(state.fromId);

            if (targets.includes(regionId)) {
                if (state.type === 'move') this.data.queueMovement(state.fromId, regionId, state.forces);
                else this.data.queueAttack(state.fromId, regionId, state.forces);
                this.ui.updateOrdersPanel(this.data.orders);
            }
            this.cancelTargeting();
            return;
        }

        const region = this.data.getRegion(regionId);
        if (!region) return;
        const country = this.data.getCountry(region.owner);
        if (!country) return;

        if (this.map.isRegionalZoom) {
            this.map.selectRegion(regionId);
            this.ui.showRegionInfo(region, country, this.data, this.data.playerCountry, this);
            const panel = document.getElementById('army-action-panel');
            panel.dataset.regionId = region.id;
            panel.style.display = 'none';
            this.updateActionButtons(region.id);
        } else {
            this.map.selectCountry(country.id);
            this.ui.showCountryInfo(country, this.data.getCountryStats(country.id), this.data);
        }
    }
}

// =====================================================================
// СТАРТОВЫЙ ЭКРАН
// =====================================================================
(function startScreen() {
    let selectedId = null;

    const ready = () => {
        const listEl = document.getElementById('start-country-list');
        const searchEl = document.getElementById('start-search');
        const startBtn = document.getElementById('start-game-btn');

        const playable = Object.keys(CountriesDB)
            .filter(id => CountriesDB[id].playable && CountriesDB[id].regions > 0)
            .sort((a, b) => CountriesDB[a].name.localeCompare(CountriesDB[b].name, 'ru'));

        const render = filter => {
            const query = filter.trim().toLowerCase();
            listEl.innerHTML = '';
            const fragment = document.createDocumentFragment();
            for (const id of playable) {
                const country = CountriesDB[id];
                if (query && !country.name.toLowerCase().includes(query)) continue;
                const item = document.createElement('div');
                item.className = 'country-list-item' + (id === selectedId ? ' selected' : '');
                item.dataset.id = id;
                item.innerHTML = `<span>${country.name}</span><span class="list-regions">${country.regions}</span>`;
                fragment.appendChild(item);
            }
            listEl.appendChild(fragment);
            if (!listEl.children.length) {
                listEl.innerHTML = '<div class="country-list-empty">Ничего не найдено</div>';
            }
        };

        const select = id => {
            selectedId = id;
            for (const el of listEl.children) el.classList.toggle('selected', el.dataset.id === id);

            const country = CountriesDB[id];
            document.getElementById('info-name').textContent = country.name;
            const set = (elId, value) => {
                document.getElementById(elId).querySelector('span').textContent = value;
            };
            set('info-pop', country.population ? formatMillions(country.population) : 'нет данных');
            set('info-area', country.area.toLocaleString('ru-RU') + ' км²');
            set('info-regions', String(country.regions));

            const regions = Object.keys(RegionsDB).filter(r => RegionsDB[r].cc === id);
            set('info-capital', regions.length ? RegionsDB[regions[0]].name : '—');

            document.getElementById('info-visuals').style.visibility = 'visible';
            document.getElementById('info-flag').src = `https://flagcdn.com/w160/${id.toLowerCase()}.png`;
            drawMinimap(id, regions, country.color);
            startBtn.disabled = false;
        };

        listEl.addEventListener('click', e => {
            const item = e.target.closest('.country-list-item');
            if (item) select(item.dataset.id);
        });
        searchEl.addEventListener('input', () => render(searchEl.value));

        startBtn.addEventListener('click', () => {
            if (!selectedId || !CountriesDB[selectedId]) return;
            const cheat = document.getElementById('cheat-toggle').checked;
            document.getElementById('start-screen').style.display = 'none';
            window.game = new GameCore(selectedId, cheat);
        });

        render('');
        select(playable.includes('UA') ? 'UA' : playable[0]);
    };

    function formatMillions(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' млн';
        if (n >= 1e3) return Math.round(n / 1e3) + ' тыс.';
        return String(n);
    }

    function drawMinimap(countryId, regionIds, color) {
        const svg = document.getElementById('info-minimap');
        svg.innerHTML = '';
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of regionIds) {
            const info = RegionsDB[id];
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', info.path);
            path.setAttribute('fill', color);
            path.setAttribute('stroke', 'rgba(255,255,255,0.65)');
            path.setAttribute('stroke-width', '0.3');
            svg.appendChild(path);
            minX = Math.min(minX, info.cx); maxX = Math.max(maxX, info.cx);
            minY = Math.min(minY, info.cy); maxY = Math.max(maxY, info.cy);
        }
        if (minX === Infinity) return;
        const pad = Math.max((maxX - minX) * 0.25, (maxY - minY) * 0.25, 3);
        svg.setAttribute('viewBox',
            `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();
})();
