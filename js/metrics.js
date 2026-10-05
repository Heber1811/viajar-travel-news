import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { doc, getFirestore, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { metricsConfig } from './metrics-config.js';
import { friendlyPageName } from './page-names.js';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_TIMEOUT_MS = 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const SESSION_KEY = 'vtn_metrics_session';
const LOCATION_KEY = 'vtn_metrics_location';
const LOCATION_TTL_MS = 24 * 60 * 60 * 1000;
const LOCATION_RETRY_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'];

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
            signal: AbortSignal.timeout(8000),
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
        expiresAt: Date.now() + (location ? LOCATION_TTL_MS : LOCATION_RETRY_MS)
    }));
    return location;
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
    let session = currentSession();
    const month = monthInSaoPaulo();
    let pageId = randomId();
    const path = `${location.pathname || '/'}${location.search}`.slice(0, 240);
    const pageHeading = document.querySelector('#card-title')?.textContent?.trim()
        || document.querySelector('main h1, article h1, .hero-content h1')?.textContent?.trim();
    const title = friendlyPageName(path, pageHeading || document.title).slice(0, 160);
    const basePath = `metricSites/${metricsConfig.siteId}/months/${month}`;
    async function recordPageView() {
        const visit = { sessionId: session.id, pageId };
        await setDoc(doc(database, `${basePath}/pageViews/${visit.pageId}`), {
            uid: user.uid,
            sessionId: visit.sessionId,
            pageId: visit.pageId,
            path,
            title,
            createdAt: serverTimestamp()
        });

        approximateLocation().then(async (location) => {
            if (!location) return;
            await setDoc(doc(database, `${basePath}/locations/${user.uid}_${visit.sessionId}`), {
                uid: user.uid,
                sessionId: visit.sessionId,
                city: location.city,
                state: location.state,
                country: location.country,
                createdAt: serverTimestamp()
            });
        }).catch(() => {});
    }

    await recordPageView();

    let pendingSeconds = 0;
    let visibleSince = document.visibilityState === 'visible' ? performance.now() : null;
    let sending;
    let idleTimer;
    let lastActivity = Date.now();
    let restartingSession = false;

    function collectVisibleTime() {
        if (visibleSince === null) return;
        const elapsed = Math.floor((performance.now() - visibleSince) / 1000);
        if (elapsed > 0) pendingSeconds += elapsed;
        visibleSince = performance.now();
    }

    async function flushEngagement() {
        collectVisibleTime();
        if (sending) await sending;
        if (pendingSeconds < 1) return;
        const seconds = Math.min(pendingSeconds, 120);
        const eventId = randomId();
        const eventSessionId = session.id;
        const eventPageId = pageId;
        pendingSeconds -= seconds;
        sending = setDoc(doc(database, `${basePath}/engagement/${eventId}`), {
            uid: user.uid,
            sessionId: eventSessionId,
            pageId: eventPageId,
            seconds,
            createdAt: serverTimestamp()
        }).catch(() => {
            // Tenta enviar novamente no próximo intervalo.
            pendingSeconds += seconds;
        }).finally(() => {
            sending = undefined;
        });
        await sending;
    }

    function stopActiveTime() {
        collectVisibleTime();
        visibleSince = null;
        window.clearTimeout(idleTimer);
    }

    function scheduleIdleTimeout() {
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
            stopActiveTime();
            flushEngagement();
        }, IDLE_TIMEOUT_MS);
    }

    async function registerActivity() {
        const now = Date.now();
        const sessionExpired = now - lastActivity > SESSION_TIMEOUT_MS;
        lastActivity = now;
        if (sessionExpired && !restartingSession) {
            restartingSession = true;
            await flushEngagement();
            session = { id: randomId(), lastActivity: now };
            pageId = randomId();
            pendingSeconds = 0;
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
            try {
                await recordPageView();
            } finally {
                restartingSession = false;
            }
        } else {
            session.lastActivity = now;
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        }
        if (document.visibilityState === 'visible' && visibleSince === null) visibleSince = performance.now();
        scheduleIdleTimeout();
    }

    ACTIVITY_EVENTS.forEach((eventName) => {
        window.addEventListener(eventName, () => { registerActivity().catch(() => {}); }, { passive: true });
    });
    if (visibleSince !== null) scheduleIdleTimeout();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            stopActiveTime();
            flushEngagement();
        } else {
            registerActivity().catch(() => {});
        }
    });
    window.setInterval(flushEngagement, HEARTBEAT_MS);
    window.addEventListener('pagehide', flushEngagement);
}

start().catch(() => {
    // A telemetria nunca pode impedir o funcionamento normal do site.
});
