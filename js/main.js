// =====================================================================
// ГЛАВНЫЙ КОНТРОЛЛЕР
// =====================================================================
class GameCore {
    constructor(data) {
        this.data = data;
        this.ui = new UIManager();
        this.map = new MapEngine(this.data, regionId => this.handleMapClick(regionId));
        this.ai = new AI(this.data);
        this.loop = new GameLoop(this.data, this.ui, this.map, this.ai);

        this.armyAction = { active: false, type: null, fromId: null, forces: {} };
        this.panelRegion = null;

        document.addEventListener('mapBackground', () => this.ui.closePanel());
        document.addEventListener('panelClosed', () => {
            this.map.clearSelection();
            this.cancelTargeting();
            this.panelRegion = null;
        });
        document.addEventListener('zoomLevelChanged', e => {
            this.ui.updateZoomMode(e.detail.isRegional);
            this.ui.flashZoomIndicator();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') { this.cancelTargeting(); this.ui.closePanel(); }
        });

        // Один слушатель на все кнопки действий в панелях и окнах.
        document.addEventListener('click', e => {
            const cancelBtn = e.target.closest('.cancel-order-btn');
            if (cancelBtn) { e.stopPropagation(); this.cancelOrder(cancelBtn); return; }
            const action = e.target.closest('[data-action]');
            if (action && !action.disabled) this.runAction(action);
        });

        this.initArmyPanel();
        this.initRecruitPanel();
        this.initGovernment();
        this.initTopButtons();
        this.initMapControls();

        // На телефоне вкладку могут выгрузить в любой момент — сохраняемся при сворачивании.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') SaveGame.save(this.data);
        });
        window.addEventListener('pagehide', () => SaveGame.save(this.data));

        this.ui.updateOrdersPanel(this.data);
        SaveGame.save(this.data);
        this.loop.afterSummary();
        if (this.data.hotseat) {
            this.loop.onHotseat = () => this.hotseatEnd();
            document.getElementById('hotseat-go').addEventListener('click', () => this.startSeat(this.handoffTo));
            // сохранились между игроками — очередь того, кто ещё не ходил
            const d = this.data;
            if (!d.gameOver) this.showHandoff(d.hotseat.done.includes(d.playerCountry) ? this.hotseatNext() || d.playerCountry : d.playerCountry);
        }
    }

    // --- горячий стул: двое и больше на одном устройстве -------------------
    // Кто ещё не сходил в этот ход (живые, по порядку).
    hotseatNext() {
        const d = this.data;
        return d.humans.find(cc => !d.hotseat.done.includes(cc) && d.countries[cc].alive && d.regionsByCountry[cc].length) || null;
    }

    // «Конец хода»: передать устройство следующему, а если все сходили —
    // посчитать ход и раздать отчёты по очереди.
    hotseatEnd() {
        const d = this.data;
        if (!d.hotseat.done.includes(d.playerCountry)) d.hotseat.done.push(d.playerCountry);
        const next = this.hotseatNext();
        if (next) { SaveGame.save(d); this.showHandoff(next); return; }
        d.hotseat.done = [];
        const reports = this.loop.runTurn(null, false);
        if (!reports) return;
        this.hotseatReports = reports;
        SaveGame.save(d);
        this.showHandoff(this.hotseatNext() || d.playerCountry);
    }

    // Экран передачи: карта закрыта, чтобы следующий не видел чужих планов.
    showHandoff(cc) {
        const d = this.data;
        this.handoffTo = cc;
        this.cancelTargeting();
        this.ui.closePanel();
        for (const modal of document.querySelectorAll('.modal.active')) modal.classList.remove('active');
        this.ui.syncModalAccess();
        const report = this.hotseatReports && this.hotseatReports[cc];
        document.getElementById('hotseat-flag').style.background = d.countries[cc].color;
        document.getElementById('hotseat-who').textContent = d.countries[cc].name;
        document.getElementById('hotseat-text').textContent = report
            ? 'Ход посчитан. Передайте устройство — сначала итоги, потом новые приказы.'
            : 'Передайте устройство. Остальным — не подглядывать 🙈';
        document.getElementById('hotseat-go').textContent = `Я — ${d.countries[cc].name}, начать ход`;
        document.getElementById('hotseat-turn').textContent = `Ход ${d.turn + 1} · ${this.loop.formatDate(d.currentDate)}`;
        document.getElementById('hotseat-screen').hidden = false;
        document.body.classList.add('hotseat-handoff');
        document.getElementById('hotseat-go').focus({ preventScroll: true });
    }

    startSeat(cc) {
        const d = this.data;
        document.getElementById('hotseat-screen').hidden = true;
        document.body.classList.remove('hotseat-handoff');
        d.becomePlayer(cc);
        this.loop.lastChanges = null;
        this.map.refreshColors();
        this.map.createCountryLabels();
        this.map.drawArmyMarkers();
        this.map.drawOrders();
        this.loop.updateTopBarUI();
        this.ui.updateOrdersPanel(d);
        const report = this.hotseatReports && this.hotseatReports[cc];
        if (report) { delete this.hotseatReports[cc]; this.loop.showReport(report); }
        else { SaveGame.save(d); this.loop.afterSummary(); }
    }

    // --- действия из карточек и окон ---------------------------------------
    runAction(btn) {
        const d = this.data;
        const player = d.playerCountry;
        const cc = btn.dataset.country;
        const action = btn.dataset.action;
        if (action === 'stats') { this.ui.showStats(d); return; }
        if (action === 'open-country') {
            this.ui.hideModal('diplo-modal');
            this.map.focusCountry(cc);
            this.showCountry(cc);
            return;
        }
        if (action === 'mission-go') { this.goToMission(d.missions[+btn.dataset.index]); return; }
        if (action === 'ping') {
            if (!this.net) return;
            this.net.ping(btn.dataset.region);
            this.map.pingRegion(btn.dataset.region);
            this.ui.toast(`📍 Показали игрокам: ${d.regions[btn.dataset.region].name}`);
            return;
        }
        if (d.gameOver) return;
        if (action.startsWith('rg-')) { this.regionsAction(action, btn); return; }
        if (['invest', 'cancel-project', 'integrate'].includes(action)) {
            const id = btn.dataset.region;
            const result = action === 'invest' ? d.act('invest', id, btn.dataset.kind)
                : action === 'integrate' ? d.act('integrateTerritory', id)
                : { ok: d.act('cancelProject', id) };
            if (!result.ok) { this.ui.toast(result.reason || 'Проект недоступен'); return; }
            this.ui.toast(action === 'invest' ? 'Строительство начато' : action === 'integrate' ? 'Территория интегрирована' : 'Средства возвращены');
            this.showRegion(id);
            this.loop.updateTopBarUI();
            this.map.refreshColors();
            this.map.createCountryLabels();
            SaveGame.save(d);
            return;
        }

        if (action === 'mission-claim') {
            const reward = d.act('claimMission', d.missions[+btn.dataset.index]?.kind);
            if (!reward) return;
            this.ui.haptic(30);
            this.ui.toast(`Награда: +${this.ui.money(reward.money)} и +${reward.influence} влияния`);
            this.afterMissions();
            return;
        }
        if (action === 'mission-skip') {
            if (!d.act('skipMission', d.missions[+btn.dataset.index]?.kind)) { this.ui.toast(`Нужно ${MISSION_RULES.SKIP_COST} влияния`); return; }
            this.afterMissions();
            return;
        }
        if (action === 'suppress' || action === 'appease') {
            const id = btn.dataset.region;
            const result = d.act(action === 'suppress' ? 'suppressRevolt' : 'appeaseRevolt', id);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.haptic(30);
            this.ui.toast(action === 'appease' ? `Уступки приняты: восстание утихло (−${this.ui.money(result.cost)})`
                : result.won ? `Восстание подавлено: гарнизон ${result.ours} против ${result.theirs}` : `Подавить не вышло: гарнизон ${result.ours} против ${result.theirs}. Нужно больше войск.`);
            this.map.refreshColors();
            this.afterStateChange();
            return;
        }
        if (action === 'borrow' || action === 'repay') {
            const result = d.act(action, Number(btn.dataset.amount));
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.toast(action === 'borrow' ? `Взято в долг ${this.ui.money(result.amount)}` : `Возвращено ${this.ui.money(result.amount)}`);
            this.ui.renderGovernment(d);
            this.loop.updateTopBarUI();
            SaveGame.save(d);
            return;
        }
        if (action === 'operation') {
            const result = d.act('planOperation', btn.dataset.region);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            if (this.net) this.net.ping(btn.dataset.region);
            this.ui.toast(`🎯 Операция объявлена, цель — ${d.regions[btn.dataset.region].name}, удар на следующем ходу. Союзники увидят цель.`);
            this.map.refreshColors();
            this.showRegion(btn.dataset.region);
            SaveGame.save(d);
            return;
        }
        if (action === 'trade-open') {
            this.ui.showTradeEditor(d, cc, null, offer => {
                const result = d.act('proposeTrade', cc, offer);
                if (result.ok) { this.ui.toast(`${d.countries[cc].name}: сделка отправлена, ответ — после хода`); this.afterStateChange(); }
                return result;
            });
            return;
        }
        if (action === 'transfer') {
            const result = d.act('transfer', cc, btn.dataset.kind, Number(btn.dataset.amount));
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.haptic(20);
            this.ui.toast(`${d.countries[cc].name}: передано ${result.text}`);
            this.afterStateChange();
            return;
        }
        if (action === 'cede') {
            const region = d.regions[btn.dataset.region];
            if (!confirm(`Отдать область ${region.name} — ${d.countries[cc].name}? Вернуть её можно только договорившись или силой.`)) return;
            const result = d.act('cedeRegion', region.id, cc);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.toast(`${region.name} теперь у ${d.countries[cc].name}`);
            this.ui.closePanel();
            this.map.createCountryLabels();
            this.map.drawArmyMarkers();
            this.afterStateChange();
            return;
        }
        if (['gift', 'deal', 'pact', 'alliance', 'tribute', 'cancel-deal', 'cancel-pact', 'cancel-alliance'].includes(action)) {
            this.diplomacyAction(cc, action);
            return;
        }

        // Война и мир — только после подтверждения: по кнопке легко промахнуться.
        if ((btn.dataset.action === 'war' || btn.dataset.action === 'peace') && !btn.dataset.confirmed) {
            const name = d.countries[cc].name;
            const again = () => { btn.dataset.confirmed = '1'; try { this.runAction(btn); } finally { delete btn.dataset.confirmed; } };
            if (btn.dataset.action === 'war') {
                const check = d.canDeclareWar(player, cc);
                if (!check.ok) { this.ui.toast(check.reason); return; }
                const allies = Diplomacy.allies(d, cc).filter(x => x !== player && !d.isAtWar(x, player));
                const lines = [`Стоит ${RULES.WAR_COST} влияния. Мир потом можно будет только предложить — противник может отказать.`];
                if (allies.length) lines.push(`Её союзники тоже вступят в войну: ${allies.map(x => d.countries[x].name).join(', ')}.`);
                if (d.isHuman(cc)) lines.push('Это живой игрок.');
                this.ui.showDecision({
                    title: `⚔️ Объявить войну: ${name}?`, text: lines.join('\n'),
                    accept: 'Объявить войну', decline: 'Отмена', danger: true,
                    onAccept: again, onDecline: () => {},
                });
            } else {
                const info = d.warInfo(player, cc);
                const lines = [info ? `Война идёт ${info.turns} ход. Вы заняли областей: ${info.taken}, потеряли: ${info.lost}.` : ''];
                lines.push(d.isHuman(cc) ? 'Игрок решит после хода.' : `Стоит ${RULES.PEACE_COST} влияния, даже если откажут. Мир сохранит нынешние границы, перемирие — ${RULES.TRUCE_TURNS} ходов.`);
                this.ui.showDecision({
                    title: `🕊️ Предложить мир: ${name}?`, text: lines.filter(Boolean).join('\n'),
                    accept: 'Предложить мир', decline: 'Отмена',
                    onAccept: again, onDecline: () => {},
                });
            }
            return;
        }
        if (btn.dataset.action === 'war') {
            const result = d.act('declareWar', player, cc);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.haptic(40);
            const joined = result.joined || [];
            this.ui.toast(`Вы объявили войну: ${d.countries[cc].name}${joined.length ? `. Её союзники вступили в войну: ${joined.map(x => d.countries[x].name).join(', ')}` : ''}`);
            this.afterStateChange();
        } else if (btn.dataset.action === 'peace') {
            const result = d.act('proposePeace', cc);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            if (result.pending) this.ui.toast(`${d.countries[cc].name}: предложение мира отправлено, ответ — после хода`);
            else if (result.accepted) this.ui.toast(`${d.countries[cc].name}: мир заключён`);
            else this.ui.toast(`${d.countries[cc].name}: мир отвергнут — там считают, что побеждают`);
            this.afterStateChange();
        } else if (btn.dataset.action === 'spy') {
            const region = d.getRegion(btn.dataset.region);
            if (!d.act('queueRecon', region.id, RULES.SPY_COST, parseInt(btn.dataset.chance, 10), region.name)) {
                this.ui.toast(`Недостаточно средств для разведки (${this.ui.money(RULES.SPY_COST)})`);
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Разведка в плане';
            this.ui.updateOrdersPanel(d);
            this.loop.updateTopBarUI();
            SaveGame.save(d);
        } else if (btn.dataset.action === 'trade') {
            d.act('setTrade', player, btn.dataset.key, btn.checked ? 'sell' : 'keep');
            this.ui.renderGovernment(d);
            this.loop.updateTopBarUI();
            SaveGame.save(d);
        } else if (btn.dataset.action === 'research') {
            const result = d.act('research', player, btn.dataset.key);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.haptic(20);
            this.ui.toast(`Модернизация: ${UnitsDB[btn.dataset.key].name} — ступень ${d.countries[player].tech[btn.dataset.key]}`);
            this.afterScience();
        } else if (btn.dataset.action === 'tech') {
            const result = d.act('startResearch', player, btn.dataset.key);
            if (!result.ok) { this.ui.toast(result.reason); return; }
            this.ui.haptic(20);
            const tech = TECH_TREE[btn.dataset.key];
            this.ui.toast(`Исследование начато: ${tech.name}. Готово через ${tech.turns} ход.`);
            this.afterScience();
        } else if (btn.dataset.action === 'tech-cancel') {
            const refund = d.act('cancelResearch', player);
            this.ui.toast(`Исследование отменено, возвращено ${this.ui.money(refund)}`);
            this.afterScience();
        }
    }

    diplomacyAction(cc, action) {
        const d = this.data;
        const name = d.countries[cc].name;
        if (action.startsWith('cancel-')) {
            const what = { 'cancel-deal': 'расторгнуть торговый договор', 'cancel-pact': 'разорвать пакт о ненападении', 'cancel-alliance': 'выйти из союза' }[action];
            if (!confirm(`${name}: ${what}? Отношения ухудшатся на ${-DIPLOMACY.BREAK_RELATION}.`)) return;
        }
        const result = d.act('diplomacyAction', cc, action);
        if (!result.ok) { this.ui.toast(result.reason); return; }
        const names = { deal: 'торговый договор', pact: 'пакт о ненападении', alliance: 'оборонительный союз' };
        if (action === 'gift') this.ui.toast(`${name}: подарок принят (−${this.ui.money(result.cost)}), отношения +${result.gain}`);
        else if (action === 'tribute') this.ui.toast(result.paid ? `${name}: дань выплачена, +${this.ui.money(result.paid)}` : `${name}: платить отказались — ${result.reason.toLowerCase()}`);
        else if (action.startsWith('cancel-')) this.ui.toast(`${name}: договор расторгнут`);
        else if (result.pending) this.ui.toast(`${name}: предложение отправлено, ответ — после хода`);
        else this.ui.toast(result.accepted ? `${name}: подписан ${names[action]}` : `${name}: отказ — ${result.reason.toLowerCase()}`);
        this.ui.haptic(20);
        this.afterStateChange();
    }

    // «Перейти» из задания — туда, где его выполняют.
    goToMission(m) {
        if (!m) return;
        const d = this.data, player = d.playerCountry;
        this.ui.hideModal('campaign-modal');
        const own = () => {
            const id = d.getCountry(player).capital && d.regions[d.getCountry(player).capital]?.owner === player ? d.getCountry(player).capital : d.mostPopulousRegion(player);
            if (id) { this.map.focusRegion(id); this.showRegion(id); }
            return id;
        };
        if (m.kind === 'recruit') { if (own()) document.getElementById('recruit-btn').click(); }
        else if (m.kind === 'build') {
            if (own()) document.getElementById('development-panel').scrollIntoView({ block: 'nearest' });
        } else if (m.kind === 'battles' || m.kind === 'conquer') {
            const enemy = d.enemiesOf(player)[0];
            if (enemy) this.map.focusCountry(enemy);
            this.ui.toast('Выберите свою область у фронта и нажмите «Наступление»');
        } else if (m.kind === 'research' || m.kind === 'modernize') this.ui.showScience(d);
        else if (m.kind === 'deal') this.openDiplomacy();
        else if (m.kind === 'friend') { this.map.focusCountry(m.param); this.showCountry(m.param); }
        else {
            this.openGovernment();
            if (m.kind === 'surplus') document.getElementById('gov-economy-section').scrollIntoView({ block: 'start' });
        }
    }

    // Окно «Области»: каждое действие — обычная команда (в сетевой игре её
    // повторит сервер), потом окно перерисовывается.
    regionsAction(action, btn) {
        const d = this.data, id = btn.dataset.region;
        if (action === 'rg-go') {
            this.ui.hideModal('regions-modal');
            this.map.showRegion(id);
            this.showRegion(id);
            return;
        }
        let text = null;
        if (action === 'rg-invest') {
            const r = d.act('invest', id, btn.dataset.kind);
            text = r.ok ? `🏗️ ${d.regions[id].name}: ${DEVELOPMENT[btn.dataset.kind].name}` : r.reason;
        } else if (action === 'rg-cancel') {
            text = d.act('cancelProject', id) ? 'Стройка отменена, деньги вернулись' : 'Нечего отменять';
        } else if (action === 'rg-recruit') {
            const unit = this.ui.regionsState().unit;
            const r = d.act('queueRecruitment', id, unit, parseInt(btn.dataset.amount, 10));
            text = r.ok ? `🪖 ${d.regions[id].name}: +${btn.dataset.amount} ${UnitsDB[unit].name}` : r.reason;
        } else if (action === 'rg-build-all') {
            let done = 0, spent = 0;
            for (const p of this.ui.bulkBuildPlan(d)) if (d.act('invest', p.region, p.kind).ok) { done++; spent += p.cost; }
            text = done ? `🏗️ Стройка начата в ${done} обл. · ${this.ui.money(spent)}` : 'Ничего не построено';
        } else if (action === 'rg-recruit-all') {
            let done = 0, units = 0;
            for (const p of this.ui.bulkRecruitPlan(d)) if (d.act('queueRecruitment', p.region, p.unit, p.amount).ok) { done++; units += p.amount; }
            text = done ? `🪖 Набор: +${units} в ${done} обл.` : 'Никого не набрали';
        }
        if (text) this.ui.toast(text);
        this.ui.haptic(15);
        this.loop.updateTopBarUI();
        this.ui.updateOrdersPanel(d);
        this.map.refreshColors();
        SaveGame.save(d);
        this.ui.showRegions(d);
    }

    afterMissions() {
        this.ui.showCampaign(this.data);
        this.loop.updateTopBarUI();
        SaveGame.save(this.data);
    }

    // --- сетевая игра ---------------------------------------------------------
    // Сессию можно сменить на ходу: гость становится сервером, если сервер
    // пропал; бывший сервер — гостем, если кампанию уже держит другой.
    attachNet(session) {
        const old = this.net;
        this.net = session;
        document.body.classList.add('net-session');
        if (old && old !== session && old.chatLog && !session.chatLog) session.chatLog = old.chatLog;
        const callbacks = session.callbacks;
        callbacks.onChange = () => this.renderNetStatus();
        callbacks.onToast = text => this.ui.toast(text);
        callbacks.onLost = () => { this.renderNetStatus(); };
        callbacks.onError = text => { this.ui.toast(text); this.renderNetStatus(); };
        callbacks.onChat = entry => this.onChat(entry);
        callbacks.onPing = entry => this.onPing(entry);
        callbacks.onNudge = entry => this.onNudge(entry);
        callbacks.onOrphan = () => this.becomeHost();
        callbacks.onTaken = () => this.becomeGuest();
        if (!this.netUiReady) this.initNetUi();
        session.attach(this);
        this.renderNetStatus();
    }

    initNetUi() {
        this.netUiReady = true;
        this.unread = 0;
        document.getElementById('net-wait-back').addEventListener('click', () => { if (this.net.ready) this.net.toggleReady(); });
        document.getElementById('net-wait-sync').addEventListener('click', () => {
            if (this.net.role === 'guest' && this.net.resync(true)) this.ui.toast('🔄 Попросили сервер прислать мир');
        });
        document.getElementById('net-wait-nudge').addEventListener('click', () => {
            if (this.net.nudge()) { this.ui.toast('🔔 Напомнили остальным'); this.ui.haptic(20); }
            this.renderNudge();
        });
        clearInterval(this.clockId);
        this.clockId = setInterval(() => this.tickClock(), 1000);
        document.getElementById('net-status').addEventListener('click', () => this.openChat());
        document.getElementById('close-chat-btn').addEventListener('click', () => this.ui.hideModal('chat-modal'));
        document.getElementById('chat-form').addEventListener('submit', e => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            if (input.value.trim()) this.net.say(input.value.trim());
            input.value = '';
        });
        document.getElementById('chat-modal').addEventListener('click', e => {
            const quick = e.target.closest('[data-say]');
            if (quick) { this.net.say(quick.dataset.say); return; }
            const ping = e.target.closest('.chat-msg.ping');
            if (ping) { this.ui.hideModal('chat-modal'); this.map.showRegion(ping.dataset.region); this.map.pingRegion(ping.dataset.region); }
        });
    }

    myNetName() {
        const names = (this.data.net && this.data.net.names) || {};
        return names[this.data.playerCountry] || (this.net && this.net.name) || 'Игрок';
    }

    // Сервер пропал надолго: занимаем комнату кампании сами. true — вышло.
    async becomeHost() {
        const guest = this.net;
        if (this.switching || !guest || guest.role !== 'guest' || this.data.gameOver) return false;
        this.switching = true;
        try {
            const host = new NetHost(this.myNetName());
            this.data.recorder = null;
            await host.start(this.data, { any: true });
            guest.callbacks = {};
            guest.leave();
            SaveGame.campaignRole = 'host';
            this.attachNet(host);
            SaveGame.save(this.data);
            this.ui.toast('📶 Сервер пропал — теперь сервер вы. Второй игрок подключится сам.');
            return true;
        } catch (err) {
            return false;   // комнату уже занял другой — остаёмся гостем и стучимся к нему
        } finally {
            this.switching = false;
        }
    }

    // Пока мы спали, кампанию открыл другой игрок: подключаемся к нему.
    becomeGuest() {
        const host = this.net;
        if (this.switching || !host || host.role !== 'host') return;
        this.switching = true;
        host.callbacks = {};
        host.stop();
        const guest = new NetGuest(this.myNetName());
        guest.cc = this.data.playerCountry;
        guest.campaignId = this.data.net && this.data.net.id;
        this.data.recorder = [];
        SaveGame.campaignRole = 'guest';
        this.attachNet(guest);
        this.switching = false;
        this.ui.toast('📶 Кампанию держит другой игрок — подключаемся к нему…');
        guest.lost();
    }

    // --- чат и метки ---
    chatOpen() { return document.getElementById('chat-modal').classList.contains('active'); }

    openChat() {
        this.unread = 0;
        this.renderChat();
        this.ui.showModal('chat-modal');
        this.renderNetStatus();
    }

    renderChat() {
        const d = this.data, log = document.getElementById('chat-log');
        const list = this.net.chatLog || [];
        log.innerHTML = list.length ? list.map(m => {
            const mine = m.cc === d.playerCountry;
            const who = mine ? 'Вы' : this.ui.escape(m.from);
            if (m.t === 'ping') {
                const r = d.regions[m.region];
                return `<div class="chat-msg ping ${mine ? 'mine' : ''}" data-region="${m.region}">📍 ${who}: ${this.ui.escape(r ? r.name : m.region)} — показать</div>`;
            }
            return `<div class="chat-msg ${mine ? 'mine' : ''}"><b>${who}</b>${this.ui.escape(m.text)}</div>`;
        }).join('') : '<div class="muted">Сообщений пока нет. Напишите что-нибудь или нажмите быструю фразу.</div>';
        log.scrollTop = log.scrollHeight;
    }

    onChat(entry) {
        if (this.chatOpen()) { this.renderChat(); return; }
        if (entry.cc !== this.data.playerCountry) {
            this.unread++;
            this.ui.toast(`💬 ${entry.from}: ${entry.text}`);
            this.ui.haptic(20);
        }
        this.renderNetStatus();
    }

    // Кто-то уже закончил ход и торопит нас.
    onNudge(entry) {
        if (this.net.ready || this.data.gameOver) return;
        this.ui.toast(`🔔 ${entry.from} ждёт вас — пора заканчивать ход!`);
        try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* нет вибрации */ }
        const btn = this.loop.endTurnBtn;
        btn.classList.remove('nudged');
        void btn.offsetWidth;   // перезапуск анимации
        btn.classList.add('nudged');
        setTimeout(() => btn.classList.remove('nudged'), 3000);
    }

    // «Поторопить» — не чаще раза в NUDGE_MS.
    renderNudge() {
        const btn = document.getElementById('net-wait-nudge');
        const wait = Math.ceil((NET.NUDGE_MS - (Date.now() - ((this.net.role === 'host' ? this.net.players[0].nudgedAt : this.net.nudgedAt) || 0))) / 1000);
        btn.disabled = wait > 0;
        btn.textContent = wait > 0 ? `🔔 Поторопить · ${wait} с` : '🔔 Поторопить';
    }

    // Раз в секунду: таймер хода. Время вышло — ход уходит сам: итоги
    // закрываются, нерешённые предложения отклоняются.
    tickClock() {
        const net = this.net, d = this.data;
        if (!net) return;
        const left = net.timeLeft();
        const el = document.getElementById('net-timer');
        if (el) {
            el.hidden = left === null;
            if (left !== null) {
                el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
                el.classList.toggle('low', left <= 20);
            }
        }
        if (!document.getElementById('net-wait').hidden) this.renderNudge();
        if (left !== 0 || net.ready || d.gameOver || this.loop.busy || this.autoTurn === d.turn) return;
        if (net.role === 'guest' && !net.connected) return;
        this.autoTurn = d.turn;   // сам — один раз за ход; вернуться к ходу игрок может
        this.cancelTargeting();
        for (let i = 0; i < 20; i++) {
            if (document.getElementById('summary-modal').classList.contains('active')) this.ui.closeSummary();
            else if (document.getElementById('decision-modal').classList.contains('active')) document.getElementById('decision-decline').click();
            else if (document.getElementById('trade-modal').classList.contains('active')) document.getElementById('close-trade-btn').click();
            else break;
        }
        this.ui.toast('⏱ Время хода вышло — ход отправлен');
        if (this.loop.awaitingSummary || d.decisions.length) net.toggleReady();
        else this.loop.processTurn();
    }

    onPing(entry) {
        const r = this.data.regions[entry.region];
        if (!r) return;
        this.map.pingRegion(entry.region);
        if (this.chatOpen()) this.renderChat();
        this.ui.toast(`📍 ${entry.from} показывает: ${r.name}`);
        this.ui.haptic(20);
    }

    // Кто уже закончил ход, кого ждём. Пока ждём — поверх карты табличка,
    // из которой можно вернуться к своему ходу.
    renderNetStatus() {
        const net = this.net;
        if (!net) return;
        const d = this.data;
        const info = net.role === 'host' ? net.status() : net.statusInfo;
        const pill = document.getElementById('net-status');
        const wait = document.getElementById('net-wait');
        const players = info ? info.players.filter(p => p.cc) : [];
        const offline = net.role === 'guest' && !net.connected;
        const row = p => {
            const name = CountriesDB[p.cc] ? CountriesDB[p.cc].name : p.cc;
            const loading = p.connected && p.loaded === false;
            const state = !p.alive ? '🏳️' : !p.connected ? '📵' : loading ? '⌛' : p.ready ? '✅' : '⏳';
            return `<span class="np ${p.ready ? 'ready' : ''}">${state} ${this.ui.escape(p.name)} · ${this.ui.escape(name)}${loading ? ' (загружает карту)' : ''}</span>`;
        };
        pill.hidden = false;
        const left = net.timeLeft();
        pill.innerHTML = `<b>📶 ${net.code || ''}</b><span class="np timer" id="net-timer" ${left === null ? 'hidden' : ''}></span>${offline ? '<span class="np off">нет связи — переподключаемся…</span>' : players.map(row).join('')}<span class="np">💬${this.unread ? ` <span class="chat-badge">${this.unread}</span>` : ''}</span>`;
        const waiting = !!net.ready && !d.gameOver;
        wait.hidden = !waiting;
        document.body.classList.toggle('net-waiting', waiting);
        if (waiting) {
            const others = players.filter(p => p.cc !== d.playerCountry && p.alive && !p.ready);
            document.getElementById('net-wait-text').textContent = offline ? 'Связь с сервером пропала. Переподключаемся…'
                : others.length ? `Ждём: ${others.map(p => p.name + (p.connected && p.loaded === false ? ' (загружает карту)' : !p.connected ? ' (нет связи)' : '')).join(', ')}` : 'Все готовы — считаем ход…';
            document.getElementById('net-wait-list').innerHTML = players.map(row).join('');
            document.getElementById('net-wait-nudge').hidden = offline || !others.length;
            document.getElementById('net-wait-sync').hidden = net.role !== 'guest' || offline;
            const away = others.filter(p => !p.connected);
            document.getElementById('net-wait-hint').textContent = away.length
                ? `Нет связи: ${away.map(p => p.name).join(', ')}. Ход посчитается, когда вернётся и нажмёт «Конец хода».`
                : left !== null ? 'Ход посчитается, когда все нажмут «Конец хода» или выйдет время.' : 'Ход посчитается, когда все нажмут «Конец хода».';
            this.renderNudge();
        }
        this.tickClock();
        const btn = this.loop.endTurnBtn.querySelector('.lbl');
        if (btn) btn.textContent = waiting ? 'Ждём…' : 'Конец хода';
    }

    // Гостю пришёл мир от сервера: всё на экране — заново.
    onNewWorld(report) {
        this.cancelTargeting();
        this.ui.closePanel();
        for (const id of ['diplo-modal', 'campaign-modal', 'gov-modal', 'science-modal', 'decision-modal', 'trade-modal', 'regions-modal']) this.ui.hideModal(id);
        this.loop.failed = false;
        this.loop.awaitingSummary = false;
        if (report) this.loop.showReport(report);
        else {
            this.map.refreshColors();
            this.map.createCountryLabels();
            this.map.drawArmyMarkers();
            this.loop.updateTopBarUI();
            this.ui.updateOrdersPanel(this.data);
            this.loop.afterSummary();
        }
        this.renderNetStatus();
    }

    afterScience() {
        this.ui.showScience(this.data);
        this.loop.updateTopBarUI();
        this.map.drawArmyMarkers();
        SaveGame.save(this.data);
    }

    // После войны или мира обновляем всё, что от этого зависит.
    afterStateChange() {
        this.map.refreshColors();
        this.loop.updateTopBarUI();
        if (document.getElementById('diplo-modal').classList.contains('active')) this.ui.showDiplomacy(this.data);
        if (document.getElementById('campaign-modal').classList.contains('active')) this.ui.showCampaign(this.data);
        if (this.panelRegion) this.showRegion(this.panelRegion);
        else if (this.panelCountry) this.showCountry(this.panelCountry);
        SaveGame.save(this.data);
    }

    cancelOrder(btn) {
        const index = parseInt(btn.dataset.orderIndex, 10), type = btn.dataset.type;
        // номер среди своих приказов — так команду можно повторить на сервере
        const list = this.data.orders[type] || [];
        const own = list.slice(0, index).filter(o => o.country === this.data.playerCountry).length;
        const order = this.data.act('cancelOwnOrder', type, own);
        if (!order) return;
        this.ui.updateOrdersPanel(this.data);
        this.loop.updateTopBarUI();
        SaveGame.save(this.data);
        if (this.panelRegion) this.showRegion(this.panelRegion);
    }

    // --- карточки ------------------------------------------------------------
    showRegion(regionId) {
        const region = this.data.getRegion(regionId);
        if (!region) return;
        this.panelRegion = regionId;
        this.panelCountry = null;
        this.map.selectRegion(regionId);
        this.ui.showRegionInfo(region, this.data.getCountry(region.owner), this.data);
        this.updateActionButtons(regionId);
        this.map.ensureVisible(region.lx, region.ly);
    }

    showCountry(countryId) {
        this.panelRegion = null;
        this.panelCountry = countryId;
        this.map.selectCountry(countryId);
        this.ui.showCountryInfo(this.data.getCountry(countryId), this.data.getCountryStats(countryId), this.data);
    }

    updateActionButtons(regionId) {
        const d = this.data;
        const region = d.getRegion(regionId);
        const show = (id, on) => { document.getElementById(id).style.display = on ? 'block' : 'none'; };
        const hint = document.getElementById('action-hint');
        hint.textContent = '';
        if (!region || region.owner !== d.playerCountry) {
            ['recruit-btn', 'init-move-btn', 'init-attack-btn', 'init-give-btn', 'init-disband-btn'].forEach(id => show(id, false));
            return;
        }
        const capacity = d.recruitCapacityLeft(regionId);
        show('recruit-btn', true);
        document.getElementById('recruit-btn').innerHTML =
            `🏭 Набрать войска <small>мощность ${capacity}/${d.recruitCapacity(regionId)}</small>`;

        const available = d.getAvailableArmy(regionId);
        const hasTroops = Object.values(available).some(n => n > 0);
        const attackTargets = d.getValidAttackTargets(regionId);
        show('init-move-btn', hasTroops && d.getValidMoveTargets(regionId).length > 0);
        show('init-attack-btn', hasTroops && attackTargets.length > 0);
        show('init-give-btn', hasTroops && d.allyTargets(regionId).length > 0);
        show('init-disband-btn', hasTroops);

        if (hasTroops && !attackTargets.length) {
            const peaceful = d.peacefulNeighbours(regionId);
            if (peaceful.length) {
                hint.textContent = `Граница с: ${peaceful.map(cc => d.countries[cc].name).join(', ')}. `
                    + 'Чтобы наступать, объявите войну в карточке их области.';
            }
        }
    }

    // --- выбор войск для марша и атаки ------------------------------------------
    renderForceInputs(regionId) {
        const available = this.data.getAvailableArmy(regionId);
        const rows = [];
        for (const unitId of Object.keys(UnitsDB)) {
            const count = available[unitId] || 0;
            if (count <= 0) continue;
            const unit = UnitsDB[unitId];
            rows.push(this.ui.stepperRow({ key: unitId, icon: unit.icon, label: unit.name, sub: `есть ${count}`, max: count, value: count }));
        }
        const container = document.getElementById('action-army-inputs');
        container.innerHTML = rows.join('');
        this.ui.bindSteppers(container);
    }

    initArmyPanel() {
        const panel = document.getElementById('army-action-panel');
        const confirmBtn = document.getElementById('confirm-action-btn');

        const openPanel = type => {
            if (!this.panelRegion) return;
            document.getElementById('action-buttons-container').style.display = 'none';
            document.getElementById('recruit-panel').style.display = 'none';
            panel.style.display = 'block';
            this.renderForceInputs(this.panelRegion);
            this.armyAction.type = type;
            const titles = { attack: 'Силы для наступления', move: 'Силы для марша', disband: 'Какие войска распустить', give: 'Какие войска передать союзнику' };
            const buttons = { attack: 'Выбрать цель атаки', move: 'Выбрать область для марша', disband: 'Распустить', give: 'Выбрать область союзника' };
            document.getElementById('action-panel-title').textContent = titles[type];
            confirmBtn.textContent = buttons[type];
            confirmBtn.classList.toggle('danger', type === 'attack' || type === 'disband');
            // для роспуска по умолчанию ничего не выбрано — чтобы не распустить всё случайно
            if (type === 'disband') {
                for (const row of document.querySelectorAll('#action-army-inputs .stepper-row')) this.ui.setStepper(row, 0);
            }
            panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        };
        document.getElementById('init-move-btn').addEventListener('click', () => openPanel('move'));
        document.getElementById('init-attack-btn').addEventListener('click', () => openPanel('attack'));
        document.getElementById('init-disband-btn').addEventListener('click', () => openPanel('disband'));
        document.getElementById('init-give-btn').addEventListener('click', () => openPanel('give'));

        document.getElementById('cancel-action-btn').addEventListener('click', () => {
            panel.style.display = 'none';
            document.getElementById('action-buttons-container').style.display = 'block';
            this.cancelTargeting();
        });

        confirmBtn.addEventListener('click', () => {
            const forces = this.ui.readSteppers(document.getElementById('action-army-inputs'));
            for (const unitId of Object.keys(UnitsDB)) forces[unitId] = forces[unitId] || 0;
            if (!Object.values(forces).some(n => n > 0)) { this.ui.toast('Выберите хотя бы одно подразделение'); return; }

            const regionId = this.panelRegion;
            if (this.armyAction.type === 'disband') {
                let saved = 0;
                for (const unitId of Object.keys(forces)) saved += (forces[unitId] || 0) * UnitsDB[unitId].maintenanceCost;
                const removed = this.data.act('disband', regionId, forces);
                this.ui.toast(`Распущено подразделений: ${removed}. Экономия ${this.ui.money(saved)} за ход`);
                this.map.drawArmyMarkers();
                this.loop.updateTopBarUI();
                this.showRegion(regionId);
                SaveGame.save(this.data);
                return;
            }
            const type = this.armyAction.type;
            const targets = this.actionTargets(type, regionId);
            if (!targets.length) { this.ui.toast('Нет доступных целей'); return; }

            this.armyAction = { active: true, type, fromId: regionId, forces };
            this.map.enableTargetSelection(targets, type === 'attack' ? 'attack-target' : 'move-target');
            this.ui.closePanelKeepTargeting();
            this.ui.showTargetBanner(type === 'move' ? 'Коснитесь области для марша' : type === 'give' ? 'Коснитесь области союзника' : 'Коснитесь цели атаки');
        });

        document.getElementById('target-cancel').addEventListener('click', () => this.cancelTargeting());
        document.getElementById('target-list-btn').addEventListener('click', () => this.showTargetList());
        document.getElementById('close-target-btn').addEventListener('click', () => this.ui.hideModal('target-modal'));
        document.getElementById('target-list').addEventListener('click', e => {
            const row = e.target.closest('[data-target]');
            if (!row) return;
            this.ui.hideModal('target-modal');
            this.handleMapClick(row.dataset.target);
        });
    }

    actionTargets(type, fromId) {
        const d = this.data;
        if (type === 'give') return d.allyTargets(fromId);
        return type === 'move' ? d.getValidMoveTargets(fromId) : d.getValidAttackTargets(fromId);
    }

    // Те же цели, что подсвечены на карте, но списком: в маленькую область
    // на телефоне пальцем не попасть. Атаки — от лучших шансов к худшим.
    showTargetList() {
        const state = this.armyAction;
        if (!state.active) return;
        const d = this.data;
        const isMove = state.type !== 'attack';
        const give = state.type === 'give';
        const ids = this.actionTargets(state.type, state.fromId);
        const LIMIT = 60;
        const rows = ids.map(id => {
            const region = d.getRegion(id);
            const transport = give ? { cost: 0 } : d.expeditionQuote(isMove ? 'movements' : 'attacks', state.fromId, id, state.forces);
            const odds = isMove ? null : this.attackOdds(id, state.forces, state.fromId);
            return { id, region, transport, odds };
        }).sort((a, b) => (a.transport.cost ? 1 : 0) - (b.transport.cost ? 1 : 0)
            || (b.odds ? b.odds.ratio : 0) - (a.odds ? a.odds.ratio : 0)
            || a.region.name.localeCompare(b.region.name, 'ru'));

        const from = d.getRegion(state.fromId);
        document.getElementById('target-title').textContent = give ? 'Кому передать войска' : isMove ? 'Куда перебросить войска' : 'Кого атаковать';
        document.getElementById('target-hint').textContent = `Из области ${from.name}. `
            + (give ? 'Войска станут войсками союзника.' : isMove ? 'Выберите свою область.' : 'Шансы считаются по отправленным войскам.');
        document.getElementById('target-list').innerHTML = rows.slice(0, LIMIT).map(({ id, region, transport, odds }) => {
            const owner = d.countries[region.owner];
            const sea = transport.cost ? ` · морем ${this.ui.money(transport.cost)}` : '';
            const chip = odds
                ? `<span class="odds ${odds.ratio >= 1 ? 'high' : odds.ratio >= 0.9 ? 'even' : 'low'}">${odds.label}</span>`
                : `<span class="odds move">${give ? 'союзник' : 'марш'}</span>`;
            return `<button class="target-row" type="button" data-target="${id}">
                <span class="swatch" style="background:${owner.color}"></span>
                <span><b>${this.ui.escape(region.name)}</b><small>${this.ui.escape(owner.name)}${sea}</small></span>
                ${chip}</button>`;
        }).join('') + (rows.length > LIMIT ? `<p class="hint">И ещё ${rows.length - LIMIT} — выберите их на карте.</p>` : '');
        this.ui.showModal('target-modal');
    }

    cancelTargeting() {
        this.ui.hideModal('target-modal');
        if (!this.armyAction.active) return;
        this.armyAction.active = false;
        this.map.disableTargetSelection();
        this.ui.hideTargetBanner();
    }

    // --- набор войск ---------------------------------------------------------------
    initRecruitPanel() {
        const panel = document.getElementById('recruit-panel');
        const list = document.getElementById('recruit-list');

        document.getElementById('recruit-btn').addEventListener('click', () => {
            if (!this.panelRegion) return;
            document.getElementById('action-buttons-container').style.display = 'none';
            panel.style.display = 'block';
            this.renderRecruit();
            panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });

        this.ui.bindSteppers(list, () => this.updateRecruitLimits());

        document.getElementById('cancel-recruit-btn').addEventListener('click', () => {
            panel.style.display = 'none';
            document.getElementById('action-buttons-container').style.display = 'block';
        });

        document.getElementById('confirm-recruit-btn').addEventListener('click', () => {
            const amounts = this.ui.readSteppers(list);
            let ordered = 0;
            for (const unitId of Object.keys(amounts)) {
                if (!amounts[unitId]) continue;
                const result = this.data.act('queueRecruitment', this.panelRegion, unitId, amounts[unitId]);
                if (!result.ok) { this.ui.toast(result.reason); break; }
                ordered += amounts[unitId];
            }
            if (!ordered) { this.ui.toast('Ничего не выбрано'); return; }
            this.ui.haptic(20);
            this.ui.toast(`Заказано подразделений: ${ordered}. Прибудут в конце хода.`);
            this.ui.updateOrdersPanel(this.data);
            this.loop.updateTopBarUI();
            this.showRegion(this.panelRegion);
            SaveGame.save(this.data);
        });
    }

    renderRecruit() {
        const d = this.data;
        const list = document.getElementById('recruit-list');
        const player = d.countries[d.playerCountry];
        const open = Object.keys(UnitsDB).filter(id => Tech.unitUnlocked(player, id));
        const closed = Object.keys(UnitsDB).length - open.length;
        list.innerHTML = open.map(unitId => {
            const unit = UnitsDB[unitId];
            return this.ui.stepperRow({
                key: unitId, icon: unit.icon, label: unit.name,
                sub: `${unit.note} · ${this.ui.money(unit.buildCost)} · ${unit.industryCost} инд. · −${this.ui.money(unit.maintenanceCost)}/ход`,
                max: 0,
            });
        }).join('') + (closed ? `<p class="hint">🔒 Ещё ${closed} род. войск откроются исследованиями в «Науке».</p>` : '');
        this.updateRecruitLimits();
    }

    // Мощность области и деньги общие на все рода войск: при изменении одной
    // строки пересчитываем пределы остальных.
    updateRecruitLimits() {
        const d = this.data;
        const list = document.getElementById('recruit-list');
        const amounts = this.ui.readSteppers(list);
        const capacity = d.recruitCapacityLeft(this.panelRegion);
        const money = d.countries[d.playerCountry].money;

        let usedCap = 0, cost = 0, upkeep = 0;
        for (const unitId of Object.keys(amounts)) {
            usedCap += UnitsDB[unitId].industryCost * amounts[unitId];
            cost += UnitsDB[unitId].buildCost * amounts[unitId];
            upkeep += UnitsDB[unitId].maintenanceCost * amounts[unitId];
        }
        for (const row of list.querySelectorAll('.stepper-row')) {
            const unit = UnitsDB[row.dataset.key];
            const own = amounts[row.dataset.key];
            const capLeft = capacity - usedCap + unit.industryCost * own;
            const moneyLeft = money - cost + unit.buildCost * own;
            const max = Math.max(0, Math.min(Math.floor(capLeft / unit.industryCost), Math.floor(moneyLeft / unit.buildCost)));
            row.dataset.max = max;
            if (own > max) this.ui.setStepper(row, max);
            row.classList.toggle('unavailable', max === 0 && own === 0);
        }
        document.getElementById('recruit-capacity').textContent =
            `Мощность индустрии: ${capacity - usedCap} из ${d.recruitCapacity(this.panelRegion)} · казна ${this.ui.money(money - cost)}`;
        document.getElementById('recruit-total').innerHTML = cost
            ? `Итого: <b>${this.ui.money(cost)}</b> · содержание <span class="neg">−${this.ui.money(upkeep)}</span> за ход`
            : '';
    }

    // --- правительство, дипломатия, журнал ----------------------------------------------
    initGovernment() {
        document.getElementById('gov-policy').addEventListener('change', e => {
            const result = this.data.act('setPolicy', this.data.playerCountry, e.target.value);
            if (!result.ok) this.ui.toast(result.reason);
            this.ui.renderGovernment(this.data);
            this.loop.updateTopBarUI();
            SaveGame.save(this.data);
        });
        document.getElementById('gov-tax-slider').addEventListener('input', e => {
            this.data.act('setTaxRate', this.data.playerCountry, parseFloat(e.target.value));
            this.ui.renderGovernment(this.data);
            this.loop.updateTopBarUI();
            SaveGame.save(this.data);
        });
        document.getElementById('save-game-btn').addEventListener('click', () => {
            this.ui.toast(SaveGame.save(this.data) ? 'Игра сохранена' : 'Не удалось сохранить: хранилище недоступно');
        });
        document.getElementById('export-game-btn').addEventListener('click', () => {
            const file = SaveGame.exportFile(this.data);
            const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
            const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.ui.toast(`Партия записана в файл ${file.name}`);
        });
        document.getElementById('new-game-btn').addEventListener('click', () => {
            if (!confirm('Начать новую игру? Текущая партия будет удалена.')) return;
            SaveGame.discard();
            location.reload();
        });
    }

    openGovernment() {
        this.ui.closePanel();
        this.data.campaign.budget = true;
        this.ui.renderGovernment(this.data);
        this.ui.showModal('gov-modal');
        SaveGame.save(this.data);
    }

    openDiplomacy() {
        this.ui.closePanel();
        this.data.campaign.diplomacy = true;
        this.ui.showDiplomacy(this.data);
        SaveGame.save(this.data);
    }

    initTopButtons() {
        document.getElementById('gov-btn').addEventListener('click', () => this.openGovernment());
        document.getElementById('sci-btn').addEventListener('click', () => this.ui.showScience(this.data));
        document.getElementById('res-status').addEventListener('click', () => {
            this.openGovernment();
            document.getElementById('gov-economy-section').scrollIntoView({ block: 'start' });
        });
        document.getElementById('diplo-btn').addEventListener('click', () => this.openDiplomacy());
        document.getElementById('regions-btn').addEventListener('click', () => { this.cancelTargeting(); this.ui.closePanel(); this.ui.showRegions(this.data); });
        document.getElementById('campaign-btn').addEventListener('click', () => this.ui.showCampaign(this.data));
        document.getElementById('log-btn').addEventListener('click', () => this.ui.showHistory(this.data.history));
        document.getElementById('gameover-new-btn').addEventListener('click', () => { SaveGame.discard(); location.reload(); });
    }

    initMapControls() {
        document.getElementById('zoom-in-btn').addEventListener('click', () => this.map.zoomBy(1.6));
        document.getElementById('zoom-out-btn').addEventListener('click', () => this.map.zoomBy(1 / 1.6));
        document.getElementById('home-btn').addEventListener('click', () => this.map.centerOnPlayer(true));
    }

    afterOrder(message) {
        this.ui.updateOrdersPanel(this.data);
        SaveGame.save(this.data);
        this.ui.haptic(20);
        this.ui.toast(message);
    }

    // Оценка без тумана войны о составе: сила обороны игроку и так видна
    // на карточке области, когда идёт война.
    // Вместе с уже назначенными ударами по этой цели из других областей.
    attackOdds(targetId, forces, fromId = this.armyAction && this.armyAction.fromId) {
        const est = this.data.strikeEstimate(targetId, forces, fromId);
        const ratio = est.ratio;
        const label = ratio >= 1.5 ? 'высокие' : ratio >= 1 ? 'хорошие' : ratio >= 0.9 ? 'равные' : 'низкие';
        return { ratio, label, attack: Math.round(est.attack), needed: Math.round(est.needed), directions: est.directions, flank: est.flank };
    }

    // --- клик по карте -----------------------------------------------------------------
    handleMapClick(regionId) {
        if (this.armyAction.active) {
            const state = this.armyAction;
            const isMove = state.type === 'move';
            const targets = this.actionTargets(state.type, state.fromId);
            this.cancelTargeting();
            if (!targets.includes(regionId)) return;
            if (state.type === 'give') {
                const result = this.data.act('giveTroops', state.fromId, regionId, state.forces);
                if (!result.ok) { this.ui.toast(result.reason); return; }
                this.ui.toast(`Передано союзнику (${this.data.countries[this.data.regions[regionId].owner].name}): ${result.text}`);
                this.map.drawArmyMarkers();
                this.loop.updateTopBarUI();
                SaveGame.save(this.data);
                this.showRegion(state.fromId);
                return;
            }
            const transport = this.data.expeditionQuote(isMove ? 'movements' : 'attacks', state.fromId, regionId, state.forces);
            if (transport.cost) {
                const odds = isMove ? null : this.attackOdds(regionId, state.forces, state.fromId);
                this.ui.showDecision({
                    title: isMove ? 'Межконтинентальная переброска' : 'Экспедиция',
                    text: `Перевозка за один ход: ${this.ui.money(transport.cost)} и ${transport.influence} влияния.${odds ? ` Шансы атаки: ${odds.label}. Сила ${odds.attack}, нужно ${odds.needed}.` : ''} При отмене приказа затраты возвращаются.`,
                    accept: 'Отправить', decline: 'Отменить',
                    onAccept: () => {
                        const result = this.data.act(isMove ? 'queueMovement' : 'queueAttack', state.fromId, regionId, state.forces);
                        if (!result.ok) { this.ui.toast(result.reason); return; }
                        this.loop.updateTopBarUI();
                        this.afterOrder('Экспедиция запланирована');
                    }, onDecline: () => {},
                });
                return;
            }
            if (isMove) {
                const result = this.data.act('queueMovement', state.fromId, regionId, state.forces);
                if (!result.ok) { this.ui.toast(result.reason); return; }
                this.afterOrder('Марш запланирован');
                return;
            }
            // Перед атакой оцениваем шансы по той же формуле, что и бой:
            // заведомо проигрышную атаку лучше переспросить, чем молча отправить.
            const odds = this.attackOdds(regionId, state.forces, state.fromId);
            const queue = () => {
                const result = this.data.act('queueAttack', state.fromId, regionId, state.forces);
                if (!result.ok) { this.ui.toast(result.reason); return; }
                this.afterOrder(`Наступление запланировано · шансы ${odds.label}${odds.flank ? ` · удар с ${odds.directions} направлений +${Math.round(odds.flank * 100)}%` : ''}`);
            };
            if (odds.ratio >= 0.9) { queue(); return; }
            const target = this.data.getRegion(regionId);
            this.ui.showDecision({
                title: '⚠️ Атака, скорее всего, провалится',
                text: `Ваши силы: ~${odds.attack}. Чтобы взять ${target.name}, нужно около ${odds.needed}. `
                    + 'Отправленные войска понесут потери, а уцелевшие вернутся назад. '
                    + 'Можно добавить сил, провести разведку или ударить сразу из нескольких областей.',
                accept: 'Атаковать всё равно',
                decline: 'Отменить',
                onAccept: queue,
                onDecline: () => {},
            });
            return;
        }

        const region = this.data.getRegion(regionId);
        if (!region) return;
        if (this.map.isRegionalZoom) this.showRegion(regionId);
        else this.showCountry(region.owner);
    }
}

// =====================================================================
// СТАРТОВЫЙ ЭКРАН
// =====================================================================
(function startScreen() {
    const FEATURED = ['US', 'CN', 'BR', 'DE', 'FR', 'UA'];
    const LIST_PREVIEW = 12;
    const LEVELS = ['', 'Легко', 'Средне', 'Сложно'];
    const $ = id => document.getElementById(id);
    const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const flagUrl = (id, w) => `https://flagcdn.com/w${w}/${id.toLowerCase()}.png`;
    const flagImg = (id, w, cls = 'flag') => `<img class="${cls}" src="${flagUrl(id, w)}" data-cc="${id}" alt="" width="36" height="24" loading="lazy">`;
    const bars = level => `<span class="bars lvl-${level}" aria-hidden="true"><i></i><i></i><i></i></span>`;

    let selectedId = null;
    let expanded = false;
    const previews = {};       // один пробный мир на сценарий — ~30 мс
    const assessments = {};    // сложность стран по сценарию

    const ready = () => {
        const listEl = $('start-country-list');
        const searchEl = $('start-search');
        const startBtn = $('start-game-btn');
        const moreBtn = $('list-more');

        const playable = Object.keys(CountriesDB)
            .filter(id => CountriesDB[id].playable && CountriesDB[id].regions > 0)
            .sort((a, b) => CountriesDB[a].name.localeCompare(CountriesDB[b].name, 'ru'));
        const featured = FEATURED.filter(id => playable.includes(id));

        const scenario = () => ($('scenario-toggle').checked ? 'war2024' : 'peace');
        const difficulty = () => (document.querySelector('input[name="difficulty"]:checked') || {}).value || 'normal';
        const goal = () => (document.querySelector('input[name="goal"]:checked') || {}).value || 'domination';
        const showGoal = () => {
            // «Вместе» — только в сетевой игре у хозяина (гость лишь видит выбор)
            const coop = document.querySelector('input[name="goal"][value="coop"]');
            coop.disabled = !(net && net.role === 'host') && !hotseatOn();
            if (coop.disabled && coop.checked && !(net && net.role === 'guest')) document.querySelector('input[name="goal"][value="domination"]').checked = true;
            $('goal-note').textContent = GOALS[goal()].text + (coop.disabled && !net ? ' «Вместе» — для игры по Wi-Fi или вдвоём на одном устройстве.' : '');
        };
        for (const radio of document.querySelectorAll('input[name="goal"]')) radio.addEventListener('change', () => { showGoal(); updateCta(); if (net && net.role === 'host') net.setOptions(hostOptions()); });
        const showLevel = () => { $('level-note').textContent = DIFFICULTY[difficulty()].note; };
        for (const radio of document.querySelectorAll('input[name="difficulty"]')) radio.addEventListener('change', () => { showLevel(); updateCta(); });
        const preview = () => {
            const key = scenario();
            if (!previews[key]) previews[key] = new GameData(playable[0], { scenario: key });
            return previews[key];
        };

        // Сложность — по тому, что реально ждёт игрока на первом ходу:
        // размер страны, недельный баланс, сильнейший сосед и война.
        const assess = id => {
            const key = scenario();
            assessments[key] = assessments[key] || {};
            if (assessments[key][id]) return assessments[key][id];
            const d = preview();
            const unitsOf = cc => Object.values(d.getCountryStats(cc).army).reduce((a, b) => a + b, 0);
            const balance = d.steadyBalance(id);
            const net = balance.income - balance.expense;
            const army = unitsOf(id);
            const neighbours = d.neighbourCountries(id).filter(cc => d.countries[cc].playable);
            let rival = null, rivalArmy = 0;
            for (const cc of neighbours) {
                const n = unitsOf(cc);
                if (n > rivalArmy) { rival = cc; rivalArmy = n; }
            }
            const enemies = d.enemiesOf(id);
            const regions = CountriesDB[id].regions;
            const ratio = rivalArmy / Math.max(army, 1);
            let score = 0;
            if (regions <= 2) score += 1;
            if (regions >= 10) score -= 1;
            if (ratio > 4) score += 2; else if (ratio > 1.2) score += 1;
            if (net < 0) score += 1;
            if (enemies.length) score += 1;
            const level = score <= 0 ? 1 : score === 1 ? 2 : 3;

            let advice;
            if (enemies.length) advice = `Идёт война: ${enemies.map(cc => d.countries[cc].name).join(', ')}. Сначала удержите границу: наберите войска и не распыляйте силы.`;
            else if (net < 0) advice = 'Расходы больше доходов. В «Правительстве» поднимите налог или распустите часть войск, иначе армия начнёт разбегаться.';
            else if (rival && ratio > 1.2) advice = `Сильный сосед — ${d.countries[rival].name}: ${rivalArmy} подразделений против ваших ${army}. Не ссорьтесь с ним, пока не окрепнете.`;
            else if (regions <= 2) advice = 'Маленькая страна: мало денег и войск. Стройте экономику и выбирайте слабых соседей.';
            else advice = 'Хороший старт: деньги есть, соседи не опасны. Вложитесь в экономику и наберите армию.';

            return (assessments[key][id] = {
                level, advice, net, army, regions, neighbours: neighbours.length,
                money: d.countries[id].money,
            });
        };

        const money = n => {
            const v = Math.abs(n);
            if (v >= 1e9) return '$' + (v / 1e9).toFixed(1).replace('.0', '') + 'B';
            if (v >= 1e6) return '$' + (v / 1e6).toFixed(1).replace('.0', '') + 'M';
            if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
            return '$' + Math.round(v);
        };

        const launch = (data, tutorial = false, session = null) => {
            $('start-screen').style.display = 'none';
            document.body.classList.add('in-game');
            // стартовый экран мог быть прокручен — игра рисуется от верха
            window.scrollTo(0, 0);
            // гость не пишет чужой мир поверх своей одиночной партии
            // сетевая кампания сохраняется в свою ячейку — у сервера и у гостя
            if (session) SaveGame.campaignRole = session.role;
            window.game = new GameCore(data);
            if (session) window.game.attachNet(session);
            if (tutorial && !session) new Tutorial(window.game).start();
            else if (!data.hotseat && !data.gameOver && !data.decisions.length && data.turn === 0 && !data.campaign.budget) window.game.ui.showCampaign(data);
        };

        // --- игра по Wi-Fi: лобби ------------------------------------------
        // net — открытая сессия (хозяин или гость), пока выбирают страны.
        let net = null;
        let netView = 'idle';
        let netNote = '';
        let netGames = null;
        const taken = id => (net ? net.takenBy(id) : null);
        const savedName = () => { try { return localStorage.getItem('politics-net-name') || ''; } catch (e) { return ''; } };
        const playerName = () => {
            const name = Net.cleanName(($('net-name') || {}).value || savedName());
            try { localStorage.setItem('politics-net-name', name); } catch (e) { /* не критично */ }
            return name;
        };
        const lobbyPlayers = () => (net.role === 'host' ? net.players : (net.lobby ? net.lobby.players : []));
        const renderNet = () => {
            const body = $('net-body');
            document.body.classList.toggle('net-lobby', !!net);
            document.body.classList.toggle('net-guest-lobby', !!net && net.role === 'guest');
            document.body.classList.toggle('net-searching', netView === 'search' || netView === 'busy');
            const note = netNote ? `<p class="net-note">${escape(netNote)}</p>` : '';
            if (netView === 'idle') {
                const last = Net.lastGame();
                body.innerHTML = `
                    <label class="net-field"><span class="label">Ваше имя</span><input id="net-name" maxlength="16" autocomplete="nickname" placeholder="Например, Папа" value="${escape(savedName())}"></label>
                    <div class="net-actions">
                        <button id="net-host-btn" class="btn btn-light" type="button">Создать игру</button>
                        <button id="net-find-btn" class="btn btn-ghost" type="button">Найти игру</button>
                    </div>
                    ${campaignList()}
                    ${last && !SaveGame.campaigns().some(c => c.meta.code === last.code) ? `<button id="net-rejoin-btn" class="btn btn-ghost btn-sm net-rejoin" type="button">↩ Вернуться в игру ${escape(last.code)}</button>` : ''}
                    ${note}`;
                return;
            }
            if (netView === 'busy') {
                body.innerHTML = `<p class="net-wait-line"><span class="spinner"></span>${escape(netNote || 'Подключаемся…')}</p>
                    <div class="net-actions"><button id="net-leave-btn" class="btn btn-ghost btn-sm" type="button">Отмена</button></div>`;
                return;
            }
            if (netView === 'search') {
                body.innerHTML = `<div class="net-found">${foundList()}</div>
                    <div class="net-code-row"><label class="sr-only" for="net-code-input">Код игры</label><input id="net-code-input" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="Код: ABCD"><button id="net-join-btn" class="btn btn-light" type="button">Войти</button></div>
                    <div class="net-actions"><button id="net-leave-btn" class="btn btn-ghost btn-sm" type="button">Назад</button></div>${note}`;
                return;
            }
            // лобби: хозяин или гость
            renderLobby(body, note);
        };
        // Сохранённые сетевые кампании: у сервера — «Продолжить», у гостя —
        // «Подключиться» к серверу или «Стать сервером» со своей копией.
        const campaignList = () => {
            const list = SaveGame.campaigns();
            if (!list.length) return '';
            return `<div class="net-campaigns"><span class="label">Сетевые кампании</span>${list.map(({ meta, savedAt }) => {
                const players = (meta.humans || []).map(cc => {
                    const name = CountriesDB[cc] ? CountriesDB[cc].name : cc;
                    return cc === meta.you ? `<b>${escape(name)}</b> (вы)` : `${escape(name)}${meta.names && meta.names[cc] ? ` 🎮 ${escape(meta.names[cc])}` : ''}`;
                }).join(' · ');
                const date = new Date(meta.date || savedAt);
                const goal = GOALS[meta.goal] ? ' · ' + GOALS[meta.goal].short : '';
                const role = 'по Wi-Fi';
                // одна кнопка для всех: кто открыл первым — сервер, второй
                // подключается к нему сам
                const buttons = meta.gameOver ? '' : `<button class="btn btn-light btn-sm" type="button" data-campaign-open="${escape(meta.id)}">▶ Продолжить</button>`;
                return `<div class="net-campaign">
                    <div class="nc-text"><span>${players}</span><small>Ход ${meta.turn} · ${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}${goal} · код ${escape(meta.code || '—')} · ${role}${meta.gameOver ? ' · окончена' : ''}</small></div>
                    <div class="nc-actions">${buttons}<button class="btn btn-ghost btn-sm nc-del" type="button" data-campaign-del="${escape(meta.id)}" aria-label="Удалить кампанию">✕</button></div>
                </div>`;
            }).join('')}</div>`;
        };
        const foundList = () => {
                const list = netGames === null ? '<p class="net-wait-line"><span class="spinner"></span>Ищем игры в вашей сети…</p>'
                    : netGames.games.length ? netGames.games.map(g => `<button class="net-game" type="button" data-code="${escape(g.code)}">
                        <span><b>${escape(g.host)}</b><small>${g.cc && CountriesDB[g.cc] ? escape(CountriesDB[g.cc].name) + ' · ' : ''}${g.started ? 'партия идёт' : 'ждёт игроков'} · игроков: ${g.players}</small></span><span class="net-code">${escape(g.code)}</span></button>`).join('')
                    : `<p class="net-wait-line"><span class="spinner"></span>${netGames.lan ? 'Ищем… Игр в этой сети пока нет — попросите создать игру.' : 'Сеть не удалось определить — введите код с экрана хозяина.'}</p>`;
                return list;
        };
        const renderLobby = (body, note) => {
            const you = net.role === 'host' ? 'host' : net.clientId;
            const rows = lobbyPlayers().map(p => `<li class="${p.connected === false ? 'off' : ''}">
                <span>${p.host ? '👑' : '🎮'} <b>${escape(p.name)}</b>${p.id === you ? ' (вы)' : ''}</span>
                <span class="net-pick">${p.cc && CountriesDB[p.cc] ? flagImg(p.cc, 40) + escape(CountriesDB[p.cc].name) : 'выбирает страну…'}</span></li>`).join('');
            const lan = net.role === 'host'
                ? (net.lan === null ? 'Проверяем сеть…' : net.lan ? 'Устройства в этой сети Wi-Fi увидят игру сами — нажмите там «Найти игру».' : 'Автопоиск в этой сети недоступен — пусть введут код.')
                : `Вы в игре у ${escape((lobbyPlayers().find(p => p.host) || {}).name || 'хозяина')}. Выберите страну ниже и ждите начала.`;
            body.innerHTML = `
                <div class="net-lobby-head"><span class="label">Код игры</span><b class="net-big-code">${escape(net.code || '····')}</b></div>
                <p class="net-note">${lan}</p>
                <ul class="net-players">${rows}</ul>
                ${net.role === 'host'
                    ? `<div class="net-timer-row"><span class="label">Таймер хода</span>${NET.TIMERS.map(t => `<button class="chip ${t === netTimer ? 'on' : ''}" type="button" data-net-timer="${t}" aria-pressed="${t === netTimer}">${timerName(t)}</button>`).join('')}</div>`
                    : `<p class="net-note">Таймер хода: ${timerName((net.lobby && net.lobby.timer) || 0)}</p>`}
                ${note}
                <div class="net-actions"><button id="net-leave-btn" class="btn btn-ghost btn-sm" type="button">${net.role === 'host' ? 'Отменить игру' : 'Выйти'}</button></div>`;
        };
        const refreshLobby = () => { renderNet(); renderFeatured(); renderList(); renderSeats(); updateCta(); };
        const leaveNet = () => {
            if (net) { if (net.role === 'host') net.stop(); else net.leave(); }
            net = null; netView = 'idle'; netGames = null;
            for (const input of document.querySelectorAll('input[name="scenario"], input[name="difficulty"], input[name="goal"]')) input.disabled = false;
            showGoal();
            refreshLobby();
        };
        const netError = text => { if (net) { if (net.role === 'host') net.stop(); else net.leave(); } net = null; netView = 'idle'; netNote = text; refreshLobby(); };
        // --- вдвоём на одном устройстве: список стран игроков ---
        let seats = [];
        const hotseatOn = () => $('hotseat-toggle').checked && !net;
        const renderSeats = () => {
            const box = $('hotseat-seats');
            box.hidden = !hotseatOn();
            if (box.hidden) return;
            box.innerHTML = seats.map((id, i) => `<span class="seat-chip">${i + 1}. ${escape(CountriesDB[id].name)}<button type="button" data-seat-del="${id}" aria-label="Убрать ${escape(CountriesDB[id].name)}">✕</button></span>`).join('')
                + (seats.length < 4 ? `<span class="seat-hint">${seats.length < 2 ? 'Нажмите страну второго игрока в списке' : 'Можно добавить ещё игрока'}</span>` : '');
        };
        $('hotseat-toggle').addEventListener('change', () => {
            seats = hotseatOn() && selectedId ? [selectedId] : [];
            renderSeats(); showGoal(); updateCta();
        });
        $('hotseat-seats').addEventListener('click', e => {
            const del = e.target.closest('[data-seat-del]');
            if (!del) return;
            seats = seats.filter(id => id !== del.dataset.seatDel);
            renderSeats(); updateCta();
        });
        let netTimer = 0;
        const hostOptions = () => ({ scenario: scenario(), difficulty: difficulty(), goal: goal(), timer: netTimer });
        const timerName = t => t ? `${t / 60} мин` : 'нет';
        const startHost = async () => {
            const name = playerName();
            netNote = 'Создаём игру…'; netView = 'busy'; renderNet();
            const session = new NetHost(name, { onChange: () => refreshLobby() });
            try {
                await session.start();
            } catch (err) { netError(err.message); return; }
            net = session; netView = 'lobby'; netNote = '';
            showGoal();
            net.setOptions(hostOptions());
            if (selectedId) net.pick(selectedId);
            refreshLobby();
        };
        // campaign — { id, cc, data }: подключение к кампании без кода, к тому,
        // кто её сейчас держит. Возвращает true, если подключились.
        const joinGame = async (code, campaign) => {
            code = Net.normalizeCode(code);
            if (!campaign && code.length !== 4) { netNote = 'Код — четыре знака с экрана хозяина'; renderNet(); return false; }
            const name = campaign ? ((campaign.data.net && campaign.data.net.names) || {})[campaign.cc] || playerName() : playerName();
            if (!campaign) { netNote = `Подключаемся к игре ${code}…`; netView = 'busy'; renderNet(); }
            const session = new NetGuest(name, {
                onLobby: lobby => {
                    // режим и уровень выбирает хозяин
                    for (const input of document.querySelectorAll('input[name="scenario"], input[name="difficulty"], input[name="goal"]')) {
                        input.checked = input.value === lobby.scenario || input.value === lobby.difficulty || input.value === lobby.goal;
                        input.disabled = true;
                    }
                    showLevel();
                    $('goal-note').textContent = GOALS[goal()] ? GOALS[goal()].text : '';
                    const mine = lobby.players.find(p => p.id === session.clientId);
                    if (mine && !mine.cc && selectedId && !taken(selectedId)) session.pick(selectedId);
                    refreshLobby();
                },
                onToast: text => { netNote = text; renderNet(); },
                onError: text => netError(text),
                onLost: () => { netNote = 'Связь пропала — переподключаемся…'; renderNet(); },
                onStart: (data, report) => {
                    net = null;
                    for (const input of document.querySelectorAll('input[name="scenario"], input[name="difficulty"], input[name="goal"]')) input.disabled = false;
                    document.body.classList.remove('net-lobby', 'net-guest-lobby');
                    launch(data, false, session);
                    if (report) window.game.loop.showReport(report);
                },
            });
            net = session;
            if (campaign) {
                try { await session.joinCampaign(campaign.id, campaign.cc, campaign.data); }
                catch (err) { session.leave(); if (net === session) net = null; return false; }
                return true;   // мир придёт следом — onStart
            }
            try {
                await session.join(code);
            } catch (err) {
                netError(err.message);
                return false;
            }
            if (session.game) return true;   // партия уже идёт — мир пришёл сразу
            netView = 'lobby'; netNote = '';
            refreshLobby();
            return true;
        };
        // Поиск идёт, пока открыт экран поиска: новые игры появляются сами.
        // Обновляем только список — введённый код не сбрасывается.
        let scanning = false;
        const scan = async () => {
            if (scanning) return;
            scanning = true;
            let result;
            try { result = await NetGuest.scan(); } catch (err) { result = { lan: false, games: [] }; netNote = err.message; }
            scanning = false;
            if (netView !== 'search') return;
            netGames = result;
            const found = document.querySelector('#net-body .net-found');
            if (found) found.innerHTML = foundList(); else renderNet();
            if (result.lan) setTimeout(() => { if (netView === 'search') scan(); }, 2500);
        };
        // Открыть кампанию у себя как сервер (своя копия — сервера или гостя).
        // «Продолжить» кампанию — одинаково для всех. Комната кампании
        // свободна — мы сервер. Занята — значит, её уже открыл другой игрок:
        // подключаемся к нему. Не вышло (брокер ещё помнит прежний сервер) —
        // пробуем снова, пока не получится.
        // «Продолжить» кампанию — одинаково для всех:
        // 1) основная комната свободна (или её держит наш же «призрак») — мы сервер;
        // 2) занята — подключаемся к тому, кто в любой из комнат кампании;
        // 3) никто не ответил — основную держит чужой «призрак»: занимаем
        //    запасную, второй игрок найдёт нас там сам.
        const resumeCampaign = async data => {
            $('net-box').scrollIntoView({ block: 'nearest' });
            const names = (data.net && data.net.names) || {};
            const name = names[data.playerCountry] || playerName();
            const id = data.net && data.net.id;
            const until = Date.now() + 90000;
            const opened = session => {
                netView = 'idle'; netNote = '';
                launch(data, false, session);
                SaveGame.save(data);
                window.game.ui.toast('Кампания открыта. Второй игрок — «▶ Продолжить» у себя, подключится сам.');
            };
            netNote = 'Открываем сетевую кампанию…'; netView = 'busy'; renderNet();
            for (let attempt = 0; Date.now() < until && netView === 'busy'; attempt++) {
                let session = new NetHost(name);
                try { await session.start(data); opened(session); return; }
                catch (err) { if (!err.taken || !id) { netView = 'idle'; netNote = err.message; renderNet(); return; } }
                if (netView !== 'busy') return;
                netNote = 'Кампания уже открыта у другого игрока — подключаемся к нему…'; renderNet();
                if (await joinGame('', { id, cc: data.playerCountry, data })) return;
                if (netView !== 'busy') return;
                netNote = 'Никто не ответил — открываем кампанию в запасной комнате…'; renderNet();
                session = new NetHost(name);
                try { await session.start(data, { any: true }); opened(session); return; }
                catch (err) { if (!err.taken) { netView = 'idle'; netNote = err.message; renderNet(); return; } }
                netNote = `Связь ещё занята — пробуем снова (попытка ${attempt + 2})…`; renderNet();
                await Net.sleep(2500);
            }
            if (netView === 'busy') { netView = 'idle'; netNote = 'Не удалось открыть кампанию. Проверьте интернет и попробуйте ещё раз.'; renderNet(); }
        };
        $('net-box').addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            if (btn.dataset.campaignOpen || btn.dataset.campaignDel) {
                const id = btn.dataset.campaignOpen || btn.dataset.campaignDel;
                if (btn.dataset.campaignDel) {
                    if (confirm('Удалить сетевую кампанию с этого устройства?')) { SaveGame.removeCampaign(id); renderNet(); }
                    return;
                }
                let payload;
                try { payload = SaveGame.loadCampaign(id); }
                catch (err) { netNote = 'Не удалось прочитать кампанию.'; renderNet(); return; }
                let data;
                try { data = GameData.restore(payload.game); }
                catch (err) { netNote = 'Кампания повреждена или от другой версии карты.'; renderNet(); return; }
                resumeCampaign(data);
                return;
            }
            if (btn.dataset.netTimer !== undefined && net && net.role === 'host') {
                netTimer = Number(btn.dataset.netTimer) || 0;
                net.setOptions(hostOptions());
                renderNet();
                return;
            }
            if (btn.id === 'net-host-btn') { netNote = ''; startHost(); }
            else if (btn.id === 'net-find-btn') { playerName(); netNote = ''; netView = 'search'; netGames = null; renderNet(); scan(); }
            else if (btn.id === 'net-leave-btn') { netNote = ''; leaveNet(); }
            else if (btn.id === 'net-join-btn') joinGame($('net-code-input').value);
            else if (btn.id === 'net-rejoin-btn') { const last = Net.lastGame(); if (last) joinGame(last.code); }
            else if (btn.dataset.code) joinGame(btn.dataset.code);
        });
        $('net-box').addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.id === 'net-code-input') joinGame(e.target.value);
        });
        $('tutorial-toggle').checked = !Tutorial.isDone();

        // Сохранённая партия — первым делом предлагаем продолжить.
        let saved = SaveGame.load();
        let saveProblem = SaveGame.error;
        // сетевая партия прошлой версии лежала в общей ячейке — переносим
        // её в сетевые кампании, чтобы одиночная игра её не затёрла
        if (saved && saved.game.humans && saved.game.humans.length > 1) {
            try {
                const data = GameData.restore(saved.game);
                SaveGame.campaignRole = 'host';
                if (SaveGame.saveCampaign(data)) { SaveGame.clear(); saved = null; }
            } catch (e) { /* оставляем как есть */ }
        }
        if (saveProblem) {
            $('save-warning').hidden = false;
            $('save-delete-btn').addEventListener('click', () => {
                SaveGame.clear();
                saveProblem = '';
                $('save-warning').hidden = true;
            });
        }
        if (saved) {
            const g = saved.game;
            const country = CountriesDB[g.player];
            const date = new Date(g.date);
            $('continue-box').hidden = false;
            $('continue-flag').outerHTML = flagImg(g.player, 80).replace('<img', '<img id="continue-flag"');
            $('continue-name').textContent = country ? country.name : g.player;
            $('continue-info').innerHTML =
                `Ход ${g.turn} · ${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
                + (SaveGame.migrated ? ' · <span class="migrated">перенесена из прошлой версии</span>' : '');
            $('continue-btn').addEventListener('click', () => {
                let data;
                try { data = GameData.restore(g); }
                catch (e) { alert('Не удалось загрузить партию. Сохранение оставлено в хранилище.'); return; }
                launch(data);
            });
        }

        const renderFeatured = () => {
            $('quick-countries').innerHTML = featured.map(id => {
                const a = assess(id);
                const who = taken(id);
                return `<button class="quick-country${who ? ' taken' : ''}" type="button" data-id="${id}" aria-pressed="${id === selectedId}">
                    ${flagImg(id, 80)}
                    <b>${escape(CountriesDB[id].name)}</b>
                    <span class="quick-meta">${who ? `🎮 ${escape(who)}` : `${bars(a.level)}${LEVELS[a.level]}`}</span>
                </button>`;
            }).join('');
        };

        const renderList = () => {
            const query = searchEl.value.trim().toLowerCase();
            const matches = query ? playable.filter(id => CountriesDB[id].name.toLowerCase().includes(query)) : playable;
            const shown = query || expanded ? matches : matches.slice(0, LIST_PREVIEW);
            $('featured-block').hidden = !!query;
            $('list-label').textContent = query ? `Найдено: ${matches.length}` : `Все страны · ${playable.length}`;
            listEl.innerHTML = shown.length ? shown.map(id => {
                const a = assess(id);
                const who = taken(id);
                return `<button class="country-list-item${id === selectedId ? ' selected' : ''}${who ? ' taken' : ''}" type="button" data-id="${id}" aria-pressed="${id === selectedId}">
                    ${flagImg(id, 40)}
                    <span class="name">${escape(CountriesDB[id].name)}${who ? ` <small class="taken-by">🎮 ${escape(who)}</small>` : ''}</span>
                    <span class="list-regions">${a.regions} обл.</span>
                    ${bars(a.level)}<span class="sr-only">${LEVELS[a.level]}</span>
                </button>`;
            }).join('') : '<div class="country-list-empty">Такой страны нет. Попробуйте другое название.</div>';
            moreBtn.hidden = !!query || expanded || matches.length <= LIST_PREVIEW;
            moreBtn.textContent = `Показать все страны (${playable.length})`;
        };

        const renderDossier = () => {
            const id = selectedId;
            const country = CountriesDB[id];
            const a = assess(id);
            const capital = CitiesDB.find(c => c.cc === id && c.isCapital);
            const regions = Object.keys(RegionsDB).filter(r => RegionsDB[r].cc === id);
            $('info-name').textContent = country.name;
            $('info-capital').textContent = 'Столица: ' + (capital ? capital.name : (regions.length ? RegionsDB[regions[0]].name : '—'));
            $('info-flag').outerHTML = flagImg(id, 160, 'flag flag-lg').replace('<img', '<img id="info-flag"');
            $('info-difficulty').className = `difficulty lvl-${a.level}`;
            $('info-difficulty').innerHTML = `Сложность${bars(a.level)}<b>${LEVELS[a.level]}</b>`;
            const stat = (label, value, cls = '') => `<div class="stat"><span>${label}</span><b class="${cls}">${value}</b></div>`;
            $('info-stats').innerHTML = [
                stat('Население', country.population ? formatMillions(country.population) : '—'),
                stat('Областей', a.regions),
                stat('Соседей', a.neighbours),
                stat('Казна', money(a.money)),
                stat('Доход / нед.', (a.net >= 0 ? '+' : '−') + money(a.net), a.net >= 0 ? 'pos' : 'neg'),
                stat('Армия', a.army.toLocaleString('ru-RU')),
            ].join('');
            // Профиль страны: чего в избытке (продаст), чего не хватает (будет докупать).
            const flows = Economy.flows(preview(), id);
            $('info-resources').innerHTML = Object.entries(RESOURCES).map(([key, res]) => {
                const net = Math.round(flows[key].prod - flows[key].need);
                return `<span class="res-chip ${net >= 0 ? 'pos' : 'neg'}" title="${res.name}: ${net >= 0 ? 'излишек' : 'нехватка'} за ход">${res.icon} ${net >= 0 ? '+' : '−'}${Math.abs(net)}</span>`;
            }).join('');
            const advice = $('info-advice');
            advice.className = `advice lvl-${a.level}`;
            advice.textContent = a.advice;
            drawMinimap(regions, country.color);
            startBtn.disabled = false;
            updateCta();
        };

        // Кнопка говорит, что именно начнётся: страна и режим.
        const updateCta = () => {
            if (!selectedId) return;
            if (net && net.role === 'guest') {
                const host = (lobbyPlayers().find(p => p.host) || {}).name || 'хозяин';
                startBtn.disabled = true;
                startBtn.innerHTML = `<span>Ждём, когда ${escape(host)} начнёт</span><small>Ваша страна: ${escape(CountriesDB[selectedId].name)}</small>`;
                return;
            }
            if (net && net.role === 'host') {
                const check = net.canStart();
                startBtn.disabled = !check.ok;
                const count = net.players.filter(p => p.connected).length;
                startBtn.innerHTML = check.ok
                    ? `<span>Начать сетевую игру ▶</span><small>${escape(CountriesDB[selectedId].name)} · игроков: ${count}</small>`
                    : `<span>${escape(check.reason)}</span><small>Код игры: ${escape(net.code)}</small>`;
                return;
            }
            const mode = scenario() === 'war2024' ? 'Сценарий 2024' : 'Мирный старт';
            if (hotseatOn()) {
                startBtn.disabled = seats.length < 2;
                startBtn.innerHTML = seats.length < 2
                    ? '<span>Выберите страну второго игрока</span><small>Вдвоём на одном устройстве</small>'
                    : `<span>Начать вдвоём ▶</span><small>${seats.map(id => escape(CountriesDB[id].name)).join(' · ')} · ${mode}</small>`;
                return;
            }
            const level = difficulty() === 'normal' ? '' : ' · ' + DIFFICULTY[difficulty()].name;
            const aim = goal() === 'domination' ? '' : ' · ' + GOALS[goal()].short;
            startBtn.innerHTML = `<span>Начать игру ▶</span><small>${escape(CountriesDB[selectedId].name)} · ${mode}${level}${aim}</small>`;
        };

        // Нет сети — вместо флага плашка цвета страны на карте.
        $('start-screen').addEventListener('error', e => {
            const img = e.target;
            if (img.tagName !== 'IMG' || !img.dataset.cc) return;
            const stub = document.createElement('span');
            stub.className = img.className + ' flag-stub';
            if (img.id) stub.id = img.id;
            stub.style.background = (CountriesDB[img.dataset.cc] || {}).color || 'var(--s3)';
            img.replaceWith(stub);
        }, true);

        const select = (id, fromTap) => {
            if (net && taken(id)) { netNote = `${CountriesDB[id].name} уже выбрал(а) ${taken(id)}`; renderNet(); return; }
            selectedId = id;
            if (net) { netNote = ''; net.pick(id); renderNet(); }
            if (hotseatOn() && !seats.includes(id) && seats.length < 4) { seats.push(id); renderSeats(); }
            for (const el of document.querySelectorAll('#start-screen [data-id]')) {
                const on = el.dataset.id === id;
                el.setAttribute('aria-pressed', String(on));
                el.classList.toggle('selected', on && el.classList.contains('country-list-item'));
            }
            renderDossier();
            // На телефоне досье ниже списка — показываем его после выбора.
            if (fromTap && window.matchMedia('(max-width: 899px)').matches) {
                $('step-dossier').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };

        const pick = e => {
            const btn = e.target.closest('[data-id]');
            if (btn) select(btn.dataset.id, true);
        };
        listEl.addEventListener('click', pick);
        $('quick-countries').addEventListener('click', pick);
        searchEl.addEventListener('input', renderList);
        searchEl.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            const first = listEl.querySelector('[data-id]');
            if (first) { searchEl.blur(); select(first.dataset.id, true); }
        });
        moreBtn.addEventListener('click', () => { expanded = true; renderList(); });
        for (const radio of document.querySelectorAll('input[name="scenario"]')) {
            radio.addEventListener('change', () => { renderFeatured(); renderList(); if (selectedId) renderDossier(); if (net && net.role === 'host') net.setOptions(hostOptions()); });
        }

        startBtn.addEventListener('click', () => {
            if (!selectedId || !CountriesDB[selectedId]) return;
            if (net) {
                if (net.role !== 'host') return;
                const data = net.createGame(hostOptions());
                if (!data) { updateCta(); return; }
                const session = net;
                net = null;
                SaveGame.campaignRole = 'host';
                SaveGame.save(data);
                launch(data, false, session);
                return;
            }
            if ((saved || saveProblem) && !confirm('Начать новую игру? Сохранённая партия будет удалена.')) return;
            SaveGame.clear();
            if (hotseatOn()) {
                if (seats.length < 2) return;
                launch(new GameData(seats[0], { humans: seats.slice(1), hotseat: true, scenario: scenario(), difficulty: difficulty(), goal: goal() }));
                return;
            }
            launch(new GameData(selectedId, { cheat: $('cheat-toggle').checked, scenario: scenario(), difficulty: difficulty(), goal: goal() }),
                $('tutorial-toggle').checked);
        });

        // Партия из файла: текущая версия грузится как есть, старая переносится.
        $('import-btn').addEventListener('click', () => $('import-file').click());
        $('import-file').addEventListener('change', async e => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            let data;
            try {
                data = GameData.restore(SaveGame.parse(await file.text()).game);
            } catch (err) {
                alert('Этот файл не подходит: в нём нет партии или она от другой карты.');
                return;
            }
            // сетевая кампания из файла открывается у нас как сервер
            if (data.multiplayer && !data.hotseat) { SaveGame.campaignRole = 'host'; resumeCampaign(data); return; }
            if ((saved || saveProblem) && !confirm('Загрузить партию из файла? Текущее сохранение будет заменено.')) return;
            SaveGame.clear();
            SaveGame.save(data);
            launch(data);
        });
        showLevel();

        drawHeroArt($('hero-art'));
        const initial = saved && playable.includes(saved.game.player) ? saved.game.player
            : (playable.includes('UA') ? 'UA' : playable[0]);
        selectedId = initial;
        renderNet();
        showGoal();
        renderFeatured();
        renderList();
        select(initial, false);
    };

    function formatMillions(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' млн';
        if (n >= 1e3) return Math.round(n / 1e3) + ' тыс.';
        return String(n);
    }

    function drawMinimap(regionIds, color) {
        const svg = document.getElementById('info-minimap');
        svg.innerHTML = '';
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of regionIds) {
            const info = RegionsDB[id];
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', info.path);
            path.setAttribute('fill', color);
            path.setAttribute('stroke', 'rgba(10,11,13,0.85)');
            path.setAttribute('stroke-width', '0.3');
            path.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.appendChild(path);
            minX = Math.min(minX, info.bx); maxX = Math.max(maxX, info.bx + info.bw);
            minY = Math.min(minY, info.by); maxY = Math.max(maxY, info.by + info.bh);
        }
        if (minX === Infinity) return;
        const pad = Math.max(maxX - minX, maxY - minY) * 0.08;
        svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
    }

    // Заставка: изометрический квартал из графитовых блоков с одним красным.
    function drawHeroArt(svg) {
        const S = 14, cos = Math.cos(Math.PI / 6), sin = 0.5;
        const pt = (i, j, z) => [(i - j) * cos * S, (i + j) * sin * S - z * S];
        const poly = (pts, fill) => `<polygon points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="${fill}"/>`;
        const palette = {
            dark: ['#2e333b', '#1c1f24', '#15171b'],
            mid: ['#3b414a', '#252930', '#1a1d22'],
            red: ['#ff3b2f', '#c9261c', '#8e1811'],
            white: ['#eceef1', '#c5c9cf', '#9aa0a8'],
        };
        // [i, j, ширина, глубина, высота, цвет]
        const blocks = [
            [0, 0, 4, 3, 5, 'dark'], [5, -1, 3, 3, 9, 'mid'], [9, 0, 3, 4, 6, 'dark'],
            [1, 4, 3, 3, 3, 'mid'], [5, 3, 2, 2, 12, 'dark'], [8, 5, 4, 2, 2, 'white'],
            [13, 1, 2, 5, 4, 'red'], [0, 8, 5, 2, 2, 'dark'], [6, 8, 3, 3, 7, 'mid'],
            [10, 8, 2, 2, 4, 'dark'], [3, 12, 3, 2, 1, 'white'],
        ].sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
        let out = '';
        // сетка «земли»
        for (let k = -2; k <= 16; k += 2) {
            const a = pt(k, -3, 0), b = pt(k, 16, 0), c = pt(-3, k, 0), d = pt(18, k, 0);
            out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="rgba(255,255,255,0.05)"/>`;
            out += `<line x1="${c[0]}" y1="${c[1]}" x2="${d[0]}" y2="${d[1]}" stroke="rgba(255,255,255,0.05)"/>`;
        }
        for (const [i, j, w, dpt, h, tone] of blocks) {
            const [top, left, right] = palette[tone];
            out += poly([pt(i, j + dpt, 0), pt(i + w, j + dpt, 0), pt(i + w, j + dpt, h), pt(i, j + dpt, h)], left);
            out += poly([pt(i + w, j, 0), pt(i + w, j + dpt, 0), pt(i + w, j + dpt, h), pt(i + w, j, h)], right);
            out += poly([pt(i, j, h), pt(i + w, j, h), pt(i + w, j + dpt, h), pt(i, j + dpt, h)], top);
            if (tone === 'red') {
                const [x, y] = pt(i + w, j + dpt / 2, h / 2);
                out += `<circle cx="${x}" cy="${y}" r="3" fill="#fff" opacity="0.9"/>`;
            }
        }
        svg.setAttribute('viewBox', '-150 -110 360 330');
        svg.setAttribute('preserveAspectRatio', 'xMaxYMid slice');
        svg.innerHTML = out;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();
})();
