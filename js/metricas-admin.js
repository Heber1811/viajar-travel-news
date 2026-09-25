import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
    browserSessionPersistence,
    getAuth,
    onAuthStateChanged,
    setPersistence,
    signInWithEmailAndPassword,
    signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
    collection,
    getDocs,
    getFirestore
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { setupGoogleAnalyticsDashboard } from './google-analytics-admin.js';
import { metricsConfig } from './metrics-config.js';
import { friendlyPageName } from './page-names.js';

const app = initializeApp(metricsConfig.firebase);
const auth = getAuth(app);
const persistenceReady = setPersistence(auth, browserSessionPersistence);
const database = getFirestore(app);
const loginPanel = document.querySelector('#loginPanel');
const dashboard = document.querySelector('#dashboard');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const reportError = document.querySelector('#reportError');
const monthSelect = document.querySelector('#monthSelect');
const sourceSelect = document.querySelector('#sourceSelect');
const reportContent = document.querySelector('#firebaseReportContent');
const googleDashboard = setupGoogleAnalyticsDashboard({ app, monthSelect, firebaseContent: reportContent, reportError });
let dailyChart;
let pagesChart;
let pageTimeChart;
let locationChart;
let currentReport;
let inactivityTimer;
let inactivityLogout = false;
const INACTIVITY_LIMIT = 30 * 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'];

function stopInactivityTimer() {
    window.clearTimeout(inactivityTimer);
    inactivityTimer = undefined;
}

function resetInactivityTimer() {
    if (!auth.currentUser) return;
    stopInactivityTimer();
    inactivityTimer = window.setTimeout(async () => {
        inactivityLogout = true;
        await signOut(auth);
    }, INACTIVITY_LIMIT);
}

ACTIVITY_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

function monthKey(date) {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit'
    }).formatToParts(date);
    return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`;
}

function fillMonths() {
    const now = new Date();
    for (let offset = 0; offset < 24; offset += 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const key = monthKey(date);
        const option = document.createElement('option');
        option.value = key;
        option.textContent = new Intl.DateTimeFormat('pt-BR', {
            month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo'
        }).format(date);
        monthSelect.append(option);
    }
}

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value || 0);
}

function formatDuration(seconds) {
    const total = Math.round(seconds || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    if (hours) return `${hours}h ${minutes}min`;
    if (minutes) return `${minutes}min ${remainder}s`;
    return `${remainder}s`;
}

function chartReady() {
    if (window.Chart) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const timer = window.setInterval(() => {
            attempts += 1;
            if (window.Chart) {
                window.clearInterval(timer);
                resolve();
            } else if (attempts > 50) {
                window.clearInterval(timer);
                reject(new Error('Não foi possível carregar os gráficos.'));
            }
        }, 100);
    });
}

function dayInSaoPaulo(timestamp) {
    if (!timestamp?.toDate) return null;
    return Number(new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', timeZone: 'America/Sao_Paulo'
    }).format(timestamp.toDate()));
}

function renderCharts(month, pageViews) {
    const [year, monthNumber] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const daily = Array(daysInMonth).fill(0);
    const pages = new Map();

    pageViews.forEach((view) => {
        const day = dayInSaoPaulo(view.createdAt);
        if (day && day <= daysInMonth) daily[day - 1] += 1;
        const pageName = friendlyPageName(view.path, view.title);
        pages.set(pageName, (pages.get(pageName) || 0) + 1);
    });

    const topPages = [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    dailyChart?.destroy();
    pagesChart?.destroy();
    dailyChart = new window.Chart(document.querySelector('#dailyChart'), {
        type: 'line',
        data: {
            labels: daily.map((_, index) => String(index + 1).padStart(2, '0')),
            datasets: [{ label: 'Visualizações', data: daily, borderColor: '#fd7d01', backgroundColor: 'rgba(253,125,1,.14)', fill: true, tension: .3 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
    pagesChart = new window.Chart(document.querySelector('#pagesChart'), {
        type: 'bar',
        data: {
            labels: topPages.map(([path]) => path),
            datasets: [{ label: 'Visualizações', data: topPages.map(([, count]) => count), backgroundColor: '#9ed13b' }]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
    return topPages;
}

function pageLabel(view) {
    return friendlyPageName(view.path, view.title);
}

function renderPageTime(pageViews, engagement) {
    const pagesById = new Map(pageViews.map((view) => [view.pageId, pageLabel(view)]));
    const totals = new Map();
    const viewsByPage = new Map();

    pageViews.forEach((view) => {
        const label = pageLabel(view);
        viewsByPage.set(label, (viewsByPage.get(label) || 0) + 1);
    });
    engagement.forEach((event) => {
        const label = pagesById.get(event.pageId);
        if (!label) return;
        totals.set(label, (totals.get(label) || 0) + Number(event.seconds || 0));
    });

    const stats = [...new Set([...viewsByPage.keys(), ...totals.keys()])].map((label) => {
        const views = viewsByPage.get(label) || 0;
        const seconds = totals.get(label) || 0;
        return { label, views, seconds, average: views ? seconds / views : 0 };
    }).sort((a, b) => b.seconds - a.seconds);

    const top = stats.slice(0, 10);
    pageTimeChart?.destroy();
    pageTimeChart = new window.Chart(document.querySelector('#pageTimeChart'), {
        type: 'bar',
        data: {
            labels: top.map((item) => item.label),
            datasets: [{ label: 'Tempo médio (segundos)', data: top.map((item) => Math.round(item.average)), backgroundColor: '#f79009' }]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });

    const table = document.querySelector('#pageTimeTable');
    table.replaceChildren(...stats.map((item) => {
        const row = document.createElement('tr');
        [item.label, formatNumber(item.views), formatDuration(item.seconds), formatDuration(item.average)].forEach((value) => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        });
        return row;
    }));
    return stats;
}

function renderLocations(pageViews, savedLocations) {
    const visitors = new Map();
    pageViews.forEach((view) => {
        if (view.uid && view.location?.city && view.location?.state && view.location?.country) {
            visitors.set(view.uid, view.location);
        }
    });
    savedLocations.forEach((location) => {
        if (location.uid && location.city && location.state && location.country) {
            visitors.set(location.uid, location);
        }
    });
    const grouped = new Map();
    visitors.forEach((location) => {
        const key = `${location.city}|${location.state}|${location.country}`;
        const current = grouped.get(key) || { ...location, visitors: 0 };
        current.visitors += 1;
        grouped.set(key, current);
    });
    const stats = [...grouped.values()].sort((a, b) => b.visitors - a.visitors || a.city.localeCompare(b.city, 'pt-BR'));
    const top = stats.slice(0, 10);

    locationChart?.destroy();
    locationChart = new window.Chart(document.querySelector('#locationChart'), {
        type: 'bar',
        data: {
            labels: top.map((item) => `${item.city} · ${item.state}`),
            datasets: [{ label: 'Visitantes', data: top.map((item) => item.visitors), backgroundColor: '#9ed13b' }]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    const table = document.querySelector('#locationTable');
    table.replaceChildren(...stats.map((item) => {
        const row = document.createElement('tr');
        [item.city, item.state, item.country, formatNumber(item.visitors)].forEach((value) => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        });
        return row;
    }));
    return stats;
}

async function loadReport() {
    const month = monthSelect.value;
    const root = `metricSites/${metricsConfig.siteId}/months/${month}`;
    reportContent.classList.add('loading');
    reportError.textContent = '';

    try {
        const pageViews = collection(database, `${root}/pageViews`);
        const engagement = collection(database, `${root}/engagement`);
        const locations = collection(database, `${root}/locations`);
        const [pageViewDocs, engagementDocs, locationDocs] = await Promise.all([
            getDocs(pageViews),
            getDocs(engagement),
            getDocs(locations)
        ]);
        const views = pageViewDocs.docs.map((item) => item.data());
        const knownPageIds = new Set(views.map((item) => item.pageId));
        const engagementEvents = engagementDocs.docs
            .map((item) => item.data())
            .filter((item) => knownPageIds.has(item.pageId));
        const data = {
            month,
            visitors: new Set(views.map((item) => item.uid).filter(Boolean)).size,
            sessions: new Set(views.map((item) => `${item.uid}:${item.sessionId}`).filter((value) => !value.includes('undefined'))).size,
            pageViews: views.length,
            views,
            engagement: engagementEvents,
            savedLocations: locationDocs.docs.map((item) => item.data())
        };
        data.seconds = data.engagement.reduce((total, item) => total + Number(item.seconds || 0), 0);
        data.averageSeconds = data.sessions ? data.seconds / data.sessions : 0;
        document.querySelector('#visitorsValue').textContent = formatNumber(data.visitors);
        document.querySelector('#sessionsValue').textContent = formatNumber(data.sessions);
        document.querySelector('#pageViewsValue').textContent = formatNumber(data.pageViews);
        document.querySelector('#averageTimeValue').textContent = formatDuration(data.averageSeconds);
        document.querySelector('#reportSubtitle').textContent = `Viajar Travel News · ${monthSelect.options[monthSelect.selectedIndex].textContent}`;
        await chartReady();
        data.topPages = renderCharts(month, data.views);
        data.pageTimes = renderPageTime(data.views, data.engagement);
        data.locations = renderLocations(data.views, data.savedLocations);
        currentReport = data;
    } catch (error) {
        reportError.textContent = error.code === 'permission-denied'
            ? 'Esta conta não tem permissão para ler os relatórios.'
            : 'Não foi possível carregar o relatório. Tente novamente.';
    } finally {
        reportContent.classList.remove('loading');
    }
}

function exportCsv() {
    if (!currentReport) return;
    const rows = [
        ['Relatório', 'Viajar Travel News'],
        ['Mês', currentReport.month],
        ['Visitantes únicos', currentReport.visitors],
        ['Sessões', currentReport.sessions],
        ['Páginas visualizadas', currentReport.pageViews],
        ['Tempo total (segundos)', currentReport.seconds],
        ['Tempo médio por sessão (segundos)', Math.round(currentReport.averageSeconds)],
        [],
        ['Página', 'Visualizações', 'Tempo total (segundos)', 'Tempo médio (segundos)'],
        ...currentReport.pageTimes.map((item) => [item.label, item.views, item.seconds, Math.round(item.average)]),
        [],
        ['Cidade', 'Estado', 'País', 'Visitantes'],
        ...currentReport.locations.map((item) => [item.city, item.state, item.country, item.visitors])
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.download = `metricas-viajar-travel-news-${currentReport.month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    try {
async function loadSelectedReport() {
    const googleSelected = sourceSelect.value === 'google';
    reportContent.classList.toggle('hidden', googleSelected);
    googleDashboard.element.classList.toggle('hidden', !googleSelected);
    document.querySelector('#reportSubtitle').textContent = `Viajar Travel News · ${monthSelect.options[monthSelect.selectedIndex].textContent}`;
    return googleSelected ? googleDashboard.load() : loadReport();
}

        await persistenceReady;
        await signInWithEmailAndPassword(auth, loginForm.email.value.trim(), loginForm.password.value);
    } catch (_) {
        loginError.textContent = 'E-mail ou senha inválidos.';
    }
});

document.querySelector('#logoutButton').addEventListener('click', () => signOut(auth));
document.querySelector('#refreshButton').addEventListener('click', loadSelectedReport);
document.querySelector('#csvButton').addEventListener('click', () => sourceSelect.value === 'google' ? googleDashboard.exportCsv() : exportCsv());
document.querySelector('#pdfButton').addEventListener('click', () => window.print());
monthSelect.addEventListener('change', loadSelectedReport);
sourceSelect.addEventListener('change', loadSelectedReport);

fillMonths();
onAuthStateChanged(auth, async (user) => {
    const authorized = user && metricsConfig.reportEmails.includes(user.email);
    loginPanel.classList.toggle('hidden', Boolean(authorized));
    dashboard.classList.toggle('hidden', !authorized);
    if (authorized) {
        inactivityLogout = false;
        resetInactivityTimer();
        await loadSelectedReport();
    } else if (user) {
        stopInactivityTimer();
        await signOut(auth);
        loginError.textContent = 'Esta conta não está autorizada para acessar os relatórios.';
    } else {
        stopInactivityTimer();
        if (inactivityLogout) {
            loginError.textContent = 'Sua sessão expirou após 30 minutos sem atividade. Entre novamente.';
            inactivityLogout = false;
        }
    }
});
