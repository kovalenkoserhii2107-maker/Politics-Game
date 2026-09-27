// =====================================================================
// ООН: СОВЕТ БЕЗОПАСНОСТИ И ГЕНЕРАЛЬНАЯ АССАМБЛЕЯ
//
// Раз в несколько ходов ООН ставит на голосование одну резолюцию — самую
// острую из повестки: санкции против агрессора, оружейное эмбарго,
// миротворцы для жертвы, принуждение к миру, прекращение огня, осуждение,
// гуманитарная помощь, репарации, всеобщее перемирие. Созыв — в отчёте
// хода, голосование — весь следующий ход, итог — в следующем отчёте.
//
// Совбез: пять постоянных членов с правом вето (США, Россия, Китай,
// Великобритания, Франция) и десять выборных на 16 ходов. Решение принято,
// если «за» не меньше 60% членов и ни один постоянный не против. Совбез
// решает обязательное: санкции, эмбарго, миротворцы, принуждение к миру,
// прекращение огня. Заблокированное вето уходит в Генассамблею: там
// голосуют все страны (голос весит по населению под корнем) и могут хотя бы
// осудить агрессора. Ассамблея же решает о помощи и репарациях.
//
// Агрессор — не тот, кто держит чужие земли, а тот, кто их захватил в
// начатой им войне. Кто отбился и отбросил напавшего на его же территорию,
// агрессором не считается; области, переданные по договору, уступкой или
// ушедшие к соседу с восстанием, — тоже не захват.
// =====================================================================
const COUNCIL = {
    FIRST: 6,               // первая сессия
    EVERY: 4,               // потом — раз в столько ходов
    MIN_TAKEN: 3,           // санкции — от стольких захваченных областей
    ENFORCE_TAKEN: 5,       // принуждение к миру — уже под санкциями и от стольких
    MIN_WARS: 2,            // всеобщее перемирие — если в мире столько войн
    CEASEFIRE_TURNS: 10,    // прекращение огня — войне столько ходов
    SANCTION_TURNS: 6,
    SANCTION_TRADE: 0.6,    // доля торговли под санкциями
    EMBARGO_TURNS: 8,
    PEACEKEEPING_TURNS: 8,
    PEACEKEEPING_DEFENSE: 1.3,
    CONDEMN_RELATION: -8,
    CONDEMN_INFLUENCE: 15,
    AID_PER_REGION: 3e6, AID_MAX: 20e6,
    REPARATION_TURNS: 8, REPARATION_SHARE: 0.1,   // доля недельных налогов
    ENFORCE_ALLIES: 3,
    YES_RELATION: -8,       // отношения цели с голосовавшими «за»
    SC_PERMANENT: ['US', 'RU', 'CN', 'GB', 'FR'],
    SC_ELECTED: 10,
    SC_TERM: 16,
    SC_MAJORITY: 0.6,
    REPEAT_GAP: 8,          // одну и ту же резолюцию против того же — не чаще
    VETO_GAP: 20,           // а заблокированную вето — ещё реже
    RECORD_KEPT: 24,
};

const COUNCIL_KINDS = {
    sanctions: {
        icon: '🚫', body: 'sc', targeted: true,
        title: (d, c) => `санкции против агрессора — ${d.countries[c.target].name}`,
        text: (d, c) => `${d.countries[c.target].name} удерживает ${Council.regionsWord(Council.taken(d, c.target))}, захваченных в начатых ею войнах. Если резолюция пройдёт, ${COUNCIL.SANCTION_TURNS} ходов её торговля на мировом рынке упадёт до ${Math.round(COUNCIL.SANCTION_TRADE * 100)}%, а отношения с голосовавшими «за» ухудшатся.`,
        why: (d, cc) => `вы удерживаете ${Council.regionsWord(Council.taken(d, cc))}, захваченных в начатых вами войнах`,
    },
    nuclear: {
        icon: '☢️', body: 'sc', targeted: true,
        title: (d, c) => `санкции за ядерную программу — ${d.countries[c.target].name}`,
        text: (d, c) => `${d.countries[c.target].name} провела ядерное испытание. Если резолюция пройдёт, ${COUNCIL.SANCTION_TURNS} ходов её торговля на мировом рынке упадёт до ${Math.round(COUNCIL.SANCTION_TRADE * 100)}%, а отношения с голосовавшими «за» ухудшатся.`,
        why: () => 'вы провели ядерное испытание',
    },
    embargo: {
        icon: '🔒', body: 'sc', targeted: true,
        title: (d, c) => `оружейное эмбарго — ${d.countries[c.target].name}`,
        text: (d, c) => `${d.countries[c.target].name} ведёт захватническую войну (жертва — ${d.countries[c.victim].name}). Эмбарго на ${COUNCIL.EMBARGO_TURNS} ходов: ей нельзя набирать войска из новых технологий и модернизировать армию.`,
        why: (d, cc, c) => `вы начали войну против страны ${d.countries[c.victim].name}`,
    },
    enforce: {
        icon: '⚔️', body: 'sc', targeted: true,
        title: (d, c) => `принуждение агрессора к миру — ${d.countries[c.target].name}`,
        text: (d, c) => `${d.countries[c.target].name} уже под санкциями, но продолжает войну (жертва — ${d.countries[c.victim].name}) и удерживает ${Council.regionsWord(Council.taken(d, c.target))}. Резолюция разрешает коалиции: до ${COUNCIL.ENFORCE_ALLIES} стран, голосовавших «за», вступят в войну на стороне жертвы, жертва получит помощь.`,
        why: (d, cc) => `вы продолжаете войну под санкциями и удерживаете ${Council.regionsWord(Council.taken(d, cc))}`,
    },
    peacekeepers: {
        icon: '🪖', body: 'sc', victim: true,
        title: (d, c) => `миротворцы ООН — ${d.countries[c.target].name}`,
        text: (d, c) => `${d.countries[c.against].name} заняла часть земель страны ${d.countries[c.target].name}. Миротворцы на ${COUNCIL.PEACEKEEPING_TURNS} ходов встанут в её приграничных областях: оборона там +${Math.round((COUNCIL.PEACEKEEPING_DEFENSE - 1) * 100)}%.`,
    },
    ceasefire: {
        icon: '🏳️', body: 'sc', pair: true,
        title: (d, c) => `прекращение огня: ${c.pair.map(cc => d.countries[cc].name).join(' — ')}`,
        text: (d, c) => `Война ${c.pair.map(cc => d.countries[cc].name).join(' и ')} идёт ${d.turn - (d.wars.get(d.pairKey(...c.pair))?.start ?? d.turn)} ходов. Если резолюция пройдёт, она закончится с перемирием на ${RULES.TRUCE_TURNS} ходов, границы останутся как есть.`,
    },
    condemn: {
        icon: '📢', body: 'ga', targeted: true,
        title: (d, c) => `осуждение агрессии — ${d.countries[c.target].name}`,
        text: (d, c) => `В Совбезе резолюцию против страны ${d.countries[c.target].name} заблокировали вето. Генассамблея может хотя бы осудить: отношения с голосовавшими «за» ${COUNCIL.CONDEMN_RELATION}, её влияние −${COUNCIL.CONDEMN_INFLUENCE}.`,
        why: () => 'резолюцию против вас заблокировали в Совбезе, и её перенесли в Ассамблею',
    },
    aid: {
        icon: '🤲', body: 'ga', victim: true, gap: 16,
        title: (d, c) => `гуманитарная помощь — ${d.countries[c.target].name}`,
        text: (d, c) => `${d.countries[c.target].name} пострадала${c.against ? ` (агрессор — ${d.countries[c.against].name})` : ''}. Фонд ООН выделит ${Council.money(Council.aidAmount(d, c.target))}, отношения с голосовавшими «за» улучшатся.`,
    },
    reparations: {
        icon: '⚖️', body: 'ga', targeted: true,
        title: (d, c) => `репарации: ${d.countries[c.target].name} → ${d.countries[c.victim].name}`,
        text: (d, c) => `${d.countries[c.target].name} начала войну против страны ${d.countries[c.victim].name} и проиграла. Если резолюция пройдёт, ${COUNCIL.REPARATION_TURNS} ходов она будет платить пострадавшей ${Council.money(Council.reparation(d, c.target))} за ход.`,
        why: (d, cc, c) => `вы начали войну против страны ${d.countries[c.victim].name} и проиграли её`,
    },
    truce: {
        icon: '🕊️', body: 'ga',
        title: () => 'всеобщее перемирие',
        text: d => `В мире идёт войн: ${d.wars.size}. Если резолюция пройдёт, все войны закончатся с перемирием на ${RULES.TRUCE_TURNS} ходов — и ваши тоже.`,
    },
};

class Council {
    // 1 область, 3 области, 5 областей
    static regionsWord(n) {
        const m10 = n % 10, m100 = n % 100;
        const word = m10 === 1 && m100 !== 11 ? 'область' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'области' : 'областей';
        return `${n} ${word}`;
    }

    static money(n) { return `$${(n / 1e6).toFixed(1)}M`; }

    static init(d) {
        d.council = null;       // { kind, target, victim, against, pair, turn, votes: { cc: true|false } }
        d.sanctions = {};       // cc -> ход, до которого действуют санкции
        d.un = Council.emptyUN();
    }

    static emptyUN() {
        return {
            seats: [], term: 0,     // выборные члены Совбеза и конец их срока
            wars: {},               // 'A|B' -> { aggressor, start, end } — кто начал последнюю войну пары
            legit: {},              // область -> кому передана без войны
            embargo: {},            // cc -> ход, до которого действует эмбарго
            peacekeepers: {},       // жертва -> { against, until }
            reparations: [],        // { from, to, amount, left }
            vetoed: [],             // { target, victim, turn, by } — ждут Ассамблеи
            record: [],             // { turn, kind, title, passed, veto }
        };
    }

    static sanctioned(d, cc) { return !!(d.sanctions && d.sanctions[cc] > d.turn); }
    static embargoed(d, cc) { return !!(d.un && d.un.embargo[cc] > d.turn); }

    // --- летопись войн ------------------------------------------------------
    // aggressor — кто начал. Союзник жертвы, вступивший по договору, и
    // коалиция по решению ООН агрессорами не считаются.
    static recordWar(d, a, b, aggressor = a) {
        d.un.wars[d.pairKey(a, b)] = { aggressor, start: d.turn, end: null };
    }

    static endWar(d, a, b) {
        const w = d.un.wars[d.pairKey(a, b)];
        if (w && w.end === null) w.end = d.turn;
    }

    static markLegit(d, regionId, cc) { d.un.legit[regionId] = cc; }
    static clearLegit(d, regionId) { if (d.un) delete d.un.legit[regionId]; }

    // Области, которые cc захватила у других стран в начатых ею войнах.
    static illegal(d, cc) {
        const out = [];
        for (const id of d.regionsByCountry[cc] || []) {
            const r = d.regions[id], from = r.originalOwner;
            if (from === cc || !CountriesDB[from].playable || d.un.legit[id] === cc) continue;
            const w = d.un.wars[d.pairKey(cc, from)];
            if (w && w.aggressor === from) continue;   // отбила у напавшего — оборона
            out.push(r);
        }
        return out;
    }

    static taken(d, cc) { return Council.illegal(d, cc).length; }

    // У кого больше всего захватила.
    static victimOf(d, cc) {
        const count = {};
        for (const r of Council.illegal(d, cc)) count[r.originalOwner] = (count[r.originalOwner] || 0) + 1;
        const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
        return best ? best[0] : null;
    }

    static aggressor(d) {
        let best = null, most = COUNCIL.MIN_TAKEN - 1;
        for (const c of Object.values(d.countries)) {
            if (!c.alive || !c.playable || Council.sanctioned(d, c.id)) continue;
            const n = Council.taken(d, c.id);
            if (n > most) { best = c.id; most = n; }
        }
        return best;
    }

    // --- Совбез -------------------------------------------------------------
    static permanent(d) {
        return COUNCIL.SC_PERMANENT.filter(cc => d.countries[cc] && d.countries[cc].alive && d.regionsByCountry[cc].length);
    }

    static members(d) {
        return [...Council.permanent(d), ...d.un.seats.filter(cc => d.countries[cc] && d.countries[cc].alive && d.regionsByCountry[cc].length)];
    }

    // Выборы: десять мест, шанс — по населению под корнем, крупные чаще.
    static elect(d, events = null) {
        const pool = Object.values(d.countries)
            .filter(c => c.alive && c.playable && d.regionsByCountry[c.id].length && !COUNCIL.SC_PERMANENT.includes(c.id))
            .map(c => ({ cc: c.id, w: Council.weight(d, c.id) + 1 }));
        const seats = [];
        while (seats.length < COUNCIL.SC_ELECTED && pool.length) {
            let roll = Math.random() * pool.reduce((s, x) => s + x.w, 0);
            const i = Math.max(0, pool.findIndex(x => (roll -= x.w) <= 0));
            seats.push(pool.splice(i, 1)[0].cc);
        }
        d.un.seats = seats;
        d.un.term = d.turn + COUNCIL.SC_TERM;
        if (!events) return;
        for (const cc of d.humans) {
            if (seats.includes(cc)) events.push({ type: 'council', for: cc, message: `🇺🇳 Вас избрали в Совет Безопасности ООН на ${COUNCIL.SC_TERM} ходов: без вашего голоса не пройдут санкции и миротворцы.` });
        }
        events.push({ type: 'council', message: `🇺🇳 Новый состав Совбеза ООН: ${seats.map(cc => d.countries[cc].name).join(', ')} — и пятёрка постоянных.` });
    }

    static weight(d, cc) {
        let pop = 0;
        for (const r of d.getCountryRegions(cc)) pop += r.population;
        return Math.max(1, Math.round(Math.sqrt(pop / 1e6)));
    }

    // Кто голосует: в Совбезе — его члены, в Ассамблее — все страны.
    static voters(d, c = d.council) {
        if (c && COUNCIL_KINDS[c.kind].body === 'sc') return Council.members(d);
        return Object.values(d.countries).filter(x => x.alive && x.playable && d.regionsByCountry[x.id].length).map(x => x.id);
    }

    static canVote(d, cc, c = d.council) {
        return !!c && Council.voters(d, c).includes(cc) && cc !== c.target;
    }

    // --- голос компьютера: true — за, false — против, null — воздержался ---
    static aiVote(d, cc, c = d.council) {
        const kind = COUNCIL_KINDS[c.kind];
        const rel = x => Diplomacy.relation(d, cc, x);
        const friend = x => Diplomacy.isAllied(d, cc, x) || Diplomacy.hasDeal(d, cc, x);
        if (kind.targeted) {
            const t = c.target;
            if (cc === t || friend(t)) return false;
            if (d.isAtWar(cc, t) || (c.victim && (cc === c.victim || Diplomacy.isAllied(d, cc, c.victim)))) return true;
            // прежние ядерные державы берегут свою монополию
            if (c.kind === 'nuclear' && d.nuclear.founders.includes(cc)) return true;
            if (rel(t) >= 20) return false;
            // войну чужими руками одобряют только недруги
            if (c.kind === 'enforce') return rel(t) <= 0 ? true : null;
            // остальное против явного нарушителя — да; только тёплые отношения удерживают
            return rel(t) >= 10 ? null : true;
        }
        if (kind.victim) {
            if (cc === c.against || friend(c.against) && rel(c.against) >= 20) return false;
            return rel(c.target) >= -10 ? true : null;
        }
        if (kind.pair) {
            const [a, b] = c.pair;
            if (cc === a || cc === b) {
                const info = d.warInfo(cc, cc === a ? b : a);
                return !info || info.taken <= info.lost;
            }
            // союзник побеждающей стороны не мешает ей
            for (const side of [a, b]) {
                const other = side === a ? b : a;
                const info = d.warInfo(side, other);
                if (Diplomacy.isAllied(d, cc, side) && info && info.taken > info.lost) return false;
            }
            return true;
        }
        const enemies = d.enemiesOf(cc);
        if (!enemies.length) return true;
        // сильный в войне мира не хочет, слабый — хочет
        const mine = d.calculateMilitaryPower(cc);
        const theirs = enemies.reduce((sum, e) => sum + d.calculateMilitaryPower(e), 0);
        return mine < theirs;
    }

    // --- повестка ---------------------------------------------------------------
    // Всё, что можно вынести на голосование, с приоритетом.
    static agenda(d) {
        const items = [];
        // вето не переубедить быстро: заблокированное не выносят дольше
        const recent = (kind, target) => d.un.record.some(r => r.kind === kind && r.target === target
            && d.turn - r.turn < (r.veto ? COUNCIL.VETO_GAP : COUNCIL_KINDS[kind].gap || COUNCIL.REPEAT_GAP));
        const add = (pri, item) => { if (!recent(item.kind, item.target || (item.pair && item.pair.join('|')))) items.push({ pri, ...item }); };
        const alive = cc => d.countries[cc] && d.countries[cc].alive && d.regionsByCountry[cc].length;

        for (const c of Object.values(d.countries)) {
            if (!alive(c.id) || !c.playable) continue;
            const n = Council.taken(d, c.id);
            const victim = n ? Council.victimOf(d, c.id) : null;
            if (n >= COUNCIL.ENFORCE_TAKEN && Council.sanctioned(d, c.id) && victim && d.isAtWar(c.id, victim)) add(100, { kind: 'enforce', target: c.id, victim });
            else if (n >= COUNCIL.MIN_TAKEN && !Council.sanctioned(d, c.id)) add(80, { kind: 'sanctions', target: c.id, victim });
        }
        const rogue = d.nuclear && d.nuclear.council.find(cc => alive(cc) && !Council.sanctioned(d, cc));
        if (rogue) add(90, { kind: 'nuclear', target: rogue });

        for (const [key, war] of d.wars) {
            const [a, b] = key.split('|');
            const w = d.un.wars[key];
            const agg = w && (w.aggressor === a || w.aggressor === b) ? w.aggressor : war.attacker;
            const victim = agg === a ? b : a;
            if (!alive(agg) || !alive(victim)) continue;
            const info = d.warInfo(agg, victim);
            // свежее нападение сильного на слабого — эмбарго
            if (d.turn - war.start <= 8 && !Council.embargoed(d, agg)
                && d.calculateMilitaryPower(agg) >= 1.3 * d.calculateMilitaryPower(victim)) add(70, { kind: 'embargo', target: agg, victim });
            // жертва теряет земли — миротворцы
            if (info && info.taken >= 1 && !d.un.peacekeepers[victim]) add(60, { kind: 'peacekeepers', target: victim, against: agg });
            if (d.turn - war.start >= COUNCIL.CEASEFIRE_TURNS) add(40, { kind: 'ceasefire', pair: [a, b] });
        }
        for (const v of d.un.vetoed) if (alive(v.target) && d.turn - v.turn <= 12) add(55, { kind: 'condemn', target: v.target, victim: v.victim || null });

        for (const c of Object.values(d.countries)) {
            if (!alive(c.id) || !c.playable) continue;
            const lost = Object.values(d.regions).filter(r => r.originalOwner === c.id && r.owner !== c.id && Council.illegal(d, r.owner).includes(r)).length;
            const nuked = d.nuclear && d.nuclear.strikes.some(s => s.target === c.id && d.turn - s.turn <= 4);
            if (lost >= 2 || nuked || Unrest.civilWar(d, c.id)) {
                const against = nuked ? d.nuclear.strikes.filter(s => s.target === c.id).pop().by : lost ? Object.values(d.regions).find(r => r.originalOwner === c.id && r.owner !== c.id)?.owner : null;
                add(35 + (d.isHuman(c.id) ? 10 : 0), { kind: 'aid', target: c.id, against: against || null });
            }
        }
        // проигранная агрессия — репарации
        for (const [key, w] of Object.entries(d.un.wars)) {
            if (w.end === null || d.turn - w.end > 6) continue;
            const [a, b] = key.split('|');
            const victim = w.aggressor === a ? b : a;
            if (!alive(w.aggressor) || !alive(victim) || d.un.reparations.some(r => r.from === w.aggressor)) continue;
            const held = cc => Object.values(d.regions).filter(r => r.originalOwner === cc && r.owner === (cc === a ? b : a)).length;
            if (held(w.aggressor) > held(victim)) add(30, { kind: 'reparations', target: w.aggressor, victim });
        }
        if (d.wars.size >= COUNCIL.MIN_WARS) add(20, { kind: 'truce' });
        return items.sort((x, y) => y.pri - x.pri);
    }

    // Главное — чаще всего; иногда ООН берётся за вопрос поменьше.
    static pick(items) {
        if (!items.length) return null;
        if (items.length === 1 || Math.random() < 0.7) return items[0];
        const rest = items.slice(1, 4);
        return rest[Math.floor(Math.random() * rest.length)];
    }

    // --- сессия ---------------------------------------------------------------
    static convene(d, events) {
        if (d.gameOver || d.council || d.turn < COUNCIL.FIRST || (d.turn - COUNCIL.FIRST) % COUNCIL.EVERY) return;
        const item = Council.pick(Council.agenda(d));
        if (item) Council.open(d, item, events);
    }

    // Резолюция на голосовании: людям — решение, всем — весть.
    static open(d, item, events) {
        const council = { kind: item.kind, target: item.target || null, victim: item.victim || null, against: item.against || null, pair: item.pair || null, turn: d.turn + 1, votes: {} };
        if (item.kind === 'nuclear') d.nuclear.council = d.nuclear.council.filter(cc => cc !== item.target);
        if (item.kind === 'condemn') d.un.vetoed = d.un.vetoed.filter(v => v.target !== item.target);
        d.council = council;
        const kind = COUNCIL_KINDS[council.kind];
        const body = kind.body === 'sc' ? 'Совбез ООН' : 'Генассамблея ООН';
        for (const cc of d.humans) {
            const seat = d.seatOf(cc);
            if (!seat || !d.countries[cc].alive || !d.regionsByCountry[cc].length) continue;
            // против себя не голосуют: голос цели — «против», без вопроса
            if (cc === council.target && kind.targeted) {
                council.votes[cc] = false;
                const veto = kind.body === 'sc' && COUNCIL.SC_PERMANENT.includes(cc) ? ' Как постоянный член Совбеза вы наложите вето — резолюция не пройдёт, но её перенесут в Генассамблею.' : '';
                events.push({ type: 'council', for: cc, message: `🇺🇳 ${body} голосует против вас: ${kind.why(d, cc, council)}. ${kind.title(d, council)}.${veto} Итог — в следующем отчёте; склонить других на свою сторону помогут подарки и договоры.` });
                continue;
            }
            if (!Council.canVote(d, cc, council)) continue;
            seat.decisions.push({ type: 'council', from: council.target || council.against || cc, kind: council.kind });
        }
        events.push({ type: 'council', ...(council.target && kind.targeted && d.isHuman(council.target) ? { exceptFor: council.target } : {}), message: `🇺🇳 ${body}: на голосовании — ${kind.title(d, council)}. Итог — в следующем отчёте.` });
    }

    static vote(d, cc, yes) {
        const c = d.council;
        if (!c || !d.isHuman(cc) || d.turn >= c.turn || !Council.canVote(d, cc, c)) return false;
        c.votes[cc] = !!yes;
        return true;
    }

    // Подсчёт: после смены хода, до новой сессии. Заодно — сроки мер ООН.
    static resolve(d, events) {
        Council.upkeep(d, events);
        const c = d.council;
        if (!c || d.turn < c.turn) return null;
        d.council = null;
        const kind = COUNCIL_KINDS[c.kind];
        const gone = cc => cc && !(d.countries[cc] && d.countries[cc].alive);
        if (gone(c.target) || gone(c.against) || (c.pair && c.pair.some(gone))) return null;
        if (c.pair && !d.isAtWar(...c.pair)) return null;

        const sc = kind.body === 'sc';
        let yes = 0, no = 0, count = 0;
        const ayes = [], vetoes = [];
        const voters = Council.voters(d, c);
        for (const cc of voters) {
            const vote = d.isHuman(cc) ? (cc in c.votes ? c.votes[cc] : null) : Council.aiVote(d, cc, c);
            if (vote === null) continue;
            const w = sc ? 1 : Council.weight(d, cc);
            if (vote) { yes += w; ayes.push(cc); } else { no += w; if (sc && COUNCIL.SC_PERMANENT.includes(cc)) vetoes.push(cc); }
            count++;
        }
        const need = Math.ceil(voters.length * COUNCIL.SC_MAJORITY);
        const passed = sc ? yes >= need && !vetoes.length : yes > no;
        const share = yes + no ? Math.round(yes / (yes + no) * 100) : 0;
        const title = kind.title(d, c);
        const body = sc ? 'Совбез ООН' : 'Генассамблея ООН';
        const humanVotes = d.humans.filter(cc => cc in c.votes).map(cc => `${d.countries[cc].name} — ${c.votes[cc] ? 'за' : 'против'}`);
        const tally = sc ? `за — ${yes} из ${voters.length}, нужно ${need}` : `за — ${share}% голосов`;
        const veto = vetoes.length && yes >= need ? ` Вето: ${vetoes.map(cc => d.countries[cc].name).join(', ')}.` : vetoes.length ? ` Против из постоянных: ${vetoes.map(cc => d.countries[cc].name).join(', ')}.` : '';
        events.push({ type: 'council', message: `🇺🇳 ${body} ${passed ? 'принял' : 'отклонил'}: ${title} (${tally}${humanVotes.length ? `; ${humanVotes.join(', ')}` : ''}).${passed ? '' : veto}` });

        d.un.record.push({ turn: d.turn, kind: c.kind, target: c.target || (c.pair && c.pair.join('|')) || null, title, passed, veto: vetoes.length ? vetoes : null });
        if (d.un.record.length > COUNCIL.RECORD_KEPT) d.un.record.shift();
        // вето по мере против агрессора — вопрос уходит в Ассамблею
        if (!passed && sc && vetoes.length && ['sanctions', 'embargo', 'enforce'].includes(c.kind)) {
            d.un.vetoed.push({ target: c.target, victim: c.victim || null, turn: d.turn, by: vetoes[0] });
        }
        if (passed) Council.apply(d, c, ayes, events);
        return { passed, share, ...c };
    }

    static apply(d, c, ayes, events) {
        const name = cc => d.countries[cc].name;
        const t = c.target;
        switch (c.kind) {
        case 'sanctions': case 'nuclear':
            d.sanctions[t] = Math.max(d.sanctions[t] || 0, d.turn + COUNCIL.SANCTION_TURNS);
            for (const cc of ayes) if (cc !== t) Diplomacy.changeRelation(d, cc, t, COUNCIL.YES_RELATION);
            break;
        case 'embargo':
            d.un.embargo[t] = d.turn + COUNCIL.EMBARGO_TURNS;
            for (const cc of ayes) if (cc !== t) Diplomacy.changeRelation(d, cc, t, COUNCIL.YES_RELATION / 2);
            break;
        case 'peacekeepers':
            d.un.peacekeepers[t] = { against: c.against, until: d.turn + COUNCIL.PEACEKEEPING_TURNS };
            for (const cc of ayes) if (cc !== t) Diplomacy.changeRelation(d, cc, t, 5);
            break;
        case 'enforce': {
            // коалиция: соседи агрессора или жертвы из голосовавших «за»
            const around = new Set([...d.neighbourCountries(t), ...(c.victim ? d.neighbourCountries(c.victim) : [])]);
            const coalition = ayes.filter(cc => !d.isHuman(cc) && around.has(cc) && cc !== c.victim && !d.isAtWar(cc, t)
                && !Diplomacy.isAllied(d, cc, t) && d.countries[cc].alive)
                .sort((a, b) => d.calculateMilitaryPower(b) - d.calculateMilitaryPower(a)).slice(0, COUNCIL.ENFORCE_ALLIES);
            for (const cc of coalition) {
                d.wars.set(d.pairKey(cc, t), { start: d.turn, attacker: cc });
                d.truces.delete(d.pairKey(cc, t));
                Council.recordWar(d, cc, t, t);
                Diplomacy.changeRelation(d, cc, t, DIPLOMACY.WAR_RELATION);
            }
            if (c.victim && d.countries[c.victim].alive) d.countries[c.victim].money += 5e6;
            d.sanctions[t] = Math.max(d.sanctions[t] || 0, d.turn + COUNCIL.SANCTION_TURNS);
            events.push({ type: 'council', message: coalition.length
                ? `⚔️ Коалиция ООН против страны ${name(t)}: ${coalition.map(name).join(', ')} вступают в войну на стороне ${c.victim ? `страны ${name(c.victim)}` : 'жертвы'}.`
                : `⚔️ Решение о принуждении страны ${name(t)} к миру принято, но воевать никто не вызвался. Санкции продлены, жертва получила помощь.` });
            for (const cc of d.humans) if (ayes.includes(cc) && cc !== c.victim && !d.isAtWar(cc, t)) events.push({ type: 'council', for: cc, message: `⚔️ Мандат ООН: вы можете объявить войну стране ${name(t)} — это не будет считаться агрессией.` });
            break;
        }
        case 'ceasefire':
            if (d.isAtWar(...c.pair)) d.makePeace(...c.pair);
            break;
        case 'condemn':
            for (const cc of ayes) if (cc !== t) Diplomacy.changeRelation(d, cc, t, COUNCIL.CONDEMN_RELATION);
            d.countries[t].influence = Math.max(0, d.countries[t].influence - COUNCIL.CONDEMN_INFLUENCE);
            break;
        case 'aid': {
            const amount = Council.aidAmount(d, t);
            d.countries[t].money += amount;
            for (const cc of ayes) if (cc !== t) Diplomacy.changeRelation(d, cc, t, 4);
            if (d.isHuman(t)) events.push({ type: 'council', for: t, message: `🤲 Фонд ООН перевёл вам ${Council.money(amount)} гуманитарной помощи.` });
            break;
        }
        case 'reparations':
            d.un.reparations.push({ from: t, to: c.victim, amount: Council.reparation(d, t), left: COUNCIL.REPARATION_TURNS });
            break;
        case 'truce':
            for (const key of [...d.wars.keys()]) {
                const [a, b] = key.split('|');
                if (d.isAtWar(a, b)) d.makePeace(a, b);
            }
            break;
        }
    }

    static aidAmount(d, cc) {
        const lost = Object.values(d.regions).filter(r => r.originalOwner === cc && r.owner !== cc).length;
        return Math.min(COUNCIL.AID_MAX, COUNCIL.AID_PER_REGION * Math.max(2, lost));
    }

    static reparation(d, cc) {
        return Math.max(300000, Math.round(d.countryBalance(cc).tax * COUNCIL.REPARATION_SHARE / 1e5) * 1e5);
    }

    // Каждый ход: выборы, выплаты репараций, сроки санкций и мер.
    static upkeep(d, events) {
        const u = d.un;
        if (!u.seats.length || d.turn >= u.term) Council.elect(d, events);
        for (const [cc, until] of Object.entries(d.sanctions || {})) {
            if (until > d.turn) continue;
            delete d.sanctions[cc];
            events.push({ type: 'council', message: `🇺🇳 Санкции сняты: ${d.countries[cc].name}.` });
        }
        for (const [cc, until] of Object.entries(u.embargo)) {
            if (until > d.turn) continue;
            delete u.embargo[cc];
            events.push({ type: 'council', message: `🇺🇳 Оружейное эмбарго снято: ${d.countries[cc].name}.` });
        }
        for (const [cc, p] of Object.entries(u.peacekeepers)) {
            if (p.until > d.turn && d.countries[cc].alive) continue;
            delete u.peacekeepers[cc];
            events.push({ type: 'council', message: `🪖 Миротворцы ООН покинули страну ${d.countries[cc].name}.` });
        }
        for (const r of u.reparations) {
            const from = d.countries[r.from], to = d.countries[r.to];
            r.left--;
            if (!from.alive || !to.alive) { r.left = 0; continue; }
            const paid = Math.max(0, Math.min(r.amount, Math.round(from.money)));
            from.money -= paid;
            to.money += paid;
            if (paid < r.amount) Diplomacy.changeRelation(d, r.from, r.to, -5);
            if (d.isHuman(r.from)) events.push({ type: 'council', for: r.from, message: `⚖️ Репарации стране ${to.name}: −${Council.money(paid)}${paid < r.amount ? ' (не хватило денег — отношения хуже)' : ''}, осталось выплат: ${r.left}.` });
            if (d.isHuman(r.to)) events.push({ type: 'council', for: r.to, message: `⚖️ Репарации от страны ${from.name}: +${Council.money(paid)}, осталось выплат: ${r.left}.` });
        }
        u.reparations = u.reparations.filter(r => r.left > 0);
    }

    // Миротворцы: приграничные с агрессором области жертвы держатся крепче.
    static peacekeeping(d, region) {
        const p = d.un && d.un.peacekeepers[region.owner];
        if (!p || p.until <= d.turn) return 1;
        return d.getNeighbors(region.id).some(id => d.regions[id] && d.regions[id].owner === p.against) ? COUNCIL.PEACEKEEPING_DEFENSE : 1;
    }

    static describe(d, decision) {
        const c = d.council;
        const kind = COUNCIL_KINDS[decision.kind];
        const open = !!c && c.kind === decision.kind && Council.canVote(d, d.playerCountry, c);
        const info = open ? c : { target: decision.from, victim: decision.from, against: decision.from, pair: [decision.from, decision.from] };
        const sc = kind.body === 'sc';
        const veto = sc && COUNCIL.SC_PERMANENT.includes(d.playerCountry);
        const how = sc
            ? `Совбез: нужно «за» от ${Math.round(COUNCIL.SC_MAJORITY * 100)}% членов и ни одного «против» от постоянных.${veto ? ' Вы — постоянный член: ваше «против» — это вето.' : ''}`
            : `Генассамблея: голосуют все страны, ваш голос весит ${Council.weight(d, d.playerCountry)} (по населению).`;
        return {
            title: `🇺🇳 ${sc ? 'Совбез' : 'Генассамблея'} ООН: ${open ? kind.title(d, c) : 'резолюция'}`,
            text: open ? `${kind.text(d, info)}\n${how} Итог — в отчёте следующего хода.` : '',
            accept: 'Голосовать «за»', decline: veto ? 'Против (вето)' : 'Голосовать «против»',
            open,
        };
    }

    // --- сохранение -----------------------------------------------------------
    static serialize(d) {
        return { council: d.council ? structuredClone(d.council) : null, sanctions: { ...(d.sanctions || {}) }, un: structuredClone(d.un) };
    }

    static valid(x) {
        if (!x || typeof x !== 'object') return false;
        const obj = o => !!o && typeof o === 'object' && !Array.isArray(o);
        const cc = v => v === null || v === undefined || !!CountriesDB[v];
        const c = x.council;
        if (c !== null && (!obj(c) || !COUNCIL_KINDS[c.kind] || !Number.isInteger(c.turn)
            || (COUNCIL_KINDS[c.kind].targeted && !CountriesDB[c.target])
            || (COUNCIL_KINDS[c.kind].victim && (!CountriesDB[c.target] || !CountriesDB[c.against]))
            || (COUNCIL_KINDS[c.kind].pair && !(Array.isArray(c.pair) && c.pair.length === 2 && c.pair.every(p => CountriesDB[p])))
            || !cc(c.victim) || !cc(c.against)
            || !obj(c.votes) || !Object.entries(c.votes).every(([k, v]) => CountriesDB[k] && typeof v === 'boolean'))) return false;
        if (!obj(x.sanctions) || !Object.entries(x.sanctions).every(([k, t]) => CountriesDB[k] && Number.isInteger(t))) return false;
        if (x.un === undefined) return true;
        const u = x.un;
        const turns = o => obj(o) && Object.entries(o).every(([k, t]) => CountriesDB[k] && Number.isInteger(t));
        return obj(u) && Array.isArray(u.seats) && u.seats.every(k => CountriesDB[k]) && Number.isInteger(u.term)
            && obj(u.wars) && Object.entries(u.wars).every(([k, w]) => k.split('|').every(p => CountriesDB[p]) && obj(w) && CountriesDB[w.aggressor] && Number.isInteger(w.start) && (w.end === null || Number.isInteger(w.end)))
            && obj(u.legit) && Object.entries(u.legit).every(([id, k]) => RegionsDB[id] && CountriesDB[k])
            && turns(u.embargo)
            && obj(u.peacekeepers) && Object.entries(u.peacekeepers).every(([k, p]) => CountriesDB[k] && obj(p) && CountriesDB[p.against] && Number.isInteger(p.until))
            && Array.isArray(u.reparations) && u.reparations.every(r => obj(r) && CountriesDB[r.from] && CountriesDB[r.to] && Number.isFinite(r.amount) && Number.isInteger(r.left))
            && Array.isArray(u.vetoed) && u.vetoed.every(v => obj(v) && CountriesDB[v.target] && cc(v.victim) && Number.isInteger(v.turn))
            && Array.isArray(u.record) && u.record.every(r => obj(r) && COUNCIL_KINDS[r.kind] && Number.isInteger(r.turn) && typeof r.title === 'string');
    }

    static restore(d, x) {
        d.council = x && x.council ? structuredClone(x.council) : null;
        d.sanctions = x && x.sanctions ? { ...x.sanctions } : {};
        if (x && x.un) { d.un = structuredClone(x.un); return; }
        // партия до ООН: кто начал идущие войны — из них самих
        d.un = Council.emptyUN();
        for (const [key, war] of d.wars) {
            const [a, b] = key.split('|');
            Council.recordWar(d, a, b, war.attacker);
            d.un.wars[key].start = war.start;
        }
        Council.elect(d);
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Council, COUNCIL, COUNCIL_KINDS };
