import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';

const deviceNames = { desktop: 'Computador', mobile: 'Celular', tablet: 'Tablet', smartTv: 'Smart TV' };

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
            <p class="source-note">Dados oficiais do Google Analytics 4 · propriedade 556011023</p>
            <div class="metrics-grid">
                <article class="metric-card"><span>Usuários ativos</span><strong id="gaUsersValue">—</strong></article>
                <article class="metric-card"><span>Sessões</span><strong id="gaSessionsValue">—</strong></article>
                <article class="metric-card"><span>Visualizações</span><strong id="gaViewsValue">—</strong></article>
                <article class="metric-card"><span>Duração média da sessão</span><strong id="gaAverageTimeValue">—</strong></article>
            </div>
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
                <article class="chart-card data-card"><h2>Usuários por cidade</h2><div class="table-wrap"><table>
                    <thead><tr><th>Cidade</th><th>Estado</th><th>País</th><th>Usuários</th></tr></thead>
                    <tbody id="gaLocationsTable"></tbody>
                </table></div></article>
            </div>
        </div>`);

    const element = document.querySelector('#googleReportContent');
    const fetchReport = httpsCallable(getFunctions(app, 'southamerica-east1'), 'relatorioGoogleAnalytics');
    let dailyChart;
    let channelsChart;
    let currentReport;

    function render(data) {
        const summary = data.summary || {};
        document.querySelector('#gaUsersValue').textContent = formatNumber(summary.activeUsers);
        document.querySelector('#gaSessionsValue').textContent = formatNumber(summary.sessions);
        document.querySelector('#gaViewsValue').textContent = formatNumber(summary.screenPageViews);
        document.querySelector('#gaAverageTimeValue').textContent = formatDuration(summary.averageSessionDuration);

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

        tableRows(document.querySelector('#gaPagesTable'), data.pages.map((item) => [
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
        downloadCsv([
            ['Google Analytics 4', 'Viajar Travel News'],
            ['Mês', data.month],
            ['Usuários ativos', data.summary.activeUsers || 0],
            ['Sessões', data.summary.sessions || 0],
            ['Visualizações', data.summary.screenPageViews || 0],
            ['Duração média da sessão (segundos)', Math.round(data.summary.averageSessionDuration || 0)],
            [],
            ['Página', 'Caminho', 'Usuários', 'Visualizações', 'Engajamento (segundos)'],
            ...data.pages.map((item) => [item.pageTitle, item.pagePath, item.activeUsers, item.screenPageViews, Math.round(item.userEngagementDuration)]),
            [],
            ['Canal', 'Usuários', 'Sessões'],
            ...data.channels.map((item) => [item.sessionDefaultChannelGroup, item.activeUsers, item.sessions]),
            [],
            ['Cidade', 'Estado', 'País', 'Usuários'],
            ...data.locations.map((item) => [item.city, item.region, item.country, item.activeUsers])
        ], data.month);
    }

    return { element, load, exportCsv };
}
