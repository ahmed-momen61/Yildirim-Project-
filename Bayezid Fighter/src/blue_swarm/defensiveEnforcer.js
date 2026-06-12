const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const ebpfBridge = require('./ebpfBridge');
class DefensiveEnforcer {
    constructor() {
        this.activeBlocks = new Map();
        this.privateIpRegex = /(^127\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2[0-9]\.)|(^172\.3[0-1]\.)|(^192\.168\.)/;
    }
    validateIPv4(ip) {
        if (!ip || typeof ip !== 'string') return false;
        const ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        if (!ipv4Pattern.test(ip)) return false;
        if (this.privateIpRegex.test(ip)) {
            console.warn(`[🛡️ Enforcer] BLOCK REJECTED: IP ${ip} is a private/internal subnet.`);
            return false;
        }
        return true;
    }
    async blockIp(ip, alertId, durationMs = 3600000) { 
        if (!this.validateIPv4(ip)) {
            throw new Error(`Invalid or Protected IP: ${ip}`);
        }
        try {
            console.log(`[🛡️ Enforcer] Engaging iptables DROP for ${ip} (Alert: ${alertId})`);
            await execPromise(`iptables -I INPUT -s ${ip} -j DROP -m comment --comment "Bayezid-IR:${alertId}"`);
            await ebpfBridge.addToBlocklist(ip);
            const expiryTimer = setTimeout(() => this.unblockIp(ip, alertId), durationMs);
            this.activeBlocks.set(ip, expiryTimer);
            return { success: true, ip, duration: durationMs };
        } catch (e) {
            console.error(`[-] Enforcer iptables failed: ${e.message}`);
            throw e;
        }
    }
    async unblockIp(ip, alertId) {
        try {
            console.log(`[🛡️ Enforcer] Auto-Expiry: Lifting iptables DROP for ${ip}`);
            const findCmd = `iptables -L INPUT --line-numbers -n | grep ${ip} | grep "Bayezid-IR:${alertId}" | awk '{print $1}' | head -n 1`;
            const { stdout } = await execPromise(findCmd);
            const ruleNum = stdout.trim();
            if (ruleNum) {
                await execPromise(`iptables -D INPUT ${ruleNum}`);
            }
            await ebpfBridge.removeFromBlocklist(ip);
            if (this.activeBlocks.has(ip)) {
                clearTimeout(this.activeBlocks.get(ip));
                this.activeBlocks.delete(ip);
            }
            return { success: true, ip };
        } catch (e) {
            console.error(`[-] Enforcer unblock failed: ${e.message}`);
            throw e;
        }
    }
}
module.exports = new DefensiveEnforcer();
