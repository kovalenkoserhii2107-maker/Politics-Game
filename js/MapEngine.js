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

        this.buildLayers();
        this.initEvents();
        this.centerOnPlayer();
        this.refreshColors();
        this.createRegionLabels();
        this.createCountryLabels();
        this.drawCities();
        this.drawArmyMarkers();
        this.updateLOD();
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
        this.regionLayer = g('layer-regions');
        this.cityLayer = g('layer-cities');
        this.regionLabelLayer = g('layer-region-labels');
        this.labelLayer = g('layer-labels');
        this.armyLayer = g('layer-armies');

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
    }

    // --- выделение ---------------------------------------------------
    clearSelection() {
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

    centerOnPlayer() {
        this.measure();
        const regions = this.data.getCountryRegions(this.data.playerCountry);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const region of regions) {
            minX = Math.min(minX, region.cx); maxX = Math.max(maxX, region.cx);
            minY = Math.min(minY, region.cy); maxY = Math.max(maxY, region.cy);
        }
        if (minX === Infinity) { minX = 560; minY = 200; maxX = 640; maxY = 260; }

        // Страна должна занять примерно 80% экрана по узкой стороне.
        const spanX = Math.max(maxX - minX, 4);
        const spanY = Math.max(maxY - minY, 4);
        const aspect = this.rect.height / this.rect.width;
        const wantView = Math.max(spanX / 0.8, (spanY / 0.8) / aspect);
        const view = Math.min(Math.max(wantView, this.minView), this.maxView);
        this.scale = this.rect.width / (view * this.baseScale);
        this.centerOn((minX + maxX) / 2, (minY + maxY) / 2);
    }

    centerOn(x, y) {
        const k = this.pxPerUnit;
        this.camX = x - this.rect.width / (2 * k);
        this.camY = y - this.rect.height / (2 * k);
        this.applyCamera();
    }

    applyCamera() {
        const k = this.pxPerUnit;
        const viewW = this.rect.width / k;
        const viewH = this.rect.height / k;
        this.svg.setAttribute('viewBox',
            `${this.camX.toFixed(3)} ${this.camY.toFixed(3)} ${viewW.toFixed(3)} ${viewH.toFixed(3)}`);
        // Толщина линий и подписи заданы в единицах карты — держим их
        // постоянными на экране: один экранный пиксель = 1/k единиц.
        this.svg.style.setProperty('--sw', (1 / k).toFixed(5) + 'px');
        this.cull();
    }

    // Всё, что за краем экрана, из отрисовки убираем: при камере на viewBox
    // браузер каждый кадр рисует вектор заново, и лишняя геометрия стоит кадров.
    cull() {
        const k = this.pxPerUnit;
        const padX = (this.rect.width / k) * 0.15 + 2;
        const padY = (this.rect.height / k) * 0.15 + 2;
        const x1 = this.camX - padX, x2 = this.camX + this.rect.width / k + padX;
        const y1 = this.camY - padY, y2 = this.camY + this.rect.height / k + padY;

        for (const list of [this.cullRegions, this.cullLabels, this.cullCities]) {
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

    // Меняем масштаб, удерживая точку под курсором на месте.
    zoomAt(newScale, pivotX, pivotY) {
        const minScale = this.rect.width / (this.maxView * this.baseScale);
        const maxScale = this.rect.width / (this.minView * this.baseScale);
        const clamped = Math.min(Math.max(newScale, minScale), maxScale);
        if (clamped === this.scale) return;
        const wasRegional = this.isRegionalZoom;
        const anchor = this.clientToMap(pivotX, pivotY);

        this.scale = clamped;
        const k = this.pxPerUnit;
        this.camX = anchor.x - (pivotX - this.rect.left) / k;
        this.camY = anchor.y - (pivotY - this.rect.top) / k;

        this.applyCamera();
        this.applyDetail();
        this.scheduleLabelUpdate();
        if (wasRegional !== this.isRegionalZoom) {
            this.updateLOD();
            document.dispatchEvent(new CustomEvent('zoomLevelChanged', {
                detail: { isRegional: this.isRegionalZoom },
            }));
        }
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
                document.dispatchEvent(new Event('panelClosed'));
            }
        });

        this.container.addEventListener('wheel', e => {
            e.preventDefault();
            this.measure();
            const factor = Math.exp(-e.deltaY * 0.0016);
            this.zoomAt(this.scale * factor, e.clientX, e.clientY);
        }, { passive: false });

        // Указатели покрывают мышь, тач и перо одним кодом.
        this.pointers = new Map();
        this.container.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            this.container.setPointerCapture(e.pointerId);
            this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (this.pointers.size === 1) {
                this.measure();
                this.isDragging = true;
                this.wasDragging = false;
                this.dragCamX = this.camX;
                this.dragCamY = this.camY;
                this.downX = e.clientX;
                this.downY = e.clientY;
            } else {
                this.isDragging = false;
                this.pinchStart = this.pinchState();
            }
        });

        this.container.addEventListener('pointermove', e => {
            if (!this.pointers.has(e.pointerId)) return;
            this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (this.pointers.size >= 2 && this.pinchStart) {
                const now = this.pinchState();
                if (now.dist > 0 && this.pinchStart.dist > 0) {
                    this.wasDragging = true;
                    this.zoomAt(this.scale * (now.dist / this.pinchStart.dist), now.x, now.y);
                    this.pinchStart = now;
                }
                return;
            }
            if (!this.isDragging) return;
            if (Math.abs(e.clientX - this.downX) > 4 || Math.abs(e.clientY - this.downY) > 4) {
                this.wasDragging = true;
            }
            const k = this.pxPerUnit;
            this.camX = this.dragCamX - (e.clientX - this.downX) / k;
            this.camY = this.dragCamY - (e.clientY - this.downY) / k;
            this.applyCamera();
        });

        const release = e => {
            this.pointers.delete(e.pointerId);
            if (this.pointers.size < 2) this.pinchStart = null;
            if (this.pointers.size === 0) {
                this.isDragging = false;
                // сбрасываем флаг после текущего клика, чтобы перетаскивание не считалось кликом
                setTimeout(() => { this.wasDragging = false; }, 0);
            }
        };
        this.container.addEventListener('pointerup', release);
        this.container.addEventListener('pointercancel', release);

        window.addEventListener('resize', () => {
            const cx = this.camX + this.rect.width / (2 * this.pxPerUnit);
            const cy = this.camY + this.rect.height / (2 * this.pxPerUnit);
            this.measure();
            this.centerOn(cx, cy);
        });
    }

    pinchState() {
        const pts = [...this.pointers.values()];
        const [a, b] = pts;
        return {
            dist: Math.hypot(a.x - b.x, a.y - b.y),
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
        };
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

            let sumX = 0, sumY = 0;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const region of component) {
                sumX += region.cx; sumY += region.cy;
                minX = Math.min(minX, region.cx); maxX = Math.max(maxX, region.cx);
                minY = Math.min(minY, region.cy); maxY = Math.max(maxY, region.cy);
            }
            const name = this.data.getCountry(countryId).name;
            const width = Math.max(maxX - minX, 4);
            const height = Math.max(maxY - minY, 4);
            // Размер подписи по размеру страны, но не больше 40 экранных
            // пикселей: иначе у России или Казахстана на телефоне на весь
            // экран растягивается одна буква.
            let fit = (width * 1.1) / Math.max(name.length * 0.55, 1);
            fit = Math.min(fit, height * 0.7);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', (sumX / component.length).toFixed(2));
            text.setAttribute('y', (sumY / component.length).toFixed(2));
            text.setAttribute('class', 'country-label');
            text.style.fontSize = `min(${fit.toFixed(3)}px, calc(var(--sw) * 40))`;
            text.textContent = name;
            fragment.appendChild(text);
            this.countryLabels.push({ el: text, fit });
        }
        this.labelLayer.appendChild(fragment);
        this.updateLabelVisibility();
    }

    // Крупнейший связный кусок владений — чтобы подпись не улетала в океан
    // между материковой частью и далёкими островами.
    largestComponent(regions, countryId) {
        const own = new Set(regions.map(r => r.id));
        const seen = new Set();
        let best = [];
        for (const region of regions) {
            if (seen.has(region.id)) continue;
            const component = [];
            const queue = [region.id];
            seen.add(region.id);
            while (queue.length) {
                const id = queue.pop();
                component.push(this.data.regions[id]);
                for (const nextId of this.data.getNeighbors(id)) {
                    if (own.has(nextId) && !seen.has(nextId)) { seen.add(nextId); queue.push(nextId); }
                }
            }
            if (component.length > best.length) best = component;
        }
        return best;
    }

    createRegionLabels() {
        this.regionLabelLayer.innerHTML = '';
        this.regionLabels = [];
        this.cullLabels = [];
        const fragment = document.createDocumentFragment();

        for (const region of Object.values(this.data.regions)) {
            const info = RegionsDB[region.id];
            // Подпись не должна вылезать за пределы своей области, поэтому
            // её размер ограничен шириной области (в единицах карты).
            const fitByWidth = (info.r * 1.7) / Math.max(region.name.length * 0.5, 1);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', region.cx);
            text.setAttribute('y', region.cy);
            text.setAttribute('class', 'region-label');
            text.style.fontSize = `min(calc(var(--sw) * 14), ${fitByWidth.toFixed(3)}px)`;
            text.textContent = region.name;
            fragment.appendChild(text);
            this.regionLabels.push({ el: text, fit: fitByWidth });
            this.cullLabels.push({ el: text, x: region.cx, y: region.cy, w: 0, h: 0, vis: true });
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
                label.el.classList.toggle('too-small', rendered < minPx);
            }
        };
        hide(this.regionLabels, 14, 8);
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
    drawCities() {
        this.cityLayer.innerHTML = '';
        this.cullCities = [];
        const fragment = document.createDocumentFragment();
        for (const city of CitiesDB) {
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const major = city.isCapital || city.population >= 700000;
            group.setAttribute('class', (city.isCapital ? 'capital' : 'city') + (major ? ' major' : ''));
            group.setAttribute('transform', `translate(${city.x},${city.y})`);

            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('r', city.isCapital ? 0.45 : 0.28);
            dot.setAttribute('class', city.isCapital ? 'capital-marker' : 'city-marker');

            group.appendChild(dot);

            // Область уже подписана именем этого города — второй раз не пишем.
            const region = this.data.getRegion(city.regionId);
            if (!region || region.name !== city.name) {
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', 0.8);
                label.setAttribute('y', 0.35);
                label.setAttribute('class', city.isCapital ? 'capital-label' : 'city-label');
                label.textContent = city.name;
                group.appendChild(label);
            }
            fragment.appendChild(group);
            this.cullCities.push({ el: group, x: city.x, y: city.y, w: 0, h: 0, vis: true });
        }
        this.cityLayer.appendChild(fragment);
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

    // --- маркеры войск --------------------------------------------------------
    drawArmyMarkers() {
        this.armyLayer.innerHTML = '';
        const player = this.data.playerCountry;
        const fragment = document.createDocumentFragment();

        for (const region of Object.values(this.data.regions)) {
            const power = this.data.calculateRegionMilitaryPower(region.id);
            if (power <= 0) continue;

            const isOwner = region.owner === player;
            const reconActive = region.reconActiveUntil && region.reconActiveUntil >= this.data.currentDate;
            let icon, label, color;

            if (isOwner) {
                icon = '🛡️'; label = ' ' + this.formatPower(power); color = '#4ade80';
            } else if (reconActive) {
                icon = '⚔️'; label = ' ' + this.formatPower(power); color = '#f87171';
            } else if (this.data.isNeighborToPlayer(region.id)) {
                icon = '⚔️'; label = ''; color = '#fca5a5';
            } else {
                continue;
            }

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', region.cx);
            text.setAttribute('y', region.cy);
            text.setAttribute('class', 'army-marker');
            text.setAttribute('fill', color);
            text.textContent = icon + label;
            fragment.appendChild(text);
        }
        this.armyLayer.appendChild(fragment);
    }
}
