// =====================================================================
// ЦЕЛЬ ПАРТИИ И СЧЁТ
//
// Счёт державы — земли, люди, экономика, наука и армия. Большие величины
// сжаты корнем, чтобы Китай не выигрывал у Молдовы одним размером. В
// партиях «на время» побеждает тот, чей счёт больше всех вырос с начала:
// так маленькая страна на равных спорит с большой.
// =====================================================================
const GOALS = {
    domination: { name: 'Мировое господство', short: 'Господство', text: 'Победа — все области суверенных стран под одним флагом.' },
    turns30: { name: 'Партия на 30 ходов', short: '30 ходов', turns: 30, text: 'Через 30 ходов побеждает тот, чья держава выросла сильнее всех: земли, люди, экономика, наука, армия.' },
    turns60: { name: 'Партия на 60 ходов', short: '60 ходов', turns: 60, text: 'Через 60 ходов побеждает тот, чья держава выросла сильнее всех.' },
    coop: { name: 'Вместе против мира', short: 'Вместе', share: 0.2, multiplayer: true, text: 'Все игроки — одна команда. Победа, когда вместе держите пятую часть областей мира.' },
};

const SCORE_PARTS = {
    land: { name: 'Земли', icon: '🚩' },
    people: { name: 'Люди', icon: '👥' },
    economy: { name: 'Экономика', icon: '💰' },
    science: { name: 'Наука', icon: '🔬' },
    army: { name: 'Армия', icon: '🪖' },
};

class Score {
    static parts(d, cc) {
        const c = d.countries[cc];
        const regions = d.regionsByCountry[cc] ? d.regionsByCountry[cc].length : 0;
        if (!c || !c.alive || !regions) return { land: 0, people: 0, economy: 0, science: 0, army: 0 };
        let pop = 0;
        for (const region of d.getCountryRegions(cc)) pop += region.population;
        const tax = Math.max(0, d.countryBalance(cc).tax) / 1e6;
        let steps = 0;
        for (const unitId of Object.keys(UnitsDB)) steps += (c.tech[unitId] || 1) - 1;
        return {
            land: regions * 10,
            people: Math.round(Math.sqrt(pop / 1e6) * 6),
            economy: Math.round(Math.sqrt(tax) * 12 + Math.sqrt(Math.max(0, c.money) / 1e6) * 2),
            science: (c.techs || []).length * 10 + steps,
            army: Math.round(Math.sqrt(Math.max(0, d.calculateMilitaryPower(cc))) * 2),
        };
    }

    static total(d, cc) {
        const p = Score.parts(d, cc);
        return p.land + p.people + p.economy + p.science + p.army;
    }

    // Отметка счёта в начале партии — от неё считается рост.
    static init(d) {
        d.scoreStart = {};
        for (const cc of Object.keys(d.countries)) {
            if (d.countries[cc].playable && d.regionsByCountry[cc].length) d.scoreStart[cc] = Score.total(d, cc);
        }
    }

    static gain(d, cc) {
        const start = d.scoreStart && d.scoreStart[cc];
        return Score.total(d, cc) - (Number.isFinite(start) ? start : 0);
    }

    // Таблица: люди всегда, из остальных — самые растущие. Счёт считаем не
    // для всех двухсот стран: сначала отбираем крупных по числу областей.
    static ranking(d, limit = 8) {
        const humans = d.humans.filter(cc => d.countries[cc]);
        const others = Object.keys(d.scoreStart || {})
            .filter(cc => !d.isHuman(cc) && d.countries[cc].alive)
            .sort((a, b) => d.regionsByCountry[b].length - d.regionsByCountry[a].length)
            .slice(0, 30);
        const rows = [...humans, ...others].map(cc => ({ cc, total: Score.total(d, cc), gain: Score.gain(d, cc), human: d.isHuman(cc) }));
        rows.sort((a, b) => b.gain - a.gain || b.total - a.total);
        const shown = rows.filter((r, i) => r.human || i < limit);
        return shown.map(r => ({ ...r, place: rows.indexOf(r) + 1 }));
    }

    // Доля областей суверенных стран у людей — для совместной цели.
    static humanShare(d) {
        let total = 0, held = 0;
        for (const region of Object.values(d.regions)) {
            if (!CountriesDB[region.originalOwner].playable) continue;
            total++;
            if (d.isHuman(region.owner)) held++;
        }
        return total ? held / total : 0;
    }

    // Конец партии по цели. Вызывается после смены хода.
    static checkEnd(d, events) {
        if (d.gameOver) return;
        const goal = GOALS[d.goal] || GOALS.domination;
        const alive = d.humans.filter(cc => d.countries[cc].alive);
        if (goal.share) {
            if (Score.humanShare(d) >= goal.share) {
                d.gameOver = true;
                d.outcome = 'victory';
                d.winner = 'team';
                events.push({ message: `🏆 Вместе вы держите ${Math.round(goal.share * 100)}% областей мира. Общая победа!` });
            }
            return;
        }
        if (!goal.turns || d.turn < goal.turns || !alive.length) return;
        // в сетевой игре соревнуются люди, в одиночной — со всем миром
        const pool = d.multiplayer ? alive : Object.keys(d.scoreStart || {}).filter(cc => d.countries[cc].alive);
        let best = null, bestGain = -Infinity;
        for (const cc of pool) {
            const g = Score.gain(d, cc);
            if (g > bestGain) { best = cc; bestGain = g; }
        }
        d.gameOver = true;
        d.winner = best;
        d.outcome = d.isHuman(best) ? 'victory' : 'defeat';
        events.push({ message: `🏁 Партия окончена. Больше всех выросла ${d.countries[best].name}: +${bestGain} очков.` });
    }

    // Итог глазами игрока cc — для экрана конца партии.
    static verdict(d, cc) {
        const goal = GOALS[d.goal] || GOALS.domination;
        const name = d.countries[cc].name;
        if (d.winner === 'team') return { victory: true, title: 'Общая победа', text: `Вместе вы удержали ${Math.round(goal.share * 100)}% областей мира на ${d.turn}-м ходу.` };
        if (goal.turns && d.winner) {
            const rows = Score.ranking(d, 3);
            const mine = rows.find(r => r.cc === cc);
            const victory = d.winner === cc;
            const winner = d.countries[d.winner].name;
            return {
                victory,
                title: victory ? 'Победа!' : 'Партия окончена',
                text: victory
                    ? `${name} выросла сильнее всех за ${goal.turns} ходов: +${mine ? mine.gain : 0} очков.`
                    : `Победила ${winner}. ${name}: ${mine ? `${mine.place}-е место, +${mine.gain} очков` : 'выбыла'}.`,
            };
        }
        if (d.winner && d.winner !== cc) return { victory: false, title: 'Мировое господство', text: `${d.countries[d.winner].name} объединила мир под своим флагом на ${d.turn}-м ходу.` };
        if (d.winner === cc || (d.outcome === 'victory' && !d.winner)) {
            return { victory: true, title: 'Мировое господство', text: `${name}: все ${d.campaignProgress(cc).total} областей суверенных стран под вашим управлением. Победа на ${d.turn}-м ходу${d.cheatMode ? ' в режиме бога' : ''}.` };
        }
        return { victory: false, title: 'Кампания завершена', text: `${name} потеряла все области на ${d.turn}-м ходу. Попробуйте другой экономический курс или другую страну.` };
    }

    static valid(start) {
        return !!start && typeof start === 'object'
            && Object.entries(start).every(([cc, v]) => CountriesDB[cc] && Number.isFinite(v));
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Score, GOALS, SCORE_PARTS };
