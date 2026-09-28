// =====================================================================
// КАРТА: отрисовка областей, камера, подписи, маркеры
//
// Вся геометрия приходит из RegionsDB (готовые path и центры cx/cy),
// поэтому getBBox не вызывается ни разу — нет принудительных пересчётов
// раскладки и рывков при перерисовке.
// =====================================================================
class MapEngine {
    constructor(gameData, onRegionClick) {
        this.container = document.getElementById('map-container');
        this.svg = document.getElementById('world-map');
        this.data = gameData;
        this.onRegionClick = onRegionClick;

        // Камера задаётся через viewBox, а не CSS-трансформом: iOS Safari
        // растрирует трансформированный слой один раз и потом растягивает
        // битмап, из-за чего карта на телефоне выглядит размытой.
        this.scale = 3;          // во сколько раз ближе, чем «весь мир на экране»
        this.camX = 0;           // левый верхний угол видимой области, единицы карты
        this.camY = 0;
        this.isDragging = false;
        this.wasDragging = false;
        // Ступени детализации задаются шириной обзора в единицах карты, а не
        // кратностью зума: одна и та же кратность на телефоне показывает втрое
        // больше карты, чем на десктопе, поэтому по кратности пороги «плывут».
        // Для справки: Украина ~28 единиц в ширину, Германия ~13, Молдова ~4.
        // Подписи и игровое взаимодействие разведены: названия стран уступают
        // место названиям областей рано, но клик по области и маркеры войск
        // работают с гораздо более дальнего плана.
        this.countryLabelView = 30;  // шире этого — подписи стран
        this.cityLabelView = 13;     // уже этого — подписи городов
        this.interactiveView = 55;   // уже этого — клик выбирает область, а не страну
        this.minView = 6;          // предел приближения
        this.maxView = 900;        // предел отдаления (мир ~833 единицы)

        this.paths = new Map();       // regionId -> <path>
        this.selection = new Set();
        this.regionLabels = [];
        this.countryLabels = [];
        // Что можно не рисовать, когда оно за краем экрана
        this.cullRegions = [];
        this.cullLabels = [];
        this.cullCities = [];
        this.cullBadges = [];
        this.badges = [];

        this.buildLayers();
        this.initEvents();
        this.centerOnPlayer();
        this.refreshColors();
        this.createRegionLabels();
        this.createCountryLabels();
        this.drawCities();
        this.drawArmyMarkers();
        this.drawOrders();
        this.updateLOD();
        document.addEventListener('ordersChanged', () => this.drawOrders());
    }

    // Сколько единиц карты укладывается по ширине экрана.
    get viewWidth() {
        if (!this.rect) return 1200;
        return this.rect.width / this.pxPerUnit;
    }

    get isRegionalZoom() { return this.viewWidth <= this.interactiveView; }

    // Ступень подписей: страны -> области -> города.
    get detailLevel() {
        const w = this.viewWidth;
        if (w > this.countryLabelView) return 0;
        return w > this.cityLabelView ? 1 : 2;
    }

    // --- построение слоёв -------------------------------------------
    buildLayers() {
        this.svg.innerHTML = '';
        const g = tag => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            el.setAttribute('id', tag);
            this.svg.appendChild(el);
            return el;
        };
        // море — под сушей: суша прячет стыки клеток у берега, видна только вода
        this.seaZoneLayer = g('layer-sea-zones');
        this.regionLayer = g('layer-regions');
        this.borderLayer = g('layer-borders');
        this.falloutLayer = g('layer-fallout');   // штриховка заражённых областей
        this.cityLayer = g('layer-cities');
        this.regionLabelLayer = g('layer-region-labels');
        this.labelLayer = g('layer-labels');
        this.orderLayer = g('layer-orders');
        this.seaLayer = g('layer-seas');
        this.portLayer = g('layer-ports');
        this.armyLayer = g('layer-armies');
        this.fleetLayer = g('layer-fleets');
        this.straitLayer = g('layer-straits');
        this.seaZones = new Map();
        this.fleetTargets = null;

        // Наконечники стрел приказов. markerUnits=strokeWidth — наконечник
        // масштабируется вместе с линией, толщина которой постоянна на экране.
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = [['attack', '#ff3b2f'], ['move', '#eceef1'], ['sea', '#7fc4ff']].map(([kind, color]) =>
            `<marker id="arrow-${kind}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto" markerUnits="strokeWidth">`
            + `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`).join('')
            // косая штриховка заражения; шаг держим постоянным на экране (setStrokeScale)
            + '<pattern id="fallout-hatch" patternUnits="userSpaceOnUse" width="1" height="1" patternTransform="rotate(45)">'
            + '<rect class="hatch-line" x="0" y="0" width="0.35" height="1"/></pattern>';
        this.svg.insertBefore(defs, this.svg.firstChild);
        this.changed = [];

        const fragment = document.createDocumentFragment();
        for (const id of Object.keys(RegionsDB)) {
            const region = this.data.getRegion(id);
            if (!region) continue;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', RegionsDB[id].path);
            path.setAttribute('class', 'region');
            path.dataset.region = id;
            fragment.appendChild(path);
            this.paths.set(id, path);
            const info = RegionsDB[id];
            this.cullRegions.push({ el: path, x: info.bx, y: info.by, w: info.bw, h: info.bh, vis: true });
        }
        this.regionLayer.appendChild(fragment);

        // Границы государств: общий участок соседних областей виден, когда
        // у них разные хозяева (refreshColors). Заливка стран без обводки
        // иначе сливается на общем плане.
        this.borders = [];
        if (typeof BordersDB !== 'undefined') {
            const lines = document.createDocumentFragment();
            for (const [a, b, d] of BordersDB) {
                if (!this.paths.has(a) || !this.paths.has(b)) continue;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', d);
                lines.appendChild(path);
                this.borders.push({ el: path, a, b, on: false });
            }
            this.borderLayer.appendChild(lines);
        }
    }

    // --- выделение ---------------------------------------------------
    clearSelection() {
        if (this.selectedSea) { this.seaZones.get(this.selectedSea)?.classList.remove('selected'); this.selectedSea = null; }
        for (const id of this.selection) {
            const path = this.paths.get(id);
            if (path) path.classList.remove('selected-region', 'selected-country');
        }
        this.selection.clear();
    }

    selectRegion(regionId) {
        this.clearSelection();
        const path = this.paths.get(regionId);
        if (!path) return;
        path.classList.add('selected-region');
        this.selection.add(regionId);
    }

    selectSea(zone) {
        this.clearSelection();
        const path = this.seaZones.get(zone);
        if (!path) return;
        path.classList.add('selected');
        this.selectedSea = zone;
    }

    selectCountry(countryId) {
        this.clearSelection();
        for (const region of this.data.getCountryRegions(countryId)) {
            const path = this.paths.get(region.id);
            if (!path) continue;
            path.classList.add('selected-country');
            this.selection.add(region.id);
        }
    }

    updateLOD() {
        this.svg.classList.toggle('regional-view', this.isRegionalZoom);
        this.svg.classList.toggle('global-view', !this.isRegionalZoom);
        this.applyDetail();
        this.clearHover();
    }

    applyDetail() {
        const level = this.detailLevel;
        if (this.lastDetail === level) return;
        this.lastDetail = level;
        this.svg.classList.remove('lod-0', 'lod-1', 'lod-2');
        this.svg.classList.add('lod-' + level);
    }

    clearHover() {
        if (!this.hovered) return;
        for (const path of this.hovered) path.classList.remove('country-hover');
        this.hovered = null;
    }

    // --- раскраска ----------------------------------------------------
    refreshColors() {
        const player = this.data.playerCountry;
        const enemies = new Set(this.data.enemiesOf(player));
        const targets = new Set(this.data.visibleOperations ? this.data.visibleOperations().map(o => o.target) : []);
        for (const [id, path] of this.paths) {
            const region = this.data.getRegion(id);
            if (!region) continue;
            const country = this.data.getCountry(region.owner);
            if (!country) continue;
            if (path.dataset.country !== region.owner) {
                path.dataset.country = region.owner;
                path.style.fill = country.color;
                path.style.stroke = country.color;
            }
            // территория противника обведена красным — фронт видно сразу
            path.classList.toggle('enemy', enemies.has(region.owner));
            path.classList.toggle('own', region.owner === player);
            path.classList.toggle('revolt', !!(this.data.revolts && this.data.revolts[id]));
            path.classList.toggle('operation', targets.has(id));
            path.classList.toggle('fallout', Nuclear.fallout(this.data, id));
        }
        this.drawFallout();
        for (const line of this.borders || []) {
            const on = this.data.getRegion(line.a).owner !== this.data.getRegion(line.b).owner;
            if (on !== line.on) { line.on = on; line.el.classList.toggle('on', on); }
        }
        this.drawArmyMarkers();
    }

    // --- камера --------------------------------------------------------
    // Одна единица карты = pxPerUnit экранных пикселей.
    measure() {
        const rect = this.container.getBoundingClientRect();
        this.rect = rect;
        this.baseScale = Math.min(rect.width / 1200, rect.height / 800) || 1;
        return rect;
    }

    get pxPerUnit() { return this.baseScale * this.scale; }

    clientToMap(clientX, clientY) {
        const k = this.pxPerUnit;
        return {
            x: this.camX + (clientX - this.rect.left) / k,
            y: this.camY + (clientY - this.rect.top) / k,
        };
    }

    centerOnPlayer(animated = false) {
        this.measure();
        const regions = this.data.getCountryRegions(this.data.playerCountry);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const region of regions) {
            const bounds = RegionsDB[region.id];
            minX = Math.min(minX, bounds.bx); maxX = Math.max(maxX, bounds.bx + bounds.bw);
            minY = Math.min(minY, bounds.by); maxY = Math.max(maxY, bounds.by + bounds.bh);
        }
        if (minX === Infinity) { minX = 560; minY = 200; maxX = 640; maxY = 260; }

        // Страна должна занять примерно 80% экрана по узкой стороне.
        const spanX = Math.max(maxX - minX, 4);
        const spanY = Math.max(maxY - minY, 4);
        const aspect = this.rect.height / this.rect.width;
        const wantView = Math.max(spanX / 0.8, (spanY / 0.8) / aspect);
        const view = Math.min(Math.max(wantView, this.minView), this.maxView);
        const scale = this.rect.width / (view * this.baseScale);
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        if (animated) {
            const safe = this.safeRect();
            this.animateTo({ x: cx, y: cy }, { x: (safe.left + safe.right) / 2, y: (safe.top + safe.bottom) / 2 }, scale);
        } else {
            this.scale = scale;
            this.centerOn(cx, cy);
        }
    }

    // Часть экрана, не закрытая панелями: верхней полосой, нижней навигацией
    // на телефоне и открытой карточкой (шторкой снизу или колонкой слева).
    focusRegion(id) {
        const region = this.data.getRegion(id), bounds = RegionsDB[id];
        if (!region || !bounds) return;
        this.measure();
        const width = Math.max(bounds.bw * 1.4, bounds.bh * 1.4 * this.rect.width / this.rect.height, this.minView);
        const scale = this.clampScale(this.rect.width / (Math.min(width, this.interactiveView * 0.9) * this.baseScale));
        this.flyTo({ x: region.lx, y: region.ly }, scale);
    }

    // Несколько морей на экране: откуда идёт эскадра и куда может дойти.
    focusSeas(ids) {
        const pts = [...ids].map(id => SeasDB.zones[id]).filter(Boolean);
        if (!pts.length) return;
        const xs = pts.map(z => z.x), ys = pts.map(z => z.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        // через линию перемены дат центры разбегаются на весь мир — тогда только к исходному морю
        if (maxX - minX > 300) { this.flyTo({ x: pts[0].x, y: pts[0].y }, this.scale); return; }
        this.measure();
        const width = Math.max((maxX - minX) * 1.6, (maxY - minY) * 1.8 * this.rect.width / this.rect.height, this.minView * 2);
        const scale = this.clampScale(this.rect.width / (Math.min(width, this.interactiveView * 0.9) * this.baseScale));
        this.flyTo({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, scale);
    }

    // Вся страна на экране, но не дальше уровня, где кликаются области.
    focusCountry(countryId) {
        const regions = this.data.getCountryRegions(countryId);
        if (!regions.length) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const region of regions) {
            const b = RegionsDB[region.id];
            minX = Math.min(minX, b.bx); minY = Math.min(minY, b.by);
            maxX = Math.max(maxX, b.bx + b.bw); maxY = Math.max(maxY, b.by + b.bh);
        }
        this.measure();
        const w = maxX - minX, h = maxY - minY;
        const width = Math.max(w * 1.15, h * 1.15 * this.rect.width / this.rect.height, this.minView * 2);
        const scale = this.clampScale(this.rect.width / (Math.min(width, this.interactiveView * 0.9) * this.baseScale));
        const capital = this.data.getRegion(this.data.countries[countryId].capital);
        // Страна не влезла — центрируем на столице, иначе на середине страны.
        const target = width > this.interactiveView * 0.9 && capital ? { x: capital.lx, y: capital.ly } : { x: minX + w / 2, y: minY + h / 2 };
        this.flyTo(target, scale);
    }

    // Перелёт к точке: она встаёт в центр видимой части экрана.
    flyTo(point, scale, ms = 420) {
        const safe = this.safeRect();
        this.animateTo(point, { x: (safe.left + safe.right) / 2, y: (safe.top + safe.bottom) / 2 }, scale, ms);
    }

    safeRect() {
        const w = window.innerWidth, h = window.innerHeight;
        const topBar = document.getElementById('top-bar');
        const top = topBar ? topBar.getBoundingClientRect().bottom : 0;
        let bottom = h, left = 0;
        const nav = document.getElementById('action-bar');
        if (nav) {
            const r = nav.getBoundingClientRect();
            if (r.top > h / 2) bottom = r.top;
        }
        if (document.body.classList.contains('sheet-open')) {
            if (w <= 768) bottom -= h * 0.58;
            else left = 340;
        }
        return { left, top, right: w, bottom: Math.max(top + 80, bottom) };
    }

    screenOf(x, y) {
        const k = this.pxPerUnit;
        return { x: (x - this.camX) * k + this.rect.left, y: (y - this.camY) * k + this.rect.top };
    }

    // Если точка карты спрятана под панелью — плавно выводим её в видимую часть.
    ensureVisible(x, y) {
        // Идёт перелёт (например, приближение двойным касанием) — не сбиваем его.
        if (this.animating) return;
        this.measure();
        const safe = this.safeRect();
        const p = this.screenOf(x, y);
        const margin = 30;
        if (p.x > safe.left + margin && p.x < safe.right - margin && p.y > safe.top + margin && p.y < safe.bottom - margin) return;
        this.animateTo({ x, y }, { x: (safe.left + safe.right) / 2, y: (safe.top + safe.bottom) / 2 }, this.scale);
    }

    zoomBy(factor) {
        this.measure();
        const safe = this.safeRect();
        const pivot = { x: (safe.left + safe.right) / 2, y: (safe.top + safe.bottom) / 2 };
        const anchor = this.clientToMap(pivot.x, pivot.y);
        this.animateTo(anchor, pivot, this.clampScale(this.scale * factor));
    }

    clampScale(scale) {
        const minScale = this.rect.width / (this.maxView * this.baseScale);
        const maxScale = this.rect.width / (this.minView * this.baseScale);
        return Math.min(Math.max(scale, minScale), maxScale);
    }

    // Плавный перелёт: точка карты `point` едет к экранной точке `screen`,
    // масштаб меняется геометрически — так движение выглядит равномерным.
    animateTo(point, screen, targetScale, ms = 280) {
        cancelAnimationFrame(this.animFrame);
        this.animating = true;
        const from = this.screenOf(point.x, point.y);
        const s0 = this.scale, s1 = targetScale;
        const wasRegional = this.isRegionalZoom;
        const t0 = performance.now();
        const step = now => {
            const t = Math.min(1, (now - t0) / ms);
            const e = 1 - Math.pow(1 - t, 3);
            this.scale = s0 * Math.pow(s1 / s0, e);
            const k = this.pxPerUnit;
            const sx = from.x + (screen.x - from.x) * e;
            const sy = from.y + (screen.y - from.y) * e;
            this.camX = point.x - (sx - this.rect.left) / k;
            this.camY = point.y - (sy - this.rect.top) / k;
            this.applyCamera();
            this.applyDetail();
            this.scheduleLabelUpdate();
            if (t < 1) { this.animFrame = requestAnimationFrame(step); return; }
            this.animating = false;
            if (wasRegional !== this.isRegionalZoom) {
                this.updateLOD();
                document.dispatchEvent(new CustomEvent('zoomLevelChanged', { detail: { isRegional: this.isRegionalZoom } }));
            }
        };
        this.animFrame = requestAnimationFrame(step);
    }

    centerOn(x, y) {
        const k = this.pxPerUnit;
        this.camX = x - this.rect.width / (2 * k);
        this.camY = y - this.rect.height / (2 * k);
        this.applyCamera();
    }

    applyCamera() {
        this.clampCamera();
        const k = this.pxPerUnit;
        const viewW = this.rect.width / k;
        const viewH = this.rect.height / k;
        this.svg.setAttribute('viewBox',
            `${this.camX.toFixed(3)} ${this.camY.toFixed(3)} ${viewW.toFixed(3)} ${viewH.toFixed(3)}`);
        // Толщина линий и подписи заданы в единицах карты — держим их
        // постоянными на экране: один экранный пиксель = 1/k единиц.
        // При простом сдвиге масштаб не меняется — и пересчитывать стили
        // тысяч подписей на каждом кадре незачем.
        // Смена --sw пересчитывает стили всех тысяч элементов карты — на
        // телефоне это главный тормоз зума. Во время движения меняем её, лишь
        // когда масштаб ушёл больше чем на 12% (линии и подписи чуть
        // «дышат»), а точное значение ставим, когда карта остановилась.
        if (k !== this.lastK) {
            const ratio = this.lastK ? k / this.lastK : 0;
            clearTimeout(this.strokeTimer);
            if (!this.lastK || ratio > MapEngine.STROKE_STEP || ratio < 1 / MapEngine.STROKE_STEP) this.setStrokeScale(k);
            else this.strokeTimer = setTimeout(() => this.setStrokeScale(this.pxPerUnit), 140);
        }
        this.cull();
        this.scheduleDeclutter();
    }

    setStrokeScale(k) {
        if (k === this.lastK) return;
        this.lastK = k;
        this.svg.style.setProperty('--sw', (1 / k).toFixed(5) + 'px');
        this.svg.style.setProperty('--k', (1 / k).toFixed(5));
        // шаг штриховки — 7 экранных пикселей, линия — 2.5
        const hatch = this.svg.querySelector('#fallout-hatch');
        if (hatch) {
            const step = 7 / k;
            hatch.setAttribute('width', step.toFixed(4));
            hatch.setAttribute('height', step.toFixed(4));
            const line = hatch.firstChild;
            line.setAttribute('width', (2.5 / k).toFixed(4));
            line.setAttribute('height', step.toFixed(4));
        }
    }

    // Карту нельзя утащить за край: центр экрана остаётся над миром.
    clampCamera() {
        const k = this.pxPerUnit;
        const halfW = this.rect.width / (2 * k), halfH = this.rect.height / (2 * k);
        // Суша — от −180° до 180° по долготе, по широте — до Огненной Земли
        // (Антарктиды на карте нет). Край суши не отходит от края экрана
        // дальше трети экрана (под панелями тоже должно быть видно карту);
        // если весь мир меньше экрана — он посередине.
        const fit = (c, lo, hi, half) => {
            const a = lo + half * 0.7, b = hi - half * 0.7;
            return a > b ? (lo + hi) / 2 : Math.min(Math.max(c, a), b);
        };
        const cx = fit(this.camX + halfW, 184, 1016, halfW);
        const cy = fit(this.camY + halfH, 0, 540, halfH);
        this.camX = cx - halfW;
        this.camY = cy - halfH;
    }

    // Всё, что за краем экрана, из отрисовки убираем: при камере на viewBox
    // браузер каждый кадр рисует вектор заново, и лишняя геометрия стоит кадров.
    cull() {
        const k = this.pxPerUnit;
        const padX = (this.rect.width / k) * 0.15 + 2;
        const padY = (this.rect.height / k) * 0.15 + 2;
        const x1 = this.camX - padX, x2 = this.camX + this.rect.width / k + padX;
        const y1 = this.camY - padY, y2 = this.camY + this.rect.height / k + padY;

        for (const list of [this.cullRegions, this.cullLabels, this.cullCities, this.cullBadges]) {
            for (const item of list) {
                const visible = item.x + item.w >= x1 && item.x <= x2
                             && item.y + item.h >= y1 && item.y <= y2;
                if (visible !== item.vis) {
                    item.vis = visible;
                    item.el.style.display = visible ? '' : 'none';
                }
            }
        }
    }

    // Ставит масштаб так, чтобы точка карты `anchor` оказалась под экранной
    // точкой `screen`. На этом держатся колесо, щипок и все анимации.
    placeCamera(scale, anchor, screen) {
        const wasRegional = this.isRegionalZoom;
        this.scale = this.clampScale(scale);
        const k = this.pxPerUnit;
        this.camX = anchor.x - (screen.x - this.rect.left) / k;
        this.camY = anchor.y - (screen.y - this.rect.top) / k;
        this.applyCamera();
        this.applyDetail();
        this.scheduleLabelUpdate();
        if (wasRegional !== this.isRegionalZoom) {
            this.updateLOD();
            document.dispatchEvent(new CustomEvent('zoomLevelChanged', { detail: { isRegional: this.isRegionalZoom } }));
        }
    }

    // Меняем масштаб, удерживая точку под курсором на месте.
    zoomAt(newScale, pivotX, pivotY) {
        this.stopMotion();
        if (this.clampScale(newScale) === this.scale) return;
        this.placeCamera(newScale, this.clientToMap(pivotX, pivotY), { x: pivotX, y: pivotY });
    }

    // Любое касание останавливает перелёт, инерцию и плавный зум колесом.
    stopMotion() {
        this.animating = false;
        cancelAnimationFrame(this.animFrame);
        cancelAnimationFrame(this.inertiaFrame);
        cancelAnimationFrame(this.wheelFrame);
        this.wheelTarget = null;
    }

    // --- события -------------------------------------------------------
    initEvents() {
        // Один слушатель на весь слой вместо тысячи: клики приходят
        // всплытием, поэтому добавление и удаление областей ничего не ломает.
        this.regionLayer.addEventListener('click', e => {
            if (this.wasDragging) return;
            const path = e.target.closest('.region');
            if (!path || path.classList.contains('dimmed')) return;
            this.onRegionClick(path.dataset.region);
        });

        // море: выбор цели похода или окно «Флот» на этом море
        this.seaZoneLayer.addEventListener('click', e => {
            if (this.wasDragging) return;
            const zone = e.target.closest('.sea-zone');
            if (!zone) return;
            e.stopPropagation();
            const id = zone.dataset.zone;
            if (this.fleetTargets) {
                if (this.fleetTargets.has(id)) document.dispatchEvent(new CustomEvent('fleetTarget', { detail: id }));
                return;
            }
            document.dispatchEvent(new CustomEvent('seaClick', { detail: id }));
        });

        // значок флота — окно «Флот» на этом море (при выборе цели — как море)
        this.fleetLayer.addEventListener('click', e => {
            if (this.wasDragging) return;
            const mark = e.target.closest('.fleet-mark');
            if (!mark) return;
            e.stopPropagation();
            if (this.fleetTargets) {
                if (this.fleetTargets.has(mark.dataset.zone)) document.dispatchEvent(new CustomEvent('fleetTarget', { detail: mark.dataset.zone }));
                return;
            }
            document.dispatchEvent(new CustomEvent('fleetClick', { detail: mark.dataset.zone }));
        });

        // значок порта — карточка его области
        this.portLayer.addEventListener('click', e => {
            if (this.wasDragging) return;
            const mark = e.target.closest('.port-mark');
            if (!mark) return;
            e.stopPropagation();
            this.onRegionClick(mark.dataset.region);
        });

        // значок пролива — открыть окно проливов на нём
        this.straitLayer.addEventListener('click', e => {
            if (this.wasDragging) return;
            const mark = e.target.closest('.strait-mark');
            if (!mark) return;
            e.stopPropagation();
            document.dispatchEvent(new CustomEvent('straitClick', { detail: mark.dataset.strait }));
        });

        this.regionLayer.addEventListener('mouseover', e => {
            if (this.isRegionalZoom || this.isDragging) return;
            const path = e.target.closest('.region');
            if (!path) return;
            const cc = path.dataset.country;
            if (this.hoveredCountry === cc) return;
            this.clearHover();
            this.hoveredCountry = cc;
            this.hovered = [];
            for (const region of this.data.getCountryRegions(cc)) {
                const el = this.paths.get(region.id);
                if (el) { el.classList.add('country-hover'); this.hovered.push(el); }
            }
        });
        this.regionLayer.addEventListener('mouseleave', () => {
            this.hoveredCountry = null;
            this.clearHover();
        });

        this.svg.addEventListener('click', e => {
            if (this.wasDragging) return;
            if (e.target === this.svg) {
                this.clearSelection();
                document.dispatchEvent(new Event('mapBackground'));
            }
        });

        // Колесо: не прыжками, а плавно догоняем целевой масштаб. Щипок на
        // тачпаде приходит как wheel с ctrlKey — он и так плавный.
        this.container.addEventListener('wheel', e => {
            e.preventDefault();
            this.measure();
            const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
            if (e.ctrlKey) { this.zoomAt(this.scale * Math.exp(-delta * 0.01), e.clientX, e.clientY); return; }
            cancelAnimationFrame(this.animFrame);
            cancelAnimationFrame(this.inertiaFrame);
            this.wheelTarget = this.clampScale((this.wheelTarget || this.scale) * Math.exp(-delta * 0.0018));
            this.wheelPivot = { x: e.clientX, y: e.clientY };
            if (!this.wheelFrame) this.wheelFrame = requestAnimationFrame(() => this.wheelStep());
        }, { passive: false });

        this.container.addEventListener('dblclick', e => {
            e.preventDefault();
            this.zoomToward(e.clientX, e.clientY, 2);
        });

        // Указатели покрывают мышь, тач и перо одним кодом.
        this.pointers = new Map();
        this.container.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            // Первый палец нового касания: всё, что помнили раньше, —
            // «застрявшие» указатели (iOS не присылает отпускание, если
            // свернуть приложение посреди жеста). Иначе один палец
            // щипает вместе с призраком и карта уменьшается вместо сдвига.
            if (e.isPrimary) this.resetPointers();
            else if (this.pointers.size >= 2) return;   // третий палец не участвует
            this.stopMotion();
            this.measure();
            this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
            if (this.pointers.size === 1) {
                this.startDrag(e.clientX, e.clientY);
                this.wasDragging = false;
                this.tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
            } else if (this.pointers.size === 2) {
                // Второй палец — щипок. Захватываем оба указателя, чтобы
                // жест не потерялся, если палец уйдёт на панель.
                this.isDragging = false;
                this.wasDragging = true;
                for (const id of this.pointers.keys()) {
                    try { this.container.setPointerCapture(id); } catch (err) { /* указатель уже отпущен */ }
                }
                const p = this.pinchState();
                this.pinch = { dist: p.dist, scale: this.scale, anchor: this.clientToMap(p.x, p.y) };
            }
        });

        this.container.addEventListener('pointermove', e => {
            const pointer = this.pointers.get(e.pointerId);
            if (!pointer) return;
            pointer.x = e.clientX;
            pointer.y = e.clientY;

            if (this.pointers.size >= 2 && this.pinch) {
                // Масштаб — по расстоянию между пальцами, сдвиг — по их
                // середине: карта ведёт себя как фото в галерее.
                const now = this.pinchState();
                if (now.dist > 0 && this.pinch.dist > 0) {
                    this.placeCamera(this.pinch.scale * (now.dist / this.pinch.dist), this.pinch.anchor, now);
                }
                return;
            }
            if (!this.isDragging) return;
            // У пальца дрожь больше, чем у мыши: малый сдвиг — ещё касание.
            const threshold = e.pointerType === 'mouse' ? 4 : 9;
            if (!this.wasDragging && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > threshold) {
                this.wasDragging = true;
                if (!this.container.hasPointerCapture(e.pointerId)) this.container.setPointerCapture(e.pointerId);
            }
            if (!this.wasDragging) return;
            const k = this.pxPerUnit;
            this.camX = this.dragCamX - (e.clientX - this.downX) / k;
            this.camY = this.dragCamY - (e.clientY - this.downY) / k;
            this.applyCamera();
            const t = performance.now();
            this.samples.push({ x: e.clientX, y: e.clientY, t });
            while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
        });

        const release = e => {
            const pointer = this.pointers.get(e.pointerId);
            if (!pointer) return;
            this.pointers.delete(e.pointerId);
            if (this.pointers.size === 1) {
                // Щипок закончился, один палец остался — продолжаем тянуть с
                // его текущего места, без рывка.
                this.pinch = null;
                const [rest] = this.pointers.values();
                this.startDrag(rest.x, rest.y);
                this.wasDragging = true;
                return;
            }
            if (this.pointers.size > 0) return;
            this.pinch = null;
            const dragged = this.wasDragging && this.isDragging;
            this.isDragging = false;
            if (dragged && e.type === 'pointerup') this.startInertia();
            if (!this.wasDragging && e.type === 'pointerup' && pointer.type !== 'mouse') this.checkDoubleTap(e);
            // сбрасываем флаг после текущего клика, чтобы перетаскивание не считалось кликом
            setTimeout(() => { this.wasDragging = false; }, 0);
        };
        this.container.addEventListener('pointerup', release);
        this.container.addEventListener('pointercancel', release);
        // Касания браузер считает точно: пальцев на экране нет — значит, и
        // тач-указателей нет, даже если отпускание потерялось.
        const sync = e => {
            if (e.touches.length) return;
            for (const [id, p] of this.pointers) if (p.type === 'touch') this.pointers.delete(id);
            if (this.pointers.size < 2) this.pinch = null;
            if (!this.pointers.size) this.isDragging = false;
        };
        this.container.addEventListener('touchend', sync, { passive: true });
        this.container.addEventListener('touchcancel', sync, { passive: true });
        // свернули приложение или ушли со страницы — жест точно закончился
        window.addEventListener('blur', () => this.resetPointers());
        window.addEventListener('pagehide', () => this.resetPointers());
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.resetPointers(); });
        // Safari масштабирует всю страницу щипком поверх карты — не даём.
        for (const type of ['gesturestart', 'gesturechange']) {
            document.addEventListener(type, e => { if (document.body.classList.contains('in-game')) e.preventDefault(); }, { passive: false });
        }

        // Клавиатура на компьютере: + и − масштаб, стрелки — сдвиг.
        window.addEventListener('keydown', e => {
            if (e.target.closest && e.target.closest('input, textarea, select')) return;
            if (!document.body.classList.contains('in-game') || document.querySelector('.modal.active')) return;
            const step = 120;
            const pan = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (e.key === '+' || e.key === '=') this.zoomBy(1.6);
            else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.6);
            else if (pan) this.panBy(pan[0], pan[1]);
            else return;
            e.preventDefault();
        });

        window.addEventListener('resize', () => {
            const cx = this.camX + this.rect.width / (2 * this.pxPerUnit);
            const cy = this.camY + this.rect.height / (2 * this.pxPerUnit);
            this.measure();
            this.scale = this.clampScale(this.scale);
            this.centerOn(cx, cy);
            this.updateLOD();
            this.updateLabelVisibility();
            document.dispatchEvent(new CustomEvent('zoomLevelChanged', { detail: { isRegional: this.isRegionalZoom } }));
        });
    }

    resetPointers() {
        this.pointers.clear();
        this.pinch = null;
        this.isDragging = false;
    }

    startDrag(x, y) {
        this.isDragging = true;
        this.dragCamX = this.camX;
        this.dragCamY = this.camY;
        this.downX = x;
        this.downY = y;
        this.samples = [{ x, y, t: performance.now() }];
    }

    // Отпустили палец на ходу — карта катится дальше и плавно тормозит.
    startInertia() {
        const samples = this.samples || [];
        if (samples.length < 2) return;
        const first = samples[0], last = samples[samples.length - 1];
        const dt = last.t - first.t;
        if (dt <= 0 || performance.now() - last.t > 60) return;   // палец успел остановиться
        let vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;   // px/мс
        const speed = Math.hypot(vx, vy);
        if (speed < 0.15) return;
        const cap = 4;
        if (speed > cap) { vx *= cap / speed; vy *= cap / speed; }
        let prev = performance.now();
        const step = now => {
            const elapsed = Math.min(now - prev, 40);
            prev = now;
            const k = this.pxPerUnit;
            this.camX -= (vx * elapsed) / k;
            this.camY -= (vy * elapsed) / k;
            this.applyCamera();
            const decay = Math.exp(-elapsed / 280);
            vx *= decay; vy *= decay;
            if (Math.hypot(vx, vy) > 0.02) this.inertiaFrame = requestAnimationFrame(step);
        };
        this.inertiaFrame = requestAnimationFrame(step);
    }

    wheelStep() {
        this.wheelFrame = null;
        if (!this.wheelTarget) return;
        const ratio = this.wheelTarget / this.scale;
        const next = Math.abs(Math.log(ratio)) < 0.004 ? this.wheelTarget : this.scale * Math.pow(ratio, 0.28);
        this.placeCamera(next, this.clientToMap(this.wheelPivot.x, this.wheelPivot.y), this.wheelPivot);
        if (next === this.wheelTarget) { this.wheelTarget = null; return; }
        this.wheelFrame = requestAnimationFrame(() => this.wheelStep());
    }

    // Двойное касание — приблизить в этой точке.
    checkDoubleTap(e) {
        const now = performance.now();
        const last = this.lastTap;
        this.lastTap = { x: e.clientX, y: e.clientY, t: now };
        if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
            this.lastTap = null;
            this.zoomToward(e.clientX, e.clientY, 2);
        }
    }

    // Плавно приблизить в 'factor' раз, подтянув точку касания к центру.
    zoomToward(clientX, clientY, factor) {
        this.measure();
        const safe = this.safeRect();
        const anchor = this.clientToMap(clientX, clientY);
        const screen = { x: (clientX + (safe.left + safe.right) / 2) / 2, y: (clientY + (safe.top + safe.bottom) / 2) / 2 };
        this.animateTo(anchor, screen, this.clampScale(this.scale * factor), 320);
    }

    panBy(dx, dy) {
        this.measure();
        const center = { x: this.rect.left + this.rect.width / 2, y: this.rect.top + this.rect.height / 2 };
        const anchor = this.clientToMap(center.x + dx, center.y + dy);
        this.animateTo(anchor, center, this.scale, 220);
    }

    pinchState() {
        const [a, b] = [...this.pointers.values()];
        return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    // --- подписи стран ---------------------------------------------------
    createCountryLabels() {
        this.labelLayer.innerHTML = '';
        this.countryLabels = [];
        const fragment = document.createDocumentFragment();

        for (const countryId of Object.keys(this.data.countries)) {
            const regions = Object.values(this.data.regions).filter(r => r.owner === countryId);
            if (!regions.length) continue;

            const component = this.largestComponent(regions, countryId);
            if (!component.length) continue;

            // центр — по площади на экране (px карты): крупные области
            // весомее, иначе подпись России тянуло бы к мелким субъектам
            let sumX = 0, sumY = 0, sumW = 0;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const region of component) {
                const w = Math.sqrt(this.screenArea(region.id));
                sumX += region.lx * w; sumY += region.ly * w; sumW += w;
                // вписанный круг области: рамка могла бы захватить далёкий остров
                const r = RegionsDB[region.id].lr || 0;
                minX = Math.min(minX, region.lx - r); maxX = Math.max(maxX, region.lx + r);
                minY = Math.min(minY, region.ly - r); maxY = Math.max(maxY, region.ly + r);
            }
            const name = this.data.getCountry(countryId).name;
            // размах — по центрам и вписанным кругам областей: страна из
            // нескольких крупных областей не получает подпись меньше заслуженной
            const width = Math.max(maxX - minX, 4);
            const height = Math.max(maxY - minY, 4);
            // Размер подписи по размеру страны, но не больше 40 экранных
            // пикселей: иначе у России или Казахстана на телефоне на весь
            // экран растягивается одна буква.
            let fit = (width * 1.1) / Math.max(name.length * 0.55, 1);
            fit = Math.min(fit, height * 0.7);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', (sumX / sumW).toFixed(2));
            text.setAttribute('y', (sumY / sumW).toFixed(2));
            text.setAttribute('class', 'country-label');
            text.style.fontSize = `min(${fit.toFixed(3)}px, calc(var(--sw) * 40))`;
            text.textContent = name;
            fragment.appendChild(text);
            this.countryLabels.push({ el: text, fit });
        }
        this.labelLayer.appendChild(fragment);
        this.updateLabelVisibility();
    }

    screenArea(id) {
        const r = RegionsDB[id].r || 0.5;
        return Math.PI * r * r;
    }

    // Крупнейший (по площади) связный кусок владений — чтобы подпись не
    // улетала в океан. Связь через далёкую переправу не считается: Французская
    // Гвиана, Аляска или Гавайи — отдельные куски, а не часть «материка».
    largestComponent(regions, countryId) {
        const own = new Set(regions.map(r => r.id));
        const gap = (a, b) => {
            const p = RegionsDB[a], q = RegionsDB[b];
            const dx = Math.max(0, p.bx - (q.bx + q.bw), q.bx - (p.bx + p.bw));
            const dy = Math.max(0, p.by - (q.by + q.bh), q.by - (p.by + p.bh));
            return Math.hypot(dx, dy);
        };
        const seen = new Set();
        let best = [], bestArea = -1;
        for (const region of regions) {
            if (seen.has(region.id)) continue;
            const component = [];
            let area = 0;
            const queue = [region.id];
            seen.add(region.id);
            while (queue.length) {
                const id = queue.pop();
                component.push(this.data.regions[id]);
                area += this.screenArea(id);
                for (const nextId of this.data.getNeighbors(id)) {
                    if (own.has(nextId) && !seen.has(nextId) && gap(id, nextId) <= MapEngine.LABEL_LINK_GAP) { seen.add(nextId); queue.push(nextId); }
                }
            }
            if (area > bestArea) { best = component; bestArea = area; }
        }
        return best;
    }

    // Подпись в центре области нужна только там, где нет города с её
    // именем: такую область и так называет город, стоящий на своём месте.
    createRegionLabels() {
        this.regionLabelLayer.innerHTML = '';
        this.regionLabels = [];
        this.cullLabels = [];
        const named = new Set(CitiesDB.map(c => c.regionId + '|' + c.name));
        const fragment = document.createDocumentFragment();

        for (const region of Object.values(this.data.regions)) {
            if (named.has(region.id + '|' + region.name)) continue;
            const info = RegionsDB[region.id];
            // Подпись не должна вылезать за пределы своей области: размер
            // ограничен вписанной окружностью (в единицах карты).
            const radius = info.lr || info.r;
            const fit = (radius * 1.8) / Math.max(region.name.length * 0.62, 1);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', region.lx);
            text.setAttribute('y', region.ly);
            text.setAttribute('class', 'region-label');
            text.style.fontSize = `min(calc(var(--sw) * 11), ${fit.toFixed(3)}px)`;
            text.textContent = region.name;
            fragment.appendChild(text);
            const item = { el: text, fit, x: region.lx, y: region.ly, text: region.name, kind: 'region' };
            this.regionLabels.push(item);
            this.cullLabels.push({ el: text, x: region.lx, y: region.ly, w: 0, h: 0, vis: true });
        }
        this.regionLabelLayer.appendChild(fragment);
        this.updateLabelVisibility();
    }

    // Слишком мелкую подпись читать нельзя — прячем её, пока не приблизят.
    updateLabelVisibility() {
        const k = this.pxPerUnit;
        const hide = (list, cap, minPx) => {
            if (!list) return;
            for (const label of list) {
                const rendered = Math.min(cap, label.fit * k);
                label.small = rendered < minPx;
                label.el.classList.toggle('too-small', label.small);
            }
        };
        hide(this.regionLabels, 11, 8);
        hide(this.countryLabels, 40, 10);
    }

    scheduleLabelUpdate() {
        if (this.labelFrame) return;
        this.labelFrame = requestAnimationFrame(() => {
            this.labelFrame = null;
            this.updateLabelVisibility();
        });
    }

    // --- города ------------------------------------------------------------
    // Первый ярус — столицы и города, давшие имя области: видны, как только
    // карта переходит к областям. Второй ярус — остальные, при сильном
    // приближении. Точка стоит на реальном месте города.
    drawCities() {
        this.cityLayer.innerHTML = '';
        this.cullCities = [];
        this.cityItems = [];
        const fragment = document.createDocumentFragment();
        const ns = 'http://www.w3.org/2000/svg';
        for (const city of CitiesDB) {
            const region = this.data.getRegion(city.regionId);
            const main = city.isCapital || (region && region.name === city.name);
            const group = document.createElementNS(ns, 'g');
            group.setAttribute('class', `city-group ${main ? 'tier-1' : 'tier-2'}${city.isCapital ? ' capital' : ''}`);
            group.setAttribute('transform', `translate(${city.x},${city.y})`);

            const dot = document.createElementNS(ns, 'circle');
            dot.setAttribute('class', city.isCapital ? 'capital-marker' : 'city-marker');
            group.appendChild(dot);

            const label = document.createElementNS(ns, 'text');
            label.setAttribute('class', `${city.isCapital ? 'capital-label' : 'city-label'} right`);
            label.textContent = city.name;
            group.appendChild(label);

            fragment.appendChild(group);
            const cull = { el: group, x: city.x, y: city.y, w: 0, h: 0, vis: true };
            this.cullCities.push(cull);
            this.cityItems.push({
                cull, label, x: city.x, y: city.y, text: city.name, tier: main ? 1 : 2,
                size: city.isCapital ? 12 : 11,
                priority: (city.isCapital ? 3e9 : 0) + (main ? 1e9 : 0) + city.population,
            });
        }
        this.cityItems.sort((a, b) => b.priority - a.priority);
        this.cityLayer.appendChild(fragment);
    }

    // --- раскладка подписей без наложений -----------------------------------
    // Значки войск важнее всего и стоят всегда; подписи городов обходят их
    // (справа от точки, иначе слева), а если места нет — прячутся до
    // следующего приближения. Считается, когда камера остановилась.
    scheduleDeclutter() {
        clearTimeout(this.declutterTimer);
        this.declutterTimer = setTimeout(() => this.declutter(), 90);
    }

    declutter() {
        if (!this.rect || !this.cityItems) return;
        const k = this.pxPerUnit, lod = this.detailLevel;
        const W = this.rect.width, H = this.rect.height;
        const screen = (x, y) => ({ x: (x - this.camX) * k, y: (y - this.camY) * k });
        const onScreen = p => p.x > -80 && p.x < W + 80 && p.y > -30 && p.y < H + 30;

        // Занятые прямоугольники храним в сетке 64×64 px: проверка — только соседние ячейки.
        const CELL = 64, grid = new Map();
        const cells = (b, fn) => {
            for (let gx = Math.floor(b.x1 / CELL); gx <= Math.floor(b.x2 / CELL); gx++) {
                for (let gy = Math.floor(b.y1 / CELL); gy <= Math.floor(b.y2 / CELL); gy++) fn(gx + ':' + gy);
            }
        };
        const hit = b => {
            let found = false;
            cells(b, key => {
                if (found) return;
                for (const o of grid.get(key) || []) {
                    if (b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1) { found = true; return; }
                }
            });
            return found;
        };
        const occupy = b => cells(b, key => { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(b); });

        if (this.isRegionalZoom) {
            for (const badge of this.badges) {
                const p = screen(badge.x, badge.y);
                if (!onScreen(p)) continue;
                occupy({ x1: p.x - badge.w / 2 - 2, x2: p.x + badge.w / 2 + 2, y1: p.y - 10, y2: p.y + 10 });
            }
        }
        const shownCities = this.cityItems.filter(c => c.cull.vis && (lod === 2 || (lod === 1 && c.tier === 1)));
        for (const c of shownCities) {
            const p = screen(c.x, c.y);
            c.p = p;
            if (onScreen(p)) occupy({ x1: p.x - 4, x2: p.x + 4, y1: p.y - 4, y2: p.y + 4 });
        }

        const place = (item, p, centered) => {
            const w = item.text.length * item.size * 0.56 + 2, h = item.size + 2;
            const boxes = centered
                ? [['center', { x1: p.x - w / 2, x2: p.x + w / 2, y1: p.y - h / 2, y2: p.y + h / 2 }]]
                : [['right', { x1: p.x + 5, x2: p.x + 5 + w, y1: p.y - h / 2, y2: p.y + h / 2 }],
                   ['left', { x1: p.x - 5 - w, x2: p.x - 5, y1: p.y - h / 2, y2: p.y + h / 2 }]];
            for (const [side, box] of boxes) {
                if (!hit(box)) { occupy(box); return side; }
            }
            return null;
        };

        // сначала столицы и главные города, потом подписи областей, потом остальное
        const regionItems = lod >= 1 ? this.regionLabels.filter(r => !r.small) : [];
        const queue = [
            ...shownCities.filter(c => c.tier === 1).map(c => ['city', c]),
            ...regionItems.map(r => ['region', r]),
            ...shownCities.filter(c => c.tier === 2).map(c => ['city', c]),
        ];
        const decided = new Set();
        for (const [kind, item] of queue) {
            decided.add(item);
            if (kind === 'city') {
                if (!onScreen(item.p)) continue;
                const side = place(item, item.p, false);
                item.label.classList.toggle('left', side === 'left');
                item.label.classList.toggle('right', side !== 'left');
                item.label.classList.toggle('crowded', !side);
            } else {
                const p = screen(item.x, item.y);
                p.y -= 16;   // подпись стоит над значком войск (см. .region-label)
                if (!onScreen(p)) continue;
                item.size = 11;
                item.el.classList.toggle('crowded', !place(item, p, true));
            }
        }
    }

    // --- выбор цели ---------------------------------------------------------
    enableTargetSelection(validIds, targetClass = 'move-target') {
        const valid = new Set(validIds);
        for (const [id, path] of this.paths) {
            if (valid.has(id)) path.classList.add(targetClass);
            else path.classList.add('dimmed');
        }
    }

    disableTargetSelection() {
        for (const path of this.paths.values()) {
            path.classList.remove('move-target', 'attack-target', 'dimmed');
        }
    }

    formatPower(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return String(Math.floor(num));
    }

    // --- ядерное заражение ------------------------------------------------------
    // Поверх области — жёлтая косая штриховка, в центре — значок ☢️ с числом
    // оставшихся ходов. Держится, пока длится заражение.
    drawFallout() {
        if (!this.falloutLayer || typeof Nuclear === 'undefined') return;
        const ns = 'http://www.w3.org/2000/svg';
        const hot = Object.keys((this.data.nuclear && this.data.nuclear.fallout) || {}).filter(id => Nuclear.fallout(this.data, id));
        const key = hot.map(id => `${id}:${this.data.nuclear.fallout[id]}`).join(',') + '@' + this.data.turn;
        if (key === this.falloutKey) return;
        this.falloutKey = key;
        this.falloutLayer.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (const id of hot) {
            const src = this.paths.get(id), region = this.data.getRegion(id);
            if (!src || !region) continue;
            const hatch = document.createElementNS(ns, 'path');
            hatch.setAttribute('d', src.getAttribute('d'));
            hatch.setAttribute('class', 'fallout-hatch');
            fragment.appendChild(hatch);
            const left = this.data.nuclear.fallout[id] - this.data.turn;
            const mark = document.createElementNS(ns, 'g');
            mark.setAttribute('class', 'fallout-mark');
            mark.setAttribute('transform', `translate(${region.lx},${region.ly})`);
            // над значком войск: тот стоит ровно в центре области
            mark.innerHTML = `<title>Радиоактивное заражение: ещё ${left} ход.</title><g class="badge-inner"><g transform="translate(0,-19)">`
                + `<rect x="-17" y="-8" width="34" height="16" rx="8"/><text class="fallout-ico" x="-8" y="0.5">☢</text><text x="4" y="0.5">${left}</text></g></g>`;
            fragment.appendChild(mark);
        }
        this.falloutLayer.appendChild(fragment);
    }

    // --- стрелки приказов --------------------------------------------------------
    // Марш — светлая пунктирная стрелка, атака — красная сплошная. Приказы
    // по одному направлению сливаются в одну стрелку.
    drawOrders() {
        this.orderLayer.innerHTML = '';
        const mine = this.data.playerOrders();
        const arrows = new Map();
        for (const [key, kind] of [['movements', 'move'], ['attacks', 'attack']]) {
            for (const { order } of mine[key]) {
                const id = `${kind}:${order.from}>${order.to}`;
                if (!arrows.has(id)) arrows.set(id, { kind, from: order.from, to: order.to });
            }
        }
        const ns = 'http://www.w3.org/2000/svg';
        const fragment = document.createDocumentFragment();
        // походы эскадр — голубые стрелки между центрами морей
        const zones = typeof Navy !== 'undefined' ? Navy.zones() : {};
        for (const o of this.data.navalOrders || []) {
            if (o.cc !== this.data.playerCountry || !zones[o.from] || !zones[o.to]) continue;
            const id = `sea:${o.from}>${o.to}`;
            if (arrows.has(id)) continue;
            const a = zones[o.from], b = zones[o.to];
            // через линию перемены дат — к ближайшей копии точки
            const span = 832;   // ширина мира на карте (от −180° до 180°)
            const bx = b.x - a.x > span / 2 ? b.x - span : a.x - b.x > span / 2 ? b.x + span : b.x;
            arrows.set(id, { kind: 'sea', a: { lx: a.x, ly: a.y }, b: { lx: bx, ly: b.y } });
        }
        for (const { kind, from, to, a: pa, b: pb } of arrows.values()) {
            const a = pa || this.data.getRegion(from), b = pb || this.data.getRegion(to);
            if (!a || !b) continue;
            // Дуга, чтобы встречные стрелки не сливались; концы отступают от
            // центров, где стоят маркеры войск.
            const dx = b.lx - a.lx, dy = b.ly - a.ly;
            const c = { x: (a.lx + b.lx) / 2 - dy * 0.18, y: (a.ly + b.ly) / 2 + dx * 0.18 };
            const at = t => ({
                x: (1 - t) * (1 - t) * a.lx + 2 * (1 - t) * t * c.x + t * t * b.lx,
                y: (1 - t) * (1 - t) * a.ly + 2 * (1 - t) * t * c.y + t * t * b.ly,
            });
            const p0 = at(0.12), p1 = at(0.86);
            const d = `M${p0.x.toFixed(2)},${p0.y.toFixed(2)} Q${c.x.toFixed(2)},${c.y.toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
            for (const cls of ['order-halo', `order-arrow ${kind}`]) {
                const path = document.createElementNS(ns, 'path');
                path.setAttribute('d', d);
                path.setAttribute('class', cls);
                if (cls !== 'order-halo') path.setAttribute('marker-end', `url(#arrow-${kind})`);
                fragment.appendChild(path);
            }
        }
        this.orderLayer.appendChild(fragment);
    }

    // Области, которые сменили хозяина за ход: захваченные и потерянные.
    // Отметка держится до следующего хода.
    // Метка другого игрока: область пульсирует несколько секунд.
    pingRegion(id) {
        const path = this.paths.get(id);
        if (!path) return;
        path.classList.remove('pinged');
        void path.getBBox();   // перезапуск анимации
        path.classList.add('pinged');
        clearTimeout(this.pingTimers?.[id]);
        this.pingTimers = this.pingTimers || {};
        this.pingTimers[id] = setTimeout(() => path.classList.remove('pinged'), 7000);
    }

    markChanges(gained, lost) {
        for (const id of this.changed) this.paths.get(id)?.classList.remove('gained', 'lost');
        this.changed = [...gained, ...lost];
        for (const id of gained) this.paths.get(id)?.classList.add('gained');
        for (const id of lost) this.paths.get(id)?.classList.add('lost');
    }

    // Показать область: издалека — приблизить, вблизи — просто довести до центра.
    showRegion(id) {
        const region = this.data.getRegion(id);
        if (!region) return;
        if (this.isRegionalZoom) this.ensureVisible(region.lx, region.ly);
        else this.focusRegion(id);
    }

    // --- значки войск --------------------------------------------------------
    // Плашка с числом в визуальном центре области. Размер постоянный на
    // экране: внутренняя группа масштабируется на --k (1 px в единицах карты).
    drawArmyMarkers() {
        this.armyLayer.innerHTML = '';
        this.badges = [];
        this.cullBadges = [];
        const player = this.data.playerCountry;
        const ns = 'http://www.w3.org/2000/svg';
        const fragment = document.createDocumentFragment();
        const watched = typeof Navy !== 'undefined' ? Navy.watched(this.data, player) : new Set();

        for (const region of Object.values(this.data.regions)) {
            const power = this.data.calculateRegionMilitaryPower(region.id);
            const isOwner = region.owner === player;
            // флот у берега видит гарнизон так же, как шпионы
            const reconActive = (region.reconActiveUntil && region.reconActiveUntil >= this.data.currentDate) || watched.has(region.id);
            let kind, label;
            if (isOwner) {
                if (power <= 0) continue;
                kind = 'own'; label = this.formatPower(power);
            } else if (Diplomacy.isAllied(this.data, player, region.owner)) {
                if (power <= 0) continue;
                kind = 'ally'; label = this.formatPower(power);
            } else if (reconActive) {
                kind = 'enemy'; label = this.formatPower(power);
            } else if (this.data.isNeighborToPlayer(region.id)) {
                kind = 'unknown'; label = '?';
            } else {
                continue;
            }
            const w = 20 + label.length * 6.6;
            const outer = document.createElementNS(ns, 'g');
            outer.setAttribute('class', `army-badge ${kind}`);
            outer.setAttribute('transform', `translate(${region.lx},${region.ly})`);
            outer.innerHTML = `<g class="badge-inner"><rect x="${-w / 2}" y="-8" width="${w}" height="16" rx="2"/>`
                + `<rect class="badge-tick" x="${-w / 2 + 4}" y="-4" width="4" height="8"/>`
                + `<text x="${-w / 2 + 12}" y="0.5">${label}</text></g>`;
            fragment.appendChild(outer);
            this.badges.push({ x: region.lx, y: region.ly, w });
            this.cullBadges.push({ el: outer, x: region.lx, y: region.ly, w: 0, h: 0, vis: true });
        }
        // рядом — войска союзников в области: свои зелёные, чужие синие, со щитом
        for (const [regionId] of Object.entries(this.data.garrisons || {})) {
            const region = this.data.regions[regionId];
            const list = this.data.garrisonsIn(regionId);
            const seen = region.owner === player || list.some(g => g.cc === player) || Diplomacy.isAllied(this.data, player, region.owner);
            if (!seen) continue;
            // сдвиг — в единицах значка: значки масштабируются вокруг своей точки
            const main = this.badges.find(b => b.x === region.lx && b.y === region.ly);
            let x = main ? main.w / 2 + 2 : 0;
            for (const g of list) {
                const label = '🛡' + this.formatPower(this.data.armyPower(g.army, g.cc));
                const w = 14 + label.length * 6;
                const outer = document.createElementNS(ns, 'g');
                outer.setAttribute('class', `army-badge garrison ${g.cc === player ? 'mine' : 'ally'}`);
                outer.setAttribute('transform', `translate(${region.lx},${region.ly})`);
                outer.innerHTML = `<g class="badge-inner"><rect x="${x}" y="-8" width="${w}" height="16" rx="2"/>`
                    + `<text x="${x + 4}" y="0.5">${label}</text></g>`;
                fragment.appendChild(outer);
                this.cullBadges.push({ el: outer, x: region.lx, y: region.ly, w: 0, h: 0, vis: true });
                x += w + 2;
            }
        }
        this.armyLayer.appendChild(fragment);
        this.drawSeas();
        this.drawPorts();
        this.drawFleets();
        this.drawStraits();
        this.cull();
        this.scheduleDeclutter();
    }

    // --- моря, порты, флоты -------------------------------------------------------
    // Морские зоны рисуются один раз: контуры под сушей, границы между ними
    // по воде, подписи морей — по одной на море (его главная зона).
    drawSeas() {
        if (!this.seaZoneLayer || this.seaZoneLayer.childElementCount || typeof SeasDB === 'undefined') return;
        const ns = 'http://www.w3.org/2000/svg';
        const frag = document.createDocumentFragment();
        for (const [id, z] of Object.entries(SeasDB.zones)) {
            if (!z.path) continue;
            const p = document.createElementNS(ns, 'path');
            p.setAttribute('class', 'sea-zone');
            p.setAttribute('d', z.path);
            p.setAttribute('fill-rule', 'evenodd');
            p.dataset.zone = id;
            const title = document.createElementNS(ns, 'title');
            title.textContent = z.name;
            p.appendChild(title);
            frag.appendChild(p);
            this.seaZones.set(id, p);
        }
        const borders = document.createElementNS(ns, 'path');
        borders.setAttribute('class', 'sea-borders');
        borders.setAttribute('d', SeasDB.borders || '');
        frag.appendChild(borders);
        this.seaZoneLayer.appendChild(frag);
        for (const z of Object.values(SeasDB.zones)) {
            if (!z.head) continue;
            const g = document.createElementNS(ns, 'g');
            g.setAttribute('class', 'sea-label');
            g.setAttribute('transform', `translate(${z.x},${z.y})`);
            g.innerHTML = `<g class="badge-inner"><text y="-15">${z.sea}</text></g>`;
            this.seaLayer.appendChild(g);
        }
    }

    // Подсветка морей, куда эскадра дойдёт за ход (null — снять).
    setFleetTargets(zones) {
        this.fleetTargets = zones && zones.size ? zones : null;
        for (const [id, el] of this.seaZones) el.classList.toggle('fleet-target', !!this.fleetTargets && this.fleetTargets.has(id));
        this.svg.classList.toggle('fleet-picking', !!this.fleetTargets);
    }

    // Порты: у реального — в городе, у построенного — у берега области.
    drawPorts() {
        if (!this.portLayer || typeof Shipping === 'undefined' || typeof SeasDB === 'undefined') return;
        const ns = 'http://www.w3.org/2000/svg';
        const player = this.data.playerCountry;
        this.portLayer.innerHTML = '';
        for (const m of Shipping.portMarks(this.data)) {
            const region = this.data.regions[m.region];
            const g = document.createElementNS(ns, 'g');
            g.setAttribute('class', `port-mark${region.owner === player ? ' own' : ''}${Navy.blockaded(this.data, region) ? ' blockaded' : ''}`);
            g.dataset.region = m.region;
            g.setAttribute('transform', `translate(${m.x},${m.y})`);
            g.innerHTML = `<title>Порт ${m.name} · уровень ${region.development.port}</title><g class="badge-inner"><circle r="7"/><text y="0.5">⚓</text></g>`;
            this.portLayer.appendChild(g);
        }
    }

    // Флоты — как значки армий, в центре своего моря: свой, союзники, враги,
    // прочие. Чужие (кроме союзных) видны только у наших берегов, рядом с
    // нашими эскадрами и по данным разведки.
    drawFleets() {
        if (!this.fleetLayer || typeof Navy === 'undefined') return;
        const ns = 'http://www.w3.org/2000/svg';
        const player = this.data.playerCountry;
        const zones = Navy.zones();
        const sight = Navy.sight(this.data, player);
        this.fleetLayer.innerHTML = '';
        for (const [zone, byCc] of Object.entries(this.data.navy || {})) {
            const z = zones[zone];
            if (!z) continue;
            const sides = { own: 0, ally: 0, enemy: 0, other: 0 };
            for (const [cc, ships] of Object.entries(byCc)) {
                const kind = cc === player ? 'own' : Diplomacy.isAllied(this.data, cc, player) ? 'ally' : this.data.isAtWar(cc, player) ? 'enemy' : 'other';
                if ((kind === 'other' || kind === 'enemy') && !sight.has(zone)) continue;
                sides[kind] += Navy.power(ships);
            }
            const parts = Object.entries(sides).filter(([, p]) => p > 0);
            if (!parts.length) continue;
            const widths = parts.map(([, p]) => 26 + String(p).length * 6.6);
            let x = -(widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * 3) / 2;
            const g = document.createElementNS(ns, 'g');
            g.setAttribute('class', 'fleet-mark');
            g.dataset.zone = zone;
            g.setAttribute('transform', `translate(${z.x},${z.y})`);
            g.innerHTML = `<title>${z.name}</title><g class="badge-inner">${parts.map(([kind, p], i) => {
                const w = widths[i];
                const out = `<g class="army-badge fleet ${kind}"><rect x="${x}" y="-8" width="${w}" height="16" rx="2"/>`
                    + `<text class="fleet-ico" x="${x + 9}" y="0.5">⛴</text><text x="${x + 17}" y="0.5">${p}</text></g>`;
                x += w + 3;
                return out;
            }).join('')}</g>`;
            this.fleetLayer.appendChild(g);
        }
    }

    // --- проливы -------------------------------------------------------------
    // Значок на границе двух морей глазами игрока: ⇄ — проход свободен,
    // 💰 — платный, ⛔ — закрыт для него. Свой пролив — в светлом кольце.
    drawStraits() {
        if (!this.straitLayer || typeof STRAITS === 'undefined') return;
        const ns = 'http://www.w3.org/2000/svg';
        const player = this.data.playerCountry;
        this.straitLayer.innerHTML = '';
        for (const [id, s] of Object.entries(STRAITS)) {
            const own = Shipping.keepers(this.data, id).includes(player);
            const pass = Shipping.passage(this.data, id, player);
            const state = own ? 'own' : pass.blocked ? 'blocked' : pass.fee ? 'fee' : 'open';
            const icon = pass.blocked && !own ? '⛔' : pass.fee && !own ? '💰' : '⇄';
            const [x, y] = Shipping.markOf(id);
            const g = document.createElementNS(ns, 'g');
            g.setAttribute('class', `strait-mark ${state}`);
            g.dataset.strait = id;
            g.setAttribute('transform', `translate(${x},${y})`);
            g.innerHTML = `<title>${s.name}</title><g class="badge-inner"><circle r="11"/><text y="0.5">${icon}</text></g>`;
            this.straitLayer.appendChild(g);
        }
    }
}

// Области дальше этого (px карты, ~200 км у экватора) — отдельный кусок
// страны для подписи: заморские владения её не сдвигают.
MapEngine.LABEL_LINK_GAP = 6;

// На сколько может уйти масштаб, прежде чем толщина линий пересчитается
// посреди движения (см. applyCamera).
MapEngine.STROKE_STEP = 1.12;
