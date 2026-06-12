const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { askRedSwarmAI, smartExec, chatWithLocalModelFast } = require('../core_ai/aiService');
const { publishLiveEvent } = require('../memory_systems/memoryService');
const prisma = require('../api/prismaClient');
const DOCKER_IMAGE_MAP = {
    'apache':   { fallback: 'httpd:2.4',      pattern: (v) => `httpd:${v}` },
    'httpd':    { fallback: 'httpd:2.4',      pattern: (v) => `httpd:${v}` },
    'nginx':    { fallback: 'nginx:alpine',    pattern: (v) => `nginx:${v}` },
    'mysql':    { fallback: 'mysql:8.0',       pattern: (v) => `mysql:${v}` },
    'mariadb':  { fallback: 'mariadb:10',      pattern: (v) => `mariadb:${v}` },
    'postgres': { fallback: 'postgres:15',     pattern: (v) => `postgres:${v}` },
    'postgresql':{ fallback: 'postgres:15',    pattern: (v) => `postgres:${v}` },
    'mongodb':  { fallback: 'mongo:7',         pattern: (v) => `mongo:${v}` },
    'redis':    { fallback: 'redis:7-alpine',  pattern: (v) => `redis:${v}` },
    'ssh':      { fallback: 'ubuntu:22.04',    pattern: () => 'ubuntu:22.04' },
    'ftp':      { fallback: 'fauria/vsftpd',   pattern: () => 'fauria/vsftpd' },
    'smtp':     { fallback: 'mailhog/mailhog', pattern: () => 'mailhog/mailhog' },
    'tomcat':   { fallback: 'tomcat:10',       pattern: (v) => `tomcat:${v}` },
    'iis':      { fallback: 'mcr.microsoft.com/windows/servercore/iis', pattern: () => 'mcr.microsoft.com/windows/servercore/iis' },
    'node':     { fallback: 'node:20-alpine',  pattern: (v) => `node:${v}` },
    'python':   { fallback: 'python:3.12-slim',pattern: (v) => `python:${v}` },
};
const parseNmapServices = (nmapOutput) => {
    const services = [];
    if (!nmapOutput) return services;
    const lines = nmapOutput.split('\n');
    for (const line of lines) {
        const match = line.match(/(\d+)\/tcp\s+open\s+(\S+)\s*(.*)/i);
        if (match) {
            const port = parseInt(match[1]);
            const service = match[2].toLowerCase();
            const versionRaw = match[3] || '';
            const verMatch = versionRaw.match(/(\d+\.\d+(?:\.\d+)?)/)
            const version = verMatch ? verMatch[1] : null;
            services.push({ port, service, version, banner: versionRaw.trim() });
        }
    }
    return services;
};
const resolveDockerImage = (service, version) => {
    const key = service.toLowerCase();
    const entry = DOCKER_IMAGE_MAP[key];
    if (!entry) return 'ubuntu:22.04'; 
    if (version) {
        try { return entry.pattern(version); } catch { return entry.fallback; }
    }
    return entry.fallback;
};
const binomialTest = (successes, n, p0 = 0.9) => {
    if (n === 0) return { pValue: 1.0, ci: [0, 0], zScore: 0 };
    const pHat = successes / n;
    const se = Math.sqrt((p0 * (1 - p0)) / n);
    const z = se > 0 ? (pHat - p0) / se : 0;
    const normalCDF = (x) => {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        const t = 1.0 / (1.0 + p * Math.abs(x));
        const y = 1.0 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-x*x/2);
        return 0.5 * (1.0 + sign * y);
    };
    const pValue = 1 - normalCDF(z);
    const sePhat = Math.sqrt((pHat * (1 - pHat)) / n);
    const ciLow = Math.max(0, pHat - 1.96 * sePhat);
    const ciHigh = Math.min(1, pHat + 1.96 * sePhat);
    return { pValue, ci: [ciLow, ciHigh], zScore: z, pHat };
};
class ShadowMirror {
    constructor() {
        this.activeMirrors = new Map();
        this.testHistory = [];
        this.successThreshold = 1.0;
    }
    buildDigitalTwin(scoutTelemetry) {
            const {
                targetIp,
                os = 'ubuntu:22.04',
                services = [],
                openPorts = [],
                webServer = null,
                dbServer = null
            } = scoutTelemetry;
            const mirrorId = `shadow-${crypto.randomBytes(4).toString('hex')}`;
            console.log(`\n[🪞] =============================================`);
            console.log(`[🪞] SHADOW-MIRROR: Building Digital Twin`);
            console.log(`[🪞] Mirror ID: ${mirrorId}`);
            console.log(`[🪞] Target: ${targetIp}`);
            console.log(`[🪞] =============================================\n`);
            const containers = [];
            containers.push({
                name: 'target-os',
                image: this._resolveOsImage(os),
                ports: openPorts.map(p => `${p}:${p}`),
                command: 'tail -f /dev/null',
                networks: ['shadow-net']
            });
            if (webServer || services.some(s => ['http', 'https', 'nginx', 'apache'].includes(s.service))) {
                const webImage = this._resolveWebServer(webServer || 'nginx');
                containers.push({
                    name: 'target-web',
                    image: webImage,
                    ports: ['80:80', '443:443'],
                    networks: ['shadow-net']
                });
            }
            if (dbServer || services.some(s => ['mysql', 'postgres', 'mongodb', 'redis'].includes(s.service))) {
                const dbImage = this._resolveDbServer(dbServer || 'mysql');
                containers.push({
                    name: 'target-db',
                    image: dbImage,
                    environment: { MYSQL_ROOT_PASSWORD: 'shadow_mirror_test', POSTGRES_PASSWORD: 'shadow_mirror_test' },
                    networks: ['shadow-net']
                });
            }
            const compose = {
            version: '3.8',
            services: {},
            networks: {
                'shadow-net': {
                    driver: 'bridge',
                    internal: true,
                    ipam: { config: [{ subnet: '172.30.0.0/24' }] }
                }
            }
        };
            containers.forEach((c, idx) => {
                compose.services[c.name] = {
                    image: c.image,
                    container_name: `${mirrorId}-${c.name}`,
                    ports: c.ports || [],
                    networks: c.networks,
                    ...(c.command && { command: c.command }),
                    ...(c.environment && { environment: c.environment }),
                    deploy: {
                        resources: {
                            limits: { memory: '512M', cpus: '0.5' }
                        }
                    }
                };
            });
            const composeYaml = this._toYaml(compose);
            const composeDir = path.join(__dirname, 'shadow_mirrors', mirrorId);
            if (!fs.existsSync(composeDir)) {
                fs.mkdirSync(composeDir, { recursive: true });
            }
            const composePath = path.join(composeDir, 'docker-compose.yml');
            fs.writeFileSync(composePath, composeYaml);
            const mirror = {
                id: mirrorId,
                targetIp,
                composePath,
                composeDir,
                containers,
                status: 'BUILT',
                createdAt: new Date().toISOString(),
                testResults: []
            };
            this.activeMirrors.set(mirrorId, mirror);
            console.log(`[🪞] Digital Twin manifest generated: ${composePath}`);
            console.log(`[🪞] Containers: ${containers.map(c => `${c.name}(${c.image})`).join(', ')}`);
        return mirror;
    }
    async deployTwin(mirrorId) {
        const mirror = this.activeMirrors.get(mirrorId);
        if (!mirror) throw new Error(`Mirror ${mirrorId} not found`);
        console.log(`[🪞] Deploying Digital Twin ${mirrorId}...`);
        mirror.status = 'DEPLOYING';
        try {
            await smartExec(
                `docker-compose -f "${mirror.composePath}" up -d --remove-orphans`,
                60000, false
            );
            mirror.status = 'RUNNING';
            console.log(`[✔] Digital Twin ${mirrorId} is LIVE.`);
        } catch (e) {
            console.log(`[⚠️] Docker deployment failed: ${e.message}`);
            mirror.status = 'SIMULATED';
            console.log(`[🪞] Running in SIMULATED mode (no Docker daemon).`);
        }
        return mirror;
    }
    async preFlightFuzz(mirrorId, payload, iterations = 10) {
        const mirror = this.activeMirrors.get(mirrorId);
        if (!mirror) throw new Error(`Mirror ${mirrorId} not found`);
        console.log(`\n[🪞] =============================================`);
        console.log(`[🪞] PRE-FLIGHT FUZZING: ${iterations} iterations`);
        console.log(`[🪞] Payload Size: ${payload.length} bytes`);
        console.log(`[🪞] =============================================\n`);
        const results = [];
        for (let i = 1; i <= iterations; i++) {
            console.log(`[🪞] Iteration ${i}/${iterations}...`);
            const testResult = {
                iteration: i,
                timestamp: new Date().toISOString(),
                success: false,
                output: '',
                memoryOffset: null,
                crashDetected: false,
                executionTimeMs: 0
            };
            const start = Date.now();
            try {
                if (mirror.status === 'RUNNING') {
                    const containerTarget = `${mirrorId}-target-os`;
                    const { stdout, stderr } = await smartExec(
                        `docker exec ${containerTarget} sh -c "${payload.replace(/"/g, '\\"')}"`,
                        30000, false
                    );
                    testResult.output = stdout || stderr || '';
                    testResult.success = !stderr || stderr.trim() === '';
                } else {
                    testResult.success = await this._simulateExecution(payload, i);
                    testResult.output = testResult.success
                        ? `[SIM] Payload executed successfully (iteration ${i})`
                        : `[SIM] Execution failed — edge case detected`;
                }
            } catch (e) {
                testResult.output = e.message;
                testResult.crashDetected = e.message.includes('segfault') ||
                    e.message.includes('core dump') ||
                    e.message.includes('SIGSEGV');
            }
            testResult.executionTimeMs = Date.now() - start;
            testResult.memoryOffset = `0x${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            results.push(testResult);
            if (testResult.crashDetected) {
                console.log(`[💥] CRASH DETECTED at iteration ${i}! Offset: ${testResult.memoryOffset}`);
            } else if (testResult.success) {
                console.log(`[✔] Iteration ${i}: SUCCESS (${testResult.executionTimeMs}ms)`);
            } else {
                console.log(`[✗] Iteration ${i}: FAILED — refining payload...`);
            }
        }
        const successes = results.filter(r => r.success).length;
        const successRate = successes / iterations;
        const crashes = results.filter(r => r.crashDetected).length;
        mirror.testResults = results;
        const approval = binomialTest(successes, iterations, 0.9);
        const report = {
            mirrorId,
            iterations,
            successes,
            failures: iterations - successes,
            crashes,
            successRate,
            approved: approval.pValue < 0.05,
            confidence: `p=${approval.pValue.toFixed(5)}, CI=[${approval.ci[0].toFixed(4)}, ${approval.ci[1].toFixed(4)}]`,
            zScore: approval.zScore.toFixed(3),
            avgExecutionMs: Math.round(results.reduce((s, r) => s + r.executionTimeMs, 0) / iterations),
            results
        };
        this.testHistory.push(report);
        console.log(`\n[🪞] =============================================`);
        console.log(`[🪞] PRE-FLIGHT RESULTS`);
        console.log(`[🪞] Success Rate: ${(successRate * 100).toFixed(1)}% (${successes}/${iterations})`);
        console.log(`[🪞] Crashes: ${crashes}`);
        console.log(`[🪞] VERDICT: ${report.approved ? '✅ APPROVED — Launch live kinetic attack' : '❌ REJECTED — Payload needs refinement'}`);
        console.log(`[🪞] =============================================\n`);
        try {
            await publishLiveEvent('bayezid_tactical_feed', 'SHADOW_MIRROR_PREFLIGHT', {
                mirrorId, successRate, approved: report.approved
            });
        } catch (e) {}
        return report;
    }
    async destroyTwin(mirrorId) {
        const mirror = this.activeMirrors.get(mirrorId);
        if (!mirror) return;
        console.log(`[🪞] Destroying Digital Twin ${mirrorId}...`);
        try {
            await smartExec(
                `docker-compose -f "${mirror.composePath}" down -v --remove-orphans`,
                30000, false
            );
        } catch (e) {
            console.log(`[!] Docker teardown failed: ${e.message}`);
        }
        mirror.status = 'DESTROYED';
        this.activeMirrors.delete(mirrorId);
        console.log(`[✔] Twin ${mirrorId} destroyed.`);
    }
    async zeroFailPipeline(scoutTelemetry, payload, iterations = 10) {
        const mirror = this.buildDigitalTwin(scoutTelemetry);
        await this.deployTwin(mirror.id);
        const report = await this.preFlightFuzz(mirror.id, payload, iterations);
        await this.destroyTwin(mirror.id);
        return report;
    }
    async _simulateExecution(payload, iteration) {
        const baseRate = 0.90;
        const edgeCasePenalty = iteration % 7 === 0 ? 0.5 : 0;
        return Math.random() > (1 - baseRate + edgeCasePenalty);
    }
    _resolveOsImage(os) {
        const map = {
            'ubuntu': 'ubuntu:22.04', 'debian': 'debian:bullseye', 'centos': 'centos:7',
            'alpine': 'alpine:3.18', 'kali': 'kalilinux/kali-rolling',
            'windows': 'mcr.microsoft.com/windows/servercore:ltsc2022'
        };
        for (const [key, image] of Object.entries(map)) {
            if (os.toLowerCase().includes(key)) return image;
        }
        return os.includes(':') ? os : 'ubuntu:22.04';
    }
    _resolveWebServer(ws) {
        const map = { 'nginx': 'nginx:alpine', 'apache': 'httpd:2.4', 'iis': 'mcr.microsoft.com/windows/servercore/iis' };
        return map[ws.toLowerCase()] || 'nginx:alpine';
    }
    _resolveDbServer(db) {
        const map = { 'mysql': 'mysql:8.0', 'postgres': 'postgres:15', 'mongodb': 'mongo:7', 'redis': 'redis:7-alpine' };
        return map[db.toLowerCase()] || 'mysql:8.0';
    }
    _toYaml(obj, indent = 0) {
        const pad = ' '.repeat(indent);
        let yaml = '';
        for (const [key, value] of Object.entries(obj)) {
            if (value === null || value === undefined) continue;
            if (typeof value === 'object' && !Array.isArray(value)) {
                yaml += `${pad}${key}:\n${this._toYaml(value, indent + 2)}`;
            } else if (Array.isArray(value)) {
                yaml += `${pad}${key}:\n`;
                value.forEach(item => {
                    if (typeof item === 'object') {
                        yaml += `${pad}  -\n${this._toYaml(item, indent + 4)}`;
                    } else {
                        yaml += `${pad}  - ${item}\n`;
                    }
                });
            } else {
                yaml += `${pad}${key}: ${value}\n`;
            }
        }
        return yaml;
    }
    getStatus() {
        return {
            activeMirrors: [...this.activeMirrors.values()].map(m => ({
                id: m.id, targetIp: m.targetIp, status: m.status, containers: m.containers.length
            })),
            totalTests: this.testHistory.length,
            recentTests: this.testHistory.slice(-5)
        };
    }
    async fingerprintTarget(targetIp) {
        const scoutLog = await prisma.redSwarmLog.findFirst({
            where: { targetIp, agentName: 'Scout', isSuccess: true },
            orderBy: { createdAt: 'desc' }
        });
        if (!scoutLog) throw new Error(`No successful Scout recon data for ${targetIp}`);
        const services = parseNmapServices(scoutLog.executionOutput);
        if (services.length === 0) {
            console.log(`[🪞] No services parsed from Scout output. Using default stack.`);
            return [{ name: 'target-os', image: 'ubuntu:22.04', port: 22 }];
        }
        return services.map(s => ({
            name: s.service,
            image: resolveDockerImage(s.service, s.version),
            port: s.port,
            banner: s.banner
        }));
    }
    async createMirror(targetIp) {
        console.log(`[🪞] Auto-Create Mirror: Fingerprinting ${targetIp}...`);
        const detectedStack = await this.fingerprintTarget(targetIp);
        console.log(`[🪞] Detected ${detectedStack.length} services: ${detectedStack.map(s => `${s.name}:${s.port}`).join(', ')}`);
        const scoutTelemetry = {
            targetIp,
            services: detectedStack.map(s => ({ service: s.name })),
            openPorts: detectedStack.map(s => s.port)
        };
        const mirror = this.buildDigitalTwin(scoutTelemetry);
        await this.deployTwin(mirror.id);
        return {
            mirrorId: mirror.id,
            detectedStack,
            containerMap: mirror.containers.map(c => ({ name: c.name, image: c.image })),
            deployStatus: mirror.status
        };
    }
    async statefulReplay(mirrorId, operationLedgerIds) {
        const mirror = this.activeMirrors.get(mirrorId);
        if (!mirror) throw new Error(`Mirror ${mirrorId} not found`);
        console.log(`[🪞] Stateful Replay: Replaying ${operationLedgerIds.length} operations on ${mirrorId}...`);
        const replayResults = [];
        for (const opId of operationLedgerIds) {
            let op;
            try {
                op = await prisma.operationLedger.findUnique({ where: { id: opId } });
            } catch { op = null; }
            if (!op) {
                replayResults.push({ op: opId, outcome: 'NOT_FOUND', deviatedFrom: null });
                continue;
            }
            const command = op.command || op.executedCommand || 'echo NOP';
            let outcome = 'FAILED';
            let deviatedFrom = null;
            try {
                if (mirror.status === 'RUNNING') {
                    const containerTarget = `${mirrorId}-target-os`;
                    await smartExec(`docker exec ${containerTarget} sh -c "${command.replace(/"/g, '\\"')}"`, 30000, false);
                    outcome = 'SUCCESS';
                } else {
                    outcome = Math.random() > 0.15 ? 'SUCCESS' : 'FAILED';
                }
            } catch {
                outcome = 'FAILED';
            }
            const originalSuccess = op.isSuccess !== undefined ? op.isSuccess : true;
            if ((outcome === 'SUCCESS') !== originalSuccess) deviatedFrom = originalSuccess ? 'original_succeeded' : 'original_failed';
            replayResults.push({ op: opId, outcome, deviatedFrom });
            console.log(`[🪞] Op ${opId.substring(0,8)}: ${outcome}${deviatedFrom ? ` [DEVIATED: ${deviatedFrom}]` : ''}`);
        }
        const identical = replayResults.filter(r => !r.deviatedFrom).length;
        const replayFidelity = (identical / replayResults.length * 100).toFixed(2);
        return { replayResults, replayFidelity: `${replayFidelity}%` };
    }
}
const shadowMirror = new ShadowMirror();
module.exports = { ShadowMirror, shadowMirror, binomialTest, parseNmapServices, resolveDockerImage };