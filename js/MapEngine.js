class MapEngine {
    constructor(gameData, onRegionClickCallback) {
        this.container = document.getElementById('map-container');
        this.svg = document.getElementById('world-map');
        this.gameData = gameData;
        this.onRegionClick = onRegionClickCallback;
        
        // НОВЫЕ НАСТРОЙКИ: Географический масштаб
        this.scale = 15; // Стартовый сильный зум
        this.translateX = 0;
        this.translateY = 0;
        this.isDragging = false;
        
        this.zoomThreshold = 22; // Новая граница перехода LOD (Страна -> Регион)
        
        this.initEvents();
        this.centerMap();
        this.colorRegions();
        
        this.createCountryLabels();
        this.drawCities();
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
            
            // МАГИЯ: Поднимаем выбранный регион поверх соседей, чтобы они не перекрывали его белую рамку.
            // При этом оставляем его строго под текстом (названиями стран).
            const firstLabel = this.svg.querySelector('.country-label');
            if (firstLabel) {
                el.parentNode.insertBefore(el, firstLabel);
            } else {
                el.parentNode.appendChild(el);
            }
        }
    }

    selectCountry(countryId) {
        this.clearSelection();
        const firstLabel = this.svg.querySelector('.country-label');
        this.svg.querySelectorAll(`.region[data-country="${countryId}"]`).forEach(el => {
            el.classList.add('selected-country');
            
            // Поднимаем все регионы страны на передний план
            if (firstLabel) {
                el.parentNode.insertBefore(el, firstLabel);
            } else {
                el.parentNode.appendChild(el);
            }
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
            
            const paths = Array.from(this.svg.querySelectorAll('path')).filter(path => {
                const regionData = this.gameData.getRegion(path.id);
                return regionData && regionData.owner === countryId;
            });

            if (paths.length === 0) return;

            // 1. Собираем статистику для вычисления "Центра масс" империи
            let regionsStats = [];
            let totalArea = 0;
            let weightedX = 0;
            let weightedY = 0;

            paths.forEach(path => {
                const bbox = path.getBBox();
                if (bbox.x > 10 && bbox.width > 0 && bbox.height > 0) { 
                    const area = bbox.width * bbox.height;
                    const cx = bbox.x + bbox.width / 2;
                    const cy = bbox.y + bbox.height / 2;
                    
                    regionsStats.push({ cx, cy, area });
                    totalArea += area;
                    weightedX += cx * area;
                    weightedY += cy * area;
                }
            });

            if (regionsStats.length === 0) return;

            // 2. Взвешенный центр империи
            const centerX = weightedX / totalArea;
            const centerY = weightedY / totalArea;

            // ФИЛЬТР: Отбрасываем мелкие острова (меньше 2% площади), чтобы они не ломали ось Норвегии, США, Франции
            const significantRegions = regionsStats.filter(r => r.area > totalArea * 0.02);
            const targetRegionsForAxis = significantRegions.length > 0 ? significantRegions : regionsStats;

            // 3. Вычисляем "Ось империи" по значимым регионам
            let maxDist = 0;
            let furthestRegion = null;
            
            targetRegionsForAxis.forEach(stat => {
                const dist = Math.hypot(stat.cx - centerX, stat.cy - centerY);
                if (dist > maxDist) {
                    maxDist = dist;
                    furthestRegion = stat;
                }
            });

            let angle = 0;
            let empireLength = Math.sqrt(totalArea);

            if (furthestRegion && maxDist > Math.sqrt(totalArea) * 0.2) {
                let dx = furthestRegion.cx - centerX;
                let dy = furthestRegion.cy - centerY;
                angle = Math.atan2(dy, dx) * (180 / Math.PI);
                
                if (angle > 90 || angle < -90) {
                    angle += 180;
                }
                
                empireLength = maxDist * 2.2;
            }

            // 4. Динамический размер без жесткого потолка в 4px
            const letterCount = country.name.length;
            // Делаем текст на 60% от длины империи
            let calculatedFontSize = (empireLength * 0.6) / (letterCount * 0.6);
            
            // Защита от переполнения: шрифт не больше 25% от квадратного корня площади. Верхний лимит подняли с 4 до 18!
            calculatedFontSize = Math.min(calculatedFontSize, Math.sqrt(totalArea) * 0.25, 16.0); 
            calculatedFontSize = Math.max(calculatedFontSize, 0.4);

            // 5. Отрисовываем название
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", centerX);
            text.setAttribute("y", centerY);
            text.setAttribute("text-anchor", "middle"); 
            text.setAttribute("dominant-baseline", "central"); 
            text.setAttribute("class", "country-label");
            text.style.fontSize = `${calculatedFontSize}px`; 
            text.textContent = country.name; 
            
            if (Math.abs(angle) > 5) {
                text.setAttribute("transform", `rotate(${angle}, ${centerX}, ${centerY})`);
            }
            
            this.svg.appendChild(text);
        });
    }

    // 2. ИСПРАВЛЕННОЕ ЦЕНТРИРОВАНИЕ КАМЕРЫ НА СТРАНЕ
    centerMap() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const paths = Array.from(this.svg.querySelectorAll('path')).filter(path => {
            const region = this.gameData.getRegion(path.id);
            return region && region.owner === this.gameData.playerCountry;
        });

        if (paths.length > 0) {
            paths.forEach(path => {
                const bbox = path.getBBox(); 
                if (bbox.width > 0 && bbox.height > 0) { 
                    if (bbox.x < minX) minX = bbox.x;
                    if (bbox.y < minY) minY = bbox.y;
                    if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width;
                    if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height;
                }
            });
        } else {
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
        paths.forEach(path => {
            // Вешаем события ТОЛЬКО ОДИН РАЗ при старте игры
            path.addEventListener('click', (e) => {
                if (!this.wasDragging) this.onRegionClick(path.id);
            });

            path.addEventListener('mouseenter', () => {
                if (!this.isRegionalZoom) {
                    const countryId = path.getAttribute('data-country');
                    this.svg.querySelectorAll(`.region[data-country="${countryId}"]`)
                        .forEach(p => p.classList.add('country-hover'));
                }
            });

            path.addEventListener('mouseleave', () => {
                if (!this.isRegionalZoom) {
                    const countryId = path.getAttribute('data-country');
                    this.svg.querySelectorAll(`.region[data-country="${countryId}"]`)
                        .forEach(p => p.classList.remove('country-hover'));
                }
            });
        });
        
        // Первичная покраска
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
    }
    
    // 3. ИДЕАЛЬНЫЙ ЗУМ ДЛЯ ПК, ANDROID И iPHONE
    initEvents() {
        this.lastTouchTime = 0; 

        // === ГЛОБАЛЬНЫЙ ПЕРЕХВАТЧИК КЛИКОВ ===
        // Если мы скроллили карту - жестко блокируем фантомный клик!
        this.svg.addEventListener('click', (e) => {
            if (this.wasDragging) {
                e.stopPropagation();
                e.preventDefault();
            }
        }, true); // true = перехват срабатывает ДО того, как клик дойдет до региона

        // --- ПК (МЫШЬ И КОЛЕСИКО) ---
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const oldZoomLevel = this.isRegionalZoom;
            const oldScale = this.scale;
            
            const delta = e.deltaY < 0 ? 1 : -1; 
            this.scale += delta * 0.15 * this.scale;
            this.scale = Math.min(Math.max(2, this.scale), 80); 
            
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
            
            // Считаем это перетаскиванием, только если мышь сдвинулась больше чем на 3 пикселя
            const dx = e.clientX - this.mouseStartX;
            const dy = e.clientY - this.mouseStartY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                this.wasDragging = true;
            }

            this.translateX = e.clientX - this.startX;
            this.translateY = e.clientY - this.startY;
            this.updateTransform();
        });

        this.container.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
        
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
                this.wasDragging = true; // Зум - это тоже манипуляция, клик не нужен
                initialPinchDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        }, { passive: false });

        this.container.addEventListener('touchmove', (e) => {
            e.preventDefault(); 
            if (e.touches.length === 1 && this.isDragging) {
                
                // Защита от микро-дрожания пальца. Движение < 4px не считается скроллом
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
                this.scale = Math.min(Math.max(2, this.scale * factor), 80);

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
            
            this.scale = Math.min(Math.max(2, iosInitialScale * e.scale), 80);
            
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
}
