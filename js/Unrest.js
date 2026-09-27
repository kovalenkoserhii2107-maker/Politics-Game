// =====================================================================
// НЕДОВОЛЬСТВО, ВОССТАНИЯ И ГРАЖДАНСКАЯ ВОЙНА
//
// Когда лояльность области держится ниже порога (высокие налоги, голод,
// оккупация, жёсткие решения), копится недовольство. Дошло до 100% —
// вспыхивает восстание: область не платит налоги, у мятежников растёт
// сила, через несколько ходов область отделяется и уходит к соседу, у
// которого мятежники попросили помощи (прежнему хозяину, если область
// захвачена, иначе — сопернику). Сосед-человек сам решает, принять ли её.
// Столица не отделяется: восстание там кончается переворотом.
//
// Остановить восстание можно силой (гарнизон против мятежников) или
// уступками (деньги — и лояльность возвращается). Два восстания и больше
// в одной стране — гражданская война: налоги по всей стране падают.
// =====================================================================
const REVOLT = {
    THRESHOLD: 0.45,        // ниже этой лояльности копится недовольство
    RATE: 0.6,              // сколько недовольства даёт каждый пункт ниже порога
    BASE: 0.05,             // и сколько — сам факт, что лояльность ниже порога
    CALM: 0.1,              // на сколько недовольство спадает за ход, когда всё в порядке
    WARN: 0.5,              // с этого уровня игрока предупреждают
    TURNS: 3,               // ходов от вспышки до отделения
    STRENGTH: 3,            // сила мятежников — столько ополчений области
    GROWTH: 0.25,           // и на столько она растёт каждый ход восстания
    APPEASE_WEEKS: 4,       // уступки стоят столько недельных налогов области
    CIVIL_WAR: 2,           // столько восстаний в стране — гражданская война
    CIVIL_TAX: 0.85,        // налоги в стране во время гражданской войны
    CIVIL_STRENGTH: 1.3,    // и насколько сильнее мятежники
    SECEDE_RELATION: -20,
};

class Unrest {
    static init(d) {
        d.revolts = d.revolts || {};
    }

    static revoltsOf(d, cc) {
        return Object.keys(d.revolts || {}).filter(id => d.regions[id] && d.regions[id].owner === cc);
    }

    static civilWar(d, cc) {
        return Unrest.revoltsOf(d, cc).length >= REVOLT.CIVIL_WAR;
    }

    // Налоги области за ход — мера уступок.
    static regionTax(d, region) {
        const c = d.countries[region.owner];
        return region.population * c.taxRate * Math.max(0.3, region.loyalty) * Economy.cycle(d).tax;
    }

    static appeaseCost(d, regionId) {
        const region = d.regions[regionId];
        return Math.round(Math.max(1e6, Unrest.regionTax(d, region) * REVOLT.APPEASE_WEEKS) / 1e5) * 1e5;
    }

    static rebelStrength(d, regionId) {
        const region = d.regions[regionId], revolt = d.revolts[regionId];
        if (!region || !revolt) return 0;
        const civil = Unrest.civilWar(d, region.owner) ? REVOLT.CIVIL_STRENGTH : 1;
        return Math.round(d.militia(region) * REVOLT.STRENGTH * (1 + REVOLT.GROWTH * revolt.age) * civil);
    }

    static garrisonStrength(d, regionId) {
        const region = d.regions[regionId];
        return Math.round(d.sidePower(region.army, region.owner, 'baseDefense', {}));
    }

    // К кому мятежники просятся: прежний хозяин захваченной области, иначе
    // сосед — воюющий с хозяином, с плохими отношениями, посильнее.
    static pickSponsor(d, regionId, exclude = []) {
        const region = d.regions[regionId], owner = region.owner;
        const ok = cc => cc && cc !== owner && !exclude.includes(cc) && d.countries[cc] && d.countries[cc].alive && d.countries[cc].playable && d.regionsByCountry[cc].length;
        if (region.originalOwner !== owner && ok(region.originalOwner)) return region.originalOwner;
        const around = [...new Set(d.getNeighbors(regionId).map(id => d.regions[id] && d.regions[id].owner))].filter(ok);
        if (!around.length) return null;
        const score = cc => (d.isAtWar(cc, owner) ? 200 : 0) - Diplomacy.relation(d, cc, owner) + Math.sqrt(d.calculateMilitaryPower(cc));
        return around.sort((a, b) => score(b) - score(a))[0];
    }

    // --- конец хода -------------------------------------------------------
    static update(d, events) {
        Unrest.init(d);
        const tell = (cc, message, type = 'unrest') => { if (d.isHuman(cc)) events.push({ type, for: cc, message }); };
        const civilBefore = {};
        for (const cc of d.humans) civilBefore[cc] = Unrest.civilWar(d, cc);

        // идущие восстания: растут, а срок вышел — область уходит
        for (const [id, revolt] of Object.entries({ ...d.revolts })) {
            const region = d.regions[id];
            if (!region || region.owner !== revolt.owner) { delete d.revolts[id]; continue; }
            revolt.age++;
            revolt.left--;
            if (revolt.left > 0) {
                tell(region.owner, `🔥 Восстание в области ${region.name}: до отделения ${revolt.left} ход. Подавите его или пойдите на уступки.`);
                continue;
            }
            Unrest.secede(d, id, events);
        }

        for (const region of Object.values(d.regions)) {
            if (d.revolts[region.id]) continue;
            const country = d.countries[region.owner];
            if (!country || !country.playable) { region.unrest = 0; continue; }
            const before = region.unrest || 0;
            if (region.loyalty < REVOLT.THRESHOLD) region.unrest = before + (REVOLT.THRESHOLD - region.loyalty) * REVOLT.RATE + REVOLT.BASE;
            else region.unrest = Math.max(0, before - REVOLT.CALM);
            region.unrest = Math.round(Math.min(1, region.unrest) * 100) / 100;
            if (region.unrest >= 1) Unrest.start(d, region.id, events);
            else if (before < REVOLT.WARN && region.unrest >= REVOLT.WARN) {
                tell(region.owner, `⚠️ В области ${region.name} зреет восстание: недовольство ${Math.round(region.unrest * 100)}%, лояльность ${Math.round(region.loyalty * 100)}%. Снизьте налоги или помогите области.`);
            }
        }

        for (const cc of d.humans) {
            if (!civilBefore[cc] && Unrest.civilWar(d, cc)) tell(cc, `🔥 Гражданская война! Восстаний: ${Unrest.revoltsOf(d, cc).length}. Налоги по стране −${Math.round((1 - REVOLT.CIVIL_TAX) * 100)}%, мятежники сильнее.`, 'civil-war');
        }
    }

    static start(d, regionId, events) {
        const region = d.regions[regionId];
        const sponsor = Unrest.pickSponsor(d, regionId);
        d.revolts[regionId] = { owner: region.owner, left: REVOLT.TURNS, age: 0, sponsor, accepted: false };
        region.unrest = 1;
        const owner = d.countries[region.owner];
        const helper = sponsor ? ` Мятежники просят помощи: ${d.countries[sponsor].name}.` : '';
        if (d.isHuman(region.owner)) events.push({ type: 'revolt', for: region.owner, message: `🔥 Восстание в области ${region.name}! Она не платит налоги и через ${REVOLT.TURNS} хода отделится.${helper}` });
        // сосед-человек решает сам, принять ли область
        if (sponsor && d.isHuman(sponsor)) {
            d.seatOf(sponsor).decisions.push({ type: 'rebels', from: region.owner, region: regionId });
            events.push({ type: 'revolt', for: sponsor, message: `🔥 В области ${region.name} (${owner.name}) восстание — мятежники просят принять их в вашу страну.` });
        }
    }

    // Мятежники победили: область уходит к соседу, гарнизон отходит.
    static secede(d, regionId, events) {
        const region = d.regions[regionId], revolt = d.revolts[regionId];
        delete d.revolts[regionId];
        const owner = region.owner;
        let sponsor = revolt.sponsor;
        // человек должен согласиться; ИИ соглашается, если не дружит с хозяином
        const agrees = cc => cc && d.countries[cc].alive && (d.isHuman(cc) ? revolt.accepted
            : !Diplomacy.isAllied(d, cc, owner) && Diplomacy.relation(d, cc, owner) < 50);
        // люди, не согласившиеся принять область, не получат её и запасным путём
        if (!agrees(sponsor)) sponsor = Unrest.pickSponsor(d, regionId, [revolt.sponsor, ...d.humans]);
        if (!agrees(sponsor)) sponsor = null;
        const tell = (cc, message) => { if (d.isHuman(cc)) events.push({ type: 'secession', for: cc, message }); };
        // столица не отделяется — там меняется власть: переворот
        if (d.countries[owner].capital === regionId) {
            const c = d.countries[owner];
            for (const unitId of Object.keys(UnitsDB)) region.army[unitId] = Math.floor(region.army[unitId] / 2);
            c.money = Math.round(c.money * 0.75);
            c.influence = 0;
            c.taxRate = 0.1;
            for (const r of d.getCountryRegions(owner)) r.loyalty = Math.min(1, Math.max(r.loyalty, 0.45) + 0.1);
            region.unrest = 0.2;
            tell(owner, `🏛️ Переворот в столице ${region.name}! Правительство потеряло влияние и четверть казны, налог снижен до 10%, половина гарнизона разбежалась.`);
            if (!d.isHuman(owner)) events.push({ type: 'world-coup', message: `🏛️ Переворот: ${c.name} сменила правительство.` });
            return;
        }
        if (!sponsor) {
            // уйти некуда: область остаётся, но гарнизон разбежался
            region.army = d.emptyArmy();
            region.loyalty = Math.max(region.loyalty, 0.5);
            region.unrest = 0.3;
            tell(owner, `🔥 Область ${region.name}: мятежники разогнали гарнизон и получили автономию. Лояльность восстановлена до 50%.`);
            return;
        }
        const home = d.getNeighbors(regionId).map(id => d.regions[id]).find(r => r && r.owner === owner);
        if (home) for (const unitId of Object.keys(UnitsDB)) home.army[unitId] += Math.floor(region.army[unitId] / 2);
        region.army = d.emptyArmy();
        const wasCapital = d.countries[owner].capital === regionId;
        d.setOwner(regionId, sponsor);
        region.loyalty = 0.7;
        region.unrest = 0;
        if (wasCapital) d.onCapitalLost(owner);
        Diplomacy.changeRelation(d, owner, sponsor, REVOLT.SECEDE_RELATION);
        const name = d.countries[sponsor].name;
        tell(owner, `💔 Область ${region.name} отделилась и перешла под флаг: ${name}. Вернуть её можно только силой или договорившись.`);
        tell(sponsor, `🗺️ Восставшая область ${region.name} присоединилась к вам.`);
        if (!d.isHuman(owner) && !d.isHuman(sponsor)) events.push({ type: 'world-secession', message: `🔥 Область ${region.name} отделилась (${d.countries[owner].name}) и перешла под флаг: ${name}.` });
    }

    // --- действия хозяина -------------------------------------------------
    static suppress(d, regionId, countryId) {
        const region = d.regions[regionId], revolt = d.revolts[regionId];
        if (!region || !revolt || region.owner !== countryId) return { ok: false, reason: 'Здесь нет восстания' };
        if (revolt.triedTurn === d.turn) return { ok: false, reason: 'В этот ход уже пытались' };
        revolt.triedTurn = d.turn;
        const ours = Unrest.garrisonStrength(d, regionId), theirs = Unrest.rebelStrength(d, regionId);
        const loss = share => { for (const u of Object.keys(UnitsDB)) region.army[u] -= Math.ceil(region.army[u] * share); };
        if (ours >= theirs) {
            loss(0.15);
            delete d.revolts[regionId];
            region.unrest = 0.4;
            region.loyalty = Math.min(1, region.loyalty + 0.1);
            region.population = Math.round(region.population * 0.99);
            return { ok: true, won: true, ours, theirs };
        }
        loss(0.3);
        region.loyalty = Math.max(0.2, region.loyalty - 0.05);
        return { ok: true, won: false, ours, theirs };
    }

    static appease(d, regionId, countryId) {
        const region = d.regions[regionId], revolt = d.revolts[regionId];
        if (!region || !revolt || region.owner !== countryId) return { ok: false, reason: 'Здесь нет восстания' };
        const cost = Unrest.appeaseCost(d, regionId), c = d.countries[countryId];
        if (c.money < cost) return { ok: false, reason: `Нужно ${Math.round(cost / 1e5) / 10}M` };
        c.money -= cost;
        delete d.revolts[regionId];
        region.unrest = 0.2;
        region.loyalty = Math.max(region.loyalty, 0.6);
        return { ok: true, cost };
    }

    static serialize(d) {
        return structuredClone(d.revolts || {});
    }

    static valid(revolts) {
        if (!revolts || typeof revolts !== 'object') return false;
        return Object.entries(revolts).every(([id, r]) => RegionsDB[id] && r && CountriesDB[r.owner]
            && Number.isInteger(r.left) && Number.isInteger(r.age) && (r.sponsor === null || CountriesDB[r.sponsor]) && typeof r.accepted === 'boolean');
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Unrest, REVOLT };
