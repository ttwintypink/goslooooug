/* passport-details.html — подробные поля + секция вложений. */
(function () {
    'use strict';
    const username = requireAuth();
    if (!username) return;

    const { haptic, hapticNotify, tgAlert } = Common;

    // Поддержка ?target= для админа.
    const params = new URLSearchParams(location.search);
    const target = params.get('target');
    const isOtherTarget = target && target !== username;
    if (isOtherTarget && Session.getRole() !== 'admin') {
        location.replace('home.html');
        return;
    }
    const dataUser = isOtherTarget ? target : username;

    const list = document.querySelector('.details-list');
    const State = { passport: {}, role: 'user' };

    const FIELDS = [
        'passport_series_number', 'issue_date', 'subdivision_code', 'issued_by',
        'fio', 'gender', 'birth_date', 'birth_place',
    ];

    async function load() {
        try {
            const data = await API.getData(username, dataUser);
            State.passport = data.passport || {};
            State.role = (data.user && data.user.role) || 'user';
            render();
        } catch (e) {
            tgAlert('Ошибка загрузки: ' + e.message);
        }
    }

    function render() {
        FIELDS.forEach(f => {
            const row = list.querySelector('[data-field="' + f + '"]');
            if (!row) return;
            const v = row.querySelector('.details-value');
            if (!v) return;
            const val = State.passport[f];
            v.textContent = (val && val.length && val !== 'Не указано') ? val : '—';
        });

        const canEdit = isOtherTarget || State.role === 'admin';
        if (canEdit) {
            AdminEdit.attachPencils(list, async (entity, field, value) => {
                await API.updateField(username, dataUser, entity, field, value);
                State.passport[field] = value || 'Не указано';
            });
        } else {
            AdminEdit.removePencils(list);
        }
    }

    /* Action sheet "Добавить" */
    const sheet = document.getElementById('attach-sheet');
    const input = document.getElementById('attach-input');

    function openSheet() {
        sheet.classList.remove('hidden');
        haptic('light');
    }
    function closeSheet() {
        sheet.classList.add('hidden');
    }

    document.getElementById('attach-add').addEventListener('click', openSheet);
    document.getElementById('attach-cancel').addEventListener('click', closeSheet);
    sheet.addEventListener('click', (e) => {
        if (e.target === sheet) closeSheet();
    });

    sheet.querySelectorAll('.action-sheet-btn').forEach(b => {
        b.addEventListener('click', () => {
            haptic('light');
            closeSheet();
            const action = b.dataset.action;
            if (action === 'gallery' || action === 'file') {
                input.click();
            } else {
                UI.maintenance('Сканирование документа');
            }
        });
    });

    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const canEdit = isOtherTarget || State.role === 'admin';
        if (!canEdit) {
            tgAlert('Загрузка фото доступна только администратору');
            input.value = '';
            return;
        }
        try {
            await API.uploadPhoto(username, dataUser, file);
            hapticNotify('success');
            tgAlert('Файл прикреплён');
        } catch (e) {
            hapticNotify('error');
            tgAlert('Ошибка: ' + e.message);
        } finally {
            input.value = '';
        }
    });

    document.querySelectorAll('.nav-back').forEach(btn => {
        btn.addEventListener('click', () => {
            haptic('light');
            const back = btn.dataset.backTo || 'passport.html';
            location.href = isOtherTarget ? back + '?target=' + encodeURIComponent(dataUser) : back;
        });
    });

    document.addEventListener('DOMContentLoaded', load);
    if (document.readyState !== 'loading') load();
})();
