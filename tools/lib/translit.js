'use strict';
// Сопоставление русских названий городов (js/CitiesDB.js) с латинскими
// из all-the-cities: транслитерация в общий «скелет» + нечёткое сравнение.

const RU_LAT = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i',
    'й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
    'у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sh','ъ':'','ы':'i','ь':'',
    'э':'e','ю':'u','я':'a','і':'i','ї':'i','є':'e','ґ':'g',
};

function translit(s) {
    let out = '';
    for (const ch of s.toLowerCase()) out += RU_LAT[ch] !== undefined ? RU_LAT[ch] : (/[a-z]/.test(ch) ? ch : ' ');
    return out;
}

// Приводим латиницу к тому же скелету: убираем диакритику и варианты записи.
function skeleton(s) {
    let t = s.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z ]/g, ' ');
    t = t
        .replace(/kh/g, 'h').replace(/ph/g, 'f').replace(/ck/g, 'k')
        .replace(/sch/g, 'sh').replace(/shch/g, 'sh')
        .replace(/ts/g, 'c').replace(/tz/g, 'c').replace(/z/g, 'z')
        .replace(/j/g, 'i').replace(/y/g, 'i').replace(/w/g, 'v')
        .replace(/x/g, 'ks').replace(/q/g, 'k')
        .replace(/(.)\1+/g, '$1')
        .replace(/\s+/g, ' ').trim();
    return t;
}

function norm(s) {
    return skeleton(s.startsWith('_') ? s.slice(1) : s);
}

function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    const cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur.slice();
    }
    return prev[n];
}

function similarity(a, b) {
    if (!a || !b) return 0;
    const d = levenshtein(a, b);
    return 1 - d / Math.max(a.length, b.length);
}

// Скелет русского названия и скелет латинского приводятся одинаково.
function ruSkeleton(ru) { return skeleton(translit(ru)); }

// Лучшее соответствие латинского имени среди русских кандидатов.
function bestMatch(latinName, ruCandidates, minScore = 0.62) {
    const target = norm(latinName);
    let best = null, bestScore = 0;
    for (const ru of ruCandidates) {
        const s = similarity(target, ruSkeleton(ru));
        if (s > bestScore) { bestScore = s; best = ru; }
    }
    return bestScore >= minScore ? { name: best, score: bestScore } : null;
}

module.exports = { translit, skeleton, ruSkeleton, similarity, bestMatch };
