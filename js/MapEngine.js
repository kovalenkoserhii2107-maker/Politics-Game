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

        this.scale = 3;
        this.translateX = 0;
        this.translateY = 0;
        this.isDragging = false;
        this.wasDragging = false;
        this.zoomThreshold = 6;
        this.detailThreshold = 15;   // с этого масштаба показываем города
        this.minScale = 1.5;
        this.maxScale = 60;

        this.paths = new Map();       // regionId -> <path>
        this.selection = new Set();

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

    get isRegionalZoom() { return this.scale >= this.zoomThreshold; }

    // Три ступени детализации: страны -> области -> города.
    get detailLevel() {
        if (this.scale < this.zoomThreshold) return 0;
        return this.scale < this.detailThreshold ? 1 : 2;
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
    centerOnPlayer() {
        const regions = this.data.getCountryRegions(this.data.playerCountry);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const region of regions) {
            minX = Math.min(minX, region.cx); maxX = Math.max(maxX, region.cx);
            minY = Math.min(minY, region.cy); maxY = Math.max(maxY, region.cy);
        }
        if (minX === Infinity) { minX = 560; minY = 200; maxX = 640; maxY = 260; }

        const w = window.innerWidth, h = window.innerHeight;
        const base = Math.min(w / 1200, h / 800);
        const offsetX = (w - 1200 * base) / 2;
        const offsetY = (h - 800 * base) / 2;

        const spanX = Math.max(maxX - minX, 6) * base;
        const spanY = Math.max(maxY - minY, 6) * base;
        const desired = Math.min((w * 0.55) / spanX, (h * 0.55) / spanY);
        this.scale = Math.min(Math.max(desired, 2.5), 30);

        const cx = offsetX + ((minX + maxX) / 2) * base;
        const cy = offsetY + ((minY + maxY) / 2) * base;
        this.translateX = w / 2 - cx * this.scale;
        this.translateY = h / 2 - cy * this.scale;
        this.applyTransform();
    }

    applyTransform() {
        this.svg.style.transformOrigin = '0 0';
        this.svg.style.transform =
            `translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale})`;
        // Толщина линий и подписи городов задаются в единицах карты, а карта
        // масштабируется целиком. Держим их постоянными на экране.
        this.svg.style.setProperty('--sw', (1 / this.scale).toFixed(4) + 'px');
    }

    // Один общий путь для колеса, щипка и жестов: меняем масштаб,
    // удерживая точку под курсором на месте.
    zoomAt(newScale, pivotX, pivotY) {
        const clamped = Math.min(Math.max(newScale, this.minScale), this.maxScale);
        if (clamped === this.scale) return;
        const wasRegional = this.isRegionalZoom;
        const ratio = clamped / this.scale;
        this.translateX = pivotX - (pivotX - this.translateX) * ratio;
        this.translateY = pivotY - (pivotY - this.translateY) * ratio;
        this.scale = clamped;
        this.applyTransform();
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
                this.isDragging = true;
                this.wasDragging = false;
                this.dragStartX = e.clientX - this.translateX;
                this.dragStartY = e.clientY - this.translateY;
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
            this.translateX = e.clientX - this.dragStartX;
            this.translateY = e.clientY - this.dragStartY;
            this.applyTransform();
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

        window.addEventListener('resize', () => this.applyTransform());
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
            let size = (width * 1.1) / Math.max(name.length * 0.55, 1);
            size = Math.min(size, height * 0.7);
            size = Math.min(Math.max(size, 1.2), 26);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', (sumX / component.length).toFixed(2));
            text.setAttribute('y', (sumY / component.length).toFixed(2));
            text.setAttribute('class', 'country-label');
            text.setAttribute('font-size', size.toFixed(2));
            text.textContent = name;
            fragment.appendChild(text);
        }
        this.labelLayer.appendChild(fragment);
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
        }
        this.regionLabelLayer.appendChild(fragment);
        this.updateLabelVisibility();
    }

    // Слишком мелкую подпись читать нельзя — прячем её, пока не приблизят.
    updateLabelVisibility() {
        if (!this.regionLabels) return;
        for (const label of this.regionLabels) {
            const rendered = Math.min(14, label.fit * this.scale);
            label.el.classList.toggle('too-small', rendered < 8);
        }
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
