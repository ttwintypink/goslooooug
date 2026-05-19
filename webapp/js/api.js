/* Тонкая обёртка над fetch для всех бэкенд-эндпоинтов. */
(function (root) {
    'use strict';

    async function postJson(path, payload) {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
        });
        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; }
        catch (_) { data = { detail: text }; }
        if (!res.ok) {
            const err = new Error(data.detail || ('HTTP ' + res.status));
            err.status = res.status;
            err.body = data;
            throw err;
        }
        return data;
    }

    async function uploadPhoto(adminUsername, targetUsername, file) {
        const fd = new FormData();
        fd.append('admin_username', adminUsername);
        fd.append('target_username', targetUsername);
        fd.append('file', file);
        const res = await fetch('/api/upload_photo', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
        return data;
    }

    root.API = {
        auth:           (u)            => postJson('/api/auth',            { username: u }),
        verifyPassword: (u, p)         => postJson('/api/verify_password', { username: u, password: p }),
        setPin:         (u, pin)       => postJson('/api/set_pin',         { username: u, pin }),
        verifyPin:      (u, pin)       => postJson('/api/verify_pin',      { username: u, pin }),
        getData:        (u, target)    => postJson('/api/get_data',        { username: u, target: target || u }),
        markRead:       (u)            => postJson('/api/mark_read',       { username: u }),
        payFines:       (u)            => postJson('/api/pay_fines',       { username: u }),
        listUsers:      (admin)        => postJson('/api/admin/list_users',{ admin_username: admin }),
        updateField:    (admin, target, entity, field, value, fineId) =>
            postJson('/api/update_field', {
                admin_username: admin, target_username: target,
                entity, field, value, fine_id: fineId,
            }),
        uploadPhoto,
    };
})(window);
