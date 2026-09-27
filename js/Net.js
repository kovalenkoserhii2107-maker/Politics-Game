// =====================================================================
// СЕТЕВАЯ ИГРА ПО WI-FI
//
// Кто создал игру — тот сервер: у него главная копия мира. Гости играют на
// своей копии и записывают команды (GameData.act). Когда все нажали «Конец
// хода», сервер повторяет команды гостей от их имени, считает ход и
// рассылает каждому новый мир и его отчёт.
//
// Связь — WebRTC через библиотеку PeerJS. Публичный брокер PeerJS нужен
// только, чтобы устройства нашли друг друга; сами ходы идут напрямую по
// локальной сети. Устройства за одним роутером видны снаружи с одного
// адреса — по нему гость находит игры в своей сети без кода. Код комнаты —
// запасной путь.
//
// Для проверки без интернета: ?signal=localhost:9000 — свой брокер,
// ?netkey=test — общая «сеть» без определения адреса.
// =====================================================================
const NET = {
    PREFIX: 'grandstrategy-v1',
    LIB: 'js/vendor/peerjs-1.5.5.min.js',
    SLOTS: 4,               // столько игр одновременно видно в одной сети
    // PeerJS пропускает сообщение до 16 300 байт. Символ — до 3 байт, а
    // кавычки внутри куска при упаковке удваиваются: 4000 символов — с запасом.
    CHUNK: 4000,
    SCAN_MS: 3500,
    JOIN_MS: 10000,
    MAX_PLAYERS: 4,
    CODE_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    CHAT_MAX: 140,          // длина сообщения в чате
    CHAT_KEEP: 40,          // сколько сообщений помнит сервер
    NUDGE_MS: 15000,        // «Поторопить» — не чаще раза в 15 секунд
    TIMERS: [0, 120, 300],  // таймер хода: нет, 2 и 5 минут
    GRACE_MS: 8000,         // после таймера сервер ждёт опоздавших столько
    BEAT_MS: 3000,          // «я на связи» — так часто
    DEAD_MS: 10000,         // тишина дольше — связь считаем оборванной
    RETRY_MS: 2000,         // гость переподключается так часто
    ORPHAN_TRIES: 2,        // столько раз подряд сервера нет — становимся сервером сами
    CLIENT_KEY: 'politics-net-client',
    LAST_KEY: 'politics-net-last',
};

class Net {
    static params() {
        try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(); }
    }

    // Библиотека нужна только в сетевой игре — грузим по требованию.
    static loadLib() {
        if (window.Peer) return Promise.resolve();
        if (!Net.libPromise) {
            Net.libPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = NET.LIB;
                script.onload = () => resolve();
                script.onerror = () => { Net.libPromise = null; reject(new Error('Не удалось загрузить модуль сети. Проверьте интернет.')); };
                document.head.appendChild(script);
            });
        }
        return Net.libPromise;
    }

    static peerOptions() {
        const options = { debug: 0 };
        const signal = Net.params().get('signal');
        if (signal) {
            const [host, port] = signal.split(':');
            Object.assign(options, { host, port: Number(port) || 9000, path: '/', secure: false });
        }
        return options;
    }

    static hash(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        return (h >>> 0).toString(36);
    }

    // Внешний адрес сети (как нас видит сервер STUN) — общий у всех устройств
    // за одним роутером. Сам адрес наружу не уходит, только его отпечаток.
    static networkKey() {
        const forced = Net.params().get('netkey');
        if (forced) return Promise.resolve(forced.replace(/[^a-z0-9]/gi, '').slice(0, 16) || null);
        if (Net.keyPromise) return Net.keyPromise;
        Net.keyPromise = new Promise(resolve => {
            let pc;
            try {
                pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] });
            } catch (e) { resolve(null); return; }
            let finished = false;
            const done = value => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                try { pc.close(); } catch (e) { /* уже закрыт */ }
                resolve(value);
            };
            const timer = setTimeout(() => done(null), 4000);
            pc.onicecandidate = e => {
                if (!e.candidate) return;
                const m = / (\d{1,3}(?:\.\d{1,3}){3}) \d+ typ srflx/.exec(e.candidate.candidate);
                if (m) done(Net.hash('net:' + m[1]));
            };
            pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') done(null); };
            pc.createDataChannel('probe');
            pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => done(null));
        });
        return Net.keyPromise;
    }

    static roomId(code) { return `${NET.PREFIX}-room-${code}`; }
    // Постоянная комната кампании: по её номеру, а не по коду — код может
    // смениться, номер кампании — нет. Её держит тот, кто сейчас сервер.
    static campaignRoom(id) { return `${NET.PREFIX}-camp-${String(id).replace(/[^a-z0-9]/gi, '')}`; }
    static beaconId(key, slot) { return `${NET.PREFIX}-lan-${key}-${slot}`; }

    static randomCode() {
        let code = '';
        for (let i = 0; i < 4; i++) code += NET.CODE_CHARS[Math.floor(Math.random() * NET.CODE_CHARS.length)];
        return code;
    }

    static normalizeCode(text) {
        return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    }

    // Подключение к брокеру под своим именем (или случайным). onTaken —
    // имя за время обрыва занял кто-то другой.
    static openPeer(id, onTaken) {
        return new Promise((resolve, reject) => {
            const peer = id ? new window.Peer(id, Net.peerOptions()) : new window.Peer(Net.peerOptions());
            const onError = err => { peer.off('open', onOpen); peer.destroy(); reject(err); };
            const onOpen = () => {
                peer.off('error', onError);
                Net.keepAlive(peer, onTaken);
                resolve(peer);
            };
            peer.once('open', onOpen);
            peer.once('error', onError);
        });
    }

    // Брокер отваливается, когда телефон засыпает или мигает Wi-Fi. Без него
    // к нам не подключиться, поэтому стучимся снова — с паузами, а при
    // возвращении в приложение — сразу.
    static keepAlive(peer, onTaken) {
        let delay = 1000, timer = null;
        const attempt = () => {
            timer = null;
            if (peer.destroyed || !peer.disconnected) return;
            try { peer.reconnect(); } catch (e) { /* попробуем позже */ }
            delay = Math.min(delay * 2, 15000);
            schedule();
        };
        const schedule = () => { if (!timer && !peer.destroyed) timer = setTimeout(attempt, delay); };
        const wake = () => {
            if (document.visibilityState !== 'visible' || peer.destroyed || !peer.disconnected) return;
            clearTimeout(timer); timer = null; delay = 1000;
            attempt();
        };
        peer.on('disconnected', schedule);
        peer.on('open', () => { delay = 1000; });
        peer.on('error', err => { if (err && err.type === 'unavailable-id' && onTaken) onTaken(); });
        peer.on('close', () => { clearTimeout(timer); document.removeEventListener('visibilitychange', wake); });
        document.addEventListener('visibilitychange', wake);
    }

    static sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    static clientId() {
        try {
            let id = localStorage.getItem(NET.CLIENT_KEY);
            if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem(NET.CLIENT_KEY, id); }
            return id;
        } catch (e) {
            Net.memoryId = Net.memoryId || Math.random().toString(36).slice(2, 12);
            return Net.memoryId;
        }
    }

    static rememberGame(info) {
        try {
            if (info) localStorage.setItem(NET.LAST_KEY, JSON.stringify(info));
            else localStorage.removeItem(NET.LAST_KEY);
        } catch (e) { /* не критично */ }
    }

    static lastGame() {
        try { return JSON.parse(localStorage.getItem(NET.LAST_KEY) || 'null'); } catch (e) { return null; }
    }

    static cleanName(name) {
        return String(name || '').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Игрок';
    }
}

// Канал к одному устройству: сообщения — объекты, длинные режутся на куски.
class NetLink {
    constructor(conn, onMessage, onClose) {
        this.conn = conn;
        this.onMessage = onMessage;
        this.onClose = onClose;
        this.parts = new Map();
        this.closed = false;
        this.lastSeen = Date.now();
        conn.on('data', raw => this.receive(raw));
        conn.on('close', () => this.fail());
        conn.on('error', () => this.fail());
        // WebRTC замечает пропажу собеседника через полминуты, а то и никогда
        // (телефон заснул). Шлём «я на связи»; тишина — связь оборвалась.
        this.beat = setInterval(() => {
            if (this.closed) return;
            if (Date.now() - this.lastSeen > NET.DEAD_MS) { this.fail(); return; }
            try { if (this.conn.open) this.conn.send({ h: 1 }); } catch (e) { /* закроется само */ }
        }, NET.BEAT_MS);
    }

    // Связь пропала сама — сообщаем владельцу.
    fail() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.beat);
        try { this.conn.close(); } catch (e) { /* уже закрыт */ }
        if (this.onClose) this.onClose();
    }

    send(message) {
        if (this.closed || !this.conn.open) return false;
        const text = JSON.stringify(message);
        if (text.length <= NET.CHUNK) {
            this.conn.send({ m: text });
            return true;
        }
        const id = Math.random().toString(36).slice(2);
        const n = Math.ceil(text.length / NET.CHUNK);
        for (let i = 0; i < n; i++) this.conn.send({ c: id, i, n, d: text.slice(i * NET.CHUNK, (i + 1) * NET.CHUNK) });
        return true;
    }

    receive(raw) {
        if (!raw || typeof raw !== 'object') return;
        this.lastSeen = Date.now();
        if (raw.h) return;
        let text = null;
        if (typeof raw.m === 'string') text = raw.m;
        else if (typeof raw.c === 'string' && Number.isInteger(raw.i) && Number.isInteger(raw.n) && raw.n > 0 && raw.n < 10000) {
            let entry = this.parts.get(raw.c);
            if (!entry) { entry = { n: raw.n, got: 0, list: [] }; this.parts.set(raw.c, entry); }
            if (entry.list[raw.i] === undefined && typeof raw.d === 'string') { entry.list[raw.i] = raw.d; entry.got++; }
            if (entry.got < entry.n) return;
            this.parts.delete(raw.c);
            text = entry.list.join('');
        }
        if (text === null) return;
        let message;
        try { message = JSON.parse(text); } catch (e) { return; }
        if (message && typeof message === 'object') this.onMessage(message);
    }

    // Закрываем сами — владельцу не сообщаем.
    close() {
        this.closed = true;
        clearInterval(this.beat);
        try { this.conn.close(); } catch (e) { /* уже закрыт */ }
    }
}

// ---------------------------------------------------------------------
// СЕРВЕР: тот, кто создал игру
// ---------------------------------------------------------------------
class NetHost {
    constructor(name, callbacks = {}) {
        this.role = 'host';
        this.name = Net.cleanName(name);
        this.callbacks = callbacks;       // onChange(), onError(text)
        this.players = [{ id: 'host', name: this.name, cc: null, host: true, connected: true, ready: false }];
        this.data = null;
        this.game = null;
        this.lan = null;                  // true — игру видно в сети, false — только по коду
        this.lastReports = {};
    }

    // resume — партия из сохранения: тот же код и те же места.
    async start(resume) {
        await Net.loadLib();
        if (resume) {
            this.data = resume;
            const net = resume.net || {};
            const names = net.names || {};
            this.players[0].cc = resume.playerCountry;
            this.players[0].name = names[resume.playerCountry] || this.name;
            // места — по списку людей: сервером может стать и бывший гость,
            // тогда бывший сервер займёт свободное место при подключении
            const byCountry = {};
            for (const [id, cc] of Object.entries(net.clients || {})) if (cc !== resume.playerCountry) byCountry[cc] = id;
            for (const cc of resume.humans) {
                if (cc === resume.playerCountry) continue;
                this.players.push({ id: byCountry[cc] || `seat-${cc}`, name: names[cc] || 'Игрок', cc, host: false, connected: false, ready: false });
            }
            resume.net = { ...net, clients: Object.fromEntries(Object.entries(byCountry).map(([cc, id]) => [id, cc])) };
        }
        // Кампания: сначала её постоянная комната. Занята — значит, кампанию
        // уже открыл другой игрок, и нам к нему (err.taken).
        if (resume && resume.net && resume.net.id) {
            try {
                this.campRoom = await Net.openPeer(Net.campaignRoom(resume.net.id), () => this.lostRoom());
            } catch (err) {
                const e = new Error(err.type === 'unavailable-id' ? 'Кампания уже открыта на другом устройстве' : this.explain(err));
                e.taken = err.type === 'unavailable-id';
                throw e;
            }
            this.listen(this.campRoom);
        }
        // Код — для новых устройств. Старый может быть ещё занят брокером
        // (он помнит нас минуту после обрыва) — тогда берём новый.
        let code = resume?.net?.code || Net.randomCode();
        for (let attempt = 0; ; attempt++) {
            try {
                this.room = await Net.openPeer(Net.roomId(code));
                break;
            } catch (err) {
                if (err.type !== 'unavailable-id' || attempt >= 5) { if (this.campRoom) this.campRoom.destroy(); throw new Error(this.explain(err)); }
                code = Net.randomCode();
            }
        }
        this.code = code;
        if (this.data) this.data.net = { ...(this.data.net || {}), code };
        this.listen(this.room);
        this.startBeacon();
        this.changed();
        return code;
    }

    listen(peer) {
        peer.on('connection', conn => this.accept(conn));
        peer.on('error', () => { /* чужие сбои соединений не роняют игру */ });
    }

    // Новая партия: номер кампании появился при старте — занимаем её комнату,
    // чтобы после обрыва гости находили нас без кода.
    async claimCampaignRoom() {
        const id = this.data && this.data.net && this.data.net.id;
        for (let attempt = 0; id && !this.campRoom && !this.stopped && attempt < 20; attempt++) {
            try {
                this.campRoom = await Net.openPeer(Net.campaignRoom(id), () => this.lostRoom());
                this.listen(this.campRoom);
                return;
            } catch (err) {
                await Net.sleep(5000);
            }
        }
    }

    // Пока нас не было у брокера, комнату кампании занял другой игрок —
    // теперь сервер он, а мы подключаемся к нему.
    lostRoom() {
        if (this.stopped) return;
        if (this.callbacks.onTaken) this.callbacks.onTaken();
    }

    explain(err) {
        if (err && err.type === 'network') return 'Нет связи с сервером знакомств. Нужен интернет, чтобы устройства нашли друг друга.';
        if (err && err.type === 'browser-incompatible') return 'Этот браузер не поддерживает игру по сети.';
        return 'Не удалось создать игру: ' + ((err && err.message) || 'ошибка сети');
    }

    // Маячок в «сети роутера»: гость спрашивает — маячок отвечает, что за игра.
    async startBeacon() {
        const key = await Net.networkKey();
        if (!key) { this.lan = false; this.changed(); return; }
        for (let slot = 1; slot <= NET.SLOTS && !this.beacon; slot++) {
            try { this.beacon = await Net.openPeer(Net.beaconId(key, slot)); } catch (e) { /* место занято другой игрой */ }
        }
        this.lan = !!this.beacon;
        if (this.beacon) {
            this.beacon.on('error', () => {});
            this.beacon.on('connection', conn => {
                conn.on('open', () => {
                    conn.send({ m: JSON.stringify(this.hello()) });
                    setTimeout(() => conn.close(), 1500);
                });
            });
        }
        this.changed();
    }

    hello() {
        const host = this.players[0];
        return { t: 'hello', code: this.code, host: host.name, cc: host.cc, players: this.players.length, started: !!this.data, campaign: this.data && this.data.net ? this.data.net.id : null };
    }

    accept(conn) {
        conn.on('open', () => {
            const meta = conn.metadata || {};
            const id = String(meta.clientId || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
            if (!id || id === 'host') { conn.close(); return; }
            const reject = reason => { conn.send({ m: JSON.stringify({ t: 'reject', reason }) }); setTimeout(() => conn.close(), 500); };
            let player = this.players.find(p => p.id === id);
            if (!player) {
                if (this.data) {
                    // партия идёт: устройство занимает место своей страны (так
                    // возвращается бывший сервер), иначе — любое свободное
                    const cc = String(meta.cc || '');
                    player = this.players.find(p => !p.host && !p.connected && p.cc === cc)
                        || this.players.find(p => !p.host && !p.connected);
                    if (!player) { reject('Игра уже идёт, свободных мест нет'); return; }
                    this.data.net.clients = Object.fromEntries(Object.entries(this.data.net.clients || {}).filter(([, cc]) => cc !== player.cc));
                    this.data.net.clients[id] = player.cc;
                    player.id = id;
                } else {
                    if (this.players.length >= NET.MAX_PLAYERS) { reject(`В игре уже ${NET.MAX_PLAYERS} игрока`); return; }
                    player = { id, name: 'Игрок', cc: null, host: false, connected: false, ready: false };
                    this.players.push(player);
                }
            }
            if (player.link) player.link.close();
            player.name = Net.cleanName(meta.name);
            player.connected = true;
            if (this.data && player.cc && this.data.net) this.data.net.names = { ...(this.data.net.names || {}), [player.cc]: player.name };
            const link = new NetLink(conn, message => this.onMessage(player, message), () => {
                if (player.link !== link) return;
                player.link = null;
                player.connected = false;
                if (!this.data) this.players = this.players.filter(p => p !== player);
                this.changed();
            });
            player.link = link;
            // вернулся посреди хода с таймером — время на ход у всех заново,
            // иначе его ход ушёл бы сразу по истёкшим часам
            if (this.data && this.deadline && !player.ready) this.deadline = Math.max(this.deadline, Date.now() + this.timer * 1000);
            this.changed();
        });
    }

    onMessage(player, message) {
        const d = this.data;
        if (message.t === 'join') {
            // гость только что подключился: в лобби — состав, в игре — мир,
            // если у гостя его нет или он отстал на ход
            if (this.chatLog && this.chatLog.length) this.sendTo(player, { t: 'chatlog', list: this.chatLog });
            if (!d) this.broadcastLobby();
            else if (player.cc && Number.isInteger(message.turn) && message.turn > d.turn) {
                // у гостя мир новее (он был сервером, пока нас не было) — берём его
                this.adopting = player;
                this.sendTo(player, { t: 'upload' });
            } else if (message.fresh || message.turn !== d.turn) this.sendState(player, message.turn === d.turn - 1 ? this.lastReports[player.cc] : null);
            this.changed();
        } else if (message.t === 'pick' && !d) {
            const cc = String(message.cc || '');
            const owner = this.players.find(p => p.cc === cc && p !== player);
            if (!CountriesDB[cc] || !CountriesDB[cc].playable) return;
            if (owner) { this.sendTo(player, { t: 'toast', text: `${CountriesDB[cc].name} уже выбрал(а) ${owner.name}` }); this.broadcastLobby(); return; }
            player.cc = cc;
            this.changed();
        } else if (message.t === 'loaded' && d) {
            player.loaded = true;
            this.changed();
        } else if (message.t === 'turn' && d) {
            player.loaded = true;
            if (!player.cc || message.turn !== d.turn) return;
            player.commands = Array.isArray(message.commands) ? message.commands.slice(0, 5000) : [];
            player.ready = true;
            this.changed();
            this.maybeResolve();
        } else if (message.t === 'unready' && d) {
            player.ready = false;
            player.commands = null;
            this.changed();
        } else if (message.t === 'chat') {
            this.relayChat(player, message.text);
        } else if (message.t === 'ping') {
            this.relayPing(player, message.region);
        } else if (message.t === 'nudge' && d) {
            this.relayNudge(player);
        } else if (message.t === 'bye') {
            if (player.link) player.link.fail();
        } else if (message.t === 'world' && d && this.adopting === player) {
            this.adopting = null;
            this.adoptWorld(message.state);
        }
    }

    // Мир от гостя новее нашего: он становится общим.
    adoptWorld(state) {
        const d = this.data, me = this.players[0].cc;
        let fresh;
        try {
            fresh = GameData.restore(state);
            if (fresh.turn <= d.turn || !fresh.isHuman(me)) return;
            fresh.becomePlayer(me);
        } catch (e) { console.error(e); return; }
        fresh.net = { ...(fresh.net || {}), ...d.net, id: d.net.id };
        for (const key of Object.keys(d)) delete d[key];
        Object.assign(d, fresh);
        for (const p of this.players) { p.ready = false; p.commands = null; }
        this.lastReports = {};
        this.startClock();
        if (this.game) this.game.onNewWorld(null);
        SaveGame.save(d);
        for (const p of this.players) if (!p.host) this.sendState(p, null);
        if (this.callbacks.onToast) this.callbacks.onToast(`Взяли более новую копию мира — ход ${d.turn + 1}`);
        this.changed();
    }

    // «Поторопить»: тем, кто ещё не нажал «Конец хода».
    relayNudge(player) {
        const now = Date.now();
        if (!player.cc || now - (player.nudgedAt || 0) < NET.NUDGE_MS) return false;
        player.nudgedAt = now;
        const entry = { t: 'nudge', from: player.name, cc: player.cc };
        for (const p of this.waitingFor()) {
            if (p === player) continue;
            if (p.host) { if (this.callbacks.onNudge) this.callbacks.onNudge(entry); }
            else this.sendTo(p, entry);
        }
        return true;
    }

    nudge() { return this.relayNudge(this.players[0]); }

    // --- чат и метки: сервер пересылает всем ---------------------------
    relayChat(player, text) {
        text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, NET.CHAT_MAX);
        if (!text) return;
        const entry = { t: 'chat', from: player.name, cc: player.cc, text, at: Date.now() };
        this.chatLog = [...(this.chatLog || []), entry].slice(-NET.CHAT_KEEP);
        for (const p of this.players) if (!p.host) this.sendTo(p, entry);
        if (this.callbacks.onChat) this.callbacks.onChat(entry);
    }

    relayPing(player, region) {
        if (!RegionsDB[region]) return;
        const entry = { t: 'ping', from: player.name, cc: player.cc, region, at: Date.now() };
        this.chatLog = [...(this.chatLog || []), entry].slice(-NET.CHAT_KEEP);
        for (const p of this.players) if (!p.host && p !== player) this.sendTo(p, entry);
        if (player !== this.players[0] && this.callbacks.onPing) this.callbacks.onPing(entry);
    }

    say(text) { this.relayChat(this.players[0], text); }
    ping(region) { this.relayPing(this.players[0], region); }

    sendTo(player, message) { return player.link ? player.link.send(message) : false; }

    lobbyState() {
        return {
            t: 'lobby', code: this.code,
            players: this.players.map(p => ({ id: p.id, name: p.name, cc: p.cc, host: p.host, connected: p.connected })),
            scenario: this.options?.scenario || 'peace', difficulty: this.options?.difficulty || 'normal', goal: this.options?.goal || 'domination', timer: this.options?.timer || 0,
        };
    }

    broadcastLobby() {
        const state = this.lobbyState();
        for (const p of this.players) if (!p.host) this.sendTo(p, { ...state, you: p.id });
    }

    status() {
        const d = this.data;
        return {
            t: 'status', turn: d ? d.turn : 0, code: this.code, left: this.timeLeft(),
            players: this.players.map(p => ({
                name: p.name, cc: p.cc, host: p.host, connected: p.connected, ready: p.ready, loaded: p.host || p.loaded !== false,
                alive: !d || !p.cc || d.countries[p.cc].alive,
            })),
        };
    }

    changed() {
        if (this.data) {
            const status = this.status();
            for (const p of this.players) if (!p.host) this.sendTo(p, status);
        } else {
            this.broadcastLobby();
        }
        if (this.callbacks.onChange) this.callbacks.onChange(this);
    }

    // Выбор хозяина в лобби (из общего списка стран).
    pick(cc) {
        const owner = this.players.find(p => p.cc === cc && !p.host);
        if (owner) return { ok: false, reason: `${CountriesDB[cc].name} уже выбрал(а) ${owner.name}` };
        this.players[0].cc = cc;
        this.changed();
        return { ok: true };
    }

    takenBy(cc) {
        const p = this.players.find(x => x.cc === cc && !x.host);
        return p ? p.name : null;
    }

    setOptions(options) {
        this.options = options;
        if (!this.data) this.broadcastLobby();
    }

    canStart() {
        const guests = this.players.filter(p => !p.host && p.connected);
        if (!guests.length) return { ok: false, reason: 'Ждём второго игрока' };
        if (this.players.some(p => p.connected && !p.cc)) return { ok: false, reason: 'Не все выбрали страну' };
        const ccs = this.players.filter(p => p.connected).map(p => p.cc);
        if (new Set(ccs).size !== ccs.length) return { ok: false, reason: 'Страны должны быть разными' };
        return { ok: true };
    }

    // Новая партия: хозяин — первый, остальные — гости со своими местами.
    createGame(options) {
        const check = this.canStart();
        if (!check.ok) return null;
        this.players = this.players.filter(p => p.connected);
        const host = this.players[0];
        const guests = this.players.slice(1);
        const d = new GameData(host.cc, { ...options, humans: guests.map(p => p.cc) });
        d.net = {
            id: SaveGame.campaignId(),
            code: this.code,
            clients: Object.fromEntries(guests.map(p => [p.id, p.cc])),
            names: Object.fromEntries(this.players.map(p => [p.cc, p.name])),
            timer: NET.TIMERS.includes(Number(options.timer)) ? Number(options.timer) : 0,
        };
        this.data = d;
        return d;
    }

    // Партия запущена у хозяина — раздаём мир гостям.
    attach(game) {
        this.game = game;
        game.loop.net = this;
        if (!this.campRoom) this.claimCampaignRoom();
        // закрыли страницу — прощаемся, чтобы гость не ждал тишины
        if (!this.bye) {
            this.bye = () => { if (!this.stopped) for (const p of this.players) if (!p.host) this.sendTo(p, { t: 'bye' }); };
            window.addEventListener('pagehide', this.bye);
        }
        this.startClock();
        for (const p of this.players) if (!p.host) this.sendState(p, null);
        this.changed();
        clearInterval(this.clockId);
        this.clockId = setInterval(() => this.tick(), 1000);
    }

    // --- таймер хода ------------------------------------------------------
    get timer() { return (this.data && this.data.net && this.data.net.timer) || 0; }

    startClock() { this.deadline = this.timer ? Date.now() + this.timer * 1000 : null; }

    // Секунд до конца хода; null — таймера нет.
    timeLeft() {
        if (!this.deadline || !this.data || this.data.gameOver) return null;
        return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    }

    // Время вышло, а кто-то так и не отправил ход — считаем без него.
    tick() {
        if (this.deadline && Date.now() > this.deadline + NET.GRACE_MS) this.maybeResolve(true);
    }

    sendState(player, report) {
        if (!player.cc) return;
        if (!this.game || !report) player.loaded = false;   // пока гость строит карту
        this.sendTo(player, { t: 'state', state: this.data.serialize(), you: player.cc, report: report || null, code: this.code, left: this.timeLeft() });
    }

    get ready() { return this.players[0].ready; }

    toggleReady() {
        const host = this.players[0];
        host.ready = !host.ready;
        this.changed();
        this.maybeResolve();
    }

    waitingFor() {
        const d = this.data;
        return this.players.filter(p => p.cc && d.countries[p.cc].alive && !p.ready);
    }

    maybeResolve(force) {
        const d = this.data;
        if (!d || !this.game || d.gameOver || this.game.loop.busy) return;
        const late = this.waitingFor();
        if (late.length && !force) return;
        // без отключившегося ход не считаем даже по таймеру: ждём, пока он
        // вернётся и сходит сам
        if (late.some(p => !p.host && !p.connected)) return;
        const lateCc = new Set(late.map(p => p.cc));
        const guests = this.players.filter(p => !p.host);
        const failed = {};
        const reports = this.game.loop.runTurn(() => {
            for (const p of guests) {
                if (p.cc && d.countries[p.cc].alive && p.commands) failed[p.cc] = d.replay(p.cc, p.commands);
            }
        });
        for (const p of this.players) { p.ready = false; p.commands = null; }
        if (!reports) { this.changed(); return; }
        this.startClock();
        for (const p of this.players) {
            const report = reports[p.cc];
            if (report && lateCc.has(p.cc)) report.turnData.events.unshift('⏱ Время хода вышло — ход посчитан без ваших приказов.');
        }
        for (const p of guests) {
            const report = reports[p.cc];
            if (report && failed[p.cc]) report.turnData.events.unshift(`⚠️ Не выполнено приказов: ${failed[p.cc]} — обстановка изменилась, пока вы планировали.`);
            this.lastReports[p.cc] = report;
            this.sendState(p, report);
        }
        this.changed();
    }

    stop() {
        this.stopped = true;
        if (this.bye) window.removeEventListener('pagehide', this.bye);
        clearInterval(this.clockId);
        for (const p of this.players) if (p.link) p.link.close();
        if (this.campRoom) this.campRoom.destroy();
        if (this.room) this.room.destroy();
        if (this.beacon) this.beacon.destroy();
    }
}

// ---------------------------------------------------------------------
// ГОСТЬ
// ---------------------------------------------------------------------
class NetGuest {
    constructor(name, callbacks = {}) {
        this.role = 'guest';
        this.name = Net.cleanName(name);
        this.callbacks = callbacks;   // onLobby(lobby), onStart(data, report), onChange(), onLost(), onError(text), onToast(text)
        this.clientId = Net.clientId();
        this.lobby = null;
        this.statusInfo = null;
        this.game = null;
        this.ready = false;
    }

    // Игры в этой же сети: спрашиваем маячки по отпечатку внешнего адреса.
    static async scan() {
        await Net.loadLib();
        const key = await Net.networkKey();
        if (!key) return { lan: false, games: [] };
        const peer = await Net.openPeer();
        const finishers = new Map();
        // пустое место брокер отвергает сразу — не ждём таймаута
        peer.on('error', err => {
            for (const [id, finish] of finishers) if (String(err && err.message).includes(id)) finish();
        });
        const games = [];
        await Promise.all(Array.from({ length: NET.SLOTS }, (_, i) => new Promise(resolve => {
            const id = Net.beaconId(key, i + 1);
            const conn = peer.connect(id, { reliable: true, serialization: 'json' });
            const finish = () => { clearTimeout(timer); finishers.delete(id); try { conn.close(); } catch (e) { /* закрыт */ } resolve(); };
            finishers.set(id, finish);
            const timer = setTimeout(finish, NET.SCAN_MS);
            conn.on('data', raw => {
                try {
                    const hello = JSON.parse(raw.m);
                    if (hello.t === 'hello' && /^[A-Z0-9]{4}$/.test(hello.code)) games.push(hello);
                } catch (e) { /* чужое сообщение */ }
                finish();
            });
            conn.on('error', finish);
        })));
        peer.destroy();
        return { lan: true, games };
    }

    async join(code) {
        this.code = Net.normalizeCode(code);
        if (this.code.length !== 4) throw new Error('Код — четыре знака');
        await Net.loadLib();
        await this.ensurePeer();
        await this.connect();
        Net.rememberGame({ code: this.code, name: this.name });
    }

    // Кампания: к тому, кто сейчас держит её комнату, — без кода.
    // saved — своя копия кампании: если она новее, чем у сервера, он её возьмёт.
    async joinCampaign(id, cc, saved) {
        this.campaignId = id;
        if (cc) this.cc = cc;
        if (saved) this.saved = saved;
        await Net.loadLib();
        await this.ensurePeer();
        await this.connect();
    }

    // Своё подключение к брокеру: после сна телефона — новое.
    async ensurePeer() {
        if (this.peer && !this.peer.destroyed && !this.peer.disconnected) return;
        if (this.peer) { try { this.peer.destroy(); } catch (e) { /* уже закрыт */ } }
        this.peer = await Net.openPeer();
    }

    target() { return this.campaignId ? Net.campaignRoom(this.campaignId) : Net.roomId(this.code); }

    connect() {
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (text, missing) => {
                if (settled) return;
                settled = true; clearTimeout(timer); this.peer.off('error', onPeerError);
                const err = new Error(text); err.missing = !!missing; reject(err);
            };
            const onPeerError = err => {
                if (err.type === 'peer-unavailable') fail(this.campaignId ? 'Кампания сейчас не открыта ни на одном устройстве.' : 'Игра с таким кодом не найдена. Проверьте код и что игра создана.', true);
            };
            const timer = setTimeout(() => fail('Не удалось подключиться. Проверьте, что оба устройства в одной сети Wi-Fi.'), NET.JOIN_MS);
            this.peer.on('error', onPeerError);
            const conn = this.peer.connect(this.target(), {
                reliable: true, serialization: 'json', metadata: { clientId: this.clientId, name: this.name, cc: this.cc || '' },
            });
            conn.on('open', () => {
                if (settled) { conn.close(); return; }
                settled = true;
                clearTimeout(timer);
                this.peer.off('error', onPeerError);
                if (this.link) this.link.close();
                const link = new NetLink(conn, message => this.onMessage(message), () => { if (this.link === link) this.lost(); });
                this.link = link;
                // fresh — мира на экране нет, пришлите его в любом случае
                this.link.send({ t: 'join', turn: this.game ? this.game.data.turn : this.saved ? this.saved.turn : -1, fresh: !this.game });
                resolve();
            });
        });
    }

    // Связь пропала: пробуем вернуться, пока игрок не выйдет сам. Если
    // сервера нет совсем несколько попыток подряд — сообщаем: пора стать
    // сервером самим (onOrphan), чтобы партия не зависела от одного телефона.
    lost() {
        if (this.leaving) return;
        this.connected = false;
        if (this.link) { this.link.close(); this.link = null; }
        if (this.callbacks.onLost) this.callbacks.onLost();
        this.scheduleRetry(NET.RETRY_MS);
    }

    scheduleRetry(ms) {
        clearTimeout(this.retryTimer);
        if (!this.wake) {
            // вернулись в приложение — пробуем сразу, не ждём таймера
            this.wake = () => { if (document.visibilityState === 'visible' && !this.connected && !this.leaving && !this.trying) this.scheduleRetry(0); };
            document.addEventListener('visibilitychange', this.wake);
        }
        this.retryTimer = setTimeout(() => this.retry(), ms);
    }

    async retry() {
        if (this.leaving || this.connected || this.trying) return;
        this.trying = true;
        try {
            await this.ensurePeer();
            await this.connect();
            this.missing = 0;
            this.hostGone = false;
        } catch (e) {
            // и «нет такого», и молчание считаем: занять комнату выйдет, только
            // если прежний сервер её действительно отпустил
            this.missing = (this.missing || 0) + 1;
            if ((this.missing >= NET.ORPHAN_TRIES || (this.hostGone && e.missing)) && this.game && this.campaignId && this.callbacks.onOrphan) {
                this.missing = 0;
                this.trying = false;
                if (await this.callbacks.onOrphan()) return;   // стали сервером
            }
            if (!this.leaving) this.scheduleRetry(NET.RETRY_MS);
        } finally {
            this.trying = false;
        }
    }

    onMessage(message) {
        this.connected = true;
        if (message.t === 'reject') {
            this.leaving = true;
            if (this.callbacks.onError) this.callbacks.onError(message.reason || 'Хозяин не пустил в игру');
        } else if (message.t === 'lobby') {
            this.lobby = message;
            if (this.callbacks.onLobby) this.callbacks.onLobby(message);
        } else if (message.t === 'toast') {
            if (this.callbacks.onToast) this.callbacks.onToast(String(message.text || ''));
        } else if (message.t === 'chat' || message.t === 'ping') {
            this.chatLog = [...(this.chatLog || []), message].slice(-NET.CHAT_KEEP);
            const cb = message.t === 'chat' ? this.callbacks.onChat : this.callbacks.onPing;
            if (cb) cb(message);
        } else if (message.t === 'chatlog' && Array.isArray(message.list)) {
            this.chatLog = message.list.slice(-NET.CHAT_KEEP);
        } else if (message.t === 'nudge') {
            if (this.callbacks.onNudge) this.callbacks.onNudge(message);
        } else if (message.t === 'bye') {
            // сервер закрыл игру — не ждём тишины, сразу ищем замену
            this.hostGone = true;
            if (this.link) this.link.close();
            this.lost();
        } else if (message.t === 'upload' && (this.game || this.saved)) {
            // сервер открыл старую копию — отдаём свою, она новее
            this.link.send({ t: 'world', state: (this.game ? this.game.data : this.saved).serialize() });
        } else if (message.t === 'status') {
            this.statusInfo = message;
            this.deadline = Number.isFinite(message.left) ? Date.now() + message.left * 1000 : null;
            const me = message.players.find(p => p.cc === this.cc);
            // готовность держит сервер: после его перезапуска можно ходить снова
            if (me && this.game && message.turn === this.game.data.turn) this.ready = !!me.ready;
            if (this.callbacks.onChange) this.callbacks.onChange(this);
        } else if (message.t === 'state') {
            this.receiveState(message);
        }
    }

    // Мир от сервера: своя копия, глазами своей страны.
    receiveState(message) {
        let fresh;
        try {
            fresh = GameData.restore(message.state);
            fresh.becomePlayer(message.you);
        } catch (e) {
            console.error(e);
            if (this.callbacks.onError) this.callbacks.onError('Не удалось принять мир от сервера');
            return;
        }
        this.cc = message.you;
        if (fresh.net && fresh.net.id) this.campaignId = fresh.net.id;
        // таймер нового хода — вместе с миром, иначе до статуса виден старый ноль
        this.deadline = Number.isFinite(message.left) ? Date.now() + message.left * 1000 : null;
        fresh.recorder = [];
        // наша страна пала, а партия идёт — для нас она закончилась
        if (!fresh.countries[this.cc].alive && !fresh.gameOver) { fresh.gameOver = true; fresh.outcome = 'defeat'; }
        this.ready = false;
        if (!this.game) {
            if (this.callbacks.onStart) this.callbacks.onStart(fresh, message.report);
            return;
        }
        const d = this.game.data;
        for (const key of Object.keys(d)) delete d[key];
        Object.assign(d, fresh);
        this.game.onNewWorld(message.report);
        if (this.link) this.link.send({ t: 'loaded', turn: d.turn });
        if (this.callbacks.onChange) this.callbacks.onChange(this);
    }

    attach(game) {
        this.game = game;
        game.loop.net = this;
        if (!this.bye) {
            this.bye = () => { if (!this.leaving && this.link) this.link.send({ t: 'bye' }); };
            window.addEventListener('pagehide', this.bye);
        }
        // карта построена — сервер перестаёт показывать «загружает»
        if (this.link) this.link.send({ t: 'loaded', turn: game.data.turn });
        if (this.callbacks.onChange) this.callbacks.onChange(this);
    }

    pick(cc) {
        if (this.link) this.link.send({ t: 'pick', cc });
        return { ok: true };
    }

    say(text) { if (this.link) this.link.send({ t: 'chat', text }); }

    nudge() {
        const now = Date.now();
        if (!this.link || now - (this.nudgedAt || 0) < NET.NUDGE_MS) return false;
        this.nudgedAt = now;
        this.link.send({ t: 'nudge' });
        return true;
    }

    timeLeft() {
        if (!this.deadline || !this.game || this.game.data.gameOver) return null;
        return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    }

    ping(region) {
        if (!this.link) return;
        this.link.send({ t: 'ping', region });
        this.chatLog = [...(this.chatLog || []), { t: 'ping', from: 'Вы', cc: this.cc, region, at: Date.now() }].slice(-NET.CHAT_KEEP);
    }

    takenBy(cc) {
        const p = this.lobby && this.lobby.players.find(x => x.cc === cc && x.id !== this.clientId);
        return p ? p.name : null;
    }

    toggleReady() {
        const d = this.game.data;
        if (!this.link || this.link.closed) { if (this.callbacks.onToast) this.callbacks.onToast('Нет связи с сервером — переподключаемся…'); return; }
        this.ready = !this.ready;
        this.link.send(this.ready ? { t: 'turn', turn: d.turn, commands: d.recorder || [] } : { t: 'unready' });
        if (this.callbacks.onChange) this.callbacks.onChange(this);
    }

    waitingFor() {
        if (!this.statusInfo) return [];
        return this.statusInfo.players.filter(p => p.cc && p.alive && !p.ready && p.cc !== this.cc).concat(this.ready ? [] : [{ cc: this.cc, name: 'Вы' }]);
    }

    leave() {
        this.leaving = true;
        clearTimeout(this.retryTimer);
        if (this.wake) document.removeEventListener('visibilitychange', this.wake);
        if (this.bye) window.removeEventListener('pagehide', this.bye);
        if (this.link) this.link.close();
        if (this.peer) this.peer.destroy();
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Net, NetLink, NetHost, NetGuest, NET };
