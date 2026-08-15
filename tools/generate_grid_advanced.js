const fs = require('fs');
const path = require('path');
const { DOMParser } = require('xmldom');
const turf = require('@turf/turf');

const SVG_FILE = path.join(__dirname, '..', 'world-map.svg');
const CITIES_FILE = path.join(__dirname, '..', 'js', 'CitiesDB.js');
const COUNTRIES_FILE = path.join(__dirname, '..', 'js', 'CountriesDB.js');
const OUTPUT_REGIONS = path.join(__dirname, '..', 'js', 'RegionsDB.js');

const CELL_SIZE = 3; 

function loadCities() {
    const content = fs.readFileSync(CITIES_FILE, 'utf8');
    const match = content.match(/const CitiesDB = (\[.*?\]);/s);
    if (match) return eval(match[1]);
    return [];
}

// Naive path parser for point-in-polygon tests (ignores curves, which is fine for dense grids)
function parseSVGPathToPolygons(d) {
    const polygons = [];
    let currentPoly = [];
    const tokens = d.replace(/([MmLlHhVvZzCcSsQqTtAa])/g, ' $1 ').trim().split(/[\s,]+/).filter(Boolean);
    let i = 0, cmd = 'M', cx = 0, cy = 0, startX = 0, startY = 0;

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
            // For curves, just use the end point (rough but fast)
            case 'C': cx=parseFloat(tokens[i+4]); cy=parseFloat(tokens[i+5]); currentPoly.push([cx,cy]); i+=6; break;
            case 'c': cx+=parseFloat(tokens[i+4]); cy+=parseFloat(tokens[i+5]); currentPoly.push([cx,cy]); i+=6; break;
            case 'S': case 'Q': cx=parseFloat(tokens[i+2]); cy=parseFloat(tokens[i+3]); currentPoly.push([cx,cy]); i+=4; break;
            case 's': case 'q': cx+=parseFloat(tokens[i+2]); cy+=parseFloat(tokens[i+3]); currentPoly.push([cx,cy]); i+=4; break;
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
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

function pointInCountry(px, py, polygons) {
    for (const poly of polygons) {
        if (pointInPolygon(px, py, poly)) return true;
    }
    return false;
}

function generate() {
    console.log('Loading SVG...');
    const svgRaw = fs.readFileSync(SVG_FILE, 'utf8');
    const doc = new DOMParser().parseFromString(svgRaw, 'image/svg+xml');
    const paths = Array.from(doc.getElementsByTagName('path'));
    
    const countryPolygons = {}; // cc -> array of polygons
    const countryBBoxes = {}; // cc -> [minX, minY, maxX, maxY]
    const oldPathsBounds = {}; 

    paths.forEach(p => {
        const id = p.getAttribute('id');
        const d = p.getAttribute('d');
        if (!id || !d) return;

        const cc = id.split('-')[0];
        const polys = parseSVGPathToPolygons(d);
        if (polys.length === 0) return;

        if (!countryPolygons[cc]) {
            countryPolygons[cc] = [];
            countryBBoxes[cc] = [Infinity, Infinity, -Infinity, -Infinity];
        }

        let cx = 0, cy = 0, pts = 0;

        polys.forEach(poly => {
            countryPolygons[cc].push(poly);
            poly.forEach(pt => {
                cx += pt[0]; cy += pt[1]; pts++;
                if (pt[0] < countryBBoxes[cc][0]) countryBBoxes[cc][0] = pt[0];
                if (pt[1] < countryBBoxes[cc][1]) countryBBoxes[cc][1] = pt[1];
                if (pt[0] > countryBBoxes[cc][2]) countryBBoxes[cc][2] = pt[0];
                if (pt[1] > countryBBoxes[cc][3]) countryBBoxes[cc][3] = pt[1];
            });
        });

        oldPathsBounds[id] = [cx / pts, cy / pts]; // Approximate center
    });

    console.log(`Parsed ${Object.keys(countryPolygons).length} countries.`);

    const cities = loadCities();
    cities.forEach(city => {
        if (oldPathsBounds[city.regionId]) {
            city.x = oldPathsBounds[city.regionId][0] + (city.offsetX || 0);
            city.y = oldPathsBounds[city.regionId][1] + (city.offsetY || 0);
        }
    });

    const finalRegions = {};

    Object.keys(countryPolygons).forEach(cc => {
        const bbox = countryBBoxes[cc];
        const polys = countryPolygons[cc];
        const width = bbox[2] - bbox[0];
        const height = bbox[3] - bbox[1];
        
        if (width < CELL_SIZE * 2 && height < CELL_SIZE * 2) {
            // Small country, 1 region
            const cx = bbox[0] + width / 2;
            const cy = bbox[1] + height / 2;
            const geom = turf.polygon([[[cx-1, cy-1], [cx+1, cy-1], [cx+1, cy+1], [cx-1, cy+1], [cx-1, cy-1]]]);
            finalRegions[`${cc}-1`] = { geom: geom, cc: cc };
            return;
        }

        const startX = Math.floor(bbox[0] / CELL_SIZE) * CELL_SIZE;
        const startY = Math.floor(bbox[1] / CELL_SIZE) * CELL_SIZE;
        const endX = Math.ceil(bbox[2] / CELL_SIZE) * CELL_SIZE;
        const endY = Math.ceil(bbox[3] / CELL_SIZE) * CELL_SIZE;

        const cells = [];
        for (let x = startX; x < endX; x += CELL_SIZE) {
            for (let y = startY; y < endY; y += CELL_SIZE) {
                // Monte Carlo sampling (3x3 points within the cell)
                let insideCount = 0;
                for (let i = 1; i <= 3; i++) {
                    for (let j = 1; j <= 3; j++) {
                        const px = x + (CELL_SIZE * i / 4);
                        const py = y + (CELL_SIZE * j / 4);
                        if (pointInCountry(px, py, polys)) insideCount++;
                    }
                }

                if (insideCount > 0) {
                    const areaPct = insideCount / 9;
                    const cellPoly = turf.polygon([[[x, y], [x + CELL_SIZE, y], [x + CELL_SIZE, y + CELL_SIZE], [x, y + CELL_SIZE], [x, y]]]);
                    cells.push({
                        id: `${cc}-G${x/CELL_SIZE}-${y/CELL_SIZE}`,
                        geom: cellPoly,
                        areaPct: areaPct,
                        cx: x + CELL_SIZE/2, cy: y + CELL_SIZE/2
                    });
                }
            }
        }

        // Merge small slivers (< 30% area)
        const validCells = [];
        const slivers = [];
        cells.forEach(c => {
            if (c.areaPct < 0.3) slivers.push(c);
            else validCells.push(c);
        });

        slivers.forEach(sliver => {
            let closest = null;
            let minDist = Infinity;
            validCells.forEach(vc => {
                const dist = Math.hypot(vc.cx - sliver.cx, vc.cy - sliver.cy);
                if (dist < minDist) { minDist = dist; closest = vc; }
            });

            if (closest) {
                try {
                    closest.geom = turf.union(turf.featureCollection([closest.geom, sliver.geom]));
                } catch(e) {}
            } else {
                validCells.push(sliver);
            }
        });

        validCells.forEach((c, idx) => {
            c.id = `${cc}-G${idx}`;
            finalRegions[c.id] = { geom: c.geom, cc: cc };
        });
    });

    console.log(`Generated ${Object.keys(finalRegions).length} regions.`);

    function coordToSVG(coord) {
        if (!coord || coord.length === 0) return '';
        let d = `M ${coord[0][0].toFixed(1)},${coord[0][1].toFixed(1)}`;
        for (let i = 1; i < coord.length; i++) {
            d += ` L ${coord[i][0].toFixed(1)},${coord[i][1].toFixed(1)}`;
        }
        d += ' Z';
        return d;
    }

    function geomToSVG(geom) {
        let pathData = '';
        if (geom.geometry.type === 'Polygon') {
            geom.geometry.coordinates.forEach(ring => { pathData += coordToSVG(ring) + ' '; });
        } else if (geom.geometry.type === 'MultiPolygon') {
            geom.geometry.coordinates.forEach(poly => {
                poly.forEach(ring => { pathData += coordToSVG(ring) + ' '; });
            });
        }
        return pathData.trim();
    }

    let dbContent = `// СГЕНЕРИРОВАНО АВТОМАТИЧЕСКИ (Fast Grid)\nconst RegionsDB = {\n`;
    let count = 0;
    
    Object.keys(finalRegions).forEach(id => {
        const r = finalRegions[id];
        
        let assignedCity = null;
        for (let city of cities) {
            if (city.x && city.y && city.regionId.startsWith(r.cc)) {
                try {
                    if (turf.booleanPointInPolygon(turf.point([city.x, city.y]), r.geom)) {
                        assignedCity = city;
                        break;
                    }
                } catch(e) {}
            }
        }
        
        const name = assignedCity ? assignedCity.name : `${r.cc} Регіон ${count++}`;
        const pathData = geomToSVG(r.geom);
        const pop = Math.floor(200000 + Math.random() * 800000);
        const agro = Math.floor(10 + Math.random() * 60);
        const ind = Math.floor(5 + Math.random() * 30);
        
        dbContent += `  '${id}': { name: '${name.replace(/'/g, "\\'")}', population: ${pop}, agro: ${agro}, industry: ${ind}, oil: 0, pathData: '${pathData}' },\n`;
    });
    
    dbContent += `};\n`;
    fs.writeFileSync(OUTPUT_REGIONS, dbContent);
    console.log('Finished writing RegionsDB.js!');
}

generate();
