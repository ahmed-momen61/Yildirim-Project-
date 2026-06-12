const os = require('os');
const { spawn } = require('child_process');
const { emitTelemetry } = require('./telemetryHub');

let tailProcess = null;
let isExpectedShutdown = false;

const parseLogLine = (line) => {
    if (line.includes('sshd') && line.includes('Failed password')) {
        const ipMatch = line.match(/from\s+([0-9a-fA-F.:]+)/);
        const userMatch = line.match(/for\s+(?:invalid\s+user\s+)?(\S+)\s+from/);
        const ip = ipMatch ? ipMatch[1] : 'unknown';
        const user = userMatch ? userMatch[1] : 'unknown';
        emitTelemetry('ADVERSARIAL', {
            event: 'SSH_FAILED_LOGIN',
            source_ip: ip,
            user: user,
            details: line.trim()
        });
        console.log(`[🛡️ LINUX TELEMETRY] Captured failed SSH login: ${user} from ${ip}`);
        return;
    }

    if (line.includes('sudo:') && (line.includes('authentication failure') || line.includes('user NOT in sudoers') || line.includes('TTY='))) {
        const userMatch = line.match(/user=(\S+)/) || line.match(/sudo:\s+(\S+)\s+:/);
        const cmdMatch = line.match(/COMMAND=(.+)$/);
        const user = userMatch ? userMatch[1] : 'unknown';
        const cmd = cmdMatch ? cmdMatch[1] : 'unknown';
        emitTelemetry('ADVERSARIAL', {
            event: 'SUDO_VIOLATION',
            user: user,
            command: cmd,
            details: line.trim()
        });
        console.log(`[🛡️ LINUX TELEMETRY] Captured sudo violation: ${user} executing ${cmd}`);
        return;
    }

    if (line.includes('sshd') && line.includes('Accepted')) {
        const ipMatch = line.match(/from\s+([0-9a-fA-F.:]+)/);
        const userMatch = line.match(/for\s+(\S+)\s+from/);
        const ip = ipMatch ? ipMatch[1] : 'unknown';
        const user = userMatch ? userMatch[1] : 'unknown';
        emitTelemetry('ADVERSARIAL', {
            event: 'SSH_SESSION_OPEN',
            source_ip: ip,
            user: user,
            details: line.trim()
        });
        console.log(`[🛡️ LINUX TELEMETRY] Captured SSH session accepted: ${user} from ${ip}`);
        return;
    }
};

const startLinuxTelemetryDaemon = () => {
    if (os.platform() === 'win32') {
        console.warn('[🛡️ LINUX TELEMETRY] System is running on WIN32. Native Linux Telemetry Daemon is disabled (graceful fallback).');
        return;
    }

    isExpectedShutdown = false;
    console.log('[🛡️ LINUX TELEMETRY] Spawning native log watcher: tail -F /var/log/auth.log');

    tailProcess = spawn('tail', ['-F', '/var/log/auth.log']);

    let buffer = '';
    tailProcess.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (line.trim()) {
                try {
                    parseLogLine(line);
                } catch (err) {
                    console.error('[-] Error parsing telemetry log line:', err.message);
                }
            }
        }
    });

    tailProcess.stderr.on('data', (data) => {
        console.warn(`[🛡️ LINUX TELEMETRY STDERR] ${data.toString().trim()}`);
    });

    tailProcess.on('close', (code) => {
        tailProcess = null;
        if (!isExpectedShutdown) {
            console.warn(`[🛡️ LINUX TELEMETRY] log watcher process exited with code ${code}. Restarting in 5s...`);
            setTimeout(startLinuxTelemetryDaemon, 5000);
        }
    });
};

const stopLinuxTelemetryDaemon = () => {
    isExpectedShutdown = true;
    if (tailProcess) {
        tailProcess.kill();
        tailProcess = null;
    }
};

module.exports = {
    startLinuxTelemetryDaemon,
    stopLinuxTelemetryDaemon
};
