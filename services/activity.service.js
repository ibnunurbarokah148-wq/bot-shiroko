const MAX_ACTIVITY_EVENTS = 100;
const SERIES_BUCKETS = 12;
const SERIES_BUCKET_MS = 5 * 60 * 1000;

const activityBuffer = [];

function normalizePlatform(platform) {
    const value = String(platform || 'system').toLowerCase();
    if (value.includes('whatsapp') || value === 'wa') return 'whatsapp';
    if (value.includes('discord')) return 'discord';
    if (value.includes('minecraft') || value === 'mc') return 'minecraft';
    return 'system';
}

function recordActivity({ platform, type = 'activity', message, metadata = {} } = {}) {
    const timestamp = Date.now();
    const activity = {
        id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        platform: normalizePlatform(platform),
        type,
        message: String(message || 'Aktivitas baru'),
        time: new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        timestamp,
        ...metadata
    };

    activityBuffer.push(activity);
    if (activityBuffer.length > MAX_ACTIVITY_EVENTS) activityBuffer.splice(0, activityBuffer.length - MAX_ACTIVITY_EVENTS);

    if (global.io) {
        global.io.emit('activity', activity);
        global.io.emit('service_status', {
            source: activity.platform,
            activity,
            generatedAt: new Date(timestamp).toISOString()
        });
    }
    return activity;
}

function getRecentActivity(limit = 6) {
    return activityBuffer.slice(-Math.max(0, Number(limit) || 0)).reverse();
}

function getActivitySeries(now = Date.now()) {
    const start = now - (SERIES_BUCKETS - 1) * SERIES_BUCKET_MS;
    const series = {
        labels: [],
        whatsapp: Array(SERIES_BUCKETS).fill(0),
        discord: Array(SERIES_BUCKETS).fill(0),
        minecraft: Array(SERIES_BUCKETS).fill(0)
    };

    for (let index = 0; index < SERIES_BUCKETS; index += 1) {
        series.labels.push(new Date(start + index * SERIES_BUCKET_MS).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit'
        }));
    }

    for (const activity of activityBuffer) {
        const index = Math.floor((activity.timestamp - start) / SERIES_BUCKET_MS);
        if (index < 0 || index >= SERIES_BUCKETS || !series[activity.platform]) continue;
        series[activity.platform][index] += 1;
    }
    return series;
}

module.exports = {
    recordActivity,
    getRecentActivity,
    getActivitySeries
};
