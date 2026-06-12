const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
class PacketCaptureManager {
    constructor(outputDir = path.join(__dirname, '../../forensics/pcaps')) {
        this.outputDir = outputDir;
        this.activeCaptures = new Map(); 
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }
    startCapture(alertId, targetIp, durationMs = 600000) { 
        if (this.activeCaptures.has(alertId)) {
            console.log(`[🔎 PCAP] Capture already running for alert ${alertId}`);
            return;
        }
        const filename = `forensic_${alertId}_${Date.now()}.pcap`;
        const filepath = path.join(this.outputDir, filename);
        console.log(`[🔎 PCAP] Starting packet capture for ${targetIp} -> ${filename}`);
        const tcpdump = spawn('tcpdump', ['-i', 'any', 'host', targetIp, '-w', filepath]);
        this.activeCaptures.set(alertId, {
            process: tcpdump,
            filepath
        });
        setTimeout(() => this.stopCapture(alertId), durationMs);
        tcpdump.on('error', (err) => {
            console.error(`[-] tcpdump error for ${alertId}:`, err.message);
            this.activeCaptures.delete(alertId);
        });
    }
    stopCapture(alertId) {
        const capture = this.activeCaptures.get(alertId);
        if (capture) {
            console.log(`[🔎 PCAP] Stopping packet capture for alert ${alertId}`);
            capture.process.kill('SIGTERM');
            this.activeCaptures.delete(alertId);
            return capture.filepath;
        }
        return null;
    }
}
module.exports = new PacketCaptureManager();
