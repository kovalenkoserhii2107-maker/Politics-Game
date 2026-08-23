// =====================================================================
// МОДЕЛЬ МИРА: страны, области, приказы, разрешение хода
// =====================================================================
class GameData {
    constructor(playerCountryId, cheatMode = false) {
        this.currentDate = new Date(2024, 0, 1);
        this.playerCountry = playerCountryId;
        this.cheatMode = cheatMode;

        this.countries = {};
        this.regions = {};
        this.regionsByCountry = {};
        this.history = [];
        this.orders = { recruitment: [], attacks: [], movements: [], recon: [] };

        this.build();
    }

    emptyArmy() {
        const army = {};
        for (const unitId of Object.keys(UnitsDB)) army[unitId] = 0;
        return army;
    }

    baseTech() {
        const tech = { marchSpeed: 1 };
        for (const unitId of Object.keys(UnitsDB)) tech[unitId] = 1;
        return tech;
    }

    build() {
        for (const id of Object.keys(CountriesDB)) {
            const c = CountriesDB[id];
            this.countries[id] = {
                id,
                name: c.name,
                color: c.color,
                money: c.money,
                influence: c.influence,
                taxRate: c.taxRate,
                playable: c.playable,
                lastNetIncome: 0,
                army: this.emptyArmy(),
                tech: this.baseTech(),
            };
            this.regionsByCountry[id] = [];
        }

        for (const id of Object.keys(RegionsDB)) {
            const info = RegionsDB[id];
            if (!this.countries[info.cc]) continue;
            this.regions[id] = {
                id,
                name: info.name,
                owner: info.cc,
                originalOwner: info.cc,
                population: info.population,
                area: info.area,
                cx: info.cx,
                cy: info.cy,
                loyalty: 1.0,
                army: this.emptyArmy(),
                resources: { oil: info.oil, agro: info.agro, industry: info.industry },
            };
            this.regionsByCountry[info.cc].push(id);
        }

        this.distributeArmiesToBorders();
        this.setStartingBudgets();
    }

    // Стартовые налог и казна подбираются под уже расставленную армию, чтобы
    // страна не оказывалась банкротом на первом же ходу. Сама механика налога
    // не меняется — игрок по-прежнему двигает ползунок как хочет.
    setStartingBudgets() {
        const INDUSTRY_VALUE = 400;
        for (const country of Object.values(this.countries)) {
            const regions = this.getCountryRegions(country.id);
            if (!regions.length) continue;

            let population = 0, industry = 0, upkeep = 0;
            for (const region of regions) {
                population += region.population;
                industry += region.resources.industry * INDUSTRY_VALUE;
                for (const unitId of Object.keys(UnitsDB)) {
                    upkeep += (region.army[unitId] || 0) * UnitsDB[unitId].maintenanceCost;
                }
            }
            if (population <= 0) continue;

            const breakEven = (upkeep - industry) / population;
            country.taxRate = Math.min(0.20, Math.max(0.05, Math.ceil(breakEven * 100) / 100 + 0.01));
            const income = population * country.taxRate + industry;
            country.money = Math.max(2000000, Math.round(income * 3));
        }
    }

    getCountry(id) { return this.countries[id]; }
    getRegion(id) { return this.regions[id]; }
    getNeighbors(id) { return NeighborsDB[id] || []; }

    // Области страны — заранее сгруппированы, поэтому без перебора всего мира.
    getCountryRegions(countryId) {
        return (this.regionsByCountry[countryId] || []).map(id => this.regions[id]);
    }

    getCountryStats(countryId) {
        const stats = { population: 0, oil: 0, agro: 0, industry: 0, regions: 0, army: this.emptyArmy() };
        const country = this.getCountry(countryId);
        if (country) {
            for (const unitId of Object.keys(UnitsDB)) stats.army[unitId] += country.army[unitId] || 0;
        }
        for (const region of Object.values(this.regions)) {
            if (region.owner !== countryId) continue;
            stats.regions++;
            stats.population += region.population;
            stats.oil += region.resources.oil;
            stats.agro += region.resources.agro;
            stats.industry += region.resources.industry;
            for (const unitId of Object.keys(UnitsDB)) stats.army[unitId] += region.army[unitId] || 0;
        }
        return stats;
    }

    calculateRegionMilitaryPower(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return 0;
        const country = this.getCountry(region.owner);
        if (!country) return 0;

        let power = 0;
        for (const unitId of Object.keys(UnitsDB)) {
            const count = region.army[unitId] || 0;
            if (!count) continue;
            const unit = UnitsDB[unitId];
            const techMultiplier = 1 + ((country.tech[unitId] || 1) - 1) * 0.2;
            power += count * (unit.baseAttack + unit.baseDefense) * techMultiplier;
        }
        return Math.floor(power);
    }

    calculateMilitaryPower(countryId) {
        const country = this.getCountry(countryId);
        if (!country) return 0;

        let total = 0;
        for (const unitId of Object.keys(UnitsDB)) {
            const count = country.army[unitId] || 0;
            if (!count) continue;
            const unit = UnitsDB[unitId];
            const techMultiplier = 1 + ((country.tech[unitId] || 1) - 1) * 0.2;
            total += count * (unit.baseAttack + unit.baseDefense) * techMultiplier;
        }
        for (const region of Object.values(this.regions)) {
            if (region.owner === countryId) total += this.calculateRegionMilitaryPower(region.id);
        }
        return Math.floor(total);
    }

    getRecruitPotential(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return 0;
        const byPopulation = Math.floor(region.population / 150000);
        const byLogistics = Math.max(1, Math.floor(region.resources.industry / 5));
        return Math.max(1, Math.min(byPopulation, byLogistics));
    }

    saveTurnHistory(turnData) {
        this.history.unshift(turnData);
        if (this.history.length > 10) this.history.pop();
    }

    areNeighbors(a, b) { return this.getNeighbors(a).includes(b); }

    isNeighborToPlayer(regionId) {
        for (const id of this.getNeighbors(regionId)) {
            const region = this.regions[id];
            if (region && region.owner === this.playerCountry) return true;
        }
        return false;
    }

    // Обход в ширину с ограничением глубины: не перебирает весь мир,
    // а расходится от исходной области максимум на maxDist шагов.
    getValidMoveTargets(startRegionId) {
        const start = this.getRegion(startRegionId);
        if (!start) return [];
        const country = this.getCountry(start.owner);
        if (!country) return [];

        const maxDist = country.tech.marchSpeed || 1;
        const visited = new Set([startRegionId]);
        const targets = [];
        let frontier = [startRegionId];

        for (let depth = 0; depth < maxDist && frontier.length; depth++) {
            const next = [];
            for (const id of frontier) {
                for (const nextId of this.getNeighbors(id)) {
                    if (visited.has(nextId)) continue;
                    const region = this.regions[nextId];
                    if (!region || region.owner !== country.id) continue;
                    visited.add(nextId);
                    targets.push(nextId);
                    next.push(nextId);
                }
            }
            frontier = next;
        }
        return targets;
    }

    getValidAttackTargets(startRegionId) {
        const region = this.getRegion(startRegionId);
        if (!region) return [];
        const targets = [];
        for (const id of this.getNeighbors(startRegionId)) {
            const other = this.regions[id];
            if (other && other.owner !== region.owner) targets.push(id);
        }
        return targets;
    }

    describeForces(forces) {
        return Object.keys(forces)
            .filter(id => forces[id] > 0)
            .map(id => `${forces[id]} ${UnitsDB[id].name}`)
            .join(', ');
    }

    queueMovement(fromId, toId, forces) {
        const from = this.getRegion(fromId), to = this.getRegion(toId);
        if (!from || !to) return;
        this.orders.movements.push({
            from: fromId, to: toId, forces,
            text: `[Марш] ${from.name} ➔ ${to.name} (${this.describeForces(forces)})`,
        });
    }

    queueAttack(fromId, toId, forces) {
        const from = this.getRegion(fromId), to = this.getRegion(toId);
        if (!from || !to) return;
        this.orders.attacks.push({
            from: fromId, to: toId, forces,
            text: `[Атака] ${from.name} ➔ ${to.name} (${this.describeForces(forces)})`,
        });
    }

    queueRecruitment(regionId, amount) {
        const region = this.getRegion(regionId);
        if (!region) return false;
        this.orders.recruitment.push({
            regionId, amount,
            text: `[Рекрутинг] ${region.name}: +${amount} батальонов`,
        });
        return true;
    }

    queueRecon(targetId, cost, prob, regionName) {
        if (this.orders.recon.some(o => o.target === targetId)) return false;
        const player = this.getCountry(this.playerCountry);
        if (!player || player.money < cost) return false;
        player.money -= cost;
        this.orders.recon.push({ target: targetId, cost, prob, regionName });
        return true;
    }

    cancelOrder(type, index) {
        const list = this.orders[type];
        if (!list || index < 0 || index >= list.length) return null;
        const [order] = list.splice(index, 1);
        if (type === 'recon') {
            const player = this.getCountry(this.playerCountry);
            if (player) player.money += order.cost;
        }
        return order;
    }

    // Сколько войск в области ещё не расписано по приказам этого хода.
    getAvailableArmy(regionId) {
        const region = this.getRegion(regionId);
        if (!region) return {};
        const available = { ...region.army };
        for (const type of ['movements', 'attacks']) {
            for (const order of this.orders[type]) {
                if (order.from !== regionId) continue;
                for (const unitId of Object.keys(order.forces)) {
                    if (available[unitId] !== undefined) available[unitId] -= order.forces[unitId];
                }
            }
        }
        return available;
    }

    processOrders() {
        const logs = [];

        // 1. Разведка
        for (const order of this.orders.recon) {
            const region = this.getRegion(order.target);
            if (!region) continue;
            if (Math.random() * 100 <= order.prob) {
                const until = new Date(this.currentDate);
                until.setMonth(until.getMonth() + 1);
                region.reconActiveUntil = until;
                logs.push({ success: true, message: `🕵️ Разведка: шпионы внедрились в ${region.name}. Данные о гарнизоне получены.` });
            } else {
                logs.push({ success: false, message: `💥 Провал операции в ${region.name}. Шпионы перехвачены контрразведкой.` });
            }
        }
        this.orders.recon = [];

        // 2. Рекрутинг
        for (const order of this.orders.recruitment) {
            const region = this.getRegion(order.regionId);
            if (!region) continue;
            region.army.infantry += order.amount;
            logs.push({ success: true, message: `В ${region.name} набрано +${order.amount} пехоты.` });
        }

        // 3. Перемещения
        for (const order of this.orders.movements) {
            const from = this.getRegion(order.from), to = this.getRegion(order.to);
            if (!from || !to || from.owner !== to.owner) continue;
            for (const unitId of Object.keys(order.forces)) {
                const moved = Math.min(from.army[unitId] || 0, order.forces[unitId]);
                from.army[unitId] -= moved;
                to.army[unitId] += moved;
            }
            logs.push({ success: true, message: order.text + ' — выполнено.' });
        }

        // 4. Атаки
        for (const order of this.orders.attacks) {
            const result = this.resolveAttack(order);
            if (result) logs.push(result);
        }

        this.orders.recruitment = [];
        this.orders.movements = [];
        this.orders.attacks = [];
        return logs;
    }

    resolveAttack(order) {
        const from = this.getRegion(order.from);
        const target = this.getRegion(order.to);
        if (!from || !target || from.owner === target.owner) return null;

        const attacker = from.owner;
        const actualForces = {};
        let hasTroops = false;
        let powerAtt = 0;

        for (const unitId of Object.keys(UnitsDB)) {
            const amount = Math.min(from.army[unitId] || 0, order.forces[unitId] || 0);
            actualForces[unitId] = amount;
            if (amount > 0) hasTroops = true;
            from.army[unitId] -= amount;
            powerAtt += amount * UnitsDB[unitId].baseAttack;
        }
        if (!hasTroops) return null;

        let powerDef = 1;
        for (const unitId of Object.keys(UnitsDB)) {
            powerDef += (target.army[unitId] || 0) * UnitsDB[unitId].baseDefense;
        }

        let success = powerAtt >= powerDef * 1.2;
        let defLossPct = Math.min(1, (powerAtt * 0.2) / powerDef);
        let attLossPct = powerDef > 1 ? Math.min(1, (powerDef * 0.1) / powerAtt) : 0;

        if (this.cheatMode && attacker === this.playerCountry) {
            success = true;
            attLossPct = 0;
            defLossPct = 1;
        }

        const attLosses = {}, defLosses = {}, survivors = {};
        for (const unitId of Object.keys(UnitsDB)) {
            const defAmount = target.army[unitId] || 0;
            const defLoss = Math.min(defAmount, Math.ceil(defAmount * defLossPct));
            defLosses[unitId] = defLoss;
            target.army[unitId] -= defLoss;

            const attAmount = actualForces[unitId] || 0;
            const attLoss = Math.min(attAmount, Math.floor(attAmount * attLossPct));
            attLosses[unitId] = attLoss;
            survivors[unitId] = attAmount - attLoss;
        }

        let message;
        if (success) {
            target.owner = attacker;          // регион достаётся тому, кто атаковал
            target.loyalty = 0.5;
            for (const unitId of Object.keys(UnitsDB)) target.army[unitId] = survivors[unitId];
            message = `Наступление: ${from.name} ➔ ${target.name} успешно! Регион захвачен.`;
        } else {
            for (const unitId of Object.keys(UnitsDB)) from.army[unitId] += survivors[unitId];
            message = `Наступление: ${from.name} ➔ ${target.name} захлебнулось.`;
        }

        return {
            success,
            message,
            losses: { attacker: attLosses, defender: defLosses, initialAttacker: actualForces },
        };
    }

    distributeArmiesToBorders() {
        const RealWorldForces = {
            RU: { infantry: 132, tanks: 35, artillery: 60, aviation: 120, antiair: 40 },
            UA: { infantry: 90, tanks: 18, artillery: 30, aviation: 10, antiair: 15 },
            TR: { infantry: 42, tanks: 22, artillery: 20, aviation: 60, antiair: 15 },
            PL: { infantry: 20, tanks: 6, artillery: 6, aviation: 10, antiair: 5 },
            RO: { infantry: 7, tanks: 3, artillery: 4, aviation: 6, antiair: 3 },
            BY: { infantry: 6, tanks: 5, artillery: 6, aviation: 7, antiair: 4 },
            HU: { infantry: 4, tanks: 1, artillery: 1, aviation: 1, antiair: 1 },
            BG: { infantry: 3, tanks: 1, artillery: 1, aviation: 1, antiair: 1 },
            GE: { infantry: 3, tanks: 1, artillery: 1, aviation: 1, antiair: 1 },
            SK: { infantry: 2, tanks: 1, artillery: 1, aviation: 1, antiair: 1 },
            MD: { infantry: 1, tanks: 0, artillery: 1, aviation: 0, antiair: 0 },
            IT: { infantry: 10, tanks: 5, artillery: 1, aviation: 0, antiair: 0 },
            DE: { infantry: 18, tanks: 6, artillery: 5, aviation: 12, antiair: 6 },
            FR: { infantry: 20, tanks: 6, artillery: 5, aviation: 14, antiair: 6 },
            NO: { infantry: 5, tanks: 1, artillery: 1, aviation: 3, antiair: 2 },
            KZ: { infantry: 8, tanks: 3, artillery: 3, aviation: 3, antiair: 3 },
        };

        for (const countryId of Object.keys(this.countries)) {
            const forces = RealWorldForces[countryId] || { infantry: 1, tanks: 0, artillery: 0, aviation: 0, antiair: 0 };
            const myRegions = this.getCountryRegions(countryId);
            if (!myRegions.length) continue;

            const borderRegions = myRegions.filter(region =>
                this.getNeighbors(region.id).some(id => {
                    const other = this.regions[id];
                    return other && other.owner !== countryId;
                }));

            const targets = borderRegions.length ? borderRegions : myRegions;
            const totalPop = targets.reduce((sum, r) => sum + r.population, 0);
            if (!totalPop) continue;

            for (const unitId of Object.keys(forces)) {
                const total = forces[unitId];
                if (!total) continue;

                let allocated = 0;
                const remainders = [];
                for (const region of targets) {
                    const exact = total * (region.population / totalPop);
                    const whole = Math.floor(exact);
                    region.army[unitId] = (region.army[unitId] || 0) + whole;
                    allocated += whole;
                    remainders.push({ region, fraction: exact - whole });
                }
                remainders.sort((a, b) => b.fraction - a.fraction);
                for (let i = 0; i < total - allocated && i < remainders.length; i++) {
                    remainders[i].region.army[unitId] += 1;
                }
            }
        }
    }
}
