// =====================================================================
// ОБУЧЕНИЕ В ПЕРВЫЕ ХОДЫ
//
// Карточка-подсказка ведёт новичка по одному действию за раз: открыть
// свою область → набрать войска → закончить ход. Шаг засчитывается сам,
// когда игрок сделал действие, — кнопка «Дальше» нужна только на
// последнем, пояснительном шаге. Пройденное обучение запоминается
// в браузере и больше не показывается.
// =====================================================================
class Tutorial {
    static KEY = 'politics-tutorial-done';

    static isDone() {
        try { return localStorage.getItem(Tutorial.KEY) === '1'; } catch (e) { return true; }
    }

    static markDone() {
        try { localStorage.setItem(Tutorial.KEY, '1'); } catch (e) { /* хранилище недоступно */ }
    }

    constructor(game) {
        this.game = game;
        this.card = document.getElementById('coach');
        this.index = -1;
        this.timer = null;
        const d = game.data;
        const ownOpen = () => {
            const id = game.panelRegion;
            return !!id && d.getRegion(id)?.owner === d.playerCountry;
        };
        const recruitOpen = () => document.getElementById('recruit-panel').style.display === 'block';
        this.steps = [
            {
                text: 'Это ваша страна. Нажмите на любую её область на карте — откроется карточка области.',
                done: ownOpen,
            },
            {
                text: 'В карточке — население, экономика и войска области. Нажмите «Набрать войска».',
                target: '#recruit-btn',
                done: () => recruitOpen() || d.campaign.recruited,
            },
            {
                text: 'Кнопками + и − выберите, сколько войск нанять, и нажмите «Заказать». Деньги спишутся сразу.',
                target: '#confirm-recruit-btn',
                done: () => d.campaign.recruited,
            },
            {
                text: 'Приказ попал в «План на ход». Нажмите «Конец хода» — пройдёт неделя, придут налоги и войска.',
                target: '#end-turn-btn',
                done: () => d.turn >= 1,
            },
            {
                text: 'Отлично! Дальше сами: чтобы захватывать области, откройте «Дипломатию» и объявите войну соседу, '
                    + 'потом в карточке своей области нажмите «Наступление». Цель — весь мир. За «Задания» платят деньгами и влиянием, а в «Дипломатии» можно торговать и заключать союзы.',
                final: true,
            },
        ];
        document.getElementById('coach-skip').addEventListener('click', () => this.finish());
        document.getElementById('coach-next').addEventListener('click', () => this.finish());
    }

    start() {
        this.game.map.focusCountry(this.game.data.playerCountry);
        document.body.classList.add('coach-on');
        this.card.hidden = false;
        this.show(0);
        // Действия игрока идут разными путями (карта, панели, окна), поэтому
        // проще раз в полсекунды проверить условие шага, чем ловить каждый.
        this.timer = setInterval(() => this.check(), 400);
    }

    show(index) {
        this.index = index;
        const step = this.steps[index];
        document.querySelectorAll('.coach-target').forEach(el => el.classList.remove('coach-target'));
        const target = step.target && document.querySelector(step.target);
        if (target) {
            target.classList.add('coach-target');
            // Кнопка может быть ниже края карточки — докручиваем до неё.
            setTimeout(() => { if (target.offsetParent) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 300);
        }
        document.getElementById('coach-step').textContent = `Обучение · ${index + 1} из ${this.steps.length}`;
        document.getElementById('coach-text').textContent = step.text;
        document.getElementById('coach-next').hidden = !step.final;
        document.getElementById('coach-skip').hidden = !!step.final;
    }

    check() {
        const step = this.steps[this.index];
        if (!step || step.final) return;
        // Шаг мог выполниться раньше — например, набор без открытой панели.
        let next = this.index;
        while (next < this.steps.length && !this.steps[next].final && this.steps[next].done()) next++;
        if (next !== this.index) this.show(next);
    }

    finish() {
        clearInterval(this.timer);
        document.querySelectorAll('.coach-target').forEach(el => el.classList.remove('coach-target'));
        document.body.classList.remove('coach-on');
        this.card.hidden = true;
        Tutorial.markDone();
    }
}
