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

        document.addEventListener('zoomLevelChanged', (e) => {
            this.ui.updateZoomMode(e.detail.isRegional);
        });

        this.initGovPanelLogic();
        this.initMoveLogic(); 

        document.getElementById('log-btn').addEventListener('click', () => {
            this.ui.showHistory(this.data.history);
        });
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
            const region = this.data.getRegion(regionId);
            if (!region) return;
            
            actionInputs.innerHTML = '';
            Object.keys(UnitsDB).forEach(unitId => {
                const count = region.army[unitId] || 0;
                if (count > 0) {
                    const unit = UnitsDB[unitId];
                    actionInputs.innerHTML += `
                        <div class="army-row">
                            <span>${unit.icon} ${unit.name} (Макс: ${count})</span>
                            <input type="number" id="action-${unitId}-input" value="0" min="0" max="${count}" style="width: 60px; background: rgba(0,0,0,0.5); color: white; border: 1px solid var(--ui-border); border-radius: 4px; padding: 4px;">
                        </div>`;
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
        const region = this.data.getRegion(regionId);
        
        // ЗАЩИТА: Если региона нет, скрываем всё и выходим
        if (!region) {
            document.getElementById('recruit-btn').style.display = 'none';
            document.getElementById('init-move-btn').style.display = 'none';
            document.getElementById('init-attack-btn').style.display = 'none';
            return;
        }

        if (region.owner === this.data.playerCountry) {
            document.getElementById('recruit-btn').style.display = 'block';
        } else {
            document.getElementById('recruit-btn').style.display = 'none';
        }

        if (region.owner !== this.data.playerCountry) {
            document.getElementById('init-move-btn').style.display = 'none';
            document.getElementById('init-attack-btn').style.display = 'none';
            return;
        }

        let hasTroops = false;
        Object.keys(UnitsDB).forEach(unitId => {
            if ((region.army[unitId] || 0) > 0) hasTroops = true;
        });

        if (hasTroops) {
            const moveTargets = this.data.getValidMoveTargets(regionId);
            document.getElementById('init-move-btn').style.display = moveTargets.length > 0 ? 'block' : 'none';
            
            const attackTargets = this.data.getValidAttackTargets(regionId);
            document.getElementById('init-attack-btn').style.display = attackTargets.length > 0 ? 'block' : 'none';
        } else {
            document.getElementById('init-move-btn').style.display = 'none';
            document.getElementById('init-attack-btn').style.display = 'none';
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
        
        const country = this.data.getCountry(region.owner);
        if (!country) return;

        if (this.map.isRegionalZoom) {
            this.ui.showRegionInfo(region, country, this.data, this.data.playerCountry);
            
            const armyActionPanel = document.getElementById('army-action-panel');
            if (armyActionPanel) {
                armyActionPanel.dataset.regionId = region.id;
                armyActionPanel.style.display = 'none';
            }
            
            this.updateActionButtonsVisibility(region.id);

        } else {
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