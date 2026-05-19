/* Состояние авторизации + гарды для каждой страницы.
   - localStorage['gu_username'] — запомненный логин (после первого входа)
   - sessionStorage['gu_pin_passed'] — флаг текущей сессии (PIN пройден)
   - sessionStorage['gu_role'] — роль (user/admin), удобно не дёргать API
*/
(function (root) {
    'use strict';

    const LS_USER = 'gu_username';
    const LS_NAME = 'gu_display_name';
    const SS_PIN  = 'gu_pin_passed';
    const SS_ROLE = 'gu_role';

    const Session = {
        getRememberedUsername: () => localStorage.getItem(LS_USER) || null,
        rememberUsername: (u)  => localStorage.setItem(LS_USER, u),
        forgetUsername:   ()   => { localStorage.removeItem(LS_USER); localStorage.removeItem(LS_NAME); },

        getDisplayName: () => localStorage.getItem(LS_NAME) || null,
        setDisplayName: (n) => { if (n) localStorage.setItem(LS_NAME, n); },

        isPinPassed: () => sessionStorage.getItem(SS_PIN) === '1',
        markPinPassed: () => sessionStorage.setItem(SS_PIN, '1'),
        clearPin:       () => sessionStorage.removeItem(SS_PIN),

        setRole: (r) => sessionStorage.setItem(SS_ROLE, r || 'user'),
        getRole: ()  => sessionStorage.getItem(SS_ROLE) || 'user',
    };

    /** Гард для всех "внутренних" страниц (после PIN).
     *  Если PIN не пройден — отправит на pin.html (или login.html, если логина нет). */
    function requireAuth() {
        const username = Session.getRememberedUsername() || (window.Common && Common.getInitialUsername());
        if (!username) {
            location.replace('login.html');
            return null;
        }
        if (!Session.isPinPassed()) {
            location.replace('pin.html');
            return null;
        }
        return username;
    }

    root.Session = Session;
    root.requireAuth = requireAuth;
})(window);
