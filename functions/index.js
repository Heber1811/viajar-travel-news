'use strict';

const crypto = require('node:crypto');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const { initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore, Timestamp } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();
const db = getFirestore();
const analyticsData = new BetaAnalyticsDataClient();
const SITE_ID = 'viajar-travel-news';
const ALLOWED_ORIGINS = new Set([
    'https://viajartravelnews.com.br',
    'https://www.viajartravelnews.com.br',
    'https://viajar-travel-news.web.app',
    'https://viajar-travel-news.firebaseapp.com',
    'https://previa-viajar-travel-news.web.app',
    'https://previa-viajar-travel-news.firebaseapp.com'
]);
const REPORT_EMAILS = new Set(['heberluiz1811@gmail.com', 'hudson.m.3110@gmail.com']);
const GA_PROPERTY = 'properties/556011023';
const ID_PATTERN = /^[a-f0-9]{32}$/i;

function required(value, name, max, pattern) {
    if (typeof value !== 'string' || value.length < 1 || value.length > max || (pattern && !pattern.test(value))) {
        throw new HttpsError('invalid-argument', `Campo inválido: ${name}`);
    }
    return value;
}

function privateHash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function monthInSaoPaulo() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit'
    }).formatToParts(new Date());
    return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}

exports.registrarMetrica = onCall({
    region: 'southamerica-east1', enforceAppCheck: true, maxInstances: 3,
    timeoutSeconds: 10, memory: '256MiB'
}, async (request) => {
    if (!ALLOWED_ORIGINS.has(request.rawRequest.headers.origin)) {
        throw new HttpsError('permission-denied', 'Origem não autorizada');
    }
    const data = request.data || {};
    const siteId = required(data.siteId, 'siteId', 40);
    const type = required(data.type, 'type', 20);
    const visitorId = required(data.visitorId, 'visitorId', 32, ID_PATTERN);
    const sessionId = required(data.sessionId, 'sessionId', 32, ID_PATTERN);
    const pageId = required(data.pageId, 'pageId', 32, ID_PATTERN);
    const path = required(data.path, 'path', 180);
    if (siteId !== SITE_ID || !['page_view', 'engagement'].includes(type) || !path.startsWith('/')) {
        throw new HttpsError('invalid-argument', 'Evento inválido');
    }

    const month = monthInSaoPaulo();
    const visitorHash = privateHash(`${month}:${visitorId}`);
    const sessionHash = privateHash(`${month}:${sessionId}`);
    const pageHash = privateHash(`${month}:${pageId}`);
    const siteRef = db.collection('metricSites').doc(SITE_ID);
    const monthRef = siteRef.collection('months').doc(month);
    const sessionRef = siteRef.collection('sessions').doc(sessionHash);
    const visitorRef = monthRef.collection('visitors').doc(visitorHash);
    const pageRef = siteRef.collection('pages').doc(pageHash);
    const expiresAt = Timestamp.fromMillis(Date.now() + 62 * 86400000);

    if (type === 'page_view') {
        await db.runTransaction(async (tx) => {
            const [monthDoc, sessionDoc, visitorDoc, pageDoc] = await Promise.all([
                tx.get(monthRef), tx.get(sessionRef), tx.get(visitorRef), tx.get(pageRef)
            ]);
            if (pageDoc.exists) return;
            const current = monthDoc.exists ? monthDoc.data() : {};
            if (sessionDoc.exists && Number(sessionDoc.get('pageViews') || 0) >= 200) return;
            tx.set(monthRef, {
                siteId: SITE_ID, month,
                pageViews: (current.pageViews || 0) + 1,
                sessions: (current.sessions || 0) + (sessionDoc.exists ? 0 : 1),
                visitors: (current.visitors || 0) + (visitorDoc.exists ? 0 : 1),
                engagementSeconds: current.engagementSeconds || 0,
                updatedAt: FieldValue.serverTimestamp()
            });
            tx.set(pageRef, { month, sessionHash, path, engagementSeconds: 0, createdAt: FieldValue.serverTimestamp(), expiresAt });
            if (!sessionDoc.exists) {
                tx.set(sessionRef, { month, pageViews: 1, engagementSeconds: 0, createdAt: FieldValue.serverTimestamp(), expiresAt });
            } else {
                tx.update(sessionRef, { pageViews: FieldValue.increment(1) });
            }
            if (!visitorDoc.exists) tx.set(visitorRef, { createdAt: FieldValue.serverTimestamp(), expiresAt });
        });
        return { accepted: true };
    }

    const eventId = required(data.eventId, 'eventId', 32, ID_PATTERN);
    const seconds = Number(data.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
        throw new HttpsError('invalid-argument', 'Tempo inválido');
    }
    const eventRef = siteRef.collection('events').doc(privateHash(`${month}:${eventId}`));
    await db.runTransaction(async (tx) => {
        const [eventDoc, pageDoc, monthDoc, sessionDoc] = await Promise.all([
            tx.get(eventRef), tx.get(pageRef), tx.get(monthRef), tx.get(sessionRef)
        ]);
        if (eventDoc.exists || !pageDoc.exists || !monthDoc.exists || !sessionDoc.exists || pageDoc.get('sessionHash') !== sessionHash) return;
        if (Number(pageDoc.get('engagementSeconds') || 0) + seconds > 14400) return;
        if (Number(sessionDoc.get('engagementSeconds') || 0) + seconds > 43200) return;
        const total = Number(monthDoc.get('engagementSeconds') || 0) + seconds;
        const sessions = Number(monthDoc.get('sessions') || 0);
        tx.set(eventRef, { createdAt: FieldValue.serverTimestamp(), expiresAt });
        tx.update(pageRef, { engagementSeconds: FieldValue.increment(seconds) });
        tx.update(sessionRef, { engagementSeconds: FieldValue.increment(seconds) });
        tx.update(monthRef, {
            engagementSeconds: total,
            averageEngagementSeconds: sessions > 0 ? Math.round(total / sessions) : 0,
            updatedAt: FieldValue.serverTimestamp()
        });
    });
    return { accepted: true };
});

function reportRows(report) {
    const dimensions = (report.dimensionHeaders || []).map((header) => header.name);
    const metrics = (report.metricHeaders || []).map((header) => header.name);
    return (report.rows || []).map((row) => {
        const item = {};
        dimensions.forEach((name, index) => { item[name] = row.dimensionValues[index]?.value || ''; });
        metrics.forEach((name, index) => { item[name] = Number(row.metricValues[index]?.value || 0); });
        return item;
    });
}

function monthRange(month) {
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new HttpsError('invalid-argument', 'Mês inválido.');
    }
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return { startDate: `${month}-01`, endDate: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function reportRequest(dateRanges, dimensions, metrics, options = {}) {
    return {
        property: GA_PROPERTY,
        dateRanges: [dateRanges],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        limit: options.limit,
        orderBys: options.orderBys
    };
}

exports.relatorioGoogleAnalytics = onCall({
    region: 'southamerica-east1',
    maxInstances: 3,
    timeoutSeconds: 30,
    memory: '256MiB'
}, async (request) => {
    const email = request.auth?.token?.email;
    if (!email || !REPORT_EMAILS.has(email)) {
        throw new HttpsError('permission-denied', 'Conta não autorizada.');
    }
    if (!ALLOWED_ORIGINS.has(request.rawRequest.headers.origin)) {
        throw new HttpsError('permission-denied', 'Origem não autorizada.');
    }

    const dateRanges = monthRange(request.data?.month);
    const descending = (metricName) => [{ metric: { metricName }, desc: true }];
    try {
        const requests = [
            reportRequest(dateRanges, [], ['activeUsers', 'sessions', 'screenPageViews', 'averageSessionDuration']),
            reportRequest(dateRanges, ['date'], ['activeUsers', 'sessions', 'screenPageViews'], { orderBys: [{ dimension: { dimensionName: 'date' } }] }),
            reportRequest(dateRanges, ['pageTitle', 'pagePath'], ['activeUsers', 'screenPageViews', 'userEngagementDuration'], { limit: 50, orderBys: descending('screenPageViews') }),
            reportRequest(dateRanges, ['sessionDefaultChannelGroup'], ['activeUsers', 'sessions'], { limit: 20, orderBys: descending('sessions') }),
            reportRequest(dateRanges, ['deviceCategory'], ['activeUsers', 'sessions'], { orderBys: descending('sessions') }),
            reportRequest(dateRanges, ['city', 'region', 'country'], ['activeUsers'], { limit: 50, orderBys: descending('activeUsers') })
        ];
        const responses = await Promise.all(requests.map((query) => analyticsData.runReport(query)));
        const [summary, daily, pages, channels, devices, locations] = responses.map(([report]) => reportRows(report));
        return {
            propertyId: GA_PROPERTY.replace('properties/', ''),
            month: request.data.month,
            summary: summary[0] || {},
            daily,
            pages,
            channels,
            devices,
            locations
        };
    } catch (error) {
        console.error('Google Analytics Data API:', error);
        if (error.code === 7 || error.code === 403) {
            throw new HttpsError('permission-denied', 'A conta de serviço ainda não tem acesso à propriedade do Analytics.');
        }
        throw new HttpsError('internal', 'Não foi possível consultar o Google Analytics.');
    }
});
