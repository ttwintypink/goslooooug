/* home.html — главный экран как в реальных ГосУслугах. */
(function () {
    'use strict';
    const username = requireAuth();
    if (!username) return;

    const { haptic, hapticNotify, tgAlert } = Common;

    const profileNameEl = document.getElementById('profile-name');
    const notifDot      = document.getElementById('notif-dot');
    const chargesCard   = document.getElementById('charges-card');
    const chargesAmount = document.getElementById('charges-amount');
    const chargesSub    = document.getElementById('charges-sub');
    const chargesList   = document.getElementById('charges-list');
    const chargesPayBtn = document.getElementById('charges-pay');

    const State = { passport: {}, fines: [], notifications: [] };

    async function load() {
        try {
            const data = await API.getData(username);
            State.passport      = data.passport || {};
            State.fines         = data.fines || [];
            State.notifications = data.notifications || [];
            Session.setRole((data.user && data.user.role) || 'user');
            render();
        } catch (e) {
            tgAlert('Ошибка загрузки: ' + e.message);
        }
    }

    function render() {
        // Имя в шапке: первое имя из ФИО, иначе TG, иначе username.
        let name;
        const fio = State.passport.fio;
        if (fio && fio !== 'Не указано') {
            const parts = fio.trim().split(/\s+/);
            name = parts.length >= 2 ? parts[1] : parts[0];
        } else if (TG && TG.initDataUnsafe && TG.initDataUnsafe.user) {
            const u = TG.initDataUnsafe.user;
            name = u.first_name || u.username || username;
        } else {
            name = username;
        }
        profileNameEl.textContent = name;
        Session.setDisplayName(name);

        const unread = State.notifications.some(n => !n.is_read);
        notifDot.classList.toggle('hidden', !unread);

        // Кнопка админ-панели — только для админов.
        const adminBtn = document.getElementById('btn-admin');
        if (adminBtn) {
            adminBtn.classList.toggle('hidden', Session.getRole() !== 'admin');
        }

        renderCharges();
    }

    function renderCharges() {
        const fines = State.fines || [];
        chargesList.innerHTML = '';
        if (!fines.length) {
            chargesCard.classList.remove('charges-active');
            chargesCard.classList.add('charges-empty');
            chargesAmount.textContent = 'Нет начислений';
            chargesSub.textContent = 'уточните данные';
            chargesSub.classList.remove('hidden');
            chargesList.classList.add('hidden');
            chargesPayBtn.classList.add('hidden');
            return;
        }
        chargesCard.classList.add('charges-active');
        chargesCard.classList.remove('charges-empty');
        chargesSub.classList.add('hidden');
        let total = 0;
        fines.forEach(f => {
            total += Number(f.amount) || 0;
            const row = document.createElement('div');
            row.className = 'charges-list-item';
            row.innerHTML =
                '<span class="item-title">' + Common.escapeHtml(f.title) + '</span>' +
                '<span class="item-amount">' + Common.formatRub(f.amount) + '</span>';
            chargesList.appendChild(row);
        });
        chargesAmount.textContent = Common.formatRub(total);
        chargesList.classList.remove('hidden');
        chargesPayBtn.classList.remove('hidden');
    }

    /* Pay flow */
    chargesPayBtn.addEventListener('click', async () => {
        if (!State.fines.length) return;
        haptic('medium');
        try {
            await API.payFines(username);
            await load();
            hapticNotify('success');
        } catch (e) {
            hapticNotify('error');
            tgAlert('Ошибка оплаты: ' + e.message);
        }
    });

    /* Поиск (заглушка) */
    document.getElementById('btn-search').addEventListener('click', () => {
        haptic('light');
        UI.maintenance('Поиск');
    });

    /* Админ-панель */
    const adminBtn = document.getElementById('btn-admin');
    if (adminBtn) {
        adminBtn.addEventListener('click', () => {
            haptic('light');
            location.href = 'admin.html';
        });
    }

    /* Профиль */
    document.getElementById('profile-btn').addEventListener('click', () => {
        haptic('light');
        UI.maintenance('Профиль');
    });

    /* Уведомления */
    const bsOverlay = document.getElementById('bs-overlay');
    const bsSheet   = document.getElementById('bs-notifications');
    const bsList    = document.getElementById('bs-notifications-list');

    document.getElementById('btn-notifications').addEventListener('click', async () => {
        haptic('light');
        bsList.innerHTML = '';
        const items = State.notifications || [];
        if (!items.length) {
            bsList.innerHTML = '<div class="bs-empty">Нет уведомлений</div>';
        } else {
            items.forEach(n => {
                const div = document.createElement('div');
                div.className = 'bs-item' + (n.is_read ? '' : ' unread');
                div.textContent = n.text;
                bsList.appendChild(div);
            });
        }
        bsOverlay.classList.remove('hidden');
        bsSheet.classList.remove('hidden');
        try {
            await API.markRead(username);
            State.notifications.forEach(n => n.is_read = 1);
            notifDot.classList.add('hidden');
        } catch (_) {}
    });

    bsOverlay.addEventListener('click', () => {
        bsOverlay.classList.add('hidden');
        bsSheet.classList.add('hidden');
    });

    /* Плитки документов */
    document.querySelectorAll('.doc-tile').forEach(t => {
        t.addEventListener('click', () => {
            haptic('light');
            const go = t.dataset.go;
            if (go === 'passport.html') {
                location.href = 'passport.html';
            } else {
                const titles = {
                    oms: 'Полис ОМС',
                    snils: 'СНИЛС',
                    'docs-all': 'Документы',
                };
                UI.maintenance(titles[go] || 'Раздел');
            }
        });
    });

    /* Сервисы */
    document.querySelectorAll('.service-tile').forEach(t => {
        t.addEventListener('click', () => {
            haptic('light');
            const map = {
                health: 'Здоровье',
                auto: 'Авто',
                school: 'Моя школа',
                other: 'Другие сервисы',
            };
            UI.maintenance(map[t.dataset.service] || 'Раздел');
        });
    });

    /* Алерт-кнопки */
    document.querySelectorAll('.alert-btn').forEach(b => {
        b.addEventListener('click', () => {
            haptic('light');
            UI.maintenance('Цифровой ID');
        });
    });

    /* Пилюли + промо-карусель */
    const pillTitles = {
        egrn: 'Сведения ЕГРН',
        doctor: 'Запись к врачу',
        inn: 'ИНН',
        decisions: 'Решения',
    };
    document.querySelectorAll('.pill').forEach(p => {
        p.addEventListener('click', () => {
            haptic('light');
            UI.maintenance(pillTitles[p.dataset.pill] || 'Раздел');
        });
    });

    const promoTitles = {
        protect: 'Защита близких',
        tax: 'Налоговый вычет',
        rent: 'Аренда онлайн',
        business: 'Бизнес онлайн',
    };
    document.querySelectorAll('.promo-card').forEach(c => {
        c.addEventListener('click', () => {
            haptic('light');
            UI.maintenance(promoTitles[c.dataset.promo] || 'Раздел');
        });
    });

    /* Tab bar */
    document.querySelectorAll('.tab-item').forEach(t => {
        t.addEventListener('click', () => {
            haptic('light');
            const tab = t.dataset.tab;
            if (tab === 'home') return;
            const titles = {
                services: 'Услуги',
                assistant: 'Помощник Макс',
                payments: 'Платежи',
                documents: 'Документы',
            };
            UI.maintenance(titles[tab] || 'Раздел');
        });
    });

    document.addEventListener('DOMContentLoaded', load);
    if (document.readyState !== 'loading') load();
})();
