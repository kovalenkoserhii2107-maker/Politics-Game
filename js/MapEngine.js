class MapEngine {
    constructor(gameData, onRegionClickCallback) {
        this.container = document.getElementById('map-container');
        this.svg = document.getElementById('world-map');
        this.gameData = gameData;
        this.onRegionClick = onRegionClickCallback;
        
        // НОВЫЕ НАСТРОЙКИ: Географический масштаб
        this.scale = 3; // Стартовый зум (нормальный вид мира)
        this.translateX = 0;
        this.translateY = 0;
        this.isDragging = false;
        
        this.zoomThreshold = 3.5; // Снизил порог для регионального уровня
        
        this.initEvents();
        this.centerMap();
        this.colorRegions();
        
        this.createCountryLabels();
        this.drawCities();
        this.drawArmyMarkers(); // <--- НОВАЯ СТРОКА
        this.updateLOD();
    }

    get isRegionalZoom() { return this.scale >= this.zoomThreshold; }

    updateLOD() {
        this.svg.querySelectorAll('.country-hover').forEach(el => el.classList.remove('country-hover'));

        if (this.isRegionalZoom) {
            this.svg.classList.remove('global-view');
            this.svg.classList.add('regional-view');
        } else {
            this.svg.classList.remove('regional-view');
            this.svg.classList.add('global-view');
        }
    }

    selectRegion(regionId) {
        this.clearSelection();
        const el = document.getElementById(regionId);
        if (el) {
            el.classList.add('selected-region');
            // Мы убрали перемещение слоев (insertBefore), так как из-за него браузер
            // "терял" значки войск при перерисовке SVG. Тонкая рамка будет видна и так!
        }
    }

    selectCountry(countryId) {
        this.clearSelection();
        this.svg.querySelectorAll(`.region[data-country="${countryId}"]`).forEach(el => {
            if (el) el.classList.add('selected-country');
        });
    }

    clearSelection() {
        this.svg.querySelectorAll('.selected-region, .selected-country').forEach(el => {
            el.classList.remove('selected-region', 'selected-country');
        });
    }

    createCountryLabels() {
        this.svg.querySelectorAll('.country-label').forEach(el => el.remove());

        Object.keys(this.gameData.countries).forEach(countryId => {
            const country = this.gameData.countries[countryId];
            
            const gridCells = Object.values(this.gameData.regions).filter(r => r.owner === countryId);
            if (gridCells.length === 0) return;

            // 2. Будуємо граф сусідів тільки для ЦІЄЇ країни
            const graph = {};
            const cellSet = new Set(gridCells.map(c => c.id));
            
            gridCells.forEach(cell => {
                const id = cell.id;
                graph[id] = [];
                const neighbors = typeof GeneratedNeighbors !== 'undefined' ? GeneratedNeighbors[id] : [];
                if (neighbors) {
                    neighbors.forEach(nId => {
                        if (cellSet.has(nId)) {
                            graph[id].push(nId);
                        }
                    });
                }
            });

            // 3. Знаходимо всі компоненти зв'язності (DFS/BFS)
            const visited = new Set();
            const components = [];
            
            Object.keys(graph).forEach(startNode => {
                if (!visited.has(startNode)) {
                    const component = [];
                    const queue = [startNode];
                    visited.add(startNode);
                    
                    while (queue.length > 0) {
                        const curr = queue.shift();
                        component.push(curr);
                        const nList = graph[curr] || [];
                        nList.forEach(neighbor => {
                            if (!visited.has(neighbor)) {
                                visited.add(neighbor);
                                queue.push(neighbor);
                            }
                        });
                    }
                    components.push(component);
                }
            });

            // Find the largest component by area (or number of regions)
            components.sort((a, b) => b.length - a.length);
            const mainComponentIds = components[0];

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            let sumX = 0, sumY = 0;
            
            mainComponentIds.forEach(rid => {
                const dbInfo = typeof RegionsDB !== 'undefined' ? RegionsDB[rid] : null;
                if (dbInfo && dbInfo.cx !== undefined) {
                    minX = Math.min(minX, dbInfo.cx);
                    maxX = Math.max(maxX, dbInfo.cx);
                    minY = Math.min(minY, dbInfo.cy);
                    maxY = Math.max(maxY, dbInfo.cy);
                    sumX += dbInfo.cx;
                    sumY += dbInfo.cy;
                }
            });

            if (minX === Infinity) return;

            const centerX = sumX / mainComponentIds.length;
            const centerY = sumY / mainComponentIds.length;
            const clusterWidth = Math.max(maxX - minX + 25, 25); // +25 to account for cell size
            const clusterHeight = Math.max(maxY - minY + 25, 25);

            // Динамический размер: пытаемся вписать текст в ширину и высоту кластера
            const letterCount = country.name.length;
            // Примерная ширина текста = fontSize * letterCount * 0.6
            let calculatedFontSize = (clusterWidth * 0.8) / (letterCount * 0.6);
            
            // Текст не должен превышать высоту кластера
            if (calculatedFontSize > clusterHeight * 0.8) {
                calculatedFontSize = clusterHeight * 0.8;
            }

            // Ограничиваем шрифты здравым смыслом (от 4 до 100 пикселей)
            calculatedFontSize = Math.min(Math.max(calculatedFontSize, 4.0), 100.0);

            // 5. Отрисовываем название
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", centerX);
            text.setAttribute("y", centerY);
            text.setAttribute("text-anchor", "middle"); 
            text.setAttribute("dominant-baseline", "central"); 
            text.setAttribute("class", "country-label");
            text.style.fontSize = `${calculatedFontSize}px`; 
            text.style.pointerEvents = "none";
            text.style.userSelect = "none";
            text.style.opacity = "0.8"; // Слегка прозрачный, чтобы не перекрывал всё
            text.textContent = country.name; 
            
            this.svg.appendChild(text);
        });
    }

    // 2. ИСПРАВЛЕННОЕ ЦЕНТРИРОВАНИЕ КАМЕРЫ НА СТРАНЕ
    centerMap() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const paths = Array.from(this.svg.querySelectorAll('.region')).filter(path => {
            const region = this.gameData.getRegion(path.id);
            return region && region.owner === this.gameData.playerCountry;
        });

        if (paths.length > 0) {
            paths.forEach(path => {
                try {
                    const bbox = path.getBBox(); 
                    if (bbox.width > 0 && bbox.height > 0) { 
                        if (bbox.x < minX) minX = bbox.x;
                        if (bbox.y < minY) minY = bbox.y;
                        if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width;
                        if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height;
                    }
                } catch(e) {}
            });
        }

        if (minX === Infinity) {
            minX = 500; minY = 300; maxX = 700; maxY = 500; // Резервный центр
        }

        const targetX = minX + (maxX - minX) / 2;
        const targetY = minY + (maxY - minY) / 2;

        const svgAspect = 1200 / 800;
        const screenAspect = screenWidth / screenHeight;
        let baseScale, offsetX = 0, offsetY = 0;

        if (screenAspect > svgAspect) {
            baseScale = screenHeight / 800;
            offsetX = (screenWidth - 1200 * baseScale) / 2;
        } else {
            baseScale = screenWidth / 1200;
            offsetY = (screenHeight - 800 * baseScale) / 2;
        }

        const physicalX = offsetX + targetX * baseScale;
        const physicalY = offsetY + targetY * baseScale;

        const maxDim = Math.max(maxX - minX, maxY - minY) * baseScale;
        const desiredSize = Math.min(screenWidth, screenHeight) * 0.45;
        this.scale = maxDim > 0 ? Math.min(Math.max(desiredSize / maxDim, 2.5), 18.0) : 4;

        this.translateX = (screenWidth / 2) - (physicalX * this.scale);
        this.translateY = (screenHeight / 2) - (physicalY * this.scale); 

        this.updateTransform();
        this.updateLOD(); 
    }

    // 1. ЖЕСТКО ФИКСИРУЕМ ТОЧКУ ЗУМА
    updateTransform() {
        this.svg.style.transformOrigin = '0px 0px'; // <--- ЭТО ИСПРАВИТ УЛЕТАНИЕ КАРТЫ ВБОК
        this.svg.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    }

    colorRegions() {
        const paths = document.querySelectorAll('.region');
        
        // Флаг для определения сенсорных устройств
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
        paths.forEach(path => {
            path.addEventListener('click', (e) => {
                // Игнорируем клик, если мы тащили карту
                if (this.wasDragging) {
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
                this.onRegionClick(path.id);
            });
    
            // На мобилках hover часто "залипает", поэтому мы его отключаем 
            // или делаем менее навязчивым. 
            if (!isTouchDevice) {
                path.addEventListener('mouseenter', () => {
                    if (this.isDragging || this.wasDragging) return; // Не подсвечивать при скролле
    
                    if (!this.isRegionalZoom) {
                        // Подсвечиваем всю страну на глобальном уровне
                        const countryId = path.getAttribute('data-country');
                        this.svg.querySelectorAll(`.region[data-country="${countryId}"]`)
                            .forEach(p => p.classList.add('country-hover'));
                    } else {
                        // На региональном уровне подсвечивается только CSS (:hover), 
                        // JS тут не нужен, но если хотите JS-контроль:
                        path.classList.add('region-hover');
                    }
                });
    
                path.addEventListener('mouseleave', () => {
                    if (!this.isRegionalZoom) {
                        const countryId = path.getAttribute('data-country');
                        this.svg.querySelectorAll(`.region[data-country="${countryId}"]`)
                            .forEach(p => p.classList.remove('country-hover'));
                    } else {
                        path.classList.remove('region-hover');
                    }
                });
            }
        });
        
        this.refreshColors();
    }

    // Этот метод безопасно вызывать сколько угодно раз (например, после каждого хода)
    refreshColors() {
        const paths = document.querySelectorAll('.region');
        paths.forEach(path => {
            const regionData = this.gameData.getRegion(path.id);
            if (regionData) {
                const countryId = regionData.owner;
                const country = this.gameData.getCountry(countryId);
                // ЗАЩИТА: Красим только если страна реально существует в базе
                if (country && country.color) {
                    path.style.fill = country.color;
                }
                path.setAttribute('data-country', countryId);
            }
        });
        // Обновляем маркеры армий вместе с покраской карты
        this.drawArmyMarkers(); // <--- НОВАЯ СТРОКА
    }
    
    // 3. ИДЕАЛЬНЫЙ ЗУМ ДЛЯ ПК, ANDROID И iPHONE
    initEvents() {
        this.lastTouchTime = 0; 

        // === ГЛОБАЛЬНЫЙ ПЕРЕХВАТЧИК КЛИКОВ ===
        this.svg.addEventListener('click', (e) => {
            if (this.wasDragging) {
                e.stopPropagation();
                e.preventDefault();
                return;
            } 

            if (e.target.tagName.toLowerCase() === 'svg') {
                this.clearSelection();
                document.dispatchEvent(new Event('panelClosed'));
            }
        }, false);

        // --- ПК (МЫШЬ И КОЛЕСИКО) ---
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const oldZoomLevel = this.isRegionalZoom;
            const oldScale = this.scale;
            
            const delta = e.deltaY < 0 ? 1 : -1; 
            this.scale += delta * 0.15 * this.scale;
            
            // УВЕЛИЧИЛИ ЛИМИТ ЗУМА ДО 25
            this.scale = Math.min(Math.max(2, this.scale), 25); 
            
            const mouseX = e.clientX, mouseY = e.clientY;
            this.translateX = mouseX - (mouseX - this.translateX) * (this.scale / oldScale);
            this.translateY = mouseY - (mouseY - this.translateY) * (this.scale / oldScale);
            this.updateTransform();

            if (oldZoomLevel !== this.isRegionalZoom) {
                this.updateLOD();
                document.dispatchEvent(new CustomEvent('zoomLevelChanged', { detail: { isRegional: this.isRegionalZoom }}));
            }
        }, { passive: false });

        this.container.addEventListener('mousedown', (e) => {
            if (Date.now() - this.lastTouchTime < 500) return; 
            if (e.button !== 0) return;
            this.isDragging = true;
            this.wasDragging = false; 
            this.mouseStartX = e.clientX;
            this.mouseStartY = e.clientY;
            this.startX = e.clientX - this.translateX;
            this.startY = e.clientY - this.translateY;
        });

        this.container.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            const dx = e.clientX - this.mouseStartX;
            const dy = e.clientY - this.mouseStartY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                this.wasDragging = true;
            }
            this.translateX = e.clientX - this.startX;
            this.translateY = e.clientY - this.startY;
            this.updateTransform();
        });

        this.container.addEventListener('mouseup', () => this.isDragging = false);
        this.container.addEventListener('mouseleave', () => this.isDragging = false);

        // --- ANDROID & iOS (ТАЧСКРИН) ---
        let initialPinchDist = null;

        this.container.addEventListener('touchstart', (e) => {
            this.wasDragging = false; 
            if (e.touches.length === 1) {
                this.isDragging = true;
                this.touchStartX = e.touches[0].clientX;
                this.touchStartY = e.touches[0].clientY;
                this.startX = e.touches[0].clientX - this.translateX;
                this.startY = e.touches[0].clientY - this.translateY;
            } else if (e.touches.length === 2) {
                this.isDragging = false;
                this.wasDragging = true; 
                initialPinchDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        }, { passive: false });

        this.container.addEventListener('touchmove', (e) => {
            e.preventDefault(); 
            if (e.touches.length === 1 && this.isDragging) {
                const dx = e.touches[0].clientX - this.touchStartX;
                const dy = e.touches[0].clientY - this.touchStartY;
                if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                    this.wasDragging = true; 
                }
                this.translateX = e.touches[0].clientX - this.startX;
                this.translateY = e.touches[0].clientY - this.startY;
                this.updateTransform();
            } else if (e.touches.length === 2 && initialPinchDist) {
                this.wasDragging = true;
                const currentDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                const oldZoomLevel = this.isRegionalZoom;
                const oldScale = this.scale;
                const factor = currentDist / initialPinchDist;
                
                // УВЕЛИЧИЛИ ЛИМИТ ЗУМА ДО 25
                this.scale = Math.min(Math.max(2, this.scale * factor), 25);

                const pinchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const pinchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                this.translateX = pinchX - (pinchX - this.translateX) * (this.scale / oldScale);
                this.translateY = pinchY - (pinchY - this.translateY) * (this.scale / oldScale);
                this.updateTransform();

                if (oldZoomLevel !== this.isRegionalZoom) {
                    this.updateLOD();
                    document.dispatchEvent(new CustomEvent('zoomLevelChanged', { detail: { isRegional: this.isRegionalZoom }}));
                }
                initialPinchDist = currentDist; 
            }
        }, { passive: false });

        this.container.addEventListener('touchend', (e) => {
            this.lastTouchTime = Date.now(); 
            if (e.touches.length === 1) {
                this.isDragging = true;
                this.touchStartX = e.touches[0].clientX;
                this.touchStartY = e.touches[0].clientY;
                this.startX = e.touches[0].clientX - this.translateX;
                this.startY = e.touches[0].clientY - this.translateY;
                initialPinchDist = null;
            } else if (e.touches.length === 0) {
                this.isDragging = false;
                initialPinchDist = null;
            }
        });

        // --- iPHONE / iPAD (Safari Gestures) ---
        let iosInitialScale = 1;

        this.container.addEventListener('gesturestart', (e) => {
            e.preventDefault();
            this.isDragging = false;
            this.wasDragging = true;
            iosInitialScale = this.scale;
        });

        this.container.addEventListener('gesturechange', (e) => {
            e.preventDefault();
            this.wasDragging = true;
            const oldZoomLevel = this.isRegionalZoom;
            const oldScale = this.scale;
            
            // УВЕЛИЧИЛИ ЛИМИТ ЗУМА ДО 25
            this.scale = Math.min(Math.max(2, iosInitialScale * e.scale), 25);
            
            const pinchX = window.innerWidth / 2;
            const pinchY = window.innerHeight / 2;
            this.translateX = pinchX - (pinchX - this.translateX) * (this.scale / oldScale);
            this.translateY = pinchY - (pinchY - this.translateY) * (this.scale / oldScale);
            this.updateTransform();

            if (oldZoomLevel !== this.isRegionalZoom) {
                this.updateLOD();
                document.dispatchEvent(new CustomEvent('zoomLevelChanged', { detail: { isRegional: this.isRegionalZoom }}));
            }
        });

        this.container.addEventListener('gestureend', (e) => {
            e.preventDefault();
            this.lastTouchTime = Date.now(); 
        });
    }

    drawCities() {
        this.svg.querySelectorAll('.city-marker, .capital-marker, .city-label, .capital-label').forEach(el => el.remove());

        CitiesDB.forEach(city => {
            const regionPath = document.getElementById(city.regionId);
            if (!regionPath) return; 

            const bbox = regionPath.getBBox();
            const centerX = bbox.x + bbox.width / 2 + (city.offsetX || 0);
            const centerY = bbox.y + bbox.height / 2 + (city.offsetY || 0);

            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", centerX);
            circle.setAttribute("cy", centerY);
            circle.setAttribute("r", city.isCapital ? "0.18" : "0.10"); 
            circle.setAttribute("class", city.isCapital ? "capital-marker" : "city-marker");
            
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", centerX + 0.3); 
            text.setAttribute("y", centerY + 0.05);
            text.setAttribute("class", city.isCapital ? "capital-label" : "city-label");
            text.textContent = city.name;

            this.svg.appendChild(circle);
            this.svg.appendChild(text);
        });
    }

    enableTargetSelection(validRegionIds, targetClass = 'move-target') {
        document.querySelectorAll('.region').forEach(path => {
            if (validRegionIds.includes(path.id)) {
                path.classList.add(targetClass);
            } else {
                path.classList.add('dimmed');
            }
        });
    }

    disableTargetSelection() {
        document.querySelectorAll('.region').forEach(path => {
            path.classList.remove('move-target', 'attack-target', 'dimmed');
        });
    }

    getRegionCenter(path) {
        const id = path.id;
        const bbox = path.getBBox();
        let cx = bbox.x + bbox.width / 2;
        let cy = bbox.y + bbox.height / 2;

        // РУЧНАЯ КОРРЕКТИРОВКА ДЛЯ СЛОЖНЫХ РЕГИОНОВ (Форма полумесяца и т.д.)
        const offsets = {
            'UA-51': { dx: 3.5, dy: -3 }, // Одесская область (Сдвигаем севернее и правее от Молдовы)
            // Если заметите еще кривой регион, добавьте его сюда. Формат: 'ID': { dx: X, dy: Y }
        };

        if (offsets[id]) {
            cx += offsets[id].dx;
            cy += offsets[id].dy;
        }

        return { x: cx, y: cy };
    }

    // Метод для красивого сокращения больших цифр (1500 -> 1.5K)
    formatPower(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return Math.floor(num);
    }
    
    drawArmyMarkers() {
        try {
            // Удаляем старые маркеры
            this.svg.querySelectorAll('.army-marker').forEach(el => el.remove());

            const playerCountryId = this.gameData.playerCountry;

            document.querySelectorAll('.region').forEach(path => {
                const region = this.gameData.getRegion(path.id);
                if (!region) return;

                // === КРИТИЧЕСКИЙ ФИКС: Создаем пустую армию, если её нет ===
                if (!region.army) region.army = {};

                const isOwner = region.owner === playerCountryId;
                
                // Безопасная проверка на соседа
                const isNeighbor = typeof this.gameData.isNeighborToPlayer === 'function' 
                    ? this.gameData.isNeighborToPlayer(region.id) 
                    : false;
                
                const isReconActive = region.reconActiveUntil && region.reconActiveUntil >= this.gameData.currentDate;
                
                // Безопасный подсчет мощи
                let power = 0;
                try {
                    power = this.gameData.calculateRegionMilitaryPower(region.id) || 0;
                } catch(e) { power = 0; }

                let shouldDraw = false;
                let icon = '';
                let textVal = '';
                let color = '';

                // === ПРАВИЛА ОТОБРАЖЕНИЯ ===
                if (isOwner) {
                    if (power > 0) {
                        shouldDraw = true;
                        icon = '🛡️';
                        textVal = ` ${this.formatPower(power)}`;
                        color = '#4ade80'; // Зеленый
                    }
                } else {
                    if (power > 0) {
                        if (isReconActive) {
                            shouldDraw = true;
                            icon = '⚔️';
                            textVal = ` ${this.formatPower(power)}`;
                            color = '#f87171'; // Красный
                        } else if (isNeighbor) {
                            shouldDraw = true;
                            icon = '⚔️';
                            textVal = ''; // Пусто, если разведки не было
                            color = '#fca5a5'; // Бледно-красный
                        }
                    }
                }

                if (shouldDraw) {
                    const center = this.getRegionCenter(path);

                    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
                    group.setAttribute("class", "army-marker");
                    group.setAttribute("pointer-events", "none");
                    
                    // === ХАК ПРОТИВ БАГА БРАУЗЕРОВ ===
                    // Смещаем маркер в центр и сжимаем его в 40 раз (scale(0.025)),
                    // чтобы обойти принудительную блокировку мелких шрифтов.
                    group.setAttribute("transform", `translate(${center.x}, ${center.y + 0.4}) scale(0.025)`);

                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    text.setAttribute("text-anchor", "middle");
                    text.setAttribute("dominant-baseline", "central");
                    
                    // Ставим "большой" шрифт, который сожмется масштабированием группы
                    text.setAttribute("font-size", "10px"); 
                    text.setAttribute("font-family", "Arial, sans-serif");
                    text.setAttribute("font-weight", "bold");
                    text.setAttribute("fill", color);
                    
                    // Делаем красивую черную обводку
                    text.setAttribute("stroke", "rgba(0,0,0,0.8)");
                    text.setAttribute("stroke-width", "1.5px"); 
                    text.setAttribute("paint-order", "stroke");

                    text.textContent = icon + textVal;
                    group.appendChild(text);
                    this.svg.appendChild(group);
                }
            });
        } catch(e) {
            console.error("Ошибка при отрисовке маркеров войск:", e);
        }
    }
}
