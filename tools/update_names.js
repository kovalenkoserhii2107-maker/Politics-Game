const fs = require('fs');

const path = '../js/CountriesDB.js';
let content = fs.readFileSync(path, 'utf8');

const regionNamesInRussian = new Intl.DisplayNames(['ru'], { type: 'region' });

const regex = /'([A-Z]{2})': \{ name: 'Страна [A-Z]{2}',/g;
content = content.replace(regex, (match, cc) => {
    try {
        let name = regionNamesInRussian.of(cc);
        if (!name || name === cc) name = `Страна ${cc}`;
        // Fix some formatting if needed
        return `'${cc}': { name: '${name.replace(/'/g, "\\'")}',`;
    } catch(e) {
        return match;
    }
});

fs.writeFileSync(path, content);
console.log("Updated CountriesDB.js");
