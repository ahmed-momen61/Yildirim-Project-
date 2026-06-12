const prisma = require('../api/prismaClient');

let cachedAutonomyMode = null;

const getAutonomyMode = async () => {
    if (cachedAutonomyMode !== null) {
        return cachedAutonomyMode;
    }
    try {
        const config = await prisma.systemConfig.findUnique({ where: { id: 'BAYEZID_CORE_CONFIG' } });
        if (config) {
            cachedAutonomyMode = config.autonomyMode;
        }
    } catch (e) {
        console.error('[-] ConfigCache Error:', e.message);
    }
    return cachedAutonomyMode || 'SNIPER';
};

const setCachedAutonomyMode = (mode) => {
    cachedAutonomyMode = mode;
    console.log(`[🧠] ConfigCache: Autonomy Mode cache updated to: ${mode}`);
};

const invalidateCache = () => {
    cachedAutonomyMode = null;
    console.log(`[🧠] ConfigCache: Cache invalidated.`);
};

module.exports = {
    getAutonomyMode,
    setCachedAutonomyMode,
    invalidateCache
};
