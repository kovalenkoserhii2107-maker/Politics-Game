#!/usr/bin/env node
// =====================================================================
// MAP GRIDIFIER v2 — Адаптивна сітка 3x3 SVG-одиниці
// Генерує RegionsDB.js + NeighborsDB.js
// =====================================================================

const fs = require('fs');
const path = require('path');

const SVG_FILE = path.join(__dirname, '..', 'world-map.svg');
const OUTPUT_DIR = path.join(__dirname, '..', 'js');

// Розмір клітинки в SVG-одиницях (3 = ~700-3000 км² залежно від регіону карти)
const CELL_SIZE = 3;
const SVG_W = 1200;
const SVG_H = 800;

// Максимальна кількість регіонів на країну (щоб Росія/Китай не мали 10k)
const MAX_REGIONS_PER_COUNTRY = 80;

// ============================================================
// КОНСТАНТИ: НАЗВИ ТА РЕСУРСИ
// ============================================================
const DIRECTION_NAMES = {
  NW:'Пн.-Зах.',N:'Пн.',NE:'Пн.-Сх.',W:'Зах.',C:'Цент.',E:'Сх.',SW:'Пд.-Зах.',S:'Пд.',SE:'Пд.-Сх.'
};
const COUNTRY_ADJ = {
  UA:'Укр.',PL:'Пол.',BY:'Біл.',RO:'Рум.',MD:'Молд.',SK:'Слов.',HU:'Угор.',RU:'Рос.',
  TR:'Тур.',BG:'Болг.',GE:'Груз.',DE:'Нім.',FR:'Фр.',IT:'Іт.',ES:'Ісп.',CN:'Кит.',
  GB:'Бр.',IN:'Інд.',JP:'Яп.',KZ:'Каз.',IQ:'Ірак.',IR:'Іран.',SA:'Ар.',AT:'Авс.',
  CZ:'Чес.',FI:'Фін.',SE:'Шв.',NO:'Норв.',CH:'Швейц.',PT:'Порт.',GR:'Грец.',RS:'Серб.',
  HR:'Хорв.',BA:'БіГ.',ME:'Чор.',MK:'МК.',AL:'Алб.',SI:'Сл.',EE:'Ест.',LV:'Лат.',
  LT:'Лит.',DK:'Дан.',NL:'Нід.',BE:'Бел.',IE:'Ірл.',AM:'Вірм.',AZ:'Аз.',TJ:'Тадж.',
  UZ:'Узб.',TM:'Туркм.',KG:'Кирг.',AF:'Афг.',PK:'Пак.',NP:'Нп.',BD:'Банг.',MM:'Мян.',
  TH:'Тай.',LA:'Лаос.',KH:'Камб.',VN:'Вєт.',MY:'Мал.',ID:'Індон.',PH:'Філ.',TW:'Тайв.',
  KP:'СК.',KR:'ПК.',MN:'Монг.',LK:'Шр.',KW:'Кув.',QA:'Кат.',OM:'Оман.',YE:'Єм.',
  JO:'Йорд.',SY:'Сир.',LB:'Лів.',IL:'Ізр.',SG:'Сінг.',CY:'Кіпр.',IS:'Ісл.',LU:'Люкс.',
  BH:'Бах.',BT:'Бут.'
};
const TERRAIN = ['рівнина','долина','нагір\'я','лісостеп','степ','поле','плато','узгір\'я','впадина','узбережжя'];
const OIL_CC = {RU:3,KZ:2,IQ:4,IR:4,SA:5,KW:4,QA:4,AZ:3,NO:3,OM:2,LY:3,DZ:2,TM:2};
const INDUSTRIAL = ['DE','FR','GB','RU','CN','JP','KR','IT','PL','CZ','SE','NL','BE','AT'];
const BIG_CC = ['RU','CN','IN','US','BR','ID','CA','AU','KZ'];

function getRegionName(cc, relCol, relRow, totalCols, totalRows) {
  const adj = COUNTRY_ADJ[cc] || cc;
  const relX = totalCols > 1 ? relCol / (totalCols - 1) : 0.5;
  const relY = totalRows > 1 ? relRow / (totalRows - 1) : 0.5;
  const dirH = relX < 0.33 ? 'W' : relX > 0.67 ? 'E' : 'C';
  const dirV = relY < 0.33 ? 'N' : relY > 0.67 ? 'S' : 'C';
  let dir;
  if (dirV==='N') dir = dirH==='C' ? 'N' : (dirH==='W' ? 'NW' : 'NE');
  else if (dirV==='S') dir = dirH==='C' ? 'S' : (dirH==='W' ? 'SW' : 'SE');
  else dir = dirH==='C' ? 'C' : (dirH==='W' ? 'W' : 'E');
  const terrain = TERRAIN[(relCol * 3 + relRow * 7) % TERRAIN.length];
  return dir==='C' ? `${adj} ${terrain}` : `${DIRECTION_NAMES[dir]} ${adj} ${terrain}`;
}

function getResources(cc, relCol, relRow, totalCols, totalRows, seed) {
  const s = (n) => ((Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
  const relY = totalRows > 1 ? relRow / (totalRows - 1) : 0.5;
  const baseOil = OIL_CC[cc] || 0;
  const oil = s(seed*7) < 0.12 ? Math.floor(baseOil * (0.5 + s(seed*13) * 1.5)) : 0;
  const agro = Math.min(99, Math.max(5, Math.floor(15 + 65 * (0.4 + 0.4 * relY))));
  const baseInd = INDUSTRIAL.includes(cc) ? 55 : 18;
  const industry = Math.max(5, Math.floor(baseInd * (0.3 + s(seed*3) * 0.9)));
  const basePop = BIG_CC.includes(cc) ? 1500000 : 450000;
  const population = Math.floor(basePop * (0.3 + s(seed*17) * 1.4));
  return { oil, agro, industry, population };
}


// ============================================================
// ПАРСЕР SVG PATH
// ============================================================
function parseSVGPath(d) {
  const polygons = [];
  let currentPoly = [];
  let cx = 0, cy = 0, startX = 0, startY = 0;
  const tokens = d.replace(/([MmLlHhVvZzCcSsQqTtAa])/g, ' $1 ').trim().split(/[\s,]+/).filter(Boolean);
  let i = 0, cmd = 'M';

  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[MmLlHhVvZzCcSsQqTtAa]$/.test(tok)) { cmd = tok; i++; continue; }

    switch (cmd) {
      case 'M': if (currentPoly.length > 2) polygons.push([...currentPoly]); currentPoly = []; cx = parseFloat(tokens[i]); cy = parseFloat(tokens[i+1]); startX=cx; startY=cy; currentPoly.push([cx,cy]); i+=2; cmd='L'; break;
      case 'm': if (currentPoly.length > 2) polygons.push([...currentPoly]); currentPoly = []; cx+=parseFloat(tokens[i]); cy+=parseFloat(tokens[i+1]); startX=cx; startY=cy; currentPoly.push([cx,cy]); i+=2; cmd='l'; break;
      case 'L': cx=parseFloat(tokens[i]); cy=parseFloat(tokens[i+1]); currentPoly.push([cx,cy]); i+=2; break;
      case 'l': cx+=parseFloat(tokens[i]); cy+=parseFloat(tokens[i+1]); currentPoly.push([cx,cy]); i+=2; break;
      case 'H': cx=parseFloat(tokens[i]); currentPoly.push([cx,cy]); i++; break;
      case 'h': cx+=parseFloat(tokens[i]); currentPoly.push([cx,cy]); i++; break;
      case 'V': cy=parseFloat(tokens[i]); currentPoly.push([cx,cy]); i++; break;
      case 'v': cy+=parseFloat(tokens[i]); currentPoly.push([cx,cy]); i++; break;
      case 'Z': case 'z': if (currentPoly.length > 2) polygons.push([...currentPoly]); currentPoly=[]; cx=startX; cy=startY; i++; break;
      case 'C': cx=parseFloat(tokens[i+4]); cy=parseFloat(tokens[i+5]); currentPoly.push([cx,cy]); i+=6; break;
      case 'c': cx+=parseFloat(tokens[i+4]); cy+=parseFloat(tokens[i+5]); currentPoly.push([cx,cy]); i+=6; break;
      case 'S': cx=parseFloat(tokens[i+2]); cy=parseFloat(tokens[i+3]); currentPoly.push([cx,cy]); i+=4; break;
      case 's': cx+=parseFloat(tokens[i+2]); cy+=parseFloat(tokens[i+3]); currentPoly.push([cx,cy]); i+=4; break;
      case 'Q': cx=parseFloat(tokens[i+2]); cy=parseFloat(tokens[i+3]); currentPoly.push([cx,cy]); i+=4; break;
      case 'q': cx+=parseFloat(tokens[i+2]); cy+=parseFloat(tokens[i+3]); currentPoly.push([cx,cy]); i+=4; break;
      case 'T': cx=parseFloat(tokens[i]); cy=parseFloat(tokens[i+1]); currentPoly.push([cx,cy]); i+=2; break;
      case 't': cx+=parseFloat(tokens[i]); cy+=parseFloat(tokens[i+1]); currentPoly.push([cx,cy]); i+=2; break;
      case 'A': cx=parseFloat(tokens[i+5]); cy=parseFloat(tokens[i+6]); currentPoly.push([cx,cy]); i+=7; break;
      case 'a': cx+=parseFloat(tokens[i+5]); cy+=parseFloat(tokens[i+6]); currentPoly.push([cx,cy]); i+=7; break;
      default: i++; break;
    }
  }
  if (currentPoly.length > 2) polygons.push(currentPoly);
  return polygons;
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n-1; i < n; j = i++) {
    const xi=poly[i][0], yi=poly[i][1], xj=poly[j][0], yj=poly[j][1];
    if (((yi>py) !== (yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi)) inside = !inside;
  }
  return inside;
}

// ============================================================
// ЧИТАЄМО SVG
// ============================================================
console.log('📖 Читаємо SVG...');
const svgRaw = fs.readFileSync(SVG_FILE, 'utf8');
const allPaths = [...svgRaw.matchAll(/<path([^>]*?)(?:\/>|>)/gs)];
console.log(`   Знайдено ${allPaths.length} path-елементів`);

const pathData = {}; // countryCode → [{id, d}]
for (const pm of allPaths) {
  const attrs = pm[1];
  const idMatch = attrs.match(/\bid="([^"]+)"/);
  const dMatch = attrs.match(/\bd="([^"]+)"/);
  if (idMatch && dMatch) {
    const id = idMatch[1];
    const cc = id.split('-')[0];
    if (!pathData[cc]) pathData[cc] = [];
    pathData[cc].push({ id, d: dMatch[1] });
  }
}
console.log(`   Ігрових країн знайдено: ${Object.keys(pathData).length}`);

// ============================================================
// ПАРСИМО ПОЛІГОНИ ТА БУДУЄМО BBOX PER COUNTRY
// ============================================================
console.log('\n🔧 Парсимо полігони...');

// Для кожної країни зберігаємо полігони + bbox
const countryPolygons = {}; // countryCode → [{ poly, minX, maxX, minY, maxY }]
const countryBBox = {};     // countryCode → {minX, maxX, minY, maxY}

let pc = 0;
for (const [cc, paths] of Object.entries(pathData)) {
  pc++;
  if (pc % 10 === 0) process.stdout.write(`\r   ${pc}/${Object.keys(pathData).length}`);

  countryPolygons[cc] = [];
  let gminX=Infinity, gmaxX=-Infinity, gminY=Infinity, gmaxY=-Infinity;

  for (const {d} of paths) {
    try {
      const polys = parseSVGPath(d);
      for (const poly of polys) {
        if (poly.length < 3) continue;
        let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
        for (const [x,y] of poly) {
          if (x<minX) minX=x; if (x>maxX) maxX=x;
          if (y<minY) minY=y; if (y>maxY) maxY=y;
        }
        if (maxX-minX < 0.05 || maxY-minY < 0.05) continue;
        countryPolygons[cc].push({ poly, minX, maxX, minY, maxY });
        if (minX<gminX) gminX=minX; if (maxX>gmaxX) gmaxX=maxX;
        if (minY<gminY) gminY=minY; if (maxY>gmaxY) gmaxY=maxY;
      }
    } catch(e) { /* skip */ }
  }
  if (gminX !== Infinity) {
    countryBBox[cc] = { minX:gminX, maxX:gmaxX, minY:gminY, maxY:gmaxY };
  }
}
console.log(`\n   Країн з полігонами: ${Object.keys(countryPolygons).length}`);

// Тест точки для конкретної країни (тільки її полігони)
function pointInCountry(px, py, cc) {
  const polys = countryPolygons[cc];
  if (!polys) return false;
  for (const {poly, minX, maxX, minY, maxY} of polys) {
    if (px<minX||px>maxX||py<minY||py>maxY) continue;
    if (pointInPolygon(px, py, poly)) return true;
  }
  return false;
}

// ============================================================
// АДАПТИВНА СІТКА — окремо для кожної країни
// ============================================================
console.log('\n🗺️  Генеруємо сіткові регіони...');

const regionDB = {};       // regionId → {name, population, oil, agro, industry}
const regionCenter = {};   // regionId → {cx, cy} (центр клітинки в SVG)
const regionCountry = {};  // regionId → countryCode

// Точки семплювання
const SAMPLES = [[0.2,0.2],[0.5,0.2],[0.8,0.2],[0.2,0.5],[0.5,0.5],[0.8,0.5],[0.2,0.8],[0.5,0.8],[0.8,0.8]];

let totalFound = 0;
const countryCells = {}; // cc → [{col, row}]

for (const [cc, bbox] of Object.entries(countryBBox)) {
  // Адаптивний розмір клітинки: для дрібних країн зменшуємо
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const area = width * height;

  // Визначаємо розмір клітинки для цієї країни
  let cell = CELL_SIZE;
  if (area < 50) cell = 1;        // Мікрокраїни: 1 SVG-одиниця
  else if (area < 200) cell = 2;  // Малі країни (Молдова, ін.)
  else if (area < 500) cell = 3;  // Середні (Польща, Україна)
  else if (area < 2000) cell = 4; // Великі (Іспанія, Іран)
  else cell = 6;                  // Дуже великі (Росія, Китай, Казахстан)

  // Сітка по bbox країни
  const colStart = Math.floor(bbox.minX / cell);
  const colEnd = Math.ceil(bbox.maxX / cell);
  const rowStart = Math.floor(bbox.minY / cell);
  const rowEnd = Math.ceil(bbox.maxY / cell);

  if (!countryCells[cc]) countryCells[cc] = [];

  for (let col = colStart; col <= colEnd; col++) {
    for (let row = rowStart; row <= rowEnd; row++) {
      // Центр клітинки в SVG-координатах
      const cx = col * cell + cell * 0.5;
      const cy = row * cell + cell * 0.5;

      // Швидкий bbox тест
      if (cx < bbox.minX - cell || cx > bbox.maxX + cell) continue;
      if (cy < bbox.minY - cell || cy > bbox.maxY + cell) continue;

      // Голосування: скільки семплів потрапляє в країну
      let hits = 0;
      for (const [ox, oy] of SAMPLES) {
        const px = col * cell + ox * cell;
        const py = row * cell + oy * cell;
        if (pointInCountry(px, py, cc)) hits++;
      }

      if (hits >= 2) {
        countryCells[cc].push({ col, row, cell, cx, cy });
      }
    }
  }
}

// Обмежуємо великі країни до MAX_REGIONS_PER_COUNTRY
for (const [cc, cells] of Object.entries(countryCells)) {
  let finalCells = cells;
  if (cells.length > MAX_REGIONS_PER_COUNTRY) {
    // Рівномірне зрідження: беремо кожну N-ту клітинку (сортовані за позицією)
    const step = cells.length / MAX_REGIONS_PER_COUNTRY;
    finalCells = [];
    for (let i = 0; i < MAX_REGIONS_PER_COUNTRY; i++) {
      finalCells.push(cells[Math.floor(i * step)]);
    }
    console.log(`   ${cc}: ${cells.length} → ${MAX_REGIONS_PER_COUNTRY} регіонів (обмежено)`);
  }

  // Знаходимо bounds для назв
  const cols = finalCells.map(c => c.col);
  const rows = finalCells.map(c => c.row);
  const minCol = Math.min(...cols), maxCol = Math.max(...cols);
  const minRow = Math.min(...rows), maxRow = Math.max(...rows);
  const totalCols = maxCol - minCol + 1;
  const totalRows = maxRow - minRow + 1;

  for (const { col, row, cell, cx, cy } of finalCells) {
    const regionId = `${cc}-G${col}-${row}`;
    const relCol = col - minCol;
    const relRow = row - minRow;
    const name = getRegionName(cc, relCol, relRow, totalCols, totalRows);
    const res = getResources(cc, relCol, relRow, totalCols, totalRows, col * 1000 + row);
    regionDB[regionId] = { name, ...res };
    regionCenter[regionId] = { cx, cy, cell };
    regionCountry[regionId] = cc;
    totalFound++;
  }
}

console.log(`\n✅ Всього регіонів: ${totalFound}`);

// ============================================================
// ============================================================
// NEIGHBORS — просторове зближення (не сіткове, а за центрами)
// ============================================================
console.log('\n🔗 Генеруємо NeighborsDB...');

const regionIds = Object.keys(regionDB);
const neighborsDB = {};
for (const rId of regionIds) neighborsDB[rId] = [];

// Будуємо просторовий індекс по клітинкам
// Два регіони — сусіди якщо їхні центри знаходяться в межах 2 * max(cell1, cell2) один від одного
// і вони або одна і та ж країна, або різні (для атаки)

for (let i = 0; i < regionIds.length; i++) {
  const rId = regionIds[i];
  const c1 = regionCenter[rId];
  const cc1 = regionCountry[rId];

  for (let j = i + 1; j < regionIds.length; j++) {
    const nId = regionIds[j];
    const c2 = regionCenter[nId];
    const cc2 = regionCountry[nId];

    // Максимальна відстань для сусідства
    const maxCell = Math.max(c1.cell, c2.cell);
    const threshold = maxCell * 2.2; // трохи більше однієї діагоналі клітинки

    const dx = Math.abs(c1.cx - c2.cx);
    const dy = Math.abs(c1.cy - c2.cy);

    if (dx > threshold || dy > threshold) continue;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= threshold) {
      neighborsDB[rId].push(nId);
      neighborsDB[nId].push(rId);
    }
  }

  if (i % 200 === 0) process.stdout.write(`\r   ${i}/${regionIds.length}`);
}
console.log(`\n   Сусідства згенеровано`);

// ============================================================
// ЗАПИСУЄМО ФАЙЛИ
// ============================================================
console.log('\n💾 Записуємо файли...');

// Бекапи
const regBackup = path.join(OUTPUT_DIR, 'RegionsDB.backup.js');
const nbBackup = path.join(OUTPUT_DIR, 'NeighborsDB.backup.js');
if (!fs.existsSync(regBackup)) fs.copyFileSync(path.join(OUTPUT_DIR, 'RegionsDB.js'), regBackup);
if (!fs.existsSync(nbBackup)) fs.copyFileSync(path.join(OUTPUT_DIR, 'NeighborsDB.js'), nbBackup);

// RegionsDB.js
let regJs = `// =================================================\n// БАЗА ПРОВІНЦІЙ — Адаптивна сітка (${CELL_SIZE} base SVG-одиниць)\n// Згенеровано: ${new Date().toISOString()}\n// =================================================\nconst RegionsDB = {\n`;
for (const [id, d] of Object.entries(regionDB)) {
  const safeName = d.name.replace(/'/g, "\\'");
  regJs += `    '${id}': { name: '${safeName}', population: ${d.population}, oil: ${d.oil}, agro: ${d.agro}, industry: ${d.industry} },\n`;
}
regJs += '};\n';

// NeighborsDB.js
let nbJs = '// СГЕНЕРОВАНО АВТОМАТИЧНО (Адаптивні сіткові сусіди)\nconst GeneratedNeighbors = {\n';
for (const [id, nbs] of Object.entries(neighborsDB)) {
  nbJs += `    "${id}": [${nbs.map(n=>`"${n}"`).join(', ')}],\n`;
}
nbJs += '};\n';

fs.writeFileSync(path.join(OUTPUT_DIR, 'RegionsDB.js'), regJs, 'utf8');
fs.writeFileSync(path.join(OUTPUT_DIR, 'NeighborsDB.js'), nbJs, 'utf8');

console.log(`   ✅ RegionsDB.js (${(regJs.length/1024).toFixed(0)} КБ)`);
console.log(`   ✅ NeighborsDB.js (${(nbJs.length/1024).toFixed(0)} КБ)`);

// Статистика
const statsByCC = {};
for (const cc of Object.values(regionCountry)) statsByCC[cc] = (statsByCC[cc]||0)+1;
const top = Object.entries(statsByCC).sort((a,b)=>b[1]-a[1]).slice(0,20);

console.log('\n📊 Статистика:');
console.log(`   Всього регіонів: ${regionIds.length}`);
console.log(`   Країн: ${Object.keys(statsByCC).length}`);
console.log('\n   Регіонів по країнах:');
for (const [c,n] of top) console.log(`      ${c.padEnd(6)}: ${n}`);
console.log('\n✅ Готово!');
