const INTERNAL_COOKIE = 'vtn_internal_access';
const INTERNAL_STORAGE_KEY = 'vtn_internal_access';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function cookieValue(name) {
    return document.cookie
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(name.length + 1);
}

function cookieDomain() {
    return /(^|\.)viajartravelnews\.com\.br$/i.test(location.hostname)
        ? '; Domain=.viajartravelnews.com.br'
        : '';
}

export function isInternalTraffic() {
    if (cookieValue(INTERNAL_COOKIE) === '1') return true;
    try {
        return localStorage.getItem(INTERNAL_STORAGE_KEY) === '1';
    } catch (_) {
        return false;
    }
}

export function setInternalTraffic(enabled) {
    const value = enabled ? '1' : '';
    const maxAge = enabled ? ONE_YEAR_SECONDS : 0;
    document.cookie = `${INTERNAL_COOKIE}=${value}; Max-Age=${maxAge}; Path=/${cookieDomain()}; SameSite=Lax; Secure`;
    try {
        if (enabled) localStorage.setItem(INTERNAL_STORAGE_KEY, '1');
        else localStorage.removeItem(INTERNAL_STORAGE_KEY);
    } catch (_) {
        // O cookie continua sendo a identificação principal.
    }
    return isInternalTraffic() === enabled;
}

export function isLikelyAutomatedTraffic() {
    if (navigator.webdriver) return true;
    return /bot\b|crawler|spider|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|slackbot|telegrambot|discordbot|uptimerobot/i
        .test(navigator.userAgent || '');
}
