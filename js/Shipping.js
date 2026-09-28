// =====================================================================
// СУДОХОДСТВО: порты, торговый флот, проливы
//
// Порт — проект развития прибрежной области (с выходом в морскую зону),
// уровни 1–5. На старте уже есть 100 крупнейших реальных портов и
// несколько добавленных (SeasDB.ports). Порты страны дают:
//   · бонус морской торговли: продаём дороже, покупаем дешевле; растёт с
//     суммой уровней, но всё медленнее (TRADE_MAX · P / (P + TRADE_HALF));
//   · фрахт — доход торгового флота: за уровень доля базы налогов области.
// Восставшая или заражённая область порт не использует.
//
// Проливы — узкие места мировой торговли и граница между двумя морскими
// зонами (SeasDB.straits): закрыт — флот не пройдёт. Каждый держат
// ключевые области на берегах; хозяин каждой настраивает свою сторону:
//   общий режим — открыт / плата (доля стоимости торговли) / закрыт;
//   «закрывать врагам» — война, отношения от −50, санкции ООН;
//   исключения — страны, для которых закрыто (deny), и страны, которых
//   пропускать бесплатно (allow) при любом режиме.
// Страны зависят от проливов по географии (users: доля морской торговли,
// идущей проливом). Закрыт — торговля через него пропадает, кроме доли
// обхода (bypass: Кильский канал, мыс Доброй Надежды, трубопроводы).
// Плата — отдельная строка бюджета: у платящих «проход проливов», у
// хозяев — «сборы за проливы». Закрытие и плата портят отношения с теми,
// кто от пролива зависит.
// =====================================================================
const SHIPPING = {
    COAST_MIN: 30,          // км берега, чтобы строить порт
    TRADE_MAX: 0.2,         // потолок бонуса морской торговли от портов
    TRADE_HALF: 6,          // при такой сумме уровней — половина потолка
    FREIGHT: 0.0012,        // фрахт за уровень порта — доля базы налогов области (≈1% налогов при ставке 12%)
    FEES: [0.02, 0.05, 0.1],
    LOSS_MAX: 0.9,          // даже при всех закрытых проливах что-то доходит
    RELATION_EVERY: 5,      // отношения от проливов меняются раз в столько ходов (иначе дроби округляются в ноль)
    CLOSE_RELATION: 15,     // при закрытии — × зависимость
    FEE_RELATION: 60,       // при плате — × ставка × зависимость
    NOTICE_DEP: 0.15,       // игроку сообщаем о проливах, от которых он зависит хотя бы так
    AI_EVERY: 6,            // ИИ пересматривает режим проливов раз в столько ходов
};

const STRAIT_MODES = {
    open: { name: 'Открыт', icon: '🟢' },
    fee: { name: 'Платный проход', icon: '💰' },
    closed: { name: 'Закрыт для всех', icon: '⛔' },
};

// at — точка на карте (координаты RegionsDB), keys — области на берегах.
const STRAITS = {
    bosporus: {
        name: 'Босфор и Дарданеллы', keys: ['TR-3'], at: [667.1, 278.6], bypass: 0,
        users: { GE: 1, UA: 0.8, MD: 0.7, BG: 0.5, RO: 0.5, AM: 0.4, AZ: 0.25, RU: 0.25, KZ: 0.1 },
    },
    danish: {
        name: 'Датские проливы', keys: ['DK-1', 'SE-1'], at: [629.3, 225.6], bypass: 0.3,
        users: { EE: 0.9, LV: 0.9, LT: 0.9, FI: 0.8, BY: 0.3, PL: 0.5, RU: 0.15, DE: 0.15 },
    },
    gibraltar: {
        name: 'Гибралтарский пролив', keys: ['ES-4', 'MA-1'], at: [587.3, 293.6], bypass: 0.3,
        users: { MT: 0.6, LB: 0.4, SY: 0.4, CY: 0.4, IL: 0.3, IT: 0.3, HR: 0.35, SI: 0.35, AL: 0.35, ME: 0.35, TN: 0.35, LY: 0.35,
            DZ: 0.3, GR: 0.25, TR: 0.2, EG: 0.15, UA: 0.2, BG: 0.2, RO: 0.2, GE: 0.2, FR: 0.1 },
    },
    suez: {
        name: 'Суэцкий канал', keys: ['EG-2'], at: [675.1, 308.4], bypass: 0.45, canal: true,
        users: { JO: 0.6, SD: 0.5, ER: 0.5, SA: 0.3, IL: 0.2, GR: 0.3, IT: 0.25, TR: 0.2, NL: 0.2, BE: 0.2, DE: 0.15, FR: 0.15, ES: 0.15, GB: 0.15,
            PL: 0.1, IN: 0.25, PK: 0.2, LK: 0.3, BD: 0.2, SG: 0.2, AE: 0.25, QA: 0.25, KW: 0.25, CN: 0.15, JP: 0.1, KR: 0.1, VN: 0.1, TH: 0.1, MY: 0.1, UA: 0.1 },
    },
    bab: {
        name: 'Баб-эль-Мандеб', keys: ['YE-1', 'DJ-1', 'ER-1'], at: [700.0, 354.0], bypass: 0.45,
        users: { JO: 0.6, SD: 0.5, SA: 0.3, EG: 0.3, IL: 0.2, GR: 0.3, IT: 0.25, TR: 0.2, NL: 0.2, BE: 0.2, DE: 0.15, FR: 0.15, ES: 0.15, GB: 0.15,
            IN: 0.25, PK: 0.2, LK: 0.3, BD: 0.2, SG: 0.2, AE: 0.25, QA: 0.25, KW: 0.25, CN: 0.15, JP: 0.1, KR: 0.1, ET: 0.8, SO: 0.3 },
    },
    hormuz: {
        name: 'Ормузский пролив', keys: ['IR-2', 'OM-1'], at: [730.2, 318.6], bypass: 0.15,
        users: { KW: 1, QA: 1, BH: 1, IQ: 0.95, AE: 0.6, SA: 0.35 },
    },
    malacca: {
        name: 'Малаккский пролив', keys: ['MY-1', 'SG-1', 'ID-1'], at: [837.2, 378.6], bypass: 0.75,
        users: { CN: 0.35, JP: 0.4, KR: 0.4, TW: 0.4, TH: 0.25, VN: 0.2, PH: 0.15, KH: 0.2, IN: 0.15, BD: 0.15, LK: 0.2, MM: 0.2, AU: 0.1 },
    },
    panama: {
        name: 'Панамский канал', keys: ['PA-1'], at: [415.7, 361.4], bypass: 0.5, canal: true,
        users: { EC: 0.35, PE: 0.3, CL: 0.25, CO: 0.2, CR: 0.3, NI: 0.25, SV: 0.3, GT: 0.25, HN: 0.25, CU: 0.2, JM: 0.3, DO: 0.2, US: 0.1, MX: 0.1,
            JP: 0.05, KR: 0.05, CN: 0.05 },
    },
    kerch: {
        name: 'Керченский пролив', keys: ['UA-9', 'RU-40'], at: [684.7, 265.0], bypass: 0,
        users: { UA: 0.15, RU: 0.1 },
    },
};

class Shipping {
    static init(d) { d.straits = {}; d.straitSeen = {}; }

    // --- порты ----------------------------------------------------------------
    // Прибрежная — область, у которой есть выход в морскую зону (озёра не в счёт).
    static coastal(region) { return !!region && typeof SeasDB !== 'undefined' && !!SeasDB.coast[region.id]; }

    // Порты на старте — реальные крупнейшие (SeasDB.ports): уровень по рейтингу.
    static presetPorts(d) {
        if (typeof SeasDB === 'undefined') return;
        for (const p of SeasDB.ports || []) {
            const r = d.regions[p.region];
            if (r) r.development.port = Math.max(r.development.port || 0, p.level);
        }
    }

    // Где на карте значок порта: у реального порта — в его городе, у
    // построенного — у берега области.
    static portMarks(d) {
        const out = [];
        const named = new Set();
        for (const p of (typeof SeasDB !== 'undefined' && SeasDB.ports) || []) {
            const r = d.regions[p.region];
            if (!r || !(r.development.port > 0)) continue;
            out.push({ region: r.id, x: p.x, y: p.y, name: p.name });
            named.add(r.id);
        }
        for (const r of Object.values(d.regions)) {
            if (named.has(r.id) || !(r.development.port > 0) || !Shipping.coastal(r)) continue;
            const c = SeasDB.coast[r.id];
            out.push({ region: r.id, x: c.x, y: c.y, name: r.name });
        }
        return out;
    }

    static markOf(id) { return (typeof SeasDB !== 'undefined' && SeasDB.marks && SeasDB.marks[id]) || STRAITS[id].at; }

    // Порт работает: область не восстала, не заражена и не блокирована с моря.
    static portActive(d, region) {
        return (region.development.port || 0) > 0 && !d.revolts[region.id] && !Nuclear.fallout(d, region.id) && !Navy.blockaded(d, region);
    }

    static portLevels(d, cc) {
        let p = 0;
        for (const r of d.getCountryRegions(cc)) if (Shipping.portActive(d, r)) p += r.development.port;
        return p;
    }

    static portBonus(d, cc, levels = Shipping.portLevels(d, cc)) {
        return SHIPPING.TRADE_MAX * levels / (levels + SHIPPING.TRADE_HALF);
    }

    static freight(d, cc) {
        let sum = 0;
        for (const r of d.getCountryRegions(cc)) if (Shipping.portActive(d, r)) sum += r.development.port * SHIPPING.FREIGHT * d.taxBase(r);
        return Math.round(sum * Economy.cycle(d).trade);
    }

    // Что даст следующий уровень порта в ход: фрахт + рост торгового бонуса.
    static portValue(d, regionId) {
        const region = d.regions[regionId];
        if (!Shipping.coastal(region)) return 0;
        const cc = region.owner;
        const levels = Shipping.portLevels(d, cc);
        const trade = Economy.projectTrade(d, cc);
        const volume = trade.sales + trade.purchases * 0.5;
        const bonus = (Shipping.portBonus(d, cc, levels + 1) - Shipping.portBonus(d, cc, levels)) * volume;
        return SHIPPING.FREIGHT * d.taxBase(region) * Economy.cycle(d).trade + bonus;
    }

    // --- проливы ----------------------------------------------------------------
    // Хозяева пролива: владельцы ключевых областей (без повторов).
    static keepers(d, id) {
        const out = [];
        for (const rid of STRAITS[id].keys) {
            const r = d.regions[rid];
            if (r && d.countries[r.owner]?.alive && !out.includes(r.owner)) out.push(r.owner);
        }
        return out;
    }

    // Настройки стороны пролива: общий режим, «закрывать врагам» и
    // исключения — кому закрыто (deny) и кого пропускать бесплатно (allow).
    static policy(d, id, cc) {
        const p = d.straits && d.straits[id] && d.straits[id][cc];
        return p || { mode: 'open', fee: 0, hostile: false, deny: [], allow: [] };
    }

    static edit(d, id, cc, change) {
        if (!STRAITS[id]) return { ok: false, reason: 'Нельзя' };
        if (!Shipping.keepers(d, id).includes(cc)) return { ok: false, reason: 'Этот пролив вам не принадлежит' };
        const p = structuredClone(Shipping.policy(d, id, cc));
        const res = change(p);
        if (res && !res.ok) return res;
        d.straits[id] = d.straits[id] || {};
        const plain = p.mode === 'open' && !p.hostile && !p.deny.length && !p.allow.length;
        if (plain) delete d.straits[id][cc]; else d.straits[id][cc] = p;
        if (!Object.keys(d.straits[id]).length) delete d.straits[id];
        return { ok: true };
    }

    static setPolicy(d, id, cc, mode, fee = 0) {
        if (!STRAIT_MODES[mode]) return { ok: false, reason: 'Нельзя' };
        if (mode === 'fee' && !SHIPPING.FEES.includes(fee)) return { ok: false, reason: 'Нельзя' };
        return Shipping.edit(d, id, cc, p => { p.mode = mode; p.fee = mode === 'fee' ? fee : 0; });
    }

    static setHostile(d, id, cc, on) {
        return Shipping.edit(d, id, cc, p => { p.hostile = !!on; });
    }

    // rule: 'deny' — закрыт для страны, 'allow' — пропускать бесплатно, null — как всем.
    static setRule(d, id, cc, target, rule) {
        if (!d.countries[target] || target === cc || ![null, 'deny', 'allow'].includes(rule)) return { ok: false, reason: 'Нельзя' };
        return Shipping.edit(d, id, cc, p => {
            p.deny = p.deny.filter(x => x !== target);
            p.allow = p.allow.filter(x => x !== target);
            if (rule) p[rule].push(target);
        });
    }

    static enemyOf(d, k, x) { return d.isAtWar(k, x) || Diplomacy.relation(d, k, x) <= -50 || Council.sanctioned(d, x); }

    // Закрыта ли для страны x сторона хозяина k.
    static shut(d, k, p, x) {
        if (p.allow.includes(x)) return false;
        if (p.deny.includes(x) || p.mode === 'closed') return true;
        return p.hostile && Shipping.enemyOf(d, k, x);
    }

    // Пролив для страны x: закрыт ли и сколько стоит проход (доля торговли).
    static passage(d, id, x) {
        let blocked = false, fee = 0;
        const by = [];
        for (const k of Shipping.keepers(d, id)) {
            if (k === x) continue;
            const p = Shipping.policy(d, id, k);
            if (Shipping.shut(d, k, p, x)) { blocked = true; by.push(k); } else if (p.mode === 'fee' && !p.allow.includes(x)) fee += p.fee;
        }
        return { blocked, fee, by };
    }

    static dep(id, cc) { return STRAITS[id].users[cc] || 0; }

    // Доля морской торговли страны, которая доходит сквозь закрытые проливы.
    static access(d, cc) {
        let loss = 0;
        for (const id of Object.keys(STRAITS)) {
            const dep = Shipping.dep(id, cc);
            if (dep && Shipping.passage(d, id, cc).blocked) loss += dep * (1 - STRAITS[id].bypass);
        }
        return 1 - Math.min(SHIPPING.LOSS_MAX, loss);
    }

    // Плата за проход: доля объёма торговли.
    static feeRate(d, cc) {
        let rate = 0;
        for (const id of Object.keys(STRAITS)) {
            const dep = Shipping.dep(id, cc);
            if (!dep) continue;
            const p = Shipping.passage(d, id, cc);
            if (!p.blocked) rate += dep * p.fee;
        }
        return rate;
    }

    // Конец хода: кто сколько заплатил за проход и кому. volume — объём
    // торговли каждой страны за ход (продажи + закупки).
    static settle(d, volume) {
        const transit = {}, tolls = {};
        for (const [cc, v] of Object.entries(volume)) {
            if (!v) continue;
            for (const id of Object.keys(STRAITS)) {
                const dep = Shipping.dep(id, cc);
                if (!dep) continue;
                for (const k of Shipping.keepers(d, id)) {
                    if (k === cc) continue;
                    const p = Shipping.policy(d, id, k);
                    if (p.mode !== 'fee' || p.allow.includes(cc) || Shipping.passage(d, id, cc).blocked) continue;
                    const pay = Math.round(v * dep * p.fee);
                    transit[cc] = (transit[cc] || 0) + pay;
                    tolls[k] = (tolls[k] || 0) + pay;
                }
            }
        }
        for (const c of Object.values(d.countries)) c.lastTolls = tolls[c.id] || 0;
        return { transit, tolls };
    }

    // --- ход -------------------------------------------------------------------
    // Отношения: закрытие и плата злят тех, кто от пролива зависит. Игроку —
    // сообщение, когда меняется режим пролива, от которого он зависит.
    static endTurn(d, events) {
        for (const id of Object.keys(STRAITS)) {
            const keepers = Shipping.keepers(d, id);
            if (d.turn % SHIPPING.RELATION_EVERY === 0) for (const k of keepers) {
                const p = Shipping.policy(d, id, k);
                if (p.mode === 'open' && !p.hostile && !p.deny.length) continue;
                for (const [cc, dep] of Object.entries(STRAITS[id].users)) {
                    if (cc === k || !d.countries[cc]?.alive) continue;
                    if (Shipping.shut(d, k, p, cc)) Diplomacy.changeRelation(d, k, cc, -SHIPPING.CLOSE_RELATION * dep);
                    else if (p.mode === 'fee' && !p.allow.includes(cc)) Diplomacy.changeRelation(d, k, cc, -SHIPPING.FEE_RELATION * p.fee * dep);
                }
            }
            const sig = keepers.map(k => { const p = Shipping.policy(d, id, k); return `${k}:${p.mode}:${p.fee}:${p.hostile}:${p.deny.join(',')}:${p.allow.join(',')}`; }).join('|');
            const was = d.straitSeen[id];
            d.straitSeen[id] = sig;
            if (was === undefined || was === sig) continue;
            for (const cc of d.humans) {
                if (keepers.includes(cc) || Shipping.dep(id, cc) < SHIPPING.NOTICE_DEP) continue;
                const pass = Shipping.passage(d, id, cc);
                const text = pass.blocked ? `закрыт для вас (${pass.by.map(x => d.countries[x].name).join(', ')}) — морская торговля падает`
                    : pass.fee ? `платный: ${Math.round(pass.fee * 100)}% стоимости проходящей торговли` : 'снова открыт';
                events.push({ type: 'strait', for: cc, message: `⚓ ${STRAITS[id].name} ${text}.` });
            }
        }
    }

    // ИИ-хозяева проливов: воюют или под санкциями — закрывают врагам;
    // каналы платные, как в жизни (экспансионист берёт больше); проливы
    // открыты, плату за них вводит только экспансионист. Пересматривают редко.
    static planAI(d) {
        for (const id of Object.keys(STRAITS)) {
            for (const k of Shipping.keepers(d, id)) {
                if (d.isHuman(k)) continue;
                const slot = (k.charCodeAt(0) + id.length) % SHIPPING.AI_EVERY;
                if ((d.turn + slot) % SHIPPING.AI_EVERY !== 0) continue;
                const trait = World.traitId(d, k);
                let mode = 'open', fee = 0;
                if (STRAITS[id].canal) { mode = 'fee'; fee = SHIPPING.FEES[trait === 'expansionist' ? 1 : 0]; }
                else if (trait === 'expansionist') { mode = 'fee'; fee = SHIPPING.FEES[0]; }
                Shipping.setPolicy(d, id, k, mode, fee);
                // на войне и под санкциями — закрыть врагам; союзникам — бесплатно
                Shipping.setHostile(d, id, k, d.enemiesOf(k).length > 0 || Council.sanctioned(d, k));
                Shipping.edit(d, id, k, p => { p.allow = Diplomacy.allies(d, k).filter(x => STRAITS[id].users[x]); });
            }
        }
    }

    // --- сохранение ---------------------------------------------------------
    static serialize(d) { return { straits: structuredClone(d.straits || {}), seen: { ...(d.straitSeen || {}) } }; }

    static valid(x) {
        const obj = o => !!o && typeof o === 'object' && !Array.isArray(o);
        if (!obj(x) || !obj(x.straits) || !obj(x.seen)) return false;
        const list = l => Array.isArray(l) && l.every(cc => CountriesDB[cc]);
        return Object.entries(x.straits).every(([id, byCc]) => STRAITS[id] && obj(byCc) && Object.entries(byCc).every(([cc, p]) =>
            CountriesDB[cc] && obj(p) && STRAIT_MODES[p.mode] && (p.mode !== 'fee' || SHIPPING.FEES.includes(p.fee))
            && typeof p.hostile === 'boolean' && list(p.deny) && list(p.allow)))
            && Object.entries(x.seen).every(([id, s]) => STRAITS[id] && typeof s === 'string');
    }

    static restore(d, x) { d.straits = structuredClone(x.straits); d.straitSeen = { ...x.seen }; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Shipping, SHIPPING, STRAITS, STRAIT_MODES };
