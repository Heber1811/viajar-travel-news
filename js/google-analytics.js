import { metricsConfig } from './metrics-config.js';

const measurementId = metricsConfig.googleAnalyticsMeasurementId;
const isAllowedHost = metricsConfig.productionHosts.includes(window.location.hostname);
const isAdminPage = /(^|\/)metricas\.html$/.test(window.location.pathname);

if (measurementId && isAllowedHost && !isAdminPage) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() {
        window.dataLayer.push(arguments);
    };

    window.gtag('js', new Date());
    window.gtag('config', measurementId);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
}
