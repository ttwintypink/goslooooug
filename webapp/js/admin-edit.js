/* admin-edit.js — общий модуль карандашей и инлайн-редактора.
   Подключается на passport.html и passport-details.html. */
(function (root) {
    'use strict';
    const { escapeHtml, hapticNotify, tgAlert } = Common;

    /** Создаёт SVG-иконку карандаша. */
    function pencilSvg() {
        return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
               '<path d="M11 2 L14 5 L5 14 L2 14 L2 11 Z" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>' +
               '</svg>';
    }

    /** Прицепляет карандаши ко всем полям с data-field на корне. */
    function attachPencils(rootEl, onSave) {
        if (!rootEl) return;
        const rows = rootEl.querySelectorAll('[data-field][data-entity]');
        rows.forEach(row => {
            if (row.querySelector(':scope > .pencil-btn')) return;
            const btn = document.createElement('button');
            btn.className = 'pencil-btn';
            btn.setAttribute('aria-label', 'Изменить');
            btn.innerHTML = pencilSvg();
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openInlineEditor(row, onSave);
            });
            row.appendChild(btn);
        });
    }

    function removePencils(rootEl) {
        if (!rootEl) return;
        rootEl.querySelectorAll('[data-field] > .pencil-btn').forEach(b => b.remove());
    }

    function openInlineEditor(row, onSave) {
        const valueEl = row.querySelector('.passport-field-value, .details-value');
        if (!valueEl) return;
        const field = row.dataset.field;
        const entity = row.dataset.entity;
        if (!field || !entity) return;
        if (row.querySelector(':scope > .inline-editor')) return;

        const current = valueEl.textContent === '—' ? '' : valueEl.textContent;

        valueEl.style.display = 'none';
        const pencil = row.querySelector(':scope > .pencil-btn');
        if (pencil) pencil.style.display = 'none';

        const editor = document.createElement('div');
        editor.className = 'inline-editor';
        editor.innerHTML =
            '<input type="text" value="' + escapeHtml(current) + '" />' +
            '<button type="button" class="ok">ОК</button>' +
            '<button type="button" class="cancel">Отмена</button>';
        row.appendChild(editor);

        const input = editor.querySelector('input');
        const okBtn = editor.querySelector('.ok');
        const cancelBtn = editor.querySelector('.cancel');
        input.focus();
        input.select();

        function close(newValue) {
            editor.remove();
            valueEl.style.display = '';
            if (pencil) pencil.style.display = '';
            if (newValue != null) valueEl.textContent = newValue.length ? newValue : '—';
        }

        cancelBtn.addEventListener('click', () => close());

        okBtn.addEventListener('click', async () => {
            const newVal = input.value.trim();
            okBtn.disabled = true;
            try {
                await onSave(entity, field, newVal);
                hapticNotify('success');
                close(newVal);
            } catch (e) {
                hapticNotify('error');
                tgAlert('Ошибка: ' + e.message);
                okBtn.disabled = false;
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') okBtn.click();
            if (e.key === 'Escape') cancelBtn.click();
        });
    }

    root.AdminEdit = { attachPencils, removePencils };
})(window);
