const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const ipToUint32BE = (ipString) => {
    const parts = ipString.split('.');
    if (parts.length !== 4) throw new Error('Invalid IPv4 address');
    const buffer = Buffer.alloc(4);
    for (let i = 0; i < 4; i++) {
        buffer.writeUInt8(parseInt(parts[i], 10), i);
    }
    return buffer.readUInt32BE(0);
};

const spawnPromise = (cmd, args) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(stderr.trim() || `Process exited with code ${code}`));
    });
});

class eBPFBridge {
    constructor(basePath = '/sys/fs/bpf/bayezid') {
        this.basePath = basePath;
        this.blocklistMap = `${this.basePath}/bayezid_blocklist`;
        this.weightsMap = `${this.basePath}/bayezid_neural_weights`;
        this.modeMap = `${this.basePath}/bayezid_ebpf_mode`;
        this.ratelimitMap = `${this.basePath}/bayezid_ratelimit`;
        this.redirectMap = `${this.basePath}/bayezid_redirect`;
    }
    _ipToHex(ipStr) {
        const parts = ipStr.split('.');
        if (parts.length !== 4) throw new Error('Invalid IPv4 address');
        return `hex ${parts.map(p => parseInt(p, 10).toString(16).padStart(2, '0')).join(' ')}`;
    }
    async setEbpfMode(mode) {
        const value = mode === 'monitor' ? 'hex 01 00 00 00' : 'hex 00 00 00 00';
        try {
            await execPromise(`bpftool map update pinned ${this.modeMap} key hex 00 00 00 00 value ${value}`);
            console.log(`[eBPF Bridge] Execution mode set to: ${mode}`);
        } catch (e) {
            console.error(`[eBPF Bridge] Failed to set mode: ${e.message}`);
        }
    }
    async addToBlocklist(ipStr) {
        try {
            const keyHex = this._ipToHex(ipStr);
            const valueHex = 'hex 01 00 00 00'; 
            await execPromise(`bpftool map update pinned ${this.blocklistMap} key ${keyHex} value ${valueHex}`);
            console.log(`[eBPF Bridge] IP ${ipStr} added to kernel blocklist.`);
        } catch (e) {
            console.error(`[eBPF Bridge] Failed to block IP ${ipStr}: ${e.message}`);
        }
    }
    async removeFromBlocklist(ipStr) {
        try {
            const keyHex = this._ipToHex(ipStr);
            await execPromise(`bpftool map delete pinned ${this.blocklistMap} key ${keyHex}`);
            console.log(`[eBPF Bridge] IP ${ipStr} removed from kernel blocklist.`);
        } catch (e) {
            console.error(`[eBPF Bridge] Failed to unblock IP ${ipStr}: ${e.message}`);
        }
    }
    async updateNeuralWeights(modelId, weightsArray) {
        if (weightsArray.length !== 9) throw new Error('Neural Net requires 8 weights + 1 bias');
        let valueStr = 'hex ';
        for (const w of weightsArray) {
            const buffer = Buffer.alloc(8);
            buffer.writeBigInt64LE(BigInt(Math.round(w)));
            valueStr += buffer.toString('hex').match(/../g).join(' ') + ' ';
        }
        try {
            const keyHex = `hex ${modelId.toString(16).padStart(2, '0')} 00 00 00`;
            await execPromise(`bpftool map update pinned ${this.weightsMap} key ${keyHex} value ${valueStr.trim()}`);
            console.log(`[eBPF Bridge] Neural weights updated for Model ID ${modelId}`);
        } catch (e) {
            console.error(`[eBPF Bridge] Failed to update weights: ${e.message}`);
        }
    }
    async setRateLimit(ipAddress, packetsPerSecond) {
        try {
            const keyHexBytes = ipAddress.split('.').map(p => parseInt(p, 10).toString(16).padStart(2, '0'));
            const valBuffer = Buffer.alloc(4);
            valBuffer.writeUInt32LE(packetsPerSecond, 0);
            const valParts = valBuffer.toString('hex').match(/../g);

            const spawnArgs = [
                'map', 'update', 'pinned', this.ratelimitMap,
                'key', 'hex', ...keyHexBytes,
                'value', 'hex', ...valParts
            ];

            await spawnPromise('sudo', ['bpftool', ...spawnArgs]);
            console.log(`[eBPF Bridge] Rate limit of ${packetsPerSecond} pps set for IP ${ipAddress}.`);
        } catch (e) {
            console.error(`[eBPF Bridge] Failed to set rate limit for ${ipAddress}: ${e.message}`);
        }
    }
    async removeRateLimit(ipAddress) {
        try {
            const keyHexBytes = ipAddress.split('.').map(p => parseInt(p, 10).toString(16).padStart(2, '0'));
            const spawnArgs = [
                'map', 'delete', 'pinned', this.ratelimitMap,
                'key', 'hex', ...keyHexBytes
            ];

            await spawnPromise('sudo', ['bpftool', ...spawnArgs]);
            console.log(`[eBPF Bridge] Rate limit removed for IP ${ipAddress}.`);
        } catch (e) {
            console.error(`[eBPF Bridge] Failed to remove rate limit for ${ipAddress}: ${e.message}`);
        }
    }
    async addToRedirectMap(ipStr, ifindex) {
        try {
            const keyHex = this._ipToHex(ipStr);
            const valBuffer = Buffer.alloc(4);
            valBuffer.writeUInt32LE(ifindex, 0);
            const valHex = 'hex ' + valBuffer.toString('hex').match(/../g).join(' ');
            await execPromise(`bpftool map update pinned ${this.redirectMap} key ${keyHex} value ${valHex}`);
            console.log(`[eBPF Bridge] IP ${ipStr} redirected to decoy veth interface index ${ifindex}.`);
        } catch (e) {
            console.error(`[eBPF Bridge] Failed to add decoy redirect for ${ipStr}: ${e.message}`);
        }
    }
}

const instance = new eBPFBridge();
instance.ipToUint32BE = ipToUint32BE;

module.exports = instance;
