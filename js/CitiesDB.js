const CitiesDB = [
    // ================= СТОЛИЦЫ (Отображаются всегда) =================
    { name: 'Киев', regionId: 'UA-32', isCapital: true },
    { name: 'Варшава', regionId: 'PL-MZ', isCapital: true },
    { name: 'Минск', regionId: 'BY-MI', isCapital: true }, 
    { name: 'Бухарест', regionId: 'RO-IF', isCapital: true },
    { name: 'Кишинев', regionId: 'MD-CU', isCapital: true },
    { name: 'Будапешт', regionId: 'HU-PE', isCapital: true },
    { name: 'Братислава', regionId: 'SK-BL', isCapital: true },
    { name: 'София', regionId: 'BG-23', isCapital: true },
    { name: 'Тбилиси', regionId: 'GE-KK', isCapital: true },
    { name: 'Москва', regionId: 'RU-MOW', isCapital: true },
    { name: 'Анкара', regionId: 'TR-06', isCapital: true },
    { name: 'Берлин', regionId: 'DE-BE', isCapital: true },
    { name: 'Париж', regionId: 'FR-IDF', isCapital: true },
    { name: 'Лондон', regionId: 'GB-ENG', isCapital: true },
    { name: 'Рим', regionId: 'IT-62', isCapital: true },
    { name: 'Мадрид', regionId: 'ES-MD', isCapital: true },
    { name: 'Вена', regionId: 'AT-9', isCapital: true },
    { name: 'Прага', regionId: 'CZ-PR', isCapital: true },
    { name: 'Берн', regionId: 'CH-BE', isCapital: true },
    { name: 'Афины', regionId: 'GR-I', isCapital: true },
    { name: 'Стокгольм', regionId: 'SE-AB', isCapital: true },
    { name: 'Осло', regionId: 'NO-03', isCapital: true },
    { name: 'Хельсинки', regionId: 'FI-18', isCapital: true },
    { name: 'Рига', regionId: 'LV-RIX', isCapital: true },
    { name: 'Вильнюс', regionId: 'LT-VL', isCapital: true },
    { name: 'Таллин', regionId: 'EE-37', isCapital: true },

    // ================= КРУПНЫЕ ГОРОДА (500k+ населения) =================

    // --- Украина ---
    { name: 'Харьков', regionId: 'UA-63', isCapital: false },
    { name: 'Одесса', regionId: 'UA-51', isCapital: false, offsetX: -0.6, offsetY: 1.0 },
    { name: 'Днепр', regionId: 'UA-12', isCapital: false },
    { name: 'Донецк', regionId: 'UA-14', isCapital: false },
    { name: 'Запорожье', regionId: 'UA-23', isCapital: false },
    { name: 'Львов', regionId: 'UA-46', isCapital: false },
    { name: 'Кривой Рог', regionId: 'UA-12', isCapital: false, offsetX: -1.5, offsetY: 0.8 }, // Смещение, так как в одном регионе с Днепром

    // --- Польша ---
    { name: 'Краков', regionId: 'PL-MA', isCapital: false },
    { name: 'Вроцлав', regionId: 'PL-DS', isCapital: false },
    { name: 'Лодзь', regionId: 'PL-LD', isCapital: false },
    { name: 'Познань', regionId: 'PL-WP', isCapital: false },

    // --- Россия (Европейская часть) ---
    { name: 'Санкт-Петербург', regionId: 'RU-LEN', isCapital: false },
    { name: 'Краснодар', regionId: 'RU-KDA', isCapital: false },
    { name: 'Ростов-на-Дону', regionId: 'RU-ROS', isCapital: false },
    { name: 'Воронеж', regionId: 'RU-VOR', isCapital: false },
    { name: 'Волгоград', regionId: 'RU-VGG', isCapital: false },
    { name: 'Саратов', regionId: 'RU-SAR', isCapital: false },

    // --- Турция ---
    { name: 'Стамбул', regionId: 'TR-34', isCapital: false },
    { name: 'Измир', regionId: 'TR-35', isCapital: false },
    { name: 'Бурса', regionId: 'TR-16', isCapital: false },
    { name: 'Адана', regionId: 'TR-01', isCapital: false },
    { name: 'Анталья', regionId: 'TR-07', isCapital: false },
    { name: 'Конья', regionId: 'TR-42', isCapital: false },
    { name: 'Газиантеп', regionId: 'TR-27', isCapital: false },

    // --- Германия ---
    { name: 'Гамбург', regionId: 'DE-HH', isCapital: false },
    { name: 'Мюнхен', regionId: 'DE-BY', isCapital: false },
    { name: 'Кёльн', regionId: 'DE-NW', isCapital: false },
    { name: 'Франкфурт', regionId: 'DE-HE', isCapital: false },
    { name: 'Штутгарт', regionId: 'DE-BW', isCapital: false },
    { name: 'Дюссельдорф', regionId: 'DE-NW', isCapital: false, offsetX: -0.8, offsetY: -0.8 },
    { name: 'Лейпциг', regionId: 'DE-SN', isCapital: false },

    // --- Франция ---
    { name: 'Марсель', regionId: 'FR-PAC', isCapital: false },
    { name: 'Лион', regionId: 'FR-ARA', isCapital: false },
    { name: 'Тулуза', regionId: 'FR-OCC', isCapital: false },

    // --- Великобритания ---
    { name: 'Бирмингем', regionId: 'GB-ENG', isCapital: false, offsetX: 0, offsetY: 1.5 },
    { name: 'Манчестер', regionId: 'GB-ENG', isCapital: false, offsetX: -0.5, offsetY: -1.0 },
    { name: 'Глазго', regionId: 'GB-SCT', isCapital: false },
    { name: 'Ливерпуль', regionId: 'GB-ENG', isCapital: false, offsetX: -1.2, offsetY: -0.5 },

    // --- Италия ---
    { name: 'Милан', regionId: 'IT-25', isCapital: false },
    { name: 'Неаполь', regionId: 'IT-72', isCapital: false },
    { name: 'Турин', regionId: 'IT-21', isCapital: false },
    { name: 'Палермо', regionId: 'IT-82', isCapital: false },
    { name: 'Генуя', regionId: 'IT-42', isCapital: false },

    // --- Испания ---
    { name: 'Барселона', regionId: 'ES-CT', isCapital: false },
    { name: 'Валенсия', regionId: 'ES-VC', isCapital: false },
    { name: 'Севилья', regionId: 'ES-AN', isCapital: false },
    { name: 'Сарагоса', regionId: 'ES-AR', isCapital: false },
    { name: 'Малага', regionId: 'ES-AN', isCapital: false, offsetX: 1.0, offsetY: 0.5 },

    // --- Остальные страны ---
    { name: 'Гомель', regionId: 'BY-HO', isCapital: false },
    { name: 'Гётеборг', regionId: 'SE-O', isCapital: false },
    { name: 'Салоники', regionId: 'GR-B', isCapital: false }
];