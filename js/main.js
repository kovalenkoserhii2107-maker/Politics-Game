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

        document.addEventListener('mapBackground', () => this.ui.closePanel());
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
        this.loop.afterSummary();
    }

    // --- действия из карточек и окон ---------------------------------------
    runAction(btn) {
        const d = this.data;
        const player = d.playerCountry;
        const cc = btn.dataset.country;
        const action = btn.dataset.action;
        if (action.startsWith('campaign-')) {
            this.ui.hideModal('campaign-modal');
            if (action === 'campaign-budget') this.openGovernment();
            else if (action === 'campaign-diplomacy') this.openDiplomacy();
            else {
                const id = document.getElementById('owned-region-select')?.value || d.mostPopulousRegion(player);
                if (id) { this.map.focusRegion(id); this.showRegion(id);
                    if (action === 'campaign-invest') { const panel = document.getElementById('development-panel'); panel.open = true; panel.scrollIntoView({ block: 'nearest' }); }
                    if (action === 'campaign-recruit') document.getElementById('recruit-btn').click();
                }
            }
            return;
        }
        if (d.gameOver) return;
        if (['invest', 'cancel-project', 'integrate'].includes(action)) {
            const id = btn.dataset.region;
            const result = action === 'invest' ? d.invest(id, btn.dataset.kind)
                : action === 'integrate' ? d.integrateTerritory(id)
                : { ok: d.cancelProject(id) };
            if (!result.ok) { this.ui.toast(result.reason || 'Проект недоступен'); return; }
            this.ui.toast(action === 'invest' ? 'Строительство начато' : action === 'integrate' ? 'Территория интегрирована' : 'Средства возвращены');
            this.showRegion(id);
            this.loop.updateTopBarUI();
            this.map.refreshColors();
            this.map.createCountryLabels();
            SaveGame.save(d);
            return;
        }

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
            SaveGame.save(d);
        } else if (btn.dataset.action === 'trade') {
            d.setTrade(player, btn.dataset.key, btn.checked ? 'sell' : 'keep');
            this.ui.renderGovernment(d);
            this.loop.updateTopBarUI();
            SaveGame.save(d);
        } else if (btn.dataset.action === 'research') {
            const result = d.research(player, btn.dataset.key);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.haptic(20);
            this.ui.toast('Исследование завершено');
            this.ui.renderGovernment(d);
            this.loop.updateTopBarUI();
            this.map.drawArmyMarkers();
            SaveGame.save(d);
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
        SaveGame.save(this.data);
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
        this.map.ensureVisible(region.lx, region.ly);
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
        document.getElementById('target-list-btn').addEventListener('click', () => this.showTargetList());
        document.getElementById('close-target-btn').addEventListener('click', () => this.ui.hideModal('target-modal'));
        document.getElementById('target-list').addEventListener('click', e => {
            const row = e.target.closest('[data-target]');
            if (!row) return;
            this.ui.hideModal('target-modal');
            this.handleMapClick(row.dataset.target);
        });
    }

    // Те же цели, что подсвечены на карте, но списком: в маленькую область
    // на телефоне пальцем не попасть. Атаки — от лучших шансов к худшим.
    showTargetList() {
        const state = this.armyAction;
        if (!state.active) return;
        const d = this.data;
        const isMove = state.type === 'move';
        const ids = isMove ? d.getValidMoveTargets(state.fromId) : d.getValidAttackTargets(state.fromId);
        const LIMIT = 60;
        const rows = ids.map(id => {
            const region = d.getRegion(id);
            const transport = d.expeditionQuote(isMove ? 'movements' : 'attacks', state.fromId, id, state.forces);
            const odds = isMove ? null : this.attackOdds(id, state.forces);
            return { id, region, transport, odds };
        }).sort((a, b) => (a.transport.cost ? 1 : 0) - (b.transport.cost ? 1 : 0)
            || (b.odds ? b.odds.ratio : 0) - (a.odds ? a.odds.ratio : 0)
            || a.region.name.localeCompare(b.region.name, 'ru'));

        const from = d.getRegion(state.fromId);
        document.getElementById('target-title').textContent = isMove ? 'Куда перебросить войска' : 'Кого атаковать';
        document.getElementById('target-hint').textContent = `Из области ${from.name}. `
            + (isMove ? 'Выберите свою область.' : 'Шансы считаются по отправленным войскам.');
        document.getElementById('target-list').innerHTML = rows.slice(0, LIMIT).map(({ id, region, transport, odds }) => {
            const owner = d.countries[region.owner];
            const sea = transport.cost ? ` · морем ${this.ui.money(transport.cost)}` : '';
            const chip = odds
                ? `<span class="odds ${odds.ratio >= 1 ? 'high' : odds.ratio >= 0.9 ? 'even' : 'low'}">${odds.label}</span>`
                : `<span class="odds move">марш</span>`;
            return `<button class="target-row" type="button" data-target="${id}">
                <span class="swatch" style="background:${owner.color}"></span>
                <span><b>${this.ui.escape(region.name)}</b><small>${this.ui.escape(owner.name)}${sea}</small></span>
                ${chip}</button>`;
        }).join('') + (rows.length > LIMIT ? `<p class="hint">И ещё ${rows.length - LIMIT} — выберите их на карте.</p>` : '');
        this.ui.showModal('target-modal');
    }

    cancelTargeting() {
        this.ui.hideModal('target-modal');
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
            SaveGame.save(this.data);
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
        document.getElementById('gov-policy').addEventListener('change', e => {
            const result = this.data.setPolicy(this.data.playerCountry, e.target.value);
            if (!result.ok) this.ui.toast(result.reason);
            this.ui.renderGovernment(this.data);
            this.loop.updateTopBarUI();
            SaveGame.save(this.data);
        });
        document.getElementById('gov-tax-slider').addEventListener('input', e => {
            this.data.countries[this.data.playerCountry].taxRate = parseFloat(e.target.value);
            this.ui.renderGovernment(this.data);
            this.loop.updateTopBarUI();
            SaveGame.save(this.data);
        });
        document.getElementById('save-game-btn').addEventListener('click', () => {
            this.ui.toast(SaveGame.save(this.data) ? 'Игра сохранена' : 'Не удалось сохранить: хранилище недоступно');
        });
        document.getElementById('export-game-btn').addEventListener('click', () => {
            const file = SaveGame.exportFile(this.data);
            const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
            const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.ui.toast(`Партия записана в файл ${file.name}`);
        });
        document.getElementById('new-game-btn').addEventListener('click', () => {
            if (!confirm('Начать новую игру? Текущая партия будет удалена.')) return;
            SaveGame.discard();
            location.reload();
        });
    }

    openGovernment() {
        this.ui.closePanel();
        this.data.campaign.budget = true;
        this.ui.renderGovernment(this.data);
        this.ui.showModal('gov-modal');
        SaveGame.save(this.data);
    }

    openDiplomacy() {
        this.ui.closePanel();
        this.data.campaign.diplomacy = true;
        this.ui.showDiplomacy(this.data);
        SaveGame.save(this.data);
    }

    initTopButtons() {
        document.getElementById('gov-btn').addEventListener('click', () => this.openGovernment());
        document.getElementById('res-status').addEventListener('click', () => {
            this.openGovernment();
            document.getElementById('gov-economy-section').scrollIntoView({ block: 'start' });
        });
        document.getElementById('diplo-btn').addEventListener('click', () => this.openDiplomacy());
        document.getElementById('campaign-btn').addEventListener('click', () => this.ui.showCampaign(this.data));
        document.getElementById('log-btn').addEventListener('click', () => this.ui.showHistory(this.data.history));
        document.getElementById('gameover-new-btn').addEventListener('click', () => { SaveGame.discard(); location.reload(); });
    }

    initMapControls() {
        document.getElementById('zoom-in-btn').addEventListener('click', () => this.map.zoomBy(1.6));
        document.getElementById('zoom-out-btn').addEventListener('click', () => this.map.zoomBy(1 / 1.6));
        document.getElementById('home-btn').addEventListener('click', () => this.map.centerOnPlayer(true));
    }

    afterOrder(message) {
        this.ui.updateOrdersPanel(this.data);
        SaveGame.save(this.data);
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
            const transport = this.data.expeditionQuote(isMove ? 'movements' : 'attacks', state.fromId, regionId, state.forces);
            if (transport.cost) {
                const odds = isMove ? null : this.attackOdds(regionId, state.forces);
                this.ui.showDecision({
                    title: isMove ? 'Межконтинентальная переброска' : 'Экспедиция',
                    text: `Перевозка за один ход: ${this.ui.money(transport.cost)} и ${transport.influence} влияния.${odds ? ` Шансы атаки: ${odds.label}. Сила ${odds.attack}, нужно ${odds.needed}.` : ''} При отмене приказа затраты возвращаются.`,
                    accept: 'Отправить', decline: 'Отменить',
                    onAccept: () => {
                        const result = isMove ? this.data.queueMovement(state.fromId, regionId, state.forces) : this.data.queueAttack(state.fromId, regionId, state.forces);
                        if (!result.ok) { this.ui.toast(result.reason); return; }
                        this.loop.updateTopBarUI();
                        this.afterOrder('Экспедиция запланирована');
                    }, onDecline: () => {},
                });
                return;
            }
            if (isMove) {
                const result = this.data.queueMovement(state.fromId, regionId, state.forces);
                if (!result.ok) { this.ui.toast(result.reason); return; }
                this.afterOrder('Марш запланирован');
                return;
            }
            // Перед атакой оцениваем шансы по той же формуле, что и бой:
            // заведомо проигрышную атаку лучше переспросить, чем молча отправить.
            const odds = this.attackOdds(regionId, state.forces);
            const queue = () => {
                const result = this.data.queueAttack(state.fromId, regionId, state.forces);
                if (!result.ok) { this.ui.toast(result.reason); return; }
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
    const FEATURED = ['US', 'CN', 'BR', 'DE', 'FR', 'UA'];
    const LIST_PREVIEW = 12;
    const LEVELS = ['', 'Легко', 'Средне', 'Сложно'];
    const $ = id => document.getElementById(id);
    const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const flagUrl = (id, w) => `https://flagcdn.com/w${w}/${id.toLowerCase()}.png`;
    const flagImg = (id, w, cls = 'flag') => `<img class="${cls}" src="${flagUrl(id, w)}" data-cc="${id}" alt="" width="36" height="24" loading="lazy">`;
    const bars = level => `<span class="bars lvl-${level}" aria-hidden="true"><i></i><i></i><i></i></span>`;

    let selectedId = null;
    let expanded = false;
    const previews = {};       // один пробный мир на сценарий — ~30 мс
    const assessments = {};    // сложность стран по сценарию

    const ready = () => {
        const listEl = $('start-country-list');
        const searchEl = $('start-search');
        const startBtn = $('start-game-btn');
        const moreBtn = $('list-more');

        const playable = Object.keys(CountriesDB)
            .filter(id => CountriesDB[id].playable && CountriesDB[id].regions > 0)
            .sort((a, b) => CountriesDB[a].name.localeCompare(CountriesDB[b].name, 'ru'));
        const featured = FEATURED.filter(id => playable.includes(id));

        const scenario = () => ($('scenario-toggle').checked ? 'war2024' : 'peace');
        const difficulty = () => (document.querySelector('input[name="difficulty"]:checked') || {}).value || 'normal';
        const showLevel = () => { $('level-note').textContent = DIFFICULTY[difficulty()].note; };
        for (const radio of document.querySelectorAll('input[name="difficulty"]')) radio.addEventListener('change', () => { showLevel(); updateCta(); });
        const preview = () => {
            const key = scenario();
            if (!previews[key]) previews[key] = new GameData(playable[0], { scenario: key });
            return previews[key];
        };

        // Сложность — по тому, что реально ждёт игрока на первом ходу:
        // размер страны, недельный баланс, сильнейший сосед и война.
        const assess = id => {
            const key = scenario();
            assessments[key] = assessments[key] || {};
            if (assessments[key][id]) return assessments[key][id];
            const d = preview();
            const unitsOf = cc => Object.values(d.getCountryStats(cc).army).reduce((a, b) => a + b, 0);
            const balance = d.steadyBalance(id);
            const net = balance.income - balance.expense;
            const army = unitsOf(id);
            const neighbours = d.neighbourCountries(id).filter(cc => d.countries[cc].playable);
            let rival = null, rivalArmy = 0;
            for (const cc of neighbours) {
                const n = unitsOf(cc);
                if (n > rivalArmy) { rival = cc; rivalArmy = n; }
            }
            const enemies = d.enemiesOf(id);
            const regions = CountriesDB[id].regions;
            const ratio = rivalArmy / Math.max(army, 1);
            let score = 0;
            if (regions <= 2) score += 1;
            if (regions >= 10) score -= 1;
            if (ratio > 4) score += 2; else if (ratio > 1.2) score += 1;
            if (net < 0) score += 1;
            if (enemies.length) score += 1;
            const level = score <= 0 ? 1 : score === 1 ? 2 : 3;

            let advice;
            if (enemies.length) advice = `Идёт война: ${enemies.map(cc => d.countries[cc].name).join(', ')}. Сначала удержите границу: наберите войска и не распыляйте силы.`;
            else if (net < 0) advice = 'Расходы больше доходов. В «Правительстве» поднимите налог или распустите часть войск, иначе армия начнёт разбегаться.';
            else if (rival && ratio > 1.2) advice = `Сильный сосед — ${d.countries[rival].name}: ${rivalArmy} подразделений против ваших ${army}. Не ссорьтесь с ним, пока не окрепнете.`;
            else if (regions <= 2) advice = 'Маленькая страна: мало денег и войск. Стройте экономику и выбирайте слабых соседей.';
            else advice = 'Хороший старт: деньги есть, соседи не опасны. Вложитесь в экономику и наберите армию.';

            return (assessments[key][id] = {
                level, advice, net, army, regions, neighbours: neighbours.length,
                money: d.countries[id].money,
            });
        };

        const money = n => {
            const v = Math.abs(n);
            if (v >= 1e9) return '$' + (v / 1e9).toFixed(1).replace('.0', '') + 'B';
            if (v >= 1e6) return '$' + (v / 1e6).toFixed(1).replace('.0', '') + 'M';
            if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
            return '$' + Math.round(v);
        };

        const launch = (data, tutorial = false) => {
            $('start-screen').style.display = 'none';
            document.body.classList.add('in-game');
            window.game = new GameCore(data);
            if (tutorial) new Tutorial(window.game).start();
            else if (!data.gameOver && !data.decisions.length && data.turn === 0 && !data.campaign.budget) window.game.ui.showCampaign(data);
        };
        $('tutorial-toggle').checked = !Tutorial.isDone();

        // Сохранённая партия — первым делом предлагаем продолжить.
        const saved = SaveGame.load();
        let saveProblem = SaveGame.error;
        if (saveProblem) {
            $('save-warning').hidden = false;
            $('save-delete-btn').addEventListener('click', () => {
                SaveGame.clear();
                saveProblem = '';
                $('save-warning').hidden = true;
            });
        }
        if (saved) {
            const g = saved.game;
            const country = CountriesDB[g.player];
            const date = new Date(g.date);
            $('continue-box').hidden = false;
            $('continue-flag').outerHTML = flagImg(g.player, 80).replace('<img', '<img id="continue-flag"');
            $('continue-name').textContent = country ? country.name : g.player;
            $('continue-info').innerHTML =
                `Ход ${g.turn} · ${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
                + (SaveGame.migrated ? ' · <span class="migrated">перенесена из прошлой версии</span>' : '');
            $('continue-btn').addEventListener('click', () => {
                try { launch(GameData.restore(g)); }
                catch (e) { alert('Не удалось загрузить партию. Сохранение оставлено в хранилище.'); }
            });
        }

        const renderFeatured = () => {
            $('quick-countries').innerHTML = featured.map(id => {
                const a = assess(id);
                return `<button class="quick-country" type="button" data-id="${id}" aria-pressed="${id === selectedId}">
                    ${flagImg(id, 80)}
                    <b>${escape(CountriesDB[id].name)}</b>
                    <span class="quick-meta">${bars(a.level)}${LEVELS[a.level]}</span>
                </button>`;
            }).join('');
        };

        const renderList = () => {
            const query = searchEl.value.trim().toLowerCase();
            const matches = query ? playable.filter(id => CountriesDB[id].name.toLowerCase().includes(query)) : playable;
            const shown = query || expanded ? matches : matches.slice(0, LIST_PREVIEW);
            $('featured-block').hidden = !!query;
            $('list-label').textContent = query ? `Найдено: ${matches.length}` : `Все страны · ${playable.length}`;
            listEl.innerHTML = shown.length ? shown.map(id => {
                const a = assess(id);
                return `<button class="country-list-item${id === selectedId ? ' selected' : ''}" type="button" data-id="${id}" aria-pressed="${id === selectedId}">
                    ${flagImg(id, 40)}
                    <span class="name">${escape(CountriesDB[id].name)}</span>
                    <span class="list-regions">${a.regions} обл.</span>
                    ${bars(a.level)}<span class="sr-only">${LEVELS[a.level]}</span>
                </button>`;
            }).join('') : '<div class="country-list-empty">Такой страны нет. Попробуйте другое название.</div>';
            moreBtn.hidden = !!query || expanded || matches.length <= LIST_PREVIEW;
            moreBtn.textContent = `Показать все страны (${playable.length})`;
        };

        const renderDossier = () => {
            const id = selectedId;
            const country = CountriesDB[id];
            const a = assess(id);
            const capital = CitiesDB.find(c => c.cc === id && c.isCapital);
            const regions = Object.keys(RegionsDB).filter(r => RegionsDB[r].cc === id);
            $('info-name').textContent = country.name;
            $('info-capital').textContent = 'Столица: ' + (capital ? capital.name : (regions.length ? RegionsDB[regions[0]].name : '—'));
            $('info-flag').outerHTML = flagImg(id, 160, 'flag flag-lg').replace('<img', '<img id="info-flag"');
            $('info-difficulty').className = `difficulty lvl-${a.level}`;
            $('info-difficulty').innerHTML = `Сложность${bars(a.level)}<b>${LEVELS[a.level]}</b>`;
            const stat = (label, value, cls = '') => `<div class="stat"><span>${label}</span><b class="${cls}">${value}</b></div>`;
            $('info-stats').innerHTML = [
                stat('Население', country.population ? formatMillions(country.population) : '—'),
                stat('Областей', a.regions),
                stat('Соседей', a.neighbours),
                stat('Казна', money(a.money)),
                stat('Доход / нед.', (a.net >= 0 ? '+' : '−') + money(a.net), a.net >= 0 ? 'pos' : 'neg'),
                stat('Армия', a.army.toLocaleString('ru-RU')),
            ].join('');
            // Профиль страны: чего в избытке (продаст), чего не хватает (будет докупать).
            const flows = Economy.flows(preview(), id);
            $('info-resources').innerHTML = Object.entries(RESOURCES).map(([key, res]) => {
                const net = Math.round(flows[key].prod - flows[key].need);
                return `<span class="res-chip ${net >= 0 ? 'pos' : 'neg'}" title="${res.name}: ${net >= 0 ? 'излишек' : 'нехватка'} за ход">${res.icon} ${net >= 0 ? '+' : '−'}${Math.abs(net)}</span>`;
            }).join('');
            const advice = $('info-advice');
            advice.className = `advice lvl-${a.level}`;
            advice.textContent = a.advice;
            drawMinimap(regions, country.color);
            updateCta();
            startBtn.disabled = false;
        };

        // Кнопка говорит, что именно начнётся: страна и режим.
        const updateCta = () => {
            if (!selectedId) return;
            const mode = scenario() === 'war2024' ? 'Сценарий 2024' : 'Мирный старт';
            const level = difficulty() === 'normal' ? '' : ' · ' + DIFFICULTY[difficulty()].name;
            startBtn.innerHTML = `<span>Начать игру ▶</span><small>${escape(CountriesDB[selectedId].name)} · ${mode}${level}</small>`;
        };

        // Нет сети — вместо флага плашка цвета страны на карте.
        $('start-screen').addEventListener('error', e => {
            const img = e.target;
            if (img.tagName !== 'IMG' || !img.dataset.cc) return;
            const stub = document.createElement('span');
            stub.className = img.className + ' flag-stub';
            if (img.id) stub.id = img.id;
            stub.style.background = (CountriesDB[img.dataset.cc] || {}).color || 'var(--s3)';
            img.replaceWith(stub);
        }, true);

        const select = (id, fromTap) => {
            selectedId = id;
            for (const el of document.querySelectorAll('#start-screen [data-id]')) {
                const on = el.dataset.id === id;
                el.setAttribute('aria-pressed', String(on));
                el.classList.toggle('selected', on && el.classList.contains('country-list-item'));
            }
            renderDossier();
            // На телефоне досье ниже списка — показываем его после выбора.
            if (fromTap && window.matchMedia('(max-width: 899px)').matches) {
                $('step-dossier').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };

        const pick = e => {
            const btn = e.target.closest('[data-id]');
            if (btn) select(btn.dataset.id, true);
        };
        listEl.addEventListener('click', pick);
        $('quick-countries').addEventListener('click', pick);
        searchEl.addEventListener('input', renderList);
        searchEl.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            const first = listEl.querySelector('[data-id]');
            if (first) { searchEl.blur(); select(first.dataset.id, true); }
        });
        moreBtn.addEventListener('click', () => { expanded = true; renderList(); });
        for (const radio of document.querySelectorAll('input[name="scenario"]')) {
            radio.addEventListener('change', () => { renderFeatured(); renderList(); if (selectedId) renderDossier(); });
        }

        startBtn.addEventListener('click', () => {
            if (!selectedId || !CountriesDB[selectedId]) return;
            if ((saved || saveProblem) && !confirm('Начать новую игру? Сохранённая партия будет удалена.')) return;
            SaveGame.clear();
            launch(new GameData(selectedId, { cheat: $('cheat-toggle').checked, scenario: scenario(), difficulty: difficulty() }),
                $('tutorial-toggle').checked);
        });

        // Партия из файла: текущая версия грузится как есть, старая переносится.
        $('import-btn').addEventListener('click', () => $('import-file').click());
        $('import-file').addEventListener('change', async e => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            let data;
            try {
                data = GameData.restore(SaveGame.parse(await file.text()).game);
            } catch (err) {
                alert('Этот файл не подходит: в нём нет партии или она от другой карты.');
                return;
            }
            if ((saved || saveProblem) && !confirm('Загрузить партию из файла? Текущее сохранение будет заменено.')) return;
            SaveGame.clear();
            SaveGame.save(data);
            launch(data);
        });
        showLevel();

        drawHeroArt($('hero-art'));
        const initial = saved && playable.includes(saved.game.player) ? saved.game.player
            : (playable.includes('UA') ? 'UA' : playable[0]);
        selectedId = initial;
        renderFeatured();
        renderList();
        select(initial, false);
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
            path.setAttribute('stroke', 'rgba(10,11,13,0.85)');
            path.setAttribute('stroke-width', '0.3');
            path.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.appendChild(path);
            minX = Math.min(minX, info.bx); maxX = Math.max(maxX, info.bx + info.bw);
            minY = Math.min(minY, info.by); maxY = Math.max(maxY, info.by + info.bh);
        }
        if (minX === Infinity) return;
        const pad = Math.max(maxX - minX, maxY - minY) * 0.08;
        svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
    }

    // Заставка: изометрический квартал из графитовых блоков с одним красным.
    function drawHeroArt(svg) {
        const S = 14, cos = Math.cos(Math.PI / 6), sin = 0.5;
        const pt = (i, j, z) => [(i - j) * cos * S, (i + j) * sin * S - z * S];
        const poly = (pts, fill) => `<polygon points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="${fill}"/>`;
        const palette = {
            dark: ['#2e333b', '#1c1f24', '#15171b'],
            mid: ['#3b414a', '#252930', '#1a1d22'],
            red: ['#ff3b2f', '#c9261c', '#8e1811'],
            white: ['#eceef1', '#c5c9cf', '#9aa0a8'],
        };
        // [i, j, ширина, глубина, высота, цвет]
        const blocks = [
            [0, 0, 4, 3, 5, 'dark'], [5, -1, 3, 3, 9, 'mid'], [9, 0, 3, 4, 6, 'dark'],
            [1, 4, 3, 3, 3, 'mid'], [5, 3, 2, 2, 12, 'dark'], [8, 5, 4, 2, 2, 'white'],
            [13, 1, 2, 5, 4, 'red'], [0, 8, 5, 2, 2, 'dark'], [6, 8, 3, 3, 7, 'mid'],
            [10, 8, 2, 2, 4, 'dark'], [3, 12, 3, 2, 1, 'white'],
        ].sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
        let out = '';
        // сетка «земли»
        for (let k = -2; k <= 16; k += 2) {
            const a = pt(k, -3, 0), b = pt(k, 16, 0), c = pt(-3, k, 0), d = pt(18, k, 0);
            out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="rgba(255,255,255,0.05)"/>`;
            out += `<line x1="${c[0]}" y1="${c[1]}" x2="${d[0]}" y2="${d[1]}" stroke="rgba(255,255,255,0.05)"/>`;
        }
        for (const [i, j, w, dpt, h, tone] of blocks) {
            const [top, left, right] = palette[tone];
            out += poly([pt(i, j + dpt, 0), pt(i + w, j + dpt, 0), pt(i + w, j + dpt, h), pt(i, j + dpt, h)], left);
            out += poly([pt(i + w, j, 0), pt(i + w, j + dpt, 0), pt(i + w, j + dpt, h), pt(i + w, j, h)], right);
            out += poly([pt(i, j, h), pt(i + w, j, h), pt(i + w, j + dpt, h), pt(i, j + dpt, h)], top);
            if (tone === 'red') {
                const [x, y] = pt(i + w, j + dpt / 2, h / 2);
                out += `<circle cx="${x}" cy="${y}" r="3" fill="#fff" opacity="0.9"/>`;
            }
        }
        svg.setAttribute('viewBox', '-150 -110 360 330');
        svg.setAttribute('preserveAspectRatio', 'xMaxYMid slice');
        svg.innerHTML = out;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();
})();
