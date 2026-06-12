const fs = require('fs');
class HeuristicWatchdog {
    constructor() {
        this.baselineCpu = 15.0; 
        this.baselineMem = 40.0; 
        this.baselinePackets = 1200; 
        this.lastCpuData = this._readProcStat();
        this.lastNetworkData = this._readProcNetDev();
        this.lastTime = Date.now();
    }
    _readProcStat() {
        try {
            const stat = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
            if (!stat.startsWith('cpu ')) return null;
            const parts = stat.split(/\s+/).slice(1).map(Number);
            const idle = parts[3];
            const total = parts.reduce((acc, val) => acc + val, 0);
            return { idle, total };
        } catch (e) {
            return null; 
        }
    }
    _readProcMeminfo() {
        try {
            const lines = fs.readFileSync('/proc/meminfo', 'utf8').split('\n');
            let total = 0, free = 0, buffers = 0, cached = 0;
            for (const line of lines) {
                if (line.startsWith('MemTotal:')) total = parseInt(line.split(/\s+/)[1]);
                if (line.startsWith('MemFree:')) free = parseInt(line.split(/\s+/)[1]);
                if (line.startsWith('Buffers:')) buffers = parseInt(line.split(/\s+/)[1]);
                if (line.startsWith('Cached:')) cached = parseInt(line.split(/\s+/)[1]);
            }
            const used = total - free - buffers - cached;
            return total > 0 ? (used / total) * 100 : 0;
        } catch (e) {
            return 0;
        }
    }
    _readProcNetDev() {
        try {
            const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
            let totalPackets = 0;
            for (const line of lines) {
                if (!line.trim()) continue;
                const parts = line.split(':')[1].trim().split(/\s+/);
                totalPackets += parseInt(parts[1]) + parseInt(parts[9]);
            }
            return totalPackets;
        } catch (e) {
            return 0;
        }
    }
    getSystemMetrics() {
        const currentCpu = this._readProcStat();
        const currentNetwork = this._readProcNetDev();
        const now = Date.now();
        const timeDiff = (now - this.lastTime) / 1000; 
        let cpuUsage = 0;
        if (currentCpu && this.lastCpuData) {
            const idleDiff = currentCpu.idle - this.lastCpuData.idle;
            const totalDiff = currentCpu.total - this.lastCpuData.total;
            cpuUsage = 100 * (1 - (idleDiff / totalDiff));
        }
        let networkPacketsPerSec = 0;
        if (timeDiff > 0) {
            networkPacketsPerSec = (currentNetwork - this.lastNetworkData) / timeDiff;
        }
        const memoryUsage = this._readProcMeminfo();
        this.lastCpuData = currentCpu;
        this.lastNetworkData = currentNetwork;
        this.lastTime = now;
        return {
            cpuUsage: cpuUsage || 10.0, 
            memoryUsage: memoryUsage || 30.0,
            networkPacketsPerSec: networkPacketsPerSec || 100,
            processCount: 150 
        };
    }
    evaluateBehavioralBreach(metrics) {
        if (metrics.cpuUsage > 80.0 || metrics.networkPacketsPerSec > 5000) {
            console.log(`\n[🐺] HEURISTIC WATCHDOG: Behavioral Anomaly Detected!`);
            console.log(`    Metrics: CPU=${metrics.cpuUsage.toFixed(1)}%, Pkts=${metrics.networkPacketsPerSec.toFixed(0)}/s`);
            return true;
        }
        return false;
    }
}
module.exports = { HeuristicWatchdog };
