/* login.html — два экрана: пароль и установка PIN. */
(function () {
    'use strict';
    const { haptic, hapticNotify, getInitialUsername, tgAlert } = Common;

    const phasePassword = document.getElementById('phase-password');
    const phaseSetpin   = document.getElementById('phase-setpin');

    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorEl       = document.getElementById('login-error');
    const submitBtn     = document.getElementById('login-submit');

    const setpinUsernameEl = document.getElementById('setpin-username');
    const setpinTitleEl    = document.getElementById('setpin-title');
    const setpinDots       = document.getElementById('setpin-dots');
    const setpinNumpad     = document.getElementById('setpin-numpad');

    let username = null;

    function showError(msg) {
        if (!msg) { errorEl.classList.add('hidden'); errorEl.textContent = ''; return; }
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    }

    function showPhase(which) {
        phasePassword.classList.toggle('hidden', which !== 'password');
        phaseSetpin.classList.toggle('hidden', which !== 'setpin');
    }

    /* ----- Bootstrap: проверяем состояние пользователя ------------------- */
    async function bootstrap() {
        username = Session.getRememberedUsername() || getInitialUsername();
        if (!username) {
            showError('Не удалось определить ваш Telegram username. Откройте приложение через бота.');
            usernameInput.value = '';
            passwordInput.disabled = true;
            submitBtn.disabled = true;
            return;
        }
        usernameInput.value = '@' + username;

        try {
            const auth = await API.auth(username);
            if (!auth.ok || !auth.exists) {
                showError(auth.message || 'Аккаунт не найден.');
                passwordInput.disabled = true;
                submitBtn.disabled = true;
                return;
            }
            // Если уже не первый вход и логин запомнен — сразу на PIN.
            if (!auth.is_first_login && Session.getRememberedUsername()) {
                location.replace('pin.html');
                return;
            }
            // Если не первый вход, но логин ещё не запомнен (например, переустановили) —
            // запоминаем и тоже редиректим на PIN, без повторной авторизации.
            if (!auth.is_first_login) {
                Session.rememberUsername(username);
                Session.setRole(auth.role || 'user');
                location.replace('pin.html');
                return;
            }
            // Первичный вход — показываем форму пароля.
            Session.setRole(auth.role || 'user');
            passwordInput.focus();
        } catch (e) {
            showError('Ошибка соединения: ' + e.message);
        }
    }

    /* ----- Фаза 1: пароль ------------------------------------------------ */
    submitBtn.addEventListener('click', async () => {
        const password = (passwordInput.value || '').trim();
        if (!password) { showError('Введите пароль.'); return; }
        showError('');
        submitBtn.disabled = true;
        try {
            const res = await API.verifyPassword(username, password);
            if (!res.ok) {
                showError('Неверный пароль.');
                hapticNotify('error');
                return;
            }
            hapticNotify('success');
            passwordInput.value = '';
            startSetPinPhase();
        } catch (e) {
            showError('Ошибка: ' + e.message);
        } finally {
            submitBtn.disabled = false;
        }
    });
    passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitBtn.click();
    });

    /* ----- Фаза 2: установка PIN (двойной ввод) -------------------------- */
    let firstPin = null;
    let buffer = '';

    function startSetPinPhase() {
        firstPin = null;
        buffer = '';
        setpinUsernameEl.textContent = '@' + username;
        setpinTitleEl.textContent = 'Придумайте PIN-код';
        updateSetpinDots();
        showPhase('setpin');
    }

    function updateSetpinDots(state) {
        const dots = setpinDots.querySelectorAll('.pin-dot');
        dots.forEach((d, i) => {
            d.classList.remove('filled', 'error');
            if (state === 'error') { d.classList.add('error'); return; }
            if (i < buffer.length) d.classList.add('filled');
        });
    }

    function shake() {
        setpinDots.classList.remove('shake');
        void setpinDots.offsetWidth;
        setpinDots.classList.add('shake');
    }

    setpinNumpad.addEventListener('click', async (e) => {
        const btn = e.target.closest('.pin-key');
        if (!btn || btn.disabled) return;
        const key = btn.dataset.key;
        if (!key) return;

        if (key === 'back') {
            if (buffer.length > 0) {
                buffer = buffer.slice(0, -1);
                updateSetpinDots();
                haptic('light');
            }
            return;
        }
        if (buffer.length >= 4) return;
        buffer += key;
        updateSetpinDots();
        haptic('light');

        if (buffer.length === 4) {
            if (firstPin === null) {
                // Первый ввод — запоминаем, просим повторить.
                firstPin = buffer;
                buffer = '';
                setpinTitleEl.textContent = 'Повторите PIN-код';
                setTimeout(updateSetpinDots, 150);
                return;
            }
            // Второй ввод — сверяем.
            if (buffer !== firstPin) {
                hapticNotify('error');
                updateSetpinDots('error');
                shake();
                setTimeout(() => {
                    firstPin = null;
                    buffer = '';
                    setpinTitleEl.textContent = 'Не совпало. Придумайте PIN-код';
                    updateSetpinDots();
                }, 480);
                return;
            }
            // Совпало — отправляем на сервер.
            try {
                await API.setPin(username, buffer);
                Session.rememberUsername(username);
                Session.markPinPassed();
                hapticNotify('success');
                location.replace('home.html');
            } catch (err) {
                hapticNotify('error');
                tgAlert('Ошибка сохранения PIN: ' + err.message);
                firstPin = null;
                buffer = '';
                setpinTitleEl.textContent = 'Придумайте PIN-код';
                updateSetpinDots();
            }
        }
    });

    document.addEventListener('DOMContentLoaded', bootstrap);
})();
