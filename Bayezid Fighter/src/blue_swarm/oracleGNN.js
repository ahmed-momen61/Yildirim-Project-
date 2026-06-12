const crypto = require('crypto');
const axios = require('axios');
const { askRedSwarmAI, smartExec } = require('../core_ai/aiService');
const { publishLiveEvent } = require('../memory_systems/memoryService');
class NetworkNode {
    constructor(ip, hostname = '', os = 'unknown', services = []) {
        this.ip = ip;
        this.hostname = hostname;
        this.os = os;
        this.services = services; 
        this.subnet = ip.split('.').slice(0, 3).join('.') + '.0/24';
        this.risk = 0; 
        this.compromised = false;
        this.isolated = false;
        this.neighbors = new Map(); 
        this.features = null; 
        this.lastSeen = Date.now();
    }
}
class NetworkGNN {
    constructor() {
        this.nodes = new Map(); 
        this.edges = [];
        this.featureDim = 16; 
        this.propagationLayers = 3;
        this.lateralMovementThreshold = 0.7; 
    }
    addNode(ip, data = {}) {
        if (!this.nodes.has(ip)) {
            this.nodes.set(ip, new NetworkNode(ip, data.hostname, data.os, data.services || []));
        } else {
            const node = this.nodes.get(ip);
            if (data.hostname) node.hostname = data.hostname;
            if (data.os) node.os = data.os;
            if (data.services) node.services = [...new Set([...node.services, ...data.services])];
            node.lastSeen = Date.now();
        }
        return this.nodes.get(ip);
    }
    addEdge(srcIp, dstIp, protocol = 'tcp', port = 0, weight = 1.0) {
        this.addNode(srcIp);
        this.addNode(dstIp);
        const srcNode = this.nodes.get(srcIp);
        const dstNode = this.nodes.get(dstIp);
        srcNode.neighbors.set(dstIp, { weight, protocol, port, direction: 'out' });
        dstNode.neighbors.set(srcIp, { weight, protocol, port, direction: 'in' });
        this.edges.push({ src: srcIp, dst: dstIp, protocol, port, weight, timestamp: Date.now() });
    }
    initializeFeatures() {
        for (const [ip, node] of this.nodes) {
            const octets = ip.split('.').map(Number);
            const features = new Float32Array(this.featureDim);
            features[0] = node.neighbors.size / Math.max(this.nodes.size, 1); 
            features[1] = node.services.length / 20; 
            features[2] = node.compromised ? 1.0 : 0.0; 
            features[3] = node.risk / 100; 
            features[4] = octets[0] / 255;
            features[5] = octets[1] / 255;
            features[6] = octets[2] / 255;
            features[7] = octets[3] / 255;
            const riskyPorts = [22, 23, 80, 443, 445, 3389, 5985, 8080, 8443, 9200];
            features[8] = node.services.filter(s => riskyPorts.includes(s.port)).length / riskyPorts.length;
            features[9] = Math.min((Date.now() - node.lastSeen) / 3600000, 1.0);
            let neighborRisk = 0;
            for (const [nip] of node.neighbors) {
                const neighbor = this.nodes.get(nip);
                if (neighbor && neighbor.compromised) neighborRisk += 0.3;
                if (neighbor && neighbor.risk > 50) neighborRisk += 0.1;
            }
            features[10] = Math.min(neighborRisk, 1.0);
            const sameSubnet = [...this.nodes.values()].filter(n => n.subnet === node.subnet).length;
            features[11] = sameSubnet / Math.max(this.nodes.size, 1);
            features[12] = node.isolated ? 1.0 : 0.0;
            features[13] = 0;
            features[14] = 0;
            features[15] = 0;
            node.features = features;
        }
    }
    prune() {
        const now = Date.now();
        const initialCount = this.edges.length;
        this.edges = this.edges.filter(edge => (now - edge.timestamp) < 3600000);
        const prunedCount = initialCount - this.edges.length;
        if (prunedCount > 0) {
            console.log(`[🌐] ORACLE-G: Pruned ${prunedCount} stale edges from GNN matrix.`);
        }
        for (const [ip, node] of this.nodes) {
            for (const [neighborIp] of node.neighbors) {
                const edgeExists = this.edges.some(e => 
                    (e.src === ip && e.dst === neighborIp) || (e.src === neighborIp && e.dst === ip)
                );
                if (!edgeExists) {
                    node.neighbors.delete(neighborIp);
                }
            }
        }
    }
    async propagate(ip = null) {
        this.prune();
        const { redisClient } = require('../memory_systems/memoryService');
        let lockKey = null;
        let lockAcquired = false;
        if (ip && redisClient && redisClient.isOpen) {
            lockKey = `gnn:lock:${ip}`;
            try {
                const res = await redisClient.set(lockKey, 'locked', { EX: 10, NX: true });
                if (!res) {
                    console.log(`[🛑] ADVISORY LOCK: GNN propagation already running for IP ${ip}. Skipping.`);
                    return;
                }
                lockAcquired = true;
            } catch (e) {
                console.warn(`[⚠️] Redis advisory lock check bypassed for ${ip}: ${e.message}`);
            }
        }

        try {
            console.log(`[🌐] ORACLE-G: Building feature matrix for PyTorch GNN...`);
            this.initializeFeatures();
            const nodesList = Array.from(this.nodes.keys());
            const nodeMatrix = nodesList.map(ip => Array.from(this.nodes.get(ip).features));
            const edgeList = [];
            for (const edge of this.edges) {
                const srcIdx = nodesList.indexOf(edge.src);
                const dstIdx = nodesList.indexOf(edge.dst);
                if (srcIdx !== -1 && dstIdx !== -1) {
                    edgeList.push([srcIdx, dstIdx]);
                }
            }
            try {
                const gnnResult = await axios.post('http://127.0.0.1:8001/api/v1/gnn/predict-lateral', {
                    nodes: nodeMatrix,
                    edges: edgeList
                });
                const riskScores = gnnResult.data.risk_scores || [];
                for (let i = 0; i < riskScores.length; i++) {
                    const ip = nodesList[i];
                    const risk = riskScores[i];
                    const node = this.nodes.get(ip);
                    if (node) {
                        node.risk = Math.min(Math.round(risk * 100), 100);
                    }
                }
                console.log(`[🌐] GNN propagation complete via PyTorch. Risk scores updated.`);
            } catch (e) {
                console.error(`[!] Failed to reach PyTorch GNN backend: ${e.message}`);
            }
        } finally {
            if (lockAcquired && lockKey) {
                try {
                    await redisClient.del(lockKey);
                } catch (e) {}
            }
        }
    }
    predictLateralMovement(compromisedIp) {
        const node = this.nodes.get(compromisedIp);
        if (!node) return [];
        const predictions = [];
        for (const [neighborIp, edgeData] of node.neighbors) {
            const neighbor = this.nodes.get(neighborIp);
            if (!neighbor || neighbor.compromised || neighbor.isolated) continue;
            const sameSubnet = neighbor.subnet === node.subnet ? 0.3 : 0;
            const serviceExposure = neighbor.features ? neighbor.features[8] * 0.3 : 0;
            const degreeCentrality = neighbor.features ? neighbor.features[0] * 0.2 : 0;
            const edgeWeight = edgeData.weight * 0.2;
            const probability = sameSubnet + serviceExposure + degreeCentrality + edgeWeight;
            predictions.push({
                targetIp: neighborIp,
                hostname: neighbor.hostname,
                probability: Math.min(probability, 1.0),
                services: neighbor.services,
                subnet: neighbor.subnet,
                riskScore: neighbor.risk
            });
        }
        predictions.sort((a, b) => b.probability - a.probability);
        return predictions;
    }
    async preemptiveIsolation(compromisedIp) {
        console.log(`\n[🛡️] =============================================`);
        console.log(`[🛡️] ORACLE-G: Pre-emptive Isolation Triggered`);
        console.log(`[🛡️] Compromised Node: ${compromisedIp}`);
        console.log(`[🛡️] =============================================\n`);
        const { redisClient } = require('../memory_systems/memoryService');
        const lockKey = `lock:gnn:isolate:${compromisedIp}`;
        let lockAcquired = false;
        try {
            if (redisClient.isOpen) {
                const result = await redisClient.set(lockKey, 'locked', {
                    EX: 10,
                    NX: true
                });
                if (!result) {
                    console.log(`[🛑] ADVISORY LOCK: GNN propagation/isolation already in progress for ${compromisedIp}. Skipping.`);
                    return { compromisedNode: compromisedIp, predictions: [], isolationActions: [], skipped: true };
                }
                lockAcquired = true;
            }
        } catch (e) {
            console.warn(`[⚠️] Redis advisory lock check bypassed: ${e.message}`);
        }
        try {
            await this.propagate(compromisedIp);
            const node = this.nodes.get(compromisedIp);
            if (node) node.compromised = true;
            await this.propagate(compromisedIp);
            const predictions = this.predictLateralMovement(compromisedIp);
            console.log(`[🛡️] Lateral Movement Predictions:`);
            const isolationActions = [];
            for (const pred of predictions) {
                console.log(`  → ${pred.targetIp} (${pred.hostname || 'unknown'}) | Probability: ${(pred.probability * 100).toFixed(1)}% | Risk: ${pred.riskScore}`);
                if (pred.probability >= this.lateralMovementThreshold) {
                    console.log(`  [🔴] ABOVE THRESHOLD (${this.lateralMovementThreshold * 100}%) — Isolating!`);
                    const isolationRules = [
                        `iptables -I INPUT -s ${compromisedIp} -d ${pred.targetIp} -j DROP`,
                        `iptables -I OUTPUT -s ${pred.targetIp} -d ${compromisedIp} -j DROP`,
                        `iptables -I FORWARD -s ${compromisedIp} -d ${pred.targetIp} -j DROP`
                    ];
                    const action = {
                        targetIp: pred.targetIp,
                        probability: pred.probability,
                        rules: isolationRules,
                        status: 'PENDING',
                        timestamp: new Date().toISOString()
                    };
                    for (const rule of isolationRules) {
                        try {
                            console.log(`  [⚡] Executing: ${rule}`);
                            await smartExec(rule, 5000, false);
                            action.status = 'APPLIED';
                        } catch (e) {
                            console.log(`  [!] Rule execution failed (may require root): ${e.message}`);
                            action.status = 'SIMULATED';
                        }
                    }
                    const targetNode = this.nodes.get(pred.targetIp);
                    if (targetNode) targetNode.isolated = true;
                    isolationActions.push(action);
                }
            }
            try {
                await publishLiveEvent('bayezid_tactical_feed', 'ORACLE_PREEMPTIVE_ISOLATION', {
                    compromisedIp,
                    isolatedNodes: isolationActions.length,
                    predictions: predictions.slice(0, 5)
                });
            } catch (e) {}
            console.log(`\n[🛡️] ORACLE-G: ${isolationActions.length} nodes pre-emptively isolated.`);
            return {
                compromisedNode: compromisedIp,
                predictions,
                isolationActions,
                graphStats: {
                    totalNodes: this.nodes.size,
                    totalEdges: this.edges.length,
                    compromisedNodes: [...this.nodes.values()].filter(n => n.compromised).length,
                    isolatedNodes: [...this.nodes.values()].filter(n => n.isolated).length
                }
            };
        } finally {
            if (lockAcquired) {
                try {
                    await redisClient.del(lockKey);
                } catch (e) {}
            }
        }
    }
    predictTemporalTraps(compromisedIp) {
        console.log(`\n[🔮] ORACLE-G: Calculating attacker's next 3 temporal steps from ${compromisedIp}...`);
        const predictions = this.predictLateralMovement(compromisedIp);
        const top3 = predictions.slice(0, 3);
        console.log(`[🔮] Temporal Traps deployed on:`);
        const deployedTraps = [];
        for (const target of top3) {
            console.log(`  → ${target.targetIp} (${target.hostname || 'unknown'}) | Temporal Confidence: ${(target.probability * 100).toFixed(1)}%`);
            deployedTraps.push(target.targetIp);
        }
        return deployedTraps;
    }
    ingestTraffic(trafficEntries) {
        console.log(`[🌐] ORACLE-G: Ingesting ${trafficEntries.length} traffic entries...`);
        if (!this.recentProbes) this.recentProbes = new Map();
        for (const entry of trafficEntries) {
            const { srcIp, dstIp, protocol, port, hostname, os, services } = entry;
            this.addNode(srcIp, { hostname: entry.srcHostname, os: entry.srcOs });
            this.addNode(dstIp, { hostname, os, services });
            this.addEdge(srcIp, dstIp, protocol || 'tcp', port || 0, 1.0);
            if (srcIp && port) {
                if (!this.recentProbes.has(srcIp)) {
                    this.recentProbes.set(srcIp, { ports: new Set(), timestamp: Date.now() });
                }
                const probe = this.recentProbes.get(srcIp);
                if (Date.now() - probe.timestamp > 30000) {
                    probe.ports.clear();
                    probe.timestamp = Date.now();
                }
                probe.ports.add(port);
                if (probe.ports.size > 3) {
                    console.log(`[🍯] HONEY-GRID: High scanning activity detected on ${srcIp} (>3 ports probed in 30s). Deploying decoy...`);
                    const serviceType = port === 22 ? 'cowrie' : port === 6379 ? 'redis' : port === 5432 ? 'postgres' : 'nginx';
                    try {
                        const { deployDecoy } = require('../network/decoyManager');
                        deployDecoy({
                            triggerIp: srcIp,
                            targetPort: port,
                            serviceType
                        }).catch(e => console.error(`[⚠️] Decoy trigger error:`, e.message));
                    } catch (decoyErr) {
                        console.warn(`[⚠️] Failed to trigger decoyManager: ${decoyErr.message}`);
                    }
                    probe.ports.clear();
                }
            }
        }
        console.log(`[🌐] Graph updated: ${this.nodes.size} nodes, ${this.edges.length} edges.`);
    }
    async ingestNmapScan(targetSubnet) {
        console.log(`[🌐] ORACLE-G: Running stealth nmap scan on ${targetSubnet}...`);
        try {
            const { stdout } = await smartExec(
                `nmap -sn -T2 ${targetSubnet} -oG -`,
                60000, false
            );
            const lines = stdout.split('\n');
            for (const line of lines) {
                const hostMatch = line.match(/Host:\s+(\d+\.\d+\.\d+\.\d+)\s+\(([^)]*)\)/);
                if (hostMatch) {
                    const [_, ip, hostname] = hostMatch;
                    this.addNode(ip, { hostname });
                }
            }
            console.log(`[✔] Nmap scan complete. ${this.nodes.size} hosts discovered.`);
        } catch (e) {
            console.log(`[!] Nmap scan failed: ${e.message}. Using existing topology.`);
        }
    }
    toMermaid() {
        let mermaid = 'graph LR\n';
        for (const [ip, node] of this.nodes) {
            const safeId = ip.replace(/\./g, '_');
            const label = node.hostname ? `${node.hostname}\\n${ip}` : ip;
            let style = '';
            if (node.compromised) style = ':::compromised';
            else if (node.isolated) style = ':::isolated';
            else if (node.risk > 60) style = ':::highrisk';
            mermaid += `    ${safeId}["${label} (Risk: ${node.risk})"]${style}\n`;
        }
        const seen = new Set();
        for (const edge of this.edges.slice(-100)) {
            const key = `${edge.src}-${edge.dst}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const srcId = edge.src.replace(/\./g, '_');
            const dstId = edge.dst.replace(/\./g, '_');
            mermaid += `    ${srcId} -->|${edge.protocol}:${edge.port}| ${dstId}\n`;
        }
        return mermaid;
    }
    getTopology() {
        const nodeList = [];
        for (const [ip, node] of this.nodes) {
            nodeList.push({
                ip,
                hostname: node.hostname,
                os: node.os,
                services: node.services,
                subnet: node.subnet,
                risk: node.risk,
                compromised: node.compromised,
                isolated: node.isolated,
                neighborCount: node.neighbors.size
            });
        }
        return {
            nodes: nodeList,
            edgeCount: this.edges.length,
            subnets: [...new Set(nodeList.map(n => n.subnet))],
            mermaidDiagram: this.toMermaid()
        };
    }
}
const oracleGNN = new NetworkGNN();
module.exports = { NetworkGNN, oracleGNN };