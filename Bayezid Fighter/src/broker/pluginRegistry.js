const fs = require('fs');
const path = require('path');
const { redisClient } = require('../memory_systems/memoryService');

const PLUGINS_DIR = path.join(__dirname, '../../plugins');

if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
}

const validateManifest = (manifest) => {
    const required = ['name', 'version', 'description', 'tier', 'entrypoint', 'capabilities'];
    for (const field of required) {
        if (manifest[field] === undefined) return false;
    }
    if (!Array.isArray(manifest.capabilities)) return false;
    return true;
};

const getRegisteredPlugins = async () => {
    const plugins = [];
    try {
        if (redisClient.isOpen) {
            const keys = await redisClient.keys('plugins:registry:*');
            for (const key of keys) {
                const data = await redisClient.get(key);
                if (data) plugins.push(JSON.parse(data));
            }
        }
    } catch (e) {
        console.error('[-] Failed to fetch plugins from Redis registry:', e.message);
    }
    return plugins;
};

const registerPlugin = async (manifestPath) => {
    try {
        const content = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(content);

        if (!validateManifest(manifest)) {
            console.warn(`[⚠️] BPA: Invalid manifest JSON schema at ${manifestPath}`);
            return;
        }

        const key = `plugins:registry:${manifest.name}`;
        if (redisClient.isOpen) {
            await redisClient.set(key, JSON.stringify(manifest));
        }
        console.log(`[🔌] BPA: Registered plugin [${manifest.name}] successfully.`);
        
        if (global.io) {
            global.io.emit('PLUGIN_REGISTRY_UPDATED', { plugin: manifest.name, action: 'register' });
        }
    } catch (err) {
        console.error(`[-] Failed to register plugin from ${manifestPath}:`, err.message);
    }
};

const loadAllPlugins = async () => {
    console.log(`[🔌] BPA: Commencing recursive scan of plugins folder: ${PLUGINS_DIR}...`);
    try {
        const items = fs.readdirSync(PLUGINS_DIR);
        for (const item of items) {
            const itemPath = path.join(PLUGINS_DIR, item);
            if (fs.statSync(itemPath).isDirectory()) {
                const manifestPath = path.join(itemPath, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    await registerPlugin(manifestPath);
                }
            }
        }
    } catch (e) {
        console.error('[-] Error scanning plugins folder:', e.message);
    }
};

const watchPluginsDirectory = () => {
    console.log(`[🔌] BPA: Watching plugins folder for manifest changes...`);
    fs.watch(PLUGINS_DIR, { recursive: true }, async (eventType, filename) => {
        if (filename && filename.endsWith('manifest.json')) {
            const fullPath = path.join(PLUGINS_DIR, filename);
            console.log(`[🔌] BPA: Detected file change in: ${filename}`);
            if (fs.existsSync(fullPath)) {
                await registerPlugin(fullPath);
            } else {
                
                const parts = filename.split(path.sep);
                const pluginName = parts[0];
                if (pluginName) {
                    const key = `plugins:registry:${pluginName}`;
                    if (redisClient.isOpen) {
                        await redisClient.del(key);
                    }
                    console.log(`[🔌] BPA: Unregistered plugin [${pluginName}].`);
                    if (global.io) {
                        global.io.emit('PLUGIN_REGISTRY_UPDATED', { plugin: pluginName, action: 'unregister' });
                    }
                }
            }
        }
    });
};

const initPluginRegistry = async () => {
    await loadAllPlugins();
    watchPluginsDirectory();
};

module.exports = {
    initPluginRegistry,
    getRegisteredPlugins,
    registerPlugin
};
