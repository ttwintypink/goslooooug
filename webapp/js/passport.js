/* passport.html — карточка паспорта (светлый стиль). */
(function () {
    'use strict';
    const username = requireAuth();
    if (!username) return;

    const { haptic, hapticNotify, tgAlert } = Common;

    // Поддержка админ-режима: ?target=username открывает чужой паспорт.
    const params = new URLSearchParams(location.search);
    const target = params.get('target');
    const isOtherTarget = target && target !== username;
    if (isOtherTarget && Session.getRole() !== 'admin') {
        location.replace('home.html');
        return;
    }
    const dataUser = isOtherTarget ? target : username;

    const photoEl       = document.getElementById('passport-photo');
    const photoEditBtn  = document.getElementById('passport-photo-edit');
    const photoInput    = document.getElementById('passport-photo-input');
    const presentBtn    = document.getElementById('passport-present');
    const numberEl      = document.getElementById('passport-number-display');
    const copyBtn       = document.getElementById('passport-copy');
    const card          = document.querySelector('.passport-card');

    const State = { passport: {}, role: 'user' };

    async function load() {
        try {
            const data = await API.getData(username, dataUser);
            State.passport = data.passport || {};
            State.role = (data.user && data.user.role) || 'user';
            // Роль текущего юзера хранится отдельно — не путаем с ролью target.
            render();
        } catch (e) {
            tgAlert('Ошибка загрузки: ' + e.message);
        }
    }

    function formatNumber(raw) {
        if (!raw || raw === 'Не указано') return '— —';
        // Допускаем форматы "6623 161874", "6623161874", "66 23 161874".
        const digits = raw.replace(/\D/g, '');
        if (digits.length === 10) {
            return digits.slice(0, 4) + ' ' + digits.slice(4);
        }
        return raw;
    }

    function render() {
        const p = State.passport;

        // Фото
        photoEl.innerHTML = '';
        if (p.photo_path) {
            const img = document.createElement('img');
            img.src = p.photo_path;
            img.alt = 'photo';
            img.onerror = renderPhotoPlaceholder;
            photoEl.appendChild(img);
        } else {
            renderPhotoPlaceholder();
        }

        // Серия и номер — крупный текст
        numberEl.textContent = formatNumber(p.passport_series_number);

        // Поля карточки
        setValue('issued_by', p.issued_by);
        setValue('issue_date', p.issue_date);
        setValue('subdivision_code', p.subdivision_code);
        setValue('fio', p.fio);
        setValue('gender', p.gender);
        setValue('birth_date', p.birth_date);
        setValue('birth_place', p.birth_place);

        // В админ-режиме всегда показываем карандаши (текущий юзер — админ),
        // независимо от роли target.
        const canEdit = isOtherTarget || State.role === 'admin';
        if (canEdit) {
            photoEditBtn.classList.remove('hidden');
            AdminEdit.attachPencils(card, saveField);
        } else {
            photoEditBtn.classList.add('hidden');
            AdminEdit.removePencils(card);
        }
    }

    function renderPhotoPlaceholder() {
        photoEl.innerHTML =
            '<svg viewBox="0 0 64 80" width="60" height="76" aria-hidden="true">' +
            '<circle cx="32" cy="28" r="14" fill="rgba(0,0,0,0.18)"/>' +
            '<path d="M8 78 C8 60, 56 60, 56 78 Z" fill="rgba(0,0,0,0.18)"/>' +
            '</svg>';
    }

    function setValue(field, value) {
        const row = card.querySelector('[data-field="' + field + '"]');
        if (!row) return;
        const v = row.querySelector('.passport-field-value');
        if (v) v.textContent = (value && value.length && value !== 'Не указано') ? value : '—';
    }

    async function saveField(entity, field, value) {
        await API.updateField(username, dataUser, entity, field, value);
        State.passport[field] = value || 'Не указано';
        if (field === 'passport_series_number') {
            numberEl.textContent = formatNumber(value);
        }
    }

    /* Копирование номера */
    copyBtn.addEventListener('click', async () => {
        const text = (State.passport.passport_series_number || '').replace(/\s+/g, ' ');
        if (!text || text === 'Не указано') return;
        try {
            await navigator.clipboard.writeText(text);
            hapticNotify('success');
            tgAlert('Номер скопирован');
        } catch (_) {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            document.body.removeChild(ta);
            hapticNotify('success');
        }
    });

    presentBtn.addEventListener('click', () => {
        haptic('medium');
        UI.maxNotInstalled();
    });

    // Если открыт чужой паспорт — детали тоже передают target.
    if (isOtherTarget) {
        const dl = document.getElementById('passport-details-link');
        if (dl) dl.href = 'passport-details.html?target=' + encodeURIComponent(dataUser);
    }

    /* Загрузка фото — только для админа */
    photoEditBtn.addEventListener('click', () => {
        if (!isOtherTarget && State.role !== 'admin') return;
        photoInput.click();
    });

    photoInput.addEventListener('change', async () => {
        const file = photoInput.files && photoInput.files[0];
        if (!file) return;
        try {
            const res = await API.uploadPhoto(username, dataUser, file);
            State.passport.photo_path = res.photo_path;
            render();
            hapticNotify('success');
        } catch (e) {
            hapticNotify('error');
            tgAlert('Ошибка загрузки: ' + e.message);
        } finally {
            photoInput.value = '';
        }
    });

    document.querySelectorAll('.nav-back').forEach(btn => {
        btn.addEventListener('click', () => {
            haptic('light');
            const target = btn.dataset.backTo;
            if (target) location.href = isOtherTarget ? 'admin.html' : target;
        });
    });

    document.addEventListener('DOMContentLoaded', load);
    if (document.readyState !== 'loading') load();
})();
