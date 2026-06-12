const { getRegisteredPlugins } = require('./pluginRegistry');
const net = require('net');
const os = require('os');

const injectPluginsContext = async (systemPrompt) => {
    try {
        const plugins = await getRegisteredPlugins();
        if (!plugins || plugins.length === 0) return systemPrompt;

        let toolPrompt = '\n\n===================================================\n';
        toolPrompt += 'AVAILABLE ENTERPRISE BPA PLUGINS (COGNITIVE CAPABILITIES):\n';
        toolPrompt += '===================================================\n';
        
        for (const plugin of plugins) {
            toolPrompt += `- PLUGIN: ${plugin.name} (Tier: ${plugin.tier}, Version: ${plugin.version})\n`;
            toolPrompt += `  Description: ${plugin.description}\n`;
            toolPrompt += `  Entrypoint: ${plugin.entrypoint}\n`;
            for (const cap of plugin.capabilities) {
                toolPrompt += `  * Capability: ${cap.id}\n`;
                toolPrompt += `    Description: ${cap.description}\n`;
                toolPrompt += `    Args Schema: ${JSON.stringify(cap.args_schema)}\n`;
            }
        }
        toolPrompt += '\nTo invoke any plugin capability, reply with a tool call in JSON format: {"tool_call": "plugin_invoke", "plugin": "<plugin-name>", "capability": "<capability-id>", "args": { ... } }\n';
        
        return systemPrompt + toolPrompt;
    } catch (e) {
        console.warn(`[⚠️] BPA Context Injector Warning: ${e.message}`);
        return systemPrompt;
    }
};

const invokePlugin = (pluginName, capabilityId, args, target = 'localhost') => new Promise(async (resolve, reject) => {
    try {
        const plugins = await getRegisteredPlugins();
        const plugin = plugins.find(p => p.name === pluginName);
        if (!plugin) return reject(new Error(`Plugin ${pluginName} not found`));

        const cap = plugin.capabilities.find(c => c.id === capabilityId);
        if (!cap) return reject(new Error(`Capability ${capabilityId} not found on plugin ${pluginName}`));

        const ipcPath = os.platform() === 'win32' 
            ? '\\\\.\\pipe\\bayezid_broker' 
            : '/run/bayezid/broker.sock';

        const client = net.connect(ipcPath, () => {
            
            const argArray = Object.keys(args).map(key => `${key}=${args[key]}`);
            const brokerPayload = {
                tool: plugin.entrypoint,
                args: [capabilityId, ...argArray],
                target,
                requesting_engine: `Plugin:${pluginName}`,
                request_id: `plugin-${Date.now()}`
            };
            client.write(JSON.stringify(brokerPayload) + '\n');
        });

        let dataBuffer = '';
        client.on('data', (chunk) => {
            dataBuffer += chunk.toString();
            const lines = dataBuffer.split('\n');
            dataBuffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const response = JSON.parse(line);
                    if (response.status === 'COMPLETED') {
                        client.end();
                        resolve(response);
                    } else if (response.status === 'BLOCKED' || response.status === 'DENIED' || response.status === 'FAILED') {
                        client.end();
                        reject(new Error(`Plugin execution ${response.status}: ${response.reason}`));
                    }
                } catch (err) {}
            }
        });

        client.on('error', (err) => {
            reject(new Error(`Connection to OS Execution Broker failed: ${err.message}`));
        });
    } catch (err) {
        reject(err);
    }
});

module.exports = {
    injectPluginsContext,
    invokePlugin
};
