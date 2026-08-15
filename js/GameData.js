class GameData {
    constructor(playerCountryId = 'UA', cheatMode = false) {
        this.currentDate = new Date(2024, 0, 1);
        this.playerCountry = playerCountryId; 
        this.cheatMode = cheatMode; 

        this.generateEmptyArmy = () => {
            let army = {};
            Object.keys(UnitsDB).forEach(unitId => { army[unitId] = 0; });
            return army;
        };

        this.generateBaseTech = () => {
            let tech = { marchSpeed: 1 };
            Object.keys(UnitsDB).forEach(unitId => { tech[unitId] = 1; });
            return tech;
        };

        // Загружаем страны динамически из CountriesDB
        this.countries = {};
        Object.keys(CountriesDB).forEach(id => {
            const c = CountriesDB[id];
            this.countries[id] = {
                id: id,
                name: c.name,
                color: c.color,
                money: c.money,
                influence: c.influence,
                taxRate: c.taxRate,
                lastNetIncome: 0,
                army: this.generateEmptyArmy(),
                tech: this.generateBaseTech()
            };
        });

        this.regions = {};
        this.history = [];
        this.orders = { recruitment: [], attacks: [], movements: [], recon: [] };
    }

    buildDatabaseFromSVG() {
        // === СИСТЕМА СІТКИ: регіони будуються з RegionsDB ===
        // Оригінальні SVG country paths залишаються для відображення меж/кольорів країн
        // Клікабельні елементи — rect-клітинки сітки

        // 1. Налаштовуємо оригінальні country paths (тільки для відображення, не для кліків)
        const countryPaths = document.querySelectorAll('#world-map path');
        countryPaths.forEach(path => {
            if (!path.id) return;
            const cc = path.id.split('-')[0];
            if (this.countries[cc]) {
                path.setAttribute('data-country', cc);
                const country = this.countries[cc];
                if (country && country.color) {
                    path.style.fill = country.color;
                    path.style.fillOpacity = '1';
                }
                path.style.stroke = 'rgba(0,0,0,0.35)';
                path.style.strokeWidth = '0.2';
                path.style.pointerEvents = 'none'; // Клік йде на rect нижче
            } else {
                path.setAttribute('display', 'none');
            }
        });

        // 1.5 Создаем clipPath для каждой страны
        const svgEl = document.getElementById('world-map');
        let defs = svgEl.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svgEl.insertBefore(defs, svgEl.firstChild);
        }
        Object.keys(this.countries).forEach(cc => {
            const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            clip.setAttribute('id', `clip-${cc}`);
            const oldPaths = Array.from(svgEl.querySelectorAll(`.region[data-country="${cc}"]`));
            oldPaths.forEach(p => {
                const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                use.setAttribute('href', `#${p.id}`);
                clip.appendChild(use);
            });
            defs.appendChild(clip);
        });

        // 2. Створюємо SVG group для сіткових клітинок
        let gridGroup = document.getElementById('grid-regions');
        if (!gridGroup) {
            gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            gridGroup.setAttribute('id', 'grid-regions');
            // Вставляємо ПІСЛЯ country paths щоб сітку було видно ПОВЕРХ країн!
            svgEl.appendChild(gridGroup);
        }

        // 3. Будуємо регіони з RegionsDB
        Object.keys(RegionsDB).forEach(regionId => {
            const dbInfo = RegionsDB[regionId];
            const countryCode = regionId.split('-')[0];

            if (!this.countries[countryCode]) return;

            // Створюємо SVG path — клікабельна клітинка сітки
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('id', regionId);
            path.setAttribute('d', dbInfo.pathData);
            path.setAttribute('data-country', countryCode);
            path.setAttribute('fill', this.countries[countryCode].color || '#888');
            path.setAttribute('fill-opacity', '0.001');
            path.setAttribute('stroke', 'rgba(255,255,255,0.25)');
            path.setAttribute('stroke-width', '0.5'); 
            path.setAttribute('clip-path', `url(#clip-${countryCode})`);
            path.classList.add('region');

            gridGroup.appendChild(path);

            // Додаємо в базу регіонів
            this.regions[regionId] = {
                id: regionId,
                name: dbInfo.name,
                owner: countryCode,
                originalOwner: countryCode,
                population: dbInfo.population,
                loyalty: 1.0,
                army: this.generateEmptyArmy(),
                resources: { oil: dbInfo.oil, agro: dbInfo.agro, industry: dbInfo.industry }
            };
        });

        console.log(`Grid: ${Object.keys(this.regions).length} регіонів завантажено`);
        this.distributeArmiesToBorders();
    }

    // Визначає розмір клітинки для країни (синхронно з generate_grid.js)
    _getAdaptiveCellSize(countryCode) {
        const CELL_MAP = {
            'BH':1,'CY':1,'LU':1,'SG':1,'QA':1,'KW':1,'LB':1,
            'MD':2,'ME':2,'MK':2,'AL':2,'SI':2,'EE':2,'LV':2,'LT':2,
            'DK':2,'NL':2,'BE':2,'IE':2,'BT':2,'LK':2,'JO':2,'IL':2,
            'SY':2,'NP':2,'GE':2,'AM':2,'AZ':2,'KH':2,'LA':2,'TW':2,
            'KP':2,'KR':2,'SK':2,'BA':2,'HR':2,'HU':2,'AT':2,'CH':2,
            'CZ':2,'RS':2,'BG':2,'RO':2,'BY':2,'YE':2,'OM':2,
            'UA':3,'PL':3,'DE':3,'TR':3,'GB':3,'IT':3,'ES':3,'FR':3,
            'PT':3,'GR':3,'NO':3,'FI':3,'SE':3,'IS':3,'IQ':3,'AF':3,
            'PK':3,'MM':3,'TH':3,'VN':3,'MY':3,'PH':3,'JP':3,'BD':3,
            'UZ':3,'TM':3,'TJ':3,'KG':3,'IR':4,'SA':4,'IN':4,'ID':4,
            'MN':4,'CN':6,'RU':6,'KZ':6
        };
        return CELL_MAP[countryCode] || 3;
    }

    getCountry(id) { return this.countries[id]; }
    getRegion(id) { return this.regions[id]; }

    getCountryStats(countryId) {
        let stats = { population: 0, oil: 0, agro: 0, industry: 0, army: this.generateEmptyArmy() };
        const country = this.getCountry(countryId);
        
        if (country && country.army) {
            Object.keys(UnitsDB).forEach(unitId => {
                stats.army[unitId] += (country.army[unitId] || 0);
            });
        }

        Object.values(this.regions).forEach(region => {
            if (region.owner === countryId) {
                stats.population += region.population;
                stats.oil += region.resources.oil;
                stats.agro += region.resources.agro;
                stats.industry += region.resources.industry;
                
                Object.keys(UnitsDB).forEach(unitId => {
                    stats.army[unitId] += (region.army[unitId] || 0);
                });
            }
        });
        return stats;
    }

    calculateRegionMilitaryPower(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return 0;
        const country = this.getCountry(region.owner);
        if (!country) return 0;

        let power = 0;
        Object.keys(UnitsDB).forEach(unitId => {
            const count = region.army[unitId] || 0;
            if (count > 0) {
                const unit = UnitsDB[unitId];
                const techLevel = country.tech[unitId] || 1;
                const techMultiplier = 1 + (techLevel - 1) * 0.2; 
                power += count * (unit.baseAttack + unit.baseDefense) * techMultiplier;
            }
        });
        return Math.floor(power);
    }

    calculateMilitaryPower(countryId) {
        const country = this.getCountry(countryId);
        if (!country) return 0;
        
        let totalPower = 0;
        Object.keys(UnitsDB).forEach(unitId => {
            const count = country.army[unitId] || 0;
            if (count > 0) {
                const unit = UnitsDB[unitId];
                const techLevel = country.tech[unitId] || 1;
                const techMultiplier = 1 + (techLevel - 1) * 0.2;
                totalPower += count * (unit.baseAttack + unit.baseDefense) * techMultiplier;
            }
        });

        Object.values(this.regions).forEach(region => {
            if (region.owner === countryId) {
                totalPower += this.calculateRegionMilitaryPower(region.id);
            }
        });
        
        return Math.floor(totalPower);
    }

    getRecruitPotential(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return 0;
        
        let potential = Math.floor(region.population / 150000);
        const logisticsCap = Math.max(1, Math.floor(region.resources.industry / 5));
        let finalPotential = Math.min(potential, logisticsCap);

        return Math.max(1, finalPotential); 
    }

    saveTurnHistory(turnData) {
        this.history.unshift(turnData); 
        if (this.history.length > 10) { this.history.pop(); }
    }

    areNeighbors(regionId1, regionId2) {
        if (GeneratedNeighbors[regionId1]) {
            return GeneratedNeighbors[regionId1].includes(regionId2);
        }
        return false;
    }

    // Проверяет, граничит ли указанный регион с территорией игрока
    isNeighborToPlayer(regionId) {
        let isNeighbor = false;
        const neighbors = GeneratedNeighbors[regionId] || [];
        
        for (let i = 0; i < neighbors.length; i++) {
            const nReg = this.getRegion(neighbors[i]);
            // Если хотя бы один сосед принадлежит игроку — возвращаем true
            if (nReg && nReg.owner === this.playerCountry) {
                return true;
            }
        }
        return false;
    }

    getFriendlyDistance(startRegionId, targetRegionId, ownerId) {
        if (startRegionId === targetRegionId) return 0;
        let queue = [{ id: startRegionId, dist: 0 }];
        let visited = new Set([startRegionId]);

        while (queue.length > 0) {
            let current = queue.shift();
            if (current.id === targetRegionId) return current.dist;

            let neighbors = GeneratedNeighbors[current.id] || [];
            for (let nextId of neighbors) {
                let nextRegion = this.getRegion(nextId);
                if (!nextRegion || visited.has(nextId) || nextRegion.owner !== ownerId) continue;
                
                visited.add(nextId);
                queue.push({ id: nextId, dist: current.dist + 1 });
            }
        }
        return -1; 
    }

    getValidMoveTargets(startRegionId) {
        const region = this.getRegion(startRegionId);
        if (!region) return [];
        const country = this.getCountry(region.owner);
        if (!country) return [];
        
        const maxDist = country.tech.marchSpeed || 1;
        let validIds = [];
        Object.values(this.regions).forEach(r => {
            if (r.owner === country.id && r.id !== startRegionId) {
                let dist = this.getFriendlyDistance(startRegionId, r.id, country.id);
                if (dist !== -1 && dist <= maxDist) validIds.push(r.id);
            }
        });
        return validIds;
    }

    getValidAttackTargets(startRegionId) {
        const region = this.getRegion(startRegionId);
        if (!region) return [];
        const countryId = region.owner;
        let validIds = [];
        
        let neighbors = GeneratedNeighbors[startRegionId] || [];
        for (let nextId of neighbors) {
            let nextRegion = this.getRegion(nextId);
            if (nextRegion && nextRegion.owner !== countryId) {
                validIds.push(nextId);
            }
        }
        return validIds;
    }

    queueMovement(fromId, toId, forces) {
        const fromRegion = this.getRegion(fromId);
        const toRegion = this.getRegion(toId);
        if (!fromRegion || !toRegion) return;
        
        let forcesText = Object.keys(forces).filter(id => forces[id] > 0).map(id => `${forces[id]} ${UnitsDB[id].name}`).join(', ');
        this.orders.movements.push({ from: fromId, to: toId, forces: forces, text: `[Марш] ${fromRegion.name} ➔ ${toRegion.name} (${forcesText})` });
    }

    queueAttack(fromId, toId, forces) {
        const fromRegion = this.getRegion(fromId);
        const toRegion = this.getRegion(toId);
        if (!fromRegion || !toRegion) return;
        
        let forcesText = Object.keys(forces).filter(id => forces[id] > 0).map(id => `${forces[id]} ${UnitsDB[id].name}`).join(', ');
        this.orders.attacks.push({ from: fromId, to: toId, forces: forces, text: `[Атака] ${fromRegion.name} ➔ ${toRegion.name} (${forcesText})` });
    }

    queueRecon(targetId, cost, prob, regionName) {
        if (!this.orders.recon) this.orders.recon = [];
        
        // Блокируем двойную отправку шпионов в один и тот же регион за ход
        if (this.orders.recon.some(o => o.target === targetId)) return false;
        
        // ПРАВИЛЬНОЕ ОБРАЩЕНИЕ К КАЗНЕ ИГРОКА
        const player = this.getCountry(this.playerCountry);
        
        if (player.money >= cost) {
            player.money -= cost;
            this.orders.recon.push({ 
                target: targetId, 
                cost: cost, 
                prob: prob, 
                regionName: regionName 
            });
            return true;
        }
        return false;
    }

    processOrders() {
        let resultsLogs = [];

        // === 1. РАЗВЕДКА (Выполняется первой в начале хода) ===
        if (this.orders.recon && this.orders.recon.length > 0) {
            this.orders.recon.forEach(order => {
                const region = this.getRegion(order.target);
                if (region) {
                    const roll = Math.random() * 100;
                    if (roll <= order.prob) {
                        // УСПЕХ
                        let activeDate = new Date(this.currentDate);
                        activeDate.setMonth(activeDate.getMonth() + 1); 
                        region.reconActiveUntil = activeDate;
                        
                        resultsLogs.push({ 
                            success: true, 
                            message: `🕵️ Разведка: Шпионы успешно внедрились в ${region.name}. Данные о гарнизоне получены.` 
                        });
                    } else {
                        // ПРОВАЛ
                        resultsLogs.push({ 
                            success: false, 
                            message: `💥 Провал операции в ${region.name}. Шпионы были перехвачены контрразведкой.` 
                        });
                    }
                }
            });
            this.orders.recon = []; // Очищаем очередь разведки
        }

        // === 2. РЕКРУТИНГ ===
        this.orders.recruitment.forEach(order => {
            const region = this.getRegion(order.regionId);
            if (region) {
                region.army.infantry += order.amount; 
                resultsLogs.push({ success: true, message: `В ${region.name} набрано +${order.amount} пехоты.` });
            }
        });

        // === 3. ПЕРЕМЕЩЕНИЕ ВОЙСК ===
        this.orders.movements.forEach(order => {
            const fromRegion = this.getRegion(order.from);
            const toRegion = this.getRegion(order.to);

            if (fromRegion && toRegion && fromRegion.owner === toRegion.owner) {
                Object.keys(order.forces).forEach(unitId => {
                    const amountToMove = order.forces[unitId];
                    const actualAmount = Math.min(fromRegion.army[unitId] || 0, amountToMove);
                    fromRegion.army[unitId] -= actualAmount;
                    toRegion.army[unitId] += actualAmount;
                });
                resultsLogs.push({ success: true, message: order.text + " — Выполнено." });
            }
        });

        // === 4. АТАКИ ===
        this.orders.attacks.forEach(order => {
            const fromRegion = this.getRegion(order.from);
            const targetRegion = this.getRegion(order.to);
            if (!fromRegion || !targetRegion || targetRegion.owner === this.playerCountry) return;

            let actualForces = {};
            let hasTroops = false;
            let powerAtt = 0;

            Object.keys(UnitsDB).forEach(unitId => {
                const amount = Math.min(fromRegion.army[unitId] || 0, order.forces[unitId] || 0);
                actualForces[unitId] = amount;
                if (amount > 0) hasTroops = true;
                fromRegion.army[unitId] -= amount; 
                powerAtt += amount * UnitsDB[unitId].baseAttack;
            });

            if (!hasTroops) return;

            let powerDef = 1; 
            Object.keys(UnitsDB).forEach(unitId => {
                powerDef += (targetRegion.army[unitId] || 0) * UnitsDB[unitId].baseDefense;
            });

            const requiredAdvantage = 1.2; 
            let success = powerAtt >= powerDef * requiredAdvantage;
            let defLossPct = powerAtt > 0 ? Math.min(1, (powerAtt * 0.2) / powerDef) : 0;
            let attLossPct = powerDef > 1 ? Math.min(1, (powerDef * 0.1) / powerAtt) : 0;

            if (this.cheatMode && fromRegion.owner === this.playerCountry) {
                success = true;      
                attLossPct = 0;      
                defLossPct = 1;      
            }

            let attLosses = {};
            let defLosses = {};
            let survivingAtt = {};

            Object.keys(UnitsDB).forEach(unitId => {
                let defAmount = targetRegion.army[unitId] || 0;
                let defLoss = Math.min(defAmount, Math.ceil(defAmount * defLossPct));
                defLosses[unitId] = defLoss;
                targetRegion.army[unitId] -= defLoss;

                let attAmount = actualForces[unitId] || 0;
                let attLoss = Math.min(attAmount, Math.floor(attAmount * attLossPct));
                attLosses[unitId] = attLoss;
                survivingAtt[unitId] = attAmount - attLoss;
            });

            let msg = "";

            if (success) {
                targetRegion.owner = this.playerCountry;
                Object.keys(UnitsDB).forEach(unitId => targetRegion.army[unitId] = survivingAtt[unitId]);
                msg = `Наступление: ${fromRegion.name} ➔ ${targetRegion.name} успешно! Регион захвачен.`;
            } else {
                Object.keys(UnitsDB).forEach(unitId => fromRegion.army[unitId] += survivingAtt[unitId]);
                msg = `Наступление: ${fromRegion.name} ➔ ${targetRegion.name} захлебнулось.`;
            }

            resultsLogs.push({
                success: success, message: msg,
                losses: { attacker: { ...attLosses }, defender: { ...defLosses }, initialAttacker: { ...actualForces } }
            });
        });

        // Очищаем очереди приказов
        this.orders.recruitment = [];
        this.orders.movements = [];
        this.orders.attacks = [];

        return resultsLogs;
    }

    distributeArmiesToBorders() {
        const RealWorldForces = {
            'RU': { infantry: 132, tanks: 35, artillery: 60, aviation: 120, antiair: 40 },
            'UA': { infantry: 90,  tanks: 18, artillery: 30, aviation: 10,  antiair: 15 },
            'TR': { infantry: 42,  tanks: 22, artillery: 20, aviation: 60,  antiair: 15 },
            'PL': { infantry: 20,  tanks: 6,  artillery: 6,  aviation: 10,  antiair: 5 },
            'RO': { infantry: 7,   tanks: 3,  artillery: 4,  aviation: 6,   antiair: 3 },
            'BY': { infantry: 6,   tanks: 5,  artillery: 6,  aviation: 7,   antiair: 4 },
            'HU': { infantry: 4,   tanks: 1,  artillery: 1,  aviation: 1,   antiair: 1 },
            'BG': { infantry: 3,   tanks: 1,  artillery: 1,  aviation: 1,   antiair: 1 },
            'GE': { infantry: 3,   tanks: 1,  artillery: 1,  aviation: 1,   antiair: 1 },
            'SK': { infantry: 2,   tanks: 1,  artillery: 1,  aviation: 1,   antiair: 1 },
            'MD': { infantry: 1,   tanks: 0,  artillery: 1,  aviation: 0,   antiair: 0 },
            'IT': { infantry: 10,   tanks: 5,  artillery: 1,  aviation: 0,   antiair: 0 }
        };

        Object.keys(this.countries).forEach(countryId => {
            const forces = RealWorldForces[countryId] || { infantry: 1, tanks: 0, artillery: 0, aviation: 0, antiair: 0 };
            const myRegions = Object.values(this.regions).filter(r => r.owner === countryId);
            
            if (myRegions.length === 0) return;

            const borderRegions = myRegions.filter(region => {
                const neighbors = GeneratedNeighbors[region.id] || [];
                return neighbors.some(nId => {
                    const nReg = this.getRegion(nId);
                    return nReg && nReg.owner !== countryId;
                });
            });

            const targetRegions = borderRegions.length > 0 ? borderRegions : myRegions;
            const borderTotalPop = targetRegions.reduce((sum, r) => sum + r.population, 0);

            if (borderTotalPop === 0) return;

            Object.keys(forces).forEach(unitId => {
                const totalUnits = forces[unitId];
                if (totalUnits === 0) return;

                let unallocated = totalUnits;
                let remainders = [];
                
                targetRegions.forEach(region => {
                    const exactShare = totalUnits * (region.population / borderTotalPop);
                    const integerPart = Math.floor(exactShare);
                    const fractionalPart = exactShare - integerPart;
                    
                    region.army[unitId] = (region.army[unitId] || 0) + integerPart;
                    unallocated -= integerPart;
                    
                    remainders.push({ region: region, fraction: fractionalPart });
                });

                remainders.sort((a, b) => b.fraction - a.fraction);

                for (let i = 0; i < unallocated; i++) {
                    remainders[i].region.army[unitId] += 1;
                }
            });
        });
    }
}
