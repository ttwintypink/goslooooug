/* Telegram WebApp init, haptic, утилиты. */
(function (root) {
    'use strict';

    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
        try { tg.ready(); tg.expand(); } catch (_) {}
        try {
            tg.setHeaderColor('#000000');
            tg.setBackgroundColor('#000000');
        } catch (_) {}
    }

    function haptic(style) {
        try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(style); } catch (_) {}
    }
    function hapticNotify(type) {
        try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(type); } catch (_) {}
    }

    function getInitialUsername() {
        if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.username) {
            return tg.initDataUnsafe.user.username;
        }
        const params = new URLSearchParams(window.location.search);
        return params.get('u');
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatRub(n) {
        const num = Number(n) || 0;
        return num.toLocaleString('ru-RU') + ' ₽';
    }

    function tgAlert(msg) {
        // Если подключен ui.js — используем красивый iOS-alert.
        if (window.UI && typeof UI.iosAlert === 'function') {
            UI.iosAlert({ message: msg, buttons: [{ label: 'OK', style: 'default' }] });
            return;
        }
        if (tg && tg.showAlert) tg.showAlert(msg);
        else alert(msg);
    }

    root.TG = tg;
    root.Common = { haptic, hapticNotify, getInitialUsername, escapeHtml, formatRub, tgAlert };
})(window);
