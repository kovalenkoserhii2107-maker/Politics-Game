// =====================================================================
// МОДУЛЬ 2: ИНТЕРФЕЙС
// =====================================================================
class UIManager {
    constructor() {
        this.panel = document.getElementById('side-panel');
        this.badge = document.getElementById('panel-badge');
        this.zoomIndicator = document.getElementById('zoom-mode');
        
        const closePanelBtn = document.getElementById('close-panel-btn');
        if (closePanelBtn) closePanelBtn.addEventListener('click', () => this.closePanel());
        
        const govBtn = document.getElementById('gov-btn');
        if (govBtn) govBtn.addEventListener('click', () => this.openGovPanel());
        
        const closeGovBtn = document.getElementById('close-gov-btn');
        if (closeGovBtn) closeGovBtn.addEventListener('click', () => this.closeGovPanel());
        
        const closeSummaryBtn = document.getElementById('close-summary-btn');
        if (closeSummaryBtn) closeSummaryBtn.addEventListener('click', () => { document.getElementById('summary-modal').style.display = 'none'; });
        
        const closeHistoryBtn = document.getElementById('close-history-btn');
        if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', () => { document.getElementById('history-modal').style.display = 'none'; });
    }

    formatNumber(num) {
        const sign = num < 0 ? '-' : '';
        const absNum = Math.abs(num);
        if (absNum >= 1000000) return sign + (absNum / 1000000).toFixed(2) + 'M';
        if (absNum >= 1000) return sign + (absNum / 1000).toFixed(1) + 'K';
        return sign + Math.floor(absNum);
    }

    updateZoomMode(isRegional) {
        if (isRegional) {
            this.zoomIndicator.innerText = "Региональное (Провинции)";
            this.zoomIndicator.style.color = "var(--ui-accent)";
        } else {
            this.zoomIndicator.innerText = "Глобальное (Страны)";
            this.zoomIndicator.style.color = "var(--ui-accent-country)";
        }
    }

    showCountryInfo(country, stats, gameData) {
        if (!country) return;
        this.badge.className = 'badge country';
        this.badge.innerText = 'СТАТИСТИКА СТРАНЫ';
        
        document.getElementById('panel-title').innerText = country.name;
        document.getElementById('panel-owner-wrap').style.display = 'none';
        
        document.getElementById('panel-pop').innerText = this.formatNumber(stats.population);
        document.getElementById('panel-oil').innerText = stats.oil;
        document.getElementById('panel-agro').innerText = stats.agro;
        document.getElementById('panel-ind').innerText = stats.industry;

        const container = document.getElementById('region-army-container');
        
        const powerHtml = `
        <div class="info-grid" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div class="info-box" style="grid-column: span 2; border-color: #ef4444; background: rgba(239, 68, 68, 0.1);">
                <div class="label" style="color: #fca5a5;">⚔️ Глобальная военная мощь</div>
                <div class="val" style="color: #ef4444; font-size: 1.5em;">${this.formatNumber(gameData.calculateMilitaryPower(country.id))}</div>
            </div>
        </div>`;

        let armyHtml = '<h3 style="font-size: 0.9em; color: #94a3b8; margin: 15px 0 5px 0; text-transform: uppercase;">Вооруженные силы (Всего):</h3>';
        let hasAnyTroops = false;
        armyHtml += '<div class="army-list">';
        
        Object.keys(UnitsDB).forEach(unitId => {
            const count = stats.army[unitId] || 0;
            if (count > 0) {
                hasAnyTroops = true;
                const unit = UnitsDB[unitId];
                armyHtml += `
                    <div class="army-list-item">
                        <span style="color:#cbd5e1; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:1.2em;">${unit.icon}</span> ${unit.name}
                        </span>
                        <span style="font-weight:bold; color:#fff; font-size:1.1em;">${this.formatNumber(count)}</span>
                    </div>`;
            }
        });
        armyHtml += '</div>';

        if (!hasAnyTroops) {
            armyHtml += '<div style="font-size: 0.85em; color: #64748b; margin-top: 5px;">Вооруженные силы отсутствуют</div>';
        }

        if(container) container.innerHTML = powerHtml + armyHtml;

        const actionBtns = document.getElementById('action-buttons-container');
        if (actionBtns) actionBtns.style.display = 'none';
        
        const armyPanel = document.getElementById('army-action-panel');
        if (armyPanel) armyPanel.style.display = 'none';

        this.panel.classList.add('active');
    }

    showRegionInfo(region, country, gameData, playerCountryId) {
        if (!region || !country) return;
        
        this.badge.className = 'badge region';
        this.badge.innerText = 'ДАННЫЕ ПРОВИНЦИИ';
        
        document.getElementById('panel-title').innerText = region.name;
        document.getElementById('panel-owner-wrap').style.display = 'block';
        document.getElementById('panel-owner').innerText = country.name;
        document.getElementById('panel-color').style.background = country.color;
        
        document.getElementById('panel-pop').innerText = this.formatNumber(region.population);
        document.getElementById('panel-oil').innerText = region.resources.oil;
        document.getElementById('panel-agro').innerText = region.resources.agro;
        document.getElementById('panel-ind').innerText = region.resources.industry;

		const armyContainer = document.getElementById('region-army-container');
        
        // --- ЛОГИКА ТУМАНА ВОЙНЫ И РАЗВЕДКИ ---
        const isOwner = region.owner === playerCountryId;
        const isNeighbor = gameData.isNeighborToPlayer(region.id);
        const isReconActive = region.reconActiveUntil && region.reconActiveUntil >= gameData.currentDate;
        
        // Задел под будущие технологии (если открыто, то у соседей видно всё сразу)
        const hasAdvancedReconTech = false; // gameData.getCountry(playerCountryId).tech['advanced_recon']
        
        // УРОВНИ ВИДИМОСТИ:
        // 1. Мощь видна: своим, соседям, или при активной разведке
        const canSeePower = isOwner || isNeighbor || isReconActive;
        
        // 2. Точный состав (Гарнизон) виден: своим, при активной разведке, или с технологией
        const canSeeGarrison = isOwner || isReconActive || (isNeighbor && hasAdvancedReconTech);

        let powerHtml = '';
        if (canSeePower) {
            powerHtml = `
            <div class="info-grid" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div class="info-box" style="grid-column: span 2; border-color: #ef4444; background: rgba(239, 68, 68, 0.1);">
                    <div class="label" style="color: #fca5a5;">⚔️ Военная мощь региона</div>
                    <div class="val" style="color: #ef4444; font-size: 1.5em;">${this.formatNumber(gameData.calculateRegionMilitaryPower(region.id))}</div>
                </div>
            </div>`;
        }

        let armyHtml = '<h3 style="font-size: 0.9em; color: #94a3b8; margin: 15px 0 5px 0; text-transform: uppercase;">Гарнизон:</h3>';

        if (!canSeeGarrison) {
            const targetPower = gameData.calculateRegionMilitaryPower(region.id);
            
            // ВЫЧИСЛЯЕМ ШАНС УСПЕХА РАЗВЕДКИ
            // Базовый шанс 95%. За каждую единицу мощи шанс падает (коэффициент 0.15).
            // То есть если мощь региона 200, шанс упадет на 30% (останется 65%).
            // Минимальный шанс всегда 15%, чтобы разведка вообще имела смысл.
            let successChance = Math.max(15, 95 - Math.floor(targetPower * 0.15));

            // Меняем иконку и текст в зависимости от того, приграничный это регион или глубокий тыл
            let fogMessage = canSeePower ? "Точный состав гарнизона неизвестен." : "Данные скрыты Туманом Войны.";
            let fogIcon = canSeePower ? "🕵️‍♂️" : "🌫️";

            armyHtml += `
                <div style="background: rgba(0,0,0,0.4); padding: 15px; border-radius: 8px; text-align: center; border: 1px dashed #475569; margin-top: 10px;">
                    <div style="font-size: 2em; margin-bottom: 5px;">${fogIcon}</div>
                    <div style="color: #94a3b8; font-size: 0.9em; margin-bottom: 10px;">${fogMessage}</div>
                    <div style="color: #fca5a5; font-size: 0.85em; margin-bottom: 10px; font-weight: bold;">
                        Вероятность успеха: ~${successChance}%
                    </div>
                    <button id="btn-recon" data-chance="${successChance}" style="background: #8b5cf6; color: white; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; transition: 0.2s;">
                        Отправить шпионов ($50k)
                    </button>
                </div>
            `;
        } else {
            // Отрисовываем реальные войска (как было раньше)
            let hasAnyTroops = false;
            armyHtml += '<div class="army-list">';
            Object.keys(UnitsDB).forEach(unitId => {
                const unit = UnitsDB[unitId];
				const count = (region.army && region.army[unitId]) ? region.army[unitId] : 0;
                
                if (count > 0 || isOwner) {
                    hasAnyTroops = true;
                    armyHtml += `
                        <div class="army-list-item">
                            <span style="color:#cbd5e1; display:flex; align-items:center; gap:8px;">
                                <span style="font-size:1.2em;">${unit.icon}</span> ${unit.name}
                            </span>
                            <span style="font-weight:bold; color:#fff; font-size:1.1em;">${this.formatNumber(count)}</span>
                        </div>`;
                }
            });
            armyHtml += '</div>';

            if (!hasAnyTroops) {
                armyHtml += '<div style="font-size: 0.85em; color: #64748b; margin-top: 5px;">Разведка не обнаружила войск</div>';
            }
        }
        
        if (armyContainer) armyContainer.innerHTML = powerHtml + armyHtml;

		const actionBtns = document.getElementById('action-buttons-container');
        if (actionBtns) actionBtns.style.display = 'block';

        const recruitBtn = document.getElementById('recruit-btn');
        if (recruitBtn) {
            const newRecruitBtn = recruitBtn.cloneNode(true);
            recruitBtn.parentNode.replaceChild(newRecruitBtn, recruitBtn);

            if (country.id === playerCountryId) {
                newRecruitBtn.style.display = 'block';
                newRecruitBtn.addEventListener('click', () => {
                    const recruitAmount = Math.max(1, Math.floor(region.population / 10000));
                    gameData.orders.recruitment.push({
                        regionId: region.id, amount: recruitAmount, text: `[Рекрутинг] ${region.name}: +${recruitAmount} батальонов`
                    });
                    this.updateOrdersPanel(gameData.orders);
                    newRecruitBtn.style.display = 'none'; 
                });
            } else {
                newRecruitBtn.style.display = 'none';
            }
        }

        const armyActionPanel = document.getElementById('army-action-panel');
        if (armyActionPanel) armyActionPanel.style.display = 'none';
        
        this.panel.classList.add('active');

		const spyBtn = document.getElementById('spy-btn');
        if (spyBtn) {
            // Проверяем, не отправляли ли мы уже шпионов сюда в этом ходу
            const isQueued = gameData.orders && gameData.orders.recon && gameData.orders.recon.some(o => o.target === region.id);
            
            if (isQueued) {
                spyBtn.innerText = "Разведка в плане";
                spyBtn.disabled = true;
                spyBtn.style.opacity = "0.5";
                spyBtn.style.cursor = "not-allowed";
            } else {
                spyBtn.onclick = () => {
                    const cost = 50000;
                    const prob = 95; // Шанс успеха
                    
                    if (gameData.queueRecon(region.id, cost, prob, region.name)) {
                        
                        // === ИСПРАВЛЕНО: Правильно обновляем счетчик денег в интерфейсе ===
                        document.getElementById('glob-money').innerText = this.formatNumber(gameData.getCountry(playerCountryId).money);
                        
                        this.updateOrdersPanel(gameData.orders);
                        
                        spyBtn.innerText = "Разведка в плане";
                        spyBtn.disabled = true;
                        spyBtn.style.opacity = "0.5";
                        spyBtn.style.cursor = "not-allowed";
                    } else {
                        alert('Недостаточно средств для проведения разведки (нужно $50K)!');
                    }
                };
            }
        }
    }

	updateOrdersPanel(orders) {
        const panel = document.getElementById('orders-panel');
        const list = document.getElementById('orders-list');
        if (!panel || !list) return;
        
        list.innerHTML = ''; 

        // Считаем общее количество приказов (добавили recon)
        const totalOrders = orders.recruitment.length + orders.attacks.length + orders.movements.length + (orders.recon ? orders.recon.length : 0);
        
        if (totalOrders === 0) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';

        const btnStyle = 'background: none; border: none; color: #ef4444; font-size: 1.5em; font-weight: bold; cursor: pointer; padding: 0 5px; line-height: 0.8;';
        const liStyle = 'margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;';

        // 1. Рекрутинг
        orders.recruitment.forEach((order, index) => { 
            list.innerHTML += `<li style="color: #60a5fa; ${liStyle}"><span>🛡️ ${order.text}</span> <button class="cancel-order-btn" data-type="recruitment" data-order-index="${index}" style="${btnStyle}">&times;</button></li>`; 
        });

        // 2. Разведка (ИСПРАВЛЕННЫЙ БЛОК)
		if (orders.recon && orders.recon.length > 0) {
            orders.recon.forEach((order, index) => {
                list.innerHTML += `<li style="color: #a855f7; ${liStyle}"><span>🕵️ Разведка: ${order.regionName}</span> <button class="cancel-order-btn" data-type="recon" data-order-index="${index}" style="${btnStyle}">&times;</button></li>`;
            });
        }
	
        // 3. Перемещения
        orders.movements.forEach((order, index) => { 
            list.innerHTML += `<li style="color: #c084fc; ${liStyle}"><span>🚚 ${order.text}</span> <button class="cancel-order-btn" data-type="movements" data-order-index="${index}" style="${btnStyle}">&times;</button></li>`; 
        });
        
        // 4. Атаки
        orders.attacks.forEach((order, index) => { 
            list.innerHTML += `<li style="color: #f87171; ${liStyle}"><span>⚔️ ${order.text}</span> <button class="cancel-order-btn" data-type="attacks" data-order-index="${index}" style="${btnStyle}">&times;</button></li>`; 
        });
    }


	closePanel() {
        if(this.panel) this.panel.classList.remove('active');
        document.dispatchEvent(new Event('panelClosed')); // <--- НОВАЯ СТРОКА
    }

    openGovPanel() { 
        const m = document.getElementById('gov-modal');
        if(m) m.classList.add('active'); 
    }
    closeGovPanel() { 
        const m = document.getElementById('gov-modal');
        if(m) m.classList.remove('active'); 
    }

    showTurnSummary(turnData) {
        this.closePanel(); 
        this.closeGovPanel(); 

        document.getElementById('summary-title').innerText = `Итоги на ${turnData.date}`;
        
        const netColor = turnData.financial.net >= 0 ? '#4ade80' : '#f87171';
        const netSign = turnData.financial.net >= 0 ? '+' : '';
        const finHtml = `
            <div>Доходы: <span style="color: #4ade80;">+$${this.formatNumber(turnData.financial.income)}</span></div>
            <div>Расходы: <span style="color: #f87171;">-$${this.formatNumber(turnData.financial.expense)}</span></div>
            <div style="margin-top: 5px; font-weight: bold; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 5px;">
                Сальдо: <span style="color: ${netColor};">${netSign}$${this.formatNumber(turnData.financial.net)}</span>
            </div>
        `;
        document.getElementById('summary-financial').innerHTML = finHtml;

        let logsHtml = '';
        if (turnData.logs.length === 0) {
            logsHtml = '<div style="color: #94a3b8; text-align: center; padding: 20px 0;">Войска оставались на позициях. Боестолкновений нет.</div>';
        } else {
            turnData.logs.forEach(log => {
                const color = log.success ? '#4ade80' : '#f87171';
                logsHtml += `
                    <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px; border-left: 3px solid ${color};">
                        <div style="color: ${color}; font-weight: bold;">${log.message}</div>`;
                
                if (log.losses) {
                    let attForcesStr = Object.keys(log.losses.initialAttacker).filter(id => log.losses.initialAttacker[id] > 0).map(id => `${log.losses.initialAttacker[id]} ${UnitsDB[id].name}`).join(', ') || 'Нет данных';
                    let attLossStr = Object.keys(log.losses.attacker).filter(id => log.losses.attacker[id] > 0).map(id => `-${log.losses.attacker[id]} ${UnitsDB[id].name}`).join(', ') || 'Без потерь';
                    let defLossStr = Object.keys(log.losses.defender).filter(id => log.losses.defender[id] > 0).map(id => `-${log.losses.defender[id]} ${UnitsDB[id].name}`).join(', ') || 'Без потерь';

                    logsHtml += `
                        <div style="font-size: 0.85em; color: #cbd5e1; margin-top: 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                            <div style="background: rgba(0,0,0,0.3); padding: 5px; border-radius: 4px;">
                                <b>Наши силы:</b> ${attForcesStr}<br><span style="color: #f87171;"><b>Потери:</b> ${attLossStr}</span>
                            </div>
                            <div style="background: rgba(0,0,0,0.3); padding: 5px; border-radius: 4px;">
                                <span style="color: #f87171;"><b>Потери врага:</b><br>${defLossStr}</span>
                            </div>
                        </div>`;
                }
                logsHtml += `</div>`;
            });
        }
        document.getElementById('summary-content').innerHTML = logsHtml;
        document.getElementById('summary-modal').style.display = 'flex';
    }

    showHistory(historyArray) {
        this.closePanel();
        this.closeGovPanel();
        
        const container = document.getElementById('history-content');
        container.innerHTML = '';

        if (historyArray.length === 0) {
            container.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 20px 0;">Журнал пуст.</div>';
        } else {
            historyArray.forEach(turn => {
                const netColor = turn.financial.net >= 0 ? '#4ade80' : '#f87171';
                const netSign = turn.financial.net >= 0 ? '+' : '';
                
                let block = `
                <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--ui-border); border-radius: 8px; padding: 15px;">
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 10px;">
                        <strong style="color: var(--ui-accent-country);">${turn.date}</strong>
                        <span style="font-weight: bold; color: ${netColor};">Сальдо: ${netSign}$${this.formatNumber(turn.financial.net)}</span>
                    </div>`;
                
                if (turn.logs.length === 0) {
                    block += `<div style="color: #94a3b8; font-size: 0.9em;">Событий не зафиксировано.</div>`;
                } else {
                    turn.logs.forEach(log => {
                        const logColor = log.success ? '#4ade80' : '#f87171';
                        block += `<div style="color: ${logColor}; font-size: 0.9em; margin-bottom: 4px;">• ${log.message}</div>`;
                    });
                }
                block += `</div>`;
                container.innerHTML += block;
            });
        }
        document.getElementById('history-modal').style.display = 'flex';
    }
}
