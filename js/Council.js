// =====================================================================
// МИРОВОЙ СОВЕТ
//
// Раз в несколько ходов страны мира голосуют: санкции против главного
// захватчика или всеобщее перемирие. Созыв — в отчёте хода, голосование —
// весь следующий ход, итог — в следующем отчёте. Люди голосуют сами
// (решение «За / Против»), компьютер — по отношениям и выгоде. Голос
// весит по населению под корнем: Китай весомее Молдовы, но не в сто раз.
//
// Санкции режут торговлю страны на мировом рынке и портят её отношения с
// теми, кто голосовал «за». Перемирие заканчивает все войны мира разом.
// =====================================================================
const COUNCIL = {
    FIRST: 8,               // первый созыв
    EVERY: 8,               // потом — раз в столько ходов
    MIN_TAKEN: 3,           // захватчик — от стольких чужих областей
    MIN_WARS: 2,            // перемирие — если в мире столько войн
    SANCTION_TURNS: 6,
    SANCTION_TRADE: 0.6,    // доля торговли под санкциями
    YES_RELATION: -8,       // отношения захватчика с голосовавшими «за»
};

const COUNCIL_KINDS = {
    sanctions: {
        icon: '🚫', targeted: true,
        title: (d, c) => `санкции — ${d.countries[c.target].name}`,
        why: (d, cc) => `вы удерживаете ${Council.regionsWord(Council.taken(d, cc))} других стран`,
        text: (d, c) => `${d.countries[c.target].name} удерживает ${Council.regionsWord(Council.taken(d, c.target))} других стран. Если совет согласится, ${COUNCIL.SANCTION_TURNS} ходов её торговля на мировом рынке упадёт до ${Math.round(COUNCIL.SANCTION_TRADE * 100)}%, а отношения с голосовавшими «за» ухудшатся.`,
    },
    nuclear: {
        icon: '☢️', targeted: true,
        title: (d, c) => `санкции за ядерную программу — ${d.countries[c.target].name}`,
        text: (d, c) => `${d.countries[c.target].name} провела ядерное испытание. Если совет согласится, ${COUNCIL.SANCTION_TURNS} ходов её торговля на мировом рынке упадёт до ${Math.round(COUNCIL.SANCTION_TRADE * 100)}%, а отношения с голосовавшими «за» ухудшатся.`,
        why: (d, cc) => 'вы провели ядерное испытание',
    },
    truce: {
        icon: '🕊️',
        title: () => 'всеобщее перемирие',
        text: d => `В мире идёт войн: ${d.wars.size}. Если совет согласится, все войны закончатся с перемирием на ${RULES.TRUCE_TURNS} ходов — и ваши тоже.`,
    },
};

class Council {
    // 1 область, 3 области, 5 областей
    static regionsWord(n) {
        const m10 = n % 10, m100 = n % 100;
        const word = m10 === 1 && m100 !== 11 ? 'область' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'области' : 'областей';
        return `${n} ${word}`;
    }

    static init(d) {
        d.council = null;       // { kind, target, turn, votes: { cc: true|false } }
        d.sanctions = {};       // cc -> ход, до которого действуют санкции
    }

    static sanctioned(d, cc) { return !!(d.sanctions && d.sanctions[cc] > d.turn); }

    // Сколько областей других суверенных стран держит cc.
    static taken(d, cc) {
        let n = 0;
        for (const id of d.regionsByCountry[cc] || []) {
            const r = d.regions[id];
            if (r.originalOwner !== cc && CountriesDB[r.originalOwner].playable) n++;
        }
        return n;
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

    static weight(d, cc) {
        let pop = 0;
        for (const r of d.getCountryRegions(cc)) pop += r.population;
        return Math.max(1, Math.round(Math.sqrt(pop / 1e6)));
    }

    static voters(d) {
        return Object.values(d.countries).filter(c => c.alive && c.playable && d.regionsByCountry[c.id].length).map(c => c.id);
    }

    // Голос компьютера: true — за, false — против, null — воздержался.
    static aiVote(d, cc, c = d.council) {
        if (COUNCIL_KINDS[c.kind].targeted) {
            const t = c.target;
            if (cc === t || Diplomacy.isAllied(d, cc, t) || Diplomacy.hasDeal(d, cc, t)) return false;
            if (d.isAtWar(cc, t)) return true;
            // прежние ядерные державы берегут свою монополию
            if (c.kind === 'nuclear' && d.nuclear.founders.includes(cc)) return true;
            // соседи боятся захватчика, недруги рады случаю, друзья против,
            // остальным всё равно
            const rel = Diplomacy.relation(d, cc, t);
            if (rel >= 20) return false;
            if (rel <= -10 || d.neighbourCountries(t).includes(cc)) return true;
            return null;
        }
        const enemies = d.enemiesOf(cc);
        if (!enemies.length) return true;
        // сильный в войне мира не хочет, слабый — хочет
        const mine = d.calculateMilitaryPower(cc);
        const theirs = enemies.reduce((sum, e) => sum + d.calculateMilitaryPower(e), 0);
        return mine < theirs;
    }

    // Созыв: после смены хода. Людям — решение, всем — весть.
    static convene(d, events) {
        if (d.gameOver || d.council || d.turn < COUNCIL.FIRST || (d.turn - COUNCIL.FIRST) % COUNCIL.EVERY) return;
        // новая ядерная держава — важнее захватчика
        const rogue = Nuclear.councilTarget(d);
        const target = rogue || Council.aggressor(d);
        let council = null;
        if (target) council = { kind: rogue ? 'nuclear' : 'sanctions', target, turn: d.turn + 1, votes: {} };
        else if (d.wars.size >= COUNCIL.MIN_WARS) council = { kind: 'truce', target: null, turn: d.turn + 1, votes: {} };
        if (!council) return;
        d.council = council;
        const kind = COUNCIL_KINDS[council.kind];
        for (const cc of d.humans) {
            const seat = d.seatOf(cc);
            if (!seat || !d.countries[cc].alive || !d.regionsByCountry[cc].length) continue;
            // против себя не голосуют: голос цели — «против», без вопроса
            if (cc === council.target) {
                council.votes[cc] = false;
                events.push({ type: 'council', for: cc, message: `🏛️ Мировой совет голосует за санкции против вас: ${kind.why(d, cc)}. Ваш голос — «против». Итог — в следующем отчёте; склонить соседей на свою сторону помогут подарки и договоры.` });
                continue;
            }
            seat.decisions.push({ type: 'council', from: council.target || cc, kind: council.kind });
        }
        events.push({ type: 'council', ...(council.target && d.isHuman(council.target) ? { exceptFor: council.target } : {}), message: `🏛️ Мировой совет созван: ${kind.title(d, council)}. Голосование — этот ход, итог — в следующем отчёте.` });
    }

    static vote(d, cc, yes) {
        const c = d.council;
        if (!c || !d.isHuman(cc) || d.turn >= c.turn || cc === c.target) return false;
        c.votes[cc] = !!yes;
        return true;
    }

    // Подсчёт: после смены хода, до нового созыва.
    static resolve(d, events) {
        for (const [cc, until] of Object.entries(d.sanctions || {})) {
            if (until > d.turn) continue;
            delete d.sanctions[cc];
            events.push({ type: 'council', message: `🏛️ Санкции сняты: ${d.countries[cc].name}.` });
        }
        const c = d.council;
        if (!c || d.turn < c.turn) return null;
        d.council = null;
        if (COUNCIL_KINDS[c.kind].targeted && !d.countries[c.target].alive) return null;
        let yes = 0, no = 0;
        const ayes = [];
        for (const cc of Council.voters(d)) {
            const vote = d.isHuman(cc) ? (cc in c.votes ? c.votes[cc] : null) : Council.aiVote(d, cc, c);
            if (vote === null) continue;
            const w = Council.weight(d, cc);
            if (vote) { yes += w; ayes.push(cc); } else no += w;
        }
        const passed = yes > no;
        const share = yes + no ? Math.round(yes / (yes + no) * 100) : 0;
        const title = COUNCIL_KINDS[c.kind].title(d, c);
        const humanVotes = d.humans.filter(cc => cc in c.votes).map(cc => `${d.countries[cc].name} — ${c.votes[cc] ? 'за' : 'против'}`);
        events.push({ type: 'council', message: `🏛️ Совет ${passed ? 'принял' : 'отклонил'}: ${title}. За — ${share}% голосов${humanVotes.length ? ` (${humanVotes.join(', ')})` : ''}.` });
        if (!passed) return { passed, share, ...c };
        if (COUNCIL_KINDS[c.kind].targeted) {
            d.sanctions[c.target] = Math.max(d.sanctions[c.target] || 0, d.turn + COUNCIL.SANCTION_TURNS);
            for (const cc of ayes) if (cc !== c.target) Diplomacy.changeRelation(d, cc, c.target, COUNCIL.YES_RELATION);
        } else {
            for (const key of [...d.wars.keys()]) {
                const [a, b] = key.split('|');
                if (d.isAtWar(a, b)) d.makePeace(a, b);
            }
        }
        return { passed, share, ...c };
    }

    static describe(d, decision) {
        const c = d.council;
        const kind = COUNCIL_KINDS[decision.kind];
        return {
            title: `🏛️ Мировой совет: ${kind.title(d, { target: decision.from })}`,
            text: `${kind.text(d, { target: decision.from })} Ваш голос весит ${Council.weight(d, d.playerCountry)} (по населению). Итог — в отчёте следующего хода.`,
            accept: 'Голосовать «за»', decline: 'Голосовать «против»',
            open: !!c && c.kind === decision.kind && c.target !== d.playerCountry,
        };
    }

    static serialize(d) {
        return { council: d.council ? structuredClone(d.council) : null, sanctions: { ...(d.sanctions || {}) } };
    }

    static valid(x) {
        if (!x || typeof x !== 'object') return false;
        const c = x.council;
        if (c !== null && (typeof c !== 'object' || !COUNCIL_KINDS[c.kind] || !Number.isInteger(c.turn)
            || (COUNCIL_KINDS[c.kind].targeted && !CountriesDB[c.target]) || !c.votes || typeof c.votes !== 'object'
            || !Object.entries(c.votes).every(([cc, v]) => CountriesDB[cc] && typeof v === 'boolean'))) return false;
        return !!x.sanctions && typeof x.sanctions === 'object' && Object.entries(x.sanctions).every(([cc, t]) => CountriesDB[cc] && Number.isInteger(t));
    }

    static restore(d, x) {
        d.council = x && x.council ? structuredClone(x.council) : null;
        d.sanctions = x && x.sanctions ? { ...x.sanctions } : {};
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Council, COUNCIL, COUNCIL_KINDS };
