// =====================================================================
// ГЛАВНЫЙ КОНТРОЛЛЕР
// =====================================================================
class GameCore {
    constructor(data) {
        this.data = data;
        this.ui = new UIManager();
        this.map = new MapEngine(this.data, regionId => this.handleMapClick(regionId));
        this.ai = new AI(this.data);
        this.loop = new GameLoop(this.data, this.ui, this.map, this.ai);

        this.armyAction = { active: false, type: null, fromId: null, forces: {} };
        this.panelRegion = null;

        document.addEventListener('panelClosed', () => {
            this.map.clearSelection();
            this.cancelTargeting();
            this.panelRegion = null;
        });
        document.addEventListener('zoomLevelChanged', e => {
            this.ui.updateZoomMode(e.detail.isRegional);
            this.ui.flashZoomIndicator();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') { this.cancelTargeting(); this.ui.closePanel(); }
        });

        // Один слушатель на все кнопки действий в панелях и окнах.
        document.addEventListener('click', e => {
            const cancelBtn = e.target.closest('.cancel-order-btn');
            if (cancelBtn) { e.stopPropagation(); this.cancelOrder(cancelBtn); return; }
            const action = e.target.closest('[data-action]');
            if (action && !action.disabled) this.runAction(action);
        });

        this.initArmyPanel();
        this.initRecruitPanel();
        this.initGovernment();
        this.initTopButtons();
        this.initMapControls();

        // На телефоне вкладку могут выгрузить в любой момент — сохраняемся при сворачивании.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') SaveGame.save(this.data);
        });
        window.addEventListener('pagehide', () => SaveGame.save(this.data));

        this.ui.updateOrdersPanel(this.data);
        SaveGame.save(this.data);
    }

    // --- действия из карточек и окон ---------------------------------------
    runAction(btn) {
        const d = this.data;
        const player = d.playerCountry;
        const cc = btn.dataset.country;

        if (btn.dataset.action === 'war') {
            const result = d.declareWar(player, cc);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.haptic(40);
            this.ui.toast(`Вы объявили войну: ${d.countries[cc].name}`);
            this.afterStateChange();
        } else if (btn.dataset.action === 'peace') {
            if (d.countries[player].influence < RULES.PEACE_COST) { this.ui.toast(`Нужно ${RULES.PEACE_COST} влияния`); return; }
            d.countries[player].influence -= RULES.PEACE_COST;
            if (this.ai.acceptsPeace(cc, player)) {
                d.makePeace(player, cc);
                this.ui.toast(`${d.countries[cc].name} согласилась на мир`);
            } else {
                this.ui.toast(`${d.countries[cc].name} отвергла мир: она считает, что побеждает`);
            }
            this.afterStateChange();
        } else if (btn.dataset.action === 'spy') {
            const region = d.getRegion(btn.dataset.region);
            if (!d.queueRecon(region.id, RULES.SPY_COST, parseInt(btn.dataset.chance, 10), region.name)) {
                this.ui.toast(`Недостаточно средств для разведки (${this.ui.money(RULES.SPY_COST)})`);
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Разведка в плане';
            this.ui.updateOrdersPanel(d);
            this.loop.updateTopBarUI();
        } else if (btn.dataset.action === 'research') {
            const result = d.research(player, btn.dataset.key);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.haptic(20);
            this.ui.toast('Исследование завершено');
            this.ui.renderGovernment(d);
            this.loop.updateTopBarUI();
            this.map.drawArmyMarkers();
        }
    }

    // После войны или мира обновляем всё, что от этого зависит.
    afterStateChange() {
        this.map.refreshColors();
        this.loop.updateTopBarUI();
        if (document.getElementById('diplo-modal').classList.contains('active')) this.ui.showDiplomacy(this.data);
        if (this.panelRegion) this.showRegion(this.panelRegion);
        else if (this.panelCountry) this.showCountry(this.panelCountry);
        SaveGame.save(this.data);
    }

    cancelOrder(btn) {
        const index = parseInt(btn.dataset.orderIndex, 10);
        const order = this.data.cancelOrder(btn.dataset.type, index);
        if (!order) return;
        this.ui.updateOrdersPanel(this.data);
        this.loop.updateTopBarUI();
        if (this.panelRegion) this.showRegion(this.panelRegion);
    }

    // --- карточки ------------------------------------------------------------
    showRegion(regionId) {
        const region = this.data.getRegion(regionId);
        if (!region) return;
        this.panelRegion = regionId;
        this.panelCountry = null;
        this.map.selectRegion(regionId);
        this.ui.showRegionInfo(region, this.data.getCountry(region.owner), this.data);
        this.updateActionButtons(regionId);
        this.map.ensureVisible(region.cx, region.cy);
    }

    showCountry(countryId) {
        this.panelRegion = null;
        this.panelCountry = countryId;
        this.map.selectCountry(countryId);
        this.ui.showCountryInfo(this.data.getCountry(countryId), this.data.getCountryStats(countryId), this.data);
    }

    updateActionButtons(regionId) {
        const d = this.data;
        const region = d.getRegion(regionId);
        const show = (id, on) => { document.getElementById(id).style.display = on ? 'block' : 'none'; };
        const hint = document.getElementById('action-hint');
        hint.textContent = '';
        if (!region || region.owner !== d.playerCountry) {
            ['recruit-btn', 'init-move-btn', 'init-attack-btn', 'init-disband-btn'].forEach(id => show(id, false));
            return;
        }
        const capacity = d.recruitCapacityLeft(regionId);
        show('recruit-btn', true);
        document.getElementById('recruit-btn').innerHTML =
            `🏭 Набрать войска <small>мощность ${capacity}/${d.recruitCapacity(regionId)}</small>`;

        const available = d.getAvailableArmy(regionId);
        const hasTroops = Object.values(available).some(n => n > 0);
        const attackTargets = d.getValidAttackTargets(regionId);
        show('init-move-btn', hasTroops && d.getValidMoveTargets(regionId).length > 0);
        show('init-attack-btn', hasTroops && attackTargets.length > 0);
        show('init-disband-btn', hasTroops);

        if (hasTroops && !attackTargets.length) {
            const peaceful = d.peacefulNeighbours(regionId);
            if (peaceful.length) {
                hint.textContent = `Граница с: ${peaceful.map(cc => d.countries[cc].name).join(', ')}. `
                    + 'Чтобы наступать, объявите войну в карточке их области.';
            }
        }
    }

    // --- выбор войск для марша и атаки ------------------------------------------
    renderForceInputs(regionId) {
        const available = this.data.getAvailableArmy(regionId);
        const rows = [];
        for (const unitId of Object.keys(UnitsDB)) {
            const count = available[unitId] || 0;
            if (count <= 0) continue;
            const unit = UnitsDB[unitId];
            rows.push(this.ui.stepperRow({ key: unitId, icon: unit.icon, label: unit.name, sub: `есть ${count}`, max: count, value: count }));
        }
        const container = document.getElementById('action-army-inputs');
        container.innerHTML = rows.join('');
        this.ui.bindSteppers(container);
    }

    initArmyPanel() {
        const panel = document.getElementById('army-action-panel');
        const confirmBtn = document.getElementById('confirm-action-btn');

        const openPanel = type => {
            if (!this.panelRegion) return;
            document.getElementById('action-buttons-container').style.display = 'none';
            document.getElementById('recruit-panel').style.display = 'none';
            panel.style.display = 'block';
            this.renderForceInputs(this.panelRegion);
            this.armyAction.type = type;
            const titles = { attack: 'Силы для наступления', move: 'Силы для марша', disband: 'Какие войска распустить' };
            const buttons = { attack: 'Выбрать цель атаки', move: 'Выбрать область для марша', disband: 'Распустить' };
            document.getElementById('action-panel-title').textContent = titles[type];
            confirmBtn.textContent = buttons[type];
            confirmBtn.classList.toggle('danger', type !== 'move');
            // для роспуска по умолчанию ничего не выбрано — чтобы не распустить всё случайно
            if (type === 'disband') {
                for (const row of document.querySelectorAll('#action-army-inputs .stepper-row')) this.ui.setStepper(row, 0);
            }
            panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        };
        document.getElementById('init-move-btn').addEventListener('click', () => openPanel('move'));
        document.getElementById('init-attack-btn').addEventListener('click', () => openPanel('attack'));
        document.getElementById('init-disband-btn').addEventListener('click', () => openPanel('disband'));

        document.getElementById('cancel-action-btn').addEventListener('click', () => {
            panel.style.display = 'none';
            document.getElementById('action-buttons-container').style.display = 'block';
            this.cancelTargeting();
        });

        confirmBtn.addEventListener('click', () => {
            const forces = this.ui.readSteppers(document.getElementById('action-army-inputs'));
            for (const unitId of Object.keys(UnitsDB)) forces[unitId] = forces[unitId] || 0;
            if (!Object.values(forces).some(n => n > 0)) { this.ui.toast('Выберите хотя бы одно подразделение'); return; }

            const regionId = this.panelRegion;
            if (this.armyAction.type === 'disband') {
                let saved = 0;
                for (const unitId of Object.keys(forces)) saved += (forces[unitId] || 0) * UnitsDB[unitId].maintenanceCost;
                const removed = this.data.disband(regionId, forces);
                this.ui.toast(`Распущено подразделений: ${removed}. Экономия ${this.ui.money(saved)} за ход`);
                this.map.drawArmyMarkers();
                this.loop.updateTopBarUI();
                this.showRegion(regionId);
                SaveGame.save(this.data);
                return;
            }
            const isMove = this.armyAction.type === 'move';
            const targets = isMove ? this.data.getValidMoveTargets(regionId) : this.data.getValidAttackTargets(regionId);
            if (!targets.length) { this.ui.toast('Нет доступных целей'); return; }

            this.armyAction = { active: true, type: this.armyAction.type, fromId: regionId, forces };
            this.map.enableTargetSelection(targets, isMove ? 'move-target' : 'attack-target');
            this.ui.closePanelKeepTargeting();
            this.ui.showTargetBanner(isMove ? 'Коснитесь области для марша' : 'Коснитесь цели атаки');
        });

        document.getElementById('target-cancel').addEventListener('click', () => this.cancelTargeting());
    }

    cancelTargeting() {
        if (!this.armyAction.active) return;
        this.armyAction.active = false;
        this.map.disableTargetSelection();
        this.ui.hideTargetBanner();
    }

    // --- набор войск ---------------------------------------------------------------
    initRecruitPanel() {
        const panel = document.getElementById('recruit-panel');
        const list = document.getElementById('recruit-list');

        document.getElementById('recruit-btn').addEventListener('click', () => {
            if (!this.panelRegion) return;
            document.getElementById('action-buttons-container').style.display = 'none';
            panel.style.display = 'block';
            this.renderRecruit();
            panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });

        this.ui.bindSteppers(list, () => this.updateRecruitLimits());

        document.getElementById('cancel-recruit-btn').addEventListener('click', () => {
            panel.style.display = 'none';
            document.getElementById('action-buttons-container').style.display = 'block';
        });

        document.getElementById('confirm-recruit-btn').addEventListener('click', () => {
            const amounts = this.ui.readSteppers(list);
            let ordered = 0;
            for (const unitId of Object.keys(amounts)) {
                if (!amounts[unitId]) continue;
                const result = this.data.queueRecruitment(this.panelRegion, unitId, amounts[unitId]);
                if (!result.ok) { this.ui.toast(result.reason); break; }
                ordered += amounts[unitId];
            }
            if (!ordered) { this.ui.toast('Ничего не выбрано'); return; }
            this.ui.haptic(20);
            this.ui.toast(`Заказано подразделений: ${ordered}. Прибудут в конце хода.`);
            this.ui.updateOrdersPanel(this.data);
            this.loop.updateTopBarUI();
            this.showRegion(this.panelRegion);
        });
    }

    renderRecruit() {
        const d = this.data;
        const list = document.getElementById('recruit-list');
        list.innerHTML = Object.keys(UnitsDB).map(unitId => {
            const unit = UnitsDB[unitId];
            return this.ui.stepperRow({
                key: unitId, icon: unit.icon, label: unit.name,
                sub: `${this.ui.money(unit.buildCost)} · ${unit.industryCost} инд. · −${this.ui.money(unit.maintenanceCost)}/ход`,
                max: 0,
            });
        }).join('');
        this.updateRecruitLimits();
    }

    // Мощность области и деньги общие на все рода войск: при изменении одной
    // строки пересчитываем пределы остальных.
    updateRecruitLimits() {
        const d = this.data;
        const list = document.getElementById('recruit-list');
        const amounts = this.ui.readSteppers(list);
        const capacity = d.recruitCapacityLeft(this.panelRegion);
        const money = d.countries[d.playerCountry].money;

        let usedCap = 0, cost = 0, upkeep = 0;
        for (const unitId of Object.keys(amounts)) {
            usedCap += UnitsDB[unitId].industryCost * amounts[unitId];
            cost += UnitsDB[unitId].buildCost * amounts[unitId];
            upkeep += UnitsDB[unitId].maintenanceCost * amounts[unitId];
        }
        for (const row of list.querySelectorAll('.stepper-row')) {
            const unit = UnitsDB[row.dataset.key];
            const own = amounts[row.dataset.key];
            const capLeft = capacity - usedCap + unit.industryCost * own;
            const moneyLeft = money - cost + unit.buildCost * own;
            const max = Math.max(0, Math.min(Math.floor(capLeft / unit.industryCost), Math.floor(moneyLeft / unit.buildCost)));
            row.dataset.max = max;
            if (own > max) this.ui.setStepper(row, max);
            row.classList.toggle('unavailable', max === 0 && own === 0);
        }
        document.getElementById('recruit-capacity').textContent =
            `Мощность индустрии: ${capacity - usedCap} из ${d.recruitCapacity(this.panelRegion)} · казна ${this.ui.money(money - cost)}`;
        document.getElementById('recruit-total').innerHTML = cost
            ? `Итого: <b>${this.ui.money(cost)}</b> · содержание <span class="neg">−${this.ui.money(upkeep)}</span> за ход`
            : '';
    }

    // --- правительство, дипломатия, журнал ----------------------------------------------
    initGovernment() {
        document.getElementById('gov-tax-slider').addEventListener('input', e => {
            this.data.countries[this.data.playerCountry].taxRate = parseFloat(e.target.value);
            this.ui.renderGovernment(this.data);
        });
        document.getElementById('save-game-btn').addEventListener('click', () => {
            this.ui.toast(SaveGame.save(this.data) ? 'Игра сохранена' : 'Не удалось сохранить: хранилище недоступно');
        });
        document.getElementById('new-game-btn').addEventListener('click', () => {
            if (!confirm('Начать новую игру? Текущая партия будет удалена.')) return;
            SaveGame.clear();
            location.reload();
        });
    }

    initTopButtons() {
        document.getElementById('gov-btn').addEventListener('click', () => {
            this.ui.closePanel();
            this.ui.renderGovernment(this.data);
            this.ui.showModal('gov-modal');
        });
        document.getElementById('diplo-btn').addEventListener('click', () => {
            this.ui.closePanel();
            this.ui.showDiplomacy(this.data);
        });
        document.getElementById('log-btn').addEventListener('click', () => this.ui.showHistory(this.data.history));
        document.getElementById('gameover-new-btn').addEventListener('click', () => { SaveGame.clear(); location.reload(); });
    }

    initMapControls() {
        document.getElementById('zoom-in-btn').addEventListener('click', () => this.map.zoomBy(1.6));
        document.getElementById('zoom-out-btn').addEventListener('click', () => this.map.zoomBy(1 / 1.6));
        document.getElementById('home-btn').addEventListener('click', () => this.map.centerOnPlayer(true));
    }

    afterOrder(message) {
        this.ui.updateOrdersPanel(this.data);
        this.ui.haptic(20);
        this.ui.toast(message);
    }

    // Оценка без тумана войны о составе: сила обороны игроку и так видна
    // на карточке области, когда идёт война.
    attackOdds(targetId, forces) {
        const d = this.data;
        const target = d.getRegion(targetId);
        const attack = d.sidePower(forces, d.playerCountry, 'baseAttack', target.army);
        const needed = d.defensePower(target, forces) * RULES.ATTACK_ADVANTAGE;
        const ratio = attack / needed;
        const label = ratio >= 1.5 ? 'высокие' : ratio >= 1 ? 'хорошие' : ratio >= 0.9 ? 'равные' : 'низкие';
        return { ratio, label, attack: Math.round(attack), needed: Math.round(needed) };
    }

    // --- клик по карте -----------------------------------------------------------------
    handleMapClick(regionId) {
        if (this.armyAction.active) {
            const state = this.armyAction;
            const isMove = state.type === 'move';
            const targets = isMove ? this.data.getValidMoveTargets(state.fromId) : this.data.getValidAttackTargets(state.fromId);
            this.cancelTargeting();
            if (!targets.includes(regionId)) return;
            if (isMove) {
                this.data.queueMovement(state.fromId, regionId, state.forces);
                this.afterOrder('Марш запланирован');
                return;
            }
            // Перед атакой оцениваем шансы по той же формуле, что и бой:
            // заведомо проигрышную атаку лучше переспросить, чем молча отправить.
            const odds = this.attackOdds(regionId, state.forces);
            const queue = () => {
                this.data.queueAttack(state.fromId, regionId, state.forces);
                this.afterOrder(`Наступление запланировано · шансы ${odds.label}`);
            };
            if (odds.ratio >= 0.9) { queue(); return; }
            const target = this.data.getRegion(regionId);
            this.ui.showDecision({
                title: '⚠️ Атака, скорее всего, провалится',
                text: `Ваши силы: ~${odds.attack}. Чтобы взять ${target.name}, нужно около ${odds.needed}. `
                    + 'Отправленные войска понесут потери, а уцелевшие вернутся назад. '
                    + 'Можно добавить сил, провести разведку или ударить сразу из нескольких областей.',
                accept: 'Атаковать всё равно',
                decline: 'Отменить',
                onAccept: queue,
                onDecline: () => {},
            });
            return;
        }

        const region = this.data.getRegion(regionId);
        if (!region) return;
        if (this.map.isRegionalZoom) this.showRegion(regionId);
        else this.showCountry(region.owner);
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

        const launch = data => {
            document.getElementById('start-screen').style.display = 'none';
            window.game = new GameCore(data);
        };

        // Сохранённая партия — сразу предлагаем продолжить.
        const saved = SaveGame.load();
        if (saved) {
            const g = saved.game;
            const country = CountriesDB[g.player];
            const date = new Date(g.date);
            const box = document.getElementById('continue-box');
            box.style.display = 'block';
            document.getElementById('continue-info').textContent =
                `${country ? country.name : g.player} · ${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()} · ход ${g.turn}`;
            document.getElementById('continue-btn').addEventListener('click', () => {
                try { launch(GameData.restore(g)); }
                catch (e) { SaveGame.clear(); alert('Сохранение повреждено и удалено. Начните новую игру.'); location.reload(); }
            });
        }

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
            if (!listEl.children.length) listEl.innerHTML = '<div class="country-list-empty">Ничего не найдено</div>';
        };

        const select = id => {
            selectedId = id;
            for (const el of listEl.children) el.classList.toggle('selected', el.dataset.id === id);
            const country = CountriesDB[id];
            document.getElementById('info-name').textContent = country.name;
            const set = (elId, value) => { document.getElementById(elId).querySelector('span').textContent = value; };
            set('info-pop', country.population ? formatMillions(country.population) : 'нет данных');
            set('info-area', country.area.toLocaleString('ru-RU') + ' км²');
            set('info-regions', String(country.regions));
            const regions = Object.keys(RegionsDB).filter(r => RegionsDB[r].cc === id);
            const capital = CitiesDB.find(c => c.cc === id && c.isCapital);
            set('info-capital', capital ? capital.name : (regions.length ? RegionsDB[regions[0]].name : '—'));
            document.getElementById('info-visuals').style.visibility = 'visible';
            document.getElementById('info-flag').src = `https://flagcdn.com/w160/${id.toLowerCase()}.png`;
            drawMinimap(regions, country.color);
            startBtn.disabled = false;
        };

        listEl.addEventListener('click', e => {
            const item = e.target.closest('.country-list-item');
            if (item) select(item.dataset.id);
        });
        searchEl.addEventListener('input', () => render(searchEl.value));

        startBtn.addEventListener('click', () => {
            if (!selectedId || !CountriesDB[selectedId]) return;
            if (saved && !confirm('Начать новую игру? Сохранённая партия будет удалена.')) return;
            SaveGame.clear();
            launch(new GameData(selectedId, {
                cheat: document.getElementById('cheat-toggle').checked,
                scenario: document.getElementById('scenario-toggle').checked ? 'war2024' : 'peace',
            }));
        });

        render('');
        select(playable.includes('UA') ? 'UA' : playable[0]);
    };

    function formatMillions(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' млн';
        if (n >= 1e3) return Math.round(n / 1e3) + ' тыс.';
        return String(n);
    }

    function drawMinimap(regionIds, color) {
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
            minX = Math.min(minX, info.bx); maxX = Math.max(maxX, info.bx + info.bw);
            minY = Math.min(minY, info.by); maxY = Math.max(maxY, info.by + info.bh);
        }
        if (minX === Infinity) return;
        const pad = Math.max(maxX - minX, maxY - minY) * 0.08;
        svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();
})();
