/* ui.js — iOS-style alert и общие UI-хелперы. */
(function (root) {
    'use strict';

    function ensureContainer() {
        let c = document.getElementById('ios-alert-root');
        if (!c) {
            c = document.createElement('div');
            c.id = 'ios-alert-root';
            document.body.appendChild(c);
        }
        return c;
    }

    /**
     * Показать iOS-style alert.
     * @param {object} opts {title, message, buttons:[{label,style,onClick}]}
     *   style: 'default' | 'cancel' | 'destructive'
     */
    function iosAlert(opts) {
        const root = ensureContainer();
        const overlay = document.createElement('div');
        overlay.className = 'ios-alert-overlay';

        const card = document.createElement('div');
        card.className = 'ios-alert-card';

        const head = document.createElement('div');
        head.className = 'ios-alert-head';

        if (opts.title) {
            const t = document.createElement('div');
            t.className = 'ios-alert-title';
            t.textContent = opts.title;
            head.appendChild(t);
        }
        if (opts.message) {
            const m = document.createElement('div');
            m.className = 'ios-alert-message';
            m.textContent = opts.message;
            head.appendChild(m);
        }
        card.appendChild(head);

        const btns = opts.buttons && opts.buttons.length
            ? opts.buttons
            : [{ label: 'OK', style: 'default' }];

        const btnRow = document.createElement('div');
        btnRow.className = 'ios-alert-buttons' + (btns.length === 2 ? ' two-cols' : '');

        btns.forEach(b => {
            const el = document.createElement('button');
            el.className = 'ios-alert-btn ios-alert-btn-' + (b.style || 'default');
            el.textContent = b.label;
            el.addEventListener('click', () => {
                close();
                if (typeof b.onClick === 'function') b.onClick();
            });
            btnRow.appendChild(el);
        });
        card.appendChild(btnRow);
        overlay.appendChild(card);
        root.appendChild(overlay);

        // запуск анимации
        requestAnimationFrame(() => overlay.classList.add('show'));

        // haptic
        try {
            if (window.Telegram && Telegram.WebApp && Telegram.WebApp.HapticFeedback) {
                Telegram.WebApp.HapticFeedback.impactOccurred('light');
            }
        } catch (_) {}

        function close() {
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 200);
        }

        return { close };
    }

    function maintenance(section) {
        return iosAlert({
            title: section ? section : 'Технические работы',
            message: 'Раздел временно недоступен. Ведутся технические работы — попробуйте чуть позже.',
            buttons: [{ label: 'Понятно', style: 'default' }],
        });
    }

    function maxNotInstalled() {
        return iosAlert({
            title: 'Приложение МАХ не найдено',
            message: 'Не обнаружено приложение МАХ на вашем устройстве. Установите его в App Store или Google Play, чтобы предъявить документ.',
            buttons: [
                { label: 'Открыть App Store', style: 'default' },
                { label: 'Отмена', style: 'cancel' },
            ],
        });
    }

    root.UI = { iosAlert, maintenance, maxNotInstalled };
})(window);
