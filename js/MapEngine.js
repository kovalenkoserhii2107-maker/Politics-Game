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

    centerMap() {
        const rect = this.container.getBoundingClientRect();
        
        // Надежно получаем размеры экрана
        const screenWidth = rect.width || window.innerWidth;
        const screenHeight = rect.height || window.innerHeight;

        // Дефолтные координаты (Центр Европы), если страна вдруг не найдена
        let targetX = 150; 
        let targetY = 100; 
        this.scale = 4; 

        // Ищем все регионы, принадлежащие выбранной стране игрока
        const playerCountryId = this.gameData.playerCountry;
        const paths = Array.from(this.svg.querySelectorAll('path')).filter(path => {
            const regionData = this.gameData.getRegion(path.id);
            return regionData && regionData.owner === playerCountryId;
        });

        if (paths.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            
            // Вычисляем крайние точки (габариты) страны в координатах SVG
            paths.forEach(path => {
                const bbox = path.getBBox(); 
                if (bbox.x > 10 && bbox.width > 0 && bbox.height > 0) { 
                    if (bbox.x < minX) minX = bbox.x;
                    if (bbox.y < minY) minY = bbox.y;
                    if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width;
                    if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height;
                }
            });

            // 1. Устанавливаем математический центр страны (в сетке 1200x800)
            targetX = minX + (maxX - minX) / 2;
            targetY = minY + (maxY - minY) / 2;

            // 2. Умный зум: чтобы страна занимала комфортные 45% экрана
            const maxDimensionSVG = Math.max(maxX - minX, maxY - minY);
            if (maxDimensionSVG > 0) {
                // Вычисляем, насколько браузер сам растянул SVG
                const svgBaseScale = Math.min(screenWidth / 1200, screenHeight / 800);
                const countryPixelSize = maxDimensionSVG * svgBaseScale;
                const desiredPixelSize = Math.min(screenWidth, screenHeight) * 0.45;
                
                const desiredScale = desiredPixelSize / countryPixelSize;
                // Лимитируем зум, чтобы не вывалиться в региональный режим (22)
                this.scale = Math.min(Math.max(desiredScale, 2.5), 18.0);
            }
        }

        // 3. СЛОЖНАЯ МАТЕМАТИКА ПЕРЕВОДА: SVG -> Физические пиксели экрана
        const svgAspect = 1200 / 800;
        const screenAspect = screenWidth / screenHeight;
        let baseScale, offsetX = 0, offsetY = 0;

        // Учитываем черные полосы (letterboxing), которые браузер добавляет для сохранения пропорций
        if (screenAspect > svgAspect) {
            baseScale = screenHeight / 800;
            offsetX = (screenWidth - 1200 * baseScale) / 2;
        } else {
            baseScale = screenWidth / 1200;
            offsetY = (screenHeight - 800 * baseScale) / 2;
        }

        // Вычисляем реальное положение центра страны на мониторе ДО зума
        const physicalX = offsetX + targetX * baseScale;
        const physicalY = offsetY + targetY * baseScale;

        // 4. Двигаем камеру так, чтобы центр страны оказался ровно по центру экрана
        this.translateX = (screenWidth / 2) - (physicalX * this.scale);
        this.translateY = (screenHeight / 2) - (physicalY * this.scale); 
        
        this.updateTransform();
    }

    updateTransform() {
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

    initEvents() {
        // --- СОБЫТИЯ МЫШИ (ПК) ---
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const oldZoomLevel = this.isRegionalZoom;
            
            const zoomSpeed = 0.15;
            const delta = e.deltaY < 0 ? 1 : -1; 
            const oldScale = this.scale;
            
            this.scale += delta * zoomSpeed * this.scale;
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
            if (e.button !== 0) return;
            this.isDragging = true;
            this.wasDragging = false;
            this.startX = e.clientX - this.translateX;
            this.startY = e.clientY - this.translateY;
        });

        this.container.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.wasDragging = true;
            this.translateX = e.clientX - this.startX;
            this.translateY = e.clientY - this.startY;
            this.updateTransform();
        });

        this.container.addEventListener('mouseup', () => this.isDragging = false);
        this.container.addEventListener('mouseleave', () => this.isDragging = false);

        // --- СОБЫТИЯ КАСАНИЙ (МОБИЛЬНЫЕ ТЕЛЕФОНЫ / ТАЧСКРИНЫ) ---
        let touchStartDist = 0;
        let initialScale = this.scale;

        this.container.addEventListener('touchstart', (e) => {
            this.wasDragging = false;
            if (e.touches.length === 1) {
                // Перемещение одним пальцем
                this.isDragging = true;
                this.startX = e.touches[0].clientX - this.translateX;
                this.startY = e.touches[0].clientY - this.translateY;
            } else if (e.touches.length === 2) {
                // Зум двумя пальцами (щипок)
                this.isDragging = false;
                touchStartDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                initialScale = this.scale;
            }
        }, { passive: false });

        this.container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && this.isDragging) {
                // Двигаем карту одним пальцем
                this.wasDragging = true;
                e.preventDefault(); // Запрещаем стандартный скролл страницы телефона
                this.translateX = e.touches[0].clientX - this.startX;
                this.translateY = e.touches[0].clientY - this.startY;
                this.updateTransform();
            } else if (e.touches.length === 2) {
                // Меняем масштаб при щипке двумя пальцами
                e.preventDefault();
                const oldZoomLevel = this.isRegionalZoom;
                const currentDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                
                if (touchStartDist > 10) {
                    const factor = currentDist / touchStartDist;
                    this.scale = Math.min(Math.max(2, initialScale * factor), 80);
                    this.updateTransform();

                    if (oldZoomLevel !== this.isRegionalZoom) {
                        this.updateLOD();
                        document.dispatchEvent(new CustomEvent('zoomLevelChanged', { detail: { isRegional: this.isRegionalZoom }}));
                    }
                }
            }
        }, { passive: false });

        this.container.addEventListener('touchend', (e) => {
            if (e.touches.length < 1) {
                this.isDragging = false;
            }
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