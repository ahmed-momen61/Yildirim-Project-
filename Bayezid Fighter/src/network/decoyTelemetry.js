const { spawn, exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);
const { redisClient } = require('../memory_systems/memoryService');

const activeListeners = new Map();

const attachDecoyTelemetry = (containerName, serviceType) => {
    console.log(`[🔬] DECOY-TELEMETRY: Attaching live tcpdump listener to ${containerName}...`);
    const pcapDir = path.join(__dirname, '../../data/decoy_pcaps');
    if (!fs.existsSync(pcapDir)) {
        fs.mkdirSync(pcapDir, { recursive: true });
    }
    const pcapPath = path.join(pcapDir, `${containerName}.pcap`);
    const writeStream = fs.createWriteStream(pcapPath);

    
    const tcpdumpProc = spawn('docker', [
        'exec', '-i', containerName, 
        'tcpdump', '-w', '-', '-s', '0', '-U'
    ]);

    tcpdumpProc.stdout.pipe(writeStream);
    activeListeners.set(containerName, {
        proc: tcpdumpProc,
        pcapPath,
        serviceType
    });

    tcpdumpProc.on('error', (err) => {
        console.warn(`[⚠️] Failed to spawn tcpdump on container ${containerName}: ${err.message}`);
    });
};

const stopDecoyTelemetryAndReport = async (containerName) => {
    console.log(`[📊] DECOY-TELEMETRY: Stopping capture and building report for ${containerName}...`);
    const listener = activeListeners.get(containerName);
    if (!listener) return;

    
    try {
        listener.proc.kill('SIGTERM');
    } catch (e) {}
    activeListeners.delete(containerName);

    let commandLog = '[]';
    let rawLogs = '';

    try {
        const { stdout } = await execPromise(`docker logs ${containerName}`).catch(() => ({ stdout: '' }));
        rawLogs = stdout;

        if (listener.serviceType === 'cowrie') {
            
            const cowrieRes = await execPromise(`docker exec ${containerName} cat /var/cowrie/data/log/cowrie.json`).catch(() => null);
            if (cowrieRes) {
                commandLog = cowrieRes.stdout;
            } else {
                commandLog = rawLogs;
            }
        } else {
            commandLog = rawLogs;
        }
    } catch (err) {
        console.warn(`[⚠️] Decoy telemetry log harvest warning: ${err.message}`);
    }

    const report = {
        containerName,
        serviceType: listener.serviceType,
        pcapPath: listener.pcapPath,
        commandLog: commandLog.substring(0, 50000), 
        timestamp: String(Date.now())
    };

    try {
        if (redisClient.isOpen) {
            await redisClient.xAdd('bayezid:decoy:reports', '*', {
                report: JSON.stringify(report)
            });
            console.log(`[✅] DECOY-TELEMETRY: Published DecoyReport to Redis Stream 'bayezid:decoy:reports'.`);
        }
    } catch (e) {
        console.error('[-] Failed to publish decoy report to stream:', e.message);
    }
};

module.exports = {
    attachDecoyTelemetry,
    stopDecoyTelemetryAndReport
};
