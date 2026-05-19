/* admin.html — список пользователей. Доступ только для админов. */
(function () {
    'use strict';
    const username = requireAuth();
    if (!username) return;

    if (Session.getRole() !== 'admin') {
        location.replace('home.html');
        return;
    }

    const { haptic, escapeHtml, tgAlert } = Common;

    const listEl = document.getElementById('admin-list');
    const searchInput = document.getElementById('admin-search-input');

    let allUsers = [];

    async function load() {
        try {
            const res = await API.listUsers(username);
            allUsers = res.users || [];
            render(allUsers);
        } catch (e) {
            listEl.innerHTML = '<div class="bs-empty" style="padding: 32px;">Ошибка: ' +
                escapeHtml(e.message) + '</div>';
        }
    }

    function render(users) {
        if (!users.length) {
            listEl.innerHTML = '<div class="bs-empty" style="padding: 32px;">Никого не найдено</div>';
            return;
        }
        listEl.innerHTML = users.map(u => {
            const fio = (u.fio && u.fio !== 'Не указано') ? u.fio : '@' + u.username;
            const sub = (u.fio && u.fio !== 'Не указано') ? '@' + u.username : '';
            const photo = u.photo_path
                ? '<img src="' + escapeHtml(u.photo_path) + '" alt="" />'
                : '<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">' +
                  '<circle cx="16" cy="12" r="6" fill="#8E8E93"/>' +
                  '<path d="M4 30 C4 22, 28 22, 28 30 Z" fill="#8E8E93"/>' +
                  '</svg>';
            const badge = u.role === 'admin'
                ? '<span class="admin-row-badge">admin</span>' : '';
            return '<div class="admin-row" data-username="' + escapeHtml(u.username) + '">' +
                '<span class="admin-row-avatar">' + photo + '</span>' +
                '<span class="admin-row-info">' +
                    '<span class="admin-row-name">' + escapeHtml(fio) + badge + '</span>' +
                    (sub ? '<span class="admin-row-username">' + escapeHtml(sub) + '</span>' : '') +
                '</span>' +
                '<span class="admin-row-chevron">' +
                    '<svg viewBox="0 0 12 20" width="8" height="14" aria-hidden="true">' +
                    '<path d="M2 2 L10 10 L2 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '</svg>' +
                '</span>' +
                '</div>';
        }).join('');

        listEl.querySelectorAll('.admin-row').forEach(row => {
            row.addEventListener('click', () => {
                haptic('light');
                const u = row.dataset.username;
                location.href = 'passport.html?target=' + encodeURIComponent(u);
            });
        });
    }

    searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) { render(allUsers); return; }
        const filtered = allUsers.filter(u =>
            (u.username || '').toLowerCase().includes(q) ||
            (u.fio || '').toLowerCase().includes(q));
        render(filtered);
    });

    document.querySelectorAll('.nav-back').forEach(btn => {
        btn.addEventListener('click', () => {
            haptic('light');
            location.href = btn.dataset.backTo || 'home.html';
        });
    });

    document.addEventListener('DOMContentLoaded', load);
    if (document.readyState !== 'loading') load();
})();
