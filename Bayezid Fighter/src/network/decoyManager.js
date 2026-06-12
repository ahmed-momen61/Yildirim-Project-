const { exec } = require('child_process');
const util = require('util');
const os = require('os');
const execPromise = util.promisify(exec);
const { redisClient } = require('../memory_systems/memoryService');
const ebpfBridge = require('../blue_swarm/ebpfBridge');

const DECOY_PROFILES = {
    'cowrie': { image: 'cowrie/cowrie:latest', label: 'SSH honeypot' },
    'redis': { image: 'redis:alpine', label: 'Redis honeypot' },
    'postgres': { image: 'postgres:alpine', label: 'Postgres DB honeypot' },
    'nginx': { image: 'nginx:alpine', label: 'Fake HTTP portal' },
    'smb': { image: 'nginx:alpine', label: 'Fake SMB' } 
};

const activeDecoyContainers = new Map();

const deployDecoy = async ({ triggerIp, targetPort, serviceType }) => {
    const profile = DECOY_PROFILES[serviceType] || DECOY_PROFILES['nginx'];
    const timestamp = Date.now();
    const networkName = `bayezid_decoy_net_${timestamp}`;
    const decoyName = `decoy_${serviceType}_${Math.floor(Math.random() * 10000)}`;

    console.log(`\n[🍯] DECOY-GRID: Deploying active decoy [${decoyName}] (Type: ${profile.label}) for IP: ${triggerIp}...`);

    try {
        
        await execPromise(`docker network create ${networkName}`).catch(() => {});

        
        let runCmd = `docker run -d --name ${decoyName} --network ${networkName} --label bayezid.decoy=true ${profile.image}`;
        if (serviceType === 'postgres') {
            runCmd = `docker run -d --name ${decoyName} --network ${networkName} --label bayezid.decoy=true -e POSTGRES_PASSWORD=fake_secure_pass postgres:alpine`;
        }
        
        const { stdout } = await execPromise(runCmd);
        const containerId = stdout.trim();

        const ttl = 1800; 
        const decoyData = {
            containerId,
            decoyName,
            triggerIp,
            targetPort: String(targetPort),
            serviceType,
            networkName,
            createdAt: String(Date.now()),
            ttl: String(ttl)
        };

        
        activeDecoyContainers.set(decoyName, decoyData);
        if (redisClient.isOpen) {
            await redisClient.hSet(`decoys:active:${containerId}`, decoyData);
            await redisClient.expire(`decoys:active:${containerId}`, ttl);
        }

        
        if (os.platform() !== 'win32') {
            try {
                
                const iflinkRes = await execPromise(`docker exec ${decoyName} cat /sys/class/net/eth0/iflink`);
                const ifindex = parseInt(iflinkRes.stdout.trim(), 10);
                if (!isNaN(ifindex)) {
                    console.log(`[🧬] DECOY-GRID: Resolved decoy peer ifindex as: ${ifindex}`);
                    
                    await ebpfBridge.addToRedirectMap(triggerIp, ifindex);
                }
            } catch (err) {
                console.warn(`[⚠️] Failed to bind eBPF XDP steering map: ${err.message}`);
            }
        } else {
            console.log(`[💻] Windows Dev Mode: Decoy is online in network. Skipping XDP interface routing.`);
        }

        
        try {
            const { attachDecoyTelemetry } = require('./decoyTelemetry');
            attachDecoyTelemetry(decoyName, serviceType);
        } catch (telemetryErr) {
            console.warn(`[⚠️] Telemetry attach failure: ${telemetryErr.message}`);
        }

        
        setTimeout(() => {
            teardownDecoy(decoyName).catch(() => {});
        }, ttl * 1000);

        console.log(`[✅] Decoy container successfully deployed: ${decoyName} (${containerId.substring(0, 12)})`);
        return decoyName;
    } catch (e) {
        console.error(`[-] Failed to deploy decoy container:`, e.message);
        return null;
    }
};

const teardownDecoy = async (decoyName) => {
    console.log(`[🧹] DECOY-GRID: Tearing down decoy container: ${decoyName}...`);
    const decoy = activeDecoyContainers.get(decoyName);
    if (!decoy) return;

    try {
        try {
            const { stopDecoyTelemetryAndReport } = require('./decoyTelemetry');
            await stopDecoyTelemetryAndReport(decoyName);
        } catch (telemetryErr) {
            console.warn(`[⚠️] Telemetry stop/report failure: ${telemetryErr.message}`);
        }

        await execPromise(`docker stop ${decoyName}`).catch(() => {});
        await execPromise(`docker rm -f ${decoyName}`).catch(() => {});
        await execPromise(`docker network rm ${decoy.networkName}`).catch(() => {});
        
        activeDecoyContainers.delete(decoyName);
        if (redisClient.isOpen) {
            await redisClient.del(`decoys:active:${decoy.containerId}`);
        }
        console.log(`[🧹] Decoy container ${decoyName} cleaned up successfully.`);
    } catch (e) {
        console.error(`[-] Decoy cleanup error:`, e.message);
    }
};

module.exports = {
    deployDecoy,
    teardownDecoy,
    activeDecoys: activeDecoyContainers
};
