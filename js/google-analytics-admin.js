import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import { friendlyPageName } from './page-names.js';

const deviceNames = { desktop: 'Computador', mobile: 'Celular', tablet: 'Tablet', smartTv: 'Smart TV' };
const channelNames = {
    Direct: 'Direto',
    'Organic Search': 'Pesquisa orgânica',
    'Organic Social': 'Rede social orgânica',
    Referral: 'Referência',
    Unassigned: 'Não atribuído'
};
const DIAGNOSTIC_PAGE_SIZE = 10;

function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
}

function formatDuration(seconds) {
    const total = Math.round(Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    if (hours) return `${hours}h ${minutes}min`;
    if (minutes) return `${minutes}min ${remainder}s`;
    return `${remainder}s`;
}

function formatDecimal(value) {
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function metricLabel(label, explanation) {
    return `<span class="metric-label">${label}<button class="metric-info no-print" type="button" aria-label="Informação sobre ${label}" data-tooltip="${explanation}">i</button></span>`;
}

function tableRows(target, rows) {
    target.replaceChildren(...rows.map((values) => {
        const row = document.createElement('tr');
        values.forEach((value) => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        });
        return row;
    }));
}

function canonicalPagePath(path) {
    const url = new URL(path || '/', 'https://viajartravelnews.com.br');
    if (url.pathname === '/paginas.html' && url.searchParams.get('id')) {
        return `${url.pathname}?id=${encodeURIComponent(url.searchParams.get('id'))}`;
    }
    return url.pathname || '/';
}

function groupedPages(pages) {
    const grouped = new Map();
    pages.forEach((item) => {
        const path = canonicalPagePath(item.pagePathPlusQueryString || item.pagePath || '/');
        const isHome = path === '/' || path === '/index.html';
        const key = isHome ? '__home__' : path;
        const current = grouped.get(key) || {
            pageTitle: isHome ? 'Página inicial' : friendlyPageName(path, item.pageTitle),
            pagePath: isHome ? '/' : path,
            activeUsers: 0,
            screenPageViews: 0,
            userEngagementDuration: 0
        };
        // Sem identificadores individuais, o maior valor evita somar duas vezes
        // o mesmo usuário que abriu / e /index.html.
        current.activeUsers = Math.max(current.activeUsers, Number(item.activeUsers) || 0);
        current.screenPageViews += Number(item.screenPageViews) || 0;
        current.userEngagementDuration += Number(item.userEngagementDuration) || 0;
        grouped.set(key, current);
    });
    return [...grouped.values()].sort((a, b) => b.screenPageViews - a.screenPageViews);
}

function diagnosticStatus(item) {
    const sessions = Number(item.sessions) || 0;
    const engaged = Number(item.engagedSessions) || 0;
    const views = Number(item.screenPageViews) || 0;
    const seconds = Number(item.userEngagementDuration) || 0;
    const direct = item.sessionDefaultChannelGroup === 'Direct';
    if (engaged > 0 || seconds / Math.max(sessions, 1) >= 10 || views > sessions) return 'Provável humano';
    if (direct && engaged === 0 && seconds < 5 && views <= sessions) return 'Suspeito';
    return 'Indeterminado';
}

function diagnosticRows(items) {
    const priority = { Suspeito: 0, Indeterminado: 1, 'Provável humano': 2 };
    return items.map((item) => ({
        ...item,
        pageName: friendlyPageName(item.pagePathPlusQueryString || '/', ''),
        status: diagnosticStatus(item)
    })).sort((a, b) => priority[a.status] - priority[b.status] || Number(b.sessions) - Number(a.sessions));
}

function downloadCsv(rows, month) {
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.download = `google-analytics-viajar-travel-news-${month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

export function setupGoogleAnalyticsDashboard({ app, monthSelect, firebaseContent, reportError }) {
    firebaseContent.insertAdjacentHTML('afterend', `
        <div id="googleReportContent" class="hidden">
            <p class="source-note">Dados oficiais do Google Analytics 4 · propriedade 556011023 · confirme no GA4 o fuso America/Sao_Paulo</p>
            <div class="metrics-grid">
                <article class="metric-card">${metricLabel('Usuários ativos', 'Navegadores ou dispositivos que tiveram atividade no período. Uma pessoa pode aparecer mais de uma vez.')}<strong id="gaUsersValue">—</strong></article>
                <article class="metric-card">${metricLabel('Sessões', 'Períodos de visita ao site. Um mesmo usuário pode gerar várias sessões.')}<strong id="gaSessionsValue">—</strong></article>
                <article class="metric-card">${metricLabel('Visualizações', 'Total de páginas visualizadas, incluindo repetições feitas pelo mesmo usuário.')}<strong id="gaViewsValue">—</strong></article>
                <article class="metric-card">${metricLabel('Duração média da sessão', 'Tempo médio calculado pelo Analytics para cada período de visita.')}<strong id="gaAverageTimeValue">—</strong></article>
                <article class="metric-card">${metricLabel('Usuários novos', 'Usuários que acessaram o site pela primeira vez neste navegador ou dispositivo.')}<strong id="gaNewUsersValue">—</strong></article>
                <article class="metric-card">${metricLabel('Usuários recorrentes', 'Usuários reconhecidos pelo Analytics que já haviam acessado o site antes. Um usuário novo que retorna no período pode aparecer também neste grupo.')}<strong id="gaReturningUsersValue">—</strong></article>
                <article class="metric-card">${metricLabel('Taxa de retorno', 'Relação entre usuários recorrentes e usuários ativos no período.')}<strong id="gaReturnRateValue">—</strong></article>
                <article class="metric-card">${metricLabel('Sessões por usuário', 'Média de sessões geradas por cada usuário ativo no período.')}<strong id="gaSessionsPerUserValue">—</strong></article>
            </div>
            <p class="audience-note">No GA4, o mesmo usuário pode aparecer como novo e recorrente quando faz a primeira visita e retorna dentro do período selecionado.</p>
            <div class="charts-grid">
                <article class="chart-card"><h2>Tráfego por dia</h2><div class="chart-wrap"><canvas id="gaDailyChart"></canvas></div></article>
                <article class="chart-card"><h2>Origem do tráfego</h2><div class="chart-wrap"><canvas id="gaChannelsChart"></canvas></div></article>
            </div>
            <article class="chart-card data-card">
                <h2>Páginas mais acessadas</h2>
                <div class="table-wrap"><table>
                    <thead><tr><th>Página</th><th>Usuários</th><th>Visualizações</th><th>Tempo médio</th></tr></thead>
                    <tbody id="gaPagesTable"></tbody>
                </table></div>
            </article>
            <div class="charts-grid data-grid">
                <article class="chart-card data-card"><h2>Dispositivos</h2><div class="table-wrap"><table>
                    <thead><tr><th>Dispositivo</th><th>Usuários</th><th>Sessões</th></tr></thead>
                    <tbody id="gaDevicesTable"></tbody>
                </table></div></article>
                <article class="chart-card data-card"><h2>Usuários por localização aproximada</h2><p class="chart-note">País e estado tendem a ser mais confiáveis que cidade. Os valores podem divergir da coleta própria.</p><div class="table-wrap"><table>
                    <thead><tr><th>Cidade</th><th>Estado</th><th>País</th><th>Usuários</th></tr></thead>
                    <tbody id="gaLocationsTable"></tbody>
                </table></div></article>
            </div>
            <article class="chart-card data-card">
                <h2>Diagnóstico por localização</h2>
                <p class="chart-note">Classificação indicativa baseada em engajamento, páginas e origem. Uma cidade estrangeira, isoladamente, não caracteriza robô.</p>
                <div class="table-wrap diagnostic-table-wrap"><table class="diagnostic-table">
                    <thead><tr><th>Localização</th><th>Página</th><th>Origem</th><th>Dispositivo</th><th>Sessões</th><th>Engajadas</th><th>Tempo</th><th>Indício</th></tr></thead>
                    <tbody id="gaLocationDiagnosticsTable"></tbody>
                </table></div>
                <nav id="gaDiagnosticsPagination" class="table-pagination no-print" aria-label="Paginação do diagnóstico">
                    <span id="gaDiagnosticsCount" class="pagination-count"></span>
                    <div class="pagination-actions">
                        <button id="gaDiagnosticsPrevious" class="pagination-button" type="button">Anterior</button>
                        <span id="gaDiagnosticsPage" class="pagination-page" aria-live="polite"></span>
                        <button id="gaDiagnosticsNext" class="pagination-button" type="button">Próxima</button>
                    </div>
                </nav>
            </article>
        </div>`);

    const element = document.querySelector('#googleReportContent');
    const fetchReport = httpsCallable(getFunctions(app, 'southamerica-east1'), 'relatorioGoogleAnalytics');
    let dailyChart;
    let channelsChart;
    let currentReport;
    let diagnosticsData = [];
    let diagnosticsPage = 1;

    function renderDiagnosticsPage() {
        const totalPages = Math.max(1, Math.ceil(diagnosticsData.length / DIAGNOSTIC_PAGE_SIZE));
        diagnosticsPage = Math.min(Math.max(diagnosticsPage, 1), totalPages);
        const start = (diagnosticsPage - 1) * DIAGNOSTIC_PAGE_SIZE;
        const visibleRows = diagnosticsData.slice(start, start + DIAGNOSTIC_PAGE_SIZE);
        const table = document.querySelector('#gaLocationDiagnosticsTable');
        table.replaceChildren(...visibleRows.map((item) => {
            const row = document.createElement('tr');
            const locationName = [item.city, item.region, item.country]
                .filter((value) => value && value !== '(not set)').join(' · ') || 'Não identificada';
            const values = [
                locationName,
                item.pageName,
                channelNames[item.sessionDefaultChannelGroup] || item.sessionDefaultChannelGroup || 'Não identificada',
                deviceNames[item.deviceCategory] || item.deviceCategory || 'Não identificado',
                formatNumber(item.sessions),
                formatNumber(item.engagedSessions),
                formatDuration(item.userEngagementDuration)
            ];
            values.forEach((value, index) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                if (index === 1) {
                    cell.className = 'diagnostic-page-name';
                    cell.title = value;
                }
                row.append(cell);
            });
            const statusCell = document.createElement('td');
            const status = document.createElement('span');
            status.className = `diagnostic-status diagnostic-status--${item.status.toLocaleLowerCase('pt-BR').replaceAll(' ', '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`;
            status.textContent = item.status;
            statusCell.append(status);
            row.append(statusCell);
            return row;
        }));

        document.querySelector('#gaDiagnosticsCount').textContent = diagnosticsData.length
            ? `${formatNumber(start + 1)}–${formatNumber(Math.min(start + DIAGNOSTIC_PAGE_SIZE, diagnosticsData.length))} de ${formatNumber(diagnosticsData.length)} registros`
            : 'Nenhum registro no período';
        document.querySelector('#gaDiagnosticsPage').textContent = `Página ${diagnosticsPage} de ${totalPages}`;
        document.querySelector('#gaDiagnosticsPrevious').disabled = diagnosticsPage === 1;
        document.querySelector('#gaDiagnosticsNext').disabled = diagnosticsPage === totalPages;
    }

    document.querySelector('#gaDiagnosticsPrevious').addEventListener('click', () => {
        diagnosticsPage -= 1;
        renderDiagnosticsPage();
    });
    document.querySelector('#gaDiagnosticsNext').addEventListener('click', () => {
        diagnosticsPage += 1;
        renderDiagnosticsPage();
    });

    function render(data) {
        const summary = data.summary || {};
        const pages = groupedPages(data.pages || []);
        const audience = data.audience || [];
        const newUsers = Number(audience.find((item) => item.newVsReturning === 'new')?.activeUsers) || 0;
        const returningUsers = Number(audience.find((item) => item.newVsReturning === 'returning')?.activeUsers) || 0;
        const returnRate = Number(summary.activeUsers) ? returningUsers / Number(summary.activeUsers) * 100 : 0;
        const sessionsPerUser = Number(summary.activeUsers) ? Number(summary.sessions) / Number(summary.activeUsers) : 0;
        document.querySelector('#gaUsersValue').textContent = formatNumber(summary.activeUsers);
        document.querySelector('#gaSessionsValue').textContent = formatNumber(summary.sessions);
        document.querySelector('#gaViewsValue').textContent = formatNumber(summary.screenPageViews);
        document.querySelector('#gaAverageTimeValue').textContent = formatDuration(summary.averageSessionDuration);
        document.querySelector('#gaNewUsersValue').textContent = formatNumber(newUsers);
        document.querySelector('#gaReturningUsersValue').textContent = formatNumber(returningUsers);
        document.querySelector('#gaReturnRateValue').textContent = `${formatDecimal(returnRate)}%`;
        document.querySelector('#gaSessionsPerUserValue').textContent = formatDecimal(sessionsPerUser);

        dailyChart?.destroy();
        dailyChart = new window.Chart(document.querySelector('#gaDailyChart'), {
            type: 'line',
            data: {
                labels: data.daily.map((item) => `${item.date.slice(6, 8)}/${item.date.slice(4, 6)}`),
                datasets: [{ label: 'Sessões', data: data.daily.map((item) => item.sessions), borderColor: '#fd7d01', backgroundColor: 'rgba(253,125,1,.14)', fill: true, tension: .3 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        });

        channelsChart?.destroy();
        channelsChart = new window.Chart(document.querySelector('#gaChannelsChart'), {
            type: 'bar',
            data: {
                labels: data.channels.map((item) => item.sessionDefaultChannelGroup || 'Não identificado'),
                datasets: [{ label: 'Sessões', data: data.channels.map((item) => item.sessions), backgroundColor: '#9ed13b' }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
        });

        tableRows(document.querySelector('#gaPagesTable'), pages.map((item) => [
            item.pageTitle && item.pageTitle !== '(not set)' ? item.pageTitle : item.pagePath,
            formatNumber(item.activeUsers),
            formatNumber(item.screenPageViews),
            formatDuration(item.screenPageViews ? item.userEngagementDuration / item.screenPageViews : 0)
        ]));
        tableRows(document.querySelector('#gaDevicesTable'), data.devices.map((item) => [
            deviceNames[item.deviceCategory] || item.deviceCategory || 'Não identificado',
            formatNumber(item.activeUsers),
            formatNumber(item.sessions)
        ]));
        tableRows(document.querySelector('#gaLocationsTable'), data.locations.map((item) => [
            item.city || 'Não identificada', item.region || '—', item.country || '—', formatNumber(item.activeUsers)
        ]));
        diagnosticsData = diagnosticRows(data.locationDiagnostics || []);
        diagnosticsPage = 1;
        renderDiagnosticsPage();
    }

    async function load() {
        element.classList.add('loading');
        reportError.textContent = '';
        try {
            const result = await fetchReport({ month: monthSelect.value });
            currentReport = result.data;
            render(currentReport);
        } catch (error) {
            if (error.code === 'functions/permission-denied') {
                reportError.textContent = error.message || 'A conta técnica ainda não tem acesso ao Google Analytics.';
            } else {
                reportError.textContent = 'Não foi possível carregar o Google Analytics. Tente novamente.';
            }
        } finally {
            element.classList.remove('loading');
        }
    }

    function exportCsv() {
        if (!currentReport) return;
        const data = currentReport;
        const pages = groupedPages(data.pages || []);
        const diagnostics = diagnosticRows(data.locationDiagnostics || []);
        const audience = data.audience || [];
        const newUsers = Number(audience.find((item) => item.newVsReturning === 'new')?.activeUsers) || 0;
        const returningUsers = Number(audience.find((item) => item.newVsReturning === 'returning')?.activeUsers) || 0;
        downloadCsv([
            ['Google Analytics 4', 'Viajar Travel News'],
            ['Mês', data.month],
            ['Usuários ativos', data.summary.activeUsers || 0],
            ['Sessões', data.summary.sessions || 0],
            ['Visualizações', data.summary.screenPageViews || 0],
            ['Duração média da sessão (segundos)', Math.round(data.summary.averageSessionDuration || 0)],
            ['Usuários novos', newUsers],
            ['Usuários recorrentes', returningUsers],
            ['Taxa de retorno (%)', data.summary.activeUsers ? (returningUsers / data.summary.activeUsers * 100).toFixed(1) : 0],
            ['Sessões por usuário', data.summary.activeUsers ? (data.summary.sessions / data.summary.activeUsers).toFixed(1) : 0],
            [],
            ['Página', 'Caminho', 'Usuários', 'Visualizações', 'Engajamento (segundos)'],
            ...pages.map((item) => [item.pageTitle, item.pagePath, item.activeUsers, item.screenPageViews, Math.round(item.userEngagementDuration)]),
            [],
            ['Canal', 'Usuários', 'Sessões'],
            ...data.channels.map((item) => [item.sessionDefaultChannelGroup, item.activeUsers, item.sessions]),
            [],
            ['Cidade aproximada', 'Estado aproximado', 'País aproximado', 'Usuários'],
            ...data.locations.map((item) => [item.city, item.region, item.country, item.activeUsers]),
            [],
            ['Diagnóstico', 'Cidade', 'Estado', 'País', 'Página', 'Origem', 'Dispositivo', 'Sessões', 'Sessões engajadas', 'Engajamento (segundos)'],
            ...diagnostics.map((item) => [
                item.status, item.city, item.region, item.country, item.pageName,
                item.sessionDefaultChannelGroup, item.deviceCategory, item.sessions,
                item.engagedSessions, Math.round(item.userEngagementDuration || 0)
            ])
        ], data.month);
    }

    return { element, load, exportCsv };
}
