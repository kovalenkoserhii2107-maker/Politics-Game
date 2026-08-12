// =====================================================================
// МОДУЛЬ 4: ГЛАВНЫЙ КОНТРОЛЛЕР
// =====================================================================
class GameCore {
    constructor(playerCountryId, cheatMode) {
        this.data = new GameData(playerCountryId, cheatMode);
        this.data.buildDatabaseFromSVG();
        
        this.ui = new UIManager();
        this.map = new MapEngine(this.data, (regionId) => this.handleMapClick(regionId));
        this.loop = new GameLoop(this.data, this.ui, this.map);

        this.armyActionState = {
            active: false, type: null, fromId: null, forces: {}
        };

        // Снимаем выделение, когда интерфейс сообщает о закрытии панели
        document.addEventListener('panelClosed', () => this.map.clearSelection());

        // Глобальный слушатель для кнопок "Отменить" (Крестик) в журнале приказов
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.cancel-order-btn');
            if (btn) {
                // ВАЖНО: Останавливаем клик, чтобы он 100% не улетел на карту под панелью
                e.stopPropagation(); 
                
                const index = parseInt(btn.dataset.orderIndex);
                const type = btn.dataset.type; 
                
                if (!isNaN(index) && type && this.data.orders[type]) {
                    // 1. Удаляем приказ из плана
                    this.data.orders[type].splice(index, 1); 
                    
                    // 2. Обновляем окошко (если список станет пустым - оно автоматически закроется)
                    this.ui.updateOrdersPanel(this.data.orders); 
                    
                    // 3. Моментально возвращаем войска в доступный резерв
                    const actionPanel = document.getElementById('army-action-panel');
                    if (actionPanel && actionPanel.dataset.regionId) {
                        const regionId = actionPanel.dataset.regionId;
                        this.updateActionButtonsVisibility(regionId);
                        
                        // МАГИЯ UX: Если меню ползунков войск открыто прямо сейчас, 
                        // обновляем значения доступных войск на лету, не закрывая меню!
                        if (actionPanel.style.display === 'block') {
                            const availableArmy = this.getAvailableArmy(regionId);
                            Object.keys(UnitsDB).forEach(unitId => {
                                const count = availableArmy[unitId] || 0;
                                const input = document.getElementById(`action-${unitId}-input`);
                                const slider = document.getElementById(`action-${unitId}-slider`);
                                if (input && slider) {
                                    input.max = count;
                                    slider.max = count;
                                    const row = input.closest('.army-row');
                                    if (row) {
                                        const span = row.querySelector('span span');
                                        if (span) span.innerText = `(Дост: ${count})`;
                                    }
                                }
                            });
                        }
                    }
                }
            }
        });
        
        document.addEventListener('zoomLevelChanged', (e) => {
            this.ui.updateZoomMode(e.detail.isRegional);
            
            // Логика появления и автоматического скрытия
            const indicator = document.getElementById('zoom-indicator');
            if (indicator) {
                indicator.classList.add('visible'); // Показываем
                
                // Если игрок быстро зумит туда-сюда, отменяем старый таймер
                if (this.zoomTimeout) clearTimeout(this.zoomTimeout);
                
                // Прячем ровно через 2 секунды (2000 мс)
                this.zoomTimeout = setTimeout(() => {
                    indicator.classList.remove('visible');
                }, 2000);
            }
        });

        // Сбрасываем выделение на карте при закрытии боковой панели
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('close-btn')) {
                this.map.clearSelection();
            }
        });
        
        this.initGovPanelLogic();
        this.initMoveLogic(); 

        document.getElementById('log-btn').addEventListener('click', () => {
            this.ui.showHistory(this.data.history);
        });
    }

    // === НОВЫЙ МЕТОД: ВЫЧИСЛЯЕТ СВОБОДНЫЕ ВОЙСКА ===
    getAvailableArmy(regionId) {
        try {
            const region = this.data.getRegion(regionId);
            if (!region) return {};
            let available = { ...(region.army || {}) };
            
            if (this.data.orders) {
                ['movements', 'attacks'].forEach(type => {
                    if (this.data.orders[type]) {
                        this.data.orders[type].forEach(order => {
                            if (order.from === regionId && order.forces) {
                                Object.keys(order.forces).forEach(unitId => {
                                    if (available[unitId] !== undefined) {
                                        available[unitId] -= order.forces[unitId];
                                    }
                                });
                            }
                        });
                    }
                });
            }
            return available;
        } catch(e) {
            console.error("Ошибка расчета доступных войск:", e);
            return {};
        }
    }
    
    initMoveLogic() {
        this.armyActionState = { active: false, type: null, fromId: null, forces: {} };

        const initMoveBtn = document.getElementById('init-move-btn');
        const initAttackBtn = document.getElementById('init-attack-btn');
        const actionPanel = document.getElementById('army-action-panel');
        const confirmBtn = document.getElementById('confirm-action-btn');
        const cancelBtn = document.getElementById('cancel-action-btn');
        const actionInputs = document.getElementById('action-army-inputs');

        const openPanel = (type) => {
            initMoveBtn.style.display = 'none';
            initAttackBtn.style.display = 'none';
            document.getElementById('recruit-btn').style.display = 'none';
            actionPanel.style.display = 'block';
            
            const regionId = actionPanel.dataset.regionId;
            const availableArmy = this.getAvailableArmy(regionId); // БЕРЕМ ТОЛЬКО СВОБОДНЫЕ ВОЙСКА
            
            actionInputs.innerHTML = '';
            Object.keys(UnitsDB).forEach(unitId => {
                const count = availableArmy[unitId] || 0;
                if (count > 0) {
                    const unit = UnitsDB[unitId];
                    // НОВЫЙ ДИЗАЙН: КНОПКА MAX И ПОЛЗУНОК
                    actionInputs.innerHTML += `
                        <div class="army-row" style="flex-direction: column; align-items: stretch; gap: 8px; margin-bottom: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span>${unit.icon} ${unit.name} <span style="color:#94a3b8; font-size:0.85em;">(Дост: ${count})</span></span>
                                <div style="display: flex; gap: 5px; align-items: center;">
                                    <button class="top-btn" id="action-${unitId}-max" style="padding: 2px 6px; font-size: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">MAX</button>
                                    <input type="number" id="action-${unitId}-input" value="0" min="0" max="${count}" style="width: 50px; background: rgba(0,0,0,0.5); color: white; border: 1px solid var(--ui-border); border-radius: 4px; padding: 4px; text-align: center;">
                                </div>
                            </div>
                            <input type="range" id="action-${unitId}-slider" value="0" min="0" max="${count}" style="width: 100%; margin: 0; accent-color: var(--ui-accent);">
                        </div>`;
                }
            });
            
            // ОЖИВЛЯЕМ ПОЛЗУНКИ И КНОПКУ MAX
            Object.keys(UnitsDB).forEach(unitId => {
                const count = availableArmy[unitId] || 0;
                if (count > 0) {
                    const input = document.getElementById(`action-${unitId}-input`);
                    const slider = document.getElementById(`action-${unitId}-slider`);
                    const maxBtn = document.getElementById(`action-${unitId}-max`);
                    
                    if(input && slider && maxBtn) {
                        input.addEventListener('input', (e) => {
                            let val = parseInt(e.target.value) || 0;
                            if(val > count) val = count;
                            if(val < 0) val = 0;
                            e.target.value = val;
                            slider.value = val;
                        });
                        slider.addEventListener('input', (e) => {
                            input.value = e.target.value;
                        });
                        maxBtn.addEventListener('click', () => {
                            input.value = count;
                            slider.value = count;
                        });
                    }
                }
            });
            
            this.armyActionState.type = type;
            if (type === 'attack') {
                confirmBtn.innerText = 'ВЫБРАТЬ ЦЕЛЬ ДЛЯ АТАКИ';
                confirmBtn.style.background = '#ef4444';
            } else {
                confirmBtn.innerText = 'ВЫБРАТЬ ЦЕЛЬ ДЛЯ МАРША';
                confirmBtn.style.background = 'var(--ui-accent)';
            }
        };

        initMoveBtn.addEventListener('click', () => openPanel('move'));
        initAttackBtn.addEventListener('click', () => openPanel('attack'));

        cancelBtn.addEventListener('click', () => {
            actionPanel.style.display = 'none';
            this.updateActionButtonsVisibility(actionPanel.dataset.regionId);
            this.armyActionState.active = false;
            this.map.disableTargetSelection();
        });

        confirmBtn.addEventListener('click', () => {
            const forces = {};
            let hasTroopsSelected = false;

            Object.keys(UnitsDB).forEach(unitId => {
                const input = document.getElementById(`action-${unitId}-input`);
                if (input) {
                    const val = parseInt(input.value) || 0;
                    forces[unitId] = val;
                    if (val > 0) hasTroopsSelected = true;
                } else {
                    forces[unitId] = 0;
                }
            });

            if (!hasTroopsSelected) return;

            const regionId = actionPanel.dataset.regionId;
            
            this.armyActionState.active = true;
            this.armyActionState.fromId = regionId;
            this.armyActionState.forces = forces;

            if (this.armyActionState.type === 'move') {
                const validTargets = this.data.getValidMoveTargets(regionId);
                this.map.enableTargetSelection(validTargets, 'move-target');
            } else {
                const validTargets = this.data.getValidAttackTargets(regionId);
                this.map.enableTargetSelection(validTargets, 'attack-target');
            }

            this.ui.closePanel();
        });
    }

    updateActionButtonsVisibility(regionId) {
        try {
            const region = this.data.getRegion(regionId);
            if (!region) return;

            // Безопасно ищем кнопки
            const recruitBtn = document.getElementById('recruit-btn');
            const moveBtn = document.getElementById('init-move-btn');
            const attackBtn = document.getElementById('init-attack-btn');

            if (recruitBtn) recruitBtn.style.display = (region.owner === this.data.playerCountry) ? 'block' : 'none';

            if (region.owner !== this.data.playerCountry) {
                if (moveBtn) moveBtn.style.display = 'none';
                if (attackBtn) attackBtn.style.display = 'none';
                return;
            }

            const availableArmy = this.getAvailableArmy(regionId) || {};
            let hasTroops = Object.values(availableArmy).some(count => count > 0);

            if (hasTroops) {
                const moveTargets = typeof this.data.getValidMoveTargets === 'function' ? this.data.getValidMoveTargets(regionId) : [];
                if (moveBtn) moveBtn.style.display = (moveTargets && moveTargets.length > 0) ? 'block' : 'none';
                
                const attackTargets = typeof this.data.getValidAttackTargets === 'function' ? this.data.getValidAttackTargets(regionId) : [];
                if (attackBtn) attackBtn.style.display = (attackTargets && attackTargets.length > 0) ? 'block' : 'none';
            } else {
                if (moveBtn) moveBtn.style.display = 'none';
                if (attackBtn) attackBtn.style.display = 'none';
            }
        } catch(e) {
            console.error("Ошибка при обновлении кнопок:", e);
        }
    }

    initGovPanelLogic() {
        const player = this.data.getCountry(this.data.playerCountry);
        const taxSlider = document.getElementById('gov-tax-slider');
        const taxVal = document.getElementById('gov-tax-val');
        const projNet = document.getElementById('gov-proj-net');
        const govArmyContainer = document.getElementById('gov-army-container');

        govArmyContainer.innerHTML = '';
        Object.keys(UnitsDB).forEach(unitId => {
            const unit = UnitsDB[unitId];
            govArmyContainer.innerHTML += `
                <div class="army-row">
                    <span style="font-size: 0.9em; color: #cbd5e1;">${unit.icon} ${unit.name} (-$${unit.maintenanceCost / 1000}k/ход)</span>
                    <div class="army-controls">
                        <button class="army-btn" id="btn-${unitId}-minus">-</button>
                        <span id="gov-${unitId}-val">0</span>
                        <button class="army-btn" id="btn-${unitId}-plus">+</button>
                    </div>
                </div>`;
        });

        const updateGovUI = () => {
            taxVal.innerText = (player.taxRate * 100).toFixed(0) + '%';
            
            Object.keys(UnitsDB).forEach(unitId => {
                const el = document.getElementById(`gov-${unitId}-val`);
                if (el) el.innerText = player.army[unitId] || 0;
            });
            
            const projection = this.loop.getProjectedNetIncome(player.id);
            projNet.innerText = this.ui.formatNumber(projection);
            projNet.style.color = projection >= 0 ? '#4ade80' : '#f87171';
        };

        Object.keys(UnitsDB).forEach(unitId => {
            const unit = UnitsDB[unitId];
            const plusBtn = document.getElementById(`btn-${unitId}-plus`);
            const minusBtn = document.getElementById(`btn-${unitId}-minus`);
            
            if (plusBtn) plusBtn.addEventListener('click', () => {
                if (player.money >= unit.buildCost) {
                    player.money -= unit.buildCost;
                    player.army[unitId] += 1;
                    updateGovUI();
                    this.loop.updateTopBarUI();
                }
            });
            if (minusBtn) minusBtn.addEventListener('click', () => {
                if (player.army[unitId] > 0) {
                    player.army[unitId] -= 1;
                    updateGovUI();
                }
            });
        });

        taxSlider.addEventListener('input', (e) => {
            player.taxRate = parseFloat(e.target.value);
            updateGovUI();
        });

        document.getElementById('gov-btn').addEventListener('click', () => {
            taxSlider.value = player.taxRate;
            updateGovUI();
        });
    }

    handleMapClick(regionId) {
        if (this.armyActionState && this.armyActionState.active) {
            const state = this.armyActionState;
            if (state.type === 'move') {
                const validTargets = this.data.getValidMoveTargets(state.fromId);
                if (validTargets.includes(regionId)) {
                    this.data.queueMovement(state.fromId, regionId, state.forces);
                    this.ui.updateOrdersPanel(this.data.orders);
                }
            } else if (state.type === 'attack') {
                const validTargets = this.data.getValidAttackTargets(state.fromId);
                if (validTargets.includes(regionId)) {
                    this.data.queueAttack(state.fromId, regionId, state.forces);
                    this.ui.updateOrdersPanel(this.data.orders);
                }
            }
            this.armyActionState.active = false;
            this.map.disableTargetSelection();
            return; 
        }

        const region = this.data.getRegion(regionId);
        if (!region) return; 
        
        // === КРИТИЧЕСКИЙ ФИКС: Защита от краша панели для своих территорий ===
        if (!region.army) region.army = {};

        const country = this.data.getCountry(region.owner);
        if (!country) return;

        if (this.map.isRegionalZoom) {
            this.map.selectRegion(regionId);
            this.ui.showRegionInfo(region, country, this.data, this.data.playerCountry);
            
            const armyActionPanel = document.getElementById('army-action-panel');
            if (armyActionPanel) {
                armyActionPanel.dataset.regionId = region.id;
                armyActionPanel.style.display = 'none';
            }
            
            this.updateActionButtonsVisibility(region.id);

        } else {
            this.map.selectCountry(country.id);
            const countryStats = this.data.getCountryStats(country.id);
            this.ui.showCountryInfo(country, countryStats, this.data);
        }
    }
}

// База доступных для игры стран на стартовом экране (Добавлен color)
const PlayableFactions = {
    'UA': { name: 'Украина', color: '#eab308', capital: 'Киев', pop: '~38 млн', area: '603 628 км²', gdp: '$160 млрд', army: '900k+ (вкл. резерв)', wiki: 'https://ru.wikipedia.org/wiki/Украина' },
    'KZ': { name: 'Казахстан', color: '#047857', capital: 'Астана', pop: '~20 млн', area: '2 724 902 км²', gdp: '$220 млрд', army: '70k+', wiki: 'https://ru.wikipedia.org/wiki/Казахстан' },
    'DE': { name: 'Германия', color: '#64748b', capital: 'Берлин', pop: '~83 млн', area: '357 022 км²', gdp: '$4.1 трлн', army: '180k+', wiki: 'https://ru.wikipedia.org/wiki/Германия' },
    'NO': { name: 'Норвегия', color: '#0c4a6e', capital: 'Осло', pop: '~5.4 млн', area: '385 207 км²', gdp: '$480 млрд', army: '23k+', wiki: 'https://ru.wikipedia.org/wiki/Норвегия' }
};

let selectedFactionId = null;

window.onload = () => {
    const listEl = document.getElementById('start-country-list');
    
    Object.keys(PlayableFactions).forEach(id => {
        const fac = PlayableFactions[id];
        const div = document.createElement('div');
        div.className = 'country-list-item';
        div.innerText = fac.name;
        
        div.onclick = () => {
            // Подсветка в списке
            document.querySelectorAll('.country-list-item').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            selectedFactionId = id;
            
            // Обновление текстовой информации
            document.getElementById('info-name').innerText = fac.name;
            document.getElementById('info-capital').querySelector('span').innerText = fac.capital;
            document.getElementById('info-pop').querySelector('span').innerText = fac.pop;
            document.getElementById('info-area').querySelector('span').innerText = fac.area;
            document.getElementById('info-gdp').querySelector('span').innerText = fac.gdp;
            document.getElementById('info-army').querySelector('span').innerText = fac.army;
            
            const wikiLink = document.getElementById('info-wiki');
            wikiLink.href = fac.wiki;
            wikiLink.style.display = 'inline-block';
            
            // --- НОВОЕ: Загрузка Флага и Мини-карты ---
            document.getElementById('info-visuals').style.visibility = 'visible';
            // Загружаем флаг в хорошем качестве по ISO коду страны
            document.getElementById('info-flag').src = `https://flagcdn.com/w160/${id.toLowerCase()}.png`;
            
            // Рендер динамического силуэта страны
            const minimap = document.getElementById('info-minimap');
            minimap.innerHTML = ''; // Очищаем старую карту
            
            // Ищем все полигоны этой страны на главной невидимой карте
            const paths = Array.from(document.querySelectorAll('#world-map path')).filter(p => p.id.startsWith(id + '-'));
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            
            paths.forEach(p => {
                const clone = p.cloneNode(true);
                clone.style.fill = fac.color;
                clone.style.stroke = 'rgba(255,255,255,0.7)';
                clone.style.strokeWidth = '0.5';
                minimap.appendChild(clone);
                
                // Вычисляем границы для умного масштабирования мини-карты
                const bbox = p.getBBox();
                if (bbox.width > 0 && bbox.x > 10) { 
                    if (bbox.x < minX) minX = bbox.x;
                    if (bbox.y < minY) minY = bbox.y;
                    if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width;
                    if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height;
                }
            });
            
            // Устанавливаем рамку камеры (viewBox) точно по размеру страны с отступом 5px
            const pad = 5;
            minimap.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${(maxX - minX) + pad * 2} ${(maxY - minY) + pad * 2}`);
            
            // Разблокировка кнопки старта
            document.getElementById('start-game-btn').disabled = false;
        };
        listEl.appendChild(div);
    });

    // Обработка кнопки "НАЧАТЬ ИГРУ"
    document.getElementById('start-game-btn').addEventListener('click', () => {
        const isCheatActive = document.getElementById('cheat-toggle').checked;
        
        // Скрываем стартовый экран
        document.getElementById('start-screen').style.display = 'none';
        
        // Инициализируем ядро игры
        const game = new GameCore(selectedFactionId, isCheatActive);
    });
};
