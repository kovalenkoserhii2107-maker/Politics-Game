// =====================================================================
// ВОЕННЫЙ ФЛОТ: верфи, эскадры в морях, морской бой, блокады
//
// Море поделено на зоны (js/data/SeasDB.js, строит tools/build_map.js):
// у каждой прибрежной области — одно-три моря, у моря — соседние моря;
// на некоторых переходах стоят проливы (js/Shipping.js).
//
// Корабли строятся на верфи порта: одна стройка на порт, класс корабля
// ограничен уровнем порта, объём заказа — корпусами (уровень × HULLS_PER_LEVEL).
// Готовые корабли выходят в выбранное море порта.
//
// Эскадра — корабли страны в одном море. За ход идёт в соседнее море; через
// пролив — если он для неё открыт (хозяину — всегда). Если в море
// встретились воюющие страны — бой: урон по защите, у подлодок бонус против
// надводных кораблей, пока у тех мало противолодочных сил. Слабая сторона
// после боя отходит.
//
// Контроль моря — у кого там сильнее флот. Прибрежная область блокирована,
// если во всех её морях враг сильнее флота хозяина и союзников: порт стоит,
// морская торговля страны падает по доле блокированного берега. Флот у
// берега поддерживает наступление на прибрежную область (обстрел).
// =====================================================================
const SHIPS = {
    patrol:    { name: 'Патрульный катер', icon: '🚤', attack: 2, defense: 3, asw: 1, shore: 0, cost: 80e3, upkeep: 15e3, turns: 1, port: 1, hull: 1 },
    corvette:  { name: 'Корвет', icon: '🛥️', attack: 4, defense: 5, asw: 5, shore: 1, cost: 250e3, upkeep: 45e3, turns: 2, port: 1, hull: 2 },
    frigate:   { name: 'Фрегат', icon: '🚢', attack: 7, defense: 9, asw: 7, shore: 2, cost: 600e3, upkeep: 100e3, turns: 3, port: 2, hull: 3 },
    sub:       { name: 'Подводная лодка', icon: '🦈', attack: 11, defense: 4, asw: 3, shore: 0, cost: 700e3, upkeep: 110e3, turns: 3, port: 2, hull: 3, tech: 'submarines', sub: true },
    destroyer: { name: 'Эсминец', icon: '🛳️', attack: 12, defense: 13, asw: 5, shore: 4, cost: 1.4e6, upkeep: 230e3, turns: 4, port: 3, hull: 5 },
};

const NAVY = {
    SPEED: 2,               // морей за ход
    HULLS_PER_LEVEL: 4,     // корпусов в одном заказе за уровень порта
    SUB_BONUS: 0.5,         // подлодка против надводных без прикрытия: +50%
    SUB_HUNT: 6,            // сколько противолодочных очков «закрывают» одну подлодку
    LOSS: 0.45,             // доля урона, переходящая в потери
    RETREAT: 0.5,           // после боя отходит сторона слабее этой доли соперника
    BLOCKADE_MIN: 8,        // чтобы блокировать, флот должен быть хоть сколько-то заметным
    BLOCKADE_TRADE: 0.5,    // блокирован весь берег — морская торговля вдвое меньше
    SHORE_PER: 0.01,        // обстрел: +1% к удару за очко огня с моря
    SHORE_MAX: 0.25,
    AI_SHARE: 0.12,         // ИИ держит флот такой доли силы армии (× характер; на войне — вдвое)
};

class Navy {
    static init(d) { d.navy = {}; d.shipyard = []; d.navalOrders = []; d.blockSeen = {}; }

    static emptyFleet() { return Object.fromEntries(Object.keys(SHIPS).map(k => [k, 0])); }

    // --- моря -------------------------------------------------------------
    static zones() { return (typeof SeasDB !== 'undefined' && SeasDB.zones) || {}; }
    static seasOf(regionId) { return (typeof SeasDB !== 'undefined' && SeasDB.coast[regionId]?.seas) || []; }

    // Куда эскадра дойдёт за ход: до SPEED морей, через открытые проливы.
    static reachable(d, cc, from) {
        const out = new Set();
        let frontier = [from];
        const seen = new Set([from]);
        for (let step = 0; step < NAVY.SPEED; step++) {
            const next = [];
            for (const z of frontier) for (const n of Navy.zones()[z]?.adj || []) {
                if (seen.has(n) || !Navy.canPass(d, cc, z, n)) continue;
                seen.add(n); out.add(n); next.push(n);
            }
            frontier = next;
        }
        return out;
    }
    static strait(a, b) { return (typeof SeasDB !== 'undefined' && SeasDB.straits[[a, b].sort().join('|')]) || null; }

    // Можно ли эскадре страны cc пройти из a в b за ход.
    static canPass(d, cc, a, b) {
        const zone = Navy.zones()[a];
        if (!zone || !zone.adj.includes(b)) return false;
        const s = Navy.strait(a, b);
        return !s || !Shipping.passage(d, s, cc).blocked;
    }

    // --- силы ----------------------------------------------------------------
    static fleet(d, zone, cc) { return (d.navy[zone] && d.navy[zone][cc]) || null; }

    static fleets(d, cc) {
        const out = [];
        for (const [zone, byCc] of Object.entries(d.navy)) if (byCc[cc]) out.push({ zone, cc, ships: byCc[cc] });
        return out;
    }

    static count(ships) { return Object.values(ships || {}).reduce((a, n) => a + n, 0); }

    static power(ships) {
        let p = 0;
        for (const [k, n] of Object.entries(ships || {})) if (SHIPS[k]) p += n * (SHIPS[k].attack + SHIPS[k].defense) / 2;
        return Math.round(p);
    }

    static totalPower(d, cc) { return Navy.fleets(d, cc).reduce((s, f) => s + Navy.power(f.ships), 0); }

    static upkeep(d, cc) {
        let sum = 0;
        for (const f of Navy.fleets(d, cc)) for (const [k, n] of Object.entries(f.ships)) sum += n * SHIPS[k].upkeep;
        return sum;
    }

    // Сила стороны в море: страна с союзниками.
    static sidePower(d, zone, cc) {
        let p = 0;
        for (const [x, ships] of Object.entries(d.navy[zone] || {})) if (x === cc || Diplomacy.isAllied(d, x, cc)) p += Navy.power(ships);
        return p;
    }

    // Самый сильный враг страны cc в море (с учётом его союзников).
    static enemyPower(d, zone, cc) {
        let best = 0;
        for (const x of Object.keys(d.navy[zone] || {})) if (d.isAtWar(x, cc)) best = Math.max(best, Navy.sidePower(d, zone, x));
        return best;
    }

    // Кто держит море: страна с самым сильным флотом.
    static controller(d, zone) {
        let best = null, bp = 0;
        for (const [x, ships] of Object.entries(d.navy[zone] || {})) { const p = Navy.power(ships); if (p > bp) { bp = p; best = x; } }
        return best;
    }

    // --- блокада --------------------------------------------------------------
    static blockaded(d, region) {
        const seas = Navy.seasOf(region.id);
        if (!seas.length || !d.enemiesOf(region.owner).length) return false;
        return seas.every(z => { const e = Navy.enemyPower(d, z, region.owner); return e >= NAVY.BLOCKADE_MIN && e > Navy.sidePower(d, z, region.owner); });
    }

    // Доля берега страны под блокадой (по длине берега).
    static blockadeShare(d, cc) {
        // блокада бывает только на войне — мирным странам и считать нечего
        if (!d.enemiesOf(cc).length) return 0;
        let all = 0, shut = 0;
        for (const r of d.getCountryRegions(cc)) {
            const km = Navy.seasOf(r.id).length ? (RegionsDB[r.id]?.coast || 0) : 0;
            if (!km) continue;
            all += km;
            if (Navy.blockaded(d, r)) shut += km;
        }
        return all ? shut / all : 0;
    }

    static tradeFactor(d, cc) { return 1 - NAVY.BLOCKADE_TRADE * Navy.blockadeShare(d, cc); }

    // Огонь с моря по прибрежной области: флот нападающих в её морях, если
    // там он не слабее флота обороны. Бонус к удару.
    static shoreBonus(d, region, attackers) {
        let fire = 0;
        for (const z of Navy.seasOf(region.id)) {
            const def = Navy.sidePower(d, z, region.owner);
            for (const cc of attackers) {
                const ships = Navy.fleet(d, z, cc);
                if (!ships || Navy.power(ships) < def) continue;
                for (const [k, n] of Object.entries(ships)) fire += n * SHIPS[k].shore;
            }
        }
        return Math.min(NAVY.SHORE_MAX, fire * NAVY.SHORE_PER);
    }

    // --- верфь -----------------------------------------------------------------
    static yardOf(d, regionId) { return d.shipyard.find(o => o.region === regionId) || null; }

    // Что можно заказать в порту: класс по уровню порта и технологиям.
    static buildable(d, regionId, type) {
        const region = d.regions[regionId], ship = SHIPS[type];
        if (!region || !ship) return { ok: false, reason: 'Нельзя' };
        const level = region.development.port || 0;
        if (!level || !Navy.seasOf(regionId).length) return { ok: false, reason: 'Нужен порт' };
        if (level < ship.port) return { ok: false, reason: `Нужен порт ${ship.port}-го уровня` };
        if (ship.tech && !Tech.has(d.countries[region.owner], ship.tech)) return { ok: false, reason: `Сначала исследуйте: ${TECH_TREE[ship.tech].name}` };
        if (Navy.yardOf(d, regionId)) return { ok: false, reason: 'Верфь занята' };
        return { ok: true, max: Math.max(1, Math.floor(level * NAVY.HULLS_PER_LEVEL / ship.hull)) };
    }

    static build(d, cc, regionId, type, n, zone) {
        const region = d.regions[regionId];
        if (d.gameOver || !region || region.owner !== cc) return { ok: false, reason: 'Нельзя' };
        const can = Navy.buildable(d, regionId, type);
        if (!can.ok) return can;
        if (!Number.isSafeInteger(n) || n < 1 || n > can.max) return { ok: false, reason: `За один заказ — до ${can.max}` };
        const seas = Navy.seasOf(regionId);
        zone = seas.includes(zone) ? zone : seas[0];
        const cost = SHIPS[type].cost * n;
        const c = d.countries[cc];
        if (c.money < cost) return { ok: false, reason: 'Недостаточно средств' };
        c.money -= cost;
        d.shipyard.push({ cc, region: regionId, type, n, left: SHIPS[type].turns, cost, zone });
        return { ok: true, cost, turns: SHIPS[type].turns };
    }

    static cancelBuild(d, cc, regionId) {
        const i = d.shipyard.findIndex(o => o.region === regionId && o.cc === cc);
        if (i < 0) return { ok: false, reason: 'Нечего отменять' };
        const [o] = d.shipyard.splice(i, 1);
        d.countries[cc].money += o.cost;
        return { ok: true, refund: o.cost };
    }

    // --- приказы ---------------------------------------------------------------
    static move(d, cc, from, to, ships) {
        const fleet = Navy.fleet(d, from, cc);
        if (d.gameOver || !fleet) return { ok: false, reason: 'Здесь нет вашего флота' };
        if (!Navy.reachable(d, cc, from).has(to)) return { ok: false, reason: `Туда не дойти за ход: до ${NAVY.SPEED} морей, через открытые проливы` };
        const busy = Navy.ordered(d, cc, from);
        const sending = {};
        let total = 0;
        for (const [k, n] of Object.entries(ships || {})) {
            if (!SHIPS[k] || !Number.isSafeInteger(n) || n < 0 || n > (fleet[k] || 0) - (busy[k] || 0)) return { ok: false, reason: 'Столько кораблей нет' };
            if (n) { sending[k] = n; total += n; }
        }
        if (!total) return { ok: false, reason: 'Выберите корабли' };
        d.navalOrders.push({ cc, from, to, ships: sending });
        return { ok: true };
    }

    static ordered(d, cc, from) {
        const out = {};
        for (const o of d.navalOrders) if (o.cc === cc && o.from === from) for (const [k, n] of Object.entries(o.ships)) out[k] = (out[k] || 0) + n;
        return out;
    }

    static cancelMove(d, cc, from, to) {
        const before = d.navalOrders.length;
        d.navalOrders = d.navalOrders.filter(o => !(o.cc === cc && o.from === from && o.to === to));
        return { ok: d.navalOrders.length < before };
    }

    static add(d, zone, cc, ships) {
        const byCc = d.navy[zone] || (d.navy[zone] = {});
        const fleet = byCc[cc] || (byCc[cc] = Navy.emptyFleet());
        for (const [k, n] of Object.entries(ships)) fleet[k] = (fleet[k] || 0) + n;
    }

    static take(d, zone, cc, ships) {
        const fleet = Navy.fleet(d, zone, cc);
        if (!fleet) return;
        for (const [k, n] of Object.entries(ships)) fleet[k] = Math.max(0, (fleet[k] || 0) - n);
        Navy.tidy(d, zone, cc);
    }

    static tidy(d, zone, cc) {
        const byCc = d.navy[zone];
        if (!byCc) return;
        if (byCc[cc] && !Navy.count(byCc[cc])) delete byCc[cc];
        if (!Object.keys(byCc).length) delete d.navy[zone];
    }

    // --- ход -------------------------------------------------------------------
    // Верфи, походы, бои. Возвращает записи для отчётов людей.
    static resolve(d) {
        const logs = [];
        const name = cc => d.countries[cc].name;
        const zname = z => Navy.zones()[z]?.name || z;

        // 1. верфи
        for (const o of [...d.shipyard]) {
            const region = d.regions[o.region];
            if (!region || region.owner !== o.cc || !d.countries[o.cc]?.alive) {
                d.shipyard.splice(d.shipyard.indexOf(o), 1);
                if (d.countries[o.cc]?.alive) d.countries[o.cc].money += o.cost;
                if (d.isHuman(o.cc)) logs.push({ for: o.cc, success: false, message: `⚓ Стройка кораблей в ${region ? region.name : 'порту'} сорвана: порт потерян. Деньги возвращены.` });
                continue;
            }
            if (--o.left > 0) continue;
            d.shipyard.splice(d.shipyard.indexOf(o), 1);
            Navy.add(d, o.zone, o.cc, { [o.type]: o.n });
            if (d.isHuman(o.cc)) logs.push({ for: o.cc, success: true, message: `⚓ Верфь ${region.name}: спущено на воду ${o.n} × ${SHIPS[o.type].icon} ${SHIPS[o.type].name} — ${zname(o.zone)}.` });
        }

        // 2. походы (пролив могли закрыть за ход — тогда стоим)
        for (const o of d.navalOrders) {
            if (!Navy.reachable(d, o.cc, o.from).has(o.to)) {
                if (d.isHuman(o.cc)) logs.push({ for: o.cc, success: false, message: `⚓ Поход в ${zname(o.to)} не состоялся: путь закрыт.` });
                continue;
            }
            const fleet = Navy.fleet(d, o.from, o.cc);
            if (!fleet) continue;
            const moved = {};
            for (const [k, n] of Object.entries(o.ships)) moved[k] = Math.min(n, fleet[k] || 0);
            Navy.take(d, o.from, o.cc, moved);
            Navy.add(d, o.to, o.cc, moved);
        }
        d.navalOrders = [];

        // 3. бои: в каждом море — пары воюющих, сильные первыми
        for (const zone of Object.keys(d.navy)) {
            for (let guard = 0; guard < 6; guard++) {
                const here = Object.keys(d.navy[zone] || {});
                let pair = null;
                for (const a of here) for (const b of here) if (a < b && d.isAtWar(a, b)) {
                    const w = Navy.power(d.navy[zone][a]) + Navy.power(d.navy[zone][b]);
                    if (!pair || w > pair.w) pair = { a, b, w };
                }
                if (!pair) break;
                Navy.battle(d, zone, pair.a, pair.b, logs);
            }
        }
        return logs;
    }

    // Урон стороны x по стороне y.
    static damage(x, y) {
        let subsY = 0, shipsY = 0, aswX = 0, subsX = 0, aswY = 0;
        for (const [k, n] of Object.entries(y)) { shipsY += n; if (SHIPS[k].sub) subsY += n; aswY += n * SHIPS[k].asw; }
        for (const [k, n] of Object.entries(x)) { aswX += n * SHIPS[k].asw; if (SHIPS[k].sub) subsX += n; }
        const subShare = shipsY ? subsY / shipsY : 0;
        // сколько вражеских подлодок накрывает наше ПЛО
        const hunt = subsY ? Math.min(1, aswX / (subsY * NAVY.SUB_HUNT)) : 1;
        // сколько наших подлодок накрывает ПЛО врага
        const cover = subsX ? Math.min(1, aswY / (subsX * NAVY.SUB_HUNT)) : 1;
        let dmg = 0;
        for (const [k, n] of Object.entries(x)) {
            const s = SHIPS[k];
            if (s.sub) dmg += n * s.attack * (1 + NAVY.SUB_BONUS * (1 - cover)) * (1 - subShare * 0.5);
            else dmg += n * (s.attack * (1 - subShare) + s.asw * subShare * hunt);
        }
        return dmg;
    }

    static battle(d, zone, a, b, logs) {
        const A = d.navy[zone][a], B = d.navy[zone][b];
        const defense = f => Object.entries(f).reduce((s, [k, n]) => s + n * SHIPS[k].defense, 0);
        const dA = Navy.damage(A, B), dB = Navy.damage(B, A);
        const lossA = NAVY.LOSS * dB / (dB + defense(A)), lossB = NAVY.LOSS * dA / (dA + defense(B));
        const sink = (f, share) => {
            const lost = {};
            for (const [k, n] of Object.entries(f)) {
                if (!n) continue;
                const exact = n * share;
                const m = Math.min(n, Math.floor(exact) + (Math.random() < exact % 1 ? 1 : 0));
                if (m) { f[k] -= m; lost[k] = m; }
            }
            return lost;
        };
        const lostA = sink(A, lossA), lostB = sink(B, lossB);
        const zname = Navy.zones()[zone]?.name || zone;
        const list = lost => Object.entries(lost).map(([k, n]) => `${n} ${SHIPS[k].icon}`).join(' ') || 'нет';
        Navy.tidy(d, zone, a); Navy.tidy(d, zone, b);
        const pA = Navy.power(Navy.fleet(d, zone, a)), pB = Navy.power(Navy.fleet(d, zone, b));
        let retreat = null;
        if (pA < pB * NAVY.RETREAT) retreat = a; else if (pB < pA * NAVY.RETREAT) retreat = b;
        let where = null;
        if (retreat && Navy.fleet(d, zone, retreat)) where = Navy.withdraw(d, zone, retreat);
        for (const [me, foe, lostMe, lostFoe] of [[a, b, lostA, lostB], [b, a, lostB, lostA]]) {
            if (!d.isHuman(me)) continue;
            const tail = retreat === me ? (where ? ` Эскадра отошла в ${Navy.zones()[where].name}.` : ' Отступать некуда — эскадра разбита.')
                : retreat === foe ? ' Противник отступил — море за нами.' : '';
            logs.push({ for: me, success: retreat === foe, message: `⚓ Бой в море (${zname}) с флотом ${d.countries[foe].name}: наши потери — ${list(lostMe)}, у противника — ${list(lostFoe)}.${tail}` });
        }
    }

    // Отход: в соседнее море без врагов, лучше — к своему берегу. Некуда — флот гибнет.
    static withdraw(d, zone, cc) {
        const ships = Navy.fleet(d, zone, cc);
        const home = new Set(d.getCountryRegions(cc).flatMap(r => Navy.seasOf(r.id)));
        const options = (Navy.zones()[zone]?.adj || []).filter(z => Navy.canPass(d, cc, zone, z) && Navy.enemyPower(d, z, cc) === 0);
        const to = options.find(z => home.has(z)) || options[0] || null;
        delete d.navy[zone][cc];
        Navy.tidy(d, zone, cc);
        if (to) Navy.add(d, to, cc, ships);
        return to;
    }

    // Мёртвые страны теряют флот; игроку — о блокаде и её снятии.
    static endTurn(d, events) {
        for (const zone of Object.keys(d.navy)) for (const cc of Object.keys(d.navy[zone])) {
            if (!d.countries[cc]?.alive || !d.regionsByCountry[cc]?.length) { delete d.navy[zone][cc]; Navy.tidy(d, zone, cc); }
        }
        for (const cc of d.humans) {
            const share = Navy.blockadeShare(d, cc);
            const was = d.blockSeen[cc] || 0;
            if (share > 0 && was === 0) events.push({ type: 'blockade', for: cc, message: `⚓ Враг блокирует наш берег (${Math.round(share * 100)}%): порты стоят, морская торговля падает. Нужен флот сильнее вражеского в этих морях.` });
            else if (share === 0 && was > 0) events.push({ type: 'blockade', for: cc, message: '⚓ Блокада снята: порты снова работают.' });
            if (share) d.blockSeen[cc] = share; else delete d.blockSeen[cc];
        }
    }

    // --- ИИ ----------------------------------------------------------------------
    // Строит флот, если есть верфь (порт): держит его соразмерным армии, на
    // войне — вдвое больше. На войне идёт к берегам врага, где тот слабее,
    // и уходит домой от сильного; в мире возвращается к своим берегам.
    static planAI(d, ai) {
        const zones = Navy.zones();
        for (const c of Object.values(d.countries)) {
            if (!c.alive || d.isHuman(c.id) || !d.regionsByCountry[c.id]?.length) continue;
            const enemies = d.enemiesOf(c.id);
            const home = new Set(d.getCountryRegions(c.id).flatMap(r => Navy.seasOf(r.id)));
            if (!home.size) continue;
            Navy.aiBuild(d, ai, c, enemies);
            for (const f of Navy.fleets(d, c.id)) {
                const target = Navy.aiTarget(d, c.id, f.zone, enemies, home);
                if (!target || target === f.zone) continue;
                const way = Navy.path(d, c.id, f.zone, target);
                const step = way[Math.min(NAVY.SPEED, way.length - 1)];
                if (step && step !== f.zone && zones[f.zone]) Navy.move(d, c.id, f.zone, step, { ...f.ships });
            }
        }
    }

    static aiBuild(d, ai, c, enemies) {
        if ((d.turn + c.id.charCodeAt(0)) % 2) return;
        const ports = d.getCountryRegions(c.id).filter(r => (r.development.port || 0) > 0 && Navy.seasOf(r.id).length && !Navy.yardOf(d, r.id));
        if (!ports.length || ai.richness(c) < 1.2) return;
        const want = d.calculateMilitaryPower(c.id) * NAVY.AI_SHARE * World.trait(d, c.id).arms * (enemies.length ? 2 : 1);
        const have = Navy.totalPower(d, c.id) + d.shipyard.filter(o => o.cc === c.id).reduce((s, o) => s + Navy.power({ [o.type]: o.n }), 0);
        if (have >= want) return;
        const port = ports.reduce((a, b) => (b.development.port > a.development.port ? b : a));
        const budget = Math.min(c.money * 0.15, d.countryBalance(c.id).tax * 2);
        const order = ['destroyer', 'sub', 'frigate', 'corvette', 'patrol'];
        for (const type of order) {
            const can = Navy.buildable(d, port.id, type);
            if (!can.ok) continue;
            const n = Math.min(can.max, Math.floor(budget / SHIPS[type].cost));
            if (n >= 1) { Navy.build(d, c.id, port.id, type, n, Navy.seasOf(port.id)[0]); return; }
        }
    }

    // Куда идти эскадре: на войне — к ближайшему морю у берегов врага, где
    // наш флот сильнее; если здесь враг сильнее — домой.
    static aiTarget(d, cc, zone, enemies, home) {
        const mine = Navy.sidePower(d, zone, cc), foe = Navy.enemyPower(d, zone, cc);
        const nearestHome = () => Navy.nearest(d, cc, zone, z => home.has(z));
        if (foe > mine) return nearestHome();
        if (enemies.length) {
            const enemySeas = new Set(enemies.flatMap(e => d.getCountryRegions(e).flatMap(r => Navy.seasOf(r.id))));
            const goal = Navy.nearest(d, cc, zone, z => enemySeas.has(z) && Navy.enemyPower(d, z, cc) < mine * 0.8, 6);
            if (goal) return goal;
        }
        return home.has(zone) ? zone : nearestHome();
    }

    // Поиск в ширину по морям с учётом проливов.
    static nearest(d, cc, from, test, limit = 12) {
        const seen = new Set([from]);
        let frontier = [from];
        for (let depth = 0; depth <= limit && frontier.length; depth++) {
            for (const z of frontier) if (test(z)) return z;
            const next = [];
            for (const z of frontier) for (const n of Navy.zones()[z]?.adj || []) {
                if (seen.has(n) || !Navy.canPass(d, cc, z, n)) continue;
                seen.add(n); next.push(n);
            }
            frontier = next;
        }
        return null;
    }

    static path(d, cc, from, to) {
        const prev = { [from]: null };
        const queue = [from];
        while (queue.length) {
            const z = queue.shift();
            if (z === to) break;
            for (const n of Navy.zones()[z]?.adj || []) {
                if (n in prev || !Navy.canPass(d, cc, z, n)) continue;
                prev[n] = z; queue.push(n);
            }
        }
        if (!(to in prev)) return [from];
        const out = [];
        for (let z = to; z !== null; z = prev[z]) out.unshift(z);
        return out;
    }

    // --- сохранение ------------------------------------------------------------
    static serialize(d) {
        return { navy: structuredClone(d.navy), yard: structuredClone(d.shipyard), orders: structuredClone(d.navalOrders), seen: { ...d.blockSeen } };
    }

    static valid(x) {
        const obj = o => !!o && typeof o === 'object' && !Array.isArray(o);
        const count = n => Number.isSafeInteger(n) && n >= 0;
        const zone = z => !!Navy.zones()[z];
        const ships = s => obj(s) && Object.entries(s).every(([k, n]) => SHIPS[k] && count(n));
        if (!obj(x) || !obj(x.navy) || !Array.isArray(x.yard) || !Array.isArray(x.orders) || !obj(x.seen)) return false;
        return Object.entries(x.navy).every(([z, byCc]) => zone(z) && obj(byCc) && Object.entries(byCc).every(([cc, s]) => CountriesDB[cc] && ships(s)))
            && x.yard.every(o => obj(o) && CountriesDB[o.cc] && RegionsDB[o.region] && SHIPS[o.type] && count(o.n) && count(o.left) && count(o.cost) && zone(o.zone))
            && x.orders.every(o => obj(o) && CountriesDB[o.cc] && zone(o.from) && zone(o.to) && ships(o.ships));
    }

    static restore(d, x) {
        d.navy = structuredClone(x.navy); d.shipyard = structuredClone(x.yard);
        d.navalOrders = structuredClone(x.orders); d.blockSeen = { ...x.seen };
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Navy, NAVY, SHIPS };
