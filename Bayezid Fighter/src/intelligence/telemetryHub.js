const { redisClient } = require('../memory_systems/memoryService');

const emitTelemetry = async (category, payload) => {
    const timestamp = new Date().toISOString();
    const safeDetails = payload.details ? JSON.stringify(payload.details) : '{}';
    const data = {
        category,
        timestamp,
        details: safeDetails
    };

    if (category === 'TACTICAL') {
        data.event = payload.event || '';
        data.node = payload.node || 'unknown';
    } else if (category === 'ADVERSARIAL') {
        data.action = payload.action || '';
        data.agent = payload.agent || 'unknown';
        data.success = payload.success ? 'true' : 'false';
    } else if (category === 'STRATEGIC') {
        data.trigger = payload.trigger || '';
        data.modifier = payload.modifier || '';
    } else if (category === 'NATIVE') {
        data.topic = payload.topic || 'UNKNOWN';
        data.source_ip = payload.source_ip || '';
        data.pid = String(payload.pid || 0);
        data.process = payload.process || '';
        data.action = payload.action || '';
        data.reason = payload.reason || '';
        data.sensor = payload.sensor || '';
        data.os = payload.os || '';
    }

    try {
        if (redisClient.isOpen) {
            await redisClient.xAdd('bayezid:telemetry', '*', data, {
                TRIM: {
                    strategy: 'MAXLEN',
                    strategyModifier: '~',
                    threshold: 100000
                }
            });
        }
    } catch (e) {
        if (e.code !== 'ECONNREFUSED') {
            console.error('[-] Redis Telemetry Stream XADD Error:', e.message);
        }
    }
};

const clearDB = async () => {
    try {
        if (redisClient.isOpen) {
            await redisClient.del('bayezid:telemetry');
        }
    } catch (e) {}
};

const flushAndClose = async () => {
    return Promise.resolve();
};

module.exports = {
    emitTelemetry,
    clearDB,
    flushAndClose
};

