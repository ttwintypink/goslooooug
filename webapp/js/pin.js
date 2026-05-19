/* pin.html — ввод PIN на каждом запуске сессии. */
(function () {
    'use strict';
    const { haptic, hapticNotify, getInitialUsername } = Common;

    const usernameEl = document.getElementById('pin-username');
    const dotsEl     = document.getElementById('pin-dots');
    const numpadEl   = document.getElementById('pin-numpad');
    const logoutBtn  = document.getElementById('pin-logout');

    let username = Session.getRememberedUsername() || getInitialUsername();
    if (!username) {
        location.replace('login.html');
        return;
    }

    let buffer = '';
    // Имя в шапке: сохранённое из прошлой сессии, иначе TG first_name, иначе username.
    const cachedName = Session.getDisplayName();
    const tgName = TG && TG.initDataUnsafe && TG.initDataUnsafe.user
        ? TG.initDataUnsafe.user.first_name : null;
    usernameEl.textContent = cachedName || tgName || username;

    function updateDots(state) {
        const dots = dotsEl.querySelectorAll('.pin-dot');
        dots.forEach((d, i) => {
            d.classList.remove('filled', 'error');
            if (state === 'error') { d.classList.add('error'); return; }
            if (i < buffer.length) d.classList.add('filled');
        });
    }

    function shake() {
        dotsEl.classList.remove('shake');
        void dotsEl.offsetWidth;
        dotsEl.classList.add('shake');
    }

    async function submit() {
        try {
            const res = await API.verifyPin(username, buffer);
            if (!res.ok) { fail(); return; }
            hapticNotify('success');
            // Подтянем роль для админских функций.
            try {
                const data = await API.getData(username);
                Session.setRole((data.user && data.user.role) || 'user');
                Session.rememberUsername(username);
            } catch (_) {}
            Session.markPinPassed();
            location.replace('home.html');
        } catch (_) {
            fail();
        }
    }

    function fail() {
        hapticNotify('error');
        updateDots('error');
        shake();
        setTimeout(() => {
            buffer = '';
            updateDots();
            dotsEl.classList.remove('shake');
        }, 480);
    }

    numpadEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.pin-key');
        if (!btn || btn.disabled) return;
        const key = btn.dataset.key;
        if (!key) return;

        if (key === 'back') {
            if (buffer.length > 0) {
                buffer = buffer.slice(0, -1);
                updateDots();
                haptic('light');
            }
            return;
        }
        if (buffer.length >= 4) return;
        buffer += key;
        updateDots();
        haptic('light');
        if (buffer.length === 4) submit();
    });

    logoutBtn.addEventListener('click', () => {
        Session.forgetUsername();
        Session.clearPin();
        location.replace('login.html');
    });
})();
