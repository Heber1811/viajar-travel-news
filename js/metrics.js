import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { doc, getFirestore, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { metricsConfig } from './metrics-config.js';
import { friendlyPageName } from './page-names.js';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const SESSION_KEY = 'vtn_metrics_session';
const LOCATION_KEY = 'vtn_metrics_location';
const LOCATION_MONTHS_KEY = 'vtn_metrics_location_months';
const LOCATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function randomId() {
    return crypto.randomUUID().replaceAll('-', '');
}

function monthInSaoPaulo() {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year').value;
    const month = parts.find((part) => part.type === 'month').value;
    return `${year}-${month}`;
}

function currentSession() {
    const now = Date.now();
    let session;
    try {
        session = JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (_) {
        session = null;
    }

    if (!session || !/^[a-f0-9]{32}$/i.test(session.id) || now - Number(session.lastActivity) > SESSION_TIMEOUT_MS) {
        session = { id: randomId(), lastActivity: now };
    } else {
        session.lastActivity = now;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
}

async function approximateLocation() {
    try {
        const cached = JSON.parse(localStorage.getItem(LOCATION_KEY));
        if (cached && Number(cached.expiresAt) > Date.now()) return cached.location || null;
    } catch (_) {
        // Consulta novamente quando o cache local estiver inválido.
    }

    let location = null;
    try {
        const response = await fetch('https://ipwho.is/', {
            signal: AbortSignal.timeout(3000),
            referrerPolicy: 'no-referrer'
        });
        const data = await response.json();
        if (response.ok && data.success && data.city && data.region && data.country) {
            location = {
                city: String(data.city).slice(0, 80),
                state: String(data.region).slice(0, 80),
                country: String(data.country).slice(0, 80)
            };
        }
    } catch (_) {
        // Localização é opcional e nunca pode impedir a coleta principal.
    }

    localStorage.setItem(LOCATION_KEY, JSON.stringify({
        location,
        expiresAt: Date.now() + (location ? LOCATION_TTL_MS : 24 * 60 * 60 * 1000)
    }));
    return location;
}

function locationAlreadyRecorded(month) {
    try {
        return JSON.parse(localStorage.getItem(LOCATION_MONTHS_KEY) || '[]').includes(month);
    } catch (_) {
        return false;
    }
}

function rememberLocationMonth(month) {
    try {
        const months = JSON.parse(localStorage.getItem(LOCATION_MONTHS_KEY) || '[]');
        localStorage.setItem(LOCATION_MONTHS_KEY, JSON.stringify([...new Set([...months, month])].slice(-24)));
    } catch (_) {
        // O bloqueio do armazenamento local não impede a coleta.
    }
}

function authenticatedUser(auth) {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);

    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                unsubscribe();
                resolve(user);
                return;
            }
            try {
                const credential = await signInAnonymously(auth);
                unsubscribe();
                resolve(credential.user);
            } catch (error) {
                unsubscribe();
                reject(error);
            }
        });
    });
}

async function start() {
    if (!metricsConfig.enabled || !metricsConfig.productionHosts.includes(location.hostname) || !crypto.randomUUID) return;

    if (document.readyState === 'loading') {
        await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    const app = initializeApp(metricsConfig.firebase);
    const user = await authenticatedUser(getAuth(app));
    const database = getFirestore(app);
    const session = currentSession();
    const month = monthInSaoPaulo();
    const pageId = randomId();
    const path = `${location.pathname || '/'}${location.search}`.slice(0, 240);
    const pageHeading = document.querySelector('#card-title')?.textContent?.trim()
        || document.querySelector('main h1, article h1, .hero-content h1')?.textContent?.trim();
    const title = friendlyPageName(path, pageHeading || document.title).slice(0, 160);
    const basePath = `metricSites/${metricsConfig.siteId}/months/${month}`;
    const locationPromise = locationAlreadyRecorded(month) ? null : approximateLocation();

    await setDoc(doc(database, `${basePath}/pageViews/${pageId}`), {
        uid: user.uid,
        sessionId: session.id,
        pageId,
        path,
        title,
        createdAt: serverTimestamp()
    });

    if (locationPromise) {
        locationPromise.then(async (location) => {
            if (location) {
                await setDoc(doc(database, `${basePath}/locations/${user.uid}`), {
                    uid: user.uid,
                    city: location.city,
                    state: location.state,
                    country: location.country,
                    createdAt: serverTimestamp()
                });
            }
            rememberLocationMonth(month);
        }).catch(() => {});
    }

    let pendingSeconds = 0;
    let visibleSince = document.visibilityState === 'visible' ? performance.now() : null;
    let sending = false;

    function collectVisibleTime() {
        if (visibleSince === null) return;
        const elapsed = Math.floor((performance.now() - visibleSince) / 1000);
        if (elapsed > 0) pendingSeconds += elapsed;
        visibleSince = performance.now();
    }

    async function flushEngagement() {
        collectVisibleTime();
        if (sending || pendingSeconds < 1) return;
        sending = true;
        const seconds = Math.min(pendingSeconds, 120);
        const eventId = randomId();
        try {
            await setDoc(doc(database, `${basePath}/engagement/${eventId}`), {
                uid: user.uid,
                sessionId: session.id,
                pageId,
                seconds,
                createdAt: serverTimestamp()
            });
            pendingSeconds -= seconds;
        } catch (_) {
            // Tenta enviar novamente no próximo intervalo.
        } finally {
            sending = false;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushEngagement();
            visibleSince = null;
        } else {
            visibleSince = performance.now();
            session.lastActivity = Date.now();
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        }
    });
    window.setInterval(flushEngagement, HEARTBEAT_MS);
    window.addEventListener('pagehide', flushEngagement);
}

start().catch(() => {
    // A telemetria nunca pode impedir o funcionamento normal do site.
});
